import { describe, it, expect } from 'vitest';
import { validateIntrinsicCandidates, IntrinsicDedup, type IntrinsicCandidate } from '../intrinsicActivity.js';

const NOW = 1_700_000_000_000;
const cand = (over: Partial<IntrinsicCandidate> = {}): IntrinsicCandidate => ({
  eventId: 'evt-1',
  type: 'loneliness',
  source: 'idle',
  evidenceRef: 'idle:200m',
  confidence: 0.7,
  expiresAt: NOW + 60_000,
  intensity: 0.4,
  ...over,
});

describe('v2.06 内在活动候选接口', () => {
  it('有效候选通过，强度/置信度被 clamp', () => {
    const seen = new IntrinsicDedup();
    const r = validateIntrinsicCandidates([cand({ intensity: 5, confidence: 2 })], { now: NOW, seen });
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].intensity).toBe(1);
    expect(r.accepted[0].confidence).toBe(1);
  });

  it('过期候选被拒绝（不能把旧事当成现在）', () => {
    const seen = new IntrinsicDedup();
    const r = validateIntrinsicCandidates([cand({ expiresAt: NOW - 1 })], { now: NOW, seen });
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('expired');
  });

  it('没有证据引用被拒绝', () => {
    const seen = new IntrinsicDedup();
    const r = validateIntrinsicCandidates([cand({ evidenceRef: '   ' })], { now: NOW, seen });
    expect(r.rejected[0].reason).toBe('no_evidence');
  });

  it('同一 eventId 重复出现 → duplicate（不能反复施加）', () => {
    const seen = new IntrinsicDedup();
    const first = validateIntrinsicCandidates([cand()], { now: NOW, seen });
    const second = validateIntrinsicCandidates([cand()], { now: NOW + 1000, seen });
    expect(first.accepted).toHaveLength(1);
    expect(second.rejected[0].reason).toBe('duplicate');
  });

  it('低置信度被拒绝', () => {
    const seen = new IntrinsicDedup();
    const r = validateIntrinsicCandidates([cand({ confidence: 0.1 })], { now: NOW, seen });
    expect(r.rejected[0].reason).toBe('low_confidence');
  });

  it('单轮上限（默认 3）', () => {
    const seen = new IntrinsicDedup();
    const list = [1, 2, 3, 4, 5].map(i => cand({ eventId: `evt-${i}` }));
    const r = validateIntrinsicCandidates(list, { now: NOW, seen });
    expect(r.accepted).toHaveLength(3);
    expect(r.rejected.filter(x => x.reason === 'over_budget')).toHaveLength(2);
  });

  it('去重表有界（不会无限增长）', () => {
    const seen = new IntrinsicDedup(3);
    for (let i = 0; i < 10; i++) seen.add(`id-${i}`);
    expect(seen.size).toBe(3);
    expect(seen.has('id-9')).toBe(true);
    expect(seen.has('id-0')).toBe(false);
  });
});
