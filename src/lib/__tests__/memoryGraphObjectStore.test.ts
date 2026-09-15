// ── memoryGraph 对象库收敛测试 ──
// 覆盖：addNode 同源幂等复用（不产生副本节点）/ episodic 归档 → 图谱节点同步归档
import { describe, it, expect } from 'vitest';
import { MemoryGraph, syncEpisodicArchivedNodes } from '../memoryGraph';

function addEpisodeNode(
  graph: MemoryGraph,
  sourceId: string,
  content = `内容-${sourceId}`,
  weight = 0.6,
) {
  return graph.addNode({
    source: 'episodic',
    content,
    tags: ['记忆'],
    emotionalSignature: { valence: 0.2, arousal: 0.3, dominantEmotion: 'calm' },
    weight,
    decayRate: 0.02,
    sourceId,
    metadata: { eventSummary: content },
    createdAt: Date.now(),
  });
}

describe('MemoryGraph.addNode — 同源幂等复用（对象库收敛）', () => {
  it('同一 source+sourceId 重复添加 → 复用既有节点而非新建副本', () => {
    const graph = new MemoryGraph();
    const first = addEpisodeNode(graph, 'ep_same');
    const second = addEpisodeNode(graph, 'ep_same');
    expect(second.id).toBe(first.id);
    expect(graph.getAllNodes()).toHaveLength(1);
  });

  it('复用节点时权重取大、激活次数累加', () => {
    const graph = new MemoryGraph();
    const first = addEpisodeNode(graph, 'ep_w', '事件A', 0.5);
    expect(first.activationCount).toBe(0); // 新建不计激活
    const second = addEpisodeNode(graph, 'ep_w', '事件A', 0.9);
    expect(second.id).toBe(first.id);
    expect(graph.getStats().totalAdded).toBe(1);
    expect(graph.getAllNodes()[0].weight).toBe(0.9);
    expect(graph.getAllNodes()[0].activationCount).toBe(1); // 每次复用 +1
  });

  it('不同 sourceId 或不同 source → 正常新建（各自独立对象）', () => {
    const graph = new MemoryGraph();
    addEpisodeNode(graph, 'ep_a');
    addEpisodeNode(graph, 'ep_b');
    graph.addNode({
      source: 'discovery', sourceId: 'ep_a', content: '发现与episode同id但不同源',
      tags: [], emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, metadata: {}, createdAt: Date.now(),
    });
    expect(graph.getAllNodes()).toHaveLength(3);
  });

  it('已归档节点不参与复用（对象可重新激活新节点）', () => {
    const graph = new MemoryGraph();
    const first = addEpisodeNode(graph, 'ep_g');
    first.archived = true;
    const second = addEpisodeNode(graph, 'ep_g');
    expect(second.id).not.toBe(first.id);
  });
});

describe('syncEpisodicArchivedNodes — episodic 归档 → 图谱节点同步', () => {
  it('不在活跃情景记忆集合中的 episodic 节点被归档', () => {
    const graph = new MemoryGraph();
    const keep = addEpisodeNode(graph, 'ep_keep');
    const gone = addEpisodeNode(graph, 'ep_gone');
    const report = syncEpisodicArchivedNodes(graph, new Set(['ep_keep', 'ep_other']));
    expect(report.archivedNodes).toContain(gone.id);
    expect(report.archivedNodes).not.toContain(keep.id);
    const goneNode = graph.getAllNodes().find(n => n.id === gone.id)!;
    const keepNode = graph.getAllNodes().find(n => n.id === keep.id)!;
    expect(goneNode.archived).toBe(true);
    expect(keepNode.archived).toBe(false);
    expect(report.synced).toBe(1);
  });

  it('已归档节点不重复计数，非 episodic 节点不受影响', () => {
    const graph = new MemoryGraph();
    addEpisodeNode(graph, 'ep_already_archived');
    const done = graph.getAllNodes().find(n => n.sourceId === 'ep_already_archived')!;
    done.archived = true;
    const thought = graph.addNode({
      source: 'thought', sourceId: 'th_1', content: '思维',
      tags: [], emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.4, decayRate: 0.03, metadata: {}, createdAt: Date.now(),
    });
    const report = syncEpisodicArchivedNodes(graph, new Set());
    expect(report.synced).toBe(0);
    expect(thought.archived).toBe(false);
  });
});
