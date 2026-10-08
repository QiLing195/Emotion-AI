// v1.60 裁决 + FINAL GOLD 生成/校验（**只做裁决与 gold 组装，不算任何量具统计**）
//
// 两种用法：
//   ① 生成裁决表（给人填）：
//      node node_modules/tsx/dist/cli.mjs scripts/v160-adjudicate.ts --a <agent.jsonl> --u <user.jsonl>
//        → 产出 adjudication-sheet.md：仅列**分歧项**，每条附双方标签+理由，以及待填的 adjudicated / reason
//   ② 合并裁决 → FINAL GOLD：
//      node node_modules/tsx/dist/cli.mjs scripts/v160-adjudicate.ts --a <agent.jsonl> --u <user.jsonl> --adj <adjudicated.jsonl> --write
//        → 校验 adjudicated 覆盖所有分歧项且标签合法 → 写 final-gold.jsonl（保留三段来源与理由）
//
// 冻结边界：**不计算** agreement / FP / FN / noise floor / guard 基线；不读取/解码 A/B。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const get = (k: string, d = '') => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const A_PATH = get('--a', 'artifacts/v1.60/annotation/annotator-agent.jsonl');
const U_PATH = get('--u', 'artifacts/v1.60/annotation/annotator-user.jsonl');
const ADJ_PATH = get('--adj');
const WRITE = argv.includes('--write');
const OUT_SHEET = get('--out', 'artifacts/v1.60/annotation/adjudication-sheet.md');
const OUT_GOLD = get('--gold', 'artifacts/v1.60/annotation/final-gold.jsonl');
const LABELS = ['SELF', 'NOT_SELF', 'AMBIGUOUS'];

interface Row { pack_id: string; label: string; note?: string }
function load(p: string, who: string, requireNote = true): Row[] {
  if (!existsSync(p)) { console.error('缺文件：' + p); process.exit(2); }
  const rows = readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l) as Row);
  const bad: string[] = [];
  if (rows.length !== 48) bad.push('行数=' + rows.length + '（期望 48）');
  if (new Set(rows.map(r => r.pack_id)).size !== rows.length) bad.push('pack_id 重复');
  for (const r of rows) {
    if (!LABELS.includes(r.label)) bad.push((r.pack_id ?? '?') + ': 非法 label=' + String(r.label));
    if (requireNote && (!r.note || r.note.trim().length < 2)) bad.push((r.pack_id ?? '?') + ': 缺理由');
  }
  if (bad.length) { console.error('✗ ' + who + ' 不合格：\n  - ' + bad.slice(0, 6).join('\n  - ')); process.exit(1); }
  return rows;
}

const a = load(A_PATH, 'A(agent)');
const u = load(U_PATH, 'B(user)');
if (a.map(r => r.pack_id).sort().join() !== u.map(r => r.pack_id).sort().join()) { console.error('✗ 两份 pack 集不一致'); process.exit(1); }
const mapA = new Map(a.map(r => [r.pack_id, r]));
const mapU = new Map(u.map(r => [r.pack_id, r]));
const ids = a.map(r => r.pack_id);
const diff = ids.filter(id => (mapA.get(id) as Row).label !== (mapU.get(id) as Row).label);

// ① 裁决表
const L: string[] = [];
L.push('# v1.60 裁决表（adjudication）');
L.push('');
L.push('- A(agent): `' + A_PATH + '`');
L.push('- B(user):  `' + U_PATH + '`');
L.push('- 共 48 条 ｜ **分歧 ' + diff.length + ' 条**（一致 ' + (48 - diff.length) + ' 条无需裁决）');
L.push('');
L.push('> 填写方式：在每条下面的 `adjudicated:` 后写 `SELF` / `NOT_SELF` / `AMBIGUOUS`，`reason:` 写裁决理由。');
L.push('> 本表**只列分歧项**；一致项直接沿用（gold 里记为 `source=agreement`）。');
L.push('> **本步骤不计算任何量具统计**（agreement / FP / FN / noise floor / guard 基线 一律未计算）。');
L.push('');
for (const id of diff) {
  const ra = mapA.get(id) as Row; const ru = mapU.get(id) as Row;
  L.push('## ' + id);
  L.push('');
  L.push('| 标注者 | 标签 | 理由 |');
  L.push('|---|---|---|');
  L.push('| A (agent) | **' + ra.label + '** | ' + (ra.note ?? '') + ' |');
  L.push('| B (user) | **' + ru.label + '** | ' + (ru.note ?? '') + ' |');
  L.push('');
  L.push('- adjudicated: ');
  L.push('- reason: ');
  L.push('');
}
writeFileSync(OUT_SHEET, L.join('\n') + '\n', 'utf8');
console.log('v1.60 adjudication');
console.log('  pairs=48 分歧=' + diff.length + ' 一致=' + (48 - diff.length));
console.log('  分歧项: ' + (diff.join(' ') || '（无）'));
console.log('  → 裁决表: ' + OUT_SHEET);

// ② 合并 → FINAL GOLD
if (ADJ_PATH) {
  const adj = load(ADJ_PATH, 'adjudicated', false);
  const missing = diff.filter(id => !adj.some(r => r.pack_id === id));
  if (missing.length) { console.error('✗ adjudicated 未覆盖分歧项：' + missing.join(' ')); process.exit(1); }
  const mapAdj = new Map(adj.map(r => [r.pack_id, r]));
  const gold = ids.map(id => {
    const ra = mapA.get(id) as Row; const ru = mapU.get(id) as Row;
    if (ra.label === ru.label) return { pack_id: id, label: ra.label, source: 'agreement', agent_initial: ra.label, user: ru.label, reason: ra.note ?? '' };
    const j = mapAdj.get(id) as Row;
    return { pack_id: id, label: j.label, source: 'adjudicated', agent_initial: ra.label, user: ru.label, reason: j.note ?? '' };
  });
  const badGold = gold.filter(g => !LABELS.includes(g.label));
  if (badGold.length) { console.error('✗ gold 含非法标签：' + badGold.map(g => g.pack_id).join(' ')); process.exit(1); }
  if (gold.length !== 48) { console.error('✗ gold 行数=' + gold.length); process.exit(1); }
  if (WRITE) {
    writeFileSync(OUT_GOLD, gold.map(g => JSON.stringify(g)).join('\n') + '\n', 'utf8');
    console.log('  → FINAL GOLD: ' + OUT_GOLD + '（48 行；字段 pack_id/label/source/agent_initial/user/reason）');
    console.log('    source 分布: agreement=' + gold.filter(g => g.source === 'agreement').length + ' adjudicated=' + gold.filter(g => g.source === 'adjudicated').length);
  } else {
    console.log('  （--write 未给：仅校验通过，未写 gold）  校验: 48 行、分歧全覆盖、标签合法 ✓');
  }
}
console.log('  （刻意未计算 agreement / FP / FN / noise floor / guard 基线）');
process.exit(0);
