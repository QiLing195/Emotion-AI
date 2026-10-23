import { describe, it, expect } from 'vitest';
import { enforceExpressionPlan } from '../expressionEnforcement.js';
import type { ExpressionPlan } from '../expressionPlan.js';

const plan = (over: Partial<ExpressionPlan> = {}): ExpressionPlan => ({
  decision: 'express',
  reason: 'express:sad(transient)',
  emotion: 'sad',
  tone: 'soft',
  duration: 'transient',
  maxSentences: 1,
  maxQuestions: 1,
  evidence: null,
  causeQuote: null,
  sourceEventId: null,
  confidence: 0.6,
  ...over,
});

describe('v2.13 ExpressionPlan 运行时强制', () => {
  it('transient：去掉“这两天/一直”这类持续声称（只改她自己的句子）', () => {
    const r = enforceExpressionPlan('我这两天一直有点沉。你呢？', plan());
    expect(r.text).not.toContain('这两天');
    expect(r.text).not.toContain('一直');
    expect(r.text).toContain('有点沉');
    expect(r.changed).toBe(true);
    expect(r.changes.join(',')).toContain('duration_claims_removed');
  });

  it('sustained：允许持续声称，不改', () => {
    const r = enforceExpressionPlan('我这两天一直有点沉。', plan({ duration: 'sustained' }));
    expect(r.text).toBe('我这两天一直有点沉。');
    expect(r.changed).toBe(false);
  });

  it('讲别人/转述的句子不动（含“你/他/朋友”）', () => {
    const r = enforceExpressionPlan('你说这两天要面试。', plan());
    expect(r.text).toBe('你说这两天要面试。');
    expect(r.changed).toBe(false);
  });

  it('提问上限：第二个问号改成句号，保留文字', () => {
    const r = enforceExpressionPlan('你还好吗？要不要说说？', plan());
    expect(r.text).toBe('你还好吗？要不要说说。');
    expect(r.changes.join(',')).toContain('questions_capped:2->1');
  });

  it('silent 计划（maxQuestions=0）：仍保留 1 个问题，不改成陈述', () => {
    const r = enforceExpressionPlan('你说的是哪一句？', plan({ decision: 'silent', maxQuestions: 0 }));
    expect(r.text).toBe('你说的是哪一句？');
    expect(r.changed).toBe(false);
  });

  it('silent 计划下仍只允许 1 问（2 个问号 → 1 个）', () => {
    const r = enforceExpressionPlan('你还好吗？要不要说说？', plan({ decision: 'silent', maxQuestions: 0 }));
    expect(r.text).toBe('你还好吗？要不要说说。');
  });

  it('只问一次：不触发', () => {
    const r = enforceExpressionPlan('你还好吗？', plan());
    expect(r.text).toBe('你还好吗？');
    expect(r.changed).toBe(false);
  });

  it('计划为 null / 关闭开关：原样返回', () => {
    expect(enforceExpressionPlan('我这两天有点沉。', null).changed).toBe(false);
    expect(enforceExpressionPlan('我这两天有点沉。', plan(), { enabled: false }).text).toBe('我这两天有点沉。');
  });

  it('不改事实内容：只移除时间词，不新增断言', () => {
    const r = enforceExpressionPlan('我这几天在翻杭州的徒步路线。', plan());
    expect(r.text).toContain('杭州的徒步路线');
    expect(r.text).not.toContain('这几天');
  });
});
