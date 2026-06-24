/**
 * 亲密加速器 — 现实关系加速因子
 *
 * 纯情绪的 intimacyDelta = (posContrib - negContrib) * 0.01 太慢太机械。
 * 现实中，共同爱好、共情、深度交流、自我暴露都会加速亲密。
 *
 * 本模块在不修改核心情感引擎的前提下，计算加速倍率，
 * 由 useAIBrainStore.updateEmotion() 在 applyEvent 后应用。
 */

export interface AcceleratorContext {
  /** 用户本轮消息原文 */
  userMessage: string;
  /** 用户消息长度（字符数） */
  messageLength: number;
  /** AI 选择的策略（如 empathize, share, explore 等） */
  strategy: string | null;
  /** 用户情感分析结果 */
  userSentiment: {
    expressedEmotion: string;
    intensity: number;
    directedAtAI: boolean;
    likelyCause: string;
  } | null;
  /** 是否检测到兴趣信号 */
  interestSignals: string[];
  /** 当前人格的 empathy 值 (0-100) */
  personaEmpathy: number;
  /** 当前连续正向交互次数 */
  positiveStreak: number;
  /** 当前 intimacyToUser (0-1) */
  currentIntimacy: number;
  /** 当前关系阶段 */
  currentStage: string;
}

export interface BoostResult {
  /** 最终倍率 (1.0 = 无加速) */
  multiplier: number;
  /** 各因子分解 */
  factors: {
    name: string;
    label: string;
    value: number;
  }[];
}

/**
 * 计算亲密加速倍率。
 *
 * 倍率叠加规则：各因子加权求和，clamp 到 [1.0, 5.0]。
 * 基准 = 1.0（纯情绪驱动）。
 */
export function computeIntimacyBoost(ctx: AcceleratorContext): BoostResult {
  const factors: { name: string; label: string; value: number }[] = [];

  // ── 因子 1：共情事件 (empathy event) ──
  // 当用户表达了强烈情绪 (intensity > 0.5) 且 AI 使用 empathize 策略
  let empathyBoost = 0;
  if (
    ctx.strategy === 'empathize' &&
    ctx.userSentiment &&
    ctx.userSentiment.intensity > 0.5
  ) {
    empathyBoost = 0.5 + ctx.userSentiment.intensity * 1.0;
    if (ctx.userSentiment.directedAtAI) {
      empathyBoost += 0.5; // 情绪指向 AI 本人，再加 0.5
    }
  }
  factors.push({ name: 'empathy', label: '共情事件', value: empathyBoost });

  // ── 因子 2：兴趣共鸣 (shared interest) ──
  // 检测到用户话题命中 AI 的兴趣/知识领域
  let interestBoost = 0;
  if (ctx.interestSignals.length > 0) {
    interestBoost = Math.min(1.0, ctx.interestSignals.length * 0.35);
  }
  factors.push({ name: 'interest', label: '兴趣共鸣', value: interestBoost });

  // ── 因子 3：深度对话 (conversation depth) ──
  // 长消息通常意味着用户投入了更多情感/思考
  let depthBoost = 0;
  const len = ctx.messageLength;
  if (len > 200) {
    depthBoost = 0.8;
  } else if (len > 120) {
    depthBoost = 0.5;
  } else if (len > 60) {
    depthBoost = 0.25;
  } else if (len > 30) {
    depthBoost = 0.1;
  }
  factors.push({ name: 'depth', label: '深度对话', value: depthBoost });

  // ── 因子 4：自我暴露 (self-disclosure) ──
  // 用户分享个人信息/经历
  const selfDisclosurePatterns = [
    /我(曾经|以前|小时候|一直|总是|觉得|认为|相信|决定)/,
    /我的(梦想|秘密|故事|经历|过去|家庭|朋友|工作)/,
    /告诉[你我]/,
    /其实.*我/,
    /说真的/,
    /说实话/,
    /跟你分享/,
    /只有你知道/,
  ];
  let disclosureCount = 0;
  for (const pat of selfDisclosurePatterns) {
    if (pat.test(ctx.userMessage)) disclosureCount++;
  }
  const disclosureBoost = Math.min(1.0, disclosureCount * 0.3);
  factors.push({ name: 'disclosure', label: '自我暴露', value: disclosureBoost });

  // ── 因子 5：用户主动亲近 (active affection) ──
  const affectionPatterns = [
    /想你了?/,
    /喜欢[你我]/,
    /爱[你我]/,
    /离不开[你我]/,
    /好想你/,
    /你真[好棒]/,
    /有你在/,
    /陪[着我伴]/,
    /❤|💕|💗|😘|😍/,
    /抱抱|亲亲|贴贴/,
  ];
  let affectionCount = 0;
  for (const pat of affectionPatterns) {
    if (pat.test(ctx.userMessage)) affectionCount++;
  }
  const affectionBoost = Math.min(1.5, affectionCount * 0.4);
  factors.push({ name: 'affection', label: '主动亲近', value: affectionBoost });

  // ── 因子 6：连续正向 (positive streak) ──
  // 多轮积极交互的复利效应
  let streakBoost = 0;
  if (ctx.positiveStreak >= 5) {
    streakBoost = 0.6;
  } else if (ctx.positiveStreak >= 3) {
    streakBoost = 0.3;
  } else if (ctx.positiveStreak >= 2) {
    streakBoost = 0.15;
  }
  factors.push({ name: 'streak', label: '连续正向', value: streakBoost });

  // ── 因子 7：陌生人阶段加速 (early stage bonus) ──
  // 现实中从陌生到初识的进展比后期快得多
  let earlyStageBoost = 0;
  if (ctx.currentStage === 'stranger' && ctx.currentIntimacy < 0.3) {
    earlyStageBoost = 1.5; // 陌生人阶段大幅加速
  } else if (ctx.currentStage === 'acquaintance' && ctx.currentIntimacy < 0.5) {
    earlyStageBoost = 0.8;
  }
  factors.push({ name: 'earlyStage', label: '初期加速', value: earlyStageBoost });

  // ── 因子 8：共情人格加成 ──
  // 高 empathy 的 AI 更容易建立亲密
  const empathyTraitBoost = Math.max(0, (ctx.personaEmpathy - 50) / 100);
  factors.push({ name: 'empathyTrait', label: '共情天赋', value: empathyTraitBoost });

  // ── 汇总 ──
  const rawMultiplier = 1.0 + factors.reduce((sum, f) => sum + f.value, 0);
  const multiplier = Math.min(5.0, Math.max(1.0, rawMultiplier));

  return { multiplier, factors };
}
