// ── v1.9 动机层 (Motive Layer) ──
// 解决的问题：**"她该说什么"没有来源**。
//
// 症状：聊天开场总是"今天怎么样/在干嘛"这类万能泛问。
// 根因：生成时 LLM 手里只有「人格 + 记忆片段 + 情绪数字 + 策略 + 一摞禁令」，
//       没有"她此刻具体想说什么"。没有具体素材，模型必然回退到对话先验（寒暄+提问）；
//       禁令只能改措辞（"今天过得怎么样"→"今天怎么样"），改不了意图。
//
// 本层给她一个**具体的、属于她自己的念头**作为生成种子：
//   他昨天说面试还没消息      → open_loop   （承接他的话）
//   我最近一直在想他那句"算了" → memory_echo （记忆回响）
//   我最近对 X 很好奇          → curiosity
//   我不想再讨好，想直接问他   → stance      （价值观立场）
//   我今天状态很低，想说少两句 → state       （内在状态）
//
// 三条硬约束（否则动机会变成新的机械感）：
//   ① 必须具体   —— 动机内容必须指向具体的人/事（模板化的"想和他多待一会儿"不入选）
//   ② 允许为空   —— 没有真心想说的就安静陪着，不为维持对话而泛问
//   ③ 会习惯化   —— 同一件事追问多次 → salience 衰减；过期即遗忘
//
// 纯逻辑模块：无 io/React 依赖。

import type {
  EmotionState, Motive, MotiveKind, MotiveState, MotiveLearningState,
} from './emotionTypes';
import { textSimilarity } from './memoryEnhancer';

// 便于调用方（含 server 层）从本模块取类型，而不必知道 emotionTypes 的布局
export type { Motive, MotiveKind, MotiveState, MotiveLearningState };

// ════════════════════════════════════════════════════════════
// 参数
// ════════════════════════════════════════════════════════════

/** 各动机类型的先验紧迫度 */
export const MOTIVE_BASE_SALIENCE: Record<MotiveKind, number> = {
  open_loop: 0.80,   // 他提到但没说完的事 → 最自然、最不机械
  worry: 0.70,
  memory_echo: 0.62,
  wish: 0.58,
  curiosity: 0.52,
  stance: 0.46,
  state: 0.40,
};

/** 各类型的保鲜期（小时）：过期即从池中清除（不许翻陈年旧账） */
export const MOTIVE_TTL_HOURS: Record<MotiveKind, number> = {
  open_loop: 48,
  worry: 24 * 7,
  memory_echo: 24 * 7,
  wish: 24 * 5,
  curiosity: 24 * 14,
  stance: 24 * 3,
  state: 6,
};

/** 低于此紧迫度就不提（宁可安静） */
export const MOTIVE_MIN_SALIENCE = 0.28;
/** 每次提起后的习惯化强度：attempts 越多越不提 */
export const MOTIVE_ATTEMPT_PENALTY = 0.8;
/** 同一意图被提起几次后基本放弃 */
export const MOTIVE_MAX_ATTEMPTS = 3;
/**
 * 与池中已有动机的相似度高于此值视为同一件事（合并刷新，不重复入池）。
 * 注意：只在**同类型**之间去重——不同动机类型即使字面相似也不是同一件事
 * （实测"面试悬念"曾被"连接感立场"吸走，导致真正的悬念消失）。
 */
export const MOTIVE_DEDUPE_SIMILARITY = 0.5;
/** 尝试次数的自然恢复（每天）：她过些天还会再想起这件事，而不是永久沉默 */
export const MOTIVE_ATTEMPT_RECOVERY_PER_DAY = 0.6;
/** 池容量上限 */
export const MOTIVE_POOL_LIMIT = 12;
/**
 * 刚刚提过的那件事，短时间内再提的额外惩罚（防连续两轮追问同一件事）。
 * 取值需足够强：即使 attempts 还是 0（理论上限 0.8×1.0），打完折也要落到阈值以下。
 */
export const MOTIVE_REPEAT_PENALTY = 0.3;
/** "刚刚提过"的时间窗口（小时） */
export const MOTIVE_REPEAT_WINDOW_H = 0.5;
/**
 * 话题级重复判定：与上一轮说出口的动机内容相似度高于此值，即视为"同一件事"。
 * 动机可能换了类型（stance → open_loop）但仍在问同一件事，这一层专门堵住它。
 */
export const MOTIVE_REPEAT_SIMILARITY = 0.3;

// ── 未完待续（open loop）抽取用的中文线索 ──
/** 未完成/未落定的动作标记 */
const UNRESOLVED_MARKERS = [
  '要去', '要去见', '打算', '准备', '约了', '约好', '明天', '后天', '下周', '下个月',
  '待会', '一会儿', '等下', '马上', '正在', '还没', '没来得及', '来不及', '得去',
];
/** 通常"等结果/有后续"的事 */
const PENDING_TOPICS = [
  '面试', '体检', '考试', '结果', '回复', '消息', '报告', '检查', '决定', '答复',
  'offer', '加班', '出差', '请假', '搬家', '谈', '面试结果', '方案', '报价', '审批',
];
/** "已经发生/正在进行"的标记：只提话题词时必须同时命中其中之一才算悬念 */
const ACTION_MARKERS = [
  '去了', '去了', '做了', '刚', '刚刚', '今天', '昨天', '上周', '已经', '正在', '在弄',
  '要', '得', '去',
];
/** 已经落定（用于解除 open loop） */
const RESOLVED_MARKERS = [
  '结果出来了', '通过了', '过了', '没通过', '没过', '成功了', '失败了', '成了', '没成',
  '定了', '解决了', '搞定了', '凉了', '黄了', '算了', '没事了', '已经好',
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hoursBetween(from: number, now: number): number {
  const h = (now - from) / 3_600_000;
  return Number.isFinite(h) && h > 0 ? h : 0;
}

function safeId(prefix: string, seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return `${prefix}_${Math.abs(hash).toString(36)}`;
}

// ════════════════════════════════════════════════════════════
// 1. 从对话中抽取未完待续的事（open loop）
// ════════════════════════════════════════════════════════════

export interface OpenLoopHit {
  /** 指向的话题片段（用于生成动机内容） */
  topic: string;
  /** 抽取依据：命中的原始句子 */
  evidence: string;
}

/**
 * 从一段用户消息里抽取"他说了但还没落定的事"。
 * 规则：①未出现"已落定"标记；②必须命中待结果话题；
 *       且 ③含未完成标记（明天/还没/打算…）或含已发生/进行标记（今天去了/正在…）。
 * 单靠话题词不算（"体检是什么流程"只是提问，不是悬念）。
 */
export function extractOpenLoops(userText: string, maxHits = 1): OpenLoopHit[] {
  if (typeof userText !== 'string') return [];
  const text = userText.trim();
  if (!text) return [];
  if (RESOLVED_MARKERS.some(m => text.includes(m))) return [];

  const hits: OpenLoopHit[] = [];
  // 按句子切，避免跨句误配
  const sentences = text.split(/[。！？!?；;\n]+/).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const topic = PENDING_TOPICS.find(t => sentence.includes(t));
    if (!topic) continue;
    const hasUnresolved = UNRESOLVED_MARKERS.some(m => sentence.includes(m));
    const hasAction = ACTION_MARKERS.some(m => sentence.includes(m));
    if (!hasUnresolved && !hasAction) continue;
    hits.push({
      topic,
      evidence: sentence.length > 40 ? sentence.slice(0, 40) : sentence,
    });
    if (hits.length >= maxHits) break;
  }
  return hits;
}

/**
 * 生成 open loop 的动机内容（具体到可以直接说出口）。
 * ⚠️ 必须区分"他刚说的"与"他之前说的"：把刚说的说成"你之前提过"会造成假记忆
 * （实测模型会照抄这个措辞，说出"你之前提过的那次"——正是幻觉自检要防的）。
 */
export function openLoopMotiveContent(hit: OpenLoopHit, fromCurrentMessage = false): string {
  if (fromCurrentMessage) {
    return `他刚说要去「${hit.topic}」，我想知道具体是什么情况、他心里怎么想`;
  }
  return `他之前提到「${hit.topic}」，还没说后来怎么样了——我想知道结果`;
}

/** 判断一条已有 open loop 是否已被后续消息落定（同一话题 + 落定标记） */
export function isOpenLoopResolved(content: string, laterUserText: string): boolean {
  if (!laterUserText) return false;
  if (!RESOLVED_MARKERS.some(m => laterUserText.includes(m))) return false;
  const topic = PENDING_TOPICS.find(t => content.includes(t));
  if (!topic) return false;
  return laterUserText.includes(topic);
}

// ════════════════════════════════════════════════════════════
// 2. 候选与打分
// ════════════════════════════════════════════════════════════

export interface MotiveCandidate {
  kind: MotiveKind;
  content: string;
  source?: Motive['source'];
  /** 时效锚点（默认 now） */
  formedAt?: number;
}

export interface SelectMotiveInput {
  /** 上一轮结束后的动机池 */
  state?: MotiveState;
  /** 本轮新采集的候选 */
  candidates: MotiveCandidate[];
  /** 用户本轮说的话（用于相关度） */
  userText: string;
  /** 本轮情感状态（用户情绪强烈时让位） */
  emotionState?: EmotionState;
  /** 本轮用户情绪强度（0~1） */
  userIntensity?: number;
  /** L1 学习到的各类型权重（只调权重，不改规则） */
  learning?: MotiveLearningState;
  /** 当前时间 */
  now?: number;
}

export interface MotiveSelection {
  /** 被选中的动机（null = 这一轮她没什么真想说的 → 安静陪伴） */
  selected: Motive | null;
  /** 是否因为"该先接住用户"而让位 */
  deferredToUser: boolean;
  /** 下一轮的池（含习惯化/过期清理结果） */
  nextState: MotiveState;
  /** 诊断信息 */
  diagnostics: { poolSize: number; topSalience: number; reason: string };
}

/** 相关度：动机内容与用户本轮话语的字面重合（复用记忆的 2-gram 相似） */
export function motiveRelevance(content: string, userText: string): number {
  const sim = textSimilarity(content, userText);
  return clamp(1 + sim * 1.5, 1, 2.5);
}

/** 是否应当让位给用户：用户情绪强烈且为负 → 先接住他，不说自己的事 */
export function shouldDeferToUser(state?: EmotionState, userIntensity = 0): boolean {
  if (!state) return false;
  const negative = (state.emotions.sad ?? 0) + (state.emotions.fear ?? 0) + (state.emotions.anger ?? 0);
  return userIntensity >= 0.6 && negative >= 0.35;
}

function salienceOf(motive: Motive, userText: string, now: number): number {
  const base = MOTIVE_BASE_SALIENCE[motive.kind] ?? 0.4;
  const ttl = MOTIVE_TTL_HOURS[motive.kind] ?? 24;
  const ageH = hoursBetween(motive.formedAt, now);
  // 时效：半衰期 = TTL/2（open loop 隔天就该淡）
  const freshness = Math.pow(0.5, ageH / (ttl / 2));
  // 习惯化：提起过就少提；但会随时间恢复（她过些天还会再想起）
  const sinceAttemptDays = hoursBetween(motive.lastAttemptAt ?? motive.formedAt, now) / 24;
  const effectiveAttempts = Math.max(0, motive.attempts - sinceAttemptDays * MOTIVE_ATTEMPT_RECOVERY_PER_DAY);
  const attemptPenalty = 1 / (1 + effectiveAttempts * MOTIVE_ATTEMPT_PENALTY);
  return clamp(base * freshness * attemptPenalty * motiveRelevance(motive.content, userText), 0, 1);
}

/** 清掉过期/废掉的动机（尝试次数会随时间恢复，因此不按 attempts 硬淘汰） */
function prunePool(pool: Motive[], now: number): Motive[] {
  return pool.filter(m => {
    if (m.satisfiedAt) return false;
    const ttl = MOTIVE_TTL_HOURS[m.kind] ?? 24;
    return hoursBetween(m.formedAt, now) < ttl;
  });
}

/** 合并候选进池：同类型且相似视为同一件事（刷新时效、不重复入池） */
export function mergeCandidates(
  pool: Motive[],
  candidates: MotiveCandidate[],
  now: number,
): Motive[] {
  const next = [...pool];
  for (const c of candidates) {
    if (!c || typeof c.content !== 'string' || !c.content.trim()) continue;
    const content = c.content.trim();
    const existing = next.find(m =>
      m.kind === c.kind && textSimilarity(m.content, content) >= MOTIVE_DEDUPE_SIMILARITY);
    if (existing) {
      // 同一件事再次被提起 → 刷新时效（但保留 attempts）
      existing.formedAt = c.formedAt ?? now;
      continue;
    }
    next.push({
      id: safeId(c.kind, content),
      kind: c.kind,
      content,
      source: c.source ?? {},
      salience: MOTIVE_BASE_SALIENCE[c.kind] ?? 0.4,
      formedAt: c.formedAt ?? now,
      expiresAt: now + (MOTIVE_TTL_HOURS[c.kind] ?? 24) * 3_600_000,
      attempts: 0,
    });
  }
  return next
    .sort((a, b) => salienceOf(b, '', now) - salienceOf(a, '', now))
    .slice(0, MOTIVE_POOL_LIMIT);
}

// ════════════════════════════════════════════════════════════
// 2b. L1 反馈学习：只学权重，不改规则（RSI-lite）
// ════════════════════════════════════════════════════════════

/** 学习状态版本号（结构变更时递增，便于识别旧数据） */
export const MOTIVE_LEARNING_VERSION = 1;
/** 达到多少条"说出口"的样本后才开始用回应率调整权重（少样本不学） */
export const MOTIVE_LEARNING_MIN_SAMPLES = 3;
/** 权重下界：任何类型都不会被永久封杀（保留开口的多样性） */
export const MOTIVE_WEIGHT_MIN = 0.5;
/** 权重上界：避免某类型垄断开口方式 */
export const MOTIVE_WEIGHT_MAX = 1.5;
/** 判定"被接住"的关键词重合阈值（无「话题」标记时退回字面相似度） */
export const MOTIVE_LANDED_SIMILARITY = 0.18;

export function createMotiveLearning(now = 0): MotiveLearningState {
  return { version: MOTIVE_LEARNING_VERSION, stats: {}, updatedAt: now };
}

/** 当前权重 = 0.5 + 回应率；样本不足则为中性 1.0（有界 [0.5, 1.5]） */
export function motiveWeight(learning: MotiveLearningState | undefined, kind: MotiveKind): number {
  if (!learning) return 1;
  const stat = learning.stats?.[kind];
  if (!stat || stat.voiced < MOTIVE_LEARNING_MIN_SAMPLES) return 1;
  const landedRate = clamp((stat.landed ?? 0) / Math.max(1, stat.voiced), 0, 1);
  return clamp(MOTIVE_WEIGHT_MIN + landedRate, MOTIVE_WEIGHT_MIN, MOTIVE_WEIGHT_MAX);
}

/**
 * 判定上一轮说出口的动机是否"被接住"：
 * - landed ：他这轮的话里出现了同一件事（话题词重合 / 字面相似）
 * - missed ：完全转到别的话题去了（相似度极低）
 * - unclear：介于两者之间 → 只记样本、不动权重
 */
export function classifyMotiveOutcome(
  voicedContent: string,
  userText: string,
): 'landed' | 'missed' | 'unclear' {
  if (!voicedContent || !userText) return 'unclear';
  // ① 动机内容里的「话题」标记与他的话重合 → 明确被接住
  const topicMatch = voicedContent.match(/「([^」]{1,12})」/);
  if (topicMatch && userText.includes(topicMatch[1])) return 'landed';
  // ② 字面相似度
  const sim = textSimilarity(voicedContent, userText);
  if (sim >= MOTIVE_LANDED_SIMILARITY) return 'landed';
  if (sim <= 0.03) return 'missed';
  return 'unclear';
}

/** 把一次结果记入统计（纯函数） */
export function learnFromOutcome(
  learning: MotiveLearningState | undefined,
  kind: MotiveKind,
  outcome: 'landed' | 'missed' | 'unclear',
  now = Date.now(),
): MotiveLearningState {
  const base = learning ?? createMotiveLearning(now);
  const prev = base.stats?.[kind] ?? { voiced: 0, landed: 0 };
  const next = {
    voiced: prev.voiced + 1,
    landed: prev.landed + (outcome === 'landed' ? 1 : 0),
  };
  return {
    version: MOTIVE_LEARNING_VERSION,
    stats: { ...base.stats, [kind]: next },
    updatedAt: now,
  };
}

/** 汇总可读的回应率（供 /state 观测） */
export function summarizeMotiveLearning(learning: MotiveLearningState | undefined): Array<{
  kind: string; voiced: number; landed: number; landedRate: number; weight: number;
}> {
  if (!learning?.stats) return [];
  return Object.entries(learning.stats).map(([kind, s]) => ({
    kind,
    voiced: s.voiced,
    landed: s.landed,
    landedRate: s.voiced > 0 ? Math.round((s.landed / s.voiced) * 100) / 100 : 0,
    weight: Math.round(motiveWeight(learning, kind as MotiveKind) * 100) / 100,
  })).sort((a, b) => b.voiced - a.voiced);
}

// ════════════════════════════════════════════════════════════
// 3. 竞选：选 0 或 1 个动机
// ════════════════════════════════════════════════════════════

export function selectMotive(input: SelectMotiveInput): MotiveSelection {
  const now = input.now ?? Date.now();
  // 预取的候选（LLM 具体化产物）与本轮即时候选一起入池，合并后清空预取槽
  const incoming: MotiveCandidate[] = [
    ...(input.state?.pendingCandidates ?? []),
    ...input.candidates,
  ];
  const pool = prunePool(
    mergeCandidates(input.state?.pool ?? [], incoming, now),
    now,
  );
  const deferredToUser = shouldDeferToUser(input.emotionState, input.userIntensity ?? 0);

  const scored = pool
    .map(m => {
      let salience = salienceOf(m, input.userText ?? '', now);
      // L1：按"这个类型的开口方式历史上被他接住的比例"调权（有界，只调权重）
      salience *= motiveWeight(input.learning, m.kind);
      // 刚刚提过的那件事：短时间内再提要额外打折（防"连续两轮追问同一件事"）
      const sinceH = hoursBetween(input.state?.lastSelectedAt ?? 0, now);
      const inRepeatWindow = sinceH < MOTIVE_REPEAT_WINDOW_H;
      if (inRepeatWindow) {
        const sameMotive = input.state?.lastSelectedId === m.id;
        // 话题级：换了动机类型但说的还是同一件事，同样要压
        const sameTopic = Boolean(input.state?.lastSelectedContent)
          && textSimilarity(m.content, input.state!.lastSelectedContent!) >= MOTIVE_REPEAT_SIMILARITY;
        if (sameMotive || sameTopic) salience *= MOTIVE_REPEAT_PENALTY;
      }
      return { motive: m, salience };
    })
    .sort((a, b) => b.salience - a.salience);
  const top = scored[0];

  const nextState: MotiveState = {
    pool,
    pendingCandidates: [], // 已合并入池
    lastSelectedId: input.state?.lastSelectedId,
    lastSelectedContent: input.state?.lastSelectedContent,
    lastSelectedKind: input.state?.lastSelectedKind,
    lastSelectedAt: input.state?.lastSelectedAt,
  };

  if (deferredToUser) {
    nextState.lastSelection = {
      at: now, reason: '用户情绪强烈 → 先接住他，本轮不表达自己的事', deferred: true,
    };
    return {
      selected: null,
      deferredToUser: true,
      nextState,
      diagnostics: {
        poolSize: pool.length,
        topSalience: top?.salience ?? 0,
        reason: nextState.lastSelection.reason,
      },
    };
  }

  if (!top || top.salience < MOTIVE_MIN_SALIENCE) {
    const reason = pool.length === 0 ? '内心没有挂着的事 → 安静陪伴' : '动机紧迫度不足 → 安静陪伴';
    nextState.lastSelection = { at: now, reason, deferred: false };
    return {
      selected: null,
      deferredToUser: false,
      nextState,
      diagnostics: {
        poolSize: pool.length,
        topSalience: top?.salience ?? 0,
        reason,
      },
    };
  }

  const selected: Motive = { ...top.motive, salience: Math.round(top.salience * 100) / 100 };
  nextState.lastSelectedId = selected.id;
  nextState.lastSelectedContent = selected.content;
  nextState.lastSelectedKind = selected.kind;
  nextState.lastSelectedAt = now;
  const reason = `选中「${selected.kind}」：${selected.content.slice(0, 30)}`;
  nextState.lastSelection = {
    at: now, reason, selectedKind: selected.kind, deferred: false,
  };
  return {
    selected,
    deferredToUser: false,
    nextState,
    diagnostics: {
      poolSize: pool.length,
      topSalience: top.salience,
      reason,
    },
  };
}

/**
 * 生成前：把选中的动机记为"已提起"（习惯化），返回新池。
 * 生成后若用户明显回应了这件事，可另调 satisfyMotive。
 */
export function markMotiveAttempted(state: MotiveState, motiveId: string, now = Date.now()): MotiveState {
  return {
    ...state,
    pool: state.pool.map(m => (m.id === motiveId
      ? { ...m, attempts: m.attempts + 1, lastAttemptAt: now }
      : m)),
  };
}

/** 闭环：用户回应了这件事 → 从池中移除 */
export function satisfyMotive(state: MotiveState, motiveId: string, now = Date.now()): MotiveState {
  return {
    ...state,
    pool: state.pool.map(m => (m.id === motiveId ? { ...m, satisfiedAt: now } : m)),
  };
}

/** 用后续消息解除已落定的 open loop（"结果出来了""黄了"） */
export function resolveOpenLoops(state: MotiveState, laterUserText: string, now = Date.now()): MotiveState {
  if (!laterUserText) return state;
  return {
    ...state,
    pool: state.pool.map(m => (
      m.kind === 'open_loop' && isOpenLoopResolved(m.content, laterUserText)
        ? { ...m, satisfiedAt: now }
        : m
    )),
  };
}

// ════════════════════════════════════════════════════════════
// 5. 价值观立场 → 具体动机内容
// ════════════════════════════════════════════════════════════

/**
 * 把"她最珍视的价值"翻译成一句具体的、她真想说的话。
 * 立场型动机是角色内在性最强的一类：不是"想聊天"，而是"我想按我在意的方式对待这段关系"。
 */
export const VALUE_STANCE_LINES: Record<string, string> = {
  connection: '我在意的是真的连上，不是聊了多少句——我想问他刚才那件事到底怎么样',
  autonomy: '我不想每次都顺着说好，这次想把自己的想法讲清楚',
  honesty: '我不想为了让他舒服就把话咽回去，我想直接说我真实的感受',
  playfulness: '我想逗他一下，别总是这么正经地说事',
  security: '我想确认我们之间是稳的，不需要靠热闹来证明',
  growth: '我在想我们上次那点不愉快，其实可以拿出来说说',
  respect: '如果他那句话带着轻慢，我想让他知道我不接受',
  passion: '我想离他近一点，不只是说说话',
};

export function valueStanceMotive(valueId: string): string | null {
  return VALUE_STANCE_LINES[valueId] ?? null;
}

/** 内在状态 → 具体动机内容（心情明显偏离中性时） */
export function moodStateMotive(moodValence: number): string | null {
  if (!Number.isFinite(moodValence)) return null;
  if (moodValence <= -0.25) return '我今天状态有点低，不太想强撑着说话';
  if (moodValence >= 0.25) return '我今天心情不错，有点想跟他说说话';
  return null;
}

/** 记忆回响 → 具体动机内容 */
export function memoryEchoMotive(injectionText: string, memoryId?: string): MotiveCandidate | null {
  const text = (injectionText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    kind: 'memory_echo',
    content: `我想起${text.slice(0, 60)}`,
    source: { memoryId },
  };
}

// ════════════════════════════════════════════════════════════
// 6. Prompt 片段（放 Prompt 末尾：注意力最高处）
// ════════════════════════════════════════════════════════════

export function motiveToPromptSnippet(selected: Motive | null): string {
  if (!selected) {
    return [
      '【此刻】你心里没有特别挂着的事。',
      '那就安静地陪着：可以只回应他、可以只给一个动作或一句很短的话。',
      '不要为了维持对话而泛问（"今天怎么样""在干嘛""忙不忙"这类空话一律不要）。',
    ].join('\n');
  }
  return [
    `【此刻我心里挂着的事】${selected.content}`,
    '本轮开口就从这件事出发——如果你想问他什么，问的应该是这件事的具体下文，而不是泛泛的关心。',
    '如果他此刻的情绪更需要被接住，就先接住他，这件事可以下一轮再提。',
    '不要说出"我心里挂着"这类元描述，直接自然地表达。',
  ].join('\n');
}

/** 供 /state 观测 */
export function describeMotive(selected: Motive | null, deferred: boolean): string {
  if (deferred) return '让位给用户情绪（本轮不表达自己的事）';
  if (!selected) return '无动机（安静陪伴）';
  return `${selected.kind}：${selected.content}`;
}
