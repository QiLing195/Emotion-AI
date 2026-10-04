import { describe, it, expect } from 'vitest';
import {
  driftPersonalityParams,
  DEFAULT_DRIFT_CONFIG,
  EMOTION_DRIFT_GATE,
  EMOTION_DRIFT_THRESHOLDS,
  applyLongTermDrift,
  computePersonalityDriftVelocity,
  LONG_TERM_DRIFT_SCALE,
  LONG_TERM_DRIFT_MIN_EPISODES,
} from '../personalityEvolution';
import { INITIAL_EMOTION_STATE } from '../emotionTypes';
import { RESTING_EMOTION_BASELINE, ACTIVATION_DEADZONE } from '../emotionActivation';
import type { EmotionState } from '../emotionTypes';

/**
 * 这一组测试锁的是 v1.13 修的那个真 bug：
 * `driftPersonalityParams` 原来读**绝对值 argmax**，而 calm 的静息值就有 0.8，
 * 所以 dominant 恒为 calm —— 而下面 7 条情绪分支**没有一条认 calm**，
 * 于是"她自己的情绪对人格的贡献恒为 0"（实测 30 轮 0 次）。
 */
function state(emotions: Record<string, number>, taiji?: Partial<EmotionState['taiji']>): EmotionState {
  return {
    ...structuredClone(INITIAL_EMOTION_STATE),
    taiji: { valence: 0.2, arousal: 0.5, expectation: 0.2, ...taiji },
    emotions: { ...RESTING_EMOTION_BASELINE, ...emotions },
  } as EmotionState;
}

function reasons(es: EmotionState, msg = '随便说点什么') {
  const res = driftPersonalityParams(es.evolution, es, msg, null, DEFAULT_DRIFT_CONFIG);
  return res.log.map(l => l.replace(/^[a-z]+: [\d.]+ → [\d.]+ /, '').replace(/[()]/g, ''));
}

describe('人格漂移的情绪门限（v1.13 重标定）', () => {
  it('门限锚在"死区 × 3"上，不是拍脑袋', () => {
    expect(EMOTION_DRIFT_GATE).toBeCloseTo(ACTIVATION_DEADZONE * 3, 6);
    expect(EMOTION_DRIFT_THRESHOLDS.joy).toBeLessThan(EMOTION_DRIFT_GATE);   // 开心最容易推动
    expect(EMOTION_DRIFT_THRESHOLDS.love).toBeGreaterThan(EMOTION_DRIFT_GATE);
  });
});

describe('driftPersonalityParams — 基调不再冒充情绪', () => {
  it('静息（正好等于人格基线）→ 一次都不漂（不对噪声做动作）', () => {
    expect(reasons(state({}))).toEqual([]);
  });

  it('**回归**：calm 绝对值最高、但她其实在难过 → 现在会失去玩心', () => {
    const es = state({ sad: 0.6, calm: 0.8 });   // 绝对值 argmax = calm
    expect(Math.max(...Object.values(es.emotions))).toBe(es.emotions.calm);
    expect(reasons(es)).toContain('悲伤时失去玩心');
  });

  it('**回归**：她感到恐惧 → 退缩（开放度下降）', () => {
    expect(reasons(state({ fear: 0.3 }))).toContain('恐惧情绪导致退缩');
  });

  it('**回归**：她感受到爱意 → 信任上升', () => {
    expect(reasons(state({ love: 0.4 }))).toContain('感受到强烈的爱意');
  });

  it('激活量不到门限 → 不动（被轻轻碰一下不算"确实在这个情绪上"）', () => {
    expect(reasons(state({ sad: EMOTION_DRIFT_THRESHOLDS.sad - 0.01 }))).toEqual([]);
    expect(reasons(state({ sad: EMOTION_DRIFT_THRESHOLDS.sad + 0.01 }))).toContain('悲伤时失去玩心');
  });

  it('混合情绪也能推动人格（不要求该情绪是唯一最强）', () => {
    // 难过 +0.35，同时平静 +0.12 —— 实测里很常见；若要求单一 argmax 就永远推不动
    const es = state({ sad: 0.35, calm: RESTING_EMOTION_BASELINE.calm + 0.12 });
    expect(reasons(es)).toContain('悲伤时失去玩心');
  });

  it('恐惧让她退缩的作用方向是**负**的（开放度下降）', () => {
    const es = state({ fear: 0.4 });
    const res = driftPersonalityParams(es.evolution, es, '我有点怕', null, DEFAULT_DRIFT_CONFIG);
    expect(res.changes.openness).toBeLessThan(0);
  });

  it('她难过时玩心下降是**负**的', () => {
    const es = state({ sad: 0.5 });
    const res = driftPersonalityParams(es.evolution, es, '好难过', null, DEFAULT_DRIFT_CONFIG);
    expect(res.changes.playfulness).toBeLessThan(0);
  });

  it('单轮变化仍受 maxChangePerRound 兜底', () => {
    const es = state({ love: 1 });
    const res = driftPersonalityParams(es.evolution, es, '我真的很喜欢你', null, DEFAULT_DRIFT_CONFIG);
    for (const v of Object.values(res.changes)) {
      expect(Math.abs(v)).toBeLessThanOrEqual(DEFAULT_DRIFT_CONFIG.maxChangePerRound + 1e-9);
    }
  });
});

// ════════════════════════════════════════════════════════════
// v1.23 长周期漂移：让"经历"塑造人格（此前 computePersonalityDriftVelocity 零调用者）
// ════════════════════════════════════════════════════════════

/** 造一条情景记忆（只用到这几个字段） */
function ep(over: Partial<{ valenceDelta: number; dominantEmotion: string; tags: string[] }> = {}) {
  return {
    id: `ep_${Math.random().toString(36).slice(2, 8)}`,
    emotionalImpact: {
      valenceDelta: over.valenceDelta ?? 0, dominantEmotion: over.dominantEmotion ?? 'calm',
    },
    tags: over.tags ?? [],
  } as never;
}

function evo() {
  return {
    trust: 50, openness: 50, playfulness: 50,
    empathy: 70, optimism: 60, sensitivity: 0.5, resilience: 0.886,
  } as never;
}

describe('v1.23 长周期漂移', () => {
  it('一段正向记忆占多 → 信任上升；负向占多 → 信任下降', () => {
    const up = evo(); applyLongTermDrift(up, Array.from({ length: 8 }, () => ep({ valenceDelta: 0.5 })));
    expect((up as never as Record<string, number>).trust).toBeGreaterThan(50);

    const down = evo(); applyLongTermDrift(down, Array.from({ length: 8 }, () => ep({ valenceDelta: -0.5 })));
    expect((down as never as Record<string, number>).trust).toBeLessThan(50);
  });

  it('resilience 是 [0,1] 尺度：单次位移必须 << 1（共用系数会把它一次打爆）', () => {
    // 冲突 + 之后有温暖 → 速度 0.5，这是最容易出事的那条
    const e = evo();
    const eps = [
      ep({ tags: ['冲突'] }),
      ...Array.from({ length: 5 }, () => ep({ tags: ['温暖'], valenceDelta: 0.3 })),
    ];
    const { changes } = applyLongTermDrift(e, eps);
    expect(changes.resilience).toBeGreaterThan(0);
    expect(changes.resilience).toBeLessThanOrEqual(LONG_TERM_DRIFT_SCALE.resilience + 1e-9);
    expect((e as never as Record<string, number>).resilience).toBeLessThanOrEqual(1);   // 不越界
  });

  it('样本不足不学（少样本不学，避免一条记忆把人格带偏）', () => {
    const e = evo();
    const { changes, skipped } = applyLongTermDrift(e, Array.from({ length: LONG_TERM_DRIFT_MIN_EPISODES - 1 }, () => ep({ valenceDelta: 0.9 })));
    expect(changes).toEqual({});
    expect(skipped).toMatch(/样本不足/);
    expect((e as never as Record<string, number>).trust).toBe(50);   // 一个点都没动
  });

  it('没登记尺度的参数一律不动（宁可不动，也不乱加）', () => {
    // 速度表里出现 playfulness，但 scale 已登记 —— 反向验证：伪造一个未登记参数
    const e = evo();
    const { changes } = applyLongTermDrift(e, Array.from({ length: 8 }, () => ep({ valenceDelta: 0.5 })));
    for (const k of Object.keys(changes)) expect(LONG_TERM_DRIFT_SCALE[k]).toBeDefined();
    // empathy / sensitivity 不在速度产出里，必须完全没动
    expect((e as never as Record<string, number>).empathy).toBe(70);
    expect((e as never as Record<string, number>).sensitivity).toBe(0.5);
  });

  it('原始趋势照样返回（便于解释"为什么往这边动"）', () => {
    const e = evo();
    const { velocities } = applyLongTermDrift(e, Array.from({ length: 8 }, () => ep({ valenceDelta: 0.5, dominantEmotion: 'love' })));
    expect(velocities.trust).toBeGreaterThan(0);
    expect(velocities.openness).toBeGreaterThan(0);
  });

  it('趋势函数本身：正向比例高 → trust 正；低于一半 → 负', () => {
    expect(computePersonalityDriftVelocity(evo(), Array.from({ length: 6 }, () => ep({ valenceDelta: 0.5 }))).trust).toBeGreaterThan(0);
    expect(computePersonalityDriftVelocity(evo(), Array.from({ length: 6 }, () => ep({ valenceDelta: -0.5 }))).trust).toBeLessThan(0);
  });
});
