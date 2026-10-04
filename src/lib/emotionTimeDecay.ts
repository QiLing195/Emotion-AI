// ── 时间衰减 (Time Decay) ──
// 从 emotionEngine.ts 拆分 (Phase 5) — 时间推移/离线后情感回归中性
//
// v1.24：九情也改为**回归各自的静息基线**（此前 `*= decay` 衰减到 0）。
//
// 为什么这是"补一处漏掉的基线"而不是改设计：本文件**其余每一层都是这么写的** ——
//   `arousal = 0.5 + (…)`、亲密 → 0.5、三才 → 0.5、`greedDrive = 0.3 + (…)`、
//   `fearAvoidance = 0.1 + (…)`、人格参数 → 50、强化 tally → 0。
// 只有九情那一行写成了纯乘法（没有回归目标），而 activation 层从 v1.13 起就按
// 「她的静息是 calm .8 / greed .2」在读 —— 两者直接冲突：**长时间没互动之后**（实测 168h 全归零）
// 读数会变成「情绪上没被激起什么，但基调被压低了：平静 −0.80、贪念 −0.20」。
// 修完之后"静息基线"只有一个含义：**它既是衰减的回归目标，也是判定"被激起"的参照**。

import { INITIAL_EMOTION_STATE } from './emotionTypes';
import type { EmotionState } from './emotionTypes';

const EMOTION_HALF_LIVES: Record<string, number> = {
  joy: 6, anger: 8, sad: 6, fear: 12,
  love: 24,    // 6→24h，爱应是持久的情感羁绊
  disgust: 4, lust: 3, calm: 12, greed: 24,
};

/**
 * 九情静息基线的回退值：**与 `emotionActivation.RESTING_EMOTION_BASELINE` 同源**
 * （都直接取 `INITIAL_EMOTION_STATE.emotions`，不在这里抄数字）。
 * 老数据没有 `baselineEmotions` 时用它 —— 关键是**必须与 activation 层用同一份**，
 * 否则两边对"静息"的定义又会分叉。
 */
function restingBaselineOf(state: EmotionState): Record<string, number> {
  return state.baselineEmotions ?? INITIAL_EMOTION_STATE.emotions;
}

/**
 * 是否让九情回归静息基线（默认开）。
 * 关掉 = 回到 v1.23 之前的"衰减到 0"，仅供 A/B 对照与回退；由 server 读 `DISABLE_BASELINE_DECAY` 设置。
 */
let baselineDecayEnabled = true;
export function setBaselineDecayEnabled(enabled: boolean): void { baselineDecayEnabled = enabled; }
export function isBaselineDecayEnabled(): boolean { return baselineDecayEnabled; }

/**
 * v1.43：**服务端**是否施加时间衰减（默认施加）。
 *
 * 为什么需要这个开关：v1.41 的探针实测服务端**从不衰减** —— `processTimeDecay` 只能经
 * `StateDecayed` 事件到达，而那个事件只有前端 store 在发。于是同一个函数在浏览器里生效、
 * 在权威（落盘）状态上从不生效，实测空闲 0.5/30/96/168 小时的 sad = 0.172/0.157/0.157/0.157
 * （一周与一天一模一样）。v1.43 把它接在协调器阶段 0。
 *
 * `DISABLE_SERVER_DECAY=true` 回到"服务端从不衰减"的旧行为（仅供 A/B 对照与回退）。
 * **每次调用现读 env**，A/B 脚本才能一条真管道跑完两档（与 `DEFER_ANCHOR_STYLE` 同一套路）。
 *
 * ⚠️ 与 `DISABLE_BASELINE_DECAY` 是**两件事**：那个决定衰减的**目标**（静息基线 / 0），
 * 这个决定衰减**做不做**。混为一谈的话，"关掉衰减"这件事就没法表达（改成衰减到 0 仍然在衰减）。
 */
export function serverDecayDisabled(): boolean {
  return process.env.DISABLE_SERVER_DECAY === 'true';
}

export function processTimeDecay(state: EmotionState, hoursElapsed: number): EmotionState {
  if (hoursElapsed <= 0) return state;
  const h = Math.min(hoursElapsed, 168);
  const newState = structuredClone(state);

  // 九情指数衰减 —— 回归**各自的**静息基线（不是回归 0）
  const baseline = restingBaselineOf(newState);
  for (const key of Object.keys(newState.emotions)) {
    const hl = EMOTION_HALF_LIVES[key] ?? 4;
    const decay = Math.exp(-(Math.log(2) / hl) * h);
    const base = typeof baseline[key] === 'number' && Number.isFinite(baseline[key]) ? baseline[key] : 0;
    if (baselineDecayEnabled) {
      // 高于基线的（被激起的）向基线落回；低于基线的（被压低的）也回到基线 —— 也就是"回到她平常的样子"
      newState.emotions[key] = base + (newState.emotions[key] - base) * decay;
      if (Math.abs(newState.emotions[key] - base) < 0.01) newState.emotions[key] = base;
    } else {
      newState.emotions[key] *= decay;
      if (Math.abs(newState.emotions[key]) < 0.01) newState.emotions[key] = 0;
    }
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
