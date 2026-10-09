// v1.60 量具 Gate harness（**可重跑、输入冻结、基线不自动更新**）
//
// 用法：
//   tsx scripts/v160-gate.ts --freeze      # 一次性：冻结输入 SHA-256 + 当前基线指标 → 写 gate-baseline.json
//   tsx scripts/v160-gate.ts               # 校验模式：完整性门 → 计算 → 基线断言 → 写运行目录
//   tsx scripts/v160-gate.ts --self-test   # 自检：内存中篡改一条代理标签，断言"基线不一致"能被抓到（不改任何文件）
//   tsx scripts/v160-gate.ts --manifest <path>   # 指定清单（用于自检输入被污染的情形）
//
// 边界（明确不做）：
//   · 不修改 L3-A 规则、不调整 80% 门槛、不重标 FINAL GOLD、不重新生成代理输出
//   · 不计算 noise floor / guard baseline；不启动正式 A/B
//   · **基线不自动更新**：重跑结果与基线不一致时报告并失败，绝不覆盖基线
//   · 机械断言只能证明"流程完整、自洽"，**不能证明评价标准本身正确**
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'artifacts/v1.60';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY = ROOT + '/annotation/regex-proxy.jsonl';
const FROZEN_MD = ROOT + '/analysis/gate1-agreement.md';
const FROZEN_JSON = ROOT + '/analysis/gate1-agreement.json';
const BASELINE = ROOT + '/analysis/gate-baseline.json';
const RUNS = ROOT + '/analysis/gate-runs';
const THRESHOLD = 0.80;
const GATE_VERSION = 'v160-gate/1';
const RULE_VERSION = 'L3-A@scripts/audit-v159-expression.ts:10-19';

const argv = process.argv.slice(2);
const FREEZE = argv.includes('--freeze');
const SELF_TEST = argv.includes('--self-test');
const mi = argv.indexOf('--manifest');
const MANIFEST = mi >= 0 && argv[mi + 1] ? argv[mi + 1] : BASELINE;

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mt = (p: string) => statSync(p).mtimeMs;

interface GoldRow { pack_id: string; label: string; source: string; reason: string }
interface ProxyRow { pack_id: string; proxy_label: string; hit: boolean; self_sentences: string[]; reason: string }
interface Baseline {
  gateVersion: string; ruleVersion: string; threshold: number;
  inputs: { gold: string; proxy: string };
  baseline: { denomA: number; matchesA: number; denomB: number; matchesB: number; fp: number; fn: number; ambiguousMismatch: number; gatePassed: boolean };
}

function loadInputs(): { gold: GoldRow[]; proxy: ProxyRow[] } {
  for (const p of [GOLD, PROXY]) if (!existsSync(p)) { console.error('缺输入：' + p); process.exit(2); }
  return {
    gold: readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as GoldRow),
    proxy: readFileSync(PROXY, 'utf8').trim().split('\n').map(l => JSON.parse(l) as ProxyRow),
  };
}

function evaluate(gold: GoldRow[], proxy: ProxyRow[]) {
  const mapP = new Map(proxy.map(p => [p.pack_id, p]));
  const detail = gold.map(g => {
    const p = mapP.get(g.pack_id) as ProxyRow | undefined;
    const proxyLabel = p ? p.proxy_label : '<MISSING>';
    return { pack_id: g.pack_id, gold_label: g.label, proxy_label: proxyLabel, match: !!p && g.label === proxyLabel, gold_source: g.source, gold_reason: g.reason, gold_is_ambiguous: g.label === 'AMBIGUOUS', proxy_hit: p ? p.hit : null };
  });
  const rowsA = detail.filter(r => !r.gold_is_ambiguous);
  const fp = rowsA.filter(r => r.proxy_label === 'SELF' && r.gold_label === 'NOT_SELF');
  const fn = rowsA.filter(r => r.proxy_label === 'NOT_SELF' && r.gold_label === 'SELF');
  const ambMismatch = detail.filter(r => r.gold_is_ambiguous && !r.match);
  const matchesA = rowsA.filter(r => r.match).length;
  const matchesB = detail.filter(r => r.match).length;
  return {
    detail, rowsA, fp, fn, ambMismatch, matchesA, matchesB,
    denomA: rowsA.length, denomB: detail.length,
    agreeA: rowsA.length ? matchesA / rowsA.length : 0,
    agreeB: detail.length ? matchesB / detail.length : 0,
  };
}

// ── 冻结模式 ──
if (FREEZE) {
  const { gold, proxy } = loadInputs();
  const e = evaluate(gold, proxy);
  const b: Baseline = {
    gateVersion: GATE_VERSION, ruleVersion: RULE_VERSION, threshold: THRESHOLD,
    inputs: { gold: sha(GOLD), proxy: sha(PROXY) },
    baseline: { denomA: e.denomA, matchesA: e.matchesA, denomB: e.denomB, matchesB: e.matchesB, fp: e.fp.length, fn: e.fn.length, ambiguousMismatch: e.ambMismatch.length, gatePassed: e.agreeA >= THRESHOLD && e.agreeB >= THRESHOLD },
  };
  writeFileSync(BASELINE, JSON.stringify(b, null, 2) + '\n', 'utf8');
  console.log('已冻结清单：' + BASELINE);
  console.log('  inputs.gold  = ' + b.inputs.gold);
  console.log('  inputs.proxy = ' + b.inputs.proxy);
  console.log('  baseline = ' + JSON.stringify(b.baseline));
  console.log('  （冻结不改变任何输入；基线此后**不自动更新**）');
  process.exit(0);
}

// ── 校验 / 自检模式 ──
if (!existsSync(MANIFEST)) { console.error('缺冻结清单：' + MANIFEST + '\n请先运行 --freeze（仅一次）。'); process.exit(2); }
const base = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Baseline;
const hGoldBefore = sha(GOLD), hProxyBefore = sha(PROXY), mGold = mt(GOLD), mProxy = mt(PROXY);
const frozenMdBefore = existsSync(FROZEN_MD) ? sha(FROZEN_MD) : null;

console.log('v1.60 Gate harness ｜ ' + GATE_VERSION + ' ｜ 规则 ' + base.ruleVersion + ' ｜ 门槛 ' + (base.threshold * 100) + '%' + (SELF_TEST ? ' ｜ **自检模式**' : ''));

// ── 输入完整性门（哈希不符 ⇒ 失败退出，不静默继续）──
check(hGoldBefore === base.inputs.gold, '输入 final-gold.jsonl SHA-256 与冻结清单一致', { now: hGoldBefore.slice(0, 12), frozen: base.inputs.gold.slice(0, 12) });
check(hProxyBefore === base.inputs.proxy, '输入 regex-proxy.jsonl SHA-256 与冻结清单一致', { now: hProxyBefore.slice(0, 12), frozen: base.inputs.proxy.slice(0, 12) });
if (fails.length) { console.log('\nASSERTIONS: 0/' + n + '\nRESULT: FAIL（输入完整性门未通过 ⇒ 拒绝计算）'); process.exit(1); }

const { gold, proxy } = loadInputs();
if (SELF_TEST) {
  // 篡改点必须**落在会影响指标的样本**上：gold=SELF 且 proxy=SELF ⇒ 改判为 NOT_SELF 会减少 matchesA 并产生 1 个 FN
  // （此前误用 proxy[0]=P01：其 gold=AMBIGUOUS，翻标签不改变任何指标 ⇒ 自检构造错误，非 harness 缺陷）
  const goldSelf = new Set(gold.filter(g => g.label === 'SELF').map(g => g.pack_id));
  const victim = proxy.find(p => goldSelf.has(p.pack_id) && p.proxy_label === 'SELF');
  if (!victim) { console.error('自检无法构造：找不到 gold=SELF 且 proxy=SELF 的样本'); process.exit(2); }
  victim.proxy_label = 'NOT_SELF';
  console.log('  · 自检：内存中把 ' + victim.pack_id + ' 的代理标签 SELF→NOT_SELF（应产生 1 个 FN；**未写盘**）');
}

// ── 结构门 ──
check(gold.length === 48, 'gold 48 行', gold.length);
check(proxy.length === 48, 'proxy 48 行', proxy.length);
check(new Set(gold.map(g => g.pack_id)).size === 48, 'gold pack_id 唯一（重复行会失败）', new Set(gold.map(g => g.pack_id)).size);
check(new Set(proxy.map(p => p.pack_id)).size === 48, 'proxy pack_id 唯一', new Set(proxy.map(p => p.pack_id)).size);
check(gold.map(g => g.pack_id).sort().join() === proxy.map(p => p.pack_id).sort().join(), 'pack_id 集合完全相同（缺行/额外行都会失败）');
check(gold.every(g => ['SELF', 'NOT_SELF', 'AMBIGUOUS'].includes(g.label)), 'gold 标签合法');
check(proxy.every(p => ['SELF', 'NOT_SELF'].includes(p.proxy_label)), 'proxy 标签合法（二值）');

const e = evaluate(gold, proxy);

// ── 可复算性：明细必须能重算出两个口径 ──
check(e.matchesA + e.fp.length + e.fn.length === e.denomA, '口径 A 可由明细重算（一致 + FP + FN = 46）', e.matchesA + e.fp.length + e.fn.length);
check(e.matchesB === e.matchesA, '口径 B 分子 = 口径 A 分子（AMBIGUOUS 全不一致）', { A: e.matchesA, B: e.matchesB });
check(e.denomA === 46 && e.denomB === 48, '两个分母分别为 46 / 48', { denomA: e.denomA, denomB: e.denomB });

console.log('\n[口径 A] 确定性样本：' + e.matchesA + '/' + e.denomA + ' = ' + (e.agreeA * 100).toFixed(1) + '% ｜ 门槛 ' + (base.threshold * 100) + '% ⇒ ' + (e.agreeA >= base.threshold ? '达到' : '**未达到**') + ' ｜ FP=' + e.fp.length + ' FN=' + e.fn.length);
console.log('[口径 B] 全样本严格：' + e.matchesB + '/' + e.denomB + ' = ' + (e.agreeB * 100).toFixed(1) + '% ｜ 门槛 ' + (base.threshold * 100) + '% ⇒ ' + (e.agreeB >= base.threshold ? '达到' : '**未达到**') + ' ｜ AMBIGUOUS_MISMATCH=' + e.ambMismatch.length + (e.ambMismatch.length ? '（' + e.ambMismatch.map(r => r.pack_id).join(' ') + '）另列，未混入 FP/FN' : ''));

// ── 基线断言（**不自动更新**）──
const cmp: Array<[string, number, number]> = [
  ['denomA', e.denomA, base.baseline.denomA], ['matchesA', e.matchesA, base.baseline.matchesA],
  ['denomB', e.denomB, base.baseline.denomB], ['matchesB', e.matchesB, base.baseline.matchesB],
  ['fp', e.fp.length, base.baseline.fp], ['fn', e.fn.length, base.baseline.fn],
  ['ambiguousMismatch', e.ambMismatch.length, base.baseline.ambiguousMismatch],
];
const drift = cmp.filter(([, now, was]) => now !== was);
if (drift.length) {
  console.log('\n⚠️ **BASELINE MISMATCH**（基线不自动更新）：');
  for (const [k, now, was] of drift) console.log('    ' + k + ': 冻结 ' + was + ' → 本次 ' + now);
  console.log('    ⇒ 若这是新规则版本的结果，请**新建清单**（新 ruleVersion）并保留本次冻结结果；不得覆盖旧基线。');
  check(false, '本次结果与冻结基线一致', drift.map(([k, now, was]) => k + ' ' + was + '→' + now));
} else {
  check(true, '本次结果与冻结基线完全一致（A ' + e.matchesA + '/' + e.denomA + '、B ' + e.matchesB + '/' + e.denomB + '、FP ' + e.fp.length + '、FN ' + e.fn.length + '、AMBIGUOUS_MISMATCH ' + e.ambMismatch.length + '）');
}

// ── 门禁状态（本 harness 不改变 Gate 结论）──
check(base.baseline.gatePassed === (e.agreeA >= base.threshold && e.agreeB >= base.threshold), 'Gate 通过/未通过与冻结结论一致（harness 不改变 Gate 状态）', { frozen: base.baseline.gatePassed, now: e.agreeA >= base.threshold && e.agreeB >= base.threshold });
console.log('  · Gate 状态：' + (base.baseline.gatePassed ? '通过' : '**未通过** ⇒ 正式 A/B 继续禁止启动'));

// ── 输出隔离：写运行目录，绝不覆盖冻结报告 ──
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '_' + hGoldBefore.slice(0, 8) + (SELF_TEST ? '_selftest' : '');
const runDir = RUNS + '/' + runId;
mkdirSync(runDir, { recursive: true });
writeFileSync(runDir + '/detail.jsonl', e.detail.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf8');
writeFileSync(runDir + '/report.json', JSON.stringify({
  gateVersion: GATE_VERSION, ruleVersion: base.ruleVersion, threshold: base.threshold, runId,
  inputs: { gold: hGoldBefore, proxy: hProxyBefore },
  denominatorA: { n: e.denomA, matches: e.matchesA, agreement: Number(e.agreeA.toFixed(4)), pass: e.agreeA >= base.threshold, fp: e.fp.map(r => r.pack_id), fn: e.fn.map(r => r.pack_id) },
  denominatorB: { n: e.denomB, matches: e.matchesB, agreement: Number(e.agreeB.toFixed(4)), pass: e.agreeB >= base.threshold, ambiguousMismatch: e.ambMismatch.map(r => r.pack_id) },
  baselineDrift: drift.map(([k, now, was]) => ({ metric: k, frozen: was, now })),
  gatePassed: base.baseline.gatePassed,
  caveat: '机械断言只证明流程完整、自洽与可复算；**不能**证明评价标准本身正确。本 harness 不修改规则/门槛/gold，不计算 noise floor 或 guard baseline，不启动正式 A/B。',
}, null, 2) + '\n', 'utf8');

// ── 未改动输入与冻结报告 ──
check(sha(GOLD) === hGoldBefore && mt(GOLD) === mGold, 'final-gold.jsonl 未被本次运行改动');
check(sha(PROXY) === hProxyBefore && mt(PROXY) === mProxy, 'regex-proxy.jsonl 未被本次运行改动');
if (frozenMdBefore) check(sha(FROZEN_MD) === frozenMdBefore, '冻结报告 gate1-agreement.md 未被覆盖');
if (existsSync(FROZEN_JSON)) check(true, '冻结报告 gate1-agreement.json 保留在原位（本次写入 ' + runDir.replace(ROOT + '/', '') + '）');

if (SELF_TEST) {
  const detected = drift.length > 0;
  console.log('\n[自检] 篡改一条标签后是否被基线断言抓到: ' + (detected ? '✓ 抓到（符合预期）' : '✗ 未抓到（缺陷）'));
  console.log('ASSERTIONS: ' + (n - fails.length) + '/' + n);
  console.log('RESULT: ' + (detected ? 'PASS（自检通过：篡改被捕获）' : 'FAIL（自检失败：篡改未被捕获）'));
  process.exit(detected ? 0 : 1);
}

console.log('  → ' + runDir + '/report.json ｜ detail.jsonl');
console.log('  · 未计算 noise floor / guard baseline；未启动正式 A/B');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
