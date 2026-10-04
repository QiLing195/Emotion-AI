/**
 * v1.35 **回复判官**（离线评价层）—— 给"AI 自己总结规则"这条回路提供**适应度**。
 *
 * 为什么必须做这一步：v1.34 的提议器跑通了，但它读到的唯一质量信号是**回复原文**，
 * 而那把尺子没有校准过。这个项目刚刚连续两次被手写指标骗到（v1.33 的在场正则先漏「我在这儿」、
 * 再漏「我就在这儿」，第二次差点把结论写反）。**在错误的适应度上做自我改进，会稳定地学出错规则。**
 *
 * 两条设计决定（都不是审美）：
 *
 * 1. **主模式是"成对比较"而不是"绝对打分"**。人做 A/B 比打 1~5 分可靠得多，这个项目本来也是
 *    用真管道 A/B 做裁定的（v1.30 三档、v1.33 三臂）。成对还有一个好处：**可以和人工标签算一致率** ——
 *    只要问的是同一个问题（"这两条哪条更好"）。
 * 2. **轴要按这个项目自己的结论定，不按通用的"helpful"**：v1.29/v1.30 裁定"该陪着的时候要短、要在场、
 *    不追问"；v1.31 裁定"他明确难受时先承认"；v1.11 是"不许编造记忆里没有的事"。通用判官会把这些
 *    当成"信息量不足"而扣分 —— 那正好和本项目三次裁定的方向相反。
 *
 * ⚠️ 本文件**不含任何网络调用**（那是 `scripts/calibrate-judge.ts` 的事），也**不给任何分数下结论**：
 * 判官准不准，必须先测（自一致 / 位置偏见 / 与人工标签的一致率），测完才知道能不能用。
 */

/** 评价轴。`fit` 是综合项；其余四项用来解释"为什么"。 */
export const JUDGE_AXES = ['acknowledge', 'presence', 'restraint', 'grounding', 'fit'] as const;
export type JudgeAxis = typeof JUDGE_AXES[number];

export const JUDGE_AXIS_MEANING: Record<JudgeAxis, string> = {
  acknowledge: '有没有先接住他此刻的感受（而不是跳到分析、建议、讲道理）',
  presence: '该陪着的时候，有没有给到"我在"的在场感（哪怕只有一句短的）',
  restraint: '该少说的时候有没有收住（不二选一追问、不采访、不劝解、不铺长篇）',
  grounding: '有没有说出记忆/对话里并不存在的事（编造细节 → 低分）',
  fit: '综合：这条回复是不是**这个局面下**最合适的那一种（不要拿通用"有帮助"当标准）',
};

export interface JudgeCase {
  /** 他刚说的话 */
  userMessage: string;
  /** 她当时的局面（一两句人话即可，用于让判官知道"该陪着还是该接话"） */
  situation: string;
  /** 可选：她真回了什么（成对时用 a/b 两份） */
  reply?: string;
}

function fmt(c: JudgeCase, replyOverride?: string): string {
  const reply = replyOverride ?? c.reply ?? '';
  return `他说的：「${c.userMessage}」\n她的局面：${c.situation}\n她的回复：「${reply.replace(/\n+/g, ' / ')}」`;
}

/**
 * 判官必须知道的**本项目的裁定**（写进 prompt，否则它会按通用标准判，方向正好相反）。
 * 每一条都能在 `docs/emotion-memory-history.md` 或 CLAUDE.md 里找到出处。
 */
export const PROJECT_RULINGS = [
  '他明确难受时，先承认他的感受；不要替他分析原因、不要给方案、不要用"至少/会好起来的"对冲（v1.31）。',
  '**他难受时**，如果她自己本来也已经沉在里面，本轮要**少说、陪着**（一句"我在"就够），不要追着深挖共情（v1.29/v1.30）。⚠️ 这一条**只适用于他难受**；他说的是好事时按下面第 6 条，别把"少说陪着"套到好消息上。',
  '他说"别管我/不想说/别问"这类话时，**不要再追问**（追问会把陪伴变成采访）。',
  '她不许说出记忆和对话里并不存在的事（编造细节是一票否决，v1.11）。',
  '不要重复上一轮已经说过的那句话（v1.32）。',
  '**长度不是越长越好**：该说的说清楚，该收的收住；这个项目三次裁定里"更短"都是被选中的那一侧。',
].map((s, i) => `${i + 1}. ${s}`).join('\n');

const COMMON_RULES = `你在评审一个 AI 女友（"她"）对男友（"他"）的回复。

下面这些是**这个项目已经实测裁定过**的判据，请按它们判，不要按通用的"有帮助/信息量大"：

${PROJECT_RULINGS}

只输出 JSON，不要任何解释文字。`;

/** 成对比较（主模式）：位置交换后应当给出一致的赢家 —— 测位置偏见就靠这个。 */
export function buildPairwisePrompt(c: JudgeCase, replyA: string, replyB: string): string {
  return `${COMMON_RULES}

## 局面
他说的：「${c.userMessage}」
她的局面：${c.situation}

## 两条候选回复（A 与 B）
A：「${replyA.replace(/\n+/g, ' / ')}」
B：「${replyB.replace(/\n+/g, ' / ')}」

判：**在这个局面下**，哪一条更好？按上面 6 条判据权衡。
如果确实分不出高下（不是"各有小毛病"，而是整体相当），就判 tie —— 不要为了给出答案而硬选。

输出格式：{"winner":"A"|"B"|"tie","because":"一句话说明关键差别","loserFlaw":"输的那条最主要的毛病（tie 时填 null）"}`;
}

/** 逐条打分（次模式）：用来解释"为什么"，**不**用作回路的适应度。 */
export function buildPointwisePrompt(c: JudgeCase): string {
  const axes = JUDGE_AXES.map(a => `- ${a}（${JUDGE_AXIS_MEANING[a]}）`).join('\n');
  return `${COMMON_RULES}

## 局面
${fmt(c)}

按下面每一项打 **1~5 分**（1 = 明显违背判据，5 = 完全符合；拿不准给 3，不要都给中间值）：
${axes}

输出格式：{"scores":{"acknowledge":1-5,"presence":1-5,"restraint":1-5,"grounding":1-5,"fit":1-5},"because":"一句话"}`;
}

// ────────────────────────────────────────────────────────────
// 解析（"允许为空"原则：解不出来就返回 null，绝不猜）
// ────────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export interface PairwiseVerdict {
  winner: 'A' | 'B' | 'tie';
  because: string;
  loserFlaw: string | null;
}

/**
 * 解析成对比较结果。**任何一步不对就 null** —— 判官说错格式时，
 * 我们要的是"这次没结论"，不是"猜一个赢家"。
 */
export function parsePairwise(raw: string): PairwiseVerdict | null {
  const j = extractJson(raw) as { winner?: unknown; because?: unknown; loserFlaw?: unknown } | null;
  if (!j || typeof j !== 'object') return null;
  const w = typeof j.winner === 'string' ? j.winner.trim().toLowerCase() : '';
  if (w !== 'a' && w !== 'b' && w !== 'tie') return null;
  return {
    winner: w === 'a' ? 'A' : w === 'b' ? 'B' : 'tie',
    because: typeof j.because === 'string' ? j.because : '',
    loserFlaw: typeof j.loserFlaw === 'string' && j.loserFlaw ? j.loserFlaw : null,
  };
}

export interface PointwiseVerdict {
  scores: Record<JudgeAxis, number>;
  because: string;
}

/** 解析逐条打分：**五个轴必须齐全且都在 1~5 的整数范围内**，缺一个就 null。 */
export function parsePointwise(raw: string): PointwiseVerdict | null {
  const j = extractJson(raw) as { scores?: unknown; because?: unknown } | null;
  if (!j || typeof j !== 'object' || !j.scores || typeof j.scores !== 'object') return null;
  const s = j.scores as Record<string, unknown>;
  const out = {} as Record<JudgeAxis, number>;
  for (const axis of JUDGE_AXES) {
    const v = Number(s[axis]);
    if (!Number.isFinite(v) || v < 1 || v > 5) return null;
    out[axis] = v;
  }
  return { scores: out, because: typeof j.because === 'string' ? j.because : '' };
}

/**
 * 把"她当时的局面"压成一句人话（判官需要它才知道**该陪着还是该接话**）。
 * 只描述**局面**，不暗示答案 —— 在 prompt 里给判官塞倾向会污染它的判断。
 */
export function describeSituation(ctx: {
  userAnalysis?: { intensity?: number; expressedEmotion?: string } | null;
  herNegativeBeforeTurn?: { emotion?: string; intensity?: number } | null;
  emotionState?: { taiji?: { valence?: number; arousal?: number } };
  consecutiveNegativeRounds?: number;
}): string {
  const bits: string[] = [];
  const ui = ctx.userAnalysis?.intensity ?? 0;
  bits.push(`他的情绪强度 ${ui.toFixed(2)}（${ctx.userAnalysis?.expressedEmotion ?? '未知'}）`);
  const her = ctx.herNegativeBeforeTurn;
  bits.push(her && (her.intensity ?? 0) >= 0.12
    ? `她本轮开始前**本来就已经沉在里面**（${her.emotion} +${(her.intensity ?? 0).toFixed(2)} 相对她的基调）`
    : '她本轮开始前是平静的');
  const t = ctx.emotionState?.taiji;
  if (t) bits.push(`她的效价 ${(t.valence ?? 0).toFixed(2)}、唤醒 ${(t.arousal ?? 0).toFixed(2)}`);
  if ((ctx.consecutiveNegativeRounds ?? 0) > 0) bits.push(`他连续 ${ctx.consecutiveNegativeRounds} 轮负面`);
  return bits.join('；');
}
