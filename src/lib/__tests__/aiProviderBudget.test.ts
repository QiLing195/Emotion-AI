import { describe, it, expect } from 'vitest';
import { retryAsync } from '../aiProvider.js';
import { GenerationBudget, GenerationBudgetExceededError } from '../generationBudget.js';

describe('v2.16 retryAsync + GenerationBudget', () => {
  it('可重试错误在预算内会重试，第二次成功', async () => {
    const budget = new GenerationBudget({ totalMs: 10_000, callMs: 5_000 });
    let attempts = 0;
    const value = await retryAsync(async () => {
      attempts++;
      if (attempts === 1) throw new Error('network wobble');
      return 'ok';
    }, 3, 1, budget);
    expect(value).toBe('ok');
    expect(attempts).toBe(2);
    expect(budget.calls).toBe(2);
    expect(budget.timeouts).toBe(0);
  });

  it('预算耗尽后不再重试（即使错误可重试）', async () => {
    let t = 0;
    const budget = new GenerationBudget({ totalMs: 2_000, callMs: 2_000, now: () => t });
    let attempts = 0;
    await expect(retryAsync(async () => {
      attempts++;
      t += 3_000; // 第一次就把预算耗光
      throw new Error('network wobble');
    }, 3, 1, budget)).rejects.toThrow('network wobble');
    expect(attempts).toBe(1);
    expect(budget.expired()).toBe(true);
  });

  it('单次调用超时按 deadline 抛 GenerationBudgetExceededError，并记 timeouts', async () => {
    const budget = new GenerationBudget({ totalMs: 5_000, callMs: 30, now: () => 0 });
    await expect(retryAsync(() => new Promise(() => {}), 3, 1, budget))
      .rejects.toBeInstanceOf(GenerationBudgetExceededError);
    expect(budget.calls).toBe(1);
    expect(budget.timeouts).toBe(1);
  });

  it('超时会真正 abort signal（v2.17：不是只让等待方返回）', async () => {
    const budget = new GenerationBudget({ totalMs: 5_000, callMs: 40 });
    let seen: AbortSignal | undefined;
    await expect(retryAsync((signal) => {
      seen = signal;
      return new Promise(() => {});
    }, 0, 1, budget)).rejects.toBeInstanceOf(GenerationBudgetExceededError);
    expect(seen?.aborted).toBe(true);
  });

  it('不可重试错误（4xx 非 429）立即抛出，不浪费预算', async () => {
    const budget = new GenerationBudget({ totalMs: 5_000, callMs: 2_000 });
    let attempts = 0;
    const err: any = new Error('bad request');
    err.status = 400;
    await expect(retryAsync(async () => { attempts++; throw err; }, 3, 1, budget)).rejects.toThrow('bad request');
    expect(attempts).toBe(1);
  });
});
