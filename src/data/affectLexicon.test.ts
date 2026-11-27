import { describe, expect, it } from 'vitest';
import {
  INITIAL_ANNOTATIONS,
  clampCoord,
  findNearestAffects,
  formatCoord,
  getIntensity,
  getQuadrant,
} from './affectLexicon';
import {
  parseImportedAnnotations,
  serializeAnnotationsToCsv,
} from './affectImportExport';

describe('affectLexicon utilities', () => {
  it('classifies coordinates into the correct circumplex quadrant', () => {
    expect(getQuadrant(0.5, 0.5)).toBe('high-positive');
    expect(getQuadrant(0.5, -0.5)).toBe('low-positive');
    expect(getQuadrant(-0.5, 0.5)).toBe('high-negative');
    expect(getQuadrant(-0.5, -0.5)).toBe('low-negative');
  });

  it('clamps and formats coordinates consistently', () => {
    expect(clampCoord(1.42)).toBe(1);
    expect(clampCoord(-2.1)).toBe(-1);
    expect(clampCoord(0.126)).toBe(0.13);
    expect(formatCoord(0.4)).toBe('+0.40');
    expect(formatCoord(-0.4)).toBe('-0.40');
    expect(formatCoord(0)).toBe('0.00');
  });

  it('computes bounded intensity and nearest lexicon anchors', () => {
    expect(getIntensity(1, 1)).toBe(1);
    expect(getIntensity(0.6, 0.8)).toBeCloseTo(1, 5);
    const nearest = findNearestAffects(0.68, 0.72, 2);
    expect(nearest[0]?.label).toBe('兴奋');
    expect(nearest[0]?.distance).toBeCloseTo(0, 5);
  });
});

describe('affectImportExport utilities', () => {
  it('round-trips CSV export and import with quoted commas', () => {
    const sample = [
      {
        ...INITIAL_ANNOTATIONS[0],
        utterance: '流程清晰, 响应迅速, "结算"体验非常稳定。',
      },
    ];
    const csv = serializeAnnotationsToCsv(sample);
    const result = parseImportedAnnotations(csv, 'export.csv', '2026-11-25 12:00');
    expect(result.error).toBeUndefined();
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].utterance).toBe(sample[0].utterance);
    expect(result.annotations[0].valence).toBe(sample[0].valence);
    expect(result.annotations[0].arousal).toBe(sample[0].arousal);
  });

  it('parses JSON arrays and clamps out-of-range coordinates', () => {
    const json = JSON.stringify([
      {
        utterance: '突然弹出告警让我非常意外',
        valence: -1.8,
        arousal: 1.5,
      },
    ]);
    const result = parseImportedAnnotations(json, 'data.json', '2026-11-25 12:00');
    expect(result.error).toBeUndefined();
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].valence).toBe(-1);
    expect(result.annotations[0].arousal).toBe(1);
    expect(result.annotations[0].quadrant).toBe('high-negative');
  });

  it('supports Chinese CSV column headers', () => {
    const csv = '文本,情绪标签,效价,唤醒度\n今天进展非常顺利,愉悦,0.82,0.45';
    const result = parseImportedAnnotations(csv, 'zh.csv', '2026-11-25 12:00');
    expect(result.error).toBeUndefined();
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].primaryLabel).toBe('愉悦');
    expect(result.annotations[0].quadrant).toBe('high-positive');
  });

  it('rejects malformed JSON and missing CSV columns', () => {
    const badJson = parseImportedAnnotations('{invalid', 'bad.json', '2026-11-25 12:00');
    expect(badJson.error).toBeTruthy();

    const badCsv = parseImportedAnnotations('foo,bar\n1,2', 'bad.csv', '2026-11-25 12:00');
    expect(badCsv.error).toBeTruthy();
  });
});
