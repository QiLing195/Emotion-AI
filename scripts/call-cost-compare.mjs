#!/usr/bin/env node
/**
 * v2.02：按需调用的成本证据（专家第 4 条）。
 *
 * 同一批消息分别在两个实例上跑：
 *   A = 当前配置（ENABLE_AGENT_TOOLS=true，允许工具循环）
 *   B = 工具关（ENABLE_AGENT_TOOLS=false，纯生成）
 * 记录：端到端耗时、回复字数、该轮工具调用次数（从服务端日志 [AgentTool] 增量数）
 *
 * 用法：node scripts/call-cost-compare.mjs <A_url> <A_log> <B_url> <B_log>
 */
import fs from 'node:fs';

const [aUrl, aLog, bUrl, bLog] = process.argv.slice(2);
if (!aUrl || !aLog || !bUrl || !bLog) {
  console.error('usage: node scripts/call-cost-compare.mjs <A_url> <A_log> <B_url> <B_log>');
  process.exit(1);
}
const messages = [
  '今天下午开了个会，挺累的',
  '嗯，我在。',
  '你知道我现在在干嘛吗？',
  '帮我看看 docs 里有什么文件',
  '陪我聊会儿天吧',
];

function countToolLines(logPath) {
  try { return fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.includes('[AgentTool]')).length; }
  catch { return 0; }
}

async function arm(name, base, logPath) {
  const before = countToolLines(logPath);
  const rows = [];
  for (const m of messages) {
    const t0 = Date.now();
    let reply = '', timings = null, ok = false;
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: m, userId: `cost-${name}`, recentMessages: [] }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = await res.json();
      reply = String(j.response ?? j.error ?? '');
      timings = j.timings ?? null;
      ok = res.ok;
    } catch (e) { reply = 'ERROR ' + (e?.message || e); }
    rows.push({ message: m, ms: Date.now() - t0, chars: reply.length, ok, timings });
    console.log(`[${name}] ${Date.now() - t0}ms ${reply.length}字 :: ${m}`);
  }
  const toolCalls = countToolLines(logPath) - before;
  return { name, rows, toolCalls, avgMs: Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length) };
}

const A = await arm('with_tools', aUrl, aLog);
const B = await arm('no_tools', bUrl, bLog);

const lines = [];
lines.push(`# 按需调用成本对比（v2.02，${new Date().toISOString()}）`);
lines.push('');
lines.push('| 消息 | A: 工具开 | B: 工具关 | 差值 |');
lines.push('|---|---|---|---|');
for (let i = 0; i < messages.length; i++) {
  const a = A.rows[i], b = B.rows[i];
  lines.push(`| ${messages[i]} | ${a.ms}ms / ${a.chars}字 | ${b.ms}ms / ${b.chars}字 | ${a.ms - b.ms >= 0 ? '+' : ''}${a.ms - b.ms}ms |`);
}
lines.push('');
lines.push(`- A 平均：**${A.avgMs}ms**，工具调用 ${A.toolCalls} 次；B 平均：**${B.avgMs}ms**，工具调用 ${B.toolCalls} 次`);
lines.push('');
lines.push('## 读法');
lines.push('- 普通闲聊本来不需要工具：若 A 明显慢于 B 而质量没有提升，就说明**不该每轮都开工具循环**；');
lines.push('- 需要查证的消息（"看看 docs" / "我现在在干嘛"）才是工具的价值所在；');
lines.push('- 这只是**延迟与调用次数**，质量差异要配合 `scripts/quality-regression.mjs` 与人工复核看。');
lines.push('');
lines.push('## 限制');
lines.push('- 单机一次采样、顺序执行、无并发；');
lines.push('- A/B 两个实例的 .env 只有 `ENABLE_AGENT_TOOLS` 不同（其余相同），但模型网络波动仍会影响耗时；');
lines.push('- 工具调用次数来自日志 `[AgentTool]` 计数，不区分工具名。');

fs.mkdirSync('artifacts/v2.02', { recursive: true });
fs.writeFileSync('artifacts/v2.02/call-cost-compare.md', lines.join('\n'));
console.log('\nwritten: artifacts/v2.02/call-cost-compare.md');
