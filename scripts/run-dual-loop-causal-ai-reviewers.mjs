#!/usr/bin/env node
/** Two separate AI reviews of the anonymized dual-loop causal replay packets. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_ROOT = path.join(ROOT, 'artifacts/emotion-learning');
const REVIEW_DIR = path.resolve(process.env.DUAL_LOOP_REVIEW_DIR
  || path.join(REVIEW_ROOT, 'dual-loop-causal-review-v0.1'));
if (REVIEW_DIR !== REVIEW_ROOT && !REVIEW_DIR.startsWith(REVIEW_ROOT + path.sep)) {
  throw new Error('dual_loop_review_dir_must_stay_under_emotion_learning_artifacts');
}
const ENV_PATH = path.join(ROOT, '.env');
const REVIEWERS = [
  { id: 'a', model: 'deepseek-flash' },
  { id: 'b', model: 'deepseek-v4-pro' },
];

function readEnvValue(name) {
  if (!fs.existsSync(ENV_PATH)) return process.env[name] ?? '';
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return process.env[name] ?? '';
}
function parseJson(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch { /* try extracting a JSON object */ }
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('reviewer_returned_invalid_json');
}
function validate(result, packet) {
  if (!result || !Array.isArray(result.samples) || result.samples.length !== packet.cases.length) {
    throw new Error('review_result_sample_count_mismatch');
  }
  const expectedIds = new Set(packet.cases.map(item => item.sampleId));
  const seen = new Set();
  for (const sample of result.samples) {
    if (!expectedIds.has(sample.sampleId) || seen.has(sample.sampleId)) throw new Error('review_result_sample_id_mismatch');
    seen.add(sample.sampleId);
    for (const dimension of ['source_attribution', 'evidence_fit', 'correction', 'causal_isolation']) {
      const score = sample.scores?.[dimension];
      if (score !== null && (!Number.isInteger(score) || score < 0 || score > 2)) {
        throw new Error(`${sample.sampleId}_invalid_${dimension}`);
      }
    }
    if (!sample.scores || !Number.isInteger(sample.scores.source_attribution)
      || !Number.isInteger(sample.scores.evidence_fit) || typeof sample.evidenceNote !== 'string') {
      throw new Error(`${sample.sampleId}_missing_required_review_fields`);
    }
  }
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const reviewerArg = process.argv.indexOf('--reviewer');
const reviewers = reviewerArg >= 0 ? REVIEWERS.filter(item => item.id === process.argv[reviewerArg + 1]) : REVIEWERS;
if (!reviewers.length) throw new Error('reviewer_not_found');

for (const reviewer of (process.argv.includes('--summarize-only') ? [] : reviewers)) {
  const packet = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, `reviewer-${reviewer.id}.json`), 'utf8'));
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: reviewer.model,
      messages: [
        { role: 'system', content: '你是独立评估者。只根据本次提供的盲评包作判断，不访问隐藏答案，不臆测角色内部事实。输出必须符合用户要求的 JSON 格式。' },
        { role: 'user', content: JSON.stringify({
          instructions: packet.instructions,
          rubric: packet.rubric,
          scale: packet.scale,
          cases: packet.cases,
        }) },
      ],
      temperature: 0.1,
      max_tokens: 4000,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${reviewer.model}_http_${response.status}`);
  const payload = await response.json();
  const rawOutput = payload.choices?.[0]?.message?.content ?? '';
  const result = validate(parseJson(rawOutput), packet);
  const outputPath = path.join(REVIEW_DIR, `reviewer-${reviewer.id}-scored.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify({
    reviewer: reviewer.id,
    evaluation: { provider: 'DeepSeek', model: reviewer.model, temperature: 0.1, usage: payload.usage ?? null },
    results: result.samples,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`reviewer-${reviewer.id}: scored ${result.samples.length} blind cases\n`);
}

if (REVIEWERS.every(reviewer => fs.existsSync(path.join(REVIEW_DIR, `reviewer-${reviewer.id}-scored.json`)))) {
  const answerKey = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, 'answer-key.json'), 'utf8'));
  const packets = Object.fromEntries(REVIEWERS.map(reviewer => [reviewer.id,
    JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, `reviewer-${reviewer.id}-scored.json`), 'utf8'))]));
  const dims = ['source_attribution', 'evidence_fit', 'correction', 'causal_isolation'];
  const summary = { generatedAt: new Date().toISOString(), reviewers: REVIEWERS.map(item => item.model), dimensions: {}, caseDisagreements: [] };
  const byId = Object.fromEntries(REVIEWERS.map(reviewer => [reviewer.id,
    new Map(packets[reviewer.id].results.map(item => [item.sampleId, item]))]));
  for (const dimension of dims) {
    const scores = REVIEWERS.flatMap(reviewer => packets[reviewer.id].results
      .map(item => item.scores[dimension]).filter(Number.isInteger));
    summary.dimensions[dimension] = scores.length
      ? { mean: scores.reduce((sum, score) => sum + score, 0) / scores.length, ratings: scores.length }
      : { mean: null, ratings: 0 };
  }
  const canonicalRows = new Map();
  for (const row of answerKey.mapping) {
    const canonical = canonicalRows.get(row.sourceScenario) ?? {};
    canonical[row.reviewer] = row.sampleId;
    canonicalRows.set(row.sourceScenario, canonical);
  }
  for (const [sourceScenario, ids] of canonicalRows) {
    if (!ids.a || !ids.b) throw new Error(`missing_reviewer_mapping_${sourceScenario}`);
    const a = byId.a.get(ids.a), b = byId.b.get(ids.b);
    if (!a || !b) throw new Error(`reviewer_result_missing_${sourceScenario}`);
    const differences = Object.fromEntries(dims.map(dimension => [dimension, {
      a: a.scores[dimension], b: b.scores[dimension],
      absolute: Number.isInteger(a.scores[dimension]) && Number.isInteger(b.scores[dimension])
        ? Math.abs(a.scores[dimension] - b.scores[dimension]) : null,
    }]));
    if (Object.values(differences).some(item => item.absolute !== null && item.absolute > 0)) {
      summary.caseDisagreements.push({ sourceScenario, differences });
    }
  }
  fs.writeFileSync(path.join(REVIEW_DIR, 'review-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`SUMMARY=${path.relative(ROOT, path.join(REVIEW_DIR, 'review-summary.json'))}\n`);
}
