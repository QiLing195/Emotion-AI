// v1.60 量具 Gate 第 2 步：一致性（**两个口径分开报**，不混称同一个"一致率"）
//
// 只读：final-gold.jsonl（真值）+ regex-proxy.jsonl（代理尺子输出）。二者均**不修改**（运行前后比对哈希）。
// 按 pack_id **精确关联**，不依赖行序。
//
// 口径 A（46 条，确定性样本）：排除 gold 中 label=AMBIGUOUS 的 2 条 ⇒ Agreement46 = 一致数 / 46
// 口径 B（48 条，全样本严格）：2 条 AMBIGUOUS 因二值代理无法表达该标签，**均按不一致计入** ⇒ Agreement48 = 一致数 / 48
//
// FP/FN 只在 46 条口径内计算（gold 为真值）：
//   proxy=SELF & gold=NOT_SELF ⇒ FP（代理过度声称"她自己的内容"）
//   proxy=NOT_SELF & gold=SELF ⇒ FN（代理漏掉）
// 48 条口径额外报告 2 条 AMBIGUOUS 造成的不一致，**单独归类，不混入普通 FP/FN**。
//
// 阈值：既定 Gate 门槛 80%，**按两个口径分别报告是否达到，不在看见结果后调整**。
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'artifacts/v1.60';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY = ROOT + '/annotation/regex-proxy.jsonl';
const OUT_MD = ROOT + '/analysis/gate1-agreement.md';
const OUT_JSON = ROOT + '/analysis/gate1-agreement.json';
const THRESHOLD = 0.80;
const RULE = 'L3-A@scripts/audit-v159-expression.ts:10-19';

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mt = (p: string) => statSync(p).mtimeMs;
for (const p of [GOLD, PROXY]) if (!existsSync(p)) { console.error('缺文件：' + p); process.exit(2); }
const hGold = sha(GOLD), hProxy = sha(PROXY), mGold = mt(GOLD), mProxy = mt(PROXY);

interface GoldRow { pack_id: string; label: string; source: string; agent_initial: string; user: string; reason: string }
interface ProxyRow { pack_id: string; proxy_label: string; rule_id: string; hit: boolean; reason: string }
const gold = readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as GoldRow);
const proxy = readFileSync(PROXY, 'utf8').trim().split('\n').map(l => JSON.parse(l) as ProxyRow);

console.log('v1.60 Gate 第 2 步：一致性（两个口径）');
console.log('  代理规则: ' + RULE + '（二值：仅 SELF / NOT_SELF）\n');

// ── 关联与完整性 ──
const gIds = gold.map(g => g.pack_id), pIds = proxy.map(p => p.pack_id);
const mapP = new Map(proxy.map(p => [p.pack_id, p]));
check(gold.length === 48, 'gold 48 行', gold.length);
check(proxy.length === 48, 'proxy 48 行', proxy.length);
check(new Set(gIds).size === 48 && new Set(pIds).size === 48, '两份 pack_id 各自唯一');
check(gIds.slice().sort().join() === pIds.slice().sort().join(), 'pack_id 集合完全一致（按 id 关联，不用行序）');
check(gold.every(g => ['SELF', 'NOT_SELF', 'AMBIGUOUS'].includes(g.label)), 'gold 标签合法');
check(proxy.every(p => ['SELF', 'NOT_SELF'].includes(p.proxy_label)), 'proxy 标签合法（二值）');

const rows = gold.map(g => {
  const p = mapP.get(g.pack_id) as ProxyRow;
  return { pack_id: g.pack_id, gold: g.label, proxy: p.proxy_label, match: g.label === p.proxy_label, goldSource: g.source, goldReason: g.reason, proxyReason: p.reason, goldIsAmbiguous: g.label === 'AMBIGUOUS' };
});

// ── 口径 A：46 条（排除 gold=AMBIGUOUS）──
const rowsA = rows.filter(r => !r.goldIsAmbiguous);
const amb = rows.filter(r => r.goldIsAmbiguous);
const matchA = rowsA.filter(r => r.match).length;
const agree46 = matchA / rowsA.length;
// FP/FN（仅在口径 A 内，gold 为真值）
const fp = rowsA.filter(r => r.proxy === 'SELF' && r.gold === 'NOT_SELF');
const fn = rowsA.filter(r => r.proxy === 'NOT_SELF' && r.gold === 'SELF');

// ── 口径 B：48 条（AMBIGUOUS 计为不一致）──
const matchB = rows.filter(r => r.match).length;
const agree48 = matchB / rows.length;
const ambMismatch = amb.filter(r => !r.match);   // 二值代理永远不等于 AMBIGUOUS

console.log('[口径 A] 确定性样本（排除 ' + amb.length + ' 条 AMBIGUOUS）');
console.log('  分母 ' + rowsA.length + ' ｜ 分子 ' + matchA + ' ｜ **Agreement46 = ' + (agree46 * 100).toFixed(1) + '%** ｜ 门槛 80% ⇒ ' + (agree46 >= THRESHOLD ? '达到' : '未达到'));
console.log('  FP（proxy=SELF, gold=NOT_SELF）= ' + fp.length + ' ｜ FN（proxy=NOT_SELF, gold=SELF）= ' + fn.length);
console.log('[口径 B] 全样本严格（2 条 AMBIGUOUS 计为不一致）');
console.log('  分母 ' + rows.length + ' ｜ 分子 ' + matchB + ' ｜ **Agreement48 = ' + (agree48 * 100).toFixed(1) + '%** ｜ 门槛 80% ⇒ ' + (agree48 >= THRESHOLD ? '达到' : '未达到'));
console.log('  其中由"代理无法表达 AMBIGUOUS"造成的不一致 = ' + ambMismatch.length + '（单独归类，不混入 FP/FN）: ' + ambMismatch.map(r => r.pack_id + '（gold=' + r.gold + ' proxy=' + r.proxy + '）').join('、'));

check(rowsA.length === 46, '口径 A 分母 = 46', rowsA.length);
check(amb.length === 2, 'gold 中 AMBIGUOUS 恰 2 条', amb.map(r => r.pack_id));
check(matchA + fp.length + fn.length === rowsA.length, 'A 口径内 一致+FP+FN = 46（自洽）', matchA + fp.length + fn.length);
check(matchB === matchA, 'B 口径分子等于 A 口径分子（AMBIGUOUS 全不一致 ⇒ 分子不变）', { matchA, matchB });

// ── 明细 ──
const L: string[] = [];
L.push('# v1.60 量具 Gate 第 2 步：一致性（两个口径）');
L.push('');
L.push('- 真值：`' + GOLD + '`（' + hGold.slice(0, 12) + '）');
L.push('- 代理：`' + PROXY + '`（' + hProxy.slice(0, 12) + '），规则 `' + RULE + '`（**二值**）');
L.push('- 关联方式：按 `pack_id` 精确匹配，不依赖行序');
L.push('');
L.push('## 两个口径（**不可混称为同一个"一致率"**）');
L.push('');
L.push('| 口径 | 分母 | 分子 | 结果 | 80% 门槛 | 含义 |');
L.push('|---|---|---|---|---|---|');
L.push('| **A 确定性样本** | 46（排除 gold 的 2 条 AMBIGUOUS） | ' + matchA + ' | **' + (agree46 * 100).toFixed(1) + '%** | ' + (agree46 >= THRESHOLD ? '达到' : '**未达到**') + ' | 可直接比较样本上的一致性 |');
L.push('| **B 全样本严格** | 48（2 条 AMBIGUOUS 计为不一致） | ' + matchB + ' | **' + (agree48 * 100).toFixed(1) + '%** | ' + (agree48 >= THRESHOLD ? '达到' : '**未达到**') + ' | 含"二值代理无法表达 AMBIGUOUS"的代价 |');
L.push('');
L.push('**2 条 AMBIGUOUS 的处理**：口径 A 中**整条剔除**（不进分子也不进分母）；口径 B 中**计为不一致**（因代理结构上产不出 AMBIGUOUS）。');
L.push('它们造成的不一致单列为 `AMBIGUOUS_MISMATCH`，**不混入普通 FP/FN**：' + ambMismatch.map(r => r.pack_id).join('、'));
L.push('');
L.push('## 口径 A 的错误明细');
L.push('');
L.push('- **FP（proxy=SELF, gold=NOT_SELF）' + fp.length + ' 条**：' + (fp.map(r => r.pack_id).join(' ') || '—'));
L.push('- **FN（proxy=NOT_SELF, gold=SELF）' + fn.length + ' 条**：' + (fn.map(r => r.pack_id).join(' ') || '—'));
L.push('');
L.push('| pack_id | gold | proxy | 一致 | gold 来源 | gold 理由 |');
L.push('|---|---|---|---|---|---|');
for (const r of rows) L.push('| ' + r.pack_id + ' | ' + r.gold + ' | ' + r.proxy + ' | ' + (r.match ? '✓' : '✗') + ' | ' + r.goldSource + ' | ' + r.goldReason.replace(/\|/g, '｜').slice(0, 80) + ' |');
L.push('');
L.push('## 解释边界（务必随结果一起引用）');
L.push('');
L.push('- 两个口径都只衡量**代理尺子与 FINAL GOLD 的一致性**，**不等于真实准确率**，也不能证明 gold 无误。');
L.push('- 80% 是既定门槛，**按两个口径分别报告，未因看见结果而调整**。');
L.push('- 本步不启动正式 A/B，不据此作机制结论。');
writeFileSync(OUT_MD, L.join('\n') + '\n', 'utf8');
writeFileSync(OUT_JSON, JSON.stringify({
  rule: RULE, threshold: THRESHOLD,
  denominatorA: { n: rowsA.length, matches: matchA, agreement: Number(agree46.toFixed(4)), pass: agree46 >= THRESHOLD, fp: fp.map(r => r.pack_id), fn: fn.map(r => r.pack_id) },
  denominatorB: { n: rows.length, matches: matchB, agreement: Number(agree48.toFixed(4)), pass: agree48 >= THRESHOLD, ambiguousMismatch: ambMismatch.map(r => r.pack_id) },
  ambiguousHandling: { A: 'excluded from both numerator and denominator', B: 'counted as disagreement', notMixedIntoFPFN: true },
  inputs: { gold: hGold, proxy: hProxy },
  note: '只读输入；未计算 noise floor / guard baseline；未启动正式 A/B',
}, null, 2) + '\n', 'utf8');

// ── 输入未被改动 ──
check(sha(GOLD) === hGold && mt(GOLD) === mGold, 'final-gold.jsonl 运行前后未变（哈希+mtime）');
check(sha(PROXY) === hProxy && mt(PROXY) === mProxy, 'regex-proxy.jsonl 运行前后未变（哈希+mtime）');

console.log('  → ' + OUT_MD);
console.log('  → ' + OUT_JSON);
console.log('  （未计算 noise floor / guard 基线；未启动正式 A/B）');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
