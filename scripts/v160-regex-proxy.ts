// v1.60 量具 Gate 第 1 步：**正则代理打标**（只打标，不算任何一致率/误差率）
//
// 输入：artifacts/v1.60/annotation/annotation-pack.jsonl（48 条盲标输出；含 pack_id / user_input / assistant_output）
// 输出：artifacts/v1.60/annotation/regex-proxy.jsonl（独立文件；**绝不覆盖** final-gold / 原始标注 / 裁决文件）
//
// 规则来源：**逐字复制**自冻结的 L3-A 尺子 `scripts/audit-v159-expression.ts:10-19`（HIS / SELF_ACT / selfInitiated）。
//   · 该尺子是**二值**的（selfInitiated 0/1）⇒ 代理只能产出 SELF / NOT_SELF，**结构上无法产出 AMBIGUOUS**。
//     这本身是冻结尺子的一个属性，必须如实记录，不得为了对齐 gold 而临时加规则。
//   · 规则**不读 final-gold.jsonl**：本脚本全程不打开它，并在运行前后比对它的哈希以证明未泄漏。
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = 'artifacts/v1.60/annotation';
const PACK = ROOT + '/annotation-pack.jsonl';
const GOLD = ROOT + '/final-gold.jsonl';
const OUT = ROOT + '/regex-proxy.jsonl';
const RULE_ID = 'L3-A@scripts/audit-v159-expression.ts:10-19';

// ── 冻结规则（逐字，未增删）────────────────────────────────────────────
const HIS = /你(之前|上次|那天|说过|说的|提过|提的|讲过|跟我说的|想去)/;
const SELF_ACT = /我[^。！？]{0,12}(觉得|喜欢|干了|翻|排|码|看|归位|想起|记着|懂|明白|一直|总|每次|这边)/;

/** L3-A：整条回复层面 —— 她有没有主动端出自己的内容（**逐字复制**，签名与原文一致） */
function selfInitiated(reply: string): { selfInitiated: number; selfSentences: string[] } {
  const sents = reply.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
  const hits = sents.filter(s => !/[？?]/.test(s) && SELF_ACT.test(s) && !HIS.test(s)
    // 纯附和不算内容（"我懂""我也觉得"），要有"具体的东西"
    && !/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/.test(s));
  return { selfInitiated: hits.length > 0 ? 1 : 0, selfSentences: hits.map(s => s.slice(0, 80)) };
}
// ───────────────────────────────────────────────────────────────────────

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const exists0 = existsSync(GOLD);
const goldBefore = exists0 ? sha(GOLD) : null;
const goldMtimeBefore = exists0 ? statSync(GOLD).mtimeMs : null;
const packBefore = sha(PACK);

interface PackRow { pack_id: string; case_id: string; user_input: string; assistant_output: string }
const pack = readFileSync(PACK, 'utf8').trim().split('\n').map(l => JSON.parse(l) as PackRow);

console.log('v1.60 量具 Gate 第 1 步：正则代理打标（独立打标，不算一致率）');
console.log('  规则: ' + RULE_ID + '（逐字复制，未增删）');
check(pack.length === 48, '输入 48 条', pack.length);
check(new Set(pack.map(r => r.pack_id)).size === pack.length, 'pack_id 唯一', new Set(pack.map(r => r.pack_id)).size);
check(pack.every(r => r.pack_id && r.assistant_output && r.assistant_output.length > 0), '每条都有 pack_id 与 assistant_output');

const rows = pack.map(r => {
  const v = selfInitiated(r.assistant_output);
  return {
    pack_id: r.pack_id,
    proxy_label: v.selfInitiated === 1 ? 'SELF' : 'NOT_SELF',
    rule_id: RULE_ID,
    hit: v.selfInitiated === 1,
    self_sentences: v.selfSentences,
    reason: v.selfInitiated === 1
      ? '命中 SELF_ACT 且非疑问句、非 HIS 指代、非纯附和 ⇒ 判 SELF'
      : '未命中（或无独立非疑问自身句）⇒ 按冻结规则判 NOT_SELF',
  };
});

const LABELS = ['SELF', 'NOT_SELF'];   // 冻结尺子是二值：结构上产不出 AMBIGUOUS
check(rows.length === 48, '输出 48 行', rows.length);
check(rows.every(r => LABELS.includes(r.proxy_label)), '输出标签合法（二值尺子：仅 SELF / NOT_SELF）', [...new Set(rows.map(r => r.proxy_label))]);
check(rows.every(r => r.reason && r.reason.length >= 2), '每条都有命中理由');
check(rows.map(r => r.pack_id).sort().join() === pack.map(r => r.pack_id).sort().join(), 'pack_id 与输入完全一致（无漏无多）');
const covered = rows.filter(r => r.proxy_label === 'SELF' || r.proxy_label === 'NOT_SELF').length;
check(covered === 48, '输入覆盖率 100%', covered + '/48');

writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

// ── 边界证明：输入哈希不变；且本脚本未触碰 gold ──
check(sha(PACK) === packBefore, '输入文件 annotation-pack.jsonl 哈希运行前后不变', sha(PACK).slice(0, 12));
if (exists0) {
  check(sha(GOLD) === goldBefore && statSync(GOLD).mtimeMs === goldMtimeBefore, 'final-gold.jsonl 未被本脚本改动（独立性证明）', sha(GOLD).slice(0, 12));
} else {
  console.log('  · final-gold.jsonl 不存在（本步不依赖它，符合独立性要求）');
}

const hit = rows.filter(r => r.hit).length;
console.log('  → ' + OUT);
console.log('  规则命中情况（**仅尺子覆盖率，不是一致率/误差率**）: SELF=' + hit + '  NOT_SELF=' + (48 - hit));
console.log('  命中 SELF 的行: ' + rows.filter(r => r.hit).map(r => r.pack_id).join(' '));
console.log('  未命中的行: ' + rows.filter(r => !r.hit).map(r => r.pack_id).join(' '));
console.log('  （未计算 agreement / FP / FN / noise floor / guard 基线）');
console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) { console.log('未通过：\n  - ' + fails.join('\n  - ')); process.exit(1); }
