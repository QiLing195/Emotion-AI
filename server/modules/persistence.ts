// @ts-nocheck
// 记忆持久化 (从 server.ts L215-274 抽取)

import type { ServerContext } from './context.js';
import fs from 'fs';
import { MEMORY_FILE } from './constants.js';
import { serializeEpisodicStore, deserializeEpisodicStore } from '../../src/lib/episodicMemory.js';
import { serializeValueSystem, deserializeValueSystem } from '../../src/lib/valueDiscovery.js';

export function saveMemory(ctx: ServerContext): void {
    if (ctx._memSaveTimer) clearTimeout(ctx._memSaveTimer);
    ctx._memSaveTimer = setTimeout(() => {
        const data: Record<string, any> = {};
        for (const [key, val] of ctx.semanticMemory) data[key] = val;
        try {
            fs.mkdirSync('./memories', { recursive: true });
            const tmpFile = MEMORY_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tmpFile, MEMORY_FILE);
        } catch (e) {
            console.error('[记忆] 持久化失败:', e);
        }
    }, 500);
}

export function loadMemory(ctx: ServerContext): void {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
            for (const [key, val] of Object.entries(data)) ctx.semanticMemory.set(key, val as any);
            console.log(`[记忆] 已加载 ${ctx.semanticMemory.size} 条语义记忆`);
        }
    } catch (e) {
        console.log('[记忆] 未找到持久化记忆文件，从头开始');
    }

    try {
        const epFile = './memories/episodic_memory.json';
        if (fs.existsSync(epFile)) {
            const epData = JSON.parse(fs.readFileSync(epFile, 'utf-8'));
            if (epData.episodes && epData.episodes.length > 0) {
                const loaded = deserializeEpisodicStore(epData);
                ctx.episodicStore.episodes = loaded.episodes;
                ctx.episodicStore.roundCounter = loaded.roundCounter;
                ctx.episodicStore.prevDominantEmotion = loaded.prevDominantEmotion;
                ctx.episodicStore.prevValence = loaded.prevValence;
                ctx.episodicStore.prevArousal = loaded.prevArousal;
                console.log(`[情景记忆] 已加载 ${ctx.episodicStore.episodes.length} 条情景记忆`);
            }
        }
    } catch (e) {
        console.error('[情景记忆] 加载失败:', (e as Error)?.message || e);
    }

    try {
        const vsFile = './memories/value_system.json';
        if (fs.existsSync(vsFile)) {
            const vsData = JSON.parse(fs.readFileSync(vsFile, 'utf-8'));
            const loaded = deserializeValueSystem(vsData);
            Object.assign(ctx.valueSystem, loaded);
        }
    } catch (e) {}
}
// @ts-nocheck
// 持久化函数组 (从 server.ts 批量抽取)

import type { ServerContext } from './context.js';
import fs from 'fs';
import {
  WORLD_MODEL_FILE, SELF_MODEL_FILE, LAYER4_STATE_FILE,
  HYPOTHESES_FILE, PATTERNS_FILE, LOG_DIR,
} from './constants.js';

export function saveWorldModel(ctx: ServerContext): void {
  try {
    fs.writeFileSync(WORLD_MODEL_FILE, JSON.stringify(ctx.worldModel, null, 2), 'utf-8');
  } catch(e) {}
}

export function loadWorldModel(ctx: ServerContext): void {
  try {
    if (fs.existsSync(WORLD_MODEL_FILE)) {
      const data = JSON.parse(fs.readFileSync(WORLD_MODEL_FILE, 'utf-8')) as any;
      Object.assign(ctx.worldModel, data);
    }
  } catch(e) {}
}

export function saveSelfModel(ctx: ServerContext): void {
  try { fs.writeFileSync(SELF_MODEL_FILE, JSON.stringify(ctx.selfModel, null, 2), 'utf-8'); } catch(e) {}
}

export function loadSelfModel(ctx: ServerContext): void {
  try {
    if (fs.existsSync(SELF_MODEL_FILE)) {
      const data = JSON.parse(fs.readFileSync(SELF_MODEL_FILE, 'utf-8')) as any;
      Object.assign(ctx.selfModel, data);
    }
  } catch(e) {}
}

export function saveLayer4State(ctx: ServerContext): void {
  try {
    fs.mkdirSync('./memories', { recursive: true });
    fs.writeFileSync(LAYER4_STATE_FILE, JSON.stringify({
      curiosityState: ctx.curiosityState,
      tensionRegulator: ctx.tensionRegulator,
    }, null, 2), 'utf-8');
    fs.writeFileSync(HYPOTHESES_FILE, JSON.stringify(ctx.hypotheses, null, 2), 'utf-8');
    fs.writeFileSync(PATTERNS_FILE, JSON.stringify(ctx.worldPatterns, null, 2), 'utf-8');
  } catch(e) {}
}

export function loadLayer4State(ctx: ServerContext): void {
  try {
    if (fs.existsSync(LAYER4_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAYER4_STATE_FILE, 'utf-8'));
      if (data.curiosityState) Object.assign(ctx.curiosityState, data.curiosityState);
      if (data.tensionRegulator) Object.assign(ctx.tensionRegulator, data.tensionRegulator);
    }
    if (fs.existsSync(HYPOTHESES_FILE)) {
      const data = JSON.parse(fs.readFileSync(HYPOTHESES_FILE, 'utf-8'));
      ctx.hypotheses.length = 0;
      ctx.hypotheses.push(...data);
    }
    if (fs.existsSync(PATTERNS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
      ctx.worldPatterns.length = 0;
      ctx.worldPatterns.push(...data);
    }
  } catch(e) {}
}

export function saveAutonomyState(ctx: ServerContext): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LOG_DIR + '/autonomy_state.json', JSON.stringify({
      internalState: ctx.internalState,
      internalLogEntries: ctx.internalLogEntries.slice(-100),
      proactiveMessages: ctx.proactiveMessages.slice(-20),
      proactivePending: ctx.proactivePending,
      _activityTracker: ctx._activityTracker,
      _activeRhythm: ctx._activeRhythm,
    }, null, 2), 'utf-8');
  } catch(e) {}
}

export function loadAutonomyState(ctx: ServerContext): void {
  try {
    const f = LOG_DIR + '/autonomy_state.json';
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf-8'));
      if (data.internalState) Object.assign(ctx.internalState, data.internalState);
      if (data.proactiveMessages) ctx.proactiveMessages.push(...data.proactiveMessages);
      if (data._activityTracker) {
        ctx._activityTracker.length = 0;
        ctx._activityTracker.push(...data._activityTracker);
      }
    }
  } catch(e) {}
}

export function saveEpisodicMemory(ctx: ServerContext): void {
  try {
    const data = serializeEpisodicStore(ctx.episodicStore);
    fs.writeFileSync('./memories/episodic_memory.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch(e) {}
}

export function saveValueSystem(ctx: ServerContext): void {
  try {
    const data = serializeValueSystem(ctx.valueSystem);
    fs.writeFileSync('./memories/value_system.json', JSON.stringify(data, null, 2), 'utf-8');
  } catch(e) {}
}
