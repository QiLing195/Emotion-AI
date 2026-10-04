// ── v1.40 她自己在低谷 → 主动消息更矜持（开关，默认关）──
//
// 裁定原话：她低谷"自闭"时**自己给自己打气、自己调整自己；主动性降低、但不是没有**。
// 所以这一版的杠杆是**把打扰推后**（空闲 120 → 240 分钟），**不是**抬动机紧迫度门槛 ——
// 后者在主动这条路上物理上做不到"降低但不是没有"，理由见下面那条测试（可达带只有 0.07 宽）。
//
// 最后一条测试是裁定的**可执行版本**：在低谷 + 开关打开时，等到 240 分钟，她**照样会发**。

import { describe, it, expect, afterEach } from 'vitest';
import {
  evaluateProactiveGates, requiredProactiveIdleMinutes, lowPeriodProactiveHoldEnabled,
  requiredMotiveSalience, passesMotiveThreshold, PROACTIVE_MIN_IDLE_MINUTES,
  LOW_PERIOD_PROACTIVE_IDLE_MINUTES, requiredProactiveDailyCap, LOW_PERIOD_PROACTIVE_DAILY_CAP,
} from '../proactiveMessenger';
import { MOTIVE_BASE_SALIENCE } from '../../../src/lib/motive';
import type { Motive } from '../../../src/lib/emotionTypes';

const KEY = 'DISABLE_LOW_PERIOD_PROACTIVE_HOLD';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

const base = { enabled: true, quotaAllowed: true, relationshipStage: 'close', proactiveThreshold: 65 };

describe('v1.40 低谷期主动消息更矜持', () => {
  it('**已上线：默认开**（两跑真管道达标）；回退开关只认字面 true', () => {
    expect(lowPeriodProactiveHoldEnabled()).toBe(true);      // 不设任何 env
    expect(requiredProactiveIdleMinutes(true)).toBe(LOW_PERIOD_PROACTIVE_IDLE_MINUTES);
    expect(requiredProactiveIdleMinutes()).toBe(PROACTIVE_MIN_IDLE_MINUTES);   // 不在低谷照旧
    process.env[KEY] = '1';
    expect(lowPeriodProactiveHoldEnabled()).toBe(true);      // 只认字面 'true'
    process.env[KEY] = 'true';
    expect(lowPeriodProactiveHoldEnabled()).toBe(false);
    expect(requiredProactiveIdleMinutes(true)).toBe(PROACTIVE_MIN_IDLE_MINUTES);   // 真回退
  });

  it('低谷 + 上线：150 分钟还不够（推后），但**不是关掉** —— 240 分钟就放行', () => {
    const at150 = evaluateProactiveGates({ ...base, idleMinutes: 150, inLowPeriod: true });
    expect(at150.allowed).toBe(false);
    expect(at150.reason).toContain('240');
    const at240 = evaluateProactiveGates({ ...base, idleMinutes: 240, inLowPeriod: true });
    expect(at240.allowed).toBe(true);                     // ← "不是没有"
    // 平常期不受影响
    expect(evaluateProactiveGates({ ...base, idleMinutes: 150, inLowPeriod: false }).allowed).toBe(true);
    expect(evaluateProactiveGates({ ...base, idleMinutes: 150 }).allowed).toBe(true);  // 不传 = 她不在低谷
  });

  /**
   * ⚠️ 这条是**量出来的事实**，也是把第一版设计否掉的依据：
   * 主动这条路上 `userText` 是空的 ⇒ `motiveRelevance('')` ≈0.73，
   * 于是可达的紧迫度上限只有 `open_loop` 0.80 × 0.73 ≈ 0.58，而默认门槛已经 0.505
   * —— 整条可达带只有 ~0.07 宽（实测：种进去 0.80 的 open_loop，算出来 0.57）。
   * 在这个带宽上抬门槛 ⇒ 上限够不着 ⇒ 那是"关掉"，不是"降低"。
   */
  it('为什么不用"抬门槛"：可达带太窄（实测口径），抬一档就等于关掉', () => {
    const maxBase = Math.max(...Object.values(MOTIVE_BASE_SALIENCE));
    const attainableCeiling = maxBase * 0.73;              // 空 userText 下的相关度
    const defaultGate = requiredMotiveSalience(65);        // 0.505
    expect(attainableCeiling).toBeGreaterThan(defaultGate);
    expect(attainableCeiling - defaultGate).toBeLessThan(0.1);   // 带宽不到 0.1
    // 抬 +0.15 ⇒ 门槛 0.655 > 可达上限 ⇒ 永远发不出（所以这条杠杆被弃用）
    expect(defaultGate + 0.15).toBeGreaterThan(attainableCeiling);
    // 而"空闲推后"这一条不碰这个带宽：门槛照旧，只是等更久
    expect(passesMotiveThreshold(
      { id: 'm', kind: 'open_loop', content: '他面试那事有结果了吗', source: {}, salience: 0.57,
        formedAt: 0, expiresAt: 9e12, attempts: 0 } as Motive, 65).ok).toBe(true);
  });

  it('心里没有挂着的事 ⇒ 两种状态下都不打扰（与低谷无关）', () => {
    expect(passesMotiveThreshold(null, 65).ok).toBe(false);
  });
});

/**
 * v1.44：「推后」只改"最早能发的时刻"，**一天能发的条数根本没变**（配额 2/日 + 最小间隔 2h）。
 * 对一个"一整天在低谷"的她，那几乎等于没改。这一版把日上限也收住：低谷时 **2 → 1**。
 * 按裁定"降低但不是没有"，底线必须是：**当天第一条照发**，只是不再有第二条。
 */
describe('v1.44 低谷期每日上限 2→1', () => {
  it('低谷 + 上线：今天已发过 1 条 ⇒ 不再打扰；**第 0 条照样发**（降低但不是没有）', () => {
    const first = evaluateProactiveGates({ ...base, idleMinutes: 300, inLowPeriod: true, sentToday: 0 });
    expect(first.allowed).toBe(true);                       // ← "不是没有"
    const second = evaluateProactiveGates({ ...base, idleMinutes: 300, inLowPeriod: true, sentToday: 1 });
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain('低谷');
    expect(second.reason).toContain('1/1');
    expect(second.reason).toContain('不是没有');
  });

  it('静息期不受影响：发过 1 条仍然放行（配额 2 是 rhythmController 的事）', () => {
    expect(evaluateProactiveGates({ ...base, idleMinutes: 300, inLowPeriod: false, sentToday: 1 }).allowed).toBe(true);
    // 回退开关打开时，低谷也照旧
    process.env[KEY] = 'true';
    expect(evaluateProactiveGates({ ...base, idleMinutes: 300, inLowPeriod: true, sentToday: 1 }).allowed).toBe(true);
    // 不传 sentToday = 这条判据不参与（旧调用点行为不变）
    delete process.env[KEY];
    expect(evaluateProactiveGates({ ...base, idleMinutes: 300, inLowPeriod: true }).allowed).toBe(true);
  });

  it('低谷 + 上线：日上限是 1，而空闲要求仍是 240（两条杠杆互不覆盖）', () => {
    expect(requiredProactiveDailyCap(true)).toBe(LOW_PERIOD_PROACTIVE_DAILY_CAP);
    expect(requiredProactiveDailyCap(false)).toBeNull();
    process.env[KEY] = 'true';
    expect(requiredProactiveDailyCap(true)).toBeNull();
    // 空闲要求与配额是**两个**闸门：idle 不够时先报 idle
    delete process.env[KEY];
    const tooEarly = evaluateProactiveGates({ ...base, idleMinutes: 150, inLowPeriod: true, sentToday: 0 });
    expect(tooEarly.allowed).toBe(false);
    expect(tooEarly.reason).toContain('240');
  });
});
