import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryGraph } from '../../../src/lib/memoryGraph.js';
import type { EpisodicMemory, EpisodicMemoryStore } from '../../../src/lib/episodicMemory.js';
import { deleteEpisode, updateEpisode, exportMemories, viewEpisode, scrubBackups } from '../memoryAdmin.js';

let dir = '';

function ep(id: string, summary = '他说面试又挂了'): EpisodicMemory {
  return {
    id,
    timestamp: 1_700_000_000_000,
    roundNumber: 3,
    eventSummary: summary,
    emotionalImpact: {
      valenceBefore: 0.1,
      valenceAfter: -0.4,
      valenceDelta: -0.5,
      arousalPeak: 0.3,
      dominantEmotion: 'sad',
    },
    narrativeFragment: '心里跟着沉了一下',
    recallWeight: 0.8,
    tags: ['面试'],
    recallCount: 1,
    lastRecalledAt: null,
    embedding: [0.1, 0.2],
  } as unknown as EpisodicMemory;
}

function storeOf(...eps: EpisodicMemory[]): EpisodicMemoryStore {
  return { episodes: eps, roundCounter: 5, prevDominantEmotion: 'calm', prevValence: 0.1, prevArousal: 0.2 };
}

function graphWith(epId: string): MemoryGraph {
  const g = new MemoryGraph();
  g.addNode({
    source: 'episodic', content: '他说面试又挂了', tags: ['面试'],
    emotionalSignature: { primary: 'sad', valence: -0.4, arousal: 0.3 } as never,
    weight: 0.8, decayRate: 0.01, sourceId: epId,
  });
  return g;
}

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mem-admin-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

describe('记忆闭环（v2.00）：删除 / 纠错 / 导出', () => {
  it('删除：从 episodic 移除并同步删掉图谱节点（不留幽灵）', () => {
    const store = storeOf(ep('e1'), ep('e2', '他说今晚不回来吃饭'));
    const g = graphWith('e1');
    g.addNode({
      source: 'episodic', content: '他说今晚不回来吃饭', tags: ['晚饭'],
      emotionalSignature: { primary: 'calm', valence: 0, arousal: 0.1 } as never,
      weight: 0.5, decayRate: 0.01, sourceId: 'e2',
    });
    const r = deleteEpisode(store, g, 'e1', { dir });
    expect(r.ok).toBe(true);
    expect(r.removedEpisode).toBe(true);
    expect(r.removedGraphNodes).toBe(1);
    expect(store.episodes.map(e => e.id)).toEqual(['e2']);
    expect(g.getAllNodes().filter(n => n.sourceId === 'e1')).toHaveLength(0);
    // 另一条不受影响
    expect(g.getAllNodes().filter(n => n.sourceId === 'e2')).toHaveLength(1);
  });

  it('删除：不存在 → ok=false(not_found)，审计仍记录一次尝试', () => {
    const store = storeOf(ep('e1'));
    const g = new MemoryGraph();
    const r = deleteEpisode(store, g, 'nope', { dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_found');
    const audit = readFileSync(join(dir, 'memory_admin_audit.jsonl'), 'utf8').trim().split('\n');
    expect(audit.length).toBe(1);
    expect(JSON.parse(audit[0]).op).toBe('delete');
  });

  it('删除 + purgeBackups：.bak 里的同一条也被清掉', () => {
    const store = storeOf(ep('e1'));
    const g = graphWith('e1');
    const bakPath = join(dir, 'episodic_memory.json.bak');
    writeFileSync(bakPath, JSON.stringify({ episodes: [ep('e1'), ep('e2', '另一条')] }, null, 2), 'utf8');
    const r = deleteEpisode(store, g, 'e1', { backupDir: dir, purgeBackups: true, dir });
    expect(r.ok).toBe(true);
    expect(r.scrubbedBackups).toBe(1);
    const bak = JSON.parse(readFileSync(bakPath, 'utf8')) as { episodes: EpisodicMemory[] };
    expect(bak.episodes.map(e => e.id)).toEqual(['e2']);
  });

  it('scrubBackups：坏 JSON 不冒险改（跳过）', () => {
    const bad = join(dir, 'episodic_memory.json.bak2');
    writeFileSync(bad, '{ not json', 'utf8');
    expect(scrubBackups(dir, 'e1')).toBe(0);
    expect(readFileSync(bad, 'utf8')).toBe('{ not json');
  });

  it('纠错：只改允许的文本字段与标签，并同步图谱内容', () => {
    const store = storeOf(ep('e1'));
    const g = graphWith('e1');
    const r = updateEpisode(store, g, 'e1', { eventSummary: '他面试通过了', tags: ['面试', '好消息'] }, { dir });
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(['eventSummary', 'tags']);
    expect(store.episodes[0].eventSummary).toBe('他面试通过了');
    const node = g.getAllNodes().find(n => n.sourceId === 'e1')!;
    expect(node.content).toBe('心里跟着沉了一下'); // narrativeFragment 未改时内容仍取它
    // 不允许改 id/时间
    const store2 = storeOf(ep('e1'));
    const r2 = updateEpisode(store2, new MemoryGraph(), 'e1', { eventSummary: 'x'.repeat(600) } as never, { dir });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('no_valid_field');
  });

  it('导出：只含文本类记忆文件，跳过截图与过大文件', () => {
    writeFileSync(join(dir, 'emotion_state.json'), '{"a":1}', 'utf8');
    writeFileSync(join(dir, 'activity_log.jsonl'), '{"t":1}\n', 'utf8');
    writeFileSync(join(dir, 'screen-1.jpg'), 'binary', 'utf8');
    const data = exportMemories(dir);
    expect(data.files.map(f => f.name).sort()).toEqual(['activity_log.jsonl', 'emotion_state.json']);
    expect(data.skipped.some(s => s.name === 'screen-1.jpg')).toBe(true);
    expect(existsSync(join(dir, 'emotion_state.json'))).toBe(true);
  });

  it('查看单条：去掉 embedding 大字段', () => {
    const store = storeOf(ep('e1'));
    const v = viewEpisode(store, 'e1')!;
    expect(v).not.toBeNull();
    expect('embedding' in v).toBe(false);
    expect(v.eventSummary).toBe('他说面试又挂了');
    expect(viewEpisode(store, 'missing')).toBeNull();
  });
});
