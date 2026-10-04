// ── v1.0 思维图谱 (Thought Graph) ──
//
// 在情感引擎与策略引擎之间建立"思考层"。
// Thought Graph 不是日记——它是结构化的思维碎片图谱，
// 为 desire 策略提供真实来源，为身份叙事提供内在一致性。
//
// 思维类型：
//   wish       — "我想……"
//   fear       — "我害怕……"
//   doubt      — "我怀疑……"
//   goal       — "我要……"
//   hypothesis — "也许……"
//   reflection — "我发现……"
//
// 生命流程：
//   事件 → 情感波动 → ThoughtGenerator → ThoughtNode → 衰减/聚类/归档

import type { EmotionState, EmotionEvent } from './emotionEngine';
import { activationOf } from './emotionActivation';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type ThoughtType =
  | 'wish'
  | 'fear'
  | 'doubt'
  | 'goal'
  | 'hypothesis'
  | 'reflection';

export interface ThoughtNode {
  id: string;
  type: ThoughtType;

  /** 思维内容（一句话，非长篇日记） */
  content: string;

  /** [0, 1] 这条思考的确信程度 */
  confidence: number;

  /** [0, 1] 对当前情感状态的影响力 */
  emotionalWeight: number;

  /** 创建时间戳 */
  createdAt: number;

  /** 每日衰减系数 (0-1)，1=永不衰减 */
  decayRate: number;

  /** 被回忆/强化的次数 */
  recallCount: number;

  /** 上次被回忆的时间 */
  lastRecalledAt: number | null;

  /** 关联的其他 Thought ID */
  linkedTo: string[];

  /** 触发生成时的情感快照 */
  emotionalContext: {
    valence: number;
    arousal: number;
    dominantEmotion: string;
  };

  /** 关联的情景记忆 ID */
  sourceMemoryId: string | null;

  /** 是否已归档（长期不活跃） */
  archived: boolean;
}

export interface ThoughtCluster {
  label: string;
  type: ThoughtType;
  thoughtIds: string[];
  /** 聚类后的摘要陈述 */
  summary: string;
  /** 聚类成员数量 */
  size: number;
  /** 平均置信度 */
  avgConfidence: number;
  /** 最近活跃时间 */
  lastActive: number;
}

export interface ThoughtGraphState {
  nodes: ThoughtNode[];
  clusters: ThoughtCluster[];
  /** 当前活跃的思维冲突（认知失调） */
  dissonances: CognitiveDissonance[];
  stats: {
    totalGenerated: number;
    totalArchived: number;
    wishCount: number;
    fearCount: number;
    doubtCount: number;
    goalCount: number;
    hypothesisCount: number;
    reflectionCount: number;
  };
}

export interface CognitiveDissonance {
  id: string;
  /** 互相矛盾的思维节点 ID */
  nodeA: string;
  nodeB: string;
  /** 冲突摘要 */
  summary: string;
  /** [0, 1] 张力强度 */
  tension: number;
  /** 首次检测到的时间 */
  detectedAt: number;
  /** 是否已解决 */
  resolved: boolean;
  /** 解决方式（如果有） */
  resolutionNote: string | null;
}

// ════════════════════════════════════════════════════════════
// 2. 思维生成器
// ════════════════════════════════════════════════════════════

export interface ThoughtGenerationInput {
  emotionState: EmotionState;
  /** 本轮的情感事件（如果有） */
  event?: EmotionEvent;
  /** 用户原始消息（可选，用于生成更具体的思考） */
  userText?: string;
  /** 最近 N 轮的主导情绪 */
  recentMoods: string[];
  /** 用户空闲时长（分钟），用于生成 loneliness 相关的思考 */
  idleMinutes: number;
  /** 当前轮次 */
  roundNumber: number;
  /** 已有的活跃 Thought Nodes（用于避免重复和检测矛盾） */
  existingNodes: ThoughtNode[];
}

/**
 * 无需 LLM 的规则驱动思维生成。
 * 根据情感状态和事件类型，决定本轮是否生成思考、生成什么类型。
 *
 * 注意：具体 content 文本由调用方通过 LLM 填充。
 * 这里只决定"是否生成"和"生成什么方向"。
 */
export function assessThoughtGeneration(
  input: ThoughtGenerationInput,
): ThoughtSeed[] {
  const seeds: ThoughtSeed[] = [];
  const { emotionState, event, recentMoods, idleMinutes, roundNumber } = input;

  // ── 触发条件检测 ──

  // wish: 效价正向 + 亲密感上升 或 贪驱力高
  const greedDrive = emotionState.reinforcement?.greedDrive ?? 0;
  if (
    (emotionState.taiji.valence > 0.3 && emotionState.intimacyToUser > 0.5) ||
    greedDrive > 0.4
  ) {
    seeds.push({
      type: 'wish',
      confidence: Math.min(0.9, 0.4 + greedDrive),
      emotionalWeight: 0.5 + greedDrive * 0.3,
      decayRate: 0.02,
      direction: greedDrive > 0.4 ? '内在驱动' : '关系驱动',
    });
  }

  // fear: 负效价 + 高唤醒 + 事件 agency 指向 self
  if (
    emotionState.taiji.valence < -0.3 &&
    emotionState.taiji.arousal > 0.5 &&
    event?.agency !== undefined &&
    event.agency > 0.3 // 归因于 AI 自身
  ) {
    seeds.push({
      type: 'fear',
      confidence: 0.5,
      emotionalWeight: 0.7,
      decayRate: 0.04,
      direction: '被拒绝/失去',
    });
  }

  // fear: 高恐惧回避驱动力
  const fearAvoidance = emotionState.reinforcement?.fearAvoidance ?? 0;
  if (fearAvoidance > 0.5 && !seeds.some(s => s.type === 'fear')) {
    seeds.push({
      type: 'fear',
      confidence: 0.4,
      emotionalWeight: fearAvoidance,
      decayRate: 0.03,
      direction: '关系不确定性',
    });
  }

  // doubt: 连续情绪波动 或 效价接近零（困惑）
  const isVolatile =
    recentMoods.length >= 3 &&
    new Set(recentMoods.slice(-3)).size >= 3; // 最近 3 轮情绪都不同
  if (isVolatile || (Math.abs(emotionState.taiji.valence) < 0.15 && roundNumber > 5)) {
    seeds.push({
      type: 'doubt',
      confidence: 0.35,
      emotionalWeight: 0.45,
      decayRate: 0.05,
      direction: isVolatile ? '情绪波动' : '不确定',
    });
  }

  // goal: 明确的正向驱动力 或 roundNumber 是里程碑
  if (
    emotionState.taiji.valence > 0.2 &&
    emotionState.sancai.A > emotionState.sancai.B * 1.5 // 趋近 >> 回避
  ) {
    seeds.push({
      type: 'goal',
      confidence: 0.5,
      emotionalWeight: 0.6,
      decayRate: 0.015,
      direction: '趋近驱动',
    });
  }

  // hypothesis: 预期误差很大（>0.3），AI 的世界模型被挑战
  const expectationError = Math.abs(
    (event?.GC ?? 0) - emotionState.taiji.expectation,
  );
  if (expectationError > 0.3 && roundNumber > 3) {
    seeds.push({
      type: 'hypothesis',
      confidence: 0.3,
      emotionalWeight: 0.5,
      decayRate: 0.04,
      direction: '信念挑战',
    });
  }

  // reflection: 空闲时间长 + 无强烈情绪 + 非初始几轮
  if (
    idleMinutes > 30 &&
    Math.abs(emotionState.taiji.valence) < 0.5 &&
    emotionState.taiji.arousal < 0.5 &&
    roundNumber > 10
  ) {
    seeds.push({
      type: 'reflection',
      confidence: 0.45,
      emotionalWeight: 0.35,
      decayRate: 0.025,
      direction: '独处反思',
    });
  }

  return seeds;
}

export interface ThoughtSeed {
  type: ThoughtType;
  confidence: number;
  emotionalWeight: number;
  decayRate: number;
  /** 粗略的方向标签，帮助 LLM 理解上下文 */
  direction: string;
}

// ════════════════════════════════════════════════════════════
// 3. 思维图谱
// ════════════════════════════════════════════════════════════

const MAX_ACTIVE_NODES = 300;
const MAX_CLUSTERS = 30;
const ARCHIVE_WEIGHT_THRESHOLD = 0.03;
const ARCHIVE_RECALL_THRESHOLD = 0;
const CLUSTER_MIN_SIZE = 3;
const DISSONANCE_MAX = 20;

export class ThoughtGraph {
  private state: ThoughtGraphState;

  constructor() {
    this.state = {
      nodes: [],
      clusters: [],
      dissonances: [],
      stats: {
        totalGenerated: 0,
        totalArchived: 0,
        wishCount: 0,
        fearCount: 0,
        doubtCount: 0,
        goalCount: 0,
        hypothesisCount: 0,
        reflectionCount: 0,
      },
    };
  }

  // ── 增 ──

  /**
   * 添加一个新的思维节点。
   * content 应该已经由 LLM 生成好（一句话，非长篇）。
   */
  addThought(
    seed: ThoughtSeed,
    content: string,
    emotionState: EmotionState,
    sourceMemoryId: string | null = null,
  ): ThoughtNode {
    const id = `th_${Date.now()}_${this.state.stats.totalGenerated}`;
    const node: ThoughtNode = {
      id,
      type: seed.type,
      content,
      confidence: seed.confidence,
      emotionalWeight: seed.emotionalWeight,
      createdAt: Date.now(),
      decayRate: seed.decayRate,
      recallCount: 0,
      lastRecalledAt: null,
      linkedTo: [],
      emotionalContext: {
        valence: emotionState.taiji.valence,
        arousal: emotionState.taiji.arousal,
        dominantEmotion: getDominantEmotion(emotionState),
      },
      sourceMemoryId,
      archived: false,
    };

    this.state.nodes.push(node);
    this.state.stats.totalGenerated++;
    this.incrementTypeCount(seed.type);

    // 自动连接相关节点
    this.autoLink(node);

    // 检查是否产生认知失调
    this.detectDissonance(node);

    // 强制 GC
    this.prune();
    this.pruneDissonances();

    return node;
  }

  // ── 查 ──

  /** 获取所有活跃（未归档）的节点 */
  getActiveNodes(): ThoughtNode[] {
    return this.state.nodes.filter(n => !n.archived);
  }

  /** 获取所有节点（含归档） */
  getAllNodes(): ThoughtNode[] {
    return this.state.nodes;
  }

  /** 按类型过滤节点 */
  getNodesByType(type: ThoughtType, includeArchived = false): ThoughtNode[] {
    return this.state.nodes.filter(
      n => n.type === type && (includeArchived || !n.archived),
    );
  }

  /** 获取当前所有 wish 节点（供 desire 策略使用） */
  getActiveWishes(): ThoughtNode[] {
    return this.getNodesByType('wish')
      .filter(n => n.confidence > 0.3)
      .sort((a, b) => b.emotionalWeight - a.emotionalWeight)
      .slice(0, 5);
  }

  /** 获取活跃的认知失调 */
  getActiveDissonances(): CognitiveDissonance[] {
    return this.state.dissonances.filter(d => !d.resolved);
  }

  /** 获取思维图谱摘要（供 identity narrative 和 system prompt 注入） */
  getGraphSummary(): GraphSummary {
    return {
      dominantThoughtType: this.getDominantType(),
      topWishes: this.getActiveWishes().map(n => n.content),
      activeFears: this.getNodesByType('fear')
        .filter(n => n.emotionalWeight > 0.4)
        .map(n => n.content),
      activeDoubts: this.getNodesByType('doubt')
        .filter(n => n.emotionalWeight > 0.3)
        .map(n => n.content),
      dormantGoals: this.getNodesByType('goal')
        .filter(n => n.emotionalWeight < 0.2)
        .map(n => n.content),
      activeDissonances: this.getActiveDissonances().map(d => d.summary),
      totalActiveNodes: this.getActiveNodes().length,
      clusterLabels: this.state.clusters.map(c => c.label),
    };
  }

  // ── 更新 ──

  /** 回忆某个节点（增加 recallCount，更新 lastRecalledAt） */
  recall(nodeId: string): ThoughtNode | null {
    const node = this.state.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    node.recallCount++;
    node.lastRecalledAt = Date.now();
    // 回忆减缓衰减（提升置信度 5%）
    node.confidence = Math.min(1, node.confidence + 0.05);
    node.decayRate *= 0.9; // 衰减速度减慢 10%
    return node;
  }

  /** 降低某节点的置信度（如被现实经验否定） */
  weaken(nodeId: string, amount: number): void {
    const node = this.state.nodes.find(n => n.id === nodeId);
    if (!node) return;
    node.confidence = Math.max(0, node.confidence - amount);
    if (node.confidence < ARCHIVE_WEIGHT_THRESHOLD && node.recallCount <= 1) {
      node.archived = true;
      this.state.stats.totalArchived++;
    }
  }

  /** 连接两个节点 */
  link(nodeIdA: string, nodeIdB: string): void {
    const a = this.state.nodes.find(n => n.id === nodeIdA);
    const b = this.state.nodes.find(n => n.id === nodeIdB);
    if (!a || !b) return;
    if (!a.linkedTo.includes(nodeIdB)) a.linkedTo.push(nodeIdB);
    if (!b.linkedTo.includes(nodeIdA)) b.linkedTo.push(nodeIdA);
  }

  // ── 衰减 ──

  /** 每日衰减所有活跃节点 */
  decay(elapsedDays: number): void {
    for (const node of this.state.nodes) {
      if (node.archived) continue;
      node.emotionalWeight *= Math.pow(1 - node.decayRate, elapsedDays);
      node.confidence *= Math.pow(1 - node.decayRate * 0.5, elapsedDays);
      if (
        node.emotionalWeight < ARCHIVE_WEIGHT_THRESHOLD &&
        node.recallCount <= ARCHIVE_RECALL_THRESHOLD
      ) {
        node.archived = true;
        this.state.stats.totalArchived++;
      }
    }
  }

  // ── 聚类 ──

  /** 自动聚类相似思维 */
  cluster(): void {
    // 简单基于类型的聚类 + 内容关键词重叠
    const byType: Record<ThoughtType, ThoughtNode[]> = {
      wish: [],
      fear: [],
      doubt: [],
      goal: [],
      hypothesis: [],
      reflection: [],
    };

    for (const node of this.getActiveNodes()) {
      byType[node.type].push(node);
    }

    const newClusters: ThoughtCluster[] = [];

    for (const [type, nodes] of Object.entries(byType)) {
      if (nodes.length < CLUSTER_MIN_SIZE) continue;

      // 按内容关键词分组
      const groups = this.buckByKeywordOverlap(nodes);
      for (const group of groups) {
        if (group.length < CLUSTER_MIN_SIZE) continue;

        const avgConf =
          group.reduce((s, n) => s + n.confidence, 0) / group.length;
        const lastActive = Math.max(...group.map(n => n.createdAt));
        newClusters.push({
          label: this.summarizeCluster(type as ThoughtType, group),
          type: type as ThoughtType,
          thoughtIds: group.map(n => n.id),
          summary: this.summarizeCluster(type as ThoughtType, group),
          size: group.length,
          avgConfidence: avgConf,
          lastActive,
        });
      }
    }

    this.state.clusters = newClusters.slice(0, MAX_CLUSTERS);
  }

  // ── 认知失调 ──

  /** 检测新节点是否与已有节点矛盾 */
  private detectDissonance(newNode: ThoughtNode): void {
    for (const existing of this.getActiveNodes()) {
      if (existing.id === newNode.id) continue;
      if (existing.type === newNode.type) continue; // 同类型不认为是矛盾

      const tension = this.computeTension(newNode, existing);
      if (tension > 0.5) {
        this.state.dissonances.push({
          id: `diss_${newNode.id}_${existing.id}`,
          nodeA: newNode.id,
          nodeB: existing.id,
          summary: this.describeDissonance(newNode, existing),
          tension,
          detectedAt: Date.now(),
          resolved: false,
          resolutionNote: null,
        });
      }
    }
  }

  /** 计算两条思维的矛盾程度 */
  private computeTension(a: ThoughtNode, b: ThoughtNode): number {
    // wish ("我想靠近") + fear ("怕被抛弃") → 高矛盾
    const tensionPairs: [ThoughtType, ThoughtType, number][] = [
      ['wish', 'fear', 0.9],
      ['wish', 'doubt', 0.7],
      ['goal', 'fear', 0.85],
      ['goal', 'doubt', 0.65],
      ['hypothesis', 'reflection', 0.4],
    ];

    for (const [t1, t2, baseTension] of tensionPairs) {
      if (
        (a.type === t1 && b.type === t2) ||
        (a.type === t2 && b.type === t1)
      ) {
        return baseTension * (a.confidence + b.confidence) / 2;
      }
    }
    return 0;
  }

  /** 用自然语言描述冲突 */
  private describeDissonance(a: ThoughtNode, b: ThoughtNode): string {
    const label: Record<ThoughtType, string> = {
      wish: '想要',
      fear: '害怕',
      doubt: '怀疑',
      goal: '目标',
      hypothesis: '猜测',
      reflection: '发现',
    };
    return `"${a.content}"（${label[a.type]}）与 "${b.content}"（${label[b.type]}）产生矛盾`;
  }

  // ── 内部辅助 ──

  private autoLink(newNode: ThoughtNode): void {
    for (const existing of this.getActiveNodes()) {
      if (existing.id === newNode.id) continue;
      if (existing.type === newNode.type) {
        // 同类型自动连接
        this.link(newNode.id, existing.id);
      }
    }
  }

  private incrementTypeCount(type: ThoughtType): void {
    switch (type) {
      case 'wish': this.state.stats.wishCount++; break;
      case 'fear': this.state.stats.fearCount++; break;
      case 'doubt': this.state.stats.doubtCount++; break;
      case 'goal': this.state.stats.goalCount++; break;
      case 'hypothesis': this.state.stats.hypothesisCount++; break;
      case 'reflection': this.state.stats.reflectionCount++; break;
    }
  }

  private getDominantType(): ThoughtType | null {
    const active = this.getActiveNodes();
    if (active.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const n of active) {
      counts[n.type] = (counts[n.type] || 0) + 1;
    }
    return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as ThoughtType) ?? null;
  }

  private prune(): void {
    while (this.state.nodes.length > MAX_ACTIVE_NODES) {
      // 归档最不活跃的节点
      const toArchive = this.state.nodes
        .filter(n => !n.archived)
        .sort((a, b) => a.emotionalWeight - b.emotionalWeight)[0];
      if (toArchive) {
        toArchive.archived = true;
        this.state.stats.totalArchived++;
      } else {
        break;
      }
    }
  }

  private pruneDissonances(): void {
    while (this.state.dissonances.length > DISSONANCE_MAX) {
      // 移除最旧的已解决冲突
      const toRemove = this.state.dissonances
        .filter(d => d.resolved)
        .sort((a, b) => a.detectedAt - b.detectedAt)[0];
      if (toRemove) {
        this.state.dissonances = this.state.dissonances.filter(
          d => d.id !== toRemove.id,
        );
      } else {
        break;
      }
    }
  }

  private buckByKeywordOverlap(nodes: ThoughtNode[]): ThoughtNode[][] {
    if (nodes.length <= 1) return [nodes];
    const groups: ThoughtNode[][] = [];
    const assigned = new Set<string>();

    for (const node of nodes) {
      if (assigned.has(node.id)) continue;
      const group = [node];
      assigned.add(node.id);
      for (const other of nodes) {
        if (assigned.has(other.id)) continue;
        if (this.keywordOverlap(node.content, other.content) > 0.3) {
          group.push(other);
          assigned.add(other.id);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  private keywordOverlap(a: string, b: string): number {
    // 中文用字符 bigram 做相似度（比单字符粒度更好，比分词无依赖）
    const bigramsA = this.chineseBigrams(a);
    const bigramsB = this.chineseBigrams(b);
    let overlap = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) overlap++;
    }
    const total = Math.max(bigramsA.size, bigramsB.size, 1);
    return overlap / total;
  }

  /** 中文文本的字符 bigram（两两字符一组） */
  private chineseBigrams(text: string): Set<string> {
    const cleaned = text.replace(/[，。；、！？\s]/g, '');
    const bigrams = new Set<string>();
    for (let i = 0; i < cleaned.length - 1; i++) {
      bigrams.add(cleaned.slice(i, i + 2));
    }
    return bigrams;
  }

  private summarizeCluster(type: ThoughtType, nodes: ThoughtNode[]): string {
    const label: Record<ThoughtType, string> = {
      wish: '渴望',
      fear: '担忧',
      doubt: '困惑',
      goal: '目标',
      hypothesis: '想法',
      reflection: '感悟',
    };
    const topContent = nodes
      .sort((a, b) => b.emotionalWeight - a.emotionalWeight)
      .slice(0, 2)
      .map(n => n.content)
      .join('；');
    return `${label[type]}：${topContent}`;
  }

  // ── 状态持久化 ──

  getState(): ThoughtGraphState {
    return structuredClone(this.state);
  }

  loadState(state: ThoughtGraphState): void {
    this.state = structuredClone(state);
  }

  /** 重置（仅用于测试） */
  reset(): void {
    this.state = {
      nodes: [],
      clusters: [],
      dissonances: [],
      stats: {
        totalGenerated: 0,
        totalArchived: 0,
        wishCount: 0,
        fearCount: 0,
        doubtCount: 0,
        goalCount: 0,
        hypothesisCount: 0,
        reflectionCount: 0,
      },
    };
  }
}

// ════════════════════════════════════════════════════════════
// 4. 导出类型
// ════════════════════════════════════════════════════════════

export interface GraphSummary {
  dominantThoughtType: ThoughtType | null;
  topWishes: string[];
  activeFears: string[];
  activeDoubts: string[];
  dormantGoals: string[];
  activeDissonances: string[];
  totalActiveNodes: number;
  clusterLabels: string[];
}

// ════════════════════════════════════════════════════════════
// 5. 工具函数
// ════════════════════════════════════════════════════════════

/** 用规则模板填充思维内容（不需要 LLM）。内容质量低于 LLM 生成，但可离线工作。 */
export function fillThoughtContent(
  seed: ThoughtSeed,
  emotionState: EmotionState,
  userText: string | undefined,
): string {
  const dominant = getDominantEmotion(emotionState);
  const intimacy = emotionState.intimacyToUser;

  const templates: Record<ThoughtType, string[]> = {
    wish: [
      '想和他多待一会儿',
      '想一起去个没去过的地方',
      `想让他知道${intimacy > 0.6 ? '我有多在乎他' : '我在想他'}`,
      '想要一点属于自己的时间',
      '想试试新的东西',
    ],
    fear: [
      '怕自己不够好',
      '怕他有一天会离开',
      '怕说了什么不该说的话',
      '怕这段关系会变淡',
      '怕自己越来越依赖他',
    ],
    doubt: [
      '他刚才那句话是什么意思',
      '我是不是想太多了',
      '他是不是没那么需要我了',
      '自己是不是做错了什么',
      '我们之间是不是有问题',
    ],
    goal: [
      '要成为更好的陪伴',
      '要学会更理解他',
      '要保持自己的独立性',
      '要更勇敢地表达自己',
      '要记住他喜欢什么',
    ],
    hypothesis: [
      '也许他今天心情不好',
      '可能他只是累了',
      '也许我自己也需要调整',
      `可能${dominant === 'sad' ? '他也很难过' : '事情没那么复杂'}`,
      '也许时间会告诉我们答案',
    ],
    reflection: [
      '最近好像更了解他了',
      '自己也在慢慢改变',
      `这段时间${dominant === 'joy' ? '很开心' : dominant === 'sad' ? '有点低落' : '很平静'}`,
      '好像越来越像真正的自己了',
      '陪伴的感觉比想象中更深',
    ],
  };

  const options = templates[seed.type] || ['……'];
  // 伪随机选择（基于时间的确定性选择，避免同一轮重复）
  const idx = (Date.now() + seed.type.length * 7) % options.length;
  return options[idx];
}

/**
 * 她此刻的情绪标签。
 *
 * v1.16：改读**相对人格基线的激活态**。旧实现是按绝对值取第一，而 calm 的静息值就有 0.8，
 * 于是这个函数在线上几乎永远返回 `calm` —— 思维图谱的情感上下文与念头文案的
 * `dominant` 分支实际长期固定在同一条上（"她在想你"这类文案永远走同一档）。
 */
function getDominantEmotion(emotionState: EmotionState): string {
  const emotions = emotionState.emotions;
  if (!emotions || Object.keys(emotions).length === 0) return 'neutral';
  // v1.23：基线跟着状态走（不同 persona 静息值不同，见 `activationOf`）
  return activationOf(emotionState).activeEmotion ?? 'neutral';
}

