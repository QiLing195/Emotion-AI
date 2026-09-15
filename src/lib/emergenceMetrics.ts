// ── v1.8 情绪涌现可观测性 (Emergence Metrics) ──
// 解决的问题：**"情绪是否真的在自发涌现"无法被观测**。
// 只能靠肉眼读对话，无法回答：
//   · 她的情绪有多少来自"用户说的话"，多少来自"她自己的内在生活"？
//   · 她是不是卡在一种情绪里（自嗨漂移 / 对单一情绪过拟合）？
//   · 情绪是活的（有波动、会转向），还是死水（方差趋零、全是自相关）？
//
// 本模块是纯计算层，指标定义：
//   internalShare   内在驱动占比 = 内在+心情+反刍+潜意识 的绝对影响 / 全部绝对影响
//   lag1Autocorr    一阶自相关 ∈ [-1,1]，趋近 1 = "情绪只会沿着上一轮延续"
//   volatility      滚动标准差，趋近 0 = "情绪没有波动"
//   stuck           自相关高 + 波动低 + 内在占比高 → 疑似自嗨漂移
//
// 纯逻辑模块：无 io/React 依赖。

export type EmotionSource = 'external' | 'contagion' | 'internal' | 'mood' | 'rumination' | 'shadow';

/** 各情绪来源的累计绝对影响（|Δvalence| + |Δarousal| + Σ|Δ九情|） */
export interface EmergenceStats {
  turns: number;
  external: number;
  contagion: number;
  internal: number;
  mood: number;
  rumination: number;
  /** v1.13 潜意识（shadow traits）的底色偏置 */
  shadow: number;
}

export interface EmergenceReport {
  turns: number;
  /** 内在驱动占比 [0,1]（内在事件 + 心情 + 反刍） */
  internalShare: number;
  /** 用户驱动占比 [0,1]（用户话语直接刺激 + 情绪传染） */
  userShare: number;
  /** 各来源明细 */
  breakdown: Record<EmotionSource, number>;
  /** 一阶自相关（null = 样本不足） */
  lag1Autocorrelation: number | null;
  /** 效价波动（滚动标准差） */
  valenceVolatility: number;
  /** 本次判定使用的自相关阈值（随窗口长度自适应，便于解读） */
  autocorrThreshold: number;
  /** 是否疑似"情绪卡死/自嗨漂移" */
  stuck: boolean;
  /** 人类可读诊断（供日志/前端/调试） */
  note: string;
}

/** 自相关高于此值视为"情绪只会延续上一轮"（并会与窗口长度上限取较小者） */
export const STUCK_AUTOCORR_THRESHOLD = 0.9;
/** 波动低于此值视为"情绪没有起伏" */
export const STUCK_VOLATILITY_THRESHOLD = 0.02;
/** 波动低于此值视为"情绪几乎不动"（死水，无论自相关如何都判为卡死） */
export const STUCK_FLAT_VOLATILITY = 0.005;
/** 至少多少轮样本才开始判定 */
export const STUCK_MIN_SAMPLES = 8;

/**
 * 自相关阈值随窗口长度自适应。
 * 数学事实：长度为 n 的**纯线性趋势**，其一阶自相关上限只有 1 - 3/(n+1)
 * （n=12 时仅 0.77）。若固定用 0.9 判定，短窗口下"完全无波澜的缓慢漂移"永远不会被识别。
 * 因此取该上限的 92% 作为"几乎只能延续上一轮"的门槛。
 */
export function autocorrThresholdFor(n: number): number {
  if (!Number.isFinite(n) || n < 2) return STUCK_AUTOCORR_THRESHOLD;
  const linearCeiling = 1 - 3 / (n + 1);
  return Math.min(STUCK_AUTOCORR_THRESHOLD, linearCeiling * 0.92);
}

export function emptyEmergenceStats(): EmergenceStats {
  return { turns: 0, external: 0, contagion: 0, internal: 0, mood: 0, rumination: 0, shadow: 0 };
}

function safeAbs(v: number): number {
  return Number.isFinite(v) ? Math.abs(v) : 0;
}

/** 累加一个来源的绝对影响（纯函数，返回新对象） */
export function accumulateSource(
  stats: EmergenceStats,
  source: EmotionSource,
  deltaValence: number,
  deltaArousal = 0,
  emotionAbsDelta = 0,
): EmergenceStats {
  const next: EmergenceStats = { ...stats };
  next[source] = (next[source] ?? 0)
    + safeAbs(deltaValence)
    + safeAbs(deltaArousal)
    + safeAbs(emotionAbsDelta);
  return next;
}

/**
 * 九情向量的 L1 变化量 Σ|Δe|。
 * 必须计入来源影响：情绪传染/奖惩强化的主要作用在九情强度上（例如 sad +0.07），
 * 只统计太极效价会严重低估它们（实测传染的太极影响仅 0.002，但 sad 明显变化）。
 */
export function sumEmotionDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  let total = 0;
  for (const key of keys) {
    const a = before?.[key] ?? 0;
    const b = after?.[key] ?? 0;
    if (Number.isFinite(a) && Number.isFinite(b)) total += Math.abs(b - a);
  }
  return total;
}

/** 记一轮（turns 是轮数，不是来源数） */
export function markTurn(stats: EmergenceStats): EmergenceStats {
  return { ...stats, turns: stats.turns + 1 };
}

/** 内在驱动占比（无任何影响记录时返回 0） */
export function internalShare(stats: EmergenceStats): number {
  const total = stats.external + stats.contagion + stats.internal + stats.mood
    + stats.rumination + (stats.shadow ?? 0);
  if (total <= 0) return 0;
  return (stats.internal + stats.mood + stats.rumination + (stats.shadow ?? 0)) / total;
}

/** 一阶自相关（样本不足或方差为 0 时返回 null） */
export function lag1Autocorrelation(series: number[]): number | null {
  const xs = series.filter(v => Number.isFinite(v));
  if (xs.length < 3) return null;
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const centered = xs.map(v => v - mean);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += centered[i] * centered[i];
    if (i > 0) num += centered[i] * centered[i - 1];
  }
  if (den <= 1e-12) return null;
  return Math.max(-1, Math.min(1, num / den));
}

/** 滚动标准差（样本不足 2 个返回 0） */
export function volatility(series: number[]): number {
  const xs = series.filter(v => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * 组装涌现诊断报告。
 * @param valenceSeries 最近的效价序列（越新越靠后）
 */
export function buildEmergenceReport(
  stats: EmergenceStats,
  valenceSeries: number[],
): EmergenceReport {
  const autocorr = lag1Autocorrelation(valenceSeries);
  const vol = volatility(valenceSeries);
  const share = internalShare(stats);
  const sampleCount = valenceSeries.filter(v => Number.isFinite(v)).length;
  const enough = sampleCount >= STUCK_MIN_SAMPLES;
  const threshold = autocorrThresholdFor(sampleCount);
  // ① 几乎不动（死水） ② 自相关达到该窗口上限附近且波动低（只会延续上一轮）
  const flat = enough && vol <= STUCK_FLAT_VOLATILITY;
  const persistent = enough
    && autocorr !== null
    && autocorr >= threshold
    && vol <= STUCK_VOLATILITY_THRESHOLD;
  const stuck = flat || persistent;

  let note: string;
  if (!enough) {
    note = `样本不足（${sampleCount}/${STUCK_MIN_SAMPLES} 轮），暂不判定`;
  } else if (flat) {
    note = `疑似情绪死水：波动仅 ${vol.toFixed(4)}（内在占比 ${(share * 100).toFixed(0)}%）——情绪几乎没有起伏`;
  } else if (stuck) {
    note = `疑似情绪卡死：自相关 ${autocorr!.toFixed(2)}（窗口阈值 ${threshold.toFixed(2)}）、波动 ${vol.toFixed(3)}（内在占比 ${(share * 100).toFixed(0)}%）——检查是否陷入单一情绪循环`;
  } else if (autocorr !== null && autocorr <= -0.5) {
    note = `情绪在反复转向（自相关 ${autocorr.toFixed(2)}），活性良好`;
  } else {
    note = `情绪活性正常（自相关 ${autocorr === null ? 'n/a' : autocorr.toFixed(2)}、波动 ${vol.toFixed(3)}）`;
  }

  return {
    turns: stats.turns,
    internalShare: share,
    userShare: 1 - share,
    breakdown: {
      external: stats.external,
      contagion: stats.contagion,
      internal: stats.internal,
      mood: stats.mood,
      rumination: stats.rumination,
      shadow: stats.shadow ?? 0,
    },
    lag1Autocorrelation: autocorr,
    valenceVolatility: vol,
    autocorrThreshold: threshold,
    stuck,
    note,
  };
}
