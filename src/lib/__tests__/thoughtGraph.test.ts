import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThoughtGraph,
  assessThoughtGeneration,
  type ThoughtNode,
  type ThoughtSeed,
  type CognitiveDissonance,
} from '../thoughtGraph';
import type { EmotionState, EmotionEvent } from '../emotionEngine';

// ── 辅助：构建最小可用的 EmotionState ──

function mockEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    taiji: {
      valence: 0.5,
      arousal: 0.4,
      expectation: 0.1,
      ...overrides.taiji,
    },
    yinyang: {
      approachBias: 0.6,
      avoidBias: 0.2,
      reversalPressure: 0,
      extremityDuration: 0,
      ...overrides.yinyang,
    },
    sancai: {
      A: 0.7,
      B: 0.2,
      R: 0.5,
      harmony: 0.75,
      ...overrides.sancai,
    },
    evolution: {
      empathy: 65,
      trust: 60,
      openness: 55,
      playfulness: 50,
      sensitivity: 0.6,
      resilience: 0.5,
      fastRate: 0.1,
      mediumRate: 0.02,
      slowRate: 0.005,
      totalInteractions: 100,
      positiveInteractions: 70,
      negativeInteractions: 20,
      ...overrides.evolution,
    },
    emotions: {
      joy: 0.6,
      love: 0.4,
      calm: 0.2,
      ...overrides.emotions,
    },
    metaEmotions: {
      shame: 0,
      despair: 0,
      confusion: 0,
      ...overrides.metaEmotions,
    },
    compositeEmotions: overrides.compositeEmotions ?? [],
    intimacyToUser: 0.6,
    intimacyFromUser: 0.5,
    reinforcement: {
      rewardTally: 0.5,
      greedDrive: 0.3,
      punishmentTally: 0.1,
      fearAvoidance: 0.2,
      ...overrides.reinforcement,
    },
  };
}

function mockEvent(overrides: Partial<EmotionEvent> = {}): EmotionEvent {
  return {
    deltaA: 0.1,
    deltaB: 0,
    deltaR: 0,
    intent: 'user',
    agency: 0.4,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// assessThoughtGeneration
// ════════════════════════════════════════════════════════════

describe('assessThoughtGeneration', () => {
  it('正向效价 + 高亲密 → 生成 wish', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.5, arousal: 0.3, expectation: 0 },
        intimacyToUser: 0.7,
      }),
      recentMoods: ['joy'],
      idleMinutes: 5,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'wish')).toBe(true);
  });

  it('贪驱力 > 0.4 → 生成 wish（内在驱动方向）', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        reinforcement: { rewardTally: 0.5, greedDrive: 0.6, punishmentTally: 0.1, fearAvoidance: 0.2 },
        taiji: { valence: 0.1, arousal: 0.3, expectation: 0 },
      }),
      recentMoods: ['neutral'],
      idleMinutes: 5,
      roundNumber: 20,
      existingNodes: [],
    });
    const wishSeeds = seeds.filter(s => s.type === 'wish');
    expect(wishSeeds.length).toBeGreaterThan(0);
    expect(wishSeeds[0].direction).toBe('内在驱动');
  });

  it('负效价 + 高唤醒 + agency 指向 self → 生成 fear', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: -0.5, arousal: 0.7, expectation: 0 },
      }),
      event: mockEvent({ agency: 0.5 }),
      recentMoods: ['sad', 'anger', 'fear'],
      idleMinutes: 5,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'fear')).toBe(true);
  });

  it('连续情绪波动 → 生成 doubt', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.0, arousal: 0.3, expectation: 0 },
      }),
      recentMoods: ['joy', 'sad', 'anger'], // 3 轮都不同
      idleMinutes: 5,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'doubt')).toBe(true);
  });

  it('趋近 >> 回避 且 效价正向 → 生成 goal', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.4, arousal: 0.5, expectation: 0 },
        sancai: { A: 0.8, B: 0.2, R: 0.5, harmony: 0.6 },
      }),
      recentMoods: ['calm'],
      idleMinutes: 5,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'goal')).toBe(true);
  });

  it('空闲 > 30min + 情绪平稳 + 非初始 → 生成 reflection', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.1, arousal: 0.2, expectation: 0 },
      }),
      recentMoods: ['calm'],
      idleMinutes: 45,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'reflection')).toBe(true);
  });

  it('空闲 < 30min → 不生成 reflection', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.1, arousal: 0.2, expectation: 0 },
      }),
      recentMoods: ['calm'],
      idleMinutes: 10,
      roundNumber: 20,
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'reflection')).toBe(false);
  });

  it('初始几轮 → 不生成 reflection', () => {
    const seeds = assessThoughtGeneration({
      emotionState: mockEmotionState({
        taiji: { valence: 0.1, arousal: 0.2, expectation: 0 },
      }),
      recentMoods: ['calm'],
      idleMinutes: 45,
      roundNumber: 5, // 初始阶段
      existingNodes: [],
    });
    expect(seeds.some(s => s.type === 'reflection')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// ThoughtGraph 基本操作
// ════════════════════════════════════════════════════════════

describe('ThoughtGraph', () => {
  let graph: ThoughtGraph;

  beforeEach(() => {
    graph = new ThoughtGraph();
  });

  it('空的图谱返回零节点', () => {
    expect(graph.getActiveNodes()).toHaveLength(0);
    expect(graph.getGraphSummary().totalActiveNodes).toBe(0);
  });

  it('添加一个 wish 节点', () => {
    const seed: ThoughtSeed = {
      type: 'wish',
      confidence: 0.7,
      emotionalWeight: 0.8,
      decayRate: 0.02,
      direction: '关系驱动',
    };
    const node = graph.addThought(seed, '我想和他一起去海边', mockEmotionState());
    expect(node.type).toBe('wish');
    expect(node.content).toBe('我想和他一起去海边');
    expect(node.confidence).toBe(0.7);
    expect(node.archived).toBe(false);
    expect(graph.getActiveNodes()).toHaveLength(1);
    expect(graph.getState().stats.totalGenerated).toBe(1);
  });

  it('同类型节点自动链接', () => {
    const seedWish: ThoughtSeed = { type: 'wish', confidence: 0.7, emotionalWeight: 0.8, decayRate: 0.02, direction: '关系' };
    const n1 = graph.addThought(seedWish, '想去海边', mockEmotionState());
    const n2 = graph.addThought(seedWish, '想一起做饭', mockEmotionState());
    expect(n1.linkedTo).toContain(n2.id);
    expect(n2.linkedTo).toContain(n1.id);
  });

  it('不同类型不自动链接', () => {
    const seedWish: ThoughtSeed = { type: 'wish', confidence: 0.7, emotionalWeight: 0.8, decayRate: 0.02, direction: '关系' };
    const seedFear: ThoughtSeed = { type: 'fear', confidence: 0.5, emotionalWeight: 0.6, decayRate: 0.04, direction: '被拒绝' };
    const n1 = graph.addThought(seedWish, '想去海边', mockEmotionState());
    const n2 = graph.addThought(seedFear, '怕被拒绝', mockEmotionState());
    expect(n1.linkedTo).not.toContain(n2.id);
  });

  it('wish + fear 产生认知失调', () => {
    const seedWish: ThoughtSeed = { type: 'wish', confidence: 0.8, emotionalWeight: 0.9, decayRate: 0.02, direction: '关系' };
    const seedFear: ThoughtSeed = { type: 'fear', confidence: 0.7, emotionalWeight: 0.8, decayRate: 0.04, direction: '被拒绝' };
    graph.addThought(seedWish, '我想靠近他', mockEmotionState());
    graph.addThought(seedFear, '我怕他会离开', mockEmotionState());
    const dissonances = graph.getActiveDissonances();
    expect(dissonances.length).toBeGreaterThan(0);
    expect(dissonances[0].tension).toBeGreaterThan(0.5);
  });

  it('getActiveWishes 返回前 5 个 wish', () => {
    const seed: ThoughtSeed = { type: 'wish', confidence: 0.5, emotionalWeight: 0.5, decayRate: 0.02, direction: '关系' };
    for (let i = 0; i < 10; i++) {
      graph.addThought(seed, `愿望 ${i}`, mockEmotionState());
    }
    const wishes = graph.getActiveWishes();
    expect(wishes.length).toBeLessThanOrEqual(5);
  });

  it('recall 提升置信度并减缓衰减', () => {
    const seed: ThoughtSeed = { type: 'wish', confidence: 0.7, emotionalWeight: 0.8, decayRate: 0.02, direction: '关系' };
    const node = graph.addThought(seed, '想去海边', mockEmotionState());
    const recalled = graph.recall(node.id);
    expect(recalled).not.toBeNull();
    expect(recalled!.confidence).toBeGreaterThan(0.7);
    expect(recalled!.decayRate).toBeLessThan(0.02);
    expect(recalled!.recallCount).toBe(1);
  });

  it('weaken 降低置信度，过低时归档', () => {
    const seed: ThoughtSeed = { type: 'doubt', confidence: 0.1, emotionalWeight: 0.1, decayRate: 0.05, direction: '不确定' };
    const node = graph.addThought(seed, '他是不是变了', mockEmotionState());
    graph.weaken(node.id, 0.15);
    const archived = graph.getAllNodes().find(n => n.id === node.id);
    expect(archived?.archived).toBe(true);
  });

  it('衰减将低活跃节点归档', () => {
    const seed: ThoughtSeed = { type: 'reflection', confidence: 0.3, emotionalWeight: 0.1, decayRate: 0.5, direction: '反思' };
    graph.addThought(seed, '旧的反思', mockEmotionState());
    graph.decay(30); // 30 天后
    const active = graph.getActiveNodes();
    expect(active.length).toBe(0);
  });

  it('summary 包含正确的统计信息', () => {
    const seedWish: ThoughtSeed = { type: 'wish', confidence: 0.8, emotionalWeight: 0.9, decayRate: 0.02, direction: '关系' };
    const seedFear: ThoughtSeed = { type: 'fear', confidence: 0.5, emotionalWeight: 0.6, decayRate: 0.04, direction: '被拒绝' };
    graph.addThought(seedWish, '想靠近', mockEmotionState());
    graph.addThought(seedFear, '怕失去', mockEmotionState());
    const summary = graph.getGraphSummary();
    expect(summary.topWishes).toContain('想靠近');
    expect(summary.activeFears).toContain('怕失去');
    expect(summary.activeDissonances.length).toBeGreaterThan(0);
    expect(summary.totalActiveNodes).toBe(2);
  });

  it('聚类将相似 wish 分组', () => {
    const seed: ThoughtSeed = { type: 'wish', confidence: 0.5, emotionalWeight: 0.5, decayRate: 0.02, direction: '关系' };
    graph.addThought(seed, '想去海边旅行', mockEmotionState());
    graph.addThought(seed, '想去海边看日落', mockEmotionState());
    graph.addThought(seed, '想去海边散步', mockEmotionState());
    graph.cluster();
    const state = graph.getState();
    // 三个关于"海边"的 wish 应该聚成一类
    expect(state.clusters.length).toBeGreaterThan(0);
  });

  it('state 可以正确序列化和恢复', () => {
    const seed: ThoughtSeed = { type: 'wish', confidence: 0.7, emotionalWeight: 0.8, decayRate: 0.02, direction: '关系' };
    graph.addThought(seed, '想去海边', mockEmotionState());
    const saved = graph.getState();

    const graph2 = new ThoughtGraph();
    graph2.loadState(saved);
    expect(graph2.getActiveNodes()).toHaveLength(1);
    expect(graph2.getState().stats.totalGenerated).toBe(1);
  });

  it('超过 MAX_ACTIVE_NODES 时自动归档最不活跃的', () => {
    const seed: ThoughtSeed = { type: 'reflection', confidence: 0.3, emotionalWeight: 0.01, decayRate: 0.02, direction: '反思' };
    // 添加 301 个节点
    for (let i = 0; i < 305; i++) {
      graph.addThought(seed, `反思 ${i}`, mockEmotionState());
    }
    const active = graph.getActiveNodes();
    expect(active.length).toBeLessThanOrEqual(300);
  });
});

// ════════════════════════════════════════════════════════════
// 边界条件
// ════════════════════════════════════════════════════════════

describe('ThoughtGraph 边界条件', () => {
  let graph: ThoughtGraph;

  beforeEach(() => {
    graph = new ThoughtGraph();
  });

  it('空图谱的摘要不报错', () => {
    const summary = graph.getGraphSummary();
    expect(summary.topWishes).toHaveLength(0);
    expect(summary.activeDissonances).toHaveLength(0);
    expect(summary.dominantThoughtType).toBeNull();
  });

  it('recall 不存在的节点返回 null', () => {
    expect(graph.recall('nonexistent')).toBeNull();
  });

  it('weaken 不存在的节点不报错', () => {
    expect(() => graph.weaken('nonexistent', 0.5)).not.toThrow();
  });

  it('link 不存在的节点不报错', () => {
    expect(() => graph.link('a', 'b')).not.toThrow();
  });

  it('空图谱 reset 正常', () => {
    graph.reset();
    expect(graph.getActiveNodes()).toHaveLength(0);
  });

  it('大量节点衰减后的性能', () => {
    const seed: ThoughtSeed = { type: 'reflection', confidence: 0.5, emotionalWeight: 0.5, decayRate: 0.01, direction: '反思' };
    for (let i = 0; i < 100; i++) {
      graph.addThought(seed, `反思 ${i}`, mockEmotionState());
    }
    graph.decay(7);
    // 衰减后应该仍有活跃节点（decayRate 很低）
    expect(graph.getActiveNodes().length).toBeGreaterThan(0);
    // 但 emotionalWeight 应该降低
    for (const n of graph.getActiveNodes()) {
      expect(n.emotionalWeight).toBeLessThanOrEqual(0.5);
    }
  });
});
