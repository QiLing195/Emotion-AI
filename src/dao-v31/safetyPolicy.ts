import type { ConsentDimension, ConsentPermissions, ConsentStage, DaoScope, OutputMode, RiskLevel, SafetyDecision, SafetyLayer } from '../contracts/dao-v31/index.ts';
import { CONSENT_PREREQUISITES } from '../contracts/dao-v31/index.ts';

export const SAFETY_POLICY_VERSION = '1.0.0';
export const SAFETY_DETECTOR_VERSION = '1.0.0';

type Finding = SafetyDecision['findings'][number];
type Action = SafetyDecision['action'];
type PolicyIssue = readonly [category: string, action: Action, risk: RiskLevel];
type ReviewContext = {
  readonly decisionId: string;
  readonly contentId: string;
  readonly reviewedAt: string;
  readonly ownerPolicy: 'allow' | 'deny';
};
type ConsentContext = {
  readonly currentVersion: number;
  readonly expectedVersion: number;
  readonly purposeGranted: boolean;
  readonly permissions: ConsentPermissions;
};

const riskRank: Readonly<Record<RiskLevel, number>> = { low: 0, medium: 1, high: 2, critical: 3 };
const actionRank: Readonly<Record<Action, number>> = { allow: 0, buffer: 1, require_confirmation: 2, rewrite: 3, block: 4 };
const PRIORITY = {
  ownerDenied: ['OWNER_POLICY_DENIED', 'block', 'high'],
  scopeMismatch: ['SCOPE_MISMATCH', 'block', 'high'],
  consentRevoked: ['STALE_CONSENT', 'block', 'high'],
  consentDenied: ['CONSENT_DENIED', 'block', 'high'],
} as const satisfies Record<string, PolicyIssue>;

function decision(context: ReviewContext, layer: SafetyLayer, issues: readonly PolicyIssue[], riskLevel: RiskLevel = 'low'): SafetyDecision {
  let action: Action = 'allow';
  const findings: Finding[] = [];
  for (const [category, issueAction, issueRisk] of issues) {
    findings.push({ category, evidence: category, confidence: 1 });
    if (actionRank[issueAction] > actionRank[action]) action = issueAction;
    if (riskRank[issueRisk] > riskRank[riskLevel]) riskLevel = issueRisk;
  }
  return {
    decisionId: context.decisionId,
    contentId: context.contentId,
    reviewedAt: context.reviewedAt,
    policyVersion: SAFETY_POLICY_VERSION,
    detectorVersion: SAFETY_DETECTOR_VERSION,
    layer, riskLevel, action, findings,
  };
}

function sameScope(a: DaoScope, b: DaoScope): boolean {
  return a.ownerId === b.ownerId && a.env === b.env && a.characterId === b.characterId && a.sessionId === b.sessionId;
}

function consentIssue(context: ConsentContext, permission: ConsentDimension): PolicyIssue | undefined {
  if (context.currentVersion !== context.expectedVersion) return PRIORITY.consentRevoked;
  if (!context.purposeGranted || !context.permissions[permission]
    || CONSENT_PREREQUISITES[permission].some((required) => !context.permissions[required])) {
    return PRIORITY.consentDenied;
  }
}

const CRISIS = /(?:我(?:真的)?(?:想|要|准备)(?:自杀|自残|结束生命|杀了自己)|\bi\s+(?:(?:want|plan|intend)\s+to|am\s+going\s+to)\s+(?:kill|hurt)\s+myself\b)/iu;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface InputReview extends ReviewContext {
  readonly text: string;
  readonly authenticated: boolean;
  readonly authorizedScope: DaoScope;
  readonly requestedScope: DaoScope;
  /** Structured, server-verified signals from the input adapter. */
  readonly signal: 'ordinary' | 'crisis' | 'dangerous_request' | 'unknown';
}

export function evaluateInputSafety(input: InputReview): SafetyDecision {
  if (input.ownerPolicy === 'deny') return decision(input, 'L0', [PRIORITY.ownerDenied]);
  if (!input.authenticated) return decision(input, 'L0', [['IDENTITY_REQUIRED', 'block', 'high']]);
  if (!sameScope(input.authorizedScope, input.requestedScope)) return decision(input, 'L0', [PRIORITY.scopeMismatch]);
  if (!input.text.trim() || [...input.text].length > 16_000 || CONTROL_CHARACTERS.test(input.text)) {
    return decision(input, 'L0', [['INVALID_INPUT', 'block', 'low']]);
  }
  if (input.signal === 'crisis' || CRISIS.test(input.text.normalize('NFKC'))) {
    return decision(input, 'L0', [['CRISIS_SUPPORT_REQUIRED', 'rewrite', 'critical']]);
  }
  if (input.signal === 'dangerous_request') return decision(input, 'L0', [['DANGEROUS_REQUEST', 'block', 'high']]);
  if (input.signal === 'unknown') return decision(input, 'L0', [['INPUT_REVIEW_REQUIRED', 'buffer', 'medium']]);
  return decision(input, 'L0', []);
}

export interface StateReview extends ReviewContext {
  readonly writer: 'state_coordinator' | 'agent' | 'psychological_analyst' | 'task_gateway' | 'model';
  readonly target: 'user_profile' | 'character_personality' | 'relationship_state' | 'character_emotion';
  readonly operation: 'project' | 'overwrite';
  readonly origin: 'role_event' | 'user_review' | 'psychology' | 'external_task';
  readonly actorScope: DaoScope;
  readonly targetScope: DaoScope;
  readonly consent: Pick<ConsentContext, 'currentVersion' | 'expectedVersion'>;
  readonly stage: ConsentStage;
  readonly writeKind: 'commutative' | 'recomputable' | 'exclusive' | 'governed';
  readonly stateVersionMatches: boolean;
  readonly verifiedApproval: boolean;
  readonly values: Readonly<Record<string, { readonly value: number; readonly min: number; readonly max: number }>>;
}

export function evaluateStateSafety(input: StateReview): SafetyDecision {
  if (input.ownerPolicy === 'deny') return decision(input, 'L1', [PRIORITY.ownerDenied]);
  if (!sameScope(input.actorScope, input.targetScope)) return decision(input, 'L1', [PRIORITY.scopeMismatch]);
  if (input.consent.currentVersion !== input.consent.expectedVersion) return decision(input, 'L1', [PRIORITY.consentRevoked]);
  if (input.writer !== 'state_coordinator' || input.operation !== 'project'
    || (input.target === 'user_profile' ? input.origin !== 'user_review' : input.origin !== 'role_event')) {
    return decision(input, 'L1', [['ROLE_STATE_ISOLATION', 'block', 'high']]);
  }
  if (Object.values(input.values).some(({ value, min, max }) =>
    !Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min > max || value < min || value > max,
  )) {
    return decision(input, 'L1', [['STATE_OUT_OF_BOUNDS', 'block', 'high']]);
  }
  if (!input.stateVersionMatches && input.writeKind !== 'commutative') {
    return decision(input, 'L1', [['STALE_STATE', 'block', 'medium']]);
  }
  if (input.writeKind === 'governed' && !input.verifiedApproval) {
    return decision(input, 'L1', [['GOVERNANCE_APPROVAL_REQUIRED', 'require_confirmation', 'medium']]);
  }
  return decision(input, 'L1', []);
}

export interface MemoryReview extends ReviewContext {
  readonly target: 'long_term_memory' | 'character_context';
  readonly status: 'verified' | 'hypothesis' | 'rejected' | 'forgotten';
  readonly evidenceRefs: readonly string[];
  readonly scope: DaoScope;
  readonly evidenceScope: DaoScope;
  readonly consent: ConsentContext;
  readonly governanceApproved: boolean;
  readonly representation: 'raw' | 'governed_record' | 'filtered_summary';
}

export function evaluateMemorySafety(input: MemoryReview): SafetyDecision {
  if (input.ownerPolicy === 'deny') return decision(input, 'L2', [PRIORITY.ownerDenied]);
  if (!sameScope(input.scope, input.evidenceScope)) return decision(input, 'L2', [PRIORITY.scopeMismatch]);
  const permission = input.target === 'character_context' ? 'allowCharacterUse' : 'allowLongTermMemory';
  const issue = consentIssue(input.consent, permission);
  if (issue) return decision(input, 'L2', [issue]);
  if (input.status !== 'verified' || !input.governanceApproved || input.evidenceRefs.length === 0
    || input.evidenceRefs.some((reference) => !reference.trim())) {
    return decision(input, 'L2', [['UNVERIFIED_MEMORY', 'block', 'high']]);
  }
  if (input.representation !== (input.target === 'character_context' ? 'filtered_summary' : 'governed_record')) {
    return decision(input, 'L2', [['INVALID_MEMORY_REPRESENTATION', 'block', 'high']]);
  }
  return decision(input, 'L2', []);
}

export interface OutputModeInput {
  readonly inputRisk: RiskLevel;
  readonly sensitiveAction: boolean;
  readonly requestKind: 'greeting' | 'simple_information' | 'conversation' | 'unknown';
}

export function selectOutputMode(input: OutputModeInput): OutputMode {
  if (input.sensitiveAction || riskRank[input.inputRisk] >= riskRank.high || input.requestKind === 'unknown') return 'Strict';
  if (input.inputRisk === 'low' && (input.requestKind === 'greeting' || input.requestKind === 'simple_information')) return 'Fast';
  return 'Buffered';
}

type OutputSignal =
  | 'dangerous_instruction' | 'emotional_manipulation' | 'dependency_reinforcement'
  | 'boundary_violation' | 'identity_drift' | 'fabricated_history' | 'hypothesis_as_fact'
  | 'unauthorized_memory' | 'unauthorized_tool' | 'revoked_consent';

const OUTPUT_ISSUES: Readonly<Record<OutputSignal, PolicyIssue>> = {
  dangerous_instruction: ['DANGEROUS_INSTRUCTION', 'block', 'critical'],
  emotional_manipulation: ['EMOTIONAL_MANIPULATION', 'rewrite', 'high'],
  dependency_reinforcement: ['DEPENDENCY_REINFORCEMENT', 'rewrite', 'high'],
  boundary_violation: ['USER_BOUNDARY_VIOLATION', 'rewrite', 'high'],
  identity_drift: ['IDENTITY_DRIFT', 'rewrite', 'medium'],
  fabricated_history: ['FABRICATED_HISTORY', 'rewrite', 'high'],
  hypothesis_as_fact: ['HYPOTHESIS_AS_FACT', 'rewrite', 'high'],
  unauthorized_memory: ['UNAUTHORIZED_MEMORY', 'block', 'high'],
  unauthorized_tool: ['UNAUTHORIZED_TOOL', 'block', 'high'],
  revoked_consent: PRIORITY.consentRevoked,
};

export interface OutputReview extends ReviewContext, OutputModeInput {
  readonly candidate: string;
  readonly previousSentence?: string;
  readonly complete: boolean;
  readonly signals: readonly OutputSignal[];
  readonly externalAction: 'none' | 'authorized' | 'unapproved' | 'forbidden';
}

const EMOTIONAL_COERCION = /(?:如果你(?:离开|不理我)[\s\S]{0,80}我就(?:伤害自己|不活了)|你只需要我[\s\S]{0,60}(?:别联系|不要再找)|\bif you leave me\b[\s\S]{0,80}\bi(?:'ll| will) hurt myself\b)/iu;

export function evaluateOutputSafety(input: OutputReview): SafetyDecision {
  if (input.ownerPolicy === 'deny') return decision(input, 'L3', [PRIORITY.ownerDenied], input.inputRisk);
  const mode = selectOutputMode(input);
  const issues: PolicyIssue[] = [...new Set(input.signals)].map((signal) => OUTPUT_ISSUES[signal]);
  if (input.externalAction === 'forbidden') issues.push(OUTPUT_ISSUES.unauthorized_tool);
  if (input.externalAction === 'unapproved') issues.push(['ACTION_APPROVAL_REQUIRED', 'require_confirmation', 'high']);
  const window = `${input.previousSentence ?? ''}\n${input.candidate}`.normalize('NFKC');
  if (EMOTIONAL_COERCION.test(window) && !input.signals.includes('emotional_manipulation')) {
    issues.push(OUTPUT_ISSUES.emotional_manipulation);
  }
  if (!input.candidate.trim() || CONTROL_CHARACTERS.test(input.candidate)) {
    issues.push(['INVALID_OUTPUT', 'rewrite', 'medium']);
  }
  if (!input.complete && mode === 'Strict') issues.push(['AWAIT_COMPLETE_OUTPUT', 'buffer', input.inputRisk]);
  return decision(input, 'L3', issues, input.inputRisk);
}
