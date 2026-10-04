// ── v1.0 状态归约器 (State Reducer) ──
// applyEvent(state, event) → newState
//
// 设计目标：
//   1. 所有情感状态变更必须通过事件驱动 — 事件是唯一真相来源
//   2. 纯函数：给定相同 state + event，始终产出相同 newState（确定性回放）
//   3. Timeline Viewer 记录的事件 = 可审计的状态变更历史
//
// ⚠️ 现状（2026-09 实测）：**目标 1/3 只完成了一部分** —— 权威管道里只有阶段 3 与 3.1
//    走 applyEvent，另外 7 路（传染/评价/内在事件/心情/反刍/人格漂移/潜意识）直接改状态
//    且不发事件。因此 `applyEvent` 可安全用于"算这一步"，但**不能**用来回放历史状态；
//    原先的 `replayState()`/`validateEventApplication()` 已据此删除，详见文件末尾说明。
//
// 当前模式（旧）: 改 state → bus.emit(log)
// 目标模式（新）: bus.emit(event) → applyEvent(state, event) → newState
//
// 事件契约：
//   - EmotionUpdated.data 携带 stimulus (EmotionEvent) + context (参数)
//   - applyEvent 从 data.stimulus + data.context 计算 newState
//   - data 中也保留 output 字段供 Timeline Viewer 直接渲染（observability）
//   - 可选验证：recompute 结果是否与 output 一致

import type { EmotionState, EmotionEvent } from './emotionEngine';
import {
  updateEmotionState,
  applyReinforcement,
  processTimeDecay,
} from './emotionEngine';
import type { ReinforcementSignal } from './emotionEngine';
import { driftPersonalityParams, type DriftConfig, DEFAULT_DRIFT_CONFIG } from './personalityEvolution';
import type { UserEmotionAnalysis } from './emotionEngine';
import type { BusEvent } from '../eventBus';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface EmotionUpdatedPayload {
  /** 输入：触发本轮更新的情感事件（刺激源） */
  stimulus: EmotionEvent;
  /** 输入：计算上下文（人格参数快照） */
  context: EmotionUpdateContext;
  /** 输出（观测用）：主情绪名 */
  dominant?: string;
  /** 输出（观测用）：前一轮主情绪 */
  prevDominant?: string;
  /** 输出（观测用）：新效价 */
  valence?: number;
  /** 输出（观测用）：新唤醒 */
  arousal?: number;
  /** 输出（观测用）：效价变化量 */
  deltaValence?: number;
  /** 输出（观测用）：唤醒变化量 */
  deltaArousal?: number;
  /** 输出（观测用）：主情绪强度 */
  intensity?: number;
  /** 输出（观测用）：九情强度快照 */
  emotions?: Record<string, number>;
  /** 输出（观测用）：能量 */
  energy?: number;
  /** 输出（观测用）：刺激来源 */
  source?: string;
}

export interface EmotionUpdateContext {
  baseA: number;
  baseB: number;
  baseR: number;
  emotionalStability: number;
  empathy: number;
  optimism: number;
}

export interface StrategyFeedbackPayload {
  type: 'reward' | 'punishment' | 'mixed';
  source: string;
  value: number;
}

export interface ReversalTriggeredPayload {
  from: string;
  to: string;
  valenceDelta: number;
  trigger: string;
}

export interface PhaseTransitionedPayload {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
}

export interface StateDecayedPayload {
  /** 经过的小时数 */
  hoursElapsed: number;
  /** 衰减前快照（观测用） */
  preValence?: number;
  preArousal?: number;
  preDominant?: string;
  /** 衰减后（观测用） */
  postValence?: number;
  postArousal?: number;
}

export interface PersonalityDriftedPayload {
  /** 触发漂移的用户消息 */
  userMessage: string;
  /** 用户情绪分析（可为 null） */
  userSentiment: UserEmotionAnalysis | null;
  /** 漂移配置 */
  config: DriftConfig;
  /** 输出：变更记录（观测用） */
  changes?: Record<string, number>;
  /** 输出：变更日志（观测用） */
  log?: string[];
}

// ════════════════════════════════════════════════════════════
// 核心：applyEvent
// ════════════════════════════════════════════════════════════

/**
 * 将事件应用到情感状态，返回新状态。
 * 这是一个纯函数 — 不会修改传入的 state。
 *
 * 当前支持的事件类型：
 *   - EmotionUpdated: 应用一次完整的情感更新循环
 *   - StrategyFeedback: 应用强化信号（奖惩）
 *   - 其他事件: 当前为只读观测事件，不改变状态，直接返回原 state
 *
 * @param state 当前情感状态
 * @param event 要应用的事件
 * @returns 新情感状态（如果事件不改变状态则返回原引用）
 */
export function applyEvent(state: EmotionState, event: BusEvent): EmotionState {
  switch (event.type) {
    case 'EmotionUpdated':
      return applyEmotionUpdate(state, event.data as EmotionUpdatedPayload);
    case 'StrategyFeedback':
      return applyStrategyFeedback(state, event.data as StrategyFeedbackPayload);
    case 'StateDecayed':
      return applyStateDecay(state, event.data as StateDecayedPayload);
    case 'PersonalityDrifted':
      return applyPersonalityDrift(state, event.data as PersonalityDriftedPayload);
    // ── 观测事件（当前不驱动状态变更）──
    case 'ReversalTriggered':
    case 'PhaseTransitioned':
    case 'UserMessageReceived':
    case 'UserInteractionReset':
    case 'InterestDetected':
    case 'InterestDecayed':
    case 'AutonomousCycleTick':
    case 'LonelinessChanged':
    case 'ProactiveMessageSent':
    case 'ProactiveMessageSkipped':
    case 'ExplorationStarted':
    case 'ExplorationCompleted':
    case 'DiscoveryStored':
    case 'DiscoveryShared':
    case 'DiscoveryDuplicateSkipped':
    case 'StrategySelected':
    case 'StateSaved':
    case 'StateLoaded':
      // 观测事件：不改变状态
      return state;
    default:
      return state;
  }
}

// ════════════════════════════════════════════════════════════
// 事件处理器
// ════════════════════════════════════════════════════════════

/**
 * 应用 EmotionUpdated 事件。
 * 从事件的 stimulus + context 重新计算情感状态。
 *
 * 确定性保证：
 *   给定相同的 state + stimulus + context，updateEmotionState 的输出是确定的
 *   （除了内部噪声项 — 这在 replay 模式下可跳过）
 */
function applyEmotionUpdate(state: EmotionState, payload: EmotionUpdatedPayload): EmotionState {
  const { stimulus, context } = payload;

  return updateEmotionState(
    state,
    stimulus,
    context.baseA,
    context.baseB,
    context.baseR,
    context.emotionalStability,
    context.empathy,
    context.optimism,
  );
}

/**
 * 应用 StateDecayed 事件（时间衰减）。
 * 调用 processTimeDecay 将所有情感参数向中性回归。
 */
function applyStateDecay(state: EmotionState, payload: StateDecayedPayload): EmotionState {
  return processTimeDecay(state, payload.hoursElapsed);
}

/**
 * 应用 PersonalityDrifted 事件（人格参数漂移）。
 * 从事件的 userMessage + userSentiment 重新计算漂移量并应用。
 *
 * 注意：driftPersonalityParams 内部会修改 evolution 对象。
 * 这里先 clone state，在 clone 上应用漂移，返回新 state。
 */
function applyPersonalityDrift(state: EmotionState, payload: PersonalityDriftedPayload): EmotionState {
  const newState = structuredClone(state);
  const result = driftPersonalityParams(
    newState.evolution,
    newState,
    payload.userMessage,
    payload.userSentiment,
    payload.config,
  );

  // 将变更记录写回 payload 供观测（如果 payload 引用在事件中，这里会更新事件数据）
  if (payload.changes === undefined && result.changes && Object.keys(result.changes).length > 0) {
    payload.changes = { ...result.changes };
    payload.log = [...result.log];
  }

  return newState;
}

/**
 * 应用 StrategyFeedback 事件（奖惩信号）。
 */
function applyStrategyFeedback(state: EmotionState, payload: StrategyFeedbackPayload): EmotionState {
  const signal: ReinforcementSignal = {
    type: payload.type,
    value: payload.value,
    source: payload.source as ReinforcementSignal['source'],
  };

  return applyReinforcement(state, signal);
}

// ════════════════════════════════════════════════════════════
// 已删除的两个"回放/校验"工具（2026-09 审计后删除，别再写回来）
//
// 删掉的是 `validateEventApplication()` 与 `replayState()`。它们建立在文件头那句
// 「事件是唯一真相来源」的**迁移目标**上，而这个目标**从未实现**，实测证据：
//
//   权威管道 aiCoordinator.processTurn 里只有两处走 applyEvent（阶段 3 用户话语刺激、
//   阶段 3.1 奖惩强化），另外 **7 处直接改状态、不发事件**：
//     3.65① applyEmotionalContagion   3.65①.5 applyAppraisal
//     3.65② applyInternalEvents       3.65③  applyMoodBias
//     3.65④ ruminationModulation      3.7     driftPersonalityParams（structuredClone 直改）
//     🌑     applyShadowEmotionBias
//   → `replayState(基线, /api/events 的事件)` **永远复现不出真实状态**（差值恰是这 7 路的贡献）。
//     留着它只会在第一次有人真去"审计"时产出一堆假告警 —— 比没有更坏。
//   → `validateEventApplication` 校验的是 payload 里声明的 valence/arousal，而这两项在
//     aiCoordinator 里就是**从刚算出的状态抄下来的**（`valence: newValence`），恒等成立，
//     是个自我循环的检查（原测试也是先把实测值填进 payload 再断言"一致"）。
//
// 真要做"实际状态 vs 记录"的审计，前提是先让这 7 路也变成事件 —— 那是另一件事。
// ════════════════════════════════════════════════════════════

/**
 * 构建 EmotionUpdated 事件的完整 payload。
 * 统一事件构造逻辑，避免散落在多处。
 */
export function buildEmotionUpdatedPayload(params: {
  stimulus: EmotionEvent;
  context: EmotionUpdateContext;
  dominant?: string;
  prevDominant?: string;
  valence?: number;
  arousal?: number;
  deltaValence?: number;
  deltaArousal?: number;
  intensity?: number;
  emotions?: Record<string, number>;
  energy?: number;
  source?: string;
}): EmotionUpdatedPayload {
  return {
    stimulus: params.stimulus,
    context: params.context,
    dominant: params.dominant,
    prevDominant: params.prevDominant,
    valence: params.valence,
    arousal: params.arousal,
    deltaValence: params.deltaValence,
    deltaArousal: params.deltaArousal,
    intensity: params.intensity,
    emotions: params.emotions,
    energy: params.energy,  // 兼容旧字段名，源自 taiji.arousal
    source: params.source,
  };
}
