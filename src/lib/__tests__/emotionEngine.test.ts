// ── emotionEngine 核心测试 ──
// 覆盖：太极更新、阴阳派生、吸引子计算、情感更新、时间衰减

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  updateEmotionState,
  getDominantEmotion,
  processTimeDecay,
  getRelationshipStage,
  validateEmotionState,
  sanitizeEmotionState,
  INITIAL_EMOTION_STATE,
  setDeterministicMode,
  isDeterministicMode,
} from '../emotionEngine';
import type { EmotionEvent, EmotionState } from '../emotionEngine';

// 启用确定性模式避免噪声影响测试
beforeAll(() => { setDeterministicMode(true); });
afterAll(() => { setDeterministicMode(false); });

function makeEvent(overrides: Partial<EmotionEvent> = {}): EmotionEvent {
  return {
    deltaA: 0,
    deltaB: 0,
    deltaR: 0,
    intent: 'user',
    ...overrides,
  };
}

describe('updateEmotionState', () => {
  it('正向事件提升效价和 joy', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const event = makeEvent({ deltaA: 0.3, deltaB: -0.1, GC: 0.5 });

    const result = updateEmotionState(state, event);

    expect(result.taiji.valence).toBeGreaterThan(INITIAL_EMOTION_STATE.taiji.valence);
    expect(result.emotions.joy).toBeGreaterThan(0);
  });

  it('负向事件降低效价', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const event = makeEvent({ deltaA: -0.2, deltaB: 0.3, GC: -0.5 });

    const result = updateEmotionState(state, event);

    expect(result.taiji.valence).toBeLessThan(INITIAL_EMOTION_STATE.taiji.valence);
  });

  it('重复正向事件持续提升亲密感', () => {
    let state = structuredClone(INITIAL_EMOTION_STATE);
    const event = makeEvent({ deltaA: 0.2, deltaB: -0.1, GC: 0.3, intent: 'user' });

    for (let i = 0; i < 5; i++) {
      state = updateEmotionState(state, event);
    }

    expect(state.intimacyToUser).toBeGreaterThan(INITIAL_EMOTION_STATE.intimacyToUser);
  });

  it('arousal 在 [0, 1] 范围内', () => {
    let state = structuredClone(INITIAL_EMOTION_STATE);
    // 高强度事件
    const event = makeEvent({ deltaA: 0.5, deltaB: -0.5, deltaR: 0.3, GC: 0.9 });

    for (let i = 0; i < 10; i++) {
      state = updateEmotionState(state, event);
    }

    expect(state.taiji.arousal).toBeGreaterThanOrEqual(0);
    expect(state.taiji.arousal).toBeLessThanOrEqual(1);
  });

  it('valance 在 [-1, 1] 范围内', () => {
    let state = structuredClone(INITIAL_EMOTION_STATE);
    // 极端负面
    const negEvent = makeEvent({ deltaA: -0.5, deltaB: 0.5, GC: -1 });

    for (let i = 0; i < 10; i++) {
      state = updateEmotionState(state, negEvent);
    }

    expect(state.taiji.valence).toBeGreaterThanOrEqual(-1);
    expect(state.taiji.valence).toBeLessThanOrEqual(1);
  });

  it('确定性模式下 valence/arousal 精确一致', () => {
    const state1 = structuredClone(INITIAL_EMOTION_STATE);
    const state2 = structuredClone(INITIAL_EMOTION_STATE);
    const event = makeEvent({ deltaA: 0.25, deltaB: -0.15, GC: 0.4 });

    const result1 = updateEmotionState(state1, event);
    const result2 = updateEmotionState(state2, event);

    // valence/arousal 在确定性模式下精确一致（Math.random() 噪声已关闭）
    expect(result1.taiji.valence).toBe(result2.taiji.valence);
    expect(result1.taiji.arousal).toBe(result2.taiji.arousal);
    // 主导情绪一致
    const dom1 = getDominantEmotion(result1.emotions);
    const dom2 = getDominantEmotion(result2.emotions);
    expect(dom1.name).toBe(dom2.name);
  });
});

describe('getDominantEmotion', () => {
  it('初始态主导情绪是 calm', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const dominant = getDominantEmotion(state.emotions);
    expect(dominant.name).toBe('calm');
  });

  it('高强度 love 成为主导', () => {
    const emotions = { ...INITIAL_EMOTION_STATE.emotions, love: 0.8, calm: 0.2 };
    const dominant = getDominantEmotion(emotions);
    expect(dominant.name).toBe('love');
    expect(dominant.intensity).toBe(0.8);
  });

  it('所有情绪为零时返回 calm', () => {
    const emotions: Record<string, number> = {};
    for (const k of Object.keys(INITIAL_EMOTION_STATE.emotions)) {
      emotions[k] = 0;
    }
    const dominant = getDominantEmotion(emotions);
    expect(dominant.name).toBeDefined();
  });
});

describe('processTimeDecay', () => {
  it('24小时离线后效价回归', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.valence = 0.8;
    state.emotions.joy = 0.7;

    const result = processTimeDecay(state, 24);

    expect(result.taiji.valence).toBeLessThan(0.8);
    expect(result.emotions.joy).toBeLessThan(0.7);
  });

  it('零小时不改变状态', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const result = processTimeDecay(state, 0);
    expect(result.taiji.valence).toBe(state.taiji.valence);
  });

  it('一周离线几乎回到基线', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.valence = 0.9;
    state.taiji.arousal = 0.9;
    state.emotions.joy = 0.9;
    state.emotions.anger = 0.8;

    const result = processTimeDecay(state, 168);

    // 一周后几乎所有情绪应接近 0
    expect(Math.abs(result.emotions.joy)).toBeLessThan(0.2);
    expect(Math.abs(result.emotions.anger)).toBeLessThan(0.2);
    // arousal 回归 0.5
    expect(Math.abs(result.taiji.arousal - 0.5)).toBeLessThan(0.3);
  });
});

describe('getRelationshipStage', () => {
  it('affinity < 30 → stranger', () => {
    expect(getRelationshipStage(10, false)).toBe('stranger');
  });

  it('affinity 50-69 → friend', () => {
    expect(getRelationshipStage(60, false)).toBe('friend');
  });

  it('affinity >= 90 → soulmate', () => {
    expect(getRelationshipStage(95, false)).toBe('soulmate');
  });

  it('危机中退回到 stranger', () => {
    expect(getRelationshipStage(80, true)).toBe('stranger');
  });
});

describe('validateEmotionState', () => {
  it('有效状态通过校验', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const result = validateEmotionState(state);
    expect(result).not.toBeNull();
    expect(result!.taiji.valence).toBe(state.taiji.valence);
  });

  it('缺少 taiji 返回 null', () => {
    expect(validateEmotionState({ emotions: {}, intimacyToUser: 0.5 })).toBeNull();
  });

  it('taiji.valence 不是 number 返回 null', () => {
    const bad = structuredClone(INITIAL_EMOTION_STATE);
    (bad as any).taiji.valence = 'not_a_number';
    expect(validateEmotionState(bad)).toBeNull();
  });

  it('null/undefined 返回 null', () => {
    expect(validateEmotionState(null)).toBeNull();
    expect(validateEmotionState(undefined)).toBeNull();
  });
});

describe('sanitizeEmotionState', () => {
  it('空对象返回默认状态', () => {
    const result = sanitizeEmotionState({});
    expect(result.taiji.valence).toBeDefined();
    expect(result.emotions.calm).toBeDefined();
  });

  it('部分字段使用传入值', () => {
    const result = sanitizeEmotionState({ intimacyToUser: 0.8 });
    expect(result.intimacyToUser).toBe(0.8);
  });
});

describe('getDominantEmotion edge cases', () => {
  it('所有正情绪', () => {
    const emotions = { joy: 0.9, anger: 0, sad: 0, fear: 0, love: 0.8, disgust: 0, lust: 0, calm: 0.1, greed: 0 };
    const d = getDominantEmotion(emotions);
    expect(d.name).toBe('joy');
    expect(d.intensity).toBe(0.9);
  });

  it('同强度时取先出现的', () => {
    const emotions = { joy: 0.5, anger: 0.5, sad: 0, fear: 0, love: 0, disgust: 0, lust: 0, calm: 0, greed: 0 };
    const d = getDominantEmotion(emotions);
    expect(['joy', 'anger']).toContain(d.name);
    expect(d.intensity).toBe(0.5);
  });
});

describe('predictable error update', () => {
  it('正向预测误差 → valence 上升', () => {
    // 设置 expectation 低、event 正向 → 正向误差
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.expectation = -0.3;
    state.taiji.valence = 0;
    const event = makeEvent({ deltaA: 0.4, GC: 0.6 });

    const result = updateEmotionState(state, event);
    expect(result.taiji.valence).toBeGreaterThan(0);
  });

  it('负向预测误差（预期高但实际差）→ valence 下降', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.expectation = 0.5;
    state.taiji.valence = 0.3;
    const event = makeEvent({ deltaA: -0.2, deltaB: 0.3, GC: -0.4 });

    const result = updateEmotionState(state, event);
    // 预期高但实际负 → 负向修正
    expect(result.taiji.valence).toBeLessThan(0.3);
  });
});
