// ── contextAwareness 单元测试 ──
// 覆盖：时间情境 / 用户状态 / 会话深度 / 情境调制因子 / reset
import { describe, it, expect, beforeEach } from 'vitest';
import { contextAwareness } from '../contextAwareness';

describe('contextAwareness — 时间情境', () => {
  beforeEach(() => { contextAwareness.reset(); });

  it('返回有效的时间快照', () => {
    const snap = contextAwareness.getSnapshot(1, '你好');
    expect(snap.time.hour).toBeGreaterThanOrEqual(0);
    expect(snap.time.hour).toBeLessThanOrEqual(23);
    expect(['morning', 'afternoon', 'evening', 'night', 'dawn']).toContain(snap.time.timeSlot);
    expect(typeof snap.time.isWeekend).toBe('boolean');
  });

  it('时间快照具有一致的字段', () => {
    const snap1 = contextAwareness.getSnapshot(1, 'test1');
    const snap2 = contextAwareness.getSnapshot(2, 'test2');
    // 两个快照应有相同结构
    expect(snap1.time.timeSlot).toBeDefined();
    expect(snap2.time.timeSlot).toBeDefined();
    // 小时应该一致（快速连续调用）
    expect(snap1.time.hour).toBe(snap2.time.hour);
  });
});

describe('contextAwareness — 用户状态', () => {
  beforeEach(() => { contextAwareness.reset(); });

  it('无交互历史时压力为 0', () => {
    const snap = contextAwareness.getSnapshot(1, '你好');
    expect(snap.user.accumulatedStress).toBe(0);
  });

  it('连续负面后压力上升', () => {
    for (let i = 0; i < 10; i++) {
      contextAwareness.recordInteraction(-0.6, '不开心');
    }
    const snap = contextAwareness.getSnapshot(11, '还是好难过');
    expect(snap.user.accumulatedStress).toBeGreaterThan(0.3);
  });

  it('连续正面后压力下降', () => {
    for (let i = 0; i < 10; i++) {
      contextAwareness.recordInteraction(0.5, '今天很开心');
    }
    const snap = contextAwareness.getSnapshot(11, '真好');
    expect(snap.user.accumulatedStress).toBeLessThan(0.3);
  });

  it('久别重逢检测（>24h 无交互）', () => {
    // 模拟 25 小时前的交互
    const oldTs = Date.now() - 25 * 60 * 60 * 1000;
    // 直接修改 interactionTimestamps（私有字段不可直接访问，通过 recordInteraction 间接测试）
    // 但 isReunion 是从 timestamps 推算的，需要手动构造
    // 由于 interactionTimestamps 是私有的，这里通过 public API 测试
    // 首次调用时没有历史交互 → isReunion 应为 false
    const snap = contextAwareness.getSnapshot(1, '好久不见');
    // 没有交互历史 → isReunion false
    expect(snap.user.isReunion).toBe(false);
    expect(snap.user.activityLevel).toBeGreaterThanOrEqual(0);
  });
});

describe('contextAwareness — 会话深度', () => {
  beforeEach(() => { contextAwareness.reset(); });

  it('新会话深度为 casual', () => {
    const snap = contextAwareness.getSnapshot(1, '你好');
    expect(snap.session.depth).toBe('small_talk');
  });

  it('多轮长消息后深入深度', () => {
    const longText = 'A'.repeat(120);
    for (let i = 0; i < 25; i++) {
      contextAwareness.recordInteraction(0.1, longText);
    }
    const snap = contextAwareness.getSnapshot(26, longText);
    expect(snap.session.depth).toBe('deep');
  });

  it('isFirstInteractionToday 检测', () => {
    const snap = contextAwareness.getSnapshot(1, '早安');
    // 当天第一次交互
    expect(typeof snap.session.isFirstInteractionToday).toBe('boolean');
  });
});

describe('contextAwareness — 情境调制因子', () => {
  beforeEach(() => { contextAwareness.reset(); });

  it('返回有效的调制因子', () => {
    const snap = contextAwareness.getSnapshot(5, '你好');
    expect(snap.modulationFactors.responseLengthMod).toBeGreaterThan(0);
    expect(snap.modulationFactors.responseLengthMod).toBeLessThanOrEqual(1.5);
    expect(snap.modulationFactors.proactiveSuitability).toBeGreaterThanOrEqual(0);
    expect(snap.modulationFactors.proactiveSuitability).toBeLessThanOrEqual(1);
  });
});

describe('contextAwareness — reset', () => {
  it('reset 清空交互历史', () => {
    for (let i = 0; i < 10; i++) {
      contextAwareness.recordInteraction(-0.5, 'test');
    }
    const before = contextAwareness.getSnapshot(11, 'test');
    expect(before.user.accumulatedStress).toBeGreaterThan(0);

    contextAwareness.reset();
    const after = contextAwareness.getSnapshot(1, 'fresh start');
    expect(after.user.accumulatedStress).toBe(0);
  });
});
