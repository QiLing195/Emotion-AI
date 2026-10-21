/**
 * 低谷"能出来"的**只读探针**（v1.70）——不改任何行为，只记录"如果按新规则，她本该在第几轮出来"。
 *
 * 为什么需要：现在的低谷退出**只依赖时间衰减**（空闲多久），快节奏对话里 depth 不下降
 * ⇒ 一次沉进去就一直沉（实测 20 轮同一段，turns 3→23）。用户问"为什么她总显得沉"，
 * 结构性原因之一就是这个。
 *
 * 新规则候选（两条 OR，都要求"已明显离开峰值"）：
 *   ① 连续 2 轮 climbing（她自己往回爬）
 *   ② 段内正向信号累计 ≥ 0.10（被好消息/被陪伴一点点顶起来）
 *   且 depth ≤ peakDepth × 0.6（不是"还在半山腰"）
 *
 * 本文件只做**判定**（纯函数）；落盘与状态累计在 server/services/lowExitProbe.ts。
 */

export const PROBE_ACCUM_THRESHOLD = 0.10;
export const PROBE_CLIMB_STREAK = 2;
export const PROBE_OFF_PEAK_RATIO = 0.6;
export const LOW_EXIT_DEPTH = 0.05;

export interface LowExitProbeInput {
  /** 这段低谷是否 active */
  active: boolean;
  /** 当前深度（lowPeriod.lastDepth） */
  depth: number;
  /** 这段最深（lowPeriod.peakDepth） */
  peakDepth: number;
  /** sinking / climbing / holding / none */
  phase: string;
  /** 最近一轮深度变化（正=更深） */
  delta: number;
  /** 本轮"被激起的正向情绪"之和（>0 部分；来自 activation delta 的 joy/love/calm 等） */
  positiveActivation: number;
  /** 之前连续 climbing 的轮数 */
  prevClimbingStreak: number;
  /** 之前累计的正向信号 */
  prevAccum: number;
}

export interface LowExitProbeResult {
  wouldExit: boolean;
  reason: string;
  climbingStreak: number;
  accum: number;
  offPeak: boolean;
}

/** 纯判定：给定当前低谷读数与本轮正向信号，返回"新规则下会不会退出" */
export function evaluateLowExitProbe(input: LowExitProbeInput): LowExitProbeResult {
  const peak = Number(input.peakDepth) || 0;
  const depth = Number(input.depth) || 0;

  if (!input.active) {
    return { wouldExit: false, reason: 'inactive（不在低谷）', climbingStreak: 0, accum: 0, offPeak: false };
  }

  const climbing = String(input.phase) === 'climbing' && Number(input.delta) < 0;
  const climbingStreak = climbing ? (Number(input.prevClimbingStreak) || 0) + 1 : 0;
  const accum = Math.min(
    PROBE_ACCUM_THRESHOLD * 2,
    (Number(input.prevAccum) || 0) + Math.max(0, Number(input.positiveActivation) || 0),
  );
  const offPeak = peak > 0 && depth <= peak * PROBE_OFF_PEAK_RATIO;

  // ① 已经低于退出线（现状规则本来就会退出）
  if (depth < LOW_EXIT_DEPTH) {
    return { wouldExit: true, reason: `depth=${depth.toFixed(3)} < ${LOW_EXIT_DEPTH}（现状规则）`, climbingStreak, accum, offPeak };
  }
  // ② 连续 climbing + 离开峰值
  if (climbingStreak >= PROBE_CLIMB_STREAK && offPeak) {
    return { wouldExit: true, reason: `连续 ${climbingStreak} 轮 climbing 且 depth=${depth.toFixed(3)} ≤ 峰值 ${peak.toFixed(3)}×${PROBE_OFF_PEAK_RATIO}`, climbingStreak, accum, offPeak };
  }
  // ③ 段内正向累计 + 离开峰值
  if (accum >= PROBE_ACCUM_THRESHOLD && offPeak) {
    return { wouldExit: true, reason: `段内正向累计 ${accum.toFixed(3)} ≥ ${PROBE_ACCUM_THRESHOLD} 且已离开峰值`, climbingStreak, accum, offPeak };
  }
  return {
    wouldExit: false,
    reason: `未达退出条件（climbStreak=${climbingStreak} accum=${accum.toFixed(3)} offPeak=${offPeak}）`,
    climbingStreak,
    accum,
    offPeak,
  };
}

/** 从 activation.delta 里取"正向被激起"之和（只算正偏离，且超过死区 0.05） */
export function positiveActivationOf(delta: Record<string, number> | undefined | null): number {
  const POS = ['joy', 'love', 'calm', 'gratitude', 'excitement', 'hope'];
  let sum = 0;
  for (const k of POS) {
    const v = Number(delta?.[k] ?? 0);
    if (v > 0.05) sum += v;
  }
  return Math.round(sum * 10000) / 10000;
}
