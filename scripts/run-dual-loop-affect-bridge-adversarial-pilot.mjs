#!/usr/bin/env node
/** Run a hand-authored adversarial pilot against the real shadow bridge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAffectBridgeShadow, evaluateAffectBridgeShadow } from '../server/services/affectBridgeShadow.ts';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5');
const fixture = JSON.parse(fs.readFileSync(path.join(dir, 'affect-bridge-adversarial-v0.3.json'), 'utf8'));
const roleContext = { confirmed: true, valuesPresent: true, concern: fixture.roleConcern, reference: fixture.roleConcernReference };
const rows = fixture.cases.map(item => {
  const localAnalysis = analyzeUserEmotionLocally(item.message);
  const shadow = analyzeAffectBridgeShadow(item.message, localAnalysis);
  const reference = item.roleReferenceOverride ? { ...fixture.roleConcernReference, ...item.roleReferenceOverride } : fixture.roleConcernReference;
  const gate = evaluateAffectBridgeShadow(shadow, { ...roleContext, reference });
  const passed = gate.disposition === item.expectedDisposition && gate.reason === item.expectedReason && gate.delta === 0;
  assert.ok(passed, `${item.id}: got ${gate.disposition}/${gate.reason}; expected ${item.expectedDisposition}/${item.expectedReason}`);
  if (item.expectedOwnerRelation) assert.equal(gate.concernOwnerRelation, item.expectedOwnerRelation, `${item.id}: owner relation`);
  if (item.expectedEventIdentity) assert.equal(gate.eventIdentity, item.expectedEventIdentity, `${item.id}: event identity`);
  return { ...item, localAnalysis, shadow, gate, passed };
});

const report = {
  sourceFixtureVersion: fixture.schemaVersion,
  shadowSchemaVersion: 'affect-bridge-v0.4',
  generatedAt: new Date().toISOString(),
  source: 'real local emotion analyzer + deterministic shadow extractor; no LLM/API calls',
  note: fixture.setType,
  metrics: {
    cases: rows.length,
    expectedGateMatches: rows.filter(row => row.passed).length,
    careResponseCandidates: rows.filter(row => row.gate.disposition === 'care_response_candidate').length,
    rejectedOrAmbiguous: rows.filter(row => row.gate.disposition !== 'care_response_candidate').length,
    stateDeltas: rows.map(row => row.gate.delta),
  },
  rows,
};
fs.writeFileSync(path.join(dir, 'affect-bridge-adversarial-pilot-v0.4.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.metrics)}\n`);
