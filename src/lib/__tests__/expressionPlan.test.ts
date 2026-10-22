import { describe, it, expect } from 'vitest';
import { planExpression, expressionPlanToSnippet } from '../expressionPlan.js';

const base = {
  activated: { sad: 0.25, calm: 0.1 } as Record<string, number>,
  hisEmotion: 'neutral',
  hisIntensity: 0.2,
  lowEstablished: false,
  moodDelta: 0,
  ruminationActive: false,
  causeQuote: null as string | null,
  round: 10,
  lastExpressedRound: null as number | null,
  hisAsksAboutHer: false,
};

describe('v2.06 ExpressionPlan（表达计划）', () => {
  it('没有明显情绪 → silent（不硬演）', () => {
    const p = planExpression({ ...base, activated: { calm: 0.03 } });
    expect(p.decision).toBe('silent');
    expect(p.reason).toContain('resting');
    expect(expressionPlanToSnippet(p)).toBeNull();
  });

  it('他明确负面情绪 → 让位（silent his_negative_defer）', () => {
    const p = planExpression({ ...base, hisEmotion: 'sad', hisIntensity: 0.8 });
    expect(p.decision).toBe('silent');
    expect(p.reason).toBe('his_negative_defer');
  });

  it('表达预算内 → silent', () => {
    const p = planExpression({ ...base, round: 10, lastExpressedRound: 9 });
    expect(p.decision).toBe('silent');
    expect(p.reason).toContain('budget');
  });

  it('短时激活 → transient，片段禁止"这两天/一直"', () => {
    const p = planExpression({ ...base });
    expect(p.decision).toBe('express');
    expect(p.duration).toBe('transient');
    expect(p.maxSentences).toBe(1);
    const snippet = expressionPlanToSnippet(p)!;
    expect(snippet).toContain('禁止说"这两天/一直/最近几天/这些天"');
  });

  it('低谷成段 → sustained，允许持续感', () => {
    const p = planExpression({ ...base, lowEstablished: true });
    expect(p.decision).toBe('express');
    expect(p.duration).toBe('sustained');
    expect(expressionPlanToSnippet(p)!).toContain('可以说"这两天/最近"');
  });

  it('心情层偏置足够大 → sustained（有持续来源）', () => {
    const p = planExpression({ ...base, moodDelta: -0.12 });
    expect(p.duration).toBe('sustained');
    expect(p.evidence).toContain('心情层偏置');
  });

  it('有原因 → 证据含他的原话，confidence 更高；无原因 → 禁止编', () => {
    const withCause = planExpression({ ...base, causeQuote: '我今天特别难过' });
    expect(withCause.evidence).toContain('我今天特别难过');
    expect(withCause.confidence).toBeGreaterThan(0.5);
    const noCause = planExpression({ ...base });
    expect(expressionPlanToSnippet(noCause)!).toContain('说不上来为什么');
  });

  it('直接问她 → 允许回答，但未知持续时 duration=unknown（不延伸成最近一直）', () => {
    const p = planExpression({ ...base, hisAsksAboutHer: true });
    expect(p.decision).toBe('express');
    expect(p.duration).toBe('unknown');
    expect(expressionPlanToSnippet(p)!).toContain('只回答你此刻的状态');
  });
});
