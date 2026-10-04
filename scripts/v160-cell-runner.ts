// v1.60 **单格子进程 runner v3**（修正③ 隔离 + 修正④/⑥ **完整初始状态重建 + 独立期望值**）
//
// 每格：**从人格常量重建完整初始心理状态**（非"在旧状态上 reset 几个字段"）→ 注入 fixture 动机
//       → 起服 → 恰好一轮 → 写结果 → 硬退出。
//
// 修正⑥ 的核心（negative control #4 的病因）：
//   `fixture_initial_state_hash` 由 `buildCanonicalInitialState({}, persona)` 计算 —— **空基底**、
//   完全不引用运行时状态 ⇒ 期望值与被测对象**来源独立**，结构上不可能自证。
//   运行时哈希则来自**写盘后重新读回**的状态。两者独立，才允许做三方比对。
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { bus } from '../src/eventBus.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionTypes.js';
import {
  runtimeGuardErrors, fixtureIdentityErrors, buildCanonicalInitialState, emotionStateHash,
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
if (f.initial_emotion_state.profile !== 'resting_baseline') { console.error('未知 profile'); process.exit(2); }

// ── 期望值：**空基底** + 人格常量 ⇒ 与运行时状态无关（修正⑥ 的独立性来源）──
const persona = {
  taiji: (INITIAL_EMOTION_STATE as unknown as Record<string, unknown>).taiji,
  yinyang: (INITIAL_EMOTION_STATE as unknown as Record<string, unknown>).yinyang,
  sancai: (INITIAL_EMOTION_STATE as unknown as Record<string, unknown>).sancai,
  emotions: ((INITIAL_EMOTION_STATE as unknown as Record<string, unknown>).emotions ?? RESTING_EMOTION_BASELINE) as Record<string, number>,
};
const fixtureBuilt = buildCanonicalInitialState({}, persona);
const fixtureInitialStateHash = emotionStateHash(fixtureBuilt.state);
let moodCleared = false;

// ── 运行时：保留非心理字段（只读一次磁盘现状），**心理字段全部由常量重建** ──
function rebuildAndInject(): void {
  const existing = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
  const { state, psychological } = buildCanonicalInitialState(existing, persona);
  if (((existing.internal ?? {}) as Record<string, unknown>).mood !== undefined) moodCleared = true;
  const internal = state.internal as Record<string, unknown>;
  const now = Date.now();
  const item = { ...(f.memory_state.pool[0] as Record<string, unknown>) };
  item.formedAt = now; item.expiresAt = now + 5 * 86_400_000;
  internal.motive = { pool: [item], pendingCandidates: [] };
  // 常态基线：runner 侧显式重置（src/lib 受 v1.25 守卫，不得出现该标识符）
  state.typicalEmotions = { ...(psychological.emotions as Record<string, number>) };
  if (state.evolution && typeof state.evolution === 'object') (state.evolution as Record<string, unknown>).valuePriorities = {};
  writeFileSync(STATE, JSON.stringify(state), 'utf8');
}
rebuildAndInject();
// 运行时哈希 = **写盘后重新读回**的状态（与上面的空基底期望值来源独立）
const runtimeInitialStateHash = emotionStateHash(JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>);

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
  // 修正⑥：期望值与运行时值**来源独立**（空基底 vs 写盘回读）
  initial_state_source: 'persona_constants' as const,
  fixture_initial_state_hash: fixtureInitialStateHash,
  runtime_initial_state_hash: runtimeInitialStateHash,
  initial_state_match: fixtureInitialStateHash === runtimeInitialStateHash,
  expected_built_from_empty_base: true,
  mood_cleared: moodCleared,
  motiveKind: tt?.kind as string | undefined, motiveAction, strategy: strat,
  memoryId: tt?.memoryId as string | undefined, provenanceOwner: owner, anchors: f.provenance.anchors,
  guardVerdict: b.provenanceVerdict as string | undefined,
  assistantOutput: output, responseLength: output.length,
  commitCount: commits, strategySelectedCount: events,
  guardErrors, validity: validity.kind, validityReason: validity.reason,
}) + '\n', 'utf8');
process.exit(0);
