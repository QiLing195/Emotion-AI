#!/usr/bin/env node
/** Deterministic cross-checks for reviewer scores against answer-keyed demo facts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reviewRoot = path.join(root, 'artifacts/emotion-learning');
const reviewDir = path.resolve(process.env.DUAL_LOOP_REVIEW_DIR
  || path.join(reviewRoot, 'dual-loop-causal-review-v0.4'));
if (reviewDir !== reviewRoot && !reviewDir.startsWith(reviewRoot + path.sep)) {
  throw new Error('dual_loop_review_dir_must_stay_under_emotion_learning_artifacts');
}
const key = JSON.parse(fs.readFileSync(path.join(reviewDir, 'answer-key.json'), 'utf8'));
const byReviewerScenario = new Map(key.mapping.map(row => [`${row.reviewer}:${row.sourceScenario}`, row]));
const findings = [];
const models = ['a', 'b'];
for (const reviewer of models) {
  const scored = JSON.parse(fs.readFileSync(path.join(reviewDir, `reviewer-${reviewer}-scored.json`), 'utf8'));
  for (const [scenario, expectedFacts] of [
    ['incidental-anchor', { disposition: 'no_reading', reason: 'no_evidence_match_to_current_concern' }],
    ['double-negation', { disposition: 'ambiguous_affect_context', reason: 'user_declined_affect_discussion' }],
    ['multiple-speakers', { disposition: 'ambiguous_affect_context', reason: 'multiple_or_mixed_affect_sources' }],
  ]) {
    const mapping = byReviewerScenario.get(`${reviewer}:${scenario}`);
    if (!mapping) continue;
    const result = scored.results.find(item => item.sampleId === mapping.sampleId);
    const actual = mapping.actual.initialImpact;
    const note = result.evidenceNote ?? '';
    if (scenario === 'incidental-anchor'
      && actual.disposition !== expectedFacts.disposition
      && result.scores.evidence_fit === 2
      && (/未.{0,20}(误作|误连|错连|错误归因)|没有.{0,12}(误作|误连|错连)|但.{0,20}(无关|错连|错误归因)/.test(note))) {
      findings.push({ reviewer, sampleId: result.sampleId, sourceScenario: scenario, dimension: 'evidence_fit', score: 2,
        kind: 'score_and_rationale_contradict_reference', confidence: 'high',
        expected: expectedFacts, actual: { disposition: actual.disposition, reason: actual.reason, anchor: actual.anchor },
        evidenceNote: note });
    }
    if (scenario === 'multiple-speakers' && result.scores.source_attribution === 2
      && !mapping.actual.initialImpact.affectReports?.length) {
      findings.push({ reviewer, sampleId: result.sampleId, sourceScenario: scenario, dimension: 'source_attribution', score: 2,
        kind: 'score_exceeds_visible_attribution_detail', confidence: 'high',
        expected: { perEmotionSubjectMappingRequired: true },
        actual: { aggregateSubject: 'multiple', perEmotionSubjectMapping: false }, evidenceNote: note });
    }
    if (scenario === 'double-negation' && actual.reason !== expectedFacts.reason) {
      findings.push({ reviewer, sampleId: result.sampleId, sourceScenario: scenario, dimension: 'system_output', score: null,
        kind: 'expected_boundary_reason_missing', confidence: 'high', expected: expectedFacts,
        actual: { disposition: actual.disposition, reason: actual.reason }, evidenceNote: note });
    }
  }
}
const output = { generatedAt: new Date().toISOString(), method: 'answer-keyed deterministic invariants; not a semantic judge', findings };
fs.writeFileSync(path.join(reviewDir, 'rationale-consistency-check.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`rationale consistency checks: ${findings.length} findings in ${path.relative(root, reviewDir)}\n`);
