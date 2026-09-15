// ── v1.2 记忆治理层 (Memory Governance) ──
// 移植自 c-former V6.3 的确定性治理范式（governance.py）：
//   "神经网络/规则只能 propose/support，正式 verify 必须由显式 reviewer 完成；
//    unknown/ambiguous 不允许作为事实主动提起。"
//
// 解决的问题：当前 tryFormEpisode 只做"是否记住"的布尔判定（7 条 OR 规则 + 低阈值），
// 随口一提与关系转折会同等入库，且无人工核实/回滚/去重通道。
// 本层给每条记忆候选增加 状态机(proposed→supported→verified/rolled_back) + 三条件证据判定，
// 让"长期人设记忆"只来自 supported/verified，可疑/重复候选先降级为 ambiguous。
//
// 纯逻辑模块：无 React/DOM/io 依赖，可被 server/UI 层引用。

// ════════════════════════════════════════════════════════════
// 1. 状态与判定
// ════════════════════════════════════════════════════════════

/** 候选状态。unknown 仅作为"判定结果"（不落库）。 */
export type MemoryStatus =
  | 'proposed'
  | 'supported'
  | 'ambiguous'
  | 'rejected'
  | 'verified'
  | 'rolled_back'
  | 'unknown';

export interface VerificationDecision {
  /** 判定结果：只有 supported 可升级为长期记忆；ambiguous 需人工或更多证据；unknown 不落库 */
  status: 'supported' | 'ambiguous' | 'unknown';
  score: number;
  /** score − runnerUp（与最接近候选/已有记忆的区分度） */
  margin: number;
  reason: string;
}

export interface EvidenceInput {
  /** 模型/规则给出的支持分 [0,1] */
  score: number;
  /** 最接近竞争候选/最相似已有记忆的相似度 [0,1] */
  runnerUp: number;
  /** 语义覆盖率：候选信息是否足够完整可理解 [0,1] */
  coverage: number;
  /** 查询/候选类型，用于分类型 margin（如 complete 类可放宽阈值换覆盖率） */
  queryType?: string;
}

/**
 * 保守边界：模型证据只能 support，永远不能 verify。
 *
 * 语义适配（相对 c-former 的拒答语义）：
 *  c-former 中 coverage 不足 → unknown(拒答) 是为了检索防幻觉；
 *  本项目 unknown = "分数太低不值得治理"，而 coverage 不足仅表示
 *  "信息尚不完整" → 归 ambiguous（落账、禁主动提起、等待 review/更多证据），
 *  避免弱记忆因"不建账"而绕过治理（不建账 = 旧行为默认放行）。
 */
export class EvidenceVerifier {
  readonly minimumScore: number;
  readonly minimumCoverage: number;
  readonly defaultMargin: number;
  readonly marginByType: ReadonlyMap<string, number>;

  constructor(opts?: {
    minimumScore?: number;
    minimumMargin?: number;
    minimumCoverage?: number;
    marginByType?: Record<string, number>;
  }) {
    this.minimumScore = opts?.minimumScore ?? 0.5;
    this.minimumCoverage = opts?.minimumCoverage ?? 0.6;
    this.defaultMargin = opts?.minimumMargin ?? 0.08;
    this.marginByType = new Map(Object.entries(opts?.marginByType ?? {}));
  }

  decide(input: EvidenceInput): VerificationDecision {
    const { score, runnerUp, coverage } = input;
    const margin = score - runnerUp;
    if (score < this.minimumScore) {
      return { status: 'unknown', score, margin, reason: 'score_below_support_threshold' };
    }
    if (coverage < this.minimumCoverage) {
      return { status: 'ambiguous', score, margin, reason: 'insufficient_semantic_coverage' };
    }
    const requiredMargin =
      (input.queryType != null && this.marginByType.has(input.queryType))
        ? this.marginByType.get(input.queryType)!
        : this.defaultMargin;
    if (margin < requiredMargin) {
      return { status: 'ambiguous', score, margin, reason: 'candidate_margin_too_small_or_duplicate' };
    }
    return { status: 'supported', score, margin, reason: 'multi_evidence_support_requires_review' };
  }
}

/** 领域校准：完整/已知类候选可放宽 margin 保覆盖率；歧义/未知/冲突类保持保守。 */
export const RECOMMENDED_MARGINS_BY_TYPE: Record<string, number> = {
  episodic_complete: 0.03, // 完整情感事件（有 impact+标签+长文本）
  episodic: 0.08,          // 一般情景记忆
  user_fact: 0.08,
  conflict: 0.08,
  unknown: 0.08,
};

export const DEFAULT_VERIFIER = new EvidenceVerifier({
  minimumScore: 0.5,
  minimumMargin: 0.08,
  minimumCoverage: 0.6,
  marginByType: RECOMMENDED_MARGINS_BY_TYPE,
});

// ════════════════════════════════════════════════════════════
// 2. 从现有 episode 启发量评估候选
// ════════════════════════════════════════════════════════════

export interface EpisodeCandidateInput {
  /** tryFormEpisode 产出的 recallWeight [0,1]（已含情绪波动/唤醒/强度/锚点加权） */
  recallWeight: number;
  /** 命中 SIGNIFICANT 情感标签数 */
  tagCount: number;
  /** 用户消息长度（字） */
  messageLength: number;
  /** |valenceDelta| */
  valenceDeltaAbs: number;
  /** 是否有信念变革 */
  beliefRevision?: boolean;
  /** 锚点事件类型（naming/promise_to/milestone/self_disclosure/shared_memory…） */
  anchorType?: string | null;
  /** 与最相似既有记忆的文本相似度 [0,1]；高 → 疑似重复候选 */
  nearestSimilarity?: number;
}

export interface EpisodeAssessment {
  input: EvidenceInput;
  decision: VerificationDecision;
  /** 对调用方的建议动作 */
  suggestedAction: 'record_long_term' | 'store_and_review' | 'skip' | 'merge_with_existing';
}

/**
 * 把 episode 启发量映射为 (score, runnerUp, coverage) 三证据并判定。
 * - score：以 recallWeight 为主，锚点/信念变革补强；
 * - coverage：事件是否"信息完整可理解"（有情感标签 + 具体内容 + 情绪轨迹）；
 * - runnerUp：与既有记忆的相似度 → margin 小即疑似重复（去重依据）。
 */
export function assessEpisodeCandidate(input: EpisodeCandidateInput): EpisodeAssessment {
  const rawScore =
    input.recallWeight +
    (input.anchorType ? 0.05 : 0) +
    (input.beliefRevision ? 0.1 : 0);
  const score = Math.max(0, Math.min(1, rawScore));

  const hasEmotionTags = input.tagCount > 0;
  const hasConcreteContent = input.messageLength >= 8;
  const hasValenceMove = input.valenceDeltaAbs > 0.05;
  let coverage = 0;
  if (hasEmotionTags) coverage += 0.4;
  if (hasConcreteContent) coverage += 0.3;
  if (hasValenceMove) coverage += 0.3;
  coverage = Math.max(0, Math.min(1, coverage));

  const runnerUp = Math.max(0, Math.min(1, input.nearestSimilarity ?? 0));
  const evidence: EvidenceInput = {
    score,
    runnerUp,
    coverage,
    queryType: input.anchorType ? 'episodic_complete' : 'episodic',
  };
  const decision = DEFAULT_VERIFIER.decide(evidence);

  let suggestedAction: EpisodeAssessment['suggestedAction'];
  if (decision.status === 'unknown') {
    suggestedAction = 'skip';
  } else if (decision.status === 'ambiguous') {
    // margin 小：可能与既有记忆重复，或证据仍不足 → 存但不主动断言
    suggestedAction = runnerUp >= Math.max(0.5, score - 0.02) ? 'merge_with_existing' : 'store_and_review';
  } else {
    suggestedAction = 'record_long_term';
  }
  return { input: evidence, decision, suggestedAction };
}

// ════════════════════════════════════════════════════════════
// 3. 候选账本（版本化状态机 + 审计）
// ════════════════════════════════════════════════════════════

export interface LedgerEntry {
  candidateId: string;
  refType: string;      // 'episodic' | 'semantic' | 'graph' | 'user_fact'
  refId: string;        // 记忆对象 id（如 episode.id）
  surfaceText: string;  // 候选文本（摘要）
  status: MemoryStatus;
  createdAt: number;
  updatedAt: number;
  decision?: { score: number; margin: number; coverage: number; reason: string };
}

export interface LedgerAuditRecord {
  candidateId: string;
  from: MemoryStatus | null;
  to: MemoryStatus;
  actor: string;
  reason: string;
  at: number;
}

export interface MemoryLedgerSnapshot {
  entries: LedgerEntry[];
  history: LedgerAuditRecord[];
}

const ALLOWED_TRANSITIONS: Record<MemoryStatus, MemoryStatus[]> = {
  proposed: ['supported', 'ambiguous', 'rejected'],
  supported: ['verified', 'rejected'],
  ambiguous: ['supported', 'rejected'],
  verified: ['rolled_back'],
  rejected: [],
  rolled_back: [],
  unknown: [],
};

export class MemoryLedger {
  private state: MemoryLedgerSnapshot;

  constructor(snapshot?: MemoryLedgerSnapshot) {
    this.state = snapshot ?? { entries: [], history: [] };
  }

  static from(snapshot: MemoryLedgerSnapshot): MemoryLedger {
    return new MemoryLedger({
      entries: [...(snapshot.entries ?? [])],
      history: [...(snapshot.history ?? [])],
    });
  }

  serialize(): MemoryLedgerSnapshot {
    return { entries: this.state.entries, history: this.state.history };
  }

  private nextVersion(): number {
    return this.state.history.length + 1;
  }

  /** 幂等 propose：同一 refId 已存在则直接返回既有条目（不重复建账）。 */
  propose(record: { refType: string; refId: string; surfaceText: string }, actor = 'model'): LedgerEntry {
    const existing = this.state.entries.find(e => e.refId === record.refId && e.refType === record.refType);
    if (existing) return existing;
    const now = Date.now();
    const entry: LedgerEntry = {
      candidateId: `${record.refType}_${record.refId}`,
      refType: record.refType,
      refId: record.refId,
      surfaceText: record.surfaceText,
      status: 'proposed',
      createdAt: now,
      updatedAt: now,
    };
    this.state.entries.push(entry);
    this.state.history.push({
      candidateId: entry.candidateId, from: null, to: 'proposed', actor, reason: 'new_candidate', at: now,
    });
    return entry;
  }

  get(candidateId: string): LedgerEntry | undefined {
    return this.state.entries.find(e => e.candidateId === candidateId);
  }

  getByRef(refType: string, refId: string): LedgerEntry | undefined {
    return this.state.entries.find(e => e.refType === refType && e.refId === refId);
  }

  status(candidateId: string): MemoryStatus {
    const entry = this.get(candidateId);
    if (!entry) throw new Error(`unknown candidate ${candidateId}`);
    return entry.status;
  }

  /**
   * 状态转移（合法性 + reviewer 权限 + 审计）。
   * 只有 actor 以 "reviewer:" 开头才能转到 verified；其余一律 PermissionError。
   */
  transition(candidateId: string, target: MemoryStatus, actor: string, reason: string): void {
    const entry = this.get(candidateId);
    if (!entry) throw new Error(`unknown candidate ${candidateId}`);
    if (!ALLOWED_TRANSITIONS[entry.status].includes(target)) {
      throw new Error(`invalid candidate transition: ${entry.status} -> ${target}`);
    }
    if (target === 'verified' && !actor.startsWith('reviewer:')) {
      throw new Error('only an explicit reviewer can verify a memory candidate');
    }
    const now = Date.now();
    this.state.history.push({
      candidateId, from: entry.status, to: target, actor, reason, at: now,
    });
    entry.status = target;
    entry.updatedAt = now;
  }

  /** 便捷：reviewer 核实 → verified */
  verify(candidateId: string, reviewerActor: string, reason = 'human_review_confirmed'): void {
    this.transition(candidateId, 'verified', reviewerActor, reason);
  }

  /** 便捷：人工纠错 → rolled_back（verified 专用回滚） */
  rollback(candidateId: string, reviewerActor: string, reason = 'human_review_correction'): void {
    this.transition(candidateId, 'rolled_back', reviewerActor, reason);
  }

  /** 便捷：人工否定（任意非终态 → rejected） */
  reject(candidateId: string, actor: string, reason = 'human_or_rule_rejection'): void {
    this.transition(candidateId, 'rejected', actor, reason);
  }

  history(candidateId?: string): LedgerAuditRecord[] {
    if (!candidateId) return this.state.history;
    return this.state.history.filter(h => h.candidateId === candidateId);
  }

  /**
   * 把一次判定落账：supported/ambiguous 建账并置态；unknown 不落库（跳过）。
   * 已存在同 ref 的候选不重复覆盖（幂等）。
   * @returns 落账条目（unknown 或幂等命中返回 undefined/既有条目）
   */
  recordFromDecision(
    record: { refType: string; refId: string; surfaceText: string },
    decision: VerificationDecision,
    opts?: { coverage?: number; actor?: string },
  ): LedgerEntry | null {
    if (decision.status === 'unknown') return null;
    const actor = opts?.actor ?? 'model:verifier';
    const entry = this.propose(record, actor);
    // 已终态（rejected/verified/rolled_back）不做模型自动改写
    if (entry.status === 'proposed') {
      this.transition(entry.candidateId, decision.status, actor, decision.reason);
      entry.decision = {
        score: decision.score,
        margin: decision.margin,
        coverage: opts?.coverage ?? 0,
        reason: decision.reason,
      };
    }
    return entry;
  }

  /**
   * v1.3 人工核实统一入口（HTTP 端点 / obsidian-review 共用）：
   *  - 只有 reviewer 前缀的 actor 允许人工操作；
   *  - verified 请求若当前在 proposed/ambiguous，自动经 supported 链式核实（reviewer 身份两步）；
   *  - 其它非法转移（如 verified→rejected）抛错，由调用方处理。
   * @returns 实际转移 {from, to}
   */
  applyReview(
    candidateId: string,
    target: 'verified' | 'rejected' | 'rolled_back' | 'supported' | 'ambiguous',
    actor: string,
    reason: string,
  ): { from: MemoryStatus; to: MemoryStatus } {
    const entry = this.get(candidateId);
    if (!entry) throw new Error(`unknown candidate ${candidateId}`);
    if (!actor.startsWith('reviewer:')) {
      throw new Error('only an explicit reviewer can perform memory review');
    }
    const from = entry.status;
    if (from === target) return { from, to: from };
    try {
      this.transition(candidateId, target, actor, reason);
    } catch (e) {
      if (target === 'verified' && (from === 'proposed' || from === 'ambiguous')) {
        this.transition(candidateId, 'supported', actor, 'reviewer_escalation');
        this.transition(candidateId, 'verified', actor, reason);
      } else {
        throw e;
      }
    }
    return { from, to: entry.status };
  }
}

// ════════════════════════════════════════════════════════════
// 4. 状态 → 使用许可（召回/主动提起/事实断言）
// ════════════════════════════════════════════════════════════

export interface RecallAllowance {
  /** 是否允许 AI 主动提起这段记忆 */
  proactive: boolean;
  /** 是否允许把内容当作事实断言（叙事/回复中引用） */
  assertive: boolean;
  /** 是否允许作为上下文提示注入 */
  context: boolean;
}

/**
 * 状态到行为许可：
 * - verified / supported / 无记录(旧记忆默认放行) → 可主动提起、可断言；
 * - ambiguous / proposed → 只可作上下文，不可主动断言；
 * - rejected / rolled_back / unknown → 一律不进注入。
 */
export function recallAllowance(status: MemoryStatus | undefined): RecallAllowance {
  switch (status) {
    case 'verified':
    case 'supported':
      return { proactive: true, assertive: true, context: true };
    case 'ambiguous':
    case 'proposed':
      return { proactive: false, assertive: false, context: true };
    case 'rejected':
    case 'rolled_back':
    case 'unknown':
      return { proactive: false, assertive: false, context: false };
    default:
      // 无账目记录 = 治理层上线前的旧记忆，保持原有行为
      return { proactive: true, assertive: true, context: true };
  }
}

/** 判断某记忆是否允许被"主动提起"（decideProactiveRecall 的治理闸门）。 */
export function isProactivelyRecallable(refType: string, refId: string, ledger: MemoryLedger): boolean {
  const entry = ledger.getByRef(refType, refId);
  return recallAllowance(entry?.status).proactive;
}
