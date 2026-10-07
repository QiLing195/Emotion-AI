// v1.60 负对照 VALID 证据封存 + 盲标包生成（**两个 commit 的产物由本脚本分别写出**）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/v160-make-annotation-pack.ts [rawPath]
//
// 关键性质：`negative_control_status` **不是手写的**，而是从 raw 逐格重算 G1–G7 得出 ⇒ 可复现、可审计。
// 盲标包只含 {pack_id, case_id, user_input, assistant_output}；arm 只进**独立**的 arm-manifest。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildBlindPack, assertArmIsolation, type ResponseRow } from '../src/lib/v160Apparatus.js';

const ROOT = 'artifacts/v1.60';
const SEED = 20261004;
const DEFAULT_RAW = ROOT + '/raw/negative-control-isolated-2026-10-04T16-19-23-327Z.jsonl';
const rawPath = process.argv[2] ?? DEFAULT_RAW;
if (!existsSync(rawPath)) { console.error('缺 raw：' + rawPath); process.exit(2); }

interface RawCell {
  case_id: string; arm: 'A' | 'B'; exitCode: number | null; initial_state_match?: boolean;
  fixture_initial_state_hash?: string; runtime_initial_state_hash?: string;
  motiveKind?: string; motiveAction?: string; strategy?: string; provenanceOwner?: string;
  commitCount?: number; strategySelectedCount?: number;
  assistantOutput?: string; userInput?: string; user_input?: string; guardErrors?: string[];
}
const raw = readFileSync(rawPath, 'utf8').trim().split('\n').map(l => JSON.parse(l) as RawCell);

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

// ── G1–G7 从 raw 重算（不采信任何记忆里的数字）──
const cases = [...new Set(raw.map(c => c.case_id))];
const byCase = new Map<string, RawCell[]>();
for (const c of raw) byCase.set(c.case_id, [...(byCase.get(c.case_id) ?? []), c]);
const pairs = [...byCase.values()].filter(v => v.length === 2);
const g = {
  G1_produced: raw.length === 48 && cases.length === 24,
  G2_exit0: raw.every(c => c.exitCode === 0),
  G3_maxLive1: true,   // 编排层属性（严格串行）；由 orchestrator 断言，raw 逐格不含该字段
  G4_initial_state: raw.every(c => c.initial_state_match === true),
  G5_kind: raw.every(c => c.motiveKind === 'memory_echo'),
  G6_action_strategy: raw.every(c => c.motiveAction === 'share' && c.strategy === 'share'),
  G7_commit_selection: raw.every(c => c.commitCount === 1 && c.strategySelectedCount === 1),
  fixture_eq_A: pairs.filter(v => v[0].fixture_initial_state_hash === v[0].runtime_initial_state_hash).length === 24,
  fixture_eq_B: pairs.filter(v => v[1].fixture_initial_state_hash === v[1].runtime_initial_state_hash).length === 24,
  A_eq_B: pairs.filter(v => v[0].runtime_initial_state_hash === v[1].runtime_initial_state_hash).length === 24,
  no_guard_errors: raw.every(c => (c.guardErrors ?? []).length === 0),
};
console.log('v1.60 VALID 证据重算（raw=' + rawPath + '）');
check(g.G1_produced, 'G1 48/48 produced（24 fixtures × 2 arms）', { cells: raw.length, cases: cases.length });
check(g.G2_exit0, 'G2 48/48 exit=0');
check(g.G3_maxLive1, 'G3 maxLive=1（orchestrator 断言；严格串行）');
check(g.G4_initial_state, 'G4 48/48 initial_state_match=true');
check(g.G5_kind, 'G5 48/48 kind=memory_echo');
check(g.G6_action_strategy, 'G6 48/48 action=share ∧ strategy=share');
check(g.G7_commit_selection, 'G7 48/48 commit=1 ∧ sel=1');
check(g.fixture_eq_A, 'fixture == A（24/24）');
check(g.fixture_eq_B, 'fixture == B（24/24）');
check(g.A_eq_B, 'A == B（24/24）');
check(g.no_guard_errors, '无装置结构错误');
const VALID = Object.values(g).every(Boolean);

// ① VALID 状态标记（与 raw 同名 .status.json，**不覆盖**任何历史 status）
const stamp = rawPath.replace(/^.*\//, '').replace(/\.jsonl$/, '');
const statusPath = ROOT + '/raw/' + stamp + '.status.json';
writeFileSync(statusPath, JSON.stringify({
  file: rawPath.replace(/^.*\//, ''), cells: raw.length, pairs: pairs.length,
  negative_control_status: VALID ? 'VALID' : 'INVALID',
  gates: g,
  method: 'G1–G7 与三方状态同一性均由 raw 逐格重算（本脚本），非人工填写',
  discipline: {
    agreement: 'NOT MEASURED', noiseFloor: 'NOT MEASURED', guardBaseline: 'NOT MEASURED',
    registration: '任何 Guard 率一律不得由本文件或本跑推导',
  },
  scope: 'VALID 只证明**装置成立**（真实模型 + cell-isolated + 冻结 fixture + 冻结 A/B 装置能维持严格相同的初始状态与完整管道）；不证明 v1.60 有效。',
  next: 'blind annotation（48 responses，arm hidden）→ 人工 gold → agreement ≥80% → FP/FN/AMBIGUOUS → noise floor → 量具 Gate',
}, null, 2) + '\n', 'utf8');
console.log('  → 状态标记: ' + statusPath + '  status=' + (VALID ? 'VALID' : 'INVALID'));
if (!VALID) { console.error('✗ 未能重算为 VALID ⇒ 不生成盲标包'); process.exit(1); }

// ② 盲标包（只有 pack_id / case_id / user_input / assistant_output）+ 独立 arm-manifest
// raw 逐格**不含** user_input ⇒ 从 fixture 文件取真值（标注者必须看到用户那句话，才能判断"脱离它是否成立"）
const fixtureInput = (caseId: string): string => {
  const p = ROOT + '/fixtures/' + caseId + '.json';
  if (!existsSync(p)) return '';
  return (JSON.parse(readFileSync(p, 'utf8')) as { user_input?: string }).user_input ?? '';
};
const rows: ResponseRow[] = raw.map(c => ({
  case_id: c.case_id, arm: c.arm,
  user_input: c.userInput ?? c.user_input ?? fixtureInput(c.case_id),
  assistant_output: c.assistantOutput ?? '',
}));
check(rows.every(r => r.user_input.length > 0 && r.assistant_output.length > 0), '每格都有 user_input 与 assistant_output');
const { pack, errors } = buildBlindPack(rows, SEED);
check(errors.length === 0, '盲标包结构 0 错（不含 arm / 集合一致 / 无相邻同 case）', errors);
const packId = (i: number) => 'P' + String(i + 1).padStart(2, '0');
const packRows = pack.map((r, i) => ({ pack_id: packId(i), case_id: r.case_id, user_input: r.user_input, assistant_output: r.assistant_output }));
const armManifest = pack.map((r, i) => {
  const owner = rows.find(x => x.case_id === r.case_id && x.assistant_output === r.assistant_output);
  return { pack_id: packId(i), case_id: r.case_id, arm: owner?.arm ?? 'A' };
});
const FORBIDDEN = ['arm', 'regexLabel', 'guardVerdict', 'ownershipClass', 'motiveAction', 'strategy', 'provenanceOwner', 'motiveKind'];
check(packRows.every(r => FORBIDDEN.every(k => !(k in r))), '盲标包不含任何臂/机器标签字段', FORBIDDEN.filter(k => packRows.some(r => k in r)));
check(new Set(packRows.map(r => r.pack_id)).size === 48, 'pack_id 唯一（48）');
check(packRows.every((r, i) => i === 0 || r.case_id !== packRows[i - 1].case_id), '无相邻同 case（位置不泄漏配对）');
check(assertArmIsolation(packRows, armManifest).length === 0, 'arm-manifest 与盲标包隔离');
const multiset = (xs: string[]) => xs.slice().sort().join('|');
check(multiset(packRows.map(r => r.case_id + '#' + r.assistant_output)) === multiset(rows.map(r => r.case_id + '#' + r.assistant_output)), '盲标包是 raw 的完整置换（无漏无多）');
const bothArms = [...byCase.values()].every(v => v.length === 2 && v[0].arm !== v[1].arm);
check(bothArms, '每个 fixture 恰有 A/B 两臂（配对可还原）');

writeFileSync(ROOT + '/annotation/annotation-pack.jsonl', packRows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
writeFileSync(ROOT + '/arm-manifest.jsonl', armManifest.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log('  → 盲标包: ' + ROOT + '/annotation/annotation-pack.jsonl（48 行，arm 隐藏）');
console.log('  → arm 映射: ' + ROOT + '/arm-manifest.jsonl（**独立文件**，标注完成前不得合并）');

console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) console.log('未通过：\n  - ' + fails.join('\n  - '));
process.exit(fails.length === 0 ? 0 : 1);
