// ── v1.3 确定性图查询层 (Deterministic Graph Queries) ──
// 参照 c-former V6.3 recursive.py 的"确定性关系层"思想移植：
//   memoryGraph 的加权边只能做"激活扩散打分"（可能召回模糊结果），
//   本层提供确定性的沿时间/主题链遍历 —— "上次 X 之后发生了什么 / 最新进展"，
//   结果可复现、100% 可解释，带 cycle/depth 防护，不依赖任何打分。
//
// 纯逻辑：只通过 MemoryGraph 公开 API(getAllNodes/getEdgesForNode) 工作。

import type { MemoryGraph, MemoryNode, MemoryEdge, EdgeType } from './memoryGraph';

export type ChainDirection = 'newer' | 'older';

export interface TemporalChainOptions {
  /** 沿时间方向：newer=找后继（更新时间/事件之后）；older=找前驱（之前） */
  direction?: ChainDirection;
  /** 只走这些边类型（缺省全部） */
  edgeTypes?: EdgeType[];
  /** 最大跳数（防止超长链） */
  maxDepth?: number;
  /** 最大步数（硬上限，与 cycle 检测双保险） */
  maxSteps?: number;
  /** 是否跳过已归档节点 */
  skipArchived?: boolean;
}

export type ChainFailureReason =
  | 'ok'
  | 'no_link'          // 起点没有满足方向的邻居
  | 'not_found'        // 起点 id 不存在
  | 'cycle'            // 检测到回到已访问节点
  | 'depth_exceeded'   // 超过 maxDepth/maxSteps
  | 'only_archived';   // 相邻节点均已归档

export interface ChainResult {
  ok: boolean;
  reason: ChainFailureReason;
  /** 沿链节点 id（含起点） */
  path: string[];
  /** 链末端节点 id（ok 时 = path 末尾） */
  endId: string | null;
  /** 每一步的连接边类型（与 path 对齐，path[i]->path[i+1] 用 steps[i]） */
  steps: EdgeType[];
}

/** 起点节点的全部相邻边（通过公开 API 取） */
function edgesOf(graph: MemoryGraph, nodeId: string): MemoryEdge[] {
  return graph.getEdgesForNode(nodeId);
}

function nodeOf(graph: MemoryGraph, nodeId: string): MemoryNode | undefined {
  return graph.getAllNodes().find(n => n.id === nodeId);
}

/**
 * 沿时间链受控遍历：从 startId 出发，每步选择"未访问且时间方向正确"的邻居
 * （newer → 取 createdAt 大于当前且最小的；older → 取小于当前且最大的，
 *   保证链是有序的细粒度序列），走到无法继续为止。
 * 防护：visited 环检测 + maxSteps 硬上限；可过滤边类型与已归档节点。
 */
export function walkTemporalChain(
  graph: MemoryGraph,
  startId: string,
  opts?: TemporalChainOptions,
): ChainResult {
  const direction: ChainDirection = opts?.direction ?? 'newer';
  const maxDepth = opts?.maxDepth ?? 4;
  const maxSteps = Math.max(1, opts?.maxSteps ?? 16);
  const edgeTypes = opts?.edgeTypes ? new Set(opts.edgeTypes) : null;
  const skipArchived = opts?.skipArchived ?? true;

  const start = nodeOf(graph, startId);
  if (!start) return { ok: false, reason: 'not_found', path: [], endId: null, steps: [] };

  const path: string[] = [startId];
  const steps: EdgeType[] = [];
  const visited = new Set<string>([startId]);

  let currentId = startId;
  for (let step = 0; step < maxSteps; step++) {
    if (path.length - 1 >= maxDepth) {
      return { ok: true, reason: 'ok', path, endId: currentId, steps };
    }
    const current = nodeOf(graph, currentId);
    if (!current) break;

    // 收集候选邻居：相连边 + 时间方向过滤 + 边类型过滤 + 已归档过滤
    const candidates: Array<{ nodeId: string; edgeType: EdgeType; createdAt: number }> = [];
    for (const edge of edgesOf(graph, currentId)) {
      const otherId = edge.sourceNodeId === currentId ? edge.targetNodeId : edge.sourceNodeId;
      if (visited.has(otherId)) continue;
      if (edgeTypes && !edgeTypes.has(edge.type)) continue;
      const other = nodeOf(graph, otherId);
      if (!other) continue;
      if (skipArchived && other.archived) continue;
      const currentTime = current.createdAt;
      const otherTime = other.createdAt;
      if (direction === 'newer' && otherTime <= currentTime) continue;
      if (direction === 'older' && otherTime >= currentTime) continue;
      candidates.push({ nodeId: otherId, edgeType: edge.type, createdAt: otherTime });
    }
    if (candidates.length === 0) {
      // 走到了链末端（已走过 ≥1 步）→ 成功；起点就无方向邻居 → no_link
      if (path.length > 1) {
        return { ok: true, reason: 'ok', path, endId: currentId, steps };
      }
      const hadAnyEdge = edgesOf(graph, currentId).length > 0;
      return {
        ok: false,
        reason: hadAnyEdge ? 'only_archived' : 'no_link',
        path,
        endId: null,
        steps,
      };
    }

    // newer → 取紧随其后的最小时间节点；older → 取最近前驱（最大时间）
    candidates.sort((a, b) =>
      direction === 'newer' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt,
    );
    const next = candidates[0];
    if (visited.has(next.nodeId)) {
      return { ok: false, reason: 'cycle', path, endId: null, steps };
    }
    visited.add(next.nodeId);
    path.push(next.nodeId);
    steps.push(next.edgeType);
    currentId = next.nodeId;
  }
  return { ok: false, reason: 'depth_exceeded', path, endId: null, steps };
}

export interface HopResult {
  ok: boolean;
  reason: ChainFailureReason;
  /** 到达的节点 id */
  nodeId: string | null;
}

/**
 * 确定性前驱/后继查询：从 startId 沿方向走 hops 跳，得到明确节点。
 * hops=0 → 起点自身；超过 maxDepth 直接拒绝（depth_exceeded）。
 */
export function hop(
  graph: MemoryGraph,
  startId: string,
  hops: number,
  opts?: Omit<TemporalChainOptions, 'maxDepth'>,
): HopResult {
  const effectiveMax = opts?.maxSteps ?? 16;
  if (hops > effectiveMax) return { ok: false, reason: 'depth_exceeded', nodeId: null };
  if (hops === 0) {
    return nodeOf(graph, startId)
      ? { ok: true, reason: 'ok', nodeId: startId }
      : { ok: false, reason: 'not_found', nodeId: null };
  }
  const result = walkTemporalChain(graph, startId, { ...opts, maxDepth: hops });
  if (!result.ok) return { ok: false, reason: result.reason, nodeId: null };
  if (result.path.length - 1 < hops) return { ok: false, reason: 'no_link', nodeId: null };
  return { ok: true, reason: 'ok', nodeId: result.path[result.path.length - 1] };
}

/** 沿时间走到"最新"（末端）→ 常用于"这个话题/这段关系的最新进展"。 */
export function latestOf(
  graph: MemoryGraph,
  startId: string,
  opts?: Omit<TemporalChainOptions, 'direction'>,
): ChainResult {
  return walkTemporalChain(graph, startId, { ...opts, direction: 'newer', maxSteps: Math.max(16, opts?.maxSteps ?? 16) });
}

/** 沿时间回看"最早前因"（older 走到头）→ "这件事是怎么开始的"。 */
export function earliestOf(
  graph: MemoryGraph,
  startId: string,
  opts?: Omit<TemporalChainOptions, 'direction'>,
): ChainResult {
  return walkTemporalChain(graph, startId, { ...opts, direction: 'older', maxSteps: Math.max(16, opts?.maxSteps ?? 16) });
}

export interface ConnectionResult {
  found: boolean;
  reason: ChainFailureReason | 'not_found';
  /** from → ... → to 的路径（含两端） */
  path: string[];
}

/**
 * 确定性多跳连接查询：BFS（有界）判断 fromId 与 toId 之间是否存在可达路径，
 * 返回具体路径（沿边类型连接，环安全）。用于"这两段记忆是否有关联/因果链"。
 */
export function connectionPath(
  graph: MemoryGraph,
  fromId: string,
  toId: string,
  opts?: { maxDepth?: number; edgeTypes?: EdgeType[]; skipArchived?: boolean },
): ConnectionResult {
  const maxDepth = opts?.maxDepth ?? 3;
  const edgeTypes = opts?.edgeTypes ? new Set(opts.edgeTypes) : null;
  const skipArchived = opts?.skipArchived ?? true;
  const start = nodeOf(graph, fromId);
  const target = nodeOf(graph, toId);
  if (!start || !target) return { found: false, reason: 'not_found', path: [] };

  // BFS（全图可达性；visited 防环；图规模小 O(V+E) 安全），随后按实际路径长度判定跳数上限
  const queue: string[] = [fromId];
  const prev = new Map<string, string>();
  const visited = new Set<string>([fromId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === toId) break;
    for (const edge of edgesOf(graph, cur)) {
      const otherId = edge.sourceNodeId === cur ? edge.targetNodeId : edge.sourceNodeId;
      if (visited.has(otherId)) continue;
      if (edgeTypes && !edgeTypes.has(edge.type)) continue;
      const other = nodeOf(graph, otherId);
      if (!other) continue;
      if (skipArchived && other.archived) continue;
      visited.add(otherId);
      prev.set(otherId, cur);
      queue.push(otherId);
    }
  }
  if (!prev.has(toId) && fromId !== toId) {
    return { found: false, reason: 'no_link', path: [] };
  }
  // 回溯路径
  const path: string[] = [];
  let cursor: string | null = toId;
  while (cursor && cursor !== fromId) {
    path.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
    if (path.length > maxDepth + 2) return { found: false, reason: 'depth_exceeded', path: [] };
  }
  path.unshift(fromId);
  if (path.length - 1 > maxDepth) return { found: false, reason: 'depth_exceeded', path: [] };
  return { found: true, reason: 'ok', path };
}
