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
  EmotionState, Motive, MotiveAction, MotiveKind, MotiveState, MotiveLearningState,
} from './emotionTypes';
import { textSimilarity } from './memoryEnhancer';
// v1.17：判定"他有没有接住这件事"改用词面锚点（共享非虚词片段），不再用相似度阈值。
// 复用评价层里已标定过的那套（最长公共子串 + 虚词表），避免同一个概念两处各写一份。
import { topicAnchor, STOP_ANCHORS, APPRAISAL_TOPIC_MIN_ANCHOR } from './appraisal';
import { provenanceForUserMemory, type MemoryProvenance } from './memoryProvenance.js';

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
  /**
   * v1.60-p0：这件**心理内容／愿望**的来源归属（`owner` 不是「这条记忆属于谁」）。
   * `memory_echo` 的种子记忆来自他的话 ⇒ `owner: user`。
   * ⚠️ 本阶段**只携带、不消费**：`checkProvenance()` 还没接进生成后。
   */
  provenance?: MemoryProvenance;
  /** 这条动机对应的记忆 id（漂移证据要能指回来源）*/
  memoryId?: string;
  kind: MotiveKind;
  content: string;
  source?: Motive['source'];
  /** 时效锚点（默认 now） */
  formedAt?: number;
  /**
   * v1.49：**这一条**的基准紧迫度（缺省取该类型的先验 `MOTIVE_BASE_SALIENCE[kind]`）。
   *
   * 为什么需要实例级：类型的先验是**一个数**，而有些动机的"该不该说"取决于**程度**。
   * `state`（她自己的状态）就是典型：先验 0.40 意味着"心情刚有点低"和"低到快撑不住"
   * 一样紧迫 —— 于是它既会在小事上多余、又在真正的低谷里抢不过任何人。
   */
  base?: number;
}

export interface SelectMotiveInput {
  /** 上一轮结束后的动机池 */
  state?: MotiveState;
  /** 本轮新采集的候选 */
  candidates: MotiveCandidate[];
  /** 用户本轮说的话（用于相关度） */
  userText: string;
  /**
   * v1.28 让位判定的依据：**这一轮开始前**她最强的负情绪激活量（相对人格本性）。
   *
   * ⚠️ 为什么不是 `EmotionState`：让位的语义是「**她本来**就已经沉在里面 → 今天先不说自己的事」，
   * 而 `selectMotive` 是在**刺激施加之后**被调用的 —— 传当前状态进来，读到的是"他这一句把她推了多少"。
   * 实测（`scripts/check-defer-threshold.ts`）：他一句强度 0.70 的话单轮就把静息的她推到绝对值 **0.32**
   * （门槛 0.35），她起始多沉 0.10 只让终点多 0.017 却跨过门槛 ⇒ 让位被"他这一句"翻来翻去。
   * 所以要求调用方**显式**传一个"刺激之前"的量（与 `dialogueStrategy` 的 Rule 1 同源同尺）。
   */
  herNegativeBeforeTurn?: { emotion: string; intensity: number } | null;
  /**
   * v1.31 候选：他本轮表达的**情绪键**（`UserEmotionAnalysis.expressedEmotion`，可为空）。
   * 传了且明确负面 ⇒ 让位门槛降到 `DEFER_USER_INTENSITY_MODERATE`（0.4）。
   * **不传 = 旧门槛 0.6**：调用方漏传只会退回 v1.30 的行为，不会悄悄变成新行为。
   */
  userEmotion?: string | null;
  /** 本轮用户情绪强度（0~1） */
  userIntensity?: number;
  /**
   * v1.39 她自己的低谷读数（低谷读数里的 `{active, established}`，由调用方算好传进来）。
   * 传了且开关打开 ⇒ 走"她自己在低谷"那条让位路。**不传 = 旧行为**（与 `userEmotion` 同一套路，
   * 调用方漏传只会退回 v1.38 的行为，不会悄悄变成新行为）。
   *
   * ⚠️ 别在这里写出低谷模块的读法函数名：`lowPeriod.test.ts` 的守卫是**源码文本扫描**，
   * 连注释一起扫（它挡的正是"注释里说不用、代码里在用"）。
   */
  herLowPeriod?: { active: boolean; established: boolean } | null;
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
  /**
   * v1.28 让位时给他的**具体锚**（有则注入 Prompt，无则退回原来的"安静陪着"文案）。
   * 让位不等于"她心里什么都没有"—— 她手里往往正好有一件**关于他**的、有下文的事。
   */
  deferAnchor: { kind: MotiveKind; content: string } | null;
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

/** v1.28 让位时的"他情绪强烈"门槛 */
export const DEFER_USER_INTENSITY = 0.6;
/**
 * v1.31：他**明确是负面情绪**（情绪键落在下面这组）时，让位门槛降到 0.4。
 *
 * 由来（`scripts/probe-moderate-emotion.ts`，真管道）：0.4~0.7 档曾经是唯一一处
 * "他越明确地说难受、她越不接"的地方 —— 一句承认都没有（承认 0.13），全是"是当众说的还是私下里？"
 * 这类二选一追问；而 0.4 以下那档反而正常（承认 0.50~0.67）。**先否掉了两个错误方向**：
 *   ① v1.27 担心的"她会转去聊宠物/美食"——**证伪**：她自己话题 0.00（40 个样本），
 *      `explore` 片段本身写的是"顺着他的话追问"，`params` 里那个兴趣名从没进过回复；
 *   ② 换**策略**标签（加一条"中等强度也共情"的 Rule 1.5）——**没用**：承认 0.00→0.13、二选一追问 0.75→1.00（代码已回滚）。
 * 真因在动机层：他这句话里有可抽取的"悬念"（面试没过 → `open_loop`），动机片段就要求她"问它的具体下文"。
 * 而 v1.30 已实测"不给她那件事 ⇒ 她只是陪着"（在场 8/8、追问 0.08）—— 所以这里**复用让位那条已验通路**，
 * 只按"他是不是明说了负面情绪"把门槛分档。
 *
 * 加样本量复测（n=8/句，0.40 与 0.49 两句，16 样本/臂）：
 *
 * | 指标 | 关（门槛 0.6） | 开（明确负面时 0.4） |
 * |---|---|---|
 * | **承认他的感受** | 0.13（2/16 条有） | **0.81（13/16 条有）** |
 * | 问句数 / 二选一追问 | 1.44 / 0.81 | 1.38 / 0.81（没变） |
 * | 在场感 | 0.00 | 0.00（他这句话没到"强烈"，本就不该只回"我在"） |
 * | 让位是否生效 | 0/16 | **16/16** |
 *
 * ⇒ 它**只修好了本来坏掉的那根轴**（先承认他在难受），没有副作用到追问/长度。
 */
export const DEFER_USER_INTENSITY_MODERATE = 0.4;
/** 他表达的情绪落在这些键上 ⇒ 视为"明确负面"（键由 `emotionCanonical` 归一，中英/口语都收） */
export const NEGATIVE_USER_EMOTIONS: ReadonlySet<string> =
  new Set(['sad', 'anger', 'fear', 'disgust']);
/**
 * v1.28「她**本来**就已经沉在里面」的门槛（激活量，相对人格本性）。
 *
 * 与 `dialogueStrategy.ACCOMPANY_WHEN_SHE_SINKS` **同为 0.12、同一语义** ——
 * 两处都在问"她是不是本来就已经沉了"，就不该一个用 0.12、一个用绝对值 0.35（同一个意思两个含义）。
 * 门槛的稳定性由 `scripts/check-defer-threshold.ts` 离线扫参确认：h=0 时**无论他多强都不让位**。
 */
export const DEFER_HER_SINK = 0.12;
/** 供离线扫参脚本使用（换门槛前先看"让位地图"） */
export const DEFER_HER_SINK_CANDIDATES = [0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25];

/**
 * 是否应当让位给用户：他情绪强烈，**且她自己本来就已经沉在里面** → 今天先不说自己的事。
 *
 * v1.28：判据从「刺激之后的绝对值 `sad+fear+anger ≥ 0.35`」改成「**刺激之前**的激活量 ≥ 0.12」。
 * 前者把"他这一句的推力"直接算进了"她的沉"（绝对值在 sad/fear/anger 上的静息底座是 0），
 * 于是他越强她越让位、与她自己本来怎样无关；后者才回答原来那个问题。
 *
 * v1.31：第三参数 `userEmotion` 是他的**情绪键**（`expressedEmotion`，可空）。传了且落在
 * `NEGATIVE_USER_EMOTIONS` 上 ⇒ 门槛用 `DEFER_USER_INTENSITY_MODERATE`（0.4）。**不传 = 旧行为**
 * （门槛 0.6），所以调用方漏传只会退回 v1.30 的行为，不会悄悄变成新行为。
 */
export function shouldDeferToUser(
  herNegativeBeforeTurn?: { emotion: string; intensity: number } | null,
  userIntensity = 0,
  userEmotion?: string | null,
): boolean {
  if (!herNegativeBeforeTurn) return false;
  const explicitNegative = Boolean(userEmotion) && NEGATIVE_USER_EMOTIONS.has(userEmotion as string);
  const threshold = explicitNegative ? DEFER_USER_INTENSITY_MODERATE : DEFER_USER_INTENSITY;
  return userIntensity >= threshold && herNegativeBeforeTurn.intensity >= DEFER_HER_SINK;
}

/**
 * v1.39 「**她自己在低谷**」也走让位 —— 开关，默认关。
 *
 * 与前一条的区别是**判据完全不同**，别混：
 * - `shouldDeferToUser`：他这句话很强 **且** 她本来也沉 ⇒ 先接住他（**由他触发**）；
 * - 这一条：**只看她自己在低谷**，与他这句话强弱无关 ⇒ 本轮不去追问他的事（**由她触发**）。
 *
 * 人设裁定（2026-09）：她低谷时"自闭"= **自己给自己打气、自己调整自己；主动性降低、但不是没有**。
 * 复用让位通路（v1.30 已裁定该路走 `omit`：**整块不给**，而不是给个锚把她推向"处理那件事"）——
 * 因为"她今天没力气接话"与"她今天先不说自己的事"在**表达层**是同一件事：本轮别在 Prompt 里
 * 塞一件"关于他的待办"。
 *
 * ⚠️ 为什么必须挑**他情绪不强**的场景来测（否则又是没有下降空间的假终点）：
 * 他明确负面 + 她沉时，`shouldDeferToUser` **本来就会**让位 ⇒ 那条路上两臂永远一样。
 * 这一条要测的是**他说的是平常事**（她本会追问的那些），她低谷时才收住。
 */
export function lowPeriodHoldBackEnabled(): boolean {
  return process.env.ENABLE_LOW_PERIOD_HOLD_BACK === 'true';
}

/** 让位闸门：`period`（默认）= 整段（要求"已成段"，≥2 次落定）；`turn` = 只看这一次落定 */
export type LowPeriodHoldBackGate = 'period' | 'turn';
export function lowPeriodHoldBackGate(): LowPeriodHoldBackGate {
  return process.env.LOW_PERIOD_HOLD_BACK_GATE === 'turn' ? 'turn' : 'period';
}

/**
 * 是否因"她自己在低谷"而收住本轮。
 * 结构参数（不 import `lowPeriod`）：与 `herNegativeBeforeTurn` 同一套路，调用方显式传一个已算好的读数。
 */
export function shouldHoldBackForLowPeriod(
  low?: { active: boolean; established: boolean } | null,
): boolean {
  if (!lowPeriodHoldBackEnabled() || !low) return false;
  return lowPeriodHoldBackGate() === 'turn' ? low.active : low.established;
}

/**
 * v1.28 让位时挑一条"关于他的"具体锚。
 *
 * 优先 `open_loop`（他说了但没落定的事，如"面试那事有消息了吗"）—— 那本来就是**关于他、且有下文**的事，
 * 正好用来"接住他"；找不到就返回 null，**保持"允许为空"**（不为了填满空间而硬造素材）。
 * 注意：这里只是**借用**它当锚，`selected` 仍是 null ⇒ 不算"她又提了一次自己的事"（不做习惯化记账）。
 */
export function pickDeferAnchor(
  scored: Array<{ motive: Motive; salience: number }>,
): { kind: MotiveKind; content: string } | null {
  const top = scored.find(s => s.motive.kind === 'open_loop');
  return top ? { kind: top.motive.kind, content: top.motive.content } : null;
}

function salienceOf(motive: Motive, userText: string, now: number): number {
  // v1.49：**实例级**基准优先（`Motive.base`），否则取类型先验。
  // 类型先验是"这一类事一般多要紧"，而有些动机的程度差异必须落在实例上（见 `stateMotiveFor`）。
  const base = motive.base ?? MOTIVE_BASE_SALIENCE[motive.kind] ?? 0.4;
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
      ...(c.base === undefined ? {} : { base: c.base }),
      // v1.60-p0：**扩展字段必须显式带过去**。这里是候选进池的**唯一重建点**，
      // 而它是白名单式字面量 ⇒ 没列出的字段会被**静默丢掉**。
      // P0-1 实测（`scripts/check-p0-selectmotive-retention.ts`）：修前 kind 存活、memoryId/provenance 丢失。
      ...(c.memoryId === undefined ? {} : { memoryId: c.memoryId }),
      ...(c.provenance === undefined ? {} : { provenance: c.provenance }),
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
/**
 * 判定"**没**被接住"的字面相似度**上界**（低于它、且两边没有任何实词锚点 → missed）。
 *
 * v1.17 起"被接住"改由 `topicAnchor()`（共享非虚词片段）判定，不再用相似度阈值 ——
 * 旧的 `MOTIVE_LANDED_SIMILARITY = 0.18` 实际是靠 `textSimilarity` 的"近似超集"加成在过关，
 * 那个加成已因会误合并两条不同的记忆而收紧（见 memoryEnhancer）。
 */
export const MOTIVE_MISSED_SIMILARITY = 0.03;

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
  // ② **词面锚点**：只要两边共享一个"够长、且不是常见虚词"的片段，就算他接住了这件事。
  //
  // v1.17：原来这里是 `textSimilarity(...) >= MOTIVE_LANDED_SIMILARITY(0.18)`，
  // 而那个阈值**是靠 `textSimilarity` 的"近似超集"加成在过关**：用例
  //   「我今天状态有点低，不想强撑着说话」<=>「你今天状态不太好吗」
  // 长度比 0.6 → 旧代码走 overlap 档拿到 0.25；去掉那个加成后退回纯 Jaccard 只剩 **0.083**。
  // 但**不能**因此把阈值降到 0.08：那样任何两句共享一个「今天」都会被判成"他接住了"，
  // 正是刚修掉的那类假阳性 —— 而 landedRate 会喂给 L1 权重学习，误判会连锁。
  // 换成锚点判断后语义也更对：**共享实词才算接住**（本例共享「天状态」）。
  const anchor = topicAnchor(voicedContent, userText);
  if (anchor) return 'landed';
  const sim = textSimilarity(voicedContent, userText);
  if (sim <= MOTIVE_MISSED_SIMILARITY) return 'missed';
  return 'unclear';
}

/**
 * v1.53：**"他接住了她这句话吗"改成双通道**。
 *
 * 老判据只有一条通道：**共享实词锚点**（他接着说这件事）。对 `open_loop`/`worry`/`memory_echo`/`curiosity`
 * 这类**话题型**动机构成立；可 `wish`（她想要什么）/`stance`（她的态度）/`state`（她自己的状态）
 * **没有"这件事"可接** —— 他再怎么回应也不会复述她的愿望或态度
 * ⇒ 真实账本里这三类的 `landed` 结构性地恒为 0（`wish` 29 发声 / 0 落地、`stance` 3 / 0）⇒ 权重被罚到 0.5。
 *
 * 第二条通道：**他明确在回应她这句话**（而不是"接着这件事说"）：
 *   ① 他问了（问号）② 他对着她说（"你"，但要排掉「我**跟你**说个事」这种另起话题的套话）
 *   ③ 他在表态（`ENGAGE_RE`："你说得对 / 我倒觉得 / 我也觉得 / 怎么了 / 陪你 …"）。
 *
 * 两条通道是 **OR**，对所有类型一致适用（不是"按类型分流"）—— 因为缺的正是第二条通道，
 * 而第一条对它本来成立的那几类仍然需要（冻结标注集里 `memory_echo` +「你还记得那事啊」
 * 只有第二条通道能认出来）。
 *
 * 反向：**敷衍短应答**（"嗯/哦/好的"）与**只收下不接**（"好的，我记下了"）判 `missed`；
 * 其余判 `unclear`（**不硬判** —— v1.17 记过：误判会经 landedRate 连锁到权重）。
 */
/** 敷衍式短应答（去掉标点与语气词后很短）*/
const FLAT_ACK_CHARS = /^[嗯哦噢唔好的是对行可以知道明白收到了解我你了的啊呀吧呢~]{1,7}$/;
/** 只收下、不接（"好的，我记下了"）*/
const ACK_ONLY_RE = /^(好的?|行|嗯)?[，,]?(我)?(记下|记住|知道|明白|收到|了解|懂了)了?[。.!！]?$/;
/** 另起话题的套话（里面的"你"不是在回应她那句）*/
const TOPIC_CHANGE_RE = /(我)?(跟你|和你说|跟您)|你听我(说|讲)|我(跟|和)你说个事/;
/** 回应/表态词：他在对**她那句话**表态（不是复述话题）*/
const ENGAGE_RE = /你说得对|你说的是|我倒|我也觉得|我觉得|我同意|我不同意|不一定|也是|对啊|你这么|你这话|你这句|你还记得|怎么了|跟我(?:说|讲)|陪你|别硬撑|早点休息/;

/**
 * 通道①的**本地加强**：光有公共子串还不够，**去掉虚词后要剩下 ≥2 个实字**。
 *
 * 起因：「我今天心里有点闷」vs「我今天也挺累的」的最长公共子串是「我今天」——
 * 一个纯时间词巧合就被判成"他接住了这件事"（旧判据的原话就是怕这个："分不出
 * 同一件事和碰巧都有今天"）。此处只在**本判据内部**收紧，不动 `appraisal.ts` 的 `topicAnchor`
 *（评价层也在用它，改它属于另一条已上线通路 —— 已在债务表记下）。
 */
function informativeAnchor(concern: string, text: string): boolean {
  const a = topicAnchor(concern, text);
  if (!a) return false;
  const informative = [...a].filter(ch => ![...STOP_ANCHORS].some(s => s.includes(ch)));
  return informative.length >= APPRAISAL_TOPIC_MIN_ANCHOR;
}

/**
 * v1.53：**第二通道** —— 他明确在回应她这句话吗（问 / 对着她说 / 表态）。
 * 纯函数、只看他那句话的表面；理解不了"他用一个动作回应"这类隐含接住（与老判据同一个量级）。
 */
export function looksResponsiveToHer(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  const bare = t.replace(/[\s，。！？、,.!?~～…—-]/g, '');
  if ((t.includes('？') || t.includes('?')) && bare.length > 2) return true;        // 他问了（"哦？"不算）
  if (t.includes('你') && !TOPIC_CHANGE_RE.test(t)) return true;                    // 对着她说
  if (ENGAGE_RE.test(t)) return true;                                                // 他在表态
  return false;
}

/**
 * v1.53：双通道判据 —— **已上线（默认开）**。
 *
 * 为什么敢默认开：
 *   · 冻结标注集 25 条：与人工标签一致率 老判据 52% → **新判据 88%**（非话题型 43% → 93%，过了事先定的 80%）；
 *   · 真管道确认（`ab-motive-outcome-signal.ts`，读**学习账本的计数**、不经过她的话术）：
 *     治疗格 A 臂 landed 全 0 / B 臂全 1（8/8 各自一致），他敷衍时两臂都 0、话题型两臂都 1 ⇒ 通过；
 *   · 设计边界仍在：把新落地率喂进权重后 `open_loop` 依然最高（0.93 vs 次高 0.72）；
 *   · **风险已被 v1.52 框住**：权重现在只影响"够格者之间的排序"，不再能封杀某一类。
 *
 * ⚠️ 证据等级：标注集是**我自己标的**（不是第三方标注），所以这一条的证据强度低于真管道 A/B；
 *    上线后应拿**真实账本**再核一次那条边界（债务表 v1.53 行）。
 *
 * 回退：`DISABLE_MOTIVE_PER_KIND_OUTCOME=true` → 逐字回到老判据（她那几类又恒为 0）。
 */
export function motivePerKindOutcomeEnabled(): boolean {
  return process.env.DISABLE_MOTIVE_PER_KIND_OUTCOME !== 'true';
}

/** 敷衍 / 只收下 —— 单独抽出来给测试与校准脚本看 */
export function looksDismissive(hisText: string): boolean {
  const t = hisText.trim();
  if (!t) return false;
  const bare = t.replace(/[\s，。！？、,.!?~～…—-]/g, '');
  return FLAT_ACK_CHARS.test(bare) || ACK_ONLY_RE.test(t);
}

/**
 * v1.53：按双通道判定"他接住了吗"。开关关着时**逐字**走老逻辑。
 */
export function classifyOutcomeFor(_kind: MotiveKind, voicedContent: string, userText: string) {
  if (!motivePerKindOutcomeEnabled()) return classifyMotiveOutcome(voicedContent, userText);
  // ① 老通道：共享实词锚点（他接着说这件事）
  const topicMatch = voicedContent.match(/「([^」]{1,12})」/);
  if (topicMatch && userText.includes(topicMatch[1])) return 'landed';
  if (informativeAnchor(voicedContent, userText)) return 'landed';
  // ② 新通道：他明确在回应她这句话
  if (looksResponsiveToHer(userText)) return 'landed';
  // ③ 反向：敷衍 / 只收下
  if (looksDismissive(userText)) return 'missed';
  // ④ 都没接上，而且两边几乎不搭 ⇒ 明确没接（沿用老判据那条线，别把它丢了）
  if (textSimilarity(voicedContent, userText) <= MOTIVE_MISSED_SIMILARITY) return 'missed';
  return 'unclear';   // 不硬判
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
  const userDefer = shouldDeferToUser(
    input.herNegativeBeforeTurn, input.userIntensity ?? 0, input.userEmotion);
  // v1.39：她自己在低谷（与他这句话强弱无关）—— 两条路都通向"本轮别在 Prompt 里塞一件关于他的待办"
  const lowHold = shouldHoldBackForLowPeriod(input.herLowPeriod);
  const deferredToUser = userDefer || lowHold;

  const scored = pool
    .map(m => {
      let salience = salienceOf(m, input.userText ?? '', now);
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
      // v1.52：这里的分**不含学习权重** —— 门槛该看它（"这件事值不值得开口"是情境问题），
      //        而学习权重只该决定"够格开口的那些里谁最该说"（排序问题）。见下面的 rawGate。
      const raw = salience;
      // L1：按"这个类型的开口方式历史上被他接住的比例"调权（有界，只调权重）
      salience *= motiveWeight(input.learning, m.kind);
      return { motive: m, salience, raw };
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
    // v1.28：让位不等于"她心里什么都没有" —— 手里那件**关于他**的事正好用来接住他
    const deferAnchor = pickDeferAnchor(scored);
    // v1.39：两条让位路的理由必须**分得开**（`/state → motive` 上要能看出是哪条触发的，
    // 否则 A/B 的操纵检查没法证明"这一轮真的走了新分支"）
    const reason = lowHold && !userDefer
      ? '她这几天就在低谷里（与她这一刻的情绪强度无关）→ 本轮只接住他，不去追问细节'
      : '她自己本来就已经沉在里面 → 先接住他，本轮不表达自己的事';
    nextState.lastSelection = {
      at: now, reason, deferred: true,
      deferAnchor,
    };
    return {
      selected: null,
      deferredToUser: true,
      deferAnchor,
      nextState,
      diagnostics: {
        poolSize: pool.length,
        topSalience: top?.salience ?? 0,
        reason: nextState.lastSelection.reason,
      },
    };
  }

  // v1.52：门槛看**加权前**的分（开关）。理由：学习权重的下界 0.5 会把"样本刚够、还没被接住过"
  // 的那几类整体减半，而门槛是按**未加权**的先验标定的 ⇒ `curiosity`(0.26)/`stance`(0.23)
  // 连"刚形成、无重复惩罚"都过不了 ⇒ 它们**事实上永远开不了口**（v1.51 量出）。
  // 注释里写的"下界保证任何开口方式都不会被封杀"要成立，就得这样分工。
  const eligible = motiveRawGateEnabled()
    ? scored.filter(x => x.raw >= MOTIVE_MIN_SALIENCE)
    : scored;
  const gated = eligible[0] ?? null;
  if (!gated || (!motiveRawGateEnabled() && gated.salience < MOTIVE_MIN_SALIENCE)) {
    const reason = pool.length === 0 ? '内心没有挂着的事 → 安静陪伴' : '动机紧迫度不足 → 安静陪伴';
    nextState.lastSelection = { at: now, reason, deferred: false };
    return {
      selected: null,
      deferredToUser: false,
      deferAnchor: null,
      nextState,
      diagnostics: {
        poolSize: pool.length,
        topSalience: top?.salience ?? 0,
        reason,
      },
    };
  }

  const selected: Motive = { ...gated.motive, salience: Math.round(gated.salience * 100) / 100 };
  nextState.lastSelectedId = selected.id;
  nextState.lastSelectedContent = selected.content;
  nextState.lastSelectedKind = selected.kind;
  nextState.lastSelectedAt = now;
  const reason = `选中「${selected.kind}」：${selected.content.slice(0, 30)}`;
  nextState.lastSelection = {
    at: now, reason, selectedKind: selected.kind, deferred: false,
    // v1.60-p0：来源归属随选中结果一起留档（`/state → motive.thisTurn` 读的就是它）
    memoryId: selected.memoryId,
    provenance: selected.provenance,
  };
  return {
    selected,
    deferredToUser: false,
    deferAnchor: null,
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

/**
 * 内在状态 → 具体动机内容（心情偏离中性时）。**分档**，不是一句话（v1.49）。
 *
 * ⚠️ v1.49 改过门槛：原来是 `|valence| ≥ 0.25` 一刀切，而 `|mood.valence|` 的实际可达带
 * **跨不过 0.25**（`scripts/play-state-motive.ts` 预演，零 LLM）：
 * 采样 `moodSampleFrom` = `(正−负)/1.5`，连续几轮的 `updateMood` alpha 落到下界 0.02 ⇒
 * `sad 0.13`（v1.13 实测"8 轮共情"后的值）极限 **−0.087**、`sad 0.33` 极限 **−0.220** ——
 * 都跨不过 0.25，`sad 0.40` 也要 200+ 轮才到 −0.24。
 * ⇒ 这条动机**事实上从不形成**（"先验 0.40 抢不到"只是第二道坎，第一道坎更早）。
 * 现在门槛降到可达带内（{@link STATE_MOOD_MIN}），并**按档给内容**。
 */
export function moodStateMotive(moodValence: number): string | null {
  if (!Number.isFinite(moodValence)) return null;
  if (moodValence <= -0.22) return '我今天状态有点低，不太想强撑着说话';
  if (moodValence <= -STATE_MOOD_MIN) return '我今天心里有点闷，说不太清楚';
  if (moodValence >= STATE_MOOD_MIN) return '我今天心情不错，有点想跟他说说话';
  return null;
}

/**
 * v1.49：`state`（她自己的状态）的**基准紧迫度**—— 连续映射，不再是常数 0.40。
 *
 * 为什么必须连续：原来的先验是**一个数**，于是"心情刚有点低"与"低到快撑不住"一样紧迫。
 * 后果两头都坏：小情绪上多余（抢不过也就罢了），真低谷里又**照样抢不过**
 * （预演实测裸分 0.38，输给 open_loop 0.76 / worry 0.57 / wish 0.44 / memory_echo 0.42 / curiosity 0.39，只赢 stance 0.37）。
 *
 * 标定（全部来自预演的实测数字，不是拍的）：
 * - `STATE_MOOD_MIN = 0.10`：低于此不说。`describeMood` 自己把 −0.15 叫作"心情有点低落"
 *   ⇒ 0.10 正好在它下面一点；而且这是**可达**的（`sad 0.20` 的极限 −0.133 能跨过）。
 * - `STATE_MOOD_FULL = 0.28`：**实测可达带的深端**（`sad 0.40` 的极限 −0.267；线上重低谷期采样 ≈ −0.23~−0.30）。
 * - `STATE_BASE_AT_MIN = 0.44`：刚过线时**赢得过** stance(0.46 的新鲜度折后 0.37)/curiosity(0.39)/memory_echo(0.42)，
 *   输给 worry(0.57)。即"轻微低落时，她自己的状态比一条小好奇心更值得说，但不是压倒一切"。
 * - `STATE_BASE_MAX = 0.72`：**刻意低于 `open_loop` 的先验 0.80** —— 这是**设计边界**，不是巧合：
 *   她那件"还没落定的事"永远优先；她自己的状态再深，也不该把它挤掉。
 *   （也低于 worry 0.70 的新鲜度折后值吗？不 —— 0.72 > 0.70×0.82=0.57，所以深低谷时她会说自己的状态。这正是要的。）
 */
export const STATE_MOOD_MIN = 0.10;
export const STATE_MOOD_FULL = 0.28;
export const STATE_BASE_AT_MIN = 0.44;
export const STATE_BASE_MAX = 0.72;

/**
 * v1.49c：池里（或待合并的候选里）**是否已经有一条 `state`**。
 *
 * 用途是"别同时给两句自述"：`state` 现在有**两条**产它的路 ——
 * 规则层的模板句（`stateMotiveFor`，本轮即时）与第 2 层具体化产出的、更具体的一句
 * （`motiveSpecificizer` → `pendingCandidates` → 下一轮入池）。
 * 两条几乎同义，**同时在池里**会让她一会儿说模板、一会儿说具体句，看起来前后不一致。
 * 所以服务端在加模板句之前先问一句这个函数；抽出来是为了能单测（在 `server.ts` 里内联就没法测）。
 */
export function hasStateMotive(
  pool: Array<{ kind: MotiveKind }> = [],
  pending: Array<{ kind: MotiveKind }> = [],
): boolean {
  return [...pool, ...pending].some(m => m.kind === 'state');
}

/**
 * v1.49：`state`（她自己的状态）是否走**新的**"按心情深度连续定分" —— **已上线（默认开）**。
 *
 * 为什么现在敢默认开（四跑真管道 A/B + 一次零 LLM 确定性仿真，全在 docs 的 v1.49 一节）：
 *   · 机制：心情 −0.22 时 B 臂 **8/8** 选中 `state`（旧行为 0/8 —— 两条坎都过不去）；
 *   · 形态：主终点【接住他那件事 ＋ 她自己在场】**4%→67%（15:0, p=0.000）**，且 `echo` 1.00→1.00
 *     （**接住没掉**）、字数 +20%、边界（他有悬念时两臂都走 `open_loop`）、对照（心情 −0.05）两臂都不形成；
 *   · 管道：具体化那句进块、模板被 `hasStateMotive` 抑制（**8/8**）；
 *   · 频率：`play-state-motive.ts` 第 ④ 段的 20 轮仿真 —— 持续低谷里 `state` 被选中 **2/20**（习惯化压住），
 *     而**旧行为是 4 轮之后彻底没话说**（安静陪伴 16/20）⇒ 它顶掉的是"他那边的动机"或**沉默**，
 *     正是人设裁定那句「主动性降低但**不是没有**」，且**不会**变成连着复读同一句。
 *
 * 回退：`DISABLE_STATE_MOTIVE=true` → 逐字回到 v1.48 之前的行为
 * （门槛 0.25 落在可达带之外 + 常数先验 0.40 ⇒ 这条动机事实上从不形成）。
 */
export function stateMotiveEnabled(): boolean {
  return process.env.DISABLE_STATE_MOTIVE !== 'true';
}

/** 本轮该不该把"她自己的状态"作为动机，以及它值多少紧迫度（null = 不值得说） */
export function stateMotiveFor(moodValence: number): { content: string; base?: number } | null {
  if (!Number.isFinite(moodValence)) return null;

  // ── 旧行为（回退开关 DISABLE_STATE_MOTIVE=true）：门槛 0.25 + 常数先验 0.40 ──
  // 实测为什么它等于"从不形成"：`|mood.valence|` 的可达带深端 ≈ 0.27，
  // 而常见低落只有 0.09~0.13（`scripts/play-state-motive.ts`）。
  if (!stateMotiveEnabled()) {
    if (moodValence <= -0.25) return { content: '我今天状态有点低，不太想强撑着说话' };
    if (moodValence >= 0.25) return { content: '我今天心情不错，有点想跟他说说话' };
    return null;
  }

  // ── 新行为：门槛落进可达带，紧迫度随深度连续 ──
  const v = Math.abs(moodValence);
  if (v < STATE_MOOD_MIN) return null;
  const content = moodStateMotive(moodValence);
  if (!content) return null;
  const t = clamp((v - STATE_MOOD_MIN) / (STATE_MOOD_FULL - STATE_MOOD_MIN), 0, 1);
  return { content, base: STATE_BASE_AT_MIN + t * (STATE_BASE_MAX - STATE_BASE_AT_MIN) };
}

/** 记忆回响 → 具体动机内容 */
/**
 * v1.54：`memory_echo` 的内容是不是**从记忆原文造句**（而不是把元指令贴上"我想起"）—— 开关，**默认关**。
 *
 * 病灶（v1.50b 追到根）：`injectionText` 是 `generateProactiveInjection()` 产出的**给模型看的元指令** ——
 * 形如「【主动回忆·轻柔】你忽然想起三周前，当时他说"…"，你感受到了一种…。在回复中自然地、短短地
 * 提及这个回忆——不是为了翻旧账…不需要追问，只是轻轻提起。」
 * 而旧代码把它截 60 字、前面加"我想起"就当成了**她此刻想说的话**：
 *   `我想起【主动回忆·轻柔】你忽然想起三周前，当时他说"…"` ← 这不是一句话，是一段指令（还带【】与引号）。
 * ⇒ 模型接不上（三跑 ~40 格，`mentionsIt` **零次**）；而且 `curious_followup` 那一档的指令里
 *   **自带问句范例**（"后来呢？/那个事情现在怎么样了？"）—— 很可能就是 v1.50b 量到"问句涨"的来源。
 *
 * 改法：有记忆原文时用**它**造句（`我想起他说过「…」`），指令不再进动机内容。
 * 回退：`DISABLE_ECHO_LINE_FROM_SUMMARY=true`；或传入的 `summary` 为空（保持向后兼容）。
 */
export function echoLineFromSummaryEnabled(): boolean {
  return process.env.ENABLE_ECHO_LINE_FROM_SUMMARY === 'true';
}

export function memoryEchoMotive(
  injectionText: string,
  memoryId?: string,
  /** 记忆原文（`episode.eventSummary`）—— 生产调用点手上就有 */
  summary?: string,
): MotiveCandidate | null {
  // v1.54：优先用**记忆原文**造一句她真能说的话
  if (echoLineFromSummaryEnabled() && summary) {
    const s = summary.replace(/\s+/g, ' ').trim();
    if (s) {
      return {
        kind: 'memory_echo',
        content: `我想起他说过「${s.slice(0, 30)}」`,
        source: { memoryId },
        memoryId,
        provenance: provenanceForUserMemory(memoryId),
      };
    }
  }
  const text = (injectionText ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    kind: 'memory_echo',
    content: `我想起${text.slice(0, 60)}`,
    source: { memoryId },
        memoryId,
        provenance: provenanceForUserMemory(memoryId),
  };
}

// ════════════════════════════════════════════════════════════
// 6. Prompt 片段（放 Prompt 末尾：注意力最高处）
// ════════════════════════════════════════════════════════════

/**
 * v1.30：让位时那段话怎么写（三档，由实测裁定；判定与动力学**完全不变**）。
 *
 * 为什么会有这一档：v1.28 让位时借一条**关于他的** `open_loop` 当锚，理由是"把素材抽空，
 * 模型会回退到安慰 + 分析"。但 v1.29 对**真实 Prompt** 逐块对切（n=4）给出了反面证据：
 *   锚在场 ⇒ 在场词 0.25；锚换成旧那段空文案 ⇒ 0.75；**整块不给** ⇒ 1.00（4/4「我在。」）。
 * 也就是说在"让位"这个分支里，**具体素材本身就是干扰**：模型会去"处理那件事"，而不是"只是陪着"。
 *
 * - `anchor`：v1.28 现状（拿那件事当锚，可以顺着问它的下文）
 * - `swallow`：锚仍在，但写成**咽下去**的（"先不问它"）—— 保留"她心里有东西"的内在理由，不让它变成任务
 * - `omit`：让位时**整块不给**（她本轮确实没有要说的事）
 */
export type DeferStyle = 'anchor' | 'swallow' | 'omit';
/** 合法档位（server 读 `DEFER_ANCHOR_STYLE` 时按它校验；非法 → 回退默认档） */
export const DEFER_ANCHOR_STYLES: DeferStyle[] = ['anchor', 'swallow', 'omit'];
/**
 * 默认档 = `omit`（**实测裁定，不是偏好**）。
 *
 * `scripts/ab-defer-anchor.ts` 在**真管道**上跑三档各 6 样本 × 2 轮（同一句话、同一段历史、
 * 她在本轮开始前同样是 sad +0.20；唯一变量是那段话的写法）：
 *
 * | 档 | 字面在场 | 追问 | 劝解 | 字数 |
 * |---|---|---|---|---|
 * | `anchor`（v1.28 现状） | 7/12 | 1.08 | 1.25 | 68.6 |
 * | `swallow`（咽下去） | 12/12 | **2.58** | 1.00 | **84.4**（最长且最像模板：±2.26） |
 * | `omit`（整块不给） | **12/12** | **0.08** | **0.58** | **52.8** |
 *
 * 读法：`swallow` 把"在场示例"和"那件事"一起给了，结果她**两件都做**（先「我在。」再追问面试）——
 * 比现状更长、更爱追问，所以它淘汰。`omit` 与 `swallow` 的在场率相同，但追问几乎归零、最短、劝解最少，
 * 正是"让位"该有的样子：**她本轮没有要说的事，就别在 Prompt 里给她一件事**。
 * （`/state → motive.thisTurn.deferAnchor` 照旧保留：锚**不再进 Prompt**，但仍能看出她为什么忍着不说。）
 */
export const DEFAULT_DEFER_STYLE: DeferStyle = 'omit';

/** 解析环境变量给的值；不合法/为空 → null（由调用方决定告警与回退，避免把解析和策略混在一起） */
export function parseDeferStyle(raw: string | undefined): DeferStyle | null {
  const v = (raw ?? '').trim();
  return (DEFER_ANCHOR_STYLES as string[]).includes(v) ? (v as DeferStyle) : null;
}

/** 「没有动机」那套措辞：允许为空（安静陪着 + 不为了维持对话而泛问） */
const NO_MOTIVE_SNIPPET = [
  '【此刻】你心里没有特别挂着的事。',
  '那就安静地陪着：可以只回应他、可以只给一个动作或一句很短的话。',
  '不要为了维持对话而泛问（"今天怎么样""在干嘛""忙不忙"这类空话一律不要）。',
].join('\n');

export interface MotiveSnippetOptions {
  /** 本轮让位给他（`MotiveSelection.deferredToUser`）。不传时按"有锚即让位"推断（向后兼容） */
  deferring?: boolean;
  /** 让位档位，默认 `DEFAULT_DEFER_STYLE`（= 实测胜出的 `omit`） */
  deferStyle?: DeferStyle;
}

/**
 * 把"她此刻想说什么"写成给模型的一段话（注入 Prompt 靠后处：注意力高）。
 *
 * v1.28 加了第二个参数 `deferAnchor`：让位时不再是"你心里没有特别挂着的事"（那段话把素材抽空，
 * 实测模型会回退到"安慰 + 分析"的对话先验 —— C 臂 58 字、2/3 在讲道理；而有素材的 A 臂是 23 字短句）。
 * 让位时改用**关于他的那件具体事**当锚，既接住他、又不违背后面的"不为了维持对话而泛问"。
 * v1.30：那句锚**怎么写**由第三参数裁定（见 `DeferStyle`）—— 上面的理由已被 v1.29 的数据质疑。
 */
export function motiveToPromptSnippet(
  selected: Motive | null,
  deferAnchor?: { kind: MotiveKind; content: string } | null,
  opts: MotiveSnippetOptions = {},
): string {
  if (selected) {
    /**
     * v1.50：**按类型分派引导语** —— 那段"问的应该是这件事的具体下文"原本服务**所有**类型。
     *
     * 病灶是量出来的，不是猜的：v1.49 第一跑里 `state` 拿到这段为他写的样板，
     * 结果模型**直接无视那条动机**、回到他这条消息的话题（`echo` 1.00→1.00、主终点 13%→0%）；
     * 换成"着色"形状之后同一个机制立刻生效（4%→67%）⇒ **文案形状对不上类型，动机就白给**。
     *
     * 而 `memory_echo`（她想起一件旧事）、`wish`（她想要什么）、`stance`（她的态度）
     * 现在拿到的都是「**问**它的具体下文」—— 那等于把"回忆/愿望/态度"变成"盘问"。
     * `open_loop` 与 `worry` **逐字不动**：这两类本来就是"关于他的、问得通"的。
     *
     * 开关默认关（它改的是**已上线通路**的文案，必须先量再上）。
     */
    /**
     * v1.56：**指代消歧**（用户方案的"第一跑"）—— 只改"这一块说的是**谁**的事"。
     *
     * 病灶（v1.55 量出）：原话「你想问他什么，问的应该是**这件事**的具体下文」里的
     * 「这件事」是**无指代**的 —— 模型把它解析成**他刚说的那件**（阳台 24/24），
     * 而**她心里挂的那件**（海）**0/24** 出现。⇒ 这解释了 L3：`open_loop`/`worry` 有效，
     * 是因为它们的"这件事"**就是他那一件**（指代重合）；`memory_echo`/`wish`/`stance`
     * 是**她自己的**事 ⇒ 指代打架、被吸到他那边。
     *
     * 这一跑**只有一个变量**：把"谁的事"说清 ＋ 把行动从"问他它的下文"改成"我自己说出来"。
     * 不加理由（那是 v1.55 的变量，已证无效）、不碰 `action` / `strategyCtx`。
     *
     * ⚠️ 文字里**不许出现无指代的「这件事」**（单测钉住）——指代必须由内容本身锚定。
     * ⚠️ 风险点：那句"跟他刚刚说的那件不是同一件"是**对比句**，而 v1.50 记过
     * 「否定式指令会点着它」⇒ 所以 `echoType`（她是否仍在接住他那件事）是**护栏**：
     *    它若掉了，说明这句对比反噬了。
     *
     * 开关默认关（它改的是**已上线通路**的文案）：`ENABLE_MOTIVE_REFERENT_SHAPE=true`。
     */
    if (motiveReferentShapeEnabled() && REFERENT_SHAPE_KINDS.includes(selected.kind)) {
      return [
        '【此刻我心里挂着的事】',
        '这一件是**我自己**心里的事 —— 跟他刚刚说的那件不是同一件。',
        `我自己心里挂着的就是：${selected.content}`,
        '我这一轮想把它说出来：说我自己挂着的这一件。',
      ].join('\n');
    }
    /**
     * v1.55（用户方案的第一步）：**理由形状** —— 动机块不只说"我心里挂着一件事"，
     * 还说清"**我为什么想说**"（内在理由）＋"表达倾向"。
     *
     * 假说（这一刀唯一的新变量）：动机内容之所以不进她的话，不是**内容形态**问题
     *（v1.54 已证三种形态全零：元指令 / 干净标签 / 造句），而是**内容没有动机力** ——
     * "一件被记着的事"若不带上"我为什么想说"，模型只把它当背景资料。
     *
     * 与现状（任务式）的差别**只有中间两行**：表头、末尾那条元描述禁令两臂相同，
     * 所以这一跑的唯一变量就是"理由"。
     *
     * ⚠️ 理由是**按类型**的（kind 级模板），不是实例级 —— 实例级的"为什么"该走 v1.10
     *   那条具体化通路，等这一跑证明形状有效再动。
     * ⚠️ 表头**没有**一起改（用户提议换成【当前内在驱动力】）—— 一次只测一个变量。
     *
     * 开关默认关（它改的是**已上线通路**的文案）：`ENABLE_MOTIVE_REASON_SHAPE=true`。
     */
    if (motiveReasonShapeEnabled()) {
      const reason = MOTIVE_REASON_LINES[selected.kind];
      if (reason) {
        return [
          `【此刻我心里挂着的事】我想让他知道：${selected.content}`,
          `因为${reason}`,
          '表达倾向：自然分享，不主动转移话题。',
          '不要说出"我心里挂着"这类元描述，直接自然地表达。',
        ].join('\n');
      }
    }
    if (motiveKindShapeEnabled() && selected.kind !== 'state') {
      const shape = MOTIVE_KIND_SHAPES[selected.kind];
      if (shape) {
        return [
          `【此刻我心里挂着的事】${selected.content}`,
          shape,
          '如果他此刻的情绪更需要被接住，就先接住他，这件事可以下一轮再提。',
          '不要说出"我心里挂着"这类元描述，直接自然地表达。',
        ].join('\n');
      }
    }
    /**
     * v1.49b：`state`（她自己的状态）**不能**套用下面那段为"他的事"写的样板。
     *
     * 实测（`scripts/ab-state-motive.ts` 第一跑）：一旦 `state` 真的入选，它拿到的却是
     * 「如果你想问他什么，问的应该是**这件事**的具体下文」—— 对"我今天心里有点闷"不成话，
     * 模型于是**忽略动机内容、回到他这条消息的话题**（`echo` 1.00→1.00、主终点 13%→0%）。
     *
     * 这段文案的形状来自**基线臂自己出现过的理想形态**（那一跑 1/8）：
     *   「…我这边今天有点提不起劲，说不上来为什么，就是心里闷闷的。**你收拾阳台的时候，脑子里在想事情吗**」
     * —— 她的状态**当着色**、同时**仍然接住他那件事**。
     * 所以这里的指令必须是"**别把他那件事换掉** + 状态只当底色（半句）"，而不是"从这件事出发"。
     * （把它当**话题**会把他那件事挤掉，见 v1.42 那个"追问就是接住的载体"的同款结论。）
     */
    if (selected.kind === 'state' && stateMotiveEnabled()) {
      return [
        `【我此刻的状态】${selected.content}`,
        '这不是关于他的事 —— 所以你这一轮照样接住他说的那件事，别把它换掉。',
        '你自己的状态只是底色：淡淡地在你这句话里带半句就够，不要变成话题、不要解释为什么，也不必问他什么。',
        '不要说出"我心里挂着"这类元描述，直接自然地表达。',
      ].join('\n');
    }
    return [
      `【此刻我心里挂着的事】${selected.content}`,
      '本轮开口就从这件事出发——如果你想问他什么，问的应该是这件事的具体下文，而不是泛泛的关心。',
      '如果他此刻的情绪更需要被接住，就先接住他，这件事可以下一轮再提。',
      '不要说出"我心里挂着"这类元描述，直接自然地表达。',
    ].join('\n');
  }

  const deferring = opts.deferring ?? Boolean(deferAnchor);
  if (!deferring) return NO_MOTIVE_SNIPPET;

  // ── 让位分支（v1.28 判定不变，只换那段话的写法）──
  const style = opts.deferStyle ?? DEFAULT_DEFER_STYLE;
  if (style === 'omit') return '';                 // 整块不给：调用方必须跳过空片段
  if (!deferAnchor) return NO_MOTIVE_SNIPPET;      // 让位但手里没有"关于他的"具体事 → 允许为空
  if (style === 'swallow') {
    return [
      '【此刻】你自己的事先放一放 —— 他这句更需要被接住。',
      `你心里本来装着一件关于他的事：${deferAnchor.content}——这一轮先不问它。`,
      '先让他知道你在：一句"我在""我陪着你"，或者一个动作，就够了。',
    ].join('\n');
  }
  return [
    '【此刻】你自己的事先放一放 —— 他这句更需要被接住。',
    `你心里其实挂着一件关于他的事：${deferAnchor.content}`,
    '想靠近的话，可以顺着这件事问一句它的下文（不是泛泛的关心）；不想问，就只是陪着，也可以。',
  ].join('\n');
}

/**
 * v1.50：每种动机的引导语形状（**只给形状对不上的那几类**）。
 *
 * `open_loop` / `worry` **故意不在表里** —— 它们本来就是"关于他的、问得通"的事，
 * 现状那段「问的应该是这件事的具体下文」对它们是成立的，一个字都不该动。
 *
 * ⚠️ 表里的文字**不能含主终点词表的词**（`scripts/ab-motive-kind-shape.ts` 有自检），
 * 也不能含要测的标记词（例如量"她把它说出来"用的「我想起/我记得」—— 所以下面写的是
 * "把它说出来"，而不是拿一个例句当示范）。
 */
export const MOTIVE_KIND_SHAPES: Partial<Record<MotiveKind, string>> = {
  // v1.50b：**全部改成正面写法**。第一跑用的是否定式（"不是要盘问他 / 不必问它现在怎么样了"），
  // 实测问句反而 1.00→1.75 —— 把"问"提到她眼前等于点着了它（"别想大象"）。
  // 现在只说**该做什么**，一个字都不提"问"。
  memory_echo: '这是**你心里存着的一件事** —— 用你自己的一句话把它说出来，'
    + '说完自然接回他刚说的那句。',
  wish: '这是**你想要的一件事**：用一句你自己的话说出来，或者轻轻提一句。',
  curiosity: '这是**你好奇的一件事**：把你好奇的那个具体的点说出来。',
  stance: '这是**你心里的一个态度**：用一句你自己的话说出来。',
};

/**
 * v1.55：**每种动机"我为什么想说"的模板**（kind 级）。
 *
 * 为什么是模板而不是 LLM 生成：这一步要验的是"**有没有理由**"这件事本身；
 * 理由的措辞一旦由模型现场生成，就同时引入了"生成质量"这个混杂变量。
 * 形状有效之后再换成实例级（走 v1.10 那条具体化通路）。
 */
export const MOTIVE_REASON_LINES: Partial<Record<MotiveKind, string>> = {
  memory_echo: '那让我觉得，我们一直在共同经历一些事。',
  wish: '这是我自己想要的东西，不只是回应他。',
  stance: '这是我看重的东西，我想让他知道我是谁。',
  curiosity: '我想弄明白这件事。',
  state: '我想让他知道我此刻是什么样。',
  open_loop: '这件事我放心不下。',
  worry: '我心里一直悬着这件事。',
};

/**
 * v1.57：**类型级的行动倾向缺省值**（`Motive.action` 的缺省来源）。
 *
 * 语义边界（这一刀最重要的一条纪律）：`kind` 回答"她心里挂着**什么**"，
 * `action` 回答"她想对这件事**做什么**"。两者**不是**一一对应的 ——
 * 同一个 `memory_echo` 可以是 share（说出来）、ask（问他后来怎样了）、wait（想到了但不说）。
 * 这里给的只是**缺省**；实例级的行动倾向要等"意义层"（D 阶段）。
 *
 * 今天**只有 `ask` / `share` 可达**：
 *   `comfort`（他难受 → 想安慰）与 `celebrate`（他报喜 → 想一起高兴）
 *   该由 `appraisal` 的 `for_him` 通路产生，而现在**没有任何 kind 会产出它们** ⇒
 *   策略层见到这两个值时**只记录理由、不改策略**（诚实留白，不硬编）。
 */
export const MOTIVE_ACTION_BY_KIND: Record<MotiveKind, MotiveAction> = {
  open_loop: 'ask',      // 他那件没落定的事 → 顺着问它的下文
  worry: 'ask',          // 她替他悬着 → 问一句
  curiosity: 'ask',      // 她好奇 → 问那个具体的点
  memory_echo: 'share',  // 她想起一件旧事 → 自己说出来
  wish: 'share',         // 她想要什么 → 说出来
  stance: 'share',       // 她的态度 → 说出来
  state: 'share',        // 她自己的状态 → 半句带出来（着色）
};

/**
 * v1.31：他**明确说了负面情绪**时，让位门槛 0.6 → 0.4 —— **默认开**，`DISABLE_MODERATE_DEFER=true` 回退。
 *
 * v1.58：从 `server.ts` 搬到这里 —— `server/services/turnMotive.ts` 也要用它，
 * 而"两份实现会漂移"是这个项目反复踩过的坑（`baselineForPersona` 抄一份、`getAllStats()` 当对象映射）。
 * 每请求读 env，便于一条真管道 A/B。
 */
export function moderateDeferEnabled(): boolean {
  return process.env.DISABLE_MODERATE_DEFER !== 'true';
}

/** v1.57：取这条动机的行动倾向（实例字段优先，缺省按类型）*/
export function actionFor(kind: MotiveKind, explicit?: MotiveAction): MotiveAction {
  return explicit ?? MOTIVE_ACTION_BY_KIND[kind] ?? 'share';
}

/**
 * v1.56：**哪些动机适用"指代消歧"形状**。
 *
 * ⚠️ 只放 `memory_echo` —— 它是**唯一被测过的**那一类（真管道 24 格：目标事件 0/12 → **11/12**，
 * p=0.001，见 `ab-referent-shape.ts`）。
 *
 * 为什么**必须**有这张表、不能对所有类型一视同仁：新形状的第一句是
 * 「这一件是**我自己**心里的事 —— 跟他刚刚说的那件不是同一件」——
 * 放到 `open_loop`/`worry`（**他的**没落定的事 / **她替他**悬着的事）上就是**说反了**。
 *
 * 为什么 `wish`/`stance`/`curiosity` 也**没放进来**（虽然它们的事同样是"她自己的"）：
 * 它们读的是同一句有歧义的话（「问的应该是这件事的具体下文」），**结构上怀疑同样受影响**，
 * 但**没测过** —— v1.50 的教训就是一个"看起来该成立"的形状实测反而反向。
 * ⇒ 逐类扩展是一次单独的实验（债务表 v1.56 行）。
 */
export const REFERENT_SHAPE_KINDS: MotiveKind[] = ['memory_echo'];

/** v1.56：指代消歧形状 —— 开关，**已上线（默认开）** */
export function motiveReferentShapeEnabled(): boolean {
  return process.env.DISABLE_MOTIVE_REFERENT_SHAPE !== 'true';
}

/** v1.55：理由形状 —— 开关，**默认关** */
export function motiveReasonShapeEnabled(): boolean {
  return process.env.ENABLE_MOTIVE_REASON_SHAPE === 'true';
}

/** v1.50：动机引导语是否按类型分派 —— 开关，**默认关** */
export function motiveKindShapeEnabled(): boolean {
  return process.env.ENABLE_MOTIVE_KIND_SHAPE === 'true';
}

/**
 * v1.52：动机门槛看**加权前**的分（学习权重只用于排序）—— **已上线（默认开）**。
 *
 * 病灶（v1.51 量出）：`motiveWeight` 的下界 0.5 把 `curiosity`/`stance` 有效先验压到 0.26/0.23，
 * 而 `MOTIVE_MIN_SALIENCE`=0.28 是按**未加权**先验标定的 ⇒ 这两类**事实上永远开不了口**
 * （`wish` 只剩 0.01 余量）。而这与 `motiveWeight` 注释里的意图（"下界保证任何开口方式
 * 都不会被封杀"）**直接矛盾**。
 *
 * 分工：门槛回答"**这件事值不值得开口**"（情境问题，含"刚说过"的重复惩罚）；
 *       学习权重只回答"**够格的那些里谁最该说**"（排序问题）。
 *
 * 为什么敢默认开：`measure-motive-reach.ts` 证明七类**全部可达**（零 LLM，确定性）；
 * 单测钉死"排序仍由权重决定"；真管道两跑同一主终点合并 **10:0, p=0.002**
 *（"她也自己说了一句" +0.63；字数 +12%、仍在跟他互动、逐字照抄 0%）。
 * ⚠️ 幅度不稳（第一跑 7:0 / 第二跑 3:0，A 臂基线在漂）—— 这是"更常开口"，不是"每次都开口"。
 *
 * 回退：`DISABLE_MOTIVE_RAW_GATE=true` → 逐字回到"门槛看加权后"（这两类再次开不了口）。
 */
export function motiveRawGateEnabled(): boolean {
  return process.env.DISABLE_MOTIVE_RAW_GATE !== 'true';
}

/** 供 /state 观测 */
export function describeMotive(selected: Motive | null, deferred: boolean): string {
  if (deferred) return '让位给用户情绪（本轮不表达自己的事）';
  if (!selected) return '无动机（安静陪伴）';
  // v1.60-p0：把**来源归属**一并说出来（唯一事实源是入选的那个 `Motive`，不另算一遍）
  const prov = selected.provenance
    ? `（来源：${selected.provenance.owner}/${selected.provenance.source}/${selected.provenance.subject}）`
    : '';
  return `${selected.kind}：${selected.content}${prov}`;
}

