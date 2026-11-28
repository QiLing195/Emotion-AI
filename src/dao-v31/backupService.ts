import { randomUUID } from 'node:crypto';
import type {
  CollectionMode, CommitRecord, DaoRequestBody, DaoResponseData, DaoScope, DataCategory, DataConsent,
  EntityRef, JsonObject, ProvenanceRecord, SensitivityLevel, SystemEvent,
} from '../contracts/dao-v31/index.ts';
import type { BackupBundle, ConsentedEntity, DataLayer, DataUse, HistoryEntry, M1PersistencePort, M1WriteTransaction, ScopeArchive, Tombstone } from './m1Types.ts';
import { ConsentManager } from './consentManager.ts';
import { layerKinds, visibleEntities } from './dataHub.ts';
import { StateCoordinator, replayEntry, restoreHistory, staleConsent } from './stateCoordinator.ts';
import { initialRuntime } from './projection.ts';
import { exactJson, integrityHash, jsonValue } from './exactJson.ts';
import { isIdentifier, sameScope } from './sessionAuth.ts';
import { conflict, denied, invalid } from './errors.ts';
import { idempotent } from './idempotency.ts';
import type { IdempotencyKey } from './idempotency.ts';
import { validateSchema } from './validation.ts';

const BACKUP_VERSION = '1.0.0';
const MAX_BACKUP_BYTES = 7 * 1024 * 1024;

type Archive = ScopeArchive & {
  readonly stateHash: string;
  readonly stateVersion: number;
  readonly consentVersion: number;
  readonly consentAudit: readonly DataConsent[];
};

function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function row(value: unknown, keys: readonly string[], optional: readonly string[] = []): JsonObject {
  if (!isRecord(value) || !keys.every((key) => Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key))) throw invalid('Invalid backup row');
  return value;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalid('Invalid backup row collection');
  return value;
}

function counter(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw invalid('Invalid backup sequence or version');
  return value;
}

function time(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value))) throw invalid('Invalid backup timestamp');
  return value;
}

function hashField(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw invalid('Invalid backup hash');
  return value;
}

function exactEqual(a: unknown, b: unknown): boolean {
  return exactJson(jsonValue(a)) === exactJson(jsonValue(b));
}

function useFrom(value: unknown): DataUse {
  const item = row(value, ['sourceId', 'category', 'sensitivity', 'collectionMode', 'purpose'], ['deviceId', 'dataScope']);
  if (!isIdentifier(item.sourceId) || typeof item.purpose !== 'string' || !item.purpose.length || item.purpose.length > 256
    || (item.deviceId !== undefined && !isIdentifier(item.deviceId))
    || (item.dataScope !== undefined && (!Array.isArray(item.dataScope) || !item.dataScope.length
      || !item.dataScope.every((term) => typeof term === 'string' && term.length > 0 && term.length <= 256)))) throw invalid('Invalid backup authorization scope');
  return {
    sourceId: item.sourceId, purpose: item.purpose,
    category: validateSchema<DataCategory>('DataCategory', item.category),
    sensitivity: validateSchema<SensitivityLevel>('SensitivityLevel', item.sensitivity),
    collectionMode: validateSchema<CollectionMode>('CollectionMode', item.collectionMode),
    ...(item.deviceId && { deviceId: item.deviceId }),
    ...(item.dataScope && { dataScope: item.dataScope as readonly string[] }),
  };
}

function entityFrom(value: unknown): ConsentedEntity {
  const data = row(value, ['ref', 'layer', 'use', 'body', 'occurredAt', 'sequence']);
  const ref = validateSchema<EntityRef>('EntityRef', data.ref);
  const use = useFrom(data.use);
  const layer = data.layer as DataLayer;
  if (typeof layer !== 'string' || !Object.hasOwn(layerKinds, layer) || layerKinds[layer] !== ref.kind || !isRecord(data.body)) {
    throw invalid('Invalid backup entity');
  }
  if (layer === 'raw_event') {
    const raw = row(data.body, ['type', 'data']);
    if (!isIdentifier(raw.type) || !isRecord(raw.data) || use.collectionMode !== 'manual'
        || use.dataScope?.length !== 1 || use.dataScope[0] !== raw.type) throw invalid('Invalid backup raw data');
  }
  if (layer === 'observation' && (typeof data.body.summary !== 'string' || !data.body.summary.length || data.body.summary.length > 16000)) {
    throw invalid('Invalid backup observation');
  }
  return { ref, layer, use, body: data.body, occurredAt: time(data.occurredAt), sequence: counter(data.sequence, 1) };
}

function changeShape(event: SystemEvent) {
  const change = row(row(event.payload, ['change']).change, ['kind'], ['key', 'amount', 'inputs', 'value', 'keys', 'decrement', 'manualRecords']);
  switch (change.kind) {
    case 'increment': row(change, ['kind', 'key', 'amount']); break;
    case 'sum': row(change, ['kind', 'key', 'inputs']); if (!Array.isArray(change.inputs)) throw invalid('Invalid backup projection'); break;
    case 'set': row(change, ['kind', 'key', 'value']); break;
    case 'remove':
      row(change, ['kind', 'keys'], ['decrement']);
      if (!Array.isArray(change.keys)) throw invalid('Invalid backup projection');
      if (change.decrement !== undefined) row(change.decrement, ['key', 'amount']);
      break;
    case 'mark': row(change, ['kind']); break;
    case 'restore': row(change, ['kind', 'manualRecords']); break;
    default: throw invalid('Invalid backup projection');
  }
}

function assertUnique(items: readonly string[]) {
  if (new Set(items).size !== items.length) throw invalid('Backup contains duplicate identifiers');
}

function readArchive(snapshot: JsonObject, scope: DaoScope): Archive {
  const data = row(snapshot, ['stateHash', 'stateVersion', 'consentVersion', 'consentAudit', 'history', 'entities', 'lineage', 'tombstones']);
  const stateVersion = counter(data.stateVersion);
  const stateHash = hashField(data.stateHash);
  const consentVersion = counter(data.consentVersion);
  const assertScope = (value: DaoScope) => { if (!sameScope(scope, value)) throw denied('Backup contains a different scope'); };

  let replay = initialRuntime;
  let lastConsentVersion = 0;
  const seen = new Set<string>();
  const history: HistoryEntry[] = [];
  for (const item of list(data.history)) {
    const record = row(item, ['event', 'commit', 'fingerprint']);
    const event = validateSchema<SystemEvent>('SystemEvent', record.event);
    const commit = validateSchema<CommitRecord>('CommitRecord', record.commit);
    assertScope(event.scope);
    assertScope(commit.scope);
    if (seen.has(event.eventId) || (event.parentEventId && !seen.has(event.parentEventId))
      || event.consentVersion < lastConsentVersion || event.consentVersion > consentVersion) throw invalid('Backup event log is inconsistent');
    changeShape(event);
    const entry = { event, commit, fingerprint: hashField(record.fingerprint) };
    replay = replayEntry(replay, entry);
    lastConsentVersion = event.consentVersion;
    history.push(entry);
    seen.add(event.eventId);
  }
  if (replay.state.stateVersion !== stateVersion || replay.hash !== stateHash) throw invalid('Backup replay hash does not match');
  const entities = list(data.entities).map(entityFrom);
  const tombstones = list(data.tombstones).map((item): Tombstone => {
    const value = row(item, ['ref', 'requestId', 'forgottenAt']);
    if (!isIdentifier(value.requestId)) throw invalid('Invalid backup tombstone');
    return { ref: validateSchema<EntityRef>('EntityRef', value.ref), requestId: value.requestId, forgottenAt: time(value.forgottenAt) };
  });
  assertUnique([...entities, ...tombstones].map((item) => item.ref.entityId));
  const byId = new Map(entities.map((item) => [item.ref.entityId, item]));
  if (entities.some((item) => item.sequence > replay.state.sequence)) throw invalid('Backup entity sequence is unavailable');
  const lineage = list(data.lineage).map((item) => {
    const proof = validateSchema<ProvenanceRecord>('ProvenanceRecord', item);
    assertScope(proof.scope);
    if (byId.get(proof.entity.entityId)?.ref.kind !== proof.entity.kind
      || proof.upstream.some((ref) => byId.get(ref.entityId)?.ref.kind !== ref.kind)) throw invalid('Backup lineage is missing evidence');
    return proof;
  });
  assertUnique(lineage.map((proof) => proof.recordId));
  const origins = new Set(lineage.filter((proof) => {
    const entity = byId.get(proof.entity.entityId)!;
    if (entity.layer === 'raw_event') {
      return proof.kind === 'collected' && proof.upstream.length === 0
        && proof.source?.sourceId === entity.use.sourceId && proof.source.category === entity.use.category
        && proof.source.sensitivity === entity.use.sensitivity && proof.source.collectionMode === entity.use.collectionMode;
    }
    const order = Object.keys(layerKinds);
    return (proof.kind === 'derived' || proof.kind === 'processed') && proof.upstream.length > 0
      && proof.upstream.every((ref) => order.indexOf(byId.get(ref.entityId)!.layer) < order.indexOf(entity.layer));
  }).map((proof) => proof.entity.entityId));
  if (origins.size !== entities.length) throw invalid('Backup entities lack their primary provenance');
  const consentAudit = list(data.consentAudit).map((item) => {
    const audit = validateSchema<DataConsent>('DataConsent', item);
    assertScope(audit.scope);
    if (audit.consentVersion > consentVersion) throw invalid('Backup consent audit is inconsistent');
    return audit;
  });
  return { stateVersion, stateHash, consentVersion, consentAudit, history, entities, lineage, tombstones };
}

function unsigned(backup: BackupBundle) {
  return { formatVersion: backup.formatVersion, scope: backup.scope, createdAt: backup.createdAt, snapshot: backup.snapshot };
}

export class BackupService {
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

  export(scope: DaoScope): Promise<BackupBundle> {
    return this.#store.write(scope, async (tx) => {
      const now = this.#now();
      const { state, hash } = tx.runtime() ?? initialRuntime;
      const lineage = tx.lineage();
      const entities = tx.entities();
      const view = await this.#consent.view(tx);
      const visible = visibleEntities(entities, lineage, view, now);
      const snapshot: Archive = {
        stateHash: hash, stateVersion: state.stateVersion, consentVersion: await tx.getConsentVersion(),
        consentAudit: await tx.listConsents(), history: tx.history(0, Number.MAX_SAFE_INTEGER),
        entities: entities.filter((entity) => visible.has(entity.ref.entityId)),
        lineage: lineage.filter((proof) => visible.has(proof.entity.entityId)),
        tombstones: tx.tombstones(),
      };
      const content = {
        formatVersion: BACKUP_VERSION, scope, createdAt: new Date(now).toISOString(), snapshot: jsonValue(snapshot) as JsonObject,
      };
      const serialized = exactJson(jsonValue(content));
      if (Buffer.byteLength(serialized) > MAX_BACKUP_BYTES) throw invalid('Backup exceeds the portable JSON size limit');
      const sha256 = integrityHash(jsonValue(content));
      tx.keepBackup(sha256, state.stateVersion, content.createdAt);
      return { ...content, sha256 };
    });
  }

  async restore(scope: DaoScope, request: DaoRequestBody<'restoreBackup'>, key?: IdempotencyKey): Promise<DaoResponseData<'restoreBackup'>> {
    const { backup, expectedConsentVersion, expectedStateVersion } = request;
    if (!sameScope(scope, backup.scope)) throw denied('Backup belongs to another scope');
    if (backup.formatVersion !== BACKUP_VERSION || integrityHash(jsonValue(unsigned(backup))) !== backup.sha256) {
      throw invalid('Backup SHA-256 or format version is invalid');
    }
    const archive = readArchive(backup.snapshot, scope);
    return this.#store.write(scope, async (tx) => {
      const { result } = await idempotent(tx, key, async () => {
        if (await tx.getConsentVersion() !== expectedConsentVersion) throw staleConsent('pre_commit');
        const current = tx.runtime() ?? initialRuntime;
        if (current.state.stateVersion !== expectedStateVersion) throw conflict('State changed before backup restore');
        if (archive.entities.some((entity) => tx.tombstone(entity.ref.entityId))
            || archive.tombstones.some((item) => tx.entity(item.ref.entityId))) throw conflict('Backup conflicts with a deletion fence');

        const view = await this.#consent.view(tx);
        const now = this.#now();
        const available = visibleEntities(archive.entities, archive.lineage, view, now);
        if (available.size !== archive.entities.length || archive.entities.some((item) =>
          item.layer === 'raw_event' && !view.resolve(item.use, 'allowUpload'))) throw denied('Re-authorize the backup data before restoring');

        const history = tx.history(0, Number.MAX_SAFE_INTEGER);
        const matching = history.length <= archive.history.length
          && history.every((entry, index) => exactEqual(entry, archive.history[index]));
        let restoredVersion: number;
        if (matching) {
          const runtime = await restoreHistory(tx, archive.history.slice(history.length));
          await this.#restoreData(tx, archive);
          restoredVersion = runtime.state.stateVersion;
        } else {
          if (tx.entities().length || tx.tombstones().length
              || !history.every(({ event }) => event.eventType === 'ConsentUpdated' || event.eventType === 'ConsentRevoked')) {
            throw conflict('Backup would overwrite a different active history');
          }
          const rawCount = archive.entities.filter((item) => item.layer === 'raw_event').length;
          const restored = await this.#coordinator.apply(tx, {
            eventId: randomUUID(), eventType: 'BackupRestored', source: 'backup-service',
            occurredAt: new Date(now).toISOString(), baseVersion: current.state.stateVersion, consentVersion: expectedConsentVersion,
            writeKind: 'governed', change: { kind: 'restore', manualRecords: rawCount }, governanceApproved: true,
          }, (write, event) => this.#restoreData(write, archive, event.sequence));
          restoredVersion = restored.stateVersion;
        }
        tx.keepBackup(backup.sha256, restoredVersion, backup.createdAt);
        return { restored: true as const, stateVersion: restoredVersion, restoredAt: new Date(now).toISOString() };
      });
      return result;
    });
  }

  async #restoreData(tx: M1WriteTransaction, archive: Archive, rebaseTo?: number) {
    for (const marker of archive.tombstones) tx.removeEntities([marker]);
    for (const entity of archive.entities) {
      const current = tx.entity(entity.ref.entityId);
      const next = { ...entity, sequence: rebaseTo ?? entity.sequence };
      if (current && !exactEqual(current, next)) throw conflict('Backup would change an existing entity');
      if (!current) tx.insertEntity(next);
    }
    const proofs = new Map(tx.lineage().map((proof) => [proof.recordId, proof]));
    for (const proof of archive.lineage) {
      const prior = proofs.get(proof.recordId);
      if (prior && !exactEqual(prior, proof)) throw conflict('Backup would change existing provenance');
      if (!prior) await tx.appendProvenance(proof);
    }
  }
}
