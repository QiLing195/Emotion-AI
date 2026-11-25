#!/usr/bin/env node
/** Verify blind packet separation, coverage, and paired review alignment. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'artifacts/emotion-learning/dual-loop-causal-review-v0.1');
const key = JSON.parse(fs.readFileSync(path.join(DIR, 'answer-key.json'), 'utf8'));
const reviewers = ['a', 'b'].map(id => ({
  id,
  packet: JSON.parse(fs.readFileSync(path.join(DIR, `reviewer-${id}.json`), 'utf8')),
  scored: JSON.parse(fs.readFileSync(path.join(DIR, `reviewer-${id}-scored.json`), 'utf8')),
}));

const mapping = Object.fromEntries(reviewers.map(({ id }) => [id,
  new Map(key.mapping.filter(row => row.reviewer === id).map(row => [row.sourceScenario, row.sampleId]))]));
for (const { id, packet, scored } of reviewers) {
  if (packet.cases.length !== 8 || scored.results.length !== 8) throw new Error(`${id}_case_count_mismatch`);
  const packetJson = JSON.stringify(packet);
  if (/sourceScenario|"expected"\s*:/.test(packetJson)) throw new Error(`${id}_packet_contains_answer_key`);
  if (new Set(packet.cases.map(item => item.sampleId)).size !== 8) throw new Error(`${id}_duplicate_sample_id`);
  if (scored.evaluation?.provider !== 'DeepSeek') throw new Error(`${id}_provider_metadata_missing`);
}
const sourceOrder = id => key.mapping.filter(row => row.reviewer === id)
  .sort((a, b) => a.sampleId.localeCompare(b.sampleId)).map(row => row.sourceScenario).join(',');
if (sourceOrder('a') === sourceOrder('b')) throw new Error('reviewer_orders_not_distinct');

const scoreMaps = Object.fromEntries(reviewers.map(({ id, scored }) => [id,
  new Map(scored.results.map(row => [row.sampleId, row]))]));
const dimensions = ['source_attribution', 'evidence_fit', 'correction', 'causal_isolation'];
let comparisons = 0;
for (const scenario of new Set(key.mapping.map(row => row.sourceScenario))) {
  const left = scoreMaps.a.get(mapping.a.get(scenario));
  const right = scoreMaps.b.get(mapping.b.get(scenario));
  if (!left || !right) throw new Error(`missing_blind_pair_${scenario}`);
  for (const dimension of dimensions) {
    if (left.scores[dimension] === null && right.scores[dimension] === null) continue;
    comparisons += 1;
    if (left.scores[dimension] !== right.scores[dimension]) throw new Error(`reviewer_disagreement_${scenario}_${dimension}`);
  }
}
const correction = key.mapping.find(row => row.sourceScenario === 'correction');
if (!correction?.expected?.correctedDisposition || correction.expected.correctedReason !== 'user_correction_or_no_affirmed_affect') {
  throw new Error('correction_answer_key_invariant_failed');
}
const ownEvent = key.mapping.find(row => row.sourceScenario === 'independent-own-event');
if (!ownEvent?.expected?.characterEventChangesDemoState || !ownEvent.expected.userBridgeDeltaUnchanged) {
  throw new Error('own_event_answer_key_invariant_failed');
}

process.stdout.write(`verified: 8 blind cases, 18 paired ratings, ${comparisons} exact agreements, answer key separated\n`);
