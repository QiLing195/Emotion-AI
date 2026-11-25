#!/usr/bin/env node
/** Validate literal evidence and compare two blinded affect annotations. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.AFFECT_BLIND_REVIEW_DIR
  || path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5/blind-review-v0.3'));
const key = JSON.parse(fs.readFileSync(path.join(dir, 'answer-key.json'), 'utf8'));
const source = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5/affect-bridge-adversarial-v0.2.json'), 'utf8'));
const raw = Object.fromEntries(['a', 'b'].map(id => [id,
  JSON.parse(fs.readFileSync(path.join(dir, `reviewer-${id}-scored.json`), 'utf8'))]));
const rowsByReviewer = {};
const invalidEvidence = [];
const unsupportedSameEventClaims = [];
for (const reviewer of ['a', 'b']) {
  const results = raw[reviewer].results ?? raw[reviewer].samples;
  if (!Array.isArray(results)) throw new Error(`${reviewer}_missing_results`);
  rowsByReviewer[reviewer] = new Map(results.map(item => [item.sampleId, item]));
  for (const mapping of key.mapping.filter(item => item.reviewer === reviewer)) {
    const result = rowsByReviewer[reviewer].get(mapping.sampleId);
    const fixture = source.cases.find(item => item.id === mapping.sourceCase);
    if (!result || !fixture) throw new Error(`${reviewer}_${mapping.sampleId}_mapping_missing`);
    if (result.eventIdentity === 'same_event' && mapping.expectedEventIdentity !== 'same_event') {
      unsupportedSameEventClaims.push({ reviewer, sampleId: mapping.sampleId, sourceCase: mapping.sourceCase });
    }
    for (const report of (Array.isArray(result.reports) ? result.reports : [result.reports]).filter(Boolean)) {
      for (const field of ['emotionEvidence', 'causeEvidence']) {
        const span = report[field];
        if (span && !fixture.message.includes(span)) invalidEvidence.push({ reviewer, sampleId: mapping.sampleId, field, span });
      }
    }
  }
}

function normalizedReports(result) {
  const rows = Array.isArray(result.reports) ? result.reports : result.reports ? [result.reports] : [];
  return rows.map(item => `${item.subject}:${item.emotion}:${item.reportKind}`).sort();
}
function ownerRelation(result) { return result.concernOwnerRelation ?? 'missing'; }
const comparison = [];
for (const mapping of key.mapping.filter(item => item.reviewer === 'a')) {
  const other = key.mapping.find(item => item.reviewer === 'b' && item.sourceCase === mapping.sourceCase);
  const a = rowsByReviewer.a.get(mapping.sampleId), b = rowsByReviewer.b.get(other.sampleId);
  const labelsA = normalizedReports(a), labelsB = normalizedReports(b);
  const sameLabels = JSON.stringify(labelsA) === JSON.stringify(labelsB);
  comparison.push({
    sourceCase: mapping.sourceCase,
    sampleIds: { a: mapping.sampleId, b: other.sampleId },
    message: source.cases.find(item => item.id === mapping.sourceCase).message,
    reviewerA: { reports: a.reports, engagementBoundary: a.engagementBoundary, concernOwnerRelation: ownerRelation(a), eventIdentity: a.eventIdentity, rationale: a.rationale },
    reviewerB: { reports: b.reports, engagementBoundary: b.engagementBoundary, concernOwnerRelation: ownerRelation(b), eventIdentity: b.eventIdentity, rationale: b.rationale },
    agreement: {
      emotionSubjectAndKind: sameLabels,
      engagementBoundary: a.engagementBoundary === b.engagementBoundary,
      concernOwnerRelation: ownerRelation(a) === ownerRelation(b),
      eventIdentity: a.eventIdentity === b.eventIdentity,
    },
  });
}
const report = {
  generatedAt: new Date().toISOString(),
  sourceSet: key.sourceSet,
  reviewers: ['two separate blind OpenAI review sessions; same environment/model family, not independent providers'],
  metrics: {
    cases: comparison.length,
    concernOwnerRelationAgreement: comparison.filter(item => item.agreement.concernOwnerRelation).length,
    eventIdentityAgreement: comparison.filter(item => item.agreement.eventIdentity).length,
    emotionSubjectAndKindAgreement: comparison.filter(item => item.agreement.emotionSubjectAndKind).length,
    engagementBoundaryAgreement: comparison.filter(item => item.agreement.engagementBoundary).length,
    invalidLiteralEvidenceCount: invalidEvidence.length,
    unsupportedSameEventClaimCount: unsupportedSameEventClaims.length,
    expectedEventIdentityAgreement: key.mapping.filter(item => item.reviewer === 'a')
      .filter(item => rowsByReviewer.a.get(item.sampleId)?.eventIdentity === item.expectedEventIdentity).length,
  },
  invalidEvidence,
  unsupportedSameEventClaims,
  comparisons: comparison,
  interpretation: [
    'Owner, topic, and event identity are separate annotation dimensions; topic overlap alone is not event identity.',
    'The same_event label requires an auditable event link; user-side references are explicitly provided or marked missing in the blind pack.',
    'A pre-result temporal phrase is not automatically causal evidence.',
    'Agreement between two same-family AI sessions is descriptive only and is not a human gold standard.',
  ],
};
const version = path.basename(dir).match(/v0\.\d+/)?.[0] ?? 'latest';
fs.writeFileSync(path.join(dir, `blind-review-analysis-${version}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.metrics)}\n`);
