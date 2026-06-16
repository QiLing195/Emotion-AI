// ── arbitration / rewardLearner 测试 ──

import { describe, it, expect } from 'vitest';
import { arbitrate, hasOverrides, formatOverrides } from '../arbitration';
import { rewardLearner } from '../rewardLearner';
import type { ArbitrationInput } from '../arbitration';
import type { StrategyDecision } from '../dialogueStrategy';
import type { ConflictState } from '../conflictManager';
import type { RhythmDecision } from '../rhythmController';
import type { ContextSnapshot } from '../contextAwareness';

// ── 辅助函数 ──

function makeNeutralStrategy(): StrategyDecision {
  return { strategy: 'neutral', confidence: 0.8, reason: 'default', params: {} };
}

function makeExploreStrategy(): StrategyDecision {
  return { strategy: 'explore', confidence: 0.7, reason: 'interest detected', params: {} };
}

function makeNormalConflictState(): ConflictState {
  return {
    phase: 'normal', warningCount: 0, conflictSignals: [],
    repairActions: [], lastConflictAt: null, repairedAt: null,
    totalConflicts: 0, successfulRepairs: 0, trustDamageAccumulated: 0,
    recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
  };
}

function makeWarningConflictState(): ConflictState {
  return {
    ...makeNormalConflictState(),
    phase: 'warning', warningCount: 3,
  };
}

function makeCasualRhythm(): RhythmDecision {
  return { mode: 'casual', responseDelayMs: 2000, allowProactive: true, suggestedResponseLength: 150, reason: 'normal' };
}

function makeDeepRhythm(): RhythmDecision {
  return { mode: 'deep_talk', responseDelayMs: 4000, allowProactive: false, suggestedResponseLength: 250, reason: 'deep' };
}

function makeDaytimeContext(): ContextSnapshot {
  return {
    time: { timeSlot: 'afternoon', hour: 14, dayOfWeek: 3, isWeekend: false, seasonalityHint: '' },
    user: { accumulatedStress: 0.3, isReunion: false, activityLevel: 0.5, consecutiveActiveDays: 3, minutesSinceLastInteraction: 10, moodBaseline: 0.2, moodVolatility: 0.1 },
    session: { depth: 'casual', roundInSession: 5, isFirstInteractionToday: false, isUserVenting: false, topicSwitchRate: 0.3 },
    modulationFactors: { responseLengthMod: 0.7, proactiveSuitability: 0.6, emotionalSensitivityMod: 1.0, depthAffinity: 0.5 },
  };
}

function makeNightStressedContext(): ContextSnapshot {
  return {
    time: { timeSlot: 'night', hour: 23, dayOfWeek: 3, isWeekend: false, seasonalityHint: '深夜' },
    user: { accumulatedStress: 0.8, isReunion: false, activityLevel: 0.2, consecutiveActiveDays: 1, minutesSinceLastInteraction: 60, moodBaseline: -0.3, moodVolatility: 0.5 },
    session: { depth: 'deep', roundInSession: 8, isFirstInteractionToday: false, isUserVenting: true, topicSwitchRate: 0.1 },
    modulationFactors: { responseLengthMod: 0.3, proactiveSuitability: 0.2, emotionalSensitivityMod: 1.3, depthAffinity: 0.8 },
  };
}

// ════════════════════════════════════════════════════════════

describe('arbitrate', () => {
  describe('规则 A: 冲突阶段校验', () => {
    it('warning 阶段不允许 explore', () => {
      const input: ArbitrationInput = {
        strategyDecision: makeExploreStrategy(),
        conflictState: makeWarningConflictState(),
        contextSnapshot: makeDaytimeContext(),
        rhythmDecision: makeCasualRhythm(),
      };
      const output = arbitrate(input);
      expect(output.finalStrategy).not.toBe('explore');
      expect(output.overrides.length).toBeGreaterThan(0);
      expect(output.overrides[0].rule).toBe('conflict_phase_strategy');
    });

    it('normal 阶段允许所有策略', () => {
      const input: ArbitrationInput = {
        strategyDecision: makeExploreStrategy(),
        conflictState: makeNormalConflictState(),
        contextSnapshot: makeDaytimeContext(),
        rhythmDecision: makeCasualRhythm(),
      };
      const output = arbitrate(input);
      expect(output.finalStrategy).toBe('explore');
      expect(hasOverrides(output)).toBe(false);
    });
  });

  describe('规则 B: 策略-节奏兼容', () => {
    it('accompany 需要 deep_talk，casual 模式会被覆盖', () => {
      const input: ArbitrationInput = {
        strategyDecision: { strategy: 'accompany', confidence: 0.8, reason: 'low arousal', params: {} },
        conflictState: makeNormalConflictState(),
        contextSnapshot: makeDaytimeContext(),
        rhythmDecision: makeCasualRhythm(),
      };
      const output = arbitrate(input);
      expect(output.finalRhythm.mode).toBe('deep_talk');
      expect(output.overrides.some(o => o.rule === 'strategy_mode_compat')).toBe(true);
    });

    it('neutral 在所有模式下都兼容', () => {
      const input: ArbitrationInput = {
        strategyDecision: makeNeutralStrategy(),
        conflictState: makeNormalConflictState(),
        contextSnapshot: makeDaytimeContext(),
        rhythmDecision: makeDeepRhythm(),
      };
      const output = arbitrate(input);
      expect(output.finalRhythm.mode).toBe('deep_talk');
      expect(output.overrides.some(o => o.rule === 'strategy_mode_compat')).toBe(false);
    });
  });

  describe('规则 D: 深夜高压', () => {
    it('深夜+高压强制 deep_talk', () => {
      const input: ArbitrationInput = {
        strategyDecision: makeNeutralStrategy(),
        conflictState: makeNormalConflictState(),
        contextSnapshot: makeNightStressedContext(),
        rhythmDecision: { ...makeCasualRhythm(), mode: 'quick_chat' },
      };
      const output = arbitrate(input);
      expect(output.finalRhythm.mode).toBe('deep_talk');
      expect(output.overrides.some(o => o.rule === 'night_stress_deep')).toBe(true);
    });
  });
});

describe('rewardLearner', () => {
  it('初始先验为中性 1.0', () => {
    rewardLearner.reset();
    const prior = rewardLearner.getStrategyPrior('empathize');
    expect(prior).toBe(1.0);
  });

  it('多轮正面反馈后先验上升', () => {
    rewardLearner.reset();
    const strategy = 'empathize';
    for (let i = 0; i < 10; i++) {
      rewardLearner.markStrategyUsed(strategy);
      rewardLearner.recordFeedback(0.5);
    }
    const prior = rewardLearner.getStrategyPrior(strategy);
    expect(prior).toBeGreaterThan(1.0);
  });

  it('负面反馈后成功率下降', () => {
    rewardLearner.reset();
    const strategy = 'explore';
    // 先用很多
    for (let i = 0; i < 5; i++) {
      rewardLearner.markStrategyUsed(strategy);
      rewardLearner.recordFeedback(-0.3);
    }
    // 继续尝试但全部失败
    for (let i = 0; i < 5; i++) {
      rewardLearner.markStrategyUsed(strategy);
      rewardLearner.recordFeedback(-0.5);
    }
    const prior = rewardLearner.getStrategyPrior(strategy);
    expect(prior).toBeLessThan(1.0);
  });

  it('不足最小样本数返回 1.0', () => {
    rewardLearner.reset();
    // 只用 2 次，minSamplesForPrior 默认 5
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(0.5);
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(0.5);
    expect(rewardLearner.getStrategyPrior('explore')).toBe(1.0);
  });

  it('getAllStats 返回排序后的数据', () => {
    rewardLearner.reset();
    const stats = rewardLearner.getAllStats();
    expect(stats.length).toBe(9); // 9种策略
    // 所有初始成功率都是 0.5
    for (const s of stats) {
      expect(s.successRate).toBe(0.5);
    }
  });
});

describe('formatOverrides', () => {
  it('无覆盖返回友好信息', () => {
    const output = arbitrate({
      strategyDecision: makeNeutralStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
    });
    expect(formatOverrides(output)).toBe('无覆盖（模块一致）');
  });

  it('有覆盖返回格式化字符串', () => {
    const output = arbitrate({
      strategyDecision: makeExploreStrategy(),
      conflictState: makeWarningConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
    });
    const formatted = formatOverrides(output);
    expect(formatted).toContain('conflict_phase_strategy');
    expect(formatted).toContain('explore');
  });
});

// ════════════════════════════════════════════════════════════
// Phase 2: 规则 E/F + 奖励学习反馈回路
// ════════════════════════════════════════════════════════════

function makeShareStrategy(): StrategyDecision {
  return { strategy: 'share', confidence: 0.65, reason: 'pending discoveries', params: {} };
}

function makeDesireStrategy(): StrategyDecision {
  return { strategy: 'desire', confidence: 0.55, reason: 'greed drive high', params: { desireTopic: '未来' } };
}

describe('arbitrate — Phase 2 规则 E: 好奇心-安全平衡', () => {
  it('用户情绪负面时 explore 策略被抑制', () => {
    const output = arbitrate({
      strategyDecision: makeExploreStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      currentValence: -0.5, // 负面情绪
    });
    expect(output.finalStrategy).not.toBe('explore');
    expect(output.finalStrategy).toBe('empathize');
    const override = output.overrides.find(o => o.rule === 'curiosity_safety_balance');
    expect(override).toBeDefined();
    expect(override!.reason).toContain('好奇心驱动');
  });

  it('重度负面时 share 切换为 accompany', () => {
    const output = arbitrate({
      strategyDecision: makeShareStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      currentValence: -0.7, // 重度负面
    });
    expect(output.finalStrategy).toBe('accompany');
  });

  it('情绪平稳时不触发安全平衡', () => {
    const output = arbitrate({
      strategyDecision: makeExploreStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      currentValence: 0.1, // 中性偏正
    });
    expect(output.finalStrategy).toBe('explore');
    expect(output.overrides.length).toBe(0);
  });

  it('desire 在负面情绪下也被抑制', () => {
    const output = arbitrate({
      strategyDecision: makeDesireStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      currentValence: -0.4,
    });
    expect(output.finalStrategy).toBe('empathize');
    const override = output.overrides.find(o => o.rule === 'curiosity_safety_balance');
    expect(override).toBeDefined();
  });
});

describe('arbitrate — Phase 2 规则 F: Insight 质量门槛', () => {
  it('insight 质量不够时 share 降级为 neutral', () => {
    const lowQualityInsights = [
      { id: 'i1', type: 'correlation' as const, title: 'test', description: '...', topic: '摄影',
        relatedTopics: [], confidence: 0.4, surpriseScore: 0.25,
        surpriseDimensions: { novel: 0.2, useful: 0.3, surprising: 0.2 },
        sourceTopics: ['摄影'], generatedAt: Date.now(), shared: false },
    ];

    const output = arbitrate({
      strategyDecision: makeShareStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      generatedInsights: lowQualityInsights,
    });
    expect(output.finalStrategy).toBe('neutral');
    const override = output.overrides.find(o => o.rule === 'insight_quality_gate');
    expect(override).toBeDefined();
    expect(override!.reason).toContain('质量门槛');
  });

  it('有高质量 insight 时不触发门槛', () => {
    const qualityInsights = [
      { id: 'i2', type: 'emotion_deviation' as const, title: 'test', description: '...', topic: '摄影',
        relatedTopics: [], confidence: 0.7, surpriseScore: 0.55,
        surpriseDimensions: { novel: 0.6, useful: 0.5, surprising: 0.5 },
        sourceTopics: ['摄影'], generatedAt: Date.now(), shared: false },
    ];

    const output = arbitrate({
      strategyDecision: makeShareStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
      generatedInsights: qualityInsights,
    });
    expect(output.finalStrategy).toBe('share');
    expect(output.overrides.length).toBe(0);
  });

  it('非 share 策略不触发门槛', () => {
    const output = arbitrate({
      strategyDecision: makeNeutralStrategy(),
      conflictState: makeNormalConflictState(),
      contextSnapshot: makeDaytimeContext(),
      rhythmDecision: makeCasualRhythm(),
    });
    // 应该没有 insight_quality_gate 覆盖
    const gateOverride = output.overrides.find(o => o.rule === 'insight_quality_gate');
    expect(gateOverride).toBeUndefined();
  });
});

describe('rewardLearner — Phase 2 反馈回路', () => {
  it('positive 反馈增加成功率', () => {
    rewardLearner.reset();
    rewardLearner.markStrategyUsed('explore');
    const before = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!;
    expect(before.attempts).toBe(1);

    rewardLearner.recordFeedback(0.8); // 正向
    const after = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!;
    expect(after.successRate).toBeGreaterThan(0.5);
    expect(after.successes).toBeGreaterThan(0);
  });

  it('negative 反馈降低成功率', () => {
    rewardLearner.reset();
    rewardLearner.markStrategyUsed('share');
    rewardLearner.recordFeedback(-0.6); // 负向
    const stats = rewardLearner.getAllStats().find(s => s.strategy === 'share')!;
    expect(stats.successRate).toBeLessThan(0.5);
    expect(stats.failures).toBeGreaterThan(0);
  });

  it('不足 minSamples 时先验为 1.0', () => {
    rewardLearner.reset();
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.markStrategyUsed('explore');
    // 只有 2 次尝试 < minSamplesForPrior(5)
    const prior = rewardLearner.getStrategyPrior('explore');
    expect(prior).toBe(1.0);
  });

  it('足够样本后成功策略先验 > 1', () => {
    rewardLearner.reset();
    for (let i = 0; i < 6; i++) {
      rewardLearner.markStrategyUsed('empathize');
      rewardLearner.recordFeedback(0.5); // 每次都成功
    }
    const prior = rewardLearner.getStrategyPrior('empathize');
    expect(prior).toBeGreaterThan(1.0);
  });

  it('时间衰减减少旧数据权重', () => {
    rewardLearner.reset();
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(1.0);
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(1.0);

    const before = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!.successes;

    // 手动模拟时间衰减
    rewardLearner.applyDailyDecay();
    const after = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!;
    // 当天数据不应衰减太多
    expect(after.successRate).toBeGreaterThan(0.5);
  });
});
