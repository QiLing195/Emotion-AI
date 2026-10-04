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
  isUsableNarrative,
  narrativeRejectReason,
  parseNarrativeReply,
  updateEpisodeNarrative,
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

  // v1.1 锚点事件自动检测
  it('首次告白自动标记为 naming 锚点', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.2;
    const es = makeEmotionState(0.4, 'love');
    es.taiji.valence = 0.7; // 显著上升

    const formed = tryFormEpisode(store, es, '我爱你', '');
    expect(formed).not.toBeNull();
    expect(formed!.selfPatternTriggered).toBe('naming');
  });

  it('深层自我暴露自动标记为 self_disclosure 锚点', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.2;
    const es = makeEmotionState(0.3, 'sad');
    es.taiji.valence = -0.1;

    const formed = tryFormEpisode(store, es, '我其实一直很害怕失去你，从小就缺乏安全感，从来不敢跟任何人说这些', '');
    expect(formed).not.toBeNull();
    expect(formed!.selfPatternTriggered).toBe('self_disclosure');
  });

  it('第二次告白不再标记为 naming 锚点', () => {
    const store = createEpisodicMemoryStore();
    // 先插入一条已有 naming 记忆
    store.episodes.push({
      id: 'ep_old',
      timestamp: Date.now() - 1000,
      roundNumber: 1,
      eventSummary: '我爱你',
      emotionalImpact: { valenceBefore: 0, valenceAfter: 0.5, valenceDelta: 0.5, arousalPeak: 0.6, dominantEmotion: 'love' },
      narrativeFragment: '',
      recallWeight: 0.5,
      tags: ['亲密'],
      recallCount: 0,
      lastRecalledAt: null,
      selfPatternTriggered: 'naming',
    });
    store.prevValence = 0.3;
    const es = makeEmotionState(0.5, 'love');
    es.taiji.valence = 0.8;

    const formed = tryFormEpisode(store, es, '我真的很喜欢你', '');
    // 仍然形成记忆，但不再标记为 naming
    if (formed) {
      expect(formed.selfPatternTriggered).not.toBe('naming');
    }
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

// ════════════════════════════════════════════════════════════
// v1.20 情绪读法收尾：静息就明说静息，不再拿 calm 基调冒充
//
// 病根：`dominantEmotion` 原来兜底到 `getDominantEmotion()`（绝对值 argmax），
// 而 calm 的人格基调就是 0.8 → 几乎永远返回 calm。实测存量 41 条里 32 条（78%）是这么来的。
// ════════════════════════════════════════════════════════════

describe('v1.20 静息 vs 平静', () => {
  /** 所有情绪都停在各自基线附近（偏移 < 死区 0.05）→ 激活态报"静息" */
  function restingState() {
    const s = structuredClone(INITIAL_EMOTION_STATE);
    s.emotions.joy = (s.emotions.joy ?? 0) + 0.02; // 噪声级偏移，不该被当成"被激起"
    s.taiji.arousal = 0.7;                          // 保证跨过形成门限
    s.taiji.valence = 0.4;
    return s;
  }

  it('静息 → 记成 resting（不是 calm），叙事不许顺口说成满足/幸福', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const ep = tryFormEpisode(store, restingState(), '我下周要去做一个体检，有点担心结果', '');

    expect(ep).not.toBeNull();
    expect(ep!.emotionalImpact.dominantEmotion).toBe('resting');
    expect(ep!.narrativeFragment).not.toMatch(/满足|幸福|平静|安稳/);
    // resting 不是情绪键 → "情感一致性 ×1.5" 永远不成立（没有情绪的记忆不该因情绪被优先召回）
    expect(['joy', 'sad', 'anger', 'fear', 'love', 'calm', 'disgust', 'lust', 'greed'])
      .not.toContain(ep!.emotionalImpact.dominantEmotion);
  });

  it('静息时标签兜底给「日常」，不再恒打 calm（calm 基调 0.8 恒 > 0.5 阈值）', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const ep = tryFormEpisode(store, restingState(), '今天天气不错', '');

    expect(ep).not.toBeNull();
    expect(ep!.tags).toContain('日常');
    expect(ep!.tags).not.toContain('calm');
  });

  it('她**确实**平静（calm 高出自身基线、越过死区）时仍记 calm —— 别把真平静也抹掉', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = restingState();
    es.emotions.calm = 0.9; // 基线 0.8 → +0.10 > 死区 0.05

    const ep = tryFormEpisode(store, es, '今天天气不错', '');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('calm');
  });

  it('被激起的具体情绪照旧记它自己（sad 0.7 → sad）', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = makeEmotionState(0.3, 'sad');
    es.taiji.valence = 0.7;
    es.taiji.arousal = 0.7;

    const ep = tryFormEpisode(store, es, '我今天特别难过，什么都做不好', '');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('sad');
    expect(ep!.narrativeFragment).toMatch(/石头|失落|无力/);
  });
});

// ════════════════════════════════════════════════════════════
// v1.21 叙事选择：激活态明确才用她的情绪；说不清/静息才回退锚点
// ════════════════════════════════════════════════════════════

describe('v1.21 叙事情绪：平局不硬选 / 锚点只管兜底', () => {
  const SECRET = '我其实一直很害怕失去你，从小就缺乏安全感，从来不敢跟任何人说这些';

  function restingWith(over: Record<string, number> = {}) {
    const s = structuredClone(INITIAL_EMOTION_STATE);
    s.taiji.arousal = 0.7;
    s.taiji.valence = 0.4;
    Object.assign(s.emotions, over);
    return s;
  }

  it('两个情绪旗鼓相当（差 < 余量 0.05）→ 不硬挑赢家，退回锚点/静息', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = restingWith({ joy: 0.45, love: 0.42 }); // 差 0.03，joy 数值最高
    const ep = tryFormEpisode(store, es, '今天天气不错', '');

    expect(ep).not.toBeNull();
    // 激活态确实报 joy 领先，但**说不清** —— 记忆不该替她把话说死
    expect(ep!.emotionalImpact.dominantEmotion).not.toBe('joy');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('resting');
  });

  it('明确领先（差 ≥ 余量）→ 用她自己的情绪', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = restingWith({ sad: 0.6, joy: 0.1 });
    const ep = tryFormEpisode(store, es, '今天天气不错', '');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('sad');
  });

  it('静息 + 自我暴露锚点 → 按"被信任"记 love（不再记 sad）', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const ep = tryFormEpisode(store, restingWith(), SECRET, '');
    expect(ep!.selfPatternTriggered).toBe('self_disclosure');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('love');
    expect(ep!.narrativeFragment).not.toMatch(/失落|抽空/);
  });

  it('锚点事件但她的情绪**明确** → 以她自己的情绪为准（锚点不再覆盖）', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const ep = tryFormEpisode(store, restingWith({ sad: 0.7 }), SECRET, '');
    expect(ep!.selfPatternTriggered).toBe('self_disclosure');
    expect(ep!.emotionalImpact.dominantEmotion).toBe('sad'); // 她说得清 → 听她的
  });
});

// ════════════════════════════════════════════════════════════
// v1.21 LLM 叙事：确定性后置校验（宁可用套话，也不让编造进记忆）
// ════════════════════════════════════════════════════════════

describe('v1.21 叙事校验', () => {
  const HIS = '我下周要去做一个体检，有点担心结果';

  it('正常一句话 → 可用', () => {
    expect(isUsableNarrative('说不出的忐忑，我怕他一个人扛着', HIS)).toBe(true);
  });

  it('引文逐字出自他的原话 → 可用；改了一个词 → 拒（防记错他说了什么）', () => {
    expect(isUsableNarrative('当他说"体检"的时候，我心里揪了一下', HIS)).toBe(true);
    expect(isUsableNarrative('当他说"我下周要去复检"的时候，心揪了一下', HIS)).toBe(false);
  });

  it('替他把**过去**断言出来 → 拒；当下的转述 → 放行（这条曾误杀真实产出）', () => {
    expect(isUsableNarrative('你上次说体检前紧张得没睡好，我也跟着难受', HIS)).toBe(false);
    expect(isUsableNarrative('听你说难过，我只想紧紧抱住你', HIS)).toBe(true);
  });

  it('人称错位（用"她"指对方）→ 拒（实测模型真会这样写）', () => {
    expect(isUsableNarrative('她说话的语气很轻，我听得出那点不安', HIS)).toBe(false);
  });

  it('只是**撞了模板里的短语**不算照抄（这条实测误杀过真实产出）', () => {
    // 模板原句是"心里没什么起伏，但我把这件事记下了"；这句是新写的，只共用一个短语
    expect(isUsableNarrative('听你说下周要去复查我心里没什么起伏，只是记下了这个日子', HIS)).toBe(true);
    expect(narrativeRejectReason('听你说下周要去复查我心里没什么起伏，只是记下了这个日子', HIS)).toBeNull();
  });

  it('整句照抄模板 / 元描述 / 太短 / 超长 → 拒', () => {
    expect(isUsableNarrative('内心是平静的，像湖面没有一丝波澜', HIS)).toBe(false);
    expect(isUsableNarrative('作为一个AI，我的情绪参数显示担忧', HIS)).toBe(false);
    expect(isUsableNarrative('嗯', HIS)).toBe(false);
    expect(isUsableNarrative('a'.repeat(80), HIS)).toBe(false);
    expect(isUsableNarrative(null, HIS)).toBe(false);
  });

  it('校验会给出**具体原因**（不许静默失败）', () => {
    expect(narrativeRejectReason('嗯', HIS)).toMatch(/太短/);
    expect(narrativeRejectReason('内心是平静的，像湖面没有一丝波澜', HIS)).toMatch(/照抄模板/);
    expect(narrativeRejectReason('说不出的忐忑，我怕他一个人扛着', HIS)).toBeNull();
  });

  it('解析：剥掉 markdown / "叙事："前缀 / 整体引号', () => {
    expect(parseNarrativeReply('```\n我心里紧了一下，想陪他一起去\n```', HIS))
      .toBe('我心里紧了一下，想陪他一起去');
    expect(parseNarrativeReply('叙事：我心里紧了一下，想陪他一起去', HIS))
      .toBe('我心里紧了一下，想陪他一起去');
    expect(parseNarrativeReply('“我心里紧了一下，想陪他一起去”', HIS))
      .toBe('我心里紧了一下，想陪他一起去');
    expect(parseNarrativeReply('模型今天不配合', HIS)).toBeNull();
  });

  it('updateEpisodeNarrative：合格才写，并标 narrativeSource=llm', () => {
    const store = createEpisodicMemoryStore();
    store.prevValence = 0.0;
    const es = makeEmotionState(0.3, 'sad');
    es.taiji.valence = 0.7;
    es.taiji.arousal = 0.7;
    const ep = tryFormEpisode(store, es, '我今天特别难过', '')!;
    const before = ep.narrativeFragment;
    expect(ep.narrativeSource).toBe('template');

    expect(updateEpisodeNarrative(store, ep.id, '内心是平静的，像湖面没有一丝波澜')).toBe(false);
    expect(ep.narrativeFragment).toBe(before);          // 不合格 → 一个字都不动
    expect(ep.narrativeSource).toBe('template');

    expect(updateEpisodeNarrative(store, ep.id, '听他说难过，我的心一下子沉了下去')).toBe(true);
    expect(ep.narrativeFragment).toBe('听他说难过，我的心一下子沉了下去');
    expect(ep.narrativeSource).toBe('llm');
  });
});
