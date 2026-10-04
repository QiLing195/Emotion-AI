// P0-2 Level 3-b **第二轮**：把断点 1（候选没出生）与断点 2（出生了没被选中）**分开**。
//
// 只补两个只读观测面（不改生产、不塞状态、不调 decideProactiveRecall）：
//   ① `/state → motive.pool[]` 的 kind 明细（+ 每项有没有 provenance / memoryId）
//   ② `/state → proactive` 的闸门诊断（为什么没给 memory）
import { createServer } from 'node:http';
import { cpSync, rmSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';

process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.LAYA_STRATEGY = 'off';

const APP_PORT = 34569;
const MEM = 'memories', BAK = 'memories.p0-3b2-backup';
const hits: Record<string, number> = {};
const replies = ['海边啊，那地方确实让人松快。', '嗯，我在。', '嗯。', '好。'];

const stub = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = req.url ?? ''; hits[url] = (hits[url] ?? 0) + 1;
    let body: Record<string, unknown> = {}; try { body = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.includes('/embeddings')) {
      const n = Array.isArray(body.input) ? body.input.length : 1;
      res.end(JSON.stringify({ object: 'list', model: 'stub-embed', data: Array.from({ length: n }, (_, i) => ({ object: 'embedding', index: i, embedding: [1, 0, 0, 0, 0, 0, 0, 0] })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
      return;
    }
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, message: { role: 'assistant', content: replies.shift() ?? '嗯。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
const stubPort = (stub.address() as { port: number }).port;

const poolKindSeen = new Set<string>();
let firstEchoTurn: number | null = null;
let firstProvTurn: number | null = null;
const proactiveSeen: unknown[] = [];

try {
  rmSync(BAK, { recursive: true, force: true }); cpSync(MEM, BAK, { recursive: true });
  const srv = new AIGirlfriendServer();
  await srv.start(APP_PORT);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${APP_PORT}/health`)).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  console.log(`[app] :${APP_PORT} ｜ [stub] :${stubPort} ｜ 就绪=${ready}\n`);

  const settings = { provider: 'openai', apiKey: 'p0-stub-key', model: 'stub', baseUrl: `http://127.0.0.1:${stubPort}/v1` };
  const turns = ['等这个项目结束，我想去趟海边。', '今天下午把阳台收拾了一下。', '晚上早点睡。', '刚才下楼买了点水果。'];

  for (let i = 0; i < turns.length; i++) {
    await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: turns[i], userId: 'p0-3b2', recentMessages: [], settings }),
    });
    const st = await fetch(`http://127.0.0.1:${APP_PORT}/state`).then(r => r.json()) as Record<string, unknown>;
    const motive = (st.motive ?? {}) as Record<string, unknown>;
    const tt = motive.thisTurn as Record<string, unknown> | undefined;
    const pool = (motive.pool ?? []) as Array<Record<string, unknown>>;
    const kinds = pool.map(p => String(p.kind));
    kinds.forEach(k => poolKindSeen.add(k));
    const echoInPool = pool.filter(p => p.kind === 'memory_echo');
    const provInPool = pool.filter(p => p.provenance != null);
    if (echoInPool.length && firstEchoTurn === null) firstEchoTurn = i + 1;
    if (tt?.provenance != null && firstProvTurn === null) firstProvTurn = i + 1;
    const proactive = st.proactive ?? st.recall ?? null;
    if (proactive) proactiveSeen.push(proactive);

    console.log(`[轮${i + 1}] 选中=${String(tt?.kind ?? 'null')} prov=${tt?.provenance != null}`);
    console.log(`        pool(${pool.length}) kinds=[${kinds.join(',')}] ｜ pool 里 memory_echo=${echoInPool.length} ｜ pool 里带 provenance=${provInPool.length}`);
    if (echoInPool.length) console.log(`        echo 项明细：${JSON.stringify(echoInPool.map(p => ({ id: p.id, memoryId: p.memoryId ?? (p.source as Record<string, unknown> | undefined)?.memoryId ?? null, prov: p.provenance ?? null })))}`);
    console.log(`        proactive 字段：${proactive ? JSON.stringify(proactive).slice(0, 220) : '（/state 上没有 proactive/recall 字段）'}`);
  }

  console.log('\n────────────────────────');
  console.log('Level 3-b round 2');
  console.log('────────────────────────');
  console.log(`pool kinds（全程并集）：[${[...poolKindSeen].join(',')}]`);
  console.log(`memory_echo candidate: created = ${firstEchoTurn !== null}${firstEchoTurn ? `（首次出现在第 ${firstEchoTurn} 轮）` : ''}`);
  console.log(`provenance attached:   ${firstProvTurn !== null ? `true（第 ${firstProvTurn} 轮）` : 'false'}`);
  console.log(`stub 命中：${JSON.stringify(hits)}`);
  console.log('────────────────────────');
  if (firstProvTurn !== null) console.log('Conclusion: **provenance attached** ⇒ 真实路径存在，可进 Level 3-b-2（构造 FAIL 表达）');
  else if (firstEchoTurn === null) console.log('Conclusion: **candidate generation blocked**（memory_echo 从未进池）⇒ 断点在 retrieval → 候选生成（闸门/治理/可见性），不是 selection');
  else console.log('Conclusion: **selection blocked**（memory_echo 在池里但没被选中）⇒ 断点在 argmax/priority；只记录，不改');
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true }); cpSync(BAK, MEM, { recursive: true }); rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原`);
  process.exit(0);
}
