#!/usr/bin/env node
/** Deterministic behavior checks for the self-contained dual-loop demo. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_PATH = path.join(ROOT, 'artifacts', 'emotion-learning', 'dual-loop-emotion-demo-v0.7.html');
const html = fs.readFileSync(DEMO_PATH, 'utf8');
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('</script>', scriptStart);
assert.ok(scriptStart >= '<script>'.length && scriptEnd > scriptStart, 'inline demo script exists');
const source = html.slice(scriptStart, scriptEnd);

class FakeElement {
  constructor(id, owner) {
    this.id = id; this.owner = owner; this.innerHTML = ''; this.textContent = ''; this.className = '';
    this.value = ''; this.checked = false; this.style = {}; this.onclick = null; this.listeners = {};
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    for (const kind of ['scenario', 'guide']) {
      const re = new RegExp(`data-${kind}="([^"]+)"`, 'g');
      let match;
      const buttons = [];
      while ((match = re.exec(this._innerHTML))) {
        const button = new FakeElement(`${kind}:${match[1]}`, this.owner);
        button.dataset = { [kind]: match[1] };
        buttons.push(button);
      }
      if (buttons.length) this.owner.queryButtons[kind] = buttons;
    }
  }
  get innerHTML() { return this._innerHTML; }
  addEventListener(event, handler) { (this.listeners[event] ??= []).push(handler); }
  click() { return this.onclick?.(); }
}

class FakeDocument {
  constructor() { this.elements = new Map(); this.queryButtons = { scenario: [], guide: [] }; }
  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement(id, this));
    return this.elements.get(id);
  }
  querySelectorAll(selector) {
    if (selector === '[data-scenario]') return this.queryButtons.scenario;
    if (selector === '[data-guide]') return this.queryButtons.guide;
    return [];
  }
}

const document = new FakeDocument();
const context = vm.createContext({ document, structuredClone, console, Math, Set, Number, String });
vm.runInContext(`${source}\nglobalThis.__demo = { getState: () => state, scenarios, guides, transition, initialState, runStoreExperiment };`, context, { timeout: 1000 });
const state = () => context.__demo.getState();
const el = (id) => document.getElementById(id);
const clickScenario = (id) => {
  const button = document.queryButtons.scenario.find((item) => item.dataset.scenario === id);
  assert.ok(button, `scenario button ${id} exists`); button.click();
};

// Appraisal before understanding must fail closed.
el('run-appraisal').click();
assert.match(el('bridge-view').innerHTML, /understanding_not_run/);
assert.equal(state().role.bridgeDelta, 0);
el('run-counterfactual').click();
assert.match(el('counterfactual-result').innerHTML, /对照未运行/);
el('run-replay').click();
assert.match(el('replay-result').innerHTML, /回放未运行/);

// Explicit user self-report + confirmed demo profile + exact shared concern anchor -> candidate, no role-state write.
el('run-understanding').click(); el('load-profile').click(); el('run-appraisal').click();
assert.equal(state().impact.disposition, 'care_response_candidate');
assert.equal(state().impact.anchor, '面试结果');
assert.equal(state().impact.delta, 0);
assert.equal(state().role.bridgeDelta, 0);
assert.match(el('bridge-view').innerHTML, /proposedStateDelta|角色候选/);

// Counterfactual pair changes only the explicit affect label; it may change understanding/response, never role state.
const roleBeforePair = { ...state().role };
el('run-counterfactual').click();
assert.match(el('counterfactual-result').innerHTML, /用户明确自述：开心/);
assert.match(el('counterfactual-result').innerHTML, /用户明确自述：难过/);
assert.match(el('counterfactual-result').innerHTML, /理解环情绪假设改变/);
assert.match(el('counterfactual-result').innerHTML, /建议状态增量：<b>0\.00<\/b>/);
assert.match(el('counterfactual-result').innerHTML, /当前角色状态保持：一致/);
assert.deepEqual({ ...state().role }, roleBeforePair, 'counterfactual pair must not mutate current role state');

// Five fresh replays of the same event sequence must be byte-for-byte identical and isolated from live demo state.
const roleBeforeReplay = { ...state().role };
el('run-replay').click();
assert.match(el('replay-result').innerHTML, /5 \/ 5 一致/);
assert.match(el('replay-result').innerHTML, /纠正前候选：care_response_candidate/);
assert.match(el('replay-result').innerHTML, /纠正后：user_correction_or_no_affirmed_affect/);
assert.match(el('replay-result').innerHTML, /joy Δ：0\.040；valence Δ：0\.030/);
assert.match(el('replay-result').innerHTML, /用户桥接 Δ：0\.00/);
assert.match(el('replay-result').innerHTML, /回放隔离当前页面状态：是/);
assert.deepEqual({ ...state().role }, roleBeforeReplay, 'replays must not mutate live demo state');

// Event idempotency is per event ID: duplicates are ignored, distinct events apply, and missing IDs fail closed.
const testEnv = { profile: { values: 'test role', concern: '面试结果', confirmed: true } };
const apply = context.__demo.transition;
let duplicateState = context.__demo.initialState();
const sameEvent = { type: 'OWN_DISCOVERY', eventId: 'test-interest-event-001' };
duplicateState = apply(duplicateState, sameEvent, testEnv);
const firstApply = { ...duplicateState.role };
duplicateState = apply(duplicateState, sameEvent, testEnv);
assert.equal(duplicateState.role.discoveryCount, 1);
assert.equal(duplicateState.role.joyDelta, firstApply.joyDelta);
assert.equal(duplicateState.trace.at(-1).source, 'duplicate_event');
duplicateState = apply(duplicateState, { type: 'OWN_DISCOVERY', eventId: 'test-interest-event-002' }, testEnv);
assert.equal(duplicateState.role.discoveryCount, 2);
assert.ok(duplicateState.role.joyDelta > firstApply.joyDelta, 'distinct event ID applies as a new event');
let missingIdState = apply(context.__demo.initialState(), { type: 'OWN_DISCOVERY' }, testEnv);
assert.equal(missingIdState.role.discoveryCount, 0);
assert.equal(missingIdState.trace.at(-1).source, 'invalid_event');
const roleBeforeIdempotencyDemo = { ...state().role };
el('run-idempotency').click();
assert.match(el('idempotency-result').innerHTML, /重复被忽略：通过/);
assert.match(el('idempotency-result').innerHTML, /新事件被正常应用：通过/);
assert.match(el('idempotency-result').innerHTML, /无 ID 拒绝写入：通过/);
assert.deepEqual({ ...state().role }, roleBeforeIdempotencyDemo, 'idempotency demo must not mutate live state');

// Serialized transaction simulation accepts one of eight concurrent duplicate submissions and restores its ledger.
const storeExperiment = await context.__demo.runStoreExperiment();
assert.equal(storeExperiment.accepted, 1);
assert.equal(storeExperiment.duplicates, 7);
assert.equal(storeExperiment.restartAccepted, false, 'restored event ledger must reject replay');
assert.equal(storeExperiment.discoveryCount, 1);
assert.deepEqual(Array.from(storeExperiment.restoredEventIds), ['evt-concurrent-demo-001']);
assert.equal(storeExperiment.stateUnchanged, true, 'transaction experiment must not mutate live demo state');
await el('run-store-experiment').click();
assert.match(el('store-result').innerHTML, /接受 1 次/);
assert.match(el('store-result').innerHTML, /重复拒绝：7 次/);
assert.match(el('store-result').innerHTML, /去重通过/);

// A real multi-turn correction withdraws an earlier user-affect hypothesis and does not roll back or write role state.
clickScenario('correction'); el('apply-correction').click();
assert.equal(state().correctionApplied, false, 'correction without a prior hypothesis must fail closed');
assert.equal(state().activeMessage, null);
el('load-profile').click(); el('run-understanding').click(); el('run-appraisal').click();
assert.equal(state().impact.disposition, 'care_response_candidate');
assert.deepEqual(Array.from(state().hypothesis.emotionHypothesis), ['sad']);
const roleBeforeCorrection = { ...state().role };
el('apply-correction').click();
assert.equal(state().correctionApplied, true);
assert.equal(state().activeMessage, '我说的“难受”是身体不舒服，不是情绪难过。');
assert.equal(state().hypothesis.userCorrection, true);
assert.equal(state().hypothesis.emotionHypothesis.length, 0);
assert.equal(state().impact, null, 'the old candidate is withdrawn when user corrects');
assert.deepEqual({ ...state().role }, roleBeforeCorrection, 'correction cannot mutate character state');
assert.match(el('scenario-message').textContent, /身体不舒服/);
assert.match(el('response-strategy').textContent, /撤销旧标签/);
el('run-appraisal').click();
assert.equal(state().impact.disposition, 'no_reading');
assert.equal(state().impact.reason, 'user_correction_or_no_affirmed_affect');
assert.equal(state().impact.delta, 0);
assert.deepEqual({ ...state().role }, roleBeforeCorrection, 'post-correction appraisal still cannot mutate character state');
assert.match(el('trace').innerHTML, /撤销旧假设 sad/);

// Third-party and inferred affect never become a user-affect write candidate.
clickScenario('quote'); el('run-understanding').click(); el('run-appraisal').click();
assert.equal(state().impact.disposition, 'ambiguous_affect_context');
assert.equal(state().impact.reason, 'not_explicit_user_self_report');
assert.equal(state().role.bridgeDelta, 0);
clickScenario('irony'); el('run-understanding').click(); el('run-appraisal').click();
assert.equal(state().impact.disposition, 'ambiguous_affect_context');
assert.equal(state().impact.reason, 'not_explicit_user_self_report');

// Negation/correction yields no affirmed emotion; unrelated concern yields no reading.
clickScenario('denial'); el('run-understanding').click(); el('run-appraisal').click();
assert.equal(state().impact.disposition, 'no_reading');
assert.equal(state().impact.reason, 'user_correction_or_no_affirmed_affect');
clickScenario('sad-linked'); el('clear-profile').click(); el('run-understanding').click(); el('run-appraisal').click();
assert.equal(state().impact.reason, 'role_constitution_unconfirmed');
el('load-profile').click(); el('role-concern').value = '她在图书馆看书'; el('run-appraisal').click();
assert.equal(state().impact.reason, 'no_evidence_match_to_current_concern');

// Role-owned simulated event changes only the demo's role state; repeated events habituate.
clickScenario('sad-linked'); el('own-event').click();
const firstJoy = state().role.joyDelta, firstValence = state().role.valenceDelta;
assert.ok(firstJoy > 0 && firstValence > 0);
assert.equal(state().role.bridgeDelta, 0);
el('own-event').click();
assert.ok(state().role.joyDelta - firstJoy < firstJoy, 'second discovery is habituated');
assert.equal(state().role.bridgeDelta, 0);

// Guided walks run the same actions as the controls, including multi-turn correction.
const tab = document.queryButtons.guide.find((item) => item.dataset.guide === 'linked');
assert.ok(tab, 'linked walkthrough tab exists'); tab.click();
for (let i = 0; i < 3; i += 1) el('walk-next').click();
assert.equal(state().impact.disposition, 'care_response_candidate');
assert.equal(state().role.bridgeDelta, 0);

const correctionTab = document.queryButtons.guide.find((item) => item.dataset.guide === 'correction');
assert.ok(correctionTab, 'correction walkthrough tab exists'); correctionTab.click();
for (let i = 0; i < 5; i += 1) el('walk-next').click();
assert.equal(state().correctionApplied, true);
assert.equal(state().impact.reason, 'user_correction_or_no_affirmed_affect');
assert.equal(state().role.bridgeDelta, 0);

console.log('Dual-loop demo v0.7 checks passed: explicit self-report gate, counterfactual pair, deterministic replay, event idempotency, concurrent duplicate serialization, snapshot restoration, missing-ID rejection, quote/irony exclusion, correction withdrawal, role-reference gates, shadow delta=0, independent role event, habituation, guided walkthrough.');
