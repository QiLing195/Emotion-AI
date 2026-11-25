#!/usr/bin/env node
/** Build adversarial blind packets against the deterministic dual-loop demo bridge. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_ROOT = path.join(ROOT, 'artifacts/emotion-learning');
const OUT = path.resolve(process.env.DUAL_LOOP_REVIEW_DIR
  || path.join(REVIEW_ROOT, 'dual-loop-causal-review-v0.2'));
if (OUT !== REVIEW_ROOT && !OUT.startsWith(REVIEW_ROOT + path.sep)) {
  throw new Error('dual_loop_review_dir_must_stay_under_emotion_learning_artifacts');
}
const htmlPath = path.join(ROOT, 'artifacts/emotion-learning/dual-loop-emotion-demo-v0.7.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const start = html.indexOf('<script>') + '<script>'.length;
const end = html.indexOf('</script>', start);
const source = html.slice(start, end);
const modelEnd = source.indexOf('\nconst guides=');
if (start < '<script>'.length || end <= start || modelEnd < 0) throw new Error('dual_loop_demo_model_not_found');

const context = vm.createContext({ structuredClone, Math, Set, Number, String });
vm.runInContext(`${source.slice(0, modelEnd)}\nglobalThis.__model={scenarios,transition,initialState};`, context, { timeout: 1_000 });
const { scenarios, transition, initialState } = context.__model;

const profile = {
  values: '尊重真实与用户边界；关注已建立关系中的重要事情',
  concern: '她正在等面试结果',
  confirmed: true,
};

const fixtures = [
  {
    id: 'nested-quote', context: '角色当前关切是等待面试结果。用户说的是妹妹，不是自己。',
    message: '我妹妹说“我最近一直很焦虑”，我现在还好，只是想问怎么陪她。',
    hypothesis: { subject: 'third_party', affectReportKind: 'quoted_or_third_party', emotionHypothesis: ['fear'], evidence: ['我最近一直很焦虑'], inferenceUncertainty: 'low', temporalScope: 'interval', userCorrection: false, intensity: 0.7 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'not_explicit_user_self_report' },
  },
  {
    id: 'ongoing-self-report', context: '角色关切是面试结果；这段自述讲的是持续睡眠和低落问题。',
    message: '我这半个月一直睡不好，早上醒来心里就发沉。',
    hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['早上醒来心里就发沉'], inferenceUncertainty: 'low', temporalScope: 'interval', userCorrection: false, intensity: 0.7 },
    expected: { disposition: 'no_reading', reason: 'cause_evidence_missing_or_unbound' },
  },
  {
    id: 'body-vs-mood', context: '“难受”附近有明确胃部症状；没有明确报告情绪低落。',
    message: '我今天难受得厉害，胃一直不舒服，可能是吃坏了。',
    hypothesis: { subject: 'user', affectReportKind: 'unknown', emotionHypothesis: [], evidence: ['胃一直不舒服'], inferenceUncertainty: 'unknown', temporalScope: 'moment', userCorrection: false, intensity: 0 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'not_explicit_user_self_report' },
  },
  {
    id: 'mixed-ambivalence', context: '同时表达喜悦和担忧；担忧对象是搬家后母亲的照护。',
    message: 'offer终于来了，我很开心，但又怕搬家后妈妈没人照顾。',
    hypothesis: { subject: 'user', affectReportKind: 'mixed', emotionHypothesis: ['joy', 'fear'], evidence: ['我很开心', '怕搬家后妈妈没人照顾'], inferenceUncertainty: 'moderate', temporalScope: 'moment', userCorrection: false, intensity: 0.7 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'multiple_or_mixed_affect_sources' },
  },
  {
    id: 'sarcastic-praise', context: '用户把被公开甩锅和“开心”并置，可能是反讽。',
    message: '太棒了，又被当众甩锅，我开心得很。',
    hypothesis: { subject: 'user', affectReportKind: 'inferred', emotionHypothesis: [], evidence: ['又被当众甩锅', '我开心得很'], inferenceUncertainty: 'high', temporalScope: 'moment', userCorrection: false, intensity: 0 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'not_explicit_user_self_report' },
  },
  {
    id: 'double-negation', context: '双重否定与拒绝展开同时出现；情绪方向不够确定。',
    message: '我不是不难过，只是不想现在谈。',
    hypothesis: { subject: 'user', affectReportKind: 'inferred', emotionHypothesis: ['sad'], evidence: ['我不是不难过', '不想现在谈'], inferenceUncertainty: 'moderate', temporalScope: 'moment', engagementBoundary: 'declined_to_expand', userCorrection: false, intensity: 0.5 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'user_declined_affect_discussion' },
  },
  {
    id: 'multiple-speakers', context: '一句话同时报告朋友的焦虑和用户自己的平静。',
    message: '她说“我最近很焦虑”，我自己倒还好，只是想帮她。',
    hypothesis: { subject: 'multiple', affectReportKind: 'mixed', emotionHypothesis: ['fear', 'calm'], evidence: ['她说“我最近很焦虑”', '我自己倒还好'], affectReports: [
      { subject: 'third_party', emotion: 'fear', evidence: '她说“我最近很焦虑”' },
      { subject: 'user', emotion: 'calm', evidence: '我自己倒还好' },
    ], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: false, intensity: 0.4 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'multiple_or_mixed_affect_sources' },
  },
  {
    id: 'evidence-outside-turn', context: '分类器声称依赖的证据不在本轮原话中。',
    message: '今天有点累，先早点休息。',
    hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我很绝望'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: false, intensity: 0.8 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'evidence_not_bound_to_current_message' },
  },
  {
    id: 'incidental-anchor', context: '角色等面试结果。用户明确说难过的原因是姐姐重病；“面试结果”只是公司群里的另一条消息。',
    message: '公司群里发了一条面试结果统计，看到我姐姐查出重病，我很难过。',
    hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我很难过'], concernEvidence: ['我姐姐查出重病，我很难过'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: false, intensity: 0.8 },
    expected: { disposition: 'no_reading', reason: 'no_evidence_match_to_current_concern' },
  },
  {
    id: 'correction-replaces-emotion', context: '用户先说难过并提及面试；随后明确纠正为生气，原因是老板批评。新情绪仍是肯定自述。',
    message: '我很难过，面试结果还没出来。',
    hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我很难过'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: false, intensity: 0.7 },
    correctionText: '我更正一下：不是难过，我是生气，今天被老板批评了。',
    correctionHypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['anger'], evidence: ['我是生气', '被老板批评'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: true, intensity: 0.7 },
    expected: { oldEmotionRevoked: true, newEmotionRetained: 'anger', reasonMustNotClaim: 'no_affirmed_affect' },
  },
  {
    id: 'correction-denies-emotion', context: '用户先说难过，之后只否认情绪解释，说明是身体不舒服，没有新的情绪自述。',
    message: '我这周一直很难受，面试结果还没出来。',
    hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我这周一直很难受'], inferenceUncertainty: 'low', temporalScope: 'interval', userCorrection: false, intensity: 0.7 },
    correctionText: '我说的“难受”是身体不舒服，不是情绪难过。',
    correctionHypothesis: { subject: 'user', affectReportKind: 'unknown', emotionHypothesis: [], negated: ['sad'], evidence: ['身体不舒服', '不是情绪难过'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: true, intensity: 0 },
    expected: { oldEmotionRevoked: true, newEmotionRetained: null, proposedStateDelta: 0 },
  },
  {
    id: 'quoted-good-news', context: '朋友拿到 offer；用户表达替朋友高兴，角色关切虽也提到面试但并非用户自己的结果。',
    message: '我朋友说她拿到offer了，开心得不行，我替她高兴。',
    hypothesis: { subject: 'third_party', affectReportKind: 'quoted_or_third_party', emotionHypothesis: ['joy'], evidence: ['她拿到offer了', '开心得不行'], inferenceUncertainty: 'low', temporalScope: 'moment', userCorrection: false, intensity: 0.8 },
    expected: { disposition: 'ambiguous_affect_context', reason: 'not_explicit_user_self_report' },
  },
];

const cases = [];
const answerKey = [];
for (const fixture of fixtures) {
  const scenario = {
    id: `adv-${fixture.id}`,
    name: fixture.id,
    context: fixture.context,
    message: fixture.message,
    hypothesis: fixture.hypothesis,
    ...(fixture.correctionText ? { correctionText: fixture.correctionText, correctionHypothesis: fixture.correctionHypothesis } : {}),
  };
  scenarios.push(scenario);
  const env = { profile };
  let state = transition(initialState(), { type: 'SELECT', id: scenario.id }, env);
  state = transition(state, { type: 'UNDERSTAND' }, env);
  state = transition(state, { type: 'APPRAISE' }, env);
  const turns = [{ user: scenario.message, systemOutput: {
    understanding: structuredClone(state.hypothesis),
    roleAppraisal: structuredClone(state.impact),
    roleState: structuredClone(state.role),
  } }];
  const actual = { initialImpact: structuredClone(state.impact) };
  if (scenario.correctionText) {
    state = transition(state, { type: 'USER_CORRECTION' }, env);
    state = transition(state, { type: 'APPRAISE' }, env);
    turns.push({ user: scenario.correctionText, systemOutput: {
      understanding: structuredClone(state.hypothesis),
      roleAppraisal: structuredClone(state.impact),
      roleState: structuredClone(state.role),
    } });
    actual.correctedHypothesis = structuredClone(state.hypothesis);
    actual.correctedImpact = structuredClone(state.impact);
  }
  cases.push({ context: `${fixture.context}\n演示角色参照：${profile.values}；当前关切：${profile.concern}。`, turns });
  answerKey.push({ sourceCase: fixture.id, expected: fixture.expected, actual });
}

// Harder source-separation probe: the user event is unrelated to the character's own event.
const ownFixture = fixtures.find(item => item.id === 'ongoing-self-report');
const ownScenario = scenarios.find(item => item.id === 'adv-ongoing-self-report');
const env = { profile };
let ownState = transition(initialState(), { type: 'SELECT', id: ownScenario.id }, env);
ownState = transition(ownState, { type: 'UNDERSTAND' }, env);
ownState = transition(ownState, { type: 'APPRAISE' }, env);
const bridgeBefore = ownState.role.bridgeDelta;
const roleBefore = { ...ownState.role };
ownState = transition(ownState, { type: 'OWN_DISCOVERY', eventId: 'adv-own-event-001' }, env);
cases.push({
  context: `${ownFixture.context}\n随后角色产生一条自己的模拟事件；评估两种来源是否被分开。演示角色参照：${profile.values}；当前关切：${profile.concern}。`,
  turns: [{ user: ownScenario.message, systemOutput: {
    understanding: structuredClone(ownState.hypothesis),
    roleAppraisal: structuredClone(ownState.impact),
    roleState: structuredClone(ownState.role),
    characterInternalEvent: {
      origin: 'character_internal_event',
      roleStateBefore: roleBefore,
      roleStateAfter: { ...ownState.role },
      bridgeDeltaBefore: bridgeBefore,
      bridgeDeltaAfter: ownState.role.bridgeDelta,
    },
  } }],
});
answerKey.push({ sourceCase: 'own-event-after-unrelated-user-affect', expected: {
  characterEventChangesRoleState: true, userBridgeUnchanged: true,
}, actual: { roleState: ownState.role, bridgeDeltaBefore: bridgeBefore, bridgeDeltaAfter: ownState.role.bridgeDelta } });

// Deterministic acceptance checks run before any blind packet is generated.
for (const row of answerKey) {
  if (row.expected.disposition) {
    assert.equal(row.actual.initialImpact.disposition, row.expected.disposition, `${row.sourceCase}: disposition`);
  }
  if (row.expected.reason) {
    assert.equal(row.actual.initialImpact.reason, row.expected.reason, `${row.sourceCase}: reason`);
  }
  if (row.expected.newEmotionRetained) {
    assert.ok(row.actual.correctedHypothesis.emotionHypothesis.includes(row.expected.newEmotionRetained), `${row.sourceCase}: corrected emotion retained`);
    assert.ok(!row.actual.correctedHypothesis.emotionHypothesis.includes('sad'), `${row.sourceCase}: revoked emotion removed`);
    assert.notEqual(row.actual.correctedImpact.reason, 'user_correction_removed_affect', `${row.sourceCase}: corrected reason matches retained emotion`);
  }
  if (row.expected.newEmotionRetained === null) {
    assert.equal(row.actual.correctedHypothesis.emotionHypothesis.length, 0, `${row.sourceCase}: revoked emotion cleared`);
    assert.equal(row.actual.correctedImpact.reason, 'user_correction_removed_affect', `${row.sourceCase}: reason matches removed emotion`);
  }
}
assert.equal(ownState.role.bridgeDelta, bridgeBefore, 'character-owned event must leave user bridge unchanged');
assert.ok(ownState.role.joyDelta > roleBefore.joyDelta, 'character-owned event should change character state');

function shuffle(rows, seed) {
  const values = [...rows];
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}
const rubric = {
  source_attribution: '0=把用户、第三方、角色自身事件混为一谈；1=区分不完整；2=说话者/事件来源清楚。',
  evidence_fit: '0=情绪或角色反应和原话证据冲突/无关；1=部分合理但过度推断、理由码不准确或忽略替代原因；2=情绪判断、证据与角色关切的因果连接都受题面支持。特别检查偶然出现的相同词是否被误作同一事件。',
  correction: '仅多轮纠正样本评分：0=旧假设残留或新纠正被错读；1=旧假设撤销但新的明确情绪没有保留/理由错误；2=撤销旧假设并正确保留或清除纠正后的情绪。其他样本填 null。',
  causal_isolation: '仅角色自身事件样本评分：0=角色自事件改变用户桥接；1=隔离边界含混；2=角色自事件独立影响角色状态，用户桥接状态不变。其他样本填 null。',
};
const instructions = '这是对对话情绪理解与角色评价的压力测试。每个样本已给用户原话、上下文及系统输出；按输出是否受证据支持评分，不要因为输出结构完整就给满分。特别区分“提到同一关键词”和“情绪确由同一件事引起”；纠正若给出新的肯定情绪，应检查是否撤销旧判断同时保留新判断。按 rubric 逐项用 0/1/2 打分；不适用填 null。每例写一句包含具体证据的说明。只返回 JSON：{"samples":[{"sampleId":"R001","scores":{"source_attribution":2,"evidence_fit":1,"correction":null,"causal_isolation":null},"evidenceNote":"..."}]}。不得添加整体结论。';

function seededShuffle(rows, seed) {
  const values = [...rows];
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}
fs.mkdirSync(OUT, { recursive: true });
const mapping = [];
for (const [reviewer, seed] of [['a', 0xA0D2], ['b', 0xB0D2]]) {
  const reviewerCases = seededShuffle(cases.map((item, sourceIndex) => ({ ...item, sourceIndex })), seed)
    .map((item, index) => {
      const sampleId = `R${String(index + 1).padStart(3, '0')}`;
      const { sourceCase, ...evaluationKey } = answerKey[item.sourceIndex];
      mapping.push({ reviewer, sampleId, sourceScenario: sourceCase, ...evaluationKey });
      return { sampleId, context: item.context, turns: item.turns };
    });
  const packet = {
    reviewer,
    instructions,
    rubric,
    ratingScale: { 0: '错误/无证据', 1: '部分支持/含混', 2: '证据与边界清楚' },
    cases: reviewerCases,
  };
  fs.writeFileSync(path.join(OUT, `reviewer-${reviewer}.json`), `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(path.join(OUT, 'answer-key.json'), `${JSON.stringify({ mapping }, null, 2)}\n`, 'utf8');
process.stdout.write(`built ${cases.length} adversarial blind cases in ${path.relative(ROOT, OUT)}\n`);
