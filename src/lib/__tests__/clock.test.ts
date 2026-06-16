// ── clock 模块测试 ──

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clock } from '../clock';

beforeEach(() => { clock.reset(); });
afterEach(() => { clock.reset(); });

describe('clock', () => {
  describe('now()', () => {
    it('返回当前时间戳', () => {
      const t = clock.now();
      expect(t).toBeGreaterThan(1_700_000_000_000);
      expect(t).toBeLessThan(Date.now() + 1000);
    });

    it('mock 模式下返回注入值', () => {
      clock.setMockTime(1000000);
      expect(clock.now()).toBe(1000000);
    });

    it('advanceTime 快进 mock 时间', () => {
      clock.setMockTime(1000000);
      clock.advanceTime(5000);
      expect(clock.now()).toBe(1005000);
    });
  });

  describe('timeSlot()', () => {
    it('5:00-7:59 → dawn', () => {
      const d = new Date('2026-06-12T06:00:00');
      clock.setMockTime(d.getTime());
      expect(clock.timeSlot()).toBe('dawn');
    });

    it('8:00-11:59 → morning', () => {
      clock.setMockTime(new Date('2026-06-12T09:00:00').getTime());
      expect(clock.timeSlot()).toBe('morning');
    });

    it('12:00-17:59 → afternoon', () => {
      clock.setMockTime(new Date('2026-06-12T15:00:00').getTime());
      expect(clock.timeSlot()).toBe('afternoon');
    });

    it('18:00-22:59 → evening', () => {
      clock.setMockTime(new Date('2026-06-12T20:00:00').getTime());
      expect(clock.timeSlot()).toBe('evening');
    });

    it('23:00-4:59 → night', () => {
      clock.setMockTime(new Date('2026-06-12T02:00:00').getTime());
      expect(clock.timeSlot()).toBe('night');
    });
  });

  describe('todayKey()', () => {
    it('返回 YYYY-MM-DD 格式', () => {
      clock.setMockTime(new Date('2026-06-12T10:00:00').getTime());
      expect(clock.todayKey()).toBe('2026-06-12');
    });
  });

  describe('elapsedMs()', () => {
    it('计算从指定时间到现在的毫秒数', () => {
      clock.setMockTime(10000);
      expect(clock.elapsedMs(5000)).toBe(5000);
    });
  });

  describe('elapsedMinutes()', () => {
    it('正确转换为分钟', () => {
      clock.setMockTime(120000); // 2 minutes since epoch
      expect(clock.elapsedMinutes(0)).toBe(2);
    });
  });

  describe('elapsedHours()', () => {
    it('正确转换为小时', () => {
      clock.setMockTime(3_600_000);
      expect(clock.elapsedHours(0)).toBe(1);
      expect(clock.elapsedHours(1_800_000)).toBe(0.5);
    });
  });

  describe('elapsedDays()', () => {
    it('正确转换为天数', () => {
      clock.setMockTime(86_400_000);
      expect(clock.elapsedDays(0)).toBe(1);
    });
  });

  describe('snapshot()', () => {
    it('返回完整快照', () => {
      clock.setMockTime(new Date('2026-06-12T15:30:00').getTime());
      const snap = clock.snapshot();
      expect(snap.hour).toBe(15);
      expect(snap.dayOfWeek).toBe(5); // Friday
      expect(snap.timeSlot).toBe('afternoon');
      expect(snap.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(snap.tickCount).toBe(0);
    });
  });

  describe('isMocked()', () => {
    it('mock 模式下返回 true', () => {
      clock.setMockTime(1000);
      expect(clock.isMocked()).toBe(true);
    });

    it('真实模式下返回 false', () => {
      expect(clock.isMocked()).toBe(false);
    });
  });

  describe('reset()', () => {
    it('重置后回到真实时间', () => {
      clock.setMockTime(1000);
      clock.reset();
      expect(clock.isMocked()).toBe(false);
      expect(clock.now()).toBeGreaterThan(1_700_000_000_000);
    });
  });

  describe('tick()', () => {
    it('递增计数', () => {
      expect(clock.tick()).toBe(1);
      expect(clock.tick()).toBe(2);
      const snap = clock.snapshot();
      expect(snap.tickCount).toBe(2);
    });
  });
});
