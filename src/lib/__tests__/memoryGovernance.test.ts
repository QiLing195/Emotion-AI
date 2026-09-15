// ── memoryGovernance 独立单元测试 ──
// 覆盖：三条件证据判定 / 分类型 margin / 状态机转移与权限 / 审计 / 序列化 /
//       recordFromDecision / 使用许可映射 / episode 候选评估
import { describe, it, expect } from 'vitest';
import {
  EvidenceVerifier,
  DEFAULT_VERIFIER,
  RECOMMENDED_MARGINS_BY_TYPE,
  MemoryLedger,
  assessEpisodeCandidate,
  recallAllowance,
  isProactivelyRecallable,
  type VerificationDecision,
  type MemoryStatus,
} from '../memoryGovernance';

// ── 1. EvidenceVerifier：三条件保守判定 ──
describe('EvidenceVerifier — 三条件保守判定', () => {
  it('分数够但信息不完整（coverage 低）→ ambiguous（存疑待审，而非直接丢弃）', () => {
    const d = DEFAULT_VERIFIER.decide({ score: 0.9, runnerUp: 0.1, coverage: 0.3 });
    expect(d.status).toBe('ambiguous');
    expect(d.reason).toBe('insufficient_semantic_coverage');
  });

  it('分数低于支持阈值 → unknown（弱候选不值得治理，保持旧行为放行）', () => {
    const d = DEFAULT_VERIFIER.decide({ score: 0.3, runnerUp: 0.1, coverage: 0.8 });
    expect(d.status).toBe('unknown');
    expect(d.reason).toBe('score_below_support_threshold');
  });

  it('margin 不足 → ambiguous（疑似重复/证据不够）', () => {
    const d = DEFAULT_VERIFIER.decide({ score: 0.6, runnerUp: 0.55, coverage: 0.8 });
    expect(d.status).toBe('ambiguous');
    expect(d.reason).toBe('candidate_margin_too_small_or_duplicate');
  });

  it('三者全过 → supported（仍需 review 才能 verified）', () => {
    const d = DEFAULT_VERIFIER.decide({ score: 0.8, runnerUp: 0.2, coverage: 0.8 });
    expect(d.status).toBe('supported');
    expect(d.reason).toBe('multi_evidence_support_requires_review');
  });

  it('margin = score - runnerUp 计算正确', () => {
    const d = DEFAULT_VERIFIER.decide({ score: 0.7, runnerUp: 0.4, coverage: 0.9 });
    expect(d.margin).toBeCloseTo(0.3, 10);
  });

  it('分类型 margin：complete 类放宽到 0.03 恢复覆盖率', () => {
    // 一般 episodic 在 margin 0.05 会 ambiguous
    const ambiguous = DEFAULT_VERIFIER.decide({ score: 0.7, runnerUp: 0.65, coverage: 0.8, queryType: 'episodic' });
    expect(ambiguous.status).toBe('ambiguous');
    // 完整类候选（有锚点/完整证据）同 margin 可支持
    const supported = DEFAULT_VERIFIER.decide({ score: 0.7, runnerUp: 0.65, coverage: 0.8, queryType: 'episodic_complete' });
    expect(supported.status).toBe('supported');
  });

  it('分类型 margin：conflict/unknown 保持保守 0.08，不因全局放宽误支持', () => {
    expect(RECOMMENDED_MARGINS_BY_TYPE.conflict).toBe(0.08);
    expect(RECOMMENDED_MARGINS_BY_TYPE.unknown).toBe(0.08);
    const d = DEFAULT_VERIFIER.decide({ score: 0.7, runnerUp: 0.64, coverage: 0.9, queryType: 'conflict' });
    expect(d.status).toBe('ambiguous');
  });

  it('自定义阈值构造生效', () => {
    const strict = new EvidenceVerifier({ minimumScore: 0.8, minimumMargin: 0.2, minimumCoverage: 0.9 });
    const d = strict.decide({ score: 0.75, runnerUp: 0.1, coverage: 0.95 });
    expect(d.status).toBe('unknown');
    expect(d.reason).toBe('score_below_support_threshold');
  });
});

// ── 2. 状态机：转移合法性 + reviewer 权限 + 审计 ──
describe('MemoryLedger — 状态机与权限', () => {
  it('propose → supported（model 可）→ verified（仅 reviewer）', () => {
    const ledger = new MemoryLedger();
    ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_1', surfaceText: '用户分享了对火锅的喜爱' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'multi_evidence_support_requires_review' },
      { coverage: 0.9 },
    );
    const entry = ledger.getByRef('episodic', 'ep_1')!;
    expect(entry.status).toBe('supported');
    ledger.verify(entry.candidateId, 'reviewer:user');
    expect(ledger.status(entry.candidateId)).toBe('verified');
  });

  it('model 试图 verify → 拒绝（只允许显式 reviewer）', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_2', surfaceText: 'x' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' },
      { coverage: 0.9 },
    )!;
    expect(() => ledger.verify(entry.candidateId, 'model')).toThrow(/only an explicit reviewer/);
    expect(ledger.status(entry.candidateId)).toBe('supported');
  });

  it('非法转移被拒绝：supported 不能回到 proposed', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_3', surfaceText: 'x' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' },
      { coverage: 0.9 },
    )!;
    expect(() => ledger.transition(entry.candidateId, 'proposed', 'model', 'regression')).toThrow(/invalid candidate transition/);
  });

  it('rejected 是终态：不能再转移', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_4', surfaceText: 'x' },
      { status: 'ambiguous', score: 0.6, margin: 0.01, reason: 'duplicate' },
      { coverage: 0.8 },
    )!;
    ledger.reject(entry.candidateId, 'reviewer:user', '记错了');
    expect(() => ledger.transition(entry.candidateId, 'supported', 'reviewer:user', 'x')).toThrow(/invalid candidate transition/);
  });

  it('verified → rolled_back（人工纠错回滚链）', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'user_fact', refId: 'fact_1', surfaceText: '用户讨厌下雨' },
      { status: 'supported', score: 0.9, margin: 0.4, reason: 'ok' },
      { coverage: 1 },
    )!;
    ledger.verify(entry.candidateId, 'reviewer:user');
    ledger.rollback(entry.candidateId, 'reviewer:user', '其实是喜欢下雨，之前理解反了');
    expect(ledger.status(entry.candidateId)).toBe('rolled_back');
  });

  it('每次转移都写入审计历史（含 actor/from/to/reason）', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_5', surfaceText: 'x' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'multi_evidence_support_requires_review' },
      { coverage: 0.9 },
    )!;
    ledger.verify(entry.candidateId, 'reviewer:user');
    const history = ledger.history(entry.candidateId);
    expect(history.length).toBeGreaterThanOrEqual(3);
    const verifyRecord = history.find(h => h.to === 'verified');
    expect(verifyRecord?.actor).toBe('reviewer:user');
    expect(history[0].from).toBeNull();
    expect(history[0].to).toBe('proposed');
  });

  it('序列化往返保持全部状态与历史', () => {
    const ledger = new MemoryLedger();
    ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_6', surfaceText: 'x' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' },
      { coverage: 0.9 },
    );
    const snapshot = ledger.serialize();
    const restored = MemoryLedger.from(snapshot);
    expect(restored.getByRef('episodic', 'ep_6')?.status).toBe('supported');
    expect(restored.history().length).toBe(ledger.history().length);
    expect(restored.serialize()).toEqual(ledger.serialize());
  });
});

// ── 3. recordFromDecision 语义 ──
describe('MemoryLedger.recordFromDecision — 判定落账', () => {
  it('unknown 判定不落库（返回 null）', () => {
    const ledger = new MemoryLedger();
    const d: VerificationDecision = { status: 'unknown', score: 0.3, margin: 0.1, reason: 'insufficient_semantic_coverage' };
    expect(ledger.recordFromDecision({ refType: 'episodic', refId: 'ep_7', surfaceText: 'x' }, d)).toBeNull();
    expect(ledger.serialize().entries).toHaveLength(0);
  });

  it('同 refId 幂等：重复 record 不重复建账、不改写既有状态', () => {
    const ledger = new MemoryLedger();
    const record = { refType: 'episodic', refId: 'ep_8', surfaceText: '用户说喜欢吃火锅' };
    const first = ledger.recordFromDecision(record, { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' }, { coverage: 0.9 })!;
    const second = ledger.recordFromDecision(record, { status: 'ambiguous', score: 0.6, margin: 0.01, reason: 'later' }, { coverage: 0.9 });
    expect(second).toBe(first);
    expect(ledger.serialize().entries).toHaveLength(1);
    expect(ledger.status(first.candidateId)).toBe('supported');
  });

  it('supported 落账带证据（score/margin/coverage/reason）', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_9', surfaceText: 'x' },
      { status: 'supported', score: 0.77, margin: 0.21, reason: 'multi_evidence_support_requires_review' },
      { coverage: 0.85 },
    )!;
    expect(entry.decision).toMatchObject({ score: 0.77, margin: 0.21, coverage: 0.85 });
  });
});

// ── 4. 使用许可映射 ──
describe('recallAllowance / isProactivelyRecallable — 状态到行为', () => {
  const cases: [MemoryStatus, boolean, boolean][] = [
    ['verified', true, true],
    ['supported', true, true],
    ['ambiguous', false, false],
    ['proposed', false, false],
    ['rejected', false, false],
    ['rolled_back', false, false],
    ['unknown', false, false],
  ];
  for (const [status, proactive, assertive] of cases) {
    it(`${status} → proactive=${proactive}, assertive=${assertive}`, () => {
      const a = recallAllowance(status);
      expect(a.proactive).toBe(proactive);
      expect(a.assertive).toBe(assertive);
      expect(a.context).toBe(status === 'ambiguous' || status === 'proposed' || proactive);
    });
  }

  it('无账目记录（治理上线前的旧记忆）默认放行，不改变既有行为', () => {
    const a = recallAllowance(undefined);
    expect(a.proactive).toBe(true);
    expect(a.assertive).toBe(true);
  });

  it('isProactivelyRecallable：supported 可主动，ambiguous 不可，无记录默认可', () => {
    const ledger = new MemoryLedger();
    expect(isProactivelyRecallable('episodic', 'ep_old', ledger)).toBe(true); // 无记录
    ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_ok', surfaceText: 'x' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' },
      { coverage: 0.9 },
    );
    expect(isProactivelyRecallable('episodic', 'ep_ok', ledger)).toBe(true);
    ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_sus', surfaceText: 'y' },
      { status: 'ambiguous', score: 0.6, margin: 0.02, reason: 'duplicate' },
      { coverage: 0.8 },
    );
    expect(isProactivelyRecallable('episodic', 'ep_sus', ledger)).toBe(false);
  });
});

// ── 5. episode 候选评估（启发映射 + 决策 + 建议动作）──
describe('assessEpisodeCandidate — episode 候选评级', () => {
  it('完整强事件（高权重+情感标签+长文本+效价移动）→ record_long_term', () => {
    const a = assessEpisodeCandidate({
      recallWeight: 0.85,
      tagCount: 2,
      messageLength: 40,
      valenceDeltaAbs: 0.4,
      anchorType: 'promise_to',
    });
    expect(a.decision.status).toBe('supported');
    expect(a.suggestedAction).toBe('record_long_term');
  });

  it('低信息事件（无标签+短消息+无情绪轨迹）→ skip（不落库）', () => {
    const a = assessEpisodeCandidate({
      recallWeight: 0.3,
      tagCount: 0,
      messageLength: 4,
      valenceDeltaAbs: 0.01,
    });
    expect(a.decision.status).toBe('unknown');
    expect(a.suggestedAction).toBe('skip');
  });

  it('与既有记忆高度相似（nearestSimilarity≈score）→ merge_with_existing 建议', () => {
    const a = assessEpisodeCandidate({
      recallWeight: 0.7,
      tagCount: 1,
      messageLength: 30,
      valenceDeltaAbs: 0.2,
      nearestSimilarity: 0.68,
    });
    expect(a.decision.status).toBe('ambiguous');
    expect(a.suggestedAction).toBe('merge_with_existing');
  });

  it('中等证据、无明显重复 → store_and_review（ambiguous 但不 merge）', () => {
    const a = assessEpisodeCandidate({
      recallWeight: 0.55,
      tagCount: 1,
      messageLength: 20,
      valenceDeltaAbs: 0.15,
      nearestSimilarity: 0.5, // margin = 0.55-0.5 = 0.05 < 0.08，但 runnerUp 未逼近 score → 不 merge
    });
    expect(a.decision.status).toBe('ambiguous');
    expect(a.suggestedAction).toBe('store_and_review');
  });
});

// ── 6. applyReview 统一人工核实入口 ──
describe('MemoryLedger.applyReview — 人工核实统一入口', () => {
  function makeSupportedLedger(refId: string): { ledger: MemoryLedger; candidateId: string } {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId, surfaceText: '记忆' },
      { status: 'supported', score: 0.8, margin: 0.3, reason: 'ok' },
      { coverage: 0.9 },
    )!;
    return { ledger, candidateId: entry.candidateId };
  }

  it('非 reviewer actor 一律拒绝', () => {
    const { ledger, candidateId } = makeSupportedLedger('ep_r1');
    expect(() => ledger.applyReview(candidateId, 'verified', 'model', 'x')).toThrow(/only an explicit reviewer/);
  });

  it('supported → verified（reviewer 一步核实）', () => {
    const { ledger, candidateId } = makeSupportedLedger('ep_r2');
    const r = ledger.applyReview(candidateId, 'verified', 'reviewer:http', 'user_confirmed');
    expect(r).toEqual({ from: 'supported', to: 'verified' });
  });

  it('ambiguous → verified 自动链式（ambiguous→supported→verified）', () => {
    const ledger = new MemoryLedger();
    const entry = ledger.recordFromDecision(
      { refType: 'episodic', refId: 'ep_r3', surfaceText: '记忆' },
      { status: 'ambiguous', score: 0.6, margin: 0.02, reason: 'duplicate' },
      { coverage: 0.8 },
    )!;
    const r = ledger.applyReview(entry.candidateId, 'verified', 'reviewer:obsidian', 'user_confirmed');
    expect(r.to).toBe('verified');
    const statuses = ledger.history(entry.candidateId).map(h => h.to);
    expect(statuses).toContain('supported');
  });

  it('supported → rejected（人工否定）合法；verified → rejected 非法', () => {
    const { ledger: l1, candidateId: c1 } = makeSupportedLedger('ep_r4');
    expect(l1.applyReview(c1, 'rejected', 'reviewer:user', '记错了').to).toBe('rejected');
    const { ledger: l2, candidateId: c2 } = makeSupportedLedger('ep_r5');
    l2.applyReview(c2, 'verified', 'reviewer:user', 'ok');
    expect(() => l2.applyReview(c2, 'rejected', 'reviewer:user', 'x')).toThrow(/invalid candidate transition/);
  });

  it('verified → rolled_back（事后纠错回滚）', () => {
    const { ledger, candidateId } = makeSupportedLedger('ep_r6');
    ledger.applyReview(candidateId, 'verified', 'reviewer:user', 'ok');
    const r = ledger.applyReview(candidateId, 'rolled_back', 'reviewer:user', '其实是误会');
    expect(r.to).toBe('rolled_back');
  });
});
