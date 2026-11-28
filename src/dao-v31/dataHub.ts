import { randomUUID } from 'node:crypto';
import type {
  ConsentDimension, DaoResponseData, DaoScope, DataCategory,
  DataConsent, EntityRef, JsonObject, ProvenanceRecord, SensitivityLevel, SystemEvent,
} from '../contracts/dao-v31/index.ts';
import type {
  ConsentedEntity, DataLayer, DataUse, M1PersistencePort, M1ReadTransaction, M1WriteTransaction,
  ManualRecord, Observation,
} from './m1Types.ts';
import { ConsentManager, ConsentView } from './consentManager.ts';
import { StateCoordinator, staleConsent } from './stateCoordinator.ts';
import type { IdempotencyKey } from './idempotency.ts';
import { idempotent } from './idempotency.ts';
import { conflict, denied, invalid, missing } from './errors.ts';
import { isIdentifier } from './sessionAuth.ts';
import { grantKey } from './m1Types.ts';

export const layerKinds: Record<DataLayer, EntityRef['kind']> = {
  raw_event: 'event', observation: 'observation', pattern: 'pattern', hypothesis: 'hypothesis', memory: 'memory', insight: 'insight',
};

const permissions: Record<DataLayer, ConsentDimension> = {
  raw_event: 'allowRead', observation: 'allowAnalysis', pattern: 'allowAnalysis',
  hypothesis: 'allowPsychologicalInference', memory: 'allowLongTermMemory', insight: 'allowAnalysis',
};

const order = Object.keys(layerKinds) as DataLayer[];
const DAY = 86_400_000;

type Filter = { readonly category?: DataCategory; readonly sensitivity?: SensitivityLevel };
type RecordReceipt = DaoResponseData<'createDataRecord'>;
type Graph = DaoResponseData<'getProvenance'>;
type DerivedInput = Readonly<{
  entityId: string;
  layer: Exclude<DataLayer, 'raw_event' | 'observation'>;
  upstream: readonly EntityRef[];
  use: DataUse;
  body: JsonObject;
  consentVersion: number;
  memoryGovernanceApproved?: boolean;
  versions?: ProvenanceRecord['versions'];
}>;

function matchesFilter(use: DataUse | DataConsent, filter: Filter) {
  return (!filter.category || filter.category === use.category) && (!filter.sensitivity || filter.sensitivity === use.sensitivity);
}

function dataUse(use: DataUse): DataUse {
  return {
    sourceId: use.sourceId, category: use.category, sensitivity: use.sensitivity, purpose: use.purpose,
    collectionMode: use.collectionMode, ...(use.deviceId && { deviceId: use.deviceId }),
    ...(use.dataScope && { dataScope: use.dataScope }),
  };
}

export function readRequirements(view: ConsentView, entity: ConsentedEntity, now: number) {
  const grant = view.resolve(entity.use, permissions[entity.layer]);
  if (!grant) return false;
  const days = entity.layer === 'raw_event' ? grant.retentionPolicy.rawDataRetentionDays : grant.retentionPolicy.derivedDataRetentionDays;
  return days === undefined || now - Date.parse(entity.occurredAt) < days * DAY;
}

export function visibleEntities(entities: readonly ConsentedEntity[], proofs: readonly ProvenanceRecord[], view: ConsentView, now: number) {
  const byId = new Map(entities.map((entity) => [entity.ref.entityId, entity]));
  const parents = new Map<string, string[]>();
  for (const proof of proofs) {
    const links = parents.get(proof.entity.entityId) ?? [];
    for (const upstream of proof.upstream) links.push(upstream.entityId);
    parents.set(proof.entity.entityId, links);
  }
  const memo = new Map<string, boolean>();
  const allowed = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const entity = byId.get(id);
    memo.set(id, false);
    if (!entity || !readRequirements(view, entity, now) || !(parents.get(id) ?? []).every(allowed)) return false;
    memo.set(id, true);
    return true;
  };
  return new Set(entities.map((entity) => entity.ref.entityId).filter(allowed));
}

/** Event payloads carry structural facts; visibility still follows the underlying evidence. */
export function eventView(event: SystemEvent, visible: ReadonlySet<string>, proofs: ReadonlySet<string>): SystemEvent | null {
  if (!event.provenance.evidenceIds.every((id) => visible.has(id))) return null;
  const recordIds = event.provenance.recordIds.filter((id) => proofs.has(id));
  return { ...event, provenance: { ...event.provenance, recordIds } };
}

export class PersonalDataHub {
  readonly #store: M1PersistencePort;
  readonly #consent: ConsentManager;
  readonly #coordinator: StateCoordinator;
  readonly #now: () => number;

  constructor(store: M1PersistencePort, consent: ConsentManager, coordinator: StateCoordinator, now = Date.now) {
    this.#store = store;
    this.#consent = consent;
    this.#coordinator = coordinator;
    this.#now = now;
  }

  async visible(tx: M1ReadTransaction) {
    const proofs = tx.lineage();
    const entities = visibleEntities(tx.entities(), proofs, await this.#consent.view(tx), this.#now());
    return { entities, proofIds: new Set(proofs.filter((proof) => entities.has(proof.entity.entityId)).map((proof) => proof.recordId)) };
  }

  async authorizedEvidence(tx: M1ReadTransaction, references: readonly EntityRef[], use?: ConsentDimension) {
    const view = await this.#consent.view(tx);
    const now = this.#now();
    const available = new Map<string, boolean>();
    async function permits(ref: EntityRef): Promise<boolean> {
      const key = ref.kind + ':' + ref.entityId;
      if (available.has(key)) return available.get(key)!;
      available.set(key, false);
      const item = tx.entity(ref.entityId);
      if (!item || item.ref.kind !== ref.kind || !readRequirements(view, item, now)) return false;
      for (const proof of await tx.getProvenance(ref.entityId)) {
        for (const parent of proof.upstream) if (!await permits(parent)) return false;
      }
      available.set(key, true);
      return true;
    }
    const visible = new Set<string>();
    for (const ref of references) {
      if (await permits(ref) && (!use || view.resolve(tx.entity(ref.entityId)!.use, use))) visible.add(ref.entityId);
    }
    return visible;
  }

  ingest(scope: DaoScope, input: ManualRecord, key?: IdempotencyKey) {
    return this.#store.write(scope, async (tx) => {
      const use = dataUse({ ...input, collectionMode: 'manual', dataScope: [input.type] });
      const view = await this.#consent.view(tx);
      const current = view.resolve(use, 'allowUpload');
      if (!current) throw denied();
      const { result, repeated } = await idempotent<RecordReceipt>(tx, key, () => this.#ingest(tx, use, input, current, view));
      if (repeated && !(await this.visible(tx)).entities.has(result.recordId)) throw missing();
      if (!repeated) return result;
      const allowed = (await this.visible(tx)).proofIds;
      return { ...result, provenanceIds: result.provenanceIds.filter((id) => allowed.has(id)) };
    });
  }

  async #ingest(tx: M1WriteTransaction, use: DataUse, input: ManualRecord, grant: DataConsent, view: ConsentView): Promise<RecordReceipt> {
    const consentVersion = await tx.getConsentVersion();
    if (consentVersion !== input.expectedConsentVersion) throw staleConsent('pre_commit');
    const raw: EntityRef = { kind: 'event', entityId: randomUUID() };
    const observation: EntityRef = { kind: 'observation', entityId: randomUUID() };
    const eventId = randomUUID();
    const at = new Date(this.#now()).toISOString();
    const canDerive = Boolean(view.resolve(use, 'allowAnalysis'));
    const proofs: ProvenanceRecord[] = [{
      recordId: randomUUID(), scope: tx.scope, kind: 'collected', entity: raw, upstream: [],
      actor: { actorId: tx.scope.ownerId, kind: 'user' }, occurredAt: at, consentVersion, consentId: grant.consentId,
      source: { sourceId: use.sourceId, category: use.category, sensitivity: use.sensitivity, collectionMode: 'manual' },
    }];
    if (canDerive) proofs.push({
      recordId: randomUUID(), scope: tx.scope, kind: 'derived', entity: observation, upstream: [raw],
      actor: { actorId: 'personal-data-hub', kind: 'module' }, occurredAt: at, consentVersion, consentId: grant.consentId,
      versions: { rule: 'manual-observation/1.0.0' },
    });
    const provenanceIds = proofs.map((proof) => proof.recordId);
    await this.#coordinator.apply(tx, {
      eventId, eventType: 'ManualRecordIngested', source: 'personal-data-hub',
      occurredAt: input.occurredAt, baseVersion: tx.runtime()?.state.stateVersion ?? 0, consentVersion,
      writeKind: 'commutative', change: { kind: 'increment', key: 'manualRecords', amount: 1 },
      provenance: { sourceId: use.sourceId, consentId: grant.consentId, evidenceIds: [raw.entityId], recordIds: provenanceIds },
    }, async (write, event) => {
      write.insertEntity({
        ref: raw, layer: 'raw_event', use, body: { type: input.type, data: input.data },
        occurredAt: input.occurredAt, sequence: event.sequence,
      });
      if (canDerive) {
        const title = typeof input.data.title === 'string' ? input.data.title.trim() : '';
        write.insertEntity({
          ref: observation, layer: 'observation', use,
          body: { summary: title ? title.slice(0, 400) : `Manual record: ${input.type}` },
          occurredAt: input.occurredAt, sequence: event.sequence,
        });
      }
      for (const proof of proofs) await write.appendProvenance(proof);
    });
    return { recordId: raw.entityId, eventId, provenanceIds };
  }

  derive(scope: DaoScope, input: DerivedInput) {
    return this.#store.write(scope, (tx) => this.deriveInTransaction(tx, input));
  }

  async deriveInTransaction(tx: M1WriteTransaction, input: DerivedInput): Promise<EntityRef> {
    if (!isIdentifier(input.entityId) || !input.upstream.length
        || new Set(input.upstream.map((item) => item.entityId)).size !== input.upstream.length) throw invalid('Derived data requires distinct evidence');
    if (input.layer === 'memory' && !input.memoryGovernanceApproved) throw denied('Memory write requires governance approval');
    if (await tx.getConsentVersion() !== input.consentVersion) throw staleConsent('pre_commit');
    const use = dataUse(input.use);
    const grant = (await this.#consent.view(tx)).resolve(use, permissions[input.layer]);
    if (!grant) throw denied();
    if (tx.tombstone(input.entityId)) throw conflict('Entity was permanently deleted');
    const dependencies = input.upstream.map((ref) => ({ ref, entity: tx.entity(ref.entityId) }));
    if (dependencies.some(({ ref, entity }) => !entity || entity.ref.kind !== ref.kind
      || order.indexOf(entity.layer) >= order.indexOf(input.layer))) throw conflict('Derived evidence is missing, forgotten or out of order');
    const active = (await this.visible(tx)).entities;
    if (dependencies.some(({ ref }) => !active.has(ref.entityId))) throw denied('Upstream evidence is not authorized');
    const ref: EntityRef = { kind: layerKinds[input.layer], entityId: input.entityId };
    const occurredAt = new Date(this.#now()).toISOString();
    const proof: ProvenanceRecord = {
      recordId: randomUUID(), scope: tx.scope, kind: input.versions ? 'processed' : 'derived',
      entity: ref, upstream: input.upstream, actor: { actorId: 'personal-data-hub', kind: 'module' },
      ...(input.versions && { versions: input.versions }),
      consentId: grant.consentId, consentVersion: input.consentVersion, occurredAt,
    };
    await this.#coordinator.apply(tx, {
      eventId: randomUUID(), eventType: 'DataDerived', source: 'personal-data-hub', occurredAt,
      baseVersion: tx.runtime()?.state.stateVersion ?? 0, consentVersion: input.consentVersion,
      writeKind: 'governed', change: { kind: 'mark' }, governanceApproved: true,
      provenance: { sourceId: use.sourceId, consentId: grant.consentId, evidenceIds: [ref.entityId], recordIds: [proof.recordId] },
    }, async (write, event) => {
      write.insertEntity({ ref, layer: input.layer, use, body: input.body, occurredAt, sequence: event.sequence });
      await write.appendProvenance(proof);
    });
    return ref;
  }

  async recordUse(scope: DaoScope, entity: EntityRef, use: DataUse, consentVersion: number,
    actor: ProvenanceRecord['actor'], consumer?: ProvenanceRecord['consumer']) {
    return this.#store.write(scope, async (tx) => {
      if (await tx.getConsentVersion() !== consentVersion) throw staleConsent('pre_commit');
      const original = tx.entity(entity.entityId);
      if (!original || original.ref.kind !== entity.kind) throw missing();
      if (grantKey(original.use) !== grantKey(use)) throw denied('Evidence is outside the requested source range');
      const view = await this.#consent.view(tx);
      const granted = view.resolve({ ...original.use, purpose: use.purpose },
        consumer?.kind === 'character' ? 'allowCharacterUse' : 'allowRead');
      if (!granted || !(await this.visible(tx)).entities.has(entity.entityId)) throw denied();
      if (consumer?.kind === 'character') throw denied('Character consumption requires a reviewed summary');
      const record: ProvenanceRecord = {
        recordId: randomUUID(), scope, kind: consumer ? 'consumed' : 'accessed',
        entity, upstream: [], actor, ...(consumer && { consumer }),
        consentVersion, consentId: granted.consentId, occurredAt: new Date(this.#now()).toISOString(),
      };
      await tx.appendProvenance(record);
      return record;
    });
  }

  listObservations(scope: DaoScope, filter: Filter, after: number, limit: number, afterId = '') {
    return this.#store.read(scope, async (tx) => {
      const now = this.#now();
      const hasGrant = (await tx.listConsents()).some((grant) => matchesFilter(grant, filter)
        && grant.permissions.allowRead && grant.permissions.allowAnalysis && !grant.revokedAt
        && (!grant.expiresAt || Date.parse(grant.expiresAt) > now));
      if (!hasGrant) throw denied();
      const { entities } = await this.visible(tx);
      const candidates = tx.entities('observation').filter((item) =>
        (item.sequence > after || (item.sequence === after && item.ref.entityId > afterId))
        && matchesFilter(item.use, filter) && entities.has(item.ref.entityId)).slice(0, limit + 1);
      const items: Observation[] = [];
      for (const item of candidates.slice(0, limit)) {
        items.push({
          observationId: item.ref.entityId, scope, sourceId: item.use.sourceId,
          category: item.use.category, sensitivity: item.use.sensitivity,
          summary: String(item.body.summary), observedAt: item.occurredAt,
          provenanceIds: (await tx.getProvenance(item.ref.entityId)).map((proof) => proof.recordId),
        });
      }
      const last = candidates[limit - 1];
      return { items, version: await tx.getConsentVersion(),
        next: candidates.length > limit ? { sequence: last.sequence, id: last.ref.entityId } : undefined };
    });
  }

  provenance(scope: DaoScope, entityId: string): Promise<Graph & { version: number }> {
    return this.#store.read(scope, async (tx) => {
      const item = tx.entity(entityId);
      if (!item) throw missing();
      const { entities } = await this.visible(tx);
      if (!entities.has(entityId)) throw denied();
      const upstream = new Set<string>();
      const queue = [entityId];
      while (queue.length) {
        const next = queue.pop()!;
        if (upstream.has(next)) continue;
        upstream.add(next);
        for (const record of await tx.getProvenance(next)) queue.push(...record.upstream.map((parent) => parent.entityId));
      }
      const down = new Set(tx.descendants(entityId).filter((id) => id !== entityId));
      const proofs = tx.lineage().filter((record) => entities.has(record.entity.entityId));
      return {
        root: item.ref, upstream: proofs.filter((record) => upstream.has(record.entity.entityId)),
        downstream: proofs.filter((record) => down.has(record.entity.entityId)), version: await tx.getConsentVersion(),
      };
    });
  }

  async searchMemory(scope: DaoScope, terms: string, limit = 20) {
    if (!terms.trim() || terms.length > 256 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid('Invalid memory query');
    return this.#store.read(scope, async (tx) => {
      const { entities } = await this.visible(tx);
      return tx.searchMemory(terms, Number.MAX_SAFE_INTEGER).filter((item) => entities.has(item.ref.entityId)).slice(0, limit);
    });
  }

  /** M1 persistence fence. The public four-action ForgetRequest route belongs to M3. */
  forget(scope: DaoScope, target: EntityRef, expectedConsentVersion: number): Promise<DaoResponseData<'forget'>> {
    return this.#store.write(scope, async (tx) => {
      if (await tx.getConsentVersion() !== expectedConsentVersion) throw staleConsent('pre_commit');
      const old = tx.tombstone(target.entityId);
      if (old?.ref.kind === target.kind) return {
        requestId: old.requestId, tombstoneId: old.ref.entityId, status: 'completed',
        affectedCount: 0, consentVersion: expectedConsentVersion,
      };
      if (tx.entity(target.entityId)?.ref.kind !== target.kind) throw missing();
      const affected = tx.descendants(target.entityId)
        .flatMap((id) => { const found = tx.entity(id); return found ? [found] : []; });
      const requestId = randomUUID();
      const time = new Date(this.#now()).toISOString();
      const markers = affected.map(({ ref }) => ({ ref, requestId, forgottenAt: time }));
      await this.#coordinator.apply(tx, {
        eventId: requestId, eventType: 'DataForgotten', source: 'personal-data-hub',
        occurredAt: time, baseVersion: tx.runtime()?.state.stateVersion ?? 0, consentVersion: expectedConsentVersion,
        writeKind: 'governed', governanceApproved: true,
        change: { kind: 'remove', keys: [], decrement: { key: 'manualRecords', amount: affected.filter((item) => item.layer === 'raw_event').length } },
      }, (write) => write.removeEntities(markers));
      return { requestId, tombstoneId: target.entityId, status: 'completed', affectedCount: affected.length, consentVersion: expectedConsentVersion };
    });
  }
}
