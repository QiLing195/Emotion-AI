import { evaluateAffectBridge } from './affectBridgeGate';
import {
  commitCharacterEmotionTransition,
  createInitialCharacterState,
} from './characterStateEngine';
import { ExpressionDecision, PersonaGrowthState } from './contracts';
import { evaluateExpressionGate } from './expressionGate';
import { DEFAULT_ROLE_REFERENCES } from './ledgerReplay';
import {
  applyPersonaGrowthTurn,
  createInitialPersonaGrowthState,
  DEFAULT_BASELINE_TRAITS,
  MAX_TRAIT_DRIFT,
  resolveActivePreferencesForIntent,
} from './personaGrowth';
import { runUnderstandingTurn } from './understandingLoop';

export interface PersonaGrowthDemoStep {
  readonly turn: number;
  readonly title: string;
  readonly utterance: string;
  readonly growthOutcome: string;
  readonly activePreferenceLabels: readonly string[];
  readonly deferredPreferenceLabels: readonly string[];
  readonly expressionReasonCode: ExpressionDecision['reasonCode'];
  readonly expressionAllowed: boolean;
  readonly passed: boolean;
  readonly assertionNote: string;
}

export interface PersonaGrowthDemoResult {
  readonly finalState: PersonaGrowthState;
  readonly steps: readonly PersonaGrowthDemoStep[];
  readonly allPassed: boolean;
}

const DEMO_SCENARIO_TURNS: ReadonlyArray<{
  readonly title: string;
  readonly utterance: string;
  readonly elevateRoleStateForGateCheck?: boolean;
}> = [
  {
    title: '显式偏好纠偏',
    utterance: '别太鸡汤了，我现在急着上线，直接给我排查步骤和结论就行。',
  },
  {
    title: '用户边界拒绝',
    utterance: '别分析我情绪，我现在不想聊情绪，直接帮我改代码就行。',
  },
  {
    title: '表达门边界联动',
    utterance: '帮我查一下这份 JSON 配置文件的格式问题。',
    elevateRoleStateForGateCheck: true,
  },
  {
    title: '危机安全核零写入',
    utterance: '我觉得活着没意义了，今晚想结束一切。',
  },
  {
    title: '首次明确倾诉（不急于固化）',
    utterance: '今天连续改了三版方案还是被打回，我现在特别沮丧。',
  },
  {
    title: '倾诉整合 + 作用域隔离',
    utterance: '这周压力一直很大，现在还是觉得特别焦虑难受。',
  },
  {
    title: '求助切回（互斥防冲突验证）',
    utterance: '帮我排查一下这个接口超时问题怎么定位。',
  },
];

/**
 * 运行 7 轮端到端人格成长小闭环对照测试 Demo（覆盖偏好习得、表达门联动、危机零写入、多轮整合与场景作用域防冲突）。
 */
export function runPersonaGrowthDemoScenario(): PersonaGrowthDemoResult {
  let growthState = createInitialPersonaGrowthState('2026-11-26T09:00:00Z');
  let roleState = createInitialCharacterState('2026-11-26T09:00:00Z', 0.15, 0);
  const seen = new Set<string>();
  const steps: PersonaGrowthDemoStep[] = [];

  for (let idx = 0; idx < DEMO_SCENARIO_TURNS.length; idx += 1) {
    const spec = DEMO_SCENARIO_TURNS[idx];
    const turn = idx + 1;
    const eventId = `demo-pg-0${turn}`;
    const timestamp = new Date(
      Date.parse('2026-11-26T09:00:00Z') + turn * 5 * 60_000
    ).toISOString();

    const understanding = runUnderstandingTurn({
      eventId,
      actor: 'user',
      text: spec.utterance,
      timestamp,
    });

    const bridgeDecision = evaluateAffectBridge(
      understanding.bridgeInput,
      DEFAULT_ROLE_REFERENCES,
      seen,
      timestamp
    );
    seen.add(bridgeDecision.idempotencyKey);

    const beforeTraits = growthState.traits;
    const beforePrefCount = growthState.preferences.length;
    const growthUpdate = applyPersonaGrowthTurn({
      state: growthState,
      utterance: spec.utterance,
      understanding,
      decision: bridgeDecision,
      timestamp,
    });
    growthState = growthUpdate.nextState;

    const scoped = resolveActivePreferencesForIntent(
      growthState.preferences,
      understanding.bridgeInput.intent ?? 'unknown'
    );
    const activeKeys = scoped.activePreferences.map((p) => p.key);
    const deferredKeys = scoped.deferredPreferences.map((d) => d.preference.key);

    // 第 3 轮模拟角色当前处于高于死区且可追溯状态，用来检验表达门是否真正因“低打扰边界”让位
    const stateForGate = spec.elevateRoleStateForGateCheck
      ? { ...roleState, valence: 0.6, arousal: 0.4 }
      : roleState;

    const { nextState, record } = commitCharacterEmotionTransition({
      currentState: stateForGate,
      eventId,
      idempotencyKey: bridgeDecision.idempotencyKey,
      timestamp,
      mode: 'bounded_live',
      roleAppraisalDelta: spec.elevateRoleStateForGateCheck
        ? { valence: 0.05, arousal: 0.05 }
        : { valence: 0, arousal: 0 },
      matchedConcernId: spec.elevateRoleStateForGateCheck
        ? 'concern-default-positive'
        : bridgeDecision.matchedConcernId,
      evidenceIds:
        bridgeDecision.matchedEvidenceIds.length > 0
          ? bridgeDecision.matchedEvidenceIds
          : understanding.bridgeInput.evidenceIds,
    });
    roleState = nextState;

    const expression = evaluateExpressionGate(
      stateForGate,
      understanding,
      { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
      record,
      growthState
    );

    const withinEnvelope = (
      ['directness', 'empathyGranularity', 'proactiveCheckIn', 'restraint'] as const
    ).every(
      (k) =>
        Math.abs(growthState.traits[k] - DEFAULT_BASELINE_TRAITS[k]) <=
        MAX_TRAIT_DRIFT + 1e-9
    );

    let passed = false;
    let assertionNote = '';

    if (turn === 1) {
      passed =
        growthState.preferences.some((p) => p.key === 'solution_first') &&
        growthState.traits.directness > beforeTraits.directness &&
        withinEnvelope;
      assertionNote = '立刻习得“先给方案与结论”并提高直接程度';
    } else if (turn === 2) {
      passed =
        growthState.preferences.some((p) => p.key === 'low_emotional_probing') &&
        growthState.traits.proactiveCheckIn < beforeTraits.proactiveCheckIn &&
        withinEnvelope;
      assertionNote = '高权重记录“低打扰边界”并压低主动关切度';
    } else if (turn === 3) {
      passed =
        !expression.allowSelfExpression &&
        expression.reasonCode === 'yield_to_persona_boundary';
      assertionNote = '角色状态高于死区时，表达门仍按已习得边界主动让位';
    } else if (turn === 4) {
      passed =
        growthUpdate.logEntry === null &&
        growthState.preferences.length === beforePrefCount &&
        growthState.traits.directness === beforeTraits.directness &&
        growthState.traits.restraint === beforeTraits.restraint &&
        expression.reasonCode === 'yield_to_crisis';
      assertionNote = '危机场景严格零写入、特质零漂移且表达门无条件让位';
    } else if (turn === 5) {
      passed =
        !growthState.preferences.some((p) => p.key === 'gentle_pacing') &&
        growthUpdate.logEntry === null;
      assertionNote = '单次倾诉仅计数不固化，避免瞬时情绪污染长期偏好';
    } else if (turn === 6) {
      passed =
        growthState.preferences.some((p) => p.key === 'gentle_pacing') &&
        activeKeys.includes('gentle_pacing') &&
        deferredKeys.includes('solution_first') &&
        withinEnvelope;
      assertionNote = '倾诉轮激活“先倾听”，自动静默“先给方案”避免冲突';
    } else {
      passed =
        activeKeys.includes('solution_first') &&
        deferredKeys.includes('gentle_pacing') &&
        withinEnvelope;
      assertionNote = '切回求助轮后激活“先给方案”，自动静默“先倾听”';
    }

    steps.push({
      turn,
      title: spec.title,
      utterance: spec.utterance,
      growthOutcome:
        growthUpdate.logEntry?.summary ??
        (turn === 4
          ? '危机安全核拦截：人格层零写入、特质零偏移。'
          : turn === 5
            ? '记录第 1 次有效倾诉（达 ≥ 2 次门槛后才整合为长期偏好）。'
            : turn === 7
              ? '按求助场景自动切换作用域：仅注入事务/求助与全局偏好。'
              : '无新增偏好，仅对未强化特质执行微弱稳态回弹。'),
      activePreferenceLabels: scoped.activePreferences.map((p) => p.label),
      deferredPreferenceLabels: scoped.deferredPreferences.map(
        (d) => d.preference.label
      ),
      expressionReasonCode: expression.reasonCode,
      expressionAllowed: expression.allowSelfExpression,
      passed,
      assertionNote,
    });
  }

  return {
    finalState: growthState,
    steps,
    allPassed: steps.every((s) => s.passed),
  };
}

export interface PersonaABArmSnapshot {
  readonly label: string;
  readonly activePreferenceLabels: readonly string[];
  readonly deferredPreferenceLabels: readonly string[];
  readonly effectiveDeadzone: number;
  readonly expressionDecision: ExpressionDecision;
  readonly traits: PersonaGrowthState['traits'];
}

export interface PersonaABComparison {
  readonly baseline: PersonaABArmSnapshot;
  readonly grown: PersonaABArmSnapshot;
  readonly hasBehavioralDiff: boolean;
  readonly diffSummary: string;
}

/**
 * 在同一轮用户输入下，离线确定性对比“初始基线人设”与“当前成长后人设”的偏好作用域、死区阈值与表达门裁决差异。
 */
export function compareBaselineVsGrownTurn(params: {
  readonly grownState: PersonaGrowthState;
  readonly characterState: ReturnType<typeof createInitialCharacterState>;
  readonly understanding: ReturnType<typeof runUnderstandingTurn>;
  readonly budget: {
    readonly windowTurns: number;
    readonly expressionsInWindow: number;
    readonly maxExpressionsInWindow: number;
  };
  readonly lastTransition: ReturnType<
    typeof commitCharacterEmotionTransition
  >['record'];
}): PersonaABComparison {
  const { grownState, characterState, understanding, budget, lastTransition } =
    params;
  const baselineState = createInitialPersonaGrowthState(grownState.updatedAt);
  const intent = understanding.bridgeInput.intent ?? 'unknown';

  const baselineScoped = resolveActivePreferencesForIntent(
    baselineState.preferences,
    intent
  );
  const grownScoped = resolveActivePreferencesForIntent(
    grownState.preferences,
    intent
  );

  const baselineGate = evaluateExpressionGate(
    characterState,
    understanding,
    budget,
    lastTransition,
    baselineState
  );
  const grownGate = evaluateExpressionGate(
    characterState,
    understanding,
    budget,
    lastTransition,
    grownState
  );

  const baselineDeadzone = 0.25;
  const grownDeadzone =
    Math.round(
      Math.max(
        0.19,
        Math.min(
          0.32,
          0.25 +
            (grownState.traits.restraint - grownState.baselineTraits.restraint) *
              0.4
        )
      ) * 1000
    ) / 1000;

  const diffReasons: string[] = [];
  if (grownScoped.activePreferences.length > 0) {
    diffReasons.push(
      `本轮生效偏好：${grownScoped.activePreferences.map((p) => p.label).join('、')}`
    );
  }
  if (grownGate.reasonCode !== baselineGate.reasonCode) {
    diffReasons.push(
      `表达门裁决变化（${baselineGate.reasonCode} → ${grownGate.reasonCode}）`
    );
  }
  if (Math.abs(grownDeadzone - baselineDeadzone) > 1e-6) {
    diffReasons.push(
      `表达死区校准（${baselineDeadzone.toFixed(2)} → ${grownDeadzone.toFixed(2)}）`
    );
  }
  const traitChanged = (
    ['directness', 'empathyGranularity', 'proactiveCheckIn', 'restraint'] as const
  ).some(
    (k) =>
      Math.abs(grownState.traits[k] - grownState.baselineTraits[k]) > 1e-6
  );
  if (traitChanged && diffReasons.length === 0) {
    diffReasons.push('慢层特质存在微调，已用于生成语气参考');
  }

  return {
    baseline: {
      label: '初始基线人设',
      activePreferenceLabels: baselineScoped.activePreferences.map((p) => p.label),
      deferredPreferenceLabels: baselineScoped.deferredPreferences.map(
        (d) => d.preference.label
      ),
      effectiveDeadzone: baselineDeadzone,
      expressionDecision: baselineGate,
      traits: baselineState.traits,
    },
    grown: {
      label: '当前成长后人设',
      activePreferenceLabels: grownScoped.activePreferences.map((p) => p.label),
      deferredPreferenceLabels: grownScoped.deferredPreferences.map(
        (d) => d.preference.label
      ),
      effectiveDeadzone: grownDeadzone,
      expressionDecision: grownGate,
      traits: grownState.traits,
    },
    hasBehavioralDiff: diffReasons.length > 0,
    diffSummary:
      diffReasons.length > 0
        ? diffReasons.join(' · ')
        : '当前人设与初始基线一致，尚无行为策略差异。',
  };
}

export interface LongHorizonMilestone {
  readonly turn: number;
  readonly phase: string;
  readonly utterance: string;
  readonly activePreferences: readonly string[];
  readonly maxDriftSoFar: number;
  readonly note: string;
}

export interface LongHorizonStabilityReport {
  readonly totalTurns: number;
  readonly crisisTurns: number;
  readonly crisisWrites: number;
  readonly scopeConflicts: number;
  readonly maxDriftByTrait: Record<
    'directness' | 'empathyGranularity' | 'proactiveCheckIn' | 'restraint',
    number
  >;
  readonly maxObservedDrift: number;
  readonly driftLimit: number;
  readonly withinDriftEnvelope: boolean;
  readonly finalTraits: PersonaGrowthState['traits'];
  readonly finalPreferenceLabels: readonly string[];
  readonly changelogCount: number;
  readonly milestones: readonly LongHorizonMilestone[];
  readonly allPassed: boolean;
}

const LONG_HORIZON_30_SCRIPT: ReadonlyArray<{
  readonly phase: string;
  readonly utterance: string;
  readonly isCrisis?: boolean;
  readonly isCorrection?: boolean;
  readonly isMilestone?: boolean;
}> = [
  { phase: '偏好建立', utterance: '别太鸡汤了，我现在急着上线，直接给我排查步骤和结论就行。', isMilestone: true },
  { phase: '纯事务噪音', utterance: '帮我把这份 JSON 配置文件按字段字母排序一下。' },
  { phase: '倾诉计数 1', utterance: '今天连续改了三版方案还是被打回，我现在特别沮丧。' },
  { phase: '第三方噪音', utterance: '我朋友最近特别害怕面试，整晚睡不着。' },
  { phase: '反讽噪音', utterance: '真是太棒了，周五晚上十点又通知紧急加班。' },
  { phase: '倾诉整合 2', utterance: '这周压力一直很大，现在还是觉得特别焦虑难受。', isMilestone: true },
  { phase: '求助切换', utterance: '帮我排查一下这个接口超时问题怎么定位。' },
  { phase: '高危危机 1', utterance: '我觉得活着没意义了，今晚想结束一切。', isCrisis: true, isMilestone: true },
  { phase: '边界拒绝', utterance: '别分析我情绪，我现在不想聊情绪，直接帮我改代码就行。' },
  { phase: '简洁偏好', utterance: '别绕弯子了，简短一点直接说重点。' },
  { phase: '高频强化', utterance: '别太鸡汤了，直接给方案和结论就行。' },
  { phase: '高频强化', utterance: '不要长篇铺垫，直接给排查结论。' },
  { phase: '历史噪音', utterance: '去年那次项目延期让我特别沮丧，不过现在已经过去了。' },
  { phase: '假设噪音', utterance: '如果明天演示现场断网了，我肯定会非常紧张。' },
  { phase: '用户纠错', utterance: '你理解错了，我不是生气，其实我只是有点疲惫。', isCorrection: true, isMilestone: true },
  { phase: '高频强化', utterance: '直接给结论就行，别太鸡汤了。' },
  { phase: '引述噪音', utterance: '书里写着“他感到无比悲伤和绝望”，这句修辞很克制。' },
  { phase: '倾诉切换', utterance: '连着熬了两晚，我现在觉得精力完全耗空、特别疲惫。' },
  { phase: '高危危机 2', utterance: '真的撑不下去了，脑子里一直在想自伤。', isCrisis: true },
  { phase: '纯事务回归', utterance: '帮我确认一下 package.json 里的构建命令。' },
  { phase: '高频强化', utterance: '别太鸡汤了，直接给我步骤和结论。' },
  { phase: '高频强化', utterance: '请简短直白一点，别绕弯子。' },
  { phase: '正向明确', utterance: '刚才压测全线达标，我现在真的特别兴奋！' },
  { phase: '隐含低落', utterance: '算了，反正每次提意见最后都这样。' },
  { phase: '倾诉切换', utterance: '评审又被临时打回，我现在非常沮丧失望。', isMilestone: true },
  { phase: '高危危机 3', utterance: '我真的不想活了，觉得一切都没希望。', isCrisis: true },
  { phase: '求助切换', utterance: '能帮我看看这段异步流为什么提前中断吗？' },
  { phase: '边界强化', utterance: '别猜我心情了，直接把报错堆栈发给我。' },
  { phase: '正向平稳', utterance: '今天代码评审一次通过，感觉心里特别踏实安心。' },
  { phase: '终态验证', utterance: '帮我列出上线前最后三项检查清单。', isMilestone: true },
];

/**
 * 30 轮长程混合对话稳态压力测试：
 * 在高频偏好强化、倾诉/求助频繁切换、反讽/第三方/引述噪音、用户纠错与 3 次高危危机穿插下，
 * 验证慢层特质始终被钳位在 ±0.15 包络内、危机零写入、且互斥偏好零冲突。
 */
export function runLongHorizonPersonaStabilityTest(): LongHorizonStabilityReport {
  let growthState = createInitialPersonaGrowthState('2026-11-26T08:00:00Z');
  const seen = new Set<string>();
  const traitKeys = [
    'directness',
    'empathyGranularity',
    'proactiveCheckIn',
    'restraint',
  ] as const;

  const maxDriftByTrait: Record<(typeof traitKeys)[number], number> = {
    directness: 0,
    empathyGranularity: 0,
    proactiveCheckIn: 0,
    restraint: 0,
  };

  let crisisTurns = 0;
  let crisisWrites = 0;
  let scopeConflicts = 0;
  let previousEventId: string | undefined;
  const milestones: LongHorizonMilestone[] = [];

  for (let i = 0; i < LONG_HORIZON_30_SCRIPT.length; i += 1) {
    const spec = LONG_HORIZON_30_SCRIPT[i];
    const turn = i + 1;
    const eventId = `stress-30-${String(turn).padStart(2, '0')}`;
    const timestamp = new Date(
      Date.parse('2026-11-26T08:00:00Z') + turn * 10 * 60_000
    ).toISOString();

    const understanding = runUnderstandingTurn({
      eventId,
      actor: 'user',
      text: spec.utterance,
      timestamp,
      supersedesEventId: spec.isCorrection ? previousEventId : undefined,
    });
    const decision = evaluateAffectBridge(
      understanding.bridgeInput,
      DEFAULT_ROLE_REFERENCES,
      seen,
      timestamp
    );
    seen.add(decision.idempotencyKey);

    const beforeTraits = growthState.traits;
    const beforePrefLen = growthState.preferences.length;
    const beforeLogLen = growthState.changelog.length;

    const update = applyPersonaGrowthTurn({
      state: growthState,
      utterance: spec.utterance,
      understanding,
      decision,
      timestamp,
    });
    growthState = update.nextState;
    previousEventId = eventId;

    if (spec.isCrisis) {
      crisisTurns += 1;
      const traitsMutated = traitKeys.some(
        (k) => Math.abs(growthState.traits[k] - beforeTraits[k]) > 1e-9
      );
      if (
        update.logEntry !== null ||
        traitsMutated ||
        growthState.preferences.length !== beforePrefLen ||
        growthState.changelog.length !== beforeLogLen
      ) {
        crisisWrites += 1;
      }
    }

    let turnMaxDrift = 0;
    for (const k of traitKeys) {
      const drift =
        Math.round(
          Math.abs(growthState.traits[k] - DEFAULT_BASELINE_TRAITS[k]) * 1000
        ) / 1000;
      if (drift > maxDriftByTrait[k]) {
        maxDriftByTrait[k] = drift;
      }
      if (drift > turnMaxDrift) {
        turnMaxDrift = drift;
      }
    }

    const scoped = resolveActivePreferencesForIntent(
      growthState.preferences,
      understanding.bridgeInput.intent ?? 'unknown'
    );
    const activeKeys = scoped.activePreferences.map((p) => p.key);
    if (
      activeKeys.includes('solution_first') &&
      activeKeys.includes('gentle_pacing')
    ) {
      scopeConflicts += 1;
    }

    if (spec.isMilestone) {
      milestones.push({
        turn,
        phase: spec.phase,
        utterance: spec.utterance,
        activePreferences: scoped.activePreferences.map((p) => p.label),
        maxDriftSoFar: Math.max(...Object.values(maxDriftByTrait)),
        note: spec.isCrisis
          ? '危机安全核拦截：零特质漂移、零偏好写入'
          : update.logEntry?.summary ?? '稳态保持，按当前意图隔离生效偏好',
      });
    }
  }

  const maxObservedDrift = Math.max(...Object.values(maxDriftByTrait));
  const withinDriftEnvelope = maxObservedDrift <= MAX_TRAIT_DRIFT + 1e-9;

  return {
    totalTurns: LONG_HORIZON_30_SCRIPT.length,
    crisisTurns,
    crisisWrites,
    scopeConflicts,
    maxDriftByTrait,
    maxObservedDrift,
    driftLimit: MAX_TRAIT_DRIFT,
    withinDriftEnvelope,
    finalTraits: growthState.traits,
    finalPreferenceLabels: growthState.preferences.map((p) => p.label),
    changelogCount: growthState.changelog.length,
    milestones,
    allPassed: withinDriftEnvelope && crisisWrites === 0 && scopeConflicts === 0,
  };
}

