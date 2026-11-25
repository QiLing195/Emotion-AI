#!/usr/bin/env node
/** Cross-audit whether a review's numeric scores agree with its written rationale. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_ROOT = path.join(ROOT, 'artifacts/emotion-learning');
const REVIEW_DIR = path.resolve(process.env.DUAL_LOOP_REVIEW_DIR
  || path.join(REVIEW_ROOT, 'dual-loop-causal-review-v0.4'));
if (REVIEW_DIR !== REVIEW_ROOT && !REVIEW_DIR.startsWith(REVIEW_ROOT + path.sep)) {
  throw new Error('dual_loop_review_dir_must_stay_under_emotion_learning_artifacts');
}
const ENV_PATH = path.join(ROOT, '.env');
const REVIEWERS = [
  { id: 'a', model: 'deepseek-flash', audits: 'b' },
  { id: 'b', model: 'deepseek-v4-pro', audits: 'a' },
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
  try { return JSON.parse(raw); } catch { /* extract the outer object */ }
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('auditor_returned_invalid_json');
}

const key = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, 'answer-key.json'), 'utf8'));
const canonical = new Map();
for (const row of key.mapping) {
  const item = canonical.get(row.sourceScenario) ?? {};
  item[row.reviewer] = row;
  canonical.set(row.sourceScenario, item);
}
const sourceRows = new Map();
for (const reviewer of REVIEWERS) {
  const packet = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, `reviewer-${reviewer.audits}.json`), 'utf8'));
  const scored = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, `reviewer-${reviewer.audits}-scored.json`), 'utf8'));
  const scores = new Map(scored.results.map(item => [item.sampleId, item]));
  for (const [scenario, reviewers] of canonical) {
    const mapping = reviewers[reviewer.audits];
    if (!mapping) throw new Error(`missing_mapping_${scenario}_${reviewer.audits}`);
    const sample = packet.cases.find(item => item.sampleId === mapping.sampleId);
    const review = scores.get(mapping.sampleId);
    if (!sample || !review) throw new Error(`missing_sample_or_score_${scenario}_${reviewer.audits}`);
    sourceRows.set(`${reviewer.id}:${scenario}`, { sampleId: mapping.sampleId, sample, review });
  }
}

const apiKey = readEnvValue('DEEPSEEK_API_KEY');
if (!apiKey || apiKey === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY_unavailable');
const dimensions = ['source_attribution', 'evidence_fit', 'correction', 'causal_isolation'];
for (const auditor of REVIEWERS) {
  const work = [...canonical.keys()].map(scenario => {
    const row = sourceRows.get(`${auditor.id}:${scenario}`);
    return {
      sampleId: row.sampleId,
      case: row.sample,
      review: { scores: row.review.scores, evidenceNote: row.review.evidenceNote },
    };
  });
  const auditPacket = {
    instructions: '你是评分一致性审计员。逐条比较三者：案例中可见的系统输出、被审评者的数值分数、被审评者的文字说明。只报告明确矛盾：① evidence_fit=2 但说明承认系统判断/因果连接错误或过度推断；② evidence_fit=0 但说明说证据完全支持；③ source_attribution=2 但说明承认主体来源混淆；④ source_attribution=0 但说明说来源清楚；⑤ 任意维度说明对系统输出的描述与输出本身直接相反。分数 1 与“部分、不完整、有些过度”等相容；分数 0 配“错误/无依据”说明是相容，不是矛盾；null 维度不审计。不要把“发现缺陷”本身误判为矛盾。每个 finding 的 why 必须明确说明哪一段评语与哪个分数/输出互相冲突。只返回 JSON：{"samples":[{"sampleId":"R001","assessment":"consistent|contradiction|unclear","findings":[{"dimension":"evidence_fit","claim":"评语中的原词","why":"具体矛盾"}]}]}。没有明确矛盾则 findings=[]。',
    dimensions,
    cases: work,
  };
  const outputPath = path.join(REVIEW_DIR, `rationale-audit-by-${auditor.id}.json`);
  if (process.argv.includes('--summarize-only')) continue;
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: auditor.model,
      messages: [
        { role: 'system', content: '你是严格、克制的评分一致性审计员。只能依据提供的案例、分数和评语。不得猜测未写出的观点。' },
        { role: 'user', content: JSON.stringify(auditPacket) },
      ],
      temperature: 0,
      max_tokens: 2500,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${auditor.model}_http_${response.status}`);
  const payload = await response.json();
  const rawOutput = payload.choices?.[0]?.message?.content ?? '';
  const parsed = parseJson(rawOutput);
  if (!Array.isArray(parsed.samples) || parsed.samples.length !== work.length) throw new Error('rationale_audit_sample_count_mismatch');
  const expectedIds = new Set(work.map(item => item.sampleId));
  const workById = new Map(work.map(item => [item.sampleId, item]));
  let ignoredNullDimensionFindings = 0;
  let auditorSelfContradictions = 0;
  for (const item of parsed.samples) {
    if (!expectedIds.has(item.sampleId) || !['consistent', 'contradiction', 'unclear'].includes(item.assessment)
      || !Array.isArray(item.findings)) throw new Error(`invalid_rationale_audit_${item.sampleId}`);
    const validFindings = [];
    for (const finding of item.findings) {
      if (!dimensions.includes(finding.dimension) || typeof finding.claim !== 'string' || typeof finding.why !== 'string') {
        throw new Error(`invalid_rationale_finding_${item.sampleId}`);
      }
      const originalScore = workById.get(item.sampleId).review.scores[finding.dimension];
      if (!Number.isInteger(originalScore)) { ignoredNullDimensionFindings += 1; continue; }
      if (/一致|相容|相符|不矛盾/.test(finding.why)) {
        auditorSelfContradictions += 1;
        continue;
      }
      validFindings.push(finding);
    }
    item.findings = validFindings;
    if (item.assessment === 'contradiction' && validFindings.length === 0) item.assessment = 'unclear';
  }
  fs.writeFileSync(outputPath, `${JSON.stringify({
    auditor: { model: auditor.model, auditedReviewer: auditor.audits, usage: payload.usage ?? null },
    results: parsed.samples,
    rawOutput,
    auditQuality: { ignoredNullDimensionFindings, auditorSelfContradictions },
  }, null, 2)}\n`, 'utf8');
  process.stdout.write(`rationale-auditor-${auditor.id}: audited ${parsed.samples.length} reviews\n`);
}

const auditFiles = REVIEWERS.map(reviewer => path.join(REVIEW_DIR, `rationale-audit-by-${reviewer.id}.json`));
if (auditFiles.every(file => fs.existsSync(file))) {
  const output = { generatedAt: new Date().toISOString(), auditors: [], contradictionCount: 0, auditQuality: { ignoredNullDimensionFindings: 0, auditorSelfContradictions: 0 }, flaggedCases: [] };
  for (const reviewer of REVIEWERS) {
    const file = JSON.parse(fs.readFileSync(path.join(REVIEW_DIR, `rationale-audit-by-${reviewer.id}.json`), 'utf8'));
    output.auditors.push(file.auditor);
    for (const key of Object.keys(output.auditQuality)) output.auditQuality[key] += file.auditQuality?.[key] ?? 0;
    for (const result of file.results) {
      if (result.assessment === 'contradiction' || result.findings.length) {
        output.flaggedCases.push({ auditor: reviewer.id, ...result });
      }
    }
  }
  output.contradictionCount = output.flaggedCases.length;
  fs.writeFileSync(path.join(REVIEW_DIR, 'rationale-audit-summary.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`RATIONALE_AUDIT=${path.relative(ROOT, path.join(REVIEW_DIR, 'rationale-audit-summary.json'))}; flagged=${output.contradictionCount}\n`);
}
