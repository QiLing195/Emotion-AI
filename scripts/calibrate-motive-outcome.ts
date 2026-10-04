// ── v1.53 校准「他接住了她这句话吗」的判据（零 LLM）──
//
// 做法与 v1.35 判官校准同一套：**先冻结人工标注**（`src/lib/__tests__/fixtures/motiveOutcomeLabels.ts`），
// 再看分类器与它的一致率。这里同时回答三个问题：
//   ① 老判据（词面锚点）在**非话题型**上到底有多差（预期：几乎全 missed）
//   ② 新判据（分类型）与人工标注的一致率
//   ③ **设计边界有没有被顶破**：把新判据的落地率喂进 `motiveWeight`，
//      会不会让"她自己的"那几类越过 `open_loop`（`他那件还没落定的事永远优先`）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/calibrate-motive-outcome.ts

import { OUTCOME_CASES, type OutcomeCase } from '../src/lib/__tests__/fixtures/motiveOutcomeLabels';
import {
  classifyMotiveOutcome, classifyOutcomeFor, looksResponsiveToHer, looksDismissive,
  MOTIVE_BASE_SALIENCE, MOTIVE_WEIGHT_MIN, MOTIVE_WEIGHT_MAX, motiveWeight,
  type MotiveLearningState,
} from '../src/lib/motive';
import type { MotiveKind } from '../src/lib/emotionTypes';

process.env.ENABLE_MOTIVE_PER_KIND_OUTCOME = 'true';

const pad = (s: string, n: number) => String(s).padEnd(n, ' ');
const TOPIC_SHAPED = ['open_loop', 'worry', 'memory_echo', 'curiosity'];
const nonTopic = (k: string) => !TOPIC_SHAPED.includes(k);

let oldHit = 0, newHit = 0, nonTopicOldHit = 0, nonTopicNewHit = 0, nonTopicTotal = 0;
const confusionNew: Record<string, number> = {};

console.log('逐条（标签 vs 老判据 vs 新判据）\n');
console.log('  ' + pad('kind', 12) + pad('标签', 9) + pad('老', 9) + pad('新', 9) + '他的话');
console.log('  ' + '-'.repeat(88));
for (const c of OUTCOME_CASES as OutcomeCase[]) {
  const oldV = classifyMotiveOutcome(c.voiced, c.his);
  const newV = classifyOutcomeFor(c.kind as MotiveKind, c.voiced, c.his);
  if (oldV === c.label) oldHit++;
  if (newV === c.label) newHit++;
  if (nonTopic(c.kind)) {
    nonTopicTotal++;
    if (oldV === c.label) nonTopicOldHit++;
    if (newV === c.label) nonTopicNewHit++;
  }
  confusionNew[`${c.label}→${newV}`] = (confusionNew[`${c.label}→${newV}`] ?? 0) + 1;
  const mark = newV === c.label ? '' : '  ⚠️';
  console.log('  ' + pad(c.kind, 12) + pad(c.label, 9) + pad(oldV, 9) + pad(newV, 9)
    + c.his.slice(0, 26) + mark);
}

const n = OUTCOME_CASES.length;
console.log(`\n一致率：老判据 ${(oldHit / n * 100).toFixed(0)}%（${oldHit}/${n}）｜新判据 **${(newHit / n * 100).toFixed(0)}%**（${newHit}/${n}）`);
console.log(`   只看**非话题型**（${nonTopicTotal} 条）：老 ${(nonTopicOldHit / nonTopicTotal * 100).toFixed(0)}% → 新 **${(nonTopicNewHit / nonTopicTotal * 100).toFixed(0)}%**`);
console.log(`   新判据混淆：${Object.entries(confusionNew).map(([k, v]) => `${k}×${v}`).join(' ')}`);

// ── 逐类落地率（用标注集当样本）+ 设计边界检查 ──
const KINDS: MotiveKind[] = ['open_loop', 'worry', 'memory_echo', 'curiosity', 'wish', 'stance', 'state'];
console.log('\n逐类落地率（标注集当样本）与权重：\n');
console.log('  ' + pad('kind', 12) + pad('样本', 7) + pad('老落地率', 11) + pad('新落地率', 11) + pad('新权重', 10) + '类型先验');
console.log('  ' + '-'.repeat(72));
const rates: Record<string, { old: number; neu: number }> = {};
for (const k of KINDS) {
  const rows = OUTCOME_CASES.filter(c => c.kind === k);
  if (!rows.length) continue;
  const oldL = rows.filter(c => classifyMotiveOutcome(c.voiced, c.his) === 'landed').length / rows.length;
  const newL = rows.filter(c => classifyOutcomeFor(k, c.voiced, c.his) === 'landed').length / rows.length;
  rates[k] = { old: oldL, neu: newL };
  const clampW = (r: number) => Math.min(MOTIVE_WEIGHT_MAX, Math.max(MOTIVE_WEIGHT_MIN, MOTIVE_WEIGHT_MIN + r));
  console.log('  ' + pad(k, 12) + pad(String(rows.length), 7) + pad((oldL * 100).toFixed(0) + '%', 11)
    + pad((newL * 100).toFixed(0) + '%', 11) + pad(clampW(newL).toFixed(2), 10) + (MOTIVE_BASE_SALIENCE[k] ?? '-'));
}

const clampW = (r: number) => Math.min(MOTIVE_WEIGHT_MAX, Math.max(MOTIVE_WEIGHT_MIN, MOTIVE_WEIGHT_MIN + r));
console.log('\n设计边界（**他那件还没落定的事永远优先**）：把新落地率喂进权重后，各类型的有效先验：\n');
const eff: Array<[string, number]> = [];
for (const k of KINDS) {
  if (!rates[k]) continue;
  const w = clampW(rates[k].neu);
  const prior = k === 'state' ? 0.72 : (MOTIVE_BASE_SALIENCE[k] ?? 0.4);
  eff.push([k, prior * w]);
}
eff.sort((a, b) => b[1] - a[1]);
const openLoopEff = eff.find(([k]) => k === 'open_loop')![1];
for (const [k, v] of eff) {
  const over = v > openLoopEff && k !== 'open_loop';
  console.log(`   ${pad(k, 12)} 有效先验 ${v.toFixed(2)}${over ? '   ⚠️ **超过了 open_loop**' : ''}`);
}
const broken = eff.filter(([k, v]) => k !== 'open_loop' && v > openLoopEff).map(([k]) => k);
console.log(`\n   ⇒ ${broken.length === 0 ? '**边界成立**（没有哪一类越过 `open_loop`）' : `**边界被顶破**：${broken.join(' / ')}`}`);

// ── 反事实：真实账本用新判据重算会变成什么 ──
console.log('\n反事实（拿**真实账本的 voiced 数**，只把 landed 换成新判据的落地率）：\n');
const real = { open_loop: { v: 17, l: 4 }, worry: { v: 6, l: 0 }, wish: { v: 29, l: 0 }, stance: { v: 3, l: 0 }, curiosity: { v: 10, l: 0 } };
const fake: MotiveLearningState = { version: 1, updatedAt: Date.now(), stats: {} } as MotiveLearningState;
for (const [k, r] of Object.entries(real)) {
  const newRate = rates[k]?.neu ?? 0;
  fake.stats![k as MotiveKind] = { voiced: r.v + 3, landed: Math.round(newRate * (r.v + 3)) };
}
console.log('  ' + pad('kind', 12) + pad('老权重', 9) + pad('新权重', 9) + '（用标注集的落地率外推）');
for (const k of Object.keys(real)) {
  const wOld = motiveWeight({ stats: Object.fromEntries(Object.entries(real).map(([kk, vv]) => [kk, { voiced: vv.v, landed: vv.l }])) } as unknown as MotiveLearningState, k as MotiveKind);
  console.log('  ' + pad(k, 12) + pad(wOld.toFixed(2), 9) + pad(motiveWeight(fake, k as MotiveKind).toFixed(2), 9));
}
console.log('\n（⚠️ 外推只说明方向：新判据让"她自己的"那几类**不再恒为 0**，且仍然低于 open_loop。）');
