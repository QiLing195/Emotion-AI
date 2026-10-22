/**
 * v2.06：内在活动候选接口（审查建议 #3）。
 *
 * 目的：内在事件（孤独/重逢/思维/兴趣/发现/洞察/活动关切）不再"规则一推导就直接施加"，
 * 而是先变成**带证据和时效的候选**，经统一校验（去重、过期、证据、置信度、单轮上限）后才允许
 * 进入情绪状态；没证据/过期/重复的候选不得当成"真实经历"。
 *
 * 刻意不做：不让 LLM 直接改状态或发言；这里只接受确定性/规则产出的候选。
 * 以后若接"内在活动 agent"，它也只能往这个接口投候选。
 */

export type IntrinsicSource = 'idle' | 'thought' | 'interest' | 'discovery' | 'insight' | 'activity';

export interface IntrinsicCandidate {
  /** 稳定标识：同一活动重复出现必须同 id（用于去重） */
  eventId: string;
  type: string;
  source: IntrinsicSource;
  /** 证据引用（空闲时长/思维种子类型/兴趣词/发现 id/活动摘要…），空 = 无证据，必须拒绝 */
  evidenceRef: string;
  confidence: number;
  /** 过期时间（ms epoch）；过期候选不得作为"现在发生的事" */
  expiresAt: number;
  intensity: number;
}

export interface CandidateValidationResult {
  accepted: IntrinsicCandidate[];
  rejected: Array<{ eventId: string; reason: 'duplicate' | 'expired' | 'no_evidence' | 'low_confidence' | 'invalid' | 'over_budget' }>;
}

export interface ValidateOptions {
  now: number;
  /** 最近已应用过的 eventId（调用方维护：有界去重表，需同时支持 has/add） */
  seen: { has(id: string): boolean; add(id: string): void };
  minConfidence?: number;
  maxPerTurn?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function validateIntrinsicCandidates(
  candidates: IntrinsicCandidate[],
  opts: ValidateOptions,
): CandidateValidationResult {
  const minConfidence = opts.minConfidence ?? 0.4;
  const maxPerTurn = opts.maxPerTurn ?? 3;
  const accepted: IntrinsicCandidate[] = [];
  const rejected: CandidateValidationResult['rejected'] = [];

  for (const c of candidates) {
    if (!c || typeof c.eventId !== 'string' || !c.eventId.trim() || typeof c.type !== 'string' || !c.type.trim()) {
      rejected.push({ eventId: String(c?.eventId ?? 'unknown'), reason: 'invalid' });
      continue;
    }
    if (c.expiresAt <= opts.now) {
      rejected.push({ eventId: c.eventId, reason: 'expired' });
      continue;
    }
    if (!c.evidenceRef || !String(c.evidenceRef).trim()) {
      rejected.push({ eventId: c.eventId, reason: 'no_evidence' });
      continue;
    }
    if (opts.seen.has(c.eventId)) {
      rejected.push({ eventId: c.eventId, reason: 'duplicate' });
      continue;
    }
    if (!(c.confidence >= minConfidence)) {
      rejected.push({ eventId: c.eventId, reason: 'low_confidence' });
      continue;
    }
    if (accepted.length >= maxPerTurn) {
      rejected.push({ eventId: c.eventId, reason: 'over_budget' });
      continue;
    }
    accepted.push({ ...c, intensity: clamp01(c.intensity), confidence: clamp01(c.confidence) });
    opts.seen.add(c.eventId);
  }
  return { accepted, rejected };
}

/** 有界去重表：只保留最近 N 个 eventId（防止进程内无限增长） */
export class IntrinsicDedup {
  private ids: string[] = [];
  private set = new Set<string>();
  constructor(private readonly capacity = 200) {}
  has(id: string): boolean { return this.set.has(id); }
  add(id: string): void {
    if (this.set.has(id)) return;
    this.set.add(id);
    this.ids.push(id);
    while (this.ids.length > this.capacity) {
      const old = this.ids.shift();
      if (old) this.set.delete(old);
    }
  }
  get size(): number { return this.set.size; }
  snapshot(): ReadonlySet<string> { return new Set(this.set); }
}

/** 各类型的默认证据与时效（毫秒）。reunion 当天只算一次；孤独/心情类 2h 内不重复。 */
export const INTRINSIC_DEFAULTS: Record<string, { ttlMs: number; confidence: number }> = {
  reunion: { ttlMs: 24 * 3600_000, confidence: 0.9 },
  loneliness: { ttlMs: 2 * 3600_000, confidence: 0.7 },
  thought_wish: { ttlMs: 6 * 3600_000, confidence: 0.6 },
  thought_fear: { ttlMs: 6 * 3600_000, confidence: 0.6 },
  thought_doubt: { ttlMs: 6 * 3600_000, confidence: 0.6 },
  interest: { ttlMs: 6 * 3600_000, confidence: 0.7 },
  discovery: { ttlMs: 6 * 3600_000, confidence: 0.8 },
  insight: { ttlMs: 6 * 3600_000, confidence: 0.7 },
  activity_concern: { ttlMs: 2 * 3600_000, confidence: 0.8 },
};
