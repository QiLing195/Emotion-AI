// ── emergenceMetrics 单元测试 (v1.8) ──
// 覆盖：来源累计 / 内在驱动占比 / 一阶自相关 / 波动 / 卡死判定 / 报告文案
// 优先级：🟡 中高 — 让"情绪是否真的在自发涌现"从"肉眼读对话"变成可测量指标

import { describe, it, expect } from 'vitest';
import {
  emptyEmergenceStats,
  accumulateSource,
  markTurn,
  internalShare,
  lag1Autocorrelation,
  volatility,
  buildEmergenceReport,
  autocorrThresholdFor,
  sumEmotionDelta,
  STUCK_AUTOCORR_THRESHOLD,
  STUCK_VOLATILITY_THRESHOLD,
  STUCK_FLAT_VOLATILITY,
  STUCK_MIN_SAMPLES,
  type EmergenceStats,
} from '../emergenceMetrics';

function stats(overrides: Partial<EmergenceStats> = {}): EmergenceStats {
  return { ...emptyEmergenceStats(), ...overrides };
}

/** 生成一条缓慢单调的序列（高自相关）+ 一条交替序列（低/负自相关） */
const smoothSeries = (n: number) => Array.from({ length: n }, (_, i) => 0.5 + i * 0.001);
const zigzagSeries = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? -0.5 : 0.5));
/** 极缓的正弦：几乎不动的"死水"型情绪（波动极小） */
const frozenSeries = (n: number) => Array.from({ length: n }, (_, i) => 0.3 + 0.0002 * (i % 5));

// ════════════════════════════════════════════════════════════
// 1. 来源累计
// ════════════════════════════════════════════════════════════

describe('accumulateSource / markTurn', () => {
  it('空统计全为 0', () => {
    expect(emptyEmergenceStats()).toEqual({
      turns: 0, external: 0, contagion: 0, internal: 0, mood: 0, rumination: 0, shadow: 0,
    });
  });

  it('按来源累加绝对的效价+唤醒影响', () => {
    let s = emptyEmergenceStats();
    s = accumulateSource(s, 'internal', -0.05, 0.02);
    s = accumulateSource(s, 'internal', 0.01, -0.03);
    expect(s.internal).toBeCloseTo(0.11, 10);
    expect(s.external).toBe(0);
  });

  it('可选第三项（九情 L1 变化）一并计入：只看太极会低估只改九情的来源', () => {
    const s = accumulateSource(emptyEmergenceStats(), 'contagion', 0.002, 0, 0.07);
    expect(s.contagion).toBeCloseTo(0.072, 10);
  });

  it('不修改入参（纯函数）', () => {
    const s = emptyEmergenceStats();
    const next = accumulateSource(s, 'mood', 0.03);
    expect(s.mood).toBe(0);
    expect(next.mood).toBe(0.03);
  });

  it('非法增量按 0 处理（NaN 不污染统计）', () => {
    const s = accumulateSource(emptyEmergenceStats(), 'mood', NaN, NaN);
    expect(s.mood).toBe(0);
  });

  it('markTurn 只增加轮数', () => {
    const s = markTurn(stats({ turns: 4, internal: 0.3 }));
    expect(s.turns).toBe(5);
    expect(s.internal).toBe(0.3);
  });
});

describe('sumEmotionDelta — 九情向量 L1 变化', () => {
  it('累加所有情绪键的绝对变化', () => {
    expect(sumEmotionDelta({ sad: 0.1, joy: 0.2 }, { sad: 0.3, joy: 0.1 })).toBeCloseTo(0.3, 10);
  });

  it('处理键不一致（新增/缺失键按 0 计）', () => {
    expect(sumEmotionDelta({ sad: 0 }, { sad: 0, fear: 0.4 })).toBeCloseTo(0.4, 10);
    expect(sumEmotionDelta({ sad: 0.5 }, {})).toBeCloseTo(0.5, 10);
  });

  it('无变化 → 0；空对象安全', () => {
    expect(sumEmotionDelta({ sad: 0.3 }, { sad: 0.3 })).toBe(0);
    expect(sumEmotionDelta({}, {})).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 内在驱动占比
// ════════════════════════════════════════════════════════════

describe('internalShare', () => {
  it('无任何影响 → 0（不产生 NaN）', () => {
    expect(internalShare(emptyEmergenceStats())).toBe(0);
  });

  it('只有用户驱动 → 0', () => {
    expect(internalShare(stats({ external: 1, contagion: 1 }))).toBe(0);
  });

  it('内在/心情/反刍合计即为内在驱动', () => {
    const s = stats({ external: 0.5, contagion: 0.5, internal: 0.5, mood: 0.3, rumination: 0.2 });
    expect(internalShare(s)).toBeCloseTo(1.0 / 2.0, 10);
    expect(internalShare(s)).toBeCloseTo(0.5, 10);
  });

  it('全部来自内在 → 1', () => {
    expect(internalShare(stats({ internal: 2 }))).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 自相关与波动
// ════════════════════════════════════════════════════════════

describe('lag1Autocorrelation', () => {
  it('样本不足 → null', () => {
    expect(lag1Autocorrelation([])).toBeNull();
    expect(lag1Autocorrelation([0.1, 0.2])).toBeNull();
  });

  it('方差为 0（情绪毫无变化）→ null 而不是 NaN', () => {
    expect(lag1Autocorrelation([0.3, 0.3, 0.3, 0.3])).toBeNull();
  });

  it('平滑序列 → 高自相关（情绪只会延续上一轮）', () => {
    // 线性斜坡的自相关上限为 1 - 3/(n+1)：n=20 → 约 0.86，已属"只会延续"
    expect(lag1Autocorrelation(smoothSeries(20))!).toBeGreaterThan(0.8);
  });

  it('交替序列 → 接近 -1（情绪有转向）', () => {
    const ac = lag1Autocorrelation(zigzagSeries(20))!;
    expect(ac).toBeLessThan(-0.9);
  });

  it('结果夹在 [-1, 1]', () => {
    const ac = lag1Autocorrelation([0.1, -0.4, 0.9, -0.2, 0.5])!;
    expect(ac).toBeGreaterThanOrEqual(-1);
    expect(ac).toBeLessThanOrEqual(1);
  });

  it('忽略非有限值', () => {
    const ac = lag1Autocorrelation([0.1, NaN, 0.2, 0.3, Infinity, 0.4])!;
    expect(Number.isFinite(ac)).toBe(true);
  });
});

describe('volatility', () => {
  it('样本不足 2 个 → 0', () => {
    expect(volatility([])).toBe(0);
    expect(volatility([0.5])).toBe(0);
  });

  it('常量序列 → 0（死水）', () => {
    expect(volatility([0.2, 0.2, 0.2])).toBeCloseTo(0, 10);
  });

  it('起伏越大波动越大', () => {
    expect(volatility([0, 1, 0, 1])).toBeGreaterThan(volatility([0, 0.1, 0, 0.1]));
  });
});

// ════════════════════════════════════════════════════════════
// 4. 报告与卡死判定
// ════════════════════════════════════════════════════════════

describe('buildEmergenceReport', () => {
  it('样本不足时明确说明"暂不判定"，不误报卡死', () => {
    const r = buildEmergenceReport(stats({ turns: 3 }), smoothSeries(3));
    expect(r.stuck).toBe(false);
    expect(r.note).toContain('样本不足');
  });

  it('自相关阈值随窗口自适应（短窗口不能用 0.9 判定）', () => {
    expect(autocorrThresholdFor(12)).toBeLessThan(STUCK_AUTOCORR_THRESHOLD);
    expect(autocorrThresholdFor(12)).toBeCloseTo((1 - 3 / 13) * 0.92, 6);
    expect(autocorrThresholdFor(200)).toBeCloseTo(STUCK_AUTOCORR_THRESHOLD, 6);
  });

  it('高自相关（达到窗口上限附近）+ 低波动 → 判定为卡死', () => {
    const series = smoothSeries(20); // 缓慢单向漂移：自相关 0.86 ≈ 窗口上限
    const r = buildEmergenceReport(stats({ turns: series.length, internal: 3, external: 1 }), series);
    expect(r.lag1Autocorrelation!).toBeGreaterThanOrEqual(r.autocorrThreshold);
    expect(r.valenceVolatility).toBeLessThanOrEqual(STUCK_VOLATILITY_THRESHOLD);
    expect(r.stuck).toBe(true);
    expect(r.note).toContain('疑似情绪卡死');
  });

  it('情绪几乎不动（死水）→ 即使自相关不高也判为卡死', () => {
    const series = frozenSeries(12);
    const r = buildEmergenceReport(stats({ turns: 12 }), series);
    expect(r.valenceVolatility).toBeLessThanOrEqual(STUCK_FLAT_VOLATILITY);
    expect(r.stuck).toBe(true);
    expect(r.note).toContain('死水');
  });

  it('高自相关但波动足够大 → 不算卡死（情绪在动）', () => {
    const series = Array.from({ length: 10 }, (_, i) => 0.5 + i * 0.05);
    const r = buildEmergenceReport(stats({ turns: 10 }), series);
    expect(r.stuck).toBe(false);
  });

  it('来回转向 → 报告为"活性良好"', () => {
    const r = buildEmergenceReport(stats({ turns: 20 }), zigzagSeries(20));
    expect(r.stuck).toBe(false);
    expect(r.note).toContain('转向');
  });

  it('正常起伏 → 报告为"活性正常"', () => {
    const series = [0.1, 0.3, 0.2, 0.5, 0.4, 0.6, 0.3, 0.55, 0.35, 0.6];
    const r = buildEmergenceReport(stats({ turns: 10 }), series);
    expect(r.stuck).toBe(false);
    expect(r.note).toContain('正常');
  });

  it('用户驱动与内在驱动占比互补为 1', () => {
    const r = buildEmergenceReport(stats({ external: 3, internal: 1 }), zigzagSeries(10));
    expect(r.internalShare + r.userShare).toBeCloseTo(1, 10);
    expect(r.internalShare).toBeCloseTo(0.25, 10);
  });

  it('明细包含全部六个来源（含 v1.13 潜意识）', () => {
    const r = buildEmergenceReport(stats({ external: 1, contagion: 2, internal: 3, mood: 4, rumination: 5 }), [0.1, 0.2, 0.3]);
    expect(r.breakdown).toEqual({ external: 1, contagion: 2, internal: 3, mood: 4, rumination: 5, shadow: 0 });
    expect(r.turns).toBe(0);
  });
});
