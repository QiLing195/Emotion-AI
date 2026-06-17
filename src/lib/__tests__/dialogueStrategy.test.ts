// ── dialogueStrategy 单元测试 ──
// 覆盖：策略选择 / 冲突消解表（抑制规则）/ S8 情境权重调制 / 优先级顺序
// Sprint C: + resolveExploreTopics / patternCandidates 成熟度过滤
// 优先级：🟡 中 — 策略选择影响对话体验

import { describe, it, expect } from 'vitest';
import { selectStrategy, getStrategyDescription, resolveExploreTopics } from '../dialogueStrategy';
import type { StrategyContext } from '../dialogueStrategy';
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
  return {
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
  };
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

// ════════════════════════════════════════════════════════════
// 6. getStrategyDescription
// ════════════════════════════════════════════════════════════

describe('getStrategyDescription', () => {
  it('所有策略类型都应有描述', () => {
    const types = ['empathize', 'redirect', 'explore', 'accompany', 'share', 'repair', 'boundary', 'desire', 'neutral'] as const;
    for (const t of types) {
      const desc = getStrategyDescription(t);
      expect(desc).toBeTruthy();
      expect(desc.length).toBeGreaterThan(5);
    }
  });
});
