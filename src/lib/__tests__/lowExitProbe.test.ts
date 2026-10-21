import { describe, it, expect } from 'vitest';
import {
  LOW_EXIT_DEPTH,
  PROBE_ACCUM_THRESHOLD,
  PROBE_CLIMB_STREAK,
  evaluateLowExitProbe,
  positiveActivationOf,
} from '../lowExitProbe.js';

const base = {
  active: true,
  depth: 0.20,
  peakDepth: 0.30,
  phase: 'holding',
  delta: 0,
  positiveActivation: 0,
  prevClimbingStreak: 0,
  prevAccum: 0,
};

describe('低谷退出探针（只读判定）', () => {
  it('不在低谷 ⇒ 一律不退出，累计清零', () => {
    const r = evaluateLowExitProbe({ ...base, active: false, prevAccum: 0.2 });
    expect(r.wouldExit).toBe(false);
    expect(r.accum).toBe(0);
    expect(r.reason).toContain('inactive');
  });

  it('depth 已在退出线以下 ⇒ 现状规则就会退出', () => {
    const r = evaluateLowExitProbe({ ...base, depth: LOW_EXIT_DEPTH - 0.01 });
    expect(r.wouldExit).toBe(true);
    expect(r.reason).toContain('现状规则');
  });

  it('连续 climbing + 离开峰值 ⇒ 会退出（新规则①）', () => {
    const r = evaluateLowExitProbe({
      ...base, depth: 0.15, peakDepth: 0.30, phase: 'climbing', delta: -0.02,
      prevClimbingStreak: PROBE_CLIMB_STREAK - 1,
    });
    expect(r.wouldExit).toBe(true);
    expect(r.reason).toContain('climbing');
    expect(r.climbingStreak).toBe(PROBE_CLIMB_STREAK);
  });

  it('正在爬但还没离开峰值 ⇒ 不退出（不能在半山腰宣布好了）', () => {
    const r = evaluateLowExitProbe({
      ...base, depth: 0.28, peakDepth: 0.30, phase: 'climbing', delta: -0.02,
      prevClimbingStreak: PROBE_CLIMB_STREAK,
    });
    expect(r.wouldExit).toBe(false);
    expect(r.offPeak).toBe(false);
  });

  it('段内正向累计达标 + 离开峰值 ⇒ 会退出（新规则②）', () => {
    const r = evaluateLowExitProbe({
      ...base, depth: 0.15, peakDepth: 0.30, positiveActivation: 0.06,
      prevAccum: PROBE_ACCUM_THRESHOLD - 0.05,
    });
    expect(r.wouldExit).toBe(true);
    expect(r.reason).toContain('正向累计');
  });

  it('累计有上限（不会无限增长）', () => {
    const r = evaluateLowExitProbe({ ...base, prevAccum: PROBE_ACCUM_THRESHOLD * 2, positiveActivation: 1 });
    expect(r.accum).toBeLessThanOrEqual(PROBE_ACCUM_THRESHOLD * 2);
  });

  it('sinking（还在往下沉）不算 climbing', () => {
    const r = evaluateLowExitProbe({
      ...base, depth: 0.15, peakDepth: 0.30, phase: 'sinking', delta: 0.02,
      prevClimbingStreak: PROBE_CLIMB_STREAK,
    });
    expect(r.climbingStreak).toBe(0);
    expect(r.wouldExit).toBe(false);
  });
});

describe('正向信号提取（只算超过死区的正偏离）', () => {
  it('小于死区的不计、负偏离不计', () => {
    expect(positiveActivationOf({ joy: 0.04, love: 0.06, sad: -0.3, calm: 0.02 })).toBe(0.06);
  });
  it('空输入 ⇒ 0', () => {
    expect(positiveActivationOf(undefined)).toBe(0);
  });
  it('多项相加', () => {
    expect(positiveActivationOf({ joy: 0.1, calm: 0.1 })).toBe(0.2);
  });
});
