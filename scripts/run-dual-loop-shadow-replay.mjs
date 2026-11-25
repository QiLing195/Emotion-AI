import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEMORIES_DIR = process.env.MEMORIES_DIR ? path.resolve(process.env.MEMORIES_DIR) : '';
if (!MEMORIES_DIR) throw new Error('Set MEMORIES_DIR to an isolated directory outside the project before running this offline replay.');
const relativeToRoot = path.relative(ROOT, MEMORIES_DIR);
if (relativeToRoot === '' || (!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot))) {
  throw new Error('Refusing to use a replay directory inside the project; production memories must never be used by this script.');
}

const DEMO_FILE = path.join(ROOT, 'artifacts/emotion-learning/dual-loop-emotion-demo-v0.7.html');
const html = fs.readFileSync(DEMO_FILE, 'utf8');
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('</script>', scriptStart);
const source = html.slice(scriptStart, scriptEnd);
const pureModelEnd = source.indexOf('\nconst guides=');
if (scriptStart < '<script>'.length || scriptEnd <= scriptStart || pureModelEnd < 0) {
  throw new Error('Could not locate the pure model section in dual-loop demo v0.7.');
}

const context = vm.createContext({ structuredClone, Math, Set, Number, String });
vm.runInContext(
  `${source.slice(0, pureModelEnd)}\nglobalThis.__model = { scenarios, transition, initialState };`,
  context,
  { timeout: 1_000 },
);
const { scenarios, transition, initialState } = context.__model;

const { commitDualLoopEmotionEventAsync } = await import('../server/persistence.ts');
const { INITIAL_EMOTION_STATE } = await import('../src/lib/emotionTypes.ts');
const roleProfile = {
  values: '尊重真实与用户边界；关注已建立关系中的重要事情',
  concern: '她正在等面试结果',
  confirmed: true,
};

const results = [];
async function persistTrace(eventId, shadowTrace, extra = {}) {
  const result = await commitDualLoopEmotionEventAsync({
    eventId,
    subject: 'character',
    appraisalVersion: 'shadow-v0.1',
    initialState: structuredClone(INITIAL_EMOTION_STATE),
    update: current => current,
    shadowTrace,
  });
  results.push({
    caseId: shadowTrace.caseId,
    eventSource: shadowTrace.eventSource,
    status: result.status,
    subject: shadowTrace.userSubject,
    emotion: shadowTrace.emotionHypothesis.join('/') || 'unknown',
    appraisal: shadowTrace.appraisalDisposition,
    reason: shadowTrace.appraisalReason,
    corrected: shadowTrace.userCorrectionApplied,
    proposedDelta: shadowTrace.proposedStateDelta,
    demoLocalStateChanged: shadowTrace.demoLocalStateChanged,
    roleStateWriteApplied: shadowTrace.roleStateWriteApplied,
    ...extra,
  });
  return result;
}

function traceFor(caseId, demoState, eventSource = 'user_affect_bridge', demoLocalStateChanged = false) {
  const hypothesis = demoState.hypothesis ?? {};
  const impact = demoState.impact ?? {};
  return {
    source: 'offline-replay',
    caseId,
    eventSource,
    demoLocalStateChanged,
    userSubject: ['user', 'third_party', 'multiple'].includes(hypothesis.subject) ? hypothesis.subject : 'unknown',
    affectReportKind: String(hypothesis.affectReportKind ?? 'unknown'),
    emotionHypothesis: Array.isArray(hypothesis.emotionHypothesis) ? hypothesis.emotionHypothesis.map(String) : [],
    inferenceUncertainty: String(hypothesis.inferenceUncertainty ?? 'unknown'),
    userCorrectionApplied: Boolean(hypothesis.userCorrection),
    appraisalDisposition: String(impact.disposition ?? 'no_reading'),
    appraisalReason: String(impact.reason ?? 'no_appraisal'),
    proposedStateDelta: Number(impact.delta ?? 0),
    roleStateWriteApplied: false,
  };
}

for (const scenario of scenarios) {
  const env = { profile: scenario.id === 'no-concern' ? { ...roleProfile, concern: '' } : roleProfile };
  let demoState = transition(initialState(), { type: 'SELECT', id: scenario.id }, env);
  demoState = transition(demoState, { type: 'UNDERSTAND' }, env);
  demoState = transition(demoState, { type: 'APPRAISE' }, env);
  if (scenario.correctionText) {
    demoState = transition(demoState, { type: 'USER_CORRECTION' }, env);
    demoState = transition(demoState, { type: 'APPRAISE' }, env);
  }
  await persistTrace(`offline-demo-v0.7:${scenario.id}`, traceFor(scenario.id, demoState));
}

// Multi-round causal pair: first a supported candidate, then an explicit correction revokes it.
const correctionScenario = scenarios.find(item => item.id === 'correction');
const correctionEnv = { profile: roleProfile };
let correctionState = transition(initialState(), { type: 'SELECT', id: correctionScenario.id }, correctionEnv);
correctionState = transition(correctionState, { type: 'UNDERSTAND' }, correctionEnv);
correctionState = transition(correctionState, { type: 'APPRAISE' }, correctionEnv);
if (correctionState.impact.disposition !== 'care_response_candidate') {
  throw new Error('causal replay precondition failed: expected a supported pre-correction candidate');
}
await persistTrace('offline-demo-v0.7:correction-before', traceFor('correction-before', correctionState), {
  preCorrectionDisposition: correctionState.impact.disposition,
});
correctionState = transition(correctionState, { type: 'USER_CORRECTION' }, correctionEnv);
correctionState = transition(correctionState, { type: 'APPRAISE' }, correctionEnv);
  if (correctionState.impact.reason !== 'user_correction_removed_affect' || correctionState.impact.delta !== 0) {
  throw new Error('causal replay failed: user correction did not revoke the prior affect hypothesis');
}
await persistTrace('offline-demo-v0.7:correction-after', traceFor('correction-after', correctionState), {
  preCorrectionDisposition: 'care_response_candidate',
});

// Independent character-origin event: it changes only the demo's local role state, never the user bridge.
const ownScenario = scenarios.find(item => item.id === 'sad-linked');
const ownEnv = { profile: roleProfile };
let ownState = transition(initialState(), { type: 'SELECT', id: ownScenario.id }, ownEnv);
ownState = transition(ownState, { type: 'UNDERSTAND' }, ownEnv);
ownState = transition(ownState, { type: 'APPRAISE' }, ownEnv);
const bridgeBeforeOwnEvent = ownState.impact.delta;
const roleBeforeOwnEvent = { ...ownState.role };
ownState = transition(ownState, { type: 'OWN_DISCOVERY', eventId: 'independent-own-event-001' }, ownEnv);
if (!(ownState.role.joyDelta > roleBeforeOwnEvent.joyDelta)
  || !(ownState.role.valenceDelta > roleBeforeOwnEvent.valenceDelta)
  || ownState.role.bridgeDelta !== 0
  || ownState.impact.delta !== bridgeBeforeOwnEvent) {
  throw new Error('causal replay failed: character event contaminated or failed to update its own demo state');
}
await persistTrace(
  'offline-demo-v0.7:independent-own-event-001',
  traceFor('own-event-independent', ownState, 'character_internal_event', true),
  { bridgeBeforeOwnEvent },
);

const persistedPath = path.join(MEMORIES_DIR, 'emotion_runtime_v1.json');
const persisted = JSON.parse(fs.readFileSync(persistedPath, 'utf8'));
const unchanged = JSON.stringify(persisted.state) === JSON.stringify(INITIAL_EMOTION_STATE);
console.table(results);
console.log(JSON.stringify({
  run: 'offline dual-loop shadow replay',
  sourceDemo: path.relative(ROOT, DEMO_FILE),
  scenarios: scenarios.length,
  persistedEvents: results.length,
  applied: results.filter(item => item.status === 'applied').length,
  duplicates: results.filter(item => item.status === 'duplicate').length,
  roleStateWriteApplied: false,
  persistedRoleStateUnchanged: unchanged,
  persistedTraceCount: persisted.processedEvents.filter(event => event.shadowTrace?.source === 'offline-replay').length,
  output: persistedPath,
}, null, 2));

if (!unchanged || results.some(item => !['applied', 'duplicate'].includes(item.status))) process.exitCode = 1;
