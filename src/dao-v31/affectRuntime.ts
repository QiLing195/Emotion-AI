import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import type { AppraisalInput } from './appraisal.ts';
import { appraisalInput, assess } from './appraisal.ts';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { emotionRules, initialEmotion } from './emotionModel.ts';
import { conflict, denied, invalid } from './errors.ts';
import type { GrantUse, M1PersistencePort, M1WriteTransaction } from './m1Types.ts';
import { isIdentifier } from './sessionAuth.ts';
import { initialClock, settleTime } from './simulationClock.ts';
import type { TimeSource, WallClock } from './simulationClock.ts';
import { StateCoordinator, staleConsent } from './stateCoordinator.ts';
import { trackUpdate } from './trackMetrics.ts';
import { DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import { exactJson, jsonValue } from './exactJson.ts';

export type RoleAppraisal = Readonly<{
  commitEventId: string; turnId: string; appraisal: AppraisalInput; evidence: readonly EntityRef[];
  relationshipSignal: number; consentVersion: number; baseVersion: number; deadlineMs?: number;
}>;

export class AffectRuntime {
  readonly #store: M1PersistencePort;
  readonly #consent: ConsentManager;
  readonly #hub: PersonalDataHub;
  readonly #coordinator: StateCoordinator;
  readonly #wall: WallClock;

  constructor(store: M1PersistencePort, consent: ConsentManager, hub: PersonalDataHub, coordinator: StateCoordinator, wall: WallClock) {
    this.#store = store;
    this.#consent = consent;
    this.#hub = hub;
    this.#coordinator = coordinator;
    this.#wall = wall;
  }

  openTurn(scope: DaoScope, eventId: string, turnId: string, expectedConsentVersion: number) {
    return this.#store.write(scope, async (tx) => {
      if (!isIdentifier(turnId)) throw invalid('Invalid turn ID');
      const prior = await tx.getEvent(eventId);
      if (prior) {
        if (prior.eventType !== 'RoleTurnOpened' || prior.turnId !== turnId || prior.consentVersion !== expectedConsentVersion) {
          throw conflict('Turn event ID already exists');
        }
        const commit = await tx.getCommit(eventId, DAO_PROJECTION_VERSION);
        if (!commit) throw conflict('Turn has no committed boundary');
        return commit;
      }
      return this.#coordinator.apply(tx, {
        eventId, eventType: 'RoleTurnOpened', source: 'role-runtime', turnId,
        occurredAt: new Date(this.#wall.now()).toISOString(), baseVersion: tx.runtime()?.state.stateVersion ?? 0,
        consentVersion: expectedConsentVersion, writeKind: 'governed', governanceApproved: true, change: { kind: 'mark' },
      });
    });
  }

  async applyA(scope: DaoScope, use: GrantUse, work: RoleAppraisal) {
    const ticket = await this.#consent.admit(scope, { ...use, permission: 'allowCharacterUse' }, work.consentVersion);
    return this.#store.write(scope, async (tx) => {
      await this.#consent.check(tx, ticket, 'pre_commit');
      await this.#consent.check(tx, { ...ticket, use: { ...ticket.use, permission: 'allowAnalysis' } }, 'pre_commit');
      return this.apply(tx, work, 'A');
    });
  }

  async apply(tx: M1WriteTransaction, work: RoleAppraisal, track: 'A' | 'C') {
    const start = performance.now();
    const { turnId, evidence } = work;
    const appraisal = appraisalInput(work.appraisal);
    const parent = await tx.getEvent(appraisal.eventId);
    if (parent?.eventType !== 'RoleTurnOpened' || parent.turnId !== turnId) throw conflict('Role appraisal has no matching turn');
    const validated = assess(appraisal);
    const declared = new Set(evidence.map((ref) => ref.entityId));
    if (evidence.some((ref) => ref.kind !== 'observation' && ref.kind !== 'memory') ||
        validated.evidence.some((id) => !declared.has(id)) ||
        (await this.#hub.authorizedEvidence(tx, evidence, 'allowCharacterUse')).size !== declared.size) {
      throw denied('Role appraisal requires authorized non-raw evidence');
    }
    const command = { kind: 'emotion', eventId: work.commitEventId, appraisal,
      relationshipSignal: work.relationshipSignal, rules: emotionRules } as const;
    const existing = await tx.getEvent(work.commitEventId);
    if (existing) {
      const prior = await tx.getCommit(work.commitEventId, DAO_PROJECTION_VERSION);
      if (!prior || existing.turnId !== turnId || existing.consentVersion !== work.consentVersion
          || exactJson(existing.payload) !== exactJson(jsonValue({ change: command }))) throw conflict('Appraisal commit ID has already been used');
      return { ...prior, outcome: 'NOOP_DUPLICATE' as const };
    }
    const clock = this.#wall.now();
    const commit = await this.#coordinator.apply(tx, {
      eventId: work.commitEventId, eventType: 'RoleAppraisalApplied', source: 'role-runtime', turnId,
      parentEventId: appraisal.eventId, occurredAt: parent.occurredAt, deadlineMs: work.deadlineMs,
      baseVersion: work.baseVersion, consentVersion: work.consentVersion, writeKind: 'exclusive',
      change: command,
      provenance: { evidenceIds: validated.evidence, recordIds: [] },
    });
    if (track === 'A' && commit.outcome === 'COMMITTED') trackUpdate(tx, {
      track: 'A', status: 'completed', eventId: commit.eventId,
    }, 0, Math.max(performance.now() - start, this.#wall.now() - clock));
    return commit;
  }

  settle(scope: DaoScope, settlementId: string, expectedConsentVersion: number, source: TimeSource = 'real_elapsed', manualTargetMs?: number) {
    return this.#store.write(scope, async (tx) => {
      if (await tx.getConsentVersion() !== expectedConsentVersion) throw staleConsent('pre_commit');
      if (source === 'manual_simulation' && manualTargetMs === undefined) throw invalid('Manual settlement needs a simulation timestamp');
      const timestamp = this.#wall.now();
      const targetMs = source === 'manual_simulation' ? manualTargetMs! : timestamp;
      const existing = await tx.getEvent(settlementId);
      if (existing) {
        const payload = existing.payload as { change?: { kind: string; clock?: { source: TimeSource; targetMs: number } } };
        if (existing.eventType !== 'TimeSettled' || payload.change?.clock?.source !== source
          || (source === 'manual_simulation' && payload.change.clock.targetMs !== targetMs)) throw conflict('Time ID already belongs to a different event');
        return { status: 'duplicate' as const, elapsedMs: 0, state: tx.runtime()?.state.emotion?.clock ?? initialClock };
      }
      const current = tx.runtime();
      const command = { source, settlementId, targetMs };
      const result = settleTime(current?.state.emotion?.clock ?? initialClock, command, scope.env);
      if (result.status !== 'settled') {
        if (result.status === 'clock_rollback') trackUpdate(tx, { track: 'D', status: 'degraded', detail: 'clock_rollback' }, 0);
        return result;
      }
      await this.#coordinator.apply(tx, {
        eventId: settlementId, eventType: 'TimeSettled', source: 'simulation-clock', occurredAt: new Date(timestamp).toISOString(),
        baseVersion: current?.state.stateVersion ?? 0, consentVersion: expectedConsentVersion, writeKind: 'exclusive',
        change: { kind: 'settle', eventId: settlementId, clock: command, env: scope.env, rules: emotionRules },
      });
      trackUpdate(tx, { track: 'D', status: 'completed', eventId: settlementId }, 0);
      return { ...result, state: tx.runtime()?.state.emotion?.clock ?? initialEmotion.clock };
    });
  }
}
