// v5.5: Pattern Discovery Engine
// 自动发现认知结构的显著变化 — 新高 Lift 边、探索退化、链类型迁移

import type { CognitiveObservatory, EdgeMetric, ChainLabelCount } from '../eventBus';
import type { MetricTimeSeries, TrendSnapshot } from './trendTracker';

// ── 发现类型 ──
export type PatternType =
  | 'emerging_edge'         // 新出现的高 Lift 因果边
  | 'fading_edge'           // 正在消失的因果边
  | 'exploration_degradation' // 探索产出持续下降
  | 'entropy_convergence'   // 分支熵持续收敛（行为固化）
  | 'entropy_divergence'    // 分支熵持续发散（行为探索期）
  | 'chain_type_shift'      // 链类型分布突变
  | 'velocity_surge'        // 学习速度突然上升
  | 'velocity_drop';        // 学习速度突然下降

export interface DiscoveredPattern {
  type: PatternType;
  title: string;              // 人类可读标题
  detail: string;             // 详细描述
  importance: 'high' | 'medium' | 'low';
  evidence: string;           // 证据（数值变化）
  icon: string;               // emoji
}

// ── 历史边快照（用于对比） ──
interface EdgeSnapshot {
  timestamp: number;
  strongestEdges: EdgeMetric[];
}

// ── Pattern Detector ──
class PatternDetector {
  private edgeHistory: EdgeSnapshot[] = [];
  private maxEdgeHistory = 20; // 保留最近 20 个边快照

  /** 记录当前最强的因果边 */
  recordEdges(obs: CognitiveObservatory): void {
    this.edgeHistory.push({
      timestamp: Date.now(),
      strongestEdges: obs.graph.strongestEdges.slice(0, 10),
    });
    if (this.edgeHistory.length > this.maxEdgeHistory) {
      this.edgeHistory.splice(0, this.edgeHistory.length - this.maxEdgeHistory);
    }
  }

  /** 主入口：发现当前窗口内的所有显著模式 */
  discover(obs: CognitiveObservatory, timeSeries: Map<string, MetricTimeSeries>, snapshotCount: number): DiscoveredPattern[] {
    if (snapshotCount < 10) return []; // 数据不足

    const patterns: DiscoveredPattern[] = [];

    // 1. 新兴/消退边
    const edgePatterns = this.detectEdgeChanges(obs);
    patterns.push(...edgePatterns);

    // 2. 探索退化
    const yieldTS = timeSeries.get('explorationYield');
    if (yieldTS && yieldTS.values.length >= 10) {
      const degradation = this.detectExplorationDegradation(yieldTS);
      if (degradation) patterns.push(degradation);
    }

    // 3. 熵变化
    const entropyTS = timeSeries.get('branchEntropy');
    if (entropyTS && entropyTS.values.length >= 10) {
      const entropyPattern = this.detectEntropyShift(entropyTS);
      if (entropyPattern) patterns.push(entropyPattern);
    }

    // 4. 学习速度突变
    const velocityTS = timeSeries.get('learningVelocity');
    if (velocityTS && velocityTS.values.length >= 10) {
      const velPattern = this.detectVelocityShift(velocityTS);
      if (velPattern) patterns.push(velPattern);
    }

    // 5. 链类型迁移
    const chainShift = this.detectChainTypeShift(obs);
    if (chainShift) patterns.push(chainShift);

    return patterns;
  }

  /** 新兴高 Lift 边 / 消退边 */
  private detectEdgeChanges(obs: CognitiveObservatory): DiscoveredPattern[] {
    if (this.edgeHistory.length < 3) return [];
    const patterns: DiscoveredPattern[] = [];

    const current = obs.graph.strongestEdges;
    const historical = this.edgeHistory[0].strongestEdges;

    const currentKeys = new Set(current.map(e => e.edge));
    const histKeys = new Set(historical.map(e => e.edge));

    // 新出现的高 lift 边
    for (const e of current) {
      if (!histKeys.has(e.edge) && e.lift >= 2.0 && e.count >= 3) {
        patterns.push({
          type: 'emerging_edge',
          title: `新因果路径: ${shortEdge(e.edge)}`,
          detail: `之前未出现或 Lift 不显著，当前 Lift=${e.lift.toFixed(1)}，${e.count}次`,
          importance: e.lift >= 4.0 ? 'high' : 'medium',
          evidence: `Lift ×${e.lift.toFixed(1)} · 频次 ${e.count}`,
          icon: '🔗',
        });
      }
    }

    // 消退的边
    for (const e of historical) {
      if (!currentKeys.has(e.edge) && e.count >= 3) {
        patterns.push({
          type: 'fading_edge',
          title: `因果路径消退: ${shortEdge(e.edge)}`,
          detail: `之前 Lift=${e.lift.toFixed(1)} (${e.count}次)，当前已不显著`,
          importance: 'low',
          evidence: `曾 Lift ×${e.lift.toFixed(1)}`,
          icon: '🔻',
        });
      }
    }

    return patterns;
  }

  /** 探索产出持续下降 */
  private detectExplorationDegradation(ts: MetricTimeSeries): DiscoveredPattern | null {
    const vals = ts.values;
    if (vals.length < 10) return null;

    const recent = vals.slice(-5);
    const older = vals.slice(-10, -5);

    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;

    if (olderMean > 0.2 && recentMean < olderMean * 0.7) {
      return {
        type: 'exploration_degradation',
        title: '探索产出退化',
        detail: `近5个窗口的平均产出率 ${(recentMean * 100).toFixed(0)}%，较前5个窗口下降 >30%`,
        importance: 'high',
        evidence: `${(olderMean * 100).toFixed(0)}% → ${(recentMean * 100).toFixed(0)}%`,
        icon: '📉',
      };
    }
    return null;
  }

  /** 分支熵趋势 */
  private detectEntropyShift(ts: MetricTimeSeries): DiscoveredPattern | null {
    const vals = ts.values;
    if (vals.length < 10) return null;

    const recent = vals.slice(-5);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;

    // 收敛检测
    const recentRange = Math.max(...recent) - Math.min(...recent);
    if (ts.trend === 'falling' && recentRange < 0.2 && mean < 1.5) {
      return {
        type: 'entropy_convergence',
        title: '分支熵收敛 — 行为固化',
        detail: `近5个窗口分支熵稳定在 ${mean.toFixed(2)}（低不确定性），系统正在形成固定行为模式`,
        importance: 'medium',
        evidence: `熵 ${mean.toFixed(2)} · 波动 ${ts.volatilityLevel}`,
        icon: '🎯',
      };
    }

    if (ts.trend === 'rising' && mean > 2.0) {
      return {
        type: 'entropy_divergence',
        title: '分支熵发散 — 探索期',
        detail: `分支熵持续上升至 ${mean.toFixed(2)}，系统处于高不确定性探索阶段`,
        importance: 'medium',
        evidence: `熵 ${mean.toFixed(2)} · 趋势 rising`,
        icon: '🌊',
      };
    }

    return null;
  }

  /** 学习速度突变 */
  private detectVelocityShift(ts: MetricTimeSeries): DiscoveredPattern | null {
    const vals = ts.values;
    if (vals.length < 8) return null;

    const recent = vals.slice(-3);
    const older = vals.slice(-6, -3);
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderMean = older.reduce((a, b) => a + b, 0) / older.length;

    if (olderMean > 0.5 && recentMean > olderMean * 2.0) {
      return {
        type: 'velocity_surge',
        title: '学习速度激增',
        detail: `近3个窗口平均 ${recentMean.toFixed(1)}/min，较前3个窗口翻倍`,
        importance: 'high',
        evidence: `${olderMean.toFixed(1)} → ${recentMean.toFixed(1)}/min`,
        icon: '🚀',
      };
    }

    if (olderMean > 0.5 && recentMean < olderMean * 0.4) {
      return {
        type: 'velocity_drop',
        title: '学习速度骤降',
        detail: `近3个窗口平均 ${recentMean.toFixed(1)}/min，较前3个窗口下降 >60%`,
        importance: 'high',
        evidence: `${olderMean.toFixed(1)} → ${recentMean.toFixed(1)}/min`,
        icon: '🐌',
      };
    }

    return null;
  }

  /** 链类型分布变化 */
  private detectChainTypeShift(obs: CognitiveObservatory): DiscoveredPattern | null {
    // 用现有指标推断：深链占比显著变化
    const deepRatio = obs.structure.deepChainRatio;
    const isolatedRatio = obs.structure.isolatedRatio;

    if (deepRatio > 0.7 && obs.structure.chainCount >= 5) {
      return {
        type: 'chain_type_shift',
        title: '深链主导',
        detail: `深链占比 ${(deepRatio * 100).toFixed(0)}%，系统处于深度认知加工模式`,
        importance: 'medium',
        evidence: `深链 ${obs.structure.depthDistribution.deep} · 中链 ${obs.structure.depthDistribution.medium} · 浅链 ${obs.structure.depthDistribution.shallow}`,
        icon: '🧠',
      };
    }

    if (isolatedRatio > 0.6 && obs.structure.chainCount >= 5) {
      return {
        type: 'chain_type_shift',
        title: '浅链泛滥',
        detail: `孤立链占比 ${(isolatedRatio * 100).toFixed(0)}%，大量消息未触发深度认知处理`,
        importance: 'medium',
        evidence: `浅链 ${obs.structure.depthDistribution.shallow} · 总链 ${obs.structure.chainCount}`,
        icon: '📭',
      };
    }

    return null;
  }

  /** 清空历史 */
  reset(): void {
    this.edgeHistory = [];
  }
}

function shortEdge(edge: string): string {
  const [from, to] = edge.split('→');
  const short = (s: string) => s.length > 12 ? s.slice(0, 10) + '..' : s;
  return `${short(from)}→${short(to)}`;
}

export const patternDetector = new PatternDetector();
