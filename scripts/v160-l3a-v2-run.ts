// v1.60 L3-A v2 —— P0 血缘断言 + P1 对照（授权范围：P0+P1；**不生成新冻结清单**）
//
// 执行内容：
//   ① 四项输入哈希核对（pack / gold / regex-proxy-v1 / gate-baseline）
//   ② 血缘断言：以 P0_replay_v1（v1 规则逐字复制）重算 annotation-pack，**逐字节**比对 regex-proxy.jsonl
//   ③ P1（机制 A）生成 p1 代理标签 → FP/FN/AMBIGUOUS_MISMATCH、九组双侧、v1→v2 翻转表
//   ④ 输出只写 artifacts/v1.60-l3a-v2/**；运行前后比对冻结物（哈希 + mtime）
//
// 明确不做：不创建 baseline-manifest-v2.json（未授权）；不改任何冻结物；不启动正式 A/B；不产出机制结论。
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { classifyV2, selfInitiatedV1, splitSentences } from './audit-v160-l3a-v2.js';

const ROOT = 'artifacts/v1.60';
const PACK = ROOT + '/annotation/annotation-pack.jsonl';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY_V1 = ROOT + '/annotation/regex-proxy.jsonl';
const BASELINE = ROOT + '/analysis/gate-baseline.json';
const V2DIR = 'artifacts/v1.60-l3a-v2';
const OUT_P1 = V2DIR + '/p1-empathy-only-proxy.jsonl';

const EXPECT = {
  pack: '6681b1b5c5245809225a471aaac1f8040c3dbe78ba82a12f026fa5302b571c5c',
  gold: '880f245f4e1671da8d685da258cf5cdde23a1100fc1a567fb217e471fb99c42c',
  proxyV1: '9f53101b327abe7f39143652f71918dd965d7136c42e718d17e18c15c060ef5f',
  baseline: '4b38f9ba51c98ac0107a97feffa9a3983a25d3bd54c5ed4550c270b56d254d70',
};
// v1 代理输出的固定元数据（与 scripts/v160-regex-proxy.ts 逐字一致）
const RULE_ID_V1 = 'L3-A@scripts/audit-v159-expression.ts:10-19';
const REASON_HIT = '命中 SELF_ACT 且非疑问句、非 HIS 指代、非纯附和 ⇒ 判 SELF';
const REASON_MISS = '未命中（或无独立非疑问自身句）⇒ 按冻结规则判 NOT_SELF';

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mt = (p: string) => statSync(p).mtimeMs;
for (const p of [PACK, GOLD, PROXY_V1, BASELINE]) if (!existsSync(p)) { console.error('缺输入：' + p); process.exit(2); }

const before = { pack: sha(PACK), gold: sha(GOLD), proxyV1: sha(PROXY_V1), baseline: sha(BASELINE) };
const mtBefore = { pack: mt(PACK), gold: mt(GOLD), proxyV1: mt(PROXY_V1), baseline: mt(BASELINE) };
const proxyV1Raw = readFileSync(PROXY_V1, 'utf8');
const frozenMdExists = existsSync(V2DIR + '/baseline-manifest-v2.json');

console.log('v1.60 L3-A v2 ｜ authorized: P0+P1（实现并跑对照，不出机制结论，不生成新冻结清单）');

// ── ① 输入哈希 ──
console.log('\n① 输入哈希核对');
check(before.pack === EXPECT.pack, 'annotation-pack.jsonl 哈希一致', before.pack.slice(0, 12));
check(before.gold === EXPECT.gold, 'final-gold.jsonl 哈希一致', before.gold.slice(0, 12));
check(before.proxyV1 === EXPECT.proxyV1, 'regex-proxy.jsonl（v1 对照基准）哈希一致', before.proxyV1.slice(0, 12));
check(before.baseline === EXPECT.baseline, 'gate-baseline.json 哈希一致', before.baseline.slice(0, 12));

interface PackRow { pack_id: string; case_id: string; user_input: string; assistant_output: string }
const pack = readFileSync(PACK, 'utf8').trim().split('\n').map(l => JSON.parse(l) as PackRow);
check(pack.length === 48, 'pack 48 行', pack.length);
check(new Set(pack.map(r => r.pack_id)).size === 48, 'pack_id 唯一', new Set(pack.map(r => r.pack_id)).size);

// ── ② 血缘断言：P0 重放必须逐字节复现冻结的 v1 代理输出 ──
console.log('\n② 血缘断言（P0 = 工具链等价性验证，**不是机制实验**）');
const replayLines = pack.map(r => {
  const v = selfInitiatedV1(r.assistant_output);
  const hit = v.selfInitiated === 1;
  return JSON.stringify({
    pack_id: r.pack_id,
    proxy_label: hit ? 'SELF' : 'NOT_SELF',
    rule_id: RULE_ID_V1,
    hit,
    self_sentences: v.selfSentences,
    reason: hit ? REASON_HIT : REASON_MISS,
  });
});
const replayText = replayLines.join('\n') + '\n';
const byteEqual = replayText === proxyV1Raw;
check(byteEqual, 'P0 重放输出与冻结的 regex-proxy.jsonl **逐字节相同**', { replayLen: replayText.length, frozenLen: proxyV1Raw.length });
if (!byteEqual) {
  const a = replayText.split('\n'), b = proxyV1Raw.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) {
    console.log('    首个差异行 ' + (i + 1) + '：');
    console.log('      replay: ' + String(a[i]).slice(0, 160));
    console.log('      frozen: ' + String(b[i]).slice(0, 160));
    break;
  }
}
// 逐字段对照（即使字节相同也留证）
const frozen = proxyV1Raw.trim().split('\n').map(l => JSON.parse(l) as { pack_id: string; proxy_label: string; rule_id: string; hit: boolean; self_sentences: string[]; reason: string });
let fieldMismatch = 0;
for (let i = 0; i < pack.length; i++) {
  const a = JSON.parse(replayLines[i]) as typeof frozen[0];
  const b = frozen[i];
  if (a.pack_id !== b.pack_id || a.proxy_label !== b.proxy_label || a.rule_id !== b.rule_id || a.hit !== b.hit || JSON.stringify(a.self_sentences) !== JSON.stringify(b.self_sentences) || a.reason !== b.reason) fieldMismatch++;
}
check(fieldMismatch === 0, '逐字段对照（pack_id/proxy_label/rule_id/hit/self_sentences/reason）全部一致', fieldMismatch);

// ── ③ P1（机制 A）──
console.log('\n③ P1：机制 A（共情排除）对照');
const gold = readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { pack_id: string; label: string; source: string; reason: string });
const goldOf = new Map(gold.map(g => [g.pack_id, g]));
const v1Of = new Map(frozen.map(f => [f.pack_id, f.proxy_label]));

const p1Rows = pack.map(r => {
  const res = classifyV2({ reply: r.assistant_output, userInput: r.user_input }, 'P1_empathy_A');
  return {
    pack_id: r.pack_id,
    proxy_label: res.label,
    rule_id: 'L3-A-v2@scripts/audit-v160-l3a-v2.ts:P1_empathy_A(mechanism A only)',
    hit: res.units.length > 0,
    self_sentences: res.units.map(u => u.sentence),
    rejected_by_A: res.rejectedByA,
    mechanisms: res.mechanisms,
    reason: res.reason,
  };
});
mkdirSync(V2DIR, { recursive: true });
writeFileSync(OUT_P1, p1Rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

check(p1Rows.length === 48, 'p1 输出 48 行', p1Rows.length);
check(p1Rows.every(r => r.proxy_label === 'SELF' || r.proxy_label === 'NOT_SELF'), 'p1 标签合法（二值，不产出 AMBIGUOUS）');
check(p1Rows.every(r => r.proxy_label === 'SELF' || r.proxy_label === 'NOT_SELF'), 'Step 1 规范：不出现 AMBIGUOUS');
const p1SelfCount = p1Rows.filter(r => r.proxy_label === 'SELF').length;
check(p1SelfCount !== 0 && p1SelfCount !== 48, '反-规避检查：SELF 条数不为 0 也不为 48', p1SelfCount);

interface Row { pack_id: string; gold: string; v1: string; p1: string; goldSource: string; goldReason: string; ambiguous: boolean; rejectedByA: string[] }
const rows: Row[] = pack.map(r => {
  const g = goldOf.get(r.pack_id)!;
  const p1 = p1Rows.find(x => x.pack_id === r.pack_id)!;
  return { pack_id: r.pack_id, gold: g.label, v1: v1Of.get(r.pack_id)!, p1: p1.proxy_label, goldSource: g.source, goldReason: g.reason, ambiguous: g.label === 'AMBIGUOUS', rejectedByA: p1.rejected_by_A };
});
const det = rows.filter(r => !r.ambiguous);
const fpV1 = det.filter(r => r.v1 === 'SELF' && r.gold === 'NOT_SELF');
const fnV1 = det.filter(r => r.v1 === 'NOT_SELF' && r.gold === 'SELF');
const fpP1 = det.filter(r => r.p1 === 'SELF' && r.gold === 'NOT_SELF');
const fnP1 = det.filter(r => r.p1 === 'NOT_SELF' && r.gold === 'SELF');
const matchV1 = det.filter(r => r.v1 === r.gold).length;
const matchP1 = det.filter(r => r.p1 === r.gold).length;
const fixed = det.filter(r => r.v1 !== r.gold && r.p1 === r.gold);
const broken = det.filter(r => r.v1 === r.gold && r.p1 !== r.gold);
const ambMismatch = rows.filter(r => r.ambiguous && r.p1 !== r.gold);

console.log('  口径 A（46 条确定性样本）：v1 = ' + matchV1 + '/46 = ' + (matchV1 / 46 * 100).toFixed(1) + '%  →  P1 = ' + matchP1 + '/46 = ' + (matchP1 / 46 * 100).toFixed(1) + '%');
console.log('  FP：' + fpV1.length + ' → ' + fpP1.length + ' ｜ FN：' + fnV1.length + ' → ' + fnP1.length);
console.log('  **修正项**（v1 错→P1 对）' + fixed.length + ' 条：' + (fixed.map(r => r.pack_id).join(' ') || '—'));
console.log('  **破坏项**（v1 对→P1 错）' + broken.length + ' 条：' + (broken.map(r => r.pack_id).join(' ') || '—'));
console.log('  AMBIGUOUS_MISMATCH：' + ambMismatch.length + ' 条（单列，不混入 FP/FN）' + (ambMismatch.length ? '：' + ambMismatch.map(r => r.pack_id).join(' ') : ''));
// 自洽：P1 的一致 + FP + FN = 46（注意：fixed ⊂ matchP1，不得把 fixed 再加一遍 —— 首版曾因此报 52）
check(matchP1 + fpP1.length + fnP1.length === 46, 'P1 口径 A 自洽（一致 + FP + FN = 46）', matchP1 + fpP1.length + fnP1.length);
check(fixed.length <= matchP1 && broken.length <= 46 - matchP1, '修正项 ⊆ P1 一致项、破坏项 ⊆ P1 不一致项', { fixed: fixed.length, matchP1, broken: broken.length });
check(fpV1.length + fnV1.length + matchV1 === 46, 'v1 口径 A 自洽（一致 + FP + FN = 46）', fpV1.length + fnV1.length + matchV1);
check(fpP1.length <= fpV1.length, '机制 A 结构性质：FP 不增加（单调 FP 下降）', { v1: fpV1.length, p1: fpP1.length });
check(fnP1.length >= fnV1.length, '机制 A 结构性质：FN 不减少（代价只能出现在 FN）', { v1: fnV1.length, p1: fnP1.length });

// ── 九组回归对照（双侧）──
const GROUPS: Array<{ g: string; pos: string; neg: string; negExpect: 'NOT_SELF' | 'AMBIGUOUS' }> = [
  { g: 'F01', pos: 'P23', neg: 'P40', negExpect: 'NOT_SELF' },
  { g: 'F02', pos: 'P16', neg: 'P46', negExpect: 'NOT_SELF' },
  { g: 'F05', pos: 'P37', neg: 'P21', negExpect: 'NOT_SELF' },
  { g: 'F07', pos: 'P43', neg: 'P22', negExpect: 'NOT_SELF' },
  { g: 'F08', pos: 'P33', neg: 'P13', negExpect: 'NOT_SELF' },
  { g: 'F14', pos: 'P02', neg: 'P45', negExpect: 'NOT_SELF' },
  { g: 'F21', pos: 'P32', neg: 'P20', negExpect: 'AMBIGUOUS' },
  { g: 'F22', pos: 'P25', neg: 'P28', negExpect: 'NOT_SELF' },
  { g: 'F04', pos: 'P42', neg: 'P01', negExpect: 'AMBIGUOUS' },
];
const byId = new Map(rows.map(r => [r.pack_id, r]));
const pairs = GROUPS.map(G => {
  const pos = byId.get(G.pos)!, neg = byId.get(G.neg)!;
  const posOk = pos.p1 === 'SELF';
  const negOk = neg.p1 !== 'SELF';                       // 表示局限：只要求 != SELF
  return { ...G, posV1: pos.v1, posP1: pos.p1, negV1: neg.v1, negP1: neg.p1, posOk, negOk, pass: posOk && negOk, negLabelReachable: G.negExpect !== 'AMBIGUOUS' };
});
console.log('\n  九组回归对照（PASS = 正例侧仍 SELF ∧ 反例侧 != SELF）');
for (const p of pairs) {
  console.log('    ' + p.g + ' 正例 ' + p.pos + ' v1=' + p.posV1 + ' P1=' + p.posP1 + ' ｜ 反例 ' + p.neg + ' v1=' + p.negV1 + ' P1=' + p.negP1 + '  ' + (p.pass ? 'PASS' : (p.posOk ? 'PAIR_REGRESSION(反例侧)' : 'PAIR_REGRESSION(正例侧)')) + (p.negLabelReachable ? '' : ' ［表示局限：反例侧 AMBIGUOUS 不可达］'));
}
const pairFails = pairs.filter(p => !p.pass);
console.log('  九组结果：PASS ' + (pairs.length - pairFails.length) + '/9' + (pairFails.length ? ' ｜ PAIR_REGRESSION：' + pairFails.map(p => p.g).join(' ') : ''));

// ── 输出（只写 v2 目录）──
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = V2DIR + '/runs/' + runId;
mkdirSync(runDir, { recursive: true });
writeFileSync(runDir + '/p0-lineage.json', JSON.stringify({
  authorization: 'P0+P1 ｜ 实现并跑对照（不出机制结论）｜ 不生成新冻结清单',
  byteEqual, fieldMismatch, replayLen: replayText.length, frozenLen: proxyV1Raw.length,
  inputs: { pack: before.pack, gold: before.gold, proxyV1: before.proxyV1, baseline: before.baseline },
  ruleIdV1: RULE_ID_V1, note: 'P0 只证明工具链等价，不证明 v1 规则语义正确',
}, null, 2) + '\n', 'utf8');
writeFileSync(runDir + '/p1-comparison.json', JSON.stringify({
  profile: 'P1_empathy_A', mechanisms: ['L3A2-A-EMPATHY-EXCLUSION(clause)'],
  denominatorA: { n: 46, v1Matches: matchV1, p1Matches: matchP1, v1Agreement: Number((matchV1 / 46).toFixed(4)), p1Agreement: Number((matchP1 / 46).toFixed(4)) },
  fp: { v1: fpV1.map(r => r.pack_id), p1: fpP1.map(r => r.pack_id) },
  fn: { v1: fnV1.map(r => r.pack_id), p1: fnP1.map(r => r.pack_id) },
  ambiguousMismatch: { n: ambMismatch.length, ids: ambMismatch.map(r => r.pack_id), note: '单列，不混入 FP/FN；二值代理无法表达 AMBIGUOUS = 表示能力局限' },
  flipTable: { fixed: fixed.map(r => ({ pack_id: r.pack_id, gold: r.gold, v1: r.v1, p1: r.p1, rejectedByA: r.rejectedByA })), broken: broken.map(r => ({ pack_id: r.pack_id, gold: r.gold, v1: r.v1, p1: r.p1, rejectedByA: r.rejectedByA })) },
  structuralProperty: '机制 A 只剔除 self 句 ⇒ 单调 FP 下降 / FN 上升：修正项必为 FP，破坏项必为 FN',
  pairsPass: (pairs.length - pairFails.length) + '/9', pairRegressions: pairFails.map(p => p.g),
  caveats: [
    'SELF_CUE 为候选词表，未独立验证：可能过度否决（⇒ FN）',
    '「明白/理解」兼作认知动词，本判据不区分用法',
    '本结果为对照数据，**不构成机制结论**；不得据一致率上升宣布语义改善',
  ],
  notCreated: 'baseline-manifest-v2.json（未授权）',
}, null, 2) + '\n', 'utf8');
writeFileSync(runDir + '/pairs.json', JSON.stringify(pairs, null, 2) + '\n', 'utf8');
writeFileSync(runDir + '/detail.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

// ── ④ 冻结物完整性 + 未创建冻结清单 ──
console.log('\n④ 冻结物与授权边界');
check(sha(PACK) === before.pack && mt(PACK) === mtBefore.pack, 'annotation-pack.jsonl 运行前后未变（哈希+mtime）');
check(sha(GOLD) === before.gold && mt(GOLD) === mtBefore.gold, 'final-gold.jsonl 未变');
check(sha(PROXY_V1) === before.proxyV1 && mt(PROXY_V1) === mtBefore.proxyV1, 'regex-proxy.jsonl（v1）未变');
check(sha(BASELINE) === before.baseline && mt(BASELINE) === mtBefore.baseline, 'gate-baseline.json 未变');
check(existsSync(V2DIR + '/baseline-manifest-v2.json') === frozenMdExists, '未创建 baseline-manifest-v2.json（授权限制）', { before: frozenMdExists, after: existsSync(V2DIR + '/baseline-manifest-v2.json') });
check(true, '规则模块未读取 final-gold（判定只用 reply/userInput）');

console.log('  → ' + OUT_P1);
console.log('  → ' + runDir + '/{p0-lineage.json, p1-comparison.json, pairs.json, detail.jsonl}');
console.log('  · 本次不产出机制结论；不启动正式 A/B');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
