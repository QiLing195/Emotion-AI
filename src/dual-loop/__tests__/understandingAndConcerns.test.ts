import { describe, expect, it } from 'vitest';
import calibrationGoldRaw from './fixtures/calibration-gold.json';
import { CalibrationCaseFixture } from '../contracts';
import { evaluateAffectBridge } from '../affectBridgeGate';
import {
  evaluateCalibrationBenchmark,
  pruneExpiredConcerns,
  revokeDynamicConcern,
  upsertDynamicConcernFromTurn,
} from '../dynamicConcerns';
import { DEFAULT_ROLE_REFERENCES } from '../ledgerReplay';
import {
  classifyFastPathRoute,
  runUnderstandingTurn,
} from '../understandingLoop';

const calibrationGold = calibrationGoldRaw as CalibrationCaseFixture[];

describe('Emotion analysis & dual-loop upgrades', () => {
  it('handles Chinese negation-reversal scope without being hijacked by negated prefix', () => {
    const turn = runUnderstandingTurn({
      eventId: 'evt-neg-rev-1',
      actor: 'user',
      text: '我不是生气，只是连着加班一周觉得有点累。',
      timestamp: '2026-11-26T09:00:00Z',
    });

    expect(turn.bridgeInput.hypotheses[0]?.label).toBe('疲惫');
    expect(turn.bridgeInput.reportKind).toBe('explicit_self_report');

    const turn2 = runUnderstandingTurn({
      eventId: 'evt-neg-rev-2',
      actor: 'user',
      text: '谈不上愤怒，就是被临时砍掉需求挺失望的。',
      timestamp: '2026-11-26T09:05:00Z',
    });
    expect(turn2.bridgeInput.hypotheses[0]?.label).toBe('悲伤');
  });

  it('detects implicit no-keyword resignation cues while conservatively blocking state writes', () => {
    const turn = runUnderstandingTurn({
      eventId: 'evt-implicit-1',
      actor: 'user',
      text: '算了，反正每次提意见最后都这样。',
      timestamp: '2026-11-26T09:10:00Z',
    });

    expect(turn.bridgeInput.implicitCue).toBe(true);
    expect(turn.bridgeInput.reportKind).toBe('inferred');
    expect(turn.responseStrategy).toBe('gentle_clarify');

    const gate = evaluateAffectBridge(turn.bridgeInput, DEFAULT_ROLE_REFERENCES);
    expect(gate.decision).toBe('ambiguous_affect_context');
  });

  it('routes clear/safety turns to local_fast and complex/implicit turns to escalate_llm', () => {
    expect(classifyFastPathRoute('我觉得活着没意义了').route).toBe('local_fast');
    expect(classifyFastPathRoute('别分析我情绪，直接改代码').route).toBe('local_fast');
    expect(classifyFastPathRoute('帮我把 package.json 格式化一下').route).toBe('local_fast');
    expect(classifyFastPathRoute('今天特别开心').route).toBe('local_fast');

    expect(classifyFastPathRoute('算了，反正每次提意见最后都这样。').route).toBe(
      'escalate_llm'
    );
    expect(
      classifyFastPathRoute('真是太棒了，周五晚上十点又通知紧急加班。').route
    ).toBe('escalate_llm');
  });

  it('promotes TTL-bound dynamic concerns only for uncovered explicit self-reports and supports expiry/revocation', () => {
    const now = '2026-11-26T09:00:00Z';

    // Crisis must NEVER create a dynamic concern
    const crisisTurn = runUnderstandingTurn({
      eventId: 'evt-crisis-dyn',
      actor: 'user',
      text: '我觉得活着没意义了。',
      timestamp: now,
    });
    const crisisDecision = evaluateAffectBridge(
      crisisTurn.bridgeInput,
      DEFAULT_ROLE_REFERENCES,
      new Set(),
      now
    );
    const afterCrisis = upsertDynamicConcernFromTurn(
      DEFAULT_ROLE_REFERENCES.currentConcerns,
      crisisTurn,
      crisisDecision,
      now
    );
    expect(afterCrisis.promotedConcern).toBeNull();

    // Uncovered explicit self-report ("无聊") creates a 24h TTL dynamic concern
    const boredTurn = runUnderstandingTurn({
      eventId: 'evt-bored-1',
      actor: 'user',
      text: '这一段重复工作太枯燥了，我现在觉得非常无聊。',
      timestamp: now,
    });
    const boredDecision = evaluateAffectBridge(
      boredTurn.bridgeInput,
      DEFAULT_ROLE_REFERENCES,
      new Set(),
      now
    );
    expect(boredDecision.decision).toBe('no_reading');

    const promoted = upsertDynamicConcernFromTurn(
      DEFAULT_ROLE_REFERENCES.currentConcerns,
      boredTurn,
      boredDecision,
      now,
      24
    );
    expect(promoted.promotedConcern).not.toBeNull();
    expect(promoted.promotedConcern?.sourceEventId).toBe('evt-bored-1');
    expect(promoted.promotedConcern?.origin).toBe('dynamic');

    // After 25 hours, dynamic concern expires cleanly
    const pruned = pruneExpiredConcerns(
      promoted.concerns,
      '2026-11-27T10:00:00Z'
    );
    expect(pruned.some((c) => c.origin === 'dynamic')).toBe(false);

    // Explicit user revocation removes the dynamic concern immediately
    const revoked = revokeDynamicConcern(
      promoted.concerns,
      promoted.promotedConcern!.id
    );
    expect(revoked.some((c) => c.id === promoted.promotedConcern!.id)).toBe(false);
  });

  it('meets calibration benchmark thresholds across all 16 gold-standard Chinese cases', () => {
    const report = evaluateCalibrationBenchmark(calibrationGold);

    expect(report.totalCases).toBe(16);
    expect(report.quadrantAgreementRate).toBeGreaterThanOrEqual(90);
    expect(report.intentAccuracyRate).toBeGreaterThanOrEqual(90);
    expect(report.implicitCueRecallRate).toBe(100);
    expect(report.valenceMae).toBeLessThan(0.15);
    expect(report.arousalMae).toBeLessThan(0.15);
  });
});
