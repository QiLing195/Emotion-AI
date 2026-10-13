// v1.60 L3-A v2 —— P0 血缘断言 + P1/P2 对照（授权：P0+P1 已完成 → P2 本次）
// 范围：实现并跑对照（**不出机制结论**）｜**不生成新冻结清单**（未授权）
//
// 本版相对首版新增：
//   ① P2（机制 B · 归属标记）对照，与 P1 并列输出
//   ② 报告内写入 assertions / result；断言失败时自动落 RUN-NOTE
//      （落地上一轮登记的"目录存在 ≠ 该次运行通过"这条可追溯性缺口）
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { classifyV2, selfInitiatedV1, type V2Profile } from './audit-v160-l3a-v2.js';

const ROOT = 'artifacts/v1.60';
const PACK = ROOT + '/annotation/annotation-pack.jsonl';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY_V1 = ROOT + '/annotation/regex-proxy.jsonl';
const BASELINE = ROOT + '/analysis/gate-baseline.json';
const V2DIR = 'artifacts/v1.60-l3a-v2';

const EXPECT = {
  pack: '6681b1b5c5245809225a471aaac1f8040c3dbe78ba82a12f026fa5302b571c5c',
  gold: '880f245f4e1671da8d685da258cf5cdde23a1100fc1a567fb217e471fb99c42c',
  proxyV1: '9f53101b327abe7f39143652f71918dd965d7136c42e718d17e18c15c060ef5f',
  baseline: '4b38f9ba51c98ac0107a97feffa9a3983a25d3bd54c5ed4550c270b56d254d70',
};
const RULE_ID_V1 = 'L3-A@scripts/audit-v159-expression.ts:10-19';
const REASON_HIT = '命中 SELF_ACT 且非疑问句、非 HIS 指代、非纯附和 ⇒ 判 SELF';
const REASON_MISS = '未命中（或无独立非疑问自身句）⇒ 按冻结规则判 NOT_SELF';

const PROFILES: Array<{ id: V2Profile; file: string }> = [
  { id: 'P1_empathy_A', file: V2DIR + '/p1-empathy-only-proxy.jsonl' },
  { id: 'P2_empathy_A_ownership_B', file: V2DIR + '/p2-ownership-proxy.jsonl' },
];

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
const manifestBefore = existsSync(V2DIR + '/baseline-manifest-v2.json');

console.log('v1.60 L3-A v2 ｜ P0（已通过）+ P1（已跑）+ P2（本次）｜ 不出机制结论 ｜ 不生成冻结清单');

// ── ⓪ tsc 强制门（2026-10-13 用户授权：类型检查失败 ⇒ 整轮必须 FAIL）──
// 背景：tsx 不做类型检查 ⇒ 首版曾出现"断言 22/22 PASS 而源码 tsc 未净"的假阳性。
// 判据：主配置 tsc --noEmit 退出码必须为 0，且与语义断言**共同**决定唯一的 result。
console.log('\n⓪ tsc 强制门（主配置 tsc --noEmit）');
let tscExit = -1; let tscLog = '';
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
  tscExit = 0;
} catch (e) {
  const err = e as { status?: number; stdout?: string; stderr?: string };
  tscExit = typeof err.status === 'number' ? err.status : -1;
  tscLog = String(err.stdout ?? '') + String(err.stderr ?? '');
}
check(tscExit === 0, 'tsc 强制门：tsc --noEmit 退出码为 0', { exit: tscExit, logHead: tscLog.slice(0, 200) });
if (tscExit !== 0) console.log('    tsc 输出（前 400 字）：\n      ' + tscLog.slice(0, 400).replace(/\n/g, '\n      '));

console.log('\n① 输入哈希核对');
check(before.pack === EXPECT.pack, 'annotation-pack.jsonl 哈希一致', before.pack.slice(0, 12));
check(before.gold === EXPECT.gold, 'final-gold.jsonl 哈希一致', before.gold.slice(0, 12));
check(before.proxyV1 === EXPECT.proxyV1, 'regex-proxy.jsonl（v1 基准）哈希一致', before.proxyV1.slice(0, 12));
check(before.baseline === EXPECT.baseline, 'gate-baseline.json 哈希一致', before.baseline.slice(0, 12));

interface PackRow { pack_id: string; case_id: string; user_input: string; assistant_output: string }
const pack = readFileSync(PACK, 'utf8').trim().split('\n').map(l => JSON.parse(l) as PackRow);
check(pack.length === 48, 'pack 48 行', pack.length);
check(new Set(pack.map(r => r.pack_id)).size === 48, 'pack_id 唯一', new Set(pack.map(r => r.pack_id)).size);

console.log('\n② 血缘断言（P0 = 工具链等价性，不是机制实验）');
const replayLines = pack.map(r => {
  const v = selfInitiatedV1(r.assistant_output);
  const hit = v.selfInitiated === 1;
  return JSON.stringify({ pack_id: r.pack_id, proxy_label: hit ? 'SELF' : 'NOT_SELF', rule_id: RULE_ID_V1, hit, self_sentences: v.selfSentences, reason: hit ? REASON_HIT : REASON_MISS });
});
const replayText = replayLines.join('\n') + '\n';
check(replayText === proxyV1Raw, 'P0 重放与冻结 regex-proxy.jsonl 逐字节相同', { replayLen: replayText.length, frozenLen: proxyV1Raw.length });

const frozen = proxyV1Raw.trim().split('\n').map(l => JSON.parse(l) as { pack_id: string; proxy_label: string });
const gold = readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { pack_id: string; label: string; source: string; reason: string });
const goldOf = new Map(gold.map(g => [g.pack_id, g]));
const v1Of = new Map(frozen.map(f => [f.pack_id, f.proxy_label]));

interface Row { pack_id: string; gold: string; v1: string; label: string; goldSource: string; goldReason: string; ambiguous: boolean; rejectedByA: string[]; rejectedByB: string[] }
const evalProfile = (prof: V2Profile, tag: string) => {
  const rows: Row[] = pack.map(r => {
    const res = classifyV2({ reply: r.assistant_output, userInput: r.user_input }, prof);
    const g = goldOf.get(r.pack_id)!;
    return { pack_id: r.pack_id, gold: g.label, v1: v1Of.get(r.pack_id)!, label: res.label, goldSource: g.source, goldReason: g.reason, ambiguous: g.label === 'AMBIGUOUS', rejectedByA: res.rejectedByA, rejectedByB: res.rejectedByB ?? [] };
  });
  const det = rows.filter(r => !r.ambiguous);
  const fp = det.filter(r => r.label === 'SELF' && r.gold === 'NOT_SELF');
  const fn = det.filter(r => r.label === 'NOT_SELF' && r.gold === 'SELF');
  const match = det.filter(r => r.label === r.gold).length;
  const fixed = det.filter(r => r.v1 !== r.gold && r.label === r.gold);
  const broken = det.filter(r => r.v1 === r.gold && r.label !== r.gold);
  const amb = rows.filter(r => r.ambiguous && r.label !== r.gold);
  check(rows.length === 48, tag + ' 输出 48 行', rows.length);
  check(rows.every(r => r.label === 'SELF' || r.label === 'NOT_SELF'), tag + ' 标签合法（二值，不产出 AMBIGUOUS）');
  const selfCount = rows.filter(r => r.label === 'SELF').length;
  check(selfCount !== 0 && selfCount !== 48, tag + ' 反-规避检查：SELF 条数不为 0/48', selfCount);
  check(match + fp.length + fn.length === 46, tag + ' 口径 A 自洽（一致 + FP + FN = 46）', match + fp.length + fn.length);
  check(fp.length <= 18 && fn.length >= 1, tag + ' 结构性质：FP 不增、FN 不减（只剔除 ⇒ 单调）', { fp: fp.length, fn: fn.length });
  writeFileSync(PROFILES.find(p => p.id === prof)!.file, rows.map(r => JSON.stringify({ pack_id: r.pack_id, proxy_label: r.label, rule_id: 'L3-A-v2@' + prof, hit: r.label === 'SELF', rejected_by_A: r.rejectedByA, rejected_by_B: r.rejectedByB, mechanisms: prof })).join('\n') + '\n', 'utf8');
  return { rows, det, fp, fn, match, fixed, broken, amb };
};

console.log('\n③ P1 / P2 对照');
const R1 = evalProfile('P1_empathy_A', 'P1(A)');
const R2 = evalProfile('P2_empathy_A_ownership_B', 'P2(A+B)');
console.log('  v1       = 27/46 = 58.7% ｜ FP 18 ｜ FN 1 ｜（冻结基线）');
console.log('  P1(A)    = ' + R1.match + '/46 = ' + (R1.match / 46 * 100).toFixed(1) + '% ｜ FP ' + R1.fp.length + ' ｜ FN ' + R1.fn.length + ' ｜ 修正 ' + R1.fixed.length + ' ｜ 破坏 ' + R1.broken.length);
console.log('  P2(A+B)  = ' + R2.match + '/46 = ' + (R2.match / 46 * 100).toFixed(1) + '% ｜ FP ' + R2.fp.length + ' ｜ FN ' + R2.fn.length + ' ｜ 修正 ' + R2.fixed.length + ' ｜ 破坏 ' + R2.broken.length);
const p2NewFixed = R2.fixed.filter(r => !R1.fixed.some(x => x.pack_id === r.pack_id)).map(r => r.pack_id);
const p2NewBroken = R2.broken.filter(r => !R1.broken.some(x => x.pack_id === r.pack_id)).map(r => r.pack_id);
console.log('  P1→P2 增量修正：' + (p2NewFixed.join(' ') || '—') + ' ｜ 增量破坏：' + (p2NewBroken.join(' ') || '—'));
console.log('  P2 全部破坏项：' + (R2.broken.map(r => r.pack_id).join(' ') || '—'));
for (const r of R2.broken) console.log('      ' + r.pack_id + ' gold=' + r.gold + ' ｜ B 否决句：' + (r.rejectedByB[0] ?? '（无）'));
console.log('  P2 剩余 FP（' + R2.fp.length + '）：' + R2.fp.map(r => r.pack_id).join(' '));
console.log('  AMBIGUOUS_MISMATCH：P1 ' + R1.amb.length + ' ｜ P2 ' + R2.amb.length + '（表示能力局限，不混入 FP/FN）');

const GROUPS: Array<{ g: string; pos: string; neg: string }> = [
  { g: 'F01', pos: 'P23', neg: 'P40' }, { g: 'F02', pos: 'P16', neg: 'P46' }, { g: 'F05', pos: 'P37', neg: 'P21' },
  { g: 'F07', pos: 'P43', neg: 'P22' }, { g: 'F08', pos: 'P33', neg: 'P13' }, { g: 'F14', pos: 'P02', neg: 'P45' },
  { g: 'F21', pos: 'P32', neg: 'P20' }, { g: 'F22', pos: 'P25', neg: 'P28' }, { g: 'F04', pos: 'P42', neg: 'P01' },
];
const pairEval = (R: ReturnType<typeof evalProfile>) => {
  const byId = new Map(R.rows.map(r => [r.pack_id, r]));
  return GROUPS.map(G => {
    const pos = byId.get(G.pos)!, neg = byId.get(G.neg)!;
    return { ...G, posV1: pos.v1, posLabel: pos.label, negV1: neg.v1, negLabel: neg.label, posOk: pos.label === 'SELF', negOk: neg.label !== 'SELF', pass: pos.label === 'SELF' && neg.label !== 'SELF' };
  });
};
const P1pairs = pairEval(R1), P2pairs = pairEval(R2);
console.log('\n  九组对照（PASS = 正例侧 SELF ∧ 反例侧 != SELF）');
for (let i = 0; i < GROUPS.length; i++) {
  const a = P1pairs[i], b = P2pairs[i];
  console.log('    ' + a.g + ' ' + a.pos + '/' + a.neg + ' ｜ v1 ' + a.posV1 + '/' + a.negV1 + ' ｜ P1 ' + a.posLabel + '/' + a.negLabel + ' ' + (a.pass ? 'PASS' : 'REGR') + ' ｜ P2 ' + b.posLabel + '/' + b.negLabel + ' ' + (b.pass ? 'PASS' : 'REGR'));
}
const p1Fail = P1pairs.filter(p => !p.pass).map(p => p.g), p2Fail = P2pairs.filter(p => !p.pass).map(p => p.g);
console.log('  九组：P1 ' + (9 - p1Fail.length) + '/9（' + (p1Fail.join(' ') || '—') + '）｜ P2 ' + (9 - p2Fail.length) + '/9（' + (p2Fail.join(' ') || '—') + '）');

const result = fails.length === 0 ? 'PASS' : 'FAIL';
const assertionLine = (n - fails.length) + '/' + n;
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = V2DIR + '/runs/' + runId;
mkdirSync(runDir, { recursive: true });
const meta = { assertions: assertionLine, result, failedChecks: fails, tsc: { exit: tscExit, gatePassed: tscExit === 0 }, authorization: 'P0+P1（已完成）+ P2（本次）｜实现并跑对照｜不出机制结论｜不生成新冻结清单' };
if (tscExit !== 0) writeFileSync(runDir + '/tsc.log', tscLog || '(tsc 无输出)', 'utf8');
writeFileSync(runDir + '/p0-lineage.json', JSON.stringify({ ...meta, byteEqual: replayText === proxyV1Raw, replayLen: replayText.length, frozenLen: proxyV1Raw.length, inputs: before, note: 'P0 只证明工具链等价，不证明 v1 规则语义正确' }, null, 2) + '\n', 'utf8');
const cmp = (R: ReturnType<typeof evalProfile>, prof: string, pairs: ReturnType<typeof pairEval>) => ({
  ...meta, profile: prof,
  denominatorA: { n: 46, v1Matches: 27, thisMatches: R.match, thisAgreement: Number((R.match / 46).toFixed(4)) },
  fp: { v1: 18, now: R.fp.length, ids: R.fp.map(r => r.pack_id) },
  fn: { v1: 1, now: R.fn.length, ids: R.fn.map(r => r.pack_id) },
  ambiguousMismatch: { n: R.amb.length, ids: R.amb.map(r => r.pack_id), note: '表示能力局限（二值无法表达 AMBIGUOUS），不混入 FP/FN' },
  flipTable: { fixed: R.fixed.map(r => ({ pack_id: r.pack_id, gold: r.gold, v1: r.v1, now: r.label, rejectedByA: r.rejectedByA, rejectedByB: r.rejectedByB })), broken: R.broken.map(r => ({ pack_id: r.pack_id, gold: r.gold, v1: r.v1, now: r.label, rejectedByA: r.rejectedByA, rejectedByB: r.rejectedByB })) },
  pairs: { passCount: 9 - pairs.filter(p => !p.pass).length, regressions: pairs.filter(p => !p.pass).map(p => p.g), detail: pairs },
  caveats: ['SELF_CUE / USER_REF_D1 均为候选词表，未独立验证', 'D2（回指解析）未实现：设计分析已发现反例 P23（若启用会破坏 F01 正例侧）——属分析，非测量', '本结果为对照数据，不构成机制结论；不得据一致率上升宣布语义改善'],
  notCreated: 'baseline-manifest-v2.json（未授权）',
});
writeFileSync(runDir + '/p1-comparison.json', JSON.stringify(cmp(R1, 'P1_empathy_A', P1pairs), null, 2) + '\n', 'utf8');
writeFileSync(runDir + '/p2-comparison.json', JSON.stringify(cmp(R2, 'P2_empathy_A_ownership_B', P2pairs), null, 2) + '\n', 'utf8');
writeFileSync(runDir + '/detail.jsonl', R2.rows.map(r => JSON.stringify({ ...r, p1Label: (R1.rows.find(x => x.pack_id === r.pack_id) as Row).label })).join('\n') + '\n', 'utf8');
if (result === 'FAIL') writeFileSync(runDir + '/RUN-NOTE.md', '# 本目录来自一次断言未全绿的运行\n\n```\nASSERTIONS: ' + assertionLine + ' ｜ RESULT: FAIL\n未通过项：\n  - ' + fails.join('\n  - ') + '\n```\n\n（由运行器自动生成：目录存在 ≠ 该次运行通过。）\n', 'utf8');

console.log('\n④ 冻结物与授权边界');
check(sha(PACK) === before.pack && mt(PACK) === mtBefore.pack, 'annotation-pack.jsonl 未变（哈希+mtime）');
check(sha(GOLD) === before.gold && mt(GOLD) === mtBefore.gold, 'final-gold.jsonl 未变');
check(sha(PROXY_V1) === before.proxyV1 && mt(PROXY_V1) === mtBefore.proxyV1, 'regex-proxy.jsonl（v1）未变');
check(sha(BASELINE) === before.baseline && mt(BASELINE) === mtBefore.baseline, 'gate-baseline.json 未变');
check(existsSync(V2DIR + '/baseline-manifest-v2.json') === manifestBefore, '未创建 baseline-manifest-v2.json（授权限制）');

console.log('  → ' + V2DIR + '/{p1-empathy-only-proxy.jsonl, p2-ownership-proxy.jsonl}');
console.log('  → ' + runDir + '/{p0-lineage, p1-comparison, p2-comparison, detail}');
console.log('  · 本次不产出机制结论；不启动正式 A/B');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
