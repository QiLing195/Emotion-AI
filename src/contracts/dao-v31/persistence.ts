import type {
  AgentAccountabilityLedger, CommitRecord, DaoScope, DataConsent,
  ProjectionCheckpoint, ProvenanceRecord, SystemEvent, TaskRecord,
} from './domain.ts';
import type { DaoOperationId } from './operations.ts';
import type { JsonObject } from './schema.ts';

/** Each call is bound to the exact four-part scope for the lifetime of the transaction. */
export interface DaoReadTransaction {
  getConsentVersion(): Promise<number>;
  listConsents(): Promise<readonly DataConsent[]>;
  getEvent(eventId: string): Promise<SystemEvent | null>;
  listEvents(afterSequence: number, limit: number): Promise<readonly SystemEvent[]>;
  getCommit(eventId: string, projectionVersion: string): Promise<CommitRecord | null>;
  getLatestCheckpoint(projectionVersion: string, atOrBefore: number): Promise<ProjectionCheckpoint | null>;
  getProvenance(entityId: string): Promise<readonly ProvenanceRecord[]>;
  getTask(taskId: string): Promise<TaskRecord | null>;
  getAccountabilityEntries(taskId: string): Promise<readonly AgentAccountabilityLedger[]>;
  getIdempotencyResult(operationId: DaoOperationId, resourcePath: string, key: string): Promise<IdempotencyResult | null>;
}

export interface IdempotencyResult {
  readonly requestHash: string;
  readonly response: JsonObject;
}

export interface DaoWriteTransaction extends DaoReadTransaction {
  updateConsent(expectedVersion: number, consent: DataConsent): Promise<void>;
  appendEvent(event: SystemEvent): Promise<void>;
  appendCommit(commit: CommitRecord): Promise<void>;
  saveCheckpoint(checkpoint: ProjectionCheckpoint): Promise<void>;
  appendProvenance(record: ProvenanceRecord): Promise<void>;
  saveTask(task: TaskRecord): Promise<void>;
  appendAccountabilityEntry(entry: AgentAccountabilityLedger): Promise<void>;
  saveIdempotencyResult(operationId: DaoOperationId, resourcePath: string, key: string, result: IdempotencyResult): Promise<void>;
}

/**
 * Implementations must reject records outside the bound scope. Write promises
 * settle after commit or rollback. Transaction callbacks only perform storage
 * work. Model calls, real-time publication and tool side effects happen outside.
 */
export interface DaoPersistencePort {
  read<T>(scope: DaoScope, operation: (tx: DaoReadTransaction) => Promise<T>): Promise<T>;
  write<T>(scope: DaoScope, operation: (tx: DaoWriteTransaction) => Promise<T>): Promise<T>;
}
