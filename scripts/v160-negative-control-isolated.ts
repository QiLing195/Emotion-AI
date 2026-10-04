// v1.60 负对照编排 v2（修正③ 隔离 + 修正④ 状态同一性 + 修正⑤ 可达性分类）
//
// 严格串行：一格一进程（cell-runner），上一格 exitCode 核验后才起下一格。
// 两种模式：
//   --reach-only  只跑 A 臂，检查 24 个 fixture 的**运行时可达性**（kind/action/strategy/provenance）——便宜，先做
//   （默认）      跑 A/B 两臂 48 格，先验三方状态同一性 + identity + 生命周期，全过才算装置有效
//
// ⚠️ 本脚本**不计算** agreement / noise floor / guard baseline。装置封条前那些数字一律不得产出。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { classifyCellInvalidity, V160_REGIME, type V160Fixture } from '../src/lib/v160Apparatus.js';

const argv = process.argv.slice(2);
const argVal = (k: string, d: number) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d; };
const LIMIT = argVal('--limit', 24);
const REAL = argv.includes('--real');
const REACH_ONLY = argv.includes('--reach-only');

const ROOT = 'artifacts/v1.60';
const TSX = 'node_modules/tsx/dist/cli.mjs';
const TMP = '.tmp-v160-cells';
const ARMS: Array<'A' | 'B'> = REACH_ONLY ? ['A'] : ['A', 'B'];

const fixtures: V160Fixture[] = [];
for (let i = 1; i <= 24; i++) {
  const p = ROOT + '/fixtures/F' + String(i).padStart(2, '0') + '.json';
  if (!existsSync(p)) { console.error('缺 fixture：' + p); process.exit(2); }
  fixtures.push(JSON.parse(readFileSync(p, 'utf8')) as V160Fixture);
}
const use = fixtures.slice(0, LIMIT);

interface Cell {
  case_id: string; arm: 'A' | 'B'; pid?: number; exitCode: number | null; timedOut?: boolean;
  initial_state_source?: string; initial_state_hash?: string; fixture_initial_state_hash?: string;
  initial_state_match?: boolean; mood_cleared?: boolean;
  motiveKind?: string; motiveAction?: string; strategy?: string; provenanceOwner?: string;
  guardVerdict?: string; assistantOutput?: string; responseLength?: number;
  commitCount?: number; strategySelectedCount?: number; guardErrors: string[]; validity?: string; validityReason?: string;
}

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
mkdirSync(ROOT + '/raw', { recursive: true }); mkdirSync(ROOT + '/analysis', { recursive: true });

function runCell(caseId: string, arm: 'A' | 'B', index: number): Promise<Cell> {
  return new Promise((resolve) => {
    const outPath = TMP + '/' + caseId + '-' + arm + '.json';
    const port = 34850 + index;
    const args = [TSX, 'scripts/v160-cell-runner.ts', '--case', caseId, '--arm', arm, '--port', String(port), '--out', outPath];
    if (REAL) args.push('--real');
    const child = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true });
    const pid = child.pid;
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ case_id: caseId, arm, pid, exitCode: null, timedOut: true, guardErrors: ['cell timeout > 240s'] });
    }, 240_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!existsSync(outPath)) { resolve({ case_id: caseId, arm, pid, exitCode: code ?? null, guardErrors: ['no result file'] }); return; }
      try {
        const j = JSON.parse(readFileSync(outPath, 'utf8')) as Cell;
        j.exitCode = code ?? null; j.pid = pid; j.guardErrors = j.guardErrors ?? [];
        resolve(j);
      } catch { resolve({ case_id: caseId, arm, pid, exitCode: code ?? null, guardErrors: ['result parse error'] }); }
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ case_id: caseId, arm, pid, exitCode: null, guardErrors: ['spawn error: ' + String(e.message)] }); });
  });
}

const cells: Cell[] = [];
let live = 0; let maxLive = 0;
console.log('v1.60 负对照 v2 ｜' + (REACH_ONLY ? '**reachability-only**（A 臂）' : 'A/B 两臂') + ' ｜fixture=' + use.length + ' 格=' + use.length * ARMS.length + ' ｜real=' + REAL);
console.log('regime: ENABLE_MOTIVE_ACTION_STRATEGY=' + V160_REGIME.ENABLE_MOTIVE_ACTION_STRATEGY
  + ' ｜ DISABLE_STATE_MOTIVE=' + V160_REGIME.DISABLE_STATE_MOTIVE + ' ｜ LAYA_STRATEGY=' + V160_REGIME.LAYA_STRATEGY + '\n');

let idx = 0;
for (const f of use) {
  for (const arm of ARMS) {
    live += 1; maxLive = Math.max(maxLive, live);
    const c = await runCell(f.case_id, arm, idx++);
    live -= 1; cells.push(c);
    console.log('  [' + c.case_id + '/' + c.arm + '] exit=' + String(c.exitCode) + ' state=' + String(c.initial_state_match)
      + ' kind=' + String(c.motiveKind) + ' action=' + String(c.motiveAction) + ' strategy=' + String(c.strategy)
      + ' own=' + String(c.provenanceOwner) + ' guard=' + String(c.guardVerdict) + ' len=' + String(c.responseLength)
      + ' commit=' + String(c.commitCount) + ' sel=' + String(c.strategySelectedCount)
      + (c.validity && c.validity !== 'valid' ? '  ⚠️ ' + c.validity : ''));
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const mode = REACH_ONLY ? 'reachability' : 'negative-control-isolated';
const rawPath = ROOT + '/raw/' + mode + '-' + stamp + '.jsonl';
writeFileSync(rawPath, cells.map(c => JSON.stringify(c)).join('\n') + '\n', 'utf8');
rmSync(TMP, { recursive: true, force: true });

const byCase = new Map<string, Cell[]>();
for (const c of cells) byCase.set(c.case_id, [...(byCase.get(c.case_id) ?? []), c]);
const complete = [...byCase.values()].filter(v => v.length === ARMS.length).length;
const classify = (c: Cell) => c.exitCode !== 0 || c.guardErrors.length > 0
  ? classifyCellInvalidity({ motiveKind: c.motiveKind, strategy: c.strategy, provenanceOwner: c.provenanceOwner, guardErrors: c.guardErrors })
  : { valid: true, kind: 'valid' as const, reason: '' };
const verdicts = cells.map(c => ({ c, v: classify(c) }));
const runtimeUnreachable = verdicts.filter(x => x.v.kind === 'runtime_unreachable').map(x => x.c.case_id + '/' + x.c.arm);
const structural = verdicts.filter(x => x.v.kind === 'structural').map(x => x.c.case_id + '/' + x.c.arm + ': ' + x.v.reason);

console.log('\n[装置结构检查]');
check(cells.length === use.length * ARMS.length, '格数 = fixture 数 × 臂数', cells.length);
check(complete === use.length, '每 fixture 都齐（' + ARMS.length + ' 格）', complete + '/' + use.length);
check(cells.every(c => c.exitCode === 0), '每格子进程 exit=0（生命周期已切断）', cells.filter(c => c.exitCode !== 0).map(c => c.case_id + '/' + c.arm));
check(maxLive === 1, '任一时刻只有一个 cell 进程存活（严格串行）', maxLive);

// 修正④：初始状态同一性 —— 三方相等
check(cells.every(c => c.initial_state_match === true), '每格：磁盘初始状态哈希 == fixture 期望哈希', cells.filter(c => c.initial_state_match !== true).map(c => c.case_id + '/' + c.arm));
if (!REACH_ONLY) {
  const pairOk = [...byCase.values()].filter(v => v.length === 2 && v[0].initial_state_hash === v[1].initial_state_hash && v[0].initial_state_match && v[1].initial_state_match).length;
  check(pairOk === use.length, '**A/B 初始 emotion state 三方相等**（fixture == A == B）', pairOk + '/' + use.length);
} else {
  console.log('  · （reach-only：跳过 A/B 状态同一性断言）');
}
check(runtimeUnreachable.length === 0, '24/24 fixture **运行时可达**（kind=memory_echo ∧ action=share ∧ strategy=share ∧ 有 provenance）', runtimeUnreachable);
check(structural.length === 0, '无结构错误（commit/sel/异常）', structural.slice(0, 3));
check(cells.every(c => (c.responseLength ?? 0) > 0), '所有格都有回复');

writeFileSync(ROOT + '/analysis/' + mode + '-summary.json', JSON.stringify({
  phase: mode, isolated: true, real: REAL, limit: LIMIT, cells: cells.length,
  pairs: complete, runtimeUnreachable, structural, rawFile: rawPath,
  initialStateAllMatch: cells.every(c => c.initial_state_match === true),
  guardBaselineStatus: 'NOT_MEASURED —— 装置封条（④⑤ + 全量回归）前，guard 计数不得用于任何基线',
  note: '本脚本不产出 agreement / noise floor / guard baseline。',
}, null, 2) + '\n', 'utf8');

console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) console.log('未通过：\n  - ' + fails.join('\n  - '));
console.log('raw: ' + rawPath);
process.exit(fails.length === 0 ? 0 : 1);
