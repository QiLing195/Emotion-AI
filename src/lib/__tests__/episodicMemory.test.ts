// ── episodicMemory 测试 ──

import { describe, it, expect } from 'vitest';
import {
  createEpisodicMemoryStore,
  tryFormEpisode,
  recallRelevantMemories,
  getSignificantEpisodes,
  decideProactiveRecall,
  generateIdentitySummary,
  serializeEpisodicStore,
  deserializeEpisodicStore,
} from '../episodicMemory';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';

function makeEmotionState(valence: number, dominant: string) {
  const state = structuredClone(INITIAL_EMOTION_STATE);
  state.taiji.valence = valence;
  state.taiji.arousal = 0.5;
  // 设置实际情绪值，确保主导情绪匹配
  for (const k of Object.keys(state.emotions)) {
    state.emotions[k] = 0;
  }
  state.emotions[dominant] = 0.7;
  state.emotions.calm = 0.1;
  return state;
}

describe('createEpisodicMemoryStore', () => {
  it('创建空存储', () => {
    const store = createEpisodicMemoryStore();
    expect(store.episodes).toEqual([]);
    expect(store.roundCounter).toBe(0);
  });
});

describe('tryFormEpisode', () => {
  it('显著情感变化形成情景记忆', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = makeEmotionState(0.3, 'joy');
    es.taiji.valence = 0.6;

    const formed = tryFormEpisode(store, es, '今天太开心了！谢谢你', '最近聊了很多');

    expect(formed).not.toBeNull();
    expect(store.episodes.length).toBe(1);
    expect(store.episodes[0].tags).toContain('温暖');
    expect(store.roundCounter).toBe(1);
  });

  it('无显著变化不形成记忆', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.2;

    // 初始状态 (valence=0.2) — 无大变化
    const es = structuredClone(INITIAL_EMOTION_STATE);
    es.taiji.valence = 0.25;

    const formed = tryFormEpisode(store, es, '嗯', '');
    expect(formed).toBeNull();
    expect(store.episodes.length).toBe(0);
  });

  it('多轮互动形成多条记忆', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    // 每次需要 > 0.35 的 valence 跳变才能形成记忆
    const valences = [-0.6, 0.4, -0.5]; // 大幅波动确保触发
    const emotions = ['sad', 'joy', 'sad'];
    for (let i = 0; i < 3; i++) {
      const es = makeEmotionState(valences[i], emotions[i]);
      tryFormEpisode(store, es, `重要事件 ${i}`, '聊天');
    }

    expect(store.episodes.length).toBe(3);
    expect(store.roundCounter).toBe(3);
  });
});

describe('recallRelevantMemories', () => {
  it('空存储返回空', () => {
    const store = createEpisodicMemoryStore();
    const result = recallRelevantMemories(store, { name: 'joy', intensity: 0.5 });
    expect(result).toEqual([]);
  });

  it('情感一致记忆加权更高', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    // 形成一条 love 标签的记忆
    const es = makeEmotionState(0.3, 'love');
    es.taiji.valence = 0.6;
    store.prevDominantEmotion = 'love';
    tryFormEpisode(store, es, '我爱你', '');

    // 用 love 情绪召回 — 应该能找回
    const result = recallRelevantMemories(store, { name: 'love', intensity: 0.6 });
    expect(result.length).toBeGreaterThan(0);
  });

  it('限制返回数量', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    for (let i = 0; i < 5; i++) {
      const es = makeEmotionState(0.3, 'joy');
      es.taiji.valence = 0.5 + i * 0.05;
      tryFormEpisode(store, es, `记忆 ${i}`, '');
    }

    const result = recallRelevantMemories(store, { name: 'joy', intensity: 0.3 }, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('getSignificantEpisodes', () => {
  it('返回加权最高记忆', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    for (let i = 0; i < 3; i++) {
      const es = makeEmotionState(0.3, 'joy');
      es.taiji.valence = 0.5 + i * 0.1;
      tryFormEpisode(store, es, `重要记忆 ${i}`, '');
    }

    const sig = getSignificantEpisodes(store, 2);
    expect(sig.length).toBeLessThanOrEqual(2);
    expect(sig[0].recallWeight).toBeGreaterThanOrEqual(sig[1]?.recallWeight ?? 0);
  });
});

describe('decideProactiveRecall', () => {
  it('无可召回记忆时返回 null', () => {
    const store = createEpisodicMemoryStore();
    const result = decideProactiveRecall(store, { name: 'joy', intensity: 0.5 }, 'empathize', true);
    expect(result.memory).toBeNull();
    expect(result.approach).toBeNull();
  });
});

describe('serializeEpisodicStore', () => {
  it('往返后数据一致', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    const es = makeEmotionState(0.3, 'love');
    es.taiji.valence = 0.7;
    tryFormEpisode(store, es, '一段温暖的回忆', '聊天上下文');

    const serialized = serializeEpisodicStore(store);
    const restored = deserializeEpisodicStore(serialized);

    expect(restored.episodes.length).toBe(store.episodes.length);
    expect(restored.roundCounter).toBe(store.roundCounter);
    expect(restored.episodes[0].narrativeFragment).toBe(store.episodes[0].narrativeFragment);
  });

  it('空存储序列化后再恢复', () => {
    const store = createEpisodicMemoryStore();
    const serialized = serializeEpisodicStore(store);
    const restored = deserializeEpisodicStore(serialized);
    expect(restored.episodes).toEqual([]);
  });
});

describe('generateIdentitySummary', () => {
  it('空存储返回默认叙事', () => {
    const store = createEpisodicMemoryStore();
    const summary = generateIdentitySummary(store, {
      empathy: 50, trust: 50, openness: 50, playfulness: 50, resilience: 0.5, sensitivity: 0.5,
    }, 0);
    expect(summary).toContain('刚刚开始');
  });

  it('有记忆时包含叙事片段', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    const es = makeEmotionState(0.3, 'love');
    es.taiji.valence = 0.8;
    tryFormEpisode(store, es, '那天你说你永远不会离开', '');

    const summary = generateIdentitySummary(store, {
      empathy: 70, trust: 80, openness: 60, playfulness: 50, resilience: 0.5, sensitivity: 0.3,
    }, 50);
    expect(summary.length).toBeGreaterThan(10);
    expect(summary).toContain('次互动');
  });
});

// ── v6.1: 向量嵌入增强召回 ──
describe('recallRelevantMemories with embedding', () => {
  it('语义匹配嵌入提升召回评分', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    const es = makeEmotionState(0.3, 'joy');
    es.taiji.valence = 0.7;
    tryFormEpisode(store, es, '关于夏天的蝉鸣和西瓜', '');
    // 手动注入嵌入向量
    store.episodes[0].embedding = [0.1, 0.2, 0.3];

    // 完全匹配的查询嵌入
    const result = recallRelevantMemories(
      store, { name: 'joy', intensity: 0.5 }, 3,
      [0.1, 0.2, 0.3], // 高相似度
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it('无嵌入时回退到纯规则评分', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    const es = makeEmotionState(0.3, 'love');
    es.taiji.valence = 0.7;
    tryFormEpisode(store, es, '你温柔的笑了', '');

    // 不传 queryEmbedding — 无嵌入时正常工作
    const result = recallRelevantMemories(store, { name: 'love', intensity: 0.5 }, 3);
    expect(result.length).toBeGreaterThan(0);
  });

  it('维度不匹配时安全回退', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;

    const es = makeEmotionState(0.3, 'joy');
    es.taiji.valence = 0.7;
    tryFormEpisode(store, es, '维度测试', '');
    store.episodes[0].embedding = [0.1, 0.2, 0.3];

    // 不同维度 — 应回退到规则分，不抛异常
    const result = recallRelevantMemories(
      store, { name: 'joy', intensity: 0.5 }, 3,
      [0.1, 0.2], // 维度不匹配
    );
    expect(result.length).toBeGreaterThan(0); // 仍应返回结果（规则分）
  });
});
