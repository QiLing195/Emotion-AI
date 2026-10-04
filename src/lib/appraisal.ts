// 评价层（appraisal）：这件事对**她**意味着什么。
//
// ── 为什么需要它（v1.14）─────────────────────────────────────────────────────
// 在此之前，"她的情绪"来自哪里？
//   · 用户话语直接刺激（阶段 3）：他把情绪说出来 → 引擎按事件更新
//   · 情绪传染（3.65①）：**把他的情绪镜像给她**（他也难过 → 我也难过）
//   · 奖惩强化（3.1）：他冲着她 → 加减 intimacy/greed
//   · 内在事件 / 心情 / 反刍 / 潜意识：与"他这句话"无关
// 全都是"他怎么样"，**没有一步在问"这件事对她意味着什么"**。
//
// 于是出现这样的落差：他说"我面试又挂了"——
//   镜像给的是 sad（我也难过）；
//   但**她心里挂着这件事**（动机池里就有"他面试那事有消息了吗"），
//   她真正的反应是**替他悬着**（fear："会不会真的没戏了"）+ 想靠近他。
//   这两件事在声学与情绪上是不一样的，而旧链路只会产出前者。
//
// 本模块只做这一件别处做不了的事：**用她自己的目标结构去评价他这件事**。
// 产出是**她自己的**情绪增量，而不是他情绪的复制品 —— 这是"理解"与"镜像"的分界。
//
// ── 刻意不做的（避免硬编 / 避免与既有阶段重复）──────────────────────────────
// · **价值观通路**：想做"他的话与她看重的价值冲突 → disgust/anger"，
//   但那需要价值→关键词表，而现成的 `VALUE_STANCE_LINES` 是"她想说的话"、不是判据表。
//   靠关键词猜冲突会误伤 —— **宁可先不做**（与本项目"允许为空"的一贯做法一致）。
// · **"冲着她"通路**：`suggestReinforcement`（阶段 3.1）已经在处理指向她的奖惩，
//   再加一条会双重计数。
// · **不镜像他的情绪**：那是传染的职责；这里只产出"关系性/处境性"的反应。
// ─────────────────────────────────────────────────────────────────────────────

import type { EmotionState } from './emotionTypes';
import type { Motive } from './emotionTypes';

/** 他的情绪强度低于此就不评价（弱信号下"她怎么想"是编的） */
export const APPRAISAL_MIN_INTENSITY = 0.4;
/** 词面锚点最短长度（2 = 一个中文实词） */
export const APPRAISAL_TOPIC_MIN_ANCHOR = 2;
/**
 * 只共享这些 2-gram 不算"同一件事"。
 *
 * ⚠️ 为什么不用 `textSimilarity`（2-gram 相似，动机/记忆召回在用的那把尺子）：
 * 实测它对**假阳性给的分更高** ——
 *   真命中：'他面试那事有消息了吗' <=> '面试又挂了' = **0.083~0.200**
 *   假命中：'他今天面试怎么样'     <=> '今天吃了面' = **0.250**
 *           '他昨天说的那件事'     <=> '昨天看的那部电影不错' = **0.286**
 * 它被"今天/昨天/结果"这类高频虚词主导，**分不出"同一件事"和"碰巧都有今天"**。
 * 故这里改用**词面锚点**（最长公共子串且不是常见虚词）。
 * 保守偏向：认不出来就**不评价**，绝不乱评价。
 */
export const STOP_ANCHORS = new Set([
  '今天', '昨天', '明天', '后天', '结果', '怎么', '什么', '时候', '一下', '这件', '那件',
  '事情', '我们', '他们', '你们', '这个', '那个', '真的', '不是', '可以', '已经', '还是',
  '就是', '因为', '所以', '但是', '如果', '然后', '现在', '最近', '有点', '一点', '感觉',
]);
/**
 * 单轮总影响上限。
 * 刻意**小于**用户直接刺激、也小于 `INTERNAL_TOTAL_CAP`(0.1)：
 * 她想得再多，也不该比"他当下这句话"对她影响更大（防"自嗨漂移"的同一道闸门）。
 */
export const APPRAISAL_TOTAL_CAP = 0.15;
/** 心疼 / 替他高兴 的基础权重 */
export const APPRAISAL_FOR_HIM_WEIGHT = 0.05;
/** 碰到她牵挂之事的基础权重（再乘以那条动机的紧迫度 salience） */
export const APPRAISAL_CONCERN_WEIGHT = 0.07;

/** 最长公共**子串**（不是子序列） */
function longestCommonSubstring(a: string, b: string): string {
  let best = '';
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best.length) best = a.slice(i - cur[j], i);
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * 她挂着的事与他这句话的**词面锚点**：够长、且不是常见虚词的最长公共子串。
 * null = 认不出是同一件事。
 */
export function topicAnchor(concern: string, text: string): string | null {
  const a = (concern ?? '').trim();
  const b = (text ?? '').trim();
  if (!a || !b) return null;
  const anchor = longestCommonSubstring(a, b);
  if (anchor.length < APPRAISAL_TOPIC_MIN_ANCHOR) return null;
  if (STOP_ANCHORS.has(anchor)) return null;
  return anchor;
}

export type AppraisalKind = 'for_him' | 'touches_her_concern';

/**
 * v1.47 这一条评价的**立场**（给下游渲染用；`reason` 是给人看的，这个是给代码用的）。
 *
 * 为什么单独给一个字段而不是让下游去解析 `reason` 的中文：
 * 本项目栽过太多次"靠字符串猜语义"（`contentInjector` 的键变成 "0"/"1"、`textSimilarity` 分不出同一件事）。
 *   · `dreading`  = 他说的正是我挂着的，而且不好 ⇒ 我替他悬着
 *   · `relieved`  = 他说的正是我挂着的，而且是好消息 ⇒ 我松一口气
 *   · `awaiting`  = 他提起了那件事但没说结果 ⇒ 我心里悬着，会留意后续
 *   · `aching`    = 他不好受 ⇒ 我心疼他、想靠近
 *   · `glad`      = 他挺好 ⇒ 我替他高兴、也安心
 */
export type AppraisalStance = 'dreading' | 'relieved' | 'awaiting' | 'aching' | 'glad';

export interface AppraisalReading {
  kind: AppraisalKind;
  /** v1.47：这一条是哪一种立场（见 {@link AppraisalStance}） */
  stance: AppraisalStance;
  /** 人话理由（可审计：为什么她会有这个反应） */
  reason: string;
  /** 命中的依据（她挂着的那件事的原文） */
  evidence?: string;
  emotions: Record<string, number>;
  valence: number;
  arousal: number;
}

export interface AppraisalInput {
  /** 他这一轮说的话 */
  userText: string;
  /** 他的情绪标签（已归一） */
  userEmotion?: string | null;
  /** 他的情绪强度 [0,1] */
  userIntensity?: number;
  /** 她心里挂着的事（动机池里那些"指向他"的条目） */
  concerns?: Motive[];
}

export interface AppraisalResult {
  readings: AppraisalReading[];
  /** 合计后（已按 {@link APPRAISAL_TOTAL_CAP} 缩放）的情绪增量 */
  emotions: Record<string, number>;
  valence: number;
  arousal: number;
  /** 人话诊断（/state → appraisal.note） */
  note: string;
}

/** 他的情绪是偏正还是偏负 */
function polarity(emotion?: string | null): 'positive' | 'negative' | 'neutral' {
  const POSITIVE = ['joy', 'love', 'gratitude', 'calm', 'excitement', 'hope'];
  const NEGATIVE = ['sad', 'anger', 'fear', 'anxiety', 'disgust', 'loneliness', 'stress', 'tired'];
  const e = (emotion ?? '').toLowerCase();
  if (POSITIVE.includes(e)) return 'positive';
  if (NEGATIVE.includes(e)) return 'negative';
  return 'neutral';
}

/** 只在她"指向他/关心他"的动机里找牵挂（愿望/好奇不算"牵挂"） */
const CONCERN_KINDS = new Set(['open_loop', 'worry']);

/**
 * 评价他这一轮的话对**她**意味着什么。
 *
 * 允许返回空（`readings: []`）—— 他说的与她心里挂着的无关、情绪也不强时，
 * **不该硬编一个反应出来**。没有评价就是没有评价。
 */
export function appraiseEvent(input: AppraisalInput): AppraisalResult {
  const src = (input ?? {}) as AppraisalInput;
  const intensity = Math.max(0, Math.min(1, src.userIntensity ?? 0));
  const pol = polarity(src.userEmotion);
  const readings: AppraisalReading[] = [];

  // ── ① 心疼 / 替他高兴 ──
  // 与"传染"的分工：传染产出**镜像**（他难过→我也难过）；
  // 这里只产出**关系性**的那一半（想靠近他 / 他好好的我就安心）。
  if (pol !== 'neutral' && intensity >= APPRAISAL_MIN_INTENSITY) {
    const k = intensity;
    if (pol === 'negative') {
      readings.push({
        kind: 'for_him',
        stance: 'aching',
        reason: `他不好受（${src.userEmotion} ${intensity.toFixed(2)}）→ 我心疼他、想靠近`,
        emotions: { love: APPRAISAL_FOR_HIM_WEIGHT * k, sad: APPRAISAL_FOR_HIM_WEIGHT * 0.4 * k },
        valence: -0.03 * k,
        arousal: 0.02 * k,
      });
    } else {
      readings.push({
        kind: 'for_him',
        stance: 'glad',
        reason: `他挺好（${src.userEmotion} ${intensity.toFixed(2)}）→ 我替他高兴、也安心`,
        emotions: { calm: APPRAISAL_FOR_HIM_WEIGHT * 0.8 * k, love: APPRAISAL_FOR_HIM_WEIGHT * 0.4 * k },
        valence: 0.03 * k,
        arousal: 0.01 * k,
      });
    }
  }

  // ── ② 这件事碰到了她心里挂着的那件事吗 ──
  // 这是"理解"的核心：同一句话，碰到牵挂与没碰到，对她的意义完全不同。
  const concerns = (src.concerns ?? []).filter(m => CONCERN_KINDS.has(m.kind) && !m.satisfiedAt);
  let hit: { motive: Motive; anchor: string } | null = null;
  for (const m of concerns) {
    const anchor = topicAnchor(m.content, src.userText ?? '');
    if (anchor && (!hit || anchor.length > hit.anchor.length)) hit = { motive: m, anchor };
  }
  if (hit) {
    // 越紧迫的事被碰到，反应越强（用真实的动机紧迫度，不另造权重）
    const s = Math.max(0.2, Math.min(1, hit.motive.salience));
    const k = APPRAISAL_CONCERN_WEIGHT * s;
    const ev = `「${hit.motive.content}」`;
    if (pol === 'negative') {
      readings.push({
        kind: 'touches_her_concern',
        stance: 'dreading',
        reason: `他说的正是我挂着的 ${ev}（都提到「${hit.anchor}」），而且不好 → 我替他悬着`,
        evidence: hit.motive.content,
        emotions: { fear: k * 0.8, sad: k * 0.5, love: k * 0.3 },
        valence: -0.04 * s,
        arousal: 0.03 * s,
      });
    } else if (pol === 'positive') {
      readings.push({
        kind: 'touches_her_concern',
        stance: 'relieved',
        reason: `他说的正是我挂着的 ${ev}（都提到「${hit.anchor}」），而且是好消息 → 我松一口气`,
        evidence: hit.motive.content,
        emotions: { calm: k * 0.8, joy: k * 0.5 },
        valence: 0.04 * s,
        arousal: 0.01 * s,
      });
    } else {
      // 提到了但没结果 —— 她开始等消息（expectation 不在九情里，故只体现为"悬着"）
      readings.push({
        kind: 'touches_her_concern',
        stance: 'awaiting',
        reason: `他提起了我挂着的 ${ev}（都提到「${hit.anchor}」），但没说结果 → 我心里悬着，会留意后续`,
        evidence: hit.motive.content,
        emotions: { fear: k * 0.5, calm: -k * 0.2 },
        valence: -0.01 * s,
        arousal: 0.03 * s,
      });
    }
  }

  // ── 合计 + 总量上限（超出等比缩放）──
  const emotions: Record<string, number> = {};
  let valence = 0;
  let arousal = 0;
  for (const r of readings) {
    for (const [e, v] of Object.entries(r.emotions)) emotions[e] = (emotions[e] ?? 0) + v;
    valence += r.valence;
    arousal += r.arousal;
  }
  const abs = Object.values(emotions).reduce((s, v) => s + Math.abs(v), 0)
    + Math.abs(valence) + Math.abs(arousal);
  const scale = abs > APPRAISAL_TOTAL_CAP ? APPRAISAL_TOTAL_CAP / abs : 1;
  for (const e of Object.keys(emotions)) emotions[e] *= scale;
  valence *= scale;
  arousal *= scale;

  const note = readings.length === 0
    ? (concerns.length === 0
      ? '没有评价：她心里没有挂着他的具体事，这一轮不额外生情'
      : '没有评价：他说的与她挂着的事无关（或他情绪太弱），不硬编反应')
    : readings.map(r => r.reason).join('；');

  return { readings, emotions, valence, arousal, note };
}

/** 把评价结果施加到状态上（纯函数；与 `applyInternalEvents` 同一套写法） */
export function applyAppraisal(state: EmotionState, result: AppraisalResult): EmotionState {
  if (result.readings.length === 0) return state;
  const next = structuredClone(state);
  for (const [emo, amount] of Object.entries(result.emotions)) {
    if (next.emotions[emo] === undefined) next.emotions[emo] = 0;
    next.emotions[emo] = Math.max(0, Math.min(1, next.emotions[emo] + amount));
  }
  next.taiji.valence = Math.max(-1, Math.min(1, next.taiji.valence + result.valence));
  next.taiji.arousal = Math.max(0, Math.min(1, next.taiji.arousal + result.arousal));
  return next;
}



// ════════════════════════════════════════════════════════════
// v1.47 把评价结论**送进她的 Prompt**
// ════════════════════════════════════════════════════════════
//
// 为什么需要这一步（真管道探针 `scripts/probe-her-state-in-prompt.ts` 实测）：
//   同一轮里，评价层**算对了** ——
//     [for_him] 他不好受（fear 0.60）→ 我心疼他、想靠近
//     [touches_her_concern] 他说的正是我挂着的「他体检结果到底怎么样」，而且不好 → 我替他悬着
//   但这两条**只进 /state**，`getLastAppraisal()` 的消费者**只有** `/state` 那一处
//   ⇒ 算出来的"理解"一个字都没到她嘴边，她也没机会把它说出来。
//
// 而 v1.18 把这条缺口记成"单轮 fear 只有 0.028、低于死区 ⇒ 要抬 cap 到 0.27"。那次推论**不成立**：
//   · 探针实测那一轮 fear 位移是 **0.102**（他表达的是 fear，传染也加了一份）——不是 0.028；
//   · 就算把 cap 抬到 0.27，**她的状态进 Prompt 的那条通路是按绝对值排序的**
//     （前端 `buildEmotionContext`：`当前情绪: calm(0.80), love(0.40)…` / `主导情绪: calm`），
//     fear 要挤进前三得先超过 0.35~0.40 —— 那已经不是"抬一点幅度"了；
//   · 而且消费它的三处门槛都要 ≥0.12（Rule 1 / 让位 / 低谷），单轮本来就够不到。
//   ⇒ 缺的不是幅度，是**投递**。这一块就是那条投递链。
//
// 写法上的两条纪律（都是本项目的教训）：
//   ① **不写成"要宣布的心情"，写成"说话时的底色"** —— 否则她会说"我很担心你"这种自述
//      （v1.38 的教训：准许低位 ≠ 让她摊开讲自己）。
//   ② **不含可被整句照抄的句子、不含具体例子**（v1.38 实测例句被逐字复制 5/16）；
//      也**不含测量用的那批"担心式追问"词**（严不严重/要紧/有没有事…）——
//      量具不能来自被量的东西，见 `scripts/ab-appraisal-stance.ts` 的判据。
// ════════════════════════════════════════════════════════════

/**
 * v1.47 是否把评价结论注入 Prompt —— **开关，默认关**。
 * 默认关的理由与其余新片段一致：先拿真管道 A/B，量到收益才上线。
 */
export function appraisalStanceEnabled(): boolean {
  return process.env.ENABLE_APPRAISAL_STANCE === 'true';
}

/** 每种立场一句"底色"。⚠️ 与量具词表**刻意不重叠**（见本文件末尾的说明）。 */
const STANCE_LINES: Record<AppraisalStance, string> = {
  dreading: '他刚说的，正是我心里搁着的那件。他不好受，我这会儿是替他悬着的那种沉——'
    + '这份分量要落在我这一轮的话里，而不是先递一句安慰。',
  relieved: '他刚说的，正是我心里搁着的那件，而且是好消息——我这会儿是松下来的一口气。'
    + '这份松要落在我这一轮的话里，不必夸张地庆祝。',
  awaiting: '他刚提起了我心里搁着的那件事，但没说结果——我这会儿把耳朵留着了。'
    + '可以顺着那件事问一句下文，或者告诉他我在等消息。',
  aching: '他这会儿不好受，我心里是疼的、想靠近他——'
    + '这份靠近要落在他那件事上，不是泛泛地劝他别难过。',
  glad: '他这会儿是高兴的，我心里也安——这份安心落在他那件事上，替他高兴就行。',
};

/**
 * 把这一轮的**评价结论**渲染成 Prompt 里的一块；没有评价时返回 `''`（调用方判空跳过）。
 *
 * 只渲染**最强的那一条**（按情绪量的绝对和排序后的第一条）：
 * 一次给五条会变成一摞互相打架的指令，而真实的她此刻只有一个立场。
 */
export function appraisalToPromptSnippet(result: AppraisalResult | null): string {
  if (!result || result.readings.length === 0) return '';
  const mag = (r: AppraisalReading) => Math.abs(r.valence)
    + Object.values(r.emotions).reduce((s, v) => s + Math.abs(v), 0);
  const top = [...result.readings].sort((a, b) => mag(b) - mag(a))[0];
  const line = STANCE_LINES[top.stance];
  if (!line) return '';
  const evidence = top.evidence ? `（我心里搁着的是「${top.evidence}」）` : '';
  return `【这件事对我来说意味着什么】${line}${evidence}`;
}
