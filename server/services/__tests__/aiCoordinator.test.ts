// ── aiCoordinator 接线回归测试（v1.9 A-0）──
// 背景：server.ts 曾只传 4 个字段，导致协调器里"已实现"的能力线上空转：
//   · lastInteractionAt 未传 → idleMins 恒为 0 → 孤独/重逢通路永不触发（实测线上）
//   · roundNumber 未传     → 退回进程内计数器（重启归零）
//   · activeValues 未传    → dialogueStrategy 的 S7 价值观调制永不成立
// 本文件锁死这些输入一旦被传入就必须生效，避免再次"看起来接好了其实空转"。

import { describe, it, expect } from 'vitest';
import { aiCoordinator } from '../aiCoordinator';
import { INITIAL_EMOTION_STATE } from '../../../src/lib/emotionEngine';
import type { EmotionState } from '../../../src/lib/emotionTypes';

const HOUR = 3_600_000;

function baseState(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function run(overrides: Record<string, unknown> = {}) {
  return aiCoordinator.processTurn({
    userText: '嗯',
    currentEmotionState: baseState(),
    emotionEvent: null,
    userAnalysis: null,
    ...overrides,
  } as never);
}

describe('aiCoordinator — lastInteractionAt 接线（孤独/重逢通路）', () => {
  it('传 12h 前的互动时间 → 孤独内在事件生效（sad 上升 + satiation 记录）', () => {
    const out = run({ lastInteractionAt: Date.now() - 12 * HOUR, roundNumber: 1 });
    expect(out.updatedEmotionState.internal?.satiation?.loneliness).toBeGreaterThan(0);
    expect(out.updatedEmotionState.emotions.sad).toBeGreaterThan(INITIAL_EMOTION_STATE.emotions.sad);
    expect(out.updatedEmotionState.taiji.valence).toBeLessThan(INITIAL_EMOTION_STATE.taiji.valence);
  });

  it('传 30h 前的互动时间 → 走重逢修复（joy/love 回升，且不叠加孤独）', () => {
    const out = run({ lastInteractionAt: Date.now() - 30 * HOUR, roundNumber: 1 });
    const satiation = out.updatedEmotionState.internal?.satiation ?? {};
    expect(satiation.reunion).toBeGreaterThan(0);
    expect(satiation.loneliness).toBeUndefined();
    expect(out.updatedEmotionState.emotions.joy).toBeGreaterThan(INITIAL_EMOTION_STATE.emotions.joy);
  });

  it('不传互动时间 → 不产生孤独事件（保持原有行为，不误报独处）', () => {
    const out = run({ roundNumber: 1 });
    expect(out.updatedEmotionState.internal?.satiation?.loneliness).toBeUndefined();
    expect(out.updatedEmotionState.internal?.satiation?.reunion).toBeUndefined();
  });
});

describe('aiCoordinator — roundNumber 透传', () => {
  it('传入的 roundNumber 应原样出现在元数据里（供 20/50 轮门控使用）', () => {
    const out = run({ roundNumber: 42 });
    expect(out.metadata.roundNumber).toBe(42);
  });

  it('未传时退回进程内计数器（向后兼容）', () => {
    const out = run({});
    expect(out.metadata.roundNumber).toBeGreaterThan(0);
  });
});

describe('aiCoordinator — activeValues 透传（S7 价值观调制）', () => {
  it('传入价值观优先级不应报错，且策略仍可选出', () => {
    const out = run({
      roundNumber: 7,
      activeValues: { connection: 0.8, honesty: 0.6, autonomy: 0.3 },
    });
    expect(out.strategy).toBeTruthy();
    expect(out.strategyDecision.confidence).toBeGreaterThan(0);
  });
});
