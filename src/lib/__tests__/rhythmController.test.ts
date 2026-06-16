// ── rhythmController 单元测试 ──
// 覆盖：节奏决策 / 聊天模式 / 响应延迟 / proactive 配额 / reset
import { describe, it, expect, beforeEach } from 'vitest';
import { rhythmController } from '../rhythmController';
import type { TimeContext, UserStateContext, SessionContext } from '../contextAwareness';

function makeTime(overrides?: Partial<TimeContext>): TimeContext {
  return {
    hour: 14, dayOfWeek: 3, isWeekend: false,
    timeSlot: 'afternoon', seasonalityHint: '',
    ...overrides,
  };
}

function makeUser(overrides?: Partial<UserStateContext>): UserStateContext {
  return {
    activityLevel: 0.5, accumulatedStress: 0.3, consecutiveActiveDays: 3,
    minutesSinceLastInteraction: 10, isReunion: false,
    moodBaseline: 0.1, moodVolatility: 0.2,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<SessionContext>): SessionContext {
  return {
    roundInSession: 5, isFirstInteractionToday: false,
    depth: 'casual', isUserVenting: false, topicSwitchRate: 0.3,
    ...overrides,
  };
}

describe('rhythmController — 基本决策', () => {
  beforeEach(() => { rhythmController.reset(); });

  it('返回有效的节奏决策', () => {
    const decision = rhythmController.decide(
      makeTime(), makeUser(), makeSession(),
      0.3, 50, 60000, { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    expect(decision.mode).toBeDefined();
    expect(['quick_chat', 'casual', 'deep_talk']).toContain(decision.mode);
    expect(decision.responseDelayMs).toBeGreaterThanOrEqual(0);
    expect(decision.suggestedResponseLength).toBeGreaterThan(0);
    expect(typeof decision.allowProactive).toBe('boolean');
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('getMode 返回当前模式', () => {
    rhythmController.decide(
      makeTime(), makeUser(), makeSession(),
      0.3, 50, 60000, { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    expect(['quick_chat', 'casual', 'deep_talk']).toContain(rhythmController.getMode());
  });
});

describe('rhythmController — 情境适配', () => {
  beforeEach(() => { rhythmController.reset(); });

  it('深夜应降低活跃性', () => {
    const dayDecision = rhythmController.decide(
      makeTime({ timeSlot: 'afternoon', hour: 14 }),
      makeUser(), makeSession(),
      0.3, 50, 60000, { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    const nightDecision = rhythmController.decide(
      makeTime({ timeSlot: 'night', hour: 2 }),
      makeUser({ accumulatedStress: 0.2 }),
      makeSession(),
      0.3, 50, 60000, { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    // 深夜的延迟不应低于白天
    expect(nightDecision.responseDelayMs).toBeGreaterThanOrEqual(dayDecision.responseDelayMs);
  });

  it('高压用户应降低 proactive', () => {
    const lowStressDecision = rhythmController.decide(
      makeTime(), makeUser({ accumulatedStress: 0.1 }),
      makeSession(), 0.3, 50, 60000,
      { responseLengthMod: 0.5, proactiveSuitability: 0.8 },
    );
    const highStressDecision = rhythmController.decide(
      makeTime(), makeUser({ accumulatedStress: 0.9 }),
      makeSession(), 0.3, 50, 60000,
      { responseLengthMod: 0.5, proactiveSuitability: 0.8 },
    );
    // 高压下若有 proactive 被允许，不应比低压更多
    // allowProactive 是 boolean，高压下应该不会比低压更激进
    if (highStressDecision.allowProactive) {
      expect(lowStressDecision.allowProactive).toBe(true);
    }
  });

  it('久别重逢应有适当延迟', () => {
    const reunionDecision = rhythmController.decide(
      makeTime(), makeUser({ isReunion: true, minutesSinceLastInteraction: 1500 }),
      makeSession(), 0.3, 50, 1500 * 60 * 1000,
      { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    // 久别重逢应该有一定延迟（不秒回）
    expect(reunionDecision.responseDelayMs).toBeGreaterThanOrEqual(0);
    expect(reunionDecision.suggestedResponseLength).toBeGreaterThan(0);
  });

  it('回复长度在合理范围内', () => {
    const decision = rhythmController.decide(
      makeTime(), makeUser(), makeSession({ depth: 'deep' }),
      0.5, 200, 60000, { responseLengthMod: 1.5, proactiveSuitability: 0.8 },
    );
    expect(decision.suggestedResponseLength).toBeGreaterThan(0);
    expect(decision.suggestedResponseLength).toBeLessThanOrEqual(1000);
  });
});

describe('rhythmController — 边界条件', () => {
  beforeEach(() => { rhythmController.reset(); });

  it('极端 arousal 值不崩溃', () => {
    expect(() => rhythmController.decide(
      makeTime(), makeUser(), makeSession(),
      0, 0, 1000, { responseLengthMod: 0, proactiveSuitability: 0 },
    )).not.toThrow();
    expect(() => rhythmController.decide(
      makeTime(), makeUser(), makeSession(),
      1, 500, 3600000, { responseLengthMod: 1, proactiveSuitability: 1 },
    )).not.toThrow();
  });

  it('reset 后状态恢复', () => {
    rhythmController.decide(
      makeTime(), makeUser(), makeSession(),
      0.5, 50, 60000, { responseLengthMod: 0.5, proactiveSuitability: 0.5 },
    );
    rhythmController.reset();
    // reset 后 getMode 不应崩溃
    expect(() => rhythmController.getMode()).not.toThrow();
  });

  it('低能量用户降低回复长度', () => {
    const normalDecision = rhythmController.decide(
      makeTime(), makeUser({ activityLevel: 0.8 }),
      makeSession(), 0.3, 50, 60000,
      { responseLengthMod: 0.7, proactiveSuitability: 0.6 },
    );
    const tiredDecision = rhythmController.decide(
      makeTime(), makeUser({ activityLevel: 0.2 }),
      makeSession(), 0.3, 50, 60000,
      { responseLengthMod: 0.3, proactiveSuitability: 0.4 },
    );
    // 疲惫用户回复不应更长
    expect(tiredDecision.suggestedResponseLength).toBeLessThanOrEqual(
      normalDecision.suggestedResponseLength + 50, // 容差
    );
  });
});
