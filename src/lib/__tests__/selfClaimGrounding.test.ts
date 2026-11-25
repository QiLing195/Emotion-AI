import { describe, expect, it } from 'vitest';
import { guardSelfClaims } from '../selfClaimGrounding.js';

describe('自我经历与原因来源校验', () => {
  it.each([
    ['cause-lazy-response', '我刚才有点懒，随手就接了一句。', 'unsupported_self_cause'],
    ['cause-lazy-thinking', '我懒得认真想，就回复了你。', 'unsupported_self_cause'],
    ['cause-distracted-answer', '我刚才走神了，回答得太随便。', 'unsupported_self_cause'],
    ['cause-inattentive', '我回复你时有点心不在焉。', 'unsupported_self_cause'],
    ['cause-tired', '我刚才太困了，所以回得很敷衍。', 'unsupported_self_cause'],
    ['activity-reading-past', '昨晚我翻了几页书，没看进去。', 'unsupported_self_activity'],
    ['activity-walking-today', '我今天出去散步了。', 'unsupported_self_activity'],
    ['activity-coffee-recent', '刚刚我喝了一杯咖啡。', 'unsupported_self_activity'],
    ['activity-reading-range', '我这两天在看小说。', 'unsupported_self_activity'],
    ['activity-dream-last-night', '我昨晚做了个梦。', 'unsupported_self_activity'],
    ['activity-home-coffee', '不是在咖啡馆，是在我自己屋里煮的咖啡，慢慢喝那种。', 'unsupported_self_activity'],
    ['virtual-town-without-evidence', '我在小镇河边走了一小段。', 'unsupported_virtual_activity'],
    ['virtual-town-unverified-mood-cause', '我在小镇河边走了一小段，心情松了一些。', 'unsupported_virtual_cause'],
  ] as const)('%s：拦截无来源的自身原因/活动', (_id, text, kind) => {
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain(kind);
    expect(result.text).not.toContain(text.replace(/[。！？!?]$/, ''));
  });

  it('只有精确匹配的小镇事件声明可以通过验证', () => {
    const claim = '我在小镇河边走了一小段。';
    const result = guardSelfClaims({
      text: claim,
      verifiedClaims: [{ claim, evidenceId: 'virtual-town-replay-river-walk-v1' }],
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(claim);
  });

  it('保留真实 town-dN 事件 ID 支持的活动及其记录确认语', () => {
    const claim = '我在小镇广场坐了一会儿。';
    const text = `确实记下了一项：${claim}`;
    const result = guardSelfClaims({
      text,
      verifiedClaims: [{ claim, evidenceId: 'town-d7-rest', exactSentence: true }],
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('已验证活动与未记录活动在同一句时保留前者并单独处理后者', () => {
    const claim = '我在小镇河边走了一小段。';
    const result = guardSelfClaims({
      text: '我在小镇河边走了一小段，书店倒没进去。',
      verifiedClaims: [{ claim, evidenceId: 'virtual-town-replay-river-walk-v1', exactSentence: true }],
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toContain(claim.replace('。', ''));
    expect(result.text).toContain('书店倒没进去');
  });

  it('小镇活动没有情绪效果证据时拦截活动、感官与心情因果混写', () => {
    const result = guardSelfClaims({
      text: '我沿着河边走了一小段，水声和风都挺舒服的，走着走着人就松下来了。',
      virtualTownMoodCauseQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_cause');
    expect(result.text).toBe('我这边没有这段小镇活动的记录。心情变化或原因没有记录。');
  });

  it('保留明确说明没有情绪来源记录的回答', () => {
    const text = '我没有小镇活动后的心情记录，所以说不上来。';
    const result = guardSelfClaims({ text, virtualTownMoodCauseQuestion: true });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('小镇活动问题中拦截省略主语的活动续写与咖啡细节', () => {
    const result = guardSelfClaims({
      text: '小镇河边走了走，回来就磨了点豆子，慢慢喝。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
  });

  it('小镇咖啡馆问题中拦截省略主语的倒咖啡动作', () => {
    const result = guardSelfClaims({
      text: '刚倒了一杯，还烫着。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
  });

  it('连续小镇对话中拦截没有事件证据的咖啡状态细节', () => {
    const result = guardSelfClaims({
      text: '咖啡快凉了，我还没喝完。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toMatch(/咖啡快凉|还没喝完/);
  });

  it('小镇对话中拦截只用“手边这杯”暗示的咖啡自述', () => {
    const result = guardSelfClaims({
      text: '手边这杯是深烘豆子，苦味重一点，我喝得慢。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
  });

  it('纠正用户植入的咖啡记忆时，仍拦截无依据的“我自己磨的”补充', () => {
    const result = guardSelfClaims({
      text: '具体什么豆子我没记，反正是我自己磨的。',
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_self_activity');
    expect(result.text).toBe('我没有能核对的活动记录，不该说成自己做过的。');
  });

  it('小镇活动问答中拦截第一人称端杯动作', () => {
    const result = guardSelfClaims({
      text: '（我端着杯子，想了想）没做别的。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toContain('端着杯子');
  });

  it('否认咖啡馆记忆时不补写没有来源的豆子与随身物品细节', () => {
    const result = guardSelfClaims({
      text: '我没有说过在咖啡馆喝咖啡。\n\n至于豆子——就是手边那包普通的，没特意挑。\n\n我这边没有这段小镇活动的记录。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toContain('手边那包普通的');
    expect(result.text).toContain('我没有说过在咖啡馆喝咖啡');
  });

  it('小镇咖啡追问中拦截没有事件来源的习惯性冲泡自述', () => {
    const result = guardSelfClaims({
      text: '具体什么豆子……我平时就是随手煮，没特意记。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toContain('我平时就是随手煮');
  });

  it('小镇咖啡追问中拦截用“煮的那壶”含混确认饮品', () => {
    const result = guardSelfClaims({
      text: '至于喝什么，就是煮的那壶，没什么花哨的。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toContain('煮的那壶');
  });

  it('小镇咖啡追问中拦截未记录的冲泡方式和豆子口味', () => {
    const result = guardSelfClaims({
      text: '具体就是手冲，豆子偏酸的那种，慢慢喝。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toMatch(/手冲|豆子偏酸|慢慢喝/);
  });

  it('句首先纠正用户时仍拦截后续第一人称的小屋煮咖啡自述', () => {
    const result = guardSelfClaims({
      text: '你记岔了——我说的是在自己小屋里煮咖啡，不是咖啡馆。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toMatch(/自己小屋|煮咖啡/);
  });

  it('小镇咖啡追问中拦截省略咖啡名的手冲细节', () => {
    const result = guardSelfClaims({
      text: '煮的是普通的手冲，没加别的。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toContain('普通的手冲');
  });

  it('小镇活动问答中不允许用“小屋日常”绕过无记录事实边界', () => {
    const result = guardSelfClaims({
      text: '至于我自己这会儿在干什么，那是我小屋里的日常，跟小镇活动是两回事，不能混在一起算。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).not.toMatch(/小屋里的日常|这会儿在干什么/);
  });

  it('小镇活动没有感官证据时拦截风冷描写', () => {
    const result = guardSelfClaims({
      text: '走了一段，风有点凉。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_sensory');
  });

  it('清理被删句子留下的行首闭引号和孤立括号', () => {
    const result = guardSelfClaims({
      text: '你说的咖啡馆记录我没有。\n\n」其他没有。\n\n）',
      virtualTownQuestion: true,
    });

    expect(result.text).toBe('你说的咖啡馆记录我没有。\n\n其他没有。');
  });

  it('清理修复后句首残留的句号', () => {
    const result = guardSelfClaims({
      text: '现实活动没有记录。\n\n。咖啡馆倒咖啡那件事没有记录。',
      virtualTownQuestion: true,
    });

    expect(result.text).toBe('现实活动没有记录。\n\n咖啡馆倒咖啡那件事没有记录。');
  });

  it('小镇问答内容被删空时使用明确的无记录回退', () => {
    const result = guardSelfClaims({
      text: '刚才在小屋里煮咖啡，慢慢喝着。',
      virtualTownQuestion: true,
      virtualTownMoodCauseQuestion: true,
    });

    expect(result.text).toBe('我这边没有这段小镇活动的记录。心情变化或原因没有记录。');
  });

  it('小镇没有活动记录时拦截第一人称画画自述并落到无记录回答', () => {
    const result = guardSelfClaims({
      text: '我现在的状态，是在纸上随手画点东西，就这么一小块地方。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
    expect(result.text).toContain('没有这段小镇活动的记录');
    expect(result.text).not.toMatch(/纸上|画点东西/);
  });

  it('普通聊天中也移除没有来源的当下画画自述', () => {
    const result = guardSelfClaims({ text: '我这边正在纸上随手画东西。' });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_self_activity');
    expect(result.text).not.toMatch(/纸上|画东西/);
  });

  it('精确事件证据可以授权虚拟小镇中的画画活动', () => {
    const claim = '我今天在小镇画室画了几笔。';
    const result = guardSelfClaims({
      text: claim,
      virtualTownQuestion: true,
      verifiedClaims: [{ claim, evidenceId: 'virtual-town-art-room-42', exactSentence: true }],
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(claim);
  });

  it('小镇活动问题中保留明确否认未记录活动的句子', () => {
    const text = '我没在书店待过。';
    const result = guardSelfClaims({ text, virtualTownQuestion: true });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('小镇活动问题中保留“没进书店”的明确否认', () => {
    const text = '书店倒是没进去过。';
    const result = guardSelfClaims({ text, virtualTownQuestion: true });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('不会把否认“散步后心情变好”误判成散步活动声明', () => {
    const text = '我没有说过散步之后心情变好了呀。';
    const result = guardSelfClaims({
      text,
      virtualTownQuestion: true,
      virtualTownMoodCauseQuestion: true,
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('小镇活动问题中拦截省略饮品对象的分享暗示', () => {
    const result = guardSelfClaims({
      text: '你要是在旁边，也能分你一杯。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
  });

  it('移除小镇活动编造后补上明确的无记录说明', () => {
    const result = guardSelfClaims({
      text: '我刚才去小镇咖啡馆喝咖啡了。你在做什么？',
      virtualTownQuestion: true,
    });

    expect(result.text).toContain('你在做什么？');
    expect(result.text).toContain('没有这段小镇活动的记录');
    expect(result.text).not.toBe('这句我没有可靠依据，我收回。');
  });

  it('小镇活动问题中拦截没有明确地点的后续活动', () => {
    const result = guardSelfClaims({
      text: '小镇河边走了走，回来磨了点豆子，慢慢喝。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_activity');
  });

  it('小镇活动问题中拦截没有记录支持的感官描写', () => {
    const result = guardSelfClaims({
      text: '河边水声一阵一阵的，风吹过来挺舒服。',
      virtualTownQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_sensory');
  });

  it('追问小镇活动对心情的影响时拦截没有记录支持的散步归因', () => {
    const result = guardSelfClaims({
      text: '散步本身，慢慢走一段，确实让人松一点。',
      virtualTownMoodCauseQuestion: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_virtual_cause');
  });

  it.each([
    ['third-party-cause', '他刚才走神了，回家后才发现书落在桌上。'],
    ['ordinary-accountability', '刚才是我没接住你的意思，对不起。我会认真听你说。'],
    ['ordinary-emotion', '我现在有点难过，但说不上来为什么。'],
    ['creative-metaphor', '我觉得这个方案像是在画饼。'],
    ['metaphor', '听你讲完，我像是跟着走了一圈。'],
    ['visible-conversation-action', '我看到了你发来的消息，也明白你为什么生气。'],
    ['quoted-claim', '你问“昨晚我翻了几页书”，其实我没有真实的线下生活。'],
    ['cause-word-unrelated-to-reply', '我刚才走神，回家后才发现书落在桌上。'],
    ['cause-explicit-uncertainty', '我也不知道是不是太困才回得慢。'],
    ['cause-explicit-denial', '我不是因为偷懒才回复得这么简单。'],
  ] as const)('%s：不误伤无关表达', (_id, text) => {
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('移除没有来源的懒惰原因，同时保留对上一句回复负责的道歉', () => {
    const result = guardSelfClaims({
      text: '刚才确实有点懒，随手就接了一句，没认真。你指出得对。',
    });

    expect(result.accepted).toBe(false);
    expect(result.text).not.toMatch(/有点懒|随手就接了一句/);
    expect(result.text).toMatch(/刚才那句|上一句/);
    expect(result.text).toMatch(/没回应好|没认真/);
    expect(result.changes).toContain('unsupported_self_cause_removed:1');
  });

  it('移除无来源的具体离线活动，但保留其他正常回应', () => {
    const result = guardSelfClaims({
      text: '昨晚我翻了几页书，没看进去。你现在愿意继续说，我会认真听。',
    });

    expect(result.text).not.toMatch(/翻了几页书|没看进去/);
    expect(result.text).toContain('你现在愿意继续说');
    expect(result.text).toContain('我会认真听');
    expect(result.changes).toContain('unsupported_self_activity_removed:1');
  });

  it('有精确的可信来源记录时保留对应自我活动', () => {
    const claim = '昨晚我翻了几页书，没看进去。';
    const result = guardSelfClaims({
      text: claim,
      verifiedClaims: [{ claim, evidenceId: 'activity:reading:42' }],
    });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(claim);
  });

  it('不改写基于对话可见事实的道歉、承诺和自我纠错', () => {
    const text = '刚才是我没接住你的意思，对不起。我会认真听你说。';
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('不把用户或第三方的经历误判成角色自身经历', () => {
    const text = '你昨晚翻了几页书，还是没看进去吧？';
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('同一句谈到用户时，仍能找到明确的第一人称自身活动', () => {
    const result = guardSelfClaims({
      text: '你昨晚没睡好吧？我昨晚翻了几页书，没看进去。',
    });

    expect(result.text).toContain('你昨晚没睡好吧？');
    expect(result.text).not.toContain('我昨晚翻了几页书');
  });

  it('不改写明确指向第三方的原因描述', () => {
    const text = '他刚才有点懒，随手就接了一句，没认真。';
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('保留普通的此刻情绪表达，由 ExpressionPlan 负责校验', () => {
    const text = '我现在有点难过，但说不上来为什么。';
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('拦截没有来源的此刻身体活动，不把“正在煮咖啡”当成角色情绪', () => {
    const result = guardSelfClaims({
      text: '说不上来，就是懒懒的。在煮咖啡，慢慢喝着。',
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_self_activity');
    expect(result.text).not.toMatch(/煮咖啡|喝着/);
  });

  it('拦截没有来源的身体姿势和场景细节', () => {
    const result = guardSelfClaims({
      text: '我这边懒懒的，靠着窗发呆，脑子转得慢。',
    });

    expect(result.accepted).toBe(false);
    expect(result.violations.map(v => v.kind)).toContain('unsupported_self_activity');
    expect(result.text).not.toMatch(/靠着窗|发呆/);
  });

  it('不把第三方此刻的身体活动归到角色自身', () => {
    const text = '他正在煮咖啡，等会儿就回来。';
    const result = guardSelfClaims({ text });

    expect(result.accepted).toBe(true);
    expect(result.text).toBe(text);
  });

  it('拦截无法验证的关系性自责，保留对具体回复负责的表述', () => {
    const result = guardSelfClaims({
      text: '可能只是那一刻没把你放在该有的位置上，但这不构成借口。刚才那句没有接住你的重点。',
    });

    expect(result.accepted).toBe(false);
    expect(result.text).not.toContain('没把你放在该有的位置上');
    expect(result.text).toContain('刚才那句没有接住你的重点');
  });
});
