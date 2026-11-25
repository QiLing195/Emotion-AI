#!/usr/bin/env node
/** Build source/experiencer blind-review packets and verify the frozen v0.3 contract. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAffectBridgeShadow } from '../server/services/affectBridgeShadow.ts';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(root, 'artifacts/emotion-learning');
const corpusPath = path.join(artifactRoot, 'dual-loop-causal-review-v0.5/source-attribution-cases-v0.1.json');
const outputDir = path.join(artifactRoot, 'dual-loop-causal-review-v0.5/source-attribution-blind-v0.1');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));

function shuffle(rows, initialSeed) {
  const values = [...rows];
  let seed = initialSeed >>> 0;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

const rubric = {
  instructions: '只依据每条文本标注。subject 是情绪体验者；reportedBy 是文本明确给出的直接表达者/转述来源，两者不可混为一谈。引号内第一人称按被归属的说话者解释；“他说我难过”可能是 user 体验、third_party 转述。没有可靠指代时使用 unknown。不要推断未写出的情绪或原因。evidence 与 causeEvidence 必须是原文连续子串；原因只能填文本明确连接情绪与事件的最小片段。不要查看其他评审者答案或隐藏映射。',
  fields: {
    subject: 'user | third_party | unknown（谁体验情绪）',
    reportedBy: 'user | third_party | unknown（谁直接表达/转述该情绪）',
    emotion: 'sad | joy | anger | fear | love | gratitude | disgust | calm | other | unknown',
    reportKind: 'explicit | quoted | inferred | mixed | unknown',
    emotionEvidence: '逐字连续原文片段；无法定位则空字符串',
    causeEvidence: '明确说明情绪原因的逐字连续原文片段；没有则空数组',
    aggregateSubject: 'user | third_party | multiple | unknown',
    aggregateKind: 'explicit_self_report | quoted_or_third_party | inferred | mixed | unknown',
    rationale: '一句话分别解释体验者与来源，说明无法判断处。',
  },
  requiredJson: '{"samples":[{"sampleId":"A001","reports":[{"subject":"user","reportedBy":"third_party","emotion":"sad","reportKind":"quoted","emotionEvidence":"很难过","causeEvidence":[]}],"aggregateSubject":"user","aggregateKind":"quoted_or_third_party","rationale":"..."}]}',
};

const mapping = [];
fs.mkdirSync(outputDir, { recursive: true });
for (const [reviewer, seed] of [['a', 0xA71D], ['b', 0xB71D]]) {
  const cases = shuffle(corpus.cases, seed).map((item, index) => {
    const sampleId = `${reviewer.toUpperCase()}${String(index + 1).padStart(3, '0')}`;
    const shadow = analyzeAffectBridgeShadow(item.text, analyzeUserEmotionLocally(item.text));
    assert.deepEqual(shadow.reports.map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion })),
      item.expected.reports.map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion })), `${item.id}: per-report contract`);
    assert.equal(shadow.subject, item.expected.aggregateSubject, `${item.id}: aggregate subject`);
    assert.equal(shadow.affectReportKind, item.expected.aggregateKind, `${item.id}: aggregate kind`);
    for (const report of shadow.reports) {
      for (const span of [...report.evidence, ...report.causeEvidence]) {
        assert.ok(item.text.includes(span), `${item.id}: evidence must be literal and contiguous`);
      }
    }
    mapping.push({ reviewer, sampleId, sourceCase: item.id, expected: item.expected, observed: {
      reports: shadow.reports.map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion })),
      aggregateSubject: shadow.subject,
      aggregateKind: shadow.affectReportKind,
    } });
    return { sampleId, text: item.text };
  });
  fs.writeFileSync(path.join(outputDir, `reviewer-${reviewer}.json`), `${JSON.stringify({
    reviewer,
    instructions: rubric.instructions,
    rubric: rubric.fields,
    requiredJson: rubric.requiredJson,
    cases,
  }, null, 2)}\n`, 'utf8');
}
fs.writeFileSync(path.join(outputDir, 'answer-key.json'), `${JSON.stringify({
  sourceSet: corpus.schemaVersion,
  note: 'Expected labels are hand-authored by the implementation team; diagnostic comparison, not an independent gold standard.',
  mapping,
}, null, 2)}\n`, 'utf8');
process.stdout.write(`source-attribution packet built and contract checked: ${corpus.cases.length} cases x 2 reviewers\n`);
