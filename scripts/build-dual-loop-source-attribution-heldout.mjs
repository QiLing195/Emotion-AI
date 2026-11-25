#!/usr/bin/env node
/** Freeze a new held-out source/experiencer set; report system output without changing the labels. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAffectBridgeShadow } from '../server/services/affectBridgeShadow.ts';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5');
const corpusPath = path.resolve(process.env.SOURCE_ATTRIBUTION_CORPUS_PATH
  || path.join(artifactDir, 'source-attribution-heldout-v0.1.json'));
const outputDir = path.resolve(process.env.SOURCE_ATTRIBUTION_REVIEW_DIR
  || path.join(artifactDir, 'source-attribution-heldout-blind-v0.1'));
if (!corpusPath.startsWith(artifactDir + path.sep) || !outputDir.startsWith(artifactDir + path.sep)) {
  throw new Error('heldout paths must remain under dual-loop-causal-review-v0.5 artifacts');
}
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const rubric = {
  instructions: '只依据文本独立标注。subject 是情绪体验者；reportedBy 是文本明确给出的直接表达者/转述来源，二者不可混为一谈。引号内第一人称按已明确归属的说话者解释；若归属线索在引语之后，结合整个文本判断，但不能仅凭引号猜测。她/他表示非当前用户，但具体身份可能未知。没有可靠指代时使用 unknown。不要推断未写出的情绪或原因。emotionEvidence 与 causeEvidence 必须是原文连续子串；原因只填文本明确连接情绪与事件的最小片段。不要访问代码、答案映射或其他评审者答案。',
  fields: {
    subject: 'user | third_party | unknown（情绪体验者）',
    reportedBy: 'user | third_party | unknown（直接表达/转述来源）',
    emotion: 'sad | joy | anger | fear | love | gratitude | disgust | calm | other | unknown',
    reportKind: 'explicit | quoted | inferred | mixed | unknown',
    emotionEvidence: '原文连续子串；无法定位则空字符串',
    causeEvidence: '明确原因的原文连续子串；没有则空数组',
    aggregateSubject: 'user | third_party | multiple | unknown',
    aggregateKind: 'explicit_self_report | quoted_or_third_party | inferred | mixed | unknown',
    rationale: '一句话分别解释 subject 与 reportedBy，指出不确定性。',
  },
  requiredJson: '{"samples":[{"sampleId":"A001","reports":[{"subject":"user","reportedBy":"third_party","emotion":"sad","reportKind":"quoted","emotionEvidence":"很难过","causeEvidence":[]}],"aggregateSubject":"user","aggregateKind":"quoted_or_third_party","rationale":"..."}]}',
};
function shuffle(rows, seed) {
  const result = [...rows];
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
fs.mkdirSync(outputDir, { recursive: true });
const mapping = [];
const systemCases = [];
for (const [reviewer, seed] of [['a', 0xC71D], ['b', 0xD71D]]) {
  const cases = shuffle(corpus.cases, seed).map((item, i) => {
    const sampleId = `${reviewer.toUpperCase()}${String(i + 1).padStart(3, '0')}`;
    const shadow = analyzeAffectBridgeShadow(item.text, analyzeUserEmotionLocally(item.text));
    const observed = {
      reports: shadow.reports.map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion })),
      aggregateSubject: shadow.subject,
      aggregateKind: shadow.affectReportKind,
    };
    const expectedRuntime = {
      reports: item.expected.reports.map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      aggregateSubject: item.expected.aggregateSubject,
      aggregateKind: item.expected.aggregateKind,
    };
    observed.reports.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    if (reviewer === 'a') systemCases.push({ id: item.id, expected: item.expected, observed, contractMatch:
      JSON.stringify(observed) === JSON.stringify(expectedRuntime) });
    mapping.push({ reviewer, sampleId, sourceCase: item.id, expected: item.expected, observed });
    return { sampleId, text: item.text };
  });
  fs.writeFileSync(path.join(outputDir, `reviewer-${reviewer}.json`), `${JSON.stringify({
    reviewer, instructions: rubric.instructions, rubric: rubric.fields, requiredJson: rubric.requiredJson, cases,
  }, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(path.join(outputDir, 'answer-key.json'), `${JSON.stringify({
  sourceSet: corpus.schemaVersion,
  note: 'Frozen hand-authored held-out target; not an independent human gold standard.',
  mapping,
}, null, 2)}\n`, 'utf8');
const report = {
  sourceSet: corpus.schemaVersion,
  cases: systemCases.length,
  contractMatches: systemCases.filter(row => row.contractMatch).length,
  mismatches: systemCases.filter(row => !row.contractMatch),
};
fs.writeFileSync(path.join(outputDir, 'system-heldout-check.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ cases: report.cases, contractMatches: report.contractMatches, mismatches: report.mismatches.map(row => row.id) })}\n`);
