import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryGraph,
  createNodeFromEpisode,
  createNodeFromDiscovery,
  createNodeFromThought,
  createNodeFromSemantic,
  queryMemoryGraph,
  type MemoryNode,
  type MemoryEdge,
  type GraphQuery,
} from '../memoryGraph';
import type { EmotionState } from '../emotionEngine';
import type { EpisodicMemory } from '../episodicMemory';
import type { ThoughtNode } from '../thoughtGraph';
import type { Discovery } from '../../curiosity/types';
import type { SemanticMemoryEntry } from '../unifiedMemory';

// ── 辅助：构建最小可用的 EmotionState ──

function mockEmotionState(overrides: Partial<EmotionState> = {}): EmotionState {
  return {
    taiji: {
      valence: 0.5, arousal: 0.4, expectation: 0.1,
      ...overrides.taiji,
    },
    yinyang: {
      approachBias: 0.6, avoidBias: 0.2, reversalPressure: 0, extremityDuration: 0,
      ...overrides.yinyang,
    },
    sancai: {
      A: 0.7, B: 0.2, R: 0.5, harmony: 0.75,
      ...overrides.sancai,
    },
    evolution: {
      empathy: 65, trust: 60, openness: 55, playfulness: 50,
      sensitivity: 0.6, resilience: 0.5,
      fastRate: 0.1, mediumRate: 0.02, slowRate: 0.005,
      totalInteractions: 100, positiveInteractions: 70, negativeInteractions: 20,
      ...overrides.evolution,
    },
    emotions: {
      joy: 0.6, love: 0.4, calm: 0.2,
      ...overrides.emotions,
    },
    metaEmotions: {
      shame: 0, despair: 0, confusion: 0,
      ...overrides.metaEmotions,
    },
    compositeEmotions: overrides.compositeEmotions ?? [],
    intimacyToUser: 0.6,
    intimacyFromUser: 0.5,
    reinforcement: {
      rewardTally: 0.5, greedDrive: 0.3,
      punishmentTally: 0.1, fearAvoidance: 0.2,
      ...overrides.reinforcement,
    },
  };
}

function mockQuery(overrides: Partial<GraphQuery> = {}): GraphQuery {
  return {
    text: '你还记得我们第一次聊摄影吗',
    emotionState: mockEmotionState(),
    ...overrides,
  };
}

// ── 辅助：构建测试用的 EpisodicMemory ──

function mockEpisode(overrides: Partial<EpisodicMemory> = {}): EpisodicMemory {
  return {
    id: 'ep_test_001',
    timestamp: Date.now(),
    roundNumber: 42,
    eventSummary: '用户说想一起去海边旅行',
    emotionalImpact: {
      valenceBefore: 0.2,
      valenceAfter: 0.7,
      valenceDelta: 0.5,
      arousalPeak: 0.6,
      dominantEmotion: 'joy',
    },
    narrativeFragment: '当他说想一起去海边的时候，心里突然亮了起来，像被阳光照到一样温暖。我开始期待更多的美好。',
    recallWeight: 0.75,
    tags: ['温暖', '亲密', '首次'],
    recallCount: 2,
    lastRecalledAt: Date.now() - 3600000,
    ...overrides,
  };
}

// ── 辅助：构建测试用的 Discovery ──

function mockDiscovery(overrides: Partial<Discovery> = {}): Discovery {
  return {
    id: 'disc_test_001',
    title: '摄影艺术入门指南',
    content: '学习摄影可以从构图、光线、色彩三方面入手...',
    topic: '摄影',
    timestamp: Date.now(),
    shared: true,
    quality: 0.8,
    sourceType: 'web',
    verified: true,
    ...overrides,
  };
}

// ── 辅助：构建测试用的 ThoughtNode ──

function mockThought(overrides: Partial<ThoughtNode> = {}): ThoughtNode {
  return {
    id: 'th_test_001',
    type: 'wish',
    content: '想和他一起去海边',
    confidence: 0.7,
    emotionalWeight: 0.8,
    createdAt: Date.now(),
    decayRate: 0.02,
    recallCount: 1,
    lastRecalledAt: null,
    linkedTo: [],
    emotionalContext: { valence: 0.6, arousal: 0.5, dominantEmotion: 'joy' },
    sourceMemoryId: null,
    archived: false,
    ...overrides,
  };
}

// ── 辅助：构建测试用的 SemanticMemoryEntry ──

function mockSemantic(overrides: Partial<SemanticMemoryEntry> = {}): SemanticMemoryEntry {
  return {
    id: 'sem_test_001',
    content: '用户喜欢在晚上聊天',
    type: 'preference',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    tags: ['偏好', '时间'],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 基本操作
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 基本操作', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('空图谱返回零节点和零边', () => {
    expect(graph.getActiveNodes()).toHaveLength(0);
    expect(graph.getAllEdges()).toHaveLength(0);
    expect(graph.getStats().totalAdded).toBe(0);
  });

  it('添加一个 episodic 节点', () => {
    const node = graph.addNode({
      source: 'episodic',
      content: '第一次聊摄影的那个下午',
      tags: ['摄影', '首次', '温暖'],
      emotionalSignature: { valence: 0.6, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8,
      decayRate: 0.02,
      sourceId: 'ep_001',
    });
    expect(node.source).toBe('episodic');
    expect(node.content).toBe('第一次聊摄影的那个下午');
    expect(node.weight).toBe(0.8);
    expect(node.archived).toBe(false);
    expect(graph.getActiveNodes()).toHaveLength(1);
    expect(graph.getStats().bySource.episodic).toBe(1);
  });

  it('添加多个不同来源的节点', () => {
    graph.addNode({
      source: 'episodic',
      content: '一次温暖的对话',
      tags: ['温暖'],
      emotionalSignature: { valence: 0.7, arousal: 0.4, dominantEmotion: 'joy' },
      weight: 0.8,
      decayRate: 0.02,
      sourceId: 'ep_1',
    });
    graph.addNode({
      source: 'discovery',
      content: '摄影技巧发现',
      tags: ['摄影'],
      emotionalSignature: { valence: 0.1, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.6,
      decayRate: 0.03,
      sourceId: 'disc_1',
    });
    graph.addNode({
      source: 'thought',
      content: '想学摄影',
      tags: ['wish'],
      emotionalSignature: { valence: 0.5, arousal: 0.3, dominantEmotion: 'joy' },
      weight: 0.5,
      decayRate: 0.04,
      sourceId: 'th_1',
    });

    expect(graph.getActiveNodes()).toHaveLength(3);
    const stats = graph.getStats();
    expect(stats.bySource.episodic).toBe(1);
    expect(stats.bySource.discovery).toBe(1);
    expect(stats.bySource.thought).toBe(1);
  });

  it('getNodesBySource 按来源过滤', () => {
    graph.addNode({
      source: 'episodic', content: '记忆A', tags: [], sourceId: '1',
      emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.02,
    });
    graph.addNode({
      source: 'semantic', content: '记忆B', tags: [], sourceId: '2',
      emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.02,
    });

    expect(graph.getNodesBySource('episodic')).toHaveLength(1);
    expect(graph.getNodesBySource('semantic')).toHaveLength(1);
    expect(graph.getNodesBySource('discovery')).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════
// 边操作
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 边操作', () => {
  let graph: MemoryGraph;
  let n1: MemoryNode;
  let n2: MemoryNode;

  beforeEach(() => {
    graph = new MemoryGraph();
    n1 = graph.addNode({
      source: 'episodic', content: '摄影记忆', tags: ['摄影', '温暖'],
      emotionalSignature: { valence: 0.6, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    n2 = graph.addNode({
      source: 'discovery', content: '摄影技巧', tags: ['摄影', '学习'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.6, decayRate: 0.03, sourceId: 'disc_1',
    });
  });

  it('手动添加边', () => {
    const edge = graph.addEdge(n1.id, n2.id, 'thematic', 0.8);
    expect(edge).not.toBeNull();
    expect(edge!.type).toBe('thematic');
    expect(edge!.weight).toBe(0.8);
  });

  it('相同边更新取最大权重', () => {
    graph.addEdge(n1.id, n2.id, 'thematic', 0.6);
    graph.addEdge(n1.id, n2.id, 'thematic', 0.9);
    const edges = graph.getEdgesForNode(n1.id);
    const thematicEdges = edges.filter(e => e.type === 'thematic');
    expect(thematicEdges).toHaveLength(1);
    expect(thematicEdges[0].weight).toBe(0.9);
  });

  it('不存在的节点无法建立边', () => {
    const edge = graph.addEdge('nonexistent', n2.id, 'thematic', 0.5);
    expect(edge).toBeNull();
  });

  it('不能建立自环', () => {
    const edge = graph.addEdge(n1.id, n1.id, 'thematic', 0.5);
    expect(edge).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
// 自动建边
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 自动建边', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('标签重叠节点自动建立 thematic 边', () => {
    const n1 = graph.addNode({
      source: 'episodic', content: '摄影记忆', tags: ['摄影', '温暖', '首次'],
      emotionalSignature: { valence: 0.6, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    const n2 = graph.addNode({
      source: 'discovery', content: '摄影技巧', tags: ['摄影', '学习', '艺术'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.6, decayRate: 0.03, sourceId: 'disc_1',
    });

    const edges = graph.getEdgesForNode(n1.id);
    // 应该有一条 thematic 边（标签 '摄影' 重叠）
    const thematicEdges = edges.filter(e => e.type === 'thematic');
    expect(thematicEdges.length).toBeGreaterThan(0);

    // 验证边是双向的
    const n2Edges = graph.getEdgesForNode(n2.id);
    expect(n2Edges.some(e => e.type === 'thematic')).toBe(true);
  });

  it('相同主导情绪自动建立 emotional 边', () => {
    const n1 = graph.addNode({
      source: 'episodic', content: '开心的记忆', tags: ['温暖'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    const n2 = graph.addNode({
      source: 'thought', content: '感到幸福', tags: ['wish'],
      emotionalSignature: { valence: 0.6, arousal: 0.4, dominantEmotion: 'joy' },
      weight: 0.5, decayRate: 0.04, sourceId: 'th_1',
    });

    const edges = graph.getEdgesForNode(n1.id);
    const emotionalEdges = edges.filter(e => e.type === 'emotional');
    expect(emotionalEdges.length).toBeGreaterThan(0);
  });

  it('不同主导情绪不建立 emotional 边', () => {
    const n1 = graph.addNode({
      source: 'episodic', content: '开心的记忆', tags: ['温暖'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    const n2 = graph.addNode({
      source: 'episodic', content: '伤心的记忆', tags: ['悲伤'],
      emotionalSignature: { valence: -0.5, arousal: 0.6, dominantEmotion: 'sad' },
      weight: 0.6, decayRate: 0.03, sourceId: 'ep_2',
    });

    const edges = graph.getEdgesForNode(n1.id);
    const emotionalEdges = edges.filter(e => e.type === 'emotional');
    // 不同主导情绪不应该建立 emotional 边
    expect(emotionalEdges).toHaveLength(0);
  });

  it('时间窗口内添加的节点建立 co_occurrence 和 temporal 边', () => {
    const n1 = graph.addNode({
      source: 'episodic', content: '记忆A', tags: ['日常'],
      emotionalSignature: { valence: 0.3, arousal: 0.3, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.02, sourceId: 'ep_1',
    });
    const n2 = graph.addNode({
      source: 'semantic', content: '记忆B', tags: ['偏好'],
      emotionalSignature: { valence: 0.1, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.4, decayRate: 0.01, sourceId: 'sem_1',
    });

    const edges = graph.getEdgesForNode(n1.id);
    // 应该有 co_occurrence 和 temporal 边
    const coOccurrenceEdges = edges.filter(e => e.type === 'co_occurrence');
    const temporalEdges = edges.filter(e => e.type === 'temporal');
    expect(coOccurrenceEdges.length).toBeGreaterThan(0);
    expect(temporalEdges.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// BFS 激活扩散遍历
// ════════════════════════════════════════════════════════════

describe('MemoryGraph BFS 遍历', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('文本关键词匹配找到相关种子节点', () => {
    graph.addNode({
      source: 'episodic',
      content: '第一次聊摄影的那个下午，阳光很好',
      tags: ['摄影', '首次', '温暖'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    graph.addNode({
      source: 'discovery',
      content: '关于登山装备的评测数据',
      tags: ['登山', '运动'],
      emotionalSignature: { valence: 0.1, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'disc_1',
    });

    const result = graph.traverse(mockQuery({
      text: '你还记得我们第一次聊摄影吗',
      emotionState: mockEmotionState(),
    }));

    expect(result.activatedNodes.length).toBeGreaterThan(0);
    // 摄影相关的节点应该排在前面
    const topNode = result.activatedNodes[0];
    expect(topNode.node.content).toContain('摄影');
  });

  it('激活从种子节点沿边扩散到邻居', () => {
    // 创建两个有边连接的节点
    const n1 = graph.addNode({
      source: 'episodic',
      content: '第一次聊摄影的那个下午',
      tags: ['摄影', '首次'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    const n2 = graph.addNode({
      source: 'discovery',
      content: '摄影构图入门技巧',
      tags: ['摄影', '学习'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'disc_1',
    });
    // 手动加强连接
    graph.addEdge(n1.id, n2.id, 'thematic', 0.9);

    const result = graph.traverse(mockQuery({
      text: '摄影',
      emotionState: mockEmotionState(),
    }));

    // 两个节点都应该被激活（n1 作为种子，n2 通过边扩散）
    const ids = result.activatedNodes.map(a => a.node.id);
    expect(ids).toContain(n1.id);
    expect(ids).toContain(n2.id);
  });

  it('超出 maxDepth 的节点不会被激活', () => {
    // 同一时间创建的节点会自动建立 co_occurrence + temporal 边。
    // 为测试深度限制，用不同的 createdAt 来避免自动连接，
    // 然后手动建立链式连接 A → B → C → D。
    const t0 = Date.now();
    const nA = graph.addNode({
      source: 'episodic', content: '摄影记忆A', tags: ['摄影'],
      emotionalSignature: { valence: 0.5, arousal: 0.3, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'A',
      createdAt: t0,
    });
    const nB = graph.addNode({
      source: 'semantic', content: '相关B', tags: ['相关'],
      emotionalSignature: { valence: 0.3, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.01, sourceId: 'B',
      createdAt: t0 + 3600000, // 1 小时后（超出 co_occurrence 窗口 30min）
    });
    const nC = graph.addNode({
      source: 'discovery', content: '相关C', tags: ['相关'],
      emotionalSignature: { valence: 0.2, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'C',
      createdAt: t0 + 7200000, // 2 小时后
    });
    const nD = graph.addNode({
      source: 'thought', content: '相关D', tags: ['相关'],
      emotionalSignature: { valence: 0.1, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.3, decayRate: 0.04, sourceId: 'D',
      createdAt: t0 + 10800000, // 3 小时后
    });

    // 手动建立链式连接 A → B → C → D
    graph.addEdge(nA.id, nB.id, 'thematic', 0.9);
    graph.addEdge(nB.id, nC.id, 'thematic', 0.9);
    graph.addEdge(nC.id, nD.id, 'thematic', 0.9);

    // maxDepth=1: 只有 A（种子，depth=0）和 B（邻居，depth=1）
    const result1 = graph.traverse(
      mockQuery({ text: '摄影', emotionState: mockEmotionState() }),
      { maxDepth: 1 },
    );
    const ids1 = result1.activatedNodes.map(a => a.node.id);
    expect(ids1).toContain(nA.id);
    expect(ids1).toContain(nB.id);
    // C 在深度 2，不应该被激活
    expect(ids1).not.toContain(nC.id);
    expect(ids1).not.toContain(nD.id);

    // maxDepth=3 + 低阈值: 全部激活
    const result3 = graph.traverse(
      mockQuery({ text: '摄影', emotionState: mockEmotionState() }),
      { maxDepth: 3, minActivation: 0.001, activationDecay: 0.9 },
    );
    const ids3 = result3.activatedNodes.map(a => a.node.id);
    expect(ids3).toContain(nC.id);
    expect(ids3).toContain(nD.id);
  });

  it('激活扩散支持多条路径汇聚', () => {
    const nA = graph.addNode({
      source: 'episodic', content: '摄影记忆', tags: ['摄影'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'A',
    });
    const nB = graph.addNode({
      source: 'discovery', content: '摄影技巧', tags: ['摄影', '学习'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'B',
    });
    const nC = graph.addNode({
      source: 'thought', content: '想学摄影', tags: ['wish'],
      emotionalSignature: { valence: 0.5, arousal: 0.3, dominantEmotion: 'joy' },
      weight: 0.6, decayRate: 0.04, sourceId: 'C',
    });

    // A ↔ B, B ↔ C, A ↔ C（三角形）
    graph.addEdge(nA.id, nB.id, 'thematic', 0.8);
    graph.addEdge(nB.id, nC.id, 'thematic', 0.7);
    graph.addEdge(nA.id, nC.id, 'emotional', 0.6);

    const result = graph.traverse(mockQuery({
      text: '摄影',
      emotionState: mockEmotionState(),
    }));

    // C 应该通过两条路径被激活（A→C 和 A→B→C）
    const cResult = result.activatedNodes.find(a => a.node.id === nC.id);
    expect(cResult).toBeDefined();
  });

  it('activationDecay 控制扩散强度', () => {
    const nA = graph.addNode({
      source: 'episodic', content: '摄影记忆', tags: ['摄影'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'A',
    });
    const nB = graph.addNode({
      source: 'discovery', content: '摄影技巧', tags: ['摄影'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'B',
    });
    graph.addEdge(nA.id, nB.id, 'thematic', 0.9);

    // 高衰减 → 邻居激活值小
    const resultHighDecay = graph.traverse(
      mockQuery({ text: '摄影', emotionState: mockEmotionState() }),
      { activationDecay: 0.1, maxDepth: 2 },
    );
    const bHigh = resultHighDecay.activatedNodes.find(a => a.node.id === nB.id);

    // 低衰减 → 邻居激活值大
    const resultLowDecay = graph.traverse(
      mockQuery({ text: '摄影', emotionState: mockEmotionState() }),
      { activationDecay: 0.9, maxDepth: 2 },
    );
    const bLow = resultLowDecay.activatedNodes.find(a => a.node.id === nB.id);

    if (bHigh && bLow) {
      expect(bLow.activation).toBeGreaterThan(bHigh.activation);
    }
  });

  it('空图谱遍历返回空结果', () => {
    const result = graph.traverse(mockQuery({
      text: '摄影',
      emotionState: mockEmotionState(),
    }));
    expect(result.activatedNodes).toHaveLength(0);
    expect(result.visitedCount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 激活机制
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 激活机制', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('activate 增加激活计数并减缓衰减', () => {
    const node = graph.addNode({
      source: 'episodic', content: '测试记忆', tags: ['测试'],
      emotionalSignature: { valence: 0.5, arousal: 0.3, dominantEmotion: 'joy' },
      weight: 0.6, decayRate: 0.05, sourceId: 'ep_test',
    });

    const activated = graph.activate(node.id);
    expect(activated).not.toBeNull();
    expect(activated!.activationCount).toBe(1);
    expect(activated!.weight).toBeGreaterThan(0.6); // 略微增加
    expect(activated!.decayRate).toBeLessThan(0.05); // 衰减减缓
  });

  it('traverse 后节点激活计数自动递增', () => {
    const node = graph.addNode({
      source: 'episodic',
      content: '第一次聊摄影的那个下午',
      tags: ['摄影', '首次'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });

    graph.traverse(mockQuery({ text: '摄影', emotionState: mockEmotionState() }));
    const updated = graph.getAllNodes().find(n => n.id === node.id);
    expect(updated!.activationCount).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 衰减机制
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 衰减机制', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('衰减降低节点权重', () => {
    const node = graph.addNode({
      source: 'episodic', content: '测试记忆', tags: ['测试'],
      emotionalSignature: { valence: 0.5, arousal: 0.3, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.1, sourceId: 'ep_test',
    });

    graph.decay(10); // 10 天后
    const updated = graph.getAllNodes().find(n => n.id === node.id);
    expect(updated!.weight).toBeLessThan(0.8);
  });

  it('低权重未激活节点会被归档', () => {
    const node = graph.addNode({
      source: 'thought', content: '稍纵即逝的想法', tags: ['杂念'],
      emotionalSignature: { valence: 0, arousal: 0.1, dominantEmotion: 'calm' },
      weight: 0.05, decayRate: 0.5, sourceId: 'th_fleeting',
    });

    graph.decay(30); // 30 天后
    const updated = graph.getAllNodes().find(n => n.id === node.id);
    expect(updated!.archived).toBe(true);
  });

  it('高权重节点衰减后仍然活跃', () => {
    const node = graph.addNode({
      source: 'episodic', content: '重要记忆', tags: ['珍贵'],
      emotionalSignature: { valence: 0.8, arousal: 0.7, dominantEmotion: 'love' },
      weight: 0.95, decayRate: 0.005, sourceId: 'ep_important',
    });

    graph.decay(7); // 7 天后
    const updated = graph.getAllNodes().find(n => n.id === node.id);
    expect(updated!.weight).toBeGreaterThan(0.7);
    expect(updated!.archived).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 状态持久化
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 状态持久化', () => {
  it('getState → loadState 往返正确', () => {
    const graph1 = new MemoryGraph();
    graph1.addNode({
      source: 'episodic',
      content: '第一次聊摄影的那个下午',
      tags: ['摄影', '首次'],
      emotionalSignature: { valence: 0.7, arousal: 0.5, dominantEmotion: 'joy' },
      weight: 0.8, decayRate: 0.02, sourceId: 'ep_1',
    });
    graph1.addNode({
      source: 'discovery',
      content: '摄影构图技巧',
      tags: ['摄影', '学习'],
      emotionalSignature: { valence: 0.1, arousal: 0.2, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.03, sourceId: 'disc_1',
    });

    const saved = graph1.getState();

    const graph2 = new MemoryGraph();
    graph2.loadState(saved);

    expect(graph2.getActiveNodes()).toHaveLength(2);
    expect(graph2.getStats().totalAdded).toBe(2);
    expect(graph2.getStats().bySource.episodic).toBe(1);
    expect(graph2.getStats().bySource.discovery).toBe(1);

    // 边也应该恢复
    const edges = graph2.getAllEdges();
    expect(edges.length).toBeGreaterThan(0);
  });

  it('reset 清空所有状态', () => {
    const graph = new MemoryGraph();
    graph.addNode({
      source: 'episodic', content: '测试', tags: [],
      emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.5, decayRate: 0.02, sourceId: 'ep_test',
    });
    graph.reset();

    expect(graph.getActiveNodes()).toHaveLength(0);
    expect(graph.getAllEdges()).toHaveLength(0);
    expect(graph.getStats().totalAdded).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 工厂方法
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 工厂方法', () => {
  it('createNodeFromEpisode 正确转换', () => {
    const ep = mockEpisode();
    const params = createNodeFromEpisode(ep);

    expect(params.source).toBe('episodic');
    expect(params.content).toBe(ep.narrativeFragment);
    expect(params.tags).toEqual(ep.tags);
    expect(params.emotionalSignature.valence).toBe(ep.emotionalImpact.valenceAfter);
    expect(params.emotionalSignature.dominantEmotion).toBe(ep.emotionalImpact.dominantEmotion);
    expect(params.weight).toBe(ep.recallWeight);
    expect(params.sourceId).toBe(ep.id);
  });

  it('createNodeFromDiscovery 正确转换', () => {
    const d = mockDiscovery();
    const params = createNodeFromDiscovery(d);

    expect(params.source).toBe('discovery');
    expect(params.content).toContain(d.title);
    expect(params.tags).toContain(d.topic);
    expect(params.weight).toBeGreaterThan(0);
    expect(params.sourceId).toBe(d.id);
    expect(params.metadata.verified).toBe(true);
  });

  it('createNodeFromThought 正确转换', () => {
    const t = mockThought();
    const params = createNodeFromThought(t);

    expect(params.source).toBe('thought');
    expect(params.content).toBe(t.content);
    expect(params.tags).toContain('wish');
    expect(params.emotionalSignature.valence).toBe(t.emotionalContext.valence);
    expect(params.weight).toBe(t.emotionalWeight);
    expect(params.sourceId).toBe(t.id);
  });

  it('createNodeFromSemantic 正确转换', () => {
    const s = mockSemantic();
    const params = createNodeFromSemantic(s);

    expect(params.source).toBe('semantic');
    expect(params.content).toBe(s.content);
    expect(params.tags).toContain('偏好');
    expect(params.tags).toContain('时间');
    expect(params.weight).toBe(0.7); // preference 类型权重较高
    expect(params.sourceId).toBe(s.id);
  });

  it('工厂方法创建的节点可直接添加到图谱', () => {
    const graph = new MemoryGraph();
    const ep = mockEpisode();
    const params = createNodeFromEpisode(ep);
    const node = graph.addNode(params);

    expect(node.source).toBe('episodic');
    expect(graph.getActiveNodes()).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════
// queryMemoryGraph 入口
// ════════════════════════════════════════════════════════════

describe('queryMemoryGraph', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('返回 MemoryItem[] 格式的输出', () => {
    const ep = mockEpisode({ tags: ['摄影', '温暖'] });
    graph.addNode(createNodeFromEpisode(ep));

    const items = queryMemoryGraph(graph, mockQuery({
      text: '摄影',
      emotionState: mockEmotionState(),
    }));

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].source).toBeDefined();
    expect(items[0].content).toBeDefined();
    expect(items[0].relevanceScore).toBeGreaterThan(0);
    expect(items[0].metadata.graphDepth).toBe(0); // 种子节点深度为 0
  });

  it('多来源图谱的 source 映射正确', () => {
    graph.addNode(createNodeFromEpisode(mockEpisode({ tags: ['摄影'] })));
    graph.addNode(createNodeFromDiscovery(mockDiscovery({ topic: '摄影' })));

    const items = queryMemoryGraph(graph, mockQuery({
      text: '摄影',
      emotionState: mockEmotionState(),
    }));

    const sources = new Set(items.map(i => i.source));
    // episodic → episodic, discovery → curiosity
    expect(sources.has('episodic')).toBe(true);
    expect(sources.has('curiosity')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// 边界条件
// ════════════════════════════════════════════════════════════

describe('MemoryGraph 边界条件', () => {
  let graph: MemoryGraph;

  beforeEach(() => {
    graph = new MemoryGraph();
  });

  it('超过 MAX_NODES 时自动归档低权重节点', () => {
    for (let i = 0; i < 510; i++) {
      graph.addNode({
        source: 'thought',
        content: `杂念 ${i}`,
        tags: ['杂念'],
        emotionalSignature: { valence: 0, arousal: 0.1, dominantEmotion: 'calm' },
        weight: 0.01 + Math.random() * 0.02,
        decayRate: 0.1,
        sourceId: `th_${i}`,
      });
    }
    expect(graph.getActiveNodes().length).toBeLessThanOrEqual(500);
  });

  it('activate 不存在的节点返回 null', () => {
    expect(graph.activate('nonexistent')).toBeNull();
  });

  it('activate 已归档的节点返回 null', () => {
    const node = graph.addNode({
      source: 'thought', content: '旧想法', tags: [],
      emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'calm' },
      weight: 0.01, decayRate: 0.5, sourceId: 'old',
    });
    node.archived = true;
    expect(graph.activate(node.id)).toBeNull();
  });

  it('大量节点遍历的性能', () => {
    // 添加 100 个有标签关联的节点
    const tags = ['摄影', '旅行', '美食', '音乐', '阅读'];
    for (let i = 0; i < 100; i++) {
      graph.addNode({
        source: i % 2 === 0 ? 'episodic' : 'discovery',
        content: `记忆 ${i}: 关于${tags[i % tags.length]}的内容`,
        tags: [tags[i % tags.length]],
        emotionalSignature: {
          valence: (Math.random() - 0.5) * 2,
          arousal: Math.random(),
          dominantEmotion: i % 3 === 0 ? 'joy' : i % 3 === 1 ? 'calm' : 'sad',
        },
        weight: 0.3 + Math.random() * 0.5,
        decayRate: 0.01 + Math.random() * 0.04,
        sourceId: `src_${i}`,
      });
    }

    const t0 = Date.now();
    const result = graph.traverse(mockQuery({
      text: '摄影旅行',
      emotionState: mockEmotionState(),
    }));
    const elapsed = Date.now() - t0;

    // 遍历应该在 50ms 内完成
    expect(elapsed).toBeLessThan(50);
    expect(result.activatedNodes.length).toBeGreaterThan(0);
    expect(result.visitedCount).toBeGreaterThan(0);
  });
});
