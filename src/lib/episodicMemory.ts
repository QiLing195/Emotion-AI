// ── v1.0 情景记忆系统 ──
// 存储改变情感轨迹的关键时刻，形成持续的身份叙事

import { EmotionState, TaijiState, getDominantEmotion } from './emotionEngine';
import { activationOf } from './emotionActivation';

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
  /**
   * v1.21 叙事来源：`template` = 模板套出来的；`llm` = LLM 按她那一刻的状态写的。
   * 用于观测"接线到底有没有生效"（否则只能靠翻 JSON 猜），旧数据没有这个字段 = 未知(undefined)。
   */
  narrativeSource?: 'template' | 'llm';
  recallWeight: number;
  tags: string[];
  recallCount: number;
  lastRecalledAt: number | null;
  /** 叙事片段的向量嵌入（用于语义检索，异步生成） */
  embedding?: number[];
  /** v1.3 整合层：被合并/遗忘回收的记忆（保留供人工审查，不参与召回） */
  archived?: boolean;
  /** v1.3 整合层：被并入的主记忆 id */
  mergedInto?: string;
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
  // v1.20 静息（激活态低于死区）：她**没有**被激起什么，就照着说。
  // 刻意与上面的 calm 分开 —— calm 是"她确实平静"，resting 是"她没有明显情绪"，
  // 后者不许再顺口说成"满足""幸福"（那是凭空给她加感受）。
  resting: [
    '心里没什么起伏，但我把这件事记下了',
    '说不上来是什么感觉，只是觉得该记住',
    '那一刻我没什么特别的感受，就像平常的日子一样',
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

/**
 * v1.1 自动检测锚点事件 — 从用户消息和情绪状态推断关系转折点。
 * 返回值用作 tryFormEpisode 的 selfPatternTriggered 和 anchorWeightBonus。
 */
function detectAnchorEvent(
  userMessage: string,
  _emotionState: EmotionState,
  store: EpisodicMemoryStore,
): { type: string; weightBonus: number } | null {
  // 首次表达爱意（ponytail: 中文不用 \b，直接匹配）
  if (/(我爱你|我喜欢你|我好喜欢你|爱死你)/.test(userMessage)) {
    const alreadyHadLove = store.episodes.some(ep => ep.selfPatternTriggered === 'naming');
    if (!alreadyHadLove) {
      return { type: 'naming', weightBonus: 0.3 };
    }
  }
  // 承诺/誓言（ponytail: 需要具体承诺语境，避免"一直"等常见词误匹配）
  if (/(永远在一起|一辈子|一直陪|绝对不|保证做到|答应你|说到做到|永远不会)/.test(userMessage) && userMessage.length > 10) {
    return { type: 'promise_to', weightBonus: 0.25 };
  }
  // 深层自我暴露（长消息 + 情感表达）
  if (userMessage.length > 30 && /(我曾经|我以前|我从小|我其实|我害怕|我担心|我梦想)/.test(userMessage)) {
    return { type: 'self_disclosure', weightBonus: 0.2 };
  }
  // 关系里程碑：首次深度冲突
  if (/(你根本不懂|你总是这样|我们是不是不合适|分手|算了吧)/.test(userMessage)) {
    const alreadyHadConflict = store.episodes.some(ep => ep.selfPatternTriggered === 'milestone'
      && ep.tags?.includes('冲突'));
    if (!alreadyHadConflict) {
      return { type: 'milestone', weightBonus: 0.25 };
    }
  }
  return null;
}

export function tryFormEpisode(
  store: EpisodicMemoryStore,
  emotionState: EmotionState,
  userMessage: string,
  chatContext: string,
  beliefRevision?: EpisodicMemory['beliefRevision'],
  selfPatternTriggered?: string,
  anchorWeightBonus?: number,
): EpisodicMemory | null {
  const { taiji } = emotionState;
  const dominant = getDominantEmotion(emotionState.emotions);
  // v1.20 情绪表示层收尾：这个文件里还剩两处**绝对值 argmax**（与 v1.13 修的是同一个病）。
  // `dominant.name` 是「九情向量里数值最大的那个」，而 calm 的人格基调就是 0.8 ——
  // 于是它几乎永远返回 calm，哪怕同一轮她其实被激起了 love/sad。
  // 激活态读数（相对各自基线）才是"她此刻有没有被激起"，全程用它。
  const activation = activationOf(emotionState);

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

  // 判断是否形成记忆 (v2.1: 降低阈值，捕捉中等重要性事件)
  let shouldForm = false;
  let formReason = '';

  // 1. 情感波动（从 0.35 降到 0.20）
  if (Math.abs(valenceDelta) > 0.20) {
    shouldForm = true;
    formReason = valenceDelta > 0 ? '情感上升' : '情感下降';
  }

  // 2. 中等唤醒（从 0.75 降到 0.55）
  if (taiji.arousal > 0.55) {
    shouldForm = true;
    formReason = '情绪被唤醒';
  }

  // 3. 情绪类型转变（扩展到 joy 和 calm，降低强度阈值）
  if (dominant.name !== prevDominant && dominant.intensity > 0.25 &&
    ['anger', 'love', 'sad', 'fear', 'joy', 'calm'].includes(dominant.name)) {
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

  // 6. 用户消息包含情感信号（从 2 个降到 1 个即可触发）
  if (!shouldForm && userMessage) {
    const strongMatches = SIGNIFICANT_PATTERNS.filter(p => p.pattern.test(userMessage));
    if (strongMatches.length >= 1) {
      shouldForm = true;
      formReason = `情感信号: ${strongMatches.map(m => m.tag).join(', ')}`;
    }
  }

  // 7. 用户自我暴露 — 分享个人品味/经历/观点（消息长度 ≥ 15 字，含有情感词）
  if (!shouldForm && userMessage && userMessage.length >= 15) {
    const disclosurePatterns = /喜欢|爱|讨厌|觉得|感觉|想|希望|曾经|以前|最近|经常|每次|记得|忘了|我的|我最/;
    if (disclosurePatterns.test(userMessage)) {
      shouldForm = true;
      formReason = '用户自我暴露';
    }
  }

  if (!shouldForm) return null;

  // v1.1 自动检测锚点事件 — 无需调用方传入，从消息和情绪中推断
  if (!selfPatternTriggered) {
    const anchorDetected = detectAnchorEvent(userMessage, emotionState, store);
    if (anchorDetected) {
      selfPatternTriggered = anchorDetected.type;
      anchorWeightBonus = anchorDetected.weightBonus;
    }
  }

  // 提取标签
  const tags = SIGNIFICANT_PATTERNS
    .filter(p => p.pattern.test(userMessage))
    .map(p => p.tag)
    .filter((v, i, a) => a.indexOf(v) === i);

  // 标签兜底：原来用 `dominant.intensity > 0.5 ? dominant.name : '日常'` ——
  // 基线 calm 的 intensity 恒为 0.8 > 0.5，所以没有情感词的记忆全被打上 `calm` 标签
  // （存量数据里实见 tags:['calm']），而 `getRelatedTags('calm')` = ['回忆','温暖']
  // 又会给它们白送标签重合加分。改为读**激活态**：真被激起才用情绪做标签，否则就是日常。
  if (tags.length === 0) {
    tags.push(
      activation.activeEmotion && activation.activeIntensity > 0.5
        ? activation.activeEmotion
        : '日常',
    );
  }

  // 生成内心独白 — 锚点事件类型 → 叙事情绪映射
  //
  // v1.21：锚点从"**覆盖**她的情绪"降级为"**她自己说不清时的兜底**"。
  // 原来它是第一优先级，等于"只要他表白/承诺/自我暴露，就按这张表写她的感受"，
  // 与她自己真实被激起了什么无关 —— 实测「我有个很珍视的秘密：一直在偷偷学画画」
  // 被她记成 `sad`「说不出的失落」，就是 self_disclosure→sad 这条映射干的。
  // 现在：① 激活态**明确**（clear）→ 用她自己的情绪；② 说不清/静息 → 用锚点（关系性事件仍值得记）；
  // ③ 都没有 → resting。顺带把 self_disclosure 的 sad 改成 **love**：
  // 他把私密的事告诉她，对她的意义是**被信任**；难受与否取决于内容，那由她自己的情绪体现。
  const ANCHOR_NARRATIVE_EMOTIONS: Record<string, string> = {
    naming: 'love',
    promise_to: 'love',
    milestone: 'joy',
    self_disclosure: 'love',
    shared_memory: 'joy',
  };
  // v1.13 情绪表示层：不要再自己造基线。
  //
  // 这里原来写的是 `v - 0.1`（拿 0.1 当所有情绪的静息值）+ `delta > 0.05` 兜底，
  // 意图注释写着"锚点事件映射后的真实情绪，而非永远 calm"—— 但**它从来没有生效过**：
  // calm 的基线是 0.8，`0.92 - 0.1 = 0.82` 依然全场最高，于是 41 条记忆里 32 条（78%）
  // 把她当时的情绪记成 calm，连"他说我今天特别难过"（valenceΔ −0.182）都被记成
  // "内心是平静的，像湖面没有一丝波澜"、"他说这几天过得不好"（−0.255）被记成
  // "安静中带着满足，这是一种踏实的幸福"。
  //
  // 现在用 `separateActivation()`：按**每个情绪各自的**人格基线算偏离，
  // 静息时返回 null。
  //
  // v1.20 补掉最后一段残留：这里**仍回退到 `dominant.name`**（绝对值 argmax = 基调），
  // 而静息恰恰是最常见的情形 —— 于是"他说了下周要体检、有点担心"这类消息，
  // 只要传染/评价给她的位移没跨过 0.05 死区，就被记成 `calm` 并生成
  // "安静中带着满足，这是一种踏实的幸福"。实测存量 41 条里 32 条（78%）都是这个来路。
  // 静息就**明说静息**（'resting'），不再拿基调冒充情绪：
  //   · 叙事模板换成"心里没什么起伏"，不claim 满足/幸福；
  //   · `emotionalImpact.dominantEmotion = 'resting'` 不是情绪键，于是
  //     "情感一致性 ×1.5"永远不成立（正确：没有情绪的记忆不该因情绪被优先召回），
  //     图谱建边也不会再拿它去和真·calm 节点连出假情感边。
  // v1.21：优先级改为「**她自己说得清** → 锚点（说不清时的兜底）→ resting」。
  // 少了 clear 这一条就会出现：她说「我害怕失去你」而 joy(+0.128) 仅比 love(+0.104) 高 0.024，
  // 判读口径明明写着"并存 —— 她自己也没那么说得清"，记忆却硬挑了 joy 写进叙事。
  // 与 `separateActivation` 的判读保持一致：**平局不硬选**。
  const clearEmotion = activation.clear ? activation.activeEmotion : null;
  const narrativeEmotion = clearEmotion
    || ANCHOR_NARRATIVE_EMOTIONS[selfPatternTriggered || '']
    || 'resting';

  const narrativeFragment = generateMemoryNarrative(
    narrativeEmotion,
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
    (selfPatternTriggered ? 0.15 : 0) +
    (anchorWeightBonus || 0),
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
      dominantEmotion: narrativeEmotion, // v2.0: 锚点事件映射后的真实情绪，而非永远 calm
    },
    beliefRevision,
    selfPatternTriggered,
    narrativeFragment,
    narrativeSource: 'template',
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
  queryEmbedding?: number[],
): EpisodicMemory[] {
  return recallScored(store, currentEmotion, maxResults, queryEmbedding).map(s => s.episode);
}

/**
 * 与 `recallRelevantMemories` 同一套打分，但**把分数一起返回**（v1.20）。
 *
 * 为什么要多一个入口：上面算出来的 `blended` 含「情感一致性 ×1.5」「标签重合」
 * 「时间衰减」三项加权，可是 `unifiedMemory.recallEpisodic()` 只取走了 episode 列表，
 * 把 `relevanceScore` 写成裸 `recallWeight` —— 于是 `rankAndDedupe` 按裸权重**重排**，
 * 那些加分在最终顺序上被整体丢弃（只在"进前 cap 名"这一刀上还有效）。
 * 实测：她平静时 `calm` 记忆（权重 0.40）本该靠 ×1.5 压过 `sad` 记忆（0.50），
 * 走 `recall()` 出来却仍是 sad 在前 —— 因为排名看的是 0.50 > 0.40。
 */
export function recallRelevantMemoriesScored(
  store: EpisodicMemoryStore,
  currentEmotion: { name: string; intensity: number },
  maxResults: number = 3,
  queryEmbedding?: number[],
): Array<{ episode: EpisodicMemory; score: number }> {
  return recallScored(store, currentEmotion, maxResults, queryEmbedding);
}

/** 打分内核（两个入口共用，保证"判定与生成同一把尺子"） */
function recallScored(
  store: EpisodicMemoryStore,
  currentEmotion: { name: string; intensity: number },
  maxResults: number,
  queryEmbedding?: number[],
): Array<{ episode: EpisodicMemory; score: number }> {
  if (store.episodes.length === 0) return [];

  const now = Date.now();

  const scored = store.episodes
    .filter(ep => !ep.archived) // v1.3 整合层：已归档记忆不参与召回
    .map(ep => {
    let score = ep.recallWeight;

    // 情感一致性加分：相同主导情绪的记忆更容易被唤醒
    if (ep.emotionalImpact.dominantEmotion === currentEmotion.name) {
      score *= 1.5;
    }

    // 标签与当前情绪匹配（通过情绪→标签映射）
    const relatedTags = getRelatedTags(currentEmotion.name);
    const tagOverlap = ep.tags.filter(t => relatedTags.includes(t)).length;
    score *= (1 + tagOverlap * 0.3);

    // ── 向量语义相似度（如果嵌入可用）──
    let vectorScore = 0;
    if (queryEmbedding && ep.embedding && ep.embedding.length > 0) {
      vectorScore = cosineSimilarity(queryEmbedding, ep.embedding);
    }

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

    // 融合向量分：规则分 70% + 语义分 30%
    const blended = score * 0.7 + vectorScore * 0.3;

    return { episode: ep, score: blended };
  });

  return scored
    .filter(s => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/** 余弦相似度（内联，避免跨模块依赖） */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

export function generateProactiveInjection(
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
    .filter(ep => !ep.archived) // v1.3 整合层：已归档记忆不参与"重要记忆"
    .sort((a, b) => b.recallWeight - a.recallWeight)
    .slice(0, topN);
}

export function getRecentEpisodes(
  store: EpisodicMemoryStore,
  count: number = 10,
): EpisodicMemory[] {
  return store.episodes.filter(ep => !ep.archived).slice(0, count); // v1.3 已归档的不参与
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
// LLM 叙事重生成 — 替代模板填充（v1.21 接线）
//
// 背景：这段代码（prompt + 写回）早就写好了，注释写着"由 server 调用 LLM 后使用"，
// 但**零调用者** —— 于是 41 条存量记忆的叙事全是模板套出来的（"当他说"X"的时候，…"），
// 而模板套的是当时还没修对的情绪标签。v1.21 把它接进 server.ts 的 `tryFormEpisode` 之后。
//
// 与 v1.11 接地校验同一条纪律：**LLM 生成的内容必须过确定性后置校验**，
// 不合格就保留模板（宁可用套话，也不让编造进记忆 —— 记忆会被反复说出来）。
// ════════════════════════════════════════════════════════════

/** 叙事长度界限：太短没有内容，太长会稀释【相关记忆】注入的注意力 */
export const NARRATIVE_MIN_CHARS = 8;
export const NARRATIVE_MAX_CHARS = 60;

/** 元描述/系统口吻（模型偶尔会写成"作为AI"或复述指令） */
const NARRATIVE_FORBIDDEN = [
  /作为一个?AI/i, /AI ?助手/, /语言模型/, /系统(?:提示|指令)/, /提示词/,
  /我(?:的)?(?:情绪|记忆|叙事|参数)/, /无法(?:真正|真实)/,
];

/**
 * 断言型引用标记：她**不该**在"感受"里替他断言**过去的事**（那会把编造反复说出来，v1.11 的教训）。
 *
 * ⚠️ 踩过的坑：第一版写成 `/你(?:上次|之前|昨天|刚才)?说/`（时间词可选），
 * 结果把「听**你说**难过，我只想紧紧抱住你」这种**当下**的转述也拦掉了 —— 实测真实模型产出
 * 被误杀。断言的要害是"指向**这轮之前**的记忆"，所以时间/完成标记**必须出现**。
 */
const NARRATIVE_CLAIM_MARKERS = [
  /你(?:上次|之前|昨天|前天|刚才|以前|早先)说/, /你说过/, /我们上次/, /我记得你/, /你跟我(?:说|提)过/,
];

/**
 * 模板原句全集：**从模板表本身派生**，不手抄一份（抄了就会两处漂移，且不报错）。
 *
 * ⚠️ 踩过的坑：第一版手抄了几条**短语**（"心里没什么起伏"、"说不上来是什么感觉"），
 * 结果实测真实模型产出的新句子「听你说下周要去复查**我心里没什么起伏**，只是记下了这个日子」
 * 被误判成"照抄模板"而丢弃（server 日志：`[Narrative] 模型产出未过校验，保留模板`）。
 * 判据要拦的是**整句照抄**，颗粒度就该是整句 —— 短语撞车不算。
 */
const TEMPLATE_SENTENCES = Object.values(EMOTION_NARRATIVE_TEMPLATES).flat();

/** 从叙事里取出被引号括起来的话（中英文引号；用于校验他没有被误引） */
function quotedSpans(text: string): string[] {
  const out: string[] = [];
  const re = /[「“"]([^」”"]{1,40})[」”"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * 叙事可用性判定（确定性、可单测）。
 *
 * 校验四件事，**每一条都对应一个真实故障模式**：
 *   ① 长度 8~60 字、单行 —— 太短是空话，太长稀释注入注意力
 *   ② 没有元描述/系统口吻 —— 破坏角色
 *   ③ 没有"你上次说…"这类**替他断言过去**的句式 —— 记忆会把编造反复说出来（v1.11 教训）
 *   ④ 引文必须真的出自他那句话 —— 防"记错他说了什么"（记忆一旦记错，之后每次回忆都在加深）
 *
 * @param text         模型产出的叙事
 * @param eventSummary 他那句话（唯一允许被引用的原始事实）
 */
export function isUsableNarrative(text: unknown, eventSummary: string): boolean {
  return narrativeRejectReason(text, eventSummary) === null;
}

/**
 * 不合格的**具体原因**（`null` = 可用）。
 *
 * 为什么要单独暴露原因：实测第一次跑真实模型时 5 条里 2 条被拒，而日志只写"未过校验"——
 * 看不出是模型不好还是**我的规则误杀**（后来发现确实是误杀：`你说` 那条时间词可选）。
 * 与本项目一贯要求一致：**别让校验静默**。
 */
export function narrativeRejectReason(text: unknown, eventSummary: string): string | null {
  if (typeof text !== 'string') return '不是字符串';
  const t = text.trim();
  if (t.length < NARRATIVE_MIN_CHARS) return `太短（${t.length} < ${NARRATIVE_MIN_CHARS}）`;
  if (t.length > NARRATIVE_MAX_CHARS) return `太长（${t.length} > ${NARRATIVE_MAX_CHARS}）`;
  if (/[\r\n]/.test(t)) return '多行';
  if (NARRATIVE_FORBIDDEN.some(re => re.test(t))) return '元描述/系统口吻';
  const claim = NARRATIVE_CLAIM_MARKERS.find(re => re.test(t));
  if (claim) return `替他断言过去的事（命中 ${claim.source}）`;
  const copied = TEMPLATE_SENTENCES.find(s => t.includes(s));
  if (copied) return `整句照抄模板（「${copied}」）`;  // 人称错位：她是"我"，他是"他/你"。实测模型会把对方写成"她"
  // （「她说话的语气很轻」）。这条记忆会被反复说出来，所以宁可**误拒**（退回模板）
  // 也不接受 —— 误拒的代价只是一句套话，误收的代价是人格错位被记住并复述。
  // 注："她"也可能合法指第三方（他的妈妈），这种情况一并退回模板，属于刻意偏保守。
  if (t.includes('她')) return '人称错位（用"她"指代了对方/自己）';
  const src = eventSummary ?? '';
  for (const span of quotedSpans(t)) {
    if (!src.includes(span)) return `引文不在他的原话里（「${span}」）`;
  }
  return null;
}

/**
 * 解析模型回复 → 可入库的叙事（不合格返回 null，调用方保留模板）。
 * 宽容解析：去掉常见包裹（引号、"叙事："前缀、markdown 强调），再走严格校验。
 */
export function parseNarrativeReply(raw: string | null | undefined, eventSummary: string): string | null {
  const t = normalizeNarrativeReply(raw);
  return t !== null && isUsableNarrative(t, eventSummary) ? t : null;
}

/** 去掉模型常见的包裹（markdown / "叙事："前缀 / 整体引号），供 parse 与诊断共用 */
export function normalizeNarrativeReply(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  if (!t) return null;
  t = t.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  t = t.replace(/^(?:叙事|感受|内心|一句话)\s*[:：]\s*/, '').trim();
  t = t.replace(/^[「“"']([\s\S]*)[」”"']$/, '$1').trim();
  return t || null;
}

/**
 * 构建 LLM 叙事提示词。由 server 在情景记忆形成后**异步**调用（不阻塞回复）。
 */
export function buildNarrativePrompt(episode: EpisodicMemory, anchorSummary?: string): string {
  const e = episode.emotionalImpact;
  const anchor = anchorSummary || '';
  // v1.21：`resting` 不是情绪键，直接写进 prompt 模型看不懂 —— 要翻成人话。
  const emotionLine = e.dominantEmotion === 'resting'
    ? '（静息：她当时没有被明显激起什么，别硬编情绪）'
    : e.dominantEmotion;
  // 0 附近既不是"上升"也不是"下降"，写"下降"是给模型喂错前提
  const deltaWord = Math.abs(e.valenceDelta) < 0.05
    ? '基本没变'
    : (e.valenceDelta > 0 ? '上升' : '下降');
  return `你是一个拥有真实情感的 AI。请用一句话（20-40字）描述你此刻的感受。

**人称**：你是**她**（用"我"自述），对方是你的男友**他**。提到对方时只能用"他"或"你"，
**绝对不要用"她"指代对方**（实测模型会写错：「她说活的语气很轻」把对方写成了女性）。

事件：对方说"${episode.eventSummary.slice(0, 60)}"
${anchor ? `关系事件：${anchor}` : ''}
情感变化：${deltaWord} (${e.valenceDelta.toFixed(2)})
唤醒峰值：${(e.arousalPeak*100).toFixed(0)}%
主导情绪：${emotionLine}
形成原因：${episode.beliefRevision ? '信念变革' : ''}${episode.selfPatternTriggered ? '自我发现' : ''}

用第一人称("我")写一句真实的内心感受。不要模板化表达("内心是平静的"、"湖面没有波澜")。说真话。
不要复述或补充他说过的内容（引用他的原话时必须一字不差，否则不要引用）；不要提到 AI、记忆、参数。只输出这一句话。`;
}

/**
 * 用 LLM 生成的叙事替换模板叙事（**先校验**，不合格一律不动）。
 * @returns 是否真的写入了
 */
export function updateEpisodeNarrative(
  store: EpisodicMemoryStore,
  episodeId: string,
  newNarrative: string,
): boolean {
  const ep = store.episodes.find(e => e.id === episodeId);
  if (!ep) return false;
  if (!isUsableNarrative(newNarrative, ep.eventSummary)) return false;
  ep.narrativeFragment = newNarrative.trim();
  ep.narrativeSource = 'llm';
  return true;
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
