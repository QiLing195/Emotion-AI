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
