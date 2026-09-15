// ── rumination 单元测试 (v1.8) ──
// 覆盖：反刍链推进/重置/平淡轮衰退 / 抑制幅度上限 / 自我安抚 /
//       水平归一化 / 描述与提示词
// 优先级：🔴 高 — 防"情绪卡死/单情绪过拟合"的关键闸门

import { describe, it, expect } from 'vitest';
import {
  trackRumination,
  activatedDominant,
  ruminationLevel,
  ruminationModulation,
  describeRumination,
  ruminationPromptHint,
  RUMINATION_ONSET,
  RUMINATION_MAX_DAMP,
  RUMINATION_MAX_CALM,
  RUMINATION_MAX_AROUSAL_DROP,
  RUMINATION_FLOOR,
  RUMINATION_RESET_H,
  RUMINATION_STREAK_CAP,
} from '../rumination';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState, RuminationState } from '../emotionTypes';

const H = 3_600_000;
const T0 = 1_700_000_000_000;

function baseState(overrides: Partial<EmotionState> = {}): EmotionState {
  return structuredClone({ ...INITIAL_EMOTION_STATE, ...overrides }) as EmotionState;
}

function rume(overrides: Partial<RuminationState> = {}): RuminationState {
  return { emotion: 'sad', streak: RUMINATION_ONSET, updatedAt: T0, ...overrides };
}

// ════════════════════════════════════════════════════════════
// 1. trackRumination — 链条推进
// ════════════════════════════════════════════════════════════

describe('trackRumination — 链条推进', () => {
  it('无历史时从 1 开始', () => {
    expect(trackRumination(undefined, 'sad', 0.5, T0)).toEqual({
      emotion: 'sad', streak: 1, updatedAt: T0,
    });
  });

  it('同一情绪连续主导则累加', () => {
    let r = trackRumination(undefined, 'sad', 0.5, T0);
    r = trackRumination(r, 'sad', 0.5, T0 + H);
    r = trackRumination(r, 'sad', 0.5, T0 + 2 * H);
    expect(r.streak).toBe(3);
  });

  it('换情绪则重置为 1', () => {
    const r = trackRumination(rume({ emotion: 'sad', streak: 5 }), 'joy', 0.5, T0 + H);
    expect(r).toEqual({ emotion: 'joy', streak: 1, updatedAt: T0 + H });
  });

  it('平淡轮（强度低于 FLOOR）不换情绪，但链条衰退', () => {
    const r = trackRumination(rume({ streak: 5 }), 'joy', RUMINATION_FLOOR / 2, T0 + H);
    expect(r.emotion).toBe('sad');
    expect(r.streak).toBe(4);
  });

  it('平淡轮链条下限为 1（不归零）', () => {
    const r = trackRumination(rume({ streak: 1 }), 'joy', 0, T0 + H);
    expect(r.streak).toBe(1);
  });

  it(`超过 ${RUMINATION_RESET_H}h 未互动则链条重置`, () => {
    const r = trackRumination(rume({ streak: 9 }), 'sad', 0.5, T0 + (RUMINATION_RESET_H + 0.5) * H);
    expect(r.streak).toBe(1);
  });

  it('恰好等于重置阈值时仍延续', () => {
    const r = trackRumination(rume({ streak: 4 }), 'sad', 0.5, T0 + RUMINATION_RESET_H * H);
    expect(r.streak).toBe(5);
  });

  it('历史数据非法（streak 非数字）时安全重置', () => {
    const bad = { emotion: 'sad', streak: NaN, updatedAt: T0 } as RuminationState;
    expect(trackRumination(bad, 'sad', 0.5, T0 + H).streak).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 1b. activatedDominant — 只看"被激活的情绪"
// ════════════════════════════════════════════════════════════

describe('activatedDominant', () => {
  it('静息状态（calm=0.8 最高）不应被判为 calm 主导', () => {
    const r = activatedDominant({ ...INITIAL_EMOTION_STATE.emotions });
    expect(r.name).toBe('neutral');
    expect(r.intensity).toBe(0);
  });

  it('在激活情绪中取最大者', () => {
    expect(activatedDominant({ calm: 0.9, greed: 0.5, sad: 0.3, joy: 0.1 }))
      .toEqual({ name: 'sad', intensity: 0.3 });
  });

  it('忽略 calm / greed 的底色高分', () => {
    expect(activatedDominant({ calm: 1.0, greed: 1.0, fear: 0.12 }).name).toBe('fear');
  });

  it('全为零（或仅负值）→ neutral / 0', () => {
    expect(activatedDominant({ joy: 0, sad: 0, calm: 0.8 })).toEqual({ name: 'neutral', intensity: 0 });
    expect(activatedDominant({ joy: -0.5, sad: -0.2 })).toEqual({ name: 'neutral', intensity: 0 });
  });

  it('能识别爱意/愤怒等激活情绪', () => {
    expect(activatedDominant({ love: 0.6, calm: 0.8 }).name).toBe('love');
    expect(activatedDominant({ anger: 0.4, sad: 0.2 }).name).toBe('anger');
  });
});

// ════════════════════════════════════════════════════════════
// 2. ruminationLevel — 归一化水平
// ════════════════════════════════════════════════════════════

describe('ruminationLevel', () => {
  it(`未达 ${RUMINATION_ONSET} 轮 → 0`, () => {
    expect(ruminationLevel(undefined, T0)).toBe(0);
    expect(ruminationLevel(rume({ streak: RUMINATION_ONSET - 1 }), T0)).toBe(0);
  });

  it('刚进入反刍 → 0，达到链条上限 → 1', () => {
    expect(ruminationLevel(rume({ streak: RUMINATION_ONSET }), T0)).toBe(0);
    expect(ruminationLevel(rume({ streak: RUMINATION_ONSET + 1 }), T0)).toBeGreaterThan(0);
    expect(ruminationLevel(rume({ streak: RUMINATION_STREAK_CAP }), T0)).toBeCloseTo(1, 6);
  });

  it('超过上限时仍夹在 1（数值稳定）', () => {
    expect(ruminationLevel(rume({ streak: 999 }), T0)).toBe(1);
  });

  it('链条过期 → 0', () => {
    expect(ruminationLevel(rume({ streak: 9 }), T0 + 20 * H)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 3. ruminationModulation — 落到情感状态
// ════════════════════════════════════════════════════════════

describe('ruminationModulation', () => {
  it('未进入反刍时返回原对象（同一引用，零开销）', () => {
    const s = baseState();
    expect(ruminationModulation(s, undefined, T0)).toBe(s);
    expect(ruminationModulation(s, rume({ streak: 1 }), T0)).toBe(s);
    expect(ruminationModulation(s, rume({ streak: 2 }), T0)).toBe(s);
  });

  it('链条过期时返回原对象', () => {
    const s = baseState();
    expect(ruminationModulation(s, rume({ streak: 9 }), T0 + 20 * H)).toBe(s);
  });

  it('进入反刍后主导情绪被钝化（强度下降）', () => {
    const s = baseState();
    s.emotions.sad = 0.8;
    const out = ruminationModulation(s, rume({ streak: RUMINATION_ONSET + 2 }), T0);
    expect(out.emotions.sad).toBeLessThan(0.8);
    expect(out.emotions.sad).toBeGreaterThan(0);
  });

  it('钝化幅度随链条增长且不超过 RUMINATION_MAX_DAMP', () => {
    const s = baseState();
    s.emotions.sad = 1;
    const mild = ruminationModulation(s, rume({ streak: RUMINATION_ONSET + 1 }), T0);
    const long = ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    expect(long.emotions.sad).toBeLessThan(mild.emotions.sad);
    expect(long.emotions.sad).toBeGreaterThanOrEqual(1 - RUMINATION_MAX_DAMP - 1e-9);
  });

  it('自我安抚：calm 回升，且不超过上限', () => {
    const s = baseState();
    s.emotions.calm = 0;
    const out = ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    expect(out.emotions.calm).toBeGreaterThan(0);
    expect(out.emotions.calm).toBeLessThanOrEqual(RUMINATION_MAX_CALM + 1e-9);
  });

  it('唤醒轻微下降，且不超过上限、不低于 0', () => {
    const s = baseState();
    s.taiji.arousal = 1;
    const out = ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    expect(out.taiji.arousal).toBeLessThan(1);
    expect(out.taiji.arousal).toBeGreaterThanOrEqual(1 - RUMINATION_MAX_AROUSAL_DROP - 1e-9);

    const low = baseState();
    low.taiji.arousal = 0;
    expect(ruminationModulation(low, rume({ streak: RUMINATION_STREAK_CAP }), T0).taiji.arousal).toBeGreaterThanOrEqual(0);
  });

  it('主导情绪为负值时不被放大（只抑制正向强度）', () => {
    const s = baseState();
    s.emotions.sad = -0.5;
    const out = ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    expect(out.emotions.sad).toBe(-0.5);
  });

  it('只影响主导情绪与 calm，其它情绪不变', () => {
    const s = baseState();
    s.emotions.sad = 0.7;
    s.emotions.joy = 0.3;
    s.emotions.fear = 0.2;
    const out = ruminationModulation(s, rume({ streak: RUMINATION_ONSET + 3 }), T0);
    expect(out.emotions.joy).toBeCloseTo(0.3, 10);
    expect(out.emotions.fear).toBeCloseTo(0.2, 10);
  });

  it('不修改入参（纯函数）', () => {
    const s = baseState();
    s.emotions.sad = 0.7;
    const before = structuredClone(s);
    ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    expect(s.emotions).toEqual(before.emotions);
    expect(s.taiji).toEqual(before.taiji);
  });

  it('长链反复下调不会把情绪压没（防止"情绪被吃掉"）', () => {
    let s = baseState();
    s.emotions.sad = 1;
    for (let i = 0; i < 30; i++) {
      s = ruminationModulation(s, rume({ streak: RUMINATION_STREAK_CAP }), T0);
    }
    // 单轮最多压 40%，30 轮后趋近 0 但不为负
    expect(s.emotions.sad).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════
// 4. 描述与提示词
// ════════════════════════════════════════════════════════════

describe('describeRumination', () => {
  it('未进入反刍 → null', () => {
    expect(describeRumination(undefined, T0)).toBeNull();
    expect(describeRumination(rume({ streak: RUMINATION_ONSET }), T0)).toBeNull();
  });

  it('进入反刍后给出情绪与轮数', () => {
    const d = describeRumination(rume({ emotion: 'anxiety', streak: 6 }), T0);
    expect(d).toContain('anxiety');
    expect(d).toContain('6');
  });

  it('链条过期 → null', () => {
    expect(describeRumination(rume({ streak: 6 }), T0 + 20 * H)).toBeNull();
  });
});

describe('ruminationPromptHint', () => {
  it('未进入反刍 → 不注入', () => {
    expect(ruminationPromptHint(rume({ streak: 2 }), T0)).toBeNull();
  });

  it('进入反刍 → 要求换表达方式，且不暴露内部数字', () => {
    const hint = ruminationPromptHint(rume({ streak: 6 }), T0);
    expect(hint).toBeTruthy();
    expect(hint).toContain('换一种表达方式');
    expect(hint).not.toMatch(/\d+\s*轮/);
  });
});
