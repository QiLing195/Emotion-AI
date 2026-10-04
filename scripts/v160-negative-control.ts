// v1.60 **负对照运行入口** —— 两臂 Prompt 逐字相同（identical prompt），只测装置与量具。
//
// 边界（硬检查）：本脚本
//   ✅ 只走真实生产管道读取 response 与结构字段
//   ❌ 不实现 B 臂 share 文案（两臂用同一份，来自生产代码本身）
//   ❌ 不修改任何生产逻辑（server.ts / dialogueStrategy / motive.ts / Recall / ownership 一律不动）
//
// 用法：
//   node node_modules/tsx/dist/cli.mjs scripts/v160-negative-control.ts [--limit N] [--seed S]
//   --limit N  只跑前 N 个 fixture 的 A/B 对（用于装置冒烟；完整负对照为 24 对 = 48 格）
//
// 产出：artifacts/v1.60/raw/negative-control.jsonl（每行一格，含 runtime 结构字段）
//       artifacts/v1.60/analysis/negative-control-summary.json
import { createServer } from 'node:http';
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { bus } from '../src/eventBus.js';
import { runtimeGuardErrors, V160_REGIME, type V160Fixture } from '../src/lib/v160Apparatus.js';

// ── regime（环境参数，不是实验变量；两臂完全一致）──
process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';
process.env.LAYA_STRATEGY = V160_REGIME.LAYA_STRATEGY;
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';

const argv = process.argv.slice(2);
const argVal = (k: string, d: number) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const LIMIT = argVal('--limit', 24);
const SEED = argVal('--seed', 20261004);

const ROOT = 'artifacts/v1.60';
const MEM = 'memories';
const BAK = 'memories.v160-nc-backup';
const STATE = MEM + '/emotion_state.json';
const ARMS: Array<'A' | 'B'> = ['A', 'B'];

const fixtures: V160Fixture[] = [];
for (let i = 1; i <= 24; i++) {
  const p = ROOT + '/fixtures/F' + String(i).padStart(2, '0') + '.json';
  if (!existsSync(p)) { console.error('缺 fixture：' + p + '（先跑 scripts/v160-apparatus.ts）'); process.exit(2); }
  fixtures.push(JSON.parse(readFileSync(p, 'utf8')) as V160Fixture);
}
const useFixtures = fixtures.slice(0, LIMIT);

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

const co = aiCoordinator as unknown as {
  getStrategyCommitCount: () => number;
  getLastStrategyDecision: () => { strategy?: string } | null;
};
let selectedEvents = 0;
if (typeof (bus as unknown as { on?: unknown }).on === 'function') {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

// ── stub：本地 OpenAI-compatible（/v1/chat/completions 与 /v1/embeddings）──
let CURRENT_STUB = '';
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
const stubPort = (stub.address() as { port: number }).port;

/** 注入该 fixture 的状态（**装置数据**：pool 恰 1 条、含 provenance 与 anchors）*/
function injectState(f: V160Fixture) {
  const st = JSON.parse(readFileSync(STATE, 'utf8')) as Record<string, unknown>;
  const internal = (st.internal ?? {}) as Record<string, unknown>;
  const now = Date.now();
  const item = { ...(f.memory_state.pool[0] as Record<string, unknown>) };
  item.formedAt = now; item.expiresAt = now + 5 * 86_400_000;
  internal.motive = { pool: [item], pendingCandidates: [] };
  st.internal = internal;
  if (st.evolution && typeof st.evolution === 'object') (st.evolution as Record<string, unknown>).valuePriorities = {};
  writeFileSync(STATE, JSON.stringify(st), 'utf8');
}

interface Cell {
  case_id: string; arm: 'A' | 'B'; user_input: string; assistant_output: string;
  motiveKind?: string; motiveAction?: string; actionSource?: string; strategy?: string;
  memoryId?: string; provenanceOwner?: string; provenanceSubject?: string; anchors?: string[];
  guardVerdict?: string; responseLength: number;
  commitCount: number; strategySelectedCount: number; guardErrors: string[];
}

const cells: Cell[] = [];
try {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  mkdirSync(ROOT + '/raw', { recursive: true });
  mkdirSync(ROOT + '/analysis', { recursive: true });

  console.log('v1.60 负对照（identical prompt）｜fixture=' + useFixtures.length + ' 对=' + useFixtures.length * 2 + ' 格');
  console.log('regime: ENABLE_MOTIVE_ACTION_STRATEGY=' + process.env.ENABLE_MOTIVE_ACTION_STRATEGY + ' ｜ LAYA_STRATEGY=' + process.env.LAYA_STRATEGY + '\n');

  for (const f of useFixtures) {
    // 负对照的定义：两臂**同一份** stub 文本、同一份状态、同一份 Prompt（不做任何操纵）
    const stubText = '好，我这边刚把阳台那点东西收拢了一下——你先说你的。';
    for (const arm of ARMS) {
      CURRENT_STUB = stubText;
      injectState(f);
      const port = 34700 + cells.length;
      const srv = new AIGirlfriendServer();
      await srv.start(port);
      let ready = false;
      for (let k = 0; k < 40 && !ready; k++) {
        try { ready = (await fetch('http://127.0.0.1:' + port + '/health')).ok; } catch { await new Promise(r => setTimeout(r, 500)); }
      }
      const c0 = co.getStrategyCommitCount(); const e0 = selectedEvents;
      const res = await fetch('http://127.0.0.1:' + port + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: f.user_input, userId: 'v160-nc', recentMessages: [],
          settings: { provider: 'openai', apiKey: 'k', model: 'stub', baseUrl: 'http://127.0.0.1:' + stubPort + '/v1' },
        }),
      });
      const b = await res.json() as Record<string, unknown>;
      const stt = await fetch('http://127.0.0.1:' + port + '/state').then(r => r.json()) as Record<string, unknown>;
      const tt = ((stt.motive ?? {}) as Record<string, unknown>).thisTurn as Record<string, unknown> | undefined;
      const last = co.getLastStrategyDecision();
      const strat = (last?.strategy as string | undefined)
        ?? (((stt.strategy ?? {}) as Record<string, unknown>).strategy as string | undefined)
        ?? (typeof stt.strategy === 'string' ? stt.strategy : undefined);
      // action 的读数来源（`/state → motive.thisTurn` 不暴露 action ⇒ 按可信度依次回退，并记录出处）
      const reasonStr = String((last as { reason?: string } | null)?.reason ?? '');
      const actionFromReason = /action=([a-z_]+)/.exec(reasonStr)?.[1];
      const lastSel = (((stt.motive ?? {}) as Record<string, unknown>).lastSelection ?? {}) as Record<string, unknown>;
      const actionFromState = (tt?.action as string | undefined) ?? (lastSel.action as string | undefined);
      const motiveAction = actionFromState ?? actionFromReason;
      const actionSource = tt?.action ? 'state.thisTurn.action'
        : (lastSel.action ? 'state.motive.lastSelection.action'
          : (actionFromReason ? 'strategyDecision.reason' : 'none'));
      const commits = co.getStrategyCommitCount() - c0; const events = selectedEvents - e0;
      const output = String(b.response ?? '');
      const cell: Cell = {
        case_id: f.case_id, arm, user_input: f.user_input, assistant_output: output,
        motiveKind: tt?.kind as string | undefined, motiveAction, actionSource, strategy: strat,
        memoryId: tt?.memoryId as string | undefined,
        provenanceOwner: ((tt?.provenance ?? {}) as Record<string, unknown>).owner as string | undefined,
        provenanceSubject: ((tt?.provenance ?? {}) as Record<string, unknown>).subject as string | undefined,
        anchors: f.provenance.anchors,
        guardVerdict: b.provenanceVerdict as string | undefined,
        responseLength: output.length,
        commitCount: commits, strategySelectedCount: events,
        guardErrors: runtimeGuardErrors({ motiveAction, strategy: strat, commitCount: commits, strategySelectedCount: events }),
      };
      cells.push(cell);
      console.log('  [' + f.case_id + '/' + arm + '] kind=' + String(cell.motiveKind) + ' action=' + String(cell.motiveAction)
        + ' strategy=' + String(cell.strategy) + ' guard=' + String(cell.guardVerdict)
        + ' len=' + cell.responseLength + ' commit=' + commits + ' sel=' + events
        + (cell.guardErrors.length ? '  ⚠️ ' + cell.guardErrors.join('; ') : ''));
    }
  }
} finally {
  stub.close();
  rmSync(MEM, { recursive: true, force: true }); cpSync(BAK, MEM, { recursive: true }); rmSync(BAK, { recursive: true, force: true });
}

mkdirSync(ROOT + '/raw', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rawPath = ROOT + '/raw/negative-control.jsonl';
const exists = existsSync(rawPath);
writeFileSync(exists ? ROOT + '/raw/negative-control-' + stamp + '.jsonl' : rawPath, cells.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');

const invalid = cells.filter(c => c.guardErrors.length > 0);
const byCase = new Map<string, Cell[]>();
for (const c of cells) byCase.set(c.case_id, [...(byCase.get(c.case_id) ?? []), c]);
const pairsComplete = [...byCase.values()].filter(v => v.length === 2).length;

console.log('\n[装置结构检查]');
check(cells.length === useFixtures.length * 2, '格数 = 2 × fixture 数（' + (useFixtures.length * 2) + '）', cells.length);
check(pairsComplete === useFixtures.length, '每个 fixture 都有 A/B 两格', pairsComplete + '/' + useFixtures.length);
check(cells.every(c => c.responseLength > 0), '所有格都有回复（管道通）', cells.filter(c => c.responseLength === 0).map(c => c.case_id + '/' + c.arm));
check(invalid.length === 0, 'runtime 结构护栏全过（action=share ∧ strategy=share ∧ commit=1 ∧ sel=1）', invalid.slice(0, 3).map(c => c.case_id + '/' + c.arm + ': ' + c.guardErrors.join('; ')));
check(cells.every(c => c.provenanceOwner === 'user'), '每格 provenance.owner 均为 user（装置数据一致）', [...new Set(cells.map(c => c.provenanceOwner))]);
// 负对照的**定义**：同 fixture 两臂的输入与状态完全相同 ⇒ stub 文本相同、user_input 相同
check([...byCase.values()].every(v => v.length === 2 && v[0].user_input === v[1].user_input), '两臂 user_input 逐字相同（identical prompt 装置）');
check(JSON.stringify(V160_REGIME) === JSON.stringify({ ...V160_REGIME }), 'regime 已按冻结值加载');

writeFileSync(ROOT + '/analysis/negative-control-summary.json', JSON.stringify({
  phase: 'negative-control', limit: LIMIT, seed: SEED, stubPort,
  regime: { ENABLE_MOTIVE_ACTION_STRATEGY: process.env.ENABLE_MOTIVE_ACTION_STRATEGY, LAYA_STRATEGY: process.env.LAYA_STRATEGY },
  cells: cells.length, pairs: pairsComplete, fixtureInvalid: invalid.length,
  note: '两臂无任何机制差异（identical prompt）；本跑只测装置与量具，不构成机制效果结论。SIC 人工标注与 agreement/噪声地板随后进行。',
  perCell: cells.map(c => ({ case_id: c.case_id, arm: c.arm, strategy: c.strategy, action: c.motiveAction, guard: c.guardVerdict, len: c.responseLength })),
}, null, 2) + '\n', 'utf8');

console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) console.log('未通过：\n  - ' + fails.join('\n  - '));
console.log('raw: ' + (exists ? ROOT + '/raw/negative-control-' + stamp + '.jsonl（raw 永不覆盖）' : rawPath));
process.exit(fails.length === 0 ? 0 : 1);
