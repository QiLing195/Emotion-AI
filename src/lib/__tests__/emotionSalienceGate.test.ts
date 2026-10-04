// ── 预测误差显著性门控 回归测试（v1.15）──
// 背景（真实根因）：她长期停在 valence≈-0.49 / disgust 0.55。
// 追查发现引擎把「没有信号」当成「坏消息」：
//   updateEmotionState 里 eventValence = f(deltaA,deltaB,GC)，全零事件 → eventValence = 0；
//   而 expectation 初始为 +0.2（人格乐观基线）→ predictionError = 0 − 0.2 = −0.2，
//   再被损失厌恶放大 → 效价被无中生有地扣掉。
//   实测 12 轮零信号事件：valence 0.2 → −0.31、disgust 0 → 0.35、expectation 0.2 → 0.014。
//   eventSalience 当时只用于唤醒，未参与效价/预期的门控 —— 这就是缺口。
//
// 修复：predictionError *= infoFactor（由 eventSalience 决定），
//   salience < SALIENCE_DEADZONE → 0（无信号即无误差）；≥ SALIENCE_FULL → 全额（行为不变）。

import { describe, it, expect } from 'vitest';
import { applyEvent, buildEmotionUpdatedPayload } from '../stateReducer';
import { INITIAL_EMOTION_STATE, INITIAL_TAIJI } from '../emotionEngine';
import { SALIENCE_DEADZONE, SALIENCE_FULL } from '../emotionTypes';
import type { EmotionEvent, EmotionState } from '../emotionEngine';

function run(event: EmotionEvent, turns: number, start?: EmotionState): EmotionState {
  let s: EmotionState = structuredClone(start ?? INITIAL_EMOTION_STATE);
  for (let i = 0; i < turns; i++) {
    const e = s.evolution;
    s = applyEvent(s, {
      id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion', timestamp: Date.now(),
      data: buildEmotionUpdatedPayload({
        stimulus: event,
        context: {
          baseA: e.resilience, baseB: 1 - e.resilience, baseR: e.sensitivity,
          emotionalStability: Math.max(0.1, Math.min(0.9, 1 - e.sensitivity)),
          empathy: e.empathy, optimism: e.optimism,
        },
      }),
    });
  }
  return s;
}

const zeroEvent: EmotionEvent = {
  deltaA: 0, deltaB: 0, deltaR: 0, intent: 'third_party',
  GC: 0, agency: 0, fairness: 0, control: 0,
};

describe('没有信号 ≠ 坏消息', () => {
  it('连续 12 轮全零事件：不再被拖成负效价', () => {
    const out = run(zeroEvent, 12);
    // 修复前实测为 −0.31
    expect(out.taiji.valence).toBeGreaterThan(0.15);
    expect(out.emotions.sad).toBeLessThan(0.2);
    expect(out.emotions.disgust).toBeLessThan(0.2);
  });

  it('连续 12 轮全零事件：预期不被侵蚀（乐观基线不再流失）', () => {
    const out = run(zeroEvent, 12);
    // 修复前从 0.2 塌到 0.014
    expect(out.taiji.expectation).toBeGreaterThan(INITIAL_TAIJI.expectation - 0.02);
  });

  it('长时间（40 轮）纯寒暄也不会积累出忧郁', () => {
    const out = run(zeroEvent, 40);
    expect(out.taiji.valence).toBeGreaterThan(0.1);
    expect(out.taiji.expectation).toBeGreaterThan(0.17);
  });

  it('微小噪声（显著性低于死区）同样视为无信息', () => {
    const noise: EmotionEvent = { ...zeroEvent, deltaA: 0.01, deltaB: 0.01, GC: 0.005 };
    const out = run(noise, 12);
    expect(out.taiji.valence).toBeGreaterThan(0.15);
    expect(out.taiji.expectation).toBeGreaterThan(INITIAL_TAIJI.expectation - 0.02);
  });

  it('死区边界内（salience < SALIENCE_DEADZONE）不改变效价', () => {
    const tiny: EmotionEvent = { ...zeroEvent, GC: SALIENCE_DEADZONE / 2 };
    const out = run(tiny, 5);
    expect(out.taiji.valence).toBeCloseTo(0.199 * Math.pow(0.995, 4), 2); // 仅自然衰减
  });
});

describe('真实信号仍然驱动情绪（修复没有把引擎打哑）', () => {
  it('线上实测的"轻微闲聊"量级（显著性 0.17）不推动情绪（死区按实测标定）', () => {
    // 线上 NLU 对"哈哈，有意思""看到一只小猫"给出 GC=0.1 / ΔA=0.05 / ΔB=0.02 → 显著性 0.17 < 死区 0.20
    const chatty: EmotionEvent = { ...zeroEvent, deltaA: 0.05, deltaB: 0.02, GC: 0.1 };
    const salience = 0.05 + 0.02 + 0.1;
    expect(salience).toBeLessThan(SALIENCE_DEADZONE);
    const out = run(chatty, 12);
    // 修复前这类消息会让「预期 0.13 > 事件效价 0.06」持续产生负误差，把乐观预期磨掉
    expect(out.taiji.expectation).toBeGreaterThan(INITIAL_TAIJI.expectation - 0.02);
  });

  it('强负事件显著降低效价', () => {
    const negative: EmotionEvent = {
      deltaA: -0.3, deltaB: 0.4, deltaR: -0.1, intent: 'third_party',
      GC: -0.6, agency: -0.4, fairness: -0.5, control: -0.3,
    };
    const out = run(negative, 1);
    expect(out.taiji.valence).toBeLessThan(INITIAL_TAIJI.valence - 0.05);
  });

  it('强正事件显著提升效价', () => {
    const positive: EmotionEvent = {
      deltaA: 0.3, deltaB: -0.2, deltaR: 0.05, intent: 'user',
      GC: 0.6, agency: -0.3, fairness: 0.5, control: 0.3,
    };
    const out = run(positive, 1);
    expect(out.taiji.valence).toBeGreaterThan(INITIAL_TAIJI.valence + 0.05);
  });

  it('显著性达到 SALIENCE_FULL 时行为与修复前一致（全额误差）', () => {
    // salience = |−0.3| + |0.4| + |−0.1| + |−0.6| = 1.4 ≥ FULL → infoFactor = 1
    const strong: EmotionEvent = {
      deltaA: -0.3, deltaB: 0.4, deltaR: -0.1, intent: 'third_party',
      GC: -0.6, agency: 0, fairness: 0, control: 0,
    };
    const salience = Math.abs(strong.deltaA) + Math.abs(strong.deltaB) + Math.abs(strong.deltaR) + Math.abs(strong.GC);
    expect(salience).toBeGreaterThanOrEqual(SALIENCE_FULL);
    const out = run(strong, 1);
    // 期望：效价被明显拉低（若门控误伤强信号，这里会几乎不动）
    expect(INITIAL_TAIJI.valence - out.taiji.valence).toBeGreaterThan(0.05);
  });

  it('中等信号的反应弱于强信号（按信息量单调）', () => {
    const mid: EmotionEvent = { ...zeroEvent, deltaA: -0.1, deltaB: 0.1, GC: -0.2 };
    const strong: EmotionEvent = { ...zeroEvent, deltaA: -0.25, deltaB: 0.25, GC: -0.5 };
    const dropMid = INITIAL_TAIJI.valence - run(mid, 1).taiji.valence;
    const dropStrong = INITIAL_TAIJI.valence - run(strong, 1).taiji.valence;
    expect(dropMid).toBeLessThan(dropStrong);
  });
});

describe('从受损状态出发也能自我恢复（不再继续下沉）', () => {
  it('从低谷起步、只收到零信号时不会继续恶化', () => {
    const damaged: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
    damaged.taiji.valence = -0.49;
    damaged.taiji.expectation = 0.0;
    damaged.emotions.disgust = 0.55;
    damaged.emotions.sad = 0.36;
    const out = run(zeroEvent, 10, damaged);
    // 效价只剩自然衰减（向 0 回升），不再被幽灵误差继续压低
    expect(out.taiji.valence).toBeGreaterThan(-0.49);
    // 预期在无信号时**保持不变**（修复前会继续被 −expectation 侵蚀；回升需要真实的正面信号）
    expect(out.taiji.expectation).toBeGreaterThanOrEqual(0);
  });
});
