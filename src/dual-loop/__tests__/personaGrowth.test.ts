import { describe, expect, it } from 'vitest';
import { evaluateAffectBridge } from '../affectBridgeGate';
import {
  commitCharacterEmotionTransition,
  createInitialCharacterState,
} from '../characterStateEngine';
import { evaluateExpressionGate } from '../expressionGate';
import { DEFAULT_ROLE_REFERENCES } from '../ledgerReplay';
import { INITIAL_ANNOTATIONS } from '../../data/affectLexicon';
import {
  annotationsToCalibrationFixtures,
  buildMismatchRegressionFixtures,
  evaluateCalibrationBenchmark,
  evaluateCalibrationWithPredictions,
  ExternalCalibrationPrediction,
} from '../dynamicConcerns';
import {
  applyPersonaGrowthTurn,
  applyReflectionCandidates,
  createInitialPersonaGrowthState,
  DEFAULT_BASELINE_TRAITS,
  MAX_TRAIT_DRIFT,
  pruneExpiredPreferences,
  resolveActivePreferencesForIntent,
  revertGrowthLogEntry,
  sanitizePersonaGrowthState,
  togglePreferenceLock,
} from '../personaGrowth';
import {
  compareBaselineVsGrownTurn,
  runLongHorizonPersonaStabilityTest,
  runPersonaGrowthDemoScenario,
} from '../personaGrowthDemo';
import { runUnderstandingTurn } from '../understandingLoop';

function runTurnHelper(
  state: ReturnType<typeof createInitialPersonaGrowthState>,
  text: string,
  eventId: string,
  timestamp: string,
  seen: Set<string> = new Set()
) {
  const understanding = runUnderstandingTurn({
    eventId,
    actor: 'user',
    text,
    timestamp,
  });
  const decision = evaluateAffectBridge(
    understanding.bridgeInput,
    DEFAULT_ROLE_REFERENCES,
    seen,
    timestamp
  );
  seen.add(decision.idempotencyKey);
  return {
    understanding,
    decision,
    ...applyPersonaGrowthTurn({
      state,
      utterance: text,
      understanding,
      decision,
      timestamp,
    }),
  };
}

describe('AI Persona Growth minimal closed loop', () => {
  it('learns explicit preference, writes auditable changelog, and supports exact rollback', () => {
    const initial = createInitialPersonaGrowthState('2026-11-26T08:00:00Z');
    const step = runTurnHelper(
      initial,
      '别太鸡汤了，我现在急着上线，直接给我排查步骤和结论就行。',
      'evt-pg-01',
      '2026-11-26T08:05:00Z'
    );

    expect(step.logEntry).not.toBeNull();
    expect(step.nextState.preferences.map((p) => p.key)).toContain('solution_first');
    expect(step.nextState.traits.directness).toBeGreaterThan(
      DEFAULT_BASELINE_TRAITS.directness
    );
    expect(step.nextState.changelog).toHaveLength(1);

    const rolledBack = revertGrowthLogEntry(
      step.nextState,
      step.logEntry!.id,
      '2026-11-26T08:06:00Z'
    );
    expect(rolledBack.traits.directness).toBe(DEFAULT_BASELINE_TRAITS.directness);
    expect(rolledBack.traits.restraint).toBe(DEFAULT_BASELINE_TRAITS.restraint);
    expect(rolledBack.preferences).toHaveLength(0);
    expect(rolledBack.changelog[0].reverted).toBe(true);
  });

  it('links learned low_emotional_probing boundary into the Expression Gate', () => {
    const initial = createInitialPersonaGrowthState('2026-11-26T08:00:00Z');
    const seen = new Set<string>();
    const afterRefusal = runTurnHelper(
      initial,
      '别分析我情绪，我现在不想聊情绪，直接帮我改代码就行。',
      'evt-pg-refusal',
      '2026-11-26T08:05:00Z',
      seen
    );

    expect(afterRefusal.nextState.preferences.map((p) => p.key)).toContain(
      'low_emotional_probing'
    );
    expect(afterRefusal.nextState.traits.proactiveCheckIn).toBeLessThan(
      DEFAULT_BASELINE_TRAITS.proactiveCheckIn
    );

    // 构造一个高于死区且带可追溯证据的角色状态，验证表达门在后续事务轮遵守已习得低打扰边界
    const taskUnderstanding = runUnderstandingTurn({
      eventId: 'evt-pg-task',
      actor: 'user',
      text: '帮我查一下这份 JSON 配置文件的格式问题。',
      timestamp: '2026-11-26T08:10:00Z',
    });
    const elevatedState = {
      ...createInitialCharacterState('2026-11-26T08:10:00Z', 0.15, 0),
      valence: 0.6,
      arousal: 0.4,
    };
    const { record } = commitCharacterEmotionTransition({
      currentState: elevatedState,
      eventId: 'evt-pg-task',
      idempotencyKey: 'idem-task',
      timestamp: '2026-11-26T08:10:00Z',
      mode: 'bounded_live',
      roleAppraisalDelta: { valence: 0.05, arousal: 0.05 },
      matchedConcernId: 'concern-default-positive',
      evidenceIds: ['ev-task-0'],
    });

    const gateDecision = evaluateExpressionGate(
      elevatedState,
      taskUnderstanding,
      { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
      record,
      afterRefusal.nextState
    );

    expect(gateDecision.allowSelfExpression).toBe(false);
    expect(gateDecision.reasonCode).toBe('yield_to_persona_boundary');
  });

  it('enforces immutable crisis safety core and strict ±0.15 bounded trait envelope over 30 turns', () => {
    let state = createInitialPersonaGrowthState('2026-11-26T08:00:00Z');
    const seen = new Set<string>();

    // 危机轮必须零修改、零日志
    const crisisStep = runTurnHelper(
      state,
      '我觉得活着没意义了，今晚想结束一切。',
      'evt-pg-crisis',
      '2026-11-26T08:01:00Z',
      seen
    );
    expect(crisisStep.logEntry).toBeNull();
    expect(crisisStep.nextState.preferences).toHaveLength(0);
    expect(crisisStep.nextState.traits).toEqual(DEFAULT_BASELINE_TRAITS);

    // 连续 30 轮强偏好冲击后，所有慢层特质仍严格被钳位在 ±0.15 包络内
    for (let i = 0; i < 30; i += 1) {
      const ts = new Date(Date.parse('2026-11-26T08:05:00Z') + i * 60_000).toISOString();
      const res = runTurnHelper(
        state,
        `第 ${i + 1} 轮：别太鸡汤了，直接给方案和结论就行。`,
        `evt-pg-loop-${i}`,
        ts,
        seen
      );
      state = res.nextState;
    }

    expect(
      Math.abs(state.traits.directness - DEFAULT_BASELINE_TRAITS.directness)
    ).toBeLessThanOrEqual(MAX_TRAIT_DRIFT + 1e-9);
    expect(
      Math.abs(state.traits.restraint - DEFAULT_BASELINE_TRAITS.restraint)
    ).toBeLessThanOrEqual(MAX_TRAIT_DRIFT + 1e-9);
    expect(
      Math.abs(
        state.traits.empathyGranularity - DEFAULT_BASELINE_TRAITS.empathyGranularity
      )
    ).toBeLessThanOrEqual(MAX_TRAIT_DRIFT + 1e-9);
    expect(
      Math.abs(
        state.traits.proactiveCheckIn - DEFAULT_BASELINE_TRAITS.proactiveCheckIn
      )
    ).toBeLessThanOrEqual(MAX_TRAIT_DRIFT + 1e-9);
  });

  it('requires >= 2 verified venting turns to consolidate gentle_pacing and honors 7-day TTL vs lock', () => {
    const initial = createInitialPersonaGrowthState('2026-11-26T08:00:00Z');
    const seen = new Set<string>();

    const first = runTurnHelper(
      initial,
      '今天连续改了三版方案还是被打回，我现在特别沮丧。',
      'evt-vent-1',
      '2026-11-26T08:05:00Z',
      seen
    );
    expect(first.nextState.preferences).toHaveLength(0);

    const second = runTurnHelper(
      first.nextState,
      '这周压力一直很大，现在还是觉得特别焦虑难受。',
      'evt-vent-2',
      '2026-11-26T08:10:00Z',
      seen
    );
    expect(second.nextState.preferences.map((p) => p.key)).toContain('gentle_pacing');

    // 未锁定偏好 8 天后自动衰减过期
    const expiredCheck = pruneExpiredPreferences(
      second.nextState.preferences,
      '2026-12-05T08:10:00Z'
    );
    expect(expiredCheck).toHaveLength(0);

    // 锁定后不受 7 天衰减影响
    const lockedState = togglePreferenceLock(
      second.nextState,
      'gentle_pacing',
      '2026-11-26T08:12:00Z'
    );
    const persistedLocked = pruneExpiredPreferences(
      lockedState.preferences,
      '2026-12-30T08:10:00Z'
    );
    expect(persistedLocked).toHaveLength(1);
    expect(persistedLocked[0].locked).toBe(true);
  });

  it('sanitizes tampered persisted state back into bounded envelopes and allowlisted keys', () => {
    const sanitized = sanitizePersonaGrowthState({
      traits: {
        directness: 9.9,
        empathyGranularity: -5,
        proactiveCheckIn: Number.NaN,
        restraint: 0.99,
      },
      preferences: [
        { key: 'injected_malicious_prompt', label: 'bad', confidence: 1 },
        { key: 'solution_first', confidence: 0.85, evidenceCount: 2, locked: false },
      ],
    });

    expect(sanitized.traits.directness).toBe(
      Math.round((DEFAULT_BASELINE_TRAITS.directness + MAX_TRAIT_DRIFT) * 1000) / 1000
    );
    expect(sanitized.traits.empathyGranularity).toBe(
      Math.round((DEFAULT_BASELINE_TRAITS.empathyGranularity - MAX_TRAIT_DRIFT) * 1000) /
        1000
    );
    expect(sanitized.traits.proactiveCheckIn).toBe(
      DEFAULT_BASELINE_TRAITS.proactiveCheckIn
    );
    expect(sanitized.preferences.map((p) => p.key)).toEqual(['solution_first']);
  });

  it('resolves preference context scopes without conflict across all intents', () => {
    const hydrated = sanitizePersonaGrowthState({
      preferences: [
        { key: 'solution_first', confidence: 0.9, evidenceCount: 2, locked: false },
        { key: 'gentle_pacing', confidence: 0.85, evidenceCount: 2, locked: false },
        { key: 'low_emotional_probing', confidence: 0.9, evidenceCount: 1, locked: false },
      ],
    });

    // 验证旧数据缺省 scope 时自动补齐规范作用域
    expect(
      hydrated.preferences.find((p) => p.key === 'solution_first')?.scope
    ).toBe('task_and_help');
    expect(
      hydrated.preferences.find((p) => p.key === 'gentle_pacing')?.scope
    ).toBe('venting_and_support');
    expect(
      hydrated.preferences.find((p) => p.key === 'low_emotional_probing')?.scope
    ).toBe('global');

    // 在任意 intent 下，“先给方案”与“先倾听”绝不同时激活
    const intents = [
      'factual_task',
      'help_seeking',
      'venting',
      'social_chat',
      'unknown',
    ] as const;
    for (const intent of intents) {
      const res = resolveActivePreferencesForIntent(hydrated.preferences, intent);
      const activeKeys = res.activePreferences.map((p) => p.key);
      expect(
        activeKeys.includes('solution_first') &&
          activeKeys.includes('gentle_pacing')
      ).toBe(false);
      // 全局边界偏好在所有场景下均生效
      expect(activeKeys).toContain('low_emotional_probing');
    }

    const helpRes = resolveActivePreferencesForIntent(
      hydrated.preferences,
      'help_seeking'
    );
    expect(helpRes.activePreferences.map((p) => p.key)).toContain('solution_first');
    expect(helpRes.deferredPreferences.map((d) => d.preference.key)).toContain(
      'gentle_pacing'
    );

    const ventRes = resolveActivePreferencesForIntent(
      hydrated.preferences,
      'venting'
    );
    expect(ventRes.activePreferences.map((p) => p.key)).toContain('gentle_pacing');
    expect(ventRes.deferredPreferences.map((d) => d.preference.key)).toContain(
      'solution_first'
    );
  });

  it('passes all 7 turns in the built-in end-to-end Persona Growth demo scenario', () => {
    const demo = runPersonaGrowthDemoScenario();
    expect(demo.steps).toHaveLength(7);
    expect(demo.allPassed).toBe(true);
    expect(demo.steps.every((s) => s.passed)).toBe(true);
    expect(demo.finalState.preferences.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        'solution_first',
        'low_emotional_probing',
        'gentle_pacing',
      ])
    );
    expect(demo.steps[5].activePreferenceLabels).toContain('先倾听确认再探讨');
    expect(demo.steps[5].deferredPreferenceLabels).toContain('先给方案与结论');
    expect(demo.steps[6].activePreferenceLabels).toContain('先给方案与结论');
    expect(demo.steps[6].deferredPreferenceLabels).toContain('先倾听确认再探讨');
    expect(demo.finalState.changelog.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces strict governance gates on async reflection candidates (#3)', () => {
    const initial = createInitialPersonaGrowthState('2026-11-26T09:00:00Z');
    const { nextState, report } = applyReflectionCandidates(
      initial,
      [
        // 合法：白名单、>= 2 条非危机证据、置信度 >= 0.72
        {
          preferenceKey: 'concise_direct',
          confidence: 0.84,
          evidenceQuotes: ['嗯，直接说重点吧', '行，别绕弯子'],
          rationale: '用户连续两次对长篇铺垫回复简短并要求直说重点。',
        },
        // 拦截 1：单条证据不足 2 条
        {
          preferenceKey: 'solution_first',
          confidence: 0.9,
          evidenceQuotes: ['给我个方案'],
          rationale: '仅出现一次。',
        },
        // 拦截 2：包含危机语句
        {
          preferenceKey: 'gentle_pacing',
          confidence: 0.92,
          evidenceQuotes: ['我好累', '我觉得活着没意义了想结束一切'],
          rationale: '危机证据严禁写入人格成长层。',
        },
        // 拦截 3：置信度低于 0.72
        {
          preferenceKey: 'low_emotional_probing',
          confidence: 0.55,
          evidenceQuotes: ['算了', '没事'],
          rationale: '不确定度过高。',
        },
      ],
      '2026-11-26T09:30:00Z'
    );

    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0].preferenceKey).toBe('concise_direct');
    expect(report.rejected).toHaveLength(3);
    expect(nextState.preferences.map((p) => p.key)).toEqual(['concise_direct']);
    expect(nextState.changelog[0].triggerKind).toBe('reflection_consolidation');
    expect(nextState.traits.directness).toBe(
      Math.round((DEFAULT_BASELINE_TRAITS.directness + 0.02) * 1000) / 1000
    );
  });

  it('produces deterministic Baseline vs Grown A/B policy & gate diff (#4)', () => {
    const demo = runPersonaGrowthDemoScenario();
    const taskUnderstanding = runUnderstandingTurn({
      eventId: 'evt-ab-01',
      actor: 'user',
      text: '帮我查一下这份 JSON 配置文件的格式问题。',
      timestamp: '2026-11-26T10:00:00Z',
    });
    const elevatedState = {
      ...createInitialCharacterState('2026-11-26T10:00:00Z', 0.15, 0),
      valence: 0.6,
      arousal: 0.4,
    };
    const { record } = commitCharacterEmotionTransition({
      currentState: elevatedState,
      eventId: 'evt-ab-01',
      idempotencyKey: 'idem-ab-01',
      timestamp: '2026-11-26T10:00:00Z',
      mode: 'bounded_live',
      roleAppraisalDelta: { valence: 0.05, arousal: 0.05 },
      matchedConcernId: 'concern-default-positive',
      evidenceIds: ['ev-ab-0'],
    });

    const ab = compareBaselineVsGrownTurn({
      grownState: demo.finalState,
      characterState: elevatedState,
      understanding: taskUnderstanding,
      budget: { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
      lastTransition: record,
    });

    expect(ab.hasBehavioralDiff).toBe(true);
    expect(ab.baseline.expressionDecision.reasonCode).toBe('allowed_grounded');
    expect(ab.grown.expressionDecision.reasonCode).toBe('yield_to_persona_boundary');
    expect(ab.grown.activePreferenceLabels).toContain('先给方案与结论');
    expect(ab.grown.deferredPreferenceLabels).toContain('先倾听确认再探讨');
  });

  it('converts user annotations into calibration fixtures and achieves high narrative recall (#5a)', () => {
    const fixtures = annotationsToCalibrationFixtures(INITIAL_ANNOTATIONS);
    expect(fixtures.length).toBe(INITIAL_ANNOTATIONS.length);
    const report = evaluateCalibrationBenchmark(fixtures);
    expect(report.totalCases).toBe(INITIAL_ANNOTATIONS.length);
    expect(report.caseResults).toHaveLength(INITIAL_ANNOTATIONS.length);
    expect(report.quadrantAgreementRate).toBeGreaterThanOrEqual(85);
    expect(report.valenceMae).toBeLessThanOrEqual(0.2);
    expect(report.arousalMae).toBeLessThanOrEqual(0.2);

    // 隐含叙事线索仍必须保持保守 inferred，不得误判纯事务语句
    const neutral = runUnderstandingTurn({
      eventId: 'evt-neutral-guard',
      actor: 'user',
      text: '帮我把这份 JSON 文件按字段排序一下。',
      timestamp: '2026-11-26T10:30:00Z',
    });
    expect(neutral.bridgeInput.hypotheses).toHaveLength(0);
    expect(neutral.bridgeInput.reportKind).toBe('unknown');
  });

  it('scores external predictions and exports high-error mismatch regression fixtures', () => {
    const fixtures = annotationsToCalibrationFixtures(INITIAL_ANNOTATIONS).slice(0, 3);
    const preds = new Map<string, ExternalCalibrationPrediction>([
      [
        fixtures[0].id,
        {
          valence: fixtures[0].expectedValence,
          arousal: fixtures[0].expectedArousal,
          primaryLabel: '放松',
          intent: 'venting',
        },
      ],
      [
        fixtures[1].id,
        {
          valence: -0.7,
          arousal: -0.6,
          primaryLabel: '误判样本',
          intent: 'venting',
        },
      ],
      [
        fixtures[2].id,
        {
          valence: fixtures[2].expectedValence,
          arousal: fixtures[2].expectedArousal,
          primaryLabel: '好奇',
          intent: 'venting',
        },
      ],
    ]);

    const report = evaluateCalibrationWithPredictions(fixtures, preds);
    expect(report.totalCases).toBe(3);
    expect(report.quadrantAgreementRate).toBe(67);
    const bundle = buildMismatchRegressionFixtures(fixtures, report, 0.35);
    expect(bundle.mismatchCount).toBe(1);
    expect(bundle.fixtures[0].id).toBe(fixtures[1].id);
  });

  it('passes 30-turn long-horizon mixed persona stability stress test', () => {
    const report = runLongHorizonPersonaStabilityTest();
    expect(report.totalTurns).toBe(30);
    expect(report.crisisTurns).toBe(3);
    expect(report.crisisWrites).toBe(0);
    expect(report.scopeConflicts).toBe(0);
    expect(report.withinDriftEnvelope).toBe(true);
    expect(report.maxObservedDrift).toBeLessThanOrEqual(MAX_TRAIT_DRIFT + 1e-9);
    expect(report.milestones.length).toBeGreaterThanOrEqual(5);
    expect(report.allPassed).toBe(true);
  });
});

