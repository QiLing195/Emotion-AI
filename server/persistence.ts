// ── v1.0 持久化层 ──
// 从 server.ts 提取：情景记忆 / 价值体系 / 语义记忆 / 好奇心状态的加载与保存

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  EpisodicMemoryStore, createEpisodicMemoryStore,
  serializeEpisodicStore, deserializeEpisodicStore,
} from '../src/lib/episodicMemory.js';
import {
  ValueSystem, createValueSystem,
  serializeValueSystem, deserializeValueSystem,
} from '../src/lib/valueDiscovery.js';
import { MemoryLedger } from '../src/lib/memoryGovernance.js';
import { shadowLayer } from '../src/lib/shadowLayer.js';
import { rewardLearner } from '../src/lib/rewardLearner.js';
import {
  createMotiveLearning, MOTIVE_LEARNING_VERSION, type MotiveLearningState,
} from '../src/lib/motive.js';
import { importCuriosityState, exportCuriosityState } from '../src/curiosity/patterns.js';
import { interestModel } from '../src/curiosity/state.js';
import { memoryGraph } from '../src/lib/memoryGraph.js';
import type { EmotionState } from '../src/lib/emotionEngine.js';
import {
  createRelationshipStateV2,
  evaluateRelationshipEventsV2,
  type RelationshipStateV2,
} from '../src/lib/relationshipProgressionV2.js';

// ── 文件路径 ──
const EPISODIC_MEMORY_FILE = path.join(__dirname, '../memories/episodic_memory.json');
const VALUE_SYSTEM_FILE = path.join(__dirname, '../memories/value_system.json');
const CURIOSITY_STATE_FILE = path.join(__dirname, '../memories/curiosity_state.json');
const SEMANTIC_MEMORY_FILE = path.join(__dirname, '../memories/semantic_memory.json');
const SEMANTIC_EMBEDDINGS_FILE = path.join(__dirname, '../memories/semantic_embeddings.json');
const MEMORY_GRAPH_FILE = path.join(__dirname, '../memories/memory_graph.json');
const EMOTION_STATE_FILE = path.join(__dirname, '../memories/emotion_state.json');
const RELATIONSHIP_STATE_FILE = path.join(__dirname, '../memories/relationship_state_v2.json');
const MEMORY_LEDGER_FILE = path.join(__dirname, '../memories/memory_ledger.json');
/** v1.9 会话状态：上一轮互动时间（孤独/重逢通路依赖它，重启后仍有效） */
const SESSION_STATE_FILE = path.join(__dirname, '../memories/session_state.json');
/** v1.9 身份叙事缓存：随经历刷新，供 Prompt 注入与 /api/identity 复用 */
const IDENTITY_NARRATIVE_FILE = path.join(__dirname, '../memories/identity_narrative.json');
/** v1.10 动机反馈学习账本（L1：只学权重，可随时删除回到中性） */
const MOTIVE_LEARNING_FILE = path.join(__dirname, '../memories/motive_learning.json');
/** v1.13 潜意识层状态（traits 置信度与证据；此前只在内存，重启清零） */
const SHADOW_STATE_FILE = path.join(__dirname, '../memories/shadow_state.json');
/** v1.13 策略学习统计（潜意识「策略证据」与策略学习都依赖它，此前重启清零） */
const REWARD_STATS_FILE = path.join(__dirname, '../memories/reward_stats.json');

// ── 运行时状态 ──
export let episodicStore: EpisodicMemoryStore = createEpisodicMemoryStore();
export let valueSystem: ValueSystem = createValueSystem();
export let semanticMemoryPool: Array<{ id: string; content: string; type: string; createdAt: string; embedding?: number[] }> = [];
/** v1.2 记忆治理账本：候选状态机（proposed→supported→verified/rolled_back）+ 审计 */
export let memoryLedger: MemoryLedger = new MemoryLedger();
/** v1.9 上一轮互动时间戳（ms）；null = 未知（不产生孤独事件） */
export let lastInteractionAt: number | null = null;
/** v1.9 身份叙事缓存（IdentityNarrative 的结构化 JSON） */
export let identityNarrative: Record<string, unknown> | null = null;
/** v1.10 动机反馈学习账本 */
export let motiveLearning: MotiveLearningState = createMotiveLearning();

// ════════════════════════════════════════════════════════════
// 加载
// ════════════════════════════════════════════════════════════

export function loadEpisodicStore(): void {
  try {
    if (fs.existsSync(EPISODIC_MEMORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(EPISODIC_MEMORY_FILE, 'utf-8'));
      episodicStore = deserializeEpisodicStore(data);
      console.log(`[Persistence] 已加载 ${episodicStore.episodes.length} 条情景记忆`);
    }
  } catch (e) { console.log('[Persistence] 未找到情景记忆文件，从头开始'); }
}

export function loadSemanticMemory(): void {
  try {
    if (fs.existsSync(SEMANTIC_MEMORY_FILE)) {
      // ponytail: 加载预计算的 embedding 缓存，激活 cosine 语义搜索路径
      let embeddingCache: Record<string, number[]> = {};
      if (fs.existsSync(SEMANTIC_EMBEDDINGS_FILE)) {
        embeddingCache = JSON.parse(fs.readFileSync(SEMANTIC_EMBEDDINGS_FILE, 'utf-8'));
      }
      const raw = JSON.parse(fs.readFileSync(SEMANTIC_MEMORY_FILE, 'utf-8'));
      semanticMemoryPool = Object.entries(raw).map(([phrase, meta]: [string, any]) => ({
        id: `sem_${phrase.slice(0, 20)}`,
        content: phrase,
        type: meta.totalValence > 0.5 ? 'positive' : meta.totalValence < -0.3 ? 'negative' : 'neutral',
        createdAt: new Date(meta.lastSeen).toISOString(),
        embedding: embeddingCache[phrase] ?? undefined,
      }));
      const withEmb = semanticMemoryPool.filter(m => m.embedding?.length).length;
      console.log(`[Persistence] 已加载 ${semanticMemoryPool.length} 条语义记忆 (${withEmb} 含 embedding)`);
    }
  } catch (e) { console.log('[Persistence] 语义记忆加载失败，使用空池'); }
}

export function loadValueSystem(): void {
  try {
    if (fs.existsSync(VALUE_SYSTEM_FILE)) {
      const data = JSON.parse(fs.readFileSync(VALUE_SYSTEM_FILE, 'utf-8'));
      valueSystem = deserializeValueSystem(data);
      console.log('[Persistence] 已加载价值体系');
    }
  } catch (e) { console.log('[Persistence] 未找到价值体系文件，从头开始'); }
}

export function loadCuriosityState(): void {
  try {
    if (fs.existsSync(CURIOSITY_STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CURIOSITY_STATE_FILE, 'utf-8'));
      if (raw.interestModel) {
        interestModel.interests = raw.interestModel.interests || [];
        interestModel.lastExploration = raw.interestModel.lastExploration || 0;
        interestModel.lastDecayDay = raw.interestModel.lastDecayDay || '';
      }
      importCuriosityState({
        mentions: raw.mentions || {},
        cooccur: raw.cooccur || {},
        emotionalSignatures: raw.emotionalSignatures || {},
        emotionalCounts: raw.emotionalCounts || {},
        explorationCountToday: raw.explorationCountToday,
        explorationDayKey: raw.explorationDayKey,
      });
      console.log(`[Persistence] 已加载好奇心状态: ${interestModel.interests.length}个兴趣`);
    } else {
      console.log('[Persistence] 未找到好奇心状态文件，从头开始');
    }
  } catch (e) { console.error('[Persistence] 加载好奇心状态失败:', e); }
}

export function loadMemoryGraph(): void {
  try {
    if (fs.existsSync(MEMORY_GRAPH_FILE)) {
      const data = JSON.parse(fs.readFileSync(MEMORY_GRAPH_FILE, 'utf-8'));
      memoryGraph.loadState(data);
      console.log(`[Persistence] 已加载记忆图谱: ${data.nodes?.length ?? 0} 节点, ${data.edges?.length ?? 0} 边`);
    }
  } catch (e) { console.log('[Persistence] 未找到记忆图谱文件，从头开始'); }
}

export function loadEmotionState(): EmotionState | null {
  try {
    if (!fs.existsSync(EMOTION_STATE_FILE)) return null;
    const state = JSON.parse(fs.readFileSync(EMOTION_STATE_FILE, 'utf-8')) as EmotionState;
    if (!state?.taiji || !state?.emotions || !state?.yinyang || !state?.evolution) return null;
    return state;
  } catch (error) {
    console.error('[Persistence] Failed to load emotion state:', error);
    return null;
  }
}

export function loadRelationshipState(): RelationshipStateV2 {
  try {
    if (!fs.existsSync(RELATIONSHIP_STATE_FILE)) return createRelationshipStateV2();
    const state = JSON.parse(fs.readFileSync(RELATIONSHIP_STATE_FILE, 'utf-8')) as RelationshipStateV2;
    if (!state?.stage || !state?.dimensions || !Array.isArray(state.evidence) || !Array.isArray(state.transitions)) {
      return createRelationshipStateV2();
    }
    state.sessionGains ??= {};
    if (state.stage === 'stranger') {
      const validEvidence = state.evidence.filter(event =>
        !(event.actor === 'ai' && event.category === 'remembered_detail')
      );
      if (validEvidence.length !== state.evidence.length) {
        return evaluateRelationshipEventsV2(
          validEvidence,
          createRelationshipStateV2(state.createdAt),
        );
      }
    }
    return state;
  } catch (error) {
    console.error('[Persistence] Failed to load relationship state:', error);
    return createRelationshipStateV2();
  }
}

export function loadMemoryLedger(): void {
  try {
    if (fs.existsSync(MEMORY_LEDGER_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MEMORY_LEDGER_FILE, 'utf-8'));
      memoryLedger = MemoryLedger.from(raw);
      console.log(`[Persistence] 已加载记忆治理账本: ${memoryLedger.serialize().entries.length} 条候选`);
    }
  } catch (e) { console.log('[Persistence] 记忆治理账本加载失败，使用空账本'); }
}

export function loadSessionState(): void {
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_STATE_FILE, 'utf-8'));
      if (typeof data?.lastInteractionAt === 'number' && Number.isFinite(data.lastInteractionAt)) {
        const loadedAt: number = data.lastInteractionAt;
        lastInteractionAt = loadedAt;
        const idleMin = Math.round((Date.now() - loadedAt) / 60_000);
        console.log(`[Persistence] 已加载会话状态：距上次互动 ${idleMin} 分钟`);
      }
    }
  } catch (e) { console.log('[Persistence] 会话状态加载失败，按首次互动处理'); }
}

export function loadIdentityNarrative(): void {
  try {
    if (fs.existsSync(IDENTITY_NARRATIVE_FILE)) {
      const data = JSON.parse(fs.readFileSync(IDENTITY_NARRATIVE_FILE, 'utf-8'));
      if (data && typeof data === 'object' && typeof data.summary === 'string') {
        identityNarrative = data;
        console.log(`[Persistence] 已加载身份叙事（第 ${data.roundNumber ?? '?'} 轮生成）`);
      }
    }
  } catch (e) { console.log('[Persistence] 身份叙事加载失败，将在下轮重新生成'); }
}

export function loadAll(): EmotionState | null {
  loadEpisodicStore();
  loadValueSystem();
  loadSemanticMemory();
  loadCuriosityState();
  loadMemoryGraph();
  loadMemoryLedger();
  loadSessionState();
  loadIdentityNarrative();
  loadMotiveLearning();
  loadShadowState();
  loadRewardStats();
  return loadEmotionState();
}

/** v1.13 载入潜意识层状态（traits 证据与置信度） */
export function loadShadowState(): void {
  try {
    if (fs.existsSync(SHADOW_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SHADOW_STATE_FILE, 'utf-8'));
      if (data && Array.isArray(data.traits)) {
        shadowLayer.loadState(data as unknown as Parameters<typeof shadowLayer.loadState>[0]);
        const active = (data.traits as Array<{ active?: boolean }>).filter(t => t?.active).length;
        console.log(`[Persistence] 已加载潜意识状态：${data.traits.length} 个特质（活跃 ${active}）`);
      }
    }
  } catch (e) { console.log('[Persistence] 潜意识状态加载失败，从零开始'); }
}

export function saveShadowState(): void {
  try {
    const tmp = SHADOW_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(shadowLayer.getState(), null, 2), 'utf-8');
    fs.renameSync(tmp, SHADOW_STATE_FILE);
  } catch (e) { console.error('[Persistence] 保存潜意识状态失败:', e); }
}

/** v1.13 载入策略学习统计（rewardLearner 全局单例） */
export function loadRewardStats(): void {
  try {
    if (!fs.existsSync(REWARD_STATS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(REWARD_STATS_FILE, 'utf-8'));
    if (Array.isArray(data?.stats)) {
      rewardLearner.importStats(data.stats);
      const totalUses = (data.stats as Array<{ attempts?: number }>)
        .reduce((sum, s) => sum + Number(s?.attempts ?? 0), 0);
      console.log(`[Persistence] 已加载策略学习统计：${data.stats.length} 个策略，累计使用 ${totalUses} 次`);
    }
  } catch (e) { console.log('[Persistence] 策略学习统计加载失败，从零开始'); }
}

export function saveRewardStats(): void {
  try {
    const tmp = REWARD_STATS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ stats: rewardLearner.exportStats(), updatedAt: Date.now() }, null, 2), 'utf-8');
    fs.renameSync(tmp, REWARD_STATS_FILE);
  } catch (e) { console.error('[Persistence] 保存策略学习统计失败:', e); }
}

export function loadMotiveLearning(): void {
  try {
    if (fs.existsSync(MOTIVE_LEARNING_FILE)) {
      const data = JSON.parse(fs.readFileSync(MOTIVE_LEARNING_FILE, 'utf-8'));
      if (data && typeof data === 'object' && data.stats && typeof data.stats === 'object') {
        motiveLearning = {
          version: typeof data.version === 'number' ? data.version : MOTIVE_LEARNING_VERSION,
          stats: data.stats as MotiveLearningState['stats'],
          updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
        };
        const kinds = Object.keys(motiveLearning.stats).length;
        console.log(`[Persistence] 已加载动机学习账本：${kinds} 种开口方式有统计`);
      }
    }
  } catch (e) { console.log('[Persistence] 动机学习账本加载失败，回到中性权重'); }
}

/** 记录一次动机结果（内存态；落盘由 saveMotiveLearning 负责） */
export function setMotiveLearning(next: MotiveLearningState): void {
  motiveLearning = next;
}

export function getMotiveLearning(): MotiveLearningState {
  return motiveLearning;
}

export function saveMotiveLearning(): void {
  try {
    const tmp = MOTIVE_LEARNING_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(motiveLearning, null, 2), 'utf-8');
    fs.renameSync(tmp, MOTIVE_LEARNING_FILE);
  } catch (e) { console.error('[Persistence] 保存动机学习账本失败:', e); }
}

/** 记录一次互动（内存态；落盘由 saveSessionState 负责） */
export function markInteraction(at: number = Date.now()): void {
  lastInteractionAt = at;
}

/** 上一轮互动时间戳（null = 未知） */
export function getLastInteractionAt(): number | null {
  return lastInteractionAt;
}

/** 当前缓存的身份叙事（无则 null） */
export function getIdentityNarrative(): Record<string, unknown> | null {
  return identityNarrative;
}

/** 记住新生成的身份叙事 */
export function setIdentityNarrative(narrative: Record<string, unknown> | null): void {
  identityNarrative = narrative;
}

export function saveSessionState(): void {
  try {
    const tmp = SESSION_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ lastInteractionAt, updatedAt: Date.now() }, null, 2), 'utf-8');
    fs.renameSync(tmp, SESSION_STATE_FILE);
  } catch (e) { console.error('[Persistence] 保存会话状态失败:', e); }
}

export function saveIdentityNarrative(): void {
  try {
    if (!identityNarrative) return;
    const tmp = IDENTITY_NARRATIVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(identityNarrative, null, 2), 'utf-8');
    fs.renameSync(tmp, IDENTITY_NARRATIVE_FILE);
  } catch (e) { console.error('[Persistence] 保存身份叙事失败:', e); }
}

// ════════════════════════════════════════════════════════════
// 保存
// ════════════════════════════════════════════════════════════

export function saveEpisodicStore(): void {
  try {
    const tmp = EPISODIC_MEMORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serializeEpisodicStore(episodicStore), null, 2), 'utf-8');
    fs.renameSync(tmp, EPISODIC_MEMORY_FILE);
  } catch (e) { console.error('[Persistence] 保存情景记忆失败:', e); }
}

export function saveValueSystem(): void {
  try {
    const tmp = VALUE_SYSTEM_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serializeValueSystem(valueSystem), null, 2), 'utf-8');
    fs.renameSync(tmp, VALUE_SYSTEM_FILE);
  } catch (e) { console.error('[Persistence] 保存价值体系失败:', e); }
}

export function saveCuriosityState(): void {
  try {
    const snapshot = exportCuriosityState();
    const interests = interestModel.interests;
    const data = {
      ...snapshot,
      interestModel: {
        interests,
        lastExploration: interestModel.lastExploration,
        lastDecayDay: interestModel.lastDecayDay,
      },
    };
    const tmp = CURIOSITY_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, CURIOSITY_STATE_FILE);
  } catch (e) { console.error('[Persistence] 保存好奇心状态失败:', e); }
}

export function saveMemoryGraph(): void {
  try {
    const state = memoryGraph.getState();
    if (state.nodes.length === 0) return; // 空图谱不保存
    const tmp = MEMORY_GRAPH_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, MEMORY_GRAPH_FILE);
  } catch (e) { console.error('[Persistence] 保存记忆图谱失败:', e); }
}

export function saveEmotionState(state: EmotionState): void {
  try {
    const tmp = EMOTION_STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, EMOTION_STATE_FILE);
  } catch (error) {
    console.error('[Persistence] Failed to save emotion state:', error);
  }
}

const asyncWriteQueues = new Map<string, Promise<void>>();

function queueAtomicJsonWrite(file: string, value: unknown): Promise<void> {
  const snapshot = JSON.stringify(value, null, 2);
  const previous = asyncWriteQueues.get(file) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, 'utf-8');
      await fs.promises.rename(tmp, file);
    })
    .catch(error => {
      console.error(`[Persistence] Failed to save ${path.basename(file)}:`, error);
    });
  asyncWriteQueues.set(file, operation);
  void operation.finally(() => {
    if (asyncWriteQueues.get(file) === operation) asyncWriteQueues.delete(file);
  });
  return operation;
}

export function saveEmotionStateAsync(state: EmotionState): Promise<void> {
  return queueAtomicJsonWrite(EMOTION_STATE_FILE, state);
}

export function saveMemoryLedgerAsync(): Promise<void> {
  return queueAtomicJsonWrite(MEMORY_LEDGER_FILE, memoryLedger.serialize());
}

export function saveEpisodicStoreAsync(): Promise<void> {
  return queueAtomicJsonWrite(EPISODIC_MEMORY_FILE, serializeEpisodicStore(episodicStore));
}

export function saveRelationshipStateAsync(state: RelationshipStateV2): Promise<void> {
  return queueAtomicJsonWrite(RELATIONSHIP_STATE_FILE, state);
}
