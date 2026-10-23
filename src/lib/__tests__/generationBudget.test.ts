import { describe, it, expect } from 'vitest';
import {
  GenerationBudget,
  GenerationBudgetExceededError,
  singleCallBudget,
  raceWithDeadline,
} from '../generationBudget.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

describe('v2.16 单轮生成预算', () => {
  it('默认值：总预算 25s，单次 15s', () => {
    const b = new GenerationBudget({ env: {} as NodeJS.ProcessEnv, now: () => 0 });
    expect(b.totalMs).toBe(25_000);
    expect(b.callMs).toBe(15_000);
    expect(b.expired()).toBe(false);
  });

  it('环境变量可覆盖并夹取范围', () => {
    const b = new GenerationBudget({
      env: { TURN_GEN_BUDGET_MS: '9000', GEN_CALL_TIMEOUT_MS: '4000' } as unknown as NodeJS.ProcessEnv,
      now: () => 0,
    });
    expect(b.totalMs).toBe(9000);
    expect(b.callMs).toBe(4000);

    const tooSmall = new GenerationBudget({ env: { TURN_GEN_BUDGET_MS: '1' } as unknown as NodeJS.ProcessEnv, now: () => 0 });
    expect(tooSmall.totalMs).toBe(1_000); // 下限
    const tooBig = new GenerationBudget({ env: { TURN_GEN_BUDGET_MS: '999999' } as unknown as NodeJS.ProcessEnv, now: () => 0 });
    expect(tooBig.totalMs).toBe(180_000); // 上限
  });

  it('remaining / timeoutForCall：取单次上限与剩余时间的较小值', () => {
    const clock = fakeClock();
    const b = new GenerationBudget({ totalMs: 10_000, callMs: 4_000, now: clock.now });
    expect(b.remainingMs()).toBe(10_000);
    expect(b.timeoutForCall()).toBe(4_000);
    clock.advance(8_000);
    expect(b.timeoutForCall()).toBe(2_000);
    clock.advance(3_000);
    expect(b.expired()).toBe(true);
    expect(b.timeoutForCall()).toBe(0);
  });

  it('预算耗尽后 beginCall 直接抛错（不发起新调用）', () => {
    const clock = fakeClock();
    const b = new GenerationBudget({ totalMs: 2_000, callMs: 2_000, now: clock.now });
    expect(b.beginCall()).toBe(2_000);
    clock.advance(2_500);
    expect(() => b.beginCall()).toThrow(GenerationBudgetExceededError);
    expect(b.calls).toBe(1);
  });

  it('raceWithDeadline：快任务正常返回，慢任务按 deadline 抛 GenerationBudgetExceededError', async () => {
    await expect(raceWithDeadline(Promise.resolve('ok'), 100)).resolves.toBe('ok');
    await expect(raceWithDeadline(new Promise(res => setTimeout(res, 50)), 500)).resolves.toBeUndefined();
    await expect(raceWithDeadline(new Promise(() => {}), 20, 'slow')).rejects.toBeInstanceOf(GenerationBudgetExceededError);
  });

  it('snapshot 记录调用次数/超时次数/剩余时间', () => {
    const clock = fakeClock();
    const b = new GenerationBudget({ totalMs: 5_000, callMs: 1_000, now: clock.now });
    b.beginCall();
    b.noteTimeout();
    clock.advance(1_200);
    const s = b.snapshot();
    expect(s.calls).toBe(1);
    expect(s.timeouts).toBe(1);
    expect(s.elapsedMs).toBe(1_200);
    expect(s.remainingMs).toBe(3_800);
    expect(s.expired).toBe(false);
  });

  it('旁路单次预算：总预算 = 单次上限（重试不会叠成无限等）', () => {
    const b = singleCallBudget({ GEN_CALL_TIMEOUT_MS: '3000' } as unknown as NodeJS.ProcessEnv);
    expect(b.totalMs).toBe(3_000);
    expect(b.callMs).toBe(3_000);
    expect(b.timeoutForCall()).toBe(3_000);
  });
});
