import { DAO_API_PREFIX, domainSchemas as d, counter, id, label, version } from './domain.ts';
import { apiSchemas, chatEventSchemas, streamEventSchemas, wire as w } from './wire.ts';
import { array, boolean, integer, literal, object, optional, ref, string, timestamp } from './schema.ts';
import type { Infer, Schema } from './schema.ts';

type Operation = {
  readonly method: 'get' | 'post' | 'put';
  readonly path: `${typeof DAO_API_PREFIX}/${string}`;
  readonly milestone: 'M1' | 'M2b' | 'M3' | 'M4' | 'M5';
  readonly summary: string;
  readonly success: 200 | 201 | 202;
  readonly body?: Schema;
  readonly pathParams?: Schema;
  readonly query?: Schema;
} & (
  | { readonly output: Schema; readonly stream?: never }
  | { readonly stream: 'chat' | 'runtime'; readonly output?: never }
);

const page = {
  cursor: optional(string({ minLength: 1, maxLength: 512 })),
  limit: optional(integer(1, 100)),
};

function paged<T>(item: Schema<T>) {
  return object({ items: array(item), nextCursor: optional(string({ minLength: 1, maxLength: 512 })) });
}

const reviewVersion = { expectedConsentVersion: counter };
const targetScope = object({ env: literal('exp'), characterId: id, sessionId: id });

export const daoOperations = {
  getHealth: {
    method: 'get', path: '/api/dao/health', milestone: 'M1', success: 200,
    summary: 'Read scoped SQLite readiness and schema version',
    output: ref('DaoHealth', w.Health),
  },
  streamRuntime: {
    method: 'get', path: '/api/dao/stream', milestone: 'M1', success: 200,
    summary: 'Subscribe to scoped runtime events and revocations', stream: 'runtime',
  },
  listConsents: {
    method: 'get', path: '/api/dao/consents', milestone: 'M1', success: 200,
    summary: 'List current grants for the scope',
    output: object({ items: array(ref('DataConsent', d.DataConsent)) }),
  },
  putConsent: {
    method: 'put', path: '/api/dao/consents/{category}', milestone: 'M1', success: 200,
    summary: 'Replace one source, sensitivity and mode grant with consent version comparison',
    pathParams: object({ category: w.category }), body: ref('ConsentChange', d.ConsentChange),
    output: ref('DataConsent', d.DataConsent),
  },
  createDataRecord: {
    method: 'post', path: '/api/dao/data/records', milestone: 'M1', success: 201,
    summary: 'Ingest an authorized manually submitted record',
    body: ref('ManualRecord', w.ManualRecord),
    output: object({ recordId: id, eventId: id, provenanceIds: array(id) }),
  },
  listObservations: {
    method: 'get', path: '/api/dao/data/observations', milestone: 'M1', success: 200,
    summary: 'List currently authorized observations',
    query: object({ ...page, category: optional(w.category), sensitivity: optional(w.sensitivity) }),
    output: paged(ref('Observation', w.Observation)),
  },
  forget: {
    method: 'post', path: '/api/dao/governance/forget', milestone: 'M3', success: 202,
    summary: 'Submit a governance operation with downstream invalidation',
    body: ref('ForgetRequest', w.ForgetRequest), output: ref('ForgetResult', w.ForgetResult),
  },
  getProvenance: {
    method: 'get', path: '/api/dao/provenance/{entityId}', milestone: 'M1', success: 200,
    summary: 'Read upstream and downstream provenance permitted by current consent',
    pathParams: object({ entityId: id }),
    output: object({ root: w.entity, upstream: array(ref('ProvenanceRecord', d.ProvenanceRecord)), downstream: array(ref('ProvenanceRecord', d.ProvenanceRecord)) }),
  },
  chatReply: {
    method: 'post', path: '/api/dao/chat/reply', milestone: 'M3', success: 200,
    summary: 'Stream a server-reviewed reply or close a session', body: ref('ChatRequest', w.ChatRequest), stream: 'chat',
  },
  getStateSnapshot: {
    method: 'get', path: '/api/dao/state/snapshot', milestone: 'M1', success: 200,
    summary: 'Read the scoped projection of four separate state objects',
    output: ref('StateSnapshot', w.Snapshot),
  },
  listEvents: {
    method: 'get', path: '/api/dao/events', milestone: 'M1', success: 200,
    summary: 'Read events and related commit records in commit sequence',
    query: object({ ...page, afterSequence: optional(counter) }),
    output: paged(object({ event: w.event, commits: array(w.commit) })),
  },
  createTask: {
    method: 'post', path: '/api/dao/tasks', milestone: 'M2b', success: 202,
    summary: 'Request a task for server-side risk and route selection',
    body: object({ request: ref('TaskRequest', d.TaskRequest), ...reviewVersion }),
    output: w.task,
  },
  listTasks: {
    method: 'get', path: '/api/dao/tasks', milestone: 'M2b', success: 200,
    summary: 'List scoped task contracts and lifecycle status',
    query: object({ ...page, status: optional(ref('TaskStatus', d.TaskStatus)) }),
    output: paged(w.task),
  },
  approveTask: {
    method: 'post', path: '/api/dao/tasks/{taskId}/approve', milestone: 'M2b', success: 200,
    summary: 'Approve a waiting task as the authenticated owner',
    pathParams: object({ taskId: id }), body: object({ ...reviewVersion }), output: w.task,
  },
  cancelTask: {
    method: 'post', path: '/api/dao/tasks/{taskId}/cancel', milestone: 'M2b', success: 200,
    summary: 'Cancel a scoped task or request cancellation of in-flight work',
    pathParams: object({ taskId: id }),
    body: object({ ...reviewVersion, reason: optional(label) }), output: w.task,
  },
  listAccountabilityEntries: {
    method: 'get', path: '/api/dao/orchestrator/ledger', milestone: 'M2b', success: 200,
    summary: 'Read independent acceptance and recovery evidence',
    query: object({ ...page, taskId: optional(id), goalId: optional(id) }),
    output: paged(ref('AgentAccountabilityLedger', d.AgentAccountabilityLedger)),
  },
  listHypotheses: {
    method: 'get', path: '/api/dao/psychology/hypotheses', milestone: 'M3', success: 200,
    summary: 'List consent-filtered hypotheses with evidence and alternatives',
    query: apiSchemas.PageQuery,
    output: paged(ref('PsychologyHypothesis', w.Hypothesis)),
  },
  analyzePsychology: {
    method: 'post', path: '/api/dao/psychology/analyze', milestone: 'M3', success: 202,
    summary: 'Request a manual Shadow analysis of an authorized window',
    body: object({ ...reviewVersion, fromSequence: optional(counter), throughSequence: optional(counter) }),
    output: object({ jobId: id, mode: literal('Shadow') }),
  },
  getUserProfile: {
    method: 'get', path: '/api/dao/user-profile', milestone: 'M4', success: 200,
    summary: 'Read the separate U0 to U4 user profile',
    output: ref('UserProfile', w.UserProfile),
  },
  reviewProfileItem: {
    method: 'post', path: '/api/dao/user-profile/{itemId}/review', milestone: 'M4', success: 200,
    summary: 'Confirm, correct or reject a profile item and propagate invalidation',
    pathParams: object({ itemId: id }), body: ref('ProfileReview', w.ProfileReview),
    output: object({ item: ref('ProfileItem', apiSchemas.ProfileItem), invalidated: array(w.entity) }),
  },
  runReplay: {
    method: 'post', path: '/api/dao/replay/run', milestone: 'M5', success: 200,
    summary: 'Run a replay with mocked side effects and current governance constraints',
    body: object({ mode: ref('ReplayMode', w.ReplayMode), ...reviewVersion,
      throughSequence: optional(counter), projectionVersion: optional(version), baselineRunId: optional(id) }),
    output: ref('ReplayResult', w.ReplayResult),
  },
  createExperimentSnapshot: {
    method: 'post', path: '/api/dao/experiments/snapshot', milestone: 'M5', success: 201,
    summary: 'Create an isolated experiment from a read-only production snapshot',
    body: object({ target: targetScope, ...reviewVersion, throughSequence: optional(counter) }),
    output: ref('ExperimentSnapshot', w.ExperimentSnapshot),
  },
  promoteExperiment: {
    method: 'post', path: '/api/dao/experiments/{expId}/promote', milestone: 'M5', success: 200,
    summary: 'Apply an individually approved and evaluated experiment configuration',
    pathParams: object({ expId: id }),
    body: object({ approvalId: id, evaluationRunId: id, expectedStateVersion: counter, ...reviewVersion }),
    output: ref('ExperimentSnapshot', w.ExperimentSnapshot),
  },
  exportBackup: {
    method: 'get', path: '/api/dao/backup/export', milestone: 'M1', success: 200,
    summary: 'Export a scope-bound backup with SHA-256 integrity metadata',
    output: ref('BackupBundle', w.BackupBundle),
  },
  restoreBackup: {
    method: 'post', path: '/api/dao/backup/restore', milestone: 'M1', success: 200,
    summary: 'Verify and transactionally restore a backup subject to current governance',
    body: object({ backup: ref('BackupBundle', w.BackupBundle), expectedStateVersion: counter, ...reviewVersion }),
    output: object({ restored: literal(true), stateVersion: counter, restoredAt: timestamp }),
  },
  exportObsidian: {
    method: 'get', path: '/api/dao/export/obsidian', milestone: 'M5', success: 200,
    summary: 'Export the authorized seven-section Markdown view with sensitive raw data excluded by default',
    query: object({ includeSensitiveRaw: optional(boolean) }),
    output: ref('ObsidianExport', w.ObsidianExport),
  },
} as const satisfies Record<string, Operation>;

export type DaoOperationId = keyof typeof daoOperations;
type Operations = typeof daoOperations;
type ReadField<K extends DaoOperationId, F extends PropertyKey> = F extends keyof Operations[K] ? Infer<Operations[K][F]> : never;
export type DaoRequestBody<K extends DaoOperationId> = ReadField<K, 'body'>;
export type DaoResponseData<K extends DaoOperationId> = ReadField<K, 'output'>;
export type DaoPathParams<K extends DaoOperationId> = ReadField<K, 'pathParams'>;
export type DaoQuery<K extends DaoOperationId> = ReadField<K, 'query'>;

function frameSchema(data: Schema) {
  return object({ scope: w.scope, meta: ref('ApiMeta', apiSchemas.ApiMeta), data });
}
export const sseSchemas = {
  chat: Object.fromEntries(Object.entries(chatEventSchemas).map(([name, schema]) => [name, frameSchema(schema)])),
  runtime: Object.fromEntries(Object.entries(streamEventSchemas).map(([name, schema]) => [name, frameSchema(schema)])),
};

export const contractOperations: Readonly<Record<DaoOperationId, Operation>> = daoOperations;
