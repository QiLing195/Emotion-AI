// ── v1.43 服务端时间衰减：接线回归测试 ──
//
// 背景（v1.41 探针挖出的既有 bug）：`processTimeDecay` 只能经 `StateDecayed` 事件到达，
// 而那个事件**只有前端 store 在发** ⇒ 服务端从不衰减。实测（真管道、同一句话、只改空档）：
//   空闲 0.5 / 30 / 96 / 168 小时的 sad = 0.172 / 0.157 / 0.157 / 0.157 —— **一周与一天一模一样**。
// v1.43 把衰减接在 `aiCoordinator` 阶段 0（施加本轮刺激之前），`DISABLE_SERVER_DECAY=true` 可回退。
//
// 本文件锁的不是"调用了 processTimeDecay"（那种测试挡不住接线漏掉），而是**行为**：
// 同一个她、同一个空档，开关一开一关，结果必须不同 —— 而且差异只能来自时间。
// 用**同一空档的两臂对照**（而不是"12h vs 168h"）来隔离：那样重逢/孤独那些通道两边都一样，
// 剩下的差就只可能是衰减（本项目栽过太多次"把另一个通道的效果算到这条通路上"）。

import { describe, it, expect, afterEach } from 'vitest';
import { aiCoordinator } from '../aiCoordinator';
import { INITIAL_EMOTION_STATE } from '../../../src/lib/emotionEngine';
import { serverDecayDisabled } from '../../../src/lib/emotionTimeDecay';
import type { EmotionState } from '../../../src/lib/emotionTypes';

const HOUR = 3_600_000;
const BASE_SAD = 0;   // INITIAL_EMOTION_STATE.emotions.sad

const orig = process.env.DISABLE_SERVER_DECAY;
afterEach(() => {
  if (orig === undefined) delete process.env.DISABLE_SERVER_DECAY;
  else process.env.DISABLE_SERVER_DECAY = orig;
});

/** 静息 + sad 0.20（比"她真的沉进去了"的门限 0.12 高，也高于退出死区 0.05） */
function sunkState(opts: { low?: boolean } = {}): EmotionState {
  const s = structuredClone(INITIAL_EMOTION_STATE) as EmotionState & { lowPeriod?: Record<string, unknown> };
  s.emotions = { ...(s.baselineEmotions ?? INITIAL_EMOTION_STATE.emotions), sad: BASE_SAD + 0.20 };
  if (opts.low) {
    const now = Date.now();
    s.lowPeriod = {
      since: now - 30 * HOUR, lastEvaluatedAt: now,
      peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0, turns: 6, selfRecovery: 0,
    };
  }
  return s;
}

function run(state: EmotionState, gapH: number | null) {
  return aiCoordinator.processTurn({
    userText: '嗯',
    currentEmotionState: state,
    emotionEvent: null,
    userAnalysis: null,
    lastInteractionAt: gapH === null ? undefined : Date.now() - gapH * HOUR,
    roundNumber: 1,
  } as never);
}

describe('v1.43 服务端时间衰减', () => {
  it('开关默认不关：同一个空档，开/关两臂的 sad 必须不同（差异只能来自时间）', () => {
    delete process.env.DISABLE_SERVER_DECAY;
    expect(serverDecayDisabled()).toBe(false);
    const decayed = run(sunkState(), 20).updatedEmotionState.emotions.sad as number;

    process.env.DISABLE_SERVER_DECAY = 'true';
    expect(serverDecayDisabled()).toBe(true);
    const raw = run(sunkState(), 20).updatedEmotionState.emotions.sad as number;

    // 20h、sad 半衰期 6h ⇒ 衰减后只剩 ~0.20 × 2^(-20/6) ≈ 0.020
    expect(decayed, `衰减后 ${decayed} vs 不衰减 ${raw}`).toBeLessThan(0.06);
    expect(raw).toBeGreaterThan(0.15);                       // 复现 v1.41 的观测（那一跑 168h 是 0.157）
    expect(decayed).toBeLessThan(raw);
  });

  it('回归静息基线，而不是衰减到 0（v1.24 的语义：回到她平常的样子）', () => {
    delete process.env.DISABLE_SERVER_DECAY;
    const out = run(sunkState(), 20).updatedEmotionState;
    const base = out.baselineEmotions ?? INITIAL_EMOTION_STATE.emotions;
    // sad 回落到基线附近；calm 这类"没被激起的"基调不该被顺手削平
    expect(Math.abs((out.emotions.sad as number) - ((base.sad as number) ?? 0))).toBeLessThan(0.06);
    expect(out.emotions.calm as number).toBeGreaterThan(0.7);
  });

  it('不传 lastInteractionAt ⇒ 不衰减（这是"时间"通路，不许被"这一轮"触发）', () => {
    delete process.env.DISABLE_SERVER_DECAY;
    const sad = run(sunkState(), null).updatedEmotionState.emotions.sad as number;
    expect(sad).toBeGreaterThan(0.15);
  });

  it('极端空档（一周）与一天**必须不一样** —— 这正是 v1.41 证伪的那条', () => {
    delete process.env.DISABLE_SERVER_DECAY;
    const oneDay = run(sunkState(), 24).updatedEmotionState.emotions.sad as number;
    const oneWeek = run(sunkState(), 168).updatedEmotionState.emotions.sad as number;
    expect(oneWeek).toBeLessThanOrEqual(oneDay);
    // 旧行为下两者都是 0.157；现在 24h 与 168h 都该落到基线附近，但至少不能再"一模一样地停在高位"
    expect(oneWeek).toBeLessThan(0.06);
  });

  it('低谷被时间带走时，结案理由记 idle（不许读成"她自己调过来了"）', () => {
    delete process.env.DISABLE_SERVER_DECAY;
    const closed = run(sunkState({ low: true }), 168).updatedEmotionState;
    const ep = (closed.lowPeriod as never as { lastEpisode?: { closedBy?: string } } | undefined)?.lastEpisode;
    expect(ep?.closedBy).toBe('idle');

    // 短空档：她还没被时间带走 ⇒ 低谷照旧开着，且结不了案
    const still = run(sunkState({ low: true }), 0.5).updatedEmotionState;
    const lp = still.lowPeriod as never as { since: number | null };
    expect(lp.since).not.toBeNull();
  });

  it('关掉之后连"低谷不会被时间结案"也回到旧行为（回退是真的回退）', () => {
    process.env.DISABLE_SERVER_DECAY = 'true';
    const out = run(sunkState({ low: true }), 168).updatedEmotionState;
    const lp = out.lowPeriod as never as { since: number | null; lastEpisode?: { closedBy?: string } };
    expect(lp.since, '关掉衰减后低谷不该被时间结案').not.toBeNull();
    expect(lp.lastEpisode?.closedBy).toBeUndefined();
  });

  it('开关只认字面 true（与其余回退开关同一套约定）', () => {
    process.env.DISABLE_SERVER_DECAY = '1';
    expect(serverDecayDisabled()).toBe(false);
    process.env.DISABLE_SERVER_DECAY = 'TRUE';
    expect(serverDecayDisabled()).toBe(false);
    process.env.DISABLE_SERVER_DECAY = 'true';
    expect(serverDecayDisabled()).toBe(true);
  });
});
