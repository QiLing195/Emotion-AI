import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import fs from 'fs';
import { spawn } from 'child_process';
import { parseString } from 'xml2js';
import { parseChatRequest, parseTtsRequest, parseVisionRequest } from './utils/requestValidation.js';

// Import services
import { AIRequestError, DefaultAIEngine } from './services/aiEngine.js';
import { WeChatOfficialAccountChannel } from './services/channels/wechat.js';
import { mcpService } from './services/mcpService.js';
import { firebaseService } from './services/firebase.js';
import type { Application } from 'express';

// ponytail: inlined from deleted server/services/interfaces.ts
import type { EmotionEvent } from '../src/lib/emotionEngine.js';
import { rewardLearner } from '../src/lib/rewardLearner.js';

interface IMessageChannel {
  id: string;
  name: string;
  registerRoutes(app: Application, aiEngine: DefaultAIEngine): void;
  setConfig(config: any): void;
}
// Phase 2: Strategy layer injection
import { aiCoordinator } from './services/aiCoordinator.js';
import { analyzeEmotionEvent, analyzeUserEmotionLocally, fallbackEmotionEvent } from './services/emotionAnalyzer.js';
import {
  filterRelationshipMemoryItems,
  getRelationshipResponsePolicy,
  processSuccessfulRelationshipTurn,
  relationshipScoreV2,
} from './services/relationshipRuntime.js';
import type { RelationshipStateV2 } from '../src/lib/relationshipProgressionV2.js';
import { buildPatternInjection, buildProactiveMemoryInjection, PERSONALITY_FOUNDATION } from '../src/lib/contentInjector.js';
import { getDominantEmotion, describeReinforcementState } from '../src/lib/emotionEngine.js';
import { assessEpisodeCandidate, isProactivelyRecallable } from '../src/lib/memoryGovernance.js';
import { runConsolidation } from '../src/lib/memoryEnhancer.js';
import { memoryGraph, syncEpisodicArchivedNodes, createNodeFromEpisode, backfillEpisodicNodes } from '../src/lib/memoryGraph.js';
import { edgeTtsArgs, resolveEmotionTone } from '../src/lib/voiceTone.js';
import { synthesizeCosyVoice, CosyVoiceUnavailableError } from './services/cosyVoiceTts.js';
import { visibleAtStage } from '../src/lib/memoryVisibility.js';
import { rhythmController } from '../src/lib/rhythmController.js';
import { shadowLayer } from '../src/lib/shadowLayer.js';
import { moodPromptHint, describeMood } from '../src/lib/moodLayer.js';
import { ruminationPromptHint, describeRumination } from '../src/lib/rumination.js';
import {
  extractOpenLoops, openLoopMotiveContent, resolveOpenLoops, selectMotive,
  markMotiveAttempted, motiveToPromptSnippet, describeMotive,
  valueStanceMotive, moodStateMotive, memoryEchoMotive,
  classifyMotiveOutcome, learnFromOutcome, summarizeMotiveLearning,
  type MotiveCandidate,
} from '../src/lib/motive.js';
import {
  buildSpecificizePrompt, parseSpecificMotives, shouldSpecificize,
} from './services/motiveSpecificizer.js';
import {
  buildGroundingCorpus, checkMemoryGrounding, buildRewriteInstruction, stripUngroundedClaims,
} from '../src/lib/memoryGrounding.js';
import {
  evaluateProactiveGates, passesMotiveThreshold, buildProactivePrompt,
  sanitizeProactiveMessage, describeProactiveDecision,
  PROACTIVE_MIN_IDLE_MINUTES,
} from './services/proactiveMessenger.js';
import { getFunnelSnapshot, getFunnelRecommendations } from '../src/curiosity/funnel.js';
import { bus } from '../src/eventBus.js';

// Phase 2: Web search integration
import { searchForLLM } from '../src/curiosity/search.js';
import { generateAIResponse, generateEmbeddings } from '../src/lib/aiProvider.js';

// Search helper for factual questions.
const FACTUAL_PATTERNS = [
  /\u4ec0\u4e48/, /\u600e\u4e48/, /\u4e3a\u4ec0\u4e48/, /\u5982\u4f55/,
  /\u662f\u8c01/, /\u54ea\u4e2a/, /\u591a\u5c11/, /\u4f55\u65f6/,
  /\u54ea\u91cc/, /\u4ecb\u7ecd\u4e00\u4e0b/, /\u89e3\u91ca/, /\u5b9a\u4e49/,
  /\u544a\u8bc9\u6211/, /\u6700\u8fd1.*\u65b0\u95fb/, /\u6700\u65b0.*\u6d88\u606f/,
  /\?$/, /\uff1f$/,
];

function isFactualQuestion(text: string): boolean {
  if (!text || text.length < 3) return false;
  const skipPatterns = /^(\u4f60\u597d|\u55e8|\u54c8\u55bd|\u65e9|\u665a\u5b89|\u62dc\u62dc|\u518d\u89c1|\u8c22\u8c22|\u7231\u4f60|\u60f3\u4f60|\u62b1\u62b1|\u4eb2\u4eb2|\u55ef|\u54e6|\u597d|\u884c|\u53ef\u4ee5|\u77e5\u9053\u4e86)/;
  if (skipPatterns.test(text.trim())) return false;
  return FACTUAL_PATTERNS.some(p => p.test(text));
}

import {
  EpisodicMemoryStore, tryFormEpisode,
  getSignificantEpisodes, decideProactiveRecall,
} from '../src/lib/episodicMemory.js';
import { recall, type RecallQuery } from '../src/lib/unifiedMemory.js';
import { driftPersonalityParams, DEFAULT_DRIFT_CONFIG } from '../src/lib/personalityEvolution.js';
import { surfaceValues, getValueNarrative } from '../src/lib/valueDiscovery.js';
import { generateIdentityNarrative, shouldRefreshNarrative, narrativeToApiResponse, narrativeToPromptSnippet } from '../src/lib/identityNarrative.js';
import {
  episodicStore, valueSystem, semanticMemoryPool,
  loadAll, loadRelationshipState,
  saveEmotionStateAsync,
  saveEpisodicStore, saveEpisodicStoreAsync,
  saveRelationshipStateAsync, saveValueSystem, saveCuriosityState,
  memoryLedger, saveMemoryLedgerAsync, saveMemoryGraph,
  getLastInteractionAt, markInteraction, saveSessionState,
  setIdentityNarrative, saveIdentityNarrative, getIdentityNarrative,
  getMotiveLearning, setMotiveLearning, saveMotiveLearning,
  saveShadowState, saveRewardStats,
} from './persistence.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── v5.0 服务端事件日志 ──
interface ServerEvent {
  id: string;
  type: string;
  level: 'cognitive' | 'system';
  source: string;
  timestamp: number;
  data: any;
  correlationId?: string;
  causedBy?: string;
  sessionId?: string;
}
let _serverEventCounter = 0;
function serverEmit(type: string, data?: any, opts?: { correlationId?: string; causedBy?: string; level?: 'cognitive' | 'system'; source?: string }): string {
  const id = `evt_srv_${Date.now()}_${++_serverEventCounter}`;
  const level = opts?.level ?? 'cognitive';
  const source = opts?.source ?? 'system';
  serverEventLog.push({ id, type, level, source, timestamp: Date.now(), data, correlationId: opts?.correlationId, causedBy: opts?.causedBy, sessionId: 'server' });
  if (serverEventLog.length > 1000) serverEventLog.splice(0, serverEventLog.length - 1000);
  return id;
}
const serverEventLog: ServerEvent[] = [];

export class AIGirlfriendServer {
  private app: express.Application;
  private server: http.Server;
  private aiEngine: DefaultAIEngine;
  private messageChannels: IMessageChannel[] = [];
  private _tick = 0;
  private _relationshipState!: RelationshipStateV2;
  private _chatQueue: Promise<void> = Promise.resolve();
  private _serverAISettingsLoaded = false;
  private _serverAISettings: any = null;
  private _lastVision: { text: string; emotion: string; ts: number } | null = null;
  private _visionCooldown = 0;
  /** v1.3 记忆增强：上次整合时间（遗忘+去重，≥6h 触发一次） */
  private _lastConsolidationAt = 0;
  /** v1.9 价值浮现：上次运行的轮次（每 10 轮一次，避免每轮都改置信度） */
  private _lastValueSurfaceRound = -1;
  /** v1.9 价值浮现：本进程是否已做过"空优先级"引导（最多一次，避免每轮刷置信度） */
  private _valueBootstrapDone = false;
  /** v1.10 动机具体化：上次运行的轮次（避免重复调用 LLM） */
  private _lastSpecificizeRound = -1;
  /** v1.12 主动消息：待投递队列（前端轮询 GET /api/proactive/pending 取走） */
  private _proactivePending: Array<{ id: string; text: string; createdAt: string; motiveKind: string }> = [];
  /** v1.12 主动消息：最近一次判定链（供 /state 与 /api/proactive/tick 观测） */
  private _lastProactiveDecision = '尚未评估';
  private _proactiveLoop: ReturnType<typeof setInterval> | null = null;
  /** v1.12 主动消息：最近一次收到的 persona（服务端无 persona 存储，用它拿主动设置） */
  private _lastPersona: Record<string, unknown> | null = null;
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.aiEngine = new DefaultAIEngine();

    this.setupMiddleware();
    this.setupRoutes();
    this.registerDefaultServices();

    // v1.0: load all persistent state
    const persistedEmotionState = loadAll();
    if (persistedEmotionState) this.aiEngine.emotionState = persistedEmotionState;
    this._relationshipState = loadRelationshipState();

    // v1.14 一次性补全：把"有 episodic 存储但图谱无节点"的历史记忆补进图谱
    // （幂等：addNode 对同一 source+sourceId 复用既有节点）
    try {
      const backfill = backfillEpisodicNodes(memoryGraph, episodicStore.episodes);
      if (backfill.added > 0) {
        console.log(`[MemoryGraph] 补全情景节点：新增 ${backfill.added} 个（已存在 ${backfill.reused}，跳过已归档 ${backfill.skippedArchived}）`);
        saveMemoryGraph();
      } else {
        console.log(`[MemoryGraph] 情景节点已齐全（已存在 ${backfill.reused}，跳过已归档 ${backfill.skippedArchived}）`);
      }
    } catch (e) {
      console.warn('[MemoryGraph] 情景节点补全失败（不影响启动）:', (e as Error).message);
    }
  }

  private setupMiddleware() {
    const localOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
    this.app.use(cors({
      origin: (origin, callback) => callback(null, !origin || localOrigin.test(origin)),
    }));
    this.app.use('/api/vision', bodyParser.json({ limit: '12mb' }));
    this.app.use(bodyParser.json({ limit: '1mb' }));
    this.app.use(bodyParser.urlencoded({ extended: true, limit: '32kb' }));

    // JSON-only mutation endpoints prevent cross-site form submissions from
    // silently consuming local AI/TTS/vision resources.
    this.app.use('/api', (req, res, next) => {
      if (
        req.method !== 'GET'
        && !req.path.startsWith('/channel/wechat/callback')
        && !req.is('application/json')
      ) {
        res.status(415).json({ error: 'Content-Type must be application/json' });
        return;
      }
      next();
    });

    const rateBuckets = new Map<string, number[]>();
    this.app.use(['/api/chat', '/api/ai-test', '/api/tts', '/api/vision'], (req, res, next) => {
      const now = Date.now();
      const windowStart = now - 60_000;
      const endpoint = req.originalUrl.split('?')[0];
      const key = `${req.ip}:${endpoint}`;
      const recent = (rateBuckets.get(key) ?? []).filter(timestamp => timestamp > windowStart);
      const limit = endpoint === '/api/vision' ? 12 : endpoint === '/api/chat' ? 30 : 60;
      if (recent.length >= limit) {
        res.status(429).json({ error: 'Too many requests' });
        return;
      }
      recent.push(now);
      rateBuckets.set(key, recent);
      next();
    });

    // XML parser for WeChat
    this.app.use('/api/channel/wechat/callback', bodyParser.text({ type: 'text/xml' }));
    this.app.use('/api/channel/wechat/callback', (req: any, res: any, next: any) => {
      if (req.body && typeof req.body === 'string') {
        try {
          parseString(req.body, (err: any, result: any) => {
            if (!err) {
              req.body = result;
            }
            next();
          });
        } catch (error) {
          next();
        }
      } else {
        next();
      }
    });
  }

  /**
   * v1.12 主动消息一次评估：动机层 → 闸门 → 生成 → 接地校验 → 入待投递队列。
   * 与普通回复的区别：这是"打扰"，所以门槛更高（空闲 ≥2h、动机紧迫度 ≥ persona 阈值、配额/时间窗）。
   */
  private async runProactiveTick(
    trigger: 'scheduler' | 'manual',
    idleMinutesOverride?: number,
  ): Promise<{
    sent: boolean; reason: string; text?: string;
  }> {
    const persona: any = this._lastPersona ?? {};
    const state = this.aiEngine.emotionState;
    if (!state) return { sent: false, reason: '情感状态尚未初始化' };

    // persona 的主动设置落到 rhythmController（每日上限由 proactiveFrequency 控制）
    if (typeof persona.proactiveFrequency === 'number') {
      rhythmController.updateConfig({
        maxProactivePerDay: Math.max(1, Math.min(5, Math.round(persona.proactiveFrequency))),
      });
    }
    const quota = rhythmController.canSendProactive(new Date());
    const lastAt = getLastInteractionAt();
    const idleMinutes = typeof idleMinutesOverride === 'number'
      ? idleMinutesOverride
      : (lastAt ? (Date.now() - lastAt) / 60_000 : Number.POSITIVE_INFINITY);

    const gates = evaluateProactiveGates({
      enabled: persona.proactive !== false,
      idleMinutes,
      quotaAllowed: quota.allowed,
      quotaReason: quota.reason,
      proactiveThreshold: persona.proactiveThreshold,
      relationshipStage: this._relationshipState?.stage,
    });

    // 动机竞选（没有新的用户输入，只用池里挂着的事）
    const motiveState = state.internal?.motive ?? { pool: [] };
    const selection = selectMotive({
      state: motiveState,
      candidates: [],
      userText: '',
      emotionState: state,
      userIntensity: 0,
      learning: getMotiveLearning(),
      now: Date.now(),
    });
    const threshold = passesMotiveThreshold(selection.selected, persona.proactiveThreshold);
    const decision = describeProactiveDecision({ gates, motive: threshold });
    this._lastProactiveDecision = decision;

    if (!gates.allowed || !threshold.ok || !selection.selected) {
      return { sent: false, reason: decision };
    }

    // 生成（短消息 + 接地校验，防编造）
    const settings = this.readAISettings();
    if (!settings?.apiKey) return { sent: false, reason: '未配置 API Key，无法生成主动消息' };
    let text = '';
    try {
      const raw = await generateAIResponse(
        settings,
        '你是一个有自己生活的女朋友，正在主动发一条很短的消息。只输出消息正文。',
        buildProactivePrompt({
          motive: selection.selected,
          moodDescription: describeMood(state.internal?.mood, Date.now()),
          minutesSinceLast: Number.isFinite(idleMinutes) ? idleMinutes : undefined,
          relationshipStageLabel: this._relationshipState?.stage,
          recentUserTexts: [],
        }),
        false,
        0.85,
      );
      text = sanitizeProactiveMessage(typeof raw === 'string' ? raw : '') ?? '';
    } catch (e) {
      return { sent: false, reason: `生成失败：${(e as Error).message}` };
    }
    if (!text) return { sent: false, reason: '生成的主动消息被清洗规则拦下（万能问候/过长/空）' };

    const grounding = checkMemoryGrounding(text, buildGroundingCorpus({
      memories: episodicStore.episodes.slice(0, 20).flatMap(e => [e.eventSummary, e.narrativeFragment]),
      conversation: [],
      extra: [selection.selected.content],
    }));
    if (!grounding.ok) {
      text = stripUngroundedClaims(text, grounding.violations);
      console.warn(`[Proactive] 主动消息含未接地引用，已处理：${grounding.violations.map(v => v.reason).join(' | ')}`);
    }

    // 入队 + 记账（配额、习惯化）
    this._proactivePending.push({
      id: `proactive_${Date.now()}`,
      text,
      createdAt: new Date().toISOString(),
      motiveKind: selection.selected.kind,
    });
    rhythmController.recordProactiveSent(new Date());
    state.internal = {
      ...(state.internal ?? { satiation: {} }),
      motive: markMotiveAttempted(selection.nextState, selection.selected.id),
    };
    void saveEmotionStateAsync(state);
    console.log(`[Proactive] (${trigger}) 发出：${text}`);
    return { sent: true, reason: decision, text };
  }

  private startProactiveLoop(): void {
    if (process.env.DISABLE_PROACTIVE_LOOP === 'true') {
      console.log('[Proactive] 主动消息循环已按环境变量禁用');
      return;
    }
    if (this._proactiveLoop) return;
    // 每 5 分钟评估一次；真正的"要不要发"由动机紧迫度 + 配额 + 时间窗共同决定
    this._proactiveLoop = setInterval(() => {
      void this.runProactiveTick('scheduler').catch(() => { /* 主动消息失败不影响主流程 */ });
    }, 5 * 60_000);
    console.log('[Proactive] 动机驱动主动消息循环已启动（每 5 分钟评估一次）');
  }

  private setupRoutes() {
    // ── v1.12 主动消息（动机驱动）──
    // 前端轮询取走待投递消息（取走即清空，避免重复显示）
    this.app.get('/api/proactive/pending', (req, res) => {
      const messages = this._proactivePending;
      this._proactivePending = [];
      res.json({
        messages,
        lastDecision: this._lastProactiveDecision,
        quota: rhythmController.getProactiveQuota(),
      });
    });
    // 手动触发一次评估（调试/测试用；不改配额，除非真的发出）
    // 可选 body：{ persona?: {...}, idleMinutes?: number } —— 仅用于在没有真实 persona 的情况下验证闸门
    this.app.post('/api/proactive/tick', async (req, res) => {
      try {
        const overrides = req.body ?? {};
        if (overrides.persona && typeof overrides.persona === 'object') {
          this._lastPersona = { ...(this._lastPersona ?? {}), ...overrides.persona };
        }
        const result = await this.runProactiveTick(
          'manual',
          typeof overrides.idleMinutes === 'number' ? overrides.idleMinutes : undefined,
        );
        res.json({ ...result, lastDecision: this._lastProactiveDecision });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Test endpoint
    this.app.get('/api/test', (req, res) => {
      res.json({ message: 'AI Girlfriend Server is running' });
    });

    // ── v5.0 认知事件流 API ──
    this.app.get('/api/events', (req, res) => {
      const n = Math.min(parseInt(req.query.n as string) || 200, 1000);
      res.json(serverEventLog.slice(-n));
    });

    // ── Sprint E: 认知观测台 API ──
    this.app.get('/api/cognitive/observatory', (req, res) => {
      const windowMin = Math.min(parseInt(req.query.window as string) || 30, 1440);
      res.json({
        funnel: getFunnelSnapshot(),
        recommendations: getFunnelRecommendations(),
        eventCoverage: bus.getEventCoverage(),
        chainStats: bus.getQuickStats(),
        cognitiveObservatory: bus.getCognitiveObservatory({ kind: 'minutes', value: windowMin }),
        timestamp: Date.now(),
      });
    });

    // AI chat endpoint — accepts client-provided persona/systemPrompt for consistency
    this.app.post('/api/chat', async (req, res) => {
      const releaseChatLock = await this.acquireChatLock();
      try {
        const parsedRequest = parseChatRequest(req.body);
        if (parsedRequest.ok === false) {
          res.status(400).json({ error: parsedRequest.error });
          return;
        }
        const { message, userId, persona, settings, recentMessages, recentMemories, chatSummary } = parsedRequest.value;
        // v1.12 主动消息需要 persona 的主动设置（服务端没有 persona 存储 → 记住最近一次的）
        if (persona && typeof persona === 'object') this._lastPersona = persona;

        const serverSettings = this.readAISettings();
        const effectiveSettings = settings?.apiKey
          ? settings
          : serverSettings
            ? {
                ...serverSettings,
                temperature: settings?.temperature ?? serverSettings.temperature,
                enableWebSearch: settings?.enableWebSearch ?? (serverSettings as any).enableWebSearch,
              }
            : settings;

        // 情感事件来源三态：
        //  - persona.dynamicEmotion === false : 用户主动关闭动态情感 → 无事件（情感/记忆均停）
        //  - DISABLE_LLM_NLU === 'true'        : 调试/省 API → 仍用本地规则事件，
        //    情感照常更新、记忆照常形成（修复: 此前 event=null 导致记忆长期停摆）
        //  - 默认                            : LLM 情感分析（失败/无 key 时自动回落本地）
        const emotionAnalysisPromise = persona?.dynamicEmotion === false
          ? Promise.resolve({ event: null, userAnalysis: analyzeUserEmotionLocally(message), source: 'disabled' as const })
          : process.env.DISABLE_LLM_NLU === 'true'
            ? Promise.resolve((() => {
                const userAnalysis = analyzeUserEmotionLocally(message);
                return { event: fallbackEmotionEvent(message, userAnalysis), userAnalysis, source: 'disabled' as const };
              })())
            : analyzeEmotionEvent(message, effectiveSettings as any);
        // ponytail: 短问候跳过 embedding（≤3字符或纯标点），省 API 调用
        const skipEmbedding = message.length < 4 || /^[\s!?！？.。，,、~-]+$/.test(message);
        const queryEmbeddingPromise: Promise<number[] | undefined> = (effectiveSettings?.apiKey && !skipEmbedding)
          ? Promise.race([
              generateEmbeddings(effectiveSettings, message),
              new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 2000)),
            ]).catch(() => undefined)
          : Promise.resolve(undefined);

        // 开始认知链
        const corrId = `corr_srv_${crypto.randomUUID()}`;
        const msgEventId = serverEmit('UserMessageReceived', { messageLength: message.length }, { correlationId: corrId, source: 'user' });

        // ── Phase 2: 策略层装填 —— 调用 aiCoordinator 获取情绪加权模式 ──
        const currentEmotionState = this.aiEngine.emotionState;
        // ponytail: 确保 reinforcement 存在，extractEmotionContext 需要
        if (currentEmotionState && !currentEmotionState.reinforcement) {
          currentEmotionState.reinforcement = {
            greedDrive: 0.5,
            fearAvoidance: 0.5,
            rewardTally: 0,
            punishmentTally: 0,
          };
        }
        const emotionAnalysis = await emotionAnalysisPromise;

        // ── v1.9 接线修复：此前只传 4 个字段，导致"已实现"的能力线上空转 ──
        //   · lastInteractionAt → 协调器 idleMins 恒为 0 → 孤独/重逢通路永不触发
        //   · activeValues      → dialogueStrategy 的 S7 价值观调制永不成立
        //   · roundNumber       → 退回进程内计数器（重启归零）→ 20/50 轮门控被拉长
        const previousInteractionAt = getLastInteractionAt();
        const currentEvolution = currentEmotionState?.evolution;
        const persistedRound = Number.isFinite(currentEvolution?.totalInteractions)
          ? currentEvolution!.totalInteractions
          : 0;
        const activeValueMap = currentEvolution?.valuePriorities ?? {};
        const turnOutput = aiCoordinator.processTurn({
          userText: message,
          currentEmotionState,
          emotionEvent: emotionAnalysis.event,
          userAnalysis: emotionAnalysis.userAnalysis,
          userId: userId || 'anonymous',
          lastInteractionAt: previousInteractionAt ?? undefined,
          roundNumber: persistedRound,
          activeValues: Object.keys(activeValueMap).length > 0 ? { ...activeValueMap } : undefined,
        });

        // 构建情绪模式注入文本
        const dominantEmotion = turnOutput.updatedEmotionState
          ? getDominantEmotion(turnOutput.updatedEmotionState.emotions).name
          : 'neutral';
        const relationshipPolicy = getRelationshipResponsePolicy(this._relationshipState);
        const patternInjection = buildPatternInjection(
          turnOutput.strategy,
          turnOutput.relevantPatterns ?? [],
          dominantEmotion,
          {
            enabled: relationshipPolicy.allowPatternInjection
              && process.env.ENABLE_PATTERN_INJECTION !== 'false',
            drives: currentEmotionState?.reinforcement
              ? {
                  greedDrive: currentEmotionState.reinforcement.greedDrive,
                  fearAvoidance: currentEmotionState.reinforcement.fearAvoidance,
                }
              : undefined,
            currentEmotions: currentEmotionState?.emotions,
          },
        );

        // ── 主动回忆：根据当前情境决定是否自然提起过去的记忆 ──
        const currentDominant = turnOutput.updatedEmotionState
          ? getDominantEmotion(turnOutput.updatedEmotionState.emotions)
          : { name: 'neutral', intensity: 0.3 };
        const proactiveDecision = decideProactiveRecall(
          episodicStore,
          currentDominant,
          turnOutput.strategy,
          relationshipPolicy.allowProactiveMemory
            && process.env.ENABLE_PROACTIVE_MEMORY !== 'false',
        );
        // v1.2 记忆治理闸门：仅 supported/verified（或无账目记录的旧记忆）允许被主动提起
        if (proactiveDecision.memory && !isProactivelyRecallable('episodic', proactiveDecision.memory.id, memoryLedger)) {
          proactiveDecision.memory = null;
          proactiveDecision.approach = null;
          proactiveDecision.injectionText = null;
        }
        // v1.6 可见性门控：关系阶段不够的记忆绝不主动提起（零泄漏在检索阶段）
        if (proactiveDecision.memory) {
          const vis = visibleAtStage(
            {
              text: `${proactiveDecision.memory.eventSummary ?? ''} ${proactiveDecision.memory.narrativeFragment ?? ''}`,
              tags: proactiveDecision.memory.tags,
              valenceDeltaAbs: Math.abs(proactiveDecision.memory.emotionalImpact?.valenceDelta ?? 0),
              arousalPeak: proactiveDecision.memory.emotionalImpact?.arousalPeak,
            },
            this._relationshipState.stage,
          );
          if (!vis.visible) {
            console.log('[Visibility] 主动回忆被阶段门控拦截:', vis.reason);
            proactiveDecision.memory = null;
            proactiveDecision.approach = null;
            proactiveDecision.injectionText = null;
          }
        }
        const memoryInjection = buildProactiveMemoryInjection(
          proactiveDecision,
          relationshipPolicy.allowProactiveMemory
            && process.env.ENABLE_PROACTIVE_MEMORY !== 'false',
        );

        // ── Phase 3: 统一记忆召回（4 源 + 嵌入搜索）──
        // 生成查询嵌入（用于语义匹配，2 秒超时不阻塞）
        const queryEmbedding = await queryEmbeddingPromise;

        const recallResult = recall(episodicStore, {
          text: message,
          emotionState: turnOutput.updatedEmotionState,
          maxResults: 8,
          sourceCaps: {
            episodic: relationshipPolicy.personalMemoryCap,
            semantic: relationshipPolicy.personalMemoryCap,
            pattern: relationshipPolicy.allowPatternInjection ? 1 : 0,
          },
          semanticMemories: semanticMemoryPool,
          // Phase 3: 接入 curiosity 发现和 pattern 候选（2 个之前是死代码的源）
          curiosityDiscoveries: turnOutput.pendingDiscoveries,
          patternCandidates: turnOutput.patternCandidates?.map(p => ({
            topic: p.topic,
            relatedTopics: p.neighbors,
            cooccurrence: p.connectedness,
          })),
          // Phase 3: 查询嵌入启用语义搜索
          queryEmbedding: queryEmbedding?.length ? queryEmbedding : undefined,
        });
        const relationshipSafeMemories = filterRelationshipMemoryItems(
          recallResult.items,
          this._relationshipState,
          message,
        );
        // v1.6 可见性门控：按关系阶段过滤召回结果（阶段不够的记忆连上下文都不注入）
        const visibilitySafeMemories = relationshipSafeMemories.filter((item) => {
          const tags = (item.metadata as any)?.tags;
          return visibleAtStage(
            { text: item.content, tags: Array.isArray(tags) ? tags : undefined },
            this._relationshipState.stage,
          ).visible;
        });
        const recallInjection = visibilitySafeMemories.length > 0
          ? `\n【相关记忆】${visibilitySafeMemories.map(i => `- ${i.content.slice(0, 80)}`).join('\n')}`
          : '';

        // ponytail: 跨源去重 — 如果召回记忆和主动注入记忆内容高度重叠，只保留一份
        const dedupedRecallInjection = memoryInjection && recallInjection
          ? (() => {
              const injectedContents = new Set(
                memoryInjection.split('\n').filter(l => l.startsWith('-')).map(l => l.slice(2, 30))
              );
              const deduped = visibilitySafeMemories.filter(m =>
                ![...injectedContents].some(ic => m.content.includes(ic) || ic.includes(m.content.slice(0, 30)))
              );
              return deduped.length > 0
                ? `\n【相关记忆】${deduped.map(i => `- ${i.content.slice(0, 80)}`).join('\n')}`
                : '';
            })()
          : recallInjection;

        // ── v1.9 动机竞选：先决定"她此刻想说什么"，再让她说 ──
        // 没有具体动机时明确允许安静陪伴 —— 泛问（"今天怎么样"）的根因是缺素材，不是缺禁令。
        const motiveSelection = (() => {
          const nowMs = Date.now();
          // ① v1.10 L1 反馈学习：先用"上一轮她说的那件事"是否被接住，更新各类型权重
          const prevMotive = currentEmotionState?.internal?.motive;
          if (prevMotive?.lastSelectedContent && prevMotive.lastSelectedKind
              && (nowMs - (prevMotive.lastSelectedAt ?? 0)) < 6 * 3600_000) {
            const outcome = classifyMotiveOutcome(prevMotive.lastSelectedContent, message);
            setMotiveLearning(learnFromOutcome(getMotiveLearning(), prevMotive.lastSelectedKind, outcome, nowMs));
            saveMotiveLearning();
            console.log(`[Motive] 反馈：上一轮「${prevMotive.lastSelectedKind}」→ ${outcome}`);
          }
          const historyUserTexts = (recentMessages ?? [])
            .filter((m: any) => m.role === 'user' && typeof m.content === 'string')
            .slice(-6)
            .map((m: any) => m.content as string);
          const poolState = resolveOpenLoops(
            prevMotive ?? { pool: [] },
            message,
            nowMs,
          );
          const candidates: MotiveCandidate[] = [];
          // ① 未完待续：他说过但没落定的事（当前消息用"刚说"措辞，历史回溯用"之前提到"）
          const loopSources: Array<{ text: string; current: boolean }> = [
            { text: message, current: true },
            ...[...historyUserTexts].reverse().map(text => ({ text, current: false })),
          ];
          for (const src of loopSources) {
            const hit = extractOpenLoops(src.text, 1)[0];
            if (hit) {
              candidates.push({ kind: 'open_loop', content: openLoopMotiveContent(hit, src.current) });
            }
          }
          // ② 记忆回响：主动回忆闸门选中的旧事（已有 approach/injectionText，此前只当记忆注入用）
          if (proactiveDecision.memory && proactiveDecision.injectionText) {
            const echo = memoryEchoMotive(proactiveDecision.injectionText, proactiveDecision.memory.id);
            if (echo) candidates.push(echo);
          }
          // ③ 价值观立场：她最珍视的价值（刚接通的 evolution.valuePriorities）
          const valueEntries = Object.entries(turnOutput.updatedEmotionState?.evolution?.valuePriorities ?? {})
            .sort((a, b) => b[1] - a[1]);
          const topValue = valueEntries[0];
          if (topValue && topValue[1] >= 0.6) {
            const stance = valueStanceMotive(topValue[0]);
            if (stance) candidates.push({ kind: 'stance', content: stance, source: { valueId: topValue[0] } });
          }
          // ④ 内在状态：底色心情明显偏离中性 → 她今天的状态本身就是想说的事
          const moodNow = turnOutput.updatedEmotionState?.internal?.mood;
          if (moodNow && moodNow.samples > 0) {
            const stateMotive = moodStateMotive(moodNow.valence);
            if (stateMotive) candidates.push({ kind: 'state', content: stateMotive });
          }
          return selectMotive({
            state: poolState,
            candidates: candidates.filter(c => c.content),
            userText: message,
            emotionState: turnOutput.updatedEmotionState,
            userIntensity: emotionAnalysis.userAnalysis?.intensity ?? 0,
            learning: getMotiveLearning(),
            now: nowMs,
          });
        })();

        // 组合：人格底座 → 主动回忆 → 统一召回 → 客户端基础 Prompt → 策略片段 → 情绪模式注入
        // ponytail: strategySnippet 放最后，LLM 对末尾权重更高
        // v1.9: 自我叙事（随经历更新）排在人格底座之后——"她是谁"要先于"这轮说什么"
        const identitySnippet = (() => {
          const cached = getIdentityNarrative();
          if (!cached || typeof cached.summary !== 'string') return '';
          try {
            return narrativeToPromptSnippet(cached as unknown as Parameters<typeof narrativeToPromptSnippet>[0]);
          } catch { return ''; }
        })();
        let enrichedSystemPrompt = [
          PERSONALITY_FOUNDATION,
          identitySnippet,
          memoryInjection,
          dedupedRecallInjection,
          persona?.systemPrompt ?? '',
          patternInjection,
          relationshipPolicy.prompt,
          turnOutput.strategySnippet,
        ].filter(Boolean).join('\n');

        // ponytail: 幻觉自检 — 模型在生成回复前自查编造行为
        enrichedSystemPrompt += '\n\n【回复前自检】输出前确认：①是否编造了具体的生活细节（逛街/做饭/追剧等）？②是否说了"上次你提到…"但记忆中没有？③是否替别人的错误道歉？如有任何一项，删除重写。';

        // v1.6 反机械化表达：压制"今天过得怎么样"这类万能问候，并禁止重复最近用过的开场
        enrichedSystemPrompt += '\n\n【表达要求·反机械化】\n' + [
          '① 禁止用万能问候开场或收尾（"今天过得怎么样""最近怎么样""在干嘛""忙不忙""有什么想聊的"等）——这类句子空洞且每轮一样。',
          '② 优先具体：记忆或上下文里有细节就直接切入那个细节（"你昨天说的面试后来有消息吗"优于泛泛问候）。',
          '③ 开场方式每轮都要变：直接回应对方 / 说出你的感受 / 提起一件具体的事 / 一句玩笑 / 安静陪伴——不要连续两轮用同一类开场。',
          '④ 连续两轮不要都以问句结尾；不要连珠炮式提问。',
          '⑤ 没有具体素材时，宁可不问，也要说一句当下真实的话，而不是用空洞寒暄填充。',
        ].join('\n');
        const recentAssistantHeads = (recentMessages ?? [])
          .filter((m: any) => m.role === 'assistant' && typeof m.content === 'string')
          .slice(-3)
          .map((m: any) => m.content.replace(/\s+/g, '').slice(0, 12))
          .filter(Boolean);
        if (recentAssistantHeads.length > 0) {
          enrichedSystemPrompt += `\n\n【避免重复】你最近几轮用过这些开场：${recentAssistantHeads.map((h: string) => `「${h}…」`).join('、')}。本轮必须换一种开场方式，也不要用相同句式收尾。`;
        }

        // v1.9 动机层放 Prompt 末尾（注意力最高处）：先给她"想说什么"，禁令只是兜底
        enrichedSystemPrompt += `\n\n${motiveToPromptSnippet(motiveSelection.selected)}`;

        // v1.8 内在生活：底色心情 + 反刍提示（只在确有信号时注入，避免每轮同一句话）
        {
          const internalState = turnOutput.updatedEmotionState?.internal;
          const nowMs = Date.now();
          const moodHint = moodPromptHint(internalState?.mood, nowMs);
          if (moodHint) enrichedSystemPrompt += `\n\n${moodHint}`;
          const ruminationHint = ruminationPromptHint(internalState?.rumination, nowMs);
          if (ruminationHint) enrichedSystemPrompt += `\n\n${ruminationHint}`;
        }

        // ── Phase 2: 网络搜索注入 ──
        // 检测事实性问题 → 搜索 → 注入上下文（3 秒超时，不影响回复速度）
        if (isFactualQuestion(message)) {
          try {
            const searchResult = await Promise.race([
              searchForLLM(message, 0),
              new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
            ]);
            if (searchResult && searchResult.results.length > 0) {
              enrichedSystemPrompt += '\n\n【实时搜索】' + searchResult.llmContext;
              console.log(`[Search] 已注入 ${searchResult.results.length} 条搜索结果到 Prompt`);
            }
          } catch (e) {
            // 搜索失败不影响主流程
            console.log('[Search] 搜索超时或失败，跳过注入');
          }
        }

        const result = await this.aiEngine.generateResponse(message, userId, {
          clientSystemPrompt: enrichedSystemPrompt,
          clientSettings: effectiveSettings,
          persona,
          emotionState: turnOutput.updatedEmotionState,
          recentMessages,
        });

        // ── v1.11 记忆接地校验：断言型记忆引用必须能在她的知识里落地 ──
        // 实测问题：她会说"你上次说面试前紧张得没睡好"，而记忆里根本没有（编造）。
        // 处理顺序：检测 → 有违规则带"可引用事实清单"重写一次 → 仍违规则整句删除（确定性兜底）。
        let aiText = result.text;
        {
          const groundingCorpus = buildGroundingCorpus({
            memories: [
              ...recallResult.items.map((i: any) => String(i.content ?? '')),
              ...(turnOutput.memoryContext ?? []).map((m: any) => String(m.content ?? '')),
              ...(proactiveDecision.memory
                ? [proactiveDecision.memory.eventSummary, proactiveDecision.memory.narrativeFragment]
                : []),
              // 长期情景记忆：她有印象但本轮未被召回的，也算"她知道"
              ...episodicStore.episodes.slice(0, 30).flatMap(e => [e.eventSummary, e.narrativeFragment]),
            ],
            conversation: (recentMessages ?? [])
              .filter((m: any) => typeof m.content === 'string')
              .map((m: any) => m.content as string),
            extra: [
              message,
              identitySnippet,
              motiveSelection.selected?.content ?? '',
              proactiveDecision.injectionText ?? '',
            ],
          });
          const allowedFacts = [
            ...recallResult.items.map((i: any) => String(i.content ?? '')).filter(Boolean).slice(0, 5),
            ...(proactiveDecision.memory?.narrativeFragment ? [proactiveDecision.memory.narrativeFragment] : []),
          ];
          const check = checkMemoryGrounding(aiText, groundingCorpus);
          if (!check.ok) {
            console.warn(`[Grounding] 检测到 ${check.violations.length} 处未接地引用：${check.violations.map(v => v.reason).join(' | ')}`);
            try {
              const retry = await generateAIResponse(
                effectiveSettings!,
                enrichedSystemPrompt + '\n\n' + buildRewriteInstruction(check.violations, allowedFacts),
                message,
                false,
                0.7,
              );
              const retryText = (typeof retry === 'string' ? retry : '').trim();
              if (retryText) {
                const recheck = checkMemoryGrounding(retryText, groundingCorpus);
                if (recheck.ok) {
                  aiText = retryText;
                  console.log('[Grounding] 重写后已接地');
                } else {
                  aiText = stripUngroundedClaims(retryText, recheck.violations);
                  console.warn('[Grounding] 重写仍不接地 → 已删除相关整句');
                }
              } else {
                aiText = stripUngroundedClaims(aiText, check.violations);
              }
            } catch (e) {
              // 重写失败不阻塞：确定性删除兜底
              aiText = stripUngroundedClaims(aiText, check.violations);
              console.warn('[Grounding] 重写调用失败，已用整句删除兜底');
            }
          }
        }

        const relationshipTurn = processSuccessfulRelationshipTurn(this._relationshipState, {
          userText: message,
          aiText,
          userAnalysis: emotionAnalysis.userAnalysis,
          strategy: turnOutput.strategy,
        });

        // 记录情感更新
        if (emotionAnalysis.event) {
          serverEmit('EmotionUpdated', { deltaA: emotionAnalysis.event.deltaA, deltaB: emotionAnalysis.event.deltaB, deltaR: emotionAnalysis.event.deltaR }, { correlationId: corrId, causedBy: msgEventId, source: 'emotion' });
        }

        // v1.0: capture episodic memory server-side
        if (emotionAnalysis.event) {
          const emoState = turnOutput.updatedEmotionState;
          const chatContext = recentMessages
            ? recentMessages.slice(-5).map((m: any) => m.content).join(' | ')
            : message;
          const newEpisode = tryFormEpisode(episodicStore, emoState, message, chatContext);
          // v1.14 情景记忆 → 图谱：此前 createNodeFromEpisode 零生产调用，
          // 导致新记忆只有 episodic 存储、图谱 BFS 召回看不到它（孤儿记忆）
          if (newEpisode) {
            try {
              memoryGraph.addNode(createNodeFromEpisode(newEpisode));
            } catch (e) {
              console.warn('[MemoryGraph] 情景节点写入失败（不影响主流程）:', (e as Error).message);
            }
          }
          // v1.2 记忆治理：候选自动评级 → 账本（supported/ambiguous），供人工 review 与主动回忆闸门
          if (newEpisode) {
            const assessment = assessEpisodeCandidate({
              recallWeight: newEpisode.recallWeight,
              tagCount: newEpisode.tags.length,
              messageLength: message.length,
              valenceDeltaAbs: Math.abs(newEpisode.emotionalImpact?.valenceDelta ?? 0),
              beliefRevision: Boolean(newEpisode.beliefRevision),
              anchorType: newEpisode.selfPatternTriggered ?? null,
            });
            memoryLedger.recordFromDecision(
              { refType: 'episodic', refId: newEpisode.id, surfaceText: newEpisode.eventSummary },
              assessment.decision,
              { coverage: assessment.input.coverage },
            );
            void saveMemoryLedgerAsync();
          }
          // 异步生成向量嵌入（不影响响应速度）
          if (newEpisode && effectiveSettings?.apiKey) {
            const embedText = `${newEpisode.narrativeFragment} ${newEpisode.tags.join(' ')}`;
            generateEmbeddings(effectiveSettings, embedText).then(emb => {
              if (emb?.length) {
                newEpisode.embedding = emb;
                void saveEpisodicStoreAsync();
              }
            }).catch(() => {});
          }
        }

        this._tick++;
        const authoritativeEmotionState = turnOutput.updatedEmotionState;
        this.aiEngine.emotionState = authoritativeEmotionState;
        this._relationshipState = relationshipTurn.state;

        // ── v1.9 A-0b: 价值发现定期浮现（此前只在从未被前端调用的 /api/identity 里跑）──
        // surfaceValues 会写 evolution.valuePriorities，S7 策略调制与【核心价值观】注入才有数据。
        {
          const evo = authoritativeEmotionState.evolution;
          const round = Number.isFinite(evo?.totalInteractions) ? evo.totalInteractions : 0;
          const emptyPriorities = Object.keys(evo?.valuePriorities ?? {}).length === 0;
          const due = round > 0 && round % 10 === 0 && round !== this._lastValueSurfaceRound;
          const bootstrap = emptyPriorities && !this._valueBootstrapDone && episodicStore.episodes.length > 0;
          if (due || bootstrap) {
            this._lastValueSurfaceRound = round;
            this._valueBootstrapDone = true;
            try {
              const { surfaced, conflicts } = surfaceValues(valueSystem, episodicStore, evo, round);
              if (surfaced.length > 0 || conflicts.length > 0) {
                console.log(`[Value] 第 ${round} 轮浮现价值: ${surfaced.join(', ')}${conflicts.length ? ` | 冲突: ${conflicts.join('; ')}` : ''}`);
              }
              saveValueSystem();
            } catch (e) { console.warn('[Value] 价值浮现失败（不影响主流程）:', e); }
          }
        }

        // ── v1.9 A-1: 身份叙事回流（此前 shouldRefreshNarrative 导入后从未调用）──
        // 生成"她随经历更新的自我描述"→ 缓存 + 落盘 + 下一轮注入 Prompt。
        {
          const evo = authoritativeEmotionState.evolution;
          const round = Number.isFinite(evo?.totalInteractions) ? evo.totalInteractions : 0;
          if (evo && shouldRefreshNarrative(evo, round, 20)) {
            try {
              const narrative = generateIdentityNarrative(
                episodicStore, evo, valueSystem, authoritativeEmotionState, round,
              );
              setIdentityNarrative(narrative as unknown as Record<string, unknown>);
              evo.lastIdentityRefresh = round;
              saveIdentityNarrative();
              console.log(`[Identity] 第 ${round} 轮刷新自我叙事：${narrative.summary.slice(0, 60)}…`);
            } catch (e) { console.warn('[Identity] 身份叙事刷新失败（不影响主流程）:', e); }
          }
        }

        // v1.9 记录本轮的互动时间（下一轮的孤独/重逢通路依赖它；重启后仍有效）
        markInteraction(Date.now());
        saveSessionState();

        // v1.13 潜意识状态落盘（仅在有新证据/新激活时；协调器只做标记，io 在这里）
        if (aiCoordinator.shadowStateDirty) {
          aiCoordinator.shadowStateDirty = false;
          saveShadowState();
          saveRewardStats(); // 策略统计同步落盘（潜意识「策略证据」跨重启可累积）
        }

        // v1.9 动机层回写：选中的动机记为"已提起"（习惯化 → 同一件事不会反复追问）
        {
          const motiveState = motiveSelection.nextState;
          authoritativeEmotionState.internal = {
            satiation: authoritativeEmotionState.internal?.satiation ?? {},
            ...(authoritativeEmotionState.internal?.mood ? { mood: authoritativeEmotionState.internal.mood } : {}),
            ...(authoritativeEmotionState.internal?.rumination ? { rumination: authoritativeEmotionState.internal.rumination } : {}),
            motive: motiveSelection.selected
              ? markMotiveAttempted(motiveState, motiveSelection.selected.id)
              : motiveState,
          };

          // ── v1.10 第 2 层：把模板念头具体化（LLM，异步，不阻塞回复）──
          // 写入 pendingCandidates，下一轮由竞选合并进池；失败一律丢弃、不污染状态。
          const round = Number.isFinite(authoritativeEmotionState.evolution?.totalInteractions)
            ? authoritativeEmotionState.evolution.totalInteractions
            : 0;
          const poolSize = authoritativeEmotionState.internal.motive?.pool.length ?? 0;
          if (effectiveSettings?.apiKey
              && effectiveSettings.dynamicEmotion !== false
              && shouldSpecificize(round, poolSize, this._lastSpecificizeRound)) {
            this._lastSpecificizeRound = round;
            const ctx = {
              recentUserTexts: (recentMessages ?? [])
                .filter((m: any) => m.role === 'user' && typeof m.content === 'string')
                .slice(-5)
                .map((m: any) => m.content as string)
                .concat([message]),
              moodDescription: describeMood(authoritativeEmotionState.internal?.mood, Date.now()),
              topValue: Object.entries(authoritativeEmotionState.evolution?.valuePriorities ?? {})
                .sort((a, b) => b[1] - a[1])[0]?.[0],
              templateThoughts: turnOutput.newThoughts?.slice(0, 4) ?? [],
              knownTopics: (authoritativeEmotionState.internal.motive?.pool ?? [])
                .filter(m => m.kind === 'open_loop')
                .map(m => (m.content.match(/「([^」]{1,12})」/) ?? [])[1])
                .filter((t): t is string => Boolean(t)),
            };
            void generateAIResponse(
              effectiveSettings,
              '你是角色内心独白生成器。只输出 JSON，不要解释。',
              buildSpecificizePrompt(ctx),
              true,
              0.8,
            ).then(raw => {
              const specific = parseSpecificMotives(raw, Date.now());
              if (specific.length === 0) return;
              // 写回 pendingCandidates：与最新状态合并（期间可能已发生新的选择）
              const latest = this.aiEngine.emotionState?.internal?.motive;
              const base = latest ?? authoritativeEmotionState.internal!.motive!;
              const mergedState = {
                ...base,
                pendingCandidates: [...(base.pendingCandidates ?? []), ...specific].slice(0, 6),
              };
              if (this.aiEngine.emotionState?.internal) {
                this.aiEngine.emotionState.internal.motive = mergedState;
                void saveEmotionStateAsync(this.aiEngine.emotionState);
              }
              console.log(`[Motive] 具体化 ${specific.length} 条：${specific.map(s => `${s.kind}/${s.content.slice(0, 18)}`).join(' | ')}`);
            }).catch(() => { /* 生成失败不影响主流程 */ });
          }
        }

        await Promise.all([
          saveEmotionStateAsync(authoritativeEmotionState),
          emotionAnalysis.event ? saveEpisodicStoreAsync() : Promise.resolve(),
          saveRelationshipStateAsync(this._relationshipState),
        ]);

        // v1.3 记忆增强：周期遗忘曲线 + 相似合并去重（≥6h 一次；启动后首轮即执行）
        if (Date.now() - this._lastConsolidationAt > 6 * 60 * 60 * 1000) {
          this._lastConsolidationAt = Date.now();
          const consolidation = runConsolidation(episodicStore, memoryLedger);
          // v1.3 对象库收敛：episodic 归档/移除 → 图谱视图节点同步归档（副本不漂移）
          const activeEpisodeIds = new Set(episodicStore.episodes.filter(e => !e.archived).map(e => e.id));
          const graphSync = syncEpisodicArchivedNodes(memoryGraph, activeEpisodeIds);
          if (consolidation.decayedCount > 0 || consolidation.mergedPairs > 0 || graphSync.synced > 0) {
            console.log(
              `[MemoryEnhancer] 整合完成: 遗忘 ${consolidation.decayedCount} 条 · 合并 ${consolidation.mergedPairs} 对 · 归档 ${consolidation.archivedCount} 条 · 图谱同步 ${graphSync.synced} 节点`,
            );
            saveMemoryGraph();
            await Promise.all([saveEpisodicStoreAsync(), saveMemoryLedgerAsync()]);
          }
        }
        if (userId) {
          try {
            await firebaseService.saveUserData(userId, { emotionState: authoritativeEmotionState });
          } catch (error) {
            console.error('Failed to save authoritative emotion state:', error);
          }
        }
        const affinityScore = relationshipTurn.score;
        console.log('[DEBUG] strategy:', turnOutput.strategy, 'conflictPhase:', turnOutput.conflictState.phase);
        res.json({
          // v1.11: 必须返回接地校验后的文本（此前返回 result.text，导致重写结果被丢弃）
          response: aiText,
          emotionEvent: emotionAnalysis.event,
          emotionAnalysis: {
            source: emotionAnalysis.source,
            user: emotionAnalysis.userAnalysis,
          },
          emotionState: authoritativeEmotionState,
          strategy: turnOutput.strategy,
          strategyReason: turnOutput.strategyDecision.reason,
          relevantPatterns: turnOutput.relevantPatterns ?? [],
          memoryContext: turnOutput.memoryContext ?? [],
          rhythmDecision: turnOutput.rhythmDecision,
          conflictPhase: turnOutput.conflictState.phase,
          relationship: {
            stage: relationshipTurn.state.stage,
            boundaryStatus: relationshipTurn.state.boundaryStatus,
            candidate: relationshipTurn.state.candidate,
            report: relationshipTurn.report,
            acceptedEvents: relationshipTurn.events.map(event => ({
              category: event.category,
              actor: event.actor,
              strength: event.strength,
            })),
          },
          _affinity: { score: affinityScore, tick: this._tick },
        });
      } catch (error) {
        console.error('[Chat] Error:', error);
        const status = error instanceof AIRequestError ? 502 : 500;
        res.status(status).json({
          error: error instanceof AIRequestError ? error.message : 'Internal server error',
        });
      } finally {
        releaseChatLock();
      }
    });

    // Small diagnostic endpoint for inspecting the emotion analyzer in isolation.
    // Configuration endpoint
    this.app.post('/api/config', async (req, res) => {
      try {
        const { userId, config } = req.body;
        if (typeof userId !== 'string' || !userId || userId.length > 200 || !config || typeof config !== 'object' || Array.isArray(config)) {
          res.status(400).json({ error: 'userId and config are required' });
          return;
        }

        // Save config to Firestore
        const success = await firebaseService.saveUserData(userId, { config });

        if (success) {
          // Update AI engine config
          this.aiEngine.setConfig(config);

          // Update channel configs
          this.messageChannels.forEach(channel => channel.setConfig(config.channels?.[channel.id]));

          res.json({ success: true, message: '配置已保存' });
        } else {
          res.status(500).json({ error: 'Failed to save config' });
        }
      } catch (error) {
        console.error('[Config] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // IoT control endpoint
    // ── v1.0 Identity API ──
    this.app.get('/api/memories', (req, res) => {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 200);
      const episodes = getSignificantEpisodes(episodicStore, limit);
      res.json({
        episodes: episodes.map(e => ({
          id: e.id,
          timestamp: e.timestamp,
          roundNumber: e.roundNumber,
          eventSummary: e.eventSummary,
          emotionalImpact: e.emotionalImpact,
          narrativeFragment: e.narrativeFragment,
          recallWeight: e.recallWeight,
          tags: e.tags,
          recallCount: e.recallCount,
          // v1.2 治理状态：null = 治理上线前的旧记忆（默认放行）
          governanceStatus: memoryLedger.getByRef('episodic', e.id)?.status ?? null,
        })),
        total: episodicStore.episodes.length,
      });
    });

    // ── v1.3 记忆治理：人工核实热同步（Obsidian review 无需重启 server）──
    this.app.post('/api/memories/governance', async (req, res) => {
      try {
        const { refId, refType, status, actor, reason } = req.body ?? {};
        if (typeof refId !== 'string' || !refId || refId.length > 200) {
          res.status(400).json({ error: 'refId is required' });
          return;
        }
        const refTypeVal = typeof refType === 'string' && refType.trim() ? refType.trim().slice(0, 50) : 'episodic';
        const allowed = ['verified', 'rejected', 'rolled_back', 'supported', 'ambiguous'] as const;
        if (typeof status !== 'string' || !(allowed as readonly string[]).includes(status)) {
          res.status(400).json({ error: `status must be one of ${allowed.join('|')}` });
          return;
        }
        const reviewer = typeof actor === 'string' && actor.startsWith('reviewer:') && actor.length <= 100
          ? actor
          : 'reviewer:http';
        const entry = memoryLedger.getByRef(refTypeVal, refId);
        if (!entry) {
          res.status(404).json({ error: 'no ledger candidate for this memory (先让对话形成记忆并评级)' });
          return;
        }
        const transition = memoryLedger.applyReview(
          entry.candidateId,
          status as 'verified' | 'rejected' | 'rolled_back' | 'supported' | 'ambiguous',
          reviewer,
          typeof reason === 'string' ? reason.slice(0, 300) : 'http_review',
        );
        void saveMemoryLedgerAsync();
        res.json({
          ok: true,
          from: transition.from,
          status: transition.to,
          actor: reviewer,
          auditVersion: memoryLedger.serialize().history.length,
        });
      } catch (error: any) {
        console.error('[Governance] Review error:', error?.message ?? error);
        res.status(400).json({ error: error?.message ?? 'invalid review transition' });
      }
    });

    this.app.get('/api/personality', (req, res) => {
      const evo = this.aiEngine['emotionState']?.evolution || {};
      res.json({
        empathy: (evo as any).empathy ?? 50,
        trust: (evo as any).trust ?? 50,
        openness: (evo as any).openness ?? 50,
        playfulness: (evo as any).playfulness ?? 50,
        sensitivity: (evo as any).sensitivity ?? 0.5,
        resilience: (evo as any).resilience ?? 0.1,
        optimism: (evo as any).optimism ?? 50,
        totalInteractions: (evo as any).totalInteractions ?? 0,
        positiveInteractions: (evo as any).positiveInteractions ?? 0,
        negativeInteractions: (evo as any).negativeInteractions ?? 0,
      });
    });

    this.app.get('/api/values', (req, res) => {
      res.json({
        values: valueSystem.values.map(v => ({
          id: v.id,
          statement: v.statement,
          confidence: v.confidence,
          status: v.status,
          supportingCount: v.supportingMemories.length,
          conflictingCount: v.conflictingMemories.length,
        })),
        dominantValue: valueSystem.dominantValue,
        valueConflict: valueSystem.valueConflict,
      });
    });

    this.app.get('/api/identity', (req, res) => {
      const emotionState = this.aiEngine['emotionState'];
      const evolution = emotionState?.evolution;
      if (!evolution) {
        res.json({ summary: '情感引擎尚未初始化', keyMemories: [], personalitySnapshot: {}, coreValues: [] });
        return;
      }
      const currentRound = (evolution as any).totalInteractions ?? 0;
      // v1.9: 主聊天管道已定期刷新并缓存叙事 → 这里优先返回缓存（一致且免重复计算）
      const cached = getIdentityNarrative();
      if (cached && typeof cached.summary === 'string') {
        res.json(cached);
        return;
      }
      surfaceValues(valueSystem, episodicStore, evolution as any, currentRound);
      const narrative = generateIdentityNarrative(
        episodicStore, evolution as any, valueSystem, emotionState!, currentRound,
      );
      saveEpisodicStore();
      saveValueSystem();
      res.json(narrativeToApiResponse(narrative));
    });

    // ── State endpoint (frontend startup) ──
    this.app.get('/state', (req, res) => {
      const es = this.aiEngine.emotionState;
      const t = es?.taiji;
      const emotions = es?.emotions ?? {};
      const dominant = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0];
      res.json({
        valence: t?.valence ?? 0,
        arousal: t?.arousal ?? 0,
        expectation: t?.expectation ?? 0,
        emotions,
        affinityScore: this.computeAffinityScore(),
        relationshipStage: this._relationshipState.stage,
        relationshipBoundaryStatus: this._relationshipState.boundaryStatus,
        relationshipCandidate: this._relationshipState.candidate,
        approachBias: es?.yinyang?.approachBias ?? 0,
        avoidBias: es?.yinyang?.avoidBias ?? 0,
        dominant: dominant?.[0] ?? 'neutral',
        intensity: dominant?.[1] ?? 0,
        apologyCredit: 1,
        recentTraumaCount: 0,
        tick: this._tick,
        extremityDuration: 0,
        lastExtremitySign: 0,
        internalNarrative: es ? describeReinforcementState(es) : '',
        rewardStats: rewardLearner.getAllStats(),
        // v1.13 潜意识层可观测：活跃特质与聚合调制（此前 498 行实现完全不可见）
        shadow: (() => {
          const mod = shadowLayer.getEmotionModulation();
          const traits = shadowLayer.getActiveTraits();
          const allTraits = shadowLayer.getState().traits;
          return {
            activeTraits: traits.map(t => ({
              id: t.id, label: t.label, confidence: Math.round(t.confidence * 100) / 100,
            })),
            // 未激活但正在累积的特质也暴露出来（否则看不出它在慢慢长）
            accumulating: allTraits
              .filter(t => !t.active && t.confidence > 0)
              .map(t => ({
                id: t.id, label: t.label,
                confidence: Math.round(t.confidence * 1000) / 1000,
                evidenceCount: t.evidence.length,
              }))
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, 5),
            modulation: {
              valenceBias: Math.round(mod.valenceBias * 1000) / 1000,
              arousalBias: Math.round(mod.arousalBias * 1000) / 1000,
              stickyEmotions: mod.stickyEmotions,
            },
            lastDetectionRound: shadowLayer.getState().stats.lastDetectionRound,
            totalDetections: shadowLayer.getState().stats.totalDetections,
          };
        })(),
        // v1.12 主动消息可观测
        proactive: {
          lastDecision: this._lastProactiveDecision,
          pending: this._proactivePending.length,
          quota: rhythmController.getProactiveQuota(),
        },
        // v1.8 内在生活可观测：底色心情 / 反刍链 / 涌现诊断（内在驱动占比·自相关·是否卡死）
        mood: es?.internal?.mood
          ? {
              description: describeMood(es.internal.mood, Date.now()),
              valence: es.internal.mood.valence,
              arousal: es.internal.mood.arousal,
              samples: es.internal.mood.samples,
              updatedAt: es.internal.mood.updatedAt,
            }
          : null,
        rumination: {
          description: describeRumination(es?.internal?.rumination, Date.now()),
          emotion: es?.internal?.rumination?.emotion ?? null,
          streak: es?.internal?.rumination?.streak ?? 0,
        },
        // v1.9 动机层可观测：她此刻心里挂着的事（本轮说话的来源）
        motive: (() => {
          const m = es?.internal?.motive;
          if (!m) return null;
          const last = m.pool.find(x => x.id === m.lastSelectedId) ?? null;
          return {
            description: m.lastSelection?.reason ?? describeMotive(last, false),
            thisTurn: m.lastSelection
              ? {
                  kind: m.lastSelection.selectedKind ?? null,
                  deferred: m.lastSelection.deferred,
                  reason: m.lastSelection.reason,
                  at: m.lastSelection.at,
                }
              : null,
            lastSelected: last ? { kind: last.kind, content: last.content, attempts: last.attempts } : null,
            poolSize: m.pool.length,
            pool: m.pool.slice(0, 5).map(x => ({
              kind: x.kind, content: x.content, attempts: x.attempts,
            })),
            // v1.10 L1 反馈学习：各开口方式的回应率与权重（可随时删除 motive_learning.json 回到中性）
            learning: summarizeMotiveLearning(getMotiveLearning()),
          };
        })(),
        emergence: aiCoordinator.getEmergenceReport(),
      });
    });

    // ── AI config auto-detect (frontend startup) ──
    this.app.get('/api/ai-config', (req, res) => {
      const ai = this.readAISettings();
      res.json({
        success: true,
        serverConfigured: Boolean(ai?.apiKey),
        provider: ai?.provider || 'deepseek',
        apiKey: '',
        model: ai?.model || 'deepseek-chat',
        baseUrl: ai?.baseUrl || 'https://api.deepseek.com/v1',
        temperature: ai?.temperature || 0.7,
      });
    });

    this.app.post('/api/ai-test', async (req, res) => {
      try {
        const { settings } = req.body || {};
        const serverSettings = this.readAISettings();
        const effectiveSettings = settings?.apiKey
          ? settings
          : serverSettings
            ? {
                ...serverSettings,
                temperature: settings?.temperature ?? serverSettings.temperature,
                enableWebSearch: settings?.enableWebSearch ?? (serverSettings as any).enableWebSearch,
              }
            : settings;

        if (!effectiveSettings?.apiKey) {
          res.status(400).json({ success: false, error: 'API Key is required' });
          return;
        }

        await generateAIResponse(
          effectiveSettings,
          'You are a connection test. Reply with ok.',
          'hi',
          false,
          0
        );
        res.json({ success: true });
      } catch (error: any) {
        console.error('[AI Test] Error:', error);
        res.status(502).json({ success: false, error: error?.message || 'AI test failed' });
      }
    });

    // ── TTS endpoint ──
    this.app.post('/api/tts', async (req, res) => {
      const parsedRequest = parseTtsRequest(req.body);
      if (parsedRequest.ok === false) {
        res.status(400).json({ error: parsedRequest.error });
        return;
      }
      const { text, voice } = parsedRequest.value;
      // v1.4 语气：客户端只传情绪白名单（服务端查表），避免任意参数注入
      const tone = resolveEmotionTone((req.body as any)?.emotion);
      const clean = text.replace(/[（(][^）)]*[）)]/g, '').trim();
      if (!clean) { res.status(400).json({ error: 'empty after cleaning' }); return; }

      // v1.5 本地情感 TTS：provider=cosyvoice 时转发给本地 CosyVoice2 服务；
      // 服务未启动/失败 → 502（前端自动回退浏览器语音，不打断聊天）
      if ((req.body as any)?.provider === 'cosyvoice') {
        try {
          const wav = await synthesizeCosyVoice({
            text: clean,
            emotion: (req.body as any)?.emotion ?? 'neutral',
          });
          res.set({ 'Content-Type': 'audio/wav', 'Content-Length': wav.length.toString() });
          res.send(wav);
        } catch (error: any) {
          const message = error instanceof CosyVoiceUnavailableError
            ? error.message
            : (error?.message || 'cosyvoice synthesis failed');
          console.error('[TTS] cosyvoice 不可用:', message);
          res.status(502).json({ error: message, fallback: 'browser' });
        }
        return;
      }
      try {
        // 修复：spawn 失败时 error 与 close 双回调曾重复 res.json 导致进程崩溃
        let settled = false;
        const failOnce = (msg: string) => {
          if (settled) return;
          settled = true;
          res.status(500).json({ error: msg });
        };
        const child = spawn('edge-tts', [
          '--voice', voice, '--text', clean, '--write-media', '-',
          ...edgeTtsArgs(tone),
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => stderr += d.toString());
        child.on('close', (code: number) => {
          if (code !== 0) {
            console.error('[TTS] edge-tts error:', stderr.slice(0, 200));
            failOnce('TTS failed');
            return;
          }
          if (settled) return;
          settled = true;
          const audio = Buffer.concat(chunks);
          res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length.toString() });
          res.send(audio);
        });
        child.on('error', (err: Error) => {
          console.error('[TTS] spawn error:', err.message);
          failOnce('TTS spawn failed');
        });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'TTS error' });
      }
    });

    // ── Vision endpoint ──
    this.app.post('/api/vision', async (req, res) => {
      const parsedRequest = parseVisionRequest(req.body);
      if (parsedRequest.ok === false) {
        res.status(400).json({ error: parsedRequest.error });
        return;
      }
      const { imageBase64, mimeType, mode } = parsedRequest.value;
      if (Date.now() - this._visionCooldown < 5000) {
        res.json({ description: this._lastVision?.text || '', emotion: this._lastVision?.emotion || '', cached: true });
        return;
      }
      this._visionCooldown = Date.now();
      try {
        const settings = this.readAISettings();
        const { generateAIChatResponse } = await import('../src/lib/aiProvider.js');
        const prompt = mode === 'emotion'
          ? `分析画面中人物的表情和情绪状态。返回 JSON: {"expression":"表情","emotion":"情绪(开心/难过/专注/疲惫/平静/兴奋等)","confidence":0.0-1.0}。只返回JSON。`
          : `用中文描述画面（20字以内）：人物在做什么、表情、状态。如果画面中有多个人或特别的环境特征，也提一下。`;
        const result = await generateAIChatResponse(
          { provider: (settings?.provider || 'deepseek') as 'gemini' | 'openai' | 'custom', apiKey: settings?.apiKey || '', model: settings?.model || 'deepseek-chat', baseUrl: settings?.baseUrl, temperature: 0.2 },
          mode === 'emotion' ? '只返回 JSON，不要其他文字。' : '用一句话描述，不要评价。',
          [{ role: 'user', content: prompt, imageUrl: `data:${mimeType};base64,${imageBase64}` }],
        );
        const raw = result?.text?.trim() || '';
        let desc = raw, emotion = '';
        if (mode === 'emotion') {
          try {
            const j = JSON.parse(raw.replace(/```json|```/g, ''));
            emotion = j.emotion || j.expression || '未知';
            desc = `${j.expression || ''}，${j.emotion || ''}`;
          } catch { emotion = raw.slice(0, 20); desc = raw.slice(0, 40); }
        }
        this._lastVision = { text: desc, emotion, ts: Date.now() };
        res.json({ description: desc, emotion });
      } catch (err: any) {
        res.status(500).json({ error: err?.message || 'vision failed' });
      }
    });

    this.app.use('/api', (req, res) => {
      res.status(404).json({ error: 'API endpoint not found' });
    });

    // Static files for web interface (Vite build output)
    this.app.use(express.static(path.join(__dirname, '../dist')));

    // Fallback to index.html for SPA routing
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
  }

  private computeAffinityScore(): number {
    return relationshipScoreV2(this._relationshipState);
  }

  private readAISettings() {
    if (this._serverAISettingsLoaded) return this._serverAISettings;
    this._serverAISettingsLoaded = true;
    try {
      const dotenv = fs.readFileSync('.env', 'utf-8');
      const geminiKey = dotenv.match(/^GEMINI_API_KEY="?(.+?)"?$/m)?.[1];
      const openaiKey = dotenv.match(/^OPENAI_API_KEY="?(.+?)"?$/m)?.[1];
      const deepseekKey = dotenv.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
      if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
        this._serverAISettings = { provider: 'gemini', apiKey: geminiKey, model: 'gemini-3-flash-preview', temperature: 0.4 };
      } else if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
        this._serverAISettings = { provider: 'openai', apiKey: openaiKey, model: 'gpt-4-turbo', temperature: 0.4 };
      } else if (deepseekKey && deepseekKey !== 'your_deepseek_api_key_here') {
        this._serverAISettings = { provider: 'deepseek', apiKey: deepseekKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 };
      }
    } catch {}
    return this._serverAISettings;
  }

  private async acquireChatLock(): Promise<() => void> {
    const previous = this._chatQueue;
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this._chatQueue = previous.then(() => current);
    await previous;
    return release;
  }

  private registerDefaultServices() {
    // The legacy channel bypasses the transactional local chat pipeline, so it
    // stays disabled unless explicitly requested for compatibility testing.
    if (process.env.ENABLE_LEGACY_WECHAT === 'true') {
      const wechatChannel = new WeChatOfficialAccountChannel();
      this.messageChannels.push(wechatChannel);
      wechatChannel.registerRoutes(this.app, this.aiEngine);
    }

    console.log(`Registered ${this.messageChannels.length} message channels`);
  }

  async start(port: number = 3000) {
    try {
      // Initialize MCP server
      await mcpService.initialize();

      // v1.12 动机驱动主动消息循环（ENABLE/DISABLE 由环境变量 + persona.proactive 共同控制）
      this.startProactiveLoop();

      // Phase 2 PR 2: 周期性保存好奇心状态（每 30 秒）
      const curiositySaveTimer = setInterval(() => {
        saveCuriosityState();
      }, 30_000);

      // ponytail: 每日衰减策略统计 — 防止过拟合到早期交互模式
      let lastDecayDate = new Date().toDateString();
      setInterval(() => {
        const today = new Date().toDateString();
        if (today !== lastDecayDate) {
          lastDecayDate = today;
          rewardLearner.applyDailyDecay();
        }
      }, 3_600_000); // 每小时检查一次

      // Phase 2 PR 2: 优雅关闭时保存好奇心状态
      const gracefulShutdown = () => {
        console.log('[Phase2] 优雅关闭：保存好奇心状态...');
        clearInterval(curiositySaveTimer);
        saveCuriosityState();
        saveEpisodicStore();
        saveValueSystem();
        process.exit(0);
      };
      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);

      // ponytail: process.env.HOST is often set by build systems (e.g. Conda) to
      // platform triples like "x86_64-conda-linux-gnu", not a network hostname.
      // Use BIND_HOST to avoid collision.
      const host = process.env.BIND_HOST || '127.0.0.1';
      this.server.listen(port, host, () => {        console.log(`Server started on http://${host}:${port}`);
        console.log(`Health check: http://localhost:${port}/health`);
        console.log(`Test endpoint: http://localhost:${port}/api/test`);
        console.log(`Web interface: http://localhost:${port}`);
      });

      return this.server;
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop() {
    await mcpService.shutdown();
    if (this.server) {
      this.server.close();
      console.log('Server stopped');
    }
  }
}

// Export for programmatic usage
export default AIGirlfriendServer;
