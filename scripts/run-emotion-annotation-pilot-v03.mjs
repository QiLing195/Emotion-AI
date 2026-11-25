#!/usr/bin/env node
/** Run protocol v0.3 development cases through two isolated reviewer requests. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_DIR = path.join(ROOT, 'artifacts', 'emotion-learning');
const PROTOCOL_PATH = path.join(DOC_DIR, 'emotion-annotation-protocol-v0.3.md');
const CASES_PATH = path.join(DOC_DIR, 'emotion-annotation-contrast-cases-v0.3.jsonl');
const OUTPUT_DIR = path.join(DOC_DIR, 'pilot-results-v0.3');
const ENV_PATH = path.join(ROOT, '.env');
const REVIEWERS = [{ id: 'reviewer-a', model: 'deepseek-flash' }, { id: 'reviewer-b', model: 'deepseek-v4-pro' }];
const enumValues = {
  subject: new Set(['user', 'quoted_person', 'third_party', 'multiple', 'unknown']),
  affectReportKind: new Set(['explicit_self_report', 'quoted_or_third_party', 'inferred', 'mixed', 'unknown']),
  temporalScope: new Set(['moment', 'ongoing', 'interval', 'retrospective', 'recurring_conditional', 'mixed', 'unspecified']),
  directedAtAI: new Set(['yes', 'no', 'mixed', 'unknown']),
  strength: new Set(['weak', 'moderate', 'strong', 'unknown']),
};
const appraisalFields = ['relevance', 'expectation', 'attribution', 'controllability', 'certainty', 'fairness', 'normCompatibility', 'novelty', 'goalCongruence'];

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
  try { return JSON.parse(raw); } catch { /* try embedded JSON */ }
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('reviewer_returned_invalid_json');
}
function isEvidence(sample, quote) { return sample.message.includes(quote) || sample.context.includes(quote); }
function validate(result, sample) {
  if (!result || result.caseId !== sample.id) throw new Error(`${sample.id}_case_id_mismatch`);
  for (const field of ['subject', 'affectReportKind', 'temporalScope', 'directedAtAI']) {
    if (!enumValues[field].has(result[field])) throw new Error(`${sample.id}_invalid_${field}`);
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
        || !enumValues.subject.has(candidate.subject) || !enumValues.strength.has(candidate.strength)
        || typeof candidate.isExplicit !== 'boolean' || !enumValues.directedAtAI.has(candidate.directedAtAI)
        || !Array.isArray(candidate.supportingEvidence)) throw new Error(`${sample.id}_invalid_candidate_fields`);
    if (!isEvidence(sample, candidate.evidenceQuote)
        || candidate.supportingEvidence.some((quote) => typeof quote !== 'string' || !isEvidence(sample, quote))) {
      throw new Error(`${sample.id}_candidate_evidence_not_in_case`);
    }
    if (!candidate.isExplicit && candidate.supportingEvidence.length < 1) throw new Error(`${sample.id}_inference_without_evidence`);
    if (candidate.isExplicit && candidate.supportingEvidence.length < 1) throw new Error(`${sample.id}_explicit_without_evidence`);
    if (candidate.isExplicit && candidate.label !== candidate.surfaceText) throw new Error(`${sample.id}_explicit_label_must_preserve_surface`);
  }
  for (const mention of result.negatedAffectMentions) {
    if (!mention || typeof mention.label !== 'string' || !mention.label.trim()
        || typeof mention.evidenceQuote !== 'string' || !mention.evidenceQuote.trim()
        || !enumValues.subject.has(mention.subject) || !sample.message.includes(mention.evidenceQuote)) {
      throw new Error(`${sample.id}_invalid_negated_mention`);
    }
  }
  if (!result.appraisalDimensions || appraisalFields.some((field) => result.appraisalDimensions[field] !== 'unknown')) {
    throw new Error(`${sample.id}_appraisal_must_be_unknown`);
  }
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const fullProtocol = fs.readFileSync(PROTOCOL_PATH, 'utf8');
const sectionStart = fullProtocol.indexOf('## 标注规则');
const sectionEnd = fullProtocol.indexOf('## v0.3 案例状态');
if (sectionStart < 0 || sectionEnd <= sectionStart) throw new Error('protocol_sections_not_found');
const protocol = `${fullProtocol.slice(sectionStart, sectionEnd).trim()}\n\n顶层枚举值严格使用协议指定的值，strength 只可为 weak、moderate、strong、unknown，禁止输出 low、medium、high、unspecified。只输出一个 JSON 对象，不得输出 Markdown 或额外字段。顶层字段必须为 caseId、subject、affectReportKind、temporalScope、reportedTimeExpressions、emotionCandidates、negatedAffectMentions、directedAtAI、alternativesOrUnknowns、appraisalDimensions。emotionCandidates 每项包含 label、surfaceText、evidenceQuote、supportingEvidence、subject、strength、isExplicit、directedAtAI；明确自述时 label 必须等于 surfaceText；negatedAffectMentions 每项包含 label、evidenceQuote、subject。`;
const cases = fs.readFileSync(CASES_PATH, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
if (cases.length !== 15 || new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error('case_pack_must_have_15_unique_cases');
const promptSha256 = createHash('sha256').update(protocol).digest('hex');
const runAt = new Date().toISOString();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function annotate(model, sample) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [
      { role: 'system', content: protocol },
      { role: 'user', content: JSON.stringify({ caseId: sample.id, context: sample.context, message: sample.message }) },
    ], temperature: 0.1, max_tokens: 1400, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`${model}_http_${response.status}`);
  const payload = await response.json(), rawOutput = payload.choices?.[0]?.message?.content;
  try { return { annotation: validate(parseJson(rawOutput), sample), rawOutput, usage: payload.usage ?? null }; }
  catch (error) { error.rawOutput = rawOutput; throw error; }
}

const caseArg = process.argv.indexOf('--case');
const reviewerArg = process.argv.indexOf('--reviewer');
const selectedCases = caseArg >= 0 ? cases.filter((item) => item.id === process.argv[caseArg + 1]) : cases;
const selectedReviewers = reviewerArg >= 0 ? REVIEWERS.filter((item) => item.id === process.argv[reviewerArg + 1]) : REVIEWERS;
if (!selectedCases.length || !selectedReviewers.length) throw new Error('requested_case_or_reviewer_not_found');
for (const reviewer of selectedReviewers) {
  const outputPath = path.join(OUTPUT_DIR, `${reviewer.id}.json`), annotations = [];
  for (let index = 0; index < selectedCases.length; index += 1) {
    const sample = selectedCases[index];
    try {
      const result = await annotate(reviewer.model, sample);
      annotations.push({ caseId: sample.id, annotation: result.annotation, rawOutput: result.rawOutput, usage: result.usage, error: null });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${selectedCases.length} ${sample.id}\n`);
    } catch (error) {
      annotations.push({ caseId: sample.id, annotation: null, rawOutput: error?.rawOutput ?? null, usage: null, error: String(error?.message ?? error) });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${selectedCases.length} ${sample.id} ERROR\n`);
    }
    fs.writeFileSync(outputPath, JSON.stringify({
      evaluation: { type: 'protocol v0.3 synthetic contrast calibration', reviewerId: reviewer.id, model: reviewer.model,
        provider: 'DeepSeek', protocol: path.basename(PROTOCOL_PATH), protocolPromptSha256: promptSha256,
        casePack: path.basename(CASES_PATH), toolAccess: 'none; separate request per case; no shared reviewer context',
        runAt, completedCases: annotations.length }, annotations,
    }, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(`OUTPUT=${path.relative(ROOT, outputPath)}\n`);
}
