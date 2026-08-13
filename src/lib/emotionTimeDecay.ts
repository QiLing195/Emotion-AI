// ── 时间衰减 (Time Decay) ──
// 从 emotionEngine.ts 拆分 (Phase 5) — 时间推移/离线后情感回归中性

import type { EmotionState } from './emotionTypes';

const EMOTION_HALF_LIVES: Record<string, number> = {
  joy: 6, anger: 8, sad: 6, fear: 12,
  love: 24,    // 6→24h，爱应是持久的情感羁绊
  disgust: 4, lust: 3, calm: 12, greed: 24,
};

export function processTimeDecay(state: EmotionState, hoursElapsed: number): EmotionState {
  if (hoursElapsed <= 0) return state;
  const h = Math.min(hoursElapsed, 168);
  const newState = structuredClone(state);

  // 九情指数衰减
  for (const key of Object.keys(newState.emotions)) {
    const hl = EMOTION_HALF_LIVES[key] ?? 4;
    const decay = Math.exp(-(Math.log(2) / hl) * h);
    newState.emotions[key] *= decay;
    if (Math.abs(newState.emotions[key]) < 0.01) newState.emotions[key] = 0;
  }

  // 太极层衰减（韧性越高，衰减越慢）
  const res = newState.evolution.resilience;
  const decayFactor = Math.exp(-0.15 * h * (1 - res * 0.5));
  newState.taiji.valence *= decayFactor;
  newState.taiji.arousal = 0.5 + (newState.taiji.arousal - 0.5) * decayFactor;
  // 预期衰减最慢（"弱者道之用"）
  newState.taiji.expectation *= Math.exp(-0.03 * h);

  // 三才回归中性
  const regress = 1 - Math.exp(-0.15 * h);
  newState.sancai.A += (0.5 - newState.sancai.A) * regress;
  newState.sancai.B += (0.5 - newState.sancai.B) * regress;
  newState.sancai.R += (0.5 - newState.sancai.R) * regress;

  // 亲密衰减
  newState.intimacyToUser += (0.5 - newState.intimacyToUser) * (1 - Math.exp(-0.08 * h));
  newState.intimacyFromUser += (0.5 - newState.intimacyFromUser) * (1 - Math.exp(-0.08 * h));

  // 强化层衰减
  newState.reinforcement.rewardTally *= Math.exp(-0.05 * h);
  newState.reinforcement.greedDrive = 0.3 + (newState.reinforcement.greedDrive - 0.3) * Math.exp(-0.05 * h);
  newState.reinforcement.punishmentTally *= Math.exp(-0.05 * h);
  newState.reinforcement.fearAvoidance = 0.1 + (newState.reinforcement.fearAvoidance - 0.1) * Math.exp(-0.05 * h);

  // 元情感衰减
  newState.metaEmotions.shame *= Math.exp(-0.15 * h);
  newState.metaEmotions.despair *= Math.exp(-0.1 * h);
  newState.metaEmotions.confusion *= Math.exp(-0.15 * h);

  // 演化衰减（韧性缓慢松弛）
  newState.evolution.resilience *= Math.exp(-0.005 * h);

  // v1.0 人格参数向基线(50)极慢回归
  const personalityRegress = 0.001 * h;
  newState.evolution.trust += (50 - newState.evolution.trust) * personalityRegress;
  newState.evolution.openness += (50 - newState.evolution.openness) * personalityRegress;
  newState.evolution.playfulness += (50 - newState.evolution.playfulness) * personalityRegress;

  return newState;
}
