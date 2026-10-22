/**
 * v2.03：情绪归因一致性（审查 P1-3）。
 *
 * 现状问题：LLM 同时产出 `emotionEvent.intent`（情绪事件属于谁）和
 * `userAnalysis.directedAtAI`（用户情绪是否指向她），两者分开校验、互不比对。
 * 矛盾组合（如"事件是 self，但用户情绪被判成指向她"）会让下游奖惩强化按一个走、
 * 情绪计算按另一个走，角色状态不一致。
 *
 * 这里只做**一致性裁决**（纯函数、无副作用）：
 *   - 一致 → 原样通过；
 *   - 矛盾 → `directedAtAI` 降级为 false（宁可少强化，也不错误奖励/惩罚）+ 强度 ×0.6；
 *   - 调用方据 `skipReinforcement` 跳过奖惩强化。
 */
import type { EmotionEvent, UserEmotionAnalysis } from './emotionTypes';

export type AttributionConsensus = 'consistent' | 'downgraded' | 'unknown';

export interface AttributionReconciliation {
  analysis: UserEmotionAnalysis;
  consensus: AttributionConsensus;
  issues: string[];
  /** true = 本轮不要走奖惩强化（定向归因不可信） */
  skipReinforcement: boolean;
}

/**
 * intent 语义：'user' = 这件事是关于他的；'self' = 关于她自己；'third_party' = 第三方。
 */
export function reconcileAttribution(
  event: EmotionEvent | null | undefined,
  analysis: UserEmotionAnalysis | null | undefined,
): AttributionReconciliation {
  if (!analysis) {
    return {
      analysis: analysis as unknown as UserEmotionAnalysis,
      consensus: 'unknown',
      issues: ['missing_user_analysis'],
      skipReinforcement: true,
    };
  }
  const next: UserEmotionAnalysis = { ...analysis };
  const issues: string[] = [];

  // 1) 用户情绪指向她，但情绪事件不是关于她的 → 矛盾
  if (next.directedAtAI && event && event.intent && event.intent !== 'user') {
    issues.push(`directedAtAI=true 但 event.intent=${event.intent}`);
  }
  // 2) 情绪事件是关于她的，但用户情绪被判成不指向她 → 矛盾
  if (!next.directedAtAI && event && event.intent === 'user' && next.expressedEmotion !== 'neutral') {
    issues.push('event.intent=user 但 directedAtAI=false');
  }
  // 3) 强度很低但事件幅度很大 → 证据不一致，别做重判断
  if (next.expressedEmotion !== 'neutral' && next.intensity < 0.15 && event
      && (Math.abs(event.deltaA) + Math.abs(event.deltaB) + Math.abs(event.deltaR)) > 0.6) {
    issues.push('intensity 很低但事件幅度很大（证据不一致）');
  }
  // 4) 引语/转述：本地识别已把 directedAtAI 置 false；若模型仍判 true，视为不确定
  if (next.directedAtAI && next.evidence && /引用|转述|他说|她说|朋友/.test(next.evidence)) {
    issues.push('可能是引用/转述，却判成指向她');
  }

  if (issues.length === 0) {
    return { analysis: next, consensus: 'consistent', issues, skipReinforcement: false };
  }

  next.directedAtAI = false;
  next.intensity = Math.max(0, Math.min(1, next.intensity * 0.6));
  next.attribution = { consensus: 'downgraded', issues };
  return { analysis: next, consensus: 'downgraded', issues, skipReinforcement: true };
}
