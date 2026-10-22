#!/usr/bin/env node
/**
 * v2.01 单机体验基线（专家第 4/5 条：先测量再优化）。
 *
 * 测量：
 *  - 冷/热启动后的基础读接口延迟（health / her-state / memories / diagnostics）
 *  - 聊天端到端延迟 + 服务端分阶段耗时（需要 DEBUG_TIMINGS=true）
 *  - 每轮聊天造成的记忆写入（episodes 计数变化、RSS 变化）
 *
 * 用法：node scripts/perf-baseline.mjs [baseUrl] [rounds]
 * 输出：artifacts/v2.01/perf-baseline.md
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const ROUNDS = Number(process.argv[3] || 5);

async function timed(fn) {
  const t0 = Date.now();
  try { return { ok: true, ms: Date.now() - t0, value: await fn() }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e?.message || e) }; }
}
const get = (p) => timed(async () => (await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(30_000) })).json());

const endpoints = ['/health', '/api/her-state', '/api/memories?limit=5', '/api/diagnostics', '/api/activity/understanding'];
const reads = [];
for (const p of endpoints) {
  const r = await get(p);
  reads.push({ path: p, ok: r.ok, ms: r.ms });
  console.log(`GET ${p} → ${r.ms}ms ${r.ok ? '' : r.error ?? ''}`);
}

const messages = [
  '今天下午开了个会，挺累的',
  '嗯，我在。',
  '你会怎么形容傍晚的天气？',
  '我刚才在想一件事，还没想明白',
  '陪我说会话吧',
];

const chats = [];
for (let i = 0; i < ROUNDS; i++) {
  const msg = messages[i % messages.length];
  const d0 = await get('/api/diagnostics');
  const t0 = Date.now();
  let payload = null;
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: msg, userId: 'perf-baseline', recentMessages: [] }),
      signal: AbortSignal.timeout(180_000),
    });
    payload = await res.json();
  } catch (e) { payload = { error: String(e?.message || e) }; }
  const totalMs = Date.now() - t0;
  const d1 = await get('/api/diagnostics');
  chats.push({
    round: i + 1,
    message: msg,
    totalMs,
    timings: payload?.timings ?? null,
    replyChars: String(payload?.response ?? '').length,
    episodesBefore: d0.value?.counts?.episodes ?? null,
    episodesAfter: d1.value?.counts?.episodes ?? null,
    rssBeforeMb: d0.value?.rssMb ?? null,
    rssAfterMb: d1.value?.rssMb ?? null,
  });
  console.log(`chat${i + 1} ${totalMs}ms reply=${chats[i].replyChars}字 timings=${Object.keys(payload?.timings ?? {}).join(',') || '无'}`);
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const phaseKeys = [...new Set(chats.flatMap(c => Object.keys(c.timings ?? {})))];
const phaseAvg = {};
for (const k of phaseKeys) {
  const vals = chats.map(c => Number(c.timings?.[k])).filter(v => Number.isFinite(v) && v >= 0);
  phaseAvg[k] = avg(vals);
}

const lines = [];
lines.push(`# 单机体验基线（v2.01，${new Date().toISOString()}）`);
lines.push('');
lines.push(`> ${ROUNDS} 轮真实聊天 + 5 个读接口；**先测量再优化**。所有数字都是本机一次采样，不是 SLO。`);
lines.push('');
lines.push('## 读接口');
lines.push('| 路径 | 延迟 | 状态 |');
lines.push('|---|---|---|');
for (const r of reads) lines.push(`| ${r.path} | ${r.ms}ms | ${r.ok ? 'ok' : '失败'} |`);
lines.push('');
lines.push('## 聊天端到端');
lines.push('| 轮 | 输入 | 端到端 | 回复字数 | timings 字段 | RSS 前→后 |');
lines.push('|---|---|---|---|---|---|');
for (const c of chats) {
  lines.push(`| ${c.round} | ${c.message} | ${c.totalMs}ms | ${c.replyChars} | ${Object.keys(c.timings ?? {}).length || 0} 个 | ${c.rssBeforeMb}→${c.rssAfterMb} MB |`);
}
lines.push('');
lines.push(`- 端到端平均：**${avg(chats.map(c => c.totalMs))}ms**（最小 ${Math.min(...chats.map(c => c.totalMs))}ms / 最大 ${Math.max(...chats.map(c => c.totalMs))}ms）`);
lines.push('');
if (phaseKeys.length) {
  lines.push('## 服务端分阶段（DEBUG_TIMINGS=true）');
  lines.push('| 阶段 | 平均 |');
  lines.push('|---|---|');
  for (const k of phaseKeys) lines.push(`| ${k} | ${phaseAvg[k]}ms |`);
  lines.push('');
}
lines.push('## 记忆写入');
lines.push('| 轮 | episodes 前→后 |');
lines.push('|---|---|');
for (const c of chats) lines.push(`| ${c.round} | ${c.episodesBefore}→${c.episodesAfter} |`);
lines.push('');
lines.push('## 备注 / 限制');
lines.push('- 这是**单机一次采样**：未做并发、未做冷启动对比、未做多日趋势；');
lines.push('- 第一轮可能包含惰性初始化（嵌入/具体化/Laya 等），与后续轮不可直接平均；');
lines.push('- 分阶段耗时只在 `DEBUG_TIMINGS=true` 时返回（默认不暴露，避免响应变大）；');
lines.push('- 未覆盖：故障注入（模型 API 超时/失败）、长会话内存增长、磁盘 IO 峰值。');

fs.mkdirSync('artifacts/v2.01', { recursive: true });
fs.writeFileSync('artifacts/v2.01/perf-baseline.md', lines.join('\n'));
console.log('\nwritten: artifacts/v2.01/perf-baseline.md');
