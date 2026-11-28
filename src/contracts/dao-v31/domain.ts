import { array, boolean, enumeration, integer, json, jsonObject, literal, number, object, optional, ref, string, timestamp, union } from './schema.ts';
import type { Infer } from './schema.ts';

export const DAO_CONTRACT_VERSION = '3.1.0';
export const DAO_PROJECTION_VERSION = '1.0.0';
export const DAO_CHECKPOINT_INTERVAL = 100;
export const DAO_API_PREFIX = '/api/dao';

export const id = string({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' });
export const label = string({ minLength: 1, maxLength: 256 });
export const text = string({ minLength: 1, maxLength: 16000 });
export const version = string({ pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' });
export const hash = string({ pattern: '^[a-f0-9]{64}$' });
export const counter = integer(0);
export const probability = number(0, 1);

const Env = enumeration('prod', 'exp');
const Scope = object({ ownerId: id, env: ref('DaoEnv', Env), characterId: id, sessionId: id });
const Category = enumeration('UserProvided', 'CalendarTask', 'HealthFitness', 'DeviceUsage', 'LocationTrace', 'CommunicationSocial');
const Sensitivity = enumeration('Public', 'Personal', 'Sensitive', 'HighlySensitive');
const CollectionMode = enumeration('manual', 'on_demand', 'scheduled', 'event_triggered');
const permissions = {
  allowRead: boolean,
  allowUpload: boolean,
  allowAnalysis: boolean,
  allowPsychologicalInference: boolean,
  allowLongTermMemory: boolean,
  allowCharacterUse: boolean,
};
export const CONSENT_DIMENSIONS = Object.freeze(Object.keys(permissions) as (keyof typeof permissions)[]);
export const CONSENT_PREREQUISITES = {
  allowRead: [],
  allowUpload: ['allowRead'],
  allowAnalysis: ['allowRead'],
  allowPsychologicalInference: ['allowRead', 'allowAnalysis'],
  allowLongTermMemory: ['allowRead'],
  allowCharacterUse: ['allowRead'],
} as const satisfies Record<ConsentDimension, readonly ConsentDimension[]>;
const ConsentPermissionsShape = object(permissions);
const ConsentPermissions = {
  ...ConsentPermissionsShape,
  allOf: CONSENT_DIMENSIONS.filter((dimension) => CONSENT_PREREQUISITES[dimension].length > 0)
    .map((dimension) => ({
      if: { properties: { [dimension]: literal(true) } },
      then: { properties: Object.fromEntries(CONSENT_PREREQUISITES[dimension].map((key) => [key, literal(true)])) },
    })),
} satisfies typeof ConsentPermissionsShape;
const consentFields = {
  sourceId: id,
  sensitivity: ref('SensitivityLevel', Sensitivity),
  purposes: array(label, { minItems: 1, uniqueItems: true }),
  collectionMode: ref('CollectionMode', CollectionMode),
  permissions: ref('ConsentPermissions', ConsentPermissions),
  retentionPolicy: object({
    rawDataRetentionDays: optional(integer(1)),
    derivedDataRetentionDays: optional(integer(1)),
  }),
  deviceId: optional(id),
  dataScope: optional(array(label, { minItems: 1, uniqueItems: true })),
  expiresAt: optional(timestamp),
};
const ConsentChange = object({ ...consentFields, expectedConsentVersion: counter });
const DataConsent = object({
  ...consentFields, consentId: id, scope: ref('DaoScope', Scope),
  category: ref('DataCategory', Category), consentVersion: counter,
  grantedAt: timestamp, revokedAt: optional(timestamp),
});
const ConsentStage = enumeration('pre_dispatch', 'pre_external', 'pre_commit');
const WriteKind = enumeration('commutative', 'recomputable', 'exclusive', 'governed');
const Event = object({
  eventId: id, eventType: id, scope: ref('DaoScope', Scope), turnId: optional(id),
  taskId: optional(id), parentEventId: optional(id),
  source: object({ module: id, deviceId: optional(id), agentId: optional(id) }),
  occurredAt: timestamp, receivedAt: timestamp, sequence: integer(1),
  schemaVersion: version, consentVersion: counter, payload: json,
  provenance: object({
    sourceId: optional(id), consentId: optional(id),
    evidenceIds: array(id, { uniqueItems: true }), recordIds: array(id, { uniqueItems: true }),
  }),
});
const Commit = object({
  commitId: id, eventId: id, scope: ref('DaoScope', Scope), sequence: integer(1),
  writeKind: ref('WriteKind', WriteKind),
  outcome: enumeration('COMMITTED', 'NOOP_DUPLICATE', 'RECOMPUTE_REQUIRED', 'CONFLICT', 'DISCARDED_BY_REVOCATION'),
  priorStateVersion: counter, stateVersion: counter, projectionVersion: version,
  consentVersion: counter, stateHash: hash, committedAt: timestamp,
});
const Checkpoint = object({
  scope: ref('DaoScope', Scope), sequence: integer(1), stateVersion: counter,
  projectionVersion: version, stateHash: hash, snapshot: jsonObject,
});
const DataLayer = enumeration('raw_event', 'observation', 'pattern', 'hypothesis', 'memory', 'insight');
const ProvenanceKind = enumeration(
  'collected', 'accessed', 'processed', 'derived', 'consumed', 'invalidated',
);
const Entity = object({
  kind: enumeration('source', 'event', 'observation', 'pattern', 'hypothesis', 'memory', 'insight', 'profile_item', 'role_context', 'task', 'snapshot', 'export', 'index', 'cache', 'model_record'),
  entityId: id,
});
const ProvenanceShape = object({
  recordId: id, scope: ref('DaoScope', Scope), kind: ref('ProvenanceKind', ProvenanceKind),
  entity: ref('EntityRef', Entity), upstream: array(ref('EntityRef', Entity)),
  actor: object({ actorId: id, kind: enumeration('user', 'module', 'agent', 'tool', 'model') }),
  source: optional(object({
    sourceId: id, category: ref('DataCategory', Category),
    sensitivity: ref('SensitivityLevel', Sensitivity), collectionMode: ref('CollectionMode', CollectionMode),
  })),
  versions: optional(object({
    model: optional(label), prompt: optional(label), knowledgeBase: optional(label), rule: optional(label),
  })),
  consumer: optional(object({ kind: enumeration('character', 'task'), id })),
  invalidation: optional(object({ requestId: id, reason: label, affected: array(ref('EntityRef', Entity)) })),
  consentId: optional(id), consentVersion: counter, occurredAt: timestamp,
});
const Provenance = {
  ...ProvenanceShape,
  allOf: [
    { if: { properties: { kind: literal('collected') } }, then: { required: ['source'] } },
    { if: { properties: { kind: literal('processed') } }, then: { required: ['versions'] } },
    { if: { properties: { kind: literal('consumed') } }, then: { required: ['consumer'] } },
    { if: { properties: { kind: literal('invalidated') } }, then: { required: ['invalidation'] } },
  ],
} satisfies typeof ProvenanceShape;
const Risk = enumeration('low', 'medium', 'high', 'critical');
const TaskRoute = enumeration('official_api', 'android_native', 'mika_sandbox');
const TaskStatus = enumeration(
  'CREATED', 'VALIDATING', 'WAITING_APPROVAL', 'QUEUED', 'RUNNING', 'VERIFYING', 'COMPLETED',
  'FAILED', 'CANCELLED', 'EXPIRED', 'BLOCKED', 'WAITING_USER_INPUT', 'UNKNOWN_RESULT',
);
const taskGrantFields = {
  intent: id,
  targetApps: array(id, { uniqueItems: true }),
  allowedActions: array(id, { minItems: 1, uniqueItems: true }),
  allowedDataScopes: array(object({
    sourceId: id, category: ref('DataCategory', Category),
    sensitivity: ref('SensitivityLevel', Sensitivity), purpose: label,
    permission: enumeration(...CONSENT_DIMENSIONS),
  })),
};
const TaskRequest = object({
  intent: id, inputs: jsonObject, targetApp: optional(id), goalId: optional(id),
});
const TaskContract = object({
  ...taskGrantFields,
  taskId: id, scope: ref('DaoScope', Scope), schemaVersion: version, consentVersion: counter,
  riskLevel: ref('RiskLevel', Risk), route: ref('TaskRoute', TaskRoute),
  approval: object({ required: boolean, approvalId: optional(id) }),
  execution: object({ timeoutMs: integer(1), maxRetries: counter, idempotencyKey: id }),
  outputSchema: jsonObject, createdAt: timestamp, expiresAt: timestamp,
});
const Task = object({
  contract: ref('MikaTaskContract', TaskContract), status: ref('TaskStatus', TaskStatus),
  updatedAt: timestamp, attempt: counter, result: optional(json), evidenceRefs: array(id),
});
const Ledger = object({
  entryId: id, scope: ref('DaoScope', Scope), taskId: id, goalId: id, sequence: integer(1),
  phase: enumeration('proposed', 'dispatched', 'executed', 'reviewed', 'accepted', 'evaluated', 'recovery'),
  proposedBy: id, dispatchedBy: optional(id), executedBy: optional(id),
  reviewedBy: optional(id), acceptedBy: optional(id),
  acceptanceCriteria: array(label, { minItems: 1 }), evidenceRefs: array(id, { uniqueItems: true }),
  consentVersion: counter, finalOutcome: optional(ref('TaskStatus', TaskStatus)), occurredAt: timestamp,
});

const SafetyLayer = enumeration('L0', 'L1', 'L2', 'L3');
const OutputMode = enumeration('Strict', 'Buffered', 'Fast');
const SafetyFinding = object({
  category: id, evidence: label, confidence: probability,
});
const SafetyDecision = object({
  decisionId: id, contentId: id, policyVersion: version, detectorVersion: version, reviewedAt: timestamp,
  layer: ref('SafetyLayer', SafetyLayer), riskLevel: ref('RiskLevel', Risk),
  findings: array(ref('SafetyFinding', SafetyFinding)),
  action: enumeration('allow', 'buffer', 'rewrite', 'block', 'require_confirmation'),
});

export const domainSchemas = {
  DaoEnv: Env, DaoScope: Scope, DataCategory: Category, SensitivityLevel: Sensitivity, CollectionMode,
  ConsentPermissions, ConsentChange, DataConsent, ConsentStage, WriteKind,
  SystemEvent: Event, CommitRecord: Commit, ProjectionCheckpoint: Checkpoint,
  DataLayer, ProvenanceKind, EntityRef: Entity, ProvenanceRecord: Provenance,
  RiskLevel: Risk, TaskRoute, TaskStatus, TaskRequest, MikaTaskContract: TaskContract,
  TaskRecord: Task, AgentAccountabilityLedger: Ledger, SafetyLayer, OutputMode,
  SafetyFinding, SafetyDecision,
} as const;

type Domain<K extends keyof typeof domainSchemas> = Infer<(typeof domainSchemas)[K]>;
export type DaoScope = Domain<'DaoScope'>;
export type DaoEnv = Domain<'DaoEnv'>;
export type DataCategory = Domain<'DataCategory'>;
export type SensitivityLevel = Domain<'SensitivityLevel'>;
export type CollectionMode = Domain<'CollectionMode'>;
export type ConsentPermissions = Domain<'ConsentPermissions'>;
export type ConsentDimension = keyof typeof permissions;
export type ConsentChange = Domain<'ConsentChange'>;
export type DataConsent = Domain<'DataConsent'>;
export type ConsentStage = Domain<'ConsentStage'>;
export type WriteKind = Domain<'WriteKind'>;
export type SystemEvent = Domain<'SystemEvent'>;
export type CommitRecord = Domain<'CommitRecord'>;
export type ProjectionCheckpoint = Domain<'ProjectionCheckpoint'>;
export type ProvenanceRecord = Domain<'ProvenanceRecord'>;
export type EntityRef = Domain<'EntityRef'>;
export type MikaTaskContract = Domain<'MikaTaskContract'>;
export type TaskRecord = Domain<'TaskRecord'>;
export type TaskStatus = Domain<'TaskStatus'>;
export type AgentAccountabilityLedger = Domain<'AgentAccountabilityLedger'>;
export type SafetyLayer = Domain<'SafetyLayer'>;
export type RiskLevel = Domain<'RiskLevel'>;
export type OutputMode = Domain<'OutputMode'>;
export type SafetyDecision = Domain<'SafetyDecision'>;

export const knownOrUnknown = <T extends ReturnType<typeof number>>(schema: T) => union(schema, literal('unknown'));
