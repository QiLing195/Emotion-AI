// ── v1.0 仲裁层 (Arbitration Layer) ──
// 统一决策器：防止 curiosity / safety / attachment / strategy 互相打架
//
// 设计原则：
//   - 接收所有独立决策，应用跨模块校验规则
//   - 输出单一、自洽的决策包
//   - 每条覆盖/调整都有明确的 reason（可观测性）

import type { StrategyType, StrategyDecision, StrategyParams } from './dialogueStrategy';
import type { ConflictState, ConflictPhase } from './conflictManager';
import type { RhythmDecision, ChatMode } from './rhythmController';
import type { ContextSnapshot } from './contextAwareness';
import type { Insight } from '../curiosity/insights';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface ArbitrationInput {
  strategyDecision: StrategyDecision;
  conflictState: ConflictState;
  contextSnapshot: ContextSnapshot;
  rhythmDecision: RhythmDecision;
  /** Phase 2: 生成的认知洞察（用于质量把关） */
  generatedInsights?: Insight[];
  /** Phase 2: 当前情绪效价（用于好奇心-安全平衡） */
  currentValence?: number;
}

export interface ArbitrationOutput {
  finalStrategy: StrategyType;
  strategySnippet?: string;
  strategyParams: StrategyParams;
  finalRhythm: RhythmDecision;
  overrides: ArbitrationOverride[];
}

export interface ArbitrationOverride {
  rule: string;
  from: string;
  to: string;
  reason: string;
  timestamp: number;
}

// ════════════════════════════════════════════════════════════
// 2. 跨模块规则表
// ════════════════════════════════════════════════════════════

/** 策略与聊天模式的可共存性矩阵 */
const STRATEGY_MODE_COMPAT: Record<StrategyType, ChatMode[]> = {
  empathize: ['quick_chat', 'casual', 'deep_talk'],
  redirect:  ['casual', 'deep_talk'],
  explore:   ['quick_chat', 'casual'],        // 探索需要一定能量
  accompany: ['deep_talk'],                    // 陪伴是深聊的
  share:     ['quick_chat', 'casual'],
  repair:    ['casual', 'deep_talk'],          // 修复不应急促
  boundary:  ['deep_talk'],                    // 边界声明需要力度
  desire:    ['casual', 'deep_talk'],
  neutral:   ['quick_chat', 'casual', 'deep_talk'],
  crisis:    ['deep_talk'],                         // 🆕 危机干预必须是深度模式
};

/** 冲突阶段对策略的强制允许表（最终裁决） */
const CONFLICT_PERMITTED: Record<ConflictPhase, StrategyType[]> = {
  normal:              ['empathize', 'redirect', 'explore', 'accompany', 'share', 'repair', 'desire', 'neutral'],
  warning:             ['empathize', 'repair', 'accompany', 'neutral'],
  conflict:            ['repair', 'empathize'],
  repairing:           ['empathize', 'accompany', 'repair'],
  recovering:          ['empathize', 'accompany', 'neutral', 'redirect'],
  boundary_defending:  ['boundary', 'accompany'],
  crisis:              ['crisis'],  // 🆕 危机模式只允许危机干预策略
};

/** 聊天模式优先级顺序 */
const MODE_PRIORITY: ChatMode[] = ['deep_talk', 'casual', 'quick_chat'];

// ════════════════════════════════════════════════════════════
// 3. 核心仲裁函数
// ════════════════════════════════════════════════════════════

export function arbitrate(input: ArbitrationInput): ArbitrationOutput {
  const overrides: ArbitrationOverride[] = [];
  let finalStrategy = input.strategyDecision.strategy;
  let strategyParams = { ...input.strategyDecision.params };
  let finalRhythm = { ...input.rhythmDecision };

  // ── 规则 A: 冲突阶段最终校验 ──
  const phase = input.conflictState.phase;
  const permitted = CONFLICT_PERMITTED[phase];
  if (!permitted.includes(finalStrategy)) {
    overrides.push({
      rule: 'conflict_phase_strategy',
      from: finalStrategy,
      to: permitted[0],
      reason: `冲突阶段为 ${phase}，不允许策略 ${finalStrategy}`,
      timestamp: Date.now(),
    });
    finalStrategy = permitted[0];
    strategyParams = {};
  }

  // ── 规则 B: 策略-节奏兼容性校验 ──
  const compatModes = STRATEGY_MODE_COMPAT[finalStrategy];
  if (!compatModes.includes(finalRhythm.mode)) {
    // 找离原始模式最近且兼容的模式
    let bestMode: ChatMode = compatModes[0]; // 第一个兼容模式作为 fallback
    const origIdx = MODE_PRIORITY.indexOf(finalRhythm.mode);
    if (origIdx >= 0) for (let offset = 0; offset < MODE_PRIORITY.length; offset++) {
      for (const sign of [1, -1]) {
        const checkIdx = origIdx + sign * offset;
        if (checkIdx >= 0 && checkIdx < MODE_PRIORITY.length) {
          const candidate = MODE_PRIORITY[checkIdx];
          if (compatModes.includes(candidate)) {
            bestMode = candidate;
            break;
          }
        }
      }
      if (bestMode !== compatModes[0]) break; // 找到了更近的兼容模式
    }
    overrides.push({
      rule: 'strategy_mode_compat',
      from: `mode=${finalRhythm.mode}`,
      to: `mode=${bestMode}`,
      reason: `策略 ${finalStrategy} 与 ${finalRhythm.mode} 模式不兼容`,
      timestamp: Date.now(),
    });
    finalRhythm = { ...finalRhythm, mode: bestMode };
  }

  // ── 规则 C: 压缩响应 → 抑制展开发言策略 ──
  const responseMod = input.contextSnapshot.modulationFactors?.responseLengthMod ?? 0.5;
  if (responseMod < 0.5 && ['explore', 'share'].includes(finalStrategy)) {
    overrides.push({
      rule: 'low_energy_suppress_verbose',
      from: finalStrategy,
      to: 'empathize',
      reason: `情境要求短响应(mod=${responseMod.toFixed(2)})，不宜 ${finalStrategy}`,
      timestamp: Date.now(),
    });
    finalStrategy = 'empathize';
    strategyParams = {};
  }

  // ── 规则 D: 深夜+高压 → 强制深聊 ──
  const isNight = input.contextSnapshot.time?.timeSlot === 'night'
    || input.contextSnapshot.time?.timeSlot === 'dawn';
  const isStressed = (input.contextSnapshot.user?.accumulatedStress ?? 0) > 0.6;
  if (isNight && isStressed && finalRhythm.mode !== 'deep_talk') {
    overrides.push({
      rule: 'night_stress_deep',
      from: `mode=${finalRhythm.mode}`,
      to: 'mode=deep_talk',
      reason: '深夜 + 用户高压：强制深聊模式',
      timestamp: Date.now(),
    });
    finalRhythm = { ...finalRhythm, mode: 'deep_talk' as const };
  }

  // ── Phase 2 规则 E: 好奇心-安全平衡 ──
  const valence = input.currentValence ?? 0;
  const isDistressed = valence < -0.3;
  const curiosityStrategies: StrategyType[] = ['explore', 'share', 'desire'];
  if (isDistressed && curiosityStrategies.includes(finalStrategy)) {
    const fallback: StrategyType = valence < -0.6 ? 'accompany' : 'empathize';
    overrides.push({
      rule: 'curiosity_safety_balance',
      from: finalStrategy,
      to: fallback,
      reason: `用户情绪效价为 ${valence.toFixed(2)}，不宜好奇心驱动策略，切换为${fallback}`,
      timestamp: Date.now(),
    });
    finalStrategy = fallback;
    strategyParams = {};
  }

  // ── Phase 2 规则 F: Insight 质量门槛 ──
  const minInsightSurprise = 0.4;
  if (finalStrategy === 'share' && input.generatedInsights) {
    const hasQualityInsight = input.generatedInsights.some(
      i => i.surpriseScore >= minInsightSurprise,
    );
    if (!hasQualityInsight && input.generatedInsights.length > 0) {
      overrides.push({
        rule: 'insight_quality_gate',
        from: 'share',
        to: 'neutral',
        reason: `${input.generatedInsights.length} 条 insight 未达质量门槛(${minInsightSurprise})`,
        timestamp: Date.now(),
      });
      finalStrategy = 'neutral';
      strategyParams = {};
    }
  }

  // ── 最终验证：规则 E/F 可能改变了策略，重新检查冲突阶段兼容性 ──
  const finalPermitted = CONFLICT_PERMITTED[phase];
  if (!finalPermitted.includes(finalStrategy)) {
    overrides.push({
      rule: 'final_conflict_validation',
      from: finalStrategy,
      to: finalPermitted[0],
      reason: `Post-E/F validation: 冲突阶段为 ${phase}，强制使用 ${finalPermitted[0]}`,
      timestamp: Date.now(),
    });
    finalStrategy = finalPermitted[0];
    strategyParams = {};
  }

  // ── 最终验证：策略-模式兼容性 ──
  const finalCompatModes = STRATEGY_MODE_COMPAT[finalStrategy];
  if (!finalCompatModes.includes(finalRhythm.mode)) {
    finalRhythm = { ...finalRhythm, mode: finalCompatModes[0] };
  }

  return { finalStrategy, strategyParams, finalRhythm, overrides };
}

// ════════════════════════════════════════════════════════════
// 4. 工具函数
// ════════════════════════════════════════════════════════════

export function hasOverrides(output: ArbitrationOutput): boolean {
  return output.overrides.length > 0;
}

export function formatOverrides(output: ArbitrationOutput): string {
  if (output.overrides.length === 0) return '无覆盖（模块一致）';
  return output.overrides
    .map(o => `[${o.rule}] ${o.from} → ${o.to} (${o.reason})`)
    .join('; ');
}
