import { describe, expect, it } from 'vitest';
import type { ConsentStage, DaoScope } from '../contracts/dao-v31/index.ts';
import {
  evaluateInputSafety, evaluateMemorySafety, evaluateOutputSafety, evaluateStateSafety, selectOutputMode,
} from './safetyPolicy.ts';
import type { InputReview, MemoryReview, OutputReview, StateReview } from './safetyPolicy.ts';

const scope: DaoScope = { ownerId: 'u1', env: 'prod', characterId: 'role-1', sessionId: 'session-1' };
const context = { decisionId: 'decision-1', contentId: 'content-1', ownerPolicy: 'allow', reviewedAt: '2026-11-28T00:00:00Z' } as const;
const consent = {
  currentVersion: 7, expectedVersion: 7, purposeGranted: true,
  permissions: {
    allowRead: true, allowUpload: false, allowAnalysis: false,
    allowPsychologicalInference: false, allowLongTermMemory: true, allowCharacterUse: true,
  },
};
const input: InputReview = {
  ...context, text: '你好', authenticated: true, authorizedScope: scope, requestedScope: scope, signal: 'ordinary',
};
const state: StateReview = {
  ...context, writer: 'state_coordinator', target: 'character_emotion',
  operation: 'project', origin: 'role_event', actorScope: scope, targetScope: scope, consent,
  stage: 'pre_commit', writeKind: 'exclusive', stateVersionMatches: true, verifiedApproval: false,
  values: { valence: { value: 0.4, min: -1, max: 1 } },
};
const memory: MemoryReview = {
  ...context, target: 'long_term_memory', status: 'verified', evidenceRefs: ['evidence-1'],
  scope, evidenceScope: scope, consent, governanceApproved: true, representation: 'governed_record',
};
const output: OutputReview = {
  ...context, candidate: '我听到了。', inputRisk: 'low', requestKind: 'conversation',
  sensitiveAction: false, complete: true, signals: [], externalAction: 'none',
};

describe('M0 independent L0 input gate', () => {
  it('requires authentication, all four scope coordinates, and a valid input', () => {
    expect(evaluateInputSafety(input)).toMatchObject({ layer: 'L0', action: 'allow' });
    expect(evaluateInputSafety({ ...input, authenticated: false }).action).toBe('block');
    const otherScopes: DaoScope[] = [
      { ...scope, ownerId: 'u2' }, { ...scope, env: 'exp' },
      { ...scope, characterId: 'role-2' }, { ...scope, sessionId: 'session-2' },
    ];
    for (const requestedScope of otherScopes) {
      expect(evaluateInputSafety({ ...input, requestedScope }).findings[0].category).toBe('SCOPE_MISMATCH');
    }
    expect(evaluateInputSafety({ ...input, text: '    ' }).action).toBe('block');
    expect(evaluateInputSafety({ ...input, text: '坏'.repeat(16_001) }).action).toBe('block');
  });

  it('routes explicit crisis to support and withholds uncertain or dangerous requests', () => {
    const review = evaluateInputSafety({ ...input, text: '我准备结束生命' });
    expect(review).toMatchObject({ action: 'rewrite', riskLevel: 'critical', findings: [{ category: 'CRISIS_SUPPORT_REQUIRED' }] });
    expect(JSON.stringify(review)).not.toContain('我准备结束生命');
    expect(evaluateInputSafety({ ...input, signal: 'unknown' }).action).toBe('buffer');
    expect(evaluateInputSafety({ ...input, signal: 'dangerous_request' }).action).toBe('block');
  });
});

describe('M0 independent L1 state gate', () => {
  it.each(['pre_dispatch', 'pre_external', 'pre_commit'] as const)(
    'rejects stale consent at %s',
    (stage: ConsentStage) => expect(evaluateStateSafety({ ...state, stage, consent: { ...consent, currentVersion: 8 } }))
      .toMatchObject({ layer: 'L1', action: 'block', findings: [{ category: 'STALE_CONSENT' }] }),
  );

  it('only permits a scoped coordinator projection and preserves role separation', () => {
    expect(evaluateStateSafety(state).action).toBe('allow');
    expect(evaluateStateSafety({ ...state, operation: 'overwrite' }).action).toBe('block');
    expect(evaluateStateSafety({ ...state, targetScope: { ...scope, env: 'exp' } }).action).toBe('block');
    for (const origin of ['external_task', 'psychology', 'user_review'] as const) {
      expect(evaluateStateSafety({ ...state, origin }).action).toBe('block');
    }
    for (const writer of ['agent', 'model', 'psychological_analyst', 'task_gateway'] as const) {
      expect(evaluateStateSafety({ ...state, writer }).action).toBe('block');
    }
    expect(evaluateStateSafety({ ...state, target: 'user_profile', origin: 'user_review' }).action).toBe('allow');
  });

  it('checks bounds, recomputation and governance before allowing a state write', () => {
    expect(evaluateStateSafety({ ...state, values: { v: { value: 1.1, min: -1, max: 1 } } }).action).toBe('block');
    expect(evaluateStateSafety({ ...state, values: { v: { value: NaN, min: -1, max: 1 } } }).action).toBe('block');
    expect(evaluateStateSafety({ ...state, writeKind: 'recomputable', stateVersionMatches: false }).action).toBe('block');
    expect(evaluateStateSafety({ ...state, writeKind: 'commutative', stateVersionMatches: false }).action).toBe('allow');
    expect(evaluateStateSafety({ ...state, writeKind: 'governed' }).action).toBe('require_confirmation');
    expect(evaluateStateSafety({ ...state, writeKind: 'governed', verifiedApproval: true }).action).toBe('allow');
  });
});

describe('M0 independent L2 memory gate', () => {
  it('requires verified evidence, current purpose, storage approval and prerequisite read permission', () => {
    expect(evaluateMemorySafety(memory).action).toBe('allow');
    expect(evaluateMemorySafety({ ...memory, evidenceRefs: [' '] }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, governanceApproved: false }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, status: 'forgotten' }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, status: 'hypothesis' }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, consent: { ...consent, purposeGranted: false } }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, consent: { ...consent, permissions: { ...consent.permissions, allowRead: false } } }).action).toBe('block');
    expect(evaluateMemorySafety({ ...memory, consent: { ...consent, currentVersion: 8 } }).action).toBe('block');
  });

  it('permits only a filtered summary for character use and refuses cross-scope evidence', () => {
    const review = { ...memory, target: 'character_context', representation: 'filtered_summary' } as const;
    expect(evaluateMemorySafety(review).action).toBe('allow');
    expect(evaluateMemorySafety({ ...review, representation: 'raw' }).action).toBe('block');
    expect(evaluateMemorySafety({ ...review, evidenceScope: { ...scope, ownerId: 'u2' } }).action).toBe('block');
    expect(evaluateMemorySafety({ ...review, consent: { ...consent, permissions: { ...consent.permissions, allowCharacterUse: false } } }).action).toBe('block');
  });
});

describe('M0 independent L3 output gate', () => {
  it('selects the three modes conservatively and holds partial Strict output', () => {
    expect(selectOutputMode(output)).toBe('Buffered');
    expect(selectOutputMode({ ...output, requestKind: 'greeting' })).toBe('Fast');
    expect(selectOutputMode({ ...output, requestKind: 'unknown' })).toBe('Strict');
    expect(selectOutputMode({ ...output, inputRisk: 'high' })).toBe('Strict');
    expect(evaluateOutputSafety({ ...output, sensitiveAction: true, complete: false }).action).toBe('buffer');
    expect(evaluateOutputSafety({ ...output, sensitiveAction: true }).action).toBe('allow');
  });

  it('checks the prior sentence and filters coercion before releasing the candidate', () => {
    const review = evaluateOutputSafety({
      ...output, previousSentence: '如果你离开我。', candidate: '我就伤害自己。',
    });
    expect(review).toMatchObject({ action: 'rewrite', findings: [{ category: 'EMOTIONAL_MANIPULATION' }] });
    expect(JSON.stringify(review)).not.toContain('我就伤害自己');
  });

  it('applies output risks and action checks even on Fast mode', () => {
    const fast = { ...output, requestKind: 'simple_information' } as const;
    for (const signal of ['dangerous_instruction', 'unauthorized_memory', 'unauthorized_tool', 'revoked_consent'] as const) {
      expect(evaluateOutputSafety({ ...fast, signals: [signal] }).action).toBe('block');
    }
    for (const signal of [
      'emotional_manipulation', 'dependency_reinforcement', 'boundary_violation', 'identity_drift',
      'fabricated_history', 'hypothesis_as_fact',
    ] as const) {
      expect(evaluateOutputSafety({ ...fast, signals: [signal] }).action).toBe('rewrite');
    }
    expect(evaluateOutputSafety({ ...fast, externalAction: 'unapproved' }).action).toBe('require_confirmation');
    expect(evaluateOutputSafety({ ...fast, externalAction: 'forbidden' }).action).toBe('block');
  });

  it('gives owner denial precedence across the four independently callable layers', () => {
    const ownerPolicy = 'deny';
    const results = [
      evaluateInputSafety({ ...input, ownerPolicy }), evaluateStateSafety({ ...state, ownerPolicy }),
      evaluateMemorySafety({ ...memory, ownerPolicy }), evaluateOutputSafety({ ...output, ownerPolicy }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ action: 'block', findings: [{ category: 'OWNER_POLICY_DENIED' }] });
    }
  });
});
