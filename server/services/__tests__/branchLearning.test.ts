import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  branchBiasEnabled,
  branchWeight,
  branchBias,
  branchScores,
  buildBiasLine,
  recordBranchOutcome,
  loadBranchLedger,
  saveBranchLedger,
  type BranchLedger,
} from '../branchLearning.js';

function ledger(): BranchLedger {
  return { schema: 'branch-learning-v0', updatedAt: 0, branches: {} };
}

describe('开关（默认关）', () => {
  it('默认关；只有显式 true 才开', () => {
    expect(branchBiasEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(branchBiasEnabled({ ENABLE_BRANCH_BIAS: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(branchBiasEnabled({ ENABLE_BRANCH_BIAS: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('有界权重（0.5~1.5，样本<3 不学）', () => {
  it('无样本 / 少样本 ⇒ 恒中性 1.0', () => {
    expect(branchWeight(undefined)).toBe(1.0);
    expect(branchWeight({ voiced: 2, landed: 2, missed: 0, unclear: 0 })).toBe(1.0);
  });

  it('3 样本开始学：全中 ⇒ 1.5 上限；全没中 ⇒ 0.5 下限', () => {
    expect(branchWeight({ voiced: 3, landed: 3, missed: 0, unclear: 0 })).toBe(1.5);
    expect(branchWeight({ voiced: 3, landed: 0, missed: 3, unclear: 0 })).toBe(0.5);
    expect(branchWeight({ voiced: 4, landed: 2, missed: 2, unclear: 0 })).toBe(1.0);
  });

  it('unclear 不算样本（不参与学习）', () => {
    expect(branchWeight({ voiced: 5, landed: 0, missed: 0, unclear: 5 })).toBe(1.0);
  });

  it('bias = weight − 1（给片段用的偏置量）', () => {
    expect(branchBias({ voiced: 3, landed: 3, missed: 0, unclear: 0 })).toBeCloseTo(0.5, 6);
    expect(branchBias(undefined)).toBe(0);
  });
});

describe('账本记录与持久化', () => {
  it('记录选择→结果，计数正确', () => {
    const l = ledger();
    recordBranchOutcome('voice', 'landed', l);
    recordBranchOutcome('voice', 'missed', l);
    recordBranchOutcome('voice', 'unclear', l);
    expect(l.branches.voice).toEqual({ voiced: 3, landed: 1, missed: 1, unclear: 1 });
    expect(l.branches.voice.voiced).toBe(3);
  });

  it('空 key 忽略（脏数据不污染账本）', () => {
    const l = ledger();
    recordBranchOutcome('', 'landed', l);
    expect(Object.keys(l.branches)).toHaveLength(0);
  });

  it('保存/读回往返；坏账本 ⇒ 回到中性而不是抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bl-'));
    const path = join(dir, 'branch_learning.json');
    const l = ledger();
    recordBranchOutcome('silence', 'missed', l);
    expect(saveBranchLedger(l, path)).toBe(true);
    expect(loadBranchLedger(path).branches.silence.missed).toBe(1);
    expect(loadBranchLedger(join(dir, 'nope.json')).branches).toEqual({});
  });
});

describe('偏置行：只鼓励"说"，不鼓励"沉默"（人设红线）', () => {
  it('说比沉默更容易被接住 ⇒ 给一句鼓励', () => {
    const line = buildBiasLine({ voiceWithCause: 0, voice: 0.3, silence: -0.2 });
    expect(line).toContain('更容易接住');
  });

  it('沉默更"有效" ⇒ **什么都不加**（不允许学习把沉默推成默认）', () => {
    expect(buildBiasLine({ voiceWithCause: 0, voice: -0.2, silence: 0.4 })).toBeNull();
  });

  it('说原因比只说状态更好 ⇒ 追加一句"带上原因"', () => {
    const line = buildBiasLine({ voiceWithCause: 0.4, voice: 0, silence: -0.1 });
    expect(line).toContain('带上原因');
  });

  it('差距不足 0.15 ⇒ 不加任何东西（不让噪声进 Prompt）', () => {
    expect(buildBiasLine({ voiceWithCause: 0.05, voice: 0.05, silence: 0.0 })).toBeNull();
  });
});
