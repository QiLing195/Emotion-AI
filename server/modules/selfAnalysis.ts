// @ts-nocheck
// 自省函数组 (从 server.ts L465-510 抽取)
// 依赖: semanticMemory

import type { ServerContext } from './context.js';

export function selfAnalyze(ctx: ServerContext): { selfValence: number; selfSalience: number } {
  const semanticMemory = ctx.semanticMemory;
  if (semanticMemory.size === 0) return { selfValence: 0, selfSalience: 0 };
  let totalValence = 0, totalOccurrences = 0;
  for (const r of semanticMemory.values()) { totalValence += r.totalValence; totalOccurrences += r.occurrences; }
  return {
    selfValence: (totalValence / Math.max(totalOccurrences, 1)) * 0.3,
    selfSalience: Math.min(1, totalOccurrences / 20) * 0.3,
  };
}

export function querySimilar(ctx: ServerContext, text: string): { key: string; totalValence: number; occurrences: number; lastSeen: number }[] {
  const semanticMemory = ctx.semanticMemory;
  if (!text || semanticMemory.size === 0) return [];
  const key = text.replace(/[^\u4e00-\u9fff\w]/g, '').toLowerCase();
  if (!key) return [];
  const results: any[] = [];
  for (const [k, v] of semanticMemory.entries()) {
    let score = 0;
    if (k.includes(key) || key.includes(k)) score = Math.max(key.length, k.length);
    else {
      let matches = 0;
      for (const ch of key) { if (k.includes(ch)) matches++; }
      score = matches / Math.max(key.length, 1);
    }
    if (score > 0.3) results.push({ key: k, totalValence: (v as any).totalValence, occurrences: (v as any).occurrences, lastSeen: (v as any).lastSeen, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function canSelfUnderstand(ctx: ServerContext, phrase: string, tick: number): boolean {
  const record = ctx.semanticMemory.get(phrase);
  if (!record) return false;
  const phase = tick < 500 ? 1 : tick < 2000 ? 2 : 3;
  return record.occurrences >= phase;
}

export function selfUnderstand(ctx: ServerContext, phrase: string): { valence: number; salience: number; dominance: number } | null {
  const r = ctx.semanticMemory.get(phrase);
  if (!r) return null;
  const valence = r.totalValence / r.occurrences;
  return {
    valence: Math.tanh(valence * 2) * 0.7,
    salience: Math.min(1, r.occurrences / 10) * 0.5,
    dominance: 0.3,
  };
}
