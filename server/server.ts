import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import { parseString } from 'xml2js';

// Import services
import { DefaultAIEngine } from './services/aiEngine.js';
import { WeChatOfficialAccountChannel } from './services/channels/wechat.js';
import { MockIoTProvider } from './services/providers/mockIoT.js';
import { mcpService } from './services/mcpService.js';
import { firebaseService } from './services/firebase.js';
import { IAIEngine, IMessageChannel, IIoTProvider } from './services/interfaces.js';

// Phase 2: Strategy layer injection
import { aiCoordinator } from './services/aiCoordinator.js';
import { buildPatternInjection, buildProactiveMemoryInjection, PERSONALITY_FOUNDATION } from '../src/lib/contentInjector.js';
import { getDominantEmotion } from '../src/lib/emotionEngine.js';
import { getFunnelSnapshot, getFunnelRecommendations } from '../src/curiosity/funnel.js';
import { bus } from '../src/eventBus.js';

// Phase 2: Web search integration
import { searchForLLM } from '../src/curiosity/search.js';
import { generateEmbeddings } from '../src/lib/aiProvider.js';

// ── 搜索引擎辅助 ──
const FACTUAL_PATTERNS = [
  /什么/g, /怎么/g, /为什么/g, /如何/g, /是谁/g, /哪个/g,
  /多少/g, /何时/g, /哪里/g, /介绍一下/g, /什么是/g,
  /解释/g, /定义/g, /告诉我/g, /最近.*新闻/g, /最新.*消息/g,
  /\?$/, /？$/,
];

function isFactualQuestion(text: string): boolean {
  if (!text || text.length < 3) return false;
  // 纯情感/问候不过搜索
  const skipPatterns = /^(你好|嗨|哈喽|早|晚安|拜拜|再见|谢谢|爱你|想你|抱抱|亲亲|嗯|哦|好|行|可以|知道了)/;
  if (skipPatterns.test(text.trim())) return false;
  // 匹配事实性问句
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
  loadAll, saveEpisodicStore, saveValueSystem, saveCuriosityState,
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
  private aiEngine: IAIEngine;
  private messageChannels: IMessageChannel[] = [];
  private iotProviders: IIoTProvider[] = [];

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.aiEngine = new DefaultAIEngine();

    this.setupMiddleware();
    this.setupRoutes();
    this.registerDefaultServices();

    // v1.0: load all persistent state
    loadAll();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));

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
      try {
        const { message, userId, persona, settings, recentMessages, recentMemories, chatSummary } = req.body;
        if (!message) {
          res.status(400).json({ error: 'Message is required' });
          return;
        }

        // 开始认知链
        const corrId = `corr_srv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const msgEventId = serverEmit('UserMessageReceived', { messageLength: message.length }, { correlationId: corrId, source: 'user' });

        // ── Phase 2: 策略层装填 —— 调用 aiCoordinator 获取情绪加权模式 ──
        const personaEmotionState = persona?.emotionState;
        const currentEmotionState = personaEmotionState
          || (this.aiEngine as any).emotionState
          || undefined;
        const turnOutput = aiCoordinator.processTurn({
          userText: message,
          currentEmotionState,
          userId: userId || 'anonymous',
        });

        // 构建情绪模式注入文本
        const dominantEmotion = turnOutput.updatedEmotionState
          ? getDominantEmotion(turnOutput.updatedEmotionState.emotions).name
          : 'neutral';
        const patternInjection = buildPatternInjection(
          turnOutput.strategy,
          turnOutput.relevantPatterns ?? [],
          dominantEmotion,
          {
            enabled: process.env.ENABLE_PATTERN_INJECTION !== 'false',
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
          process.env.ENABLE_PROACTIVE_MEMORY !== 'false',
        );
        const memoryInjection = buildProactiveMemoryInjection(
          proactiveDecision,
          process.env.ENABLE_PROACTIVE_MEMORY !== 'false',
        );

        // ── Phase 3: 统一记忆召回（4 源 + 嵌入搜索）──
        // 生成查询嵌入（用于语义匹配，2 秒超时不阻塞）
        let queryEmbedding: number[] | undefined;
        try {
          if (settings?.apiKey) {
            queryEmbedding = await Promise.race([
              generateEmbeddings(settings, message),
              new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 2000)),
            ]);
          }
        } catch { /* 嵌入生成失败不影响主流程 */ }

        const recallResult = recall(episodicStore, {
          text: message,
          emotionState: turnOutput.updatedEmotionState,
          maxResults: 8,
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
        const recallInjection = recallResult.items.length > 0
          ? `\n【相关记忆】${recallResult.items.map(i => `- ${i.content.slice(0, 80)}`).join('\n')}`
          : '';

        // 组合：人格底座 → 主动回忆 → 统一召回 → 客户端基础 Prompt → 策略片段 → 情绪模式注入
        let enrichedSystemPrompt = [
          PERSONALITY_FOUNDATION,
          memoryInjection,
          recallInjection,
          persona?.systemPrompt ?? '',
          turnOutput.strategySnippet,
          patternInjection,
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
          clientSettings: settings,
          persona,
          recentMessages,
        });

        // 记录情感更新
        if (result.emotionEvent) {
          serverEmit('EmotionUpdated', { deltaA: result.emotionEvent.deltaA, deltaB: result.emotionEvent.deltaB, deltaR: result.emotionEvent.deltaR }, { correlationId: corrId, causedBy: msgEventId, source: 'emotion' });
        }

        // v1.0: capture episodic memory server-side
        if (result.emotionEvent && this.aiEngine['emotionState']) {
          const emoState = this.aiEngine['emotionState'];
          const chatContext = recentMessages
            ? recentMessages.slice(-5).map((m: any) => m.content).join(' | ')
            : message;
          tryFormEpisode(episodicStore, emoState, message, chatContext);
          saveEpisodicStore();
        }

        console.log('[DEBUG] strategy:', turnOutput.strategy, 'conflictPhase:', turnOutput.conflictState.phase);
        res.json({
          response: result.text,
          emotionEvent: result.emotionEvent,
          strategy: turnOutput.strategy,
          strategyReason: turnOutput.strategyDecision.reason,
          conflictPhase: turnOutput.conflictState.phase,
        });
      } catch (error) {
        console.error('[Chat] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Configuration endpoint
    this.app.post('/api/config', async (req, res) => {
      try {
        const { userId, config } = req.body;
        if (!userId || !config) {
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

    // Static files for web interface (Vite build output)
    this.app.use(express.static(path.join(__dirname, '../dist')));

    // Fallback to index.html for SPA routing
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
  }

  private registerDefaultServices() {
    // Register WeChat channel
    const wechatChannel = new WeChatOfficialAccountChannel();
    this.messageChannels.push(wechatChannel);
    wechatChannel.registerRoutes(this.app, this.aiEngine);

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

      this.server.listen(port, () => {
        console.log(`Server started on port ${port}`);
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