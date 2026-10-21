import { describe, it, expect } from 'vitest';
import { parseCnTime, toLocalIso } from '../cnTimeParse.js';

// 基准：2026-10-21（周三）23:00 本地
const NOW = new Date(2026, 9, 21, 23, 0, 0, 0).getTime();

describe('相对日：今天/明天/后天', () => {
  it('明天下午三点 → 次日 15:00', () => {
    const r = parseCnTime('明天下午三点提醒我', NOW);
    expect(r).not.toBeNull();
    expect(r!.human).toBe('2026-10-22 15:00');
  });

  it('后天上午 10:30 → 两天后 10:30', () => {
    const r = parseCnTime('后天 10:30 记得', NOW);
    expect(r!.human).toBe('2026-10-23 10:30');
  });

  it('明天（没说时段）→ 默认 10:00', () => {
    const r = parseCnTime('明天问他面试结果', NOW);
    expect(r!.human).toBe('2026-10-22 10:00');
  });
});

describe('星期：下周三 / 周三 / 下下周一', () => {
  it('下周三 → 下周三（+7 天）', () => {
    const r = parseCnTime('下周三我要体检', NOW);
    expect(r!.human).toBe('2026-10-28 10:00');
  });

  it('周五（今天周三）→ 本周五', () => {
    const r = parseCnTime('周五提醒我', NOW);
    expect(r!.human).toBe('2026-10-23 10:00');
  });

  it('周三（今天正好周三）→ 下一个周三（+7 天，不是今天）', () => {
    const r = parseCnTime('周三问他', NOW);
    expect(r!.human).toBe('2026-10-28 10:00');
  });
});

describe('绝对日期：10月28日 / 2026-11-02', () => {
  it('10月28日下午3点 → 10-28 15:00', () => {
    const r = parseCnTime('10月28日下午3点提醒', NOW);
    expect(r!.human).toBe('2026-10-28 15:00');
  });

  it('已过去的日期（没写年份）→ 顺延到明年', () => {
    const r = parseCnTime('3月5日提醒我', NOW);
    expect(r!.human).toBe('2027-03-05 10:00');
  });

  it('2026-11-02 10:00 → 原样', () => {
    const r = parseCnTime('2026-11-02 10:00 提醒', NOW);
    expect(r!.human).toBe('2026-11-02 10:00');
  });
});

describe('只有时段 / 解析不出来', () => {
  it('"下午三点"（已过）→ 明天 15:00', () => {
    const r = parseCnTime('下午三点提醒我', NOW);
    expect(r!.human).toBe('2026-10-22 15:00');
  });

  it('没有时间信息 ⇒ null（不猜）', () => {
    expect(parseCnTime('他不太喜欢吵闹的地方', NOW)).toBeNull();
    expect(parseCnTime('', NOW)).toBeNull();
  });

  it('toLocalIso 输出 set_followup 需要的格式', () => {
    const ts = new Date(2026, 9, 22, 15, 0, 0, 0).getTime();
    expect(toLocalIso(ts)).toBe('2026-10-22T15:00');
  });
});
