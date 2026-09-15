// ── v1.8 心情层 (Mood Layer) ──
// 补上情绪涌现的第二个缺口：**情绪只有"此刻"，没有"底色"**。
//
// 打比方：
//   · 情绪(emotion) = 天气（分钟~小时）
//   · 心情(mood)    = 季节/气候（半天~一天）  ← 本模块
//   · 人格(personality) = 气候带（月~年，由 evolution 承担）
//
// 作用：
//   ① 跨轮/跨会话连续 —— 她昨天被你说的话伤到，今天早上一句"早"也不该立刻阳光灿烂
//   ② 给情绪一个偏置 —— 心情低落时，中性的话也更容易被听成有点淡
//   ③ 反"自嗨漂移" —— 心情向 0 缓慢衰减（无新证据就淡忘），且遇到强烈情绪时让位
//
// 关键约束（用户信号优先）：
//   · 单轮偏置幅度 ≤ MOOD_MAX_BIAS（0.05），只做"轻推"
//   · 当下主导情绪越强，心情偏置权重越低（强烈情绪时心情让位）
//   · 心跳超过 MOOD_FRESHNESS_H 未更新 → 偏置权重衰减到 0（不带着一周前的心情说话）
//
// 纯逻辑模块：无 io/React 依赖。

import type { EmotionState, MoodState } from './emotionTypes';

/** 心情 EMA 时间常数（小时）：约 12h 内完成一半权重更新 */
export const MOOD_TAU_H = 12;
/** 心情向中性（0）衰减的半衰期（小时）：没有新互动就慢慢淡掉 */
export const MOOD_HALF_LIFE_H = 18;
/** 每轮偏置最多推动多少（绝对上限，防心情盖过情绪） */
export const MOOD_MAX_BIAS = 0.05;
/** 每轮向心情靠拢的比例 */
export const MOOD_PULL = 0.08;
/** 唤醒维度的靠拢比例（比效价更弱：心情更多体现在好坏，不在能量） */
export const MOOD_AROUSAL_PULL = 0.05;
/** 首次采样时的采纳率（第一轮不足以定义"今天的心情"） */
export const MOOD_FIRST_ALPHA = 0.35;
/**
 * 单轮最小采纳率：心情本身是 12h 尺度量，但同一场连续对话里也应缓慢成形
 * （否则快速连续的几十轮对心情毫无影响）。仅作下限，不改变长时间尺度的"慢"。
 */
export const MOOD_MIN_ALPHA = 0.02;
/** 偏置权重保持满值的时长（小时） */
export const MOOD_FULL_WEIGHT_H = 6;
/** 偏置权重衰减到 0 的时长（小时）：超过此空闲时长则心情不再影响本轮 */
export const MOOD_FRESHNESS_H = 24;
/** 强烈情绪让位系数：主导情绪强度 1.0 时偏置权重降到 (1 - 此值) */
export const MOOD_YIELD_TO_EMOTION = 0.7;
/** 心情偏差映射到太极效价的最大位移（心情 ±1 → 静息效价 ±此值） */
export const MOOD_SPAN = 0.35;
/** 心情死区：|偏差| 小于此值时完全不产生偏置（不干扰用户当下带来的情绪） */
export const MOOD_DEADZONE = 0.05;
/** 创建心情时的默认静息效价锚点（未被调用方指定时使用） */
export const DEFAULT_ANCHOR_VALENCE = 0.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 小时差（now - then），非法输入返回 0 */
export function hoursBetween(then: number | undefined, now: number): number {
  if (typeof then !== 'number' || !Number.isFinite(then)) return 0;
  const h = (now - then) / 3_600_000;
  return Number.isFinite(h) && h > 0 ? h : 0;
}

export function createMood(now: number, anchorValence = DEFAULT_ANCHOR_VALENCE): MoodState {
  return {
    valence: 0,
    arousal: 0,
    anchorValence: Number.isFinite(anchorValence) ? clamp(anchorValence, -1, 1) : DEFAULT_ANCHOR_VALENCE,
    updatedAt: now,
    samples: 0,
  };
}

/**
 * 从情感状态取一个心情采样点。
 *
 * ⚠️ 关键设计：采样的是**九情净效价（0 中心，相对量）**，不是太极效价绝对值。
 * 因为太极效价有一个正的静息点（默认人格 0.2、甜蜜人格 0.5），若直接采绝对值，
 * "她被你说得难过"时心情反而是正的——那正好把用户的影响抹平（方向反了）。
 * 净效价以 0 为中心：平静时 ≈ 0，愉悦为正，难过为负，与人格设定无关。
 */
export function moodSampleFrom(state: EmotionState): { valence: number; arousal: number } {
  const e = state.emotions ?? {};
  const positive = (e.joy ?? 0) + (e.love ?? 0) * 0.8 + (e.lust ?? 0) * 0.4;
  const negative = (e.sad ?? 0)
    + (e.fear ?? 0) * 0.8
    + (e.anger ?? 0) * 0.6
    + (e.disgust ?? 0) * 0.5;
  return {
    valence: clamp((positive - negative) / 1.5, -1, 1),
    arousal: clamp(state.taiji.arousal, 0, 1),
  };
}

/** 按半衰期把心情向中性衰减（不修改入参） */
export function decayedMood(mood: MoodState | undefined, now: number): MoodState {
  if (!mood || !Number.isFinite(mood.valence)) return createMood(now);
  const ageH = hoursBetween(mood.updatedAt, now);
  if (ageH <= 0) return { ...mood };
  const factor = Math.pow(0.5, ageH / MOOD_HALF_LIFE_H);
  return {
    ...mood,
    valence: mood.valence * factor,
    arousal: mood.arousal * factor,
    updatedAt: now,
  };
}

/**
 * 用本轮情感状态更新心情（EMA + 时间加权）。
 * - dt 越大，采纳率越高（久别回来时，心情快速跟上当下，而不是被旧心情拖住）
 * - 无历史心情时用 MOOD_FIRST_ALPHA 部分采纳（单轮不足以定义一天的心情）
 * - anchorValence 是"她的静息基线"（调用方传 evolution.baseline）：
 *   传入时以传入值为准（基线漂移/persona 变更会自动纠正历史锚点），
 *   未传入时沿用历史锚点。
 */
export function updateMood(
  mood: MoodState | undefined,
  sample: { valence: number; arousal: number },
  now: number,
  anchorValence?: number,
): MoodState {
  const target = {
    valence: clamp(sample.valence, -1, 1),
    arousal: clamp(sample.arousal, 0, 1),
  };
  const fallbackAnchor = Number.isFinite(mood?.anchorValence as number)
    ? clamp(mood!.anchorValence, -1, 1)
    : DEFAULT_ANCHOR_VALENCE;
  const anchor = Number.isFinite(anchorValence as number)
    ? clamp(anchorValence as number, -1, 1)
    : fallbackAnchor;
  if (!mood || !Number.isFinite(mood.valence) || mood.samples <= 0) {
    return {
      valence: target.valence * MOOD_FIRST_ALPHA,
      arousal: target.arousal * MOOD_FIRST_ALPHA,
      anchorValence: anchor,
      updatedAt: now,
      samples: 1,
    };
  }
  // 先按半衰期淡忘，再吸收本轮采样
  const base = decayedMood(mood, now);
  const dtH = hoursBetween(mood.updatedAt, now);
  const alpha = dtH <= 0
    ? MOOD_FIRST_ALPHA
    : clamp(1 - Math.exp(-dtH / MOOD_TAU_H), MOOD_MIN_ALPHA, 1);
  return {
    valence: base.valence + (target.valence - base.valence) * alpha,
    arousal: base.arousal + (target.arousal - base.arousal) * alpha,
    anchorValence: anchor,
    updatedAt: now,
    samples: mood.samples + 1,
  };
}

/** 偏置权重：新鲜度（0~1）× 强烈情绪让位（0~1） */
export function moodBiasWeight(
  mood: MoodState | undefined,
  now: number,
  dominantIntensity = 0,
): number {
  if (!mood || mood.samples <= 0) return 0;
  const ageH = hoursBetween(mood.updatedAt, now);
  if (ageH >= MOOD_FRESHNESS_H) return 0;
  const freshness = ageH <= MOOD_FULL_WEIGHT_H
    ? 1
    : 1 - (ageH - MOOD_FULL_WEIGHT_H) / (MOOD_FRESHNESS_H - MOOD_FULL_WEIGHT_H);
  const yieldFactor = 1 - MOOD_YIELD_TO_EMOTION * clamp(dominantIntensity, 0, 1);
  return clamp(freshness, 0, 1) * clamp(yieldFactor, 0, 1);
}

/**
 * 本轮心情的**目标太极效价**：静息锚点 + 心情偏差 × MOOD_SPAN。
 * 锚点应当是她的人格基线（`evolution.baseline`），而不是"此刻的效价"——
 * 否则心情会锚在当下的低谷上，把"她今天很难过"变成"她一直这么难过"（自我强化漂移）。
 */
export function moodTargetValence(mood: MoodState, now: number): number {
  const decayed = decayedMood(mood, now);
  const anchor = Number.isFinite(mood.anchorValence) ? mood.anchorValence : DEFAULT_ANCHOR_VALENCE;
  return clamp(anchor + decayed.valence * MOOD_SPAN, -1, 1);
}

/**
 * 本轮心情偏置向量。
 * `baseValence` 是**本轮开始前**（用户话语生效之前）的效价：
 * 偏置量按"起点 → 目标"的差距计算，再叠加到当前状态上，
 * 这样心情不会去抹平用户刚刚造成的影响（用户信号优先）。
 */
export function moodBias(
  mood: MoodState | undefined,
  now: number,
  dominantIntensity = 0,
  baseValence = 0,
): { valence: number; arousal: number; weight: number } {
  const weight = moodBiasWeight(mood, now, dominantIntensity);
  if (weight <= 0 || !mood) return { valence: 0, arousal: 0, weight: 0 };
  const decayed = decayedMood(mood, now);
  if (Math.abs(decayed.valence) < MOOD_DEADZONE) return { valence: 0, arousal: 0, weight };
  return {
    valence: clamp(
      (moodTargetValence(mood, now) - baseValence) * MOOD_PULL * weight,
      -MOOD_MAX_BIAS,
      MOOD_MAX_BIAS,
    ),
    arousal: clamp(
      (decayed.arousal - 0.5) * MOOD_AROUSAL_PULL * weight,
      -MOOD_MAX_BIAS * 0.5,
      MOOD_MAX_BIAS * 0.5,
    ),
    weight,
  };
}

/**
 * 把心情作为轻推作用到情感状态（纯函数，返回新状态）。
 * 注意：
 *   · 偏置量是"起点效价 → 目标效价（静息锚点 + 心情偏差）"的一小步，
 *     靠拢式偏置天然自限，不会因为连续多轮同向叠加而漂移出去。
 *   · `baseValence` 默认取当前效价；显式传入"本轮开始前的效价"可保证
 *     不削弱用户当下带来的情绪变化。
 *   · |心情偏差| < MOOD_DEADZONE 时完全不介入。
 */
export function applyMoodBias(
  state: EmotionState,
  mood: MoodState | undefined,
  now: number,
  dominantIntensity = 0,
  baseValence: number = state.taiji.valence,
): EmotionState {
  if (!mood || mood.samples <= 0) return state;
  const weight = moodBiasWeight(mood, now, dominantIntensity);
  if (weight <= 0) return state;
  const decayed = decayedMood(mood, now);
  if (Math.abs(decayed.valence) < MOOD_DEADZONE) return state;

  const dValence = clamp(
    (moodTargetValence(mood, now) - baseValence) * MOOD_PULL * weight,
    -MOOD_MAX_BIAS,
    MOOD_MAX_BIAS,
  );
  const dArousal = clamp(
    (decayed.arousal - state.taiji.arousal) * MOOD_AROUSAL_PULL * weight,
    -MOOD_MAX_BIAS * 0.5,
    MOOD_MAX_BIAS * 0.5,
  );
  if (Math.abs(dValence) < 1e-6 && Math.abs(dArousal) < 1e-6) return state;

  const next = structuredClone(state);
  next.taiji.valence = clamp(next.taiji.valence + dValence, -1, 1);
  next.taiji.arousal = clamp(next.taiji.arousal + dArousal, 0, 1);
  // 心情不直接改动九情强度（那是情绪层的事），只动太极底色
  // 但会轻微牵动与心情同向的主导情绪，让"底色"能被她自己感知到
  const pullEmotion = Math.min(Math.abs(dValence), MOOD_MAX_BIAS);
  if (pullEmotion > 0 && decayed.valence > 0) {
    next.emotions.joy = clamp((next.emotions.joy ?? 0) + pullEmotion * 0.5, -1, 1);
  } else if (pullEmotion > 0 && decayed.valence < 0) {
    next.emotions.sad = clamp((next.emotions.sad ?? 0) + pullEmotion * 0.5, -1, 1);
  }
  return next;
}

/** 心情的自然语言描述（供日志/提示词/前端展示） */
export function describeMood(mood: MoodState | undefined, now: number): string {
  if (!mood || mood.samples <= 0) return '平静';
  const decayed = decayedMood(mood, now);
  const v = decayed.valence;
  const a = decayed.arousal;
  if (v >= 0.45) return a >= 0.5 ? '心情很好、很有活力' : '心情很好';
  if (v >= 0.15) return a >= 0.5 ? '心情不错、兴致挺高' : '心情不错';
  if (v <= -0.45) return a >= 0.5 ? '心情很低落，还有点烦躁' : '心情很低落';
  if (v <= -0.15) return a >= 0.5 ? '心情有点糟，静不下来' : '心情有点低落';
  if (a >= 0.6) return '心里有点躁动';
  if (a <= 0.25) return '心情平静，有点懒';
  return '心情平淡';
}

/**
 * 心情的提示词片段：只在心情明显偏离中性时给出（避免每轮都注入同一句话，
 * 那本身就是"机械化"的来源）。
 */
export function moodPromptHint(mood: MoodState | undefined, now: number): string | null {
  if (!mood || mood.samples <= 0) return null;
  // 与偏置同一条新鲜度门槛：过期心情既不偏置、也不提示
  if (moodBiasWeight(mood, now) <= 0) return null;
  const decayed = decayedMood(mood, now);
  if (Math.abs(decayed.valence) < 0.18 && Math.abs(decayed.arousal - 0.5) < 0.25) return null;
  return `【当前底色心情】${describeMood(mood, now)}（这是她今天整体的情绪底色，会以很淡的方式影响语气；不要直接说出"我心情指数是X"，也别说教）`;
}
