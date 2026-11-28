import { describe, expect, it } from 'vitest';
import { assess } from './appraisal.ts';
import type { AppraisalInput } from './appraisal.ts';
import { emotionRules, initialEmotion, projectEmotion } from './emotionModel.ts';

export const feedback: AppraisalInput = {
  appraisalId: 'appraisal-test', eventId: 'observed-event', goalCongruence: -0.8,
  causalAgency: { self: 0.7, user: 0.2, environment: 0.1 }, perceivedIntent: 'unknown',
  fairness: 0.8, controllability: 0.6, confidence: 0.8, evidence: ['observation-test'], intentEvidence: [],
};

describe('M2a evidence-constrained appraisal and emotion provenance', () => {
  it('keeps causal agency distinct from unknown intent and computes L1→L2→L3→one modulation pass', () => {
    const state = projectEmotion(initialEmotion, {
      kind: 'emotion', eventId: 'commit-test', appraisal: feedback, relationshipSignal: 0.7, rules: emotionRules,
    });
    expect(assess(feedback)).toMatchObject({ confidence: 0.5, uncertainty: 0.5, perceivedIntent: 'unknown' });
    expect(state.basic.Anger).toBe(0);
    expect(state.basic.Sadness).toBeGreaterThan(0.1);
    expect(state.cognitive.Guilt).toBeCloseTo(0.0252, 5);
    expect(state.relationship.Attachment).toBe(0);
    expect(state.provenance).toMatchObject({ eventId: 'commit-test', appraisalId: 'appraisal-test', evidenceIds: ['observation-test'] });
    expect(state.provenance?.layers.map(({ layer }) => layer)).toEqual(['L1', 'L2', 'L3', 'cross_layer']);
    expect(state.provenance?.layers[3].changes.B).toBe(state.yi.B);
  });

  it('retains Unknown when supported counterfactuals disagree and rejects invented evidence', () => {
    const alternative = {
      hypothesisId: 'benign', interpretation: 'benevolent', evidenceFor: ['opposing'], evidenceAgainst: ['observation-test'], confidence: 0.9,
    } as const;
    const contested: AppraisalInput = { ...feedback, confidence: 0.7, perceivedIntent: 'hostile',
      evidence: ['observation-test', 'opposing'], intentEvidence: ['observation-test'],
      flags: ['relationship_risk', 'memory_conflict'], alternatives: [alternative] };
    const outcome = assess(contested);
    expect(outcome).toMatchObject({ perceivedIntent: 'unknown', counterfactualTriggered: true, competingConfidence: 0.72 });
    expect(outcome.uncertainty).toBeGreaterThan(0.5);
    expect(() => assess({ ...contested, alternatives: [{ ...alternative, evidenceFor: ['invented'] }] })).toThrow();
    expect(assess({ ...contested, flags: [], goalCongruence: -0.3 }).counterfactualTriggered).toBe(false);
  });
});
