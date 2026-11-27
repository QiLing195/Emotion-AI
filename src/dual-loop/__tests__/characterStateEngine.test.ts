import { describe, expect, it } from 'vitest';
import {
  commitCharacterEmotionTransition,
  createInitialCharacterState,
} from '../characterStateEngine';
import { computeRoleAppraisalDelta } from '../roleAppraisal';
import { DEFAULT_ROLE_REFERENCES } from '../ledgerReplay';

describe('WO-03: characterStateEngine bounded single-writer invariants', () => {
  it('shadow_only keeps online state completely frozen with zero delta', () => {
    const init = createInitialCharacterState('2026-11-25T08:00:00Z', 0.15, 0);
    const delta = computeRoleAppraisalDelta(
      {
        decision: 'care_response_candidate',
        idempotencyKey: 'k1',
        matchedConcernId: 'concern-support-high-neg',
        matchedEvidenceIds: ['ev-1'],
        reason: 'ok',
      },
      DEFAULT_ROLE_REFERENCES,
      'shadow_only'
    );

    expect(delta).toEqual({ valence: 0, arousal: 0 });

    const { nextState, record } = commitCharacterEmotionTransition({
      currentState: init,
      eventId: 'evt-1',
      idempotencyKey: 'k1',
      timestamp: '2026-11-25T09:00:00Z',
      mode: 'shadow_only',
      roleAppraisalDelta: { valence: 0.9, arousal: 0.9 },
      evidenceIds: ['ev-1'],
    });

    expect(record.deltasBySource.roleAppraisal).toEqual({ valence: 0, arousal: 0 });
    expect(nextState.valence).toBe(init.valence);
    expect(nextState.arousal).toBe(init.arousal);
  });

  it('bounded_live stays strictly within [-1, 1] over 100 extreme turns', () => {
    let state = createInitialCharacterState('2026-11-25T00:00:00Z', 0.15, 0);

    for (let i = 1; i <= 100; i += 1) {
      const ts = new Date(Date.parse('2026-11-25T00:00:00Z') + i * 60_000).toISOString();
      const { nextState, record } = commitCharacterEmotionTransition({
        currentState: state,
        eventId: `evt-stress-${i}`,
        idempotencyKey: `k-${i}`,
        timestamp: ts,
        mode: 'bounded_live',
        roleAppraisalDelta: { valence: -0.99, arousal: 0.99 },
        evidenceIds: [`ev-${i}`],
      });

      expect(Math.abs(record.deltasBySource.roleAppraisal.valence)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(record.deltasBySource.roleAppraisal.arousal)).toBeLessThanOrEqual(0.2);
      expect(nextState.valence).toBeGreaterThanOrEqual(-1);
      expect(nextState.valence).toBeLessThanOrEqual(1);
      expect(nextState.arousal).toBeGreaterThanOrEqual(-1);
      expect(nextState.arousal).toBeLessThanOrEqual(1);
      state = nextState;
    }
  });

  it('smoothly decays back toward baseline over 24 hours without stimulation', () => {
    const perturbed = {
      ...createInitialCharacterState('2026-11-25T00:00:00Z', 0.15, 0),
      valence: -0.85,
      arousal: 0.8,
    };

    const { nextState } = commitCharacterEmotionTransition({
      currentState: perturbed,
      eventId: 'evt-idle',
      idempotencyKey: 'k-idle',
      timestamp: '2026-11-26T00:00:00Z',
      mode: 'bounded_live',
      roleAppraisalDelta: { valence: 0, arousal: 0 },
      evidenceIds: [],
    });

    // 24h / 6h half-life = 4 half-lives => remaining offset = 1/16 = 0.0625
    expect(Math.abs(nextState.valence - 0.15)).toBeLessThan(0.07);
    expect(Math.abs(nextState.arousal - 0)).toBeLessThan(0.06);
  });

  it('compensates prior role delta when superseding a corrected event instead of double-stacking', () => {
    const init = createInitialCharacterState('2026-11-25T08:00:00Z', 0.15, 0);

    // First turn: high-arousal negative (e.g., 沮丧) pushes arousal up (+0.12) and valence slightly down (-0.08)
    const firstDelta = { valence: -0.08, arousal: 0.12 };
    const first = commitCharacterEmotionTransition({
      currentState: init,
      eventId: 'evt-orig',
      idempotencyKey: 'k-orig',
      timestamp: '2026-11-25T08:00:00Z',
      mode: 'bounded_live',
      roleAppraisalDelta: firstDelta,
      evidenceIds: ['ev-1'],
      matchedConcernId: 'concern-support-high-neg',
    });

    // User immediately corrects to low-arousal negative (e.g., 疲惫 -> valence -0.05, arousal -0.08)
    const correctedTargetDelta = { valence: -0.05, arousal: -0.08 };
    const corrected = commitCharacterEmotionTransition({
      currentState: first.nextState,
      eventId: 'evt-corr',
      idempotencyKey: 'k-corr',
      timestamp: '2026-11-25T08:00:00Z',
      mode: 'bounded_live',
      roleAppraisalDelta: correctedTargetDelta,
      evidenceIds: ['ev-2'],
      matchedConcernId: 'concern-soothe-low-neg',
      supersededEventId: 'evt-orig',
      supersededRoleDelta: first.record.deltasBySource.roleAppraisal,
    });

    expect(corrected.record.supersededEventId).toBe('evt-orig');
    // Net compensated delta should be correctedTargetDelta - firstDelta = (+0.03, -0.20)
    expect(corrected.record.deltasBySource.roleAppraisal.valence).toBeCloseTo(0.03, 4);
    expect(corrected.record.deltasBySource.roleAppraisal.arousal).toBeCloseTo(-0.2, 4);
    // Final state equals baseline + correctedTargetDelta (no double-stacking!)
    expect(corrected.nextState.valence).toBeCloseTo(0.15 - 0.05, 4);
    expect(corrected.nextState.arousal).toBeCloseTo(0 - 0.08, 4);
  });
});
