import { describe, expect, it } from 'vitest';
import { EmotionAnnotation, INITIAL_ANNOTATIONS } from './affectLexicon';
import {
  buildDailyEmotionTrend,
  buildEmotionLabelFrequencies,
  extractDateKey,
} from './emotionTrendStats';

function makeAnnotation(
  overrides: Partial<EmotionAnnotation>
): EmotionAnnotation {
  return {
    id: 'ann-test',
    utterance: '测试文本',
    context: '可用性访谈',
    valence: 0.5,
    arousal: 0.3,
    primaryLabel: '愉悦',
    quadrant: 'high-positive',
    createdAt: '2026-11-25 10:00',
    ...overrides,
  };
}

describe('emotionTrendStats time-series aggregation', () => {
  it('extracts normalized YYYY-MM-DD keys from standard, slash, and ISO formats', () => {
    expect(extractDateKey('2026-11-25 14:22')).toBe('2026-11-25');
    expect(extractDateKey('2026-1-5 08:00')).toBe('2026-01-05');
    expect(extractDateKey('2026/11/9')).toBe('2026-11-09');
    expect(extractDateKey('2026-11-26T09:15:00Z')).toBe('2026-11-26');
    expect(extractDateKey('')).toBeNull();
    expect(extractDateKey('not-a-date')).toBeNull();
  });

  it('aggregates daily quadrant counts, averages, dominant label, and volatility accurately', () => {
    const dataset: EmotionAnnotation[] = [
      makeAnnotation({
        id: '1',
        valence: 0.8,
        arousal: 0.4,
        primaryLabel: '愉悦',
        quadrant: 'high-positive',
        createdAt: '2026-11-20 09:00',
      }),
      makeAnnotation({
        id: '2',
        valence: 0.4,
        arousal: -0.4,
        primaryLabel: '愉悦',
        quadrant: 'low-positive',
        createdAt: '2026-11-20 15:00',
      }),
      makeAnnotation({
        id: '3',
        valence: -0.6,
        arousal: 0.6,
        primaryLabel: '沮丧',
        quadrant: 'high-negative',
        createdAt: '2026-11-22 11:00',
      }),
    ];

    const trend = buildDailyEmotionTrend(dataset, 'all');
    expect(trend.dayCount).toBe(2);
    expect(trend.totalCount).toBe(3);
    expect(trend.positiveRatio).toBe(67);
    expect(trend.points[0].date).toBe('2026-11-20');
    expect(trend.points[0].count).toBe(2);
    expect(trend.points[0].avgValence).toBe(0.6);
    expect(trend.points[0].avgArousal).toBe(0);
    expect(trend.points[0].quadrantCounts['high-positive']).toBe(1);
    expect(trend.points[0].quadrantCounts['low-positive']).toBe(1);
    expect(trend.points[0].dominantLabel).toBe('愉悦');

    expect(trend.points[1].date).toBe('2026-11-22');
    expect(trend.points[1].avgValence).toBe(-0.6);
    // Daily avgValence values are +0.6 and -0.6 -> std dev = 0.60
    expect(trend.valenceVolatility).toBe(0.6);
  });

  it('filters 7d and 30d windows anchored to the latest record date', () => {
    const dataset: EmotionAnnotation[] = [
      makeAnnotation({ id: 'a', createdAt: '2026-10-01 09:00' }),
      makeAnnotation({ id: 'b', createdAt: '2026-11-10 09:00' }),
      makeAnnotation({ id: 'c', createdAt: '2026-11-22 09:00' }),
      makeAnnotation({ id: 'd', createdAt: '2026-11-26 09:00' }),
    ];

    const last7d = buildDailyEmotionTrend(dataset, '7d');
    expect(last7d.points.map((p) => p.date)).toEqual(['2026-11-22', '2026-11-26']);

    const last30d = buildDailyEmotionTrend(dataset, '30d');
    expect(last30d.points.map((p) => p.date)).toEqual([
      '2026-11-10',
      '2026-11-22',
      '2026-11-26',
    ]);

    const all = buildDailyEmotionTrend(dataset, 'all');
    expect(all.dayCount).toBe(4);
  });

  it('handles empty datasets and default INITIAL_ANNOTATIONS cleanly', () => {
    const empty = buildDailyEmotionTrend([], 'all');
    expect(empty.points).toHaveLength(0);
    expect(empty.totalCount).toBe(0);

    const defaults = buildDailyEmotionTrend(INITIAL_ANNOTATIONS, 'all');
    expect(defaults.dayCount).toBe(7);
    expect(defaults.totalCount).toBe(INITIAL_ANNOTATIONS.length);
  });

  it('computes descending label frequencies, dominant quadrants, and normalized weights', () => {
    expect(buildEmotionLabelFrequencies([])).toEqual([]);

    const dataset: EmotionAnnotation[] = [
      makeAnnotation({ id: '1', primaryLabel: '愉悦', valence: 0.8, arousal: 0.4, quadrant: 'high-positive' }),
      makeAnnotation({ id: '2', primaryLabel: '愉悦', valence: 0.7, arousal: 0.3, quadrant: 'high-positive' }),
      makeAnnotation({ id: '3', primaryLabel: '愉悦', valence: 0.9, arousal: 0.5, quadrant: 'high-positive' }),
      makeAnnotation({ id: '4', primaryLabel: '沮丧', valence: -0.7, arousal: 0.5, quadrant: 'high-negative' }),
      makeAnnotation({ id: '5', primaryLabel: '沮丧', valence: -0.6, arousal: 0.4, quadrant: 'high-negative' }),
      makeAnnotation({ id: '6', primaryLabel: '平静', valence: 0.3, arousal: -0.6, quadrant: 'low-positive' }),
    ];

    const freqs = buildEmotionLabelFrequencies(dataset);
    expect(freqs.map((f) => f.label)).toEqual(['愉悦', '沮丧', '平静']);
    expect(freqs[0].count).toBe(3);
    expect(freqs[0].weight).toBe(1);
    expect(freqs[0].ratio).toBe(0.5);
    expect(freqs[0].quadrant).toBe('high-positive');
    expect(freqs[1].count).toBe(2);
    expect(freqs[1].weight).toBe(0.5);
    expect(freqs[1].quadrant).toBe('high-negative');
    expect(freqs[2].count).toBe(1);
    expect(freqs[2].weight).toBe(0);
    expect(freqs[2].quadrant).toBe('low-positive');
  });
});
