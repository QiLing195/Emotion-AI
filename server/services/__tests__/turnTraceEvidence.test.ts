import { describe, it, expect } from 'vitest';
import { buildTurnTrace, sanitizeTraceLabel } from '../turnTrace.js';

describe('v2.21 evidence 脱敏（trace 不夹带用户原话）', () => {
  it('expressionPlan 的 evidence 可能含「他刚说的「…」」——必须遮蔽引文', () => {
    const rec = buildTurnTrace({
      plan: {
        decision: 'express',
        reason: 'express:sad(transient)',
        emotion: 'sad',
        tone: 'soft',
        duration: 'transient',
        evidence: '低谷已持续成段；他刚说的「我今天特别难过，什么都做不好」',
        maxSentences: 1,
        maxQuestions: 1,
        confidence: 0.6,
      },
      // 调用方即便多传 causeQuote 也不能进文件
      causeQuote: '我今天特别难过，什么都做不好',
    } as never);
    const json = JSON.stringify(rec);
    expect(json).not.toContain('我今天特别难过');
    expect(json).not.toContain('什么都做不好');
    expect(rec.plan.evidence).toContain('引文已遮蔽');
    expect(rec.plan.evidence).toContain('低谷已持续成段');
  });

  it('sanitizeTraceLabel：去换行、遮蔽中/英文引号、限长', () => {
    expect(sanitizeTraceLabel('a\nb\tc')).toBe('a b c');
    expect(sanitizeTraceLabel('他刚说的「秘密」')).toBe('他刚说的「[引文已遮蔽]」');
    expect(sanitizeTraceLabel('他说“别告诉别人”')).toBe('他说“[引文已遮蔽]”');
    expect(sanitizeTraceLabel('say "hello"')).toBe('say "[引文已遮蔽]"');
    const long = sanitizeTraceLabel('低'.repeat(300));
    expect((long ?? '').length).toBeLessThanOrEqual(161);
    expect(long?.endsWith('…')).toBe(true);
    expect(sanitizeTraceLabel(null)).toBeNull();
    expect(sanitizeTraceLabel('   ')).toBeNull();
  });
});
