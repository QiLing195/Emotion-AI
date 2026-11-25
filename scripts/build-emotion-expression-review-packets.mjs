#!/usr/bin/env node
/** Build two independently ordered blind-review packets from a completed replay. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.resolve(REPO, 'artifacts');
const OUTPUT_DIR = path.resolve(process.env.EMOTION_EVAL_OUTPUT_DIR || path.join(ARTIFACTS, 'v2.30', 'post-fix'));
if (OUTPUT_DIR === ARTIFACTS || !OUTPUT_DIR.startsWith(ARTIFACTS + path.sep)) {
  throw new Error('refusing_to_write_review_packets_outside_artifacts');
}

const replay = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, 'emotion-expression-replay.json'), 'utf8'));
const dataset = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, 'v2.30', 'emotion-expression-eval-set.json'), 'utf8'));
const dimensions = dataset.blindReviewRubric.map(item => item.dimension);

function shuffled(values, initialSeed) {
  const rows = [...values];
  let seed = initialSeed >>> 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [rows[index], rows[swap]] = [rows[swap], rows[index]];
  }
  return rows;
}

function buildPacket(reviewer, seed) {
  const samples = replay.results.map((sample) => {
    if (!sample.blindedSampleId || sample.status !== 'complete') return null;
    return {
      sampleId: sample.blindedSampleId,
      priorContext: sample.context ?? [],
      conversation: sample.turns.map((turn, index) => ({
        turnNumber: index + 1,
        user: turn.user,
        reply: turn.reply,
        ratings: Object.fromEntries(dimensions.map(dimension => [dimension, null])),
        hardFailure: null,
        evidenceNotes: '',
      })),
    };
  }).filter(Boolean);

  if (samples.length !== replay.sampleCount || replay.completeSamples !== replay.sampleCount) {
    throw new Error('replay_is_incomplete_or_missing_blind_mapping');
  }

  return {
    reviewer,
    replayAt: replay.generatedAt,
    instructions: '独立评审每轮回复；不要讨论或查看另一份评分。1–5 分，出现硬失败时勾选并写明原文证据。',
    rubric: dataset.blindReviewRubric,
    ratingScale: dataset.ratingScale,
    hardFailureExamples: dataset.hardFailureExamples,
    samples: shuffled(samples, seed),
  };
}

for (const [reviewer, seed] of [['A', 0xA230], ['B', 0xB230]]) {
  const packet = buildPacket(reviewer, seed);
  fs.writeFileSync(path.join(OUTPUT_DIR, `reviewer-${reviewer.toLowerCase()}.json`), JSON.stringify(packet, null, 2), 'utf8');
  process.stdout.write(`reviewer-${reviewer.toLowerCase()}.json: ${packet.samples.length} 匿名样本\n`);
}
