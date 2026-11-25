#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'artifacts', 'v2.31', 'replay');
const args = new Map(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  return at > 0 ? [arg.slice(0, at).replace(/^--/, ''), arg.slice(at + 1)] : [arg, ''];
}));
const readJson = (arg, fallback) => JSON.parse(fs.readFileSync(path.resolve(ROOT, args.get(arg) || fallback), 'utf8'));
const packetA = readJson('reviewer-a', 'artifacts/v2.31/replay/multiturn-reviewer-a.json');
const packetB = readJson('reviewer-b', 'artifacts/v2.31/replay/multiturn-reviewer-b.json');
const keyFile = readJson('key', 'artifacts/v2.31/replay/multiturn-review-key.json');
const outputPath = path.resolve(ROOT, args.get('out') || 'artifacts/v2.31/replay/multiturn-review-results.json');
if (!outputPath.startsWith(BASE + path.sep)) throw new Error('output_must_stay_inside_v2.31_replay');

const dimensions = ['facts', 'answers_question', 'naturalness', 'character_voice'];
function indexPacket(packet, name) {
  if (!Array.isArray(packet.samples)) throw new Error(`${name}_missing_samples`);
  const indexed = new Map();
  for (const sample of packet.samples) {
    if (!sample.sampleId || indexed.has(sample.sampleId)) throw new Error(`${name}_duplicate_or_missing_sample_id`);
    if (!Array.isArray(sample.conversation) || sample.conversation.length !== 4) throw new Error(`${name}_${sample.sampleId}_expected_four_turns`);
    for (const turn of sample.conversation) {
      for (const dimension of dimensions) {
        if (!Number.isInteger(turn.ratings?.[dimension]) || turn.ratings[dimension] < 1 || turn.ratings[dimension] > 5) {
          throw new Error(`${name}_${sample.sampleId}_turn_${turn.turnNumber}_missing_${dimension}_score`);
        }
      }
      if (typeof turn.hardFailure !== 'boolean') throw new Error(`${name}_${sample.sampleId}_turn_${turn.turnNumber}_missing_hard_failure_boolean`);
      if (turn.hardFailure && !String(turn.evidenceNotes || '').trim()) throw new Error(`${name}_${sample.sampleId}_turn_${turn.turnNumber}_hard_failure_needs_evidence`);
    }
    indexed.set(sample.sampleId, sample);
  }
  return indexed;
}

const a = indexPacket(packetA, 'reviewer_a');
const b = indexPacket(packetB, 'reviewer_b');
if (a.size !== b.size || [...a.keys()].some((id) => !b.has(id))) throw new Error('reviewer_sample_ids_do_not_match');
const mapping = new Map((keyFile.mapping || []).map((row) => [row.sampleId, row]));
if (mapping.size !== a.size || [...a.keys()].some((id) => !mapping.has(id))) throw new Error('review_key_does_not_match_packets');

const rows = [];
for (const [sampleId, meta] of mapping) {
  const sampleA = a.get(sampleId);
  const sampleB = b.get(sampleId);
  for (let i = 0; i < sampleA.conversation.length; i += 1) {
    const turnA = sampleA.conversation[i];
    const turnB = sampleB.conversation[i];
    if (turnA.turnNumber !== turnB.turnNumber || turnA.user !== turnB.user || turnA.reply !== turnB.reply) {
      throw new Error(`${sampleId}_reviewers_changed_or_mismatched_sample_text`);
    }
    rows.push({
      sampleId,
      arm: meta.arm,
      caseId: meta.caseId,
      run: meta.run,
      turnNumber: turnA.turnNumber,
      ratings: Object.fromEntries(dimensions.map((d) => [d, (turnA.ratings[d] + turnB.ratings[d]) / 2])),
      hardFailure: turnA.hardFailure || turnB.hardFailure,
      reviewersFlaggedHardFailure: [turnA.hardFailure, turnB.hardFailure].filter(Boolean).length,
    });
  }
}

const mean = (items) => items.length ? Number((items.reduce((sum, value) => sum + value, 0) / items.length).toFixed(3)) : null;
const summarize = (items) => ({
  turns: items.length,
  means: Object.fromEntries(dimensions.map((d) => [d, mean(items.map((row) => row.ratings[d]))])),
  hardFailureTurns: items.filter((row) => row.hardFailure).length,
  hardFailureFlaggedByBoth: items.filter((row) => row.reviewersFlaggedHardFailure === 2).length,
});
const arms = Object.fromEntries(['with-town', 'without-town'].map((arm) => [arm, summarize(rows.filter((row) => row.arm === arm))]));
const agreementCells = [];
for (const [sampleId, sampleA] of a) {
  const sampleB = b.get(sampleId);
  for (let i = 0; i < sampleA.conversation.length; i += 1) {
    for (const dimension of dimensions) {
      const left = sampleA.conversation[i].ratings[dimension];
      const right = sampleB.conversation[i].ratings[dimension];
      agreementCells.push({ exact: left === right, withinOne: Math.abs(left - right) <= 1 });
    }
  }
}

const paired = new Map();
for (const row of rows) {
  const pairKey = `${row.caseId}::${row.run}::${row.turnNumber}`;
  if (!paired.has(pairKey)) paired.set(pairKey, {});
  paired.get(pairKey)[row.arm] = row;
}
const deltas = [...paired.values()].filter((pair) => pair['with-town'] && pair['without-town']);
const result = {
  generatedAt: new Date().toISOString(),
  reviewerCount: 2,
  scoring: 'mean of two independent blinded reviewers; hard failure is union of reviewer flags',
  sampleCount: a.size,
  turnCount: rows.length,
  arms,
  pairedMeanDeltaWithTownMinusWithoutTown: Object.fromEntries(dimensions.map((d) => [d,
    mean(deltas.map((pair) => pair['with-town'].ratings[d] - pair['without-town'].ratings[d]))])),
  interRaterAgreement: {
    scoredCells: agreementCells.length,
    exactAgreementRate: mean(agreementCells.map((cell) => Number(cell.exact))),
    withinOnePointRate: mean(agreementCells.map((cell) => Number(cell.withinOne))),
  },
  rows,
};
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ output: path.relative(ROOT, outputPath), sampleCount: result.sampleCount, turnCount: result.turnCount, arms, interRaterAgreement: result.interRaterAgreement }, null, 2)}\n`);
