// v5.2: Trend Observatory — 认知指标时序趋势追踪
// 不新增事件，纯粹对 CognitiveObservatory 快照做时序包装
// 每个 30s 记录一个点，保留 120 个 = 60 分钟历史

import type { CognitiveObservatory } from '../eventBus';

// ── 趋势方向 ──
export type TrendDirection = 'up' | 'down' | 'flat';

// ── 带趋势的指标点 ──
export interface TrendPoint {
  value: number;
  delta: number | null;       // null = 尚无历史数据
  direction: TrendDirection;
}

// ── 四层趋势指标 ──
export interface TrendObservatory {
  timestamp: number;
  lookbackMinutes: number;
  snapshotCount: number;       // 历史快照数，用于判断数据成熟度
  cognition: {
    curiosityIndex: TrendPoint;
    cognitiveEfficiency: TrendPoint;
    learningVelocity: TrendPoint;
    chainQualityScore: TrendPoint;
  };
  behavior: {
    explorationYield: TrendPoint;
    noveltyRate: TrendPoint;
    duplicateRate: TrendPoint;
    strategyConversion: TrendPoint;
  };
  structure: {
    chainCount: TrendPoint;
    avgDepth: TrendPoint;
    deepChainRatio: TrendPoint;
  };
  graph: {
    edgeCount: TrendPoint;
    branchEntropy: TrendPoint;
    forkRate: TrendPoint;
  };
}

// ── 快照存储（只存数值，不存完整 CognitiveObservatory） ──
export interface TrendSnapshot {
  timestamp: number;
  // emotion
  dominantEmotion: number;  // placeholder: not used for string metrics
  valence: number;
  arousal: number;
  emotionEntropy: number;   // -1 = null
  reversalCount: number;
  // cognition
  curiosityIndex: number;
  cognitiveEfficiency: number;
  learningVelocity: number;
  chainQualityScore: number;
  // behavior (用 -1 表示 null)
  explorationYield: number;
  noveltyRate: number;
  duplicateRate: number;
  strategyConversion: number;
  // structure
  chainCount: number;
  avgDepth: number;
  deepChainRatio: number;
  // graph
  edgeCount: number;
  branchEntropy: number; // -1 = null
  forkRate: number;
}

function nullToNegOne(v: number | null): number {
  return v === null ? -1 : v;
}

function negOneToNull(v: number): number | null {
  return v === -1 ? null : v;
}

// ── 按指标量纲自适应阈值 ──
const THRESHOLDS: Record<string, number> = {
  // 0-100 整数指标
  curiosityIndex: 2,
  chainQualityScore: 2,
  // 0-1 比率指标
  cognitiveEfficiency: 0.02,
  explorationYield: 0.03,
  noveltyRate: 0.03,
  duplicateRate: 0.03,
  strategyConversion: 0.03,
  deepChainRatio: 0.03,
  forkRate: 0.03,
  // 计数指标
  chainCount: 1,
  edgeCount: 2,
  // 深度指标
  avgDepth: 0.3,
  // 速度指标
  learningVelocity: 0.3,
  // 熵指标
  branchEntropy: 0.1,
  emotionEntropy: 0.1,
  // 情感指标
  valence: 0.05,
  arousal: 0.05,
};

function computeDirection(delta: number, key: string): TrendDirection {
  const threshold = THRESHOLDS[key] ?? 0.01;
  if (delta > threshold) return 'up';
  if (delta < -threshold) return 'down';
  return 'flat';
}

// ── v5.25 Time Series Layer ──

export type VolatilityLevel = 'low' | 'medium' | 'high';

// ── v5.3 Anomaly Detection ──

export type AnomalySeverity = 'normal' | 'warning' | 'alert';

export interface AnomalyFlag {
  key: string;
  label: string;
  current: number;         // 当前值
  baseline: number;        // EWMA 基线
  deviation: number;       // current - baseline
  zScore: number | null;   // 偏离标准差数
  severity: AnomalySeverity;
}

export interface AnomalyReport {
  timestamp: number;
  flags: AnomalyFlag[];
  summary: string | null;  // 人类可读摘要，如 "⚠ 探索产出率、好奇心指数 显著异常"
}

/** 单个指标的时序洞察 */
export interface MetricTimeSeries {
  key: string;
  values: number[];            // 最近 N 个点，用于 sparkline
  slope: number | null;        // 线性回归斜率（每分钟变化量）
  volatility: number | null;   // 标准差
  volatilityLevel: VolatilityLevel;
  trend: 'rising' | 'falling' | 'stable' | 'volatile' | 'insufficient';
}

// ── TrendTracker 类 ──
class TrendTracker {
  private snapshots: TrendSnapshot[] = [];
  private maxSnapshots = 120; // 60 min @ 30s intervals
  private lastRecordTime = 0;
  private recordIntervalMs = 30000; // 30s

  /** 记录一个快照（去重：同一 30s 窗口内只保留最后一个） */
  record(obs: CognitiveObservatory): void {
    const now = Date.now();

    // 去重：如果距离上次记录不到 recordIntervalMs，替换最后一个
    if (this.snapshots.length > 0 && now - this.lastRecordTime < this.recordIntervalMs) {
      this.snapshots[this.snapshots.length - 1] = this.toSnapshot(obs, now);
      this.lastRecordTime = now;
      return;
    }

    this.snapshots.push(this.toSnapshot(obs, now));
    this.lastRecordTime = now;

    // 环形缓冲
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }
  }

  /** 获取带趋势的完整观测数据 */
  getTrends(lookbackMinutes: number = 5): TrendObservatory {
    const snapshots = this.snapshots;
    const current = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

    // 找到 lookbackMinutes 之前的快照作为比较基准
    const lookbackMs = lookbackMinutes * 60 * 1000;
    const cutoff = Date.now() - lookbackMs;
    let prev: TrendSnapshot | null = null;
    for (let i = snapshots.length - 2; i >= 0; i--) {
      if (snapshots[i].timestamp <= cutoff) {
        prev = snapshots[i];
        break;
      }
    }
    // 如果找不到足够老的快照，用最早的一个
    if (!prev && snapshots.length >= 2) {
      prev = snapshots[0];
    }

    const makePoint = (curVal: number, prevVal: number | undefined, key: string, nullable = false): TrendPoint => {
      if (nullable && curVal === -1 && (prevVal === undefined || prevVal === -1)) {
        return { value: 0, delta: null, direction: 'flat' };
      }
      const v = nullable ? curVal : curVal;
      if (prevVal === undefined || (nullable && prevVal === -1)) {
        return { value: v, delta: null, direction: 'flat' };
      }
      const delta = curVal - prevVal;
      return {
        value: v,
        delta,
        direction: computeDirection(delta, key),
      };
    };

    return {
      timestamp: Date.now(),
      lookbackMinutes,
      snapshotCount: snapshots.length,
      cognition: {
        curiosityIndex: makePoint(current?.curiosityIndex ?? 0, prev?.curiosityIndex, 'curiosityIndex'),
        cognitiveEfficiency: makePoint(current?.cognitiveEfficiency ?? 0, prev?.cognitiveEfficiency, 'cognitiveEfficiency'),
        learningVelocity: makePoint(current?.learningVelocity ?? 0, prev?.learningVelocity, 'learningVelocity'),
        chainQualityScore: makePoint(current?.chainQualityScore ?? 0, prev?.chainQualityScore, 'chainQualityScore'),
      },
      behavior: {
        explorationYield: makePoint(current?.explorationYield ?? -1, prev?.explorationYield, 'explorationYield', true),
        noveltyRate: makePoint(current?.noveltyRate ?? -1, prev?.noveltyRate, 'noveltyRate', true),
        duplicateRate: makePoint(current?.duplicateRate ?? -1, prev?.duplicateRate, 'duplicateRate', true),
        strategyConversion: makePoint(current?.strategyConversion ?? -1, prev?.strategyConversion, 'strategyConversion', true),
      },
      structure: {
        chainCount: makePoint(current?.chainCount ?? 0, prev?.chainCount, 'chainCount'),
        avgDepth: makePoint(current?.avgDepth ?? 0, prev?.avgDepth, 'avgDepth'),
        deepChainRatio: makePoint(current?.deepChainRatio ?? 0, prev?.deepChainRatio, 'deepChainRatio'),
      },
      graph: {
        edgeCount: makePoint(current?.edgeCount ?? 0, prev?.edgeCount, 'edgeCount'),
        branchEntropy: makePoint(current?.branchEntropy ?? -1, prev?.branchEntropy, 'branchEntropy', true),
        forkRate: makePoint(current?.forkRate ?? 0, prev?.forkRate, 'forkRate'),
      },
    };
  }

  /** 获取历史快照（用于未来画趋势图） */
  getHistory(): ReadonlyArray<TrendSnapshot> {
    return this.snapshots;
  }

  /** 提取单个指标的数值序列（过滤 -1 哨兵值） */
  getMetricValues(key: keyof TrendSnapshot, lookbackMinutes: number = 30): number[] {
    const cutoff = Date.now() - lookbackMinutes * 60 * 1000;
    return this.snapshots
      .filter(s => s.timestamp >= cutoff && (s[key] as number) !== -1)
      .map(s => s[key] as number);
  }

  /** 线性回归斜率：每分钟变化量 */
  getSlope(key: keyof TrendSnapshot, lookbackMinutes: number = 30): number | null {
    const points = this.snapshots
      .filter(s => (s[key] as number) !== -1)
      .slice(-Math.ceil(lookbackMinutes / 0.5)); // ~2 points per minute

    if (points.length < 4) return null;

    const firstT = points[0].timestamp;
    const n = points.length;

    // x = 分钟数, y = 指标值
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (const p of points) {
      const x = (p.timestamp - firstT) / 60000;
      const y = p[key] as number;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;
    return (n * sumXY - sumX * sumY) / denom;
  }

  /** 标准差 + 波动等级（分指标类型，避免小分母 CV 失真） */
  getVolatility(key: keyof TrendSnapshot, lookbackMinutes: number = 15): { stddev: number | null; level: VolatilityLevel } {
    const values = this.getMetricValues(key, lookbackMinutes);
    if (values.length < 4) return { stddev: null, level: 'low' };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);

    // 按指标量纲选择判定方式，避免 branchEntropy(μ≈0.15) 等小均值被 CV 放大
    const keyStr = key as string;
    let level: VolatilityLevel;

    if (
      keyStr === 'explorationYield' || keyStr === 'noveltyRate' ||
      keyStr === 'duplicateRate' || keyStr === 'strategyConversion' ||
      keyStr === 'deepChainRatio' || keyStr === 'forkRate' ||
      keyStr === 'cognitiveEfficiency' ||
      keyStr === 'valence' || keyStr === 'arousal' || keyStr === 'emotionEntropy'
    ) {
      // 0-1 比率指标：直接用 σ 判定
      if (stddev < 0.03) level = 'low';
      else if (stddev < 0.08) level = 'medium';
      else level = 'high';
    } else if (keyStr === 'branchEntropy') {
      // 熵指标（典型范围 0.5-2.5）：直接用 σ
      if (stddev < 0.10) level = 'low';
      else if (stddev < 0.25) level = 'medium';
      else level = 'high';
    } else if (keyStr === 'avgDepth') {
      // 深度指标（典型范围 2-8）：直接用 σ
      if (stddev < 0.3) level = 'low';
      else if (stddev < 0.8) level = 'medium';
      else level = 'high';
    } else if (keyStr === 'learningVelocity') {
      // 速度指标（典型范围 0.5-8/min）
      if (stddev < 0.5) level = 'low';
      else if (stddev < 1.5) level = 'medium';
      else level = 'high';
    } else {
      // 0-100 整数 / 计数 / 大均值指标：CV 安全可用
      const cv = mean !== 0 ? stddev / Math.abs(mean) : 0;
      if (cv < 0.05) level = 'low';
      else if (cv < 0.15) level = 'medium';
      else level = 'high';
    }

    return { stddev, level };
  }

  /** 综合时序洞察 */
  getTimeSeries(key: keyof TrendSnapshot, lookbackMinutes: number = 30): MetricTimeSeries {
    const values = this.getMetricValues(key, lookbackMinutes);
    const slope = this.getSlope(key, lookbackMinutes);
    const { stddev: volatility, level: volatilityLevel } = this.getVolatility(key, 15);

    // 趋势判断
    let trend: MetricTimeSeries['trend'] = 'insufficient';
    if (values.length >= 4 && slope !== null && volatility !== null) {
      if (volatilityLevel === 'high') {
        trend = 'volatile';
      } else if (slope > 0.02) {
        trend = 'rising';
      } else if (slope < -0.02) {
        trend = 'falling';
      } else {
        trend = 'stable';
      }
    }

    return {
      key: key as string,
      values,
      slope,
      volatility,
      volatilityLevel,
      trend,
    };
  }

  // ═══ v5.3 Anomaly Detection ═══

  /** 指数加权移动平均 (EWMA)，halfLifeMinutes 越小越敏感 */
  getEWMA(key: keyof TrendSnapshot, halfLifeMinutes: number = 5): number | null {
    const values = this.getMetricValues(key, halfLifeMinutes * 3); // 3x half-life 覆盖
    if (values.length < 3) return null;

    const alpha = 1 - Math.exp(Math.log(0.5) / (halfLifeMinutes * 2)); // ~2 points/min
    let ewma = values[0];
    for (let i = 1; i < values.length; i++) {
      ewma = alpha * values[i] + (1 - alpha) * ewma;
    }
    return ewma;
  }

  /** 简单移动平均基线 */
  getBaseline(key: keyof TrendSnapshot, lookbackMinutes: number = 30): number | null {
    const values = this.getMetricValues(key, lookbackMinutes);
    if (values.length < 4) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** z-score = (current - baseline) / stddev */
  getZScore(key: keyof TrendSnapshot): number | null {
    const values = this.getMetricValues(key, 30);
    if (values.length < 6) return null;

    const current = values[values.length - 1];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0) return 0;

    return (current - mean) / stddev;
  }

  /** 获取所有追踪指标的异常标记 */
  getAnomalies(): AnomalyReport {
    const flags: AnomalyFlag[] = [];
    const trackedKeys: { key: keyof TrendSnapshot; label: string }[] = [
      { key: 'chainQualityScore', label: '综合质量分' },
      { key: 'curiosityIndex', label: '好奇心指数' },
      { key: 'explorationYield', label: '探索产出率' },
      { key: 'branchEntropy', label: '分支熵' },
      { key: 'learningVelocity', label: '学习速度' },
      { key: 'deepChainRatio', label: '深链占比' },
      { key: 'strategyConversion', label: '策略转化' },
      { key: 'valence', label: '情感效价' },
      { key: 'arousal', label: '唤醒度' },
    ];

    for (const { key, label } of trackedKeys) {
      const values = this.getMetricValues(key, 30);
      if (values.length < 6) continue;

      const current = values[values.length - 1];
      const baseline = this.getEWMA(key, 5);
      if (baseline === null) continue;

      const deviation = current - baseline;
      const zScore = this.getZScore(key);

      let severity: AnomalySeverity = 'normal';
      if (zScore !== null && Math.abs(zScore) > 3.0) {
        severity = 'alert';
      } else if (zScore !== null && Math.abs(zScore) > 2.0) {
        severity = 'warning';
      }

      // 额外检查：值是否跌破/突破近期范围
      if (severity === 'normal') {
        const recentMin = Math.min(...values.slice(0, -1));
        const recentMax = Math.max(...values.slice(0, -1));
        const rangeMargin = (recentMax - recentMin) * 0.15;
        if (current < recentMin - rangeMargin || current > recentMax + rangeMargin) {
          severity = 'warning';
        }
      }

      flags.push({ key: key as string, label, current, baseline, deviation, zScore, severity });
    }

    // 生成摘要
    const alerts = flags.filter(f => f.severity === 'alert');
    const warnings = flags.filter(f => f.severity === 'warning');
    let summary: string | null = null;

    if (alerts.length > 0) {
      summary = `⚠ ${alerts.map(a => a.label).join('、')} 显著异常`;
    } else if (warnings.length > 0) {
      summary = `⚡ ${warnings.map(w => w.label).join('、')} 轻微偏离`;
    }

    return {
      timestamp: Date.now(),
      flags,
      summary,
    };
  }

  /** 测试用：绕过去重，直接写入快照 */
  _recordForTest(obs: CognitiveObservatory): void {
    const ts = obs.timestamp || Date.now();
    this.snapshots.push(this.toSnapshot(obs, ts));
    this.lastRecordTime = ts;
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
    }
  }

  /** 清空历史 */
  reset(): void {
    this.snapshots = [];
    this.lastRecordTime = 0;
  }

  private toSnapshot(obs: CognitiveObservatory, timestamp: number): TrendSnapshot {
    return {
      timestamp,
      // emotion (new fields added at end of TrendSnapshot)
      dominantEmotion: 0, // placeholder — string can't be stored as number
      valence: obs.emotion.valence,
      arousal: obs.emotion.arousal,
      emotionEntropy: nullToNegOne(obs.emotion.emotionEntropy),
      reversalCount: obs.emotion.reversalCount,
      curiosityIndex: obs.cognition.curiosityIndex,
      cognitiveEfficiency: obs.cognition.cognitiveEfficiency,
      learningVelocity: obs.cognition.learningVelocity,
      chainQualityScore: obs.cognition.chainQualityScore,
      explorationYield: nullToNegOne(obs.behavior.explorationYield),
      noveltyRate: nullToNegOne(obs.behavior.noveltyRate),
      duplicateRate: nullToNegOne(obs.behavior.duplicateRate),
      strategyConversion: nullToNegOne(obs.behavior.strategyConversion),
      chainCount: obs.structure.chainCount,
      avgDepth: obs.structure.avgDepth,
      deepChainRatio: obs.structure.deepChainRatio,
      edgeCount: obs.graph.edgeCount,
      branchEntropy: nullToNegOne(obs.graph.branchEntropy),
      forkRate: obs.graph.forkRate,
    };
  }
}

export const trendTracker = new TrendTracker();
