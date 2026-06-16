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
