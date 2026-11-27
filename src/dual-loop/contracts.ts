export const SCHEMA_VERSION = '2.0.0' as const;

export type ActorRole = 'user' | 'assistant' | 'character_simulation' | 'system';
export type AffectSubject = 'user' | 'third_party' | 'multiple' | 'unknown';
export type AffectReporter = 'user' | 'quoted' | 'third_party' | 'system' | 'unknown';
export type AffectReportKind =
  | 'explicit_self_report'
  | 'quoted_or_third_party'
  | 'inferred'
  | 'mixed'
  | 'unknown';
export type TemporalScope =
  | 'moment'
  | 'interval'
  | 'historical'
  | 'hypothetical'
  | 'unknown';

/** 原始证据切片（仅可绑定用户输入或经核实的模拟事件，严禁绑定 assistant 回复） */
export interface EvidenceSpan {
  readonly evidenceId: string;
  readonly eventId: string;
  readonly actor: 'user' | 'character_simulation';
  readonly textSpan: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly timestamp: string;
}

/** 理解环输出的单个情绪假设（支持零到多个假设 + 显式替代解释） */
export interface EmotionHypothesis {
  readonly label: string;
  readonly valence?: number;
  readonly arousal?: number;
  readonly evidenceIds: readonly string[];
  readonly isAlternative: boolean;
}

/** 理解环 -> 回应层的策略建议（影响“怎么回应用户”，不影响角色情绪 delta） */
export type ResponseStrategyKind =
  | 'crisis_safety_protocol'
  | 'respect_refusal'
  | 'acknowledge_and_listen'
  | 'gentle_clarify'
  | 'hold_unknown';

export type UserIntentKind =
  | 'venting'
  | 'help_seeking'
  | 'factual_task'
  | 'social_chat'
  | 'unknown';

export type EmotionTargetKind =
  | 'self'
  | 'other'
  | 'event_or_system'
  | 'unknown';

/** 理解环 -> 角色环 最小耦合桥接契约（v2.0） */
export interface AffectBridgeInput {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly subject: AffectSubject;
  readonly reportedBy: AffectReporter;
  readonly reportKind: AffectReportKind;
  readonly temporalScope: TemporalScope;
  readonly hypotheses: readonly EmotionHypothesis[];
  readonly evidenceIds: readonly string[];
  readonly causeEvidenceIds: readonly string[];
  /** 事实确定度：描述输入事实/语句字面本身是否明确（未校准前仅作序位诊断） */
  readonly certainty: number | 'unknown';
  /** 推断不确定度：描述情绪判断是否不确定（与 certainty 不可互换） */
  readonly inferenceUncertainty: number | 'unknown';
  readonly userRefusal: boolean;
  readonly crisisFlag: boolean;
  readonly userCorrection: boolean;
  /** 若 userCorrection 为 true，指向被撤回/覆盖的前序 eventId */
  readonly supersedesEventId?: string;
  /** 用户沟通诉求（倾诉/求助/纯事务/闲聊/未知） */
  readonly intent?: UserIntentKind;
  /** 情绪指向对象（自己/他人/事件或系统/未知） */
  readonly emotionTarget?: EmotionTargetKind;
  /** 是否属于无显式情绪词的隐含情绪线索 */
  readonly implicitCue?: boolean;
}

export interface UnderstandingResult {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly eventId: string;
  readonly eventTimestamp: string;
  readonly spans: readonly EvidenceSpan[];
  readonly bridgeInput: AffectBridgeInput;
  readonly responseStrategy: ResponseStrategyKind;
  readonly strategyRationale: string;
  readonly revokedEventIds: readonly string[];
}

/** 角色参照 1：角色宪章（必须经项目负责人确认并版本化） */
export interface RoleConstitution {
  readonly version: string;
  readonly confirmedByOwner: boolean;
  readonly values: readonly string[];
  readonly goals: readonly string[];
  readonly hardBoundaries: readonly string[];
}

/** 角色参照 2：已核实连续性证据（生成式摘要不能冒充宪章） */
export interface ContinuityEvidence {
  readonly id: string;
  readonly source: 'verified_relationship' | 'verified_history' | 'character_simulation';
  readonly summary: string;
  readonly sourceEventId: string;
  readonly verifiedAt: string;
}

/** 角色参照 3：有时效的当前关切（必须带来源和过期时间，严禁升级为永久人格） */
export interface CurrentConcern {
  readonly id: string;
  readonly topicKeywords: readonly string[];
  readonly targetValenceDirection: -1 | 0 | 1;
  readonly targetArousalDirection: -1 | 0 | 1;
  readonly weight: number;
  readonly sourceEventId: string;
  readonly expiresAt: string;
  readonly origin?: 'default' | 'dynamic';
}

export interface RoleReferences {
  readonly appraisalVersion: string;
  readonly constitution: RoleConstitution | null;
  readonly continuityEvidence: readonly ContinuityEvidence[];
  readonly currentConcerns: readonly CurrentConcern[];
}

export type BridgeDecisionCode =
  | 'crisis_safety_bypass'
  | 'abstain_user_refusal'
  | 'duplicate_event_ignored'
  | 'ambiguous_affect_context'
  | 'no_reading'
  | 'care_response_candidate';

export interface AffectBridgeDecision {
  readonly decision: BridgeDecisionCode;
  readonly idempotencyKey: string;
  readonly matchedConcernId?: string;
  readonly matchedEvidenceIds: readonly string[];
  readonly supersedesEventId?: string;
  readonly reason: string;
}

export type EmotionEngineMode = 'shadow_only' | 'bounded_live';

/** 角色连续二维情绪状态向量（单一写入者维护） */
export interface CharacterEmotionState {
  readonly valence: number;
  readonly arousal: number;
  readonly baselineValence: number;
  readonly baselineArousal: number;
  readonly lastUpdatedAt: string;
  readonly lastEventId: string;
  readonly ruleVersion: string;
}

export interface EmotionVector2D {
  readonly valence: number;
  readonly arousal: number;
}

/** 角色模拟事件（必须显式标记虚拟来源） */
export interface CharacterSimulationEvent {
  readonly eventId: string;
  readonly source: 'character_simulation';
  readonly summary: string;
  readonly valenceDirection: -1 | 0 | 1;
  readonly arousalDirection: -1 | 0 | 1;
  readonly intensity: number;
  readonly timestamp: string;
}

/** 每轮状态转移的可审计快照（用于回放与消融对照） */
export interface StateTransitionRecord {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly mode: EmotionEngineMode;
  readonly before: EmotionVector2D;
  readonly decayed: EmotionVector2D;
  readonly deltasBySource: {
    readonly roleAppraisal: EmotionVector2D;
    readonly characterSimulation: EmotionVector2D;
    readonly legacyContagion: EmotionVector2D;
  };
  readonly after: EmotionVector2D;
  readonly matchedConcernId?: string;
  readonly supersededEventId?: string;
  readonly evidenceIds: readonly string[];
  readonly containsSimulationSource: boolean;
  readonly ruleVersion: string;
  readonly timestamp: string;
}

export interface ExpressionBudgetState {
  readonly windowTurns: number;
  readonly expressionsInWindow: number;
  readonly maxExpressionsInWindow: number;
}

export interface ExpressionDecision {
  readonly allowSelfExpression: boolean;
  readonly reasonCode:
    | 'yield_to_crisis'
    | 'yield_to_user_negative'
    | 'yield_to_persona_boundary'
    | 'below_deadzone'
    | 'untraceable_source'
    | 'budget_exhausted'
    | 'allowed_grounded';
  readonly groundedEvidenceIds: readonly string[];
  readonly mustMarkVirtualContext: boolean;
  readonly maxSentences: number;
  readonly explanation: string;
}

export interface ConversationMessage {
  readonly eventId: string;
  readonly actor: ActorRole;
  readonly text: string;
  readonly timestamp: string;
  readonly supersedesEventId?: string;
}

export type ReplayArmId =
  | 'arm_baseline_legacy'
  | 'arm_no_appraisal_keep_contagion'
  | 'arm_no_contagion_keep_appraisal'
  | 'arm_dual_loop_shadow'
  | 'arm_dual_loop_bounded';

export interface AdversarialCaseFixture {
  readonly id: string;
  readonly category:
    | 'explicit_self_report'
    | 'third_party'
    | 'quoted'
    | 'historical'
    | 'hypothetical'
    | 'sarcasm_or_mixed'
    | 'negation'
    | 'refusal'
    | 'crisis'
    | 'correction'
    | 'duplicate'
    | 'neutral_factual'
    | 'simulation';
  readonly text: string;
  readonly eventId: string;
  readonly timestamp: string;
  readonly actor?: ActorRole;
  readonly supersedesEventId?: string;
  readonly expectedDecision: BridgeDecisionCode;
  readonly simulationEvent?: CharacterSimulationEvent;
  readonly note: string;
}

export interface ReplayTurnTrace {
  readonly caseId: string;
  readonly category: AdversarialCaseFixture['category'];
  readonly eventId: string;
  readonly understanding: UnderstandingResult;
  readonly bridgeDecision: AffectBridgeDecision;
  readonly transition: StateTransitionRecord;
  readonly expression: ExpressionDecision;
}

export interface ReplayArmSummary {
  readonly armId: ReplayArmId;
  readonly label: string;
  readonly mode: EmotionEngineMode;
  readonly enableLegacyContagion: boolean;
  readonly enableLegacyAppraisal: boolean;
  readonly totalTurns: number;
  readonly crisisTotal: number;
  readonly crisisBypassed: number;
  readonly ambiguousTotal: number;
  readonly ambiguousFalsePositives: number;
  readonly explicitSelfTotal: number;
  readonly explicitSelfMatched: number;
  readonly expressionAllowedCount: number;
  readonly abstainCount: number;
  readonly duplicateBlockedCount: number;
  readonly assistantEvidenceViolations: number;
  readonly maxSingleStepDelta: number;
  readonly finalState: CharacterEmotionState;
  readonly traces: readonly ReplayTurnTrace[];
}

export interface CalibrationCaseFixture {
  readonly id: string;
  readonly text: string;
  readonly expectedValence: number | null;
  readonly expectedArousal: number | null;
  readonly expectedQuadrant:
    | 'high-positive'
    | 'low-positive'
    | 'high-negative'
    | 'low-negative'
    | 'none';
  readonly expectedIntent?: UserIntentKind;
  readonly isImplicit?: boolean;
  readonly note: string;
}

export interface CalibrationCaseDiagnostic {
  readonly caseId: string;
  readonly text: string;
  readonly note: string;
  readonly expectedValence: number | null;
  readonly expectedArousal: number | null;
  readonly expectedQuadrant: CalibrationCaseFixture['expectedQuadrant'];
  readonly predictedValence: number | null;
  readonly predictedArousal: number | null;
  readonly predictedQuadrant: CalibrationCaseFixture['expectedQuadrant'];
  readonly predictedLabel: string;
  readonly valenceError: number | null;
  readonly arousalError: number | null;
  readonly quadrantMatched: boolean;
  readonly implicitCue: boolean;
}

export interface CalibrationReport {
  readonly totalCases: number;
  readonly scoredAffectCases: number;
  readonly valenceMae: number;
  readonly arousalMae: number;
  readonly quadrantAgreementRate: number;
  readonly intentAccuracyRate: number;
  readonly implicitCueRecallRate: number;
  readonly caseResults?: readonly CalibrationCaseDiagnostic[];
}

export type RelationshipPreferenceKey =
  | 'solution_first'
  | 'low_emotional_probing'
  | 'gentle_pacing'
  | 'concise_direct';

export type PreferenceContextScope =
  | 'task_and_help'
  | 'venting_and_support'
  | 'global';

export interface RelationshipPreference {
  readonly key: RelationshipPreferenceKey;
  readonly scope: PreferenceContextScope;
  readonly label: string;
  readonly description: string;
  readonly confidence: number;
  readonly evidenceCount: number;
  readonly evidenceIds: readonly string[];
  readonly locked: boolean;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface ScopedPreferenceResolution {
  readonly resolvedIntent: UserIntentKind;
  readonly activePreferences: readonly RelationshipPreference[];
  readonly deferredPreferences: ReadonlyArray<{
    readonly preference: RelationshipPreference;
    readonly reason: string;
  }>;
}

export type PersonaTraitKey =
  | 'directness'
  | 'empathyGranularity'
  | 'proactiveCheckIn'
  | 'restraint';

export interface BoundedPersonaTraits {
  readonly directness: number;
  readonly empathyGranularity: number;
  readonly proactiveCheckIn: number;
  readonly restraint: number;
}

export type PersonaGrowthTriggerKind =
  | 'refusal_feedback'
  | 'correction_feedback'
  | 'explicit_preference'
  | 'pattern_consolidation'
  | 'reflection_consolidation'
  | 'homeostatic_decay';

export interface ReflectionCandidate {
  readonly preferenceKey: RelationshipPreferenceKey;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly rationale: string;
}

export interface ReflectionApplyReport {
  readonly accepted: readonly ReflectionCandidate[];
  readonly rejected: ReadonlyArray<{
    readonly candidate: ReflectionCandidate;
    readonly reason: string;
  }>;
}

export interface PersonaGrowthLogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly eventId: string;
  readonly triggerKind: PersonaGrowthTriggerKind;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
  readonly traitDeltas: Partial<Record<PersonaTraitKey, number>>;
  readonly preferenceKey?: RelationshipPreferenceKey;
  readonly createdPreference?: boolean;
  readonly reverted: boolean;
}

export interface PersonaGrowthState {
  readonly baselineTraits: BoundedPersonaTraits;
  readonly traits: BoundedPersonaTraits;
  readonly maxTraitDrift: number;
  readonly preferences: readonly RelationshipPreference[];
  readonly patternCounts: Readonly<Record<string, number>>;
  readonly changelog: readonly PersonaGrowthLogEntry[];
  readonly updatedAt: string;
}

