// ── moodLayer 单元测试 (v1.8) ──
// 覆盖：心情 EMA（时间加权）/ 半衰期淡忘 / 偏置上限 / 强烈情绪让位 /
//       新鲜度窗口 / 自然语言描述 / 提示词抑制
// 优先级：🔴 高 — 情绪涌现的"底色"层，且是防自嗨漂移的闸门之一

import { describe, it, expect } from 'vitest';
import {
  createMood,
  decayedMood,
  updateMood,
  moodSampleFrom,
  moodBiasWeight,
  moodBias,
  applyMoodBias,
  describeMood,
  moodPromptHint,
  hoursBetween,
  MOOD_MAX_BIAS,
  MOOD_HALF_LIFE_H,
  MOOD_FRESHNESS_H,
  MOOD_FULL_WEIGHT_H,
  MOOD_FIRST_ALPHA,
  MOOD_MIN_ALPHA,
  MOOD_SPAN,
  MOOD_DEADZONE,
  DEFAULT_ANCHOR_VALENCE,
  moodTargetValence,
  MOOD_TAU_H,
} from '../moodLayer';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState, MoodState } from '../emotionTypes';

const H = 3_600_000;
const T0 = 1_700_000_000_000;

function baseState(overrides: Partial<EmotionState> = {}): EmotionState {
  return structuredClone({ ...INITIAL_EMOTION_STATE, ...overrides }) as EmotionState;
}

function mood(overrides: Partial<MoodState> = {}): MoodState {
  return { valence: 0, arousal: 0.5, anchorValence: 0.2, updatedAt: T0, samples: 3, ...overrides };
}

// ════════════════════════════════════════════════════════════
// 1. 基础工具
// ════════════════════════════════════════════════════════════

describe('hoursBetween', () => {
  it('计算正向小时差', () => {
    expect(hoursBetween(T0, T0 + 2 * H)).toBeCloseTo(2, 6);
  });

  it('非法/未来时间戳返回 0（不产生负时长）', () => {
    expect(hoursBetween(undefined, T0)).toBe(0);
    expect(hoursBetween(NaN, T0)).toBe(0);
    expect(hoursBetween(T0 + H, T0)).toBe(0);
  });
});

describe('createMood / moodSampleFrom', () => {
  it('新建心情为中性且采样数为 0，并带静息锚点', () => {
    expect(createMood(T0)).toEqual({
      valence: 0, arousal: 0, anchorValence: 0.2, updatedAt: T0, samples: 0,
    });
    expect(createMood(T0, 0.5).anchorValence).toBe(0.5);
    expect(createMood(T0, NaN).anchorValence).toBe(0.2);
  });

  it('心情采样取自九情净效价（0 中心相对量，而非太极绝对值）', () => {
    const calm = baseState(); // 初始只有 calm=0.8 / greed=0.2 → 净效价 0
    expect(moodSampleFrom(calm).valence).toBeCloseTo(0, 10);

    const happy = baseState();
    happy.emotions.joy = 0.5;
    happy.emotions.love = 0.5;
    expect(moodSampleFrom(happy).valence).toBeGreaterThan(0);

    const sad = baseState();
    sad.emotions.sad = 0.6;
    expect(moodSampleFrom(sad).valence).toBeLessThan(0);
  });

  it('净效价夹在 [-1,1]，唤醒取自太极', () => {
    const s = baseState();
    s.emotions.joy = 10;
    s.taiji.arousal = 1.7;
    const sample = moodSampleFrom(s);
    expect(sample.valence).toBe(1);
    expect(sample.arousal).toBe(1);
  });

  it('太极效价为正值静息（0.2）时不产生"假性正心情"', () => {
    const s = baseState();
    s.taiji.valence = 0.5; // 甜蜜人格的静息效价
    expect(moodSampleFrom(s).valence).toBeCloseTo(0, 10);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 淡忘与 EMA
// ════════════════════════════════════════════════════════════

describe('decayedMood — 无新证据就淡忘', () => {
  it('无心情时返回中性心情', () => {
    expect(decayedMood(undefined, T0).valence).toBe(0);
  });

  it('经过一个半衰期后强度减半', () => {
    const m = mood({ valence: 0.8, arousal: 0.4 });
    const d = decayedMood(m, T0 + MOOD_HALF_LIFE_H * H);
    expect(d.valence).toBeCloseTo(0.4, 6);
    expect(d.arousal).toBeCloseTo(0.2, 6);
  });

  it('经过两个半衰期后强度为四分之一', () => {
    const d = decayedMood(mood({ valence: 0.8 }), T0 + 2 * MOOD_HALF_LIFE_H * H);
    expect(d.valence).toBeCloseTo(0.2, 6);
  });

  it('不修改入参（纯函数）', () => {
    const m = mood({ valence: 0.6 });
    decayedMood(m, T0 + 10 * H);
    expect(m.valence).toBe(0.6);
    expect(m.updatedAt).toBe(T0);
  });
});

describe('updateMood — 时间加权 EMA', () => {
  it('首次采样只采纳 MOOD_FIRST_ALPHA 比例（单轮不足以定义一天心情）', () => {
    const m = updateMood(undefined, { valence: 1, arousal: 1 }, T0);
    expect(m.valence).toBeCloseTo(MOOD_FIRST_ALPHA, 6);
    expect(m.arousal).toBeCloseTo(MOOD_FIRST_ALPHA, 6);
    expect(m.samples).toBe(1);
  });

  it('静息锚点以调用方传入的基线为准（可自动纠正历史锚点），未传入时沿用旧值', () => {
    const first = updateMood(undefined, { valence: 0.4, arousal: 0.5 }, T0, 0.5);
    expect(first.anchorValence).toBe(0.5);
    // 基线漂移 / persona 变更 → 传入值覆盖历史锚点
    const later = updateMood(first, { valence: 0.4, arousal: 0.5 }, T0 + 3 * H, 0.1);
    expect(later.anchorValence).toBe(0.1);
    // 调用方没给 → 沿用历史锚点
    const noAnchor = updateMood(later, { valence: 0.4, arousal: 0.5 }, T0 + 6 * H);
    expect(noAnchor.anchorValence).toBe(0.1);
  });

  it('未指定锚点时用默认静息效价', () => {
    expect(updateMood(undefined, { valence: 0.4, arousal: 0.5 }, T0).anchorValence)
      .toBe(DEFAULT_ANCHOR_VALENCE);
  });

  it('采样数为 0 的历史心情按首次采样处理', () => {
    const m = updateMood(mood({ valence: 0.9, samples: 0 }), { valence: 0, arousal: 0 }, T0);
    expect(m.valence).toBe(0);
    expect(m.samples).toBe(1);
  });

  it('同一个 dt 下的 EMA 采纳率符合 1 - exp(-dt/tau)', () => {
    const dtH = MOOD_TAU_H; // 恰好一个时间常数
    const prev = mood({ valence: 0, arousal: 0.5, updatedAt: T0 });
    const next = updateMood(prev, { valence: 1, arousal: 0.5 }, T0 + dtH * H);
    const alpha = 1 - Math.exp(-1);
    expect(next.valence).toBeCloseTo(alpha, 6);
  });

  it('同一瞬间（dt=0）的第二次采样仍按 MOOD_FIRST_ALPHA 采纳', () => {
    const m = updateMood(mood({ valence: 0, samples: 2 }), { valence: 1, arousal: 0 }, T0);
    expect(m.valence).toBeCloseTo(MOOD_FIRST_ALPHA, 6);
  });

  it('相邻轮次（分钟级）采纳率很低：心情是"慢"量', () => {
    const prev = mood({ valence: 0, arousal: 0.5 });
    const next = updateMood(prev, { valence: 1, arousal: 0.5 }, T0 + 5 * 60_000);
    expect(next.valence).toBeGreaterThan(0);
    expect(next.valence).toBeLessThan(MOOD_MIN_ALPHA + 1e-9);
  });

  it('两个连续采样比一个长间隔采样更"迟钝"（时间加权生效）', () => {
    const prev = mood({ valence: 0, arousal: 0.5 });
    const oneJump = updateMood(prev, { valence: 1, arousal: 0.5 }, T0 + 6 * H);
    const s1 = updateMood(prev, { valence: 1, arousal: 0.5 }, T0 + 1 * H);
    const twoSteps = updateMood(s1, { valence: 1, arousal: 0.5 }, T0 + 2 * H);
    expect(twoSteps.valence).toBeLessThan(oneJump.valence);
  });

  it('久别（超过多个半衰期）后心情快速跟上当下而非被旧心情拖住', () => {
    const prev = mood({ valence: -0.9, arousal: 0.9 });
    const next = updateMood(prev, { valence: 0.5, arousal: 0.5 }, T0 + 48 * H);
    // 旧心情已几乎衰减干净 → 结果接近新采样
    expect(next.valence).toBeGreaterThan(0.4);
  });

  it('反复同一采样时心情收敛到一个"被阻尼"的水平（心情是情绪的阻尼积分，不是原样累加）', () => {
    let m = createMood(T0);
    let t = T0;
    for (let i = 0; i < 40; i++) {
      t += 0.5 * H;
      m = updateMood(m, { valence: -0.7, arousal: 0.2 }, t);
    }
    // 持续 20h 的 -0.7 采样 → 心情稳定在约 -0.47（≈ 采样的 70%，
    // 差额被"无新证据即淡忘"的半衰期吃掉，这正是心情不会无限放大的原因）
    expect(m.valence).toBeLessThan(-0.4);
    expect(m.valence).toBeGreaterThan(-0.55);
    expect(m.valence).toBeGreaterThan(-0.7);
    expect(m.arousal).toBeGreaterThanOrEqual(0);
    expect(m.arousal).toBeLessThanOrEqual(1);
    expect(m.samples).toBe(40);
  });

  it('采样值越界时被夹紧', () => {
    const m = updateMood(mood({ valence: 0, samples: 1 }), { valence: 9, arousal: -9 }, T0 + 5 * H);
    expect(m.valence).toBeLessThanOrEqual(1);
    expect(m.arousal).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 偏置权重：新鲜度 + 强烈情绪让位
// ════════════════════════════════════════════════════════════

describe('moodBiasWeight', () => {
  it('无心情 → 权重 0', () => {
    expect(moodBiasWeight(undefined, T0)).toBe(0);
    expect(moodBiasWeight(mood({ samples: 0 }), T0)).toBe(0);
  });

  it('新鲜期内（≤6h）权重为 1', () => {
    expect(moodBiasWeight(mood(), T0 + MOOD_FULL_WEIGHT_H * H)).toBeCloseTo(1, 6);
  });

  it('6~24h 之间线性衰减，24h 后为 0（不带一周前的心情说话）', () => {
    const mid = moodBiasWeight(mood(), T0 + 15 * H);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(moodBiasWeight(mood(), T0 + MOOD_FRESHNESS_H * H)).toBe(0);
    expect(moodBiasWeight(mood(), T0 + 100 * H)).toBe(0);
  });

  it('主导情绪越强，心情让位越多', () => {
    const calm = moodBiasWeight(mood(), T0, 0);
    const strong = moodBiasWeight(mood(), T0, 1);
    expect(strong).toBeLessThan(calm);
  });
});

describe('moodBias', () => {
  it('权重为 0 时偏置为 0', () => {
    expect(moodBias(undefined, T0).valence).toBe(0);
    expect(moodBias(mood(), T0 + 48 * H).weight).toBe(0);
  });

  it('偏置幅度受 MOOD_MAX_BIAS 限制', () => {
    const b = moodBias(mood({ valence: 1, arousal: 1 }), T0, 0);
    expect(Math.abs(b.valence)).toBeLessThanOrEqual(MOOD_MAX_BIAS + 1e-9);
    expect(Math.abs(b.arousal)).toBeLessThanOrEqual(MOOD_MAX_BIAS + 1e-9);
  });

  it('心情为正时偏置为正、为负时偏置为负', () => {
    expect(moodBias(mood({ valence: 0.8 }), T0).valence).toBeGreaterThan(0);
    expect(moodBias(mood({ valence: -0.8 }), T0).valence).toBeLessThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// 4. applyMoodBias — 落到情感状态
// ════════════════════════════════════════════════════════════

describe('applyMoodBias', () => {
  it('无心情时返回原对象（同一引用）', () => {
    const s = baseState();
    expect(applyMoodBias(s, undefined, T0)).toBe(s);
    expect(applyMoodBias(s, mood({ samples: 0 }), T0)).toBe(s);
  });

  it('心情过期时返回原对象', () => {
    const s = baseState();
    expect(applyMoodBias(s, mood({ valence: -0.9 }), T0 + 30 * H)).toBe(s);
  });

  it('目标效价 = 静息锚点 + 心情偏差 × MOOD_SPAN', () => {
    expect(moodTargetValence(mood({ valence: 0.5, anchorValence: 0.2 }), T0))
      .toBeCloseTo(0.2 + 0.5 * MOOD_SPAN, 10);
    expect(moodTargetValence(mood({ valence: -0.5, anchorValence: 0.5 }), T0))
      .toBeCloseTo(0.5 - 0.5 * MOOD_SPAN, 10);
  });

  it('心情在死区内（|偏差| < MOOD_DEADZONE）完全不介入', () => {
    const s = baseState();
    expect(applyMoodBias(s, mood({ valence: MOOD_DEADZONE - 0.01 }), T0)).toBe(s);
  });

  it('已处在目标效价时不产生偏置（靠拢式偏置自限）', () => {
    const s = baseState();
    s.taiji.valence = moodTargetValence(mood({ valence: 0.6 }), T0);
    expect(applyMoodBias(s, mood({ valence: 0.6 }), T0)).toBe(s);
  });

  it('心情偏正时会把她从更低处往上拉（不是单向压制）', () => {
    const s = baseState();
    s.taiji.valence = 0.0;
    const out = applyMoodBias(s, mood({ valence: 0.6 }), T0);
    expect(out.taiji.valence).toBeGreaterThan(0);
  });

  it('偏置量按"本轮起点"计算：用户当下造成的影响被完整保留（不被心情抹平）', () => {
    const noImpact = baseState();
    noImpact.taiji.valence = 0.2;  // 本轮开始前 = 本轮结束（用户没带来变化）
    const withImpact = baseState();
    withImpact.taiji.valence = -0.3; // 用户这一句让她掉了 0.5

    const m = mood({ valence: -0.1 });
    const a = applyMoodBias(noImpact, m, T0, 0, 0.2);
    const b = applyMoodBias(withImpact, m, T0, 0, 0.2);

    // 两者偏置量完全相同 → 用户影响的差值（-0.5）原样保留
    expect(b.taiji.valence - a.taiji.valence).toBeCloseTo(-0.5, 6);
    // 且心情确实起了作用（往下推了一小步）
    expect(a.taiji.valence).toBeLessThan(0.2);
  });

  it('心情锚定在人格基线上：低谷中的她会被轻轻托回，而不是越陷越深', () => {
    const s = baseState();
    s.taiji.valence = -0.5; // 此刻很低落
    // 基线 0.2，心情轻度负（-0.2）→ 目标 0.13，偏置应当向上
    const out = applyMoodBias(s, mood({ valence: -0.2, anchorValence: 0.2 }), T0, 0, -0.5);
    expect(out.taiji.valence).toBeGreaterThan(-0.5);
  });

  it('低落心情把中性状态往下推，且幅度不超过 MOOD_MAX_BIAS', () => {
    const s = baseState();
    s.taiji.valence = 0;
    const out = applyMoodBias(s, mood({ valence: -0.8 }), T0);
    expect(out.taiji.valence).toBeLessThan(0);
    expect(out.taiji.valence).toBeGreaterThanOrEqual(-MOOD_MAX_BIAS - 1e-9);
  });

  it('不修改入参（纯函数）', () => {
    const s = baseState();
    const before = structuredClone(s);
    applyMoodBias(s, mood({ valence: -0.8, arousal: 0.9 }), T0);
    expect(s.taiji).toEqual(before.taiji);
    expect(s.emotions).toEqual(before.emotions);
  });

  it('强烈主导情绪时心情几乎不让偏置生效（用户信号优先）', () => {
    const s = baseState();
    s.taiji.valence = 0;
    const weak = applyMoodBias(s, mood({ valence: -0.8 }), T0, 0.05);
    const strong = applyMoodBias(s, mood({ valence: -0.8 }), T0, 0.95);
    expect(strong.taiji.valence).toBeGreaterThan(weak.taiji.valence);
    expect(strong.taiji.valence).toBeLessThanOrEqual(0);
  });

  it('已经比心情更低落时，偏置把状态往上拉（向心情靠拢，不是单向压）', () => {
    const s = baseState();
    s.taiji.valence = -0.9;
    const out = applyMoodBias(s, mood({ valence: -0.2 }), T0);
    expect(out.taiji.valence).toBeGreaterThan(s.taiji.valence);
  });

  it('正心情轻微牵动 joy，负心情轻微牵动 sad', () => {
    const s = baseState();
    s.taiji.valence = 0;
    s.emotions.joy = 0;
    s.emotions.sad = 0;
    const happy = applyMoodBias(s, mood({ valence: 0.9 }), T0);
    expect(happy.emotions.joy).toBeGreaterThan(0);
    const sad = applyMoodBias(s, mood({ valence: -0.9 }), T0);
    expect(sad.emotions.sad).toBeGreaterThan(0);
  });

  it('中性心情不牵动九情（只可能微调太极）', () => {
    const s = baseState();
    s.taiji.valence = 0.3;
    s.emotions.joy = 0.2;
    s.emotions.sad = 0.1;
    const out = applyMoodBias(s, mood({ valence: 0 }), T0);
    expect(out.emotions.joy).toBeCloseTo(0.2, 6);
    expect(out.emotions.sad).toBeCloseTo(0.1, 6);
  });

  it('太极夹在合法区间', () => {
    const s = baseState();
    s.taiji.valence = 0.99;
    s.taiji.arousal = 0.99;
    const out = applyMoodBias(s, mood({ valence: 1, arousal: 1 }), T0);
    expect(out.taiji.valence).toBeLessThanOrEqual(1);
    expect(out.taiji.arousal).toBeLessThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════
// 5. 描述与提示词
// ════════════════════════════════════════════════════════════

describe('describeMood', () => {
  it('无心情 → 平静', () => {
    expect(describeMood(undefined, T0)).toBe('平静');
  });

  it('区分正负与唤醒高低', () => {
    expect(describeMood(mood({ valence: 0.6, arousal: 0.7 }), T0)).toContain('很好');
    expect(describeMood(mood({ valence: 0.6, arousal: 0.1 }), T0)).toBe('心情很好');
    expect(describeMood(mood({ valence: -0.6, arousal: 0.1 }), T0)).toBe('心情很低落');
    expect(describeMood(mood({ valence: -0.6, arousal: 0.8 }), T0)).toContain('烦躁');
  });

  it('中性偏一点 → 平淡/平静类描述', () => {
    expect(describeMood(mood({ valence: 0.02, arousal: 0.45 }), T0)).toBe('心情平淡');
    expect(describeMood(mood({ valence: 0.0, arousal: 0.9 }), T0)).toBe('心里有点躁动');
    expect(describeMood(mood({ valence: 0.0, arousal: 0.1 }), T0)).toBe('心情平静，有点懒');
  });

  it('过期心情按衰减后的值描述（不夸张）', () => {
    const m = mood({ valence: -0.9, arousal: 0.1 });
    const later = describeMood(m, T0 + MOOD_HALF_LIFE_H * H * 3);
    expect(later).not.toBe('心情很低落');
  });
});

describe('moodPromptHint', () => {
  it('中性心情不注入提示词（避免每轮同一句话）', () => {
    expect(moodPromptHint(mood({ valence: 0.05, arousal: 0.5 }), T0)).toBeNull();
    expect(moodPromptHint(undefined, T0)).toBeNull();
  });

  it('明显心情给出底色提示，且不暴露内部数字', () => {
    const hint = moodPromptHint(mood({ valence: -0.6, arousal: 0.3 }), T0);
    expect(hint).toBeTruthy();
    expect(hint).toContain('底色心情');
    expect(hint).not.toMatch(/0\.\d/);
  });

  it('过期心情不再提示', () => {
    expect(moodPromptHint(mood({ valence: -0.9 }), T0 + 40 * H)).toBeNull();
  });
});
