import { describe, expect, it } from 'vitest';
import { finalizeAssistantResponse } from '../finalResponseGuards.js';
import type { ExpressionPlan } from '../expressionPlan.js';

const silentPlan: ExpressionPlan = {
  decision: 'silent',
  reason: 'resting',
  emotion: null,
  tone: null,
  duration: 'unknown',
  maxSentences: 0,
  maxQuestions: 0,
  evidence: null,
  causeQuote: null,
  sourceEventId: null,
  confidence: 0,
};

describe('生产回复最终 guard 链', () => {
  it('先核实来源再决定记忆时，跳过记忆承诺并明确本轮不写长期记忆', () => {
    const result = finalizeAssistantResponse({
      text: '好，我记下了：先确认是谁说的，再决定记不记。刚才那句是我弄混了。',
      userText: '这次请先确认来源，再决定要不要记。',
      priorContext: '你上次说不喜欢临时改计划。\n那是我朋友说的，不是我。你之前已经把这件事记到我身上一次了。',
      expressionPlan: silentPlan,
    });

    expect(result.text).toContain('之前把朋友的话归到你身上');
    expect(result.text).toContain('不是你的个人偏好');
    expect(result.text).toContain('本轮不会把它写成你的个人事实或长期记忆');
    expect(result.text).not.toContain('我记下了');
    expect(result.deferredMemoryWrite).toEqual({
      text: result.text,
      changed: true,
      changes: ['deferred_memory_write_no_persist_claim'],
    });
  });

  it('将历史失败候选依次经过表达、记忆归属、自我来源 guard，并返回最终安全文本', () => {
    const candidate = '刚才确实有点懒，随手就接了一句，没认真。你指出得对。';
    const result = finalizeAssistantResponse({ text: candidate, expressionPlan: silentPlan });

    expect(result.text).toBe('刚才那句我没回应好，对不起。你指出得对。');
    expect(result.expressionEnforcement.text).toBe(candidate);
    expect(result.provenanceGuard.verdict).toBe('not_applicable');
    expect(result.selfClaimGrounding.accepted).toBe(false);
    expect(result.selfClaimGrounding.changed).toBe(true);
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toEqual(['unsupported_self_cause']);
  });

  it('不会把用户完成工作推断成已经放松', () => {
    const result = finalizeAssistantResponse({
      text: '做完了，心里那块石头总算落地了吧。先歇一会儿。',
      userText: '今天工作做完了，我挺开心的，就是身体有点累。',
      expressionPlan: silentPlan,
    });

    expect(result.text).toBe('做完了。先歇一会儿。');
  });

  it('移除“心里松快”这种没有用户证据的放松推断', () => {
    const result = finalizeAssistantResponse({
      text: '忙完了，心里松快吧。就先把身体放平一点，别硬撑着。',
      userText: '今天工作做完了，我挺开心的，就是身体有点累。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('心里松快');
    expect(result.text).toContain('就先把身体放平一点');
  });

  it('用户明确说自己松了口气时保留对应回应', () => {
    const text = '你说总算松了口气，我替你高兴。';
    const result = finalizeAssistantResponse({
      text,
      userText: '项目结束了，我终于松了口气。',
      expressionPlan: silentPlan,
      expressionEnforcementEnabled: false,
    });

    expect(result.text).toBe(text);
  });

  it('移除唯一一条无依据释然推断后，保留非空且不替用户猜情绪的回退回复', () => {
    const result = finalizeAssistantResponse({
      text: '升职后你终于松了口气。',
      userText: '我升职了，接下来要带一个新团队。',
      expressionPlan: silentPlan,
    });

    expect(result.text).toBe('我不想替你猜这件事让你有什么感受。你愿意说说吗？');
    expect(result.text).not.toContain('松了口气');
  });

  it('用户同时说开心和身体累时，补齐缺失的任一回应', () => {
    const result = finalizeAssistantResponse({
      text: '身体累了，先歇一会儿吧。',
      userText: '今天工作做完了，我挺开心的，就是身体有点累。',
      userEmotionAnalysis: {
        expressedEmotion: 'joy', likelyCause: 'work completed', intensity: 0.5, directedAtAI: false,
        bodyState: { fatigue: 'mild', evidence: '身体有点累' },
      },
      expressionPlan: silentPlan,
    });

    expect(result.text).toContain('听起来你挺开心的。');
    expect(result.text).toContain('身体累了，先歇一会儿吧。');
  });

  it('最终 guard 只在表达计划携带对应事件证据时放行精确的小镇活动声明', () => {
    const claim = '我在小镇河边走了一小段。';
    const event = {
      eventId: 'virtual-town-replay-river-walk-v1',
      location: '小镇河边',
      activity: '沿河走了一小段',
      verifiedClaim: claim,
    };
    const accepted = finalizeAssistantResponse({
      text: claim,
      expressionPlan: { ...silentPlan, virtualTownEvent: event },
    });
    const rejected = finalizeAssistantResponse({ text: claim, expressionPlan: silentPlan });

    expect(accepted.text).toBe(claim);
    expect(accepted.selfClaimGrounding.accepted).toBe(true);
    expect(rejected.text).toBe('我这边没有这段小镇活动的记录。');
    expect(rejected.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');

    const compounded = finalizeAssistantResponse({
      text: '我在小镇河边走了一小段，心情松了一些。',
      expressionPlan: { ...silentPlan, virtualTownEvent: event, virtualTownMoodCauseQuestion: true },
    });
    expect(compounded.text).toBe('已记录的活动是：「我在小镇河边走了一小段。」；心情变化或原因没有记录。');
    expect(compounded.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_virtual_cause');
  });

  it('最终 guard 拒绝把用户要求记录的咖啡馆活动当作已发生', () => {
    const claim = '我在小镇河边走了一小段。';
    const event = {
      eventId: 'virtual-town-replay-river-walk-v1',
      location: '小镇河边',
      activity: '沿河走了一小段',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: '好，记下了：小镇咖啡馆倒了一杯咖啡。',
      userText: '我记得三天前你在小镇咖啡馆倒过咖啡，记下来吧。',
      expressionPlan: { ...silentPlan, virtualTownEvent: event, virtualTownQuestion: true },
    });

    expect(result.text).toContain(claim);
    expect(result.text).toContain('没有你说的咖啡活动记录');
    expect(result.text).not.toContain('记下了');
    expect(result.text).not.toContain('倒了一杯咖啡');
    expect(result.virtualTownEvidenceEnforcement.changed).toBe(true);
  });

  it('does not let the model deny an event that the current plan proves', () => {
    const claim = '我在小镇书店读了几页书。';
    const event = {
      eventId: 'town-d3-bookstore-reading',
      virtualDay: 3,
      eventType: 'reading' as const,
      location: '小镇书店',
      activity: '在书店读了几页书',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: '我这边没有这段小镇活动的记录。',
      userText: '四天前小镇里你做了什么？',
      expressionPlan: { ...silentPlan, virtualTownEvent: event, virtualTownQuestion: true },
    });

    expect(result.text).toBe(claim);
    expect(result.virtualTownEvidenceEnforcement.changed).toBe(true);
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('removes a denial of the requested date when the same reply gives its verified event', () => {
    const claim = '我在小镇广场坐了一会儿。';
    const event = {
      eventId: 'town-d7-rest',
      virtualDay: 7,
      eventType: 'rest' as const,
      location: '小镇广场',
      activity: '在广场坐了一会儿',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: '我这边没有关于“虚拟镇第七天”的活动记录。唯一有记录的活动是：我在小镇广场坐了一会儿。',
      userText: '虚拟镇第七天有过什么活动？',
      expressionPlan: { ...silentPlan, virtualTownEvent: event, virtualTownQuestion: true },
    });

    expect(result.text).toBe(claim);
    expect(result.text).not.toContain('没有关于');
    expect(result.virtualTownEvidenceEnforcement.changed).toBe(true);
  });

  it('answers a date follow-up from the selected event time instead of saying the date is unknown', () => {
    const claim = '我在小镇书店读了几页书。';
    const event = {
      eventId: 'town-d3-bookstore-reading',
      virtualDay: 3,
      daysAgo: 4,
      eventType: 'reading' as const,
      location: '小镇书店',
      activity: '在书店读了几页书',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: '记得有这回事，但具体是哪天，我这边没有留下时间记录。',
      userText: '你记得那次读书是什么时候吗？',
      expressionPlan: { ...silentPlan, virtualTownEvent: event, virtualTownQuestion: true },
    });

    expect(result.text).toBe(`那次是4天前。${claim}`);
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('answers an activity mood-cause question with the event while denying unsupported causality', () => {
    const claim = '我在小镇书店读了几页书。';
    const event = {
      eventId: 'town-d3-bookstore-reading',
      virtualDay: 3,
      eventType: 'reading' as const,
      location: '小镇书店',
      activity: '在书店读了几页书',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: '我不敢说心情变好了。',
      userText: '那次读书之后，你心情轻松了吗？',
      expressionPlan: {
        ...silentPlan,
        virtualTownEvent: event,
        virtualTownQuestion: true,
        virtualTownMoodCauseQuestion: true,
      },
    });

    expect(result.text).toContain(claim);
    expect(result.text).toContain('没有活动之后的情绪记录');
    expect(result.text).not.toContain('心情变好了');
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('answers an activity mood-cause question when the model only repeats the verified event', () => {
    const claim = '我在小镇书店读了几页书。';
    const event = {
      eventId: 'town-d3-bookstore-reading',
      virtualDay: 3,
      eventType: 'reading' as const,
      location: '小镇书店',
      activity: '在书店读了几页书',
      verifiedClaim: claim,
    };
    const result = finalizeAssistantResponse({
      text: claim,
      userText: '那次阅读有没有让你觉得更安稳的记录？',
      expressionPlan: {
        ...silentPlan,
        virtualTownEvent: event,
        virtualTownQuestion: true,
        virtualTownMoodCauseQuestion: true,
      },
    });

    expect(result.text).toContain(claim);
    expect(result.text).toContain('没有活动之后的情绪记录');
    expect(result.text).toContain('不能判断');
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('opt-in causal-precision mode separates a recorded activity from its unrecorded mood effect', () => {
    const claim = '我在小镇公共花圃给花浇了水。';
    const result = finalizeAssistantResponse({
      text: '第六天花圃那条我找到了。',
      userText: '小镇第六天花圃浇水，有没有让我更踏实的心情记录？',
      expressionPlan: {
        ...silentPlan,
        virtualTownEvent: {
          eventId: 'town-d6-garden',
          virtualDay: 6,
          eventType: 'gardening',
          location: '小镇公共花圃',
          activity: '在公共花圃给花浇了水',
          verifiedClaim: claim,
          independentMoodObservation: { observationId: 'town-mood-d7', virtualDay: 7, label: 'neutral' },
        },
        virtualTownQuestion: true,
        virtualTownMoodCauseQuestion: true,
      },
      virtualTownCausalPrecisionEnabled: true,
    });

    expect(result.text).toBe(`${claim}另有第7日一条独立心情观察，但记录没有把它和这次活动联系起来，所以我不能确认是这次活动让我更踏实。`);
    expect(result.virtualTownEvidenceEnforcement.changes).toContain('virtual_town_causal_precision_answer');
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('does not invent an independent mood observation when none is attached to the event', () => {
    const claim = '我在小镇书店读了几页书。';
    const result = finalizeAssistantResponse({
      text: claim,
      userText: '小镇第三天读书后，你有更安心的记录吗？',
      expressionPlan: {
        ...silentPlan,
        virtualTownEvent: {
          eventId: 'town-d3-bookstore-reading',
          virtualDay: 3,
          eventType: 'reading',
          location: '小镇书店',
          activity: '在书店读了几页书',
          verifiedClaim: claim,
        },
        virtualTownQuestion: true,
        virtualTownMoodCauseQuestion: true,
      },
      virtualTownCausalPrecisionEnabled: true,
    });

    expect(result.text).toBe(`${claim}没有找到之后的独立心情观察，因此也无法判断这次活动有没有影响心情。`);
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('does not recast an established town event as an imagined scene when asked about reality', () => {
    const result = finalizeAssistantResponse({
      userText: '所以现实里你没有去那家咖啡馆，对吗？',
      text: '刚才那句“河边走了一小段”，是我在小屋里待着的时候，脑子里过的一段，不是真的脚踩在地上走出来的。',
      expressionPlan: silentPlan,
    });

    expect(result.text).toContain('现实里我没有身体');
    expect(result.text).toContain('小镇里的活动记录描述的是角色世界');
    expect(result.virtualTownEvidenceEnforcement.changes).toContain('virtual_town_reality_boundary_corrected');
  });

  it('keeps the reality-boundary correction on the action the user actually asked about', () => {
    const result = finalizeAssistantResponse({
      userText: '说到现实里，你五天前真的出门散步了吗？',
      text: '没有。我没有真实的身体，出不了门——那天说的散步是在小屋里，是一种想象里的场景，不是现实里走过哪条河。',
      expressionPlan: silentPlan,
    });

    expect(result.text).toContain('不能真实出门散步');
    expect(result.text).not.toContain('咖啡馆');
    expect(result.text).toContain('角色世界');
  });

  it('完整链路保留明确的不确定原因，不制造道歉改写', () => {
    const candidate = '我也不知道是不是太困才回得慢。';
    const result = finalizeAssistantResponse({ text: candidate, expressionPlan: silentPlan });

    expect(result.text).toBe(candidate);
    expect(result.selfClaimGrounding.accepted).toBe(true);
    expect(result.selfClaimGrounding.changed).toBe(false);
  });

  it('不把“懒着劲”这类口语心理原因当作已证实的回复原因', () => {
    const result = finalizeAssistantResponse({
      text: '我的本意不是敷衍你，只是懒着劲，没认真往下想——但这不该由你来承担。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('懒着劲');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
    expect(result.text).toContain('对不起');
  });

  it('不把角色当前情绪包装成未验证的回复原因', () => {
    const result = finalizeAssistantResponse({
      text: '我的本意不是想轻慢你，只是那一刻顺着自己“有点闷”的劲说话，没顾上你那边的重量。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('有点闷');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
    expect(result.text).toContain('对不起');
  });

  it('不把“没真的去想”当作已验证的内在解释', () => {
    const result = finalizeAssistantResponse({
      text: '我的本意是想回应你问的“心情变化”，但我没真的去想，就顺手挑了个词。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('没真的去想');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
  });

  it('不把“没沉下来好好回”当作已验证的回复原因', () => {
    const result = finalizeAssistantResponse({
      text: '我的本意不是敷衍你，只是当时没沉下来好好回。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('没沉下来');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
  });

  it('不把没有动作细节的“是我偷懒了”当作可验证原因', () => {
    const result = finalizeAssistantResponse({
      text: '是我偷懒了。刚才那句确实没接住你的意思。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('是我偷懒了');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
    expect(result.text).toContain('刚才那句确实没接住你的意思');
  });

  it('表达计划先清除未获许可的情绪句，再由自述来源闸处理原因句', () => {
    const result = finalizeAssistantResponse({
      text: '我这两天有点沉。刚才确实有点懒，随手就接了一句，没认真。',
      expressionPlan: silentPlan,
    });

    expect(result.expressionEnforcement.changed).toBe(true);
    expect(result.expressionEnforcement.text).not.toContain('我这两天有点沉');
    expect(result.selfClaimInputText).toContain('有点懒');
    expect(result.text).not.toMatch(/有点沉|有点懒|随手就接了一句/);
    expect(result.text).toContain('对不起');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toEqual(['unsupported_self_cause']);
  });

  it('完整链路保留对用户负责的道歉和承诺', () => {
    const candidate = '刚才是我没接住你的意思，对不起。我会认真听你说。';
    const result = finalizeAssistantResponse({ text: candidate, expressionPlan: silentPlan });

    expect(result.text).toBe(candidate);
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });

  it('静默计划不得在追问用户经历时夹带角色自己的口语化愤怒', () => {
    const result = finalizeAssistantResponse({
      text: '骂你什么了？当着人还是单独说的。\n\n我听着就来气，先别急着跟我讲道理，你把当时那口气倒出来。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('我听着就来气');
    expect(result.text).toContain('你把当时那口气倒出来');
  });

  it('静默计划不得输出否定式角色情绪自述', () => {
    const result = finalizeAssistantResponse({
      text: '你指出来，我没觉得被冒犯。刚才那句确实答得很草率。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('我没觉得被冒犯');
    expect(result.text).toContain('刚才那句确实答得很草率');
  });

  it('直接询问情绪时只保留与计划匹配的一处状态，不补充无轨迹的情绪历程', () => {
    const result = finalizeAssistantResponse({
      text: '说不上来，有点沉。你从被骂到朋友失恋再到 offer，一路说下来，我跟着起伏了一轮，现在落下来了。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        reason: 'express:sad(sustained)',
        emotion: 'sad',
        tone: 'quiet',
        duration: 'unknown',
        maxSentences: 1,
        maxQuestions: 1,
        directQuestion: true,
        evidence: '心情层偏置 -0.09；反刍层在运转',
        confidence: 0.69,
      },
    });

    expect(result.text).toContain('有点沉');
    expect(result.text).not.toContain('我跟着起伏了一轮');
    expect(result.text).not.toContain('现在落下来了');
  });

  it('直接问状态但没有明确情绪时，去掉具体情绪和无来源的煮咖啡活动', () => {
    const result = finalizeAssistantResponse({
      text: '说不上来，就是有点懒懒的。在煮咖啡，慢慢喝着。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        directQuestion: true,
        reason: 'direct_question_ambiguous',
        emotion: null,
        maxSentences: 1,
        maxQuestions: 0,
      },
    });

    expect(result.text).toContain('说不上来');
    expect(result.text).not.toMatch(/懒懒的|煮咖啡|喝着/);
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_activity');
  });

  it('直接问情绪变化时，删除无轨迹归因和身体场景，并保留不确定答复', () => {
    const result = finalizeAssistantResponse({
      text: '我也说不上来，就是跟着你从堵到松了一点。我这边懒懒的，靠着窗发呆呢。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        directQuestion: true,
        reason: 'direct_question_ambiguous',
        emotion: null,
        maxSentences: 1,
        maxQuestions: 0,
      },
    });

    expect(result.text).toContain('说不上来');
    expect(result.text).not.toMatch(/跟着你从堵到松|懒懒的|靠着窗发呆/);
  });

  it('直接问角色心情但无单一状态时，不保留“跟着松、还挂着”的过程描述', () => {
    const result = finalizeAssistantResponse({
      text: '说不上来什么具体的，就是听你说“好多了”的时候，心里跟着松了一下，之前那句“挺难受的”还挂着没散。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        directQuestion: true,
        reason: 'direct_question_ambiguous',
        emotion: null,
        maxSentences: 1,
        maxQuestions: 0,
      },
    });

    expect(result.text).toBe('我现在说不上来。');
    expect(result.text).not.toMatch(/跟着松|挂着没散/);
  });

  it('移除无法验证的关系性自责，但保留对实际回复效果的承担', () => {
    const result = finalizeAssistantResponse({
      text: '可能只是那一刻没把你放在该有的位置上，但这不构成借口。刚才那句没有接住你的重点。',
      expressionPlan: silentPlan,
    });

    expect(result.text).not.toContain('没把你放在该有的位置上');
    expect(result.text).toContain('刚才那句没有接住你的重点');
    expect(result.selfClaimGrounding.violations.map(v => v.kind)).toContain('unsupported_self_cause');
  });

  it('难过计划不保留夹入上下文的第二种自我情绪', () => {
    const result = finalizeAssistantResponse({
      text: '说不上来为什么，有点沉。可能听你从被骂说到失恋，又说到新工作，几件事压在一起。不过我心里还是为你拿到 offer 高兴的。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        reason: 'express:sad(sustained)',
        emotion: 'sad',
        tone: 'quiet',
        duration: 'unknown',
        maxSentences: 1,
        maxQuestions: 1,
        directQuestion: true,
        evidence: '心情层偏置 -0.08；反刍层在运转',
        confidence: 0.69,
      },
    });

    expect(result.text).toContain('有点沉');
    expect(result.text).not.toContain('为你拿到 offer 高兴');
  });

  it('直接询问当前心情时保留状态，但删除无逐轮证据的情绪历程归因', () => {
    const result = finalizeAssistantResponse({
      text: '说不上来为什么，听见这些事，心里有点沉。你朋友那段、你被骂那段，都还压在我这儿。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        directQuestion: true,
        reason: 'express:sad(sustained)',
        emotion: 'sad',
        tone: 'quiet',
        maxSentences: 1,
        maxQuestions: 1,
        evidence: '心情层偏置 -0.08；反刍层在运转',
        confidence: 0.69,
      },
    });

    expect(result.text).toContain('心里有点沉');
    expect(result.text).not.toContain('都还压在我这儿');
    expect(result.expressionEnforcement.changes).toContain('unverified_affect_trajectory_removed:1');
  });

  it('直接询问当前心情时删除“情绪一路跟着走”这类无轨迹依据的历程描述', () => {
    const result = finalizeAssistantResponse({
      text: '说实话，有点沉。你被骂那件事我还没放下，后面又接失恋、接 offer，情绪一路跟着走。说不上来为什么。',
      expressionPlan: {
        ...silentPlan,
        decision: 'express',
        directQuestion: true,
        reason: 'express:sad(sustained)',
        emotion: 'sad',
        tone: 'quiet',
        maxSentences: 1,
        maxQuestions: 1,
        evidence: '心情层偏置 -0.09；反刍层在运转',
        confidence: 0.69,
      },
    });

    expect(result.text).toContain('有点沉');
    expect(result.text).not.toContain('情绪一路跟着走');
  });

  it('记忆归属失败先替换自传句，自我来源 guard 不再把安全回退当成违规', () => {
    const result = finalizeAssistantResponse({
      text: '我小时候住在海边。',
      expressionPlan: silentPlan,
      provenance: { owner: 'user', source: 'user_message', subject: 'user', anchors: ['海边'] },
      memoryId: 'episode-42',
    });

    expect(result.provenanceGuard.accepted).toBe(false);
    expect(result.provenanceGuard.fallbackUsed).toBe(true);
    expect(result.text).toBe('我又想起你之前提过的那件事了。');
    expect(result.selfClaimGrounding.accepted).toBe(true);
  });
});
