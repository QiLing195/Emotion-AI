// ── v1.0 记忆图谱 (Memory Graph) ──
//
// 复用 Thought Graph 的节点/边/衰减机制，统一 4 种记忆来源：
//   episodic  — 情景记忆（关键时刻的情感叙事）
//   semantic  — 语义记忆（已学习的偏好/事实）
//   discovery — 好奇心发现（Web/AI 探索产生的知识）
//   thought   — 思维碎片（Thought Graph 中的 wish/fear/doubt 等）
//
// 核心能力：
//   1. 统一节点 — MemoryNode 包装所有记忆来源
//   2. 加权边 — co_occurrence / emotional / temporal / thematic
//   3. BFS 激活扩散 — 从种子节点沿边传播激活，替代关键词匹配
//   4. 衰减机制 — 未激活节点权重随时间下降
//
// 连接：
//   episodicMemory + semanticMemory + discoveries + thoughtGraph
//   ↓ 添加为 MemoryNode → 自动建边 → BFS 查询
//
// 集成点：
//   aiCoordinator 阶段 3.8 — 每轮根据上下文激活相关记忆节点
//   workspace 注入 — 替代 unifiedMemory 中的关键词匹配

import type { EmotionState } from './emotionEngine';
import { getDominantEmotion } from './emotionEngine';
import type { EpisodicMemory } from './episodicMemory';
import type { ThoughtNode } from './thoughtGraph';
import type { Discovery } from '../curiosity/types';
import type { SemanticMemoryEntry } from './unifiedMemory';
import type { MemoryItem, MemorySource } from './unifiedMemory';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type MemoryNodeSource = 'episodic' | 'semantic' | 'discovery' | 'thought';

export interface EmotionalSignature {
  valence: number;
  arousal: number;
  dominantEmotion: string;
}

export interface MemoryNode {
  id: string;
  source: MemoryNodeSource;
  /** 可展示的文本摘要 */
  content: string;
  /** 标签（用于边构建和查询匹配） */
  tags: string[];
  /** 情感签名（用于情感一致性匹配） */
  emotionalSignature: EmotionalSignature;
  /** [0, 1] 节点重要性 */
  weight: number;
  createdAt: number;
  /** 上次被激活的时间 */
  lastActivatedAt: number;
  /** 被激活次数 */
  activationCount: number;
  /** 每日衰减系数 (0-1)，1=永不衰减 */
  decayRate: number;
  /** 指向原始数据的 ID（跨来源引用） */
  sourceId: string;
  /** 来源特定的元数据 */
  metadata: Record<string, any>;
  /** 是否已归档（长期不活跃） */
  archived: boolean;
}

export type EdgeType = 'co_occurrence' | 'emotional' | 'temporal' | 'thematic';

export interface MemoryEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: EdgeType;
  /** [0, 1] 关联强度 */
  weight: number;
  createdAt: number;
}

/** BFS 遍历配置 */
export interface TraversalConfig {
  /** 最大 BFS 深度（默认 3） */
  maxDepth: number;
  /** 每跳激活衰减系数（默认 0.5） */
  activationDecay: number;
  /** 最低激活阈值（默认 0.05） */
  minActivation: number;
  /** 最大返回节点数（默认 10） */
  maxResults: number;
}

/** 遍历结果中的单个节点 */
export interface ActivatedNode {
  node: MemoryNode;
  /** [0, 1] 累积激活值 */
  activation: number;
  /** BFS 深度（0 = 种子节点） */
  depth: number;
}

export interface TraversalResult {
  activatedNodes: ActivatedNode[];
  /** 遍历涉及的节点总数 */
  visitedCount: number;
  /** 各来源贡献数 */
  sources: Record<MemoryNodeSource, number>;
}

export interface MemoryGraphState {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  stats: {
    totalAdded: number;
    totalArchived: number;
    bySource: Record<MemoryNodeSource, number>;
  };
}

/** 图谱查询输入 */
export interface GraphQuery {
  /** 用户当前消息（用于关键词匹配种子节点） */
  text: string;
  /** 当前情感状态（用于情感一致性种子选择） */
  emotionState: EmotionState;
  /** 遍历配置（可选，有默认值） */
  traversal?: Partial<TraversalConfig>;
}

// ════════════════════════════════════════════════════════════
// 2. 常量
// ════════════════════════════════════════════════════════════

const DEFAULT_TRAVERSAL: TraversalConfig = {
  maxDepth: 3,
  activationDecay: 0.5,
  minActivation: 0.05,
  maxResults: 10,
};

const MAX_NODES = 500;
const MAX_EDGES = 2000;
const ARCHIVE_WEIGHT_THRESHOLD = 0.03;
const CO_OCCURRENCE_WINDOW_MS = 30 * 60_000;  // 30 分钟内添加的节点视为共现
const TEMPORAL_WINDOW_MS = 24 * 60 * 60_000;   // 24 小时内的节点可建时间边

// ════════════════════════════════════════════════════════════
// 3. MemoryGraph 类
// ════════════════════════════════════════════════════════════

export class MemoryGraph {
  private nodeMap: Map<string, MemoryNode> = new Map();
  private edgeMap: Map<string, MemoryEdge> = new Map();
  /** 邻接表：nodeId → 相连的 edgeIds */
  private adjacency: Map<string, Set<string>> = new Map();
  private stats: MemoryGraphState['stats'];

  constructor() {
    this.stats = {
      totalAdded: 0,
      totalArchived: 0,
      bySource: { episodic: 0, semantic: 0, discovery: 0, thought: 0 },
    };
  }

  // ── 增 ──

  /**
   * 添加一个记忆节点。
   * 自动建立与已有节点的边连接。
   */
  addNode(params: {
    source: MemoryNodeSource;
    content: string;
    tags: string[];
    emotionalSignature: EmotionalSignature;
    weight: number;
    decayRate: number;
    sourceId: string;
    metadata?: Record<string, any>;
    createdAt?: number;
  }): MemoryNode {
    const now = Date.now();

    // v1.3 对象库收敛：同一来源对象（source+sourceId）已存在 → 复用既有节点，
    // 只提权/刷新活跃度，不再创建"副本节点"（观测点/索引不复制对象）。
    if (params.sourceId) {
      const existing = [...this.nodeMap.values()].find(
        n => !n.archived && n.source === params.source && n.sourceId === params.sourceId,
      );
      if (existing) {
        existing.weight = Math.max(existing.weight, Math.min(1, Math.max(0, params.weight)));
        existing.lastActivatedAt = now;
        existing.activationCount++;
        return existing;
      }
    }

    const id = `mem_${params.source}_${now}_${this.stats.totalAdded}`;
    const node: MemoryNode = {
      id,
      source: params.source,
      content: params.content,
      tags: params.tags,
      emotionalSignature: params.emotionalSignature,
      weight: Math.min(1, Math.max(0, params.weight)),
      createdAt: params.createdAt ?? now,
      lastActivatedAt: now,
      activationCount: 0,
      decayRate: Math.min(1, Math.max(0, params.decayRate)),
      sourceId: params.sourceId,
      metadata: params.metadata ?? {},
      archived: false,
    };

    this.nodeMap.set(id, node);
    this.adjacency.set(id, new Set());
    this.stats.totalAdded++;
    this.stats.bySource[params.source]++;

    // 自动建边
    this.autoConnect(node);

    // GC
    this.prune();

    return node;
  }

  /**
   * 在两个节点间添加加权边。
   * 重复调用会更新已有边的权重（取最大值）。
   */
  addEdge(
    sourceNodeId: string,
    targetNodeId: string,
    type: EdgeType,
    weight: number,
  ): MemoryEdge | null {
    const a = this.nodeMap.get(sourceNodeId);
    const b = this.nodeMap.get(targetNodeId);
    if (!a || !b) return null;
    if (sourceNodeId === targetNodeId) return null;

    // 检查是否已存在同类型边
    const existing = this.findEdge(sourceNodeId, targetNodeId, type);
    if (existing) {
      existing.weight = Math.max(existing.weight, weight);
      return existing;
    }

    const edge: MemoryEdge = {
      id: `edge_${type}_${Date.now()}_${this.edgeMap.size}`,
      sourceNodeId,
      targetNodeId,
      type,
      weight: Math.min(1, Math.max(0, weight)),
      createdAt: Date.now(),
    };

    this.edgeMap.set(edge.id, edge);
    this.adjacency.get(sourceNodeId)?.add(edge.id);
    this.adjacency.get(targetNodeId)?.add(edge.id);

    // GC 边
    while (this.edgeMap.size > MAX_EDGES) {
      const oldest = [...this.edgeMap.values()]
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.removeEdge(oldest.id);
      else break;
    }

    return edge;
  }

  // ── 查 ──

  /** 获取所有活跃（未归档）节点 */
  getActiveNodes(): MemoryNode[] {
    return [...this.nodeMap.values()].filter(n => !n.archived);
  }

  /** 获取所有节点（含归档） */
  getAllNodes(): MemoryNode[] {
    return [...this.nodeMap.values()];
  }

  /** 按来源过滤节点 */
  getNodesBySource(source: MemoryNodeSource, includeArchived = false): MemoryNode[] {
    return [...this.nodeMap.values()].filter(
      n => n.source === source && (includeArchived || !n.archived),
    );
  }

  /** 获取节点的所有邻接边 */
  getEdgesForNode(nodeId: string): MemoryEdge[] {
    const edgeIds = this.adjacency.get(nodeId);
    if (!edgeIds) return [];
    return [...edgeIds].map(id => this.edgeMap.get(id)).filter(Boolean) as MemoryEdge[];
  }

  /** 获取所有边 */
  getAllEdges(): MemoryEdge[] {
    return [...this.edgeMap.values()];
  }

  /** 获取图的统计信息 */
  getStats() {
    return { ...this.stats };
  }

  // ── 激活 ──

  /**
   * BFS 激活扩散遍历。
   *
   * 算法：
   *   1. 种子选择 — 文本关键词 + 情感标签匹配当前上下文
   *   2. BFS 传播 — 每层沿边向外扩散，activation 按 edge.weight × decayFactor 衰减
   *   3. 收集 — activation > minActivation 的节点，按 activation 降序取 top maxResults
   */
  traverse(query: GraphQuery, config?: Partial<TraversalConfig>): TraversalResult {
    const cfg = { ...DEFAULT_TRAVERSAL, ...config };
    const visited = new Map<string, ActivatedNode>(); // nodeId → ActivatedNode
    const dominant = getDominantEmotion(query.emotionState.emotions);

    // ── Phase 1: 种子选择 ──
    const seeds = this.selectSeeds(query.text, dominant, query.emotionState);
    const queue: { nodeId: string; depth: number }[] = [];

    for (const { node, score } of seeds) {
      visited.set(node.id, { node, activation: score, depth: 0 });
      queue.push({ nodeId: node.id, depth: 0 });
    }

    // ── Phase 2: BFS 传播 ──
    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= cfg.maxDepth) continue;

      const currentActivation = visited.get(nodeId)?.activation ?? 0;
      const edges = this.getEdgesForNode(nodeId);

      for (const edge of edges) {
        const neighborId =
          edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
        const neighbor = this.nodeMap.get(neighborId);
        if (!neighbor || neighbor.archived) continue;

        // 计算传播激活值
        const spreadActivation = currentActivation * edge.weight * cfg.activationDecay;

        if (spreadActivation < cfg.minActivation) continue;

        if (visited.has(neighborId)) {
          // 已访问：叠加激活值（多条路径汇聚）
          const existing = visited.get(neighborId)!;
          existing.activation = Math.min(1, existing.activation + spreadActivation);
          existing.depth = Math.min(existing.depth, depth + 1);
        } else {
          visited.set(neighborId, {
            node: neighbor,
            activation: spreadActivation,
            depth: depth + 1,
          });
          queue.push({ nodeId: neighborId, depth: depth + 1 });
        }
      }
    }

    // ── Phase 3: 收集 & 排序 ──
    const activated = [...visited.values()]
      .filter(a => a.activation >= cfg.minActivation)
      .sort((a, b) => b.activation - a.activation)
      .slice(0, cfg.maxResults);

    // 统计来源
    const sources: Record<MemoryNodeSource, number> = {
      episodic: 0, semantic: 0, discovery: 0, thought: 0,
    };
    for (const a of activated) {
      sources[a.node.source]++;
    }

    // 激活计数更新
    const now = Date.now();
    for (const a of activated) {
      a.node.activationCount++;
      a.node.lastActivatedAt = now;
    }

    return { activatedNodes: activated, visitedCount: visited.size, sources };
  }

  /** 显式激活某个节点 */
  activate(nodeId: string): MemoryNode | null {
    const node = this.nodeMap.get(nodeId);
    if (!node || node.archived) return null;
    node.activationCount++;
    node.lastActivatedAt = Date.now();
    // 激活减缓衰减
    node.decayRate *= 0.9;
    node.weight = Math.min(1, node.weight + 0.02);
    return node;
  }

  // ── 衰减 & GC ──

  /** 每日衰减所有活跃节点 */
  decay(elapsedDays: number): void {
    for (const node of this.nodeMap.values()) {
      if (node.archived) continue;
      node.weight *= Math.pow(1 - node.decayRate, elapsedDays);
      if (node.weight < ARCHIVE_WEIGHT_THRESHOLD && node.activationCount <= 1) {
        node.archived = true;
        this.stats.totalArchived++;
      }
    }
  }

  /** 清理低权重节点和孤立边 */
  prune(): void {
    // 归档低权重节点
    while (this.nodeMap.size > MAX_NODES) {
      const toArchive = [...this.nodeMap.values()]
        .filter(n => !n.archived)
        .sort((a, b) => a.weight - b.weight)[0];
      if (toArchive) {
        toArchive.archived = true;
        this.stats.totalArchived++;
      } else {
        break;
      }
    }
  }

  /** 移除一条边 */
  private removeEdge(edgeId: string): void {
    const edge = this.edgeMap.get(edgeId);
    if (!edge) return;
    this.adjacency.get(edge.sourceNodeId)?.delete(edgeId);
    this.adjacency.get(edge.targetNodeId)?.delete(edgeId);
    this.edgeMap.delete(edgeId);
  }

  // ── 内部：自动建边 ──

  private autoConnect(newNode: MemoryNode): void {
    const now = Date.now();

    for (const existing of this.nodeMap.values()) {
      if (existing.id === newNode.id || existing.archived) continue;

      // 1. 主题边（标签重叠）
      const tagOverlap = newNode.tags.filter(t => existing.tags.includes(t));
      if (tagOverlap.length > 0) {
        const weight = Math.min(1, tagOverlap.length * 0.25);
        this.addEdge(newNode.id, existing.id, 'thematic', weight);
      }

      // 2. 情感边（相同主导情绪 或 效价相近）
      if (
        newNode.emotionalSignature.dominantEmotion === existing.emotionalSignature.dominantEmotion
      ) {
        const valenceDiff = Math.abs(
          newNode.emotionalSignature.valence - existing.emotionalSignature.valence,
        );
        const weight = Math.max(0.1, 1 - valenceDiff);
        this.addEdge(newNode.id, existing.id, 'emotional', weight * 0.6);
      }

      // 3. 共现边（时间窗口内添加的节点）
      const timeDiff = Math.abs(newNode.createdAt - existing.createdAt);
      if (timeDiff < CO_OCCURRENCE_WINDOW_MS) {
        const weight = 1 - timeDiff / CO_OCCURRENCE_WINDOW_MS;
        this.addEdge(newNode.id, existing.id, 'co_occurrence', weight * 0.5);
      }

      // 4. 时间边（24h 内的节点）
      if (timeDiff < TEMPORAL_WINDOW_MS) {
        const weight = 1 - timeDiff / TEMPORAL_WINDOW_MS;
        this.addEdge(newNode.id, existing.id, 'temporal', weight * 0.3);
      }
    }
  }

  // ── 内部：种子选择 ──

  private selectSeeds(
    queryText: string,
    dominant: { name: string; intensity: number },
    emotionState: EmotionState,
  ): { node: MemoryNode; score: number }[] {
    const keywords = extractChineseBigrams(queryText);
    const emotionKw = EMOTION_MEMORY_KEYWORDS[dominant.name] ?? [];
    const scored: { node: MemoryNode; score: number }[] = [];

    for (const node of this.nodeMap.values()) {
      if (node.archived) continue;
      let score = 0;

      // 文本关键词匹配（bigram 重叠）
      const nodeBigrams = extractChineseBigrams(node.content);
      let bigramOverlap = 0;
      for (const bg of keywords) {
        if (nodeBigrams.has(bg)) bigramOverlap++;
      }
      const total = Math.max(keywords.size, nodeBigrams.size, 1);
      score += (bigramOverlap / total) * 3;

      // 标签关键词匹配
      for (const kw of keywords) {
        for (const tag of node.tags) {
          if (tag.includes(kw) || kw.includes(tag)) score += 0.5;
        }
      }

      // 情感一致性
      if (node.emotionalSignature.dominantEmotion === dominant.name) {
        score += dominant.intensity * 2;
      }
      for (const ekw of emotionKw) {
        if (node.content.includes(ekw)) score += 1;
      }

      // 时间衰减（旧的记忆更难成为种子）
      const daysOld = (Date.now() - node.createdAt) / (1000 * 60 * 60 * 24);
      score *= Math.pow(0.8, daysOld / 7); // 每周衰减 20%

      // 权重加权
      score *= (0.3 + node.weight * 0.7);

      if (score > 0.2) {
        scored.push({ node, score: Math.min(1, score / 10) });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // 最多 10 个种子
  }

  // ── 内部：查找已有边 ──

  private findEdge(
    nodeIdA: string,
    nodeIdB: string,
    type: EdgeType,
  ): MemoryEdge | null {
    const edgesA = this.adjacency.get(nodeIdA);
    if (!edgesA) return null;
    for (const edgeId of edgesA) {
      const edge = this.edgeMap.get(edgeId);
      if (!edge) continue;
      if (edge.type !== type) continue;
      if (
        (edge.sourceNodeId === nodeIdA && edge.targetNodeId === nodeIdB) ||
        (edge.sourceNodeId === nodeIdB && edge.targetNodeId === nodeIdA)
      ) {
        return edge;
      }
    }
    return null;
  }

  // ── 持久化 ──

  getState(): MemoryGraphState {
    return {
      nodes: [...this.nodeMap.values()],
      edges: [...this.edgeMap.values()],
      stats: { ...this.stats },
    };
  }

  loadState(state: MemoryGraphState): void {
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.adjacency.clear();

    for (const node of state.nodes) {
      this.nodeMap.set(node.id, node);
      this.adjacency.set(node.id, new Set());
    }
    for (const edge of state.edges) {
      this.edgeMap.set(edge.id, edge);
      this.adjacency.get(edge.sourceNodeId)?.add(edge.id);
      this.adjacency.get(edge.targetNodeId)?.add(edge.id);
    }
    this.stats = { ...state.stats };
  }

  reset(): void {
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.adjacency.clear();
    this.stats = {
      totalAdded: 0,
      totalArchived: 0,
      bySource: { episodic: 0, semantic: 0, discovery: 0, thought: 0 },
    };
  }
}

// ════════════════════════════════════════════════════════════
// 4. 工厂方法
// ════════════════════════════════════════════════════════════

/** 从情景记忆创建 MemoryNode */
export function createNodeFromEpisode(ep: EpisodicMemory): {
  source: MemoryNodeSource;
  content: string;
  tags: string[];
  emotionalSignature: EmotionalSignature;
  weight: number;
  decayRate: number;
  sourceId: string;
  metadata: Record<string, any>;
  createdAt: number;
} {
  return {
    source: 'episodic',
    content: ep.narrativeFragment,
    tags: ep.tags,
    emotionalSignature: {
      valence: ep.emotionalImpact.valenceAfter,
      arousal: ep.emotionalImpact.arousalPeak,
      dominantEmotion: ep.emotionalImpact.dominantEmotion,
    },
    weight: ep.recallWeight,
    decayRate: 0.01 + (1 - ep.recallWeight) * 0.04, // 高权重记忆衰减慢
    sourceId: ep.id,
    metadata: {
      eventSummary: ep.eventSummary,
      valenceDelta: ep.emotionalImpact.valenceDelta,
      roundNumber: ep.roundNumber,
      hasBeliefRevision: !!ep.beliefRevision,
      selfPatternTriggered: ep.selfPatternTriggered,
    },
    createdAt: ep.timestamp,
  };
}

/** 从好奇心发现创建 MemoryNode */
export function createNodeFromDiscovery(d: Discovery): {
  source: MemoryNodeSource;
  content: string;
  tags: string[];
  emotionalSignature: EmotionalSignature;
  weight: number;
  decayRate: number;
  sourceId: string;
  metadata: Record<string, any>;
  createdAt: number;
} {
  return {
    source: 'discovery',
    content: `${d.title}: ${d.content.slice(0, 120)}`,
    tags: [d.topic, d.sourceType],
    emotionalSignature: {
      valence: 0.1,  // 发现通常情感中性
      arousal: 0.15,
      dominantEmotion: 'calm',
    },
    weight: d.quality * 0.8 + (d.verified ? 0.2 : 0),
    decayRate: 0.03, // 发现衰减较快
    sourceId: d.id,
    metadata: {
      topic: d.topic,
      sourceType: d.sourceType,
      quality: d.quality,
      verified: d.verified,
      shared: d.shared,
    },
    createdAt: d.timestamp,
  };
}

/** 从思维节点创建 MemoryNode */
export function createNodeFromThought(t: ThoughtNode): {
  source: MemoryNodeSource;
  content: string;
  tags: string[];
  emotionalSignature: EmotionalSignature;
  weight: number;
  decayRate: number;
  sourceId: string;
  metadata: Record<string, any>;
  createdAt: number;
} {
  return {
    source: 'thought',
    content: t.content,
    tags: [t.type],
    emotionalSignature: {
      valence: t.emotionalContext.valence,
      arousal: t.emotionalContext.arousal,
      dominantEmotion: t.emotionalContext.dominantEmotion,
    },
    weight: t.emotionalWeight,
    decayRate: t.decayRate,
    sourceId: t.id,
    metadata: {
      thoughtType: t.type,
      confidence: t.confidence,
      recallCount: t.recallCount,
      sourceMemoryId: t.sourceMemoryId,
    },
    createdAt: t.createdAt,
  };
}

/** 从语义记忆条目创建 MemoryNode */
export function createNodeFromSemantic(s: SemanticMemoryEntry): {
  source: MemoryNodeSource;
  content: string;
  tags: string[];
  emotionalSignature: EmotionalSignature;
  weight: number;
  decayRate: number;
  sourceId: string;
  metadata: Record<string, any>;
  createdAt: number;
} {
  return {
    source: 'semantic',
    content: s.content,
    tags: s.tags ?? [s.type],
    emotionalSignature: {
      valence: 0,  // 语义记忆情感中性
      arousal: 0.1,
      dominantEmotion: 'calm',
    },
    weight: s.type === 'preference' ? 0.7 : 0.5,
    decayRate: 0.005, // 语义记忆衰减最慢
    sourceId: s.id,
    metadata: {
      semanticType: s.type,
      hasEmbedding: !!s.embedding,
    },
    createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
  };
}

// ════════════════════════════════════════════════════════════
// 5. 图谱查询入口（替代 unifiedMemory 关键词匹配）
// ════════════════════════════════════════════════════════════

/**
 * 通过图谱遍历查询相关记忆。
 * 替代 unifiedMemory.ts 中各来源独立的关键词匹配。
 *
 * @returns MemoryItem[] — 与 unifiedMemory.recall() 相同的输出格式，可直接注入 workspace
 */
export function queryMemoryGraph(
  graph: MemoryGraph,
  query: GraphQuery,
  config?: Partial<TraversalConfig>,
): MemoryItem[] {
  const result = graph.traverse(query, config);

  return result.activatedNodes.map(a => ({
    id: a.node.id,
    source: mapSource(a.node.source),
    content: a.node.content,
    relevanceScore: a.activation,
    emotionalMatch: a.node.emotionalSignature.dominantEmotion,
    timestamp: a.node.createdAt,
    metadata: {
      ...a.node.metadata,
      graphDepth: a.depth,
      activationCount: a.node.activationCount,
      tags: a.node.tags,
    },
  }));
}

/** 将 MemoryNodeSource 映射到 MemoryItem 的 MemorySource */
function mapSource(source: MemoryNodeSource): MemorySource {
  switch (source) {
    case 'episodic': return 'episodic';
    case 'semantic': return 'semantic';
    case 'discovery': return 'curiosity';
    case 'thought': return 'pattern'; // thought 映射到 pattern（认知模式）
  }
}

// ════════════════════════════════════════════════════════════
// 6. 工具函数
// ════════════════════════════════════════════════════════════

export interface EpisodicArchiveSyncReport {
  synced: number;
  archivedNodes: string[];
}

/**
 * v1.3 对象库收敛：让图谱中的 episodic 节点跟随情景记忆状态。
 * episodic 被整合层归档(archived)/移除后，其 graph 视图节点也应归档，
 * 避免"对象已回收、图谱仍在召回"的副本漂移。
 * @param graph  目标图谱
 * @param episodesById 当前活跃情景记忆 id 集合（来自 episodic store）
 */
export function syncEpisodicArchivedNodes(
  graph: MemoryGraph,
  episodesById: ReadonlySet<string>,
): EpisodicArchiveSyncReport {
  const report: EpisodicArchiveSyncReport = { synced: 0, archivedNodes: [] };
  for (const node of graph.getAllNodes()) {
    if (node.source !== 'episodic' || node.archived) continue;
    if (!episodesById.has(node.sourceId)) {
      node.archived = true;
      report.synced++;
      report.archivedNodes.push(node.id);
    }
  }
  return report;
}

/**
 * v1.14 情景记忆 → 图谱补全（backfill）。
 *
 * 背景：`createNodeFromEpisode` 早已写好，但**生产代码从未调用** →
 * 新记忆只有 episodic 存储、图谱里没有节点，BFS 召回看不到它们
 * （实测 26 条 episode 却只有 19 个 episodic 节点，7 条"孤儿记忆"）。
 *
 * 幂等：`addNode` 对同一 (source, sourceId) 会复用既有节点，因此本函数可重复执行。
 * 已归档的 episode 不补（避免把"已遗忘"的记忆重新拉回活跃图谱）。
 */
export function backfillEpisodicNodes(
  graph: MemoryGraph,
  episodes: readonly EpisodicMemory[],
): { added: number; reused: number; skippedArchived: number } {
  const existing = new Set(
    graph.getAllNodes()
      .filter(n => n.source === 'episodic' && !n.archived)
      .map(n => n.sourceId),
  );
  let added = 0;
  let reused = 0;
  let skippedArchived = 0;
  for (const ep of episodes ?? []) {
    if (!ep?.id) continue;
    if (existing.has(ep.id)) { reused++; continue; }
    if ((ep as { archived?: boolean }).archived) { skippedArchived++; continue; }
    try {
      graph.addNode(createNodeFromEpisode(ep));
      existing.add(ep.id);
      added++;
    } catch {
      // 单条失败不影响整批（例如字段缺失的旧数据）
      skippedArchived++;
    }
  }
  return { added, reused, skippedArchived };
}

/** 中文文本的字符 bigram（两两字符一组） */
function extractChineseBigrams(text: string): Set<string> {
  const cleaned = text.replace(/[，。；、！？\s,.\-_;:!?]/g, '');
  const bigrams = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.add(cleaned.slice(i, i + 2));
  }
  // 同时也加入单字（兼容短词）
  for (const ch of cleaned) {
    bigrams.add(ch);
  }
  return bigrams;
}

const EMOTION_MEMORY_KEYWORDS: Record<string, string[]> = {
  joy: ['开心', '高兴', '快乐', '哈哈', '美好', '幸福'],
  sad: ['难过', '伤心', '哭', '悲伤', '失落', '痛苦'],
  anger: ['生气', '愤怒', '烦', '讨厌', '不爽'],
  fear: ['害怕', '担心', '焦虑', '紧张', '不安'],
  love: ['爱', '温暖', '甜蜜', '心动', '幸福'],
  disgust: ['恶心', '反感', '讨厌'],
  calm: ['平静', '放松', '安心', '舒服', '自在'],
  lust: ['心跳', '渴望', '冲动', '诱惑'],
  greed: ['想要', '渴望', '贪', '更多'],
};

// ════════════════════════════════════════════════════════════
// 7. 全局单例
// ════════════════════════════════════════════════════════════

/** 全局记忆图谱单例（供 aiCoordinator + persistence 共享） */
export const memoryGraph = new MemoryGraph();
