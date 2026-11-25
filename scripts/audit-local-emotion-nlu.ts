#!/usr/bin/env node
/** Offline-only audit for the deterministic emotion fallback. No server or API calls. */
import { readFileSync } from 'node:fs';
import { analyzeAffectBridgeShadow } from '../server/services/affectBridgeShadow.js';
import { analyzeUserEmotionLocally } from '../server/services/emotionAnalyzer.js';

type Check = { id: string; rule: string; ok: boolean };
type LocalAnalysis = ReturnType<typeof analyzeUserEmotionLocally>;
const checks: Check[] = [];
const add = (id: string, rule: string, ok: boolean) => checks.push({ id, rule, ok });
const normalize = (value: unknown) => JSON.stringify(value);

const scenarios = JSON.parse(readFileSync('test_data/emotion_scenarios.json', 'utf8')) as Array<{
  id: string;
  turns: string[];
  expect: Record<string, unknown>;
}>;
const scenarioCheckStart = checks.length;
for (const scenario of scenarios) {
  const analysis = analyzeUserEmotionLocally(scenario.turns[0] ?? '');
  const expected = scenario.expect;
  if (typeof expected.directed_at_ai === 'boolean') {
    add(scenario.id, 'directed_at_ai', analysis.directedAtAI === expected.directed_at_ai);
  }
  if (expected.emotion_not_love || expected.no_love_attribution) {
    add(scenario.id, 'not_love', analysis.expressedEmotion !== 'love');
  }
  if (expected.emotion_negative) {
    add(scenario.id, 'negative_emotion', ['anger', 'sad', 'fear', 'disgust'].includes(analysis.expressedEmotion));
  }
  if (typeof expected.uncertainty_gte === 'number') {
    add(scenario.id, 'uncertainty_floor', (analysis.uncertainty ?? 0) >= expected.uncertainty_gte);
  }
}
const scenarioCheckCount = checks.length - scenarioCheckStart;

const heldoutPath = 'artifacts/emotion-learning/dual-loop-causal-review-v0.5/source-attribution-heldout-v0.1.json';
const heldout = JSON.parse(readFileSync(heldoutPath, 'utf8')) as {
  cases: Array<{
    id: string;
    text: string;
    expected: {
      reports: Array<{ subject: string; reportedBy: string; emotion: string }>;
      aggregateSubject: string;
      aggregateKind: string;
    };
  }>;
};
let heldoutUserEmotionCases = 0;
let heldoutUserEmotionMatches = 0;
for (const item of heldout.cases) {
  const analysis = analyzeUserEmotionLocally(item.text);
  const shadow = analyzeAffectBridgeShadow(item.text, analysis);
  const observed = {
    reports: shadow.reports
      .map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion }))
      .sort((a, b) => normalize(a).localeCompare(normalize(b))),
    aggregateSubject: shadow.subject,
    aggregateKind: shadow.affectReportKind,
  };
  const expected = {
    reports: item.expected.reports
      .map(({ subject, reportedBy, emotion }) => ({ subject, reportedBy, emotion }))
      .sort((a, b) => normalize(a).localeCompare(normalize(b))),
    aggregateSubject: item.expected.aggregateSubject,
    aggregateKind: item.expected.aggregateKind,
  };
  add(item.id, 'affect_bridge_target_match', normalize(observed) === normalize(expected));

  const userEmotions = item.expected.reports.filter(report => report.subject === 'user').map(report => report.emotion);
  if (userEmotions.length > 0) {
    heldoutUserEmotionCases += 1;
    const match = userEmotions.includes(analysis.expressedEmotion);
    if (match) heldoutUserEmotionMatches += 1;
    add(item.id, 'local_user_emotion_match', match);
  }
}

const adversarial = [
  {
    id: 'quoted-fear-then-user-sadness',
    text: '朋友说：“我很焦虑。”之后，我因为面试结果很难过。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'sad' && (a.uncertainty ?? 1) < 0.6,
  },
  {
    id: 'third-party-fear-then-user-sadness',
    text: '她因为结果很焦虑，我很难过。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'sad',
  },
  {
    id: 'negated-user-sadness',
    text: '我不难过。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'neutral',
  },
  {
    id: 'quoted-sadness-not-directed',
    text: '他说：“我很难过。”',
    ok: (a: LocalAnalysis) => !a.directedAtAI && (a.uncertainty ?? 0) >= 0.6,
  },
  {
    id: 'mixed-user-affect-uncertain',
    text: '我拿到 offer 了，但又有点担心做不好。',
    ok: (a: LocalAnalysis) => (a.uncertainty ?? 0) >= 0.4,
  },
  {
    id: 'sarcastic-complaint-negative',
    text: '你可真会挑时候说这话。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'anger' && a.directedAtAI,
  },
  {
    id: 'double-negation-not-hate',
    text: '我不讨厌你。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'love' && (a.uncertainty ?? 0) > 0,
  },
  {
    id: 'strong-affect-clears-high-gate',
    text: '我真的撑不住了，快崩溃了。',
    ok: (a: LocalAnalysis) => a.expressedEmotion === 'sad' && a.intensity >= 0.7,
  },
];
for (const item of adversarial) add(item.id, 'adversarial_local_rule', item.ok(analyzeUserEmotionLocally(item.text)));

const failed = checks.filter(check => !check.ok);
console.log(JSON.stringify({
  mode: 'offline_no_api',
  scenarioConstraints: {
    passed: checks.slice(0, scenarioCheckCount).filter(check => check.ok).length,
    total: scenarioCheckCount,
  },
  heldout: {
    targetMatches: checks.filter(check => check.rule === 'affect_bridge_target_match' && check.ok).length,
    cases: heldout.cases.length,
    userEmotionMatches: heldoutUserEmotionMatches,
    userEmotionCases: heldoutUserEmotionCases,
  },
  adversarial: { passed: adversarial.length - failed.filter(check => check.rule === 'adversarial_local_rule').length, total: adversarial.length },
  failedChecks: failed.map(({ id, rule }) => ({ id, rule })),
  caveat: 'Heldout labels are hand-authored targets, not an independent human gold standard.',
}));
if (failed.length > 0) process.exitCode = 1;
