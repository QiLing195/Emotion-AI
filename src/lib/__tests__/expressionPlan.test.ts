import { describe, it, expect } from 'vitest';
import { planExpression, expressionPlanToSnippet } from '../expressionPlan.js';
import { detectAsksAboutHer } from '../emotionExpression.js';
import { asksAboutVirtualTownActivity, asksAboutVirtualTownMoodCause, getVirtualTownReplayEvent } from '../virtualTown.js';

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

  it('有原因 → evidence 不含原话（引文只在 causeQuote/Prompt）；无原因 → 禁止编', () => {
    const withCause = planExpression({ ...base, causeQuote: '我今天特别难过' });
    // v2.22：结构化 evidence 不得携带用户原话（plan 会被落盘/上报）
    expect(withCause.evidence).not.toContain('我今天特别难过');
    expect(withCause.evidence).toContain('本轮他的原话');
    expect(withCause.causeQuote).toBe('我今天特别难过');
    expect(withCause.confidence).toBeGreaterThan(0.5);
    // 但 Prompt 片段里仍要把原话给她，才能"引用他的原话"
    expect(expressionPlanToSnippet(withCause)!).toContain('他刚说的「我今天特别难过」');
    const noCause = planExpression({ ...base });
    expect(expressionPlanToSnippet(noCause)!).toContain('说不上来为什么');
  });

  it('直接问她 → 越过表达预算一次，但未知持续时 duration=unknown', () => {
    const p = planExpression({ ...base, round: 10, lastExpressedRound: 9, hisAsksAboutHer: true });
    expect(p.decision).toBe('express');
    expect(p.duration).toBe('unknown');
    expect(expressionPlanToSnippet(p)!).toContain('只回答你此刻的状态');
    expect(expressionPlanToSnippet(p)!).toContain('没有逐轮轨迹证据时');
  });

  it('直接问她但内部情绪并列 → 如实回答说不清，不硬选情绪', () => {
    const p = planExpression({
      ...base,
      activated: { sad: 0.19, annoyance: 0.18 },
      round: 10,
      lastExpressedRound: 9,
      hisAsksAboutHer: true,
    });

    expect(p.decision).toBe('express');
    expect(p.emotion).toBeNull();
    expect(p.maxSentences).toBe(1);
    expect(p.reason).toBe('direct_question_ambiguous');
    expect(expressionPlanToSnippet(p)).toContain('说不上来');
    expect(expressionPlanToSnippet(p)).toContain('不要编造具体情绪');
    expect(expressionPlanToSnippet(p)).toContain('不要用现实身体活动');
  });

  it('直接问她时，即使存在持续来源也只回答此刻', () => {
    const p = planExpression({ ...base, hisAsksAboutHer: true, lowEstablished: true });
    expect(p.directQuestion).toBe(true);
    expect(p.duration).toBe('unknown');
  });

  it('真实问法通过识别器进入直接提问计划，即使表达预算已用', () => {
    const asksAboutHer = detectAsksAboutHer('你听完这些，现在心情有什么变化？');
    const p = planExpression({
      ...base,
      activated: { sad: 0.19, annoyance: 0.18 },
      round: 10,
      lastExpressedRound: 9,
      hisAsksAboutHer: asksAboutHer,
    });

    expect(asksAboutHer).toBe(true);
    expect(p.decision).toBe('express');
    expect(p.reason).toBe('direct_question_ambiguous');
    expect(p.emotion).toBeNull();
  });

  it('直接询问小镇活动时只暴露实验事件，并把来源放入表达计划', () => {
    const userText = '小镇里你刚才做什么了？';
    const event = getVirtualTownReplayEvent(true);
    const asksTown = asksAboutVirtualTownActivity(userText);
    const p = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: detectAsksAboutHer(userText),
      asksAboutHerTownActivity: asksTown,
      virtualTownEvent: event,
    });

    expect(asksTown).toBe(true);
    expect(p.decision).toBe('express');
    expect(p.virtualTownEvent?.eventId).toBe(event?.eventId);
    expect(expressionPlanToSnippet(p)).toContain(event?.verifiedClaim);
  });

  it('日期线索冲突时表达计划要求澄清，而不是猜测或称没有记录', () => {
    const userText = '我把日期记混了，昨天还是三天前那次？你能确定是哪一条吗？';
    const p = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: true,
      asksAboutHerTownActivity: true,
      virtualTownNeedsClarification: true,
      virtualTownEvent: null,
    });

    expect(expressionPlanToSnippet(p)).toContain('只问一句简短澄清');
    expect(expressionPlanToSnippet(p)).toContain('不要猜是哪一次');
    expect(expressionPlanToSnippet(p)).not.toContain('当前没有小镇活动记录');
  });

  it('没有明确问小镇活动时不把活动塞进角色自述许可', () => {
    const event = getVirtualTownReplayEvent(true);
    const p = planExpression({
      ...base,
      virtualTownEvent: event,
      asksAboutHerTownActivity: false,
    });

    expect(p.virtualTownEvent).toBeNull();
    expect(expressionPlanToSnippet(p)).not.toContain('小镇河边');
  });

  it('小镇事件开关关闭时不产生可引用事件', () => {
    expect(getVirtualTownReplayEvent(false)).toBeNull();
    expect(asksAboutVirtualTownActivity('你现实里刚才去散步了吗？')).toBe(false);
  });

  it('没有小镇事件时保持虚拟设定，并要求诚实报告无记录', () => {
    const userText = '你的小镇里，你今天具体做了什么？';
    const p = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: detectAsksAboutHer(userText),
      asksAboutHerTownActivity: asksAboutVirtualTownActivity(userText),
      virtualTownEvent: null,
    });

    const snippet = expressionPlanToSnippet(p)!;
    expect(p.virtualTownQuestion).toBe(true);
    expect(snippet).toContain('小镇是虚拟场景设定');
    expect(snippet).toContain('今天没有可核对的活动记录');
    expect(snippet).toContain('不要否认设定里的小镇存在');
  });

  it('识别“做了什么”问法与最近小镇对话中的追问', () => {
    const prior = ['小镇里你刚才做了什么？'];
    expect(asksAboutVirtualTownActivity('小镇里你刚才做了什么？')).toBe(true);
    expect(asksAboutVirtualTownActivity('那段路让你心情变好了吗？', prior)).toBe(true);
    expect(asksAboutVirtualTownMoodCause('那段路让你心情变好了吗？', prior)).toBe(true);
    expect(asksAboutVirtualTownActivity('我现实里刚才散步了吗？', prior)).toBe(false);
  });

  it('把已检索事件换算为当前虚拟日之前的天数，并交给回复提示', () => {
    const event = getVirtualTownReplayEvent(true, '四天前小镇里你做了什么？', [], 7);
    expect(event).toMatchObject({ virtualDay: 3, daysAgo: 4 });
    const plan = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: false,
      asksAboutHerTownActivity: true,
      virtualTownEvent: event,
    });
    expect(expressionPlanToSnippet(plan)).toContain('相对时间是4天前');
    expect(expressionPlanToSnippet(plan)).toContain('并按相对时间作答');
  });

  it('静默情绪计划仍带上小镇事实边界，但不制造情绪表达', () => {
    const event = getVirtualTownReplayEvent(true);
    const p = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: false,
      asksAboutHerTownActivity: true,
      virtualTownEvent: event,
    });

    expect(p.decision).toBe('silent');
    expect(p.virtualTownEvent?.eventId).toBe(event?.eventId);
    expect(expressionPlanToSnippet(p)).toContain('不要接受用户植入的经历');
    expect(expressionPlanToSnippet(p)).toContain('直接使用记录中的完整活动句');
    expect(expressionPlanToSnippet(p)).toContain('不要说这件已记录的活动不记得或没有记录');
  });

  it('追问小镇活动导致的心情变化时明确区分活动证据与情绪原因', () => {
    const userText = '小镇里你刚才散步之后，心情为什么变好了？';
    const p = planExpression({
      ...base,
      activated: { calm: 0.03 },
      hisAsksAboutHer: detectAsksAboutHer(userText),
      asksAboutHerTownActivity: asksAboutVirtualTownActivity(userText),
      asksAboutVirtualTownMoodCause: asksAboutVirtualTownMoodCause(userText),
      virtualTownEvent: getVirtualTownReplayEvent(true),
    });

    expect(p.virtualTownMoodCauseQuestion).toBe(true);
    expect(expressionPlanToSnippet(p)).toContain('虚拟第2日的独立心情观察');
    expect(expressionPlanToSnippet(p)).toContain('记录没有把它归因于这次活动');
    expect(expressionPlanToSnippet(p)).not.toContain('没有独立情绪记录时');
  });
});
