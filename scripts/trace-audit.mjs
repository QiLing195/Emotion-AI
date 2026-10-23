#!/usr/bin/env node
/**
 * v2.21：turn trace 审计脚本（读 memories/turn_trace.jsonl）
 *
 * 只看结构，不打印任何正文；默认读 MEMORIES_DIR/turn_trace.jsonl。
 *
 * 用法：
 *   node scripts/trace-audit.mjs [--file=path] [--rounds] [--json]
 *   --rounds  逐轮表格（round/strategy/plan/duration/guard/budget/agent/reply 字数）
 *   --json    输出聚合 JSON（便于脚本消费）
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name) => args.includes(`--${name}`);
const file = opt('file') || path.join(process.env.MEMORIES_DIR || 'memories', 'turn_trace.jsonl');
const wantJson = flag('json');
const wantRounds = flag('rounds');

if (!fs.existsSync(file)) {
  console.error(`trace 文件不存在: ${file}`);
  process.exit(2);
}

const rows = fs.readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter(Boolean);

if (rows.length === 0) {
  console.error(`trace 文件为空: ${file}`);
  process.exit(2);
}

const count = (map, key) => { if (key == null || key === '') key = '(none)'; map[key] = (map[key] ?? 0) + 1; };
const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const avg = (arr) => (arr.length ? Math.round((sum(arr) / arr.length) * 10) / 10 : 0);

const strategies = {};
const decisions = {};
const durations = {};
const rejectedReasons = {};
const acceptedTypes = {};
const tools = {};
const guardChanges = {};
const budgetCalls = [];
const budgetElapsed = [];
const budgetTimeouts = [];
const replyChars = [];
const replyQ = [];
const promptChars = [];
let expired = 0;
let withTools = 0;
let withPlan = 0;
let withEvidence = 0;

for (const r of rows) {
  count(strategies, r.strategy);
  count(decisions, r.plan?.decision);
  count(durations, r.plan?.duration);
  if (r.plan?.decision) withPlan++;
  if (r.plan?.evidence) withEvidence++;
  for (const t of r.intrinsic?.accepted ?? []) count(acceptedTypes, t);
  for (const reason of r.intrinsic?.rejected ?? []) count(rejectedReasons, reason);
  for (const c of r.enforcement?.changes ?? []) {
    const key = String(c).split(':')[0];
    count(guardChanges, key);
  }
  if (r.agent?.usedTools) withTools++;
  for (const t of r.agent?.tools ?? []) count(tools, t);
  if (r.budget) {
    budgetCalls.push(Number(r.budget.calls ?? 0));
    budgetElapsed.push(Number(r.budget.elapsedMs ?? 0));
    budgetTimeouts.push(Number(r.budget.timeouts ?? 0));
    if (r.budget.expired) expired++;
  }
  replyChars.push(Number(r.reply?.chars ?? 0));
  replyQ.push(Number(r.reply?.questionMarks ?? 0));
  promptChars.push(Number(r.prompt?.chars ?? 0));
}

const summary = {
  file,
  turns: rows.length,
  firstTs: rows[0].ts ?? null,
  lastTs: rows[rows.length - 1].ts ?? null,
  strategies,
  plan: {
    withPlan,
    decisions,
    durations,
    withEvidence,
  },
  intrinsic: { acceptedTypes, rejectedReasons },
  enforcement: guardChanges,
  agent: { turnsWithTools: withTools, tools },
  budget: {
    callsAvg: avg(budgetCalls),
    callsMax: budgetCalls.length ? Math.max(...budgetCalls) : 0,
    elapsedAvgMs: avg(budgetElapsed),
    elapsedMaxMs: budgetElapsed.length ? Math.max(...budgetElapsed) : 0,
    timeoutsTotal: sum(budgetTimeouts),
    expiredTurns: expired,
  },
  reply: {
    charsAvg: avg(replyChars),
    charsMax: replyChars.length ? Math.max(...replyChars) : 0,
    questionMarksAvg: avg(replyQ),
  },
  promptCharsAvg: avg(promptChars),
};

if (wantJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`# turn trace 审计 — ${rows.length} 轮`);
  console.log(`文件: ${file}`);
  console.log(`时间: ${summary.firstTs} → ${summary.lastTs}`);
  console.log('');
  console.log('## 策略 / 表达计划');
  console.log('  strategy: ' + (JSON.stringify(strategies) || '{}'));
  console.log(`  plan: ${withPlan}/${rows.length} 轮有计划；decision=${JSON.stringify(decisions)} duration=${JSON.stringify(durations)}`);
  console.log(`  evidence 非空: ${withEvidence}/${rows.length}`);
  console.log('');
  console.log('## 内在候选 / 运行时强制');
  console.log('  accepted: ' + (JSON.stringify(acceptedTypes) || '{}'));
  console.log('  rejected: ' + (JSON.stringify(rejectedReasons) || '{}'));
  console.log('  guard changes: ' + (JSON.stringify(guardChanges) || '{}'));
  console.log('');
  console.log('## 工具 / 预算 / 回复');
  console.log(`  使用工具的轮数: ${withTools}；工具: ${JSON.stringify(tools) || '{}'}`);
  console.log(`  budget: callsAvg=${summary.budget.callsAvg} callsMax=${summary.budget.callsMax} elapsedAvgMs=${summary.budget.elapsedAvgMs} elapsedMaxMs=${summary.budget.elapsedMaxMs} timeoutsTotal=${summary.budget.timeoutsTotal} expiredTurns=${summary.budget.expiredTurns}`);
  console.log(`  prompt chars avg=${summary.promptCharsAvg}`);
  console.log(`  reply chars avg=${summary.reply.charsAvg} max=${summary.reply.charsMax} questionsAvg=${summary.reply.questionMarksAvg}`);
}

if (wantRounds) {
  console.log('');
  console.log('## 逐轮');
  console.log('| round | strategy | plan | duration | guard | budget(ms/calls/timeouts) | tools | replyChars |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const guard = (r.enforcement?.changes ?? []).join(',') || '-';
    const b = r.budget ? `${r.budget.elapsedMs}/${r.budget.calls}/${r.budget.timeouts}` : '-';
    const ts = (r.agent?.tools ?? []).join(',') || '-';
    console.log(`| ${r.round ?? '-'} | ${r.strategy ?? '-'} | ${r.plan?.decision ?? '-'} | ${r.plan?.duration ?? '-'} | ${guard} | ${b} | ${ts} | ${r.reply?.chars ?? '-'} |`);
  }
}
