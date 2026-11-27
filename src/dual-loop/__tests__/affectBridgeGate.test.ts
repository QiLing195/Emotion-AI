import { describe, expect, it } from 'vitest';
import {
  AffectBridgeInput,
  RoleReferences,
  SCHEMA_VERSION,
} from '../contracts';
import {
  buildIdempotencyKey,
  evaluateAffectBridge,
} from '../affectBridgeGate';
import { DEFAULT_ROLE_REFERENCES } from '../ledgerReplay';

function makeInput(overrides: Partial<AffectBridgeInput> = {}): AffectBridgeInput {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: 'evt-test-1',
    eventTimestamp: '2026-11-25T12:00:00Z',
    subject: 'user',
    reportedBy: 'user',
    reportKind: 'explicit_self_report',
    temporalScope: 'moment',
    hypotheses: [
      {
        label: '沮丧',
        valence: -0.68,
        arousal: 0.42,
        evidenceIds: ['ev-1'],
        isAlternative: false,
      },
    ],
    evidenceIds: ['ev-1'],
    causeEvidenceIds: ['ev-1'],
    certainty: 0.9,
    inferenceUncertainty: 0.15,
    userRefusal: false,
    crisisFlag: false,
    userCorrection: false,
    ...overrides,
  };
}

describe('WO-02: affectBridgeGate 7-gate invariants', () => {
  it('Gate 1: crisis flag unconditionally bypasses role loop', () => {
    const res = evaluateAffectBridge(
      makeInput({ crisisFlag: true }),
      DEFAULT_ROLE_REFERENCES
    );
    expect(res.decision).toBe('crisis_safety_bypass');
  });

  it('Gate 2: user refusal abstains immediately', () => {
    const res = evaluateAffectBridge(
      makeInput({ userRefusal: true }),
      DEFAULT_ROLE_REFERENCES
    );
    expect(res.decision).toBe('abstain_user_refusal');
  });

  it('Gate 3: duplicate event key is ignored while correction supersedes cleanly', () => {
    const first = makeInput();
    const key = buildIdempotencyKey(first, DEFAULT_ROLE_REFERENCES.appraisalVersion);
    const seen = new Set<string>([key]);

    expect(
      evaluateAffectBridge(first, DEFAULT_ROLE_REFERENCES, seen).decision
    ).toBe('duplicate_event_ignored');

    const correction = makeInput({
      eventId: 'evt-test-2',
      userCorrection: true,
      supersedesEventId: 'evt-test-1',
    });
    const corrRes = evaluateAffectBridge(
      correction,
      DEFAULT_ROLE_REFERENCES,
      seen
    );
    expect(corrRes.decision).toBe('care_response_candidate');
    expect(corrRes.supersedesEventId).toBe('evt-test-1');
  });

  it('Gate 4: blocks third-party, quoted, mixed, historical, and hypothetical inputs', () => {
    const blockedVariants: Array<Partial<AffectBridgeInput>> = [
      { subject: 'third_party' },
      { subject: 'multiple' },
      { reportedBy: 'quoted', reportKind: 'quoted_or_third_party' },
      { reportKind: 'mixed' },
      { reportKind: 'inferred' },
      { temporalScope: 'historical' },
      { temporalScope: 'hypothetical' },
      { temporalScope: 'unknown' },
    ];
    for (const variant of blockedVariants) {
      const res = evaluateAffectBridge(
        makeInput(variant),
        DEFAULT_ROLE_REFERENCES
      );
      expect(res.decision).toBe('ambiguous_affect_context');
    }
  });

  it('Gate 5: never defaults unknown certainty/uncertainty to neutral or 0', () => {
    expect(
      evaluateAffectBridge(
        makeInput({ certainty: 'unknown' }),
        DEFAULT_ROLE_REFERENCES
      ).decision
    ).toBe('no_reading');

    expect(
      evaluateAffectBridge(
        makeInput({ inferenceUncertainty: 'unknown' }),
        DEFAULT_ROLE_REFERENCES
      ).decision
    ).toBe('no_reading');

    expect(
      evaluateAffectBridge(
        makeInput({ inferenceUncertainty: 0.5 }),
        DEFAULT_ROLE_REFERENCES
      ).decision
    ).toBe('no_reading');

    expect(
      evaluateAffectBridge(
        makeInput({ evidenceIds: [] }),
        DEFAULT_ROLE_REFERENCES
      ).decision
    ).toBe('no_reading');
  });

  it('Gate 6 & 7: requires owner-confirmed constitution and unexpired sourced concern', () => {
    const unconfirmedRefs: RoleReferences = {
      ...DEFAULT_ROLE_REFERENCES,
      constitution: {
        version: 'draft',
        confirmedByOwner: false,
        values: ['draft'],
        goals: [],
        hardBoundaries: [],
      },
    };
    expect(
      evaluateAffectBridge(makeInput(), unconfirmedRefs).decision
    ).toBe('no_reading');

    const expiredRes = evaluateAffectBridge(
      makeInput(),
      DEFAULT_ROLE_REFERENCES,
      new Set(),
      '2027-01-05T00:00:00Z'
    );
    expect(expiredRes.decision).toBe('no_reading');

    const validRes = evaluateAffectBridge(
      makeInput(),
      DEFAULT_ROLE_REFERENCES,
      new Set(),
      '2026-11-25T12:00:00Z'
    );
    expect(validRes.decision).toBe('care_response_candidate');
    expect(validRes.matchedConcernId).toBe('concern-support-high-neg');
  });
});
