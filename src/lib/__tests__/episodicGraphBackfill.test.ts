// ── 情景记忆 → 图谱补全 测试（v1.14）──
// 背景：createNodeFromEpisode 早已写好却**零生产调用** → 新记忆只有 episodic 存储、
//       图谱 BFS 召回看不到它们（实测 26 条 episode 只有 19 个 episodic 节点）。
// 必须锁死：①补全能覆盖所有活跃 episode ②幂等（重复执行不产生副本）
//           ③已归档的 episode 不补（不把遗忘的记忆拉回图谱）④字段映射正确

import { describe, it, expect } from 'vitest';
import { MemoryGraph, backfillEpisodicNodes, createNodeFromEpisode } from '../memoryGraph';
import type { EpisodicMemory } from '../episodicMemory';

const T0 = 1_700_000_000_000;

function episode(overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  const id = overrides.id ?? `ep_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    timestamp: T0,
    roundNumber: 10,
    eventSummary: '他提到下周要去面试',
    narrativeFragment: '当他说"我下周要去面试，有点紧张"的时候，我也跟着紧张了一下。',
    tags: ['工作', '紧张'],
    recallWeight: 0.7,
    emotionalImpact: {
      valenceBefore: 0.2,
      valenceAfter: -0.1,
      valenceDelta: -0.3,
      arousalPeak: 0.6,
      dominantEmotion: 'fear',
    },
    ...overrides,
  } as EpisodicMemory;
}

describe('createNodeFromEpisode — 映射契约', () => {
  it('来源/内容/情绪签名/权重/时间戳正确映射', () => {
    const ep = episode();
    const node = createNodeFromEpisode(ep);
    expect(node.source).toBe('episodic');
    expect(node.sourceId).toBe(ep.id);
    expect(node.content).toBe(ep.narrativeFragment);
    expect(node.tags).toEqual(ep.tags);
    expect(node.weight).toBe(ep.recallWeight);
    expect(node.createdAt).toBe(ep.timestamp);
    expect(node.emotionalSignature.valence).toBe(ep.emotionalImpact.valenceAfter);
    expect(node.emotionalSignature.arousal).toBe(ep.emotionalImpact.arousalPeak);
    expect(node.emotionalSignature.dominantEmotion).toBe('fear');
  });

  it('高权重记忆衰减更慢', () => {
    const heavy = createNodeFromEpisode(episode({ recallWeight: 0.9 }));
    const light = createNodeFromEpisode(episode({ recallWeight: 0.1 }));
    expect(heavy.decayRate).toBeLessThan(light.decayRate);
  });
});

describe('backfillEpisodicNodes — 补全', () => {
  it('空图谱 + 3 条活跃记忆 → 新增 3 个节点', () => {
    const graph = new MemoryGraph();
    const report = backfillEpisodicNodes(graph, [episode(), episode(), episode()]);
    expect(report.added).toBe(3);
    expect(report.reused).toBe(0);
    expect(graph.getAllNodes().filter(n => n.source === 'episodic')).toHaveLength(3);
  });

  it('幂等：重复执行不再新增（复用既有节点）', () => {
    const graph = new MemoryGraph();
    const eps = [episode(), episode()];
    const first = backfillEpisodicNodes(graph, eps);
    const second = backfillEpisodicNodes(graph, eps);
    expect(first.added).toBe(2);
    expect(second.added).toBe(0);
    expect(second.reused).toBe(2);
    expect(graph.getAllNodes()).toHaveLength(2); // 没有副本
  });

  it('已归档的 episode 不补（不把遗忘的记忆拉回图谱）', () => {
    const graph = new MemoryGraph();
    const report = backfillEpisodicNodes(graph, [
      episode(),
      episode({ archived: true } as Partial<EpisodicMemory>),
    ]);
    expect(report.added).toBe(1);
    expect(report.skippedArchived).toBe(1);
  });

  it('混合场景：部分已在图谱、部分缺失', () => {
    const graph = new MemoryGraph();
    const existing = episode();
    graph.addNode(createNodeFromEpisode(existing));
    const report = backfillEpisodicNodes(graph, [existing, episode(), episode()]);
    expect(report.reused).toBe(1);
    expect(report.added).toBe(2);
  });

  it('缺 id 的脏数据被跳过而不是抛错', () => {
    const graph = new MemoryGraph();
    const report = backfillEpisodicNodes(graph, [
      episode(),
      { narrativeFragment: '没有 id 的旧数据' } as unknown as EpisodicMemory,
    ]);
    expect(report.added).toBe(1);
  });

  it('空输入安全', () => {
    const graph = new MemoryGraph();
    expect(backfillEpisodicNodes(graph, [])).toEqual({ added: 0, reused: 0, skippedArchived: 0 });
    expect(backfillEpisodicNodes(graph, undefined as unknown as EpisodicMemory[]))
      .toEqual({ added: 0, reused: 0, skippedArchived: 0 });
  });

  it('补全后的节点能被图查询找到（同一 sourceId 可回溯）', () => {
    const graph = new MemoryGraph();
    const ep = episode();
    backfillEpisodicNodes(graph, [ep]);
    const found = graph.getAllNodes().find(n => n.source === 'episodic' && n.sourceId === ep.id);
    expect(found).toBeTruthy();
    expect(found!.content).toContain('面试');
  });
});
