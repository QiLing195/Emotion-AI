import { describe, it, expect } from 'vitest';
import { applyNonUserTurnBudget } from '../turnBudget.js';
import { scaleSourcesForBudget, emptyEmergenceStats } from '../emergenceMetrics.js';
import type { EmotionState } from '../emotionTypes';

function state(emotions: Record<string, number>, valence: number, arousal: number): EmotionState {
  return {
    emotions,
    taiji: { valence, arousal, expectation: 0.2, energy: 0.5 } as never,
    evolution: { sensitivity: 0.5, empathy: 50, optimism: 0.5 } as never,
    internal: {},
  } as unknown as EmotionState;
}

function delta(a: EmotionState, b: EmotionState): number {
  const keys = new Set([...Object.keys(a.emotions), ...Object.keys(b.emotions)]);
  let sum = 0;
  for (const k of keys) sum += Math.abs(Number((a.emotions as never)[k] ?? 0) - Number((b.emotions as never)[k] ?? 0));
  sum += Math.abs(a.taiji.valence - b.taiji.valence) + Math.abs(a.taiji.arousal - b.taiji.arousal);
  return sum;
}

describe('v2.03：非用户来源的单轮总预算（审查 P1-2）', () => {
  it('未超预算 → 原样返回（scale=1）', () => {
    const base = { emotions: { sad: 0.1, calm: 0.8 }, valence: 0.1, arousal: 0.2 };
    const s = state({ sad: 0.13, calm: 0.78 }, 0.08, 0.22);
    const r = applyNonUserTurnBudget(s, base, 0.25);
    expect(r.scale).toBe(1);
    expect(r.state).toBe(s);
  });

  it('超预算 → 等比缩回，缩后总变化 ≈ cap', () => {
    const base = { emotions: { sad: 0.1, calm: 0.8 }, valence: 0.1, arousal: 0.2 };
    // 累计变化：sad +0.3, calm -0.2, valence -0.2, arousal +0.2 → 远超 0.25
    const s = state({ sad: 0.4, calm: 0.6 }, -0.1, 0.4);
    const before = delta(s, state(base.emotions, base.valence, base.arousal));
    expect(before).toBeGreaterThan(0.25);
    const r = applyNonUserTurnBudget(s, base, 0.25);
    expect(r.scale).toBeLessThan(1);
    const after = delta(r.state, state(base.emotions, base.valence, base.arousal));
    expect(after).toBeLessThanOrEqual(0.2501);
    expect(after).toBeCloseTo(0.25, 2);
    // 方向保持（没有反转正负）
    expect(r.state.emotions.sad).toBeGreaterThan(base.emotions.sad);
    expect(r.state.taiji.valence).toBeLessThan(base.valence);
  });

  it('预算缩放后来源记账同步缩小（来源之和 ≈ 实际变化）', () => {
    const stats = {
      ...emptyEmergenceStats(),
      external: 0.1,
      contagion: 0.2,
      appraisal: 0.2,
      internal: 0.2,
      mood: 0.1,
      rumination: 0.1,
    };
    const scaled = scaleSourcesForBudget(stats, ['contagion', 'appraisal', 'internal', 'mood', 'rumination'], 0.5);
    expect(scaled.external).toBe(0.1); // 用户来源不动
    expect(scaled.contagion).toBeCloseTo(0.1);
    expect(scaled.appraisal).toBeCloseTo(0.1);
    expect(scaled.internal).toBeCloseTo(0.1);
    expect(scaled.mood).toBeCloseTo(0.05);
    expect(scaled.rumination).toBeCloseTo(0.05);
  });
});
