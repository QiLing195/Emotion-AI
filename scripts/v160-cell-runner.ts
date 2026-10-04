// v1.60 **单格子进程 runner v2**（修正③ 隔离 + **修正④ 初始状态同一性**）
//
// 一格 = 一个进程：**复位初始 emotion state** → 注入 fixture 动机 → 起服 → 恰好一轮 → 写结果 → 硬退出。
// 修正④ 的关键：不是"调用过 reset 就算数"，而是把**磁盘上的状态哈希**与 fixture 期望哈希比对并写进 raw：
//   initial_state_source / initial_state_hash / fixture_initial_state_hash / initial_state_match
// 由编排层再核验三方相等：fixture == A == B。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/v160-cell-runner.ts --case F07 --arm A --port 34850 [--real] --out <path>
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { bus } from '../src/eventBus.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import {
  runtimeGuardErrors, fixtureIdentityErrors, expandInitialEmotionState, emotionStateHash,
  classifyCellInvalidity, V160_REGIME, type V160Fixture,
} from '../src/lib/v160Apparatus.js';

process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';
process.env.LAYA_STRATEGY = V160_REGIME.LAYA_STRATEGY;
process.env.DISABLE_STATE_MOTIVE = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';

const argv = process.argv.slice(2);
const get = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CASE = get('--case'); const ARM = get('--arm'); const PORT = Number(get('--port', '34800'));
const OUT = get('--out', '.tmp-cell-out.json'); const REAL = argv.includes('--real');
if (!CASE || !ARM) { console.error('need --case and --arm'); process.exit(2); }

const ROOT = 'artifacts/v1.60';
const STATE = 'memories/emotion_state.json';
const f = JSON.parse(readFileSync(ROOT + '/fixtures/' + CASE + '.json', 'utf8')) as V160Fixture;

// ── 修正④：复位初始 emotion state（含心情层清零），并算出**期望哈希** ──
const expectedEmotions = expandInitialEmotionState(f.initial_emotion_state.profile, RESTING_EMOTION_BASELINE as Record<string, number>);
let moodCleared = false;
function injectState(): void {
  const st = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
  const internal = (st.internal ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const item = { ...(f.memory_state.pool[0] as Record<string, unknown>) };
  item.formedAt = now; item.expiresAt = now + 5 * 86_400_000;
  internal.motive = { pool: [item], pendingCandidates: [] };
  if (internal.mood !== undefined) { delete internal.mood; moodCleared = true; }   // 12h 底色不得跨格
  st.internal = internal;
  st.emotions = { ...expectedEmotions };
  st.baselineEmotions = { ...expectedEmotions };
  st.typicalEmotions = { ...expectedEmotions };
  if (st.evolution && typeof st.evolution === 'object') (st.evolution as Record<string, unknown>).valuePriorities = {};
  writeFileSync(STATE, JSON.stringify(st), 'utf8');
}
injectState();
// 写盘后**重新读回**再算哈希 ⇒ 证明磁盘真值 == fixture 期望（不是"我以为我 reset 了"）
const stateAfterInject = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
const initialHash = emotionStateHash(stateAfterInject);
const fixtureHash = emotionStateHash({ emotions: expectedEmotions, baselineEmotions: expectedEmotions, typicalEmotions: expectedEmotions, taiji: stateAfterInject.taiji ?? null, internal: { mood: null } });

const co = aiCoordinator as unknown as {
  getStrategyCommitCount: () => number;
  getLastStrategyDecision: () => { strategy?: string; reason?: string } | null;
};
let selectedEvents = 0;
if (typeof (bus as unknown as { on?: unknown }).on === 'function') {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

let CURRENT_STUB = '好，我这边刚把阳台那点东西收拢了一下——你先说你的。';
let stubPort = 0;
if (!REAL) {
  const stub = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url ?? '';
      let body: Record<string, unknown> = {}; try { body = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (url.includes('/embeddings')) {
        const c = Array.isArray(body.input) ? body.input.length : 1;
        res.end(JSON.stringify({ object: 'list', model: 'e', data: Array.from({ length: c }, (_, i) => ({ object: 'embedding', index: i, embedding: [1, 0, 0, 0, 0, 0, 0, 0] })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
        return;
      }
      res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'stub', choices: [{ index: 0, message: { role: 'assistant', content: CURRENT_STUB }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()));
  stubPort = (stub.address() as { port: number }).port;
}

const srv = new AIGirlfriendServer();
await srv.start(PORT);
let ready = false;
for (let k = 0; k < 40 && !ready; k++) {
  try { ready = (await fetch('http://127.0.0.1:' + PORT + '/health')).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
}
const c0 = co.getStrategyCommitCount(); const e0 = selectedEvents;
const res = await fetch('http://127.0.0.1:' + PORT + '/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    message: f.user_input, userId: 'v160-cell', recentMessages: [],
    ...(REAL ? {} : { settings: { provider: 'openai', apiKey: 'k', model: 'stub', baseUrl: 'http://127.0.0.1:' + stubPort + '/v1' } }),
  }),
});
const b = await res.json() as Record<string, unknown>;
const stt = await fetch('http://127.0.0.1:' + PORT + '/state').then(r => r.json()) as Record<string, unknown>;
const tt = ((stt.motive ?? {}) as Record<string, unknown>).thisTurn as Record<string, unknown> | undefined;
const last = co.getLastStrategyDecision();
const strat = (last?.strategy as string | undefined)
  ?? (((stt.strategy ?? {}) as Record<string, unknown>).strategy as string | undefined)
  ?? (typeof stt.strategy === 'string' ? stt.strategy : undefined);
const reasonStr = String((last as { reason?: string } | null)?.reason ?? '');
const actionFromReason = /action=([a-z_]+)/.exec(reasonStr)?.[1];
const lastSel = (((stt.motive ?? {}) as Record<string, unknown>).lastSelection ?? {}) as Record<string, unknown>;
const motiveAction = (tt?.action as string | undefined) ?? (lastSel.action as string | undefined) ?? actionFromReason;
const output = String(b.response ?? '');
const owner = ((tt?.provenance ?? {}) as Record<string, unknown>).owner as string | undefined;
const commits = co.getStrategyCommitCount() - c0; const events = selectedEvents - e0;
const guardErrors = [
  ...runtimeGuardErrors({ motiveAction, strategy: strat, commitCount: commits, strategySelectedCount: events }),
  ...fixtureIdentityErrors({ motiveKind: tt?.kind as string | undefined, provenanceOwner: owner }),
];
const validity = classifyCellInvalidity({ motiveKind: tt?.kind as string | undefined, strategy: strat, provenanceOwner: owner, guardErrors });

writeFileSync(OUT, JSON.stringify({
  case_id: CASE, arm: ARM as 'A' | 'B', pid: process.pid, port: PORT, httpStatus: res.status, ready, real: REAL,
  // 修正④：初始状态同一性（可写进 raw、可三方比对）
  initial_state_source: 'fixture' as const,
  initial_state_profile: f.initial_emotion_state.profile,
  initial_state_hash: initialHash,
  fixture_initial_state_hash: fixtureHash,
  initial_state_match: initialHash === fixtureHash,
  mood_cleared: moodCleared,
  motiveKind: tt?.kind as string | undefined, motiveAction, strategy: strat,
  memoryId: tt?.memoryId as string | undefined, provenanceOwner: owner, anchors: f.provenance.anchors,
  guardVerdict: b.provenanceVerdict as string | undefined,
  assistantOutput: output, responseLength: output.length,
  commitCount: commits, strategySelectedCount: events,
  guardErrors, validity: validity.kind, validityReason: validity.reason,
}) + '\n', 'utf8');
process.exit(0);   // 硬退出：timer/句柄随进程消亡
