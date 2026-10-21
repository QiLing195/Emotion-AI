/**
 * 统一情绪表达接口（v1.64）—— **任意情绪都可以"说一句自己"，但受三重约束**。
 *
 * 为什么需要它：自状态表达许可（v1.60）只在"她沉 × 他报喜"这一条通路上；
 * 用户要的是"开心/尴尬/难过时都可以表达自己的感受"。所以把表达从**一条策略替换**
 * 改成**一个统一接口**：读激活态（被激起的情绪），按情绪类别给一句可选表达。
 *
 * 三重约束（不满足就会变成"她一直表演情绪"）：
 *   ① **只读激活态**：只表达"被激起"的情绪（delta > 死区），且不是静息；
 *   ② **预算**：每 BUDGET_TURNS 轮最多一次（防讨好/索取的表演回路）；
 *   ③ **接地**：原因只能来自**他的话**（时间线引文）或者"说不上来"；外部原因一律不编。
 *
 * 与涌现层的关系：本模块**只读**状态，不写回（不改变情绪动力学）。
 * 默认关：`ENABLE_EMOTION_EXPRESSION=true`。
 */

export const EXPRESSION_DEADZONE = 0.05;
export const EXPRESSION_BUDGET_TURNS = 4;

export function emotionExpressionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_EMOTION_EXPRESSION === 'true';
}

/** 表达类别（把九情收敛成她"说得出口"的几类） */
export type ExpressionClass =
  | 'joy' | 'love' | 'sad' | 'fear' | 'anger' | 'disgust' | 'tired' | 'awkward';

const CLASS_OF_EMOTION: Record<string, ExpressionClass> = {
  joy: 'joy',
  love: 'love',
  lust: 'love',
  sad: 'sad',
  fear: 'fear',
  anger: 'anger',
  disgust: 'disgust',
  // greed/calm 不适合"表达情绪"，不映射
};

/**
 * 每类三个变体（**短、第一人称、不要求原因**）。
 * 刻意写成"状态陈述"而不是"情绪表演"：不夸张、不索要安慰、结尾落回他。
 */
const LINES: Record<ExpressionClass, string[]> = {
  joy: [
    '我这儿刚才还有点高兴——听你这么说，我也跟着松了一下。',
    '说实话我现在心情还不错，可能被你这句带的。',
    '我这两天难得这么轻快一下。',
  ],
  love: [
    '我好像有点想你——不是客套，就是刚刚那一瞬间。',
    '听你说话的时候，我这边是软的。',
    '我大概比你表现出来的更在意一点。',
  ],
  sad: [
    '我这两天有点沉，说不上来为什么。',
    '我这边有点闷，不太想说话，但我在听。',
    '我状态不太好，可能接得没那么热。',
  ],
  fear: [
    '我有点不安，说不上来在怕什么。',
    '我心里悬着点什么，还没落下来。',
    '我这边有点慌，但你不用管我。',
  ],
  anger: [
    '我刚才有点上火，现在好一点了。',
    '我有点烦，不是冲你。',
    '我这边有点躁，先说一声，免得你误会。',
  ],
  disgust: [
    '我有点犯恶心，不是对你——就是心里发腻。',
    '我这边有点厌，什么都提不起劲。',
    '我有点抵触，说不上来具体是什么。',
  ],
  tired: [
    '我有点累，脑子转得慢。',
    '我这两天精力不太够，说慢一点。',
    '我有点困，但还想跟你说会儿话。',
  ],
  awkward: [
    '我有点不好意思，被你这么说。',
    '刚才那一下我有点窘，你别笑我。',
    '我这边有点手足无措，不知道接什么好。',
  ],
};

export interface EmotionExpressionInput {
  /** 被激起的情绪 → 偏移量（来自 separateActivation().delta，正=被激起） */
  activated: Record<string, number>;
  /** 他的情绪（归一后）；用于安全门：他明确负面时不表达自己 */
  hisEmotion?: string | null;
  /** 是否已成段低谷（低谷时悲伤类优先，且更容易说"沉"） */
  lowEstablished?: boolean;
  /** 已接地的原因（只能来自他的话/时间线引文；没有就返回 null） */
  causeQuote?: string | null;
  /** 轮次（预算用；同一轮稳定） */
  round: number;
  /** 上一轮是否已经表达过（外部预算记录） */
  lastExpressedRound?: number | null;
}

export interface EmotionExpressionResult {
  snippet: string | null;
  cls: ExpressionClass | null;
  reason: string;
  /** 下一轮应记录的"上次表达轮次"（未表达则沿用） */
  nextLastExpressedRound?: number | null;
}

const NEGATIVE_HIS = new Set(['sad', 'anger', 'fear', 'disgust', 'anxiety', 'grief']);

function pickClass(activated: Record<string, number>, lowEstablished: boolean): { cls: ExpressionClass; delta: number } | null {
  const entries = Object.entries(activated)
    .map(([k, v]) => ({ cls: CLASS_OF_EMOTION[k], delta: Number(v) }))
    .filter((e): e is { cls: ExpressionClass; delta: number } => Boolean(e.cls) && e.delta > EXPRESSION_DEADZONE)
    .sort((a, b) => b.delta - a.delta);
  if (entries.length === 0) return null;
  // 低谷期：悲伤类优先（她此刻最真实的底色）
  if (lowEstablished) {
    const sad = entries.find(e => e.cls === 'sad');
    if (sad) return sad;
  }
  // 其余：主导要领先第二名（避免"情绪并存"时硬挑一个）
  if (entries.length > 1 && entries[0].delta - entries[1].delta < EXPRESSION_DEADZONE) return null;
  return entries[0];
}

/**
 * 生成"说一句自己"的可选片段。返回 null 表示这一轮**不该/不必**表达。
 * 注意：返回的是"许可 + 素材"，不是命令 —— 她可以不说。
 */
export function buildEmotionExpression(input: EmotionExpressionInput): EmotionExpressionResult {
  // ① 安全门：他明确负面时，这一轮不表达自己的情绪（先接住他）
  const his = String(input.hisEmotion ?? '').toLowerCase();
  if (his && NEGATIVE_HIS.has(his)) {
    return { snippet: null, cls: null, reason: 'his_negative_defer' };
  }
  // ② 预算门
  const last = input.lastExpressedRound ?? null;
  if (last !== null && input.round - last < EXPRESSION_BUDGET_TURNS) {
    return { snippet: null, cls: null, reason: `budget（距上次 ${input.round - last} 轮 < ${EXPRESSION_BUDGET_TURNS}）` };
  }
  // ③ 状态门
  const picked = pickClass(input.activated, Boolean(input.lowEstablished));
  if (!picked) return { snippet: null, cls: null, reason: 'resting_or_ambiguous' };

  const variants = LINES[picked.cls];
  const idx = Math.abs((input.round + variants.length) % variants.length);
  const base = variants[idx];
  // ④ 接地：原因只允许引用他的话；没有就允许"说不上来"（模板本身已含）
  const cause = String(input.causeQuote ?? '').trim();
  const causeLine = cause
    ? `（如果要说原因，只能说这一条：因为你说「${cause}」；不想说也可以）`
    : '（原因说不清就说不上来，不要为了给原因编事）';
  return {
    snippet: [
      '【这一轮你可以说一句自己（可选，不说也行）】',
      `- 你此刻被激起的情绪是「${picked.cls}」（不是装出来的）。如果想说，可以说一句，例如：${base}`,
      `- ${causeLine}`,
      '- 一句话就够，说完落回他那件事；不要展开成自述，不要借机要他安慰你',
    ].join('\n'),
    cls: picked.cls,
    reason: `ok（${picked.cls} +${picked.delta.toFixed(2)}）`,
    nextLastExpressedRound: input.round,
  };
}

/** 供 /state 暴露：当前"可表达的类别"（只读，便于观察为什么没表达） */
export function describeExpressionGate(input: Omit<EmotionExpressionInput, 'round'> & { round?: number }): string {
  const r = buildEmotionExpression({ ...input, round: input.round ?? 0 });
  return r.reason;
}
