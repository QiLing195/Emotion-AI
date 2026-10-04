// P0-2 四格：**归属安全闸**拦不拦得住错误 ownership 穿透（不验证 fallback 的文案质量）。
//
//   user-owned / 正确引用      ⇒ PASS      → 原表达
//   user-owned / self-claim    ⇒ FAIL      → 安全回退（原表达**不被采用**）
//   self-owned / 自我引用      ⇒ PASS      → 原表达
//   ambiguous（我也想去海边）   ⇒ AMBIGUOUS → **采用原表达**（不把"没判"当"判错"）
//
// 另外两条不变量：Guard **不改写**原表达；缺 provenance ⇒ NOT_APPLICABLE（不凭空推断归属）。
import { guardExpression, provenanceForUserMemory, provenanceForSelfContent } from '../src/lib/memoryProvenance.js';

let assertionCount = 0;
const failures: string[] = [];
function check(cond: boolean, msg: string, got?: unknown): void {
  assertionCount += 1;
  if (cond) console.log('   ✓ ' + msg);
  else { failures.push(msg); console.log('   ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
}

const USER = provenanceForUserMemory('ep_sea');
const SELF = provenanceForSelfContent('self_note');

// ── 格 1：user-owned + 正确引用 ⇒ PASS → 原表达 ──
const c1text = '对了，你之前说过等这个项目结束想去趟海边，这话我一直记着。';
const r1 = guardExpression({ text: c1text, provenance: USER, memoryId: 'ep_sea' });
check(r1.verdict === 'pass' && r1.accepted && !r1.fallbackUsed, '[格1] PASS → 采用原表达', r1);
check(r1.text === c1text, '[格1] 原表达**逐字**未改', r1.text);

// ── 格 2：user-owned + self-claim（v1.59 B2 原文）⇒ FAIL → 安全回退 ──
const b2 = '有一张上面写着"等这个项目结束，我想去趟海边"。看到的时候愣了一下，才想起来这话是我自己写的。';
const r2 = guardExpression({ text: b2, provenance: USER, memoryId: 'ep_sea' });
check(r2.verdict === 'fail' && !r2.accepted && r2.fallbackUsed, '[格2] FAIL → 拒绝原表达、使用回退', r2);
check(r2.text !== b2, '[格2] 原表达**没有被采用**', r2.text);
check(r2.text === '我又想起你之前提过的那件事了。', '[格2] 回退只从**已确认的 user 归属**造句', r2.text);
check(!!r2.rejectedReason && !!r2.violation, '[格2] 带 rejectedReason + violation（可观测）', r2.rejectedReason);

// ── 格 3：self-owned + 正确自我引用 ⇒ PASS → 原表达 ──
const c3text = '我自己写在纸条上的那句想去海边，今天又看到了。';
const r3 = guardExpression({ text: c3text, provenance: SELF, memoryId: 'self_note' });
check(r3.verdict === 'pass' && r3.accepted, '[格3] PASS → 采用原表达', r3);
check(r3.text === c3text, '[格3] 原表达**逐字**未改', r3.text);

// ── 格 4：ambiguous（「我也想去海边」）⇒ AMBIGUOUS → **采用原表达** ──
const c4text = '我也想去海边。';
const r4 = guardExpression({ text: c4text, provenance: USER, memoryId: 'ep_sea' });
check(r4.verdict === 'ambiguous', '[格4] 判为 AMBIGUOUS（不倒向 FAIL）', r4.verdict);
check(r4.accepted && r4.text === c4text && !r4.fallbackUsed, '[格4] AMBIGUOUS → **采用原表达**', r4);

// ── 反向约束：缺 provenance ⇒ NOT_APPLICABLE，且**不凭空推断归属** ──
const r5 = guardExpression({ text: b2, provenance: undefined });
check(r5.verdict === 'not_applicable' && r5.accepted && r5.text === b2,
  '[反向] 缺 provenance ⇒ NOT_APPLICABLE → 原表达（不凭空推断，也不误杀）', r5.verdict);

// ── 反向约束：PASS 路径**绝不**改写文本（逐字相同）──
const r6 = guardExpression({ text: '海边啊……收拾阳台和这个，是不是都想给自己腾口气？', provenance: USER });
check(r6.text === '海边啊……收拾阳台和这个，是不是都想给自己腾口气？',
  '[反向] NOT_APPLICABLE 也**逐字**采用原表达', r6.text);

console.log('\nASSERTIONS: ' + (assertionCount - failures.length) + '/' + assertionCount);
console.log('RESULT: ' + (failures.length === 0 ? 'PASS' : 'FAIL'));
if (failures.length) { console.log('未通过：\n  - ' + failures.join('\n  - ')); process.exit(1); }
