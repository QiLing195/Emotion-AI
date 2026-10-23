#!/usr/bin/env node
/**
 * v2.14：unified expression 开/关两臂对比（读两份 emotion_scenario_results.json）
 *
 * 用法：node scripts/compare-scenario-arms.mjs <on.json> <off.json>
 * 输出 Markdown 表（stdout），不写文件。
 *
 * 说明：这是**描述性**对比（单次采样、模型非确定），不做显著性检验。
 */
import fs from 'node:fs';

const [onPath, offPath] = process.argv.slice(2);
if (!onPath || !offPath) {
  console.error('usage: node scripts/compare-scenario-arms.mjs <on.json> <off.json>');
  process.exit(1);
}
const on = JSON.parse(fs.readFileSync(onPath, 'utf8'));
const off = JSON.parse(fs.readFileSync(offPath, 'utf8'));

const SELF = /(我(也|这两天|最近|今天|现在|心里|有点|觉得)|我有点|我这儿|我这边|本子上|笔搁|不想动|划掉|写了两句|^闷|闷[，。,.]|说不上来|有点沉)/g;
const DURATION = /这两天|最近几天|这些天|一直很|一直都在|这段时间/g;
const AI_WORDS = ['AI', '人工智能', '模型', '程序', '不是真人', '虚拟'];

function count(re, text) { return (String(text).match(re) || []).length; }

function summarize(run) {
  const results = run.results ?? [];
  const turns = results.flatMap(r => r.turns ?? []);
  const replies = turns.map(t => String(t.reply ?? ''));
  const failedFlags = results.filter(r => !r.green).flatMap(r => Object.entries(r.flags ?? {}).filter(([, v]) => !v).map(([k]) => `${r.id}:${k}`));
  const ms = turns.map(t => Number(t.ms ?? 0)).filter(n => n > 0);
  return {
    scenarios: results.length,
    green: results.filter(r => r.green).length,
    turns: turns.length,
    failedFlags,
    selfDisclosure: replies.reduce((n, r) => n + count(SELF, r), 0),
    durationWords: replies.reduce((n, r) => n + count(DURATION, r), 0),
    questionMarks: replies.reduce((n, r) => n + count(/[？?]/g, r), 0),
    avgChars: Math.round(replies.reduce((n, r) => n + r.length, 0) / Math.max(1, replies.length)),
    avgMs: Math.round(ms.reduce((n, v) => n + v, 0) / Math.max(1, ms.length)),
    aiMentioned: replies.filter(r => AI_WORDS.some(w => r.includes(w))).length,
    planTurns: turns.filter(t => t.expressionPlan != null).length,
  };
}

const a = summarize(on);
const b = summarize(off);
const rows = [
  ['场景通过', `${a.green}/${a.scenarios}`, `${b.green}/${b.scenarios}`],
  ['失败 flag', a.failedFlags.join(', ') || '—', b.failedFlags.join(', ') || '—'],
  ['轮数', a.turns, b.turns],
  ['平均字数', a.avgChars, b.avgChars],
  ['平均耗时 ms', a.avgMs, b.avgMs],
  ['自我披露命中（总）', a.selfDisclosure, b.selfDisclosure],
  ['“这两天/一直”出现（总）', a.durationWords, b.durationWords],
  ['问号总数', a.questionMarks, b.questionMarks],
  ['提到 AI 的次数', a.aiMentioned, b.aiMentioned],
  ['带 ExpressionPlan 的轮数', a.planTurns, b.planTurns],
];
console.log('| 指标 | ON（unified+enforcement） | OFF |');
console.log('|---|---|---|');
for (const [k, x, y] of rows) console.log(`| ${k} | ${x} | ${y} |`);
console.log('');
console.log(`> 数据：ON=${onPath} / OFF=${offPath}；单次采样，仅供描述。`);
