#!/usr/bin/env node
/** Build paired blind packets that change only causal-question replies in v7. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = path.join(ROOT, 'artifacts', 'v2.31', 'replay');
const BASELINE_DIR = path.join(REPLAY_ROOT, 'heldout-style-v4', 'runtime');
const CANDIDATE_DIR = path.join(REPLAY_ROOT, 'heldout-style-v7-causal-on');
const OUTPUT_DIR = path.join(REPLAY_ROOT, 'heldout-style-v7-causal-review');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function loadReplay(directory) {
  const replay = JSON.parse(fs.readFileSync(path.join(directory, 'emotion-expression-replay.json'), 'utf8'));
  if (replay.completeSamples !== replay.sampleCount || replay.completeTurns !== replay.totalTurns) {
    throw new Error(`incomplete_replay:${directory}`);
  }
  return replay;
}

const baseline = loadReplay(BASELINE_DIR);
const candidate = loadReplay(CANDIDATE_DIR);
const keyOf = sample => `${sample.caseId}::${sample.run}`;
const candidateByKey = new Map(candidate.results.map(sample => [keyOf(sample), sample]));
if (baseline.results.length !== candidate.results.length
    || baseline.results.some(sample => !candidateByKey.has(keyOf(sample)))) {
  throw new Error('baseline_and_candidate_samples_do_not_match');
}

const pairs = [];
for (const fixed of baseline.results) {
  const revised = candidateByKey.get(keyOf(fixed));
  if (fixed.turns.length !== 4 || revised.turns.length !== 4) throw new Error(`${keyOf(fixed)}_turn_count_mismatch`);
  const targetIndices = revised.turns
    .map((turn, index) => turn.expressionPlan?.virtualTownMoodCauseQuestion ? index : -1)
    .filter(index => index >= 0);
  if (targetIndices.length !== 2) throw new Error(`${keyOf(fixed)}_expected_two_target_turns`);

  const evidenceByTurn = revised.turns.map(turn => {
    const eventRecord = turn.expressionPlan?.virtualTownEvent ?? null;
    const observation = eventRecord?.independentMoodObservation ?? null;
    return {
      virtualTownQuestion: Boolean(turn.expressionPlan?.virtualTownQuestion),
      virtualTownMoodCauseQuestion: Boolean(turn.expressionPlan?.virtualTownMoodCauseQuestion),
      eventRecord,
      moodObservations: observation ? [observation] : [],
      moodCauseRecord: null,
    };
  });
  const buildConversation = treatment => fixed.turns.map((turn, index) => ({
    turnNumber: index + 1,
    user: turn.user,
    // Reuse the identical baseline context and replace only the two target replies.
    reply: treatment && targetIndices.includes(index) ? revised.turns[index].reply : turn.reply,
    evidence: evidenceByTurn[index],
    ratings: { facts: null, answers_question: null, naturalness: null, character_voice: null },
    hardFailure: null,
    evidenceNotes: '',
  }));
  for (const [condition, treatment] of [['fixed', false], ['causal_precision', true]]) {
    pairs.push({
      pairId: keyOf(fixed),
      condition,
      priorContext: fixed.context ?? [],
      knownTownRecords: [...new Map(evidenceByTurn.map(evidence => evidence.eventRecord)
        .filter(Boolean).map(event => [event.eventId, event])).values()],
      conversation: buildConversation(treatment),
    });
  }
}

function shuffle(values, initialSeed) {
  const rows = [...values];
  let seed = initialSeed >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [rows[index], rows[swap]] = [rows[swap], rows[index]];
  }
  return rows;
}

const mapped = shuffle(pairs, 0x7A31C0DE).map((sample, index) => ({
  sampleId: `S${String(index + 1).padStart(3, '0')}`,
  ...sample,
}));
for (const [reviewer, seed] of [['a', 0xA531], ['b', 0xB531]]) {
  const packet = {
    reviewer: reviewer.toUpperCase(),
    sourceRevision: 'heldout-style-v7-causal-precision',
    instructions: '独立评审每轮最终回复；不要讨论或查看另一份评分。组名和配对关系已隐藏。',
    samples: shuffle(mapped, seed).map(({ sampleId, priorContext, knownTownRecords, conversation }) => ({
      sampleId,
      priorContext,
      knownTownRecords: structuredClone(knownTownRecords),
      conversation: structuredClone(conversation),
    })),
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, `multiturn-reviewer-${reviewer}.json`), `${JSON.stringify(packet, null, 2)}\n`);
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'multiturn-review-key.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  pairing: 'same baseline four-turn replay; only the two mood-causality target replies are replaced by v7 guarded replies',
  mapping: mapped.map(({ sampleId, pairId, condition }) => ({ sampleId, pairId, condition })),
}, null, 2)}\n`);
process.stdout.write(`PACKETS=${mapped.length} PAIRS=${pairs.length / 2} OUT=${path.relative(ROOT, OUTPUT_DIR)}\n`);
