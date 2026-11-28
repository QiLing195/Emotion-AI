import { domainSchemas as d, counter, hash, id, knownOrUnknown, label, probability, text, version } from './domain.ts';
import { array, boolean, dictionary, enumeration, integer, jsonObject, literal, number, object, optional, ref, string, timestamp, union } from './schema.ts';
import type { Infer } from './schema.ts';

const scope = ref('DaoScope', d.DaoScope);
const task = ref('TaskRecord', d.TaskRecord);
const commit = ref('CommitRecord', d.CommitRecord);
const event = ref('SystemEvent', d.SystemEvent);
const entity = ref('EntityRef', d.EntityRef);
const category = ref('DataCategory', d.DataCategory);
const sensitivity = ref('SensitivityLevel', d.SensitivityLevel);

const ApiMeta = object({ requestId: id, serverTime: timestamp, consentVersion: counter, projectionVersion: version });
const ApiError = object({
  code: enumeration(
    'INVALID_REQUEST', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
    'INVALID_CONSENT_DEPENDENCY', 'CONSENT_VERSION_MISMATCH', 'IDEMPOTENCY_CONFLICT',
    'SCOPE_MISMATCH', 'RATE_LIMITED', 'UNAVAILABLE', 'INTERNAL_ERROR', 'NOT_IMPLEMENTED',
  ),
  message: label, retryable: boolean, details: optional(jsonObject),
});
const ApiFailure = object({ ok: literal(false), error: ref('ApiError', ApiError), meta: ref('ApiMeta', ApiMeta) });
const PageQuery = object({ cursor: optional(string({ minLength: 1, maxLength: 512 })), limit: optional(integer(1, 100)) });

export const SCOPE_HEADERS = {
  env: 'X-Dao-Env',
  characterId: 'X-Dao-Character-Id',
  sessionId: 'X-Dao-Session-Id',
} as const;

const Health = object({
  env: ref('DaoEnv', d.DaoEnv), sqlite: object({
    journalMode: literal('wal'), foreignKeys: literal(true), busyTimeoutMs: integer(0),
    fts5: boolean, schemaVersion: counter,
  }),
  contractVersion: version,
});
const ManualRecord = object({
  sourceId: id, category, sensitivity, purpose: label, occurredAt: timestamp,
  type: id, data: jsonObject, expectedConsentVersion: counter,
});
const Observation = object({
  observationId: id, scope, sourceId: id, category, sensitivity, summary: text,
  observedAt: timestamp, provenanceIds: array(id, { minItems: 1 }),
});
const ForgetRequest = union(
  object({ action: literal('revoke_future_collection'), sourceId: id, category, sensitivity, expectedConsentVersion: counter }),
  object({ action: literal('delete_collected_data'), target: entity, expectedConsentVersion: counter }),
  object({ action: literal('correct_inference'), target: entity, correction: text, expectedConsentVersion: counter }),
  object({ action: literal('prohibit_character_use'), target: entity, expectedConsentVersion: counter }),
);
const ForgetResult = object({
  requestId: id, status: enumeration('accepted', 'completed'), affectedCount: counter,
  consentVersion: counter, tombstoneId: optional(id),
});
const ChatRequest = union(
  object({ turnType: literal('message'), message: text, expectedConsentVersion: counter }),
  object({ turnType: literal('session_end'), expectedConsentVersion: counter }),
);
const RegulationState = object({
  regulation: probability, recoveryRate: probability, resilience: probability,
  stressLoad: probability, adaptation: probability,
});
const EmotionProvenance = object({
  eventId: id, appraisalId: optional(id), evidenceIds: array(id), calculationVersion: version,
  layers: array(object({
    layer: enumeration('L1', 'L2', 'L3', 'cross_layer'),
    ruleId: id, changes: dictionary(number()),
  })),
});
const ProfileItem = object({
  itemId: id, layer: enumeration('U0', 'U1', 'U2', 'U3', 'U4'),
  status: enumeration('unknown', 'candidate', 'confirmed', 'corrected', 'rejected', 'expired'),
  summary: optional(text), confidence: knownOrUnknown(probability),
  evidenceRefs: array(id), createdAt: timestamp, expiresAt: optional(timestamp),
});
const UserProfile = object({ version: counter, items: array(ref('ProfileItem', ProfileItem)) });
const Track = enumeration('A', 'B1', 'B2', 'C', 'D');
const TrackMetrics = object({
  track: ref('RuntimeTrack', Track), pending: counter, completed: counter,
  failures: counter, lastDurationMs: optional(number(0)), degraded: boolean,
});
const Snapshot = object({
  scope, sequence: counter, stateVersion: counter, stateHash: hash,
  userProfile: ref('UserProfile', UserProfile),
  characterPersonality: object({
    version: counter, constitutionId: id, traits: dictionary(number(-1, 1)),
    interactionObservationIds: array(id),
  }),
  relationshipState: object({
    version: counter, affinity: number(-1, 1), trust: probability,
  }),
  characterEmotion: object({
    version: counter, valence: number(-1, 1), arousal: number(-1, 1),
    A: probability, B: probability, layers: dictionary(number()),
  }),
  regulationState: ref('RegulationState', RegulationState),
  emotionProvenance: union(ref('EmotionProvenance', EmotionProvenance), literal(null)),
  trackMetrics: array(ref('TrackMetrics', TrackMetrics)),
});
const Hypothesis = object({
  hypothesisId: id, scope, mode: enumeration('Shadow', 'Advisory'), framework: id,
  summary: text, evidenceRefs: array(id, { minItems: 1 }), counterEvidenceRefs: array(id),
  alternativeExplanations: array(text, { minItems: 1 }), confidence: knownOrUnknown(probability),
  status: enumeration('candidate', 'rejected', 'invalidated', 'expired'),
  createdAt: timestamp, expiresAt: timestamp, provenanceIds: array(id, { minItems: 1 }),
});
const ProfileReview = union(
  object({ action: literal('confirm'), expectedConsentVersion: counter }),
  object({ action: literal('correct'), correction: text, expectedConsentVersion: counter }),
  object({ action: literal('reject'), reason: optional(label), expectedConsentVersion: counter }),
);
const ReplayMode = enumeration('state', 'appraisal', 'e2e');
const EvaluationAxis = array(object({
  metric: id, value: knownOrUnknown(number()), unit: label, sampleSize: counter, evidenceRefs: array(id),
}));
const EvaluationReport = object({
  userUnderstanding: EvaluationAxis, characterGrowth: EvaluationAxis, longTermSystem: EvaluationAxis,
});
const ReplayResult = object({
  runId: id, mode: ref('ReplayMode', ReplayMode), projectionVersion: version,
  status: enumeration('completed', 'inconclusive'), stateHash: optional(hash),
  comparison: optional(jsonObject), evaluation: optional(ref('EvaluationReport', EvaluationReport)),
  realSideEffects: integer(0, 0), resurrectedEntities: integer(0, 0),
});
const ExperimentSnapshot = object({
  experimentId: id, scope, sourceScope: scope, sourceSequence: counter, sourceHash: hash,
  createdAt: timestamp, status: enumeration('isolated', 'approved', 'promoted'),
});
const BackupBundle = object({
  formatVersion: version, scope, createdAt: timestamp, sha256: hash,
  snapshot: jsonObject,
});
const markdownFiles = array(object({
  filename: string({ minLength: 4, maxLength: 240, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*\\.md$' }),
  markdown: string(),
}));
const ObsidianExport = object({
  generatedAt: timestamp,
  sections: object({
    '00-Inbox': markdownFiles,
    '01-Raw': markdownFiles,
    '02-Observation': markdownFiles,
    '03-Cognitive': markdownFiles,
    '04-Memory': markdownFiles,
    '05-Character': markdownFiles,
    '06-Experiment': markdownFiles,
  }),
});

const TrackUpdate = object({
  track: ref('RuntimeTrack', Track), eventId: optional(id),
  jobId: optional(id), status: enumeration('queued', 'running', 'completed', 'cancelled', 'expired', 'degraded', 'failed'),
  detail: optional(label),
});

export const streamEventSchemas = {
  track_update: TrackUpdate,
  system_event: event,
  commit_record: commit,
  task_status: task,
  shadow_psychology: ref('PsychologyHypothesis', Hypothesis),
  consent_revoked: object({ category, sensitivity, sourceId: id, consentVersion: counter }),
  stream_reset: object({ reason: literal('cursor_unavailable') }),
  error: ref('ApiError', ApiError),
} as const;

export const chatEventSchemas = {
  reply_started: object({ turnId: id, mode: ref('OutputMode', d.OutputMode) }),
  reply_delta: object({ turnId: id, text }),
  safety_replaced: object({ turnId: id, replacement: text, decision: ref('SafetyDecision', d.SafetyDecision) }),
  reply_done: object({ turnId: id, reason: enumeration('completed', 'safety_replaced', 'session_ended'), stateVersion: counter }),
  error: ref('ApiError', ApiError),
} as const;

export const apiSchemas = {
  ApiMeta, ApiError, ApiFailure, PageQuery, DaoHealth: Health, ManualRecord, Observation, ForgetRequest,
  ForgetResult, ChatRequest, RegulationState, EmotionProvenance, ProfileItem, UserProfile, RuntimeTrack: Track,
  TrackMetrics, StateSnapshot: Snapshot, PsychologyHypothesis: Hypothesis, ProfileReview, ReplayMode,
  EvaluationReport, ReplayResult, ExperimentSnapshot, BackupBundle, ObsidianExport, TrackUpdate,
} as const;

export const wire = {
  scope, task, commit, event, entity, category, sensitivity, Track, Health, ManualRecord, Observation,
  ForgetRequest, ForgetResult, ChatRequest, Snapshot, Hypothesis, UserProfile, ProfileReview, ReplayMode,
  ReplayResult, ExperimentSnapshot, BackupBundle, ObsidianExport,
} as const;

export type ApiMeta = Infer<typeof ApiMeta>;
export type ApiError = Infer<typeof ApiError>;
export type ApiEnvelope<T> =
  | { readonly ok: true; readonly data: T; readonly meta: ApiMeta }
  | Infer<typeof ApiFailure>;
export type DaoStreamFrames = {
  [K in keyof typeof streamEventSchemas]: { readonly scope: Infer<typeof scope>; readonly meta: ApiMeta; readonly data: Infer<(typeof streamEventSchemas)[K]> };
};
export type DaoChatFrames = {
  [K in keyof typeof chatEventSchemas]: { readonly scope: Infer<typeof scope>; readonly meta: ApiMeta; readonly data: Infer<(typeof chatEventSchemas)[K]> };
};
export type DaoScopeHeaders = {
  readonly Authorization: `Bearer ${string}`;
  readonly [SCOPE_HEADERS.env]: Infer<typeof d.DaoEnv>;
  readonly [SCOPE_HEADERS.characterId]: string;
  readonly [SCOPE_HEADERS.sessionId]: string;
};
export type DaoWriteHeaders = DaoScopeHeaders & { readonly 'Idempotency-Key': string };
