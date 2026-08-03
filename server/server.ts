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
import { MockIoTProvider } from './services/providers/mockIoT.js';
import { mcpService } from './services/mcpService.js';
import { firebaseService } from './services/firebase.js';
import type { Application } from 'express';

// ponytail: inlined from deleted server/services/interfaces.ts
import type { EmotionEvent } from '../src/lib/emotionEngine.js';

interface IMessageChannel {
  id: string;
  name: string;
  registerRoutes(app: Application, aiEngine: DefaultAIEngine): void;
  setConfig(config: any): void;
}
interface IIoTProvider {
  id: string;
  name: string;
  toggleDevice(deviceId: string, status: 'on' | 'off'): Promise<{ success: boolean; message?: string }>;
}

// Phase 2: Strategy layer injection
import { aiCoordinator } from './services/aiCoordinator.js';
import { analyzeEmotionEvent, analyzeUserEmotionLocally } from './services/emotionAnalyzer.js';
import { buildRelationshipDemoScenarios, runRelationshipDemo } from './services/relationshipDemo.js';
import { analyzeRelationalSpeech } from '../src/lib/relationalSpeechAnalyzer.js';
import {
  filterRelationshipMemoryItems,
  getRelationshipResponsePolicy,
  processSuccessfulRelationshipTurn,
  relationshipScoreV2,
} from './services/relationshipRuntime.js';
import type { RelationshipStateV2 } from '../src/lib/relationshipProgressionV2.js';
import { buildPatternInjection, buildProactiveMemoryInjection, PERSONALITY_FOUNDATION } from '../src/lib/contentInjector.js';
import { getDominantEmotion } from '../src/lib/emotionEngine.js';
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
import { generateIdentityNarrative, shouldRefreshNarrative, narrativeToApiResponse } from '../src/lib/identityNarrative.js';
import {
  episodicStore, valueSystem, semanticMemoryPool,
  loadAll, loadRelationshipState,
  saveEmotionStateAsync,
  saveEpisodicStore, saveEpisodicStoreAsync,
  saveRelationshipStateAsync, saveValueSystem, saveCuriosityState,
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
  private iotProviders: IIoTProvider[] = [];
  private _tick = 0;
  private _relationshipState!: RelationshipStateV2;
  private _chatQueue: Promise<void> = Promise.resolve();
  private _serverAISettingsLoaded = false;
  private _serverAISettings: any = null;
  private _lastVision: { text: string; emotion: string; ts: number } | null = null;
  private _visionCooldown = 0;

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
    this.app.use(['/api/chat', '/api/emotion-demo', '/api/ai-test', '/api/tts', '/api/vision'], (req, res, next) => {
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

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

        // Start independent remote work together to reduce end-to-end latency.
        // DISABLE_LLM_NLU: 跳过 LLM 情感分析，使用本地引擎（砍掉 ~50% API 调用）
        const emotionAnalysisPromise = (persona?.dynamicEmotion === false || process.env.DISABLE_LLM_NLU === 'true')
          ? Promise.resolve({
              event: null,
              userAnalysis: analyzeUserEmotionLocally(message),
              source: 'disabled' as const,
            })
          : analyzeEmotionEvent(message, effectiveSettings as any);
        const queryEmbeddingPromise: Promise<number[] | undefined> = effectiveSettings?.apiKey
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

        const turnOutput = aiCoordinator.processTurn({
          userText: message,
          currentEmotionState,
          emotionEvent: emotionAnalysis.event,
          userAnalysis: emotionAnalysis.userAnalysis,
          userId: userId || 'anonymous',
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
        const recallInjection = relationshipSafeMemories.length > 0
          ? `\n【相关记忆】${relationshipSafeMemories.map(i => `- ${i.content.slice(0, 80)}`).join('\n')}`
          : '';

        // 组合：人格底座 → 主动回忆 → 统一召回 → 客户端基础 Prompt → 策略片段 → 情绪模式注入
        // ponytail: strategySnippet 放最后，LLM 对末尾权重更高
        let enrichedSystemPrompt = [
          PERSONALITY_FOUNDATION,
          memoryInjection,
          recallInjection,
          persona?.systemPrompt ?? '',
          patternInjection,
          relationshipPolicy.prompt,
          turnOutput.strategySnippet,
        ].filter(Boolean).join('\n');

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

        const relationshipTurn = processSuccessfulRelationshipTurn(this._relationshipState, {
          userText: message,
          aiText: result.text,
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
        await Promise.all([
          saveEmotionStateAsync(authoritativeEmotionState),
          emotionAnalysis.event ? saveEpisodicStoreAsync() : Promise.resolve(),
          saveRelationshipStateAsync(this._relationshipState),
        ]);
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
          response: result.text,
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
    this.app.post('/api/emotion-demo', async (req, res) => {
      try {
        const { message, settings } = req.body || {};
        if (typeof message !== 'string' || !message.trim() || message.length > 8_000) {
          res.status(400).json({ error: 'Message is required' });
          return;
        }

        const serverSettings = this.readAISettings();
        const effectiveSettings = settings?.apiKey ? settings : serverSettings;
        const analysis = await analyzeEmotionEvent(message, effectiveSettings as any);
        res.json({
          input: message,
          source: analysis.source,
          userAnalysis: analysis.userAnalysis,
          emotionEvent: analysis.event,
        });
      } catch (error) {
        console.error('[Emotion Demo] Error:', error);
        res.status(500).json({ error: 'Emotion analysis failed' });
      }
    });

    this.app.get('/api/relationship-demo/scenarios', (req, res) => {
      const scenarios = buildRelationshipDemoScenarios();
      res.json({
        scenarios: Object.entries(scenarios).map(([id, scenario]) => ({
          id,
          description: scenario.description,
          eventCount: scenario.events.length,
        })),
      });
    });

    this.app.post('/api/relationship-demo', (req, res) => {
      try {
        const scenarios = buildRelationshipDemoScenarios();
        const scenarioId = typeof req.body?.scenario === 'string' ? req.body.scenario : null;
        const events = scenarioId ? scenarios[scenarioId]?.events : req.body?.events;
        if (!events) {
          res.status(400).json({ error: 'Provide a valid scenario or an events array' });
          return;
        }
        res.json({
          scenario: scenarioId,
          description: scenarioId ? scenarios[scenarioId].description : 'Custom event sequence',
          ...runRelationshipDemo(events),
        });
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Relationship demo failed' });
      }
    });

    this.app.post('/api/relationship-speech-demo', (req, res) => {
      const text = req.body?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > 2_000) {
        res.status(400).json({ error: 'text is required and must not exceed 2000 characters' });
        return;
      }
      const context = req.body?.context && typeof req.body.context === 'object'
        ? req.body.context
        : {};
      res.json({ text, analysis: analyzeRelationalSpeech(text, context) });
    });

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
    this.app.post('/api/iot/control', async (req, res) => {
      try {
        const { providerId, deviceId, action } = req.body;
        if (!providerId || !deviceId || !action) {
          res.status(400).json({ error: 'providerId, deviceId, and action are required' });
          return;
        }

        const provider = this.iotProviders.find(p => p.id === providerId);
        if (!provider) {
          res.status(404).json({ error: 'IoT provider not found' });
          return;
        }

        if (action !== 'on' && action !== 'off') {
          res.status(400).json({ error: 'action must be "on" or "off"' });
          return;
        }

        const result = await provider.toggleDevice(deviceId, action);
        res.json(result);
      } catch (error) {
        console.error('[IoT] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

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
        })),
        total: episodicStore.episodes.length,
      });
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
        internalNarrative: '',
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
      const clean = text.replace(/[（(][^）)]*[）)]/g, '').trim();
      if (!clean) { res.status(400).json({ error: 'empty after cleaning' }); return; }
      try {
        const child = spawn('edge-tts', [
          '--voice', voice, '--text', clean, '--write-media', '-',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        let stderr = '';
        child.stderr.on('data', (d: Buffer) => stderr += d.toString());
        child.on('close', (code: number) => {
          if (code !== 0) {
            console.error('[TTS] edge-tts error:', stderr.slice(0, 200));
            res.status(500).json({ error: 'TTS failed' });
            return;
          }
          const audio = Buffer.concat(chunks);
          res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length.toString() });
          res.send(audio);
        });
        child.on('error', (err: Error) => {
          console.error('[TTS] spawn error:', err.message);
          res.status(500).json({ error: 'TTS spawn failed' });
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

    // Register Mock IoT provider
    const mockIoTProvider = new MockIoTProvider();
    this.iotProviders.push(mockIoTProvider);

    console.log(`Registered ${this.messageChannels.length} message channels`);
    console.log(`Registered ${this.iotProviders.length} IoT providers`);
  }

  async start(port: number = 3000) {
    try {
      // Initialize MCP server
      await mcpService.initialize();

      // Phase 2 PR 2: 周期性保存好奇心状态（每 30 秒）
      const curiositySaveTimer = setInterval(() => {
        saveCuriosityState();
      }, 30_000);

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
      this.server.listen(port, host, () => {
        console.log(`Server started on http://${host}:${port}`);
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
