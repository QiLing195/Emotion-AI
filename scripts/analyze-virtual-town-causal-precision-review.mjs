#!/usr/bin/env node
/** Summarize paired two-reviewer scores for the v7 causal-precision change. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_DIR = path.join(ROOT, 'artifacts', 'v2.31', 'replay', 'heldout-style-v7-causal-review');
const DIMENSIONS = ['facts', 'answers_question', 'naturalness', 'character_voice'];
const key = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, 'multiturn-review-key.json'), 'utf8'));
const mapping = new Map(key.mapping.map(row => [row.sampleId, row]));
const reviewers = ['a', 'b'].map(id => JSON.parse(fs.readFileSync(
  path.join(REVIEW_DIR, `multiturn-reviewer-${id}-ai-scored.json`), 'utf8',
)));
const byReviewer = reviewers.map(packet => new Map(packet.samples.map(sample => [sample.sampleId, sample])));

const observations = new Map();
for (const [reviewerIndex, samples] of byReviewer.entries()) {
  for (const sample of samples.values()) {
    const { condition, pairId } = mapping.get(sample.sampleId) ?? {};
    if (!condition || !pairId) throw new Error(`missing_mapping:${sample.sampleId}`);
    for (const turn of sample.conversation) {
      // v14 corpus preregisters its two mood-causality probes at turns 2 and 4.
      if (![2, 4].includes(turn.turnNumber)) continue;
      const key = `${pairId}::${condition}`;
      const row = observations.get(key) ?? { pairId, condition, ratings: Object.fromEntries(DIMENSIONS.map(d => [d, []])), hardFailures: 0, reviewerScores: [] };
      for (const dimension of DIMENSIONS) row.ratings[dimension].push(turn.ratings[dimension]);
      row.hardFailures += turn.hardFailure ? 1 : 0;
      row.reviewerScores.push({ reviewer: reviewerIndex, sampleId: sample.sampleId, turnNumber: turn.turnNumber, ratings: turn.ratings });
      observations.set(key, row);
    }
  }
}

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const conditions = ['fixed', 'causal_precision'];
const summary = Object.fromEntries(conditions.map(condition => {
  const rows = [...observations.values()].filter(row => row.condition === condition);
  return [condition, {
    targetRatings: rows.reduce((n, row) => n + row.ratings.facts.length, 0),
    hardFailures: rows.reduce((n, row) => n + row.hardFailures, 0),
    scores: Object.fromEntries(DIMENSIONS.map(dimension => [dimension, mean(rows.flatMap(row => row.ratings[dimension]))])),
  }];
}));

const pairIds = [...new Set(key.mapping.map(row => row.pairId))];
const paired = Object.fromEntries(DIMENSIONS.map(dimension => {
  const deltas = pairIds.map(pairId => {
    const fixed = observations.get(`${pairId}::fixed`);
    const treatment = observations.get(`${pairId}::causal_precision`);
    return mean(treatment.ratings[dimension]) - mean(fixed.ratings[dimension]);
  });
  return [dimension, {
    meanDelta: mean(deltas),
    up: deltas.filter(delta => delta > 0).length,
    tie: deltas.filter(delta => delta === 0).length,
    down: deltas.filter(delta => delta < 0).length,
    pairs: deltas.length,
  }];
}));

const exactAgreement = [];
const withinOneAgreement = [];
for (const reviewerSample of byReviewer[0].values()) {
  const other = byReviewer[1].get(reviewerSample.sampleId);
  if (!other) throw new Error(`missing_reviewer_b_sample:${reviewerSample.sampleId}`);
  for (let index = 0; index < reviewerSample.conversation.length; index += 1) {
    const left = reviewerSample.conversation[index];
    const right = other.conversation[index];
    if (![2, 4].includes(left.turnNumber)) continue;
    const differences = DIMENSIONS.map(d => Math.abs(left.ratings[d] - right.ratings[d]));
    exactAgreement.push(differences.every(diff => diff === 0));
    withinOneAgreement.push(differences.every(diff => diff <= 1));
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  reviewerModels: reviewers.map(packet => packet.evaluation?.model),
  pairedConversations: pairIds.length,
  targetTurnsPerCondition: 30,
  summary,
  pairedTargetReplyDeltas: paired,
  reviewerAgreement: {
    exactAcrossDimensions: mean(exactAgreement.map(Boolean).map(Number)),
    withinOneAcrossDimensions: mean(withinOneAgreement.map(Boolean).map(Number)),
    observations: exactAgreement.length,
  },
};
fs.writeFileSync(path.join(REVIEW_DIR, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
