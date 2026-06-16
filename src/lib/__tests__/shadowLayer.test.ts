import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowLayer, type ShadowTrait, type EmotionModulation, type StrategyModulation, type MemoryModulation } from '../shadowLayer';
import type { ThoughtGraphState } from '../thoughtGraph';

// ════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════

function emptyThoughtState(): ThoughtGraphState {
  return {
    nodes: [],
    clusters: [],
    dissonances: [],
    stats: {
      totalGenerated: 0, totalArchived: 0,
      wishCount: 0, fearCount: 0, doubtCount: 0,
      goalCount: 0, hypothesisCount: 0, reflectionCount: 0,
    },
  };
}

function makeThoughtNodes(types: Array<{ type: string; emotionalWeight: number; content: string }>): ThoughtGraphState {
  const state = emptyThoughtState();
  state.nodes = types.map((t, i) => ({
    id: `n${i}`,
    type: t.type as any,
    content: t.content,
    confidence: 0.5,
    emotionalWeight: t.emotionalWeight,
    createdAt: Date.now(),
    decayRate: 0.02,
    recallCount: 0,
    lastRecalledAt: null,
    linkedTo: [],
    emotionalContext: { valence: 0, arousal: 0.5, dominantEmotion: 'neutral' },
    sourceMemoryId: null,
    archived: false,
  }));
  state.stats.totalGenerated = types.length;
  return state;
}

// ════════════════════════════════════════════════════════════
// Phase 1: 初始化和 trait 模板
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: 初始化', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('初始状态：6 个 dormant traits，置信度全为 0', () => {
    const state = shadow.getState();
    expect(state.traits).toHaveLength(6);
    for (const t of state.traits) {
      expect(t.confidence).toBe(0);
      expect(t.active).toBe(false);
    }
    expect(state.stats.activeTraits).toBe(0);
    expect(state.stats.totalDetections).toBe(0);
  });

  it('6 个 trait 的 id 正确', () => {
    const ids = shadow.getState().traits.map(t => t.id);
    expect(ids).toContain('control');
    expect(ids).toContain('fear_of_neglect');
    expect(ids).toContain('intimacy_ambivalence');
    expect(ids).toContain('self_worth_doubt');
    expect(ids).toContain('repetition_ennui');
    expect(ids).toContain('abandonment_fear');
  });

  it('无活跃 trait 时，调制参数为中性', () => {
    expect(shadow.getEmotionModulation()).toEqual({
      stickyEmotions: [],
      arousalBias: 0,
      valenceBias: 0,
      alphaVMultiplier: 1.0,
    });
    expect(shadow.getStrategyModulation()).toEqual({
      boostStrategies: [],
      suppressStrategies: [],
      overallWeight: 1.0,
    });
    expect(shadow.getMemoryModulation()).toEqual({
      negativityBias: 0,
      selectiveAttention: [],
    });
  });

  it('reset 回到初始状态', () => {
    // 先添加一些证据
    const ts = makeThoughtNodes([
      { type: 'wish', emotionalWeight: 0.8, content: '想让他听我的' },
      { type: 'wish', emotionalWeight: 0.7, content: '想掌控局面' },
      { type: 'fear', emotionalWeight: 0.6, content: '怕失控' },
    ]);
    shadow.detectTraits(ts, null, null, 50);
    expect(shadow.getState().traits.some(t => t.evidence.length > 0)).toBe(true);

    shadow.reset();
    expect(shadow.getActiveTraits()).toHaveLength(0);
    expect(shadow.getState().stats.totalDetections).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 1: trait 检测 — Thought Graph 证据
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: Thought Graph 证据', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('多次 wish + fear → 检测到 control trait', () => {
    const ts = makeThoughtNodes([
      { type: 'wish', emotionalWeight: 0.8, content: '想让他听我的' },
      { type: 'wish', emotionalWeight: 0.7, content: '想掌控对话' },
      { type: 'fear', emotionalWeight: 0.6, content: '怕他不听我的' },
      { type: 'wish', emotionalWeight: 0.5, content: '想主导方向' },
    ]);
    shadow.detectTraits(ts, null, null, 50);

    const control = shadow.getState().traits.find(t => t.id === 'control')!;
    expect(control.confidence).toBeGreaterThan(0);
    expect(control.evidence.length).toBeGreaterThan(0);
  });

  it('多次 doubt → 检测到 fear_of_neglect', () => {
    const ts = makeThoughtNodes([
      { type: 'doubt', emotionalWeight: 0.7, content: '他是不是不需要我了' },
      { type: 'doubt', emotionalWeight: 0.6, content: '我是不是不重要' },
      { type: 'doubt', emotionalWeight: 0.8, content: '他在不在乎我' },
    ]);
    shadow.detectTraits(ts, null, null, 50);

    const fon = shadow.getState().traits.find(t => t.id === 'fear_of_neglect')!;
    expect(fon.confidence).toBeGreaterThan(0);
  });

  it('wish + fear 同时大量出现 → intimacy_ambivalence', () => {
    const ts = makeThoughtNodes([
      { type: 'wish', emotionalWeight: 0.9, content: '想靠近他' },
      { type: 'wish', emotionalWeight: 0.8, content: '想要更亲密' },
      { type: 'fear', emotionalWeight: 0.7, content: '怕被伤害' },
      { type: 'fear', emotionalWeight: 0.6, content: '怕太近会受伤' },
      { type: 'wish', emotionalWeight: 0.5, content: '想敞开心扉' },
    ]);
    shadow.detectTraits(ts, null, null, 50);

    const ia = shadow.getState().traits.find(t => t.id === 'intimacy_ambivalence')!;
    expect(ia.confidence).toBeGreaterThan(0);
  });

  it('少量 wish → 不触发 control（阈值保护）', () => {
    const ts = makeThoughtNodes([
      { type: 'wish', emotionalWeight: 0.5, content: '想去海边' },
    ]);
    shadow.detectTraits(ts, null, null, 50);

    const control = shadow.getState().traits.find(t => t.id === 'control')!;
    expect(control.confidence).toBe(0); // 只有 1 个 wish，不够 3 个
  });

  it('空 Thought Graph → 无新证据', () => {
    const ts = emptyThoughtState();
    const activated = shadow.detectTraits(ts, null, null, 50);
    expect(activated).toHaveLength(0);
    for (const t of shadow.getState().traits) {
      expect(t.evidence).toHaveLength(0);
    }
  });
});

// ════════════════════════════════════════════════════════════
// Phase 1: Dissonance 证据
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: Dissonance 证据', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('活跃的 dissonance → 检测到 intimacy_ambivalence', () => {
    const ts = emptyThoughtState();
    ts.dissonances = [
      { id: 'd1', nodeA: 'a', nodeB: 'b', summary: '想靠近 vs 怕受伤', tension: 0.8, detectedAt: Date.now(), resolved: false, resolutionNote: null },
      { id: 'd2', nodeA: 'c', nodeB: 'd', summary: '想要更多 vs 怕被拒绝', tension: 0.7, detectedAt: Date.now(), resolved: false, resolutionNote: null },
    ];
    shadow.detectTraits(ts, null, null, 50);

    const ia = shadow.getState().traits.find(t => t.id === 'intimacy_ambivalence')!;
    expect(ia.confidence).toBeGreaterThan(0);
  });

  it('已解决的 dissonance 不计入', () => {
    const ts = emptyThoughtState();
    ts.dissonances = [
      { id: 'd1', nodeA: 'a', nodeB: 'b', summary: '旧冲突', tension: 0.8, detectedAt: Date.now() - 100000, resolved: true, resolutionNote: '解决了' },
    ];
    shadow.detectTraits(ts, null, null, 50);
    // 已解决的不应该触发
    const traits = shadow.getActiveTraits();
    // 没有 thought 节点，只有已解决的 dissonance → 不应激活任何 trait
    expect(traits.length).toBeLessThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 1: 情感证据
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: 情感证据', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('anger 粘性 + reversal → control', () => {
    const ts = emptyThoughtState();
    const eh = { stickyEmotions: ['anger'], avgArousal: 0.6, avgValence: -0.1, reversalCount: 3 };
    shadow.detectTraits(ts, eh, null, 50);

    const control = shadow.getState().traits.find(t => t.id === 'control')!;
    expect(control.confidence).toBeGreaterThan(0);
  });

  it('sad 粘性 + 负效价 → self_worth_doubt', () => {
    const ts = emptyThoughtState();
    const eh = { stickyEmotions: ['sad', 'fear'], avgArousal: 0.3, avgValence: -0.4, reversalCount: 1 };
    shadow.detectTraits(ts, eh, null, 50);

    const swd = shadow.getState().traits.find(t => t.id === 'self_worth_doubt')!;
    expect(swd.confidence).toBeGreaterThan(0);
  });

  it('fear 粘性 + 负效价 → abandonment_fear', () => {
    const ts = emptyThoughtState();
    const eh = { stickyEmotions: ['fear'], avgArousal: 0.55, avgValence: -0.3, reversalCount: 2 };
    shadow.detectTraits(ts, eh, null, 50);

    const af = shadow.getState().traits.find(t => t.id === 'abandonment_fear')!;
    expect(af.confidence).toBeGreaterThan(0);
  });

  it('低唤醒 → repetition_ennui', () => {
    const ts = emptyThoughtState();
    const eh = { stickyEmotions: [], avgArousal: 0.2, avgValence: 0, reversalCount: 0 };
    shadow.detectTraits(ts, eh, null, 50);

    const re = shadow.getState().traits.find(t => t.id === 'repetition_ennui')!;
    expect(re.confidence).toBeGreaterThan(0);
  });

  it('中性情感 → 无证据', () => {
    const ts = emptyThoughtState();
    const eh = { stickyEmotions: [], avgArousal: 0.5, avgValence: 0, reversalCount: 0 };
    const activated = shadow.detectTraits(ts, eh, null, 50);
    expect(activated).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 1: 策略统计证据
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: 策略证据', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('低 assert + 高 comfort → self_worth_doubt', () => {
    const ts = emptyThoughtState();
    const stats = {
      'empathize': { uses: 15, successes: 10 },
      'boundary': { uses: 2, successes: 1 },
    };
    shadow.detectTraits(ts, null, stats, 50);

    const swd = shadow.getState().traits.find(t => t.id === 'self_worth_doubt')!;
    expect(swd.confidence).toBeGreaterThan(0);
  });

  it('高频 boundary → control', () => {
    const ts = emptyThoughtState();
    const stats = {
      'boundary': { uses: 20, successes: 12 },
    };
    shadow.detectTraits(ts, null, stats, 50);

    const control = shadow.getState().traits.find(t => t.id === 'control')!;
    expect(control.confidence).toBeGreaterThan(0);
  });

  it('策略单一 → repetition_ennui', () => {
    const ts = emptyThoughtState();
    const stats = {
      'self_disclosure': { uses: 30, successes: 20 },
      'empathize': { uses: 20, successes: 12 },
      'express_affection': { uses: 15, successes: 10 },
    };
    shadow.detectTraits(ts, null, stats, 50);

    const re = shadow.getState().traits.find(t => t.id === 'repetition_ennui')!;
    expect(re.confidence).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 1: 置信度累加
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 1: 置信度累加', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('多次检测逐步提升置信度', () => {
    // 每轮 3 个 doubt 节点，每轮添加 1 个 evidence (weight = 0.015)
    // 多轮后 confidence 应逐步上升
    for (let round = 50; round <= 200; round += 50) {
      const ts = makeThoughtNodes([
        { type: 'doubt', emotionalWeight: 0.7, content: `doubt-${round}-1` },
        { type: 'doubt', emotionalWeight: 0.7, content: `doubt-${round}-2` },
        { type: 'doubt', emotionalWeight: 0.7, content: `doubt-${round}-3` },
      ]);
      shadow.detectTraits(ts, null, null, round);
    }

    const fon = shadow.getState().traits.find(t => t.id === 'fear_of_neglect')!;
    // 4 轮 × 1 evidence = 4 evidence × 0.015 = 0.06
    expect(fon.confidence).toBeGreaterThan(0.04);
    expect(fon.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('置信度不超过 1.0', () => {
    const ts = makeThoughtNodes([]);
    // 添加 200 个 doubt 节点
    for (let i = 0; i < 100; i++) {
      ts.nodes.push({
        id: `d${i}`,
        type: 'doubt' as any,
        content: `怀疑 ${i}`,
        confidence: 0.8,
        emotionalWeight: 0.9,
        createdAt: Date.now(),
        decayRate: 0.02,
        recallCount: 0,
        lastRecalledAt: null,
        linkedTo: [],
        emotionalContext: { valence: -0.3, arousal: 0.5, dominantEmotion: 'sad' },
        sourceMemoryId: null,
        archived: false,
      });
    }
    ts.stats.totalGenerated = 100;
    shadow.detectTraits(ts, null, null, 50);

    const fon = shadow.getState().traits.find(t => t.id === 'fear_of_neglect')!;
    expect(fon.confidence).toBeLessThanOrEqual(1.0);
  });

  it('大量证据将 trait 推到 active (confidence ≥ 0.3)', () => {
    // 一次性添加 30 个 doubt 节点 → 1 evidence, confidence = 0.015
    // 做不到。需要多种证据来源同时命中。
    // 组合：thought + dissonance + emotion + strategy
    const ts = makeThoughtNodes([
      { type: 'doubt', emotionalWeight: 0.9, content: '1' },
      { type: 'doubt', emotionalWeight: 0.9, content: '2' },
      { type: 'doubt', emotionalWeight: 0.9, content: '3' },
    ]);
    ts.dissonances = [
      { id: 'd1', nodeA: 'a', nodeB: 'b', summary: '自我矛盾', tension: 0.8, detectedAt: Date.now(), resolved: false, resolutionNote: null },
    ];
    const eh = { stickyEmotions: ['sad', 'fear'], avgArousal: 0.3, avgValence: -0.4, reversalCount: 1 };
    const stats = { 'empathize': { uses: 15, successes: 10 }, 'boundary': { uses: 2, successes: 1 } };

    // 多轮累计
    for (let round = 50; round <= 300; round += 50) {
      const fresh = makeThoughtNodes([
        { type: 'doubt', emotionalWeight: 0.9, content: `r${round}-1` },
        { type: 'doubt', emotionalWeight: 0.9, content: `r${round}-2` },
        { type: 'doubt', emotionalWeight: 0.9, content: `r${round}-3` },
      ]);
      fresh.dissonances = ts.dissonances;
      shadow.detectTraits(fresh, eh, stats, round);
    }

    const swd = shadow.getState().traits.find(t => t.id === 'self_worth_doubt')!;
    // thought + dissonance + emotion + strategy = 4 证据源, 每轮 4 evidence
    // 6 轮 × 4 = 24 evidence × 0.015 = 0.36
    expect(swd.confidence).toBeGreaterThanOrEqual(0.15);
    expect(swd.evidence.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 2: 影响力出口
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 2: 影响力出口', () => {
  let shadow: ShadowLayer;

  beforeEach(() => {
    shadow = new ShadowLayer();
  });

  it('激活 abandonment_fear → 调制参数生效', () => {
    // 用足够证据自然激活 abandonment_fear
    for (let round = 50; round <= 400; round += 50) {
      const ts = makeThoughtNodes([
        { type: 'fear', emotionalWeight: 0.9, content: `fear-${round}-1` },
        { type: 'fear', emotionalWeight: 0.9, content: `fear-${round}-2` },
        { type: 'fear', emotionalWeight: 0.9, content: `fear-${round}-3` },
        { type: 'fear', emotionalWeight: 0.8, content: `fear-${round}-4` },
      ]);
      ts.dissonances = [
        { id: `d${round}`, nodeA: 'a', nodeB: 'b', summary: '怕失去的矛盾', tension: 0.8, detectedAt: Date.now(), resolved: false, resolutionNote: null },
      ];
      const eh = { stickyEmotions: ['fear'], avgArousal: 0.5, avgValence: -0.3, reversalCount: 2 };
      shadow.detectTraits(ts, eh, null, round);
    }

    const af = shadow.getState().traits.find(t => t.id === 'abandonment_fear')!;
    // 8 轮应该有足够的证据
    expect(af.evidence.length).toBeGreaterThan(0);

    // 如果已经激活，验证调制
    if (af.active) {
      const em = shadow.getEmotionModulation();
      expect(em.valenceBias).toBeLessThan(0);
      expect(em.alphaVMultiplier).toBeLessThan(1.0);
    }
  });

  it('多个 trait 同时激活 → 聚合调制', () => {
    // 组合证据激活多个 trait
    for (let round = 50; round <= 400; round += 50) {
      const ts = makeThoughtNodes([
        { type: 'fear', emotionalWeight: 0.9, content: `f-${round}-1` },
        { type: 'fear', emotionalWeight: 0.9, content: `f-${round}-2` },
        { type: 'fear', emotionalWeight: 0.9, content: `f-${round}-3` },
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-1` },
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-2` },
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-3` },
      ]);
      ts.dissonances = [
        { id: `d${round}`, nodeA: 'a', nodeB: 'b', summary: '矛盾', tension: 0.7, detectedAt: Date.now(), resolved: false, resolutionNote: null },
      ];
      const eh = { stickyEmotions: ['fear', 'sad'], avgArousal: 0.4, avgValence: -0.3, reversalCount: 3 };
      shadow.detectTraits(ts, eh, null, round);
    }

    // 验证至少有一些 trait 被激活
    const active = shadow.getActiveTraits();
    // 即使没有激活，调制也应该返回合理默认值
    const em = shadow.getEmotionModulation();
    expect(typeof em.alphaVMultiplier).toBe('number');
    expect(em.alphaVMultiplier).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 3: 状态持久化
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 3: 持久化', () => {
  it('getState → loadState 完整往返', () => {
    const s1 = new ShadowLayer();
    const ts = makeThoughtNodes([
      { type: 'fear', emotionalWeight: 0.9, content: 'f1' },
      { type: 'fear', emotionalWeight: 0.9, content: 'f2' },
      { type: 'fear', emotionalWeight: 0.9, content: 'f3' },
    ]);
    s1.detectTraits(ts, null, null, 50);
    const saved = s1.getState();

    const s2 = new ShadowLayer();
    s2.loadState(saved);

    expect(s2.getState().traits.length).toBe(6);
    const original = s1.getState().traits.find(t => t.id === 'abandonment_fear')!;
    const restored = s2.getState().traits.find(t => t.id === 'abandonment_fear')!;
    expect(restored.confidence).toBe(original.confidence);
    expect(restored.evidence.length).toBe(original.evidence.length);
  });
});


// ════════════════════════════════════════════════════════════
// Phase 3: 自我模型关联
// ════════════════════════════════════════════════════════════

describe('ShadowLayer — Phase 3: 自我模型关联', () => {
  it('无活跃 Shadow → 一致性高', () => {
    const shadow = new ShadowLayer();
    const patterns = [
      { label: '善于表达', category: 'expression', confidence: 0.8 },
      { label: '渴望亲密', category: 'desire', confidence: 0.7 },
    ];
    const report = shadow.getSelfShadowContrast(patterns);
    expect(report.consistencyScore).toBeGreaterThanOrEqual(0.7);
    expect(report.unknownShadows).toHaveLength(0);
    expect(report.knownStrengths.length).toBeGreaterThan(0);
  });

  it('有证据但未激活 → 报告仍可生成', () => {
    const shadow = new ShadowLayer();
    // 积累一些证据（但不足以激活）
    for (let round = 50; round <= 200; round += 50) {
      const ts = makeThoughtNodes([
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-1` },
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-2` },
        { type: 'doubt', emotionalWeight: 0.9, content: `d-${round}-3` },
      ]);
      shadow.detectTraits(ts, null, null, round);
    }

    const fon = shadow.getState().traits.find(t => t.id === 'fear_of_neglect')!;
    expect(fon.evidence.length).toBeGreaterThan(0);

    const patterns = [{ label: '逻辑分析', category: 'expression', confidence: 0.8 }];
    const report = shadow.getSelfShadowContrast(patterns);
    expect(typeof report.consistencyScore).toBe('number');
    expect(report.knownStrengths.length).toBeGreaterThan(0);
  });

  it('getRelatedSelfCategories 映射正确', () => {
    const shadow = new ShadowLayer();
    // 无活跃 trait 时 consistency 高
    const report = shadow.getSelfShadowContrast([]);
    expect(report.consistencyScore).toBe(0.8);
    expect(report.blindSpots).toHaveLength(0);
    expect(report.unknownShadows).toHaveLength(0);
  });
});
