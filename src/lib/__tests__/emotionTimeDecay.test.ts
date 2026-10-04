// ── 时间衰减：九情回归**各自的静息基线**（v1.24）──
//
// 这一组锁的是"两个静息互相矛盾"那个 bug：
// `processTimeDecay` 原来把九情 `*= decay`（衰减到 0），而 activation 层从 v1.13 起
// 就按「她的静息是 calm .8 / greed .2」在读 → 长空闲后读数变成
// 「基调被压低：平静 −0.80、贪念 −0.20」，而不是"静息"。
// 关键证据：本文件其余每一层本来就回归自己的基线（arousal/亲密/三才 → 0.5、
// greedDrive → 0.3、fearAvoidance → 0.1、人格参数 → 50），只有九情漏了。

import { describe, it, expect, afterEach } from 'vitest';
import { processTimeDecay, setBaselineDecayEnabled, isBaselineDecayEnabled } from '../emotionTimeDecay';
import { activationOf, RESTING_EMOTION_BASELINE } from '../emotionActivation';
import {
  INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET, INITIAL_EMOTION_GENTLE,
} from '../emotionTypes';
import type { EmotionState } from '../emotionTypes';

afterEach(() => setBaselineDecayEnabled(true));   // 别把开关漏给别的用例

/** 一个"被激起过"的状态：她基线之上还有明显位移 */
function excited(over: Record<string, number> = {}): EmotionState {
  const s = structuredClone(INITIAL_EMOTION_STATE);
  Object.assign(s.emotions, { sad: 0.5, love: 0.4, ...over });
  return s;
}

describe('v1.24 九情衰减回归静息基线', () => {
  it('被激起的情绪落回基线（不是落到 0 再往下没人管）', () => {
    const out = processTimeDecay(excited(), 168);
    expect(out.emotions.sad).toBeCloseTo(RESTING_EMOTION_BASELINE.sad, 5);     // 0
    expect(out.emotions.calm).toBeCloseTo(RESTING_EMOTION_BASELINE.calm, 5);   // 0.8
    expect(out.emotions.greed).toBeCloseTo(RESTING_EMOTION_BASELINE.greed, 5); // 0.2
  });

  it('被**压低**的基调也回到基线（安静下来她仍是平静的）', () => {
    const s = structuredClone(INITIAL_EMOTION_STATE);
    s.emotions.calm = 0.2;   // 平静被压下去（不是"被激起"）
    const out = processTimeDecay(s, 168);
    expect(out.emotions.calm).toBeCloseTo(RESTING_EMOTION_BASELINE.calm, 5);
  });

  it('衰减后的读数就是"静息"，不再是"基调被压低"（这就是修它的目的）', () => {
    const before = activationOf(processTimeDecay(excited(), 168));
    expect(before.resting).toBe(true);
    expect(before.suppressed).toEqual([]);
    expect(before.note).not.toMatch(/基调被压低/);
  });

  it('用**状态自带**的基线：sweet 长时间后停在 love .4，而不是落到 0', () => {
    const sweet = structuredClone(INITIAL_EMOTION_SWEET);
    sweet.emotions.love = 0.8;                       // 被激起（基线是 .4）
    const out = processTimeDecay(sweet, 168);
    expect(out.emotions.love).toBeCloseTo(0.4, 5);   // 回到 sweet 的基线
    expect(out.emotions.calm).toBeCloseTo(0.8, 5);
    expect(activationOf(out).resting).toBe(true);    // 且读作静息
  });

  it('gentle 的 calm 基线是 .9：长时间后停在那儿', () => {
    const gentle = structuredClone(INITIAL_EMOTION_GENTLE);
    const out = processTimeDecay(gentle, 168);
    expect(out.emotions.calm).toBeCloseTo(0.9, 5);
    expect(activationOf(out).resting).toBe(true);
  });

  it('老数据没有 baselineEmotions → 用默认基线（与 activation 层同源，不再分叉）', () => {
    const s = excited();
    delete (s as { baselineEmotions?: unknown }).baselineEmotions;
    const out = processTimeDecay(s, 168);
    expect(out.emotions.calm).toBeCloseTo(RESTING_EMOTION_BASELINE.calm, 5);
    expect(activationOf({ emotions: out.emotions }).resting).toBe(true);   // activation 也回退到同一份
  });

  it('开关关掉 → 回到 v1.23 之前的旧行为（衰减到 0），可随时回退', () => {
    setBaselineDecayEnabled(false);
    expect(isBaselineDecayEnabled()).toBe(false);
    const out = processTimeDecay(excited(), 168);
    expect(out.emotions.calm).toBe(0);
    expect(out.emotions.sad).toBe(0);
    // 旧行为下的读数正是那条"基调被压低"（这就是它错在哪）
    expect(activationOf({ emotions: out.emotions }).note).toMatch(/基调被压低/);
  });

  it('短时间只衰减一部分（不是一步跳回基线）', () => {
    const out = processTimeDecay(excited({ sad: 0.6 }), 6);   // sad 半衰期 6h
    expect(out.emotions.sad).toBeGreaterThan(0.2);
    expect(out.emotions.sad).toBeLessThan(0.6);
  });

  it('非法/缺失基线不会产生 NaN', () => {
    const s = excited();
    s.baselineEmotions = { sad: NaN, love: 'x' as never };
    const out = processTimeDecay(s, 48);
    for (const v of Object.values(out.emotions)) expect(Number.isFinite(v)).toBe(true);
  });
});
