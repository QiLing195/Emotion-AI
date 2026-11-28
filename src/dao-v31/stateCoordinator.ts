import { randomUUID } from 'node:crypto';
import { DAO_CHECKPOINT_INTERVAL, DAO_CONTRACT_VERSION, DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import type { CommitRecord, DaoScope, JsonObject, SystemEvent, WriteKind } from '../contracts/dao-v31/index.ts';
import type { HistoryEntry, M1PersistencePort, M1ReadTransaction, M1WriteTransaction, ProjectionChange, RuntimeProjection } from './m1Types.ts';
import { initialRuntime, project, validateChange } from './projection.ts';
import { integrityHash, jsonValue } from './exactJson.ts';
import { projectionHash } from './determinism.ts';
import { conflict, DaoError, invalid } from './errors.ts';
import { isIdentifier } from './sessionAuth.ts';

export interface StateProposal {
  readonly eventId: string;
  readonly eventType: string;
  readonly turnId?: string;
  readonly source: string;
  readonly occurredAt: string;
  readonly baseVersion: number;
  readonly consentVersion: number;
  readonly writeKind: WriteKind;
  readonly change: ProjectionChange;
  readonly parentEventId?: string;
  readonly deadlineMs?: number;
  readonly governanceApproved?: boolean;
  readonly provenance?: SystemEvent['provenance'];
}

type Effect = (tx: M1WriteTransaction, event: SystemEvent) => Promise<void> | void;

export function staleConsent(stage: 'pre_dispatch' | 'pre_external' | 'pre_commit') {
  return new DaoError(409, 'CONSENT_VERSION_MISMATCH', 'Consent version changed', {
    stage, ...(stage === 'pre_commit' && { outcome: 'DISCARDED_BY_REVOCATION' }),
  });
}

function checkpoint(tx: M1WriteTransaction, current: ReturnType<typeof project>) {
  return tx.saveCheckpoint({
    scope: tx.scope, sequence: current.state.sequence, stateVersion: current.state.stateVersion,
    projectionVersion: DAO_PROJECTION_VERSION, stateHash: current.hash, snapshot: { ...current.state },
  });
}

export function replayEntry(current: ReturnType<typeof project>, entry: HistoryEntry) {
  const { event, commit } = entry;
  if (event.sequence !== current.state.sequence + 1 || commit.eventId !== event.eventId
    || commit.sequence !== event.sequence || commit.priorStateVersion !== current.state.stateVersion
    || commit.projectionVersion !== DAO_PROJECTION_VERSION || commit.outcome !== 'COMMITTED'
    || commit.consentVersion !== event.consentVersion) throw conflict('Event log sequence or commit integrity mismatch');
  const change = (event.payload as JsonObject).change as unknown as ProjectionChange;
  checkRuntimeEvent(change, event.eventId, event.scope.env);
  validateChange(commit.writeKind, change);
  const next = project(current.state, change, event.sequence);
  if (next.hash !== commit.stateHash || next.state.stateVersion !== commit.stateVersion) {
    throw conflict('Replayed state does not match the committed projection');
  }
  return next;
}

function checkRuntimeEvent(change: ProjectionChange, eventId: string, env: DaoScope['env']) {
  if ((change.kind === 'emotion' || change.kind === 'settle') && change.eventId !== eventId
      || change.kind === 'settle' && change.env !== env) throw invalid('Runtime command does not match its event scope');
}

export class StateCoordinator {
  readonly #store: M1PersistencePort;
  readonly #now: () => number;

  constructor(store: M1PersistencePort, now = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  commit(scope: DaoScope, proposal: StateProposal) {
    return this.#store.write(scope, (tx) => this.apply(tx, proposal));
  }

  async apply(tx: M1WriteTransaction, proposal: StateProposal, effect?: Effect): Promise<CommitRecord> {
    const { eventId, eventType, source, occurredAt, baseVersion, consentVersion, writeKind, change, parentEventId } = proposal;
    if (![eventId, eventType, source].every(isIdentifier) || !Number.isSafeInteger(baseVersion) || baseVersion < 0
        || !Number.isSafeInteger(consentVersion) || consentVersion < 0 || !Number.isFinite(Date.parse(occurredAt))
        || (proposal.turnId !== undefined && !isIdentifier(proposal.turnId))
        || (proposal.deadlineMs !== undefined && !Number.isFinite(proposal.deadlineMs))) {
      throw invalid('Invalid event proposal');
    }
    validateChange(writeKind, change);
    checkRuntimeEvent(change, eventId, tx.scope.env);
    if (await tx.getConsentVersion() !== consentVersion) throw staleConsent('pre_commit');
    const fingerprint = integrityHash(jsonValue(proposal));
    const prior = await tx.getCommit(eventId, DAO_PROJECTION_VERSION);
    if (prior) {
      const existing = tx.history(prior.sequence - 1, 1)[0];
      if (existing?.fingerprint !== fingerprint) throw conflict('Event ID already belongs to a different proposal');
      return { ...prior, outcome: 'NOOP_DUPLICATE' };
    }
    const now = this.#now();
    if (proposal.deadlineMs !== undefined && now >= proposal.deadlineMs) throw conflict('Proposal has expired');
    const current = tx.runtime() ?? initialRuntime;
    if (baseVersion > current.state.stateVersion || ((writeKind === 'exclusive' || writeKind === 'governed')
        && baseVersion !== current.state.stateVersion)) throw conflict('Proposal uses an incompatible state version');
    if (writeKind === 'governed' && !proposal.governanceApproved) throw conflict('Governed mutation requires explicit approval');
    if (parentEventId && !await tx.getEvent(parentEventId)) throw conflict('Parent event is unavailable in this scope');

    const sequence = current.state.sequence + 1;
    const time = new Date(now).toISOString();
    const next = project(current.state, change, sequence);
    const event: SystemEvent = {
      eventId, eventType, scope: tx.scope, occurredAt, receivedAt: time, sequence,
      source: { module: source }, ...(parentEventId ? { parentEventId } : {}),
      ...(proposal.turnId && { turnId: proposal.turnId }),
      schemaVersion: DAO_CONTRACT_VERSION, consentVersion, payload: { change },
      provenance: proposal.provenance ?? { evidenceIds: [], recordIds: [] },
    };
    const commit: CommitRecord = {
      commitId: randomUUID(), eventId, scope: tx.scope, sequence, writeKind, outcome: 'COMMITTED',
      priorStateVersion: current.state.stateVersion, stateVersion: next.state.stateVersion,
      projectionVersion: DAO_PROJECTION_VERSION, consentVersion, stateHash: next.hash, committedAt: time,
    };
    await tx.appendEvent(event);
    tx.setEventFingerprint(eventId, fingerprint);
    if (effect) await effect(tx, event);
    await tx.appendCommit(commit);
    tx.setRuntime(next);
    if (sequence % DAO_CHECKPOINT_INTERVAL === 0) await checkpoint(tx, next);
    tx.enqueue({ event: 'system_event', eventId });
    tx.enqueue({ event: 'commit_record', eventId });
    return commit;
  }

  current(scope: DaoScope) {
    return this.#store.read(scope, (tx) => tx.runtime() ?? initialRuntime);
  }

  replay(scope: DaoScope) {
    return this.#store.read(scope, (tx) => this.#rebuild(tx, false));
  }

  recover(scope: DaoScope) {
    return this.#store.write(scope, async (tx) => {
      const restored = await this.#rebuild(tx, true);
      tx.setRuntime(restored);
      return restored;
    });
  }

  async #rebuild(tx: M1ReadTransaction, useCheckpoint: boolean) {
    let current = initialRuntime;
    if (useCheckpoint) {
      const saved = await tx.getLatestCheckpoint(DAO_PROJECTION_VERSION, Number.MAX_SAFE_INTEGER);
      if (saved) {
        const { snapshot, stateHash, stateVersion, sequence } = saved;
        const baseCommit = tx.history(sequence - 1, 1)[0]?.commit;
        if (baseCommit?.sequence !== sequence || baseCommit.stateHash !== stateHash
            || snapshot.sequence !== sequence || snapshot.stateVersion !== stateVersion
            || projectionHash(snapshot) !== stateHash) throw conflict('Checkpoint integrity mismatch');
        current = { state: snapshot as unknown as RuntimeProjection, hash: stateHash };
      }
    }
    while (true) {
      const rows = tx.history(current.state.sequence, 256);
      for (const entry of rows) current = replayEntry(current, entry);
      if (rows.length < 256) break;
    }
    if ((await tx.listEvents(current.state.sequence, 1)).length > 0) throw conflict('Event log has an uncommitted entry');
    return current;
  }
}

export async function restoreHistory(tx: M1WriteTransaction, history: readonly HistoryEntry[]) {
  let current = tx.runtime() ?? initialRuntime;
  for (const entry of history) {
    const next = replayEntry(current, entry);
    await tx.appendEvent(entry.event);
    tx.setEventFingerprint(entry.event.eventId, entry.fingerprint);
    await tx.appendCommit(entry.commit);
    if (next.state.sequence % DAO_CHECKPOINT_INTERVAL === 0) await checkpoint(tx, next);
    tx.enqueue({ event: 'system_event', eventId: entry.event.eventId });
    tx.enqueue({ event: 'commit_record', eventId: entry.event.eventId });
    current = next;
  }
  tx.setRuntime(current);
  return current;
}
