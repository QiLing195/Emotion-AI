import { describe, it, expect } from 'vitest';
import {
  EMOTION_KEYS,
  RESTING_EMOTION_BASELINE,
  ACTIVATION_DEADZONE,
  ACTIVATION_MARGIN,
  separateActivation,
  describeActivation,
  emotionLabel,
} from '../emotionActivation';
import { INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET } from '../emotionTypes';

// 线上实测向量（2026-09 从 /state 抄下来的真实值）——
// 这是本模块存在的理由：绝对值 argmax 说"calm"，激发态说"她并不平静，心底是爱意/渴望"。
const LIVE_VECTOR = {
  calm: 0.439, greed: 0.359, love: 0.184, lust: 0.184, joy: 0.175,
  sad: 0.133, disgust: 0.125, anger: 0.121, fear: 0.072,
};

describe('RESTING_EMOTION_BASELINE — 基线来自人格初始化，不抄数字', () => {
  it('与 INITIAL_EMOTION_STATE.emotions 逐键一致', () => {
    for (const k of EMOTION_KEYS) {
      expect(RESTING_EMOTION_BASELINE[k]).toBe(INITIAL_EMOTION_STATE.emotions[k as keyof typeof INITIAL_EMOTION_STATE.emotions]);
    }
  });

  it('九个情绪键齐全（漏一个就会静默把基线当 0）', () => {
    expect(Object.keys(RESTING_EMOTION_BASELINE).sort()).toEqual([...EMOTION_KEYS].sort());
    expect(EMOTION_KEYS).toHaveLength(9);
  });

  it('基调确实是 calm 最高（这就是"她永远平静"的来源，不是 bug 是人格）', () => {
    expect(RESTING_EMOTION_BASELINE.calm).toBeGreaterThan(0.5);
    expect(RESTING_EMOTION_BASELINE.calm).toBe(Math.max(...EMOTION_KEYS.map(k => RESTING_EMOTION_BASELINE[k])));
  });
});

describe('separateActivation — 基调不算情绪', () => {
  it('静息（正好等于基线）→ 没有情绪，resting=true（下游不必硬演）', () => {
    const a = separateActivation(RESTING_EMOTION_BASELINE);
    expect(a.resting).toBe(true);
    expect(a.activeEmotion).toBeNull();
    expect(a.activeIntensity).toBe(0);
    expect(a.clear).toBe(false);
    expect(a.suppressed).toEqual([]);
    expect(a.note).toContain('静息');
  });

  it('线上真实向量：绝对值说 calm，激发态说的是同一份数据的另一面', () => {
    const a = separateActivation(LIVE_VECTOR);
    // 绝对值 argmax = calm（旧读法）
    const rawTop = [...EMOTION_KEYS].sort((x, y) => LIVE_VECTOR[y] - LIVE_VECTOR[x])[0];
    expect(rawTop).toBe('calm');
    // 激发态：calm 低于基线 0.361 → 被压下去，不是"她平静"
    expect(a.suppressed).toContain('calm');
    expect(a.delta.calm).toBeCloseTo(0.439 - 0.8, 5);
    // 真正被激起的是 love（+0.184 > lust +0.184 的并列，按键序稳定）
    expect(a.activeEmotion).not.toBeNull();
    expect(['love', 'lust', 'joy']).toContain(a.activeEmotion);
    expect(a.resting).toBe(false);
  });

  it('基调再高也不会当上主导（本模块的核心断言）', () => {
    const a = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: 0.2 });
    expect(a.activeEmotion).toBe('sad');
    expect(a.activeIntensity).toBeCloseTo(0.2, 5);
    expect(a.clear).toBe(true);
  });

  it('低于死区的偏离一律不算（不对噪声做动作）', () => {
    const justUnder = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: ACTIVATION_DEADZONE - 0.001 });
    expect(justUnder.resting).toBe(true);
    const justOver = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: ACTIVATION_DEADZONE + 0.001 });
    expect(justOver.activeEmotion).toBe('sad');
  });

  it('实测标定：单轮"骂老板"的噪声量级不该被当情绪', () => {
    // smoke 实测：用户愤怒 0.90 那一轮，她的 sad 只动了 +0.007
    const noise = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: RESTING_EMOTION_BASELINE.sad + 0.007 });
    expect(noise.resting).toBe(true);
    // 而持续低落 8 轮累积到 +0.128 —— 这个必须被判成"被激起了"
    const real = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: RESTING_EMOTION_BASELINE.sad + 0.128 });
    expect(real.activeEmotion).toBe('sad');
    expect(real.clear).toBe(true);
    expect(ACTIVATION_DEADZONE).toBeGreaterThan(0.007 * 5);
    expect(ACTIVATION_DEADZONE).toBeLessThan(0.128);
  });

  it('两个情绪接近时报"说不清"，不假装确定', () => {
    const a = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: 0.3, love: 0.3 });
    expect(a.activeEmotion).toBe('sad');
    expect(a.runnerUp).toBe('love');
    expect(a.clear).toBe(false);
    expect(a.note).toContain('并存');
    // 拉开到超过余量 → 明确
    const b = separateActivation({ ...RESTING_EMOTION_BASELINE, sad: 0.3 + ACTIVATION_MARGIN, love: 0.3 });
    expect(b.clear).toBe(true);
    expect(b.note).not.toContain('并存');
  });

  it('基调被压低单独列出（她此刻不在这个基调上）', () => {
    const a = separateActivation({ ...RESTING_EMOTION_BASELINE, calm: 0.2 });
    expect(a.suppressed).toEqual(['calm']);
    expect(a.resting).toBe(true);           // 没被激起什么
    expect(a.note).toContain('基调被压低');  // 但也不是"静息"
  });

  it('可以换人格基线（sweet 人格的静息值不同）', () => {
    const sweetBase = INITIAL_EMOTION_SWEET.emotions;
    // 用默认基线看，sweet 的 love 0.4 显得"被激起"；用 sweet 自己的基线看则是静息
    expect(separateActivation(sweetBase, RESTING_EMOTION_BASELINE).activeEmotion).toBe('love');
    const asSweet = separateActivation(sweetBase, sweetBase);
    expect(asSweet.resting).toBe(true);
  });

  it('垃圾输入不抛错、不产生 NaN', () => {
    for (const bad of [null, undefined, {}, { sad: NaN }, { sad: 'x' as never }, { 未知键: 1 }]) {
      const a = separateActivation(bad as never);
      expect(a.resting).toBe(true);
      for (const k of EMOTION_KEYS) expect(Number.isFinite(a.delta[k])).toBe(true);
    }
  });

  it('不修改传进来的对象（它是 state.emotions 的引用）', () => {
    const emo = { ...RESTING_EMOTION_BASELINE, sad: 0.5 };
    const snapshot = { ...emo };
    separateActivation(emo);
    expect(emo).toEqual(snapshot);
  });
});

describe('describeActivation — 两种读法必须并排出现', () => {
  it('同时给出绝对值读法和激发态读法（否则看不出旧结论有多不可信）', () => {
    const lines = describeActivation(LIVE_VECTOR);
    expect(lines[0]).toContain('绝对值读法');
    expect(lines[0]).toContain('平静');
    expect(lines[1]).toContain('激发态读法');
    expect(lines.join('\n')).toContain('基调被压低');
  });

  it('静息时不编造情绪', () => {
    expect(describeActivation(RESTING_EMOTION_BASELINE).join('\n')).toContain('静息');
  });
});

describe('emotionLabel — 情绪键 → 人话', () => {
  it('九情都有中文名，未知键原样返回（暴露引擎新增没同步的键）', () => {
    for (const k of EMOTION_KEYS) {
      expect(emotionLabel(k)).not.toBe(k);
      expect(emotionLabel(k).length).toBeGreaterThan(0);
    }
    expect(emotionLabel('brand_new')).toBe('brand_new');
    expect(emotionLabel(null)).toBe('未知');
  });
});
