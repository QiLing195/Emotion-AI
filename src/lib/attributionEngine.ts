// v5.5.5: Causal Attribution Engine
// v5.4: metric→metric decomposition
// v5.5.5: metric→event→edge→chain causal tracing
// 回答 "为什么这个指标变了？" → "根因在哪里？"

import type { AnomalyFlag } from './trendTracker';
import type { CognitiveObservatory, PMIEdge, ChainLabelCount } from '../eventBus';

// ── 归因结果 ──
export interface AttributionFactor {
  label: string;           // 因子名（如 "探索产出率"）
  contribution: number;    // 对该指标变化的贡献（带符号）
  contributionPct: number; // 贡献百分比
  detail: string;          // 人类可读细节（如 "68% → 41%"）
}

export interface MetricAttribution {
  metricKey: string;
  metricLabel: string;
  current: number;
  baseline: number;
  delta: number;
  factors: AttributionFactor[];  // 按 |contribution| 降序排列
}

// ── 成分分解规则 ──
interface DecompositionRule {
  label: string;
  components: {
    key: string;
    label: string;
    weight: number;       // 在公式中的权重
    getCurrent: (c: CognitiveObservatory) => number;
    getBaseline: (baseline: CognitiveObservatory) => number;
  }[];
}

const RULES: Record<string, DecompositionRule> = {
  curiosityIndex: {
    label: '好奇心指数',
    components: [
      {
        key: 'explorationYield',
        label: '探索产出率',
        weight: 0.4,
        getCurrent: c => c.behavior.explorationYield ?? 0,
        getBaseline: b => b.behavior.explorationYield ?? 0,
      },
      {
        key: 'noveltyRate',
        label: '新颖率',
        weight: 0.3,
        getCurrent: c => c.behavior.noveltyRate ?? 0,
        getBaseline: b => b.behavior.noveltyRate ?? 0,
      },
      {
        key: 'deepChainRatio',
        label: '深链占比',
        weight: 0.3,
        getCurrent: c => c.structure.deepChainRatio,
        getBaseline: b => b.structure.deepChainRatio,
      },
    ],
  },
  chainQualityScore: {
    label: '综合质量分',
    components: [
      { key: 'deepChainRatio', label: '深链占比', weight: 0.25,
        getCurrent: c => c.structure.deepChainRatio, getBaseline: b => b.structure.deepChainRatio },
      { key: 'explorationYield', label: '探索产出率', weight: 0.20,
        getCurrent: c => c.behavior.explorationYield ?? 0, getBaseline: b => b.behavior.explorationYield ?? 0 },
      { key: 'noveltyRate', label: '新颖率', weight: 0.20,
        getCurrent: c => c.behavior.noveltyRate ?? 0, getBaseline: b => b.behavior.noveltyRate ?? 0 },
      { key: 'strategyConversion', label: '策略转化', weight: 0.15,
        getCurrent: c => c.behavior.strategyConversion ?? 0, getBaseline: b => b.behavior.strategyConversion ?? 0 },
      { key: 'cognitiveEfficiency', label: '认知效率', weight: 0.10,
        getCurrent: c => c.cognition.cognitiveEfficiency * 10, getBaseline: b => b.cognition.cognitiveEfficiency * 10 }, // scaled
      { key: 'duplicateRate', label: '重复率', weight: 0.10,
        getCurrent: c => 1 - (c.behavior.duplicateRate ?? 0), getBaseline: b => 1 - (b.behavior.duplicateRate ?? 0) }, // inverted
    ],
  },
};

// ── 比率指标导数分解 ──
interface RatioDecomposition {
  numeratorKey: string;
  numeratorLabel: string;
  denominatorKey: string;
  denominatorLabel: string;
}

const RATIO_DECOMPOSITIONS: Record<string, RatioDecomposition> = {
  explorationYield: {
    numeratorKey: 'DiscoveryStored', numeratorLabel: '发现存储数',
    denominatorKey: 'ExplorationStarted', denominatorLabel: '探索开始数',
  },
  strategyConversion: {
    numeratorKey: 'StrategySelected', numeratorLabel: '策略选择数',
    denominatorKey: 'ExplorationStarted', denominatorLabel: '探索开始数',
  },
};

// ── v5.5.5 因果诊断树节点 ──
export interface CausalNode {
  label: string;
  detail: string;
  children: CausalNode[];
}

// ── 值格式化 ──
function fmtVal(v: number): string {
  if (v < 2) return (v * 100).toFixed(0) + '%';
  return v.toFixed(1);
}

// ── Attribution Engine ──
class AttributionEngine {
  /**
   * 对单个异常指标做成分归因
   * @param flag - 来自 TrendTracker 的异常标记
   * @param current - 当前 CognitiveObservatory 快照
   * @param baselineObs - 基线 CognitiveObservatory（EWMA 时段代表值）
   */
  attribute(flag: AnomalyFlag, current: CognitiveObservatory, baselineObs: CognitiveObservatory): MetricAttribution | null {
    const factors: AttributionFactor[] = [];

    // 尝试加权和分解
    const rule = RULES[flag.key];
    if (rule) {
      for (const comp of rule.components) {
        const curVal = comp.getCurrent(current);
        const baseVal = comp.getBaseline(baselineObs);
        const delta = curVal - baseVal;
        const contribution = comp.weight * delta;

        if (Math.abs(contribution) < 0.001) continue; // 忽略微小贡献

        factors.push({
          label: comp.label,
          contribution,
          contributionPct: 0, // 下面统一计算
          detail: fmtDelta(curVal, baseVal),
        });
      }
    }

    // 尝试比率分解
    const ratioRule = RATIO_DECOMPOSITIONS[flag.key];
    if (ratioRule && factors.length === 0) {
      // 用导数近似：Δr ≈ (1/D)ΔN - (N/D²)ΔD
      const numCur = this.countEvents(current, ratioRule.numeratorKey);
      const numBase = this.countEvents(baselineObs, ratioRule.numeratorKey);
      const denCur = this.countEvents(current, ratioRule.denominatorKey);
      const denBase = this.countEvents(baselineObs, ratioRule.denominatorKey);

      if (denBase > 0 && denCur > 0) {
        const numDelta = numCur - numBase;
        const denDelta = denCur - denBase;
        const numContrib = (1 / denBase) * numDelta;
        const denContrib = -(numBase / (denBase * denBase)) * denDelta;

        factors.push({
          label: ratioRule.numeratorLabel,
          contribution: numContrib,
          contributionPct: 0,
          detail: fmtDelta(numCur, numBase),
        });
        factors.push({
          label: ratioRule.denominatorLabel,
          contribution: denContrib,
          contributionPct: 0,
          detail: fmtDelta(denCur, denBase),
        });
      }
    }

    if (factors.length === 0) return null;

    // 计算贡献百分比
    const totalContrib = Math.abs(factors.reduce((s, f) => s + f.contribution, 0));
    for (const f of factors) {
      f.contributionPct = totalContrib > 0 ? Math.round((Math.abs(f.contribution) / totalContrib) * 100) : 0;
    }

    // 按贡献绝对值降序排列
    factors.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

    return {
      metricKey: flag.key,
      metricLabel: flag.label,
      current: flag.current,
      baseline: flag.baseline,
      delta: flag.deviation,
      factors,
    };
  }

  /** 对一组异常做批量归因 */
  attributeAnomalies(flags: AnomalyFlag[], current: CognitiveObservatory, baselineObs: CognitiveObservatory): MetricAttribution[] {
    return flags
      .filter(f => f.severity !== 'normal')
      .map(f => this.attribute(f, current, baselineObs))
      .filter(Boolean) as MetricAttribution[];
  }

  // ═══ v5.5.5 Causal Attribution ═══

  /**
   * 从指标异常出发，下钻到事件/边/链级别的根因
   * @returns 因果诊断树
   */
  traceRootCause(flag: AnomalyFlag, obs: CognitiveObservatory): CausalNode {
    const root: CausalNode = {
      label: `${flag.label} ${flag.deviation > 0 ? '+' : ''}${flag.deviation.toFixed(flag.deviation < 1 ? 2 : 0)}`,
      detail: `当前 ${fmtVal(flag.current)} · 基线 ${fmtVal(flag.baseline)}`,
      children: [],
    };

    switch (flag.key) {
      case 'explorationYield':
        root.children.push(...this.traceExplorationYield(obs));
        break;
      case 'strategyConversion':
        root.children.push(...this.traceRatioMetric(obs, 'strategyConversion'));
        break;
      case 'curiosityIndex':
      case 'chainQualityScore':
        root.children.push(...this.traceCompositeMetric(flag.key, obs));
        break;
      case 'deepChainRatio':
        root.children.push(...this.traceDeepChainRatio(obs));
        break;
      case 'branchEntropy':
        root.children.push(...this.traceBranchEntropy(obs));
        break;
      case 'learningVelocity':
        root.children.push(...this.traceLearningVelocity(obs));
        break;
    }

    return root;
  }

  /** 批量因果追踪 */
  traceAll(flags: AnomalyFlag[], obs: CognitiveObservatory): CausalNode[] {
    return flags
      .filter(f => f.severity !== 'normal')
      .map(f => this.traceRootCause(f, obs));
  }

  // ── 逐指标因果追踪器 ──

  /** explorationYield ↓ → 找边 + 链类型 + 重复发现 */
  private traceExplorationYield(obs: CognitiveObservatory): CausalNode[] {
    const nodes: CausalNode[] = [];

    // 1. 关键边 lift 分析
    const expToDiscEdge = obs.edgeDetail.find(e => e.from === 'ExplorationStarted' && e.to === 'DiscoveryStored');
    if (expToDiscEdge) {
      if (expToDiscEdge.lift !== null && expToDiscEdge.lift < 1.5) {
        nodes.push({
          label: 'Exploration→Discovery 因果弱化',
          detail: `Lift ×${expToDiscEdge.lift.toFixed(1)}，探索不产生发现`,
          children: [this.traceDuplicateBuildup(obs)],
        });
      }
    }

    // 2. 探索失败链比例 + 典型案例
    const totalExplorationChains = obs.chainLabels
      .filter(c => c.label === '探索型链' || c.label === '策略收敛链')
      .reduce((s, c) => s + c.count, 0);
    if (totalExplorationChains > 0) {
      const explorationChains = obs.chainLabels.find(c => c.label === '探索型链');
      const explCount = explorationChains?.count ?? 0;
      const ratio = explCount / totalExplorationChains;
      if (ratio > 0.6) {
        const failedChains = obs.chainDetail
          .filter(cd => cd.label === '探索型链' && cd.yield === 'none')
          .slice(0, 3);
        const children: CausalNode[] = [];
        if (failedChains.length > 0) {
          children.push({
            label: '无产出探索链案例',
            detail: `${failedChains.length} 条探索链未产生发现`,
            children: failedChains.map(cd => ({
              label: `链 ${cd.correlationId}`,
              detail: `深度${cd.depth} · ${cd.eventSeq}`,
              children: [] as CausalNode[],
            })),
          });
        }
        nodes.push({
          label: '探索型链占主导',
          detail: `${explCount}/${totalExplorationChains} 条探索链（${(ratio*100).toFixed(0)}%），其中部分无产出`,
          children,
        });
      }
    }

    // 3. 重复发现是否挤压新发现
    const dupNode = this.traceDuplicateBuildup(obs);
    if (dupNode.children.length > 0) nodes.push(dupNode);

    return nodes;
  }

  /** 重复发现积压 → 下钻到话题层 */
  private traceDuplicateBuildup(obs: CognitiveObservatory): CausalNode {
    const dupEdge = obs.edgeDetail.find(e => e.from === 'ExplorationStarted' && e.to === 'DiscoveryDuplicateSkipped');
    const storeEdge = obs.edgeDetail.find(e => e.from === 'ExplorationStarted' && e.to === 'DiscoveryStored');

    const dupCount = dupEdge?.count ?? 0;
    const storeCount = storeEdge?.count ?? 0;
    const total = dupCount + storeCount;

    const children: CausalNode[] = [];
    if (total > 0 && dupCount / total > 0.3) {
      children.push({
        label: `重复率 ${((dupCount/total)*100).toFixed(0)}%`,
        detail: `${dupCount} 次重复跳过 / ${total} 次总探索产出`,
        children: [],
      });
      if (storeEdge && dupEdge && dupEdge.lift !== null && storeEdge.lift !== null && dupEdge.lift > storeEdge.lift) {
        children.push({
          label: '重复路径 Lift > 发现路径',
          detail: `重复 Lift ×${dupEdge.lift.toFixed(1)} vs 发现 Lift ×${storeEdge.lift.toFixed(1)}`,
          children: [],
        });
      }

      // 话题细分：哪些话题在重复？
      if (obs.topicClusters.length > 0) {
        const topSkipped = obs.topicClusters
          .filter(tc => tc.skipped > 0)
          .sort((a, b) => b.skipped - a.skipped)
          .slice(0, 3);
        if (topSkipped.length > 0) {
          children.push({
            label: '高频重复话题',
            detail: `Top ${topSkipped.length} 个话题占主要重复`,
            children: topSkipped.map(tc => ({
              label: `"${tc.topic}" ×${tc.skipped} 次重复`,
              detail: `${tc.skipped} 跳过 / ${tc.total} 次总尝试`,
              children: [] as CausalNode[],
            })),
          });
        }
      }
    }

    return {
      label: '重复发现诊断',
      detail: total > 0 ? `${storeCount} 存储 · ${dupCount} 重复` : '无数据',
      children,
    };
  }

  /** 通用比率指标追踪 */
  private traceRatioMetric(obs: CognitiveObservatory, _key: string): CausalNode[] {
    const nodes: CausalNode[] = [];
    // 用 edgeDetail 找相关边
    const strategyEdges = obs.edgeDetail.filter(e => e.to === 'StrategySelected');
    if (strategyEdges.length === 0) {
      nodes.push({ label: '无策略选择事件', detail: '当前窗口未触发策略', children: [] });
    }
    return nodes;
  }

  /** 复合指标：逐子指标下钻 */
  private traceCompositeMetric(key: string, obs: CognitiveObservatory): CausalNode[] {
    const rule = RULES[key];
    if (!rule) return [];

    return rule.components.map(comp => {
      const curVal = comp.getCurrent(obs);
      const child: CausalNode = {
        label: `${comp.label} (权重 ${(comp.weight*100).toFixed(0)}%)`,
        detail: `当前 ${fmtVal(curVal)}`,
        children: [],
      };
      // 子指标如果也有对应的因果路径，继续下钻
      if (comp.key === 'explorationYield' && curVal < 0.5) {
        child.children.push(...this.traceExplorationYield(obs));
      } else if (comp.key === 'deepChainRatio' && curVal < 0.5) {
        child.children.push(...this.traceDeepChainRatio(obs));
      } else if (comp.key === 'strategyConversion' && curVal < 0.3) {
        child.children.push(...this.traceRatioMetric(obs, 'strategyConversion'));
      }
      return child;
    });
  }

  /** 深链占比 → 链类型分布诊断 */
  private traceDeepChainRatio(obs: CognitiveObservatory): CausalNode[] {
    const nodes: CausalNode[] = [];
    const shallow = obs.chainLabels.find(c => c.label === '浅回应链');
    const exploration = obs.chainLabels.find(c => c.label === '探索型链');
    const strategy = obs.chainLabels.find(c => c.label === '策略收敛链');

    if (shallow && shallow.count > 0) {
      const total = obs.chainLabels.reduce((s, c) => s + c.count, 0);
      const shallowPct = total > 0 ? shallow.count / total : 0;
      if (shallowPct > 0.4) {
        nodes.push({
          label: `浅回应链过多 (${shallow.count}条, ${(shallowPct*100).toFixed(0)}%)`,
          detail: '大量消息未触发深度认知 — 可能因用户输入过于简单或兴趣检测阈值过高',
          children: [],
        });
      }
    }

    if (exploration && strategy) {
      nodes.push({
        label: `链类型分布: 探索${exploration.count} · 策略${strategy.count} · 浅${shallow?.count ?? 0}`,
        detail: '深链 = 探索型链 + 策略收敛链',
        children: [],
      });
    }

    return nodes;
  }

  /** 分支熵变化 → 找主要的熵贡献边 */
  private traceBranchEntropy(obs: CognitiveObservatory): CausalNode[] {
    // 找 lift 最高和最低的边 — 它们贡献最多熵
    const top = obs.edgeDetail.slice(0, 3);
    const bottom = obs.edgeDetail.slice(-3);

    return [{
      label: '主要熵贡献边',
      detail: `共 ${obs.edgeDetail.length} 条因果边`,
      children: [
        ...top.map(e => ({
          label: `高Lift: ${e.fromLabel}→${e.toLabel}`,
          detail: `Lift ×${e.lift?.toFixed(1) ?? '?'} · ${e.count}次`,
          children: [] as CausalNode[],
        })),
        ...bottom.map(e => ({
          label: `低Lift: ${e.fromLabel}→${e.toLabel}`,
          detail: `Lift ×${e.lift?.toFixed(1) ?? '?'} · ${e.count}次`,
          children: [] as CausalNode[],
        })),
      ],
    }];
  }

  /** 学习速度变化 → 话题细分 */
  private traceLearningVelocity(obs: CognitiveObservatory): CausalNode[] {
    const storeEdges = obs.edgeDetail.filter(e => e.to === 'DiscoveryStored');
    const totalStored = storeEdges.reduce((s, e) => s + e.count, 0);

    const children: CausalNode[] = storeEdges.slice(0, 3).map(e => ({
      label: `${e.fromLabel}→DiscoveryStored`,
      detail: `Lift ×${e.lift?.toFixed(1) ?? '?'} · ${e.count}次`,
      children: [] as CausalNode[],
    }));

    // 话题细分
    const topTopics = obs.topicClusters
      .filter(tc => tc.stored > 0)
      .sort((a, b) => b.stored - a.stored)
      .slice(0, 3);
    if (topTopics.length > 0) {
      children.push({
        label: '主要发现话题',
        detail: `Top ${topTopics.length} 话题贡献最多发现`,
        children: topTopics.map(tc => ({
          label: `"${tc.topic}" ×${tc.stored} 次存储`,
          detail: `${tc.total} 次总探索`,
          children: [] as CausalNode[],
        })),
      });
    }

    return [{
      label: `发现存储: ${totalStored} 次`,
      detail: storeEdges.length > 0
        ? `来源: ${storeEdges.map(e => e.fromLabel).join(', ')}`
        : '无数据',
      children,
    }];
  }

  /** 统计 CognitiveObservatory 中某类事件的出现次数 */
  private countEvents(obs: CognitiveObservatory, type: string, depth = 0): number {
    if (depth > 2) return 10; // 避免循环调用，返回合理默认值

    if (type === 'DiscoveryStored' && obs.behavior.explorationYield !== null) {
      const started = this.countEvents(obs, 'ExplorationStarted', depth + 1);
      if (started > 0) {
        return Math.max(1, Math.round((obs.behavior.explorationYield ?? 0) * started));
      }
    }
    if (type === 'ExplorationStarted') {
      // 从链结构直接推断
      if (obs.structure.chainCount > 0) {
        const nonShallow = obs.structure.chainCount - obs.structure.depthDistribution.shallow;
        return Math.max(1, nonShallow);
      }
      return 5;
    }
    if (type === 'StrategySelected') {
      if (obs.behavior.strategyConversion !== null && obs.behavior.strategyConversion > 0) {
        const started = this.countEvents(obs, 'ExplorationStarted', depth + 1);
        return Math.max(1, Math.round((obs.behavior.strategyConversion ?? 0) * started));
      }
      return 1;
    }
    return 5;
  }
}

function fmtDelta(cur: number, base: number): string {
  const pct = (v: number) => (v * 100).toFixed(0) + '%';
  if (Math.abs(cur) < 2 && Math.abs(base) < 2) {
    return `${pct(cur)} → ${pct(base)}`;
  }
  return `${cur.toFixed(1)} → ${base.toFixed(1)}`;
}

// ── 从 anomaly 推导基线 CognitiveObservatory ──
// EWMA 代表最近趋势，需要近似一个 CognitiveObservatory 结构
export function inferBaselineObservatory(current: CognitiveObservatory, flags: AnomalyFlag[]): CognitiveObservatory {
  const base = JSON.parse(JSON.stringify(current)) as CognitiveObservatory;

  // 用 EWMA 值回填各项指标
  for (const flag of flags) {
    switch (flag.key) {
      case 'chainQualityScore': base.cognition.chainQualityScore = Math.round(flag.baseline); break;
      case 'curiosityIndex': base.cognition.curiosityIndex = Math.round(flag.baseline); break;
      case 'explorationYield': base.behavior.explorationYield = flag.baseline; break;
      case 'branchEntropy': base.graph.branchEntropy = flag.baseline; break;
      case 'learningVelocity': base.cognition.learningVelocity = flag.baseline; break;
      case 'deepChainRatio': base.structure.deepChainRatio = flag.baseline; break;
      case 'strategyConversion': base.behavior.strategyConversion = flag.baseline; break;
    }
  }
  return base;
}

export const attributionEngine = new AttributionEngine();
