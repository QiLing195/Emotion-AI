// ── v4.1 情感引擎算法优化补丁 ──
// 基于架构审查的四项核心算法改进
// 不修改原有 emotionEngine.ts，作为可插拔的优化层
//
// 优化项：
//   1. 个性化损失厌恶（P1）— lossAversion 从硬编码2.0 → 人格参数函数
//   2. 唤醒边界修复（P1）— (1-arousal)因子改为 min(0.1, 1-arousal)
//   3. 极值平滑回归（P2）— 硬翻转 → 加速回归 + 概率性翻转
//   4. 情绪惯性平滑（P2）— 每轮独立计算 → 指数移动平均
//   5. 🆕 个性化 alpha 速率（S6）— 全局常量 → 人格参数函数

import type {
  EmotionState, EmotionEvent, TaijiState, YinYangState,
  SancaiState, EvolutionState,
} from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 1. 个性化损失厌恶
// ════════════════════════════════════════════════════════════

/**
 * 计算个性化的损失厌恶系数
 *
 * 硬编码 2.0 的问题：
 *   - 高韧性人格不应该被负面事件成倍冲击
 *   - 高敏感人格的放大效应不应是固定倍率
 *
 * 改进：
 *   lossAversion ∈ [1.0, 3.0]
 *   - resilience 高 → 系数低（更有韧性）
 *   - sensitivity 高 → 系数高（更敏感）
 *   - 基础值 1.5 保证正面事件仍有优势
 */
export function computeLossAversion(evolution: EvolutionState): number {
  const resilience = evolution.resilience;   // [0, 1]
  const sensitivity = evolution.sensitivity; // [0, 1]

  // 韧性的缓冲效应 + 敏感度的放大效应
  const base = 1.5;
  const resilienceBuffer = (1 - resilience) * 1.0;  // 低韧性→高缓冲→高系数
  const sensitivityAmp = sensitivity * 0.5;          // 高敏感→高系数

  return Math.round((base + resilienceBuffer + sensitivityAmp) * 100) / 100;
}

/**
 * 计算个性化的预测误差
 * 替代: rawError < 0 ? rawError × 2.0 : rawError
 */
export function computePersonalizedError(
  rawError: number,
  evolution: EvolutionState,
): number {
  if (rawError >= 0) return rawError;
  const lossAversion = computeLossAversion(evolution);
  return rawError * lossAversion;
}

// ════════════════════════════════════════════════════════════
// 1.5 🆕 个性化 alpha 速率 (S6: 人格 → 情感更新速率)
// ════════════════════════════════════════════════════════════

export interface PersonalizedAlphas {
  alphaV: number;  // 效价更新速率
  alphaA: number;  // 唤醒更新速率
  alphaE: number;  // 预期更新速率
}

/**
 * 从人格参数计算个性化的情感更新速率。
 *
 * 原始硬编码:
 *   ALPHA_V = 0.30, ALPHA_A = 0.20, ALPHA_E = 0.10
 *
 * 个性化规则:
 *   - empathy 高 → alphaV 略高（更易被他人情绪影响）
 *   - resilience 高 → alphaV 略低（情绪更稳定）
 *   - sensitivity 高 → alphaA 提高（更大的唤醒响应）
 *   - trust/openness 高 → alphaE 更低（更信任，预期更慢改变）
 *   - 浮动范围：±30% 原始基准值
 */
export function computePersonalizedAlphas(evolution: EvolutionState): PersonalizedAlphas {
  const empathy = evolution.empathy / 100;
  const resilience = evolution.resilience;
  const sensitivity = evolution.sensitivity;
  const trust = evolution.trust / 100;

  const alphaV = 0.30 * (1 + (empathy - 0.5) * 0.3 - (resilience - 0.5) * 0.3);
  const alphaA = 0.20 * (1 + (sensitivity - 0.5) * 0.4);
  const alphaE = 0.10 * (1 - (trust - 0.5) * 0.3);

  return {
    alphaV: Math.round(Math.max(0.15, Math.min(0.45, alphaV)) * 1000) / 1000,
    alphaA: Math.round(Math.max(0.10, Math.min(0.35, alphaA)) * 1000) / 1000,
    alphaE: Math.round(Math.max(0.05, Math.min(0.15, alphaE)) * 1000) / 1000,
  };
}

// ════════════════════════════════════════════════════════════
// 2. 唤醒更新边界修复
// ════════════════════════════════════════════════════════════

/**
 * 修复后的唤醒更新
 *
 * 原始问题：
 *   1. error > 0 时乘以 0.5 → 正面惊喜的唤醒效应只有负面一半
 *   2. (1 - arousal) 在高唤醒时完全阻止进一步唤醒
 *   3. error === 0 时无回归项
 *
 * 改进：
 *   正面: 0.8, 负面: 1.0（非对称但不至于减半）
 *   (1 - arousal) → max(0.1, 1 - arousal) 保留最小上升空间
 *   加入微小回归项
 */
export function computeArousalUpdate(
  currentArousal: number,
  error: number,
  salience: number,
  alphaA: number = 0.20,
  baselineArousal: number = 0.25,
): number {
  let delta = 0;

  if (error > 0) {
    // 正面惊喜：唤醒提升，但幅度为负面的 80%（正面事件冲击更温和）
    const positivityFactor = 0.8;  // 原来0.5，提至0.8更合理
    delta = alphaA * error * positivityFactor * Math.max(0.1, 1 - currentArousal) * salience;
  } else if (error < 0) {
    // 负面冲击：唤醒提升（警觉）
    delta = alphaA * Math.abs(error) * Math.max(0.1, 1 - currentArousal) * salience;
  }

  // 无论 error 正负，微小的基线回归
  delta += -0.01 * (currentArousal - baselineArousal);

  return currentArousal + delta;
}

// ════════════════════════════════════════════════════════════
// 3. 极值平滑回归（替代硬翻转）
// ════════════════════════════════════════════════════════════

/**
 * 处理结果
 */
export interface ReversalResult {
  valence: number;
  reversalPressure: number;
  extremityDuration: number;
  didReverse: boolean;
}

/**
 * 平滑极值反转
 *
 * 原始问题：
 *   reversalPressure > threshold → valence = -valence × 0.6（硬翻转）
 *   产生不自然的情感突变
 *
 * 改进：两阶段平滑反转
 *   Phase 1 (压力 < 1.5x 阈值): 加速向中性回归
 *   Phase 2 (压力 ≥ 1.5x 阈值): 温和方向反转
 */
export function applySmoothReversal(
  valence: number,
  reversalPressure: number,
  extremityDuration: number,
  reversalRate: number = 0.08,
  extremityThreshold: number = 0.7,
  reversalThreshold: number = 1.0,
): ReversalResult {
  if (Math.abs(valence) <= extremityThreshold) {
    // 不处于极值区，缓慢释放压力
    return {
      valence,
      reversalPressure: Math.max(0, reversalPressure - 0.02),
      extremityDuration: Math.max(0, extremityDuration - 0.5),
      didReverse: false,
    };
  }

  // 在极值区：累积压力
  const newDuration = extremityDuration + 1;
  const newPressure = reversalPressure + reversalRate * newDuration;

  if (newPressure < reversalThreshold) {
    // 压力未达阈值，不触发反转
    return {
      valence,
      reversalPressure: newPressure,
      extremityDuration: newDuration,
      didReverse: false,
    };
  }

  if (newPressure < reversalThreshold * 1.5) {
    // Phase 1: 加速回归，不反转方向
    const regressionForce = 0.15 * (newPressure / reversalThreshold);
    const newValence = valence - Math.sign(valence) * Math.abs(valence) * regressionForce;
    return {
      valence: newValence,
      reversalPressure: newPressure * 0.5, // 部分释放
      extremityDuration: newDuration * 0.5,
      didReverse: false,
    };
  }

  // Phase 2: 温和方向反转
  const newValence = -valence * 0.4; // 原来 0.6，降至 0.4 更平滑
  return {
    valence: newValence,
    reversalPressure: newPressure * 0.3, // 部分释放而非清零
    extremityDuration: 0,                // 重置极值计时
    didReverse: true,
  };
}

// ════════════════════════════════════════════════════════════
// 4. 情绪惯性平滑
// ════════════════════════════════════════════════════════════

/**
 * 九情强度平滑器 — 防止情绪突变
 *
 * 原始问题：每轮独立计算距离 → 情绪可以突变
 * 改进：指数移动平均，过渡自然
 *
 * smoothingFactor: 0.7 = 70%当前值 + 30%上一轮值
 */
export class EmotionSmoother {
  private previous: Record<string, number> | null = null;
  private smoothingFactor: number;

  constructor(smoothingFactor: number = 0.7) {
    this.smoothingFactor = smoothingFactor;
  }

  /**
   * 平滑当前情绪强度
   * @param current 本轮计算的原始九情强度
   * @returns 平滑后的九情强度
   */
  smooth(current: Record<string, number>): Record<string, number> {
    if (!this.previous) {
      this.previous = { ...current };
      return current;
    }

    const smoothed: Record<string, number> = {};
    for (const [key, value] of Object.entries(current)) {
      const prev = this.previous[key] ?? 0;
      smoothed[key] = this.smoothingFactor * value + (1 - this.smoothingFactor) * prev;
    }

    this.previous = smoothed;
    return smoothed;
  }

  /** 检测情绪是否发生显著转变（主导情绪变化） */
  detectShift(
    current: Record<string, number>,
    threshold: number = 0.3,
  ): { shifted: boolean; from: string; to: string } {
    if (!this.previous) return { shifted: false, from: '', to: '' };

    const prevDominant = Object.entries(this.previous)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))[0];
    const currDominant = Object.entries(current)
      .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))[0];

    if (!prevDominant || !currDominant) return { shifted: false, from: '', to: '' };

    const intensityDelta = Math.abs(currDominant[1] - (this.previous[currDominant[0]] ?? 0));
    const shifted = prevDominant[0] !== currDominant[0] && intensityDelta > threshold;

    return {
      shifted,
      from: prevDominant[0],
      to: currDominant[0],
    };
  }

  reset(): void {
    this.previous = null;
  }
}

// 全局单例
export const emotionSmoother = new EmotionSmoother();
