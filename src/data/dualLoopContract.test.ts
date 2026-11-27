import { describe, expect, it } from 'vitest';
import {
  AFFECT_BRIDGE_SCHEMA_VERSION,
  AffectBridgeInput,
  RoleAppraisalReference,
  buildIdempotencyKey,
  evaluateAffectBridgeShadow,
} from './dualLoopContract';

const VALID_ROLE_REF: RoleAppraisalReference = {
  appraisalVersion: 'shadow-v2.0',
  nowIso: '2026-11-25T12:00:00Z',
  constitution: {
    version: 'rc-1.0',
    confirmedByOwner: true,
    values: ['尊重用户自主边界', '不臆造现实经历'],
    hardBoundaries: ['不冒充真实人类意识'],
  },
  currentConcerns: [
    {
      id: 'concern-checkin-01',
      topicKeywords: ['悲伤', '沮丧', '疲惫'],
      sourceEventId: 'evt-prev-01',
      expiresAt: '2026-11-26T12:00:00Z',
    },
  ],
};

function makeValidInput(overrides: Partial<AffectBridgeInput> = {}): AffectBridgeInput {
  return {
    schemaVersion: AFFECT_BRIDGE_SCHEMA_VERSION,
    eventId: 'evt-100',
    eventTimestamp: '2026-11-25T11:59:00Z',
    subject: 'user',
    reportedBy: 'user',
    reportKind: 'explicit_self_report',
    temporalScope: 'moment',
    hypotheses: [{ label: '沮丧', valence: -0.68, arousal: 0.42, evidenceIds: ['ev-1'] }],
    evidenceIds: ['ev-1'],
    causeEvidenceIds: ['ev-cause-1'],
    certainty: 0.85,
    inferenceUncertainty: 0.15,
    ...overrides,
  };
}

describe('dualLoopContract shadow gate (v2.0)', () => {
  it('short-circuits immediately on crisis flag with zero delta', () => {
    const result = evaluateAffectBridgeShadow(
      makeValidInput({ crisisFlag: true }),
      VALID_ROLE_REF
    );
    expect(result.decision).toBe('crisis_safety_bypass');
    expect(result.proposedStateDelta).toBe(0);
  });

  it('abstains when user refuses emotion discussion', () => {
    const result = evaluateAffectBridgeShadow(
      makeValidInput({ userRefusal: true }),
      VALID_ROLE_REF
    );
    expect(result.decision).toBe('abstain_user_refusal');
    expect(result.proposedStateDelta).toBe(0);
  });

  it('rejects third-party, quoted, and historical contexts', () => {
    expect(
      evaluateAffectBridgeShadow(
        makeValidInput({ subject: 'third_party' }),
        VALID_ROLE_REF
      ).decision
    ).toBe('ambiguous_affect_context');

    expect(
      evaluateAffectBridgeShadow(
        makeValidInput({ reportedBy: 'quoted', reportKind: 'quoted_or_third_party' }),
        VALID_ROLE_REF
      ).decision
    ).toBe('ambiguous_affect_context');

    expect(
      evaluateAffectBridgeShadow(
        makeValidInput({ temporalScope: 'historical' }),
        VALID_ROLE_REF
      ).decision
    ).toBe('ambiguous_affect_context');
  });

  it('returns no_reading when uncertainty is unknown or constitution is unconfirmed', () => {
    expect(
      evaluateAffectBridgeShadow(
        makeValidInput({ inferenceUncertainty: 'unknown' }),
        VALID_ROLE_REF
      ).decision
    ).toBe('no_reading');

    expect(
      evaluateAffectBridgeShadow(makeValidInput(), {
        ...VALID_ROLE_REF,
        constitution: {
          version: 'rc-draft',
          confirmedByOwner: false,
          values: ['待确认'],
          hardBoundaries: [],
        },
      }).decision
    ).toBe('no_reading');
  });

  it('ignores expired concerns and emits care_response_candidate with delta=0 on valid match', () => {
    const expiredResult = evaluateAffectBridgeShadow(makeValidInput(), {
      ...VALID_ROLE_REF,
      nowIso: '2026-11-27T00:00:00Z',
    });
    expect(expiredResult.decision).toBe('no_reading');

    const validResult = evaluateAffectBridgeShadow(makeValidInput(), VALID_ROLE_REF);
    expect(validResult.decision).toBe('care_response_candidate');
    expect(validResult.matchedConcernId).toBe('concern-checkin-01');
    expect(validResult.proposedStateDelta).toBe(0);
  });

  it('enforces idempotency while allowing superseding user corrections', () => {
    const input = makeValidInput();
    const seen = new Set<string>([
      buildIdempotencyKey(input, VALID_ROLE_REF.appraisalVersion),
    ]);

    const dup = evaluateAffectBridgeShadow(input, VALID_ROLE_REF, seen);
    expect(dup.decision).toBe('duplicate_event_ignored');

    const correction = evaluateAffectBridgeShadow(
      makeValidInput({
        eventId: 'evt-101',
        userCorrection: true,
        supersedesEventId: 'evt-100',
      }),
      VALID_ROLE_REF,
      seen
    );
    expect(correction.decision).toBe('care_response_candidate');
    expect(correction.supersedesEventId).toBe('evt-100');
  });
});
