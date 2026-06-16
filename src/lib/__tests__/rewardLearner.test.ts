// ── rewardLearner 独立单元测试 ──
// 覆盖：反馈记录 / 先验查询 / 时间衰减 / 拉普拉斯平滑 / 重置 / 边界
import { describe, it, expect, beforeEach } from 'vitest';
import { rewardLearner } from '../rewardLearner';

describe('rewardLearner — 基本反馈回路', () => {
  beforeEach(() => { rewardLearner.reset(); });

  it('初始状态所有策略成功率为 0.5（拉普拉斯中性先验）', () => {
    const stats = rewardLearner.getAllStats();
    for (const s of stats) {
      expect(s.successRate).toBe(0.5);
      expect(s.attempts).toBe(0);
      expect(s.successes).toBe(0);
      expect(s.failures).toBe(0);
    }
  });

  it('markStrategyUsed 增加尝试计数', () => {
    rewardLearner.markStrategyUsed('empathize');
    rewardLearner.markStrategyUsed('empathize');
    const stats = rewardLearner.getAllStats().find(s => s.strategy === 'empathize')!;
    expect(stats.attempts).toBe(2);
  });

  it('正反馈提升成功率', () => {
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(0.9);
    const stats = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!;
    expect(stats.successRate).toBeGreaterThan(0.5);
    expect(stats.successes).toBeCloseTo(0.9, 1);
  });

  it('负反馈降低成功率', () => {
    rewardLearner.markStrategyUsed('share');
    rewardLearner.recordFeedback(-0.8);
    const stats = rewardLearner.getAllStats().find(s => s.strategy === 'share')!;
    expect(stats.successRate).toBeLessThan(0.5);
    // 拉普拉斯平滑后 1 / (0.8 + 1 + 1) ≈ 0.357
    expect(stats.successRate).toBeCloseTo(0.357, 1);
  });

  it('多次正反馈一致性', () => {
    const s = 'empathize' as const;
    for (let i = 0; i < 5; i++) {
      rewardLearner.markStrategyUsed(s);
      rewardLearner.recordFeedback(0.6);
    }
    const stats = rewardLearner.getAllStats().find(x => x.strategy === s)!;
    expect(stats.attempts).toBe(5);
    expect(stats.successRate).toBeGreaterThan(0.7);
  });

  it('正负混合反馈后成功率趋于中性略正', () => {
    const s = 'neutral' as const;
    rewardLearner.markStrategyUsed(s); rewardLearner.recordFeedback(0.5);
    rewardLearner.markStrategyUsed(s); rewardLearner.recordFeedback(0.5);
    rewardLearner.markStrategyUsed(s); rewardLearner.recordFeedback(-0.5);
    const stats = rewardLearner.getAllStats().find(x => x.strategy === s)!;
    // 2 正 1 负 → 成功率 > 0.5（拉普拉斯：3/(3+1.5) ≈ 0.667）
    expect(stats.successRate).toBeGreaterThan(0.55);
  });
});

describe('rewardLearner — getStrategyPrior', () => {
  beforeEach(() => { rewardLearner.reset(); });

  it('不足 minSamples 时先验为 1.0', () => {
    rewardLearner.markStrategyUsed('explore');
    expect(rewardLearner.getStrategyPrior('explore')).toBe(1.0);
  });

  it('足够样本后成功策略先验 > 1', () => {
    for (let i = 0; i < 6; i++) {
      rewardLearner.markStrategyUsed('empathize');
      rewardLearner.recordFeedback(0.7);
    }
    const prior = rewardLearner.getStrategyPrior('empathize');
    expect(prior).toBeGreaterThan(1.0);
  });

  it('足够样本后失败策略先验 < 1', () => {
    for (let i = 0; i < 6; i++) {
      rewardLearner.markStrategyUsed('share');
      rewardLearner.recordFeedback(-0.7);
    }
    const prior = rewardLearner.getStrategyPrior('share');
    expect(prior).toBeLessThan(1.0);
  });

  it('先验值范围在 [0.3, 2.0] 内', () => {
    // 极端成功
    const s = 'empathize' as const;
    for (let i = 0; i < 10; i++) {
      rewardLearner.markStrategyUsed(s);
      rewardLearner.recordFeedback(1.0);
    }
    const maxPrior = rewardLearner.getStrategyPrior(s);
    expect(maxPrior).toBeLessThanOrEqual(2.0);
    expect(maxPrior).toBeGreaterThanOrEqual(0.3);
  });
});

describe('rewardLearner — 时间衰减', () => {
  beforeEach(() => { rewardLearner.reset(); });

  it('当天数据不受衰减影响', () => {
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(1.0);
    const before = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!.successRate;
    rewardLearner.applyDailyDecay();
    const after = rewardLearner.getAllStats().find(s => s.strategy === 'explore')!.successRate;
    // 当天数据不受衰减
    expect(after).toBe(before);
  });

  it('reset 回到初始状态', () => {
    rewardLearner.markStrategyUsed('explore');
    rewardLearner.recordFeedback(0.8);
    rewardLearner.reset();
    const stats = rewardLearner.getAllStats();
    for (const s of stats) {
      expect(s.successRate).toBe(0.5);
      expect(s.attempts).toBe(0);
    }
  });
});

describe('rewardLearner — 边界条件', () => {
  beforeEach(() => { rewardLearner.reset(); });

  it('未调用 markStrategyUsed 时 recordFeedback 不崩溃', () => {
    expect(() => rewardLearner.recordFeedback(0.5)).not.toThrow();
  });

  it('recordFeedback 值为零不影响统计', () => {
    rewardLearner.markStrategyUsed('neutral');
    const before = rewardLearner.getAllStats().find(s => s.strategy === 'neutral')!;
    rewardLearner.recordFeedback(0);
    const after = rewardLearner.getAllStats().find(s => s.strategy === 'neutral')!;
    expect(after.successRate).toBe(before.successRate);
  });

  it('9 种策略全部初始化', () => {
    const stats = rewardLearner.getAllStats();
    expect(stats.length).toBe(9);
    const strategies = stats.map(s => s.strategy);
    expect(strategies).toContain('empathize');
    expect(strategies).toContain('boundary');
    expect(strategies).toContain('desire');
    expect(strategies).toContain('neutral');
  });

  it('getAllStats 按成功率降序排列', () => {
    rewardLearner.markStrategyUsed('empathize'); rewardLearner.recordFeedback(0.9);
    rewardLearner.markStrategyUsed('explore'); rewardLearner.recordFeedback(-0.5);
    // 需要足够样本才能触发排序差异
    for (let i = 0; i < 5; i++) {
      rewardLearner.markStrategyUsed('empathize'); rewardLearner.recordFeedback(0.9);
      rewardLearner.markStrategyUsed('explore'); rewardLearner.recordFeedback(-0.5);
    }
    const stats = rewardLearner.getAllStats();
    expect(stats[0].successRate).toBeGreaterThanOrEqual(stats[1].successRate);
  });
});
