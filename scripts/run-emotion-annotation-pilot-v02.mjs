#!/usr/bin/env node
/** Run protocol v0.2's synthetic contrast cases through two isolated reviewers. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_DIR = path.join(ROOT, 'artifacts', 'emotion-learning');
const PROTOCOL_PATH = path.join(DOC_DIR, 'emotion-annotation-protocol-v0.2.md');
const CASES_PATH = path.join(DOC_DIR, 'emotion-annotation-contrast-cases-v0.2.jsonl');
const OUTPUT_DIR = path.join(DOC_DIR, 'pilot-results-v0.2');
const ENV_PATH = path.join(ROOT, '.env');
const REVIEWERS = [
  { id: 'reviewer-a', model: 'deepseek-flash' },
  { id: 'reviewer-b', model: 'deepseek-v4-pro' },
];
const values = {
  subject: new Set(['user', 'quoted_person', 'third_party', 'multiple', 'unknown']),
  affectReportKind: new Set(['explicit_self_report', 'quoted_or_third_party', 'inferred', 'mixed', 'unknown']),
  temporalScope: new Set(['moment', 'ongoing', 'interval', 'retrospective', 'recurring_conditional', 'mixed', 'unspecified']),
  directedAtAI: new Set(['yes', 'no', 'mixed', 'unknown']),
  strength: new Set(['weak', 'moderate', 'strong', 'unknown']),
  appraisal: ['relevance', 'expectation', 'attribution', 'controllability', 'certainty', 'fairness', 'normCompatibility', 'novelty', 'goalCongruence'],
};

function readEnvValue(name) {
  const source = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === name) return match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

function parseJson(content) {
  const raw = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(raw); } catch { /* try JSON embedded in surrounding text */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('reviewer_returned_invalid_json');
}

function validate(result, sample) {
  if (!result || result.caseId !== sample.id) throw new Error(`${sample.id}_case_id_mismatch`);
  for (const field of ['subject', 'affectReportKind', 'temporalScope', 'directedAtAI']) {
    if (!values[field].has(result[field])) throw new Error(`${sample.id}_invalid_${field}`);
  }
  if (!Array.isArray(result.reportedTimeExpressions) || !Array.isArray(result.emotionCandidates)
      || result.emotionCandidates.length > 3 || !Array.isArray(result.negatedAffectMentions)
      || !Array.isArray(result.alternativesOrUnknowns) || result.alternativesOrUnknowns.length < 1) {
    throw new Error(`${sample.id}_invalid_shape`);
  }
  for (const candidate of result.emotionCandidates) {
    if (!candidate || typeof candidate.label !== 'string' || !candidate.label.trim()
        || typeof candidate.surfaceText !== 'string' || !candidate.surfaceText.trim()
        || typeof candidate.evidenceQuote !== 'string' || !candidate.evidenceQuote.trim()
        || !values.subject.has(candidate.subject) || !values.strength.has(candidate.strength)
        || typeof candidate.isExplicit !== 'boolean' || !values.directedAtAI.has(candidate.directedAtAI)) {
      throw new Error(`${sample.id}_invalid_candidate`);
    }
    if (!sample.message.includes(candidate.evidenceQuote) && !sample.context.includes(candidate.evidenceQuote)) {
      throw new Error(`${sample.id}_candidate_evidence_not_in_case`);
    }
  }
  for (const mention of result.negatedAffectMentions) {
    if (!mention || typeof mention.label !== 'string' || !mention.label.trim()
        || typeof mention.evidenceQuote !== 'string' || !mention.evidenceQuote.trim()
        || !values.subject.has(mention.subject)
        || !sample.message.includes(mention.evidenceQuote)) throw new Error(`${sample.id}_invalid_negated_mention`);
  }
  if (!result.appraisalDimensions || values.appraisal.some((key) => result.appraisalDimensions[key] !== 'unknown')) {
    throw new Error(`${sample.id}_appraisal_must_be_unknown`);
  }
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const fullProtocol = fs.readFileSync(PROTOCOL_PATH, 'utf8');
const start = fullProtocol.indexOf('## 1.');
const end = fullProtocol.indexOf('## 8.');
if (start < 0 || end <= start) throw new Error('protocol_sections_not_found');
const protocol = `${fullProtocol.slice(start, end).trim()}\n\n仅输出一个 JSON 对象，不能添加 Markdown 或解释。顶层必须为 caseId、subject、affectReportKind、temporalScope、reportedTimeExpressions、emotionCandidates、negatedAffectMentions、directedAtAI、alternativesOrUnknowns、appraisalDimensions。emotionCandidates 每项必须包含 label、surfaceText、evidenceQuote、subject、strength、isExplicit、directedAtAI；negatedAffectMentions 每项必须包含 label、evidenceQuote、subject。`;
const cases = fs.readFileSync(CASES_PATH, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
if (cases.length !== 11 || new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error('contrast_pack_must_have_11_unique_cases');
const hash = createHash('sha256').update(protocol).digest('hex');
const runAt = new Date().toISOString();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function annotate(model, sample) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: protocol },
        { role: 'user', content: JSON.stringify({ caseId: sample.id, context: sample.context, message: sample.message }) },
      ],
      temperature: 0.1,
      max_tokens: 1400,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`${model}_http_${response.status}`);
  const payload = await response.json();
  const rawOutput = payload.choices?.[0]?.message?.content;
  return { annotation: validate(parseJson(rawOutput), sample), rawOutput, usage: payload.usage ?? null };
}

for (const reviewer of REVIEWERS) {
  const outputPath = path.join(OUTPUT_DIR, `${reviewer.id}.json`);
  const annotations = [];
  for (let index = 0; index < cases.length; index += 1) {
    const sample = cases[index];
    try {
      const result = await annotate(reviewer.model, sample);
      annotations.push({ caseId: sample.id, annotation: result.annotation, rawOutput: result.rawOutput, usage: result.usage, error: null });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${cases.length} ${sample.id}\n`);
    } catch (error) {
      annotations.push({ caseId: sample.id, annotation: null, rawOutput: null, usage: null, error: String(error?.message ?? error) });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${cases.length} ${sample.id} ERROR\n`);
    }
    fs.writeFileSync(outputPath, JSON.stringify({
      evaluation: {
        type: 'protocol v0.2 synthetic contrast calibration', reviewerId: reviewer.id,
        model: reviewer.model, provider: 'DeepSeek', protocol: path.basename(PROTOCOL_PATH),
        protocolPromptSha256: hash, casePack: path.basename(CASES_PATH),
        toolAccess: 'none; separate request per case; no shared reviewer context', runAt,
        completedCases: annotations.length,
      },
      annotations,
    }, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(`OUTPUT=${path.relative(ROOT, outputPath)}\n`);
}
