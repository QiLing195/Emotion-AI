import { describe, it, expect } from 'vitest';
import { executeStrongConnection } from '../moduleConnections.js';
import { GenerationBudgetExceededError } from '../generationBudget.js';

describe('v2.18 executeStrongConnection：预算错误不被 fallback 吞掉', () => {
  it('预算耗尽：不 fallback、不熔断，原样上抛', async () => {
    const budgetErr = new GenerationBudgetExceededError('no generation budget');
    await expect(
      executeStrongConnection('S4', async () => { throw budgetErr; }, () => 'fallback'),
    ).rejects.toBe(budgetErr);
  });

  it('普通错误：仍走 fallback（旧行为不变）', async () => {
    const value = await executeStrongConnection(
      'S4',
      async () => { throw new Error('network wobble'); },
      () => 'fallback',
    );
    expect(value).toBe('fallback');
  });

  it('按 name 识别（跨模块副本场景）：同样不 fallback', async () => {
    const named = new Error('budget');
    named.name = 'GenerationBudgetExceededError';
    await expect(
      executeStrongConnection('S4', async () => { throw named; }, () => 'fallback'),
    ).rejects.toBe(named);
  });
});
