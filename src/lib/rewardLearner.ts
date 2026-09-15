// ── v1.0 奖励学习器 (Reward Learner) ──
// 从 StrategyFeedback 事件中学习策略有效性，修正策略选择的置信度先验
//
// 核心思路：
//   - 不直接选择策略，而是维护每个策略的"历史成功率"作为先验
//   - 当 StrategyFeedback 发出 reward 信号时，当前策略的成功计数 +1
//   - 当 StrategyFeedback 发出 punishment 信号时，当前策略的失败计数 +1
//   - selectStrategy 可以在计算 confidence 时查询这个先验
//
// 设计约束：
//   - 轻量：纯内存，不依赖 Firestore
//   - 可观测：导出 getStrategyStats() 供仪表盘使用
//   - 有遗忘：旧数据指数衰减，防止过拟合到早期交互

import type { StrategyType } from './dialogueStrategy';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface StrategyStats {
  strategy: StrategyType;
  /** 成功次数（加权：正面反馈 × 强度） */
  successes: number;
  /** 失败次数（加权：负面反馈 × 强度） */
  failures: number;
  /** 总尝试次数 */
  attempts: number;
  /** 加权成功率 [0, 1] */
  successRate: number;
  /** 最近一次使用的 timestamp */
  lastUsedAt: number;
  /** 最近一次获得反馈的 timestamp */
  lastFeedbackAt: number;
}

export interface RewardLearningConfig {
  /** 新旧反馈的混合权重（新反馈权重），越大越重视近期 */
  recencyWeight: number;
  /** 时间衰减率：每天过去，旧统计乘以这个值 */
  dailyDecay: number;
  /** 最少尝试次数：低于此次数的策略使用原始 confidence */
  minSamplesForPrior: number;
}

export const DEFAULT_REWARD_CONFIG: RewardLearningConfig = {
  recencyWeight: 0.3,
  dailyDecay: 0.95,
  minSamplesForPrior: 5,
};

// ════════════════════════════════════════════════════════════
// 2. 学习器实现
// ════════════════════════════════════════════════════════════

class RewardLearner {
  private stats: Map<StrategyType, StrategyStats> = new Map();
  private config: RewardLearningConfig;
  private currentStrategy: StrategyType | null = null;
  private currentStrategyStartedAt: number = 0;

  constructor(config: Partial<RewardLearningConfig> = {}) {
    this.config = { ...DEFAULT_REWARD_CONFIG, ...config };
    this.initStats();
  }

  private initStats(): void {
    const strategies: StrategyType[] = [
      'empathize', 'redirect', 'explore', 'accompany',
      'share', 'repair', 'boundary', 'desire', 'neutral',
    ];
    for (const s of strategies) {
      this.stats.set(s, {
        strategy: s,
        successes: 0,
        failures: 0,
        attempts: 0,
        successRate: 0.5, // 初始中性先验
        lastUsedAt: 0,
        lastFeedbackAt: 0,
      });
    }
  }

  /**
   * 标记当前使用的策略。
   * 在 selectStrategy 后被调用，记录本轮选了什么。
   */
  markStrategyUsed(strategy: StrategyType): void {
    this.currentStrategy = strategy;
    this.currentStrategyStartedAt = Date.now();
    const s = this.stats.get(strategy);
    if (s) {
      s.attempts++;
      s.lastUsedAt = Date.now();
    }
  }

  /**
   * 记录对当前策略的反馈。
   * 在 StrategyFeedback 事件被触发时调用。
   */
  recordFeedback(value: number): void {
    if (!this.currentStrategy) return;
    const s = this.stats.get(this.currentStrategy);
    if (!s) return;

    const absVal = Math.abs(value);

    if (value > 0) {
      // 正向反馈
      s.successes += absVal;
      s.successRate = this.computeSuccessRate(s.successes, s.failures, s.attempts);
    } else {
      // 负向反馈
      s.failures += absVal;
      s.successRate = this.computeSuccessRate(s.successes, s.failures, s.attempts);
    }
    s.lastFeedbackAt = Date.now();
  }

  /**
   * 获取策略的先验权重。
   * 尝试次数不足时返回 1.0（不调整原始 confidence）。
   * 返回 > 1 表示该策略历史上更成功，< 1 表示更失败。
   */
  getStrategyPrior(strategy: StrategyType): number {
    const s = this.stats.get(strategy);
    if (!s || s.attempts < this.config.minSamplesForPrior) return 1.0;

    // 从 0.5 中性基线偏移
    // successRate 0.7 → prior = 0.7/0.5 = 1.4 (提升)
    // successRate 0.3 → prior = 0.3/0.5 = 0.6 (抑制)
    return Math.max(0.3, Math.min(2.0, s.successRate / 0.5));
  }

  /**
   * 获取所有策略的统计快照（供仪表盘）。
   */
  getAllStats(): StrategyStats[] {
    return Array.from(this.stats.values())
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * v1.13 持久化：导出/导入统计。
   * 此前统计只活在内存里、服务重启即清零 → 依赖它的潜意识「策略证据」永远攒不够，
   * 策略学习本身也每次从零开始。
   */
  exportStats(): StrategyStats[] {
    return Array.from(this.stats.values()).map(s => ({ ...s }));
  }

  importStats(saved: Array<Partial<StrategyStats>> | null | undefined): void {
    if (!Array.isArray(saved) || saved.length === 0) return;
    for (const item of saved) {
      if (!item || typeof item.strategy !== 'string') continue;
      const key = item.strategy as StrategyType;
      const current = this.stats.get(key);
      if (!current) continue; // 未知策略名（旧数据）忽略
      this.stats.set(key, {
        ...current,
        successes: Number(item.successes ?? current.successes),
        failures: Number(item.failures ?? current.failures),
        attempts: Number(item.attempts ?? current.attempts),
        successRate: Number(item.successRate ?? current.successRate),
        lastUsedAt: Number(item.lastUsedAt ?? current.lastUsedAt),
        lastFeedbackAt: Number(item.lastFeedbackAt ?? current.lastFeedbackAt),
      });
    }
  }

  /**
   * 应用时间衰减（每日调用一次或定期调用）。
   * 旧数据逐渐衰减，防止过拟合到早期交互模式。
   */
  applyDailyDecay(): void {
    const decay = this.config.dailyDecay;
    for (const [, s] of this.stats) {
      const daysSinceFeedback = s.lastFeedbackAt > 0
        ? (Date.now() - s.lastFeedbackAt) / (1000 * 60 * 60 * 24)
        : 0;
      if (daysSinceFeedback > 1) {
        const factor = Math.pow(decay, daysSinceFeedback);
        s.successes *= factor;
        s.failures *= factor;
        if (s.attempts > 0) {
          s.successRate = this.computeSuccessRate(s.successes, s.failures, s.attempts);
        }
      }
    }
  }

  /**
   * 重置学习器状态。
   */
  reset(): void {
    this.stats.clear();
    this.currentStrategy = null;
    this.initStats();
  }

  private computeSuccessRate(successes: number, failures: number, attempts: number): number {
    if (attempts === 0) return 0.5;
    // 拉普拉斯平滑：避免极端值
    const alpha = 1;
    const beta = 1;
    return (successes + alpha) / (successes + failures + alpha + beta);
  }
}

// ── 全局单例 ──
export const rewardLearner = new RewardLearner();
