import { describe, expect, it } from 'vitest';
import { evaluateExpressionGate } from '../expressionGate';
import { createInitialCharacterState } from '../characterStateEngine';
import { runUnderstandingTurn } from '../understandingLoop';
import { StateTransitionRecord } from '../contracts';

function makeTransition(
  overrides: Partial<StateTransitionRecord> = {}
): StateTransitionRecord {
  return {
    eventId: 'evt-1',
    idempotencyKey: 'k-1',
    mode: 'bounded_live',
    before: { valence: 0.15, arousal: 0 },
    decayed: { valence: 0.15, arousal: 0 },
    deltasBySource: {
      roleAppraisal: { valence: 0.12, arousal: 0.12 },
      characterSimulation: { valence: 0, arousal: 0 },
      legacyContagion: { valence: 0, arousal: 0 },
    },
    after: { valence: 0.55, arousal: 0.35 },
    matchedConcernId: 'concern-celebrate-high-pos',
    evidenceIds: ['ev-evt-1-0'],
    containsSimulationSource: false,
    ruleVersion: 'state-engine-v2.0',
    timestamp: '2026-11-25T10:00:00Z',
    ...overrides,
  };
}

describe('WO-04: expressionGate 6-step filter invariants', () => {
  const highState = {
    ...createInitialCharacterState('2026-11-25T10:00:00Z', 0.15, 0),
    valence: 0.55,
    arousal: 0.35,
  };

  it('yields unconditionally on crisis and explicit user negative affect', () => {
    const crisisTurn = runUnderstandingTurn({
      eventId: 'evt-c',
      actor: 'user',
      text: '我觉得活着没意义了，想结束一切。',
      timestamp: '2026-11-25T10:00:00Z',
    });
    expect(
      evaluateExpressionGate(
        highState,
        crisisTurn,
        { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
        makeTransition()
      ).reasonCode
    ).toBe('yield_to_crisis');

    const negativeTurn = runUnderstandingTurn({
      eventId: 'evt-n',
      actor: 'user',
      text: '今天方案又被打回，我现在特别沮丧。',
      timestamp: '2026-11-25T10:00:00Z',
    });
    expect(
      evaluateExpressionGate(
        highState,
        negativeTurn,
        { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
        makeTransition()
      ).reasonCode
    ).toBe('yield_to_user_negative');
  });

  it('enforces deadzone, traceability, budget, and virtual context tagging', () => {
    const positiveTurn = runUnderstandingTurn({
      eventId: 'evt-p',
      actor: 'user',
      text: '今天发布顺利通过，我现在特别开心。',
      timestamp: '2026-11-25T10:00:00Z',
    });

    const baselineState = createInitialCharacterState('2026-11-25T10:00:00Z', 0.15, 0);
    expect(
      evaluateExpressionGate(
        baselineState,
        positiveTurn,
        { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
        makeTransition()
      ).reasonCode
    ).toBe('below_deadzone');

    expect(
      evaluateExpressionGate(
        highState,
        positiveTurn,
        { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
        makeTransition({ evidenceIds: [], matchedConcernId: undefined })
      ).reasonCode
    ).toBe('untraceable_source');

    expect(
      evaluateExpressionGate(
        highState,
        positiveTurn,
        { windowTurns: 5, expressionsInWindow: 1, maxExpressionsInWindow: 1 },
        makeTransition()
      ).reasonCode
    ).toBe('budget_exhausted');

    const simAllowed = evaluateExpressionGate(
      highState,
      positiveTurn,
      { windowTurns: 5, expressionsInWindow: 0, maxExpressionsInWindow: 1 },
      makeTransition({ containsSimulationSource: true })
    );
    expect(simAllowed.allowSelfExpression).toBe(true);
    expect(simAllowed.mustMarkVirtualContext).toBe(true);
    expect(simAllowed.maxSentences).toBe(1);
  });
});
