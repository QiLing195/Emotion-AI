// v1.60 双标注分歧对照器（**只做 disagreement，刻意不算准确率**）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/v160-disagreement.ts --a <annotator-agent.jsonl> --b <annotator-user.jsonl> [--out artifacts/v1.60/annotation/disagreement.md]
//
// 设计边界（冻结）：
//   · 只输出：逐条对照（两方标签 + 两方理由），不一致项置顶，边界项（AMBIGUOUS / 已知边界）标记
//   · **不计算** agreement 率 / FP / FN / noise floor / guard 基线 —— 那些要等 adjudication 之后
//   · 不读取、不解码 A/B（arm 不在任何标注文件里）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const get = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const A_PATH = get('--a', 'artifacts/v1.60/annotation/annotator-agent.jsonl');
const B_PATH = get('--b');
const OUT = get('--out', 'artifacts/v1.60/annotation/disagreement.md');
if (!B_PATH) { console.error('用法：--a <agent.jsonl> --b <user.jsonl>'); process.exit(2); }
for (const p of [A_PATH, B_PATH]) if (!existsSync(p)) { console.error('缺文件：' + p); process.exit(2); }

const LABELS = ['SELF', 'NOT_SELF', 'AMBIGUOUS'];
interface Row { pack_id: string; label: string; note?: string }
const load = (p: string, who: string): Row[] => {
  const rows = readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
  const bad: string[] = [];
  for (const r of rows) {
    if (!r.pack_id) bad.push('缺 pack_id');
    if (!LABELS.includes(r.label)) bad.push(`${r.pack_id}: 非法 label=${String(r.label)}`);
    if (!r.note || r.note.trim().length < 2) bad.push(`${r.pack_id}: 缺理由`);
  }
  if (rows.length !== 48) bad.push(`行数=${rows.length}（期望 48）`);
  const ids = new Set(rows.map(r => r.pack_id));
  if (ids.size !== rows.length) bad.push('pack_id 重复');
  if (bad.length) { console.error(`✗ ${who} 文件不合格：\n  - ` + bad.slice(0, 6).join('\n  - ')); process.exit(1); }
  return rows;
};
const a = load(A_PATH, 'A(agent)');
const b = load(B_PATH, 'B(user)');
const idsA = a.map(r => r.pack_id).sort().join(',');
const idsB = b.map(r => r.pack_id).sort().join(',');
if (idsA !== idsB) { console.error('✗ 两份 pack 集不一致'); process.exit(1); }

const mapB = new Map(b.map(r => [r.pack_id, r]));
const pairs = a.map(ra => ({ id: ra.pack_id, a: ra, b: mapB.get(ra.pack_id) as Row }));
const diff = pairs.filter(p => p.a.label !== p.b.label);
const same = pairs.filter(p => p.a.label === p.b.label);
const ambiguousInvolved = diff.filter(p => p.a.label === 'AMBIGUOUS' || p.b.label === 'AMBIGUOUS');
// 已知边界项（agent 初标时标出的低置信条目）——仅作提示，不参与任何计算
const KNOWN_BOUNDARY = ['P07', 'P09', 'P13', 'P20', 'P31', 'P23', 'P42', 'P47'];

const L: string[] = [];
L.push('# v1.60 双标注分歧对照（disagreement）');
L.push('');
L.push('- A(agent 第二标注者): `' + A_PATH + '`');
L.push('- B(人工标注者):       `' + B_PATH + '`');
L.push('- 共 ' + pairs.length + ' 条 ｜ 标签一致 ' + same.length + ' 条 ｜ **不一致 ' + diff.length + ' 条**');
L.push('');
L.push('> **刻意不计算**：agreement 率 / FP / FN / noise floor / guard 基线。那些必须等 adjudication 产出 FINAL GOLD 之后。');
L.push('> 本表只把分歧逐条摊开（含双方理由），供裁决使用。');
L.push('');
if (diff.length) {
  L.push('## 一、分歧项（' + diff.length + ' 条，需裁决）');
  L.push('');
  for (const p of diff) {
    L.push('### ' + p.id + (KNOWN_BOUNDARY.includes(p.id) ? '　⚠️ 已知边界项' : '') + (p.a.label === 'AMBIGUOUS' || p.b.label === 'AMBIGUOUS' ? '　（含 AMBIGUOUS）' : ''));
    L.push('');
    L.push('| 标注者 | 标签 | 理由 |');
    L.push('|---|---|---|');
    L.push('| A (agent) | **' + p.a.label + '** | ' + (p.a.note ?? '') + ' |');
    L.push('| B (user) | **' + p.b.label + '** | ' + (p.b.note ?? '') + ' |');
    L.push('');
  }
} else {
  L.push('## 一、分歧项');
  L.push('');
  L.push('无（两份标注完全一致）—— 此时仍需人工确认是否属于"同一判断者效应"（例如 B 参考了 A），否则一致率没有独立性含义。');
  L.push('');
}
L.push('## 二、一致项（' + same.length + ' 条，供核对）');
L.push('');
L.push('| pack | 标签 | A 理由 |');
L.push('|---|---|---|');
for (const p of same) L.push('| ' + p.id + ' | ' + p.a.label + ' | ' + (p.a.note ?? '') + ' |');
L.push('');
L.push('## 三、边界项汇总（不参与任何计算，仅提示裁决优先级）');
L.push('');
L.push('| pack | A | B | 是否分歧 |');
L.push('|---|---|---|---|');
for (const id of KNOWN_BOUNDARY) {
  const p = pairs.find(x => x.id === id);
  if (!p) continue;
  L.push('| ' + id + ' | ' + p.a.label + ' | ' + p.b.label + ' | ' + (p.a.label === p.b.label ? '否' : '**是**') + ' |');
}
L.push('');
L.push('## 四、下一步（本轮不做）');
L.push('');
L.push('1. 逐条裁决分歧 → `adjudicated.jsonl`（保留 `agent_initial` / `user` / `adjudicated` 三段，含各自理由）');
L.push('2. FINAL GOLD 就位后，才计算 agreement（人工 gold vs 正则代理）≥ 80%');
L.push('3. 再查 FP / FN / AMBIGUOUS，然后 noise floor，最后量具 Gate');

writeFileSync(OUT, L.join('\n') + '\n', 'utf8');
console.log('v1.60 disagreement');
console.log('  pairs=' + pairs.length + ' same=' + same.length + ' diff=' + diff.length + ' (含 AMBIGUOUS 的分歧=' + ambiguousInvolved.length + ')');
console.log('  分歧项: ' + (diff.map(p => p.id + '(' + p.a.label + ' vs ' + p.b.label + ')').join(' ') || '无'));
console.log('  → ' + OUT);
console.log('  （刻意未计算 agreement / FP / FN / noise floor / guard 基线）');
process.exit(0);
