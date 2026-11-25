#!/usr/bin/env node
/** Validate the human-authored bridge contract fixture set and evidence spans. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5/local-nlu-bridge-fixtures-v0.3.json');
const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(fixture.schemaVersion, 'affect-bridge-v0.3');
assert.ok(Array.isArray(fixture.cases) && fixture.cases.length === 6);
assert.ok(['user', 'character', 'third_party'].includes(fixture.roleConcernReference?.owner));
assert.ok(typeof fixture.roleConcernReference?.topic === 'string' && fixture.roleConcernReference.topic.trim());
assert.ok(typeof fixture.roleConcernReference?.eventReference === 'string' && fixture.roleConcernReference.eventReference.trim());
const ids = new Set();
for (const item of fixture.cases) {
  assert.ok(!ids.has(item.id), `duplicate fixture id: ${item.id}`);
  ids.add(item.id);
  const expected = item.expected;
  assert.ok(['user', 'third_party', 'multiple', 'unknown'].includes(expected.subject), `${item.id}: subject enum`);
  assert.ok(['explicit_self_report', 'quoted_or_third_party', 'inferred', 'mixed', 'unknown'].includes(expected.affectReportKind), `${item.id}: report-kind enum`);
  assert.ok(['open', 'declined_to_expand', 'unknown'].includes(expected.engagementBoundary), `${item.id}: engagement-boundary enum`);
  assert.ok(Array.isArray(expected.reports) && expected.reports.length > 0, `${item.id}: reports required`);
  for (const report of expected.reports) {
    assert.ok(['user', 'third_party', 'unknown'].includes(report.subject), `${item.id}: per-report subject`);
    assert.ok(['user', 'third_party', 'unknown'].includes(report.reportedBy), `${item.id}: per-report reporter`);
    assert.ok(Array.isArray(report.evidence) && report.evidence.length > 0, `${item.id}: emotion evidence required`);
    assert.ok(Array.isArray(report.causeEvidence), `${item.id}: cause evidence must be explicitly represented, including []`);
    for (const quote of [...report.evidence, ...report.causeEvidence]) {
      assert.ok(item.message.includes(quote), `${item.id}: evidence span is not a literal substring: ${quote}`);
    }
  }
  if (expected.subject === 'multiple') {
    assert.ok(expected.reports.some(report => report.subject === 'user'), `${item.id}: user report missing`);
    assert.ok(expected.reports.some(report => report.subject === 'third_party'), `${item.id}: third-party report missing`);
    assert.equal(expected.affectReportKind, 'mixed');
  }
  if (item.id === 'incidental-anchor') {
    assert.ok(item.message.includes('面试结果'));
    assert.equal(expected.bridgeDisposition, 'no_reading', 'incidental concern text must not create a cause link');
    assert.ok(expected.reports.every(report => report.causeEvidence.every(span => !span.includes('面试结果'))));
  }
  if (item.id === 'double-negation-boundary') {
    assert.equal(expected.engagementBoundary, 'declined_to_expand');
    assert.equal(expected.bridgeDisposition, 'ambiguous_affect_context');
  }
}
process.stdout.write(`bridge contract fixtures: ${ids.size}/6 valid\n`);
