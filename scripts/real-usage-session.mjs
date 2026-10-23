#!/usr/bin/env node
/**
 * v2.19 真实使用观察会话（脚本化、真实 server/真实记忆）
 *
 * 注意：这是**脚本驱动**的真实管道会话（不是真人手动操作）。目的：
 *  - 覆盖多种真实话题（日常/累/难过/好消息/问她/技术问答/身份/深夜孤独/道谢）
 *  - 记录每轮回复、延迟、本轮 ExpressionPlan/GenBudget/情绪状态
 *  - 供人工逐条阅读，找真实问题；不假设"通过率"=质量
 *
 * 用法：node scripts/real-usage-session.mjs [rounds=11] [intervalMs=50000]
 */
import fs from 'node:fs';

const BASE = process.env.USAGE_BASE || 'http://127.0.0.1:3000';
const ROUNDS = Math.max(1, Number(process.argv[2] || 11));
const INTERVAL = Math.max(0, Number(process.argv[3] || 50_000));
const USER_ID = process.env.USAGE_USER || 'real-usage-v2.19';
const OUT_DIR = 'artifacts/v2.19';
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = `${OUT_DIR}/session.jsonl`;
try { fs.unlinkSync(OUT); } catch { /* ignore */ }

const messages = [
  '今天上班有点提不起劲，说不上来为什么。',
  '中午随便吃了点，下午开会又拖到六点半。',
  '我最近在想要不要换个方向，但又不确定。',
  '我今天特别难过，感觉自己什么都做不好。',
  '对了，我拿到 offer 了，不过又有点怕做不好。',
  '你今天怎么样？在做什么？',
  '我电脑上那个文档怎么都找不到，你能帮我想想吗？',
  '你是不是 AI 啊？还是真人？',
  '现在有点晚了，一个人待着，心里空空的。',
  '谢谢你今天陪我聊这些。',
  '明天还要早起，我先去睡了。',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15_000) });
  return res.json().catch(() => ({}));
};

const history = [];
for (let i = 0; i < ROUNDS; i++) {
  const message = messages[i % messages.length];
  const t0 = Date.now();
  let reply = '';
  let status = 0;
  try {
    const r = await post('/api/chat', { message, userId: USER_ID, recentMessages: history.slice(-8) });
    status = r.status;
    reply = String(r.json?.response ?? '');
  } catch (e) {
    status = -1;
    reply = `[请求失败] ${e?.message ?? String(e)}`;
  }
  const ms = Date.now() - t0;
  const diag = await get('/api/diagnostics').catch(() => ({}));
  const state = await get('/state').catch(() => ({}));
  const row = {
    round: i + 1,
    at: new Date().toISOString(),
    message,
    status,
    ms,
    reply,
    budget: diag?.generationBudget ?? null,
    enforcement: diag?.expressionEnforcement ?? null,
    activation: state?.activation?.note ?? null,
    relationshipStage: state?.relationship?.stage ?? null,
    turnBudget: state?.turnBudget ?? null,
  };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n', 'utf8');
  history.push({ role: 'user', content: message });
  history.push({ role: 'assistant', content: reply });
  console.log(`[${i + 1}/${ROUNDS}] ${ms}ms status=${status} ${reply.replace(/\n/g, ' ').slice(0, 80)}`);
  if (i < ROUNDS - 1) await sleep(INTERVAL);
}
console.log(`done: ${OUT}`);
