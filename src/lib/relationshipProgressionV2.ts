export type RelationshipStageV2 =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'crush'
  | 'lover'
  | 'partner';

export type RelationshipActor = 'user' | 'ai' | 'mutual';

export type RelationshipEventCategory =
  | 'conversation'
  | 'self_disclosure'
  | 'reliable_support'
  | 'remembered_detail'
  | 'shared_activity'
  | 'boundary_respected'
  | 'boundary_reopened'
  | 'repair'
  | 'proactive_contact'
  | 'special_attention'
  | 'playful_flirt'
  | 'relationship_probe'
  | 'indirect_affection'
  | 'explicit_affection'
  | 'relationship_proposal'
  | 'romantic_expression'
  | 'affectionate_response'
  | 'relationship_discussion'
  | 'explicit_confession'
  | 'explicit_acceptance'
  | 'mutual_confirmation'
  | 'future_plan'
  | 'boundary_rejection'
  | 'discomfort'
  | 'inconsistency';

export interface RelationshipDimensions {
  familiarity: number;
  trust: number;
  reciprocity: number;
  userRomanticInterest: number;
  aiRomanticInterest: number;
  mutualRomanticConfidence: number;
  romanticInterest: number;
  specialPreference: number;
  boundaryComfort: number;
  commitmentClarity: number;
  repairCapacity: number;
}

export interface RelationshipEvidenceEvent {
  id: string;
  category: RelationshipEventCategory;
  actor: RelationshipActor;
  strength: number;
  sessionId: string;
  timestamp: number;
  accepted?: boolean;
  note?: string;
}

export interface RelationshipCandidate {
  target: RelationshipStageV2;
  startedAt: number;
  startedEventIndex: number;
  startingSessionId: string;
}

export interface RelationshipTransition {
  from: RelationshipStageV2;
  to: RelationshipStageV2;
  timestamp: number;
  evidenceIds: string[];
}

export interface RelationshipStateV2 {
  stage: RelationshipStageV2;
  dimensions: RelationshipDimensions;
  evidence: RelationshipEvidenceEvent[];
  candidate: RelationshipCandidate | null;
  boundaryStatus: 'open' | 'cautious' | 'closed';
  transitions: RelationshipTransition[];
  sessionGains: Record<string, Partial<Record<keyof RelationshipDimensions, number>>>;
  createdAt: number;
  updatedAt: number;
}

export interface RelationshipProgressReport {
  stage: RelationshipStageV2;
  nextStage: RelationshipStageV2 | null;
  candidate: RelationshipCandidate | null;
  dimensions: RelationshipDimensions;
  effectiveEventCount: number;
  categoryCount: number;
  sessionCount: number;
  userEvidenceCount: number;
  aiEvidenceCount: number;
  blockers: string[];
}

const STAGE_ORDER: RelationshipStageV2[] = [
  'stranger', 'acquaintance', 'friend', 'crush', 'lover', 'partner',
];

const ROMANTIC_CATEGORIES = new Set<RelationshipEventCategory>([
  'special_attention',
  'playful_flirt',
  'relationship_probe',
  'indirect_affection',
  'explicit_affection',
  'relationship_proposal',
  'romantic_expression',
  'affectionate_response',
  'relationship_discussion',
  'explicit_confession',
  'explicit_acceptance',
  'mutual_confirmation',
  'future_plan',
]);

const DIMENSION_DELTAS: Record<RelationshipEventCategory, Partial<RelationshipDimensions>> = {
  conversation: { familiarity: 0.08 },
  self_disclosure: { familiarity: 0.12, trust: 0.1 },
  reliable_support: { trust: 0.12, reciprocity: 0.08 },
  remembered_detail: { familiarity: 0.08, specialPreference: 0.08 },
  shared_activity: { familiarity: 0.1, reciprocity: 0.08 },
  boundary_respected: { boundaryComfort: 0.12, trust: 0.08 },
  boundary_reopened: { boundaryComfort: 0.18, trust: 0.05 },
  repair: { repairCapacity: 0.18, trust: 0.08, boundaryComfort: 0.06 },
  proactive_contact: { reciprocity: 0.08, familiarity: 0.04 },
  special_attention: { specialPreference: 0.12, romanticInterest: 0.05 },
  playful_flirt: { romanticInterest: 0.03, specialPreference: 0.02 },
  relationship_probe: { romanticInterest: 0.05, specialPreference: 0.04, commitmentClarity: 0.02 },
  indirect_affection: { romanticInterest: 0.08, specialPreference: 0.06 },
  explicit_affection: { romanticInterest: 0.12, specialPreference: 0.08, commitmentClarity: 0.03 },
  relationship_proposal: { romanticInterest: 0.14, specialPreference: 0.08, commitmentClarity: 0.12 },
  romantic_expression: { romanticInterest: 0.15, specialPreference: 0.1, commitmentClarity: 0.03 },
  affectionate_response: { romanticInterest: 0.12, reciprocity: 0.1, boundaryComfort: 0.04 },
  relationship_discussion: { commitmentClarity: 0.15, trust: 0.06 },
  explicit_confession: { romanticInterest: 0.2, specialPreference: 0.12, commitmentClarity: 0.18 },
  explicit_acceptance: { romanticInterest: 0.15, reciprocity: 0.12, commitmentClarity: 0.22, boundaryComfort: 0.06 },
  mutual_confirmation: { commitmentClarity: 0.3, romanticInterest: 0.12, trust: 0.08 },
  future_plan: { commitmentClarity: 0.12, trust: 0.05 },
  boundary_rejection: { romanticInterest: -0.25, specialPreference: -0.15, boundaryComfort: -0.3 },
  discomfort: { romanticInterest: -0.15, boundaryComfort: -0.2, trust: -0.08 },
  inconsistency: { trust: -0.15, reciprocity: -0.12, commitmentClarity: -0.08 },
};

const STAGE_LABELS_V2: Record<RelationshipStageV2, string> = {
  stranger: '陌生人',
  acquaintance: '初识',
  friend: '朋友',
  crush: '暧昧',
  lover: '恋人',
  partner: '稳定伴侣',
};

const SESSION_GAIN_CAPS: Partial<Record<keyof RelationshipDimensions, number>> = {
  familiarity: 0.2,
  trust: 0.2,
  reciprocity: 0.2,
  userRomanticInterest: 0.18,
  aiRomanticInterest: 0.18,
  mutualRomanticConfidence: 0.12,
  specialPreference: 0.2,
  boundaryComfort: 0.2,
  commitmentClarity: 0.22,
  repairCapacity: 0.2,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nextStage(stage: RelationshipStageV2): RelationshipStageV2 | null {
  const index = STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < STAGE_ORDER.length - 1 ? STAGE_ORDER[index + 1] : null;
}

function uniqueEffectiveEvidence(events: RelationshipEvidenceEvent[]): RelationshipEvidenceEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.sessionId}:${event.actor}:${event.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasActor(events: RelationshipEvidenceEvent[], actor: 'user' | 'ai'): boolean {
  return events.some(event => event.actor === actor || event.actor === 'mutual');
}

function countActor(events: RelationshipEvidenceEvent[], actor: 'user' | 'ai'): number {
  return events.filter(event => event.actor === actor || event.actor === 'mutual').length;
}

function distinctCount<T>(items: T[]): number {
  return new Set(items).size;
}

function observationsSinceCandidate(state: RelationshipStateV2): RelationshipEvidenceEvent[] {
  if (!state.candidate) return [];
  return uniqueEffectiveEvidence(state.evidence.slice(state.candidate.startedEventIndex + 1));
}

function candidateObservedEnough(state: RelationshipStateV2, minEvents: number, minSessions: number): boolean {
  const observations = observationsSinceCandidate(state);
  return observations.length >= minEvents
    && distinctCount([state.candidate?.startingSessionId, ...observations.map(event => event.sessionId)]) >= minSessions;
}

export function createRelationshipStateV2(now = Date.now()): RelationshipStateV2 {
  return {
    stage: 'stranger',
    dimensions: {
      familiarity: 0,
      trust: 0,
      reciprocity: 0,
      userRomanticInterest: 0,
      aiRomanticInterest: 0,
      mutualRomanticConfidence: 0,
      romanticInterest: 0,
      specialPreference: 0,
      boundaryComfort: 0.5,
      commitmentClarity: 0,
      repairCapacity: 0,
    },
    evidence: [],
    candidate: null,
    boundaryStatus: 'open',
    transitions: [],
    sessionGains: {},
    createdAt: now,
    updatedAt: now,
  };
}

function shouldStartCandidate(state: RelationshipStateV2, target: RelationshipStageV2): boolean {
  const effective = uniqueEffectiveEvidence(state.evidence);
  const sessions = distinctCount(effective.map(event => event.sessionId));
  const categories = distinctCount(effective.map(event => event.category));
  const romantic = effective.filter(event => ROMANTIC_CATEGORIES.has(event.category));

  switch (target) {
    case 'acquaintance':
      return effective.length >= 3 && categories >= 2 && sessions >= 2 && state.dimensions.familiarity >= 0.18;
    case 'friend':
      return effective.length >= 6 && categories >= 4 && sessions >= 3
        && state.dimensions.trust >= 0.28 && state.dimensions.reciprocity >= 0.18;
    case 'crush':
      return romantic.length >= 4
        && distinctCount(romantic.map(event => event.category)) >= 3
        && distinctCount(romantic.map(event => event.sessionId)) >= 2
        && hasActor(romantic, 'user') && hasActor(romantic, 'ai')
        && state.dimensions.romanticInterest >= 0.14;
    case 'lover':
      return romantic.some(event => event.category === 'relationship_discussion')
        && romantic.some(event => event.category === 'explicit_confession')
        && hasActor(romantic, 'user') && hasActor(romantic, 'ai')
        && state.dimensions.commitmentClarity >= 0.35;
    case 'partner':
      return effective.some(event => event.category === 'future_plan')
        && effective.some(event => event.category === 'repair')
        && sessions >= 6;
    default:
      return false;
  }
}

function qualifiesForPromotion(state: RelationshipStateV2, target: RelationshipStageV2): boolean {
  const effective = uniqueEffectiveEvidence(state.evidence);
  const sessions = distinctCount(effective.map(event => event.sessionId));
  const categories = distinctCount(effective.map(event => event.category));
  const romantic = effective.filter(event => ROMANTIC_CATEGORIES.has(event.category));
  const romanticSessions = distinctCount(romantic.map(event => event.sessionId));

  switch (target) {
    case 'acquaintance':
      return effective.length >= 4 && categories >= 3 && sessions >= 2
        && state.dimensions.familiarity >= 0.25
        && candidateObservedEnough(state, 1, 2);
    case 'friend':
      return effective.length >= 8 && categories >= 5 && sessions >= 3
        && hasActor(effective, 'user') && hasActor(effective, 'ai')
        && state.dimensions.trust >= 0.35
        && state.dimensions.reciprocity >= 0.25
        && state.dimensions.boundaryComfort >= 0.45
        && candidateObservedEnough(state, 2, 3);
    case 'crush':
      return state.boundaryStatus === 'open'
        && romantic.length >= 6
        && distinctCount(romantic.map(event => event.category)) >= 4
        && romanticSessions >= 3
        && countActor(romantic, 'user') >= 2
        && countActor(romantic, 'ai') >= 2
        && state.dimensions.romanticInterest >= 0.28
        && state.dimensions.specialPreference >= 0.35
        && state.dimensions.boundaryComfort >= 0.5
        && candidateObservedEnough(state, 3, 3);
    case 'lover': {
      const confirmationCategories = new Set(
        romantic
          .filter(event => ['explicit_confession', 'explicit_acceptance', 'mutual_confirmation'].includes(event.category))
          .map(event => event.category),
      );
      return state.boundaryStatus === 'open'
        && romantic.length >= 10
        && distinctCount(romantic.map(event => event.category)) >= 5
        && romanticSessions >= 4
        && confirmationCategories.size >= 3
        && hasActor(romantic.filter(event => event.category !== 'romantic_expression'), 'user')
        && hasActor(romantic.filter(event => event.category !== 'romantic_expression'), 'ai')
        && state.dimensions.commitmentClarity >= 0.6
        && candidateObservedEnough(state, 3, 2);
    }
    case 'partner':
      return effective.length >= 20 && sessions >= 8
        && effective.filter(event => event.category === 'reliable_support').length >= 2
        && effective.filter(event => event.category === 'repair').length >= 2
        && effective.filter(event => event.category === 'future_plan').length >= 2
        && state.dimensions.trust >= 0.7
        && state.dimensions.repairCapacity >= 0.4
        && state.dimensions.commitmentClarity >= 0.75
        && candidateObservedEnough(state, 4, 3);
    default:
      return false;
  }
}

function evaluateStage(state: RelationshipStateV2): void {
  const target = nextStage(state.stage);
  if (!target) {
    state.candidate = null;
    return;
  }

  if (state.boundaryStatus !== 'open' && (target === 'crush' || target === 'lover')) {
    state.candidate = null;
    return;
  }

  if (state.candidate?.target !== target) {
    state.candidate = shouldStartCandidate(state, target)
      ? {
          target,
          startedAt: state.updatedAt,
          startedEventIndex: state.evidence.length - 1,
          startingSessionId: state.evidence.at(-1)?.sessionId ?? 'unknown',
        }
      : null;
    return;
  }

  if (!qualifiesForPromotion(state, target)) return;

  const from = state.stage;
  const recentEvidence = uniqueEffectiveEvidence(state.evidence).slice(-20);
  state.stage = target;
  state.transitions.push({
    from,
    to: target,
    timestamp: state.updatedAt,
    evidenceIds: recentEvidence.map(event => event.id),
  });
  state.candidate = null;
}

function applySessionCappedDelta(
  state: RelationshipStateV2,
  sessionId: string,
  key: keyof RelationshipDimensions,
  delta: number,
): void {
  if (delta <= 0) {
    state.dimensions[key] = clamp01(state.dimensions[key] + delta);
    return;
  }
  state.sessionGains ??= {};
  const gains = state.sessionGains[sessionId] ?? {};
  const used = gains[key] ?? 0;
  const cap = SESSION_GAIN_CAPS[key] ?? 1;
  const applied = Math.min(delta, Math.max(0, cap - used));
  if (applied <= 0) return;
  state.dimensions[key] = clamp01(state.dimensions[key] + applied);
  gains[key] = used + applied;
  state.sessionGains[sessionId] = gains;
}

export function applyRelationshipEventV2(
  current: RelationshipStateV2,
  input: RelationshipEvidenceEvent,
): RelationshipStateV2 {
  if (
    !input
    || typeof input.id !== 'string'
    || !input.id
    || typeof input.sessionId !== 'string'
    || !input.sessionId
    || !['user', 'ai', 'mutual'].includes(input.actor)
    || !DIMENSION_DELTAS[input.category]
  ) {
    throw new Error('Invalid relationship event');
  }
  if (current.evidence.some(event => event.id === input.id)) return current;

  const state = structuredClone(current);
  const event: RelationshipEvidenceEvent = {
    ...input,
    strength: clamp01(Number.isFinite(input.strength) ? input.strength : 0),
    timestamp: Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
    note: typeof input.note === 'string' ? input.note.slice(0, 300) : undefined,
  };
  const repetitions = state.evidence.filter(existing =>
    existing.sessionId === event.sessionId
    && existing.actor === event.actor
    && existing.category === event.category
  ).length;
  const repetitionScale = repetitions === 0 ? 1 : repetitions === 1 ? 0.25 : 0.1;
  const scale = event.strength * repetitionScale;

  for (const [dimension, delta] of Object.entries(DIMENSION_DELTAS[event.category])) {
    const key = dimension as keyof RelationshipDimensions;
    const scaledDelta = (delta ?? 0) * scale;
    if (key === 'romanticInterest') {
      if (event.actor === 'user' || event.actor === 'mutual') {
        applySessionCappedDelta(state, event.sessionId, 'userRomanticInterest', scaledDelta * (event.actor === 'mutual' ? 0.75 : 1));
      }
      if (event.actor === 'ai' || event.actor === 'mutual') {
        applySessionCappedDelta(state, event.sessionId, 'aiRomanticInterest', scaledDelta * (event.actor === 'mutual' ? 0.75 : 1));
      }
      continue;
    }
    applySessionCappedDelta(state, event.sessionId, key, scaledDelta);
  }

  if (ROMANTIC_CATEGORIES.has(event.category) && event.accepted === true) {
    applySessionCappedDelta(state, event.sessionId, 'mutualRomanticConfidence', 0.06 * scale);
  }
  if (ROMANTIC_CATEGORIES.has(event.category) && event.actor === 'mutual') {
    applySessionCappedDelta(state, event.sessionId, 'mutualRomanticConfidence', 0.08 * scale);
  }
  if (event.category === 'boundary_rejection' || event.category === 'discomfort') {
    applySessionCappedDelta(state, event.sessionId, 'mutualRomanticConfidence', -0.2 * scale);
  }
  state.dimensions.romanticInterest = clamp01(
    Math.min(state.dimensions.userRomanticInterest, state.dimensions.aiRomanticInterest) * 0.75
      + state.dimensions.mutualRomanticConfidence * 0.25,
  );

  state.evidence.push(event);
  if (state.evidence.length > 300) state.evidence = state.evidence.slice(-300);
  state.updatedAt = event.timestamp;

  if (event.category === 'boundary_rejection') {
    state.boundaryStatus = 'closed';
    state.candidate = null;
  } else if (event.category === 'discomfort') {
    state.boundaryStatus = 'cautious';
    state.candidate = null;
  } else if (event.category === 'boundary_reopened' && event.accepted === true) {
    let lastRejectionIndex = -1;
    for (let index = state.evidence.length - 1; index >= 0; index--) {
      if (state.evidence[index].category === 'boundary_rejection' || state.evidence[index].category === 'discomfort') {
        lastRejectionIndex = index;
        break;
      }
    }
    const repairEvidence = uniqueEffectiveEvidence(state.evidence.slice(lastRejectionIndex + 1))
      .filter(existing => existing.category === 'repair' || existing.category === 'boundary_respected');
    const repairSessions = distinctCount(repairEvidence.map(existing => existing.sessionId));
    if (repairEvidence.length >= 2 && repairSessions >= 2) state.boundaryStatus = 'open';
  }

  evaluateStage(state);
  return state;
}

export function evaluateRelationshipEventsV2(
  events: RelationshipEvidenceEvent[],
  initialState = createRelationshipStateV2(events[0]?.timestamp ?? Date.now()),
): RelationshipStateV2 {
  return events.reduce(applyRelationshipEventV2, initialState);
}

export function getRelationshipProgressReportV2(state: RelationshipStateV2): RelationshipProgressReport {
  const effective = uniqueEffectiveEvidence(state.evidence);
  const target = nextStage(state.stage);
  const blockers: string[] = [];
  if (state.boundaryStatus === 'closed') blockers.push('存在明确拒绝，浪漫阶段入口已关闭');
  if (state.boundaryStatus === 'cautious') blockers.push('存在不适信号，需要先确认边界');
  if (!state.candidate && target) blockers.push(`尚未形成进入${STAGE_LABELS_V2[target]}的多事件证据组合`);
  if (state.candidate) blockers.push(`正在观察进入${STAGE_LABELS_V2[state.candidate.target]}后的持续性与双向性`);

  return {
    stage: state.stage,
    nextStage: target,
    candidate: state.candidate,
    dimensions: state.dimensions,
    effectiveEventCount: effective.length,
    categoryCount: distinctCount(effective.map(event => event.category)),
    sessionCount: distinctCount(effective.map(event => event.sessionId)),
    userEvidenceCount: countActor(effective, 'user'),
    aiEvidenceCount: countActor(effective, 'ai'),
    blockers,
  };
}

export { STAGE_LABELS_V2 };
