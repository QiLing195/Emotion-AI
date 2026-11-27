export const AFFECT_BRIDGE_SCHEMA_VERSION = '2.0.0' as const;

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

export interface EmotionHypothesis {
  label: string;
  valence?: number;
  arousal?: number;
  evidenceIds: string[];
  isAlternative?: boolean;
}

/**
 * 理解环 -> 角色环 最小耦合桥接契约（v2.0）
 * 仅传递带来源与证据的事件候选，严禁携带“角色应当产生某种情绪”的指令或 delta。
 */
export interface AffectBridgeInput {
  schemaVersion: typeof AFFECT_BRIDGE_SCHEMA_VERSION;
  eventId: string;
  eventTimestamp: string;
  subject: AffectSubject;
  reportedBy: AffectReporter;
  reportKind: AffectReportKind;
  temporalScope: TemporalScope;
  hypotheses: EmotionHypothesis[];
  evidenceIds: string[];
  causeEvidenceIds: string[];
  certainty: number | 'unknown';
  inferenceUncertainty: number | 'unknown';
  userRefusal?: boolean;
  crisisFlag?: boolean;
  userCorrection?: boolean;
  supersedesEventId?: string;
}

export interface RoleConstitution {
  version: string;
  confirmedByOwner: boolean;
  values: string[];
  hardBoundaries: string[];
}

export interface CurrentConcern {
  id: string;
  topicKeywords: string[];
  sourceEventId: string;
  expiresAt: string;
}

export interface RoleAppraisalReference {
  appraisalVersion: string;
  constitution: RoleConstitution | null;
  currentConcerns: CurrentConcern[];
  nowIso: string;
}

export type BridgeDecisionCode =
  | 'crisis_safety_bypass'
  | 'abstain_user_refusal'
  | 'duplicate_event_ignored'
  | 'ambiguous_affect_context'
  | 'no_reading'
  | 'care_response_candidate';

export interface AffectBridgeShadowResult {
  decision: BridgeDecisionCode;
  idempotencyKey: string;
  proposedStateDelta: 0;
  matchedConcernId?: string;
  matchedEvidenceIds: string[];
  supersedesEventId?: string;
  reason: string;
}

const MAX_ALLOWED_UNCERTAINTY = 0.35;
const MIN_REQUIRED_CERTAINTY = 0.65;

export function buildIdempotencyKey(
  input: Pick<AffectBridgeInput, 'eventId' | 'subject' | 'supersedesEventId'>,
  appraisalVersion: string
): string {
  const revision = input.supersedesEventId
    ? `corr:${input.supersedesEventId}`
    : 'orig';
  return `${input.eventId}::${input.subject}::${appraisalVersion}::${revision}`;
}

/**
 * 影子阶段纯函数判定门（v2.0）
 * 遵循“危机优先短路 -> 拒绝优先 -> 幂等去重 -> 证据与主体核验 -> 角色宪章/关切审计”顺序。
 * 影子阶段 proposedStateDelta 恒为 0，不修改线上角色状态。
 */
export function evaluateAffectBridgeShadow(
  input: AffectBridgeInput,
  roleRef: RoleAppraisalReference,
  seenEventKeys: ReadonlySet<string> = new Set()
): AffectBridgeShadowResult {
  const idempotencyKey = buildIdempotencyKey(input, roleRef.appraisalVersion);

  // 门禁 1：高风险危机信号直接短路，绕过角色环状态更新
  if (input.crisisFlag) {
    return {
      decision: 'crisis_safety_bypass',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '检测到高风险危机信号，已短路绕过角色状态机并交由安全响应链路处理。',
    };
  }

  // 门禁 2：用户明确拒绝继续讨论情绪
  if (input.userRefusal) {
    return {
      decision: 'abstain_user_refusal',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '用户明确拒绝继续探讨情绪，停止情绪拓展。',
    };
  }

  // 门禁 3：幂等去重（防止重试或回放重复触发）
  if (seenEventKeys.has(idempotencyKey)) {
    return {
      decision: 'duplicate_event_ignored',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [],
      supersedesEventId: input.supersedesEventId,
      reason: '该事件键已处理过，按幂等规则忽略。',
    };
  }

  // 门禁 4：主体、报告者、报告类型与时间范围核验（防主体污染与引述误判）
  const isUserSelfCurrent =
    input.subject === 'user' &&
    input.reportedBy === 'user' &&
    input.reportKind === 'explicit_self_report' &&
    (input.temporalScope === 'moment' || input.temporalScope === 'interval');

  if (!isUserSelfCurrent) {
    return {
      decision: 'ambiguous_affect_context',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '主体非用户本人明确当前自述（含第三方、引述、混合、历史或假设语境），按保守原则拒判。',
    };
  }

  // 门禁 5：证据、确定度、不确定度与假设完整性核验（严禁 unknown 静默填 0）
  const primaryHypotheses = input.hypotheses.filter((h) => !h.isAlternative);
  const uncertaintyTooHigh =
    input.inferenceUncertainty === 'unknown' ||
    input.inferenceUncertainty > MAX_ALLOWED_UNCERTAINTY;
  const certaintyTooLow =
    input.certainty === 'unknown' || input.certainty < MIN_REQUIRED_CERTAINTY;

  if (
    input.evidenceIds.length === 0 ||
    primaryHypotheses.length === 0 ||
    uncertaintyTooHigh ||
    certaintyTooLow
  ) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '证据不足、确定度偏低或推断不确定度未知/过高，保持无判断状态。',
    };
  }

  // 门禁 6：角色宪章确认状态检查
  if (
    !roleRef.constitution ||
    !roleRef.constitution.confirmedByOwner ||
    roleRef.constitution.values.length === 0
  ) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '角色宪章尚未建立或未经负责人确认，角色环不产生评价候选。',
    };
  }

  // 门禁 7：检查存在有效期内、带事件来源且与主假设可审计匹配的当前关切
  const nowMs = Date.parse(roleRef.nowIso);
  const primaryLabelsLower = primaryHypotheses.map((h) => h.label.toLowerCase());

  const matchedConcern = roleRef.currentConcerns.find((concern) => {
    if (!concern.sourceEventId.trim()) return false;
    const expMs = Date.parse(concern.expiresAt);
    if (!Number.isFinite(expMs) || (Number.isFinite(nowMs) && expMs <= nowMs)) {
      return false;
    }
    return concern.topicKeywords.some((kw) =>
      primaryLabelsLower.some((label) => label.includes(kw.toLowerCase()))
    );
  });

  if (!matchedConcern) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      proposedStateDelta: 0,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: '当前关切已过期、缺少事件来源或与本轮证据无明确匹配，返回无判断。',
    };
  }

  // 影子通过：仅记录可审计关切候选，proposedStateDelta 恒为 0
  return {
    decision: 'care_response_candidate',
    idempotencyKey,
    proposedStateDelta: 0,
    matchedConcernId: matchedConcern.id,
    matchedEvidenceIds: [...input.evidenceIds],
    supersedesEventId: input.supersedesEventId,
    reason: `匹配到有效角色关切（${matchedConcern.id}），已生成只读影子关切候选（delta=0）。`,
  };
}
