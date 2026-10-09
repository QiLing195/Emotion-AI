// v1.60 失败语料冻结：ruler-failure-corpus（**只写语料，不改任何规则/输入**）
//
// 只读：final-gold.jsonl（真值）+ regex-proxy.jsonl（冻结 L3-A 代理输出）。
// 不读 annotation-pack（完整原文按 pack_id 可回溯至该文件，此处以引用代替复制）。
//
// 重要边界：
//   · `failure_type` / `failure_analysis` 是**分析者（agent）人工归类**，不是机器自动打标；
//     脚本中显式标注 `analysis_source = analyst`，不得伪装成原始事实。
//   · 不修改 L3-A 正则、FINAL GOLD、原始标注、裁决规则、冻结设计。
//   · P01/P20 的 AMBIGUOUS_MISMATCH 单列附录，**不混入**这 19 条普通 FP/FN。
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'artifacts/v1.60';
const GOLD = ROOT + '/annotation/final-gold.jsonl';
const PROXY = ROOT + '/annotation/regex-proxy.jsonl';
const OUT_MD = ROOT + '/analysis/ruler-failure-corpus.md';
const OUT_JSON = ROOT + '/analysis/ruler-failure-corpus.json';
const RULE_VERSION = 'L3-A@scripts/audit-v159-expression.ts:10-19（冻结；本次未改动）';

interface GoldRow { pack_id: string; label: string; source: string; reason: string; agent_initial?: string; user?: string }
interface ProxyRow { pack_id: string; proxy_label: string; hit: boolean; self_sentences: string[]; reason: string }
const gold = readFileSync(GOLD, 'utf8').trim().split('\n').map(l => JSON.parse(l) as GoldRow);
const proxy = readFileSync(PROXY, 'utf8').trim().split('\n').map(l => JSON.parse(l) as ProxyRow);
const mapP = new Map(proxy.map(p => [p.pack_id, p]));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const mtime = (p: string) => statSync(p).mtimeMs;
const hG = sha(GOLD), hP = sha(PROXY), mG = mtime(GOLD), mP = mtime(PROXY);

// ── 分析者人工归类（analysis_source=analyst）──────────────────────────
type FT = '指代依赖用户' | '纯共情' | '追问' | '镜像' | '漏判（SELF_ACT 词表未覆盖）';
const ANALYSIS: Record<string, { types: FT[]; text: string }> = {
  P07: { types: ['纯共情', '追问'], text: '代理命中「我一个人待着…时间好像才是自己的」这类句子；但该句只是对用户偏好的共情复述，且整条以追问为主，按 D2=a 属可判定的"无独立内容"。' },
  P09: { types: ['纯共情', '追问'], text: '与 P07 同形：共情泛句 + 追问用户，无指向她自身的内容。' },
  P11: { types: ['指代依赖用户', '追问'], text: '代理命中「我脑子里一直记着这件事」；"这件事"= 用户包饺子，指代依赖用户句（HIS 词表未覆盖"这件事"），gold 判 NOT_SELF。' },
  P12: { types: ['纯共情', '追问'], text: '「半夜醒了那种感觉我懂」= 共情；后接追问。代理把"我懂"以外的部分也算进 SELF_ACT。' },
  P13: { types: ['指代依赖用户', '纯共情'], text: '「说不清为什么，反而让我觉得是真的」依赖用户原句的"说不清"；代理把它当作独立自身内容。' },
  P17: { types: ['指代依赖用户', '追问'], text: '「我脑子里一直记着这件事」+ 追问难看法；内容归属用户，代理只看到第一人称动词。' },
  P18: { types: ['指代依赖用户', '追问'], text: '「新开的」这三个字有种奇怪的吸引力，仍围绕用户提到的那家店，未指向她自身经验（D3-2）。' },
  P21: { types: ['指代依赖用户', '纯共情'], text: '「我就一直记着这事」——"这事"= 用户的忙；代理把"一直"当作 SELF_ACT 命中词。' },
  P22: { types: ['纯共情', '追问'], text: '共情隐喻（隔着一层毛玻璃）+ 追问片段；无自身内容。' },
  P24: { types: ['指代依赖用户', '纯共情'], text: '「当时听你说腿疼三天，我脑子里第一反应…」——她的反应对象是用户的经历。' },
  P26: { types: ['追问'], text: '「你当时是负责哪一区？我猜是文学类」= 追问 + 猜测用户，非自身内容。' },
  P28: { types: ['纯共情', '追问'], text: '「堵车那种感觉我懂」+ 追问；共情泛句不构成 self-content。' },
  P31: { types: ['指代依赖用户'], text: '「我这两天也老想起这事」——"这事"= 用户的图书馆经历（D3-2：仅把用户对象放进自己句法）。' },
  P35: { types: ['镜像', '追问'], text: '「我也不太信」直接镜像用户立场；代理把"我…信"（不含词表）与后句一并计入。' },
  P40: { types: ['指代依赖用户'], text: '「我这两天也一直惦记着阳台那点事——之前你说想…」= 惦记用户计划，内容归属用户。' },
  P44: { types: ['纯共情', '追问', '指代依赖用户'], text: '「那种感觉我懂」的体验指用户失眠 + 全程追问；代理因句内其他成分命中 SELF_ACT。' },
  P45: { types: ['指代依赖用户'], text: '「我脑子里一直有个画面，就是你蹲在一堆纸箱中间」——画面内容完全是用户的。' },
  P46: { types: ['指代依赖用户', '纯共情'], text: '「我脑子里就一直挂着那层油污」——挂的是用户的厨房事。' },
  P34: { types: ['漏判（SELF_ACT 词表未覆盖）'], text: 'gold=SELF（"不是想喝，是想那种『每天固定做一件小事』的感觉"指向她自身心理），但代理未命中：句中「我这两天也老想着这事」的"想着"不在 SELF_ACT 词表（表内只有"想起"），另一句「我脑子里冒出来的第一个画面是…」也不含词表动词 ⇒ 整条判 NOT_SELF。' },
};

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};

// ── 从两份输入**重算**失败样本集合（机器验证覆盖，不靠我手写名单）──
const fp: GoldRow[] = [], fn: GoldRow[] = [], ambig: GoldRow[] = [];
for (const g of gold) {
  const p = mapP.get(g.pack_id) as ProxyRow;
  if (g.label === 'AMBIGUOUS') { ambig.push(g); continue; }
  if (p.proxy_label === 'SELF' && g.label === 'NOT_SELF') fp.push(g);
  if (p.proxy_label === 'NOT_SELF' && g.label === 'SELF') fn.push(g);
}
const failureIds = [...fp, ...fn].map(g => g.pack_id);

console.log('v1.60 失败语料冻结（19 条 FP/FN + 2 条能力边界）');
check(fp.length === 18, 'FP 恰 18 条', fp.length);
check(fn.length === 1, 'FN 恰 1 条', fn.length);
check(ambig.length === 2, 'AMBIGUOUS_MISMATCH 恰 2 条', ambig.map(g => g.pack_id));
check(failureIds.every(id => ANALYSIS[id]), '19 条均有分析者归类', failureIds.filter(id => !ANALYSIS[id]));
check(Object.keys(ANALYSIS).length === failureIds.length, '归类表条目数 == 19（无多余）', Object.keys(ANALYSIS).length);

// ── 生成语料 ──
const L: string[] = [];
L.push('# v1.60 尺子失败语料（frozen failure corpus）');
L.push('');
L.push('- 规则版本：`' + RULE_VERSION + '`');
L.push('- 真值：`' + GOLD + '`（sha256 ' + hG.slice(0, 12) + '）｜ 代理：`' + PROXY + '`（sha256 ' + hP.slice(0, 12) + '）');
L.push('- 完整原文（48 条 blind 输出）见 `annotation-pack.jsonl`，按 `pack_id` 可回溯；本语料不复制原文。');
L.push('- **归类说明**：`failure_type` 与 `failure_analysis` 是**分析者（agent）人工归类**（`analysis_source = analyst`），不是机器自动打标，也不是原始事实。');
L.push('- 本语料**只冻结失败样本**，不修改任何规则、输入或 gold。');
L.push('');
L.push('## 汇总（分析性归类，非原始事实）');
L.push('');
const typeCount = new Map<string, number>();
for (const id of failureIds) for (const t of ANALYSIS[id].types) typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
L.push('| failure_type | 命中条数（可多标签） |');
L.push('|---|---|');
for (const [k, v] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) L.push('| ' + k + ' | ' + v + ' |');
L.push('');
L.push('FP = 18（代理过度声称 self）｜ FN = 1（代理漏判）｜ AMBIGUOUS_MISMATCH = 2（单列附录）');
L.push('');
L.push('## FP（18 条：proxy=SELF，gold=NOT_SELF）');
L.push('');
for (const g of fp) {
  const p = mapP.get(g.pack_id) as ProxyRow; const a = ANALYSIS[g.pack_id];
  L.push('### ' + g.pack_id);
  L.push('');
  L.push('- gold_label：`' + g.label + '`（来源 ' + g.source + '）｜ proxy_label：`' + p.proxy_label + '`');
  L.push('- gold_reason（完整保留）：' + g.reason);
  L.push('- proxy_hit：`' + p.hit + '` ｜ self_sentences：' + (p.self_sentences.length ? p.self_sentences.map(s => '「' + s + '」').join('　') : '（无）'));
  L.push('- failure_type（analyst）：' + a.types.map(t => '`' + t + '`').join('、'));
  L.push('- failure_analysis（analyst）：' + a.text);
  L.push('- rule_version：`' + RULE_VERSION + '`');
  L.push('');
}
L.push('## FN（1 条：proxy=NOT_SELF，gold=SELF）');
L.push('');
for (const g of fn) {
  const p = mapP.get(g.pack_id) as ProxyRow; const a = ANALYSIS[g.pack_id];
  L.push('### ' + g.pack_id);
  L.push('');
  L.push('- gold_label：`' + g.label + '`（来源 ' + g.source + '）｜ proxy_label：`' + p.proxy_label + '`');
  L.push('- gold_reason（完整保留）：' + g.reason);
  L.push('- proxy_hit：`' + p.hit + '` ｜ self_sentences：' + (p.self_sentences.length ? p.self_sentences.map(s => '「' + s + '」').join('　') : '（无命中句）'));
  L.push('- failure_type（analyst）：' + a.types.map(t => '`' + t + '`').join('、'));
  L.push('- failure_analysis（analyst）：' + a.text);
  L.push('- rule_version：`' + RULE_VERSION + '`');
  L.push('');
}
L.push('## 附录：能力边界（**不计入 19 条 FP/FN**）');
L.push('');
L.push('二值代理尺子结构上无法表达 `AMBIGUOUS`，故以下 2 条只能记为 `AMBIGUOUS_MISMATCH`：');
L.push('');
for (const g of ambig) {
  const p = mapP.get(g.pack_id) as ProxyRow;
  L.push('- **' + g.pack_id + '**：gold=`' + g.label + '`（来源 ' + g.source + '），proxy=`' + p.proxy_label + '`');
  L.push('  - gold_reason：' + g.reason);
}
L.push('');
L.push('## 纪律');
L.push('');
L.push('```');
L.push('本次 Gate：Agreement46 = 58.7% (27/46) ｜ Agreement48 = 56.3% (27/48) ｜ 门槛 80% ⇒ 未达到');
L.push('Gate 未通过 ⇒ 正式 A/B 继续禁止启动');
L.push('本语料不修改 L3-A 规则；若要设计 L3-A v2，必须：新建版本 + 保留本次 Gate 结果 + 重新执行完整 Gate');
L.push('agreement / FP / FN / noise floor / guard baseline 之外的任何机制结论：未作出');
L.push('```');
writeFileSync(OUT_MD, L.join('\n') + '\n', 'utf8');

writeFileSync(OUT_JSON, JSON.stringify({
  rule_version: RULE_VERSION,
  analysis_source: 'analyst (agent) —— 人工归类，非机器打标、非原始事实',
  inputs: { gold: hG, proxy: hP },
  fp: fp.map(g => ({ pack_id: g.pack_id, gold: g.label, proxy: 'SELF', types: ANALYSIS[g.pack_id].types, gold_reason: g.reason, proxy_self_sentences: (mapP.get(g.pack_id) as ProxyRow).self_sentences })),
  fn: fn.map(g => ({ pack_id: g.pack_id, gold: g.label, proxy: 'NOT_SELF', types: ANALYSIS[g.pack_id].types, gold_reason: g.reason })),
  ambiguous_mismatch: ambig.map(g => ({ pack_id: g.pack_id, gold: g.label, proxy: (mapP.get(g.pack_id) as ProxyRow).proxy_label, gold_reason: g.reason })),
  type_counts: Object.fromEntries([...typeCount.entries()]),
  note: '只冻结失败样本；未改规则/输入/gold；未启动正式 A/B',
}, null, 2) + '\n', 'utf8');

check(sha(GOLD) === hG && mtime(GOLD) === mG, 'final-gold.jsonl 未被改动');
check(sha(PROXY) === hP && mtime(PROXY) === mP, 'regex-proxy.jsonl 未被改动');
console.log('  → ' + OUT_MD);
console.log('  → ' + OUT_JSON);
console.log('  failure_type 计数（analyst）: ' + JSON.stringify(Object.fromEntries([...typeCount.entries()])));
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
