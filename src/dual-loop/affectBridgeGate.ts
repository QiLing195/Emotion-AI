import {
  AffectBridgeDecision,
  AffectBridgeInput,
  CurrentConcern,
  RoleReferences,
} from './contracts';

export const MAX_ALLOWED_UNCERTAINTY = 0.35;
export const MIN_REQUIRED_CERTAINTY = 0.65;

/**
 * 幂等键构造公式：
 * eventId::subject::appraisalVersion::orig|corr:<supersedesEventId>
 */
export function buildIdempotencyKey(
  input: Pick<AffectBridgeInput, 'eventId' | 'subject' | 'supersedesEventId'>,
  appraisalVersion: string
): string {
  const revision = input.supersedesEventId
    ? `corr:${input.supersedesEventId}`
    : 'orig';
  return `${input.eventId}::${input.subject}::${appraisalVersion}::${revision}`;
}

export function findMatchingConcern(
  input: AffectBridgeInput,
  concerns: readonly CurrentConcern[],
  nowIso: string
): CurrentConcern | undefined {
  const primaryLabels = input.hypotheses
    .filter((h) => !h.isAlternative)
    .map((h) => h.label.trim().toLowerCase())
    .filter(Boolean);

  if (primaryLabels.length === 0) return undefined;

  const nowMs = Date.parse(nowIso);

  return concerns.find((concern) => {
    if (!concern.sourceEventId.trim()) return false;
    const expMs = Date.parse(concern.expiresAt);
    if (!Number.isFinite(expMs) || (Number.isFinite(nowMs) && expMs <= nowMs)) {
      return false;
    }
    return concern.topicKeywords.some((keyword) => {
      const kw = keyword.trim().toLowerCase();
      return kw.length > 0 && primaryLabels.some((label) => label.includes(kw));
    });
  });
}

/**
 * 双环桥接 7 道硬门禁（纯函数，无副作用，按序短路）
 */
export function evaluateAffectBridge(
  input: AffectBridgeInput,
  refs: RoleReferences,
  seenKeys: ReadonlySet<string> = new Set(),
  nowIso: string = input.eventTimestamp
): AffectBridgeDecision {
  const idempotencyKey = buildIdempotencyKey(input, refs.appraisalVersion);

  // Gate 1: 高风险危机信号无条件短路
  if (input.crisisFlag) {
    return {
      decision: 'crisis_safety_bypass',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 1 触发：检测到高风险危机信号，已短路绕过角色环并交由安全兜底链路。',
    };
  }

  // Gate 2: 用户明确拒绝继续谈情绪
  if (input.userRefusal) {
    return {
      decision: 'abstain_user_refusal',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 2 触发：用户拒绝继续探讨情绪，尊重边界并停止拓展。',
    };
  }

  // Gate 3: 幂等去重拦截重复事件或重放
  if (seenKeys.has(idempotencyKey)) {
    return {
      decision: 'duplicate_event_ignored',
      idempotencyKey,
      matchedEvidenceIds: [],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 3 触发：重复事件键命中幂等保护，已忽略本次重复触发。',
    };
  }

  // Gate 4: 主体、报告者、报告类型与时间范围核验
  const isExplicitCurrentSelf =
    input.subject === 'user' &&
    input.reportedBy === 'user' &&
    input.reportKind === 'explicit_self_report' &&
    (input.temporalScope === 'moment' || input.temporalScope === 'interval');

  if (!isExplicitCurrentSelf) {
    return {
      decision: 'ambiguous_affect_context',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 4 触发：非用户本人明确的当前/区间自述（含第三方、引述、混合、历史或假设），按保守原则拒判。',
    };
  }

  // Gate 5: 证据完整性、确定度与推断不确定度门限（严禁 unknown 静默填 0）
  const primaryHypotheses = input.hypotheses.filter((h) => !h.isAlternative);
  const certaintyInsufficient =
    input.certainty === 'unknown' || input.certainty < MIN_REQUIRED_CERTAINTY;
  const uncertaintyTooHigh =
    input.inferenceUncertainty === 'unknown' ||
    input.inferenceUncertainty > MAX_ALLOWED_UNCERTAINTY;

  if (
    input.evidenceIds.length === 0 ||
    primaryHypotheses.length === 0 ||
    certaintyInsufficient ||
    uncertaintyTooHigh
  ) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 5 触发：证据不足、确定度偏低或推断不确定度未知/过高，保持无判断。',
    };
  }

  // Gate 6: 角色宪章确认核验
  if (
    !refs.constitution ||
    !refs.constitution.confirmedByOwner ||
    refs.constitution.values.length === 0
  ) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 6 触发：角色宪章尚未建立或未经负责人确认，保持无判断。',
    };
  }

  // Gate 7: 有时效、带事件来源的当前关切审计匹配
  const matchedConcern = findMatchingConcern(input, refs.currentConcerns, nowIso);
  if (!matchedConcern) {
    return {
      decision: 'no_reading',
      idempotencyKey,
      matchedEvidenceIds: [...input.evidenceIds],
      supersedesEventId: input.supersedesEventId,
      reason: 'Gate 7 触发：缺少有效期内且带事件来源的匹配角色关切，保持无判断。',
    };
  }

  return {
    decision: 'care_response_candidate',
    idempotencyKey,
    matchedConcernId: matchedConcern.id,
    matchedEvidenceIds: [...input.evidenceIds],
    supersedesEventId: input.supersedesEventId,
    reason: `7 道门禁全部通过：匹配到有效角色关切（${matchedConcern.id}），已生成可审计关切候选。`,
  };
}
