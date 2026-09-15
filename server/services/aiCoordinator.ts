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
import { selectStrategy, STRATEGY_PROMPT_SNIPPETS } from '../../src/lib/dialogueStrategy.js';
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
import type { StrategyDecision, StrategyType, StrategyContext } from '../../src/lib/dialogueStrategy.js';
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
  /** 用户 ID（用于日志） */
  userId?: string;
  /** 上一轮时间戳（用于节奏检测） */
  lastInteractionAt?: number;
  /** 🆕 S7: 当前活跃价值观 */
  activeValues?: Record<string, number>;
}

export interface TurnOutput {
  /** 策略选择结果 */
  strategy: StrategyType;
  strategyDecision: StrategyDecision;
  /** 可直接注入 System Prompt 的策略提示词片段 */
  strategySnippet: string;
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
  /** v1.1 依恋风格：用户消息历史（用于话题切换率计算） */
  private topicHistory: string[] = [];
  /** v1.1 依恋风格：亲密表达次数 */
  private intimacySeekingCount = 0;
  /** v1.1 依恋风格：交互时间戳（用于频率波动计算） */
  private interactionTimestamps: number[] = [];
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
      const dominantEntry = Object.entries(updatedEmotionState.emotions)
        .sort((a, b) => b[1] - a[1])[0];
      const oldDominantEntry = Object.entries(input.currentEmotionState.emotions)
        .sort((a, b) => b[1] - a[1])[0];
      bus.emit('EmotionUpdated', buildEmotionUpdatedPayload({
        stimulus: input.emotionEvent,
        context,
        dominant: dominantEntry?.[0] ?? 'neutral',
        prevDominant: oldDominantEntry?.[0] ?? 'neutral',
        valence: newValence,
        arousal: newArousal,
        deltaValence: newValence - oldValence,
        deltaArousal: newArousal - oldArousal,
        intensity: dominantEntry?.[1] ?? 0,
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

    const strategyDecision = selectStrategy(strategyCtx);
    // 🌑 Shadow 调制：活跃 trait 影响策略置信度
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
    // v1.0: 奖励学习 — 记录本轮策略选择
    rewardLearner.markStrategyUsed(strategyDecision.strategy);
    // Phase 2: 存储本轮策略和效价变化量（用户消息对 AI 情绪的影响），供下轮反馈
    this.lastStrategy = strategyDecision.strategy;
    this.lastTurnValenceDelta = updatedEmotionState.taiji.valence
      - input.currentEmotionState.taiji.valence;
    this.lastUserDirectedAtAI = input.userAnalysis?.directedAtAI ?? false;

    // ── 阶段 4.5: 仲裁层（Arbitration）──
    // 跨模块交叉校验：防止冲突管理器/策略引擎/节奏控制器输出矛盾
    const t4_5 = Date.now();
    const arbitrationInput: ArbitrationInput = {
      strategyDecision,
      conflictState,
      contextSnapshot,
      rhythmDecision: { mode: 'casual', responseDelayMs: 0, allowProactive: false, suggestedResponseLength: 0, reason: 'arbitration_pre' },
      // Phase 2: 认知上下文供仲裁规则 E/F 使用
      generatedInsights,
      currentValence: updatedEmotionState.taiji.valence,
    };
    const arbitrationOutput = arbitrate(arbitrationInput);
    const finalStrategy = arbitrationOutput.finalStrategy;
    const strategySnippet = STRATEGY_PROMPT_SNIPPETS[finalStrategy];
    if (hasOverrides(arbitrationOutput)) {
      console.log(`[Arbitration] ⚡ 策略覆盖: ${formatOverrides(arbitrationOutput)}`);
    }
    // v5.1: 策略选择 → EventBus（补全认知主链的策略节点）
    bus.emit('StrategySelected', {
      strategy: finalStrategy,
      reason: strategyDecision.reason,
      confidence: strategyDecision.confidence,
      overrides: arbitrationOutput.overrides,
    });
    const strategyMs = Date.now() - t4;
    const arbitrationMs = Date.now() - t4_5;

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
