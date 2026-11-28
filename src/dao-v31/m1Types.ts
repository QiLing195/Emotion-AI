import type {
  CollectionMode, CommitRecord, ConsentDimension, DaoEnv, DaoPersistencePort, DaoReadTransaction,
  DaoRequestBody, DaoResponseData, DaoScope, DaoWriteTransaction, DataCategory, EntityRef, JsonObject,
  ProvenanceRecord, SensitivityLevel, SystemEvent,
} from '../contracts/dao-v31/index.ts';

export type GrantIdentity = Readonly<{
  sourceId: string;
  category: DataCategory;
  sensitivity: SensitivityLevel;
  collectionMode: CollectionMode;
  deviceId?: string;
}>;

export function grantKey(grant: GrantIdentity): string {
  return JSON.stringify([grant.sourceId, grant.category, grant.sensitivity, grant.collectionMode, grant.deviceId ?? null]);
}

export type DataUse = GrantIdentity & Readonly<{ purpose: string; dataScope?: readonly string[] }>;
export type GrantUse = DataUse & Readonly<{ permission: ConsentDimension }>;
export type DataLayer = 'raw_event' | 'observation' | 'pattern' | 'hypothesis' | 'memory' | 'insight';

export type ProjectionChange =
  | Readonly<{ kind: 'increment'; key: string; amount: number }>
  | Readonly<{ kind: 'sum'; key: string; inputs: readonly string[] }>
  | Readonly<{ kind: 'set'; key: string; value: number }>
  | Readonly<{ kind: 'remove'; keys: readonly string[]; decrement?: Readonly<{ key: string; amount: number }> }>
  | Readonly<{ kind: 'restore'; manualRecords: number }>
  | Readonly<{ kind: 'mark' }>;

export interface RuntimeProjection {
  readonly sequence: number;
  readonly stateVersion: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly derived: Readonly<Record<string, number>>;
  readonly slots: Readonly<Record<string, number>>;
}
export interface RuntimeRecord {
  readonly state: RuntimeProjection;
  readonly hash: string;
}

export type ConsentedEntity = Readonly<{
  ref: EntityRef;
  layer: DataLayer;
  use: DataUse;
  body: JsonObject;
  occurredAt: string;
  sequence: number;
}>;

export type Tombstone = Readonly<{
  ref: EntityRef;
  requestId: string;
  forgottenAt: string;
}>;

export type RuntimeNotification =
  | { readonly event: 'system_event' | 'commit_record'; readonly eventId: string }
  | { readonly event: 'consent_revoked'; readonly data: {
    readonly category: DataCategory; readonly sensitivity: SensitivityLevel;
    readonly sourceId: string; readonly consentVersion: number;
  } };

export interface OutboxEntry {
  readonly id: number;
  readonly notification: RuntimeNotification;
}
export interface HistoryEntry {
  readonly event: SystemEvent;
  readonly commit: CommitRecord;
  readonly fingerprint: string;
}
export interface ScopeArchive {
  readonly history: readonly HistoryEntry[];
  readonly entities: readonly ConsentedEntity[];
  readonly lineage: readonly ProvenanceRecord[];
  readonly tombstones: readonly Tombstone[];
}

export interface M1ReadTransaction extends DaoReadTransaction {
  readonly scope: DaoScope;
  runtime(): RuntimeRecord | null;
  history(after: number, limit: number): readonly HistoryEntry[];
  entity(entityId: string): ConsentedEntity | null;
  entities(layer?: DataLayer): readonly ConsentedEntity[];
  descendants(entityId: string): readonly string[];
  lineage(): readonly ProvenanceRecord[];
  tombstone(entityId: string): Tombstone | null;
  tombstones(): readonly Tombstone[];
  outbox(after: number, limit: number): readonly OutboxEntry[];
  hasOutbox(id: number): boolean;
  latestOutbox(): number;
  searchMemory(terms: string, limit: number): readonly ConsentedEntity[];
}

export interface M1WriteTransaction extends M1ReadTransaction, DaoWriteTransaction {
  setRuntime(record: RuntimeRecord): void;
  setEventFingerprint(eventId: string, fingerprint: string): void;
  insertEntity(entity: ConsentedEntity): void;
  removeEntities(tombstones: readonly Tombstone[]): void;
  enqueue(notification: RuntimeNotification): void;
  keepBackup(sha256: string, stateVersion: number, createdAt: string): void;
}

export interface M1PersistencePort extends DaoPersistencePort {
  read<T>(scope: DaoScope, operation: (tx: M1ReadTransaction) => Promise<T> | T): Promise<T>;
  write<T>(scope: DaoScope, operation: (tx: M1WriteTransaction) => Promise<T> | T): Promise<T>;
  health(env: DaoEnv): Promise<DaoResponseData<'getHealth'>['sqlite']>;
}

export type ManualRecord = DaoRequestBody<'createDataRecord'>;
export type Observation = DaoResponseData<'listObservations'>['items'][number];
export type BackupBundle = DaoResponseData<'exportBackup'>;
