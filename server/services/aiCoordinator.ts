// ── v1.0 AI 协调器 (AI Coordinator) ──
// 封装所有 v4.1 新模块的调用序列，提供单一 processTurn() 入口
// 设计目标：
//   - server.ts 不再直接 import 7 个 lib 模块，只依赖此协调器
//   - 调用顺序显式化、可追踪（S5 → S8 → 情感更新 → 策略选择 → 节奏决策）
//   - 每步产出可独立用于调试/日志/认知追踪
//
// 使用方式：
//   import { aiCoordinator } from './aiCoordinator.js';
//   const turn = await aiCoordinator.processTurn(userText, currentState, context);
//   // turn.strategySnippet → 注入 System Prompt
//   // turn.updatedEmotionState → 更新持久化状态
//   // turn.rhythmDecision → 响应延迟/长度/模式

import { extractEmotionContext, classifyAttachmentStyle, applyEmotionalContagion, suggestReinforcement } from '../../src/lib/emotionEngine.js';
// v1.43：服务端时间衰减（此前只有前端 store 在调 `processTimeDecay`，服务端从不衰减 —— 见阶段 0 的说明）
import { processTimeDecay, serverDecayDisabled } from '../../src/lib/emotionTimeDecay.js';
import { driftPersonalityParams } from '../../src/lib/personalityEvolution.js';
import { appraiseEvent, applyAppraisal, appraisalStanceEnabled, appraisalToPromptSnippet, type AppraisalResult } from '../../src/lib/appraisal.js';
import { activationOf, updateTypicalEmotions } from '../../src/lib/emotionActivation.js';
import { updateLowPeriod, lowPeriodOf } from '../../src/lib/lowPeriod.js';
import { applyInternalEvents, deriveInternalEvents, thoughtTypeToInternal } from '../../src/lib/emotionInternal.js';
import { applyMoodBias, updateMood, moodSampleFrom } from '../../src/lib/moodLayer.js';
import { ruminationModulation, trackRumination, activatedDominant } from '../../src/lib/rumination.js';
import {
  accumulateSource,
  buildEmergenceReport,
  emptyEmergenceStats,
  markTurn,
  sumEmotionDelta,
  type EmergenceReport,
  type EmergenceStats,
} from '../../src/lib/emergenceMetrics.js';
import { applyEvent, buildEmotionUpdatedPayload } from '../../src/lib/stateReducer.js';
import { selectStrategy, STRATEGY_PROMPT_SNIPPETS, getSuppressedStrategies, paramsForStrategy, resolveStrategySnippet, lowPeriodStanceEnabled, lowPeriodRestraintEnabled } from '../../src/lib/dialogueStrategy.js';
import { applyLayaVerdict, LAYA_CHOOSABLE_STRATEGIES, LAYA_KEEP_ACCOMPANY_STRATEGIES, type LayaStrategyVerdict } from '../../src/lib/layaDecision.js';
import { layaMinConfidence, layaKeepAccompany } from './layaClient.js';
import { conflictManager } from '../../src/lib/conflictManager.js';
import { contextAwareness } from '../../src/lib/contextAwareness.js';
import { rhythmController } from '../../src/lib/rhythmController.js';
import { getConnectionHealth } from '../../src/lib/moduleConnections.js';
import { arbitrate, hasOverrides, formatOverrides, type ArbitrationInput } from '../../src/lib/arbitration.js';
import { rewardLearner } from '../../src/lib/rewardLearner.js';
import { extractInterests, updateInterestModel } from '../../src/curiosity/interests.js';
import { getRelevantPatterns, getPatternCandidates } from '../../src/curiosity/patterns.js';
import { interestModel, discoveries } from '../../src/curiosity/state.js';
import { getShareableInsights } from '../../src/curiosity/insights.js';
import { recordPatternCounts, getFunnelSnapshot, logFunnelSummary } from '../../src/curiosity/funnel.js';
import { bus } from '../../src/eventBus.js';
import { ThoughtGraph, assessThoughtGeneration, fillThoughtContent } from '../../src/lib/thoughtGraph.js';
import { shadowLayer, applyShadowEmotionBias, strategyStatsForShadow } from '../../src/lib/shadowLayer.js';
import { MemoryGraph, queryMemoryGraph, memoryGraph, createNodeFromThought, createNodeFromDiscovery } from '../../src/lib/memoryGraph.js';
import type { EmotionState, EmotionEvent, UserEmotionAnalysis } from '../../src/lib/emotionEngine.js';
import type { StrategyDecision, StrategyType, StrategyContext, StrategyMotiveContext } from '../../src/lib/dialogueStrategy.js';
import { herNegativeActivation } from '../../src/lib/dialogueStrategy.js';
import type { ConflictState } from '../../src/lib/conflictManager.js';
import type { ContextSnapshot } from '../../src/lib/contextAwareness.js';
import type { RhythmDecision } from '../../src/lib/rhythmController.js';
import type { Discovery } from '../../src/curiosity/types.js';
import type { PatternCandidate } from '../../src/curiosity/patterns.js';
import type { Insight } from '../../src/curiosity/insights.js';
import type { EmotionContext } from '../../src/types/shared.js';
import type { ThoughtSeed, GraphSummary } from '../../src/lib/thoughtGraph.js';
import type { MemoryItem } from '../../src/lib/unifiedMemory.js';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

/**
 * v1.13 潜意识检测间隔（轮）。原生设计是"每 50 轮检测一次"，
 * 这里改成"距上次检测 ≥N 轮"（避免重启后 `% 50` 错拍），并允许用环境变量调快/调慢：
 *   SHADOW_DETECTION_INTERVAL_ROUNDS=20
 * 参考时标：每条证据 +0.015 置信度，≥0.3 激活；一次检测通常产生 1~4 条证据，
 * 因此默认间隔下"新特质浮现"大致需要 20~30 次检测（约 1000~1500 轮）。
 */
const SHADOW_DETECTION_INTERVAL_ROUNDS = (() => {
  const raw = Number(process.env.SHADOW_DETECTION_INTERVAL_ROUNDS);
  return Number.isFinite(raw) && raw >= 5 ? Math.floor(raw) : 50;
})();

export interface TurnInput {
  /** 用户原始文本 */
  userText: string;
  /** 当前情感状态（上一轮结束后的快照） */
  currentEmotionState: EmotionState;
  /** 本轮从 LLM 提取的情感事件（可由调用方预先提取，也可留空） */
  emotionEvent?: EmotionEvent | null;
  /** 用户情感分析结果（可选，来自 NLU 管道） */
  userAnalysis?: UserEmotionAnalysis | null;
  /** 最近 N 轮用户情绪效价 */
  recentUserMoods?: number[];
  /** 连续负面轮数 */
  consecutiveNegativeRounds?: number;
  /** 本轮检测到的兴趣信号 */
  interestSignals?: string[];
  /** 待分享的好奇心发现 */
  pendingDiscoveries?: Discovery[];
  /** 当前轮次 */
  roundNumber?: number;
  /**
   * v1.58 C-1：**延后提交策略** —— 本轮只**计算**临时策略（唯一用途：给回忆闸门当条件输入），
   * 由调用方在跑完「回忆 → 动机」后调 `commitFinalStrategyWithMotive()` **一次性提交**。
   *
   * 不传（默认）= 旧行为：当场计算并提交 —— 所以既有测试与其它调用方完全不受影响。
   * ⚠️ 临时策略**绝不产生副作用**（不记奖励、不发事件、不写 `lastStrategy*`）。
   */
  deferStrategyCommit?: boolean;
  /** 用户 ID（用于日志） */
  userId?: string;
  /** 上一轮时间戳（用于节奏检测） */
  lastInteractionAt?: number;
  /** 🆕 S7: 当前活跃价值观 */
  activeValues?: Record<string, number>;
  /**
   * v1.33 Laya 决策层的意见（由**调用方**在进入本函数前异步取好）。
   *
   * 为什么不让协调器自己去问：`processTurn` 是**同步**函数（调用点只取返回值），
   * 在里面 `await` 一次 HTTP 要把它改成 async 并波及其它调用点；
   * 而"取意见"本来就是 I/O，属于调用方的活。协调器只做**纯仲裁**。
   *
   * `undefined` = 这轮没问（`LAYA_STRATEGY=off`，一次网络都不发）；
   * `null` = 问了但没拿到可解析的意见（熔断/超时/HTTP 错误）。
   */
  layaVerdict?: LayaStrategyVerdict | null;
}

export interface TurnOutput {
  /** 策略选择结果 */
  strategy: StrategyType;
  strategyDecision: StrategyDecision;
  /** 可直接注入 System Prompt 的策略提示词片段 */
  strategySnippet: string;
  /**
   * v1.47：可直接注入 System Prompt 的**评价结论**片段（"这件事对我来说意味着什么"）。
   * 关闭开关或本轮没有评价时是 `''`（调用方判空跳过，别在 Prompt 里留空块）。
   */
  appraisalSnippet: string;
  /** 更新后的情感状态（已应用 v4.1 补丁） */
  updatedEmotionState: EmotionState;
  /** 冲突状态快照（可观测） */
  conflictState: ConflictState;
  /** 情境快照（可观测） */
  contextSnapshot: ContextSnapshot;
  /** 节奏决策（延迟/长度/模式） */
  rhythmDecision: RhythmDecision;
  /** Phase 1: 情绪加权后的相关认知模式 */
  relevantPatterns?: PatternCandidate[];
  /** Sprint C: 所有候选模式（含未确认），供 context assembly 使用 */
  patternCandidates?: PatternCandidate[];
  /** Sprint C: 待分享发现（来自探索引擎） */
  pendingDiscoveries?: Discovery[];
  /** Sprint E: 生成的认知洞察（来自 getShareableInsights） */
  generatedInsights?: Insight[];
  /** Sprint E: 漏斗快照（Interest → Pattern → Insight → Shared） */
  funnelSnapshot?: ReturnType<typeof getFunnelSnapshot>;
  /** 🧠 思维图谱摘要 */
  thoughtSummary: GraphSummary;
  /** 🧠 本轮新生成的思维内容列表 */
  newThoughts: string[];
  /** 🧩 Memory Graph: 图遍历召回的记忆上下文 */
  memoryContext: MemoryItem[];
  /** 模块连接健康报告（可选，用于调试） */
  connectionHealth: ReturnType<typeof getConnectionHealth>;
  /** 管道元数据（时间戳、耗时等） */
  metadata: TurnMetadata;
}

export interface TurnMetadata {
  processedAt: number;
  roundNumber: number;
  /** 各阶段耗时（ms），用于性能监控 */
  timings: {
    conflictDetectionMs: number;
    contextEnrichmentMs: number;
    emotionUpdateMs: number;
    patternRetrievalMs: number;
    thoughtGenerationMs: number;
    strategySelectionMs: number;
    arbitrationMs: number;
    rhythmDecisionMs: number;
    memoryGraphMs: number;
    /** v1.7 内在情绪源（情绪传染 + 孤独/重逢/思维/兴趣等内在事件）耗时 */
    internalEmotionMs: number;
    totalMs: number;
  };
}

// ════════════════════════════════════════════════════════════
// 2. 协调器实现
// ════════════════════════════════════════════════════════════

export class AICoordinator {
  /** 每轮调用计数器（用于情境感知的轮次追踪） */
  private turnCounter = 0;
  /** 用户效价历史（跨轮共享，供 contextAwareness 使用） */
  private valenceHistory: number[] = [];
  /** Phase 2: 上一轮策略（用于反馈学习） */
  private lastStrategy: StrategyType | null = null;
  /** Phase 2: 上一轮用户消息导致的 AI 效价变化量（本轮的反馈信号） */
  private lastTurnValenceDelta: number = 0;
  /** Phase 2: 上轮用户情绪是否指向 AI — 用于反馈归因过滤 */
  private lastUserDirectedAtAI: boolean = false;
  /**
   * v1.33 最近一次完整的策略裁决（含 Laya 决策层的审计记录）。
   * `/state → strategy` 读它 —— 在此之前 `/state` **根本没有策略字段**，
   * "这一轮为什么这么回"只能靠翻日志。
   */
  private lastStrategyDecision: StrategyDecision | null = null;
  /** v1.34 最近一次构造出来的策略上下文（只给离线反事实重放用，见 getLastStrategyContext） */
  private lastStrategyContext: StrategyContext | null = null;
  /**
   * v1.58 C-1：**已提交**的策略数。结构断言用 —— 一轮**必须恰好 = 1**。
   * 它守的是那条架构不变式：只有最终策略才被记账/发事件（否则"学一份、用另一份"）。
   */
  private strategyCommitCount = 0;
  /**
   * v1.58 C-1：延后提交时留一份"临时方案 + 上下文"，等 `commitFinalStrategyWithMotive()` 定稿重算。
   * 没有它，"临时策略给回忆闸门用"就得靠把 ctx 序列化出去 —— 那更容易漂。
   */
  private pendingStrategy: {
    strategyCtx: StrategyContext;
    extras: {
      conflictState: ConflictState | null;
      contextSnapshot: ContextSnapshot;
      generatedInsights: Insight[];
      updatedEmotionState: EmotionState;
      shadowStrategyMod: ReturnType<typeof shadowLayer.getStrategyModulation>;
      userAnalysis: UserEmotionAnalysis | null | undefined;
    };
    commitInputs: { valenceDelta: number; userDirectedAtAI: boolean };
  } | null = null;
  /** v1.1 依恋风格：用户消息历史（用于话题切换率计算） */
  private topicHistory: string[] = [];
  /** v1.1 依恋风格：亲密表达次数 */
  private intimacySeekingCount = 0;
  /** v1.1 依恋风格：交互时间戳（用于频率波动计算） */
  private interactionTimestamps: number[] = [];
  /**
   * v1.13 上一轮的人格漂移结果（可观测）。
   * 此前这条通路整个不存在，所以"她的人格到底长没长"只能靠翻代码判断。
   */
  private lastPersonalityDrift: { changes: Record<string, number>; log: string[]; at: number } | null = null;
  /**
   * v1.14 最近一次评价层的结果（"这件事对她意味着什么"）。
   * 没有它就无从判断"她到底有没有在理解他这件事"，只能看情绪数字。
   */
  private lastAppraisal: AppraisalResult | null = null;
  /** 🧠 思维图谱（跨轮共享，在情感引擎与策略引擎之间积累思维碎片） */
  private thoughtGraph = new ThoughtGraph();
  /** 🧩 记忆图谱（全局单例，统一四来源记忆 + BFS 激活扩散召回） */
  private memoryGraph = memoryGraph;
  /** v1.8 涌现诊断：各情绪来源的累计绝对影响 */
  private emergence: EmergenceStats = emptyEmergenceStats();
  /** v1.8 涌现诊断：她自己的效价序列（用于自相关/波动，注意不是用户效价） */
  private herValenceHistory: number[] = [];
  /** v1.13 潜意识状态是否有更新（协调器不做 io，由 server 决定落盘时机） */
  shadowStateDirty = false;

  /**
   * 处理一轮对话的完整管道。
   *
   * 调用顺序（严格按强连接依赖）：
   *   1. S5: 冲突检测 → 状态机推进
   *   2. S8: 情境感知快照 → 上下文富化
   *   3. S3: 情感引擎更新（自动应用 v4.1 补丁）
   *   4. S5+S8: 策略选择（含冲突消解 + 情境权重）
   *   5. 节奏决策
   *
   * @returns TurnOutput — 包含所有下游所需的决策和状态
   */
  /**
   * v1.58 C-1：**计算**一个策略方案 —— 选策略 + Shadow 置信度调制 + 仲裁 + 片段。
   *
   * **零副作用**：不记奖励、不发事件、不写 `lastStrategy*`。
   * 所以它可以被调用多次：给**回忆闸门**当条件输入（临时方案）、做反事实重放、给 Observatory 用。
   * 只有 {@link commitStrategyPlan} 才把方案**变成**本轮真正的决策。
   */
  private computeStrategyPlan(
    strategyCtx: StrategyContext,
    extras: {
      conflictState: ConflictState | null;
      contextSnapshot: ReturnType<typeof contextAwareness.getSnapshot>;
      generatedInsights: Insight[];
      updatedEmotionState: EmotionState;
      /** v1.58：Shadow 调制（原本是 `processTurn` 的局部量）*/
      shadowStrategyMod: ReturnType<typeof shadowLayer.getStrategyModulation>;
      /** v1.58：片段里要读他的情绪键（原本直接读 `input`）*/
      userAnalysis: UserEmotionAnalysis | null | undefined;
    },
  ): {
    decision: StrategyDecision;
    finalStrategy: StrategyType;
    snippet: string;
    arbitrationOutput: ReturnType<typeof arbitrate>;
    arbitrationMs: number;
    strategyCtx: StrategyContext;
  } {
    const strategyDecision = selectStrategy(strategyCtx);
    // 🌑 Shadow 调制：活跃 trait 影响策略置信度（v1.58：调制量由调用方传入 —— 它原本是 `processTurn` 的局部量）
    const shadowStrategyMod = extras.shadowStrategyMod;
    if (shadowStrategyMod.boostStrategies.length > 0 || shadowStrategyMod.suppressStrategies.length > 0) {
      const origConf = strategyDecision.confidence;
      if (shadowStrategyMod.boostStrategies.includes(strategyDecision.strategy)) {
        strategyDecision.confidence = Math.min(0.99, origConf * 1.15);
      }
      if (shadowStrategyMod.suppressStrategies.includes(strategyDecision.strategy)) {
        strategyDecision.confidence *= 0.85;
      }
      strategyDecision.confidence = Math.round(strategyDecision.confidence * 100) / 100;
    }
    // ── 阶段 4.5: 仲裁层（Arbitration）──
    // 跨模块交叉校验：防止冲突管理器/策略引擎/节奏控制器输出矛盾
    const t4_5 = Date.now();
    const arbitrationInput: ArbitrationInput = {
      strategyDecision,
      conflictState: extras.conflictState as ConflictState,   // v1.58：仲裁层的类型要求非空（原代码亦然）
      contextSnapshot: extras.contextSnapshot,
      rhythmDecision: { mode: 'casual', responseDelayMs: 0, allowProactive: false, suggestedResponseLength: 0, reason: 'arbitration_pre' },
      // Phase 2: 认知上下文供仲裁规则 E/F 使用
      generatedInsights: extras.generatedInsights,
      currentValence: extras.updatedEmotionState.taiji.valence,
    };
    const arbitrationOutput = arbitrate(arbitrationInput);
    const finalStrategy = arbitrationOutput.finalStrategy;
    // v1.38/v1.42：低谷期的两块片段（两个开关都默认关）。⚠️ 这里是**唯一**允许读低谷读数的地方，
    // 而且读的动作被两个开关名显式挡住 —— 由 lowPeriod.test.ts 的源码守卫钉住
    // （"协调器只更新不读"那条约定在 v1.38 被**有据地**放宽成"只在开关后面读一次"，
    //  v1.42 加第二个开关时守卫同步改成"这一行必须同时挂着两个开关名"，
    //  放宽的理由始终是它要拿真管道 A/B，而不是"顺手接一下"）。
    // 守卫要求这一行**本身**同时挂着两个开关名（见 lowPeriod.test.ts 的约定守卫）——
    // 表达式故意不折行：折了行，"挂了开关"就只写在注释里，而注释挡不住接线。
    const strategySnippet = resolveStrategySnippet(finalStrategy, {
      inEstablishedLowPeriod: (lowPeriodStanceEnabled() || lowPeriodRestraintEnabled()) && lowPeriodOf(extras.updatedEmotionState).established,
      hisEmotion: extras.userAnalysis?.expressedEmotion ?? null,
    });
    if (hasOverrides(arbitrationOutput)) {
    console.log(`[Arbitration] ⚡ 策略覆盖: ${formatOverrides(arbitrationOutput)}`);
    }
    return {
      decision: strategyDecision,
      finalStrategy,
      snippet: strategySnippet,
      arbitrationOutput,
      arbitrationMs: Date.now() - t4_5,
      strategyCtx,
    };
  }

  /**
   * v1.58 C-1：**提交**一个策略方案 —— 奖励学习 + EventBus + `lastStrategy*`。
   *
   * **一轮只许调用一次**（`getStrategyCommitCount()` 可观测）：
   * 否则"系统记录/学习的策略"与"最终真正执行的策略"会不一致。
   */
  private commitStrategyPlan(plan: {
    decision: StrategyDecision;
    finalStrategy: StrategyType;
    arbitrationOutput: ReturnType<typeof arbitrate>;
    /** v1.58：`lastStrategyContext` 要留的上下文（原本直接读局部 `strategyCtx`）*/
    strategyCtx: StrategyContext;
    /** v1.58：提交侧要的两个量（原本直接读 `updatedEmotionState`/`input`）*/
    valenceDelta: number;
    userDirectedAtAI: boolean;
  }): void {
    const strategyDecision = plan.decision;
    const finalStrategy = plan.finalStrategy;
    const arbitrationOutput = plan.arbitrationOutput;
    // v1.0: 奖励学习 — 记录本轮策略选择
    rewardLearner.markStrategyUsed(strategyDecision.strategy);
    // Phase 2: 存储本轮策略和效价变化量（用户消息对 AI 情绪的影响），供下轮反馈
    this.lastStrategy = strategyDecision.strategy;
    // v1.33：留一份完整裁决（含 Laya 审计）供 `/state → strategy` 读
    this.lastStrategyDecision = strategyDecision;
    // v1.34：上下文也留一份（离线工具拿它重放阈值改动）
    this.lastStrategyContext = plan.strategyCtx;
    this.lastTurnValenceDelta = plan.valenceDelta;
    this.lastUserDirectedAtAI = plan.userDirectedAtAI;
    // v5.1: 策略选择 → EventBus（补全认知主链的策略节点）
    bus.emit('StrategySelected', {
    strategy: finalStrategy,
    reason: strategyDecision.reason,
    confidence: strategyDecision.confidence,
    overrides: arbitrationOutput.overrides,
    });
    this.strategyCommitCount += 1;
  }

  /** v1.58：本轮**已提交**的策略数（结构断言用：必须是 1）*/
  getStrategyCommitCount(): number {
    return this.strategyCommitCount;
  }

  /**
   * v1.58 C-1：**定稿** —— 用本轮的动机重算策略并**一次性提交**。
   *
   * 因果链：`情绪 → 临时策略(仅喂回忆闸门，不提交) → 回忆 → 动机 → 定稿策略 → 仲裁 → 提交`。
   * ⚠️ 传 `motive` 时策略层才**看得见她的行动倾向**（`Rule 3.5`，开关在策略层内部）；
   *    不传（开关关着）时重算结果与临时方案逐字相同 ⇒ 行为不变，但**仍然只提交一次**。
   */
  commitFinalStrategyWithMotive(motive?: StrategyMotiveContext): {
    strategy: StrategyType;
    strategyDecision: StrategyDecision;
    strategySnippet: string;
  } | null {
    const pending = this.pendingStrategy;
    if (!pending) return null;
    const plan = this.computeStrategyPlan(
      motive ? { ...pending.strategyCtx, motive } : pending.strategyCtx,
      pending.extras,
    );
    this.commitStrategyPlan({ ...plan, ...pending.commitInputs });
    this.pendingStrategy = null;
    return { strategy: plan.finalStrategy, strategyDecision: plan.decision, strategySnippet: plan.snippet };
  }

  processTurn(input: TurnInput): TurnOutput {
    const t0 = Date.now();
    this.turnCounter++;
    const roundNumber = input.roundNumber ?? this.turnCounter;

    // ── Phase 2: 反馈学习 — 用上轮效价变化量推断策略效果 ──
    // 上轮用户消息导致的 AI 效价变化反映了用户情绪走向：
    //   正变化 → 用户情绪改善 → 上轮策略有效（reward）
    //   负变化 → 用户情绪恶化 → 上轮策略无效（penalty）
    if (this.lastStrategy && Math.abs(this.lastTurnValenceDelta) > 0.05) {
      const feedbackSignal = Math.tanh(this.lastTurnValenceDelta * 3); // [-1, 1]
      // 仅当用户情绪指向 AI 时给予全权重反馈；指向外部事件时衰减 70%
      const attributionWeight = this.lastUserDirectedAtAI ? 1.0 : 0.3;
      const weightedFeedback = feedbackSignal * attributionWeight;
      if (Math.abs(weightedFeedback) > 0.1) {
        rewardLearner.recordFeedback(weightedFeedback);
        // 负载保持与 applyEvent 的 StrategyFeedback 同形（type/source/value），
        // 这样事件既可观测、也可在需要时直接回放，不会出现 undefined 导致的 NaN。
        bus.emit('StrategyFeedback', {
          type: weightedFeedback > 0 ? 'reward' : 'punishment',
          source: 'quality_time',
          value: Math.round(Math.abs(weightedFeedback) * 1000) / 1000,
          strategy: this.lastStrategy,
          feedback: Math.round(weightedFeedback * 1000) / 1000,
          valenceDelta: Math.round(this.lastTurnValenceDelta * 1000) / 1000,
        });
      }
    }

    // ── 阶段 0: v1.43 服务端时间衰减（**同样必须在施加本轮刺激之前**）──
    //
    // 为什么必须在这里补：`processTimeDecay` 只能经 `StateDecayed` 事件到达，而那个事件
    // **只有前端 store 在发**（`useAIBrainStore` 的 `hoursInactive`）⇒ 服务端从不衰减。
    // v1.41 探针实测（真管道、同一句话、只改空档）：
    //   空闲 0.5 / 30 / 96 / 168 小时后 sad = 0.172 / 0.157 / 0.157 / 0.157 —— **一周与一天一模一样**，
    //   0.5→30h 那点差落在 >24h 的**重逢**通道上，不是衰减。
    // 后果：① 落盘状态永不淡化（他离开一周，她的 sad 还是走时那个数）；② v1.24 那套
    // 「基线 + 偏移 × decay」**只在浏览器生效**，前后端必然漂移；③ 同一份状态里其余每一层
    // 本来就回归自己的基线（三才 0.5 / `greedDrive` 0.3 / 人格 50 / tally 0 / 心情 18h / 反刍 6h），
    // **只有九情这一路不回** —— 与 v1.24 的判据同构（"决定性证据是同一函数自己"）。
    // 所以这是**补一处漏掉的调用**，不是新设计。
    //
    // 用"距上一轮的间隔"逐轮施加，与连续衰减**数学等价**：指数衰减对时间可加
    // （`exp(-λh₁)·exp(-λh₂) = exp(-λ(h₁+h₂))`），不需要再加一个时钟字段。
    //
    // ⚠️ 与低谷的关系：衰减会把一段低谷带回静息基线 ⇒ 低谷**可能**被"没人理她"结案。
    // v1.37 曾把这条写成局限、v1.41 证伪（服务端根本不衰减），接上衰减后它**成真** ——
    // 所以同一轮里把"结案理由"也传下去：`depthBeforeDecay` 让 `updateLowPeriod`
    // 自己判"是不是时间把她带回来的"（`closedBy: 'idle'` / `'self'`），
    // 绝不把"时间到了"读成"她自己给自己打气调过来了"。
    const decayedHours = typeof input.lastInteractionAt === 'number'
      ? Math.max(0, (Date.now() - input.lastInteractionAt) / 3_600_000)
      : 0;
    let depthBeforeDecay: number | undefined;
    if (decayedHours > 0 && !serverDecayDisabled() && input.currentEmotionState) {
      depthBeforeDecay = herNegativeActivation(input.currentEmotionState).intensity;
      // 就地写回：与 `updateTypicalEmotions` 同一套路 —— 权威状态就是这个对象（server.ts 传的就是它）
      Object.assign(
        input.currentEmotionState,
        processTimeDecay(input.currentEmotionState, decayedHours),
      );
    }

    // ── 阶段 0: v1.25 常态基线老化（**必须在施加本轮刺激之前**）──
    //
    // 「她最近一段时间的常态」是判定"被激起"的参照物。参照物只能反映**过去** ——
    // 若放在本轮刺激之后再更新，就会把正要检测的那个位移吸进参照里（自己抹平自己的信号）。
    // 所以这里读的是**上一轮落定**的 emotions，按真实流逝时间做慢速 EMA（半衰期 72h，实测标定）。
    updateTypicalEmotions(input.currentEmotionState);

    // ── 阶段 0: v1.37 低谷期计时（**同样在刺激之前**）──
    //
    // 「她沉了多久」只能是**跨轮**的量，而链路里所有判定都是逐轮的 ⇒ 在这里记一笔。
    // 读的同样是**上一轮落定**的状态，所以单轮被一句话推一下不会立起"一段"低谷
    // （除非它跨过了轮边界）—— 这正是"一段"的语义。
    // ⚠️ 只记录，**不读**：本文件里不许出现低谷读数的读取函数（由 lowPeriod.test.ts 的源码守卫钉住），
    // 因此行为不可能依赖它。要接线（"主动性降低但不为零"）需要单独决策 + 真管道 A/B。
    updateLowPeriod(input.currentEmotionState, Date.now(), { depthBeforeDecay });

    // ── 阶段 0: v1.27 她当前的负情绪激活量（**同样必须在刺激之前**）──
    //
    // 策略层 Rule 1 要问「**我自己也被带进去了**吗」—— 语义是"她本来就已经沉在里面"，
    // 所以参照必须是**本轮开始前**的状态。实测（`scripts/ab-emotion-reply.ts` 标定）：
    // 他一句强度 0.50 的话单轮就把静息的她推到 `sad +0.100`、0.60 → `+0.126`、0.80 → `+0.153`，
    // 全部压过陪伴门限 0.12 ⇒ 若在刺激之后取值，这个门限恒成立、判别力归零。
    // 先算成数值（而不是把 state 传下去）也顺带免疫后续阶段可能的就地修改。
    const herNegativeBeforeTurn = herNegativeActivation(input.currentEmotionState);

    // ── 阶段 0: 兴趣检测 + 情绪签名记录 → EventBus ──
    // Sprint C: userInterests 同时用于 interestSignals（策略层 Rule 4）和模式追踪
    const userInterests = extractInterests(input.userText);
    if (userInterests.length > 0) {
      bus.emit('InterestDetected', { topics: userInterests });
      // Phase 1: 记录 mention 时附带当前情绪上下文，建立情绪签名
      const currentEmotionCtx = extractEmotionContext(input.currentEmotionState);
      updateInterestModel(userInterests, 'conversation', currentEmotionCtx);
    }

    // ── 阶段 1: S5 冲突检测 ──
    const t1 = Date.now();
    const signals = conflictManager.detectSignals(
      input.userText,
      input.emotionEvent ?? null,
      input.userAnalysis ?? null,
    );
    conflictManager.update(signals, input.userText);
    const conflictState = conflictManager.getState();
    const conflictMs = Date.now() - t1;

    // ── 阶段 2: S8 情境感知 ──
    const t2 = Date.now();
    // 记录交互数据（效价从当前情感状态推算）
    const currentValence = input.currentEmotionState.taiji.valence;
    this.valenceHistory.push(currentValence);
    if (this.valenceHistory.length > 50) this.valenceHistory.shift();

    contextAwareness.recordInteraction(currentValence, input.userText);
    const contextSnapshot = contextAwareness.getSnapshot(roundNumber, input.userText);
    const contextMs = Date.now() - t2;

    // ── 阶段 2b: v1.1 依恋信号积累 ──
    this.topicHistory.push(input.userText);
    if (this.topicHistory.length > 20) this.topicHistory.shift();
    this.interactionTimestamps.push(Date.now());
    if (this.interactionTimestamps.length > 20) this.interactionTimestamps.shift();
    const intimacyKeywords = ['想你', '陪我', '抱抱', '别走', '需要你', '不要离开', '爱', '喜欢'];
    if (intimacyKeywords.some(kw => input.userText.includes(kw))) {
      this.intimacySeekingCount++;
    }

    // ── 阶段 3: 情感引擎更新（v1.0 applyEvent 统一路径）──
    const t3 = Date.now();
    let updatedEmotionState: EmotionState;
    if (input.emotionEvent) {
      const evo = input.currentEmotionState.evolution;
      const context = {
        baseA: evo.resilience,
        baseB: 1 - evo.resilience,
        baseR: evo.sensitivity,
        emotionalStability: Math.max(0.1, Math.min(0.9, 1 - evo.sensitivity)),
        empathy: evo.empathy,
        optimism: evo.optimism,
      };

      // 走 applyEvent（纯函数，可回放）
      updatedEmotionState = applyEvent(input.currentEmotionState, {
        id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion',
        timestamp: Date.now(),
        data: buildEmotionUpdatedPayload({ stimulus: input.emotionEvent, context }),
      });

      // 发事件（携带完整 stimulus + context，供 Timeline Viewer 消费）
      const oldValence = input.currentEmotionState.taiji.valence;
      const oldArousal = input.currentEmotionState.taiji.arousal;
      const newValence = updatedEmotionState.taiji.valence;
      const newArousal = updatedEmotionState.taiji.arousal;
      // v1.16：事件里报的"主导情绪"也改读**激活态**（相对人格基线），
      // 否则 Timeline Viewer 上她永远显示 calm（基调冒充情绪）。
      const dominantEntry = [activationOf(updatedEmotionState).activeEmotion ?? 'neutral'];
      const oldDominantEntry = [activationOf(input.currentEmotionState).activeEmotion ?? 'neutral'];
      bus.emit('EmotionUpdated', buildEmotionUpdatedPayload({
        stimulus: input.emotionEvent,
        context,
        dominant: dominantEntry[0],
        prevDominant: oldDominantEntry[0],
        valence: newValence,
        arousal: newArousal,
        deltaValence: newValence - oldValence,
        deltaArousal: newArousal - oldArousal,
        intensity: activationOf(updatedEmotionState).activeIntensity,
        emotions: updatedEmotionState.emotions,
        source: input.emotionEvent.intent || 'user',
      }));
    } else {
      updatedEmotionState = { ...input.currentEmotionState };
    }
    const emotionMs = Date.now() - t3;

    // ── 阶段 3.1: v1.8 操作条件反射（奖惩强化）──
    // 此前 suggestReinforcement/applyReinforcement 只在旧前端 store 里被调用，
    // 权威管道（server）从未接入：她被夸奖不会更亲近、被指责也不会更戒备。
    // 只处理**明确指向她**的情绪（避免把"用户对老板生气"算到她头上）。
    if (input.userAnalysis?.directedAtAI && input.userAnalysis.expressedEmotion !== 'neutral') {
      const signal = suggestReinforcement(input.userAnalysis);
      if (signal.value > 0.01) {
        updatedEmotionState = applyEvent(updatedEmotionState, {
          id: '', type: 'StrategyFeedback', level: 'cognitive', source: 'emotion',
          timestamp: Date.now(),
          data: { type: signal.type, source: signal.source, value: signal.value },
        });
      }
    }

    // ── 阶段 3.5: 情绪加权模式检索（Phase 1: Emotion-Cognition Deep Coupling） ──
    const t3_5 = Date.now();
    const updatedEmotionCtx = extractEmotionContext(updatedEmotionState);
    const relevantPatterns = getRelevantPatterns(
      interestModel.interests,
      updatedEmotionCtx,
    );
    // Sprint C: 同时获取所有候选模式（含未确认），供策略层 Rule 4 使用
    const patternCandidates = getPatternCandidates(interestModel.interests);
    // Sprint E: 记录漏斗计数
    const confirmedCount = patternCandidates.filter(p => p.stage === 'confirmed').length;
    const candidateCount = patternCandidates.length - confirmedCount;
    recordPatternCounts(candidateCount, confirmedCount);
    const patternMs = Date.now() - t3_5;

    // Sprint C: 从探索引擎获取待分享发现（shared=true 的高质量发现，最近5条）
    const pendingDiscoveries = discoveries
      .filter(d => d.shared && d.quality >= 0.5)
      .slice(-5)
      .reverse(); // 最新的在前

    // 🧩 同步新发现到 MemoryGraph（去重：已存在的跳过）
    for (const d of pendingDiscoveries) {
      const existingNodes = this.memoryGraph.getNodesBySource('discovery');
      if (!existingNodes.some(n => n.sourceId === d.id)) {
        this.memoryGraph.addNode(createNodeFromDiscovery(d));
      }
    }

    // Sprint E: 从模式生成 Insight，发射 InsightGenerated 事件
    const generatedInsights = getShareableInsights(patternCandidates);
    if (generatedInsights.length > 0) {
      bus.emit('InsightGenerated', {
        count: generatedInsights.length,
        topInsight: generatedInsights[0]?.title,
      });
    }

    // ── 阶段 3.6: 🧠 思维生成（Thought Graph）──
    const t3_6 = Date.now();
    const recentMoods = (input.recentUserMoods ?? this.valenceHistory.slice(-10))
      .map(v => v > 0.2 ? 'positive' : v < -0.2 ? 'negative' : 'neutral');
    const idleMins = input.lastInteractionAt
      ? (Date.now() - input.lastInteractionAt) / 60_000
      : 0;

    const seeds = assessThoughtGeneration({
      emotionState: updatedEmotionState,
      event: input.emotionEvent ?? undefined,
      userText: input.userText,
      recentMoods,
      idleMinutes: idleMins,
      roundNumber,
      existingNodes: this.thoughtGraph.getActiveNodes(),
    });

    const newThoughtIds: string[] = [];
    for (const seed of seeds) {
      // 用模板填充内容（可替换为 LLM 生成以获得更高质量）
      const content = fillThoughtContent(seed, updatedEmotionState, input.userText);
      const node = this.thoughtGraph.addThought(
        seed,
        content,
        updatedEmotionState,
        null, // sourceMemoryId — 未来可关联 episodicMemory
      );
      newThoughtIds.push(node.id);

      // 🧩 同步到 MemoryGraph（自动建边）
      this.memoryGraph.addNode(createNodeFromThought(node));
    }

    // 每日衰减（随轮次渐进触发）
    if (roundNumber % 20 === 0) {
      this.thoughtGraph.decay(1); // 每 20 轮衰减 1 天
    }
    // 定期聚类
    if (roundNumber % 50 === 0) {
      this.thoughtGraph.cluster();
    }

    // ── 阶段 3.65: v1.7 内在情绪源（情绪不再只由"用户当前这句话"驱动）──
    // 逐源记录影响量（供涌现诊断：内在驱动 vs 用户驱动）
    // 记账口径：|Δ效价| + |Δ唤醒| + Σ|Δ九情|（只看太极会低估只改九情的来源，如情绪传染）
    const valenceBeforeInternal = updatedEmotionState.taiji.valence;
    const arousalBeforeInternal = updatedEmotionState.taiji.arousal;
    // ① 情绪传染：用户情绪按共情度传染给她（此前 applyEmotionalContagion 从未接入主链）
    if (input.userAnalysis) {
      const beforeTai = updatedEmotionState.taiji;
      const beforeEmo = { ...updatedEmotionState.emotions };
      updatedEmotionState = applyEmotionalContagion(
        updatedEmotionState,
        input.userAnalysis.expressedEmotion,
        input.userAnalysis.intensity,
        updatedEmotionState.evolution.empathy,
      );
      const afterTai = updatedEmotionState.taiji;
      this.emergence = accumulateSource(
        this.emergence,
        'contagion',
        afterTai.valence - beforeTai.valence,
        afterTai.arousal - beforeTai.arousal,
        sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
      );
    }
    // ①.5 v1.14 评价层：这件事对**她**意味着什么
    //
    // 与传染的分工：传染是**镜像**（他也难过 → 我也难过）；
    // 这里用她自己的目标结构（动机池里"她挂着他的事"）评价他的这句话，
    // 产出**她自己的**反应——例如"他面试挂了"碰到她挂着的那件事 →
    // 替他悬着（fear）+ 想靠近（love），而不是只把他的 sad 复制一遍。
    // 允许为空：他说的与她挂着的无关、或他情绪太弱 → 不硬编反应。
    if (input.userAnalysis && process.env.DISABLE_APPRAISAL !== 'true') {
      const concerns = (updatedEmotionState.internal?.motive?.pool ?? [])
        .filter(m => !m.satisfiedAt && (m.kind === 'open_loop' || m.kind === 'worry'));
      const appraisal = appraiseEvent({
        userText: input.userText,
        userEmotion: input.userAnalysis.expressedEmotion,
        userIntensity: input.userAnalysis.intensity,
        concerns,
      });
      this.lastAppraisal = appraisal;
      if (appraisal.readings.length > 0) {
        const beforeTai = updatedEmotionState.taiji;
        const beforeEmo = { ...updatedEmotionState.emotions };
        updatedEmotionState = applyAppraisal(updatedEmotionState, appraisal);
        const afterTai = updatedEmotionState.taiji;
        this.emergence = accumulateSource(
          this.emergence,
          'appraisal',
          afterTai.valence - beforeTai.valence,
          afterTai.arousal - beforeTai.arousal,
          sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
        );
      }
    }

    // ② 内在事件：孤独/重逢/思维/兴趣/发现/洞察 → 弱强度情绪变化（习惯化 + 单轮总量上限）
    const t3_65 = Date.now();
    const internalEvents = deriveInternalEvents({
      idleMinutes: input.lastInteractionAt ? idleMins : undefined,
      interestCount: userInterests.length,
      thoughtTypes: seeds
        .map(s => thoughtTypeToInternal(s.type))
        .filter((t): t is NonNullable<typeof t> => t !== null),
      hasDiscovery: pendingDiscoveries.length > 0,
      hasInsight: generatedInsights.length > 0,
    });
    if (internalEvents.length > 0) {
      const beforeTai = updatedEmotionState.taiji;
      const beforeEmo = { ...updatedEmotionState.emotions };
      updatedEmotionState = applyInternalEvents(updatedEmotionState, internalEvents);
      const afterTai = updatedEmotionState.taiji;
      this.emergence = accumulateSource(
        this.emergence,
        'internal',
        afterTai.valence - beforeTai.valence,
        afterTai.arousal - beforeTai.arousal,
        sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
      );
    }
    // ③ v1.8 心情层：把"上一轮之后的底色心情"轻推回本轮（强烈情绪时让位）
    const nowMs = Date.now();
    const prevMood = input.currentEmotionState.internal?.mood;
    const prevRumination = input.currentEmotionState.internal?.rumination;
    if (prevMood && prevMood.samples > 0) {
      // 让位权重用"被激活的情绪"强度（不能把静息就高的 calm 算进来）
      const dominantNow = activatedDominant(updatedEmotionState.emotions).intensity;
      const beforeTai = updatedEmotionState.taiji;
      const beforeEmo = { ...updatedEmotionState.emotions };
      updatedEmotionState = applyMoodBias(
        updatedEmotionState,
        prevMood,
        nowMs,
        dominantNow,
        // 起点取"本轮开始前"的效价：心情只推动底色，不抹平用户当下造成的变化
        input.currentEmotionState.taiji.valence,
      );
      const afterTai = updatedEmotionState.taiji;
      this.emergence = accumulateSource(
        this.emergence,
        'mood',
        afterTai.valence - beforeTai.valence,
        afterTai.arousal - beforeTai.arousal,
        sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
      );
    }
    // ④ v1.8 反刍：同一情绪连续主导 → 边际强度钝化 + 自我安抚（给情绪切换留出口）
    {
      const beforeTai = updatedEmotionState.taiji;
      const beforeEmo = { ...updatedEmotionState.emotions };
      updatedEmotionState = ruminationModulation(updatedEmotionState, prevRumination, nowMs);
      const afterTai = updatedEmotionState.taiji;
      this.emergence = accumulateSource(
        this.emergence,
        'rumination',
        afterTai.valence - beforeTai.valence,
        afterTai.arousal - beforeTai.arousal,
        sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
      );
    }
    // 用户话语直接刺激（阶段 3 的 applyEvent）作为 external 来源一并记账
    this.emergence = accumulateSource(
      this.emergence,
      'external',
      valenceBeforeInternal - input.currentEmotionState.taiji.valence,
      arousalBeforeInternal - input.currentEmotionState.taiji.arousal,
      sumEmotionDelta(input.currentEmotionState.emotions, updatedEmotionState.emotions),
    );

    // ⑤ 回写内在状态：心情采样（本轮九情净效价）+ 反刍链推进（只看激活情绪）
    const activeDominant = activatedDominant(updatedEmotionState.emotions);
    updatedEmotionState.internal = {
      satiation: updatedEmotionState.internal?.satiation ?? {},
      // v1.9 动机池由 server 在 Prompt 组装阶段维护，这里必须原样带走（否则每轮被清空）
      ...(input.currentEmotionState.internal?.motive
        ? { motive: input.currentEmotionState.internal.motive }
        : {}),
      mood: updateMood(
        prevMood,
        moodSampleFrom(updatedEmotionState),
        nowMs,
        // 锚点用她的人格基线（不是此刻的效价），否则心情会锚死在当下的低谷
        Number.isFinite(input.currentEmotionState.evolution?.baseline)
          ? input.currentEmotionState.evolution.baseline
          : input.currentEmotionState.taiji.valence,
      ),
      rumination: trackRumination(
        prevRumination,
        activeDominant.name,
        activeDominant.intensity,
        nowMs,
      ),
    };
    const internalEmotionMs = Date.now() - t3_65;

    // ⑥ 涌现可观测：记轮数 + 她的效价序列（用于自相关/波动诊断）
    this.emergence = markTurn(this.emergence);
    this.herValenceHistory.push(updatedEmotionState.taiji.valence);
    if (this.herValenceHistory.length > 50) this.herValenceHistory.shift();

    const thoughtSummary = this.thoughtGraph.getGraphSummary();
    const activeWishes = this.thoughtGraph.getActiveWishes().map(n => n.content);
    if (newThoughtIds.length > 0) {
      bus.emit('ThoughtGenerated', {
        count: newThoughtIds.length,
        types: seeds.map(s => s.type),
      });
    }
    const thoughtMs = Date.now() - t3_6;

    // ── 阶段 3.7: 🌑 Shadow Layer 检测与施加（v1.13 接线）──
    // 此前：shadowEmotionMod 定义后从不消费、detectTraits 的 strategyStats 传 null
    //       （"策略证据"永不产生）、状态不持久化（重启清零）—— 498 行实现基本空转。
    // 现在：①每 ≥50 轮（按持久化轮次，而非 `% 50 === 0`，避免重启后错拍）
    //       ②喂入 rewardLearner 的真实策略统计 ③每轮把聚合偏置限幅施加到太极
    let shadowDetected = false;
    {
      const shadowState = shadowLayer.getState();
      const roundsSinceDetection = roundNumber - (shadowState.stats.lastDetectionRound ?? -SHADOW_DETECTION_INTERVAL_ROUNDS);
      if (roundsSinceDetection >= SHADOW_DETECTION_INTERVAL_ROUNDS) {
        const emotionHist = {
          stickyEmotions: findStickyEmotions(input.recentUserMoods ?? []),
          avgArousal: updatedEmotionState.taiji.arousal,
          avgValence: updatedEmotionState.taiji.valence,
          reversalCount: updatedEmotionState.yinyang.reversalPressure > 0 ? 1 : 0,
        };
        // 策略证据：把 rewardLearner 的统计映射成 {uses, successes}
        // （注意 getAllStats() 返回数组；早期误用 Object.entries 导致这条通路静默失效）
        const strategyStats = strategyStatsForShadow(rewardLearner.getAllStats() as any);
        const activated = shadowLayer.detectTraits(
          this.thoughtGraph.getState(),
          emotionHist,
          Object.keys(strategyStats).length > 0 ? strategyStats : null,
          roundNumber,
        );
        if (activated.length > 0) {
          console.log(`[Shadow] 新激活特质：${activated.map(t => `${t.label}(conf=${t.confidence.toFixed(2)})`).join('、')}`);
        }
        shadowDetected = true;
      }
    }
    // 潜意识状态有更新 → 标记待落盘（协调器不做 io，由 server 决定时机）
    if (shadowDetected) this.shadowStateDirty = true;
    const shadowEmotionMod = shadowLayer.getEmotionModulation();
    const shadowStrategyMod = shadowLayer.getStrategyModulation();
    const shadowMemoryMod = shadowLayer.getMemoryModulation();

    // 施加潜意识情绪偏置（限幅 ±SHADOW_MAX_TURN_BIAS：底色级慢变量，不许盖过用户当下的话）
    {
      const activeTraits = shadowLayer.getActiveTraits();
      const before = updatedEmotionState.taiji;
      const beforeEmo = { ...updatedEmotionState.emotions };
      updatedEmotionState = applyShadowEmotionBias(updatedEmotionState, shadowEmotionMod);
      if (activeTraits.length > 0) {
        const after = updatedEmotionState.taiji;
        this.emergence = accumulateSource(
          this.emergence,
          'shadow',
          after.valence - before.valence,
          after.arousal - before.arousal,
          sumEmotionDelta(beforeEmo, updatedEmotionState.emotions),
        );
      }
    }

    // ── 阶段 3.7: v1.13 人格参数漂移（信任/开放/活泼/共情/敏感度/韧性）──
    //
    // 为什么补这一步：`driftPersonalityParams` 此前**从未在权威链路里执行**。
    // 它的唯一调用点挂在 `PersonalityDrifted` 事件上，而该事件只有前端旧 store 的
    // `updateEmotion` 会发 —— 那个 action 没有任何调用者（前端已改为读服务端返回的
    // `emotionState`）；`server.ts` 也只 import 未调用。
    // 实测后果（scripts/ab-personality-drift.ts，30 轮）：六个参数**一个点都没动**。
    //
    // 放在这里是因为它必须读**本轮情绪都已落定**之后的状态（传染/内在事件/心情/反刍/潜意识
    // 全部施加完），而它本身不改情绪，故不影响同轮的记忆召回与策略选择。
    // 单轮幅度上限由 `DEFAULT_DRIFT_CONFIG.maxChangePerRound` = 2.0 兜底。
    if (process.env.DISABLE_PERSONALITY_DRIFT !== 'true') {
      const driftedState = structuredClone(updatedEmotionState);
      const driftResult = driftPersonalityParams(
        driftedState.evolution,
        driftedState,
        input.userText,
        input.userAnalysis ?? null,
      );
      updatedEmotionState = driftedState;
      this.lastPersonalityDrift = {
        changes: { ...driftResult.changes },
        log: [...driftResult.log],
        at: Date.now(),
      };
    }

    // ── 阶段 3.8: 🧩 Memory Graph 激活 ──
    // 根据当前上下文，通过 BFS 激活扩散召回相关记忆
    const t3_8 = Date.now();
    const memoryContext = queryMemoryGraph(
      this.memoryGraph,
      { text: input.userText, emotionState: updatedEmotionState },
      { maxDepth: 2, maxResults: 5 },
    );

    // 🌑 Shadow 记忆调制：negativityBias 影响负情绪记忆的召回权重
    if (shadowMemoryMod.negativityBias > 0.1) {
      for (const item of memoryContext) {
        if (item.emotionalMatch === 'sad' || item.emotionalMatch === 'fear' || item.emotionalMatch === 'anger') {
          item.relevanceScore = Math.min(1, item.relevanceScore * (1 + shadowMemoryMod.negativityBias));
        }
      }
    }
    const memoryMs = Date.now() - t3_8;

    // ── 阶段 3.9: v1.1 依恋风格计算（每 20 轮淬炼一次）──
    if (roundNumber >= 20 && roundNumber % 20 === 0) {
      const valenceVolatility = computeVolatility(this.valenceHistory);
      const topicSwitchRate = computeTopicSwitchRate(this.topicHistory);
      const intimacySeekingRate = Math.min(1, this.intimacySeekingCount / Math.max(1, this.topicHistory.length));
      const freqVolatility = computeIntervalVolatility(this.interactionTimestamps);
      const attachment = classifyAttachmentStyle(valenceVolatility, topicSwitchRate, intimacySeekingRate, freqVolatility);
      // 慢速 EMA 淬炼到 evolution（不直接跳变）
      const alpha = 0.15;
      updatedEmotionState.evolution.attachmentAnxietyScore =
        (updatedEmotionState.evolution.attachmentAnxietyScore ?? 0) * (1 - alpha) + attachment.anxiety * alpha;
      updatedEmotionState.evolution.attachmentAvoidanceScore =
        (updatedEmotionState.evolution.attachmentAvoidanceScore ?? 0) * (1 - alpha) + attachment.avoidance * alpha;
      updatedEmotionState.evolution.attachmentStyle = attachment.style;
    }

    // ── 阶段 4: 策略选择（S5 冲突 + S8 情境 + Sprint C 认知上下文 + Sprint E Insight + 🧠 Thought Graph + 🌑 Shadow + 🧩 Memory Graph 共同调制） ──
    const t4 = Date.now();
    const strategyCtx: StrategyContext = {
      emotionState: updatedEmotionState,
      // v1.27：Rule 1 的"她也被带进去了吗"必须读**本轮开始前**的激活量 ——
      // 这里取 `input.currentEmotionState`（尚未被本轮刺激推动）。
      // 用 `updatedEmotionState` 现算会让门限恒成立（实测任何 ≥0.5 强度的负面话都把她推过 0.12）。
      herNegativeBeforeTurn,
      userAnalysis: input.userAnalysis ?? null,
      conflictState,
      recentUserMoods: input.recentUserMoods ?? this.valenceHistory.slice(-10),
      consecutiveNegativeRounds: input.consecutiveNegativeRounds ?? 0,
      // Sprint C: 使用阶段 0 提取的实际兴趣信号（而非永远为 []）
      interestSignals: input.interestSignals ?? userInterests,
      // Sprint C: 从探索引擎获取待分享发现（而非永远为 []）
      pendingDiscoveries: input.pendingDiscoveries ?? pendingDiscoveries,
      // Sprint E: 合并 insight 生成的标题作为额外的发现
      generatedInsights,
      // Phase 1: 情绪加权后的相关认知模式
      relevantPatterns,
      // Sprint C: 所有候选模式（含未确认），供 Rule 4 成熟度过滤
      patternCandidates,
      idleMinutes: input.lastInteractionAt
        ? (Date.now() - input.lastInteractionAt) / 60_000
        : 0,
      timeOfDay: new Date().getHours(),
      timeSlot: contextSnapshot.time.timeSlot,
      userStress: contextSnapshot.user.accumulatedStress,
      isReunion: contextSnapshot.user.isReunion,
      roundNumber,
      // 🧠 Thought Graph: 活跃 wish 内容列表（供 desire 策略使用）
      activeWishes,
      // 🧠 思维图谱摘要（供 System Prompt 个性注入）
      thoughtSummary,
      // 🆕 S7: 当前活跃价值观
      activeValues: input.activeValues,
      // 🧩 Memory Graph: 图遍历召回的记忆上下文
      memoryContext,
    };

    // ── v1.58 C-1：**计算**与**提交**分开（架构边界，已写进 CLAUDE.md）──
    const strategyPlan = this.computeStrategyPlan(strategyCtx, {
      conflictState, contextSnapshot, generatedInsights, updatedEmotionState, shadowStrategyMod,
      userAnalysis: input.userAnalysis,
    });
    const strategyDecision = strategyPlan.decision;
    const finalStrategy = strategyPlan.finalStrategy;
    const strategySnippet = strategyPlan.snippet;
    const arbitrationOutput = strategyPlan.arbitrationOutput;
    // v1.58：提交侧要的两个量先算好（它们是**本轮**的，与"哪一趟策略"无关）
    const commitInputs = {
      valenceDelta: updatedEmotionState.taiji.valence - input.currentEmotionState.taiji.valence,
      userDirectedAtAI: input.userAnalysis?.directedAtAI ?? false,
    };
    if (input.deferStrategyCommit) {
      // 本轮**先不提交**：调用方还要跑「回忆闸门 → 动机」，再调
      // `commitFinalStrategyWithMotive()` 一次性提交 —— 于是只有一个最终策略被记账。
      this.pendingStrategy = {
        strategyCtx,
        extras: { conflictState, contextSnapshot, generatedInsights, updatedEmotionState, shadowStrategyMod, userAnalysis: input.userAnalysis },
        commitInputs,
      };
    } else {
      this.commitStrategyPlan({ ...strategyPlan, ...commitInputs });
    }
    const strategyMs = Date.now() - t4;
    const arbitrationMs = strategyPlan.arbitrationMs;

    // ── 阶段 5: 节奏决策 ──
    const t5 = Date.now();
    const userMessageLength = input.userText.length;
    const roundIntervalMs = input.lastInteractionAt
      ? Date.now() - input.lastInteractionAt
      : 60000; // 默认 1 分钟

    const rhythmDecision = rhythmController.decide(
      contextSnapshot.time,
      contextSnapshot.user,
      contextSnapshot.session,
      input.userAnalysis?.intensity ?? updatedEmotionState.taiji.arousal,
      userMessageLength,
      roundIntervalMs,
      {
        responseLengthMod: contextSnapshot.modulationFactors.responseLengthMod,
        proactiveSuitability: contextSnapshot.modulationFactors.proactiveSuitability,
      },
    );

    // v1.0: 仲裁层覆盖节奏决策（如果仲裁层推翻了原始节奏）
    const finalRhythm = {
      ...rhythmDecision,
      mode: arbitrationOutput.finalRhythm.mode,
    };
    if (finalRhythm.mode !== rhythmDecision.mode) {
      console.log(`[Arbitration] ⚡ 节奏覆盖: ${rhythmDecision.mode} → ${finalRhythm.mode}`);
    }
    const rhythmMs = Date.now() - t5;

    // ── 组装输出 ──
    const totalMs = Date.now() - t0;

    return {
      strategy: finalStrategy,
      strategyDecision,
      strategySnippet,
      // v1.47：评价结论的投递（开关默认关；关着时逐字是 ''，Prompt 与旧版完全一致）
      appraisalSnippet: appraisalStanceEnabled() ? appraisalToPromptSnippet(this.lastAppraisal) : '',
      updatedEmotionState,
      conflictState,
      contextSnapshot,
      rhythmDecision: finalRhythm,
      relevantPatterns,
      patternCandidates,
      pendingDiscoveries,
      generatedInsights,
      funnelSnapshot: getFunnelSnapshot(),
      thoughtSummary,
      newThoughts: seeds.map(s => `${s.type}:${s.direction}`),
      memoryContext,
      connectionHealth: getConnectionHealth(),
      metadata: {
        processedAt: Date.now(),
        roundNumber,
        timings: {
          conflictDetectionMs: conflictMs,
          contextEnrichmentMs: contextMs,
          emotionUpdateMs: emotionMs,
          patternRetrievalMs: patternMs,
          thoughtGenerationMs: thoughtMs,
          strategySelectionMs: strategyMs,
          arbitrationMs,
          rhythmDecisionMs: rhythmMs,
          memoryGraphMs: memoryMs,
          internalEmotionMs,
          totalMs,
        },
      },
    };
  }

  /**
   * 在 AI 回复发送后调用，评估修复效果。
   * 应在下一轮用户消息到达时（或之前）调用。
   */
  evaluateLastRepair(userValenceAfter: number): void {
    conflictManager.evaluateRepair(userValenceAfter);
  }

  /**
   * v1.8 涌现诊断报告：内在驱动占比 / 情绪自相关 / 波动 / 是否卡死。
   * 供 /state 端点与调试使用，不参与对话决策。
   */
  getEmergenceReport(): EmergenceReport {
    return buildEmergenceReport(this.emergence, this.herValenceHistory);
  }

  /**
   * 重置协调器状态（切换用户或清空会话时调用）。
   */
  reset(): void {
    this.turnCounter = 0;
    this.valenceHistory = [];
    this.herValenceHistory = [];
    this.emergence = emptyEmergenceStats();
    this.lastStrategy = null;
    this.lastTurnValenceDelta = 0;
    this.lastUserDirectedAtAI = false;
    this.topicHistory = [];
    this.intimacySeekingCount = 0;
    this.interactionTimestamps = [];
    conflictManager.reset();
    contextAwareness.reset();
    rhythmController.reset();
  }

  /**
   * 获取当前管道健康状态摘要（用于 /health 端点或调试面板）。
   */
  /**
   * v1.13 上一轮的人格漂移（信任/开放/活泼/共情/敏感度/韧性 各自变了多少 + 原因）。
   * 没有这一步就无从判断"她的人格有没有在长"。
   */
  getLastPersonalityDrift(): { changes: Record<string, number>; log: string[]; at: number } | null {
    return this.lastPersonalityDrift;
  }

  /**
   * v1.14 最近一次评价层结果：这件事对**她**意味着什么（readings 带人话理由与依据）。
   */
  getLastAppraisal(): AppraisalResult | null {
    return this.lastAppraisal;
  }

  /**
   * v1.33 最近一次策略裁决（含 Laya 决策层的审计记录），供 `/state → strategy` 读。
   */
  getLastStrategyDecision(): StrategyDecision | null {
    return this.lastStrategyDecision;
  }

  /**
   * v1.34 最近一次**构造出来的 `StrategyContext`** —— 只给离线工具用
   * （`scripts/collect-strategy-ledger.ts` 把它连同回复一起落盘，之后
   * `scripts/propose-strategy-tuning.ts` 就能在**真实样本上反事实重放** `selectStrategy`）。
   *
   * 为什么值得单独开一个口：要回答"把某个阈值改一下会怎样"，唯一的诚实办法是拿真发生过的
   * 局面重放；而 `StrategyContext` 只在 `processTurn` 内部存在过，不落盘就永远回不来。
   */
  getLastStrategyContext(): StrategyContext | null {
    return this.lastStrategyContext;
  }

  getHealthSummary(): {
    connections: ReturnType<typeof getConnectionHealth>;
    conflictPhase: string;
    rhythmMode: string;
    turnCount: number;
  } {
    return {
      connections: getConnectionHealth(),
      conflictPhase: conflictManager.getState().phase,
      rhythmMode: rhythmController.getMode(),
      turnCount: this.turnCounter,
    };
  }
}

// ── v1.1 依恋风格辅助函数 ──

/** 计算数值数组的标准化波动率 [0, 1] */
function computeVolatility(values: number[]): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.min(1, Math.sqrt(variance) * 2);
}

/**
 * 计算话题切换率 [0, 1]。
 * ponytail: 简化为相邻消息长度变化率 > 50% 即视为话题切换。
 */
function computeTopicSwitchRate(messages: string[]): number {
  if (messages.length < 2) return 0;
  let switches = 0;
  for (let i = 1; i < messages.length; i++) {
    if (Math.abs(messages[i].length - messages[i - 1].length) / Math.max(1, messages[i - 1].length) > 0.5) {
      switches++;
    }
  }
  return switches / (messages.length - 1);
}

/** 计算交互间隔的波动率（log-scale） */
function computeIntervalVolatility(timestamps: number[]): number {
  if (timestamps.length < 3) return 0;
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  return computeVolatility(intervals.map(i => Math.log(i + 1)));
}


/** 从最近情绪历史中找出粘性情绪（出现频率 > 40%） */
function findStickyEmotions(_moods: number[]): string[] {
  // 从效价历史推断粘性情绪（简化版，后续可接入真实的九情追踪）
  if (_moods.length < 5) return [];
  const negRatio = _moods.filter(v => v < -0.2).length / _moods.length;
  const result: string[] = [];
  if (negRatio > 0.4) result.push('sad');
  if (negRatio > 0.6) result.push('fear');
  return result;
}

// 全局单例（与 DefaultAIEngine 保持相同模式）
export const aiCoordinator = new AICoordinator();

