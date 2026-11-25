#!/usr/bin/env node
/** Send two blinded affect-annotation packets to separate reviewer models. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'artifacts/emotion-learning');
const reviewDir = path.resolve(process.env.AFFECT_BLIND_REVIEW_DIR
  || path.join(artifactRoot, 'dual-loop-causal-review-v0.5', 'blind-review-v0.2'));
if (!reviewDir.startsWith(artifactRoot + path.sep)) throw new Error('blind_review_dir_must_stay_under_emotion_learning_artifacts');
const envPath = path.join(root, '.env');

function readEnvValue(name) {
  if (!fs.existsSync(envPath)) return process.env[name] ?? '';
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return process.env[name] ?? '';
}
function parseJson(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch { /* try object extraction */ }
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('reviewer_returned_invalid_json');
}
function validate(result, packet) {
  if (!Array.isArray(result?.samples) || result.samples.length !== packet.cases.length) throw new Error('sample_count_mismatch');
  const byId = new Map(packet.cases.map(item => [item.sampleId, item]));
  const seen = new Set();
  for (const sample of result.samples) {
    const source = byId.get(sample.sampleId);
    if (!source || seen.has(sample.sampleId)) throw new Error('sample_id_mismatch');
    seen.add(sample.sampleId);
    if (!Array.isArray(sample.reports) || !['open', 'declined', 'unclear'].includes(sample.engagementBoundary)
      || !['same_owner_topic_overlap', 'different_owner_topic_overlap', 'none', 'unclear'].includes(sample.concernOwnerRelation)
      || !['same_event', 'different_event', 'unlinked'].includes(sample.eventIdentity)
      || typeof sample.rationale !== 'string') throw new Error(`${sample.sampleId}_invalid_review_shape`);
    for (const report of sample.reports) {
      if (!['user', 'third_party', 'unknown'].includes(report.subject)
        || !['sad', 'joy', 'anger', 'fear', 'love', 'gratitude', 'disgust', 'calm', 'other', 'unknown'].includes(report.emotion)
        || !['explicit', 'inferred', 'quoted', 'hypothetical', 'historical', 'none'].includes(report.reportKind)
        || !['current', 'interval', 'historical', 'hypothetical', 'unclear'].includes(report.temporalScope)
        || typeof report.emotionEvidence !== 'string' || typeof report.causeEvidence !== 'string') {
        throw new Error(`${sample.sampleId}_invalid_report`);
      }
      if (report.emotionEvidence && !source.userText.includes(report.emotionEvidence)) throw new Error(`${sample.sampleId}_emotion_evidence_not_literal`);
      if (report.causeEvidence && !source.userText.includes(report.causeEvidence)) throw new Error(`${sample.sampleId}_cause_evidence_not_literal`);
    }
  }
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const reviewers = [
  { id: 'a', model: 'deepseek-flash' },
  { id: 'b', model: 'deepseek-v4-pro' },
];
for (const reviewer of reviewers) {
  const packet = JSON.parse(fs.readFileSync(path.join(reviewDir, `reviewer-${reviewer.id}.json`), 'utf8'));
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: reviewer.model,
      messages: [
        { role: 'system', content: '你是独立盲评标注者。只标注给定原话，不访问或猜测隐藏答案。所有证据必须逐字引用。严格按 requiredJson 输出 JSON 对象。' },
        { role: 'user', content: JSON.stringify({ instructions: packet.instructions, rubric: packet.rubric, requiredJson: packet.requiredJson, cases: packet.cases }) },
      ],
      temperature: 0.1,
      max_tokens: 6000,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${reviewer.model}_http_${response.status}`);
  const payload = await response.json();
  const result = validate(parseJson(payload.choices?.[0]?.message?.content), packet);
  fs.writeFileSync(path.join(reviewDir, `reviewer-${reviewer.id}-scored.json`), `${JSON.stringify({
    reviewer: reviewer.id,
    evaluation: { provider: 'DeepSeek', model: reviewer.model, temperature: 0.1, usage: payload.usage ?? null },
    results: result.samples,
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`reviewer-${reviewer.id}: annotated ${result.samples.length} blinded cases\n`);
}

const key = JSON.parse(fs.readFileSync(path.join(reviewDir, 'answer-key.json'), 'utf8'));
const scored = Object.fromEntries(reviewers.map(reviewer => [reviewer.id,
  JSON.parse(fs.readFileSync(path.join(reviewDir, `reviewer-${reviewer.id}-scored.json`), 'utf8'))]));
const bySource = Object.fromEntries(reviewers.map(reviewer => [reviewer.id, new Map(
  key.mapping.filter(row => row.reviewer === reviewer.id).map(row => [
    row.sourceCase,
    scored[reviewer.id].results.find(result => result.sampleId === row.sampleId),
  ]),
)]));
const disagreements = [];
for (const row of key.mapping.filter(item => item.reviewer === 'a')) {
  const a = bySource.a.get(row.sourceCase), b = bySource.b.get(row.sourceCase);
  const signature = item => JSON.stringify({
    reports: item.reports.map(report => `${report.subject}:${report.emotion}:${report.reportKind}`).sort(),
    boundary: item.engagementBoundary,
    relation: item.concernRelation,
  });
  if (signature(a) !== signature(b)) disagreements.push({ sourceCase: row.sourceCase, reviewerA: a, reviewerB: b });
}
const report = {
  generatedAt: new Date().toISOString(),
  sourceSet: key.sourceSet,
  reviewers: reviewers.map(item => item.model),
  caseCount: bySource.a.size,
  relationAgreement: [...bySource.a.keys()].filter(id => bySource.a.get(id).concernRelation === bySource.b.get(id).concernRelation).length,
  structuredDisagreementCount: disagreements.length,
  disagreements,
  limitations: ['两个 AI 评审不是人类独立金标准；同服务模型可能共享偏差。', '一致率是十个合成案例上的描述统计，不代表外部效度。'],
};
fs.writeFileSync(path.join(reviewDir, 'blind-review-summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`relation agreement: ${report.relationAgreement}/${report.caseCount}; structured disagreements: ${report.structuredDisagreementCount}\n`);
