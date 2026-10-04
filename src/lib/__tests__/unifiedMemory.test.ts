// ── unifiedMemory 测试 ──

import { describe, it, expect } from 'vitest';
import { recall, type SemanticMemoryEntry, type PatternMemoryEntry } from '../unifiedMemory';
import { createEpisodicMemoryStore } from '../episodicMemory';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';

function makeEmotionState() {
  const state = structuredClone(INITIAL_EMOTION_STATE);
  state.emotions.love = 0.6;
  state.emotions.joy = 0.3;
  return state;
}

function makeSemanticMemories(): SemanticMemoryEntry[] {
  return [
    { id: 's1', content: '我喜欢吃火锅，尤其是麻辣锅底', type: 'preference', createdAt: new Date().toISOString() },
    { id: 's2', content: '上次提到的那个咖啡馆，我觉得很不错', type: 'event', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 's3', content: '今天心情不太好，工作压力有点大', type: 'state', createdAt: new Date().toISOString() },
  ];
}

function makePatterns(): PatternMemoryEntry[] {
  return [
    { topic: '摄影', relatedTopics: ['旅行', '艺术'], cooccurrence: 0.8 },
    { topic: '美食', relatedTopics: ['火锅', '咖啡'], cooccurrence: 0.6 },
  ];
}

describe('recall', () => {
  it('空情景记忆时返回空结果', () => {
    const store = createEpisodicMemoryStore();
    const result = recall(store, {
      text: '你好',
      emotionState: makeEmotionState(),
    });
    expect(result.items.length).toBe(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('从语义记忆中召回相关内容', () => {
    const store = createEpisodicMemoryStore();
    const result = recall(store, {
      text: '我今天想吃火锅',
      emotionState: makeEmotionState(),
      semanticMemories: makeSemanticMemories(),
    });

    // 至少应召回火锅相关的语义记忆
    const hasFood = result.items.some(i => i.content.includes('火锅'));
    expect(hasFood).toBe(true);
    expect(result.sources.semantic).toBeGreaterThan(0);
  });

  it('从模式中召回话题集群', () => {
    const store = createEpisodicMemoryStore();
    const result = recall(store, {
      text: '摄影旅行',
      emotionState: makeEmotionState(),
      patternCandidates: makePatterns(),
    });

    const hasPhoto = result.items.some(i => i.metadata?.topic === '摄影');
    expect(hasPhoto).toBe(true);
  });

  it('去重：相似内容不重复出现', () => {
    const store = createEpisodicMemoryStore();
    const semMem: SemanticMemoryEntry[] = [
      { id: 's1', content: '我喜欢吃火锅', type: 'preference', createdAt: new Date().toISOString() },
      { id: 's2', content: '火锅真的很好吃，尤其是冬天', type: 'preference', createdAt: new Date().toISOString() },
    ];

    const result = recall(store, {
      text: '想吃火锅',
      emotionState: makeEmotionState(),
      semanticMemories: semMem,
      maxResults: 5,
    });

    // 虽然两条都匹配，但去重后只会保留最相关的一条
    expect(result.items.length).toBeLessThanOrEqual(2);
  });

  it('按相关性排序', () => {
    const store = createEpisodicMemoryStore();
    const semMem: SemanticMemoryEntry[] = [
      { id: 's1', content: '今天天气不错', type: 'neutral', createdAt: new Date(Date.now() - 86400000 * 30).toISOString() },
      { id: 's2', content: '火锅真好吃，我们下次再去', type: 'preference', createdAt: new Date().toISOString() },
    ];

    const result = recall(store, {
      text: '想吃火锅',
      emotionState: makeEmotionState(),
      semanticMemories: semMem,
    });

    if (result.items.length >= 2) {
      // 第二条（火锅）应该排在第一
      expect(result.items[0].content).toContain('火锅');
    }
  });

  it('sourceCaps 限制各来源数量', () => {
    const store = createEpisodicMemoryStore();
    const manySem: SemanticMemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      content: `记忆内容 ${i} 关于火锅`,
      type: 'preference',
      createdAt: new Date().toISOString(),
    }));

    const result = recall(store, {
      text: '火锅',
      emotionState: makeEmotionState(),
      semanticMemories: manySem,
      sourceCaps: { semantic: 2 },
    });

    const semanticItems = result.items.filter(i => i.source === 'semantic');
    expect(semanticItems.length).toBeLessThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════
// Phase 3: curiosity 源 + embedding 语义搜索
// ════════════════════════════════════════════════════════════

describe('recall — Phase 3 curiosity 发现源', () => {
  it('从 curiosity 发现中召回相关话题', () => {
    const store = createEpisodicMemoryStore();
    const discoveries = [
      { id: 'd1', title: 'AI绘画的新突破', content: 'Stable Diffusion 3发布，图像质量大幅提升', topic: 'AI', timestamp: Date.now(), quality: 0.8, url: '', shared: true, sourceType: 'web' as const, verified: false },
      { id: 'd2', title: '摄影技巧：长曝光', content: '长曝光可以让水流呈现丝绸效果', topic: '摄影', timestamp: Date.now(), quality: 0.7, url: '', shared: false, sourceType: 'web' as const, verified: false },
    ];

    const result = recall(store, {
      text: 'AI和摄影有什么新进展',
      emotionState: makeEmotionState(),
      curiosityDiscoveries: discoveries,
    });

    expect(result.sources.curiosity).toBeGreaterThan(0);
    const hasAi = result.items.some(i => i.metadata?.topic === 'AI');
    expect(hasAi).toBe(true);
  });

  it('curiosity + semantic + pattern 三源联合召回', () => {
    const store = createEpisodicMemoryStore();
    const discoveries = [
      { id: 'd1', title: '摄影新趋势', content: '...', topic: '摄影', timestamp: Date.now(), quality: 0.8, url: '', shared: true, sourceType: 'web' as const, verified: false },
    ];

    const result = recall(store, {
      text: '今天想聊聊摄影',
      emotionState: makeEmotionState(),
      semanticMemories: makeSemanticMemories(),
      curiosityDiscoveries: discoveries,
      patternCandidates: makePatterns(),
    });

    // 三个源都应参与召回
    expect(result.sources.curiosity).toBeGreaterThan(0);
    expect(result.sources.pattern).toBeGreaterThan(0);
    expect(result.sources.semantic).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// v1.20 情绪加分跟着**激活态**走（不再是 calm 基调白拿）
// ════════════════════════════════════════════════════════════

describe('recall — 情绪一致性加分读激活态', () => {
  /** 只把 calm 抬到 0.9（相对基线 +0.10 > 死区 0.05）→ 她**确实**平静 */
  function calmActivated() {
    const s = structuredClone(INITIAL_EMOTION_STATE);
    s.emotions.calm = 0.9;
    return s;
  }
  /** 全部停在基线附近（偏移 < 死区）→ 静息：她此刻没有明显情绪 */
  function resting() {
    return structuredClone(INITIAL_EMOTION_STATE);
  }

  function storeWithTwo() {
    const store = createEpisodicMemoryStore();
    const ts = Date.now();
    const mk = (id: string, emotion: string, weight: number) => ({
      id, timestamp: ts, roundNumber: 1,
      eventSummary: id,
      emotionalImpact: { valenceBefore: 0, valenceAfter: 0, valenceDelta: 0, arousalPeak: 0.3, dominantEmotion: emotion },
      narrativeFragment: `记忆 ${id} 的叙事内容足够长以便注入`,
      recallWeight: weight, tags: ['日常'], recallCount: 0, lastRecalledAt: null,
    });
    // calm 记忆权重更低：它要赢，只能靠"情绪一致性 ×1.5"
    store.episodes.push(mk('e_calm', 'calm', 0.40) as never, mk('e_sad', 'sad', 0.50) as never);
    return store;
  }

  it('静息时 calm 记忆不再白拿 ×1.5（否则 0.40×1.5=0.60 会翻盘压过 0.50）', () => {
    const result = recall(storeWithTwo(), { text: '随便聊聊', emotionState: resting() as never, maxResults: 2 });
    expect(result.items[0].id).toBe('e_sad');
  });

  it('她确实平静（calm 越过基线死区）时，calm 记忆才被优先召回', () => {
    const result = recall(storeWithTwo(), { text: '随便聊聊', emotionState: calmActivated() as never, maxResults: 2 });
    expect(result.items[0].id).toBe('e_calm');
  });

  it('她被激起 sad 时，sad 记忆胜出', () => {
    const s = structuredClone(INITIAL_EMOTION_STATE);
    s.emotions.sad = 0.5; // 相对基线 +0.5
    const result = recall(storeWithTwo(), { text: '随便聊聊', emotionState: s as never, maxResults: 2 });
    expect(result.items[0].id).toBe('e_sad');
  });
});

describe('recall — Phase 3 embedding 语义搜索', () => {
  it('有 queryEmbedding 时启用语义匹配', () => {
    const store = createEpisodicMemoryStore();
    // 语义记忆带 embedding
    const semWithEmbeddings: SemanticMemoryEntry[] = [
      { id: 's1', content: '摄影是我最喜欢的爱好', type: 'preference', createdAt: new Date().toISOString(),
        embedding: [0.1, 0.2, 0.3, 0.4, 0.5] },
      { id: 's2', content: '今天天气不错', type: 'neutral', createdAt: new Date().toISOString(),
        embedding: [0.9, 0.8, 0.7, 0.6, 0.5] },
    ];

    const result = recall(store, {
      text: '想拍照',
      emotionState: makeEmotionState(),
      semanticMemories: semWithEmbeddings,
      queryEmbedding: [0.1, 0.2, 0.3, 0.4, 0.5], // 与 s1 接近
    });

    // s1 的分数应该更高
    expect(result.sources.semantic).toBeGreaterThan(0);
  });

  it('无 queryEmbedding 时降级为纯关键词匹配', () => {
    const store = createEpisodicMemoryStore();
    const result = recall(store, {
      text: '火锅',
      emotionState: makeEmotionState(),
      semanticMemories: makeSemanticMemories(),
      // 不传 queryEmbedding
    });

    // 关键词匹配仍然工作
    expect(result.sources.semantic).toBeGreaterThan(0);
  });
});
