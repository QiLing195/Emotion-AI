/**
 * v2.03：单轮非用户来源的总预算（审查 P1-2）。
 *
 * 问题：一条用户消息可能同时经过 `emotionEvent`（直接刺激）、奖惩强化、情绪传染、
 * 关系评价、内在事件、心情层、反刍层。各条路都有自己的上限，但**加起来**没有总预算，
 * 于是一句强情绪可能被多次计入。
 *
 * 做法（保守、可回退）：
 *   - 以"直接刺激之后"的状态为基准（`base`）；
 *   - 后续所有非直接来源造成的累计变化（九情 L1 + |Δvalence| + |Δarousal|）超过 cap 时，
 *     把**超出部分等比缩回**（保留各来源的相对比例）；
 *   - 返回实际被削掉的量，调用方可以把它记入诊断（`budget` 来源），保证"来源之和 ≈ 总变化"。
 *
 * 只作用于非用户来源；用户的直接话语造成的位移不在预算内（用户信号优先）。
 */
import type { EmotionState } from './emotionTypes';

export interface TurnBudgetResult {
  state: EmotionState;
  /** 实际削掉的量（绝对值）：用于记账，让各来源之和与总变化对得上 */
  removed: { valence: number; arousal: number; emotionAbs: number };
  scale: number;
  totalBefore: number;
  cap: number;
}

function l1(obj: Record<string, number>): number {
  return Object.values(obj).reduce((n, v) => n + Math.abs(v), 0);
}

/**
 * @param state 当前状态（所有非用户来源已施加）
 * @param base  直接刺激之后的状态快照
 * @param cap   本 turn 非用户来源允许的总影响（默认 0.25）
 */
export function applyNonUserTurnBudget(
  state: EmotionState,
  base: { emotions: Record<string, number>; valence: number; arousal: number },
  cap = 0.25,
): TurnBudgetResult {
  const keys = new Set([...Object.keys(state.emotions ?? {}), ...Object.keys(base.emotions ?? {})]);
  const deltaEmo: Record<string, number> = {};
  for (const k of keys) {
    const a = Number((state.emotions as unknown as Record<string, number>)?.[k] ?? 0);
    const b = Number(base.emotions?.[k] ?? 0);
    deltaEmo[k] = a - b;
  }
  const deltaValence = Number(state.taiji?.valence ?? 0) - Number(base.valence ?? 0);
  const deltaArousal = Number(state.taiji?.arousal ?? 0) - Number(base.arousal ?? 0);
  const totalBefore = l1(deltaEmo) + Math.abs(deltaValence) + Math.abs(deltaArousal);

  if (!Number.isFinite(totalBefore) || totalBefore <= cap || totalBefore <= 0) {
    return {
      state,
      removed: { valence: 0, arousal: 0, emotionAbs: 0 },
      scale: 1,
      totalBefore,
      cap,
    };
  }

  const scale = cap / totalBefore;
  // 把超出部分缩回：new = base + delta * scale
  const nextEmotions = { ...(state.emotions as unknown as Record<string, number>) };
  for (const k of keys) {
    nextEmotions[k] = Number(base.emotions?.[k] ?? 0) + deltaEmo[k] * scale;
  }
  const next: EmotionState = {
    ...state,
    emotions: nextEmotions as unknown as EmotionState['emotions'],
    taiji: {
      ...state.taiji,
      valence: Number(base.valence ?? 0) + deltaValence * scale,
      arousal: Number(base.arousal ?? 0) + deltaArousal * scale,
    },
  };
  return {
    state: next,
    removed: {
      valence: deltaValence * (1 - scale),
      arousal: deltaArousal * (1 - scale),
      emotionAbs: l1(deltaEmo) * (1 - scale),
    },
    scale,
    totalBefore,
    cap,
  };
}
