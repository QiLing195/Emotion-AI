// v6.0-pre: Pattern Library — 跨窗口模式积累与知识沉淀
// 将 ChainDetail.eventSeq 归一化为 PatternSignature，跨窗口统计

import type { ChainDetail, ChainLabel } from '../eventBus';

// ── 归一化模式签名（事件类型序列） ──
export type PatternSignature = string; // e.g. "UM→ID→ES→DS→SS→EC"

export function normalizeSignature(eventSeq: string): PatternSignature {
  // 已经是缩写序列，直接作为签名
  return eventSeq.trim();
}

// ── 模式记录 ──
export interface PatternRecord {
  signature: PatternSignature;
  label: ChainLabel;
  total: number;          // 出现总次数
  successes: number;      // yield='stored'
  failures: number;       // yield='skipped' | 'none'
  avgDepth: number;       // 平均深度
  firstSeen: number;      // 首次出现时间戳
  lastSeen: number;       // 最近出现时间戳
  examples: string[];     // 最近 3 个 correlationIds
}

// ── 推荐建议 ──
export interface Recommendation {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  pattern: PatternSignature;
}

// ── 库统计 ──
export interface LibraryStats {
  totalPatterns: number;
  totalChains: number;
  overallSuccessRate: number;
  topSuccessPattern: PatternRecord | null;
  topFailurePattern: PatternRecord | null;
}

// ── Pattern Library ──
class PatternLibrary {
  private patterns = new Map<PatternSignature, PatternRecord>();
  private maxExamples = 3;

  /** 从单次快照的 chainDetail 中吸取经验 */
  ingest(chains: ChainDetail[]): void {
    const now = Date.now();

    for (const c of chains) {
      // 忽略过短的链（< 3 事件）= 浅回应链无学习价值
      if (c.depth < 3) continue;

      const sig = normalizeSignature(c.eventSeq);
      const existing = this.patterns.get(sig);

      const isSuccess = c.yield === 'stored';
      const isFailure = c.yield === 'skipped' || c.yield === 'none';

      if (existing) {
        existing.total++;
        if (isSuccess) existing.successes++;
        if (isFailure) existing.failures++;
        // 滑动平均深度
        existing.avgDepth = (existing.avgDepth * (existing.total - 1) + c.depth) / existing.total;
        existing.lastSeen = now;
        // 保留最近案例
        if (existing.examples.length >= this.maxExamples) {
          existing.examples.shift();
        }
        existing.examples.push(c.correlationId);
      } else {
        this.patterns.set(sig, {
          signature: sig,
          label: c.label,
          total: 1,
          successes: isSuccess ? 1 : 0,
          failures: isFailure ? 1 : 0,
          avgDepth: c.depth,
          firstSeen: now,
          lastSeen: now,
          examples: [c.correlationId],
        });
      }
    }

    // 清理超过 24h 未出现的低频模式（保留至少 50 条）
    if (this.patterns.size > 60) {
      const cutoff = now - 24 * 60 * 60 * 1000;
      for (const [sig, p] of this.patterns) {
        if (p.lastSeen < cutoff && p.total <= 2) {
          this.patterns.delete(sig);
        }
      }
    }
  }

  /** Top 成功模式（按成功率×出现次数排序） */
  getTopPatterns(n = 5): PatternRecord[] {
    return Array.from(this.patterns.values())
      .filter(p => p.total >= 2 && p.successes > 0)
      .sort((a, b) => {
        const scoreA = (a.successes / a.total) * Math.log(a.total + 1);
        const scoreB = (b.successes / b.total) * Math.log(b.total + 1);
        return scoreB - scoreA;
      })
      .slice(0, n);
  }

  /** Top 反模式（高频率 + 低成功率） */
  getAntiPatterns(n = 5): PatternRecord[] {
    return Array.from(this.patterns.values())
      .filter(p => p.total >= 2 && p.failures > 0)
      .sort((a, b) => {
        const failRateA = a.failures / a.total;
        const failRateB = b.failures / b.total;
        return (failRateB * Math.log(b.total + 1)) - (failRateA * Math.log(a.total + 1));
      })
      .slice(0, n);
  }

  /** 自动生成建议 */
  getRecommendations(): Recommendation[] {
    const recs: Recommendation[] = [];
    const antiPatterns = this.getAntiPatterns(5);
    const topPatterns = this.getTopPatterns(5);

    for (const ap of antiPatterns) {
      const failRate = ap.failures / ap.total;
      const events = ap.signature.split('→');

      // 检测 Exploration→Duplicate 模式
      const hasDD = events.includes('DD');
      const hasDS = events.includes('DS');
      const hasSS = events.includes('SS');
      const hasES = events.includes('ES');

      if (hasDD && !hasDS && failRate > 0.6) {
        recs.push({
          severity: 'high',
          title: `重复探索循环: ${ap.signature}`,
          detail: `该模式出现 ${ap.total} 次，失败率 ${(failRate*100).toFixed(0)}%。建议在 ExplorationStarted 后增加 Topic Novelty Check`,
          pattern: ap.signature,
        });
      } else if (hasES && !hasSS && ap.avgDepth < 5 && failRate > 0.5) {
        recs.push({
          severity: 'medium',
          title: `探索未触发策略: ${ap.signature}`,
          detail: `探索链平均深度 ${ap.avgDepth.toFixed(1)}，但未生成策略。建议降低 StrategySelection 阈值`,
          pattern: ap.signature,
        });
      } else if (failRate > 0.7) {
        recs.push({
          severity: 'high',
          title: `高频失败模式: ${ap.signature}`,
          detail: `${ap.total} 次中出现 ${ap.failures} 次失败。建议检查该路径的事件前置条件`,
          pattern: ap.signature,
        });
      }
    }

    // 检测成功模式在衰退
    for (const tp of topPatterns) {
      const successRate = tp.successes / tp.total;
      const hoursSinceLast = (Date.now() - tp.lastSeen) / 3600000;

      if (successRate > 0.8 && hoursSinceLast > 2 && tp.total >= 3) {
        recs.push({
          severity: 'low',
          title: `成功模式近期缺位: ${tp.signature}`,
          detail: `过去 ${hoursSinceLast.toFixed(1)}h 未出现该成功路径。成功率曾达 ${(successRate*100).toFixed(0)}%，可能值得重新激活`,
          pattern: tp.signature,
        });
      }
    }

    return recs.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    });
  }

  /** 库统计 */
  getStats(): LibraryStats {
    const all = Array.from(this.patterns.values());
    const totalChains = all.reduce((s, p) => s + p.total, 0);
    const totalSuccess = all.reduce((s, p) => s + p.successes, 0);

    return {
      totalPatterns: this.patterns.size,
      totalChains,
      overallSuccessRate: totalChains > 0 ? totalSuccess / totalChains : 0,
      topSuccessPattern: all.filter(p => p.successes > 0).sort((a, b) => b.successes - a.successes)[0] || null,
      topFailurePattern: all.filter(p => p.failures > 0).sort((a, b) => b.failures - a.failures)[0] || null,
    };
  }

  /** 清空 */
  reset(): void {
    this.patterns.clear();
  }
}

export const patternLibrary = new PatternLibrary();
