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
import { importCuriosityState, exportCuriosityState } from '../src/curiosity/patterns.js';
import { interestModel } from '../src/curiosity/state.js';

// ── 文件路径 ──
const EPISODIC_MEMORY_FILE = path.join(__dirname, '../memories/episodic_memory.json');
const VALUE_SYSTEM_FILE = path.join(__dirname, '../memories/value_system.json');
const CURIOSITY_STATE_FILE = path.join(__dirname, '../memories/curiosity_state.json');
const SEMANTIC_MEMORY_FILE = path.join(__dirname, '../memories/semantic_memory.json');

// ── 运行时状态 ──
export let episodicStore: EpisodicMemoryStore = createEpisodicMemoryStore();
export let valueSystem: ValueSystem = createValueSystem();
export let semanticMemoryPool: Array<{ id: string; content: string; type: string; createdAt: string; embedding?: number[] }> = [];

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
      const raw = JSON.parse(fs.readFileSync(SEMANTIC_MEMORY_FILE, 'utf-8'));
      semanticMemoryPool = Object.entries(raw).map(([phrase, meta]: [string, any]) => ({
        id: `sem_${phrase.slice(0, 20)}`,
        content: phrase,
        type: meta.totalValence > 0.5 ? 'positive' : meta.totalValence < -0.3 ? 'negative' : 'neutral',
        createdAt: new Date(meta.lastSeen).toISOString(),
      }));
      console.log(`[Persistence] 已加载 ${semanticMemoryPool.length} 条语义记忆`);
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

export function loadAll(): void {
  loadEpisodicStore();
  loadValueSystem();
  loadSemanticMemory();
  loadCuriosityState();
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
