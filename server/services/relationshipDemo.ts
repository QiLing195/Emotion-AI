import {
  evaluateRelationshipEventsV2,
  getRelationshipProgressReportV2,
  STAGE_LABELS_V2,
} from '../../src/lib/relationshipProgressionV2.js';
import type {
  RelationshipActor,
  RelationshipEventCategory,
  RelationshipEvidenceEvent,
} from '../../src/lib/relationshipProgressionV2.js';

interface ScenarioDefinition {
  description: string;
  events: RelationshipEvidenceEvent[];
}

function createEventFactory() {
  let sequence = 0;
  return (
    category: RelationshipEventCategory,
    actor: RelationshipActor,
    sessionId: string,
    strength = 1,
    accepted?: boolean,
    note?: string,
  ): RelationshipEvidenceEvent => {
    sequence++;
    return {
      id: `demo_${sequence}`,
      category,
      actor,
      sessionId,
      strength,
      accepted,
      note,
      timestamp: 1_700_000_000_000 + sequence * 60_000,
    };
  };
}

function baseFriendship(event: ReturnType<typeof createEventFactory>): RelationshipEvidenceEvent[] {
  return [
    event('conversation', 'user', 's1', 1, undefined, 'First conversation'),
    event('conversation', 'ai', 's1'),
    event('self_disclosure', 'user', 's2', 1, undefined, 'Shares a personal difficulty'),
    event('remembered_detail', 'ai', 's2'),
    event('reliable_support', 'ai', 's3'),
    event('proactive_contact', 'user', 's3'),
    event('reliable_support', 'ai', 's4'),
    event('shared_activity', 'mutual', 's4'),
    event('boundary_respected', 'user', 's5', 1, true),
    event('conversation', 'ai', 's6'),
  ];
}

function mutualRomance(event: ReturnType<typeof createEventFactory>): RelationshipEvidenceEvent[] {
  return [
    event('special_attention', 'user', 's7'),
    event('romantic_expression', 'user', 's7'),
    event('special_attention', 'ai', 's8'),
    event('affectionate_response', 'ai', 's8', 1, true),
    event('relationship_discussion', 'mutual', 's9'),
    event('romantic_expression', 'ai', 's9'),
    event('affectionate_response', 'user', 's10', 1, true),
    event('special_attention', 'mutual', 's11', 1, true),
  ];
}

export function buildRelationshipDemoScenarios(): Record<string, ScenarioDefinition> {
  const supportEvent = createEventFactory();
  const confessionEvent = createEventFactory();
  const romanceEvent = createEventFactory();
  const commitmentEvent = createEventFactory();
  const rejectionEvent = createEventFactory();

  return {
    support_only: {
      description: 'Vulnerability and support build trust, but do not create romance.',
      events: [
        ...baseFriendship(supportEvent),
        supportEvent('self_disclosure', 'user', 's7'),
        supportEvent('reliable_support', 'ai', 's7'),
        supportEvent('self_disclosure', 'user', 's8'),
        supportEvent('reliable_support', 'ai', 's8'),
      ],
    },
    single_confession: {
      description: 'One confession is evidence, not a stage transition.',
      events: [
        ...baseFriendship(confessionEvent),
        confessionEvent('explicit_confession', 'user', 's7'),
      ],
    },
    mutual_romance: {
      description: 'Reciprocal romantic evidence across sessions can enter the crush stage.',
      events: [...baseFriendship(romanceEvent), ...mutualRomance(romanceEvent)],
    },
    mutual_commitment: {
      description: 'Confession, acceptance, confirmation, and continuity can enter the lover stage.',
      events: [
        ...baseFriendship(commitmentEvent),
        ...mutualRomance(commitmentEvent),
        commitmentEvent('explicit_confession', 'user', 's12'),
        commitmentEvent('relationship_discussion', 'ai', 's12'),
        commitmentEvent('explicit_acceptance', 'ai', 's13', 1, true),
        commitmentEvent('mutual_confirmation', 'mutual', 's13', 1, true),
        commitmentEvent('future_plan', 'mutual', 's14'),
      ],
    },
    boundary_rejection: {
      description: 'An explicit rejection closes romantic progression until repair and reopening.',
      events: [
        ...baseFriendship(rejectionEvent),
        ...mutualRomance(rejectionEvent),
        rejectionEvent('boundary_rejection', 'user', 's12', 1, false),
        rejectionEvent('explicit_confession', 'ai', 's13'),
      ],
    },
  };
}

export function runRelationshipDemo(events: RelationshipEvidenceEvent[]) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 200) {
    throw new Error('events must contain between 1 and 200 entries');
  }
  const state = evaluateRelationshipEventsV2(events);
  const report = getRelationshipProgressReportV2(state);
  return {
    state,
    report: {
      ...report,
      stageLabel: STAGE_LABELS_V2[report.stage],
      nextStageLabel: report.nextStage ? STAGE_LABELS_V2[report.nextStage] : null,
    },
  };
}
