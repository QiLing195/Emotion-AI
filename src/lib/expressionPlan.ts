/**
 * v2.06：ExpressionPlan（审查建议 #4）。
 *
 * 现状问题：`buildUnifiedPermit()` 只按"本轮激活值"挑表达类别，**没有结构化的情绪来源与时间尺度**。
 * 结果：一次短暂的用户触发也可能被说成"我这两天一直很沉"（状态持续时间编造）。
 *
 * 本模块是一个**确定性**计划器（不调模型）：
 *   - 决定这一轮**要不要**表达（silent/express）与原因；
 *   - 给出唯一情绪、语气、时间尺度（transient/sustained）、句子/问题上限；
 *   - 给出可引用证据（心情层/反刍/低谷/他刚说的话/内在活动候选）；
 *   - 回复模型只负责把计划说自然，不能重新决定她是什么情绪或编造原因。
 *
 * 与既有统一接口的关系：`ENABLE_UNIFIED_EXPRESSION` 开时走本计划器；关时保留旧 `buildUnifiedPermit`
 * 作为回退路径（A/B 用）。
 */

export type PlanDecision = 'express' | 'silent';
export type PlanDuration = 'transient' | 'sustained' | 'unknown';
export type PlanTone = 'quiet' | 'soft' | 'bright' | 'playful' | 'calm' | 'restrained';

export interface ExpressionPlan {
  decision: PlanDecision;
  reason: string;
  emotion: string | null;
  tone: PlanTone | null;
  /** transient = 只描述此刻；sustained = 可以提"这两天/最近"；unknown = 只回答近况、不延伸 */
  duration: PlanDuration;
  maxSentences: number;
  maxQuestions: number;
  evidence: string | null;
  causeQuote: string | null;
  sourceEventId: string | null;
  confidence: number;
}

export interface ExpressionPlanInput {
  activated: Record<string, number>;
  hisEmotion: string | null;
  hisIntensity?: number;
  lowEstablished: boolean;
  /** 心情层偏置（正=偏高，负=偏低）；幅度够大才算 sustained */
  moodDelta?: number;
  ruminationActive?: boolean;
  causeQuote: string | null;
  round: number;
  lastExpressedRound: number | null;
  hisAsksAboutHer: boolean;
  /** 已通过校验的内在活动候选（见 intrinsicActivity.ts） */
  intrinsic?: Array<{ eventId: string; type: string; evidenceRef: string; confidence: number }>;
}

const NEGATIVE_HIS = new Set(['sad', 'anger', 'fear', 'disgust', 'grief', 'anxious']);
const BUDGET_TURNS = 3;
const DEADZONE = 0.05;

const TONE_BY_EMOTION: Record<string, PlanTone> = {
  sad: 'quiet',
  fear: 'quiet',
  anger: 'restrained',
  disgust: 'restrained',
  love: 'soft',
  joy: 'bright',
  gratitude: 'soft',
  neutral: 'calm',
};

const SUSTAINED_MOOD_DELTA = 0.05;

/** 从激活态里挑一个"她自己说得清"的情绪；并列时不算（避免硬演）。 */
function pickEmotion(activated: Record<string, number>, lowEstablished: boolean): { emotion: string | null; value: number; ambiguous: boolean } {
  const entries = Object.entries(activated ?? {})
    .filter(([k, v]) => Number.isFinite(v) && v > DEADZONE && k !== 'calm')
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { emotion: null, value: 0, ambiguous: false };
  const [top, second] = entries;
  const ambiguous = second !== undefined && top[1] - second[1] < DEADZONE;
  if (ambiguous && !lowEstablished) return { emotion: null, value: top[1], ambiguous: true };
  return { emotion: top[0], value: top[1], ambiguous };
}

export function planExpression(input: ExpressionPlanInput): ExpressionPlan {
  const silent = (reason: string, over: Partial<ExpressionPlan> = {}): ExpressionPlan => ({
    decision: 'silent',
    reason,
    emotion: null,
    tone: null,
    duration: 'unknown',
    maxSentences: 0,
    maxQuestions: 0,
    evidence: null,
    causeQuote: input.causeQuote ?? null,
    sourceEventId: over.sourceEventId ?? null,
    confidence: 0,
    ...over,
  });

  // 1) 他明确负面情绪且不是问她 → 让位，先接住他
  const his = String(input.hisEmotion ?? '').toLowerCase();
  if (his && NEGATIVE_HIS.has(his) && !input.hisAsksAboutHer && (input.hisIntensity ?? 0.6) >= 0.4) {
    return silent('his_negative_defer');
  }
  // 2) 表达预算（距上次不足 N 轮）
  if (input.lastExpressedRound !== null && input.round - input.lastExpressedRound < BUDGET_TURNS && !input.hisAsksAboutHer) {
    return silent(`budget（距上次 ${input.round - input.lastExpressedRound} 轮 < ${BUDGET_TURNS}）`);
  }
  // 3) 没有可辨识情绪 → 静息
  const { emotion, value, ambiguous } = pickEmotion(input.activated, input.lowEstablished);
  if (!emotion) return silent(ambiguous ? 'ambiguous（两个情绪并列，不硬演）' : 'resting（没有明显情绪）');

  // 4) 时间尺度：只有持续来源才算 sustained（避免"短暂触发→我这两天一直很沉"）
  const sustainedByMood = Math.abs(Number(input.moodDelta ?? 0)) >= SUSTAINED_MOOD_DELTA;
  const sustained = Boolean(input.lowEstablished) || sustainedByMood || Boolean(input.ruminationActive);
  const duration: PlanDuration = input.hisAsksAboutHer && !sustained ? 'unknown' : sustained ? 'sustained' : 'transient';

  // 5) 证据：只列真实存在的来源；没有就明确"说不清"
  // v2.22：`evidence` 只放**结构化原因标签**，绝不拼用户原话。
  // 引文单独留在 `causeQuote` 字段里，由 `expressionPlanToSnippet()` 只拼进 Prompt；
  // 这样任何把 plan 落盘/上报的消费者（turn trace、审计、日志）都不可能顺手带走原话。
  const evidenceParts: string[] = [];
  if (input.lowEstablished) evidenceParts.push('低谷已持续成段');
  if (sustainedByMood) evidenceParts.push(`心情层偏置 ${Number(input.moodDelta).toFixed(2)}`);
  if (input.ruminationActive) evidenceParts.push('反刍层在运转');
  const intrinsic = (input.intrinsic ?? []).find(c => c && c.eventId && c.evidenceRef);
  if (intrinsic) evidenceParts.push(`内在活动：${intrinsic.type}（${intrinsic.evidenceRef}）`);
  if (input.causeQuote) evidenceParts.push('本轮他的原话（引文只在 Prompt 片段里提供）');
  const evidence = evidenceParts.length ? evidenceParts.join('；') : null;

  const confidence = Math.min(0.95,
    0.5
    + (input.causeQuote ? 0.15 : 0)
    + (sustained ? 0.15 : 0)
    + (intrinsic ? 0.1 : 0)
    + Math.min(0.1, value * 0.2));

  return {
    decision: 'express',
    reason: `express:${emotion}${sustained ? '(sustained)' : '(transient)'}`,
    emotion,
    tone: TONE_BY_EMOTION[emotion] ?? 'calm',
    duration,
    maxSentences: 1,
    maxQuestions: input.hisAsksAboutHer ? 1 : 1,
    evidence,
    causeQuote: input.causeQuote ?? null,
    sourceEventId: intrinsic?.eventId ?? null,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** 把计划渲染成给回复模型的片段。模型只负责说自然，不负责改情绪/编原因。 */
export function expressionPlanToSnippet(plan: ExpressionPlan): string | null {
  if (plan.decision !== 'express' || !plan.emotion) return null;
  const durationRule = plan.duration === 'sustained'
    ? '可以说"这两天/最近"这类持续感（因为确有持续来源）。'
    : plan.duration === 'transient'
      ? '**只能说此刻**；禁止说"这两天/一直/最近几天/这些天"（那会被当成持续状态）。'
      : '只回答你此刻的状态，不延伸成"最近一直"。';
  // v2.22：引文只在 Prompt 片段里拼；`plan.evidence` 本身保持无原话（可安全落盘/上报）
  const evidenceText = [plan.evidence, plan.causeQuote ? `他刚说的「${plan.causeQuote}」` : null]
    .filter(Boolean)
    .join('；');
  const evidenceRule = evidenceText
    ? `可引用的原因：${evidenceText}；除此之外不要编原因，说不清就说"说不上来为什么"。`
    : '没有可引用原因：可以说"说不上来为什么"，不许编一个理由。';
  return [
    `【这一轮你可以说一句自己（可选，不说也行；最多 ${plan.maxSentences} 句、≤30 字）】`,
    `- 你此刻被激起的是「${plan.emotion}」，不是装的；语气：${plan.tone}。`,
    `- ${durationRule}`,
    `- ${evidenceRule}`,
    `- 说完回到他的事；最多 ${plan.maxQuestions} 个问题；不要展开自述，不要借机要他安慰你。`,
  ].join('\n');
}
