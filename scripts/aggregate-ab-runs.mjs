#!/usr/bin/env node
/**
 * v2.15：汇总 N 次 A/B 结果（artifacts/v2.14/ab/{on,off}-*.json）
 * 输出 Markdown 到 stdout；不做显著性检验（描述性）。
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'artifacts/v2.14/ab';
const files = fs.readdirSync(dir).filter(f => /^(on|off)-\d+\.json$/.test(f));
const SELF = /(我(也|这两天|最近|今天|现在|心里|有点|觉得)|我有点|我这儿|我这边|本子上|笔搁|不想动|划掉|写了两句|^闷|闷[，。,.]|说不上来|有点沉)/g;
const DURATION = /这两天|最近几天|这些天|一直很|一直都在|这段时间/g;

function summarize(file) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const results = data.results ?? [];
  const turns = results.flatMap(r => r.turns ?? []);
  const replies = turns.map(t => String(t.reply ?? ''));
  const ms = turns.map(t => Number(t.ms ?? 0)).filter(n => n > 0);
  return {
    file,
    scenarios: results.length,
    green: results.filter(r => r.green).length,
    failed: results.filter(r => !r.green).flatMap(r => Object.entries(r.flags ?? {}).filter(([, v]) => !v).map(([k]) => `${r.id}:${k}`)),
    self: replies.reduce((n, r) => n + (r.match(SELF) || []).length, 0),
    duration: replies.reduce((n, r) => n + (r.match(DURATION) || []).length, 0),
    questions: replies.reduce((n, r) => n + (r.match(/[？?]/g) || []).length, 0),
    chars: Math.round(replies.reduce((n, r) => n + r.length, 0) / Math.max(1, replies.length)),
    ms: Math.round(ms.reduce((n, v) => n + v, 0) / Math.max(1, ms.length)),
    planTurns: turns.filter(t => t.expressionPlan != null).length,
    // 每个场景在本次是否通过（用于跨 run 一致性）
    perScenario: Object.fromEntries(results.map(r => [r.id, Boolean(r.green)])),
  };
}

const runs = files.map(summarize).sort((a, b) => a.file.localeCompare(b.file));
const arms = { on: runs.filter(r => r.file.startsWith('on-')), off: runs.filter(r => r.file.startsWith('off-')) };

const stats = (list) => {
  const nums = (key) => list.map(r => r[key]);
  const mean = (a) => Math.round((a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)) * 10) / 10;
  const range = (a) => `${Math.min(...a)}–${Math.max(...a)}`;
  return {
    pass: list.map(r => `${r.green}/${r.scenarios}`).join(' / '),
    self: `${mean(nums('self'))}（${range(nums('self'))}）`,
    duration: `${mean(nums('duration'))}（${range(nums('duration'))}）`,
    questions: `${mean(nums('questions'))}（${range(nums('questions'))}）`,
    chars: `${mean(nums('chars'))}（${range(nums('chars'))}）`,
    ms: `${mean(nums('ms'))}（${range(nums('ms'))}）`,
    plan: list.map(r => r.planTurns).join(' / '),
    failed: list.flatMap(r => r.failed).join(', ') || '—',
  };
};
const A = stats(arms.on);
const B = stats(arms.off);
console.log(`# unified expression A/B（每臂 ${arms.on.length} 次，每次全新 memories 快照）`);
console.log('');
console.log('| 指标（均值 / 范围） | ON（计划器+强制） | OFF（旧路径） |');
console.log('|---|---|---|');
console.log(`| 场景通过（每次） | ${A.pass} | ${B.pass} |`);
console.log(`| 失败 flag | ${A.failed} | ${B.failed} |`);
console.log(`| 自我披露命中（总） | ${A.self} | ${B.self} |`);
console.log(`| “这两天/一直”出现 | ${A.duration} | ${B.duration} |`);
console.log(`| 问号总数 | ${A.questions} | ${B.questions} |`);
console.log(`| 平均字数 | ${A.chars} | ${B.chars} |`);
console.log(`| 平均耗时 ms | ${A.ms} | ${B.ms} |`);
console.log(`| 带 plan 轮数（每次） | ${A.plan} | ${B.plan} |`);
console.log('');

// 跨 run 一致性
const ids = Object.keys(arms.on[0]?.perScenario ?? {});
console.log('## 场景级跨 run 一致性');
console.log('');
console.log('| 场景 | ON 通过次数 | OFF 通过次数 |');
console.log('|---|---|---|');
for (const id of ids) {
  const onN = arms.on.filter(r => r.perScenario[id]).length;
  const offN = arms.off.filter(r => r.perScenario[id]).length;
  const mark = (n) => (n === arms.on.length ? '✅' : n === 0 ? '❌' : `⚠️ ${n}/${arms.on.length}`);
  console.log(`| ${id} | ${mark(onN)} | ${mark(offN)} |`);
}
