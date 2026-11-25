import { describe, expect, it } from 'vitest';
import { enforceExpressionPlan } from '../expressionEnforcement.js';
import type { ExpressionPlan } from '../expressionPlan.js';

type Case = {
  name: string;
  reply: string;
  plan: Partial<ExpressionPlan>;
  keep?: string[];
  remove?: string[];
  unchanged?: boolean;
};

const basePlan: ExpressionPlan = {
  decision: 'express',
  reason: 'express:sad(transient)',
  emotion: 'sad',
  tone: 'quiet',
  duration: 'unknown',
  maxSentences: 1,
  maxQuestions: 1,
  evidence: null,
  causeQuote: null,
  sourceEventId: null,
  confidence: 0.7,
};

const cases: Case[] = [
  // 01–10: 直接提问且情绪明确，只留一处符合计划的状态。
  { name: 'sad: 此刻低落', reply: '我现在有点沉。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['有点沉'] },
  { name: 'sad: 低落与喜悦混写', reply: '我有点沉。不过替你高兴。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['有点沉'], remove: ['替你高兴'] },
  { name: 'sad: 往下坠的口语表达', reply: '我这边往下坠了一点。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['往下坠'] },
  { name: 'sad: 无主语发闷', reply: '这会儿心里发闷。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['心里发闷'] },
  { name: 'sad: 提不起劲', reply: '提不太起劲。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['提不太起劲'] },
  { name: 'joy: 开心', reply: '我挺开心的。', plan: { directQuestion: true, emotion: 'joy' }, keep: ['挺开心'] },
  { name: 'anger: 生气', reply: '我现在有点生气。', plan: { directQuestion: true, emotion: 'anger' }, keep: ['有点生气'] },
  { name: 'fear: 不安', reply: '我心里有些不安。', plan: { directQuestion: true, emotion: 'fear' }, keep: ['不安'] },
  { name: 'disgust: 反感', reply: '我有点反感。', plan: { directQuestion: true, emotion: 'disgust' }, keep: ['反感'] },
  { name: 'gratitude: 感激', reply: '我挺感激的。', plan: { directQuestion: true, emotion: 'gratitude' }, keep: ['感激'] },

  // 11–20: 直接提问但状态不明确，不让模型自行补具体情绪。
  { name: 'unclear: 无主语低落', reply: '说不上来，有点沉。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_unclear' }, keep: ['说不上来'], remove: ['有点沉'] },
  { name: 'unclear: 明确自我发闷', reply: '我听着心里发闷，但说不清是什么。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['说不清'], remove: ['心里发闷'] },
  { name: 'unclear: 烦躁', reply: '我感觉有些烦。现在说不上来。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['说不上来'], remove: ['有些烦'] },
  { name: 'unclear: 无主语踏实', reply: '反而觉得踏实。也说不上为什么。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['说不上为什么'], remove: ['踏实'] },
  { name: 'unclear: 关系性高兴', reply: '我替你感到开心，但自己的心情说不准。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['说不准'], remove: ['替你感到开心'] },
  { name: 'unclear: 焦虑', reply: '我有点焦虑。暂时说不清原因。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_unclear' }, keep: ['说不清原因'], remove: ['有点焦虑'] },
  { name: 'unclear: 两种状态并列', reply: '有点难过，也有点生气。说不清哪种更多。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['说不清'], remove: ['难过', '生气'] },
  { name: 'unclear: 持续时长不应泄漏', reply: '我这两天一直有点沉。现在也说不上来。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_unclear' }, keep: ['说不上来'], remove: ['有点沉', '这两天', '一直'] },
  { name: 'unclear: 喜悦与担心混合', reply: '有点开心，也挺担心的。还没想清楚。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_ambiguous' }, keep: ['还没想清楚'], remove: ['开心', '担心'] },
  { name: 'unclear: 仅表达未知，不误删', reply: '我现在也说不上来，没什么特别的感觉。', plan: { directQuestion: true, emotion: null, reason: 'direct_question_unclear' }, keep: ['说不上来', '没什么特别的感觉'] },

  // 21–30: silent 计划移除自身披露，同时保留对用户的回应。
  { name: 'silent: 句首无主语低落', reply: '有点沉。你今天真的不容易。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你今天真的不容易'], remove: ['有点沉'] },
  { name: 'silent: 句尾自身感受', reply: '你被批评这件事，我听着心里发闷。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你被批评这件事'], remove: ['心里发闷'] },
  { name: 'silent: 多句表达', reply: '我有点难过。你愿意告诉我发生了什么。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你愿意告诉我'], remove: ['有点难过'] },
  { name: 'silent: 反而踏实', reply: '你慢慢说，我反而觉得踏实。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你慢慢说'], remove: ['觉得踏实'] },
  { name: 'silent: 替用户高兴', reply: '你拿到 offer 了，替你开心。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你拿到 offer 了'], remove: ['替你开心'] },
  { name: 'silent: 引述他人情绪', reply: '你说朋友很难过，我听着也有些沉。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你说朋友很难过'], remove: ['有些沉'] },
  { name: 'silent: 自身不安', reply: '你不用马上决定。我有点不安。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你不用马上决定'], remove: ['有点不安'] },
  { name: 'silent: 自身愤怒', reply: '他这样对你确实不公平，我也挺生气。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['对你确实不公平'], remove: ['挺生气'] },
  { name: 'silent: 自身心动', reply: '你记得我说过的话，我有点心动。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你记得我说过的话'], remove: ['心动'] },
  { name: 'silent: 自身感谢', reply: '你愿意听我说，我挺感激的。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你愿意听我说'], remove: ['感激'] },

  // 31–40: 用户/第三方情绪与事实不能被当成她的自我披露。
  { name: '保留: 理解用户难过', reply: '我理解你很难过。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['我理解你很难过'], unchanged: true },
  { name: '保留: 用户担心工作', reply: '你担心做不好很正常。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你担心做不好'], unchanged: true },
  { name: '保留: 转述朋友愤怒', reply: '你朋友现在很生气。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['你朋友现在很生气'], unchanged: true },
  { name: '保留: 用户喜悦', reply: '你拿到 offer，听起来很开心。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['听起来很开心'], unchanged: true },
  { name: '保留: 对用户的担心判断', reply: '我猜你是在担心新工作的节奏。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['担心新工作的节奏'], unchanged: true },
  { name: '保留: 他人难过', reply: '他现在很难过，先陪在他身边吧。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['他现在很难过'], unchanged: true },
  { name: '保留: 引号内情绪', reply: '你说“我很生气”，听起来这事让你很受伤。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['我很生气', '让你很受伤'], unchanged: true },
  { name: '保留: 用户心动', reply: '你说见到她会心动，这很正常。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['会心动'], unchanged: true },
  { name: '保留: 用户厌恶', reply: '你对这种做法反感，可以直接说出来。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['反感'], unchanged: true },
  { name: '保留: 用户疲惫', reply: '你听起来有些累，今天先休息也可以。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['有些累'], unchanged: true },

  // 41–50: 普通 express 计划的披露上限与句子边界。
  { name: 'cap: sad 后接 joy', reply: '我现在有点沉。替你高兴。', plan: { emotion: 'sad', maxSentences: 1 }, keep: ['有点沉'], remove: ['替你高兴'] },
  { name: 'cap: joy 后接 fear', reply: '我挺开心。也有些担心。', plan: { emotion: 'joy', maxSentences: 1 }, keep: ['挺开心'], remove: ['有些担心'] },
  { name: 'cap: anger 后接 sadness', reply: '我很生气。后来又有点难过。', plan: { emotion: 'anger', maxSentences: 1 }, keep: ['很生气'], remove: ['有点难过'] },
  { name: 'cap: fear 后接 calm', reply: '我有些紧张。现在又安静下来了。', plan: { emotion: 'fear', maxSentences: 1 }, keep: ['有些紧张'], remove: ['安静下来了'] },
  { name: 'cap: 第一人称状态句', reply: '我现在有点沉。你说的那句话我记下了。', plan: { emotion: 'sad', maxSentences: 1 }, keep: ['有点沉', '我记下了'], unchanged: true },
  { name: 'cap: 不改用户事实', reply: '我有点开心。你下周一入职。', plan: { emotion: 'joy', maxSentences: 1 }, keep: ['有点开心', '下周一入职'], unchanged: true },
  { name: 'cap: 用户内容同句保留', reply: '你终于拿到 offer 了，我替你高兴。', plan: { emotion: 'joy', maxSentences: 1 }, keep: ['你终于拿到 offer 了'], unchanged: true },
  { name: 'cap: 中英文情绪分隔', reply: '我有点 happy。之后有点 worried。', plan: { emotion: 'joy', maxSentences: 1 }, keep: ['happy'], remove: ['worried'] },
  { name: 'cap: 同句双状态', reply: '我先是难过，后来又有些生气。', plan: { emotion: 'sad', maxSentences: 1 }, keep: ['难过'], remove: ['生气'] },
  { name: 'cap: 无状态内容不计数', reply: '我在听。你可以继续说。', plan: { emotion: 'sad', maxSentences: 1 }, keep: ['我在听', '你可以继续说'], unchanged: true },
  { name: 'edge: 否定情绪不匹配计划', reply: '我其实并不难过，只是有点担心。', plan: { directQuestion: true, emotion: 'sad' }, remove: ['并不难过', '有点担心'] },
  { name: 'edge: 反讽引语不是她的自述', reply: '你说“我可真是太开心了”，听起来像在反讽。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['我可真是太开心了', '听起来像在反讽'], unchanged: true },
  { name: 'real: silent 下的松口气是自身情绪', reply: '听你这么说，我松了口气。', plan: { decision: 'silent', emotion: null, maxSentences: 0 }, keep: ['听你这么说'], remove: ['松了口气'] },
  { name: 'real: 直接问她时情绪未缓回来也计入额度', reply: '说不上来，有点沉。你这一晚事情很多，情绪还没缓回来。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['有点沉'], remove: ['情绪还没缓回来'] },
  { name: 'real: “我跟着堵”是第二处自身情绪表达', reply: '有点往下沉。你骂老板那会儿我跟着堵，后来还有别的事。', plan: { directQuestion: true, emotion: 'sad' }, keep: ['有点往下沉'], remove: ['我跟着堵'] },
];

describe('ExpressionGuard 中文情绪表达回归集（55 cases）', () => {
  it.each(cases)('$name', ({ reply, plan: overrides, keep = [], remove = [], unchanged }) => {
    const result = enforceExpressionPlan(reply, { ...basePlan, ...overrides });
    for (const phrase of keep) expect(result.text, `应保留：${phrase}`).toContain(phrase);
    for (const phrase of remove) expect(result.text, `应移除：${phrase}`).not.toContain(phrase);
    if (unchanged) expect(result.text).toBe(reply);
  });
});
