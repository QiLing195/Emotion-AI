import { randomUUID } from 'node:crypto';
import { CONSENT_DIMENSIONS, CONSENT_PREREQUISITES } from '../contracts/dao-v31/index.ts';
import type { ConsentChange, ConsentDimension, ConsentStage, DaoScope, DataCategory, DataConsent } from '../contracts/dao-v31/index.ts';
import type { DataUse, GrantUse, M1PersistencePort, M1ReadTransaction, M1WriteTransaction } from './m1Types.ts';
import { StateCoordinator, staleConsent } from './stateCoordinator.ts';
import { denied, DaoError, invalid } from './errors.ts';
import { grantKey } from './m1Types.ts';
import { idempotent } from './idempotency.ts';
import type { IdempotencyKey } from './idempotency.ts';

const scopeKey = (scope: DaoScope) => JSON.stringify([scope.ownerId, scope.env, scope.characterId, scope.sessionId]);

export class ConsentView {
  readonly #byKey: ReadonlyMap<string, DataConsent>;
  readonly #now: number;

  constructor(grants: readonly DataConsent[], now: number) {
    this.#now = now;
    this.#byKey = new Map(grants.map((grant) => [grantKey(grant), grant]));
  }

  resolve(use: DataUse, permission: ConsentDimension): DataConsent | undefined {
    const grant = this.#byKey.get(grantKey(use));
    if (!grant || grant.revokedAt || (grant.expiresAt && Date.parse(grant.expiresAt) <= this.#now)
        || !grant.purposes.includes(use.purpose) || !grant.permissions[permission]
        || CONSENT_PREREQUISITES[permission].some((required) => !grant.permissions[required])) return undefined;
    if (grant.dataScope && (!use.dataScope?.length || use.dataScope.some((item) => !grant.dataScope?.includes(item)))) return undefined;
    return grant;
  }
}

export interface ConsentTicket {
  readonly scope: DaoScope;
  readonly use: GrantUse;
  readonly expectedVersion: number;
}

function isNarrowed(previous: DataConsent | undefined, current: DataConsent) {
  if (!previous || previous.revokedAt) return false;
  return Boolean(current.revokedAt
    || CONSENT_DIMENSIONS.some((key) => previous.permissions[key] && !current.permissions[key])
    || previous.purposes.some((purpose) => !current.purposes.includes(purpose))
    || (current.dataScope && (!previous.dataScope || previous.dataScope.some((item) => !current.dataScope?.includes(item))))
    || (current.expiresAt && (!previous.expiresAt || Date.parse(current.expiresAt) < Date.parse(previous.expiresAt)))
    || (['rawDataRetentionDays', 'derivedDataRetentionDays'] as const).some((key) =>
      (current.retentionPolicy[key] ?? Infinity) < (previous.retentionPolicy[key] ?? Infinity)));
}

export class ConsentManager {
  readonly #store: M1PersistencePort;
  readonly #coordinator: StateCoordinator;
  readonly #now: () => number;
  readonly #active = new Map<string, Set<{ controller: AbortController; version: number }>>();

  constructor(store: M1PersistencePort, coordinator: StateCoordinator, now = Date.now) {
    this.#store = store;
    this.#coordinator = coordinator;
    this.#now = now;
  }

  list(scope: DaoScope) {
    return this.#store.read(scope, async (tx) => ({ items: await tx.listConsents(), version: await tx.getConsentVersion() }));
  }

  async view(tx: M1ReadTransaction) {
    return new ConsentView(await tx.listConsents(), this.#now());
  }

  async check(tx: M1ReadTransaction, ticket: ConsentTicket, stage: ConsentStage) {
    if (await tx.getConsentVersion() !== ticket.expectedVersion) throw staleConsent(stage);
    const grant = (await this.view(tx)).resolve(ticket.use, ticket.use.permission);
    if (!grant) throw denied();
    return grant;
  }

  async replace(scope: DaoScope, category: DataCategory, change: ConsentChange, key?: IdempotencyKey): Promise<DataConsent> {
    const result = await this.#store.write(scope, (tx) => idempotent(tx, key, async () => {
      if (CONSENT_DIMENSIONS.some((dimension) => change.permissions[dimension]
          && CONSENT_PREREQUISITES[dimension].some((required) => !change.permissions[required]))) {
        throw new DaoError(400, 'INVALID_CONSENT_DEPENDENCY', 'Consent dimensions have unsatisfied prerequisites');
      }
      const { expectedConsentVersion, ...fields } = change;
      if (await tx.getConsentVersion() !== expectedConsentVersion) throw staleConsent('pre_commit');
      const time = this.#now();
      if (fields.expiresAt && Date.parse(fields.expiresAt) <= time && fields.permissions.allowRead) {
        throw invalid('New active consent must expire in the future');
      }
      const old = (await tx.listConsents()).find((item) => grantKey(item) === grantKey({ ...fields, category }));
      const now = new Date(time).toISOString();
      const consent: DataConsent = {
        ...fields, category, scope, consentId: old?.consentId ?? randomUUID(),
        consentVersion: expectedConsentVersion + 1, grantedAt: now,
        ...(!fields.permissions.allowRead && { revokedAt: now }),
      };
      await tx.updateConsent(expectedConsentVersion, consent);
      const narrowed = isNarrowed(old, consent);
      await this.#coordinator.apply(tx, {
        eventId: randomUUID(), eventType: narrowed ? 'ConsentRevoked' : 'ConsentUpdated', source: 'consent-manager',
        occurredAt: now, baseVersion: tx.runtime()?.state.stateVersion ?? 0, consentVersion: consent.consentVersion,
        writeKind: 'governed', change: { kind: 'mark' }, governanceApproved: true,
      });
      if (narrowed) tx.enqueue({ event: 'consent_revoked', data: {
        category, sensitivity: consent.sensitivity, sourceId: consent.sourceId, consentVersion: consent.consentVersion,
      } });
      return consent;
    }));
    if (!result.repeated) this.notifyVersion(scope, result.result.consentVersion);
    return result.result;
  }

  notifyVersion(scope: DaoScope, version: number) {
    for (const pending of this.#active.get(scopeKey(scope)) ?? []) {
      if (pending.version < version) pending.controller.abort(staleConsent('pre_commit'));
    }
  }

  async admit(scope: DaoScope, use: GrantUse, expectedVersion: number): Promise<ConsentTicket> {
    const ticket = { scope: { ...scope }, use: { ...use, ...(use.dataScope && { dataScope: [...use.dataScope] }) }, expectedVersion };
    await this.#store.read(scope, (tx) => this.check(tx, ticket, 'pre_dispatch'));
    return ticket;
  }

  async execute<T, R>(
    ticket: ConsentTicket, external: (signal: AbortSignal) => Promise<T>,
    persist: (tx: M1WriteTransaction, value: T) => Promise<R> | R,
  ): Promise<R> {
    const key = scopeKey(ticket.scope);
    const active = this.#active.get(key) ?? new Set();
    const controller = new AbortController();
    const pending = { controller, version: ticket.expectedVersion };
    active.add(pending);
    this.#active.set(key, active);
    let monitor: NodeJS.Timeout | undefined;
    let checking = false;
    try {
      await this.#store.read(ticket.scope, (tx) => this.check(tx, ticket, 'pre_external'));
      if (controller.signal.aborted) throw staleConsent('pre_external');
      monitor = setInterval(() => {
        if (checking || controller.signal.aborted) return;
        checking = true;
        void this.#store.read(ticket.scope, (tx) => this.check(tx, ticket, 'pre_commit'))
          .catch((error: unknown) => controller.abort(error))
          .finally(() => { checking = false; });
      }, 200);
      monitor.unref();
      let value: T;
      try {
        value = await external(controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
      }
      return await this.#store.write(ticket.scope, async (tx) => {
        await this.check(tx, ticket, 'pre_commit');
        controller.signal.throwIfAborted();
        return persist(tx, value);
      });
    } finally {
      clearInterval(monitor);
      active.delete(pending);
      if (active.size === 0) this.#active.delete(key);
    }
  }
}
