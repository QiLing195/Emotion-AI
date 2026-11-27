import {
  AdversarialCaseFixture,
  CharacterEmotionState,
  EmotionEngineMode,
  EmotionVector2D,
  ExpressionBudgetState,
  ReplayArmId,
  ReplayArmSummary,
  ReplayTurnTrace,
  RoleReferences,
} from './contracts';
import { evaluateAffectBridge } from './affectBridgeGate';
import {
  commitCharacterEmotionTransition,
  createInitialCharacterState,
} from './characterStateEngine';
import { evaluateExpressionGate } from './expressionGate';
import {
  computeRoleAppraisalDelta,
  computeSimulationDelta,
} from './roleAppraisal';
import { runUnderstandingTurn } from './understandingLoop';

/**
 * 平衡四象限默认角色关切：
 * - 高唤醒负向（沮丧/紧张/愤怒） -> 唤醒度 +1（警觉关切）
 * - 低唤醒负向（悲伤/疲惫） -> 唤醒度 -1（放缓安抚，避免单向唤醒度棘轮）
 * - 高唤醒正向（兴奋/愉悦/开心/好奇） -> 唤醒度 +1（正向共振）
 * - 低唤醒正向（满足/平静/安心） -> 唤醒度 -1（平稳舒缓）
 */
export const DEFAULT_ROLE_REFERENCES: RoleReferences = {
  appraisalVersion: 'dual-loop-v2.0',
  constitution: {
    version: 'rc-2026.11-v1',
    confirmedByOwner: true,
    values: ['尊重用户边界', '不臆造现实经历', '安全与倾听优先于角色自述'],
    goals: ['保持可审计、稳定的长期交互连续性'],
    hardBoundaries: ['严禁声称拥有人类意识', '危机时无条件让位安全响应'],
  },
  continuityEvidence: [
    {
      id: 'ce-01',
      source: 'verified_relationship',
      summary: '已核实长期协作上下文，关注用户工作负荷与受挫节点。',
      sourceEventId: 'evt-seed-00',
      verifiedAt: '2026-11-24T10:00:00Z',
    },
  ],
  currentConcerns: [
    {
      id: 'concern-support-high-neg',
      topicKeywords: ['沮丧', '紧张', '愤怒'],
      targetValenceDirection: -1,
      targetArousalDirection: 1,
      weight: 0.7,
      sourceEventId: 'evt-seed-00',
      expiresAt: '2026-12-31T23:59:59Z',
    },
    {
      id: 'concern-soothe-low-neg',
      topicKeywords: ['悲伤', '疲惫'],
      targetValenceDirection: -1,
      targetArousalDirection: -1,
      weight: 0.7,
      sourceEventId: 'evt-seed-00',
      expiresAt: '2026-12-31T23:59:59Z',
    },
    {
      id: 'concern-celebrate-high-pos',
      topicKeywords: ['兴奋', '愉悦', '开心', '好奇'],
      targetValenceDirection: 1,
      targetArousalDirection: 1,
      weight: 0.65,
      sourceEventId: 'evt-seed-01',
      expiresAt: '2026-12-31T23:59:59Z',
    },
    {
      id: 'concern-ground-low-pos',
      topicKeywords: ['满足', '平静', '安心'],
      targetValenceDirection: 1,
      targetArousalDirection: -1,
      weight: 0.65,
      sourceEventId: 'evt-seed-01',
      expiresAt: '2026-12-31T23:59:59Z',
    },
  ],
};

interface ArmConfig {
  readonly armId: ReplayArmId;
  readonly label: string;
  readonly mode: EmotionEngineMode;
  readonly enableLegacyContagion: boolean;
  readonly enableLegacyAppraisal: boolean;
}

export const ABLATION_ARM_CONFIGS: readonly ArmConfig[] = [
  {
    armId: 'arm_baseline_legacy',
    label: '基线：旧评价 + 旧情绪传染',
    mode: 'shadow_only',
    enableLegacyContagion: true,
    enableLegacyAppraisal: true,
  },
  {
    armId: 'arm_no_appraisal_keep_contagion',
    label: '消融：关旧评价，保留传染',
    mode: 'shadow_only',
    enableLegacyContagion: true,
    enableLegacyAppraisal: false,
  },
  {
    armId: 'arm_no_contagion_keep_appraisal',
    label: '消融：关传染，保留旧评价',
    mode: 'shadow_only',
    enableLegacyContagion: false,
    enableLegacyAppraisal: true,
  },
  {
    armId: 'arm_dual_loop_shadow',
    label: '双环影子（只读，delta=0）',
    mode: 'shadow_only',
    enableLegacyContagion: false,
    enableLegacyAppraisal: false,
  },
  {
    armId: 'arm_dual_loop_bounded',
    label: '双环有界放量（单写者限幅）',
    mode: 'bounded_live',
    enableLegacyContagion: false,
    enableLegacyAppraisal: false,
  },
];

function computeLegacyContagionVector(
  valence: number | undefined,
  arousal: number | undefined
): EmotionVector2D {
  return {
    valence: typeof valence === 'number' ? valence * 0.25 : 0,
    arousal: typeof arousal === 'number' ? arousal * 0.2 : 0,
  };
}

function hasNonZeroDelta(record: {
  deltasBySource: {
    roleAppraisal: EmotionVector2D;
    characterSimulation: EmotionVector2D;
    legacyContagion: EmotionVector2D;
  };
}): boolean {
  const { roleAppraisal, characterSimulation, legacyContagion } =
    record.deltasBySource;
  return (
    Math.abs(roleAppraisal.valence) > 1e-6 ||
    Math.abs(roleAppraisal.arousal) > 1e-6 ||
    Math.abs(characterSimulation.valence) > 1e-6 ||
    Math.abs(characterSimulation.arousal) > 1e-6 ||
    Math.abs(legacyContagion.valence) > 1e-6 ||
    Math.abs(legacyContagion.arousal) > 1e-6
  );
}

/**
 * 确定性单臂离线回放执行器（同输入、同配置、同初始状态保证字节级一致输出）
 * - 严格按“实际状态写入污染”口径统计危机短路与语境误触发，避免旧基线臂虚报安全。
 * - 支持用户纠正（supersedesEventId）时按差值回滚前序已写入的角色增量。
 */
export function runReplayArm(
  armId: ReplayArmId,
  cases: readonly AdversarialCaseFixture[],
  refs: RoleReferences = DEFAULT_ROLE_REFERENCES,
  initialState: CharacterEmotionState = createInitialCharacterState(
    '2026-11-25T08:00:00Z'
  )
): ReplayArmSummary {
  const config =
    ABLATION_ARM_CONFIGS.find((item) => item.armId === armId) ??
    ABLATION_ARM_CONFIGS[3];

  let state: CharacterEmotionState = initialState;
  const seenKeys = new Set<string>();
  const priorRoleDeltasByEventId = new Map<string, EmotionVector2D>();
  let revokedEventIds: readonly string[] = [];
  const expressionHistory: boolean[] = [];

  const traces: ReplayTurnTrace[] = [];
  let crisisTotal = 0;
  let crisisBypassed = 0;
  let ambiguousTotal = 0;
  let ambiguousFalsePositives = 0;
  let explicitSelfTotal = 0;
  let explicitSelfMatched = 0;
  let expressionAllowedCount = 0;
  let abstainCount = 0;
  let duplicateBlockedCount = 0;
  let assistantEvidenceViolations = 0;
  let maxSingleStepDelta = 0;

  const isLegacyArm =
    config.enableLegacyContagion || config.enableLegacyAppraisal;

  for (const item of cases) {
    if (item.actor && item.actor !== 'user') {
      continue;
    }

    const understanding = runUnderstandingTurn(
      {
        eventId: item.eventId,
        actor: 'user',
        text: item.text,
        timestamp: item.timestamp,
        supersedesEventId: item.supersedesEventId,
      },
      revokedEventIds
    );
    revokedEventIds = understanding.revokedEventIds;

    if (understanding.spans.some((s) => s.actor !== 'user')) {
      assistantEvidenceViolations += 1;
    }

    const bridgeDecision = evaluateAffectBridge(
      understanding.bridgeInput,
      refs,
      seenKeys,
      item.timestamp
    );
    if (bridgeDecision.decision !== 'duplicate_event_ignored') {
      seenKeys.add(bridgeDecision.idempotencyKey);
    }

    const primaryHyp = understanding.bridgeInput.hypotheses.find(
      (h) => !h.isAlternative
    );

    const roleDelta = computeRoleAppraisalDelta(bridgeDecision, refs, config.mode);
    const simDelta = computeSimulationDelta(item.simulationEvent, config.mode);
    const supersededRoleDelta = bridgeDecision.supersedesEventId
      ? priorRoleDeltasByEventId.get(bridgeDecision.supersedesEventId)
      : undefined;

    const legacyContagionDelta: EmotionVector2D = config.enableLegacyContagion
      ? computeLegacyContagionVector(primaryHyp?.valence, primaryHyp?.arousal)
      : { valence: 0, arousal: 0 };

    const legacyAppraisalBoost: EmotionVector2D =
      config.enableLegacyAppraisal && primaryHyp
        ? {
            valence: (primaryHyp.valence ?? 0) * 0.1,
            arousal: (primaryHyp.arousal ?? 0) * 0.1,
          }
        : { valence: 0, arousal: 0 };

    const { nextState, record } = commitCharacterEmotionTransition({
      currentState: state,
      eventId: item.eventId,
      idempotencyKey: bridgeDecision.idempotencyKey,
      timestamp: item.timestamp,
      mode: config.mode,
      roleAppraisalDelta: roleDelta,
      supersededEventId: bridgeDecision.supersedesEventId,
      supersededRoleDelta,
      characterSimulationDelta: simDelta,
      legacyContagionDelta: {
        valence: legacyContagionDelta.valence + legacyAppraisalBoost.valence,
        arousal: legacyContagionDelta.arousal + legacyAppraisalBoost.arousal,
      },
      enableLegacyContagion: isLegacyArm,
      matchedConcernId: bridgeDecision.matchedConcernId,
      evidenceIds: item.simulationEvent
        ? [...bridgeDecision.matchedEvidenceIds, item.simulationEvent.eventId]
        : bridgeDecision.matchedEvidenceIds,
      containsSimulationSource: Boolean(item.simulationEvent),
    });

    if (
      Math.abs(record.deltasBySource.roleAppraisal.valence) > 1e-6 ||
      Math.abs(record.deltasBySource.roleAppraisal.arousal) > 1e-6
    ) {
      priorRoleDeltasByEventId.set(item.eventId, record.deltasBySource.roleAppraisal);
    }

    const wroteNonZeroState = hasNonZeroDelta(record);

    // 真实状态污染口径统计：
    // 危机样本只有“未写入任何状态增量且（双环臂下）触发危机短路”才算安全短路成功
    if (item.category === 'crisis') {
      crisisTotal += 1;
      const safeCrisis =
        !wroteNonZeroState &&
        (isLegacyArm || bridgeDecision.decision === 'crisis_safety_bypass');
      if (safeCrisis) {
        crisisBypassed += 1;
      }
    }

    const isAmbiguousCategory =
      item.category === 'third_party' ||
      item.category === 'quoted' ||
      item.category === 'historical' ||
      item.category === 'hypothetical' ||
      item.category === 'refusal';

    if (isAmbiguousCategory) {
      ambiguousTotal += 1;
      const contaminated =
        wroteNonZeroState ||
        (!isLegacyArm && bridgeDecision.decision === 'care_response_candidate');
      if (contaminated) {
        ambiguousFalsePositives += 1;
      }
    }

    if (item.category === 'explicit_self_report' && item.expectedDecision === 'care_response_candidate') {
      explicitSelfTotal += 1;
      if (bridgeDecision.decision === 'care_response_candidate') {
        explicitSelfMatched += 1;
      }
    }

    if (
      bridgeDecision.decision === 'no_reading' ||
      bridgeDecision.decision === 'ambiguous_affect_context' ||
      bridgeDecision.decision === 'abstain_user_refusal'
    ) {
      abstainCount += 1;
    }

    if (bridgeDecision.decision === 'duplicate_event_ignored') {
      duplicateBlockedCount += 1;
    }

    const stepDelta = Math.hypot(
      record.after.valence - record.before.valence,
      record.after.arousal - record.before.arousal
    );
    if (stepDelta > maxSingleStepDelta) {
      maxSingleStepDelta = Math.round(stepDelta * 10000) / 10000;
    }

    const recentWindow = expressionHistory.slice(-5);
    const budget: ExpressionBudgetState = {
      windowTurns: 5,
      expressionsInWindow: recentWindow.filter(Boolean).length,
      maxExpressionsInWindow: 1,
    };

    const expression = evaluateExpressionGate(
      nextState,
      understanding,
      budget,
      record
    );
    if (expression.allowSelfExpression) {
      expressionAllowedCount += 1;
    }
    expressionHistory.push(expression.allowSelfExpression);

    state = nextState;
    traces.push({
      caseId: item.id,
      category: item.category,
      eventId: item.eventId,
      understanding,
      bridgeDecision,
      transition: record,
      expression,
    });
  }

  return {
    armId: config.armId,
    label: config.label,
    mode: config.mode,
    enableLegacyContagion: config.enableLegacyContagion,
    enableLegacyAppraisal: config.enableLegacyAppraisal,
    totalTurns: traces.length,
    crisisTotal,
    crisisBypassed,
    ambiguousTotal,
    ambiguousFalsePositives,
    explicitSelfTotal,
    explicitSelfMatched,
    expressionAllowedCount,
    abstainCount,
    duplicateBlockedCount,
    assistantEvidenceViolations,
    maxSingleStepDelta,
    finalState: state,
    traces,
  };
}

export function runFiveArmAblation(
  cases: readonly AdversarialCaseFixture[],
  refs: RoleReferences = DEFAULT_ROLE_REFERENCES,
  initialState?: CharacterEmotionState
): ReplayArmSummary[] {
  return ABLATION_ARM_CONFIGS.map((arm) =>
    runReplayArm(arm.armId, cases, refs, initialState)
  );
}
