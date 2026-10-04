// P0-2 Level 3-b（第一轮）：**系统里到底有没有一条真实的 provenance 生产路径？**
//
// 只回答一个问题：`selected?.provenance != undefined` 在生产链里能否自然出现。
//   ✗ 不追 FAIL / AMBIGUOUS      ✗ 不改 argmax / priority / strategy / share
//   ✗ 不人工塞 selected.provenance ✗ 不直接调 decideProactiveRecall()
//
// 手法（零播种）：让记忆**由真实对话自己形成** —— 第 1 轮他说「想去海边」（user-owned 事实），
// 之后中性闲聊，逐轮读 `/state → motive.thisTurn`。embedding stub 给**极端可分辨**向量。
import { createServer } from 'node:http';
import { cpSync, rmSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';

process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.LAYA_STRATEGY = 'off';

const APP_PORT = 34568;
const MEM = 'memories', BAK = 'memories.p0-3b-backup';
const hits: Record<string, number> = {};
const replyQueue: string[] = [];   // 每轮给 stub 固定回复（不控制"她说什么"，只避免空回复）

const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = req.url ?? '';
    hits[url] = (hits[url] ?? 0) + 1;
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* 忽略 */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.includes('/embeddings')) {
      // 极端可分辨：所有输入都给同一维度的确定向量（同向 ⇒ 相似度无歧义，不制造假排序）
      const input = body.input;
      const n = Array.isArray(input) ? input.length : 1;
      res.end(JSON.stringify({
        object: 'list', model: 'stub-embed',
        data: Array.from({ length: n }, (_, i) => ({ object: 'embedding', index: i, embedding: [1, 0, 0, 0, 0, 0, 0, 0] })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }));
      return;
    }
    const text = replyQueue.shift() ?? '嗯，我在。';
    res.end(JSON.stringify({
      id: 'chatcmpl-stub', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'stub',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
const stubPort = (stub.address() as { port: number }).port;

const trace: Array<Record<string, unknown>> = [];
try {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });

  const srv = new AIGirlfriendServer();
  await srv.start(APP_PORT);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${APP_PORT}/health`)).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  console.log(`[app] :${APP_PORT} ｜ [stub] :${stubPort} ｜ 就绪=${ready}\n`);

  const settings = { provider: 'openai', apiKey: 'p0-stub-key', model: 'stub', baseUrl: `http://127.0.0.1:${stubPort}/v1` };
  const turns = [
    '等这个项目结束，我想去趟海边。',          // ← 播种 user-owned 事实（真实对话，不是塞状态）
    '今天下午把阳台收拾了一下。',
    '晚上打算早点睡。',
    '刚才下楼买了点水果。',
    '这周事情有点多。',
    '今天天气还不错。',
  ];
  for (let i = 0; i < turns.length; i++) {
    replyQueue.push(i === 0 ? '海边啊，那地方确实让人松快。' : '嗯，我在听。');
    const before = { ...hits };
    const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: turns[i], userId: 'p0-3b', recentMessages: [], settings }),
    });
    const body = await res.json() as Record<string, unknown>;
    const st = await fetch(`http://127.0.0.1:${APP_PORT}/state`).then(r => r.json()) as Record<string, unknown>;
    const tt = ((st.motive ?? {}) as Record<string, unknown>).thisTurn as Record<string, unknown> | undefined;
    const pool = ((st.motive ?? {}) as Record<string, unknown>).pool as unknown[] | undefined;
    const row = {
      turn: i + 1,
      embeddingNow: (hits['/v1/embeddings'] ?? 0) - (before['/v1/embeddings'] ?? 0),
      chatNow: (hits['/v1/chat/completions'] ?? 0) - (before['/v1/chat/completions'] ?? 0),
      motiveKind: tt?.kind ?? null,
      memoryId: tt?.memoryId ?? null,
      hasProvenance: tt?.provenance != null,
      provenance: tt?.provenance ?? null,
      poolSize: pool?.length ?? 0,
      verdict: body.provenanceVerdict ?? null,
      accepted: body.expressionAccepted ?? null,
    };
    trace.push(row);
    console.log(`[轮${i + 1}] embed+${row.embeddingNow} chat+${row.chatNow} ｜ motive=${row.motiveKind} memoryId=${row.memoryId} prov=${row.hasProvenance} ｜ pool=${row.poolSize} ｜ guard=${row.verdict}/${row.accepted}`);
  }

  console.log('\n────────────────────────────');
  console.log('Level 3-b trace');
  console.log('────────────────────────────');
  console.log(`embedding   called=${(hits['/v1/embeddings'] ?? 0) > 0}（命中 ${hits['/v1/embeddings'] ?? 0} 次）`);
  const echoTurns = trace.filter(r => r.motiveKind === 'memory_echo');
  const provTurns = trace.filter(r => r.hasProvenance === true);
  console.log(`candidate   memory_echo 被选中的轮次 = [${echoTurns.map(r => r.turn).join(',') || '无'}]`);
  console.log(`selection   memoryId = [${echoTurns.map(r => r.memoryId ?? 'null').join(',') || '无'}]`);
  console.log(`provenance  attached = [${provTurns.map(r => r.turn).join(',') || '无'}]`);
  console.log('────────────────────────────');
  const pathFound = provTurns.length > 0;
  console.log(pathFound
    ? '=> Path found: memory → retrieval → memory_echo → selected → **provenance**'
    : '=> Path NOT found（这一轮内）：selected 从未携带 provenance');
  if (!pathFound) {
    console.log('   断点定位：');
    console.log(`   · embedding → retrieval：${(hits['/v1/embeddings'] ?? 0) > 0 ? '有调用（未断）' : '**没有 embedding 调用**'}`);
    console.log(`   · retrieval → candidate：memory_echo 曾入选 = ${echoTurns.length > 0}`);
    console.log(`   · candidate → selection：被选中的动机种类 = [${trace.map(r => r.motiveKind).join(',')}]`);
    console.log('   （按设计：断在哪一段就是这一轮的结论，不改生产逻辑去"凑"路径）');
  }
  console.log(`\nstub 命中统计：${JSON.stringify(hits)}`);
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原`);
  process.exit(0);   // 观测矩阵阶段：结论本身就是产出，不用 PASS/FAIL 判定
}
