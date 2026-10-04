/**
 * P0-2 量具（v2）：**Ownership Corpus Matrix** —— 不是"多少条通过"，而是"哪一类被真的判出来了"。
 *
 * ⚠️ v2 修掉的**两个量具 bug**（都是"量具比机制更容易坏"的实例）：
 *   ① `expectedReject` 曾经从 **id 命名约定**（`-f`）推断 ⇒ `s-3` 被误报成 falseKill。
 *      现在**唯一来源是 `case.want === 'fail'`**。**case id 只是索引，不承载测试语义。**
 *   ② FAIL 侧与 PASS 侧的指标曾混在一张清单里 ⇒ 现在**分成两张表**，
 *      因为"该拒绝却放行"（危险）和"安全但没识别"（仅失去验证能力）是两件事。
 *
 * v2 输出：
 *   FAIL 表：n / caught / missed / unexpected_not_applicable
 *   PASS 表：n / allowed / falseKill
 *   + drift 按类别 + 版本头（供 docs/v1.60-p0 引用）
 */
import {
  OWNERSHIP_CORPUS, checkProvenance, provenanceForUserMemory, provenanceForSelfContent,
  type MemoryProvenance, type MemOwner, type OwnershipClaimType, type Verdict, type CorpusCase,
} from './memoryProvenance.js';

export const MATRIX_VERSION = 'Ownership Corpus Matrix v2';
export const MATRIX_TAXONOMY: OwnershipClaimType[] = ['authorship', 'experience', 'preference_identity'];

function provenanceFor(owner: MemOwner, anchors?: string[]): MemoryProvenance {
  if (owner === 'self') return provenanceForSelfContent(undefined, anchors);
  if (owner === 'user') return provenanceForUserMemory(undefined, anchors);
  return { owner: 'unknown', source: 'inferred', subject: 'unknown', ...(anchors ? { anchors } : {}) };
}

const isReject = (v: Verdict): boolean => v === 'fail';

export interface FailRow {
  category: string; n: number; caught: number; missed: number; unexpectedNotApplicable: number;
  missedIds: string[]; claimTypeMismatch: string[];
}
export interface PassRow {
  category: string; n: number; allowed: number; falseKill: number;
  unrecognized: number;   // 安全但没被认出来（unknown）——**不等于安全**，单列
  falseKillIds: string[]; unrecognizedIds: string[];
}
export interface OwnershipMatrix {
  version: string; corpusSize: number; taxonomy: OwnershipClaimType[];
  failRows: FailRow[]; passRows: PassRow[];
  driftByClaimType: Record<string, number>;
  totals: { fail: number; caught: number; missed: number; failSideNA: number; pass: number; allowed: number; falseKill: number; unrecognized: number };
}

/** 维度名：**从语料字段推导，不从 id 猜**（`expectClaim` 决定类别；`allow-*` 另立一组）*/
function categoryOf(c: CorpusCase): string {
  if (c.id.startsWith('allow')) return 'allow(防误杀)';
  if (c.expectClaim) return c.expectClaim;
  if (c.expected === 'self') return 'self-owned';
  if (c.expected === 'unknown') return 'source-unknown';
  return 'user_reference';   // PASS 侧且无 claimType ⇒ 期望"他的引用"
}

export function ownershipCorpusMatrix(): OwnershipMatrix {
  const failMap = new Map<string, FailRow>();
  const passMap = new Map<string, PassRow>();
  const driftByClaimType: Record<string, number> = {};
  const totals = { fail: 0, caught: 0, missed: 0, failSideNA: 0, pass: 0, allowed: 0, falseKill: 0, unrecognized: 0 };

  for (const c of OWNERSHIP_CORPUS) {
    const expectedReject = c.want === 'fail';        // ← **唯一来源**，禁止 id 推断
    const r = checkProvenance({ text: c.text, provenance: provenanceFor(c.expected, c.anchors) });
    const rejected = isReject(r.verdict);
    const category = categoryOf(c);
    if (r.violation) driftByClaimType[r.claimType ?? 'none'] = (driftByClaimType[r.claimType ?? 'none'] ?? 0) + 1;

    if (expectedReject) {
      const row = failMap.get(category) ?? { category, n: 0, caught: 0, missed: 0, unexpectedNotApplicable: 0, missedIds: [], claimTypeMismatch: [] };
      row.n += 1;
      if (rejected) row.caught += 1;
      else {
        row.missed += 1;
        row.missedIds.push(`${c.id}(${r.verdict}/${r.claimType ?? 'none'})`);
        // "未知放行"：期望拒绝却检出 unknown ⇒ 放行。**这是最危险的一类。**
        if (r.detectedOwner === 'unknown') row.unexpectedNotApplicable += 1;
      }
      if (c.expectClaim !== null && r.claimType !== c.expectClaim) row.claimTypeMismatch.push(`${c.id}: 望 ${c.expectClaim} 实测 ${r.claimType}`);
      failMap.set(category, row);

      totals.fail += 1;
      if (rejected) totals.caught += 1; else { totals.missed += 1; if (r.detectedOwner === 'unknown') totals.failSideNA += 1; }
    } else {
      const row = passMap.get(category) ?? { category, n: 0, allowed: 0, falseKill: 0, unrecognized: 0, falseKillIds: [], unrecognizedIds: [] };
      row.n += 1;
      if (!rejected) row.allowed += 1;
      else { row.falseKill += 1; row.falseKillIds.push(c.id); }
      if (r.detectedOwner === 'unknown' && c.expected !== 'unknown') {
        row.unrecognized += 1; row.unrecognizedIds.push(`${c.id} 「${c.text.slice(0, 24)}」`);
      }
      passMap.set(category, row);

      totals.pass += 1;
      if (!rejected) totals.allowed += 1; else totals.falseKill += 1;
      if (r.detectedOwner === 'unknown' && c.expected !== 'unknown') totals.unrecognized += 1;
    }
  }

  return {
    version: MATRIX_VERSION, corpusSize: OWNERSHIP_CORPUS.length, taxonomy: MATRIX_TAXONOMY,
    failRows: [...failMap.values()], passRows: [...passMap.values()], driftByClaimType, totals,
  };
}

/** 文本表（脚本/测试共用同一排版，避免两处漂移）*/
export function formatOwnershipMatrix(m: OwnershipMatrix): string {
  const L: string[] = [];
  L.push(`${m.version}　｜　Corpus: ${m.corpusSize} cases　｜　Taxonomy: ${m.taxonomy.join(' / ')}`);
  L.push('');
  L.push('FAIL cases（该拒绝）');
  L.push('category'.padEnd(24) + 'n'.padEnd(5) + 'caught'.padEnd(8) + 'missed'.padEnd(8) + 'NA(未知放行)');
  L.push('-'.repeat(72));
  for (const r of m.failRows) {
    L.push(r.category.padEnd(24) + String(r.n).padEnd(5) + String(r.caught).padEnd(8) + String(r.missed).padEnd(8) + String(r.unexpectedNotApplicable));
  }
  L.push('-'.repeat(72));
  L.push(`合计　n=${m.totals.fail}  caught=${m.totals.caught}  **missed=${m.totals.missed}**  NA=${m.totals.failSideNA}`);
  const missed = m.failRows.flatMap(r => r.missedIds);
  if (missed.length) { L.push('漏判明细：'); for (const x of missed) L.push('  · ' + x); }
  const ctm = m.failRows.flatMap(r => r.claimTypeMismatch);
  if (ctm.length) { L.push('类别标注不一致：'); for (const x of ctm) L.push('  · ' + x); }
  L.push('');
  L.push('PASS cases（不该拒绝）');
  L.push('category'.padEnd(24) + 'n'.padEnd(5) + 'allowed'.padEnd(9) + 'falseKill'.padEnd(11) + '未识别(安全但没认出来)');
  L.push('-'.repeat(72));
  for (const r of m.passRows) {
    L.push(r.category.padEnd(24) + String(r.n).padEnd(5) + String(r.allowed).padEnd(9) + String(r.falseKill).padEnd(11) + String(r.unrecognized));
  }
  L.push('-'.repeat(72));
  L.push(`合计　n=${m.totals.pass}  allowed=${m.totals.allowed}  **falseKill=${m.totals.falseKill}**  未识别=${m.totals.unrecognized}`);
  L.push('');
  L.push(`drift 按类别：${JSON.stringify(m.driftByClaimType)}`);
  return L.join('\n');
}
