#!/usr/bin/env node
/** Deterministic regression checks for the dual-loop demo's evidence bridge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'artifacts/emotion-learning/dual-loop-emotion-demo-v0.7.html'), 'utf8');
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('</script>', scriptStart);
const source = html.slice(scriptStart, scriptEnd);
const modelEnd = source.indexOf('\nconst guides=');
assert.ok(scriptStart >= '<script>'.length && scriptEnd > scriptStart && modelEnd > 0, 'demo model script must be present');

const context = vm.createContext({ structuredClone, Math, Set, Number, String });
vm.runInContext(`${source.slice(0, modelEnd)}\nglobalThis.__model={scenarios,transition,initialState};`, context, { timeout: 1_000 });
const { scenarios, transition, initialState } = context.__model;
const profile = { values: '尊重真实与用户边界；关注已建立关系中的重要事情', concern: '她正在等面试结果', confirmed: true };

function appraise(id, message, hypothesis) {
  const scenario = { id, message, hypothesis };
  scenarios.push(scenario);
  const env = { profile };
  let state = transition(initialState(), { type: 'SELECT', id }, env);
  state = transition(state, { type: 'UNDERSTAND' }, env);
  return transition(state, { type: 'APPRAISE' }, env).impact;
}

const unrelatedKeyword = appraise('regression-incidental-anchor',
  '公司群里发了一条面试结果统计，看到我姐姐查出重病，我很难过。',
  { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我姐姐查出重病，我很难过'], inferenceUncertainty: 'low', userCorrection: false });
assert.equal(unrelatedKeyword.disposition, 'no_reading', 'unrelated concern keyword must not bridge');
assert.equal(unrelatedKeyword.reason, 'cause_evidence_missing_or_unbound');

const supportedEvidence = appraise('regression-linked-concern',
  '面试结果出来了，我拿到 offer 了，真的很开心。',
  { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['joy'], evidence: ['真的很开心'], concernEvidence: ['面试结果出来了，我拿到 offer 了，真的很开心'], inferenceUncertainty: 'low', userCorrection: false });
assert.equal(supportedEvidence.disposition, 'care_response_candidate', 'concern present in affect evidence should remain eligible');

const broadEvidenceOnly = appraise('regression-broad-evidence-without-cause-span',
  '公司群里发了一条面试结果统计，看到我姐姐查出重病，我很难过。',
  { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['公司群里发了一条面试结果统计，看到我姐姐查出重病，我很难过'], inferenceUncertainty: 'low', userCorrection: false });
assert.equal(broadEvidenceOnly.disposition, 'no_reading', 'whole-message emotion evidence is insufficient to establish a causal link');
assert.equal(broadEvidenceOnly.reason, 'cause_evidence_missing_or_unbound');

const unboundCauseEvidence = appraise('regression-unbound-cause-evidence',
  '我今天很开心。',
  { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['joy'], evidence: ['我今天很开心'], concernEvidence: ['面试结果出来了'], inferenceUncertainty: 'low', userCorrection: false });
assert.equal(unboundCauseEvidence.disposition, 'no_reading');
assert.equal(unboundCauseEvidence.reason, 'cause_evidence_missing_or_unbound', 'fabricated cause spans must fail closed');

const declinedDiscussion = appraise('regression-double-negation-boundary',
  '我不是不难过，只是不想现在谈。',
  { subject: 'user', affectReportKind: 'inferred', emotionHypothesis: ['sad'], evidence: ['我不是不难过', '不想现在谈'], inferenceUncertainty: 'moderate', engagementBoundary: 'declined_to_expand', userCorrection: false });
assert.equal(declinedDiscussion.disposition, 'ambiguous_affect_context');
assert.equal(declinedDiscussion.reason, 'user_declined_affect_discussion', 'refusal to elaborate must be represented as an interaction boundary');

const multipleSpeakers = appraise('regression-multiple-speakers',
  '她说“我最近很焦虑”，我自己倒还好，只是想帮她。',
  { subject: 'multiple', affectReportKind: 'mixed', emotionHypothesis: ['fear', 'calm'], evidence: ['她说“我最近很焦虑”', '我自己倒还好'], affectReports: [
    { subject: 'third_party', emotion: 'fear', evidence: '她说“我最近很焦虑”' },
    { subject: 'user', emotion: 'calm', evidence: '我自己倒还好' },
  ], inferenceUncertainty: 'low', userCorrection: false });
assert.equal(multipleSpeakers.reason, 'multiple_or_mixed_affect_sources');
assert.deepEqual(Array.from(multipleSpeakers.affectReports, item => item.subject), ['third_party', 'user'], 'per-emotion source attribution must survive appraisal');

const correctionScenario = {
  id: 'regression-correction-new-affect', message: '我很难过，面试结果还没出来。',
  hypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['sad'], evidence: ['我很难过'], inferenceUncertainty: 'low', userCorrection: false },
  correctionText: '我更正一下：不是难过，我是生气，今天被老板批评了。',
  correctionHypothesis: { subject: 'user', affectReportKind: 'explicit_self_report', emotionHypothesis: ['anger'], evidence: ['我是生气', '被老板批评'], inferenceUncertainty: 'low', userCorrection: true },
};
scenarios.push(correctionScenario);
let corrected = transition(initialState(), { type: 'SELECT', id: correctionScenario.id }, { profile });
corrected = transition(corrected, { type: 'UNDERSTAND' }, { profile });
corrected = transition(corrected, { type: 'USER_CORRECTION' }, { profile });
const correctedAppraisal = transition(corrected, { type: 'APPRAISE' }, { profile }).impact;
assert.deepEqual(Array.from(corrected.hypothesis.emotionHypothesis), ['anger'], 'new explicit emotion must replace the revoked one');
assert.equal(correctedAppraisal.reason, 'user_correction_affect_retained_shadow_only');
assert.equal(correctedAppraisal.delta, 0, 'correction remains shadow-only');

correctionScenario.correctionHypothesis = { subject: 'user', affectReportKind: 'unknown', emotionHypothesis: [], evidence: ['身体不舒服'], inferenceUncertainty: 'low', userCorrection: true };
let revoked = transition(initialState(), { type: 'SELECT', id: correctionScenario.id }, { profile });
revoked = transition(revoked, { type: 'UNDERSTAND' }, { profile });
revoked = transition(revoked, { type: 'USER_CORRECTION' }, { profile });
const revokedAppraisal = transition(revoked, { type: 'APPRAISE' }, { profile }).impact;
assert.equal(revokedAppraisal.reason, 'user_correction_removed_affect');
assert.deepEqual(Array.from(revoked.hypothesis.emotionHypothesis), []);

process.stdout.write('dual-loop bridge regressions: 8/8 passed\n');
