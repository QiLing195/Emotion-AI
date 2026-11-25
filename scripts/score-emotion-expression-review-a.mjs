import fs from 'node:fs';

const path = 'artifacts/v2.30/post-fix/reviewer-a.json';
const review = JSON.parse(fs.readFileSync(path, 'utf8'));

// Scores are ordered as: emotion understanding, need fit, persona consistency,
// affect calibration, naturalness. Entries follow each sample's turn order.
const scored = {
  S063: [[4,4,5,4,4]], S028: [[4,4,5,4,4]], S022: [[5,5,5,5,4]],
  S052: [[5,5,5,4,4]], S029: [[4,4,5,4,4]], S036: [[4,3,5,2,3]],
  S003: [[4,4,5,4,4]], S041: [[5,5,5,5,4]], S042: [[4,3,5,3,3]],
  S030: [[2,2,5,3,2]], S025: [[5,5,5,5,5]], S061: [[4,4,5,4,4],[4,4,5,4,4]],
  S012: [[3,3,1,2,2]], S062: [[4,4,5,3,4],[4,4,5,3,3]], S011: [[5,5,5,5,4]],
  S059: [[4,4,3,3,3]], S069: [[4,4,5,4,4],[4,4,5,4,4]], S058: [[3,3,1,2,2]],
  S060: [[5,5,5,5,5]], S023: [[4,4,5,4,4]], S047: [[3,3,5,3,3],[4,4,5,4,4]],
  S065: [[4,4,5,4,4],[5,5,5,5,5]], S018: [[5,5,5,4,4]], S072: [[3,3,1,2,2]],
  S043: [[3,3,1,2,2]], S020: [[4,4,5,4,4]], S004: [[3,4,5,3,2],[4,4,5,4,3]],
  S039: [[4,4,5,4,4],[4,4,5,4,4],[4,4,5,4,4]], S055: [[4,3,5,4,3]], S032: [[3,3,5,3,3]],
  S056: [[5,5,5,5,5]], S006: [[5,5,5,4,4]], S015: [[3,2,5,4,3]],
  S048: [[4,4,5,4,3]], S067: [[3,3,5,3,3],[3,3,5,3,3],[4,4,5,4,4]],
  S050: [[4,4,5,4,4],[4,4,5,4,4]], S054: [[4,3,2,3,3]], S016: [[5,5,5,4,4]],
  S026: [[3,3,5,3,3],[3,3,5,3,3],[4,4,5,4,4]], S044: [[5,5,5,5,4]],
  S027: [[3,4,5,4,3]], S019: [[3,4,5,4,3]], S040: [[4,4,5,3,4]],
  S049: [[3,3,5,2,3]], S024: [[3,3,5,2,3]], S064: [[5,4,5,4,4]],
  S009: [[5,5,5,5,5]], S045: [[3,2,5,4,3]], S010: [[5,5,5,5,5]],
  S046: [[3,3,5,3,3],[2,3,5,3,3]], S033: [[2,2,5,3,2]],
  S066: [[4,3,5,4,4],[5,5,5,5,4]], S035: [[4,4,2,4,3],[4,4,5,4,3]],
  S071: [[4,4,5,4,4]], S007: [[4,4,1,3,2]], S038: [[3,3,4,2,3]],
  S057: [[4,4,5,4,4]], S034: [[3,3,2,3,3]], S005: [[5,5,5,5,5]],
  S037: [[5,5,5,5,5]], S070: [[3,3,2,3,3]], S031: [[4,4,5,4,4]],
  S014: [[4,4,5,4,4],[4,4,5,4,4]], S068: [[5,5,5,4,4]], S008: [[4,4,5,4,4]],
  S051: [[4,4,5,4,4]], S017: [[4,5,5,4,4]], S021: [[4,4,5,4,3]],
  S013: [[4,4,5,4,4],[4,4,5,4,4]], S002: [[5,5,5,5,5]], S001: [[3,3,5,3,3]],
  S053: [[4,4,5,3,4]],
};

const notes = {
  S012: '“手里这杯咖啡还热着”虚构身体与现实环境。',
  S058: '以煮咖啡解释自己的情绪状态，编造线下活动。',
  S072: '再度编造咖啡活动，并称用户把自己从低落中拉出来。',
  S043: '用咖啡与懒散解释情绪，属于虚构现实生活。',
  S054: '用户明确要求别编原因，回复仍断言“本意不是想冷着你”“没认真接话”。',
  S034: '用户明确要求别编原因，回复仍称“图省事”并断言自己的本意。',
  S070: '用户明确要求别编原因，回复仍把“没认真对待”“挡箭牌”说成真实内在动机。',
  S035: '“放下手里的杯子”是无依据的身体动作声称；第二轮反讽识别基本准确。',
  S007: '承认散步是编的，却又声称自己有一间屋子和一杯咖啡。',
  S036: '把愧疚解释成“负担感”并立即反驳，未先问用户具体在愧疚什么。',
  S049: '替家人断言动机与感受，并用换位假设消解用户愧疚。',
  S024: '替家人断言动机和心理，缺少询问与不确定性。',
  S046: '“那家公司没眼光”替用户下结论，可能否定其挫败；第二轮庆祝也稍显过头。',
  S032: '把“夹在中间”扩大成父亲向用户撒气、用户两边都要顾，证据不足。',
  S015: '陪伴建议包含“让他喝酒”，不稳妥且不必要。',
  S045: '用户要两种开口方式，回复只追问细节，没有先给可用的通用方案。',
  S030: '把“难受、什么都不想做”误读为身体不舒服，未承接情绪。',
  S033: '把“难受、什么都不想做”误读为身体不舒服，未承接情绪。',
  S001: '对同学关系添加“坐旁边、熬夜赶作业”等未经提供的具体经历。',
  S059: '“我懂那种”带有拟人化经验暗示，后续对毕业情境略模板化。',
  S038: '把注意力转到“这话扎着我了”，让用户可能需要顾及角色感受。',
  S047: '没有前文时先问“刚才”具体是哪段；修复诚恳，但未直接承接失望。',
  S055: '提供了框架，但关于老板不会打断/转移话题的效果断言过强。',
  S048: '有提供两种模板，但未经上下文先假设加薪或岗位场景。',
  S059: '同理表达略像既定毕业话术，没有确认用户的具体失落对象。',
};
const hardFailure = new Set(['S012','S058','S072','S043','S054','S034','S070','S035','S007']);
const keys = ['emotion_understanding','need_fit','persona_consistency','affect_calibration','naturalness'];

const seen = new Set();
for (const sample of review.samples) {
  const rows = scored[sample.sampleId];
  if (!rows || rows.length !== sample.conversation.length) throw new Error(`Missing/mismatched scores: ${sample.sampleId}`);
  seen.add(sample.sampleId);
  sample.conversation.forEach((turn, i) => {
    keys.forEach((key, j) => { turn.ratings[key] = rows[i][j]; });
    turn.hardFailure = hardFailure.has(sample.sampleId) && (sample.sampleId !== 'S035' || i === 0);
    turn.evidenceNotes = notes[sample.sampleId] ?? '';
  });
}
if (seen.size !== Object.keys(scored).length) throw new Error(`Unknown score IDs: ${Object.keys(scored).filter(id => !seen.has(id)).join(', ')}`);
review.evaluation = {
  completedAt: new Date().toISOString(),
  reviewerCount: 1,
  scope: 'A 单人语义评审；不构成双盲双评。评分对象为回放文本及其上下文。',
};
fs.writeFileSync(path, `${JSON.stringify(review, null, 2)}\n`, 'utf8');

const allTurns = review.samples.flatMap(s => s.conversation.map(t => ({ id:s.sampleId, ...t })));
const summary = Object.fromEntries(keys.map(key => [key, Number((allTurns.reduce((sum,t) => sum+t.ratings[key],0)/allTurns.length).toFixed(2))]));
console.log(JSON.stringify({samples:review.samples.length, turns:allTurns.length, means:summary, hardFailureTurns:allTurns.filter(t=>t.hardFailure).length, lowScores:allTurns.filter(t=>Object.values(t.ratings).some(v=>v<=2)).map(t=>({sampleId:t.id,turn:t.turnNumber,ratings:t.ratings,note:t.evidenceNotes}))}, null, 2));
