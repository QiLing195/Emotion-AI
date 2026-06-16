// v6.0-pre: Case Analyzer — 案例排行 + 对比诊断
// 从 ChainDetail 数据中提取最佳/最差案例，自动对比成功链与失败链

import type { ChainDetail } from '../eventBus';

// ── 案例排行 ──
export interface CaseRanking {
  best: ChainDetail[];      // 成功探索链，按 depth 降序
  worst: ChainDetail[];     // 无产出/跳过链，按 depth 降序
  deepest: ChainDetail[];   // 最深链 Top 5
  strategic: ChainDetail[]; // 含策略选择的链
}

export function rankCases(chains: ChainDetail[]): CaseRanking {
  const withDiscovery = chains.filter(c => c.hasDiscovery);
  const withoutDiscovery = chains.filter(c => !c.hasDiscovery || c.yield === 'skipped' || c.yield === 'none');

  return {
    best: withDiscovery
      .filter(c => c.yield === 'stored')
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 5),
    worst: withoutDiscovery
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 5),
    deepest: [...chains]
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 5),
    strategic: chains
      .filter(c => c.hasStrategy)
      .sort((a, b) => b.depth - a.depth)
      .slice(0, 5),
  };
}

// ── 对比诊断 ──
export interface ChainComparison {
  failed: ChainDetail;
  compared: ChainDetail;
  divergenceAt: number;              // 从第几个事件开始分叉（0-indexed）
  failedEvent: string;              // 失败链在分叉点的事件类型
  successEvent: string;             // 成功链在分叉点的事件类型
  sharedPrefix: string;            // 共同前缀的事件序列
  summary: string;                 // 人类可读摘要
}

/**
 * 为一条失败链找到最相似的成功链，并输出对比
 */
export function compareChains(failed: ChainDetail, allChains: ChainDetail[]): ChainComparison | null {
  // 找最相似的成功链：与失败链共享最长前缀的 stored 链
  const candidates = allChains.filter(c => c.yield === 'stored' && c.correlationId !== failed.correlationId);
  if (candidates.length === 0) return null;

  const failedEvents = failed.eventSeq.split('→');
  let bestMatch: ChainDetail | null = null;
  let bestPrefixLen = 0;

  for (const c of candidates) {
    const candEvents = c.eventSeq.split('→');
    let prefixLen = 0;
    for (let i = 0; i < Math.min(failedEvents.length, candEvents.length); i++) {
      if (failedEvents[i] === candEvents[i]) prefixLen++;
      else break;
    }
    if (prefixLen > bestPrefixLen) {
      bestPrefixLen = prefixLen;
      bestMatch = c;
    }
  }

  if (!bestMatch || bestPrefixLen === 0) return null;

  const successEvents = bestMatch.eventSeq.split('→');
  const divIdx = bestPrefixLen;

  const failedEvent = failedEvents[divIdx] || '(结束)';
  const successEvent = successEvents[divIdx] || '(结束)';

  const sharedPrefix = failedEvents.slice(0, divIdx).join('→');

  // 生成摘要
  let summary: string;
  if (failedEvent === 'DD' && successEvent === 'DS') {
    summary = '分歧点: 重复跳过 vs 发现存储 — 同样的话题在本链中被判定为重复';
  } else if (failedEvent === '(结束)' && successEvent !== '(结束)') {
    summary = `失败链提前结束，缺少 ${successEvent} 阶段`;
  } else if (failedEvent !== successEvent) {
    summary = `分歧点: ${failedEvent} vs ${successEvent}`;
  } else {
    summary = '链结构相似但产出不同';
  }

  return {
    failed,
    compared: bestMatch,
    divergenceAt: divIdx,
    failedEvent,
    successEvent,
    sharedPrefix,
    summary,
  };
}
