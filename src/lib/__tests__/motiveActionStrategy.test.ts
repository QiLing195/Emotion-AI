// ── v1.57 Rule 3.5：`action → selectedStrategy` 的单测 ──
//
// 用户方案 C 的问题被严格限定为：**同一个动机，只改 `action`，策略决策会不会变**。
// 所以这里的断言全部落在 `strategy` 与 `reason` 上 —— **不测她说的话**（那是 A/B 的事）。
//
// 必须锁死：①开关默认关、关着时字段**完全无效**（逐字节旧行为）
//           ②开着时 share→share / ask→explore / wait→accompany，且 reason 里留动机痕迹
//           ③`comfort`/`celebrate` 今天**没有规则** ⇒ 只留痕、不改策略（诚实留白）
//           ④**安全线优先**：连续负面时 action=share **不得**把策略抢成 share
//           ⑤`actionFor` 的缺省（按 kind）与实例覆盖

import { describe, it, expect, afterEach } from 'vitest';
import { selectStrategy, motiveActionStrategyEnabled } from '../dialogueStrategy';
import type { StrategyContext, StrategyMotiveContext } from '../dialogueStrategy';
import { RESTING_EMOTION_BASELINE } from '../emotionActivation';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import { actionFor } from '../motive';
import type { MotiveAction, MotiveKind } from '../emotionTypes';

const KEY = 'ENABLE_MOTIVE_ACTION_STRATEGY';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});
const on = () => { process.env[KEY] = 'true'; };
const off = () => { delete process.env[KEY]; };

function herState() {
  return {
    ...structuredClone(INITIAL_EMOTION_STATE),
    emotions: { ...RESTING_EMOTION_BASELINE, sad: (RESTING_EMOTION_BASELINE.sad ?? 0) + 0.08 },
    baselineEmotions: { ...RESTING_EMOTION_BASELINE },
  } as never;
}
function ctx(over: Partial<StrategyContext> = {}): StrategyContext {
  return {
    emotionState: herState(),
    herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.06 },
    userAnalysis: null,
    conflictState: null,
    recentUserMoods: [0.1, 0.05, 0.12],
    consecutiveNegativeRounds: 0,
    interestSignals: [],
    pendingDiscoveries: [],
    idleMinutes: 3,
    timeOfDay: 15,
    ...over,
  } as unknown as StrategyContext;
}
const withMotive = (action: MotiveAction, kind: MotiveKind = 'memory_echo'): Partial<StrategyContext> => ({
  motive: { type: kind, action, priority: 0.62 } as StrategyMotiveContext,
});

describe('v1.57 策略层消费动机的行动倾向（Rule 3.5）', () => {
  it('开关默认关；只认字面 true', () => {
    off();
    expect(motiveActionStrategyEnabled()).toBe(false);
    process.env[KEY] = '1';
    expect(motiveActionStrategyEnabled()).toBe(false);
    on();
    expect(motiveActionStrategyEnabled()).toBe(true);
  });

  it('关着时**字段完全无效**：给不给 motive，策略与理由都逐字相同', () => {
    off();
    for (const a of ['share', 'ask', 'wait'] as MotiveAction[]) {
      const base = selectStrategy(ctx());
      const withField = selectStrategy(ctx(withMotive(a)));
      expect(withField.strategy, a).toBe(base.strategy);
      expect(withField.reason, a).toBe(base.reason);
    }
  });

  it('开着时三个 action 给出**三个不同**的策略，且 reason 里留动机痕迹', () => {
    on();
    const share = selectStrategy(ctx(withMotive('share')));
    const ask = selectStrategy(ctx(withMotive('ask')));
    const wait = selectStrategy(ctx(withMotive('wait')));
    expect(share.strategy).toBe('share');
    expect(ask.strategy).toBe('explore');
    expect(wait.strategy).toBe('accompany');
    expect(new Set([share.strategy, ask.strategy, wait.strategy]).size).toBe(3);
    for (const d of [share, ask, wait]) {
      expect(d.reason).toContain('action=');
      expect(d.reason).toContain('memory_echo');
    }
  });

  it('⚠️ `comfort` / `celebrate` 今天没有规则 ⇒ 只留白、**不改策略**', () => {
    on();
    const base = selectStrategy(ctx());
    for (const a of ['comfort', 'celebrate'] as MotiveAction[]) {
      const d = selectStrategy(ctx(withMotive(a)));
      expect(d.strategy, a).toBe(base.strategy);
      expect(d.reason, a).toBe(base.reason);
    }
  });

  it('⚠️ **安全线优先**：连续负面（且未回升）时 action=share **不得**把策略抢成 share', () => {
    on();
    // ⚠️ Rule 2 里有 `isRecovering` 例外（末尾两轮在回升 ⇒ 故意不转移注意）。
    //    所以这里必须给一条**真的没有回升**的序列 —— 第一版我给了 [-0.4,-0.5,-0.6,-0.45]，
    //    末尾回升 ⇒ Rule 2 不触发 ⇒ 断言失败。**那是我用例的错，不是策略的 bug。**
    const d = selectStrategy(ctx({
      ...withMotive('share'),
      consecutiveNegativeRounds: 5,
      recentUserMoods: [-0.4, -0.5, -0.6, -0.7],
    }));
    expect(d.strategy).not.toBe('share');
    expect(d.strategy).toBe('redirect');   // Rule 2 赢
  });

  it('`actionFor`：缺省按 kind，实例可覆盖（同一个记忆可以 share / ask / wait）', () => {
    expect(actionFor('memory_echo')).toBe('share');
    expect(actionFor('open_loop')).toBe('ask');
    expect(actionFor('curiosity')).toBe('ask');
    expect(actionFor('wish')).toBe('share');
    // 实例级覆盖 —— 这正是"同一个记忆三种走法"要留的口子
    expect(actionFor('memory_echo', 'ask')).toBe('ask');
    expect(actionFor('memory_echo', 'wait')).toBe('wait');
  });
});
