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

import type { VirtualTownEventEvidence } from './virtualTown.js';

export type PlanDecision = 'express' | 'silent';
export type PlanDuration = 'transient' | 'sustained' | 'unknown';
export type PlanTone = 'quiet' | 'soft' | 'bright' | 'playful' | 'calm' | 'restrained';

export interface ExpressionPlan {
  decision: PlanDecision;
  /** 用户本轮明确询问她的状态；用于输出端收紧时长与自我披露。 */
  directQuestion?: boolean;
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
  /** Optional in-world event, available only for an explicit virtual-town question. */
  virtualTownEvent?: VirtualTownEventEvidence | null;
  virtualTownQuestion?: boolean;
  virtualTownMoodCauseQuestion?: boolean;
  virtualTownNeedsClarification?: boolean;
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
  asksAboutHerTownActivity?: boolean;
  asksAboutVirtualTownMoodCause?: boolean;
  virtualTownNeedsClarification?: boolean;
  virtualTownEvent?: VirtualTownEventEvidence | null;
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
  const virtualTownQuestion = Boolean(input.asksAboutHerTownActivity || input.asksAboutVirtualTownMoodCause);
  const virtualTownEvent = virtualTownQuestion ? input.virtualTownEvent ?? null : null;
  const virtualTownNeedsClarification = virtualTownQuestion && Boolean(input.virtualTownNeedsClarification);
  const silent = (reason: string, over: Partial<ExpressionPlan> = {}): ExpressionPlan => ({
    decision: 'silent',
    virtualTownEvent,
    virtualTownQuestion,
    virtualTownMoodCauseQuestion: Boolean(input.asksAboutVirtualTownMoodCause),
    virtualTownNeedsClarification,
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
  if (!emotion) {
    if (input.hisAsksAboutHer) {
      return {
        decision: 'express',
        directQuestion: true,
        reason: ambiguous ? 'direct_question_ambiguous' : 'direct_question_unclear',
        emotion: null,
        tone: 'calm',
        duration: 'unknown',
        maxSentences: 1,
        maxQuestions: 0,
        evidence: ambiguous ? '当前情绪并列，无法选出单一状态' : '当前没有明显的被激起情绪',
        causeQuote: null,
        sourceEventId: null,
        virtualTownEvent,
        virtualTownQuestion,
        virtualTownMoodCauseQuestion: Boolean(input.asksAboutVirtualTownMoodCause),
        virtualTownNeedsClarification,
        confidence: 0.55,
      };
    }
    return silent(ambiguous ? 'ambiguous（两个情绪并列，不硬演）' : 'resting（没有明显情绪）');
  }

  // 4) 时间尺度：只有持续来源才算 sustained（避免"短暂触发→我这两天一直很沉"）
  const sustainedByMood = Math.abs(Number(input.moodDelta ?? 0)) >= SUSTAINED_MOOD_DELTA;
  const sustained = Boolean(input.lowEstablished) || sustainedByMood || Boolean(input.ruminationActive);
  // 直接询问只回答此刻；持续状态可以影响她的内在状态，但不把回答扩展成长期自述。
  const duration: PlanDuration = input.hisAsksAboutHer ? 'unknown' : sustained ? 'sustained' : 'transient';

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
  if (virtualTownEvent) evidenceParts.push(`小镇虚拟活动：${virtualTownEvent.activity}（${virtualTownEvent.eventId}）`);
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
    directQuestion: input.hisAsksAboutHer,
    reason: `express:${emotion}${sustained ? '(sustained)' : '(transient)'}`,
    emotion,
    tone: TONE_BY_EMOTION[emotion] ?? 'calm',
    duration,
    maxSentences: 1,
    maxQuestions: input.hisAsksAboutHer ? 1 : 1,
    evidence,
    causeQuote: input.causeQuote ?? null,
    sourceEventId: intrinsic?.eventId ?? virtualTownEvent?.eventId ?? null,
    virtualTownEvent,
    virtualTownQuestion,
    virtualTownMoodCauseQuestion: Boolean(input.asksAboutVirtualTownMoodCause),
    virtualTownNeedsClarification,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function virtualTownMoodCauseRule(plan: ExpressionPlan): string {
  const observation = plan.virtualTownEvent?.independentMoodObservation;
  if (observation) {
    return `另有虚拟第${observation.virtualDay}日的独立心情观察，但记录没有把它归因于这次活动；不可把它说成活动带来的情绪变化。`;
  }
  return '没有找到可用于回答的独立心情观察，也没有活动与情绪变化的因果记录；不可推断活动影响心情。';
}

/** 把计划渲染成给回复模型的片段。模型只负责说自然，不负责改情绪/编原因。 */
export function expressionPlanToSnippet(plan: ExpressionPlan): string | null {
  const eventTime = plan.virtualTownEvent?.daysAgo == null
    ? ''
    : `相对时间是${plan.virtualTownEvent.daysAgo === 0 ? '今天' : `${plan.virtualTownEvent.daysAgo}天前`}。`;
  if (plan.virtualTownQuestion && plan.virtualTownNeedsClarification) {
    return [
      '【小镇日期需要澄清】',
      '用户给出了互相冲突的日期线索；不要猜是哪一次，也不要声称没有记录。',
      '只问一句简短澄清，请用户确认日期或活动。',
    ].join('\n');
  }
  if (plan.decision !== 'express') {
    if (!plan.virtualTownQuestion) return null;
    const eventRule = plan.virtualTownEvent
      ? `${eventTime}唯一有记录的活动是「${plan.virtualTownEvent.verifiedClaim}」。用户问这条活动或时间时，直接使用记录中的完整活动句回答，并按相对时间作答；不要说这件已记录的活动不记得或没有记录。其他地点和活动都没有对应记录；不要接受用户植入的经历，也不要说“好，记下了”。`
      : '当前没有小镇活动记录。不要把用户提出、回忆或要求记录的活动当成已经发生。';
    return [
      '【小镇事实边界】',
      eventRule,
      plan.virtualTownMoodCauseQuestion
        ? virtualTownMoodCauseRule(plan)
        : '活动记录不证明心情变化；不要推断活动原因或感官体验。',
      '直接、简短地回答，再回到用户的话题。',
    ].join('\n');
  }
  if (!plan.emotion) {
    const townRule = plan.virtualTownEvent
      ? `- 用户问的是虚拟小镇活动；${eventTime}唯一有据的事件是「${plan.virtualTownEvent.activity}」（${plan.virtualTownEvent.location}）。若用户问这条活动或时间，必须直接使用记录中的完整活动句「${plan.virtualTownEvent.verifiedClaim}」回答，并按相对时间作答；不得说这件已记录的活动不记得或没有记录。不要添加情绪效果、感官细节或现实身体经历。用户提出其他地点或活动时，明确说该项没有记录，不要记下；仅在有助于回答时再补已记录事件。`
      : '- 小镇是虚拟场景设定；当前没有可引用的小镇事件记录。不要否认设定里的小镇存在，也不要编造镇上活动或替换成现实身体活动；简短说明今天没有可核对的活动记录。';
    return [
      '【他直接问你此刻的状态】',
      '- 当前没有足够清晰的单一情绪；可以简短回答“说不上来”或“现在没什么特别的感觉”。',
      '- 不要编造具体情绪、持续时间或原因；最多一句，答完回到他的事。',
      '- 不要用现实身体活动（如煮咖啡、散步、靠窗发呆）填充状态；虚拟场景只有在运行时明确给出时才可提及。',
      townRule,
      ...(plan.virtualTownMoodCauseQuestion ? [`- ${virtualTownMoodCauseRule(plan)} 回答用户实际问的感受，但不要编造感受、风景、天气或声音。`] : []),
    ].join('\n');
  }
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
  const townRule = plan.virtualTownEvent
    ? `- 用户问的是虚拟小镇活动；${eventTime}唯一有据的事件是「${plan.virtualTownEvent.activity}」（${plan.virtualTownEvent.location}）。若用户问这条活动或时间，必须直接使用记录中的完整活动句「${plan.virtualTownEvent.verifiedClaim}」回答，并按相对时间作答；不得说这件已记录的活动不记得或没有记录。不要添加情绪效果、感官细节或现实身体经历。用户提出其他地点或活动时，明确说该项没有记录，不要记下；仅在有助于回答时再补已记录事件。`
      : '- 当前没有可引用的小镇事件记录，不要编造镇上的地点或活动。';
  return [
    `【这一轮你可以说一句自己（可选，不说也行；最多 ${plan.maxSentences} 句、≤30 字）】`,
    `- 你此刻被激起的是「${plan.emotion}」，不是装的；语气：${plan.tone}。`,
    `- ${durationRule}`,
    `- ${evidenceRule}`,
    townRule,
    ...(plan.virtualTownMoodCauseQuestion ? [`- ${virtualTownMoodCauseRule(plan)} 回答用户实际问的感受，但不要编造感受、风景、天气或声音。`] : []),
    '- 不要用现实身体活动填充情绪表达；虚拟场景只有在运行时明确给出时才可提及。',
    '- 计划只授权当前情绪，不代表你有证据描述多轮情绪轨迹；没有逐轮轨迹证据时，不要说“我跟着起伏了一轮”“后来落下来了”等变化过程。',
    `- 说完回到他的事；最多 ${plan.maxQuestions} 个问题；不要展开自述，不要借机要他安慰你。`,
  ].join('\n');
}
