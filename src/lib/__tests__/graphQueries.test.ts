// ── graphQueries 确定性图查询测试 ──
// 覆盖：时间链遍历(newer/older) / 单跳 hop / latest/earliest / 连接路径 BFS /
//       环与深度防护 / 归档与边类型过滤
import { describe, it, expect } from 'vitest';
import { MemoryGraph, type MemoryNode } from '../memoryGraph';
import { walkTemporalChain, hop, latestOf, earliestOf, connectionPath } from '../graphQueries';

// 注意：MemoryGraph.addNode 会自动建边(主题/情绪/时间) —— 测试节点需差异化
// tag/情绪/时间，避免 autoConnect 引入计划外连线干扰确定性断言。
function buildGraph(): { graph: MemoryGraph; a: MemoryNode; b: MemoryNode; c: MemoryNode; d: MemoryNode } {
  const graph = new MemoryGraph();
  const t0 = Date.now() - 10 * 86400_000;
  const DAY = 86400_000;
  const mk = (sourceId: string, createdAt: number, tag: string, emotion: string, content: string) =>
    graph.addNode({
      source: 'episodic',
      content,
      tags: [tag],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: emotion },
      weight: 0.6,
      decayRate: 0.02,
      sourceId,
      createdAt,
      metadata: {},
    });
  const a = mk('ep_a', t0, 'tagA', 'joy', '面试通过很开心');
  const b = mk('ep_b', t0 + 2 * DAY, 'tagB', 'sad', '搬去新城市有点不舍');
  const c = mk('ep_c', t0 + 4 * DAY, 'tagC', 'fear', '新工作第一天紧张');
  const d = mk('ep_d', t0 + 6 * DAY, 'tagD', 'anger', '和室友闹了矛盾');
  graph.addEdge(a.id, b.id, 'thematic', 0.8);
  graph.addEdge(b.id, c.id, 'thematic', 0.9);
  return { graph, a, b, c, d };
}

describe('walkTemporalChain — 时间链受控遍历', () => {
  it('newer：沿时间递进走到最新（A→B→C）', () => {
    const { graph, a, c } = buildGraph();
    const r = walkTemporalChain(graph, a.id, { direction: 'newer' });
    expect(r.ok).toBe(true);
    expect(r.path).toEqual([a.id, expect.any(String), c.id]);
    expect(r.endId).toBe(c.id);
  });

  it('older：沿时间回溯（C→B→A）', () => {
    const { graph, a, c } = buildGraph();
    const r = walkTemporalChain(graph, c.id, { direction: 'older' });
    expect(r.ok).toBe(true);
    expect(r.path[0]).toBe(c.id);
    expect(r.endId).toBe(a.id);
  });

  it('不存在的起点 → not_found', () => {
    const { graph } = buildGraph();
    const r = walkTemporalChain(graph, 'mem_ghost');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_found');
  });

  it('孤立节点（无方向邻居）→ no_link', () => {
    const { graph, d } = buildGraph();
    const r = walkTemporalChain(graph, d.id, { direction: 'newer' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_link');
    expect(r.path).toEqual([d.id]);
  });

  it('超过 maxDepth 正常截断为 ok（软边界）', () => {
    const { graph, a } = buildGraph();
    const r = walkTemporalChain(graph, a.id, { direction: 'newer', maxDepth: 1 });
    expect(r.ok).toBe(true);
    expect(r.path.length - 1).toBeLessThanOrEqual(1);
  });

  it('已归档节点被跳过 → only_archived', () => {
    const { graph, a, b } = buildGraph();
    const nodeB = graph.getAllNodes().find(n => n.id === b.id)!;
    nodeB.archived = true;
    const r = walkTemporalChain(graph, a.id, { direction: 'newer' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('only_archived');
  });
});

describe('hop / latestOf / earliestOf', () => {
  it('hop 跳数精确：A 跳 1 → B，跳 2 → C', () => {
    const { graph, a, b, c } = buildGraph();
    const h1 = hop(graph, a.id, 1);
    expect(h1).toMatchObject({ ok: true, nodeId: b.id });
    const h2 = hop(graph, a.id, 2);
    expect(h2).toMatchObject({ ok: true, nodeId: c.id });
  });

  it('hops=0 → 起点自身；hops 超过硬上限 → depth_exceeded', () => {
    const { graph, a } = buildGraph();
    expect(hop(graph, a.id, 0)).toMatchObject({ ok: true, nodeId: a.id });
    expect(hop(graph, a.id, 64)).toMatchObject({ ok: false, reason: 'depth_exceeded' });
  });

  it('latestOf/earliestOf 语义正确', () => {
    const { graph, a, c } = buildGraph();
    expect(latestOf(graph, a.id).endId).toBe(c.id);
    expect(earliestOf(graph, c.id).endId).toBe(a.id);
  });
});

describe('connectionPath — 确定性连接查询', () => {
  it('A 与 C 之间存在路径 → 返回具体链路', () => {
    const { graph, a, c } = buildGraph();
    const r = connectionPath(graph, a.id, c.id);
    expect(r.found).toBe(true);
    expect(r.path[0]).toBe(a.id);
    expect(r.path[r.path.length - 1]).toBe(c.id);
    expect(r.path.length).toBe(3);
  });

  it('无连接（孤立 D）→ no_link', () => {
    const { graph, a, d } = buildGraph();
    const r = connectionPath(graph, a.id, d.id);
    expect(r.found).toBe(false);
    expect(r.reason).toBe('no_link');
  });

  it('目标已归档 → 不可达', () => {
    const { graph, a, c } = buildGraph();
    const nodeC = graph.getAllNodes().find(n => n.id === c.id)!;
    nodeC.archived = true;
    const r = connectionPath(graph, a.id, c.id);
    expect(r.found).toBe(false);
  });

  it('超过 maxDepth 的路径 → 拒绝（depth_exceeded）', () => {
    const graph = new MemoryGraph();
    const DAY = 86400_000;
    const t0 = Date.now() - 20 * DAY;
    const emotions = ['joy', 'sad', 'fear', 'anger', 'disgust', 'calm'];
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const n = graph.addNode({
        source: 'episodic', sourceId: `ep_chain_${i}`, content: `事件链第${i}条完全不同主题内容`,
        tags: [`tag_${i}`],
        emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: emotions[i] },
        weight: 0.5, decayRate: 0.02, createdAt: t0 + i * 2 * DAY, metadata: {},
      });
      ids.push(n.id);
      if (i > 0) graph.addEdge(ids[i - 1], ids[i], 'temporal', 0.5);
    }
    const near = connectionPath(graph, ids[0], ids[3], { maxDepth: 5 });
    expect(near.found).toBe(true);
    const far = connectionPath(graph, ids[0], ids[5], { maxDepth: 3 });
    expect(far.found).toBe(false);
    expect(far.reason).toBe('depth_exceeded');
  });
});
