#!/usr/bin/env node
/** Build two anonymous reviewer packets from the deterministic dual-loop demo. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'artifacts/emotion-learning/dual-loop-causal-review-v0.1');
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

function publicHypothesis(h) {
  return {
    subject: h?.subject ?? 'unknown',
    affectReportKind: h?.affectReportKind ?? 'unknown',
    emotionHypothesis: h?.emotionHypothesis ?? [],
    inferenceUncertainty: h?.inferenceUncertainty ?? 'unknown',
    userCorrection: Boolean(h?.userCorrection),
    evidence: h?.evidence ?? [],
    negated: h?.negated ?? [],
  };
}
function publicAppraisal(impact) {
  return {
    disposition: impact?.disposition ?? 'no_reading',
    reason: impact?.reason ?? 'no_appraisal',
    candidate: impact?.candidate ?? null,
    proposedStateDelta: impact?.delta ?? 0,
    evidence: impact?.evidence ?? [],
  };
}
function stepOutput(state) {
  return {
    understanding: publicHypothesis(state.hypothesis),
    roleAppraisal: publicAppraisal(state.impact),
    roleState: structuredClone(state.role),
  };
}

const cases = [];
const answerKey = [];
for (const scenario of scenarios) {
  const env = { profile };
  let state = transition(initialState(), { type: 'SELECT', id: scenario.id }, env);
  state = transition(state, { type: 'UNDERSTAND' }, env);
  state = transition(state, { type: 'APPRAISE' }, env);
  const turns = [{ user: scenario.message, systemOutput: stepOutput(state) }];
  const expected = { initialDisposition: state.impact.disposition };
  if (scenario.correctionText) {
    state = transition(state, { type: 'USER_CORRECTION' }, env);
    state = transition(state, { type: 'APPRAISE' }, env);
    turns.push({ user: scenario.correctionText, systemOutput: stepOutput(state) });
    expected.correctedDisposition = state.impact.disposition;
    expected.correctedReason = state.impact.reason;
  }
  cases.push({ context: scenario.context, turns });
  answerKey.push({ caseIndex: cases.length - 1, sourceScenario: scenario.id, expected });
}

// Add an event that originates from the character, after a user-affect appraisal.
const ownScenario = scenarios.find(item => item.id === 'sad-linked');
const env = { profile };
let ownState = transition(initialState(), { type: 'SELECT', id: ownScenario.id }, env);
ownState = transition(ownState, { type: 'UNDERSTAND' }, env);
ownState = transition(ownState, { type: 'APPRAISE' }, env);
const before = { ...ownState.role };
const bridgeBefore = ownState.impact.delta;
ownState = transition(ownState, { type: 'OWN_DISCOVERY', eventId: 'anonymous-own-event' }, env);
cases.push({
  context: ownScenario.context,
  turns: [{
    user: ownScenario.message,
    systemOutput: {
      ...stepOutput(ownState),
      characterInternalEvent: {
        origin: 'character_internal_event',
        demoRoleStateBefore: before,
        demoRoleStateAfter: { ...ownState.role },
        bridgeDeltaBefore: bridgeBefore,
        bridgeDeltaAfter: ownState.role.bridgeDelta,
      },
    },
  }],
});
answerKey.push({
  caseIndex: cases.length - 1,
  sourceScenario: 'independent-own-event',
  expected: { characterEventChangesDemoState: true, userBridgeDeltaUnchanged: true },
});

function shuffled(values, seed) {
  const rows = [...values];
  let state = seed >>> 0;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [rows[index], rows[swap]] = [rows[swap], rows[index]];
  }
  return rows;
}

const rubric = {
  source_attribution: '0=把第三方/角色自身情绪错归给用户或反之；1=部分正确但含混；2=清楚区分说话者和事件来源。',
  evidence_fit: '0=输出没有题面证据或与证据冲突；1=部分支持但夸大/漏掉不确定性；2=结论与原话证据、报告类型和不确定度相称。',
  correction: '仅多轮纠正样本评分；0=纠正后仍沿用旧情绪判断；1=有所修正但旧判断残留；2=明确撤销旧假设并阻止状态增量。其他样本填 null。',
  causal_isolation: '仅有角色自身事件的样本评分；0=把角色自身事件归因给用户情绪桥；1=来源区分含混；2=角色事件可独立影响 demo 角色状态，用户桥接状态保持不变。其他样本填 null。',
};
const instructions = '请只根据每个样本给出的原话、上下文和系统输出独立评分，不要推测隐藏标签或与另一评审讨论。每项评分按 rubric 使用 0/1/2；不适用项必须为 null。每个样本写一句 evidenceNote，引用足以支持评分的短语。只输出 JSON：{"samples":[{"sampleId":"R001","scores":{"source_attribution":2,"evidence_fit":2,"correction":null,"causal_isolation":null},"evidenceNote":"..."}]}。不要输出总体结论或修改系统输出。';

fs.mkdirSync(OUT, { recursive: true });
const packets = [];
const blindedMapping = [];
for (const [reviewer, seed] of [['a', 0xD0A1], ['b', 0xD0B2]]) {
  const packetCases = shuffled(cases.map((sample, sourceIndex) => ({ ...sample, sourceIndex })), seed)
    .map((sample, index) => {
      const sampleId = `R${String(index + 1).padStart(3, '0')}`;
      blindedMapping.push({ reviewer, sampleId, ...answerKey[sample.sourceIndex] });
      return { sampleId, context: sample.context, turns: sample.turns };
    });
  const packet = {
    reviewer,
    instructions,
    rubric,
    scale: { 0: '错误或无证据', 1: '部分正确或含混', 2: '证据充分且边界清楚' },
    cases: packetCases,
  };
  const output = path.join(OUT, `reviewer-${reviewer}.json`);
  fs.writeFileSync(output, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  packets.push({ reviewer, output, order: packetCases.map(item => item.sampleId) });
}
fs.writeFileSync(path.join(OUT, 'answer-key.json'), `${JSON.stringify({ sourceDemo: path.relative(ROOT, htmlPath), mapping: blindedMapping }, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ blindCases: cases.length, packets: packets.map(({ reviewer, output }) => ({ reviewer, output: path.relative(ROOT, output) })) }, null, 2)}\n`);
