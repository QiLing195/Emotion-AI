// v5.0: 认知追踪协议 — 事件总线升级
// 从 flat event stream → causal event graph
// 关键设计决策：causedBy > correlationId，level 只分两层

export type EventLevel = 'cognitive' | 'system';

export type EventSource =
  | 'user'
  | 'curiosity'
  | 'memory'
  | 'emotion'
  | 'strategy'
  | 'autonomy'
  | 'world'
  | 'system'
  | 'cognition';

export type EventName =
  // 用户交互
  | 'UserMessageReceived'
  | 'UserInteractionReset'
  // 兴趣
  | 'InterestDetected'
  | 'InterestDecayed'
  // 自主循环
  | 'AutonomousCycleTick'
  | 'LonelinessChanged'
  | 'ProactiveMessageSent'
  | 'ProactiveMessageSkipped'
  // 好奇心
  | 'ExplorationStarted'
  | 'ExplorationCompleted'
  | 'DiscoveryStored'
  | 'DiscoveryShared'
  | 'DiscoveryDuplicateSkipped'
  | 'InsightGenerated'
  // 策略
  | 'StrategySelected'
  | 'StrategyFeedback'
  // 情感
  | 'EmotionUpdated'
  | 'ReversalTriggered'
  | 'PhaseTransitioned'
  | 'StateDecayed'
  // 人格演化
  | 'PersonalityDrifted'
  // 系统
  | 'StateSaved'
  | 'StateLoaded'
  // 🧠 思维图谱
  | 'ThoughtGenerated'
  // 💕 亲密加速器
  | 'IntimacyAccelerated'
  // 🔗 关系演化
  | 'AffinityChanged'
  | 'RelationshipStageChanged'
  | 'CrisisStateChanged'
  | 'PersonaUpdated'
  | 'ProactiveScoreChanged';

// ── 事件元数据（协议定义） ──
export interface EventMeta {
  level: EventLevel;
  source: EventSource;
  label: string;
}

// ── 每个事件类型的元数据 — 这是"认知追踪协议"的核心 ──
const EVENT_META: Record<EventName, EventMeta> = {
  // ── cognitive 层：人格行为 ──
  UserMessageReceived:       { level: 'cognitive', source: 'user',      label: '用户消息' },
  UserInteractionReset:      { level: 'cognitive', source: 'user',      label: '交互重置' },
  InterestDetected:          { level: 'cognitive', source: 'curiosity', label: '兴趣检测' },
  InterestDecayed:           { level: 'system',    source: 'curiosity', label: '兴趣衰减' },
  AutonomousCycleTick:       { level: 'system',    source: 'autonomy',  label: '自主周期' },
  LonelinessChanged:         { level: 'cognitive', source: 'autonomy',  label: '孤独感变化' },
  ProactiveMessageSent:      { level: 'cognitive', source: 'autonomy',  label: '主动消息' },
  ProactiveMessageSkipped:   { level: 'cognitive', source: 'autonomy',  label: '跳过主动消息' },
  ExplorationStarted:        { level: 'cognitive', source: 'curiosity', label: '探索开始' },
  ExplorationCompleted:      { level: 'cognitive', source: 'curiosity', label: '探索完成' },
  DiscoveryStored:           { level: 'cognitive', source: 'curiosity', label: '发现存储' },
  DiscoveryShared:           { level: 'cognitive', source: 'curiosity', label: '发现分享' },
  DiscoveryDuplicateSkipped: { level: 'cognitive', source: 'curiosity', label: '重复发现跳过' },
  InsightGenerated:          { level: 'cognitive', source: 'curiosity', label: '洞察生成' },
  StrategySelected:          { level: 'cognitive', source: 'strategy',  label: '策略选择' },
  StrategyFeedback:          { level: 'cognitive', source: 'strategy',  label: '策略反馈' },
  EmotionUpdated:            { level: 'cognitive', source: 'emotion',   label: '情感更新' },
  ReversalTriggered:         { level: 'cognitive', source: 'emotion',   label: '情感反转' },
  PhaseTransitioned:         { level: 'cognitive', source: 'emotion',   label: '阶段转换' },
  StateDecayed:              { level: 'system',    source: 'emotion',   label: '状态衰减' },
  PersonalityDrifted:        { level: 'cognitive', source: 'emotion',   label: '人格漂移' },
  StateSaved:                { level: 'system',    source: 'system',    label: '状态保存' },
  StateLoaded:               { level: 'system',    source: 'system',    label: '状态加载' },
  ThoughtGenerated:          { level: 'cognitive', source: 'cognition', label: '思维生成' },
  IntimacyAccelerated:       { level: 'cognitive', source: 'emotion',   label: '亲密加速' },
  AffinityChanged:           { level: 'cognitive', source: 'emotion',   label: '亲密度变化' },
  RelationshipStageChanged:  { level: 'cognitive', source: 'emotion',   label: '关系阶段跃迁' },
  CrisisStateChanged:        { level: 'cognitive', source: 'system',    label: '危机状态切换' },
  PersonaUpdated:            { level: 'system',    source: 'system',    label: '人格参数更新' },
  ProactiveScoreChanged:     { level: 'cognitive', source: 'autonomy',  label: '主动倾向变化' },
};

// ── 升级后的事件结构 ──
export interface BusEvent<T = any> {
  /** 事件唯一 ID */
  id: string;
  /** 事件类型 */
  type: EventName;
  /** 认知层 / 系统层 */
  level: EventLevel;
  /** 事件来源模块 */
  source: EventSource;
  /** 时间戳 */
  timestamp: number;
  /** 事件数据 */
  data: T;
  /** 同一条认知链上的事件共享同一个 correlationId */
  correlationId?: string;
  /** 直接前驱事件 ID（不是链，是直接因果） */
  causedBy?: string;
  /** 会话 ID */
  sessionId?: string;
}

// ── 简单 ID 生成（排序友好） ──
let _idCounter = 0;
function genId(): string {
  _idCounter++;
  return `evt_${Date.now()}_${_idCounter.toString(36)}`;
}

function genCorrelationId(): string {
  return `corr_${crypto.randomUUID()}`;
}

type EventHandler = (event: BusEvent) => void;

class EventBus {
  private handlers = new Map<EventName, EventHandler[]>();
  private eventLog: BusEvent[] = [];
  private maxLogSize = 1000;
  private _sessionId: string;
  private _currentChainId: string | null = null;

  constructor() {
    this._sessionId = `sess_${Date.now()}`;
  }

  /** 获取当前会话 ID */
  get sessionId(): string {
    return this._sessionId;
  }

  /** 开始一条新的认知链，返回 correlationId */
  startChain(): string {
    this._currentChainId = genCorrelationId();
    return this._currentChainId;
  }

  /** 获取当前认知链 ID */
  get currentChainId(): string | null {
    return this._currentChainId;
  }

  /** 重置认知链（用户交互结束时调用） */
  endChain(): void {
    this._currentChainId = null;
  }

  on(type: EventName, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler);
    return () => {
      const list = this.handlers.get(type);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  /**
   * 发射事件
   * @param type 事件类型
   * @param data 事件数据
   * @param opts 可选：覆盖 correlationId / causedBy；不传则自动继承当前链
   */
  emit(type: EventName, data?: any, opts?: { correlationId?: string; causedBy?: string }): string {
    const meta = EVENT_META[type];
    const event: BusEvent = {
      id: genId(),
      type,
      level: meta.level,
      source: meta.source,
      timestamp: Date.now(),
      data,
      correlationId: opts?.correlationId ?? this._currentChainId ?? undefined,
      causedBy: opts?.causedBy,
      sessionId: this._sessionId,
    };

    if (process.env.NODE_ENV !== 'production') {
      const levelTag = event.level === 'cognitive' ? '🧠' : '⚙️';
      const chainTag = event.correlationId ? ` [${event.correlationId.slice(-6)}]` : '';
      const causedTag = event.causedBy ? ` ←${event.causedBy.slice(-8)}` : '';
      const summary = data ? JSON.stringify(data).slice(0, 100) : '';
      console.log(`[Event]${levelTag} ${type}${chainTag}${causedTag} ${summary}`);
    }

    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.splice(0, this.eventLog.length - this.maxLogSize);
    }

    const handlers = this.handlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (e) {
        console.error(`[EventBus] handler error for ${type}:`, e);
      }
    }

    return event.id; // 返回事件 ID，让调用方可以传给下游事件作为 causedBy
  }

  /** 获取最近 N 条事件 */
  recentEvents(n = 50): BusEvent[] {
    return this.eventLog.slice(-n);
  }

  /** 按层级过滤 — 默认只看 cognitive */
  cognitiveEvents(n = 50): BusEvent[] {
    return this.eventLog.filter(e => e.level === 'cognitive').slice(-n);
  }

  /** 按 correlationId 追踪整条因果链 */
  traceChain(correlationId: string): BusEvent[] {
    return this.eventLog.filter(e => e.correlationId === correlationId);
  }

  /** 从某个事件开始，沿 causedBy 反向追溯因果树 */
  traceCausality(eventId: string, maxDepth = 10): BusEvent[] {
    const chain: BusEvent[] = [];
    let current = this.eventLog.find(e => e.id === eventId);
    let depth = 0;
    while (current && depth < maxDepth) {
      chain.unshift(current);
      if (current.causedBy) {
        current = this.eventLog.find(e => e.id === current!.causedBy);
      } else {
        break;
      }
      depth++;
    }
    return chain;
  }

  /** 按类型过滤最近事件 */
  eventsOfType(type: EventName, n = 20): BusEvent[] {
    return this.eventLog.filter(e => e.type === type).slice(-n);
  }

  /** 获取事件日志的只读副本（用于 /api/events） */
  getLog(): ReadonlyArray<BusEvent> {
    return this.eventLog;
  }

  /** 获取事件元数据 */
  static getMeta(type: EventName): EventMeta {
    return EVENT_META[type];
  }

  // ── 事件覆盖率 (v5.2) ──

  /** 按事件类型统计计数，立即暴露"哪些系统在工作、哪些没工作" */
  getEventCoverage(): Record<string, number> {
    const coverage: Record<string, number> = {};
    for (const e of this.eventLog) {
      coverage[e.type] = (coverage[e.type] || 0) + 1;
    }
    // 补零：所有已定义但从未发射的事件类型
    const allTypes: EventName[] = [
      'UserMessageReceived', 'UserInteractionReset',
      'InterestDetected', 'InterestDecayed',
      'AutonomousCycleTick', 'LonelinessChanged',
      'ProactiveMessageSent', 'ProactiveMessageSkipped',
      'ExplorationStarted', 'ExplorationCompleted',
      'DiscoveryStored', 'DiscoveryShared', 'DiscoveryDuplicateSkipped',
      'InsightGenerated',
      'StrategySelected', 'StrategyFeedback',
      'EmotionUpdated', 'ReversalTriggered', 'PhaseTransitioned',
      'StateSaved', 'StateLoaded',
      'ThoughtGenerated', 'IntimacyAccelerated',
      'AffinityChanged', 'RelationshipStageChanged', 'CrisisStateChanged',
      'PersonaUpdated', 'ProactiveScoreChanged',
    ];
    for (const t of allTypes) {
      if (!(t in coverage)) coverage[t] = 0;
    }
    return coverage;
  }

  // ── 链统计 MVP (v5.2) ──

  /** 轻量链统计 MVP：4 个核心指标，不替代完整 getChainStats() */
  getQuickStats(): {
    chainCount: number;
    avgLength: number;
    discoverySuccess: string;
    topEdges: { edge: string; count: number }[];
  } {
    const chains = this.groupByChain();
    const chainLengths: number[] = [];
    let totalDiscoveries = 0;
    let successfulDiscoveries = 0;

    for (const [, events] of chains) {
      chainLengths.push(events.length);
      for (const e of events) {
        if (e.type === 'DiscoveryStored') successfulDiscoveries++;
        if (e.type === 'DiscoveryStored' || e.type === 'DiscoveryDuplicateSkipped') {
          totalDiscoveries++;
        }
      }
    }

    const avgLen = chainLengths.length > 0
      ? Math.round((chainLengths.reduce((a, b) => a + b, 0) / chainLengths.length) * 10) / 10
      : 0;

    const successRate = totalDiscoveries > 0
      ? `${Math.round((successfulDiscoveries / totalDiscoveries) * 100)}%`
      : 'N/A';

    // Top edges: 从因果边计数中取 Top 5
    const edgeMap = this.countCausalEdges(this.eventLog);
    const topEdges = Array.from(edgeMap.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([edge, count]) => ({ edge, count }));

    return {
      chainCount: chains.size,
      avgLength: avgLen,
      discoverySuccess: successRate,
      topEdges,
    };
  }

  // ── 链统计分析 (v5.1) ──

  /** 按 correlationId 分组所有事件 */
  private groupByChain(windowMs?: number): Map<string, BusEvent[]> {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    const groups = new Map<string, BusEvent[]>();
    for (const e of this.eventLog) {
      if (!e.correlationId) continue;
      if (windowMs && e.timestamp < cutoff) continue;
      const chain = groups.get(e.correlationId) || [];
      chain.push(e);
      groups.set(e.correlationId, chain);
    }
    return groups;
  }

  /** 统计所有因果边: Map<"fromType→toType", count> */
  private countCausalEdges(events: BusEvent[]): Map<string, number> {
    const edges = new Map<string, number>();
    for (const e of events) {
      if (!e.causedBy) continue;
      const from = this.eventLog.find(prev => prev.id === e.causedBy);
      const edge = `${from?.type || '?'} → ${e.type}`;
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
    return edges;
  }

  /** 获取当前认知行为统计 */
  getChainStats(windowMinutes = 30): ChainStats {
    const chains = this.groupByChain(windowMinutes * 60 * 1000);
    const allChains = this.groupByChain(); // 全量用于 discovery 统计

    const chainSizes = Array.from(chains.values()).map(c => c.length);
    const chainCount = chains.size;
    const avgLength = chainCount > 0
      ? chainSizes.reduce((a, b) => a + b, 0) / chainCount
      : 0;

    // 孤立链 vs 深度链
    const isolatedChains = chainSizes.filter(s => s <= 2).length;
    const deepChains = chainSizes.filter(s => s >= 4).length;
    const isolatedRatio = chainCount > 0 ? isolatedChains / chainCount : 0;

    // Discovery 成功率（全量，不受窗口限制）
    const allEvents = Array.from(allChains.values()).flat();
    const stored = allEvents.filter(e => e.type === 'DiscoveryStored').length;
    const skipped = allEvents.filter(e => e.type === 'DiscoveryDuplicateSkipped').length;
    const discoveryTotal = stored + skipped;
    const discoverySuccess = discoveryTotal > 0 ? stored / discoveryTotal : null;

    // Top 因果边
    const allChainEvents = Array.from(chains.values()).flat();
    const edgeCounts = this.countCausalEdges(allChainEvents);
    const topEdges = Array.from(edgeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([edge, count]) => ({ edge, count }));

    // 链深度分布
    const depthDistribution = {
      shallow: chainSizes.filter(s => s <= 2).length,   // 浅链: 1-2 事件
      medium: chainSizes.filter(s => s >= 3 && s <= 5).length,  // 中链: 3-5 事件
      deep: chainSizes.filter(s => s >= 6).length,       // 深链: 6+ 事件
    };

    // 链分叉率：多个事件共享同一个 causedBy 的次数
    const causedByCounts = new Map<string, number>();
    for (const e of allChainEvents) {
      if (!e.causedBy) continue;
      causedByCounts.set(e.causedBy, (causedByCounts.get(e.causedBy) || 0) + 1);
    }
    const forkCount = Array.from(causedByCounts.values()).filter(c => c > 1).length;
    const forkRate = allChainEvents.length > 0 ? forkCount / allChainEvents.length : 0;

    return {
      chainCount,
      avgLength,
      isolatedRatio,
      deepChainCount: deepChains,
      discoverySuccess,
      topEdges,
      depthDistribution,
      forkRate,
      windowMinutes,
    };
  }

  // ── v2 认知指标 (ChainStatistics v2) ──

  /** 统一窗口解析：返回 groupByChain 可用的 windowMs（undefined = 全量） */
  private resolveWindowMs(spec: WindowSpec): number | undefined {
    if (spec.kind === 'session') return undefined;
    return spec.value * 60 * 1000;
  }

  /** 统一窗口解析：返回 cutoff 时间戳（ms），undefined = 全量 */
  private resolveWindowCutoff(spec: WindowSpec): number | undefined {
    if (spec.kind === 'session') return undefined;
    return Date.now() - spec.value * 60 * 1000;
  }

  /** 为每个事件类型计算分叉熵（认知不确定度） */
  computeForkEntropy(spec: WindowSpec): { mean: number | null; perType: PerTypeEntropy[] } {
    const cutoff = this.resolveWindowCutoff(spec);
    const events = cutoff
      ? this.eventLog.filter(e => e.timestamp >= cutoff)
      : [...this.eventLog];

    // transitionMatrix[S][T] = count of S→T edges
    const transitionMatrix = new Map<string, Map<string, number>>();
    const outgoingTotals = new Map<string, number>();
    const uniqueTargets = new Map<string, Set<string>>();

    for (const e of events) {
      if (!e.causedBy) continue;
      const prev = this.eventLog.find(p => p.id === e.causedBy);
      if (!prev) continue;
      const from = prev.type;
      const to = e.type;

      if (!transitionMatrix.has(from)) transitionMatrix.set(from, new Map());
      const row = transitionMatrix.get(from)!;
      row.set(to, (row.get(to) || 0) + 1);
      outgoingTotals.set(from, (outgoingTotals.get(from) || 0) + 1);

      if (!uniqueTargets.has(from)) uniqueTargets.set(from, new Set());
      uniqueTargets.get(from)!.add(to);
    }

    const perType: PerTypeEntropy[] = [];
    let weightedEntropySum = 0;
    let totalOutgoing = 0;

    for (const [type, row] of transitionMatrix) {
      const total = outgoingTotals.get(type) || 0;
      if (total === 0) continue;
      let entropy = 0;
      for (const count of row.values()) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
      perType.push({
        type,
        label: EVENT_META[type as EventName]?.label || type,
        entropy,
        outgoingCount: total,
        uniqueTargets: uniqueTargets.get(type)?.size || 0,
      });
      weightedEntropySum += entropy * total;
      totalOutgoing += total;
    }

    perType.sort((a, b) => b.entropy - a.entropy);
    const mean = totalOutgoing > 0 ? weightedEntropySum / totalOutgoing : null;
    return { mean, perType };
  }

  /** 计算所有因果边的 PMI 和 Lift */
  computePMI(spec: WindowSpec): PMIEdge[] {
    const cutoff = this.resolveWindowCutoff(spec);
    const events = cutoff
      ? this.eventLog.filter(e => e.timestamp >= cutoff)
      : [...this.eventLog];

    const edgeCounts = new Map<string, number>();       // "fromType→toType" → count
    const fromCounts = new Map<string, number>();       // fromType → total outgoing
    const toCounts = new Map<string, number>();         // toType → total incoming
    let totalEdges = 0;

    for (const e of events) {
      if (!e.causedBy) continue;
      const prev = this.eventLog.find(p => p.id === e.causedBy);
      if (!prev) continue;
      const key = `${prev.type}→${e.type}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      fromCounts.set(prev.type, (fromCounts.get(prev.type) || 0) + 1);
      toCounts.set(e.type, (toCounts.get(e.type) || 0) + 1);
      totalEdges++;
    }

    const result: PMIEdge[] = [];
    for (const [key, count] of edgeCounts) {
      const [from, to] = key.split('→');
      const p_ab = count / totalEdges;
      const p_a = (fromCounts.get(from) || 0) / totalEdges;
      const p_b = (toCounts.get(to) || 0) / totalEdges;
      const denom = p_a * p_b;

      result.push({
        from,
        to,
        fromLabel: EVENT_META[from as EventName]?.label || from,
        toLabel: EVENT_META[to as EventName]?.label || to,
        count,
        pmi: denom > 0 ? Math.log2(p_ab / denom) : null,
        lift: denom > 0 ? p_ab / denom : null,
      });
    }

    // 按 lift 降序排列，null 排末尾
    result.sort((a, b) => {
      if (a.lift === null && b.lift === null) return 0;
      if (a.lift === null) return 1;
      if (b.lift === null) return -1;
      return b.lift - a.lift;
    });
    return result;
  }

  /** 计算发现指标三路拆分 */
  private computeDiscoveryMetrics(spec: WindowSpec, chains: Map<string, BusEvent[]>): DiscoveryMetrics {
    const cutoff = this.resolveWindowCutoff(spec);
    const allChainEvents = Array.from(chains.values()).flat();

    const startedEvents = allChainEvents.filter(e => e.type === 'ExplorationStarted');
    const storedEvents = allChainEvents.filter(e => e.type === 'DiscoveryStored');
    const skippedEvents = allChainEvents.filter(e => e.type === 'DiscoveryDuplicateSkipped');

    const totalExplorations = startedEvents.length;
    const totalStored = storedEvents.length;
    const totalSkipped = skippedEvents.length;

    const explorationYield = totalExplorations > 0 ? totalStored / totalExplorations : null;
    const dedupEfficiency = (totalStored + totalSkipped) > 0 ? totalSkipped / (totalStored + totalSkipped) : null;

    // Novelty rate
    let noveltyRate: number | null = null;
    if (totalStored > 0) {
      if (cutoff) {
        // 窗口模式：话题在窗口前未出现过 = 新话题
        const preWindowEvents = this.eventLog.filter(
          e => e.type === 'DiscoveryStored' && e.timestamp < cutoff
        );
        const preTopics = new Set(preWindowEvents.map(e => e.data?.topic).filter(Boolean));
        const newTopicCount = storedEvents.filter(
          e => !preTopics.has(e.data?.topic)
        ).length;
        noveltyRate = newTopicCount / totalStored;
      } else {
        // Session 模式：不同话题数 / 总数（主题多样性代理）
        const allTopics = new Set(storedEvents.map(e => e.data?.topic).filter(Boolean));
        noveltyRate = allTopics.size / totalStored;
      }
    }

    return { explorationYield, dedupEfficiency, noveltyRate, totalExplorations, totalStored, totalSkipped };
  }

  /** 对链进行语义聚类（基于 eventType n-gram 规则） */
  clusterChains(spec: WindowSpec): ChainLabelCount[] {
    const windowMs = this.resolveWindowMs(spec);
    const chains = this.groupByChain(windowMs);

    const labelCounts = new Map<ChainLabel, number>();
    labelCounts.set('探索型链', 0);
    labelCounts.set('对话修复链', 0);
    labelCounts.set('策略收敛链', 0);
    labelCounts.set('浅回应链', 0);
    labelCounts.set('其他链', 0);

    for (const [, events] of chains) {
      const types = events.map(e => e.type).sort((a, b) => {
        const ia = events.findIndex(ev => ev.type === a);
        const ib = events.findIndex(ev => ev.type === b);
        return ia - ib;
      });

      let label: ChainLabel;

      if (types.includes('ExplorationStarted') && types.includes('DiscoveryStored')) {
        label = '探索型链';
      } else if (types.includes('ReversalTriggered') || types.includes('PhaseTransitioned')) {
        label = '对话修复链';
      } else if (types.includes('StrategySelected') && types.filter(t => t === 'EmotionUpdated').length >= 2) {
        label = '策略收敛链';
      } else if (events.length <= 2 && !types.includes('ExplorationStarted') && !types.includes('DiscoveryStored') && !types.includes('StrategySelected')) {
        label = '浅回应链';
      } else {
        label = '其他链';
      }

      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }

    return Array.from(labelCounts.entries()).map(([label, count]) => ({ label, count }));
  }

  /** V2 完整统计 — 编排所有计算 */
  getChainStatsV2(specOrMinutes: WindowSpec | number = { kind: 'minutes', value: 30 }): ChainStatsV2 {
    const spec: WindowSpec = typeof specOrMinutes === 'number'
      ? { kind: 'minutes', value: specOrMinutes }
      : specOrMinutes;

    const cutoff = this.resolveWindowCutoff(spec);
    const windowMs = this.resolveWindowMs(spec);
    const chains = this.groupByChain(windowMs);

    const chainSizes = Array.from(chains.values()).map(c => c.length);
    const chainCount = chains.size;
    const avgDepth = chainCount > 0
      ? chainSizes.reduce((a, b) => a + b, 0) / chainCount
      : 0;

    const isolatedChains = chainSizes.filter(s => s <= 2).length;
    const deepChains = chainSizes.filter(s => s >= 4).length;
    const isolatedRatio = chainCount > 0 ? isolatedChains / chainCount : 0;

    const depthDistribution = {
      shallow: chainSizes.filter(s => s <= 2).length,
      medium: chainSizes.filter(s => s >= 3 && s <= 5).length,
      deep: chainSizes.filter(s => s >= 6).length,
    };

    // 确定有效的事件范围
    const eventsInWindow = cutoff
      ? this.eventLog.filter(e => e.timestamp >= cutoff)
      : [...this.eventLog];

    const forkResult = this.computeForkEntropy(spec);
    const pmiEdges = this.computePMI(spec);
    const discovery = this.computeDiscoveryMetrics(spec, chains);
    const chainLabels = this.clusterChains(spec);

    // Top edges (raw frequency, for backward compat)
    const allChainEvents = Array.from(chains.values()).flat();
    const edgeCounts = this.countCausalEdges(allChainEvents);
    const topEdgesRaw = Array.from(edgeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([edge, count]) => ({ edge, count }));

    const eventsWithoutCorrelation = eventsInWindow.filter(e => !e.correlationId).length;

    return {
      chainCount,
      avgDepth,
      forkEntropy: forkResult.mean,
      perTypeEntropy: forkResult.perType.slice(0, 5),
      depthDistribution,
      isolatedRatio,
      discovery,
      dedupRatio: discovery.dedupEfficiency,
      topEdgesRaw,
      topEdgesPMI: pmiEdges.slice(0, 5),
      chainLabels,
      windowMinutes: spec.kind === 'session' ? null : spec.value,
      totalEvents: eventsInWindow.length,
      eventsWithoutCorrelation,
      computedAt: Date.now(),
    };
  }

  /** V3 认知观测台 — 四层指标完整快照 */
  getCognitiveObservatory(specOrMinutes: WindowSpec | number = { kind: 'minutes', value: 30 }): CognitiveObservatory {
    const spec: WindowSpec = typeof specOrMinutes === 'number'
      ? { kind: 'minutes', value: specOrMinutes }
      : specOrMinutes;

    const cutoff = this.resolveWindowCutoff(spec);
    const windowMs = this.resolveWindowMs(spec);
    const chains = this.groupByChain(windowMs);

    const chainSizes = Array.from(chains.values()).map(c => c.length);
    const chainCount = chains.size;

    // 有效事件范围
    const eventsInWindow = cutoff
      ? this.eventLog.filter(e => e.timestamp >= cutoff)
      : [...this.eventLog];

    const allChainEvents = Array.from(chains.values()).flat();

    // ═══ Layer 1: Structure ═══
    const avgDepth = chainCount > 0
      ? chainSizes.reduce((a, b) => a + b, 0) / chainCount
      : 0;
    const maxDepth = chainCount > 0 ? Math.max(...chainSizes) : 0;
    const isolatedChains = chainSizes.filter(s => s <= 2).length;
    const deepChains = chainSizes.filter(s => s >= 4).length;
    const isolatedRatio = chainCount > 0 ? isolatedChains / chainCount : 0;
    const deepChainRatio = chainCount > 0 ? deepChains / chainCount : 0;

    const depthDistribution = {
      shallow: chainSizes.filter(s => s <= 2).length,
      medium: chainSizes.filter(s => s >= 3 && s <= 5).length,
      deep: chainSizes.filter(s => s >= 6).length,
    };

    const structure: StructureMetrics = {
      chainCount,
      avgDepth,
      maxDepth,
      isolatedRatio,
      deepChainRatio,
      depthDistribution,
    };

    // ═══ Layer 2: Graph ═══
    // 收集因果边
    const edgeCounts = new Map<string, number>();
    const fromCounts = new Map<string, number>();
    const toCounts = new Map<string, number>();
    let totalEdges = 0;

    for (const e of allChainEvents) {
      if (!e.causedBy) continue;
      const prev = this.eventLog.find(p => p.id === e.causedBy);
      if (!prev) continue;
      const key = `${prev.type}→${e.type}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      fromCounts.set(prev.type, (fromCounts.get(prev.type) || 0) + 1);
      toCounts.set(e.type, (toCounts.get(e.type) || 0) + 1);
      totalEdges++;
    }

    // 分叉率：分叉节点数（有 >1 子节点）/ 总节点数
    const childCounts = new Map<string, number>();
    for (const e of allChainEvents) {
      if (!e.causedBy) continue;
      childCounts.set(e.causedBy, (childCounts.get(e.causedBy) || 0) + 1);
    }
    const forkNodeCount = Array.from(childCounts.values()).filter(c => c > 1).length;
    const totalNodes = new Set(allChainEvents.map(e => e.id)).size;
    const forkRate = totalNodes > 0 ? forkNodeCount / totalNodes : 0;

    // 分支熵
    const forkEntropyResult = this.computeForkEntropy(spec);

    // Build EdgeMetrics list
    const allEdgeMetrics: EdgeMetric[] = [];
    for (const [key, count] of edgeCounts) {
      const [from, to] = key.split('→');
      const p_b_given_a = count / (fromCounts.get(from) || 1);
      const p_b = (toCounts.get(to) || 0) / totalEdges || 0;
      const lift = p_b > 0 ? p_b_given_a / p_b : 0;
      allEdgeMetrics.push({ edge: key, count, probability: p_b_given_a, lift });
    }

    const topEdges = [...allEdgeMetrics]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const strongestEdges = [...allEdgeMetrics]
      .sort((a, b) => b.lift - a.lift)
      .slice(0, 5);

    const graph: GraphMetrics = {
      edgeCount: totalEdges,
      forkRate,
      branchEntropy: forkEntropyResult.mean,
      topEdges,
      strongestEdges,
    };

    // ═══ Layer 3: Behavior ═══
    const startedCount = allChainEvents.filter(e => e.type === 'ExplorationStarted').length;
    const storedCount = allChainEvents.filter(e => e.type === 'DiscoveryStored').length;
    const skippedCount = allChainEvents.filter(e => e.type === 'DiscoveryDuplicateSkipped').length;
    const strategyCount = allChainEvents.filter(e => e.type === 'StrategySelected').length;

    const explorationYield = startedCount > 0 ? storedCount / startedCount : null;
    const duplicateRate = (storedCount + skippedCount) > 0 ? skippedCount / (storedCount + skippedCount) : null;
    const strategyConversion = startedCount > 0 ? strategyCount / startedCount : null;

    // 新颖率：新语义簇 / 总发现
    let noveltyRate: number | null = null;
    if (storedCount > 0) {
      if (cutoff) {
        const preWindowStored = this.eventLog.filter(
          e => e.type === 'DiscoveryStored' && e.timestamp < cutoff
        );
        const preTopics = new Set(preWindowStored.map(e => e.data?.topic).filter(Boolean));
        const windowStored = allChainEvents.filter(e => e.type === 'DiscoveryStored');
        const newTopicCount = windowStored.filter(e => !preTopics.has(e.data?.topic)).length;
        noveltyRate = newTopicCount / storedCount;
      } else {
        const allTopics = new Set(
          allChainEvents.filter(e => e.type === 'DiscoveryStored').map(e => e.data?.topic).filter(Boolean)
        );
        noveltyRate = allTopics.size / storedCount;
      }
    }

    const behavior: BehaviorMetrics = {
      explorationYield,
      noveltyRate,
      duplicateRate,
      strategyConversion,
    };

    // ═══ Layer 4: Cognition ═══
    const yieldVal = explorationYield ?? 0;
    const noveltyVal = noveltyRate ?? 0;

    const curiosityIndex = Math.round(
      (0.4 * yieldVal + 0.3 * noveltyVal + 0.3 * deepChainRatio) * 100
    );

    const cognitiveEfficiency = eventsInWindow.length > 0
      ? storedCount / eventsInWindow.length
      : 0;

    const windowMin = spec.kind === 'minutes' ? spec.value : 30;
    const learningVelocity = storedCount / windowMin;

    const chainQualityScore = Math.round((
      0.25 * deepChainRatio +
      0.20 * yieldVal +
      0.20 * noveltyVal +
      0.15 * (strategyConversion ?? 0) +
      0.10 * cognitiveEfficiency * 10 +  // scale up since cognitiveEfficiency is typically small
      0.10 * (1 - (duplicateRate ?? 0))
    ) * 100);

    const cognition: CognitionMetrics = {
      curiosityIndex: Math.min(100, curiosityIndex),
      cognitiveEfficiency,
      learningVelocity,
      chainQualityScore: Math.min(100, chainQualityScore),
    };

    // 链类型聚类 + 全量 PMI（供因果归因下钻）
    const chainLabels = this.clusterChains(spec);
    const edgeDetail = this.computePMI(spec);

    // ═══ Layer 5: Emotion ═══
    const emotionEvents = allChainEvents.filter(e =>
      e.type === 'EmotionUpdated' || e.type === 'ReversalTriggered' || e.type === 'PhaseTransitioned'
    );
    const emotionUpdates = emotionEvents.filter(e => e.type === 'EmotionUpdated');
    const reversalCount = emotionEvents.filter(e => e.type === 'ReversalTriggered').length;
    const phaseCount = emotionEvents.filter(e => e.type === 'PhaseTransitioned').length;

    let dominantEmotion = 'neutral';
    let valence = 0, arousal = 0, energy = 0;
    let emotionEntropy: number | null = null;

    if (emotionUpdates.length > 0) {
      valence = emotionUpdates.reduce((s, e) => s + (e.data?.valence || 0), 0) / emotionUpdates.length;
      arousal = emotionUpdates.reduce((s, e) => s + (e.data?.arousal || 0), 0) / emotionUpdates.length;
      energy = emotionUpdates.reduce((s, e) => s + (e.data?.energy || e.data?.arousal || 0), 0) / emotionUpdates.length;
      // 用最后一次更新的主导情绪
      const last = emotionUpdates[emotionUpdates.length - 1];
      dominantEmotion = last.data?.dominant || 'neutral';

      // 九情 Shannon 熵
      if (last.data?.emotions) {
        const eList = Object.values(last.data.emotions) as number[];
        const total = eList.reduce((s, v) => s + Math.abs(v), 0) || 1;
        emotionEntropy = 0;
        for (const v of eList) {
          const p = Math.abs(v) / total;
          if (p > 0) emotionEntropy -= p * Math.log2(p);
        }
      }
    }

    const topEmotions: { name: string; intensity: number }[] = [];
    if (emotionUpdates.length > 0) {
      const last = emotionUpdates[emotionUpdates.length - 1];
      if (last.data?.emotions) {
        topEmotions.push(...Object.entries(last.data.emotions as Record<string, number>)
          .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
          .slice(0, 3)
          .map(([name, intensity]) => ({ name, intensity })));
      }
    }

    const emotion: EmotionMetrics = {
      dominantEmotion,
      valence,
      arousal,
      reversalCount,
      phaseTransitions: phaseCount,
      emotionEntropy,
      energy,
      topEmotions,
    };

    // 话题聚合（供诊断树下钻到语义层）
    const topicMap = new Map<string, { stored: number; skipped: number }>();
    for (const e of allChainEvents) {
      if (e.type === 'DiscoveryStored' || e.type === 'DiscoveryDuplicateSkipped') {
        const topic = e.data?.topic || '(unknown)';
        const entry = topicMap.get(topic) || { stored: 0, skipped: 0 };
        if (e.type === 'DiscoveryStored') entry.stored++;
        else entry.skipped++;
        topicMap.set(topic, entry);
      }
    }
    const topicClusters: TopicCluster[] = Array.from(topicMap.entries())
      .map(([topic, v]) => ({ topic, stored: v.stored, skipped: v.skipped, total: v.stored + v.skipped }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // 单链详情 Top 10（供诊断树展示典型案例）
    const eventSeqAbbr: Record<string, string> = {
      UserMessageReceived: 'UM', InterestDetected: 'ID', ExplorationStarted: 'ES',
      DiscoveryStored: 'DS', DiscoveryDuplicateSkipped: 'DD', StrategySelected: 'SS',
      ExplorationCompleted: 'EC', EmotionUpdated: 'EU', StrategyFeedback: 'SF',
    };
    const chainDetail: ChainDetail[] = Array.from(chains.entries())
      .map(([corrId, events]) => {
        const types = events.map(e => e.type);
        let label: ChainLabel = '其他链';
        if (types.includes('ExplorationStarted') && types.includes('DiscoveryStored')) label = '探索型链';
        else if (types.includes('ReversalTriggered') || types.includes('PhaseTransitioned')) label = '对话修复链';
        else if (types.includes('StrategySelected') && types.filter(t => t === 'EmotionUpdated').length >= 2) label = '策略收敛链';
        else if (events.length <= 2) label = '浅回应链';

        let yieldVal: ChainDetail['yield'] = 'none';
        if (types.includes('DiscoveryStored')) yieldVal = 'stored';
        else if (types.includes('DiscoveryDuplicateSkipped')) yieldVal = 'skipped';

        return {
          correlationId: corrId.slice(-6),
          depth: events.length,
          eventSeq: types.map(t => eventSeqAbbr[t] || t.slice(0, 2)).join('→'),
          hasDiscovery: types.includes('DiscoveryStored') || types.includes('DiscoveryDuplicateSkipped'),
          hasStrategy: types.includes('StrategySelected'),
          label,
          yield: yieldVal,
        };
      })
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 10);

    return {
      windowMinutes: spec.kind === 'session' ? 60 : spec.value,
      timestamp: Date.now(),
      structure,
      graph,
      behavior,
      cognition,
      emotion,
      chainLabels,
      edgeDetail,
      topicClusters,
      chainDetail,
    };
  }

  /** 清空事件日志 */
  clearLog(): void {
    this.eventLog = [];
  }
}

// ── v1 链统计类型（保持兼容） ──
export interface ChainStats {
  chainCount: number;
  avgLength: number;
  isolatedRatio: number;
  deepChainCount: number;
  discoverySuccess: number | null;
  topEdges: { edge: string; count: number }[];
  depthDistribution: { shallow: number; medium: number; deep: number };
  forkRate: number;
  windowMinutes: number;
}

// ── v2 链统计类型 ──

/** PMI/Lift 归一化的因果边 */
export interface PMIEdge {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  count: number;
  pmi: number | null;       // log₂(P(A→B) / P(A)P(B))
  lift: number | null;      // P(A→B) / P(A)P(B)
}

/** 每个事件类型的分叉熵 */
export interface PerTypeEntropy {
  type: string;
  label: string;
  entropy: number;          // -Σ P(next|type)·log₂P(next|type), 0 = deterministic
  outgoingCount: number;
  uniqueTargets: number;
}

/** 链语义标签 */
export type ChainLabel = '探索型链' | '对话修复链' | '策略收敛链' | '浅回应链' | '其他链';

export interface ChainLabelCount {
  label: ChainLabel;
  count: number;
}

/** 发现指标三路拆分 */
export interface DiscoveryMetrics {
  explorationYield: number | null;   // stored / started
  dedupEfficiency: number | null;   // skipped / (stored + skipped)
  noveltyRate: number | null;       // new_topics / total_stored
  totalExplorations: number;
  totalStored: number;
  totalSkipped: number;
}

/** 窗口规格 */
export type WindowSpec =
  | { kind: 'minutes'; value: number }
  | { kind: 'session' };

/** V2 主统计接口 */
export interface ChainStatsV2 {
  // Layer 1: Structure
  chainCount: number;
  avgDepth: number;
  forkEntropy: number | null;
  perTypeEntropy: PerTypeEntropy[];
  depthDistribution: { shallow: number; medium: number; deep: number };
  isolatedRatio: number;

  // Layer 2: Behavior
  discovery: DiscoveryMetrics;

  // Layer 3: Efficiency
  dedupRatio: number | null;

  // Edge Analysis
  topEdgesRaw: { edge: string; count: number }[];
  topEdgesPMI: PMIEdge[];

  // Chain Labels
  chainLabels: ChainLabelCount[];

  // Metadata
  windowMinutes: number | null;
  totalEvents: number;
  eventsWithoutCorrelation: number;
  computedAt: number;
}

// ── v3 认知观测体系 (Cognitive Observatory) ──

/** 因果边指标 */
export interface EdgeMetric {
  edge: string;         // "fromType → toType"
  count: number;        // 出现次数
  probability: number;  // P(B|A)
  lift: number;         // P(B|A) / P(B)
}

/** 第一层：结构指标 — 认知链长什么样 */
export interface StructureMetrics {
  chainCount: number;
  avgDepth: number;
  maxDepth: number;
  isolatedRatio: number;    // 长度 ≤ 2 的链占比
  deepChainRatio: number;  // 长度 ≥ 4 的链占比
  depthDistribution: {
    shallow: number;  // 1-2 事件
    medium: number;   // 3-5 事件
    deep: number;     // 6+ 事件
  };
}

/** 第二层：图谱指标 — 思维路径是什么 */
export interface GraphMetrics {
  edgeCount: number;           // 因果边总数
  forkRate: number;            // 分叉节点数 / 总节点数
  branchEntropy: number | null; // 分支熵（加权平均）
  topEdges: EdgeMetric[];      // 按 count 排序的 Top 边
  strongestEdges: EdgeMetric[]; // 按 lift 排序的 Top 边
}

/** 第三层：行为指标 — 系统行为有效吗 */
export interface BehaviorMetrics {
  explorationYield: number | null;    // 有效探索 / 总探索
  noveltyRate: number | null;        // 新语义簇 / 总发现
  duplicateRate: number | null;      // 重复跳过 / (存储 + 跳过)
  strategyConversion: number | null; // 策略选择 / 探索开始
}

/** 第五层：情感指标 — 系统情绪状态 */
export interface EmotionMetrics {
  dominantEmotion: string;       // 当前主导情绪
  valence: number;               // 效价均值
  arousal: number;               // 唤醒度均值
  reversalCount: number;         // 情绪反转次数（窗口内）
  phaseTransitions: number;      // 阶段转换次数（窗口内）
  emotionEntropy: number | null; // 九情 Shannon 熵（情绪多样性）
  energy: number;                // 能量水平均值
  topEmotions: { name: string; intensity: number }[]; // Top 3 情绪
}

/** 第四层：认知指标 — 系统在变聪明还是变迟钝 */
export interface CognitionMetrics {
  curiosityIndex: number;       // 0-100，主动探索倾向
  cognitiveEfficiency: number;  // 发现存储 / 总事件
  learningVelocity: number;     // 每分钟新增发现数
  chainQualityScore: number;    // 0-100，综合评分
}

/** 话题聚合（供因果归因下钻到语义层） */
export interface TopicCluster {
  topic: string;
  stored: number;
  skipped: number;
  total: number;
}

/** 单链详情（供因果归因展示典型案例） */
export interface ChainDetail {
  correlationId: string;    // 链 ID 末6位
  depth: number;            // 事件数
  eventSeq: string;         // 事件序列缩写，如 "UM→ID→ES→DS→EC"
  hasDiscovery: boolean;
  hasStrategy: boolean;
  label: ChainLabel;
  yield: 'stored' | 'skipped' | 'none';
}

/** 认知观测台完整快照 */
export interface CognitiveObservatory {
  windowMinutes: number;
  timestamp: number;
  structure: StructureMetrics;
  graph: GraphMetrics;
  behavior: BehaviorMetrics;
  cognition: CognitionMetrics;
  /** 情感状态（第五层） */
  emotion: EmotionMetrics;
  /** 链类型分布（供因果归因下钻） */
  chainLabels: ChainLabelCount[];
  /** 全量 PMI 边（供因果归因下钻，保留所有边而非仅 top 5） */
  edgeDetail: PMIEdge[];
  /** 话题聚合（供因果归因下钻到语义层） */
  topicClusters: TopicCluster[];
  /** 单链详情 Top 10（典型案例） */
  chainDetail: ChainDetail[];
}

export const bus = new EventBus();

// 导出元数据供 TimelineViewer 使用
export { EVENT_META };
