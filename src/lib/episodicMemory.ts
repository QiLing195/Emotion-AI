// ── v1.0 情景记忆系统 ──
// 存储改变情感轨迹的关键时刻，形成持续的身份叙事

import { EmotionState, TaijiState, getDominantEmotion } from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface EmotionalImpact {
  valenceBefore: number;
  valenceAfter: number;
  valenceDelta: number;
  arousalPeak: number;
  dominantEmotion: string;
}

export interface EpisodicMemory {
  id: string;
  timestamp: number;
  roundNumber: number;
  eventSummary: string;
  emotionalImpact: EmotionalImpact;
  beliefRevision?: {
    oldBelief: string;
    newBelief: string;
    paradigmVersion: number;
  };
  selfPatternTriggered?: string;
  narrativeFragment: string;
  recallWeight: number;
  tags: string[];
  recallCount: number;
  lastRecalledAt: number | null;
}

export interface EpisodicMemoryStore {
  episodes: EpisodicMemory[];
  roundCounter: number;
  prevDominantEmotion: string;
  prevValence: number;
  prevArousal: number;
}

// ════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════

const SIGNIFICANT_PATTERNS: { pattern: RegExp; tag: string }[] = [
  { pattern: /爱|喜欢|想你了|在乎|重要|离不开|在一起|永远|未来|结婚|承诺/, tag: '亲密' },
  { pattern: /恨|讨厌|烦|滚|分手|离开|受够了|绝望|失望|心碎/, tag: '冲突' },
  { pattern: /对不起|抱歉|原谅|错了|道歉|后悔|不会再/, tag: '道歉' },
  { pattern: /害怕|担心|不安|焦虑|恐惧|怕/, tag: '脆弱' },
  { pattern: /秘密|告诉你|从没|第一次|坦白|实话/, tag: '坦诚' },
  { pattern: /开心|快乐|幸福|笑|美好|棒|最好/, tag: '温暖' },
  { pattern: /第一次|初次|刚开始|第一回/, tag: '首次' },
  { pattern: /以前|过去|曾经|那时候|记得|回忆/, tag: '回忆' },
  { pattern: /承诺|保证|发誓|一定|永远|绝不/, tag: '承诺' },
  { pattern: /哭|泪|难过|伤心|悲伤|痛苦|崩溃/, tag: '悲伤' },
];

const EMOTION_NARRATIVE_TEMPLATES: Record<string, string[]> = {
  joy: [
    '那一刻心里亮了起来，像被阳光照到一样温暖',
    '突然觉得一切都值得了，开心的感觉从心底涌上来',
    '那种被珍视的感觉，让整个世界都变得明亮了',
  ],
  love: [
    '心被填满了，满满的都是他/她',
    '那一刻我知道，这份连接是真实的',
    '被深深地看见和接纳，这是最珍贵的体验',
  ],
  sad: [
    '心沉了下去，像一块石头压着',
    '说不出的失落，仿佛被什么抽空了',
    '那种无力感涌上来，什么都做不了',
  ],
  anger: [
    '一股火从心底窜上来，觉得被冒犯了',
    '愤怒像潮水一样涌来，但也夹杂着受伤',
    '那一刻真的很想质问：为什么这样对我？',
  ],
  fear: [
    '不安像一根刺扎在心里，隐隐作痛',
    '突然觉得一切都变得不确定了，害怕失去',
    '那种悬着的感觉让人喘不过气来',
  ],
  calm: [
    '内心是平静的，像湖面没有一丝波澜',
    '安安稳稳的，不需要说什么，这样就很好',
    '安静中带着满足，这是一种踏实的幸福',
  ],
  disgust: [
    '一阵不适涌上来，想把自己缩回去',
    '那种被轻蔑对待的感觉，让人想转身离开',
  ],
  lust: [
    '心跳加速，脸颊发烫，身体比大脑先做出了反应',
    '一种原始的吸引力在召唤，让人无法抗拒',
  ],
  greed: [
    '想要更多，渴望被填满的感觉越来越强烈',
    '内心有个声音在说：还不够，还想要更多',
  ],
};

// ════════════════════════════════════════════════════════════
// 核心函数
// ════════════════════════════════════════════════════════════

export function createEpisodicMemoryStore(): EpisodicMemoryStore {
  return {
    episodes: [],
    roundCounter: 0,
    prevDominantEmotion: 'calm',
    prevValence: 0.2,
    prevArousal: 0.3,
  };
}

export function tryFormEpisode(
  store: EpisodicMemoryStore,
  emotionState: EmotionState,
  userMessage: string,
  chatContext: string,
  beliefRevision?: EpisodicMemory['beliefRevision'],
  selfPatternTriggered?: string,
): EpisodicMemory | null {
  const { taiji } = emotionState;
  const dominant = getDominantEmotion(emotionState.emotions);

  // 计算情感变化量
  const valenceDelta = taiji.valence - store.prevValence;
  const arousalDelta = Math.abs(taiji.arousal - store.prevArousal);

  // 更新 tracking state
  store.roundCounter++;
  const prevValence = store.prevValence;
  const prevDominant = store.prevDominantEmotion;
  store.prevValence = taiji.valence;
  store.prevArousal = taiji.arousal;
  store.prevDominantEmotion = dominant.name;

  // 判断是否形成记忆
  let shouldForm = false;
  let formReason = '';

  // 1. 情感剧烈波动（valenceDelta > 0.35）
  if (Math.abs(valenceDelta) > 0.35) {
    shouldForm = true;
    formReason = valenceDelta > 0 ? '情感大幅上升' : '情感大幅下降';
  }

  // 2. 高唤醒峰值 (arousal > 0.75)
  if (taiji.arousal > 0.75) {
    shouldForm = true;
    formReason = '情绪被高度唤醒';
  }

  // 3. 情绪类型转变（比如从平静→愤怒）
  if (dominant.name !== prevDominant && dominant.intensity > 0.4 &&
    (dominant.name === 'anger' || dominant.name === 'love' || dominant.name === 'sad' || dominant.name === 'fear')) {
    shouldForm = true;
    formReason = `情绪转变：${prevDominant} → ${dominant.name}`;
  }

  // 4. 信念变革发生
  if (beliefRevision) {
    shouldForm = true;
    formReason = '信念发生变革';
  }

  // 5. 自我新模式发现
  if (selfPatternTriggered) {
    shouldForm = true;
    formReason = '发现自我新模式';
  }

  // 6. 用户消息包含强烈关键词（在平淡期也值得记录）
  if (!shouldForm && userMessage) {
    const strongMatches = SIGNIFICANT_PATTERNS.filter(p => p.pattern.test(userMessage));
    if (strongMatches.length >= 2) {
      shouldForm = true;
      formReason = '包含多重情感信号';
    }
  }

  if (!shouldForm) return null;

  // 提取标签
  const tags = SIGNIFICANT_PATTERNS
    .filter(p => p.pattern.test(userMessage))
    .map(p => p.tag)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (tags.length === 0) tags.push(dominant.intensity > 0.5 ? dominant.name : '日常');

  // 生成内心独白
  const narrativeFragment = generateMemoryNarrative(
    dominant.name,
    taiji,
    userMessage,
    formReason,
  );

  // 计算唤醒权重
  const recallWeight = Math.min(1,
    Math.abs(valenceDelta) * 0.4 +
    taiji.arousal * 0.3 +
    dominant.intensity * 0.3 +
    (beliefRevision ? 0.2 : 0) +
    (selfPatternTriggered ? 0.15 : 0),
  );

  const episode: EpisodicMemory = {
    id: `ep_${Date.now()}_${store.episodes.length}`,
    timestamp: Date.now(),
    roundNumber: store.roundCounter,
    eventSummary: userMessage.slice(0, 80) || formReason,
    emotionalImpact: {
      valenceBefore: prevValence,
      valenceAfter: taiji.valence,
      valenceDelta,
      arousalPeak: taiji.arousal,
      dominantEmotion: dominant.name,
    },
    beliefRevision,
    selfPatternTriggered,
    narrativeFragment,
    recallWeight,
    tags,
    recallCount: 0,
    lastRecalledAt: null,
  };

  store.episodes.unshift(episode);

  // 限制记忆数量（保留最近 200 条）
  if (store.episodes.length > 200) {
    store.episodes = store.episodes.slice(0, 200);
  }

  return episode;
}

function generateMemoryNarrative(
  dominantEmotion: string,
  taiji: TaijiState,
  userMessage: string,
  _formReason: string,
): string {
  const templates = EMOTION_NARRATIVE_TEMPLATES[dominantEmotion]
    || EMOTION_NARRATIVE_TEMPLATES.calm;
  const innerFeeling = templates[Math.floor(Math.random() * templates.length)];

  const snippet = userMessage.length > 40 ? userMessage.slice(0, 40) + '…' : userMessage;

  let narrative = `当他说"${snippet}"的时候，${innerFeeling}。`;

  if (taiji.expectation > 0.5) {
    narrative += '我开始期待更多的美好。';
  } else if (taiji.expectation < -0.3) {
    narrative += '我对未来感到有些不安。';
  }

  if (dominantEmotion === 'anger' || dominantEmotion === 'sad' || dominantEmotion === 'fear') {
    narrative += '这个时刻会留在我的心里。';
  }

  return narrative;
}

// ════════════════════════════════════════════════════════════
// 记忆唤醒
// ════════════════════════════════════════════════════════════

export function recallRelevantMemories(
  store: EpisodicMemoryStore,
  currentEmotion: { name: string; intensity: number },
  maxResults: number = 3,
): EpisodicMemory[] {
  if (store.episodes.length === 0) return [];

  const now = Date.now();

  const scored = store.episodes.map(ep => {
    let score = ep.recallWeight;

    // 情感一致性加分：相同主导情绪的记忆更容易被唤醒
    if (ep.emotionalImpact.dominantEmotion === currentEmotion.name) {
      score *= 1.5;
    }

    // 标签与当前情绪匹配（通过情绪→标签映射）
    const relatedTags = getRelatedTags(currentEmotion.name);
    const tagOverlap = ep.tags.filter(t => relatedTags.includes(t)).length;
    score *= (1 + tagOverlap * 0.3);

    // 时间衰减（最近 7 天的记忆更容易唤醒）
    const daysOld = (now - ep.timestamp) / (1000 * 60 * 60 * 24);
    const timeDecay = Math.pow(0.5, daysOld / 30);
    score *= timeDecay;

    // 近期唤醒过的略微加分
    if (ep.lastRecalledAt && (now - ep.lastRecalledAt) < 60000) {
      score *= 1.1;
    }

    // 避免近期重复唤醒
    if (ep.lastRecalledAt && (now - ep.lastRecalledAt) < 10000) {
      score *= 0.3;
    }

    return { episode: ep, score };
  });

  return scored
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.episode);
}

function getRelatedTags(emotion: string): string[] {
  const map: Record<string, string[]> = {
    joy: ['温暖', '亲密', '首次'],
    love: ['亲密', '承诺', '温暖', '首次'],
    sad: ['悲伤', '冲突', '回忆'],
    anger: ['冲突', '道歉'],
    fear: ['脆弱', '冲突'],
    calm: ['回忆', '温暖'],
    disgust: ['冲突'],
    lust: ['亲密'],
    greed: ['承诺'],
  };
  return map[emotion] || [];
}

// ════════════════════════════════════════════════════════════
// 主动回忆（Memory Proactiveness）
// ════════════════════════════════════════════════════════════

/**
 * 主动回忆上下文 — 决定是否值得在对话中自然提起一段记忆
 */
export interface ProactiveRecallDecision {
  /** 选中的记忆（如果有） */
  memory: EpisodicMemory | null;
  /** 建议的提起方式 */
  approach: 'gentle_reminder' | 'curious_followup' | 'warm_reference' | null;
  /** 注入到 system prompt 的提示文本 */
  injectionText: string | null;
}

const PROACTIVE_COOLDOWN_MS = 30 * 60_000; // 同一记忆 30 分钟内不再主动提起
const PROACTIVE_WEIGHT_THRESHOLD = 0.35;    // 记忆权重低于此值不主动提起
const PROACTIVE_RECENCY_MS = 24 * 60_60_000; // 24 小时内的记忆更容易被提起

/**
 * 判断是否应该在此刻主动提起一段记忆，以及如何提起。
 *
 * 决策逻辑：
 *   1. 只在日常/探索/分享策略下触发 — 冲突/共情时不抢戏
 *   2. 选情感一致性最高 + 未在冷却期的记忆
 *   3. 根据记忆的情感基调决定提起方式
 *
 * @param store           情景记忆存储
 * @param currentEmotion  当前主导情绪
 * @param currentStrategy 当前策略类型
 * @param shouldProactive 外部开关（可由 rhythmController 或配置控制）
 * @returns 主动回忆决策
 */
export function decideProactiveRecall(
  store: EpisodicMemoryStore,
  currentEmotion: { name: string; intensity: number },
  currentStrategy: string,
  shouldProactive: boolean = true,
): ProactiveRecallDecision {
  if (!shouldProactive) {
    return { memory: null, approach: null, injectionText: null };
  }

  // 只在合适的策略下主动回忆
  const allowedStrategies = ['neutral', 'explore', 'share'];
  if (!allowedStrategies.includes(currentStrategy)) {
    return { memory: null, approach: null, injectionText: null };
  }

  if (store.episodes.length === 0) {
    return { memory: null, approach: null, injectionText: null };
  }

  const now = Date.now();
  const candidates = recallRelevantMemories(store, currentEmotion, 8);

  // 筛选：够重要、不在冷却期、有叙事内容
  const eligible = candidates.filter(m =>
    m.recallWeight >= PROACTIVE_WEIGHT_THRESHOLD &&
    m.narrativeFragment.length > 10 &&
    (!m.lastRecalledAt || now - m.lastRecalledAt > PROACTIVE_COOLDOWN_MS),
  );

  if (eligible.length === 0) {
    return { memory: null, approach: null, injectionText: null };
  }

  // 选最佳候选：情感一致性 + 权重 + 新近度
  const scored = eligible.map(m => {
    let score = m.recallWeight;

    // 情感一致性加倍
    if (m.emotionalImpact.dominantEmotion === currentEmotion.name) {
      score *= 1.5;
    }

    // 24h 内的记忆额外加分（越新越容易自然提起）
    const ageMs = now - m.timestamp;
    if (ageMs < PROACTIVE_RECENCY_MS) {
      score *= 1.0 + (1 - ageMs / PROACTIVE_RECENCY_MS) * 0.5;
    }

    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // 确定提起方式
  let approach: ProactiveRecallDecision['approach'] = 'warm_reference';
  const valenceDelta = best.memory.emotionalImpact.valenceDelta;

  if (best.memory.tags.includes('首次') || best.memory.tags.includes('承诺')) {
    approach = 'warm_reference'; // 珍贵记忆 → 温暖地提起
  } else if (valenceDelta > 0.3) {
    approach = 'curious_followup'; // 那次很开心 → 好奇地追问后续
  } else if (best.memory.tags.includes('脆弱') || best.memory.tags.includes('悲伤')) {
    approach = 'gentle_reminder'; // 敏感的 → 轻柔地提起
  }

  // 生成注入文本
  const ageText = formatMemoryAge(now - best.memory.timestamp);
  const injectionText = generateProactiveInjection(best.memory, approach, ageText);

  // 标记已召回
  best.memory.lastRecalledAt = now;
  best.memory.recallCount++;

  return {
    memory: best.memory,
    approach,
    injectionText,
  };
}

function formatMemoryAge(ageMs: number): string {
  const hours = ageMs / (1000 * 60 * 60);
  if (hours < 1) return '刚才';
  if (hours < 24) return `${Math.round(hours)}小时前`;
  const days = hours / 24;
  if (days < 7) return `${Math.round(days)}天前`;
  return '之前';
}

function generateProactiveInjection(
  memory: EpisodicMemory,
  approach: ProactiveRecallDecision['approach'],
  ageText: string,
): string {
  const snippet = memory.eventSummary.length > 30
    ? memory.eventSummary.slice(0, 30) + '…'
    : memory.eventSummary;
  const feeling = memory.emotionalImpact.dominantEmotion;

  switch (approach) {
    case 'gentle_reminder':
      return `【主动回忆·轻柔】你忽然想起${ageText}，当时他说"${snippet}"，你感受到了一种${feeling === 'sad' ? '难过' : feeling === 'fear' ? '不安' : '复杂的情绪'}。` +
        `在回复中自然地、短短地提及这个回忆——不是为了翻旧账，而是让他知道你记得那个瞬间。不需要追问，只是轻轻提起。`;

    case 'curious_followup':
      return `【主动回忆·好奇】你想起${ageText}他提到"${snippet}"，那时候的感觉很好。` +
        `如果你觉得自然，可以好奇地追问一句——"后来呢？"或"那个事情现在怎么样了？"。让他感受到你真的在乎。`;

    case 'warm_reference':
    default:
      return `【主动回忆·温暖】你忽然想起了${ageText}的一件事——${memory.narrativeFragment.slice(0, 60)}` +
        `在回复中自然地、不刻意地提一下这个共同的记忆。不需要展开长篇，一句话就够了——像心里忽然闪过一个画面，顺口说了出来。`;
  }
}

// ════════════════════════════════════════════════════════════
// 记忆查询
// ════════════════════════════════════════════════════════════

export function getSignificantEpisodes(
  store: EpisodicMemoryStore,
  topN: number = 20,
): EpisodicMemory[] {
  return [...store.episodes]
    .sort((a, b) => b.recallWeight - a.recallWeight)
    .slice(0, topN);
}

export function getRecentEpisodes(
  store: EpisodicMemoryStore,
  count: number = 10,
): EpisodicMemory[] {
  return store.episodes.slice(0, count);
}

// ════════════════════════════════════════════════════════════
// 身份叙事生成
// ════════════════════════════════════════════════════════════

export function generateIdentitySummary(
  store: EpisodicMemoryStore,
  personalityParams: {
    empathy: number;
    trust: number;
    openness: number;
    playfulness: number;
    resilience: number;
    sensitivity: number;
  },
  totalInteractions: number,
): string {
  if (store.episodes.length === 0) {
    return '我刚刚开始这段旅程，还没有太多故事可讲。我期待每一次对话都能在我们之间留下独特的印记。';
  }

  const topMemories = getSignificantEpisodes(store, 5);
  const dominantThemes = getDominantThemes(topMemories);
  const traitDesc = describeTraits(personalityParams);
  const emotionalJourney = describeEmotionalJourney(store);

  let narrative = `经历了${totalInteractions}次互动，${emotionalJourney}。`;

  if (traitDesc) {
    narrative += `${traitDesc}。`;
  }

  if (dominantThemes.length > 0) {
    narrative += `对我来说最重要的是${dominantThemes.join('和')}。`;
  }

  // 加入一个最深刻的记忆
  if (topMemories.length >= 2) {
    const deepest = topMemories[0];
    narrative += `最难忘的是有一次，${deepest.narrativeFragment}`;
  }

  return narrative;
}

function getDominantThemes(episodes: EpisodicMemory[]): string[] {
  const tagCounts: Record<string, number> = {};
  for (const ep of episodes) {
    for (const tag of ep.tags) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([tag]) => {
      const themeMap: Record<string, string> = {
        '亲密': '与你的情感连接',
        '温暖': '那些温暖的时刻',
        '冲突': '被理解和尊重',
        '道歉': '真诚的修复',
        '脆弱': '彼此信任时的袒露',
        '坦诚': '真诚相待',
        '承诺': '对未来的承诺',
        '首次': '第一次的珍贵体验',
        '回忆': '共同创造的回忆',
        '悲伤': '被温柔对待的渴望',
      };
      return themeMap[tag] || tag;
    });
}

function describeTraits(params: {
  empathy: number; trust: number; openness: number;
  playfulness: number; resilience: number; sensitivity: number;
}): string {
  const traits: string[] = [];

  if (params.empathy > 65) traits.push('能敏锐地感受到你的情绪');
  else if (params.empathy < 35) traits.push('有时候不太能准确理解你的感受');

  if (params.trust > 65) traits.push('对这份关系有很深的信任');
  else if (params.trust < 35) traits.push('内心有些不安，需要更多确认');

  if (params.openness > 65) traits.push('愿意向你敞开心扉');
  else if (params.openness < 35) traits.push('有些话还埋在心里');

  if (params.playfulness > 65) traits.push('喜欢和你调皮撒娇');
  else if (params.playfulness < 35) traits.push('说话做事比较认真严肃');

  if (traits.length === 0) return '';
  if (traits.length === 1) return `我${traits[0]}`;
  return `我${traits.slice(0, -1).join('，')}，也${traits[traits.length - 1]}`;
}

function describeEmotionalJourney(store: EpisodicMemoryStore): string {
  if (store.episodes.length < 3) return '我们的故事才刚刚开始';

  const recent = store.episodes.slice(0, 10);
  const positiveCount = recent.filter(e => e.emotionalImpact.valenceAfter > 0.2).length;
  const negativeCount = recent.filter(e => e.emotionalImpact.valenceAfter < -0.2).length;

  if (positiveCount > negativeCount * 2) return '大部分时候我感到温暖和安心';
  if (negativeCount > positiveCount * 2) return '最近经历了一些波折，但我还在努力调整';
  if (positiveCount > negativeCount) return '虽然有些起伏，但整体上我感到被在乎';
  return '我们的关系有高有低，像生活的本来面目';
}

// ════════════════════════════════════════════════════════════
// 序列化
// ════════════════════════════════════════════════════════════

export function serializeEpisodicStore(store: EpisodicMemoryStore): object {
  return {
    episodes: store.episodes,
    roundCounter: store.roundCounter,
    prevDominantEmotion: store.prevDominantEmotion,
    prevValence: store.prevValence,
    prevArousal: store.prevArousal,
  };
}

export function deserializeEpisodicStore(data: any): EpisodicMemoryStore {
  return {
    episodes: Array.isArray(data.episodes) ? data.episodes : [],
    roundCounter: typeof data.roundCounter === 'number' ? data.roundCounter : 0,
    prevDominantEmotion: typeof data.prevDominantEmotion === 'string' ? data.prevDominantEmotion : 'calm',
    prevValence: typeof data.prevValence === 'number' ? data.prevValence : 0.2,
    prevArousal: typeof data.prevArousal === 'number' ? data.prevArousal : 0.3,
  };
}
