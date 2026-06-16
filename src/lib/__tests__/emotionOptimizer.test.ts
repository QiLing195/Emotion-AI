// ── emotionOptimizer 单元测试 ──
// 覆盖：个性化损失厌恶 / 唤醒边界修复 / 极值平滑反转 / 情绪惯性平滑 / 阴阳三才职责
// 优先级：🔴 最高 — 纯函数，影响情感计算核心

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeLossAversion,
  computePersonalizedError,
  computeArousalUpdate,
  applySmoothReversal,
  EmotionSmoother,
  updateSancaiFromYinYang,
} from '../emotionOptimizer';
import type { EvolutionState, YinYangState, SancaiState } from '../emotionEngine';

// ── 测试辅助：构造默认 EvolutionState ──
function makeEvolution(overrides: Partial<EvolutionState> = {}): EvolutionState {
  return {
    fastRate: 0.3,
    mediumRate: 0.1,
    slowRate: 0.01,
    baseline: 0,
    resilience: 0.5,
    empathy: 50,
    optimism: 50,
    sensitivity: 0.5,
    openness: 30,
    playfulness: 30,
    totalInteractions: 100,
    positiveInteractions: 60,
    negativeInteractions: 20,
    trust: 50,
    valuePriorities: {},
    lastIdentityRefresh: 0,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. computeLossAversion — 个性化损失厌恶
// ════════════════════════════════════════════════════════════

describe('computeLossAversion', () => {
  it('默认人格 (resilience=0.5, sensitivity=0.5) 应返回约 2.0', () => {
    const evo = makeEvolution({ resilience: 0.5, sensitivity: 0.5 });
    const la = computeLossAversion(evo);
    // base 1.5 + (1-0.5)*1.0 + 0.5*0.5 = 1.5 + 0.5 + 0.25 = 2.25
    expect(la).toBeCloseTo(2.25, 1);
  });

  it('高韧性 (resilience=1.0) + 低敏感 (sensitivity=0.0) 应返回最低系数 1.5', () => {
    const evo = makeEvolution({ resilience: 1.0, sensitivity: 0.0 });
    const la = computeLossAversion(evo);
    // 1.5 + 0 + 0 = 1.5
    expect(la).toBeCloseTo(1.5, 1);
  });

  it('低韧性 (resilience=0.0) + 高敏感 (sensitivity=1.0) 应返回最高系数 3.0', () => {
    const evo = makeEvolution({ resilience: 0.0, sensitivity: 1.0 });
    const la = computeLossAversion(evo);
    // 1.5 + 1.0 + 0.5 = 3.0
    expect(la).toBeCloseTo(3.0, 1);
  });

  it('返回值应在 [1.0, 3.0] 合理范围内', () => {
    for (let r = 0; r <= 1; r += 0.25) {
      for (let s = 0; s <= 1; s += 0.25) {
        const evo = makeEvolution({ resilience: r, sensitivity: s });
        const la = computeLossAversion(evo);
        expect(la).toBeGreaterThanOrEqual(1.0);
        expect(la).toBeLessThanOrEqual(3.0);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════
// 2. computePersonalizedError
// ════════════════════════════════════════════════════════════

describe('computePersonalizedError', () => {
  it('正误差不应放大（直接返回原值）', () => {
    const evo = makeEvolution({ resilience: 0.0, sensitivity: 1.0 });
    expect(computePersonalizedError(0.5, evo)).toBe(0.5);
    expect(computePersonalizedError(0.01, evo)).toBe(0.01);
    expect(computePersonalizedError(0, evo)).toBe(0);
  });

  it('负误差应根据 lossAversion 放大', () => {
    const evo = makeEvolution({ resilience: 0.5, sensitivity: 0.5 });
    // lossAversion ≈ 2.25, -0.4 * 2.25 ≈ -0.9
    const result = computePersonalizedError(-0.4, evo);
    expect(result).toBeLessThan(-0.4);
    expect(result).toBeCloseTo(-0.9, 1);
  });

  it('高韧性人格负误差放大应较小', () => {
    const highRes = makeEvolution({ resilience: 1.0, sensitivity: 0.0 });
    const lowRes = makeEvolution({ resilience: 0.0, sensitivity: 1.0 });
    const err = -0.5;
    const highResResult = computePersonalizedError(err, highRes);
    const lowResResult = computePersonalizedError(err, lowRes);
    // 高韧性放大倍数应小于低韧性
    expect(Math.abs(highResResult)).toBeLessThan(Math.abs(lowResResult));
  });
});

// ════════════════════════════════════════════════════════════
// 3. computeArousalUpdate — 唤醒边界修复
// ════════════════════════════════════════════════════════════

describe('computeArousalUpdate', () => {
  it('高唤醒状态下正面误差仍可微降（不再被 (1-arousal) 锁死）', () => {
    // 原始问题：arousal=0.95, (1-0.95)=0.05 → 几乎无法更新
    // 修复后：max(0.1, 0.05)=0.1 → 保留 10% 上升空间
    const result = computeArousalUpdate(0.95, 0.3, 0.5, 0.20);
    expect(result).toBeLessThan(0.95); // 正面惊喜降低唤醒
    expect(result).toBeGreaterThan(0.88); // 但不应降太多
  });

  it('负面冲击应提升唤醒', () => {
    const result = computeArousalUpdate(0.3, -0.6, 0.8, 0.20);
    expect(result).toBeGreaterThan(0.3); // 唤醒上升
  });

  it('无误差时应有微小的基线回归', () => {
    const result = computeArousalUpdate(0.8, 0, 0.5, 0.20, 0.25);
    // delta = -0.01 * (0.8 - 0.25) = -0.0055
    expect(result).toBeLessThan(0.8);
    expect(result).toBeCloseTo(0.794, 1);
  });

  it('结果应在 [0, 1] 范围内（clamp 由调用方负责，此处验证不越界太多）', () => {
    const result = computeArousalUpdate(0.5, -1.0, 1.0, 0.20);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1.05); // 轻微超界，clamp 处理
  });
});

// ════════════════════════════════════════════════════════════
// 4. applySmoothReversal — 极值平滑反转
// ════════════════════════════════════════════════════════════

describe('applySmoothReversal', () => {
  it('非极值区 (|v| ≤ 0.7) 应缓慢释放反转压力', () => {
    const result = applySmoothReversal(0.5, 0.8, 3);
    expect(result.didReverse).toBe(false);
    expect(result.reversalPressure).toBeLessThan(0.8); // 压力释放
    expect(result.valence).toBe(0.5); // valence 不变
  });

  it('极值区 + 压力低于阈值 → 累积压力但不反转', () => {
    const result = applySmoothReversal(0.8, 0.3, 5);
    expect(result.didReverse).toBe(false);
    expect(result.reversalPressure).toBeGreaterThan(0.3); // 压力累积
    expect(result.extremityDuration).toBe(6); // duration + 1
  });

  it('Phase 1：压力超阈值但未达 1.5x → 加速回归（方向不变）', () => {
    // newPressure = 0.8 + 0.08*(4+1) = 0.8 + 0.4 = 1.20
    // 1.20 > 1.0 (阈值) 且 < 1.5 (1.5x阈值) → Phase 1
    const result = applySmoothReversal(0.85, 0.8, 4);
    expect(result.didReverse).toBe(false);
    // valence 应该朝 0 移动
    expect(Math.abs(result.valence)).toBeLessThan(0.85);
    // 方向不变
    expect(Math.sign(result.valence)).toBe(1);
    // 压力部分释放
    expect(result.reversalPressure).toBeGreaterThan(0);
    expect(result.reversalPressure).toBeLessThan(1.2);
  });

  it('Phase 2：压力超过 1.5x 阈值 → 温和方向反转', () => {
    // 构造足够的持续时间和压力
    const result = applySmoothReversal(0.9, 2.0, 12);
    // newPressure ≈ 2.0 + 0.08*13 = 3.04 > 1.5
    expect(result.didReverse).toBe(true);
    // 符号翻转，绝对值减小到 0.9 * 0.4 = 0.36
    expect(result.valence).toBeLessThan(0);
    expect(Math.abs(result.valence)).toBeCloseTo(0.36, 1);
  });

  it('翻转后 reversalPressure 不应清零而应衰减', () => {
    const result = applySmoothReversal(0.9, 2.0, 12);
    expect(result.reversalPressure).toBeGreaterThan(0);
    expect(result.reversalPressure).toBeLessThan(2.0); // 部分释放
  });

  it('负面极值同样适用两阶段反转', () => {
    const result = applySmoothReversal(-0.88, 2.2, 10);
    expect(result.didReverse).toBe(true);
    // 符号从负翻正
    expect(result.valence).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// 5. EmotionSmoother — 情绪惯性平滑
// ════════════════════════════════════════════════════════════

describe('EmotionSmoother', () => {
  let smoother: EmotionSmoother;

  beforeEach(() => {
    smoother = new EmotionSmoother(0.7);
  });

  it('首次调用应直接返回原始值（无历史）', () => {
    const current = { joy: 0.8, sad: 0.1, anger: 0.0 };
    const result = smoother.smooth(current);
    expect(result).toEqual(current);
  });

  it('第二次调用应平滑过渡（70% 当前 + 30% 历史）', () => {
    smoother.smooth({ joy: 0.1, sad: 0.8, anger: 0.1 });
    const current = { joy: 0.9, sad: 0.1, anger: 0.0 };
    const result = smoother.smooth(current);
    // joy: 0.7*0.9 + 0.3*0.1 = 0.63 + 0.03 = 0.66
    expect(result.joy).toBeCloseTo(0.66, 1);
    // sad: 0.7*0.1 + 0.3*0.8 = 0.07 + 0.24 = 0.31
    expect(result.sad).toBeCloseTo(0.31, 1);
  });

  it('情绪急转时应平滑而非突变（锯齿测试）', () => {
    // 模拟：三句悲伤后突然一句开心
    smoother.smooth({ joy: 0.0, sad: 0.9 });
    smoother.smooth({ joy: 0.0, sad: 0.95 });
    const result = smoother.smooth({ joy: 0.9, sad: 0.0 });
    // joy 不应直接跳到 0.9，而应被上一轮的 sad=0.95 残差缓和
    expect(result.joy).toBeLessThan(0.9);
    expect(result.sad).toBeGreaterThan(0.0); // 仍有悲伤残余
  });

  it('detectShift 应在主导情绪变化时检测到转变', () => {
    smoother.smooth({ joy: 0.8, sad: 0.1, anger: 0.0 });
    const { shifted, from, to } = smoother.detectShift(
      { joy: 0.1, sad: 0.8, anger: 0.0 },
    );
    expect(shifted).toBe(true);
    expect(from).toBe('joy');
    expect(to).toBe('sad');
  });

  it('detectShift 在主导情绪未变时应返回 false', () => {
    smoother.smooth({ joy: 0.7, sad: 0.2 });
    const { shifted } = smoother.detectShift({ joy: 0.8, sad: 0.1 });
    expect(shifted).toBe(false);
  });

  it('reset 后应像首次调用', () => {
    smoother.smooth({ joy: 0.5, sad: 0.3 });
    smoother.reset();
    const result = smoother.smooth({ joy: 0.2, sad: 0.6 });
    // 无历史，直接返回当前值
    expect(result).toEqual({ joy: 0.2, sad: 0.6 });
  });
});

// ════════════════════════════════════════════════════════════
// 6. updateSancaiFromYinYang — 阴阳→三才职责澄清
// ════════════════════════════════════════════════════════════

describe('updateSancaiFromYinYang', () => {
  it('approachBias > avoidBias 时 A 应趋近正、B 趋近 0', () => {
    const yinyang: YinYangState = {
      approachBias: 0.6,
      avoidBias: 0.1,
      reversalPressure: 0,
      extremityDuration: 0,
    };
    const sancai: SancaiState = { A: 0, B: 0, R: 0.5, harmony: 1 };
    const result = updateSancaiFromYinYang(sancai, yinyang, 0.3);
    expect(result.A).toBeGreaterThan(result.B);
  });

  it('R 在 A 和 B 都低时应保持较高（理性），冲突高时降低', () => {
    const calmYY: YinYangState = {
      approachBias: 0.1, avoidBias: 0.1,
      reversalPressure: 0, extremityDuration: 0,
    };
    const intenseYY: YinYangState = {
      approachBias: 0.8, avoidBias: 0.7,
      reversalPressure: 0, extremityDuration: 0,
    };
    const sancai: SancaiState = { A: 0.5, B: 0.5, R: 0.5, harmony: 0.5 };

    const calm = updateSancaiFromYinYang(sancai, calmYY, 0.3);
    const intense = updateSancaiFromYinYang(sancai, intenseYY, 0.3);

    expect(calm.R).toBeGreaterThan(intense.R);
  });

  it('harmony 在 A≈B 时应接近 1，差异大时降低', () => {
    const balancedYY: YinYangState = {
      approachBias: 0.5, avoidBias: 0.5,
      reversalPressure: 0, extremityDuration: 0,
    };
    const unbalancedYY: YinYangState = {
      approachBias: 0.9, avoidBias: 0.1,
      reversalPressure: 0, extremityDuration: 0,
    };
    const sancai: SancaiState = { A: 0.5, B: 0.5, R: 0.5, harmony: 0.5 };

    const balanced = updateSancaiFromYinYang(sancai, balancedYY, 0.3);
    const unbalanced = updateSancaiFromYinYang(sancai, unbalancedYY, 0.3);

    expect(balanced.harmony).toBeGreaterThan(unbalanced.harmony);
  });
});
