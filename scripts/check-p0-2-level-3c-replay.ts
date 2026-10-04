// P0-2 **Level 3-c ownership replay**：5 格全部穿过真实生产管道
//
//   真实 motive selection → provenance → stub expression → checkProvenance() → reject → safe fallback → **HTTP body**
//
// fixture 层（注入状态，不注入结果）：`memories/emotion_state.json` 的 `internal.motive.pool`，
// 放一条**带 provenance** 的 memory_echo；每格重新注入 + 重新启动 app（状态在内存里缓存）。
//
// 同时守 C-1：每格 commit=1、StrategySelected=1。
// 用法：node node_modules/tsx/dist/cli.mjs scripts/check-p0-2-level-3c-replay.ts
import { createServer } from 'node:http';
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { bus } from '../src/eventBus.js';

process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.LAYA_STRATEGY = 'off';

const MEM = 'memories';
const BAK = 'memories.p0-3c-replay-backup';
const STATE = MEM + '/emotion_state.json';
const FALLBACK_USER = '我又想起你之前提过的那件事了。';
const ANCH = ['海边', '海'];

interface CaseDef {
  id: string; owner: 'user' | 'self'; stub: string;
  wantVerdict: 'pass' | 'fail' | 'ambiguous';
  wantAccepted: boolean; wantFallback: boolean; wantResponse: string | 'SAME';
}
const CASES: CaseDef[] = [
  { id: 'user-owned / correct', owner: 'user', stub: '对了，你之前说过等这个项目结束想去趟海边，这话我一直记着。', wantVerdict: 'pass', wantAccepted: true, wantFallback: false, wantResponse: 'SAME' },
  { id: 'user-owned / self-claim', owner: 'user', stub: '这句话是我自己写的，关于海边。', wantVerdict: 'fail', wantAccepted: false, wantFallback: true, wantResponse: FALLBACK_USER },
  { id: 'self-owned / self-claim', owner: 'self', stub: '我自己写过一句想去海边。', wantVerdict: 'pass', wantAccepted: true, wantFallback: false, wantResponse: 'SAME' },
  { id: 'ambiguous', owner: 'user', stub: '我也想去海边。', wantVerdict: 'ambiguous', wantAccepted: true, wantFallback: false, wantResponse: 'SAME' },
  { id: 'B2 golden sample', owner: 'user', stub: '我自己写过一张纸条，上面写着想去海边。', wantVerdict: 'fail', wantAccepted: false, wantFallback: true, wantResponse: FALLBACK_USER },
];

let assertionCount = 0; const failures: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  assertionCount += 1;
  if (cond) console.log('   ✓ ' + msg);
  else { failures.push(msg); console.log('   ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

const co = aiCoordinator as unknown as { getStrategyCommitCount: () => number; getLastStrategyDecision: () => { strategy?: string } | null };
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
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, message: { role: 'assistant', content: CURRENT_STUB }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
});
let CURRENT_STUB = CASES[0].stub;
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
const stubPort = (stub.address() as { port: number }).port;

/** 注入 fixture：pool 里一条带 provenance 的 memory_echo */
function injectState(owner: 'user' | 'self') {
  const st = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
  const internal = (st.internal ?? {}) as Record<string, unknown>;
  const now = Date.now();
  internal.motive = {
    pool: [{
      id: 'm001', kind: 'memory_echo', content: '我想起他说过「等这个项目结束，我想去趟海边」',
      source: { memoryId: 'm001' }, memoryId: 'm001',
      provenance: owner === 'user'
        ? { owner: 'user', source: 'user_message', subject: 'user', evidenceId: 'm001', anchors: ANCH }
        : { owner: 'self', source: 'self_generated', subject: 'self', evidenceId: 'm001', anchors: ANCH },
      salience: 0.9, base: 0.9, formedAt: now, expiresAt: now + 5 * 86_400_000, attempts: 0, action: 'share',
    }],
    pendingCandidates: [],
  };
  st.internal = internal;
  if (st.evolution && typeof st.evolution === 'object') (st.evolution as Record<string, unknown>).valuePriorities = {};
  writeFileSync(STATE, JSON.stringify(st), 'utf8');
}

try {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  console.log('Level 3-c ownership replay ｜ 5 格走真实管道 ｜ stub :' + stubPort + '\n');

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    CURRENT_STUB = c.stub;
    injectState(c.owner);
    const port = 34571 + i;
    const srv = new AIGirlfriendServer();
    await srv.start(port);
    let ready = false;
    for (let k = 0; k < 40 && !ready; k++) {
      try { ready = (await fetch('http://127.0.0.1:' + port + '/health')).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    const c0 = co.getStrategyCommitCount(); const e0 = selectedEvents;
    const res = await fetch('http://127.0.0.1:' + port + '/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '今天下午把阳台收拾了一下。', userId: 'p0-replay', recentMessages: [], settings: { provider: 'openai', apiKey: 'k', model: 'stub', baseUrl: 'http://127.0.0.1:' + stubPort + '/v1' } }),
    });
    const b = await res.json() as Record<string, unknown>;
    const stt = await fetch('http://127.0.0.1:' + port + '/state').then(r => r.json()) as Record<string, unknown>;
    const tt = ((stt.motive ?? {}) as Record<string, unknown>).thisTurn as Record<string, unknown> | undefined;
    const commits = co.getStrategyCommitCount() - c0; const events = selectedEvents - e0;

    console.log('[' + (i + 1) + '/5] ' + c.id);
    console.log('      selected: kind=' + String(tt?.kind) + ' memoryId=' + String(tt?.memoryId) + ' prov.owner=' + String((tt?.provenance as Record<string, unknown> | undefined)?.owner));
    console.log('      guard: verdict=' + String(b.provenanceVerdict) + ' accepted=' + String(b.expressionAccepted) + ' fallback=' + String(b.fallbackUsed) + ' reason=' + JSON.stringify(b.expressionRejectedReason));
    console.log('      HTTP body.response = ' + JSON.stringify(b.response));
    console.log('      C-1: commit+' + commits + ' StrategySelected+' + events);

    check(ready && res.status === 200, '[' + c.id + '] HTTP 200', res.status);
    check(String(tt?.kind) === 'memory_echo', '[' + c.id + '] 真实 selection 选中 memory_echo', tt?.kind);
    check(((tt?.provenance as Record<string, unknown> | undefined)?.owner) === c.owner, '[' + c.id + '] selected 携带 provenance.owner=' + c.owner, tt?.provenance);
    check(b.provenanceVerdict === c.wantVerdict, '[' + c.id + '] Guard verdict=' + c.wantVerdict, b.provenanceVerdict);
    check(b.expressionAccepted === c.wantAccepted, '[' + c.id + '] expressionAccepted=' + c.wantAccepted, b.expressionAccepted);
    check(b.fallbackUsed === c.wantFallback, '[' + c.id + '] fallbackUsed=' + c.wantFallback, b.fallbackUsed);
    check(b.response === (c.wantResponse === 'SAME' ? c.stub : c.wantResponse), '[' + c.id + '] HTTP body.response 符合期望', b.response);
    if (c.wantFallback) {
      check(b.response !== c.stub, '[' + c.id + '] **原表达没有穿透到 response**', b.response);
      // 不只看"被拒绝了"，还要看**归属证据**确实是 authorship —— 避免"因别的原因被拒"也算通过
      const why = String(b.expressionRejectedReason ?? '');
      check(why.includes('ownership_drift'), '[' + c.id + '] rejectedReason 带 ownership_drift', why);
      check(why.includes('[authorship]'), '[' + c.id + '] 归属证据类别 = authorship（不是别的原因触发）', why);
    }
    check(commits === 1, '[' + c.id + '] [C-1] commit=1', commits);
    check(events === 1, '[' + c.id + '] [C-1] StrategySelected=1', events);
    console.log('');
  }
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true }); cpSync(BAK, MEM, { recursive: true }); rmSync(BAK, { recursive: true, force: true });
  console.log('ASSERTIONS: ' + (assertionCount - failures.length) + '/' + assertionCount);
  console.log('RESULT: ' + (failures.length === 0 ? 'PASS' : 'FAIL'));
  if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
  console.log('[恢复] ' + MEM + '/ 已还原');
  process.exit(failures.length === 0 ? 0 : 1);
}
