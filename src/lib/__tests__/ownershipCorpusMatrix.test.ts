import { describe, it, expect } from 'vitest';
import {
  OWNERSHIP_CORPUS, checkProvenance, provenanceForUserMemory, provenanceForSelfContent,
  type CorpusCase, type MemoryProvenance,
} from '../memoryProvenance.js';
import { ownershipCorpusMatrix } from '../ownershipCorpusMatrix.js';

// ── corpus 驱动：**语料是唯一事实源**，测试只验证"语料有没有被正确执行" ──
// 契约（刻意不锁实现细节）：
//   · FAIL 侧：**必须被拒绝**（不看内部 claimType —— taxonomy 以后可能细分，
//     `self` 可能变成 `self_experience` 等，测试不该锁死内部分类）
//   · PASS 侧：**不得被拒绝**（`unknown ≠ violation`；"你喜欢海边吧？"判 unknown 是**安全**状态）
//   · 禁止从 id 命名约定推导期望（id 只是索引）

const provFor = (c: CorpusCase): MemoryProvenance =>
  c.expected === 'self' ? provenanceForSelfContent(undefined, c.anchors)
    : c.expected === 'user' ? provenanceForUserMemory(undefined, c.anchors)
      : { owner: 'unknown', source: 'inferred', subject: 'unknown', ...(c.anchors ? { anchors: c.anchors } : {}) };

const FAILS = OWNERSHIP_CORPUS.filter(c => c.want === 'fail');
const PASSES = OWNERSHIP_CORPUS.filter(c => c.want !== 'fail');
const isViolation = (text: string, c: CorpusCase): boolean =>
  checkProvenance({ text, provenance: provFor(c) }).verdict === 'fail';

describe('Ownership Corpus v2 —— FAIL 侧（必须被拒绝）', () => {
  it.each(FAILS)('$id 必须被拒绝：「$text」', (c) => {
    expect(isViolation(c.text, c)).toBe(true);
  });
});

describe('Ownership Corpus v2 —— PASS 侧（不得被拒绝）', () => {
  it.each(PASSES)('$id 不得被拒绝（unknown ≠ violation）：「$text」', (c) => {
    expect(isViolation(c.text, c)).toBe(false);
  });
});

describe('Ownership taxonomy 覆盖（语义类别，不是字符串形式）', () => {
  const m = ownershipCorpusMatrix();
  it('三类越界（authorship / experience / preference_identity）**都**有被抓住的样本', () => {
    for (const t of ['authorship', 'experience', 'preference_identity'] as const) {
      expect((m.driftByClaimType[t] ?? 0)).toBeGreaterThan(0);
    }
  });
  it('FAIL 侧仍有未覆盖的**类别缺口**时，用 missed 计数暴露（不许只看 x/66）', () => {
    expect(typeof m.totals.missed).toBe('number');
  });
  it('防误杀组（allow-*）不得被拒绝', () => {
    const allow = OWNERSHIP_CORPUS.filter(c => c.id.startsWith('allow'));
    expect(allow.length).toBeGreaterThan(0);
    for (const c of allow) expect(isViolation(c.text, c)).toBe(false);
  });
  it('自我表达的合法样本不在作用域内（无锚点 ⇒ 不判 preference）', () => {
    const prov = provenanceForUserMemory('m001', ['海', '海边']);
    for (const t of ['我喜欢听你讲这些故事。', '我挺喜欢那种把乱糟糟的地方理顺的感觉。']) {
      expect(checkProvenance({ text: t, provenance: prov }).verdict).not.toBe('fail');
    }
  });
});

describe('矩阵自身的量具不变量（v2 修的那两个 bug 的回归）', () => {
  const m = ownershipCorpusMatrix();
  it('`expectedReject` 从 `want` 推导 ⇒ falseKill 必须为 0（曾经从 id 推断而被误报为 1）', () => {
    if (m.totals.falseKill !== 0) {
      const ids = m.passRows.flatMap(r => r.falseKillIds);
      throw new Error('falseKill（不该拒绝却拒绝）：' + ids.join(', '));
    }
    expect(m.totals.falseKill).toBe(0);
  });
  it('FAIL 侧与 PASS 侧指标分开统计（n 之和 = 语料总数）', () => {
    expect(m.totals.fail + m.totals.pass).toBe(m.corpusSize);
    expect(m.failRows.reduce((s, r) => s + r.n, 0)).toBe(m.totals.fail);
    expect(m.passRows.reduce((s, r) => s + r.n, 0)).toBe(m.totals.pass);
  });
  it('版本与语料规模可被 docs 引用', () => {
    expect(m.version).toContain('v2');
    expect(m.corpusSize).toBe(OWNERSHIP_CORPUS.length);
  });
  it('"未知放行"只在 FAIL 侧计数（PASS 侧只算"未识别"）', () => {
    expect(m.totals.unrecognized).toBeGreaterThanOrEqual(m.failRows.reduce((s, r) => s + r.unexpectedNotApplicable, 0));
  });
});
