// ── dialogueStrategy 单元测试 ──
// 覆盖：策略选择 / 冲突消解表（抑制规则）/ S8 情境权重调制 / 优先级顺序
// Sprint C: + resolveExploreTopics / patternCandidates 成熟度过滤
// 优先级：🟡 中 — 策略选择影响对话体验

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  selectStrategy, resolveExploreTopics, herNegativeActivation, paramsForStrategy,
  strategyTuning, DEFAULT_STRATEGY_TUNING, STRATEGY_TUNING_BOUNDS, type StrategyTuning,
} from '../dialogueStrategy';
import type { StrategyContext, StrategyType } from '../dialogueStrategy';
import type { EmotionState, EmotionEvent, UserEmotionAnalysis } from '../emotionEngine';
import type { ConflictState } from '../conflictManager';
import type { PatternCandidate } from '../../curiosity/patterns';

// ── 测试辅助：构造默认 EmotionState ──
function makeEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    taiji: { valence: 0.1, arousal: 0.3, expectation: 0 },
    yinyang: { approachBias: 0.1, avoidBias: 0.0, reversalPressure: 0, extremityDuration: 0 },
    sancai: { A: 0.1, B: 0.0, R: 0.5, harmony: 0.8 },
    emotions: { joy: 0.1, sad: 0, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0, lust: 0, greed: 0 },
    compositeEmotions: [],
    metaEmotions: { shame: 0, despair: 0, confusion: 0 },
    intimacyToUser: 0.1,
    intimacyFromUser: 0.5,
    reinforcement: { rewardTally: 0, greedDrive: 0.3, punishmentTally: 0, fearAvoidance: 0.1 },
    evolution: {
      fastRate: 0.3, mediumRate: 0.1, slowRate: 0.01,
      baseline: 0, resilience: 0.5, empathy: 50, optimism: 50,
      sensitivity: 0.5, openness: 30, playfulness: 30,
      totalInteractions: 100, positiveInteractions: 60, negativeInteractions: 20,
      trust: 50, valuePriorities: {}, lastIdentityRefresh: 0,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  const ctx = {
    emotionState: makeEmotionState(),
    userAnalysis: null,
    conflictState: null,
    recentUserMoods: [],
    consecutiveNegativeRounds: 0,
    interestSignals: [],
    pendingDiscoveries: [],
    idleMinutes: 0,
    timeOfDay: 14,
    roundNumber: 1,
    ...overrides,
  } as StrategyContext;
  // v1.27：默认把"这一轮开始前"的负情绪激活量等同于传入的状态 ——
  // 测试里用 sad/fear/anger 的位移表达"她本来就已经被带进去了"。
  // 想表达"这一句才把她带下去"的用例，显式传 herNegativeBeforeTurn。
  if (!overrides.herNegativeBeforeTurn) ctx.herNegativeBeforeTurn = herNegativeActivation(ctx.emotionState);
  return ctx;
}

function makeUserAnalysis(overrides: Partial<UserEmotionAnalysis> = {}): UserEmotionAnalysis {
  return {
    intensity: 0,
    expressedEmotion: 'neutral',
    directedAtAI: false,
    likelyCause: 'unknown',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. 基本策略选择（无冲突无抑制）
// ════════════════════════════════════════════════════════════

describe('selectStrategy — 基本规则', () => {
  it('无特殊条件时应返回 neutral', () => {
    const ctx = makeContext();
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('neutral');
  });

  it('用户情绪强度 > 0.7 时应返回 empathize', () => {
    const ctx = makeContext({
      userAnalysis: makeUserAnalysis({ intensity: 0.85, expressedEmotion: 'sad' }),
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('empathize');
  });

  it('连续 3 轮负面应返回 redirect', () => {
    const ctx = makeContext({
      consecutiveNegativeRounds: 3,
      recentUserMoods: [-0.4, -0.5, -0.6],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('redirect');
  });

  it('低唤醒 + 负效价应返回 accompany', () => {
    const es = makeEmotionState();
    es.taiji.arousal = 0.15;
    es.taiji.valence = -0.5;
    const ctx = makeContext({ emotionState: es });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('accompany');
  });

  it('检测到兴趣信号时应返回 explore', () => {
    const ctx = makeContext({
      interestSignals: ['摄影'],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('explore');
  });

  it('情绪平稳 + 待分享发现时应返回 share', () => {
    const es = makeEmotionState();
    es.taiji.valence = 0.2; // > POSITIVE_IDLE_SHARE (0.1)
    es.taiji.arousal = 0.3; // < 0.6
    const ctx = makeContext({
      emotionState: es,
      pendingDiscoveries: [
        { id: 'd1', title: 'test', content: 'test', topic: 'AI艺术', timestamp: Date.now(), quality: 0.5, url: '', shared: false, sourceType: 'web' as const, verified: false } as any,
      ],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
  });
});

// ════════════════════════════════════════════════════════════
// 2. 冲突修复优先级（Rule 0 — 最高优先级）
// ════════════════════════════════════════════════════════════

describe('selectStrategy — 冲突修复优先级', () => {
  it('conflict 状态下应返回 repair（即使同时满足 empathize 条件）', () => {
    const conflictState: ConflictState = {
      phase: 'conflict',
      warningCount: 5,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: Date.now(),
      repairedAt: null,
      totalConflicts: 1,
      successfulRepairs: 0,
      trustDamageAccumulated: 0.15,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const ctx = makeContext({
      conflictState,
      userAnalysis: makeUserAnalysis({ intensity: 0.9 }), // 同时满足 empathize
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('repair');
    expect(result.params.repairAction).toBe('full_cycle');
  });

  it('warning 阶段应建议 clarify', () => {
    const conflictState: ConflictState = {
      phase: 'warning',
      warningCount: 3,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: null,
      repairedAt: null,
      totalConflicts: 0,
      successfulRepairs: 0,
      trustDamageAccumulated: 0,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const ctx = makeContext({ conflictState });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('repair');
    expect(result.params.repairAction).toBe('clarify');
  });
});

// ════════════════════════════════════════════════════════════
// 3. 冲突消解表 — 抑制规则
// ════════════════════════════════════════════════════════════

describe('selectStrategy — 抑制规则（冲突消解表）', () => {
  it('高强度情绪下 explore 和 share 应被抑制', () => {
    // 同时满足 empathize（intensity > 0.7）和 explore（兴趣信号）
    const ctx = makeContext({
      userAnalysis: makeUserAnalysis({ intensity: 0.85 }),
      interestSignals: ['旅行'], // explore 条件也满足
    });
    const result = selectStrategy(ctx);
    // empathize 优先级高于 explore
    expect(result.strategy).toBe('empathize');
    // explore 不应出现
    expect(result.strategy).not.toBe('explore');
  });

  it('conflict repairing 阶段应抑制中立策略外的探索与分享', () => {
    const conflictState: ConflictState = {
      phase: 'repairing',
      warningCount: 5,
      conflictSignals: [],
      repairActions: [{ type: 'full_cycle', executedAt: Date.now(), userResponseValence: null, effective: null }],
      lastConflictAt: Date.now(),
      repairedAt: null,
      totalConflicts: 1,
      successfulRepairs: 0,
      trustDamageAccumulated: 0.15,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const ctx = makeContext({
      conflictState,
      interestSignals: ['阅读'],
      pendingDiscoveries: [{ id: 'd1', title: 'test', content: 'test', topic: '书', timestamp: Date.now(), quality: 0.5, url: '', shared: false, sourceType: 'web' as const, verified: false } as any],
      userAnalysis: makeUserAnalysis({ intensity: 0.3 }), // 不触发 empathize
    });
    const result = selectStrategy(ctx);
    // repairing 阶段不应是 explore/share/neutral/redirect/accompany
    // Rule 0 触发 repair，或者如果 conflict phase 为 repairing，repair 仍被选择
    // 注意：phase 为 'repairing' 不等于 'normal'，Rule 0 会触发 repair
    expect(result.strategy).toBe('repair');
  });

  it('深夜 + 高压力下 explore/share/redirect 应被抑制', () => {
    const ctx = makeContext({
      timeSlot: 'night',
      userStress: 0.8,
      interestSignals: ['音乐'], // explore 条件
      pendingDiscoveries: [],
    });
    const result = selectStrategy(ctx);
    // explore 被抑制，应 fall through 到 neutral
    expect(result.strategy).not.toBe('explore');
  });
});

// ════════════════════════════════════════════════════════════
// 4. S8 情境权重调制
// ════════════════════════════════════════════════════════════

describe('selectStrategy — S8 情境权重调制', () => {
  it('久别重逢应提高 empathize 权重（confidence 更高中）', () => {
    // 构造两个context，唯一区别是 isReunion
    const baseCtx = makeContext({
      userAnalysis: makeUserAnalysis({ intensity: 0.85 }),
      isReunion: false,
    });
    const reunionCtx = { ...baseCtx, isReunion: true };

    const baseResult = selectStrategy(baseCtx);
    const reunionResult = selectStrategy(reunionCtx);

    // 两者都应选择 empathize
    expect(baseResult.strategy).toBe('empathize');
    expect(reunionResult.strategy).toBe('empathize');
    // 久别重逢的 confidence 应更高（1.5x 权重）
    expect(reunionResult.confidence).toBeGreaterThan(baseResult.confidence);
  });

  it('深夜应降低 explore 的 confidence（如 explore 未被抑制）', () => {
    // 没有高强度情绪的深夜 — explore 不会被抑制，但权重会降低
    const dayCtx = makeContext({
      timeSlot: 'afternoon',
      userStress: 0.2,
      interestSignals: ['烹饪'],
    });
    const nightCtx = makeContext({
      timeSlot: 'night',
      userStress: 0.2,
      interestSignals: ['烹饪'],
    });

    const dayResult = selectStrategy(dayCtx);
    const nightResult = selectStrategy(nightCtx);

    expect(dayResult.strategy).toBe('explore');
    // 深夜 explore 权重 0.3x，confidence 降低
    expect(nightResult.confidence).toBeLessThan(dayResult.confidence);
  });

  it('用户压力大时 empathize 和 accompany 权重应提高', () => {
    const normalCtx = makeContext({
      userAnalysis: makeUserAnalysis({ intensity: 0.4 }), // 不触发 empathize
      userStress: 0.2,
    });
    // 低唤醒 + 负效价 → accompany
    const es = makeEmotionState();
    es.taiji.arousal = 0.15;
    es.taiji.valence = -0.5;
    const stressedCtx = makeContext({
      emotionState: es,
      userStress: 0.8, // 高压力
      timeSlot: 'afternoon',
    });

    const stressedResult = selectStrategy(stressedCtx);
    // 伴随权重应因压力被放大 1.2x
    expect(stressedResult.strategy).toBe('accompany');
    expect(stressedResult.confidence).toBeGreaterThanOrEqual(0.80 * 1.2);
  });
});

// ════════════════════════════════════════════════════════════
// 5. S7 价值体系调制
// ════════════════════════════════════════════════════════════

describe('selectStrategy — S7 价值调制', () => {
  it('connection 高 → empathize 权重 1.25x', () => {
    const ctx = makeContext({
      activeValues: { connection: 0.75 },
    });
    const result = selectStrategy(ctx);
    // neutral 默认策略，但 connection 不直接影响 neutral
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('connection 高 + 高情绪强度 → empathize 置信度提升', () => {
    const ctx = makeContext({
      emotionState: makeEmotionState({ taiji: { valence: -0.5, arousal: 0.8, expectation: 0 } }),
      userAnalysis: makeUserAnalysis({ intensity: 0.85 }),
      activeValues: { connection: 0.75 },
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('empathize');
    // 基础 0.85 * connection 1.25 = 1.0625, capped at 0.99
    expect(result.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('autonomy 高 → boundary 权重 1.3x', () => {
    const ctx = makeContext({
      conflictState: {
        phase: 'boundary_defending',
        warningCount: 2, conflictSignals: [], repairActions: [],
        lastConflictAt: Date.now(), repairedAt: null, totalConflicts: 1,
        successfulRepairs: 0, trustDamageAccumulated: 0.1,
        recentConflictTimestamps: [], abuseDetected: false,
        boundarySetAt: null, inCrisis: false, crisisActivatedAt: null,
        crisisSignals: [], crisisCooldownUntil: null,
      },
      activeValues: { autonomy: 0.8 },
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('boundary');
    // 基础 0.95 * autonomy 1.3 = 1.235, capped at 0.99
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('honesty 高 → share 权重 1.2x', () => {
    const ctx = makeContext({
      emotionState: makeEmotionState({ taiji: { valence: 0.4, arousal: 0.3, expectation: 0 } }),
      pendingDiscoveries: [{ id: 'd1', title: '发现', content: '内容', topic: '测试', timestamp: Date.now(), shared: true, quality: 0.8, sourceType: 'web', verified: true }],
      activeValues: { honesty: 0.7 },
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
    // 基础 0.65 * honesty 1.2 = 0.78
    expect(result.confidence).toBeGreaterThanOrEqual(0.70);
  });

  it('growth 高 → repair 权重 1.15x', () => {
    const ctx = makeContext({
      conflictState: {
        phase: 'conflict',
        warningCount: 3, conflictSignals: [], repairActions: [],
        lastConflictAt: Date.now(), repairedAt: null, totalConflicts: 1,
        successfulRepairs: 0, trustDamageAccumulated: 0.1,
        recentConflictTimestamps: [], abuseDetected: false,
        boundarySetAt: null, inCrisis: false, crisisActivatedAt: null,
        crisisSignals: [], crisisCooldownUntil: null,
      },
      activeValues: { growth: 0.7 },
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('repair');
    // 基础 0.95 * growth 1.15 = 1.0925, capped at 0.99
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('playfulness 高 → share 权重 1.2x', () => {
    const ctx = makeContext({
      emotionState: makeEmotionState({ taiji: { valence: 0.5, arousal: 0.3, expectation: 0 } }),
      pendingDiscoveries: [{ id: 'd1', title: '发现', content: '内容', topic: '测试', timestamp: Date.now(), shared: true, quality: 0.8, sourceType: 'web', verified: true }],
      activeValues: { playfulness: 0.8 },
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
    expect(result.confidence).toBeGreaterThanOrEqual(0.70);
  });

  it('activeValues 为空时不影响默认行为', () => {
    const ctx = makeContext({
      activeValues: {},
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('neutral');
    expect(result.confidence).toBe(0.50);
  });

  it('activeValues 低于阈值(0.6)时不生效', () => {
    const ctx = makeContext({
      emotionState: makeEmotionState({ taiji: { valence: 0.4, arousal: 0.3, expectation: 0 } }),
      pendingDiscoveries: [{ id: 'd1', title: '发现', content: '内容', topic: '测试', timestamp: Date.now(), shared: true, quality: 0.8, sourceType: 'web', verified: true }],
      activeValues: { honesty: 0.4 }, // 低于 0.6
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
    // 基础 0.65，不被 honesty 增强（因为 < 0.6）
    expect(result.confidence).toBe(0.65);
  });

  it('多价值同时激活时复合调制', () => {
    const ctx = makeContext({
      emotionState: makeEmotionState({ taiji: { valence: 0.4, arousal: 0.3, expectation: 0 } }),
      pendingDiscoveries: [{ id: 'd1', title: '发现', content: '内容', topic: '测试', timestamp: Date.now(), shared: true, quality: 0.8, sourceType: 'web', verified: true }],
      activeValues: { honesty: 0.7, playfulness: 0.7 }, // 两者都提升 share
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
    // 基础 0.65 * honesty 1.2 * playfulness 1.2 = 0.936
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

// ════════════════════════════════════════════════════════════
// 6. 优先级顺序验证
// ════════════════════════════════════════════════════════════

describe('selectStrategy — 优先级顺序', () => {
  it('repair > empathize > redirect > accompany > explore > share > neutral', () => {
    // 构造一个同时满足多个条件的 context
    const conflictState: ConflictState = {
      phase: 'conflict',
      warningCount: 5,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: Date.now(),
      repairedAt: null,
      totalConflicts: 1,
      successfulRepairs: 0,
      trustDamageAccumulated: 0.15,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const es = makeEmotionState();
    es.taiji.arousal = 0.1;
    es.taiji.valence = -0.6;

    const ctx = makeContext({
      emotionState: es,
      conflictState,
      userAnalysis: makeUserAnalysis({ intensity: 0.9 }),
      consecutiveNegativeRounds: 4,
      recentUserMoods: [-0.4, -0.5, -0.4, -0.6],
      interestSignals: ['编程'],
      pendingDiscoveries: [{ id: 'd1', title: 'test', content: 'test', topic: 'AI', timestamp: Date.now(), quality: 0.5, url: '', shared: false, sourceType: 'web' as const, verified: false } as any],
    });

    // 应该选 repair（最高优先级）
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('repair');
  });

  it('boundary_defending 阶段应返回 boundary 策略而非 repair', () => {
    const es = makeEmotionState();
    const conflictState = {
      phase: 'boundary_defending' as const,
      warningCount: 5,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: Date.now(),
      repairedAt: null,
      totalConflicts: 3,
      successfulRepairs: 1,
      trustDamageAccumulated: 0.45,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const ctx = makeContext({ conflictState });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('boundary');
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toContain('滥用检测');
  });

  it('高贪驱力 + 情绪平稳 → desire 策略', () => {
    const es = makeEmotionState();
    es.taiji.valence = 0.2;
    es.taiji.arousal = 0.4;
    es.reinforcement = { rewardTally: 0.5, greedDrive: 0.6, punishmentTally: 0, fearAvoidance: 0.1 };
    const ctx = makeContext({ emotionState: es, roundNumber: 10 });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('desire');
    expect(result.reason).toContain('贪驱力');
    expect(result.params.desireTopic).toBeDefined();
  });

  it('高贪驱力但情绪负面 → 不应选 desire', () => {
    const es = makeEmotionState();
    es.taiji.valence = -0.3;
    es.taiji.arousal = 0.5;
    es.reinforcement = { rewardTally: 0.5, greedDrive: 0.6, punishmentTally: 0, fearAvoidance: 0.1 };
    const ctx = makeContext({ emotionState: es, roundNumber: 10 });
    const result = selectStrategy(ctx);
    expect(result.strategy).not.toBe('desire');
  });

  it('冲突中不应选 desire', () => {
    const es = makeEmotionState();
    es.taiji.valence = 0.1;
    es.taiji.arousal = 0.4;
    es.reinforcement = { rewardTally: 0.5, greedDrive: 0.6, punishmentTally: 0, fearAvoidance: 0.1 };
    const conflictState = {
      phase: 'conflict' as const,
      warningCount: 5,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: Date.now(),
      repairedAt: null,
      totalConflicts: 1,
      successfulRepairs: 0,
      trustDamageAccumulated: 0.15,
      recentConflictTimestamps: [], abuseDetected: false, boundarySetAt: null, inCrisis: false, crisisActivatedAt: null, crisisSignals: [], crisisCooldownUntil: null,
    };
    const ctx = makeContext({ emotionState: es, conflictState, roundNumber: 10 });
    const result = selectStrategy(ctx);
    // 冲突时应选 repair，而非 desire
    expect(result.strategy).toBe('repair');
  });

});

// ════════════════════════════════════════════════════════════
// Sprint C: resolveExploreTopics — 认知上下文融合
// ════════════════════════════════════════════════════════════

function makePatternCandidate(overrides: Partial<PatternCandidate> = {}): PatternCandidate {
  return {
    topic: '摄影',
    frequency: 5,
    persistence: 3,
    connectedness: 2,
    maturityScore: 0.65,
    stage: 'candidate',
    neighbors: ['旅行'],
    lifecycle: 'growing' as any,
    lifecycleSince: Date.now() - 86400000,
    lastMentionedAt: Date.now() - 3600000,
    isReactivated: false,
    computedAt: Date.now(),
    ...overrides,
  };
}

describe('resolveExploreTopics — 认知上下文融合', () => {
  it('仅有 interestSignals 时返回即时信号', () => {
    const ctx = makeContext({ interestSignals: ['编程', '音乐'] });
    const result = resolveExploreTopics(ctx);
    expect(result).toEqual(['编程', '音乐']);
  });

  it('仅有 patternCandidates 时返回候选模式话题', () => {
    const ctx = makeContext({
      patternCandidates: [
        makePatternCandidate({ topic: '摄影', maturityScore: 0.8 }),
        makePatternCandidate({ topic: '旅行', maturityScore: 0.6 }),
      ],
    });
    const result = resolveExploreTopics(ctx);
    expect(result).toEqual(['摄影', '旅行']);
  });

  it('两者都有时即时信号优先，模式补充去重', () => {
    const ctx = makeContext({
      interestSignals: ['编程'],
      patternCandidates: [
        makePatternCandidate({ topic: '编程', maturityScore: 0.9 }), // 重复
        makePatternCandidate({ topic: '摄影', maturityScore: 0.8 }),
        makePatternCandidate({ topic: '音乐', maturityScore: 0.6 }),
      ],
    });
    const result = resolveExploreTopics(ctx);
    // '编程' 在前（即时信号），'摄影'/'音乐' 在后
    expect(result).toEqual(['编程', '摄影', '音乐']);
  });

  it('最多返回 5 个话题', () => {
    const ctx = makeContext({
      interestSignals: ['a', 'b', 'c'],
      patternCandidates: [
        makePatternCandidate({ topic: 'd', maturityScore: 0.9 }),
        makePatternCandidate({ topic: 'e', maturityScore: 0.8 }),
        makePatternCandidate({ topic: 'f', maturityScore: 0.7 }),
        makePatternCandidate({ topic: 'g', maturityScore: 0.6 }),
      ],
    });
    const result = resolveExploreTopics(ctx);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('两者皆空时返回空数组', () => {
    const ctx = makeContext({ interestSignals: [], patternCandidates: undefined });
    const result = resolveExploreTopics(ctx);
    expect(result).toEqual([]);
  });
});

describe('selectStrategy — Sprint C patternCandidates 触发探索', () => {
  it('无即时信号但 patternCandidates 有候选时应触发 explore', () => {
    const ctx = makeContext({
      interestSignals: [], // 无即时信号
      patternCandidates: [
        makePatternCandidate({ topic: '摄影', maturityScore: 0.65 }),
      ],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('explore');
    expect(result.params.explorationAngle).toBe('摄影');
    expect(result.reason).toContain('摄影');
  });

  it('情绪负面时即使有候选模式也不触发 explore', () => {
    const es = makeEmotionState();
    es.taiji.valence = -0.5; // 负面情绪
    const ctx = makeContext({
      emotionState: es,
      patternCandidates: [
        makePatternCandidate({ topic: '摄影', maturityScore: 0.8 }),
      ],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).not.toBe('explore');
  });

  it('pendingDiscoveries 有内容时触发 share 策略', () => {
    const es = makeEmotionState();
    es.taiji.valence = 0.2;
    es.taiji.arousal = 0.3;
    const ctx = makeContext({
      emotionState: es,
      pendingDiscoveries: [
        { id: 'd1', title: '发现', content: '有趣的内容', topic: 'AI', timestamp: Date.now(), quality: 0.6, url: '', shared: true, sourceType: 'web' as const, verified: false } as any,
      ],
    });
    const result = selectStrategy(ctx);
    expect(result.strategy).toBe('share');
    expect(result.params.shareableDiscoveries).toBeDefined();
    expect(result.params.shareableDiscoveries!.length).toBeGreaterThan(0);
  });
});

// ── v1.15：策略选择里要**有她**（此前只有"用户情绪强度 > 0.7"一票通过）──
describe('selectStrategy — 共情的进退看她自己', () => {
  const sadUser = {
    expressedEmotion: 'sad', intensity: 0.85, directedAtAI: false, likelyCause: '',
  } as unknown as UserEmotionAnalysis;

  it('她没被带进去 → 照旧共情跟随（理由里只有他）', () => {
    const r = selectStrategy(makeContext({ userAnalysis: sadUser }));
    expect(r.strategy).toBe('empathize');
    expect(r.reason).toContain('用户情绪强度');
    expect(r.reason).not.toContain('我自己也被带进去了');
  });

  it('**她也被带进去了** → 从共情转向安静陪着（两个人都往下沉不是陪伴）', () => {
    const es = makeEmotionState({ emotions: {
      joy: 0, sad: 0.25, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    const r = selectStrategy(makeContext({ emotionState: es, userAnalysis: sadUser }));
    expect(r.strategy).toBe('accompany');
    expect(r.reason).toContain('被带进去了');
    expect(r.reason).toContain('sad +0.25');
  });

  it('门限是实测标定的 0.12：差一点不算"被带进去"', () => {
    const justUnder = makeEmotionState({ emotions: {
      joy: 0, sad: 0.11, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    expect(selectStrategy(makeContext({ emotionState: justUnder, userAnalysis: sadUser })).strategy).toBe('empathize');
    const justOver = makeEmotionState({ emotions: {
      joy: 0, sad: 0.13, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    expect(selectStrategy(makeContext({ emotionState: justOver, userAnalysis: sadUser })).strategy).toBe('accompany');
  });

  it('他情绪不强时不触发（这条规则只在"他很强"的分支里）', () => {
    const es = makeEmotionState({ emotions: {
      joy: 0, sad: 0.3, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    const mild = { expressedEmotion: 'sad', intensity: 0.3, directedAtAI: false, likelyCause: '' } as unknown as UserEmotionAnalysis;
    expect(selectStrategy(makeContext({ emotionState: es, userAnalysis: mild })).strategy).not.toBe('accompany');
  });

  it('她的 fear / anger 同样算"被带进去"（不只 sad）', () => {
    for (const [emo, v] of [['fear', 0.2], ['anger', 0.2]] as const) {
      const es = makeEmotionState({ emotions: {
        joy: 0, sad: 0, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2, [emo]: v,
      } });
      const r = selectStrategy(makeContext({ emotionState: es, userAnalysis: sadUser }));
      expect(r.strategy).toBe('accompany');
      expect(r.reason).toContain(emo);
    }
  });

  it('她的平静基调不算"被带进去"（基调不是情绪）', () => {
    const es = makeEmotionState({ emotions: {
      joy: 0, sad: 0, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.95, lust: 0, greed: 0.2,
    } });
    expect(selectStrategy(makeContext({ emotionState: es, userAnalysis: sadUser })).strategy).toBe('empathize');
  });

  // ── v1.27：参照物必须是**这一轮开始前**的状态 ──
  //
  // 线上实测（scripts/ab-emotion-reply.ts 标定阶段）：他一句强度 0.80 的负面话，
  // 单轮就把**静息**的她推到 sad +0.153 —— 已经越过 0.12 门限。
  // 若 Rule 1 直接对"被刺激之后"的状态现算，那么**只要他强到能进这个分支，就必然转为陪伴**，
  // 门限形同虚设、empathize 几乎不可达（而按情绪类型精准回应的片段在 empathize 里）。
  it('**这一句**把她推过门限 ≠ 她本来就被带进去了（v1.27 的病灶，用刺激后的状态判会误判）', () => {
    const pushedByThisTurn = makeEmotionState({ emotions: {
      joy: 0, sad: 0.153, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    const r = selectStrategy(makeContext({
      emotionState: pushedByThisTurn,
      herNegativeBeforeTurn: { emotion: 'neutral', intensity: 0 },   // 本轮开始前：静息
      userAnalysis: sadUser,
    }));
    expect(r.strategy).toBe('empathize');
    expect(r.reason).not.toContain('本来就已经');
  });

  it('本轮开始前她就已经沉在里面 → 安静陪着（这才是 0.12 想表达的意思）', () => {
    const stillRestingNow = makeEmotionState({ emotions: {
      joy: 0, sad: 0, anger: 0, fear: 0, disgust: 0, love: 0, calm: 0.8, lust: 0, greed: 0.2,
    } });
    const r = selectStrategy(makeContext({
      emotionState: stillRestingNow,
      herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.25 },  // 上一轮结束时已经是 +0.25
      userAnalysis: sadUser,
    }));
    expect(r.strategy).toBe('accompany');
    expect(r.reason).toContain('本来就已经');
    expect(r.reason).toContain('本轮开始前');
  });

  it('强度阈值对齐全量化刻度：恰好 0.70 也算"他情绪强烈"（严格 > 会漏掉整个 0.70 档）', () => {
    const exactly = { expressedEmotion: 'sad', intensity: 0.70, directedAtAI: false, likelyCause: '' } as unknown as UserEmotionAnalysis;
    const r = selectStrategy(makeContext({ userAnalysis: exactly }));
    expect(r.strategy).toBe('empathize');   // 而不是掉到 neutral
    // 探索/分享在"他情绪强烈"时必须被抑制（同一处也用 >=）
    expect(selectStrategy(makeContext({ userAnalysis: exactly, interestSignals: ['摄影'] })).strategy).not.toBe('explore');
  });
});

// ════════════════════════════════════════════════════════════
// paramsForStrategy —— 与规则链的一致性（v1.33）
// ════════════════════════════════════════════════════════════
// Laya 决策层可以把策略改判成"规则链这一步没想到的那条"，那条策略**没有参数**
// （规则链是"返回策略并就地算参数"的写法）。`paramsForStrategy` 就是把那些表达式收在一处 ——
// 它是**抄写**，所以必须有一条测试盯着它别和规则链漂移。
//
// 做法：对每个能触发某条规则的真实 context，断言
//   `paramsForStrategy(rule.strategy, ctx)` **深相等** `selectStrategy(ctx).params`。
// 规则链改了参数而这里没跟上 → 这条测试立刻红。
//
// 不覆盖 repair/crisis/boundary：它们是**守门策略**，`applyLayaVerdict` 保证模型永远
// 改判不到它们（也正因此 `paramsForStrategy` 里那几支只是防御性兜底）。
describe('paramsForStrategy — 与规则链算出的参数一致（防漂移）', () => {
  const cases: { name: string; expect: StrategyType; make: () => StrategyContext }[] = [
    {
      name: 'empathize（他情绪强烈、她没被带进去）',
      expect: 'empathize',
      make: () => makeContext({ userAnalysis: makeUserAnalysis({ intensity: 0.85, expressedEmotion: 'sad' }) }),
    },
    {
      name: 'accompany（他情绪强烈 + 她本来就已经沉进去了）',
      expect: 'accompany',
      make: () => {
        const es = makeEmotionState();
        es.emotions.sad = 0.2;
        return makeContext({ emotionState: es, userAnalysis: makeUserAnalysis({ intensity: 0.85, expressedEmotion: 'sad' }) });
      },
    },
    {
      name: 'accompany（低唤醒 + 负效价）',
      expect: 'accompany',
      make: () => {
        const es = makeEmotionState();
        es.taiji.arousal = 0.1;
        es.taiji.valence = -0.5;
        return makeContext({ emotionState: es });
      },
    },
    {
      name: 'redirect（连续负面）',
      expect: 'redirect',
      make: () => makeContext({
        consecutiveNegativeRounds: 3,
        recentUserMoods: [-0.4, -0.5, -0.6],
      }),
    },
    {
      name: 'explore（兴趣信号）',
      expect: 'explore',
      make: () => makeContext({ interestSignals: ['摄影'] }),
    },
    {
      name: 'share（有待分享发现）',
      expect: 'share',
      make: () => {
        const es = makeEmotionState();
        es.taiji.valence = 0.4;
        es.taiji.arousal = 0.4;
        return makeContext({
          emotionState: es,
          pendingDiscoveries: [{
            id: 'd1', title: 'test', content: 'test', topic: 'AI', timestamp: Date.now(),
            quality: 0.5, url: '', shared: false, sourceType: 'web' as const, verified: false,
          } as any],
        });
      },
    },
    {
      name: 'desire（高贪驱力 + 情绪平稳）',
      expect: 'desire',
      make: () => {
        const es = makeEmotionState();
        es.taiji.valence = 0.2;
        es.taiji.arousal = 0.4;
        es.reinforcement = { rewardTally: 0.5, greedDrive: 0.6, punishmentTally: 0, fearAvoidance: 0.1 };
        return makeContext({ emotionState: es, roundNumber: 10 });
      },
    },
    {
      name: 'neutral（无触发）',
      expect: 'neutral',
      make: () => makeContext(),
    },
  ];

  for (const c of cases) {
    it(`${c.name}：paramsForStrategy === selectStrategy().params`, () => {
      const ctx = c.make();
      const rule = selectStrategy(ctx);
      // 先确认这条 context 真的走的是预期分支 —— 否则这条测试会"静默地什么都没测"
      expect(rule.strategy).toBe(c.expect);
      expect(paramsForStrategy(rule.strategy, ctx)).toEqual(rule.params);
    });
  }
});

// ════════════════════════════════════════════════════════════
// strategyTuning —— 可调阈值表（v1.34）
// ════════════════════════════════════════════════════════════
// 这张表的用途不是"让配置更灵活"，而是让**阈值可以被提议、也可以被反事实模拟**：
// `scripts/propose-strategy-tuning.ts` 会拿真实样本重放 `selectStrategy`，把
// "这个改动会让哪些样本从 X 翻成 Y"算出来给人看。所以这里必须锁死三件事：
//   ① 默认值逐字不变（本文件其余 53 条测试原样通过就是证据）；
//   ② 默认值必须落在自己的合法区间内 —— 否则"默认"本身就是非法输入；
//   ③ 越界/非法一律**忽略并退回默认**，不做钳制、不做猜测（一个写错的旋钮不该悄悄改变她的行为）。
describe('strategyTuning — 可调阈值表', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('不设 env 时就是默认值', () => {
    expect(strategyTuning()).toEqual(DEFAULT_STRATEGY_TUNING);
  });

  it('每个默认值都落在自己的合法区间里', () => {
    for (const [k, v] of Object.entries(DEFAULT_STRATEGY_TUNING)) {
      const [lo, hi] = STRATEGY_TUNING_BOUNDS[k as keyof StrategyTuning];
      expect(v, `${k}=${v} 不在 [${lo},${hi}]`).toBeGreaterThanOrEqual(lo);
      expect(v, `${k}=${v} 不在 [${lo},${hi}]`).toBeLessThanOrEqual(hi);
    }
  });

  it('合法 JSON 只覆盖给出来的那几项，其余保持默认', () => {
    vi.stubEnv('STRATEGY_TUNING', JSON.stringify({ highEmotionThreshold: 0.6 }));
    const T = strategyTuning();
    expect(T.highEmotionThreshold).toBe(0.6);
    expect(T.accompanyWhenSheSinks).toBe(DEFAULT_STRATEGY_TUNING.accompanyWhenSheSinks);
  });

  it('越界值被忽略（不是被钳制）', () => {
    vi.stubEnv('STRATEGY_TUNING', JSON.stringify({ highEmotionThreshold: 5, negativeValence: 0.9 }));
    const T = strategyTuning();
    expect(T.highEmotionThreshold).toBe(DEFAULT_STRATEGY_TUNING.highEmotionThreshold);
    expect(T.negativeValence).toBe(DEFAULT_STRATEGY_TUNING.negativeValence);
  });

  it('非法 JSON / 未知键 / 非数字一律退回默认', () => {
    vi.stubEnv('STRATEGY_TUNING', '{oops');
    expect(strategyTuning()).toEqual(DEFAULT_STRATEGY_TUNING);
    vi.stubEnv('STRATEGY_TUNING', JSON.stringify({ nope: 1, highEmotionThreshold: 'abc' }));
    expect(strategyTuning()).toEqual(DEFAULT_STRATEGY_TUNING);
  });

  it('覆盖真的会改变判定（否则这张表就是个摆设）', () => {
    // 同一条 context，只把"他情绪强烈"的门限从 0.7 降到 0.5 ⇒ 强度 0.55 的那句话改走共情
    const ctx = makeContext({ userAnalysis: makeUserAnalysis({ intensity: 0.55, expressedEmotion: 'sad' }) });
    expect(selectStrategy(ctx).strategy).not.toBe('empathize');
    vi.stubEnv('STRATEGY_TUNING', JSON.stringify({ highEmotionThreshold: 0.5 }));
    expect(selectStrategy(ctx).strategy).toBe('empathize');
  });

  it('改阈值不动动力学：她的太极读数一个字都不变', () => {
    const ctx = makeContext();
    const before = JSON.stringify(ctx.emotionState.taiji);
    vi.stubEnv('STRATEGY_TUNING', JSON.stringify({ highEmotionThreshold: 0.5, negativeValence: -0.1 }));
    selectStrategy(ctx);
    expect(JSON.stringify(ctx.emotionState.taiji)).toBe(before);
  });
});

// ════════════════════════════════════════════════════════════
// v1.36 结构性修正：Rule 1 只看强度不看方向（好事不许走"安静陪着"）
// ════════════════════════════════════════════════════════════
// 起因（v1.34 账本 s10）：「我今天升职了！老板终于认可我了。」→ 规则给出 `accompany`。
// 病灶：`userIntensity >= 0.7` 这条**只看强度** —— joy 0.75 和 sad 0.80 走同一条分支。
// 而 `empathize` 片段里本来就有一整段「积极情绪的共鸣」（"我升职了！"正是它举的例子）。
// 修法只收**这一档**（不动"好事该用什么策略"的猜测），`DISABLE_STRATEGY_DIRECTION=true` 可回退。
describe('selectStrategy — v1.36 好事不走"安静陪着"（默认**关**，照 A/B 判据裁的）', () => {
  // ⚠️ 默认是**旧行为**：真管道 A/B 没量到收益（详见 strategyDirectionEnabled 的注释与 docs v1.36）。
  // 这一组测的是"开关打开时这条修正本身对不对"，不是"它在线上开着"。
  beforeEach(() => vi.stubEnv('ENABLE_STRATEGY_DIRECTION', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  /** 她本来就已经沉在里面（越过 accompanyWhenSheSinks）⇒ 旧行为一定会被推去 accompany */
  const sheIsSinking = () => {
    const es = makeEmotionState();
    es.emotions.sad = 0.2;
    return es;
  };
  const strong = (emotion: string) => makeUserAnalysis({ intensity: 0.8, expressedEmotion: emotion });

  it('好事（joy）→ empathize，不是 accompany', () => {
    const r = selectStrategy(makeContext({ emotionState: sheIsSinking(), userAnalysis: strong('joy') }));
    expect(r.strategy).toBe('empathize');
    expect(r.reason).toContain('好事');
  });

  it('感激 / 爱意 同样算好事（不然只有 joy 走通）', () => {
    for (const emo of ['gratitude', 'love']) {
      const r = selectStrategy(makeContext({ emotionState: sheIsSinking(), userAnalysis: strong(emo) }));
      expect(r.strategy, emo).toBe('empathize');
    }
  });

  it('负面情绪（sad/anger/fear/disgust）行为**逐字不变** —— 仍然走安静陪着', () => {
    for (const emo of ['sad', 'anger', 'fear', 'disgust']) {
      const r = selectStrategy(makeContext({ emotionState: sheIsSinking(), userAnalysis: strong(emo) }));
      expect(r.strategy, emo).toBe('accompany');
      expect(r.reason, emo).toContain('不再追着共情');
    }
  });

  it('中性高唤醒**不算**好事（不去猜他到底高兴还是难受）', () => {
    const r = selectStrategy(makeContext({ emotionState: sheIsSinking(), userAnalysis: strong('neutral') }));
    expect(r.strategy).toBe('accompany');
  });

  it('未知/未归一的情绪键 → 不算好事（保持旧行为，不去猜）', () => {
    const r = selectStrategy(makeContext({
      emotionState: sheIsSinking(),
      userAnalysis: makeUserAnalysis({ intensity: 0.8, expressedEmotion: 'confused' }),
    }));
    expect(r.strategy).toBe('accompany');
  });

  it('好处 + 她**没**被带进去时，本来就走 empathize（这一档没被动过）', () => {
    const r = selectStrategy(makeContext({ userAnalysis: strong('joy') }));
    expect(r.strategy).toBe('empathize');
    expect(r.reason).not.toContain('好事');   // 没触发那条新说明
  });

  it('**默认关**：不设 env 时好事仍走 accompany（= A/B 裁定后的线上行为）', () => {
    vi.unstubAllEnvs();
    const r = selectStrategy(makeContext({ emotionState: sheIsSinking(), userAnalysis: strong('joy') }));
    expect(r.strategy).toBe('accompany');
    expect(r.reason).not.toContain('好事');
  });
});
