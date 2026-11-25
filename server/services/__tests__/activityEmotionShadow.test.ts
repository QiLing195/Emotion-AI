import { describe, expect, it } from 'vitest';
import type { ActivityUnderstanding } from '../activityUnderstanding.js';
import { emptyActivityEmotionShadow, stepActivityEmotionShadow } from '../activityEmotionShadow.js';

const dev: ActivityUnderstanding = {
  summary: '你在写代码/弄项目',
  category: 'dev',
  label: '写代码',
  confidence: 1,
  windows: 2,
  spanMinutes: 0.33,
  categories: [{ key: 'dev', label: '写代码', count: 2, share: 1 }],
  evidence: ['private-project.ts'],
  vague: false,
};

const study: ActivityUnderstanding = {
  ...dev,
  category: 'study',
  label: '学习',
  summary: '你在学东西',
  categories: [{ key: 'study', label: '学习', count: 2, share: 1 }],
};

describe('activity emotion threshold shadow (read-only)', () => {
  it('raises 1, 2, and 5 minute candidates at the observed elapsed thresholds', () => {
    let state = emptyActivityEmotionShadow();
    let result = stepActivityEmotionShadow(state, dev, 1_000_000);
    state = result.state;
    expect(result.diagnostics.candidates).toEqual({ oneMinute: false, twoMinutes: false, fiveMinutes: false });

    result = stepActivityEmotionShadow(state, dev, 1_060_000);
    state = result.state;
    expect(result.diagnostics.candidates).toEqual({ oneMinute: true, twoMinutes: false, fiveMinutes: false });

    result = stepActivityEmotionShadow(state, dev, 1_120_000);
    state = result.state;
    expect(result.diagnostics.candidates).toEqual({ oneMinute: true, twoMinutes: true, fiveMinutes: false });

    result = stepActivityEmotionShadow(state, dev, 1_180_000);
    state = result.state;
    result = stepActivityEmotionShadow(state, dev, 1_240_000);
    state = result.state;
    result = stepActivityEmotionShadow(state, dev, 1_300_000);
    expect(result.diagnostics.candidates).toEqual({ oneMinute: true, twoMinutes: true, fiveMinutes: true });
    expect(result.diagnostics.observedCategory).toBe('dev');
    expect(result.diagnostics.sampleCount).toBe(6);
  });

  it('restarts a candidate window on category changes, non-concern evidence, stale samples, and time reversal', () => {
    let state = emptyActivityEmotionShadow();
    state = stepActivityEmotionShadow(state, dev, 2_000_000).state;

    let result = stepActivityEmotionShadow(state, study, 2_060_000);
    expect(result.diagnostics.reason).toBe('category_changed');
    expect(result.diagnostics.sampleCount).toBe(1);
    state = result.state;

    result = stepActivityEmotionShadow(state, { ...dev, category: 'video', label: '看视频' }, 2_120_000);
    expect(result.diagnostics.reason).toBe('not_a_concern_category');
    expect(result.diagnostics.observedCategory).toBeNull();
    state = result.state;

    state = stepActivityEmotionShadow(state, dev, 3_000_000).state;
    result = stepActivityEmotionShadow(state, dev, 3_180_001);
    expect(result.diagnostics.reason).toBe('sample_gap_reset');
    expect(result.diagnostics.sampleCount).toBe(1);
    state = result.state;

    result = stepActivityEmotionShadow(state, dev, 3_170_000);
    expect(result.diagnostics.reason).toBe('clock_reversal_reset');
    expect(result.diagnostics.sampleCount).toBe(1);
  });

  it('does not retain activity titles or expose a state mutation result', () => {
    const result = stepActivityEmotionShadow(emptyActivityEmotionShadow(), dev, 4_000_000);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('private-project.ts');
    expect(result).not.toHaveProperty('emotionState');
    expect(result).not.toHaveProperty('stateDelta');
  });
});
