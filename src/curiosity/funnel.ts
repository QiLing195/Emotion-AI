// v1.0: Sprint E — 认知漏斗追踪器 (Cognitive Funnel Tracker)
// 追踪完整的认知管线：Interest → Pattern → Candidate → Confirmed → Insight → Shared
// 计算 Discovery Yield 健康指标，输出漏斗仪表盘数据
//
// 设计原则：
//   - 纯计数，不依赖任何模块内部状态
//   - 通过 EventBus 被动接收事件
//   - 暴露 getFunnelSnapshot() 供仪表盘/健康检查消费

import { bus } from '../eventBus.js';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface FunnelCounts {
  interestDetected: number;
  patternCandidate: number;
  patternConfirmed: number;
  insightGenerated: number;
  discoveryShared: number;
}

export interface DiscoveryYield {
  /** DY = DiscoveryShared / InterestDetected，百分比 */
  ratio: number;
  /** 健康状态 */
  status: 'too_low' | 'conservative' | 'healthy' | 'generous' | 'broken';
  /** 状态描述 */
  description: string;
}

export interface FunnelSnapshot {
  /** 各阶段累计计数 */
  counts: FunnelCounts;
  /** 各阶段转化率 */
  conversionRates: {
    interestToCandidate: number;
    candidateToConfirmed: number;
    confirmedToInsight: number;
    insightToShared: number;
  };
  /** Discovery Yield 健康指标 */
  discoveryYield: DiscoveryYield;
  /** 快照时间 */
  timestamp: number;
}

// ════════════════════════════════════════════════════════════
// 2. 内部状态
// ════════════════════════════════════════════════════════════

const _counts: FunnelCounts = {
  interestDetected: 0,
  patternCandidate: 0,
  patternConfirmed: 0,
  insightGenerated: 0,
  discoveryShared: 0,
};

// ════════════════════════════════════════════════════════════
// 3. 事件监听
// ════════════════════════════════════════════════════════════

let _initialized = false;

function ensureInit(): void {
  if (_initialized) return;
  _initialized = true;

  bus.on('InterestDetected', () => {
    _counts.interestDetected++;
  });

  bus.on('DiscoveryShared', () => {
    _counts.discoveryShared++;
  });

  bus.on('InsightGenerated', (event) => {
    _counts.insightGenerated += (event.data?.count as number) ?? 1;
  });
}

export function initFunnelTracker(): void {
  ensureInit();
}

/**
 * 外部调用：记录 Pattern 评估后的计数。
 * 应在 evaluatePatterns() 调用后立即调用。
 */
export function recordPatternCounts(
  candidateCount: number,
  confirmedCount: number,
): void {
  ensureInit();
  _counts.patternCandidate += candidateCount;
  _counts.patternConfirmed += confirmedCount;
}

// ════════════════════════════════════════════════════════════
// 4. Discovery Yield 计算
// ════════════════════════════════════════════════════════════

/**
 * 计算 Discovery Yield 健康指标。
 *
 * DY = DiscoveryShared / InterestDetected
 *
 * 健康区间（来自 cognitive-model-v1.md §4）：
 *   0% ~ 2%    → too_low      — 门槛过高，系统保守
 *   2% ~ 5%    → conservative — 偏保守，Discovery 稀缺
 *   5% ~ 20%   → healthy      — 健康区间
 *   20% ~ 50%  → generous     — 门槛偏低，Discovery 贬值
 *   >50%       → broken       — Interest = Discovery，失去认知筛选能力
 */
export function computeDiscoveryYield(
  discoveryShared: number,
  interestDetected: number,
): DiscoveryYield {
  if (interestDetected === 0) {
    return { ratio: 0, status: 'too_low', description: '尚未检测到任何兴趣' };
  }

  const ratio = discoveryShared / interestDetected;
  let status: DiscoveryYield['status'];
  let description: string;

  if (ratio < 0.02) {
    status = 'too_low';
    description = `Discovery Yield ${(ratio * 100).toFixed(1)}% — 门槛过高，建议降低成熟度阈值`;
  } else if (ratio < 0.05) {
    status = 'conservative';
    description = `Discovery Yield ${(ratio * 100).toFixed(1)}% — 偏保守，Discovery 稀缺但可接受`;
  } else if (ratio <= 0.20) {
    status = 'healthy';
    description = `Discovery Yield ${(ratio * 100).toFixed(1)}% — 健康区间`;
  } else if (ratio <= 0.50) {
    status = 'generous';
    description = `Discovery Yield ${(ratio * 100).toFixed(1)}% — 门槛偏低，Discovery 开始贬值，建议提高阈值`;
  } else {
    status = 'broken';
    description = `Discovery Yield ${(ratio * 100).toFixed(1)}% — 系统失去认知筛选能力，需重构成熟度模型`;
  }

  return { ratio, status, description };
}

// ════════════════════════════════════════════════════════════
// 5. 快照与仪表盘
// ════════════════════════════════════════════════════════════

export function getFunnelSnapshot(): FunnelSnapshot {
  const { interestDetected, patternCandidate, patternConfirmed, insightGenerated, discoveryShared } = _counts;

  return {
    counts: { ..._counts },
    conversionRates: {
      interestToCandidate: interestDetected > 0 ? patternCandidate / interestDetected : 0,
      candidateToConfirmed: patternCandidate > 0 ? patternConfirmed / patternCandidate : 0,
      confirmedToInsight: patternConfirmed > 0 ? insightGenerated / patternConfirmed : 0,
      insightToShared: insightGenerated > 0 ? discoveryShared / insightGenerated : 0,
    },
    discoveryYield: computeDiscoveryYield(discoveryShared, interestDetected),
    timestamp: Date.now(),
  };
}

/**
 * 输出漏斗摘要到控制台（可观测性）。
 * 调用时机：每次 processTurn 或探索周期结束时。
 */
export function logFunnelSummary(): void {
  const snap = getFunnelSnapshot();
  const c = snap.counts;
  console.log(
    `[Funnel] Interest(${c.interestDetected}) → ` +
    `Candidate(${c.patternCandidate}) → ` +
    `Confirmed(${c.patternConfirmed}) → ` +
    `Insight(${c.insightGenerated}) → ` +
    `Shared(${c.discoveryShared}) | ` +
    `DY=${(snap.discoveryYield.ratio * 100).toFixed(1)}% [${snap.discoveryYield.status}]`,
  );
}

/**
 * 判断是否应该调整配置。
 * 返回需要调整的配置项和方向。
 */
export function getFunnelRecommendations(): {
  action: 'none' | 'lower_thresholds' | 'raise_thresholds' | 'investigate';
  details: string;
} {
  const snap = getFunnelSnapshot();
  const dy = snap.discoveryYield;

  switch (dy.status) {
    case 'too_low':
      return {
        action: 'lower_thresholds',
        details: 'Discovery 产出过低。建议：降低 candidateScore(当前0.45→0.35) 或 minNeighborsForCorrelation(当前2→1)',
      };
    case 'conservative':
      return {
        action: 'lower_thresholds',
        details: 'Discovery 偏保守。可微调 pattern 阈值或 insight Surprise Test 门槛',
      };
    case 'healthy':
      return { action: 'none', details: '漏斗健康' };
    case 'generous':
      return {
        action: 'raise_thresholds',
        details: 'Discovery 产出偏高。建议：提高 Surprise Test minScore 或 emotionDeviationThreshold',
      };
    case 'broken':
      return {
        action: 'investigate',
        details: '漏斗严重失衡。检查是否 Interest 检测过于宽松，或 insight 去重失效',
      };
  }
}

// ════════════════════════════════════════════════════════════
// 6. 维护与调试
// ════════════════════════════════════════════════════════════

/** 重置所有计数（测试用）。不取消事件监听（bus 不支持 off），只清零计数器。 */
export function resetFunnel(): void {
  ensureInit(); // 确保监听器已注册（幂等）
  _counts.interestDetected = 0;
  _counts.patternCandidate = 0;
  _counts.patternConfirmed = 0;
  _counts.insightGenerated = 0;
  _counts.discoveryShared = 0;
}

/** 获取原始计数（调试用） */
export function getRawCounts(): Readonly<FunnelCounts> {
  return { ..._counts };
}
