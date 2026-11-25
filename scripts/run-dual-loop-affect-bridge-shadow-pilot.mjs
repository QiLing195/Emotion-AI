#!/usr/bin/env node
/** Run the actual local analyzer through the read-only affect bridge seam. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAffectBridgeShadow, evaluateAffectBridgeShadow } from '../server/services/affectBridgeShadow.ts';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5');
const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'local-nlu-bridge-fixtures-v0.3.json'), 'utf8'));
const roleContext = { confirmed: true, valuesPresent: true, concern: fixture.roleConcern, reference: fixture.roleConcernReference };

const rows = fixture.cases.map(item => {
  const analysis = analyzeUserEmotionLocally(item.message);
  const shadow = analyzeAffectBridgeShadow(item.message, analysis);
  const gate = evaluateAffectBridgeShadow(shadow, roleContext);
  const expected = item.expected;
  assert.equal(shadow.subject, expected.subject, `${item.id}: subject`);
  assert.equal(shadow.affectReportKind, expected.affectReportKind, `${item.id}: affectReportKind`);
  assert.equal(shadow.engagementBoundary, expected.engagementBoundary, `${item.id}: engagementBoundary`);
  const legacyReportProjection = shadow.reports.map(({ subject, reportedBy, emotion, evidence, causeEvidence, temporalScope, uncertainty, eventReference }) => ({
    subject, reportedBy, emotion, evidence, causeEvidence, temporalScope, uncertainty,
    ...(eventReference ? { eventReference } : {}),
  }));
  assert.deepEqual(legacyReportProjection, expected.reports, `${item.id}: v0.3-compatible report contract`);
  assert.equal(gate.disposition, expected.bridgeDisposition, `${item.id}: bridge disposition`);
  assert.equal(gate.reason, expected.bridgeReason, `${item.id}: bridge reason`);
  assert.equal(gate.delta, 0, `${item.id}: shadow must not mutate state`);
  return { id: item.id, message: item.message, localAnalysis: analysis, shadow, gate };
});

const report = {
  schemaVersion: 'affect-bridge-v0.4',
  generatedAt: new Date().toISOString(),
  source: 'real analyzeUserEmotionLocally + deterministic shadow extractor; no LLM/API calls',
  note: 'Six hand-authored pilot fixtures only. Passing verifies implementation against these fixtures, not general emotion accuracy or causal understanding.',
  metrics: {
    cases: rows.length,
    contractMatches: rows.length,
    bridgeCandidates: rows.filter(row => row.gate.disposition === 'care_response_candidate').length,
    stateDeltas: rows.map(row => row.gate.delta),
  },
  rows,
};
fs.writeFileSync(path.join(dir, 'affect-bridge-shadow-pilot-v0.4.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.metrics)}\n`);
