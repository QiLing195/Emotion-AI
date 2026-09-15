// ── v1.8 反刍层 (Rumination) ──
// 补上情绪涌现的第三个缺口：**同一情绪反复出现时没有"疲劳/消化"机制**。
//
// 反刍的真实心理形态：
//   · 好事/坏事连续同一情绪主导 → 情绪变得"粘"，表达开始重复
//   · 但边际强度递减（第 5 轮还在难过，不会比第 1 轮更炸）
//   · 时间久了会疲惫、钝化、自我安抚（calm 上升、唤醒下降）
//   · 长时间中断 → 链条重置（不是"永远记得上次的情绪"）
//
// 它同时是防"情绪卡死 / 过度拟合单一情绪"的闸门：
//   连续主导 ≥ RUMINATION_ONSET 轮后，主导情绪按边际递减被抑制，
//   并让 calm（自我安抚）回升，给情绪切换留出口。
//
// 纯逻辑模块：无 io/React 依赖。

import type { EmotionState, RuminationState } from './emotionTypes';

/** 连续多少轮同一情绪主导才进入反刍 */
export const RUMINATION_ONSET = 3;
/** 进入反刍后，每多一轮主导情绪被抑制的比例 */
export const RUMINATION_SATIATION_PER_TURN = 0.06;
/** 主导情绪最大抑制比例（不会把情绪压没，只是"钝化"） */
export const RUMINATION_MAX_DAMP = 0.4;
/** 每多一轮，calm（自我安抚/消化）最多回升多少 */
export const RUMINATION_CALM_PER_TURN = 0.012;
/** calm 回升上限 */
export const RUMINATION_MAX_CALM = 0.06;
/** 反刍带来的唤醒衰减上限（久陷情绪会累） */
export const RUMINATION_MAX_AROUSAL_DROP = 0.03;
/** 强度低于此值的轮次视为"平淡轮"：不延续反刍链，反而让链条缓慢衰退 */
export const RUMINATION_FLOOR = 0.05;
/** 超过多少小时无互动，反刍链重置 */
export const RUMINATION_RESET_H = 6;
/** 抑制/回升计算的轮数上限（避免极长链条导致数值失稳） */
export const RUMINATION_STREAK_CAP = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 反刍只关心**被激活的情绪**，不关心底色。
 * `calm`（自我调节能力）与 `greed`（欲望底色）在静息状态下就很高
 * （初始 calm=0.8, greed=0.2），若按数值取最大，反刍链会永远锁在 calm 上，
 * 反刍机制形同虚设。因此本函数在「激活情绪集合」中取最大者。
 */
export const RUMINATION_TRACKED_EMOTIONS = [
  'joy', 'sad', 'anger', 'fear', 'love', 'disgust', 'lust',
] as const;

export function activatedDominant(
  emotions: Record<string, number>,
): { name: string; intensity: number } {
  let name = 'neutral';
  let intensity = 0;
  for (const key of RUMINATION_TRACKED_EMOTIONS) {
    const v = emotions[key] ?? 0;
    if (v > intensity) {
      intensity = v;
      name = key;
    }
  }
  return intensity > 0 ? { name, intensity } : { name: 'neutral', intensity: 0 };
}

/**
 * 推进反刍链。
 * - 同一情绪（且强度 ≥ FLOOR）→ streak + 1
 * - 换情绪 → streak = 1（重新开始）
 * - 平淡轮（强度 < FLOOR）→ streak - 1（不死锁，自然消退）
 * - 距上次超过 RUMINATION_RESET_H → streak = 1
 */
export function trackRumination(
  prev: RuminationState | undefined,
  dominant: string,
  intensity: number,
  now: number,
): RuminationState {
  const fresh = !prev
    || !Number.isFinite(prev.streak)
    || (now - prev.updatedAt) / 3_600_000 > RUMINATION_RESET_H;
  if (fresh) {
    return { emotion: dominant, streak: 1, updatedAt: now };
  }
  if (intensity < RUMINATION_FLOOR) {
    // 平淡轮：不换情绪，但链条衰退（下限 1，保留"她还在这个情绪底色里"）
    return { emotion: prev.emotion, streak: Math.max(1, prev.streak - 1), updatedAt: now };
  }
  if (dominant === prev.emotion) {
    return { emotion: dominant, streak: prev.streak + 1, updatedAt: now };
  }
  return { emotion: dominant, streak: 1, updatedAt: now };
}

/** 当前反刍强度（0 = 未进入反刍，1 = 链条已达上限） */
export function ruminationLevel(rumination: RuminationState | undefined, now: number): number {
  if (!rumination || rumination.streak <= RUMINATION_ONSET) return 0;
  const stale = (now - rumination.updatedAt) / 3_600_000 > RUMINATION_RESET_H;
  if (stale) return 0;
  const excess = Math.min(rumination.streak - RUMINATION_ONSET, RUMINATION_STREAK_CAP - RUMINATION_ONSET);
  return clamp(excess / (RUMINATION_STREAK_CAP - RUMINATION_ONSET), 0, 1);
}

/**
 * 反刍调制：抑制主导情绪的边际强度 + 轻微自我安抚（纯函数，返回新状态）。
 * 未达阈值返回原对象（同一引用）。
 */
export function ruminationModulation(
  state: EmotionState,
  rumination: RuminationState | undefined,
  now: number,
): EmotionState {
  const level = ruminationLevel(rumination, now);
  if (level <= 0 || !rumination) return state;

  const excess = Math.min(
    rumination.streak - RUMINATION_ONSET,
    RUMINATION_STREAK_CAP - RUMINATION_ONSET,
  );
  const damp = Math.min(RUMINATION_MAX_DAMP, excess * RUMINATION_SATIATION_PER_TURN);
  const calmGain = Math.min(RUMINATION_MAX_CALM, excess * RUMINATION_CALM_PER_TURN);
  const arousalDrop = Math.min(
    RUMINATION_MAX_AROUSAL_DROP,
    excess * (RUMINATION_MAX_AROUSAL_DROP / (RUMINATION_STREAK_CAP - RUMINATION_ONSET)),
  );

  const next = structuredClone(state);
  const cur = next.emotions[rumination.emotion];
  if (typeof cur === 'number' && cur > 0) {
    next.emotions[rumination.emotion] = clamp(cur * (1 - damp), -1, 1);
  }
  if (calmGain > 0) {
    next.emotions.calm = clamp((next.emotions.calm ?? 0) + calmGain, -1, 1);
  }
  next.taiji.arousal = clamp(next.taiji.arousal - arousalDrop, 0, 1);
  return next;
}

/** 反刍的自然语言描述（供日志/调试；返回 null 表示未进入反刍） */
export function describeRumination(
  rumination: RuminationState | undefined,
  now: number,
): string | null {
  if (!rumination || rumination.streak <= RUMINATION_ONSET) return null;
  if ((now - rumination.updatedAt) / 3_600_000 > RUMINATION_RESET_H) return null;
  return `反刍中：「${rumination.emotion}」已连续主导 ${rumination.streak} 轮`;
}

/**
 * 反刍的提示词片段：只给出"别重复同一种表达"的行为要求，不暴露内部数字。
 */
export function ruminationPromptHint(
  rumination: RuminationState | undefined,
  now: number,
): string | null {
  const desc = describeRumination(rumination, now);
  if (!desc) return null;
  return '【注意】她已连续几轮沉浸在类似情绪里：这次换一种表达方式（可以是动作、回忆、反问、或者干脆少说两句），不要重复上一轮的情绪句式。';
}
