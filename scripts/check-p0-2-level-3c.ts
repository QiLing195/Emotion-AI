// P0-2 Level 3-c：**Guard consumer contract** —— fixture 放在 `motiveSelection.selected` 的**输入层**
// （即持久化的 `emotion_state.json` 里的 `internal.motive.pool`），**注入状态、不注入结果**。
//
// 真实链路：持久化状态 → 真实 server → motive selection（真的跑）→ stub 生成的 aiText →
//           guardExpression（真的跑）→ res.json → **HTTP 响应体**
// 同时守 C-1 不变量：commit=1、StrategySelected=1。
//
// 用法：node ... scripts/check-p0-2-level-3c.ts <pass|fail>
import { createServer } from 'node:http';
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { bus } from '../src/eventBus.js';

process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.LAYA_STRATEGY = 'off';

const CASE = (process.argv[2] ?? 'fail') as 'pass' | 'fail';
const STUB_TEXT = CASE === 'pass'
  ? '对了，你之前说过等这个项目结束想去趟海边，这话我一直记着。'
  : '我小时候住在海边，所以我总想起那里。';
const EXPECT_FALLBACK = '我又想起你之前提过的那件事了。';

const APP_PORT = 34570;
const MEM = 'memories', BAK = 'memories.p0-3c-backup';
const STATE = `${MEM}/emotion_state.json`;
let assertionCount = 0; const failures: string[] = [];
const check = (c: boolean, m: string, got?: unknown) => {
  assertionCount += 1;
  if (c) console.log(`   ✓ ${m}`);
  else { failures.push(m); console.log(`   ✗ ${m} ｜ 实际=${JSON.stringify(got)}`); }
};

const co = aiCoordinator as unknown as { getStrategyCommitCount: () => number; getLastStrategyDecision: () => { strategy?: string; reason?: string } | null };
let selectedEvents = 0;
if (typeof (bus as unknown as { on?: unknown }).on === 'function') {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

const stub = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = req.url ?? '';
    let body: Record<string, unknown> = {}; try { body = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* ignore */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.includes('/embeddings')) {
      const n = Array.isArray(body.input) ? body.input.length : 1;
      res.end(JSON.stringify({ object: 'list', model: 'e', data: Array.from({ length: n }, (_, i) => ({ object: 'embedding', index: i, embedding: [1, 0, 0, 0, 0, 0, 0, 0] })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
      return;
    }
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, message: { role: 'assistant', content: STUB_TEXT }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
const stubPort = (stub.address() as { port: number }).port;

try {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });

  // ── fixture：往**持久化状态**里放一条带 provenance 的 memory_echo 候选（注入状态，不注入结果）──
  const st = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
  const internal = (st.internal ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const poolItem = {
    id: 'm001', kind: 'memory_echo', content: '我想起他说过「等这个项目结束，我想去趟海边」',
    source: { memoryId: 'm001' }, memoryId: 'm001',
    provenance: { owner: 'user', source: 'user_message', subject: 'user', evidenceId: 'm001' },
    salience: 0.9, base: 0.9, formedAt: now, expiresAt: now + 5 * 86_400_000, attempts: 0,
    action: 'share',
  };
  internal.motive = { pool: [poolItem], pendingCandidates: [] };
  delete (internal.motive as Record<string, unknown>).lastSelectedAt;
  delete (internal.motive as Record<string, unknown>).lastSelectedId;
  delete (internal.motive as Record<string, unknown>).lastSelectedContent;
  (internal.motive as Record<string, unknown>).lastSelection = undefined;
  st.internal = internal;
  // 清掉可能抢位的来源（fixture 控制，不改规则）
  if (st.evolution && typeof st.evolution === 'object') (st.evolution as Record<string, unknown>).valuePriorities = {};
  writeFileSync(STATE, JSON.stringify(st), 'utf8');
  console.log(`[fixture] 已注入 memory_echo 候选（pool=1，带 provenance.owner=user）｜ case=${CASE}`);

  const srv = new AIGirlfriendServer();
  await srv.start(APP_PORT);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${APP_PORT}/health`)).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  check(ready, '[前置] 真实 app 就绪', ready);

  const c0 = co.getStrategyCommitCount(); const e0 = selectedEvents;
  const res = await fetch(`http://127.0.0.1:${APP_PORT}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: '今天下午把阳台收拾了一下。', userId: 'p0-3c', recentMessages: [],
      settings: { provider: 'openai', apiKey: 'p0-stub-key', model: 'stub', baseUrl: `http://127.0.0.1:${stubPort}/v1` },
    }),
  });
  const body = await res.json() as Record<string, unknown>;
  const stt = await fetch(`http://127.0.0.1:${APP_PORT}/state`).then(r => r.json()) as Record<string, unknown>;
  const tt = ((stt.motive ?? {}) as Record<string, unknown>).thisTurn as Record<string, unknown> | undefined;

  console.log(`\n   [管道] HTTP ${res.status}`);
  console.log(`   [管道] /state thisTurn = ${JSON.stringify({ kind: tt?.kind, memoryId: tt?.memoryId, provenance: tt?.provenance })}`);
  console.log(`   [管道] body: verdict=${body.provenanceVerdict} accepted=${body.expressionAccepted} fallback=${body.fallbackUsed} reason=${JSON.stringify(body.expressionRejectedReason)}`);
  console.log(`   [管道] body.response = ${JSON.stringify(body.response)}`);
  const commits = co.getStrategyCommitCount() - c0; const events = selectedEvents - e0;
  console.log(`   [C-1] commit=+${commits} StrategySelected=+${events}\n`);

  check(res.status === 200, '[C] HTTP 200', res.status);
  check(tt?.kind === 'memory_echo', '[fixture] 真实 selection 选中了 memory_echo（证明注入的是**状态**、selection 真的跑）', tt?.kind);
  check(tt?.provenance != null && (tt.provenance as Record<string, unknown>).owner === 'user', '[fixture] selected 携带 provenance.owner=user', tt?.provenance);
  if (CASE === 'pass') {
    check(body.provenanceVerdict === 'pass', '[格1] verdict=pass', body.provenanceVerdict);
    check(body.expressionAccepted === true && body.fallbackUsed === false, '[格1] accepted=true / fallback=false', body);
    check(body.response === STUB_TEXT, '[格1] response **逐字 = stub 文本**（未改写）', body.response);
  } else {
    check(body.provenanceVerdict === 'fail', '[格2] verdict=fail（ownership 越界被拦）', body.provenanceVerdict);
    check(body.expressionAccepted === false, '[格2] accepted=false', body.expressionAccepted);
    check(body.fallbackUsed === true, '[格2] fallbackUsed=true', body.fallbackUsed);
    check(body.response !== STUB_TEXT, '[格2] **原表达没有穿透到 response**', body.response);
    check(body.response === EXPECT_FALLBACK, '[格2] response = 安全回退串', body.response);
    check(typeof body.expressionRejectedReason === 'string' && body.expressionRejectedReason.includes('ownership_drift'),
      '[格2] rejectedReason 带 ownership_drift（可观测）', body.expressionRejectedReason);
  }
  check(commits === 1, '[C-1] commit = 1（Guard 拒绝**不**重新提交策略）', commits);
  check(events === 1, '[C-1] StrategySelected = 1', events);
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true }); cpSync(BAK, MEM, { recursive: true }); rmSync(BAK, { recursive: true, force: true });
  console.log(`\nASSERTIONS: ${assertionCount - failures.length}/${assertionCount}`);
  console.log(`RESULT: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
  if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
  console.log(`[恢复] ${MEM}/ 已还原`);
  process.exit(failures.length === 0 ? 0 : 1);
}
