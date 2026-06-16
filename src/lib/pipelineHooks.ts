// ── v1.0 管道集成钩子 (Pipeline Integration Hooks) ──
// 为 S5（冲突→策略）和 S6（人格→情感速率）提供轻量集成点
// 设计原则：
//   - 每个钩子是纯胶水代码（glue），零业务逻辑
//   - 可在 server.ts 或 AICoordinator 中按需调用
//   - 不修改任何现有模块，只编排调用顺序
//
// 使用方式（在回复生成管道中）：
//   import { applyS5ConflictAwareness, applyS6PersonalityModulation } from './pipelineHooks';
//   const ctx = { ...baseCtx };
//   applyS5ConflictAwareness(ctx, userText, emotionEvent, userAnalysis);
//   applyS6PersonalityModulation(ctx, evolution);
//   const strategy = selectStrategy(ctx);

import { conflictManager } from './conflictManager';
import { contextAwareness } from './contextAwareness';
import { computeLossAversion } from './emotionOptimizer';
import type { EmotionEvent, EmotionState, EvolutionState } from './emotionEngine';
import type { UserEmotionAnalysis } from './emotionEngine';
import type { StrategyContext } from './dialogueStrategy';

// ════════════════════════════════════════════════════════════
// S5: 冲突检测 → 策略选择
// ════════════════════════════════════════════════════════════

/**
 * S5 强连接：将冲突检测结果注入策略上下文。
 *
 * 调用时机：每轮用户消息到达后、策略选择之前。
 * 副作用：推进 conflictManager 内部状态机。
 *
 * @returns 更新后的 StrategyContext（含 conflictState）
 */
export function applyS5ConflictAwareness(
  ctx: StrategyContext,
  userText: string,
  emotionEvent: EmotionEvent | null,
  userAnalysis: UserEmotionAnalysis | null,
): StrategyContext {
  // 1) 从用户文本和情感事件中检测冲突信号
  const signals = conflictManager.detectSignals(userText, emotionEvent, userAnalysis);

  // 2) 推进状态机
  conflictManager.update(signals, userText);

  // 3) 将冲突状态注入策略上下文
  return {
    ...ctx,
    conflictState: conflictManager.getState(),
  };
}

/**
 * 在 AI 回复生成后评估修复效果。
 *
 * 调用时机：收到用户对 AI 修复尝试的下一轮回应后。
 */
export function applyS5RepairEvaluation(userValenceAfter: number): void {
  conflictManager.evaluateRepair(userValenceAfter);
}

// ════════════════════════════════════════════════════════════
// S6: 人格参数 → 情感更新速率
// ════════════════════════════════════════════════════════════

/**
 * S6 强连接：从人格演化状态计算个性化的 lossAversion 系数。
 *
 * 调用时机：情感引擎更新之前（已通过 taijiUpdate 的 evolution 参数自动应用）。
 * 此函数主要用于可观测性——在日志/调试面板中展示当前的个性化参数。
 *
 * @returns { lossAversion, resilience, sensitivity }
 */
export function getS6PersonalitySnapshot(evolution: EvolutionState): {
  lossAversion: number;
  resilience: number;
  sensitivity: number;
} {
  return {
    lossAversion: computeLossAversion(evolution),
    resilience: evolution.resilience,
    sensitivity: evolution.sensitivity,
  };
}

// ════════════════════════════════════════════════════════════
// S8: 情境感知 → 策略选择（上下文富化）
// ════════════════════════════════════════════════════════════

/**
 * S8 强连接：将情境感知数据注入策略上下文。
 *
 * 调用时机：在 applyS5ConflictAwareness 之后、selectStrategy 之前。
 * 无副作用，纯数据映射。
 */
export function applyS8ContextEnrichment(
  ctx: StrategyContext,
  userText: string,
  recentValence?: number,
): StrategyContext {
  const snapshot = contextAwareness.getSnapshot(ctx.roundNumber, userText);

  // 记录本轮交互数据（供后续轮次的情境推断）
  if (recentValence !== undefined) {
    contextAwareness.recordInteraction(recentValence, userText);
  }

  return {
    ...ctx,
    timeSlot: snapshot.time.timeSlot,
    userStress: snapshot.user.accumulatedStress,
    isReunion: snapshot.user.isReunion,
  };
}

// ════════════════════════════════════════════════════════════
// 便捷：一次性应用所有强连接
// ════════════════════════════════════════════════════════════

/**
 * 在策略选择之前，按顺序应用所有强连接钩子。
 *
 * 调用顺序：S5（冲突检测）→ S8（情境富化）→ selectStrategy
 *
 * 使用示例：
 *   const ctx = buildBaseContext(emotionState, userAnalysis, ...);
 *   const enriched = enrichStrategyContext(ctx, userText, emotionEvent, userAnalysis, userValence);
 *   const decision = selectStrategy(enriched);
 */
export function enrichStrategyContext(
  baseCtx: StrategyContext,
  userText: string,
  emotionEvent: EmotionEvent | null,
  userAnalysis: UserEmotionAnalysis | null,
  userValence?: number,
): StrategyContext {
  let ctx = baseCtx;

  // S5: 冲突感知（可能修改 conflictManager 状态机）
  ctx = applyS5ConflictAwareness(ctx, userText, emotionEvent, userAnalysis);

  // S8: 情境富化（纯数据注入）
  ctx = applyS8ContextEnrichment(ctx, userText, userValence);

  return ctx;
}
