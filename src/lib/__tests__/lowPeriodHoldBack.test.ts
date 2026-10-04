// ── v1.39 她自己在低谷 → 走让位路（开关，默认关）──
//
// 与 v1.28/v1.31 那条让位路**判据不同**，别混：
//   · 那条：他这句话很强 **且** 她本来也沉（**由他触发**）；
//   · 这条：**只看她自己在不在低谷**，与他这句话强弱无关（**由她触发**）。
//
// 复用同一条通路是因为"她今天没力气接话"与"她今天先不说自己的事"在**表达层**是同一件事：
// 本轮别在 Prompt 里塞一件"关于他的待办"。v1.30 已裁定该路走 `omit`（整块不给）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  selectMotive, shouldHoldBackForLowPeriod, lowPeriodHoldBackEnabled, lowPeriodHoldBackGate,
  shouldDeferToUser, type SelectMotiveInput,
} from '../motive';

const KEYS = ['ENABLE_LOW_PERIOD_HOLD_BACK', 'LOW_PERIOD_HOLD_BACK_GATE'] as const;
const original = Object.fromEntries(KEYS.map(k => [k, process.env[k]])) as Record<string, string | undefined>;
afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

/** 静息（她没沉） */
const RESTING = { emotion: 'neutral', intensity: 0 };
/** 越过进入门槛 0.12 ⇒ "她真的沉进去了" */
const SINKING = { emotion: 'sad', intensity: 0.20 };

/** 一条"关于他、且本会被追问"的动机（open_loop 先验 0.80 > 门槛 0.28） */
const openLoop = () => ({
  id: 'm-open-loop', kind: 'open_loop' as const, content: '他面试那事有消息了吗',
  source: {}, salience: 0.8, formedAt: 0, expiresAt: 9_999_999_999, attempts: 0,
});

function run(over: Partial<SelectMotiveInput> = {}) {
  return selectMotive({
    state: { pool: [openLoop()] },
    candidates: [],
    userText: '嗯',
    herNegativeBeforeTurn: RESTING,
    userIntensity: 0.1,          // ⚠️ 刻意**很弱**：这条路上让位与"他这句话强不强"无关
    now: 1_000_000,
    ...over,
  });
}

describe('v1.39 低谷期收住（复用让位通路）', () => {
  it('开关默认关；只认字面 true', () => {
    expect(lowPeriodHoldBackEnabled()).toBe(false);
    expect(shouldHoldBackForLowPeriod({ active: true, established: true })).toBe(false);
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = '1';
    expect(lowPeriodHoldBackEnabled()).toBe(false);
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    expect(lowPeriodHoldBackEnabled()).toBe(true);
  });

  it('闸门默认 `period`（整段）：只有"已成段"才算，光"此刻沉"不算', () => {
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    expect(lowPeriodHoldBackGate()).toBe('period');
    expect(shouldHoldBackForLowPeriod({ active: true, established: true })).toBe(true);
    expect(shouldHoldBackForLowPeriod({ active: true, established: false })).toBe(false);
    expect(shouldHoldBackForLowPeriod({ active: false, established: false })).toBe(false);
    expect(shouldHoldBackForLowPeriod(null)).toBe(false);
    expect(shouldHoldBackForLowPeriod(undefined)).toBe(false);
  });

  it('闸门 `turn`（逐轮）：这一次落定沉就够了', () => {
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    process.env.LOW_PERIOD_HOLD_BACK_GATE = 'turn';
    expect(lowPeriodHoldBackGate()).toBe('turn');
    expect(shouldHoldBackForLowPeriod({ active: true, established: false })).toBe(true);
    expect(shouldHoldBackForLowPeriod({ active: false, established: false })).toBe(false);
    // 拼错的闸门名一律回落到 period（一个拼错的旋钮不该悄悄改变她的行为）
    process.env.LOW_PERIOD_HOLD_BACK_GATE = 'peroid';
    expect(lowPeriodHoldBackGate()).toBe('period');
  });

  it('不传 `herLowPeriod` = 旧行为（开关开着也没用）', () => {
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    expect(run().selected).not.toBeNull();
  });

  it('这条路的**独立性**：他这句话很弱（0.1）也照样收住 —— 而旧让位路此时不成立', () => {
    // 旧路：他 0.1、她沉 ⇒ 不让位（门槛要 0.4/0.6）
    expect(shouldDeferToUser(SINKING, 0.1)).toBe(false);
    expect(run({ herNegativeBeforeTurn: SINKING, userIntensity: 0.1 }).selected).not.toBeNull();

    // 新路：开关开 + 已成段 ⇒ 收住，且**与他这句话强弱无关**
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    const out = run({ herLowPeriod: { active: true, established: true } });
    expect(out.selected).toBeNull();
    expect(out.deferredToUser).toBe(true);
    expect(out.nextState.lastSelection?.reason).toContain('低谷');
  });

  it('开关关 / 未成段 / 不在低谷 ⇒ 一律照旧（本轮会照常追问）', () => {
    const notEstablished = { active: true, established: false };
    // 开关关
    expect(run({ herLowPeriod: { active: true, established: true } }).selected).not.toBeNull();
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    expect(run({ herLowPeriod: notEstablished }).selected).not.toBeNull();
    expect(run({ herLowPeriod: { active: false, established: false } }).selected).not.toBeNull();
    // 逐轮闸门下同一条样例会收住 —— 证明上面不是"因为状态没传进去"
    process.env.LOW_PERIOD_HOLD_BACK_GATE = 'turn';
    expect(run({ herLowPeriod: notEstablished }).selected).toBeNull();
  });

  it('两条让位路的**理由必须分得开**（操纵检查靠它）', () => {
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    // 只由她触发
    const her = run({ herLowPeriod: { active: true, established: true } });
    expect(her.nextState.lastSelection?.reason).toContain('低谷');
    // 只由他触发（她本来沉 + 他很强）→ 走旧理由
    const him = run({ herNegativeBeforeTurn: SINKING, userIntensity: 0.8 });
    expect(him.nextState.lastSelection?.reason).toContain('先接住他');
    expect(him.nextState.lastSelection?.reason).not.toContain('低谷');
  });
});
