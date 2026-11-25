#!/usr/bin/env node
/** Compare blinded source/experiencer annotations with each other and the hand-authored target. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.env.SOURCE_ATTRIBUTION_REVIEW_DIR
  || path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5/source-attribution-blind-v0.1'));
const key = JSON.parse(fs.readFileSync(path.join(dir, 'answer-key.json'), 'utf8'));
const raw = Object.fromEntries(['a', 'b'].map(id => [id,
  JSON.parse(fs.readFileSync(path.join(dir, `reviewer-${id}-scored.json`), 'utf8'))]));

function rowsFor(reviewer) {
  const rows = raw[reviewer].results ?? raw[reviewer].samples;
  if (!Array.isArray(rows)) throw new Error(`${reviewer}_missing_samples`);
  const map = new Map(rows.map(row => [row.sampleId, row]));
  const expectedIds = key.mapping.filter(row => row.reviewer === reviewer).map(row => row.sampleId);
  if (map.size !== expectedIds.length || expectedIds.some(id => !map.has(id))) throw new Error(`${reviewer}_sample_ids_mismatch`);
  return map;
}
const reviews = { a: rowsFor('a'), b: rowsFor('b') };
const invalidEvidence = [];
const comparisons = [];
function sortedReports(sample, fields = ['subject', 'reportedBy', 'emotion']) {
  return (sample.reports ?? []).map(report => Object.fromEntries(fields.map(field => [field, report[field]])))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
for (const rowA of key.mapping.filter(item => item.reviewer === 'a')) {
  const rowB = key.mapping.find(item => item.reviewer === 'b' && item.sourceCase === rowA.sourceCase);
  const a = reviews.a.get(rowA.sampleId), b = reviews.b.get(rowB.sampleId);
  const expected = rowA.expected;
  const reportsA = sortedReports(a), reportsB = sortedReports(b);
  const attributionA = sortedReports(a, ['subject', 'reportedBy']);
  const attributionB = sortedReports(b, ['subject', 'reportedBy']);
  const expectedAttribution = [...expected.reports].map(({ subject, reportedBy }) => ({ subject, reportedBy }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const expectedRuntimeReports = [...expected.reports].map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  for (const [reviewer, sample] of [['a', a], ['b', b]]) {
    const packet = JSON.parse(fs.readFileSync(path.join(dir, `reviewer-${reviewer}.json`), 'utf8'));
    const text = packet.cases.find(item => item.sampleId === sample.sampleId)?.text;
    if (typeof text !== 'string') throw new Error(`${sample.sampleId}_source_missing`);
    for (const report of sample.reports ?? []) {
      for (const field of ['emotionEvidence', 'causeEvidence']) {
        const spans = Array.isArray(report[field]) ? report[field] : report[field] ? [report[field]] : [];
        for (const span of spans) if (!text.includes(span)) invalidEvidence.push({ reviewer, sampleId: sample.sampleId, field, span });
      }
    }
  }
  comparisons.push({
    sourceCase: rowA.sourceCase,
    agreement: {
      reportAttribution: JSON.stringify(attributionA) === JSON.stringify(attributionB),
      emotionLabels: JSON.stringify(sortedReports(a, ['emotion'])) === JSON.stringify(sortedReports(b, ['emotion'])),
      perReportKinds: JSON.stringify(sortedReports(a, ['reportKind'])) === JSON.stringify(sortedReports(b, ['reportKind'])),
      aggregateSubject: a.aggregateSubject === b.aggregateSubject,
      aggregateKind: a.aggregateKind === b.aggregateKind,
      reviewerAAttributionAgainstTarget: JSON.stringify(attributionA) === JSON.stringify(expectedAttribution),
      reviewerBAttributionAgainstTarget: JSON.stringify(attributionB) === JSON.stringify(expectedAttribution),
      reviewerAAgainstTarget: JSON.stringify(reportsA) === JSON.stringify(expectedRuntimeReports)
        && a.aggregateSubject === expected.aggregateSubject && a.aggregateKind === expected.aggregateKind,
      reviewerBAgainstTarget: JSON.stringify(reportsB) === JSON.stringify(expectedRuntimeReports)
        && b.aggregateSubject === expected.aggregateSubject && b.aggregateKind === expected.aggregateKind,
    },
    reviewerA: a,
    reviewerB: b,
    expected,
  });
}
const metrics = {
  cases: comparisons.length,
  reviewerReportAttributionAgreement: comparisons.filter(row => row.agreement.reportAttribution).length,
  reviewerEmotionLabelAgreement: comparisons.filter(row => row.agreement.emotionLabels).length,
  reviewerPerReportKindAgreement: comparisons.filter(row => row.agreement.perReportKinds).length,
  aggregateSubjectAgreement: comparisons.filter(row => row.agreement.aggregateSubject).length,
  aggregateKindAgreement: comparisons.filter(row => row.agreement.aggregateKind).length,
  reviewerAAttributionAgainstTarget: comparisons.filter(row => row.agreement.reviewerAAttributionAgainstTarget).length,
  reviewerBAttributionAgainstTarget: comparisons.filter(row => row.agreement.reviewerBAttributionAgainstTarget).length,
  reviewerAExactTargetMatch: comparisons.filter(row => row.agreement.reviewerAAgainstTarget).length,
  reviewerBExactTargetMatch: comparisons.filter(row => row.agreement.reviewerBAgainstTarget).length,
  invalidLiteralEvidenceCount: invalidEvidence.length,
};
const report = {
  generatedAt: new Date().toISOString(),
  sourceSet: key.sourceSet,
  limitations: [key.note, 'Two AI reviewer sessions are descriptive diagnostics, not independent human gold or cross-provider validation.'],
  metrics,
  invalidEvidence,
  comparisons,
};
fs.writeFileSync(path.join(dir, 'review-analysis.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(metrics)}\n`);
