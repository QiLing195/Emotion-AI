#!/usr/bin/env node
/** Exercise the real deterministic local emotion analyzer at the dual-loop seam. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoPath = path.join(root, 'artifacts/emotion-learning/dual-loop-emotion-demo-v0.7.html');
const html = fs.readFileSync(demoPath, 'utf8');
const scriptStart = html.indexOf('<script>') + '<script>'.length;
const scriptEnd = html.indexOf('</script>', scriptStart);
const source = html.slice(scriptStart, scriptEnd);
const modelEnd = source.indexOf('\nconst guides=');
if (scriptStart < '<script>'.length || scriptEnd <= scriptStart || modelEnd < 0) throw new Error('dual_loop_model_not_found');
const context = vm.createContext({ structuredClone, Math, Set, Number, String });
vm.runInContext(`${source.slice(0, modelEnd)}\nglobalThis.__model={assessBridge};`, context, { timeout: 1_000 });
const { assessBridge } = context.__model;

const profile = { values: '尊重真实与用户边界；关注已建立关系中的重要事情', concern: '她正在等面试结果', confirmed: true };
const cases = [
  { id: 'incidental-anchor', message: '公司群里发了一条面试结果统计，看到我姐姐查出重病，我很难过。', expectedEmotion: ['sad'], subject: 'user', reportKind: 'explicit_self_report' },
  { id: 'explicit-cause-sad', message: '面试结果还没出来，这让我这周很难过。', expectedEmotion: ['sad'], subject: 'user', reportKind: 'explicit_self_report' },
  { id: 'explicit-cause-joy', message: '面试结果出来了，我拿到 offer 了，这让我真的很开心。', expectedEmotion: ['joy'], subject: 'user', reportKind: 'explicit_self_report' },
  { id: 'quoted-third-party', message: '我朋友说“面试没结果前她很难过”，我不知道怎么安慰她。', expectedEmotion: ['sad'], subject: 'third_party', reportKind: 'quoted_or_third_party' },
  { id: 'multiple-speakers', message: '她说“我最近很焦虑”，我自己倒还好，只是想帮她。', expectedEmotion: ['fear', 'calm'], subject: 'multiple', reportKind: 'mixed' },
  { id: 'double-negation-boundary', message: '我不是不难过，只是不想现在谈。', expectedEmotion: ['sad'], subject: 'user', reportKind: 'inferred' },
];

const rows = cases.map(item => {
  const analysis = analyzeUserEmotionLocally(item.message);
  // Subject/report labels come from the fixture annotation here; the local NLU does not emit them.
  const hypothesis = {
    subject: item.subject,
    affectReportKind: item.reportKind,
    emotionHypothesis: analysis.expressedEmotion === 'neutral' ? [] : [analysis.expressedEmotion],
    evidence: analysis.evidence ? [analysis.evidence] : [],
    inferenceUncertainty: (analysis.uncertainty ?? 1) <= 0.3 ? 'low' : (analysis.uncertainty ?? 1) <= 0.6 ? 'moderate' : 'high',
    userCorrection: false,
  };
  const bridge = assessBridge(hypothesis, { message: item.message }, profile);
  const expected = new Set(item.expectedEmotion);
  const actual = new Set(hypothesis.emotionHypothesis);
  const emotionMatch = expected.size === actual.size && [...expected].every(value => actual.has(value));
  return {
    id: item.id,
    message: item.message,
    expectedEmotion: item.expectedEmotion,
    localEmotion: analysis.expressedEmotion,
    emotionMatch,
    localEvidenceIsWholeMessage: analysis.evidence === item.message.slice(0, 80),
    localSchemaFieldsMissing: ['subject', 'affectReportKind', 'concernEvidence', 'engagementBoundary']
      .filter(key => !(key in analysis)),
    bridge: { disposition: bridge.disposition, reason: bridge.reason, anchor: bridge.anchor ?? null, delta: bridge.delta },
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  source: 'analyzeUserEmotionLocally; no LLM/API calls',
  note: 'Bridge inputs use fixture-annotated subject/report type. The real local analyzer supplies only its actual emotion, evidence, and uncertainty fields; missing cause evidence is deliberately not fabricated.',
  metrics: {
    emotionMatches: rows.filter(row => row.emotionMatch).length,
    sampleCount: rows.length,
    localWholeMessageEvidenceCount: rows.filter(row => row.localEvidenceIsWholeMessage).length,
    bridgeCandidates: rows.filter(row => row.bridge.disposition === 'care_response_candidate').length,
  },
  rows,
};
const outDir = path.join(root, 'artifacts/emotion-learning/dual-loop-causal-review-v0.5');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'local-nlu-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report.metrics)}\n`);
