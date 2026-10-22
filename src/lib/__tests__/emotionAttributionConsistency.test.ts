import { describe, it, expect } from 'vitest';
import { reconcileAttribution } from '../emotionAttributionConsistency.js';
import type { EmotionEvent, UserEmotionAnalysis } from '../emotionTypes';

const event = (intent: EmotionEvent['intent']): EmotionEvent => ({
  deltaA: 0.2, deltaB: -0.1, deltaR: 0.05, intent,
  GC: 0.4, agency: -0.3, fairness: 0.2, control: 0.1,
});
const analysis = (over: Partial<UserEmotionAnalysis> = {}): UserEmotionAnalysis => ({
  expressedEmotion: 'love',
  likelyCause: '对你有感情表达',
  intensity: 0.7,
  directedAtAI: true,
  ...over,
});

describe('v2.03：事件归因 × 用户情绪归因的一致性（审查 P1-3）', () => {
  it('一致组合（intent=user + directedAtAI=true）原样通过', () => {
    const r = reconcileAttribution(event('user'), analysis());
    expect(r.consensus).toBe('consistent');
    expect(r.skipReinforcement).toBe(false);
    expect(r.analysis.directedAtAI).toBe(true);
  });

  it('矛盾组合（intent=self 却说 directedAtAI）→ 降级、不强化、强度打折', () => {
    const r = reconcileAttribution(event('self'), analysis());
    expect(r.consensus).toBe('downgraded');
    expect(r.skipReinforcement).toBe(true);
    expect(r.analysis.directedAtAI).toBe(false);
    expect(r.analysis.intensity).toBeLessThan(0.7);
    expect(r.analysis.attribution?.issues.length).toBeGreaterThan(0);
  });

  it('矛盾组合（intent=user 但 directedAtAI=false，且情绪非中性）→ 降级', () => {
    const r = reconcileAttribution(event('user'), analysis({ directedAtAI: false }));
    expect(r.consensus).toBe('downgraded');
    expect(r.skipReinforcement).toBe(true);
  });

  it('引用/转述证据 + 指向她 → 视为不确定，不强化', () => {
    const r = reconcileAttribution(event('user'), analysis({ evidence: '他说他不喜欢我' }));
    expect(r.consensus).toBe('downgraded');
    expect(r.analysis.directedAtAI).toBe(false);
  });

  it('强度很低但事件幅度很大 → 降级（证据不一致）', () => {
    const big = { ...event('user'), deltaA: 0.5, deltaB: 0.5, deltaR: 0.5 };
    const r = reconcileAttribution(big, analysis({ intensity: 0.05 }));
    expect(r.consensus).toBe('downgraded');
  });

  it('没有分析结果 → unknown 且不强化（保守）', () => {
    const r = reconcileAttribution(event('user'), null);
    expect(r.consensus).toBe('unknown');
    expect(r.skipReinforcement).toBe(true);
  });
});
