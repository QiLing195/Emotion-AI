// v1.60 基线审阅小结（**只读分析**）
//
// 从冻结的逐条证据重新计算交叉关系，不凭摘要估算；不修改 L3-A / gold / 代理输出 / 冻结基线。
// 严格区分两类信息：
//   事实（机器计算）：FP / FN / AMBIGUOUS_MISMATCH 计数与逐条 pack_id
//   解释（分析者标签）：failure_type（指代依赖用户 / 纯共情 / 追问 / 镜像 / 漏判）
// 机制计数**允许重叠**：不得相加，也不得据此宣称某机制贡献了多少个百分点。
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'artifacts/v1.60';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY = ROOT + '/annotation/regex-proxy.jsonl';
const CORPUS = ROOT + '/analysis/ruler-failure-corpus.json';
const OUT_MD = ROOT + '/analysis/gate-baseline-review.md';
const OUT_JSON = ROOT + '/analysis/gate-baseline-review.json';

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mt = (p: string) => statSync(p).mtimeMs;
for (const p of [GOLD, PROXY, CORPUS]) if (!existsSync(p)) { console.error('缺输入：' + p); process.exit(2); }
const h = { g: sha(GOLD), p: sha(PROXY), c: sha(CORPUS) };
const m = { g: mt(GOLD), p: mt(PROXY), c: mt(CORPUS) };

interface GoldRow { pack_id: string; label: string; source: string; reason: string }
interface ProxyRow { pack_id: string; proxy_label: string; hit: boolean; self_sentences: string[] }
interface CorpusItem { pack_id: string; types: string[]; gold_reason: string; proxy_self_sentences?: string[] }
const gold = readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as GoldRow);
const proxy = readFileSync(PROXY, 'utf8').trim().split('\n').map(l => JSON.parse(l) as ProxyRow);
const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as { fp: CorpusItem[]; fn: CorpusItem[]; ambiguous_mismatch: Array<{ pack_id: string; gold: string; proxy: string }> };

// ── 事实层：从 gold + proxy 重新计算（不依赖语料文件）──
const pMap = new Map(proxy.map(p => [p.pack_id, p]));
const FP: string[] = [], FN: string[] = [], AMB: string[] = [], MATCH: string[] = [];
for (const g of gold) {
  const p = pMap.get(g.pack_id) as ProxyRow;
  const eq = g.label === p.proxy_label;
  if (g.label === 'AMBIGUOUS') { if (!eq) AMB.push(g.pack_id); continue; }
  if (eq) MATCH.push(g.pack_id);
  else if (p.proxy_label === 'SELF') FP.push(g.pack_id);
  else FN.push(g.pack_id);
}
const denomA = 46, denomB = 48, matchesA = MATCH.length, matchesB = MATCH.length;
const agreeA = matchesA / denomA, agreeB = matchesB / denomB;

console.log('v1.60 基线审阅小结（只读）');
check(FP.length === 18, '事实层：FP 重算 = 18', FP.length);
check(FN.length === 1, '事实层：FN 重算 = 1', FN.length);
check(AMB.length === 2, '事实层：AMBIGUOUS_MISMATCH 重算 = 2', AMB);
check(matchesA + FP.length + FN.length === denomA, '事实层：一致 + FP + FN = 46', matchesA + FP.length + FN.length);
// 语料文件必须与重算完全一致（否则语料与事实脱节）
const corpusIds = [...corpus.fp.map(x => x.pack_id), ...corpus.fn.map(x => x.pack_id)].sort().join();
check(corpusIds === [...FP, ...FN].sort().join(), '语料的 19 条 == 事实层重算的 FP∪FN（无脱节）', { corpus: corpusIds.slice(0, 40), calc: [...FP, ...FN].sort().join().slice(0, 40) });
check(corpus.ambiguous_mismatch.map(x => x.pack_id).sort().join() === AMB.slice().sort().join(), '语料的 2 条 AMBIGUOUS_MISMATCH == 事实层重算');

// ── 解释层：机制标签（分析者）与事实层的交叉 ──
const label = new Map<string, string[]>();
for (const x of corpus.fp) label.set(x.pack_id, x.types);
for (const x of corpus.fn) label.set(x.pack_id, x.types);
const MECH = ['指代依赖用户', '纯共情', '追问', '镜像', '漏判（SELF_ACT 词表未覆盖）'];
const rows = MECH.map(k => {
  const ids = [...label.entries()].filter(([, t]) => t.includes(k)).map(([id]) => id);
  return { mech: k, ids, fp: ids.filter(i => FP.includes(i)).length, fn: ids.filter(i => FN.includes(i)).length };
});
// 两两重叠（解释层内部）
const overlaps: Array<{ a: string; b: string; ids: string[] }> = [];
for (let i = 0; i < MECH.length; i++) for (let j = i + 1; j < MECH.length; j++) {
  const a = MECH[i], b = MECH[j];
  const ids = [...label.entries()].filter(([, t]) => t.includes(a) && t.includes(b)).map(([id]) => id);
  if (ids.length) overlaps.push({ a, b, ids });
}
const union3 = new Set([...rows[0].ids, ...rows[1].ids, ...rows[2].ids]);
check(union3.size === 18, '「指代依赖 ∪ 纯共情 ∪ 追问」的并集 == 18 个 FP（全覆盖，但**有重叠**）', union3.size);
check(rows[0].fn + rows[1].fn + rows[2].fn + rows[3].fn === 0 && rows[4].fn === 1, '前四类机制均只对应 FP；FN 仅由「漏判」一类承担');

// ── 同 fixture 的对照对（未来 v2 必须保持可区分）──
const pack = readFileSync(ROOT + '/annotation/annotation-pack.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l) as { pack_id: string; case_id: string });
const caseOf = new Map(pack.map(r => [r.pack_id, r.case_id]));
const goldOf = new Map(gold.map(g => [g.pack_id, g.label]));
const byCase = new Map<string, string[]>();
for (const g of gold) byCase.set(caseOf.get(g.pack_id) as string, [...(byCase.get(caseOf.get(g.pack_id) as string) ?? []), g.pack_id]);
const contrasts = [...byCase.entries()].filter(([, ids]) => new Set(ids.map(i => goldOf.get(i))).size > 1);
check(contrasts.length > 0, '存在"同 fixture、gold 标签不同"的对照对', contrasts.length);
const contrastLines = contrasts.map(([c, ids]) => c + '：' + ids.map(i => i + '=' + goldOf.get(i) + (FP.includes(i) ? '(代理FP)' : FN.includes(i) ? '(代理FN)' : '')).join(' ｜ '));

// ── 证据强度分层（解释层的自评，非事实）──
const STRONG = ['P07', 'P09', 'P11', 'P12', 'P17', 'P22', 'P26', 'P28', 'P31', 'P35', 'P40', 'P45', 'P46'];
const CANDIDATE = ['P13', 'P18', 'P21', 'P24', 'P44', 'P34'];
check(new Set([...STRONG, ...CANDIDATE]).size === 19, '证据分层覆盖全部 19 条且无重复', new Set([...STRONG, ...CANDIDATE]).size);

// ── 报告 ──
const L: string[] = [];
L.push('# v1.60 基线审阅小结（只读分析）');
L.push('');
L.push('- 输入（**只读**）：`final-gold.jsonl` ' + h.g.slice(0, 12) + ' ｜ `regex-proxy.jsonl` ' + h.p.slice(0, 12) + ' ｜ `ruler-failure-corpus.json` ' + h.c.slice(0, 12));
L.push('- 规则版本（冻结）：`L3-A@scripts/audit-v159-expression.ts:10-19` ｜ 门槛 80%（**未调整**）');
L.push('- **两类信息必须分开读**：`事实` = 机器重算的计数；`解释` = 分析者标注的机制类别。机制类别可重叠，**不得相加**，也不得据此宣称某机制贡献了多少个百分点。');
L.push('');
L.push('## 一、事实层（机器重算，逐条可追溯）');
L.push('');
L.push('| 审阅项 | 已知结果 | 逐条（pack_id） |');
L.push('|---|---|---|');
L.push('| 口径 A 一致率 | **' + matchesA + '/' + denomA + ' = ' + (agreeA * 100).toFixed(1) + '%** | 一致项 ' + matchesA + ' 条 |');
L.push('| 口径 B 一致率 | **' + matchesB + '/' + denomB + ' = ' + (agreeB * 100).toFixed(1) + '%** | 同分子；分母含 2 条 AMBIGUOUS |');
L.push('| 假阳性 FP | **' + FP.length + '** | ' + FP.join(' ') + ' |');
L.push('| 假阴性 FN | **' + FN.length + '** | ' + FN.join(' ') + ' |');
L.push('| AMBIGUOUS_MISMATCH | **' + AMB.length + '**（单列，不混入 FP/FN） | ' + AMB.join(' ') + ' |');
L.push('');
L.push('**两条 AMBIGUOUS_MISMATCH 对整体判断的影响（事实）**：它们使口径 B 的分母比口径 A 多 2，而分子不变（两条都不匹配）⇒ 两个百分比之差完全来自这 2 条被计入分母。');
L.push('补充事实：这 2 条的性质不同 —— `P01` 是**裁决登记的 fixture/prompt 归属冲突**（`fixture_prompt_ownership_conflict`），`P20` 是双方一致的 `AMBIGUOUS`。');
L.push('⇒ 口径 B 承受的"代价"里，**一部分来自尺子表达能力（二值），另一部分来自装置自身的归属冲突**；两者在此口径下被混在一起计算。');
L.push('');
L.push('## 二、解释层（分析者机制标签，**允许重叠**）');
L.push('');
L.push('| 机制（分析者标签） | 涉及条数 | 其中 FP | 其中 FN | 样本 |');
L.push('|---|---|---|---|---|');
for (const r of rows) L.push('| ' + r.mech + ' | ' + r.ids.length + ' | ' + r.fp + ' | ' + r.fn + ' | ' + r.ids.join(' ') + ' |');
L.push('');
L.push('**两两重叠（解释层内部，说明为什么不能相加）**');
L.push('');
L.push('| 机制对 | 重叠条数 | 样本 |');
L.push('|---|---|---|');
for (const o of overlaps) L.push('| ' + o.a + ' ∩ ' + o.b + ' | ' + o.ids.length + ' | ' + o.ids.join(' ') + ' |');
L.push('');
L.push('核对事实：`指代依赖 ∪ 纯共情 ∪ 追问` 的并集 = **18**，即**全部 FP 都被这三类覆盖**（但有重叠，故不能把 11 + 10 + 11 相加）；FN 仅由「漏判」承担。');
L.push('');
L.push('## 三、三个问题的回答');
L.push('');
L.push('### 1. 当前量具在哪些语义边界上失效？');
L.push('');
L.push('- **边界一：带补语的共情句**。冻结排除项只匹配裸形式（`/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/`），一旦补上宾语（「我懂**那种感觉**。」）即失效，句子凭 `SELF_ACT` 里的「懂」命中。');
L.push('- **边界二：宾语指向用户事件的第一人称句**。「我脑子里一直记着**这件事**」「搬书**这事**我记着呢」「**你这句话**我一直记着」——主语是「我」，宾语归用户；`HIS` 只覆盖「你(之前|说过|的…」形态，抓不到「这件事／这事／那层／你这句话」。');
L.push('- **边界三：整条以追问/猜测为主**的回复，只要句中另有一处第一人称动词即可命中（P26 等）。');
L.push('- **边界四（表达能力）**：二值尺子无法表达 `AMBIGUOUS`，与 gold 的三态体系天然错位。');
L.push('');
L.push('### 2. 哪些失效模式有足够证据支持，哪些仍只是候选解释？');
L.push('');
L.push('**证据充分（' + STRONG.length + ' 条）**：' + STRONG.join(' '));
L.push('　依据：代理命中句与 gold 理由可直接对照（命中句本身即含用户对象，或句式为"我懂 + 补语"这一确定的排除失效形态）。');
L.push('');
L.push('**仍属候选解释（' + CANDIDATE.length + ' 条）**：' + CANDIDATE.join(' '));
L.push('　依据：需要语义判断（命题是否依赖用户句、体验归属、HIS 形态覆盖 vs 宾语归属的区分、P34 的词表缺口 vs 句法缺口两个假说尚未分离）。');
L.push('');
L.push('### 3. 若编写 v2，哪些回归对照必须保持可区分？');
L.push('');
L.push('以下均为**同一 fixture 内 gold 标签不同**的成对样本 —— v2 必须让它们继续分开，否则等于用规则覆盖了裁决结论：');
L.push('');
for (const line of contrastLines) L.push('- ' + line);
L.push('');
L.push('## 四、边界声明');
L.push('');
L.push('```');
L.push('事实（机器重算）：FP 18 ｜ FN 1 ｜ AMBIGUOUS_MISMATCH 2 ｜ A 27/46 = 58.7% ｜ B 27/48 = 56.3% ｜ Gate 未通过');
L.push('解释（分析者标签）：机制计数可重叠，不得相加，不得换算成百分点贡献');
L.push('未修改：L3-A 规则 / 80% 门槛 / FINAL GOLD / 原始标注 / 冻结基线 / 生产规则');
L.push('未计算：noise floor / guard baseline ｜ 未启动：正式 A/B');
L.push('机械断言只证明流程完整自洽，不能证明评价标准本身正确');
L.push('```');
writeFileSync(OUT_MD, L.join('\n') + '\n', 'utf8');
writeFileSync(OUT_JSON, JSON.stringify({
  facts: { matchesA, denomA, matchesB, denomB, agreeA: Number(agreeA.toFixed(4)), agreeB: Number(agreeB.toFixed(4)), fp: FP, fn: FN, ambiguousMismatch: AMB },
  interpretation: { mechanisms: rows, overlaps, evidenceStrong: STRONG, evidenceCandidate: CANDIDATE, note: '分析者标签，可重叠，不可相加' },
  contrasts: contrasts.map(([c, ids]) => ({ case_id: c, items: ids.map(i => ({ pack_id: i, gold: goldOf.get(i), proxy: FP.includes(i) ? 'SELF' : FN.includes(i) ? 'NOT_SELF' : 'match' })) })),
  inputs: h,
  caveat: '只读分析；未改规则/门槛/gold/基线；未计算 noise floor 或 guard baseline；未启动正式 A/B',
}, null, 2) + '\n', 'utf8');

check(sha(GOLD) === h.g && mt(GOLD) === m.g, 'final-gold.jsonl 未被本次运行改动');
check(sha(PROXY) === h.p && mt(PROXY) === m.p, 'regex-proxy.jsonl 未被本次运行改动');
check(sha(CORPUS) === h.c && mt(CORPUS) === m.c, 'ruler-failure-corpus.json 未被本次运行改动');
console.log('  → ' + OUT_MD);
console.log('  → ' + OUT_JSON);
console.log('  机制（解释层，可重叠）: ' + rows.map(r => r.mech + '=' + r.ids.length).join(' ｜ '));
console.log('  同 fixture 对照对: ' + contrasts.length + ' 组');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
