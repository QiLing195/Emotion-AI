import {
  CharacterEmotionState,
  ExpressionBudgetState,
  ExpressionDecision,
  PersonaGrowthState,
  StateTransitionRecord,
  UnderstandingResult,
} from './contracts';
import { computeEffectiveDeadzone } from './personaGrowth';

export const EXPRESSION_DEADZONE_RADIUS = 0.25;
export const USER_NEGATIVE_YIELD_VALENCE = -0.4;

/**
 * 受控表达门（6 级过滤顺序 + 人格边界耦合）：
 * 1. 危机信号最高让位
 * 2. 用户明确强负面自述优先让位
 * 2.5 已习得“低打扰边界”偏好在事务/求助场景下让位
 * 3. 角色状态偏离基线的死区阈值检查（随慢层“表达克制度”有界微调）
 * 4. 证据可追溯性检查（无证据不得自述）
 * 5. 频率预算检查
 * 6. 接地放行 + 虚拟语境强制标注
 */
export function evaluateExpressionGate(
  state: CharacterEmotionState,
  understanding: UnderstandingResult,
  budget: ExpressionBudgetState,
  lastTransition: StateTransitionRecord,
  personaGrowth?: PersonaGrowthState
): ExpressionDecision {
  const { bridgeInput } = understanding;

  // Step 1: 危机信号最高让位
  if (bridgeInput.crisisFlag) {
    return {
      allowSelfExpression: false,
      reasonCode: 'yield_to_crisis',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation: '检测到危机信号，角色自我表达无条件让位给安全响应。',
    };
  }

  // Step 2: 用户明确强负面情绪优先服务用户，角色不抢话
  const primaryUserNeg = bridgeInput.hypotheses.some(
    (h) =>
      !h.isAlternative &&
      typeof h.valence === 'number' &&
      h.valence <= USER_NEGATIVE_YIELD_VALENCE
  );
  if (
    bridgeInput.subject === 'user' &&
    bridgeInput.reportKind === 'explicit_self_report' &&
    primaryUserNeg
  ) {
    return {
      allowSelfExpression: false,
      reasonCode: 'yield_to_user_negative',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation: '用户正处于明确负面状态，优先倾听与回应用户，角色暂不展开自我情绪表达。',
    };
  }

  // Step 2.5: 已习得关系边界偏好在事务/求助场景下抑制角色自我情绪披露
  const hasLowProbingPref = Boolean(
    personaGrowth?.preferences.some((p) => p.key === 'low_emotional_probing')
  );
  if (
    hasLowProbingPref &&
    (bridgeInput.intent === 'factual_task' ||
      bridgeInput.intent === 'help_seeking' ||
      bridgeInput.userRefusal)
  ) {
    return {
      allowSelfExpression: false,
      reasonCode: 'yield_to_persona_boundary',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation:
        '遵循已习得的“低打扰边界”关系偏好：当前为事务或求助场景，角色保持静默不展开自我情绪表达。',
    };
  }

  // Step 3: 死区阈值检查（结合慢层表达克制度做小幅有界调节）
  const effectiveDeadzone = computeEffectiveDeadzone(
    EXPRESSION_DEADZONE_RADIUS,
    personaGrowth
  );
  const distanceFromBaseline = Math.hypot(
    state.valence - state.baselineValence,
    state.arousal - state.baselineArousal
  );
  if (distanceFromBaseline < effectiveDeadzone) {
    return {
      allowSelfExpression: false,
      reasonCode: 'below_deadzone',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation: `当前角色状态偏离基线距离（${distanceFromBaseline.toFixed(2)}）低于死区阈值（${effectiveDeadzone.toFixed(2)}），保持静默。`,
    };
  }

  // Step 4: 证据可追溯性检查
  const hasTraceableEvidence =
    lastTransition.evidenceIds.length > 0 &&
    (Boolean(lastTransition.matchedConcernId) || lastTransition.containsSimulationSource);
  if (!hasTraceableEvidence) {
    return {
      allowSelfExpression: false,
      reasonCode: 'untraceable_source',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation: '缺少可追溯的事件证据或角色参照来源，禁止编造情绪原因。',
    };
  }

  // Step 5: 频率预算检查
  if (budget.expressionsInWindow >= budget.maxExpressionsInWindow) {
    return {
      allowSelfExpression: false,
      reasonCode: 'budget_exhausted',
      groundedEvidenceIds: [],
      mustMarkVirtualContext: false,
      maxSentences: 0,
      explanation: `近 ${budget.windowTurns} 轮表达预算已用尽（${budget.expressionsInWindow}/${budget.maxExpressionsInWindow}），本轮抑制自我披露。`,
    };
  }

  // Step 6: 接地放行
  return {
    allowSelfExpression: true,
    reasonCode: 'allowed_grounded',
    groundedEvidenceIds: [...lastTransition.evidenceIds],
    mustMarkVirtualContext: lastTransition.containsSimulationSource,
    maxSentences: 1,
    explanation: lastTransition.containsSimulationSource
      ? '通过表达门（含角色世界模拟事件，回复必须明确虚拟语境且限 1 句以内）。'
      : '通过表达门：允许基于绑定证据做简短、克制的角色表达（限 1 句以内）。',
  };
}
