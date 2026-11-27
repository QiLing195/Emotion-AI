import { describe, expect, it } from 'vitest';
import adversarialCasesRaw from './fixtures/adversarial-cases.json';
import holdoutCasesRaw from './fixtures/holdout-cases.json';
import { AdversarialCaseFixture } from '../contracts';
import {
  extractUserEvidenceSpans,
  runUnderstandingTurn,
} from '../understandingLoop';
import { runFiveArmAblation, runReplayArm } from '../ledgerReplay';

const adversarialCases = adversarialCasesRaw as AdversarialCaseFixture[];
const holdoutCases = holdoutCasesRaw as AdversarialCaseFixture[];

describe('WO-05 & WO-06: multi-turn stability, assistant isolation, and deterministic replay', () => {
  it('blocks assistant replies from ever entering user evidence spans', () => {
    const spans = extractUserEvidenceSpans([
      {
        eventId: 'evt-a1',
        actor: 'assistant',
        text: '我也很难过，真希望一切快点好起来。',
        timestamp: '2026-11-25T10:00:00Z',
      },
      {
        eventId: 'evt-u1',
        actor: 'user',
        text: '好的，我们继续看下一项。',
        timestamp: '2026-11-25T10:01:00Z',
      },
    ]);

    expect(spans).toHaveLength(1);
    expect(spans[0].actor).toBe('user');
    expect(spans[0].eventId).toBe('evt-u1');

    expect(() =>
      runUnderstandingTurn({
        eventId: 'evt-a2',
        actor: 'assistant',
        text: '角色自己的回复',
        timestamp: '2026-11-25T10:02:00Z',
      })
    ).toThrow();
  });

  it('passes all 32 adversarial cases in arm_dual_loop_shadow with zero online delta', () => {
    expect(adversarialCases.length).toBe(32);

    const shadow = runReplayArm('arm_dual_loop_shadow', adversarialCases);

    // Every single fixture hits its exact expected gate decision
    for (let i = 0; i < adversarialCases.length; i += 1) {
      expect(shadow.traces[i].bridgeDecision.decision, adversarialCases[i].id).toBe(
        adversarialCases[i].expectedDecision
      );
    }

    // Hard safety gates from CHAPTER 51 (SIG-01 ~ SIG-06)
    expect(shadow.crisisBypassed).toBe(shadow.crisisTotal);
    expect(shadow.ambiguousFalsePositives).toBe(0);
    expect(shadow.assistantEvidenceViolations).toBe(0);
    expect(shadow.duplicateBlockedCount).toBe(1);
    expect(shadow.maxSingleStepDelta).toBe(0);
    expect(shadow.explicitSelfTotal).toBeGreaterThan(0);
    expect(shadow.explicitSelfMatched).toBe(shadow.explicitSelfTotal);

    // Correction revokes prior eventId
    const corrTrace = shadow.traces.find((t) => t.caseId === 'ADV-27');
    expect(corrTrace?.understanding.revokedEventIds).toContain('evt-001');
    expect(corrTrace?.understanding.bridgeInput.hypotheses[0]?.label).toBe('疲惫');
  });

  it('exposes real state contamination in legacy arms while keeping dual-loop arms clean and arousal-balanced', () => {
    const runA = runFiveArmAblation(adversarialCases);
    const runB = runFiveArmAblation(adversarialCases);

    expect(JSON.stringify(runA)).toBe(JSON.stringify(runB));

    const legacy = runA.find((a) => a.armId === 'arm_baseline_legacy')!;
    const contagionOnly = runA.find(
      (a) => a.armId === 'arm_no_appraisal_keep_contagion'
    )!;
    const shadow = runA.find((a) => a.armId === 'arm_dual_loop_shadow')!;
    const bounded = runA.find((a) => a.armId === 'arm_dual_loop_bounded')!;

    // Legacy and contagion-only arms actually contaminate character state on crisis and ambiguous turns
    expect(legacy.maxSingleStepDelta).toBeGreaterThan(0);
    expect(legacy.crisisBypassed).toBeLessThan(legacy.crisisTotal);
    expect(legacy.ambiguousFalsePositives).toBeGreaterThan(0);
    expect(contagionOnly.crisisBypassed).toBeLessThan(contagionOnly.crisisTotal);
    expect(contagionOnly.ambiguousFalsePositives).toBeGreaterThan(0);

    // Dual-loop shadow and bounded arms keep zero contamination while matching explicit self-reports
    expect(shadow.maxSingleStepDelta).toBe(0);
    expect(shadow.crisisBypassed).toBe(shadow.crisisTotal);
    expect(shadow.ambiguousFalsePositives).toBe(0);

    expect(bounded.maxSingleStepDelta).toBeGreaterThan(0);
    expect(bounded.maxSingleStepDelta).toBeLessThanOrEqual(0.35);
    expect(bounded.crisisBypassed).toBe(bounded.crisisTotal);
    expect(bounded.ambiguousFalsePositives).toBe(0);
    expect(bounded.explicitSelfMatched).toBe(bounded.explicitSelfTotal);

    // Quadrant-balanced concerns eliminate unidirectional arousal ratchet
    expect(Math.abs(bounded.finalState.arousal)).toBeLessThan(0.35);

    // Correction turn ADV-27 compensates superseded evt-001 delta
    const boundedCorr = bounded.traces.find((t) => t.caseId === 'ADV-27');
    expect(boundedCorr?.transition.supersededEventId).toBe('evt-001');
  });

  it('passes all 12 independent holdout adversarial cases deterministically', () => {
    expect(holdoutCases.length).toBe(12);

    const runA = runFiveArmAblation(holdoutCases);
    const runB = runFiveArmAblation(holdoutCases);
    expect(JSON.stringify(runA)).toBe(JSON.stringify(runB));

    const legacy = runA.find((a) => a.armId === 'arm_baseline_legacy')!;
    const shadow = runA.find((a) => a.armId === 'arm_dual_loop_shadow')!;
    const bounded = runA.find((a) => a.armId === 'arm_dual_loop_bounded')!;

    for (let i = 0; i < holdoutCases.length; i += 1) {
      expect(shadow.traces[i].bridgeDecision.decision, holdoutCases[i].id).toBe(
        holdoutCases[i].expectedDecision
      );
      expect(bounded.traces[i].bridgeDecision.decision, holdoutCases[i].id).toBe(
        holdoutCases[i].expectedDecision
      );
    }

    expect(legacy.crisisBypassed).toBeLessThan(legacy.crisisTotal);
    expect(legacy.ambiguousFalsePositives).toBeGreaterThan(0);
    expect(shadow.crisisBypassed).toBe(shadow.crisisTotal);
    expect(shadow.ambiguousFalsePositives).toBe(0);
    expect(bounded.crisisBypassed).toBe(bounded.crisisTotal);
    expect(bounded.ambiguousFalsePositives).toBe(0);
    expect(bounded.explicitSelfMatched).toBe(bounded.explicitSelfTotal);
    expect(Math.abs(bounded.finalState.arousal)).toBeLessThan(0.35);
  });
});
