// ── funnel.ts 单元测试 ──
// 覆盖：漏斗计数 / Discovery Yield 计算 / 快照 / 建议生成
// 优先级：🟡 中 — 漏斗是可观测性的核心

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeDiscoveryYield,
  getFunnelSnapshot,
  getFunnelRecommendations,
  resetFunnel,
  recordPatternCounts,
  getRawCounts,
} from '../funnel';
import type { DiscoveryYield } from '../funnel';
import { bus } from '../../eventBus';

// ════════════════════════════════════════════════════════════
// 1. computeDiscoveryYield — 健康指标分类
// ════════════════════════════════════════════════════════════

describe('computeDiscoveryYield', () => {
  it('无兴趣时返回 too_low', () => {
    const result = computeDiscoveryYield(0, 0);
    expect(result.status).toBe('too_low');
    expect(result.ratio).toBe(0);
    expect(result.description).toContain('尚未检测到任何兴趣');
  });

  it('DY < 2% → too_low', () => {
    // 100 个兴趣只产出 1 个分享 → 1%
    const result = computeDiscoveryYield(1, 100);
    expect(result.status).toBe('too_low');
    expect(result.ratio).toBeCloseTo(0.01);
  });

  it('DY 2%-5% → conservative', () => {
    const result = computeDiscoveryYield(3, 100); // 3%
    expect(result.status).toBe('conservative');
  });

  it('DY 5%-20% → healthy', () => {
    const result = computeDiscoveryYield(10, 100); // 10%
    expect(result.status).toBe('healthy');
  });

  it('DY 20%-50% → generous', () => {
    const result = computeDiscoveryYield(30, 100); // 30%
    expect(result.status).toBe('generous');
  });

  it('DY > 50% → broken', () => {
    const result = computeDiscoveryYield(60, 100); // 60%
    expect(result.status).toBe('broken');
    expect(result.description).toContain('失去认知筛选能力');
  });
});

// ════════════════════════════════════════════════════════════
// 2. recordPatternCounts + getRawCounts
// ════════════════════════════════════════════════════════════

describe('recordPatternCounts', () => {
  beforeEach(() => {
    resetFunnel();
  });

  it('记录后 getRawCounts 正确', () => {
    recordPatternCounts(5, 3); // 5 candidate, 3 confirmed
    const counts = getRawCounts();
    expect(counts.patternCandidate).toBe(5);
    expect(counts.patternConfirmed).toBe(3);
  });

  it('多次记录累加', () => {
    recordPatternCounts(2, 1);
    recordPatternCounts(3, 2);
    const counts = getRawCounts();
    expect(counts.patternCandidate).toBe(5);
    expect(counts.patternConfirmed).toBe(3);
  });

  it('resetFunnel 归零所有计数', () => {
    recordPatternCounts(10, 5);
    resetFunnel();
    const counts = getRawCounts();
    expect(counts.patternCandidate).toBe(0);
    expect(counts.patternConfirmed).toBe(0);
    expect(counts.insightGenerated).toBe(0);
    expect(counts.discoveryShared).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 3. getFunnelSnapshot — 快照与转化率
// ════════════════════════════════════════════════════════════

describe('getFunnelSnapshot', () => {
  beforeEach(() => {
    resetFunnel();
  });

  it('空漏斗返回全零快照', () => {
    const snap = getFunnelSnapshot();
    expect(snap.counts.interestDetected).toBe(0);
    expect(snap.conversionRates.interestToCandidate).toBe(0);
    expect(snap.discoveryYield.status).toBe('too_low');
  });

  it('有数据后转化率计算正确', () => {
    recordPatternCounts(8, 5); // Interest → 8 candidate, 5 confirmed
    // 模拟 InterestDetected 和 DiscoveryShared
    bus.emit('InterestDetected', { topics: ['a', 'b'] });
    bus.emit('InterestDetected', { topics: ['c'] });
    bus.emit('DiscoveryShared', { topic: 'test', title: 't', quality: 0.5 });
    bus.emit('InsightGenerated', { count: 2, topInsight: 'test' });

    const snap = getFunnelSnapshot();
    // InterestDetected 计数 2
    expect(snap.counts.interestDetected).toBeGreaterThanOrEqual(2);
    expect(snap.counts.insightGenerated).toBe(2);
    expect(snap.counts.discoveryShared).toBe(1);
  });

  it('snapshot 不可变引用', () => {
    recordPatternCounts(1, 1);
    const snap1 = getFunnelSnapshot();
    const snap2 = getFunnelSnapshot();
    // 两次快照应为独立对象
    expect(snap1).not.toBe(snap2);
    expect(snap1.counts).not.toBe(snap2.counts);
  });
});

// ════════════════════════════════════════════════════════════
// 4. getFunnelRecommendations
// ════════════════════════════════════════════════════════════

describe('getFunnelRecommendations', () => {
  beforeEach(() => {
    resetFunnel();
  });

  it('healthy 时建议为 none', () => {
    // 模拟健康漏斗：10 Interest → 2 Shared = 20% (刚好在健康边界)
    for (let i = 0; i < 10; i++) {
      bus.emit('InterestDetected', { topics: [`topic${i}`] });
    }
    bus.emit('DiscoveryShared', { topic: 't', title: 't', quality: 0.5 });
    bus.emit('DiscoveryShared', { topic: 't2', title: 't2', quality: 0.5 });

    const rec = getFunnelRecommendations();
    // DY = 2/10 = 20% → "healthy"
    expect(rec.action).toBe('none');
    expect(rec.details).toContain('健康');
  });

  it('broken 时建议为 investigate', () => {
    // 模拟破碎漏斗：1 Interest → 1 Shared = 100%
    bus.emit('InterestDetected', { topics: ['a'] });
    bus.emit('DiscoveryShared', { topic: 't', title: 't', quality: 0.5 });

    const rec = getFunnelRecommendations();
    expect(rec.action).toBe('investigate');
    expect(rec.details).toContain('失衡');
  });
});
