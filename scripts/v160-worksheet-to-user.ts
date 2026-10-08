// v1.60 转写器：annotation-worksheet.md（人工填写）→ annotator-user.jsonl
//
// 为什么需要它：worksheet 是人读界面（`- humanLabel:` / `- note:` 两行），
// 而 disagreement / adjudication 工具吃的是 {pack_id, label, note} 的 JSONL。
// 本脚本**只做忠实转写**：不改任何标签、不改理由文字（空理由标为占位并计数上报）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = 'artifacts/v1.60/annotation';
const W = ROOT + '/annotation-worksheet.md';
const PACK = ROOT + '/annotation-pack.jsonl';
const OUT = ROOT + '/annotator-user.jsonl';
const PLACEHOLDER = '（用户未填理由）';

if (!existsSync(W)) { console.error('缺 worksheet：' + W); process.exit(2); }
const lines = readFileSync(W, 'utf8').split('\n');

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

interface Row { pack_id: string; label: string; note: string }
const rows: Row[] = [];
let cur: Row | null = null;
for (const raw of lines) {
  const line = raw.trim();
  const h = /^##\s+(P\d\d)/.exec(line);
  if (h) { if (cur) rows.push(cur); cur = { pack_id: h[1], label: '', note: '' }; continue; }
  if (!cur) continue;
  const l = /^-\s*humanLabel:\s*(\S+)\s*$/.exec(line);      // 必须整行是填写行（排除表头里的反引号示例）
  if (l) { cur.label = l[1]; continue; }
  const t = /^-\s*note:\s*(.*)$/.exec(line);
  if (t) { cur.note = t[1].trim(); continue; }
}
if (cur) rows.push(cur);

const labels = new Set(['SELF', 'NOT_SELF', 'AMBIGUOUS']);
const packIds = readFileSync(PACK, 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { pack_id: string }).pack_id);

console.log('v1.60 worksheet → annotator-user 转写');
check(rows.length === 48, '抽到 48 条', rows.length);
check(rows.every(r => labels.has(r.label)), '标签全部落在三态内', rows.filter(r => !labels.has(r.label)).map(r => r.pack_id + '=' + r.label));
check(new Set(rows.map(r => r.pack_id)).size === 48, 'pack_id 唯一', new Set(rows.map(r => r.pack_id)).size);
check(rows.map(r => r.pack_id).sort().join() === packIds.slice().sort().join(), 'pack 集与盲标包完全一致');
const empty = rows.filter(r => !r.note);
const filled = rows.map(r => r.note ? r : { ...r, note: PLACEHOLDER });
check(empty.length <= 3, '空理由数在可接受范围（≤3，标占位）', empty.map(r => r.pack_id));
check(filled.every(r => r.note.length >= 2), '每条理由 ≥2 字（含占位）');

writeFileSync(OUT, filled.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
const dist = filled.reduce((m, r) => { m[r.label] = (m[r.label] ?? 0) + 1; return m; }, {} as Record<string, number>);
console.log('  → ' + OUT);
console.log('  标签分布（**仅完整性核对，非实验结果**）: ' + JSON.stringify(dist));
console.log('  空理由被标占位: ' + empty.length + ' 条' + (empty.length ? '（' + empty.map(r => r.pack_id).join(' ') + '）' : ''));
console.log('  （本脚本不计算 agreement / FP / FN / noise floor / guard 基线）');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
