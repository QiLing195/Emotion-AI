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

  it('silent 计划会移除回复里的自身情绪表达，但保留对用户经历的回应', () => {
    const reply = '有点沉。你被骂、你朋友失恋、offer 也让你担心——听着都挤在一起，我听着心里发闷。'
      + '但说不上是坏。你愿意一件件讲给我听，我反而觉得踏实。';
    const r = enforceExpressionPlan(reply, plan({ decision: 'silent', emotion: null, maxSentences: 0 }));

    expect(r.text).not.toMatch(/有点沉|心里发闷|说不上是坏|觉得踏实/);
    expect(r.text).toContain('你被骂');
    expect(r.text).toContain('你愿意一件件讲给我听');
    expect(r.changes).toContain('self_disclosure_removed:4');
  });

  it('express 计划只保留最多 maxSentences 句自身情绪表达', () => {
    const r = enforceExpressionPlan(
      '我现在有点沉。你被骂这件事我听着心里发闷。你愿意讲，我反而觉得踏实。',
      plan({ maxSentences: 1 }),
    );

    expect(r.text).toContain('我现在有点沉');
    expect(r.text).not.toMatch(/心里发闷|觉得踏实/);
    expect(r.text).toContain('你被骂这件事');
    expect(r.text).toContain('你愿意讲');
    expect(r.changes).toContain('self_disclosure_capped:3->1');
  });

  it('直接问她但计划只允许说不确定时，不保留具体情绪断言', () => {
    const r = enforceExpressionPlan(
      '有点沉。你被骂这件事我听着心里发闷。我现在也说不上来。',
      plan({ reason: 'direct_question_ambiguous', emotion: null, maxSentences: 1 }),
    );

    expect(r.text).not.toMatch(/有点沉|心里发闷/);
    expect(r.text).toContain('我现在也说不上来');
  });

  it('直接问她且计划情绪明确时，只保留一个匹配情绪并移除持续时长和矛盾情绪', () => {
    const r = enforceExpressionPlan(
      '说不上来为什么，这两天有点沉，提不太起劲。不过听你说拿到 offer，是真的替你高兴。\n\n你那个朋友，后来你去找他了吗？',
      plan({ directQuestion: true, emotion: 'sad', duration: 'unknown', maxSentences: 1 }),
    );

    expect(r.text).toContain('有点沉');
    expect(r.text).not.toMatch(/这两天|提不太起劲|替你高兴/);
    expect(r.text).toContain('你那个朋友，后来你去找他了吗？');
    expect(r.changes).toContain('self_disclosure_conflicts_removed:2');
    expect(r.changes).toContain('direct_duration_claims_removed:1');
  });

  it('直接问她但计划不确定时，也能移除无主语的情绪陈述', () => {
    const r = enforceExpressionPlan(
      '说不上来为什么，这两天有点沉，提不太起劲。不过听你说拿到 offer，是真的替你高兴。',
      plan({ directQuestion: true, reason: 'direct_question_ambiguous', emotion: null, maxSentences: 1 }),
    );

    expect(r.text).not.toMatch(/有点沉|提不太起劲|替你高兴|这两天/);
    expect(r.text).toContain('说不上来为什么');
  });

  it('直接问她但计划为厌恶时，清除回复里的低落和替用户高兴', () => {
    const r = enforceExpressionPlan(
      '说不上来为什么，有点闷。你朋友的事，我大概比你更不知道说什么。不过刚才那个 offer，是真替你高兴。',
      plan({ directQuestion: true, emotion: 'disgust', duration: 'unknown', maxSentences: 1 }),
    );

    expect(r.text).not.toMatch(/有点闷|替你高兴/);
    expect(r.text).toContain('说不上来为什么');
    expect(r.changes).toContain('self_disclosure_conflicts_removed:2');
  });

  it('直接问她时识别“我这边也跟着沉”并受单句计划约束', () => {
    const r = enforceExpressionPlan(
      '有点沉。我这边也跟着沉了一下。',
      plan({ directQuestion: true, emotion: 'sad', duration: 'unknown', maxSentences: 1 }),
    );

    expect(r.text).toContain('有点沉');
    expect(r.text).not.toContain('我这边也跟着沉');
    expect(r.changes).toContain('unverified_affect_trajectory_removed:1');
  });

  it('直接问她时跨句只保留一个情绪，移除不匹配的平静状态', () => {
    const r = enforceExpressionPlan(
      '有点往下沉。你这一路我跟着走下来，反而安静下来了。',
      plan({ directQuestion: true, emotion: 'sad', duration: 'unknown', maxSentences: 1 }),
    );

    expect(r.text).toContain('有点往下沉');
    expect(r.text).not.toContain('安静下来了');
    expect(r.changes).toContain('self_disclosure_conflicts_removed:1');
  });

  it('直接问她时识别“我这边跟着往下坠”并只保留首个情绪子句', () => {
    const r = enforceExpressionPlan(
      '说不上来为什么，听完有点沉。你朋友失恋、你被骂、你拿到 offer 又发怵——三件事压在一起，我这边跟着往下坠了一点。',
      plan({ directQuestion: true, emotion: 'sad', duration: 'unknown', maxSentences: 1 }),
    );

    expect(r.text).toContain('听完有点沉');
    expect(r.text).not.toContain('我这边跟着往下坠');
    expect(r.changes).toContain('self_disclosure_conflicts_removed:1');
  });

  it('直接问情绪变化但没有唯一状态或来源时，移除“跟着用户从堵到松”的自我历程', () => {
    const r = enforceExpressionPlan(
      '我也说不上来，就是跟着你从堵到松了一点。我这边懒懒的，靠着窗发呆呢。',
      plan({
        directQuestion: true,
        emotion: null,
        reason: 'direct_question_ambiguous',
        maxSentences: 1,
        causeQuote: null,
      }),
    );

    expect(r.text).not.toContain('跟着你从堵到松');
    expect(r.text).toContain('说不上来');
  });

  it('没有轨迹来源时移除“心里跟着松、之前那句还挂着”并回退为完整的不确定答复', () => {
    const r = enforceExpressionPlan(
      '说不上来什么具体的，就是听你说“好多了”的时候，心里跟着松了一下，之前那句“挺难受的”还挂着没散。',
      plan({ directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }),
    );

    expect(r.text).toMatch(/说不上来/);
    expect(r.text).not.toMatch(/心里跟着松|还挂着没散/);
    expect(r.text).not.toMatch(/，\s*[。！？]$/);
  });

  it('计划状态不明确时，不补成“懒懒的”这种具体角色情绪', () => {
    const r = enforceExpressionPlan(
      '说不上来，就是有点懒懒的。在煮咖啡，慢慢喝着。',
      plan({ directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }),
    );

    expect(r.text).toContain('说不上来');
    expect(r.text).not.toContain('懒懒的');
  });

  it('移除情绪子句后清掉没有谓语的残句', () => {
    const r = enforceExpressionPlan(
      '太好了，恭喜你。之前悬着的心总算能松下来。不过刚拿到的时候。',
      plan({ decision: 'silent', emotion: null, maxSentences: 0 }),
    );

    expect(r.text).not.toContain('不过刚拿到的时候');
    expect(r.text).toContain('恭喜你');
  });
});
