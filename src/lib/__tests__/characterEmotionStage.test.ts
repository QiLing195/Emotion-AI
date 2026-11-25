import { describe, expect, it } from 'vitest';
import { INITIAL_EMOTION_STATE } from '../emotionTypes.js';
import { applyCharacterEmotionStage } from '../characterEmotionStage.js';
import { emptyEmergenceStats, snapshotEmotionSource } from '../emergenceMetrics.js';
import { IntrinsicDedup } from '../intrinsicActivity.js';

describe('applyCharacterEmotionStage', () => {
  it('separates direct stimulus accounting from contagion and applies evidenced inner activity', () => {
    const previousState = structuredClone(INITIAL_EMOTION_STATE);
    const stateAfterDirectStimulus = structuredClone(previousState);
    stateAfterDirectStimulus.taiji.valence += 0.1;
    stateAfterDirectStimulus.emotions.joy += 0.2;
    const directStimulusAfter = snapshotEmotionSource(stateAfterDirectStimulus);
    let now = 10_000;

    const result = applyCharacterEmotionStage({
      previousState,
      stateAfterDirectStimulus,
      directStimulusAfter,
      userText: '今天有点难过',
      userAnalysis: {
        expressedEmotion: 'sad',
        likelyCause: 'work',
        intensity: 0.7,
        directedAtAI: false,
      },
      appraisalEnabled: false,
      activityConcern: { type: 'activity_concern', category: 'work', summary: '正在工作', intensity: 0.5 },
      idleMinutes: undefined,
      interestTopics: [],
      thoughtTypes: [],
      discoveryIds: [],
      generatedInsightCount: 0,
      roundNumber: 7,
      emergence: emptyEmergenceStats(),
      seen: new IntrinsicDedup(20),
      now: () => now++,
    });

    // directStimulusAfter 是 external 的截止点；后续传染和内在变化分开记账。
    expect(result.emergence.external).toBeCloseTo(0.3, 10);
    expect(result.emergence.contagion).toBeGreaterThan(0);
    expect(result.emergence.internal).toBeGreaterThan(0);
    expect(result.intrinsic.accepted).toContainEqual({
      eventId: 'activity_concern:activity:work',
      type: 'activity_concern',
      evidenceRef: 'activity:work',
    });
    expect(result.emergenceBeforeNonUser).toEqual(emptyEmergenceStats());
  });

  it('does not report an appraisal update when appraisal is disabled', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const result = applyCharacterEmotionStage({
      previousState: state,
      stateAfterDirectStimulus: state,
      directStimulusAfter: null,
      userText: '今天还好',
      userAnalysis: null,
      appraisalEnabled: false,
      activityConcern: null,
      interestTopics: [],
      thoughtTypes: [],
      discoveryIds: [],
      generatedInsightCount: 0,
      roundNumber: 1,
      emergence: emptyEmergenceStats(),
      seen: new IntrinsicDedup(20),
      now: () => 10_000,
    });

    expect(result.appraisalUpdated).toBe(false);
    expect(result.appraisal).toBeNull();
    expect(result.activityConcern).toBeNull();
  });

  it.each([
    {
      name: 'high uncertainty',
      uncertainty: 0.9,
      attribution: { consensus: 'consistent' as const, issues: [] },
    },
    {
      name: 'downgraded attribution',
      uncertainty: 0.1,
      attribution: { consensus: 'downgraded' as const, issues: ['quoted affect'] },
    },
    {
      name: 'unknown attribution',
      uncertainty: 0.1,
      attribution: { consensus: 'unknown' as const, issues: ['insufficient evidence'] },
    },
  ])('does not write $name into the character state through contagion', ({ uncertainty, attribution }) => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const result = applyCharacterEmotionStage({
      previousState: structuredClone(state),
      stateAfterDirectStimulus: state,
      directStimulusAfter: null,
      userText: '我最近有点难受',
      userAnalysis: {
        expressedEmotion: 'sad',
        likelyCause: 'uncertain report',
        intensity: 0.8,
        directedAtAI: false,
        uncertainty,
        attribution,
      },
      appraisalEnabled: true,
      activityConcern: null,
      idleMinutes: 0,
      interestTopics: [],
      thoughtTypes: [],
      discoveryIds: [],
      generatedInsightCount: 0,
      roundNumber: 1,
      emergence: emptyEmergenceStats(),
      seen: new IntrinsicDedup(20),
      now: () => 10_000,
    });

    expect(result.emergence.contagion).toBe(0);
    expect(result.appraisalUpdated).toBe(false);
    expect(result.appraisal).toBeNull();
    expect(result.state.emotions.sad).toBeCloseTo(state.emotions.sad, 10);
    expect(result.state.emotions.love).toBeCloseTo(state.emotions.love, 10);
  });

  it('keeps contagion for a low-uncertainty, consistent user emotion analysis', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    const result = applyCharacterEmotionStage({
      previousState: structuredClone(state),
      stateAfterDirectStimulus: state,
      directStimulusAfter: null,
      userText: '我最近很难受',
      userAnalysis: {
        expressedEmotion: 'sad',
        likelyCause: 'work',
        intensity: 0.8,
        directedAtAI: false,
        uncertainty: 0.1,
        attribution: { consensus: 'consistent', issues: [] },
      },
      appraisalEnabled: true,
      activityConcern: null,
      idleMinutes: 0,
      interestTopics: [],
      thoughtTypes: [],
      discoveryIds: [],
      generatedInsightCount: 0,
      roundNumber: 1,
      emergence: emptyEmergenceStats(),
      seen: new IntrinsicDedup(20),
      now: () => 10_000,
    });

    expect(result.emergence.contagion).toBeGreaterThan(0);
    expect(result.appraisalUpdated).toBe(true);
    expect(result.appraisal?.readings.length).toBeGreaterThan(0);
    expect(result.state.emotions.sad).toBeGreaterThan(state.emotions.sad);
  });

  it('reopens a stable activity concern after its two-hour evidence TTL expires', () => {
    const seen = new IntrinsicDedup(20);
    let state = structuredClone(INITIAL_EMOTION_STATE);
    const initialNow = 10_000;
    const applyAt = (nowMs: number, roundNumber: number) => applyCharacterEmotionStage({
      previousState: state,
      stateAfterDirectStimulus: state,
      directStimulusAfter: null,
      userText: '嗯',
      userAnalysis: null,
      appraisalEnabled: false,
      activityConcern: { type: 'activity_concern', category: 'dev', summary: '正在写代码', intensity: 1 },
      idleMinutes: 0,
      interestTopics: [],
      thoughtTypes: [],
      discoveryIds: [],
      generatedInsightCount: 0,
      roundNumber,
      emergence: emptyEmergenceStats(),
      seen,
      now: () => nowMs,
    });

    const first = applyAt(initialNow, 1);
    state = first.state;
    const beforeExpiry = applyAt(initialNow + 60 * 60_000, 2);
    state = beforeExpiry.state;
    const afterExpiry = applyAt(initialNow + 2 * 60 * 60_000, 3);

    expect(first.intrinsic.accepted).toContainEqual({
      eventId: 'activity_concern:activity:dev',
      type: 'activity_concern',
      evidenceRef: 'activity:dev',
    });
    expect(beforeExpiry.intrinsic.rejected).toContainEqual({
      eventId: 'activity_concern:activity:dev',
      reason: 'duplicate',
    });
    expect(beforeExpiry.state.emotions.fear).toBe(first.state.emotions.fear);
    expect(afterExpiry.intrinsic.accepted).toContainEqual({
      eventId: 'activity_concern:activity:dev',
      type: 'activity_concern',
      evidenceRef: 'activity:dev',
    });
    expect(afterExpiry.state.emotions.fear).toBeGreaterThan(beforeExpiry.state.emotions.fear);
  });
});
