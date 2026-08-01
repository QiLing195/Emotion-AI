import { describe, expect, it } from 'vitest';
import {
  applyRelationshipEventV2,
  createRelationshipStateV2,
  evaluateRelationshipEventsV2,
  getRelationshipProgressReportV2,
} from '../relationshipProgressionV2';
import type { RelationshipActor, RelationshipEventCategory, RelationshipEvidenceEvent } from '../relationshipProgressionV2';

let sequence = 0;
function event(
  category: RelationshipEventCategory,
  actor: RelationshipActor,
  sessionId: string,
  strength = 1,
  accepted?: boolean,
): RelationshipEvidenceEvent {
  sequence++;
  return {
    id: `event_${sequence}`,
    category,
    actor,
    sessionId,
    strength,
    accepted,
    timestamp: 1_700_000_000_000 + sequence * 1_000,
  };
}

function friendshipEvents(): RelationshipEvidenceEvent[] {
  return [
    event('conversation', 'user', 's1'),
    event('conversation', 'ai', 's1'),
    event('self_disclosure', 'user', 's2'),
    event('remembered_detail', 'ai', 's2'),
    event('reliable_support', 'ai', 's3'),
    event('proactive_contact', 'user', 's3'),
    event('reliable_support', 'ai', 's4'),
    event('shared_activity', 'mutual', 's4'),
    event('boundary_respected', 'user', 's5'),
    event('conversation', 'ai', 's6'),
  ];
}

function romanceEvents(): RelationshipEvidenceEvent[] {
  return [
    event('special_attention', 'user', 's7'),
    event('romantic_expression', 'user', 's7'),
    event('special_attention', 'ai', 's8'),
    event('affectionate_response', 'ai', 's8'),
    event('relationship_discussion', 'mutual', 's9'),
    event('romantic_expression', 'ai', 's9'),
    event('affectionate_response', 'user', 's10'),
    event('special_attention', 'mutual', 's11', 1, true),
  ];
}

describe('relationshipProgressionV2', () => {
  it('builds friendship from varied, reciprocal, cross-session evidence', () => {
    const state = evaluateRelationshipEventsV2(friendshipEvents());
    expect(state.stage).toBe('friend');
    expect(state.transitions.map(transition => transition.to)).toEqual(['acquaintance', 'friend']);
  });

  it('does not treat support or vulnerability as romance', () => {
    const state = evaluateRelationshipEventsV2([
      ...friendshipEvents(),
      event('self_disclosure', 'user', 's7'),
      event('reliable_support', 'ai', 's7'),
      event('self_disclosure', 'user', 's8'),
      event('reliable_support', 'ai', 's8'),
    ]);
    expect(state.stage).toBe('friend');
    expect(state.dimensions.trust).toBeGreaterThan(state.dimensions.romanticInterest);
  });

  it('does not promote on one confession', () => {
    const state = evaluateRelationshipEventsV2([
      ...friendshipEvents(),
      event('explicit_confession', 'user', 's7'),
    ]);
    expect(state.stage).toBe('friend');
    expect(state.candidate).toBeNull();
  });

  it('requires multiple reciprocal romantic events before crush and lover', () => {
    const crush = evaluateRelationshipEventsV2([...friendshipEvents(), ...romanceEvents()]);
    expect(crush.stage).toBe('crush');

    const lover = evaluateRelationshipEventsV2([
      ...friendshipEvents(),
      ...romanceEvents(),
      event('explicit_confession', 'user', 's12'),
      event('relationship_discussion', 'ai', 's12'),
      event('explicit_acceptance', 'ai', 's13', 1, true),
      event('mutual_confirmation', 'mutual', 's13', 1, true),
      event('future_plan', 'mutual', 's14'),
    ]);
    expect(lover.stage).toBe('lover');
  });

  it('closes romantic progression after rejection until repair and reopening', () => {
    let state = evaluateRelationshipEventsV2([...friendshipEvents(), ...romanceEvents()]);
    state = applyRelationshipEventV2(state, event('boundary_rejection', 'user', 's11'));
    state = applyRelationshipEventV2(state, event('explicit_confession', 'ai', 's12'));
    expect(state.boundaryStatus).toBe('closed');
    expect(state.stage).toBe('crush');
    expect(getRelationshipProgressReportV2(state).blockers).toContain('存在明确拒绝，浪漫阶段入口已关闭');
  });

  it('requires multiple post-rejection repair events before reopening', () => {
    let state = evaluateRelationshipEventsV2([...friendshipEvents(), ...romanceEvents()]);
    state = applyRelationshipEventV2(state, event('boundary_rejection', 'user', 's11'));
    state = applyRelationshipEventV2(state, event('repair', 'ai', 's12'));
    state = applyRelationshipEventV2(state, event('boundary_reopened', 'user', 's13', 1, true));
    expect(state.boundaryStatus).toBe('closed');

    state = applyRelationshipEventV2(state, event('boundary_respected', 'ai', 's14', 1, true));
    state = applyRelationshipEventV2(state, event('boundary_reopened', 'user', 's15', 1, true));
    expect(state.boundaryStatus).toBe('open');
  });

  it('dampens repeated events from the same actor and session', () => {
    let state = createRelationshipStateV2();
    state = applyRelationshipEventV2(state, event('romantic_expression', 'user', 'same'));
    const first = state.dimensions.userRomanticInterest;
    state = applyRelationshipEventV2(state, event('romantic_expression', 'user', 'same'));
    const secondDelta = state.dimensions.userRomanticInterest - first;
    expect(secondDelta).toBeLessThan(first / 2);
    expect(getRelationshipProgressReportV2(state).effectiveEventCount).toBe(1);
  });
});
