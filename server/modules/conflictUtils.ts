// server.ts 冲突检测工具函数（纯函数，无副作用）

import { CONFLICT_KEYWORDS, RECOVERY_KEYWORDS } from './constants.js';

export function detectConflictSignals(userText: string): number {
  let count = 0;
  for (const pat of CONFLICT_KEYWORDS) {
    if (pat.test(userText)) { count++; break; }
  }
  return count;
}

export function hasRecoverySignal(userText: string): boolean {
  return RECOVERY_KEYWORDS.some(p => p.test(userText));
}

/** 阶段划分：纯函数，根据交互轮次判断关系阶段 */
export function getPhase(tick: number): number {
    if (tick < 500) return 1;
    if (tick < 2000) return 2;
    return 3;
}

export function consequentValence(consequent: string): number {
    if (consequent.includes('关怀') || consequent.includes('在乎') || consequent.includes('爱')) return 1;
    if (consequent.includes('疏远') || consequent.includes('冷落') || consequent.includes('抛弃')) return -1;
    if (consequent.includes('操控') || consequent.includes('利用')) return -0.8;
    return 0;
}
