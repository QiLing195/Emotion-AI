#!/usr/bin/env node
/** Run the synthetic emotion annotation pilot with two isolated DeepSeek reviewers. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES_PATH = path.join(ROOT, 'artifacts', 'emotion-learning', 'emotion-annotation-pilot-cases-v0.1.jsonl');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'emotion-learning', 'pilot-results');
const ENV_PATH = path.join(ROOT, '.env');
const REVIEWERS = [
  { id: 'reviewer-a', model: 'deepseek-flash' },
  { id: 'reviewer-b', model: 'deepseek-v4-pro' },
];
const ALLOWED = {
  subject: new Set(['user', 'quoted_person', 'third_party', 'multiple', 'unknown']),
  affectReportKind: new Set(['explicit_self_report', 'quoted_or_third_party', 'inferred', 'unknown']),
  temporalScope: new Set(['moment', 'ongoing', 'interval', 'retrospective', 'unspecified']),
  strength: new Set(['weak', 'moderate', 'strong', 'unknown']),
  directedAtAI: new Set(['yes', 'no', 'unknown']),
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

function validate(result, expectedId) {
  if (!result || result.caseId !== expectedId) throw new Error(`${expectedId}_case_id_mismatch`);
  for (const field of ['subject', 'affectReportKind', 'temporalScope', 'directedAtAI']) {
    if (!ALLOWED[field].has(result[field])) throw new Error(`${expectedId}_invalid_${field}`);
  }
  if (typeof result.reportedInterval !== 'string' || !Array.isArray(result.emotionCandidates)
      || result.emotionCandidates.length > 3 || !Array.isArray(result.alternativesOrUnknowns)
      || result.alternativesOrUnknowns.length < 1) throw new Error(`${expectedId}_invalid_shape`);
  for (const candidate of result.emotionCandidates) {
    if (!candidate || typeof candidate.label !== 'string' || !candidate.label.trim()
        || !ALLOWED.strength.has(candidate.strength) || typeof candidate.evidenceQuote !== 'string'
        || typeof candidate.isExplicit !== 'boolean') throw new Error(`${expectedId}_invalid_candidate`);
  }
  const dimensions = result.appraisalDimensions;
  const dimensionKeys = ['relevance', 'expectation', 'attribution', 'controllability', 'certainty', 'fairness', 'normCompatibility', 'novelty', 'goalCongruence'];
  if (!dimensions || dimensionKeys.some((key) => dimensions[key] !== 'unknown')) throw new Error(`${expectedId}_appraisal_must_be_unknown`);
  return result;
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const cases = fs.readFileSync(CASES_PATH, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
if (cases.length !== 8 || new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error('pilot_case_pack_must_have_8_unique_cases');

const protocol = `你是独立情绪标注者。仅依据本条案例中的上下文与原话填写 JSON；不要查资料，不要补出未说的心理原因，也不要把推断写成明确自述。引用原话作为证据。允许 unknown 和空候选。不得访问项目文件、外部工具、网络检索、其他评审会话或隐藏答案；你只会收到单条合成案例。不得只凭一个负面词就把情绪定为愤怒；注意否定、引号、反讽、第三人称和时间变化。没有足够依据时允许不选情绪。

字段契约：subject 为 user|quoted_person|third_party|multiple|unknown；affectReportKind 为 explicit_self_report|quoted_or_third_party|inferred|unknown；temporalScope 为 moment|ongoing|interval|retrospective|unspecified；reportedInterval 仅写原话明确给出的时间范围，不自行换算日期；emotionCandidates 为 0–3 项，每项包含 label、strength（weak|moderate|strong|unknown）、evidenceQuote、isExplicit；directedAtAI 为 yes|no|unknown，只有上下文明确情绪针对 AI 时才填 yes；alternativesOrUnknowns 至少写一个合理替代解释或 none_observed，并说明文本缺少什么信息；appraisalDimensions 中 relevance、expectation、attribution、controllability、certainty、fairness、normCompatibility、novelty、goalCongruence 必须全部为 unknown，因为没有提供完整人物档案。

只返回一个 JSON 对象，不得添加文本或额外字段，格式：{"caseId":"ANP-01","subject":"user","affectReportKind":"explicit_self_report","temporalScope":"moment","reportedInterval":"","emotionCandidates":[{"label":"难受","strength":"moderate","evidenceQuote":"我现在挺难受的","isExplicit":true}],"directedAtAI":"unknown","alternativesOrUnknowns":["..."],"appraisalDimensions":{"relevance":"unknown","expectation":"unknown","attribution":"unknown","controllability":"unknown","certainty":"unknown","fairness":"unknown","normCompatibility":"unknown","novelty":"unknown","goalCongruence":"unknown"}}`;
const promptHash = createHash('sha256').update(protocol).digest('hex');
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
      max_tokens: 1200,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw new Error(`${model}_http_${response.status}`);
  const payload = await response.json();
  const rawContent = payload.choices?.[0]?.message?.content;
  const parsed = validate(parseJson(rawContent), sample.id);
  return { parsed, rawContent, usage: payload.usage ?? null };
}

for (const reviewer of REVIEWERS) {
  const outputPath = path.join(OUTPUT_DIR, `${reviewer.id}.json`);
  const annotations = [];
  for (let index = 0; index < cases.length; index += 1) {
    const sample = cases[index];
    try {
      const result = await annotate(reviewer.model, sample);
      annotations.push({ caseId: sample.id, annotation: result.parsed, rawOutput: result.rawContent, usage: result.usage, error: null });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${cases.length} ${sample.id}\n`);
    } catch (error) {
      annotations.push({ caseId: sample.id, annotation: null, rawOutput: null, usage: null, error: String(error?.message ?? error) });
      process.stdout.write(`${reviewer.id}: ${index + 1}/${cases.length} ${sample.id} ERROR\n`);
    }
    fs.writeFileSync(outputPath, JSON.stringify({
      evaluation: {
        type: 'synthetic emotion annotation pilot', reviewerId: reviewer.id, model: reviewer.model,
        provider: 'DeepSeek', promptSha256: promptHash, casePack: path.basename(CASES_PATH),
        toolAccess: 'none; standalone request, no shared reviewer context',
        runAt: new Date().toISOString(), completedCases: annotations.length,
      },
      annotations,
    }, null, 2) + '\n', 'utf8');
  }
  process.stdout.write(`OUTPUT=${path.relative(ROOT, outputPath)}\n`);
}
