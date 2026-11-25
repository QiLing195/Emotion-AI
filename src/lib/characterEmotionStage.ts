/**
 * 角色情绪更新阶段：将用户情绪传染、她对事件的评价、内在活动、心情与反刍
 * 按固定顺序施加到直接刺激之后的状态，并为每个来源记录实际变化。
 *
 * 本模块不读写文件、不访问协调器单例。去重器、时钟和阶段输入由调用方提供，
 * 便于单独验证来源归因与情绪更新顺序。
 */
import type { EmotionState, UserEmotionAnalysis } from './emotionTypes.js';
import { applyEmotionalContagion } from './emotionEngine.js';
import { appraiseEvent, applyAppraisal, type AppraisalResult } from './appraisal.js';
import { applyInternalEvents, deriveInternalEvents, type InternalEventType, thoughtTypeToInternal } from './emotionInternal.js';
import { applyMoodBias, updateMood, moodSampleFrom } from './moodLayer.js';
import { ruminationModulation, trackRumination, activatedDominant } from './rumination.js';
import {
  recordEmotionSourceChange,
  snapshotEmotionSource,
  type EmergenceStats,
  type EmotionSourceSnapshot,
} from './emergenceMetrics.js';
import { validateIntrinsicCandidates, INTRINSIC_DEFAULTS, type IntrinsicCandidate } from './intrinsicActivity.js';
import type { IntrinsicDedup } from './intrinsicActivity.js';

export interface ActivityConcern {
  type: 'activity_concern';
  category: string;
  summary: string;
  intensity: number;
}

export interface CharacterEmotionStageInput {
  previousState: EmotionState;
  stateAfterDirectStimulus: EmotionState;
  directStimulusAfter: EmotionSourceSnapshot | null;
  userText: string;
  userAnalysis: UserEmotionAnalysis | null;
  appraisalEnabled: boolean;
  activityConcern: ActivityConcern | null;
  idleMinutes?: number;
  interestTopics: string[];
  thoughtTypes: string[];
  discoveryIds: string[];
  generatedInsightCount: number;
  roundNumber: number;
  emergence: EmergenceStats;
  seen: Pick<IntrinsicDedup, 'has' | 'add'>;
  now: () => number;
}

export interface CharacterEmotionStageResult {
  state: EmotionState;
  emergence: EmergenceStats;
  emergenceBeforeNonUser: EmergenceStats;
  appraisal: AppraisalResult | null;
  appraisalUpdated: boolean;
  activityConcern: ActivityConcern | null;
  intrinsic: {
    accepted: Array<{ eventId: string; type: string; evidenceRef: string }>;
    rejected: Array<{ eventId: string; reason: string }>;
  };
  intrinsicCandidateCount: number;
}

/** User-affect inference is only a candidate; explicit uncertainty or failed attribution must not write role state. */
function canApplyUserAffect(analysis: UserEmotionAnalysis): boolean {
  if ((analysis.uncertainty ?? 0) >= 0.6) return false;
  if (analysis.attribution && analysis.attribution.consensus !== 'consistent') return false;
  return true;
}

export function applyCharacterEmotionStage(input: CharacterEmotionStageInput): CharacterEmotionStageResult {
  let state = input.stateAfterDirectStimulus;
  let emergence = input.emergence;
  const emergenceBeforeNonUser = { ...emergence };
  let appraisal: AppraisalResult | null = null;
  let appraisalUpdated = false;
  const userAffectUsable = input.userAnalysis ? canApplyUserAffect(input.userAnalysis) : false;

  if (input.userAnalysis && userAffectUsable) {
    const before = snapshotEmotionSource(state);
    state = applyEmotionalContagion(
      state,
      input.userAnalysis.expressedEmotion,
      input.userAnalysis.intensity,
      state.evolution.empathy,
    );
    emergence = recordEmotionSourceChange(
      emergence,
      'contagion',
      before,
      snapshotEmotionSource(state),
    );
  }

  if (input.userAnalysis && userAffectUsable && input.appraisalEnabled) {
    const concerns = (state.internal?.motive?.pool ?? [])
      .filter(m => !m.satisfiedAt && (m.kind === 'open_loop' || m.kind === 'worry'));
    appraisal = appraiseEvent({
      userText: input.userText,
      userEmotion: input.userAnalysis.expressedEmotion,
      userIntensity: input.userAnalysis.intensity,
      concerns,
    });
    appraisalUpdated = true;
    if (appraisal.readings.length > 0) {
      const before = snapshotEmotionSource(state);
      state = applyAppraisal(state, appraisal);
      emergence = recordEmotionSourceChange(
        emergence,
        'appraisal',
        before,
        snapshotEmotionSource(state),
      );
    }
  }

  const internalEvents = deriveInternalEvents({
    idleMinutes: input.idleMinutes,
    interestCount: input.interestTopics.length,
    thoughtTypes: input.thoughtTypes
      .map(thoughtTypeToInternal)
      .filter((type): type is InternalEventType => type !== null),
    hasDiscovery: input.discoveryIds.length > 0,
    hasInsight: input.generatedInsightCount > 0,
  });
  if (input.activityConcern) internalEvents.push(input.activityConcern);

  const intrinsicCandidates: IntrinsicCandidate[] = internalEvents.map((event) => {
    const defaults = INTRINSIC_DEFAULTS[event.type] ?? { ttlMs: 6 * 3600_000, confidence: 0.6 };
    const evidenceRef = input.activityConcern && event.type === 'activity_concern'
      ? `activity:${input.activityConcern.category ?? 'unknown'}`
      : event.type === 'reunion' || event.type === 'loneliness'
        ? `idle:${Math.round(input.idleMinutes ?? 0)}m`
        : event.type.startsWith('thought_')
          ? `thought:${event.type}`
          : event.type === 'interest'
            ? `interest:${input.interestTopics.slice(0, 2).join('/')}`
            : event.type === 'discovery'
              ? `discovery:${input.discoveryIds[0] ?? input.discoveryIds.length}`
              : event.type === 'insight'
                ? `insight:${input.generatedInsightCount}`
                : `event:${event.type}`;
    return {
      // Same activity evidence may be observed on every chat turn. Give it a
      // stable ID so its 2h candidate TTL actually prevents repeat state writes.
      eventId: event.type === 'activity_concern'
        ? `${event.type}:${evidenceRef}`
        : `r${input.roundNumber}:${event.type}:${evidenceRef}`,
      type: event.type,
      source: event.type.startsWith('thought_') ? 'thought'
        : event.type === 'interest' ? 'interest'
          : event.type === 'discovery' ? 'discovery'
            : event.type === 'insight' ? 'insight'
              : event.type === 'activity_concern' ? 'activity' : 'idle',
      evidenceRef,
      confidence: defaults.confidence,
      expiresAt: input.now() + defaults.ttlMs,
      intensity: event.intensity ?? 1,
    };
  });
  const intrinsicResult = validateIntrinsicCandidates(intrinsicCandidates, {
    now: input.now(),
    seen: input.seen,
    maxPerTurn: 3,
  });
  const acceptedInternal = intrinsicResult.accepted.map(candidate => ({
    type: candidate.type,
    intensity: candidate.intensity,
  })) as Parameters<typeof applyInternalEvents>[1];
  if (acceptedInternal.length > 0) {
    const before = snapshotEmotionSource(state);
    state = applyInternalEvents(state, acceptedInternal);
    emergence = recordEmotionSourceChange(
      emergence,
      'internal',
      before,
      snapshotEmotionSource(state),
    );
  }

  const nowMs = input.now();
  const previousMood = input.previousState.internal?.mood;
  const previousRumination = input.previousState.internal?.rumination;
  if (previousMood && previousMood.samples > 0) {
    const dominantIntensity = activatedDominant(state.emotions).intensity;
    const before = snapshotEmotionSource(state);
    state = applyMoodBias(
      state,
      previousMood,
      nowMs,
      dominantIntensity,
      input.previousState.taiji.valence,
    );
    emergence = recordEmotionSourceChange(
      emergence,
      'mood',
      before,
      snapshotEmotionSource(state),
    );
  }

  {
    const before = snapshotEmotionSource(state);
    state = ruminationModulation(state, previousRumination, nowMs);
    emergence = recordEmotionSourceChange(
      emergence,
      'rumination',
      before,
      snapshotEmotionSource(state),
    );
  }

  const externalBefore = snapshotEmotionSource(input.previousState);
  emergence = recordEmotionSourceChange(
    emergence,
    'external',
    externalBefore,
    input.directStimulusAfter ?? externalBefore,
  );

  const activeDominant = activatedDominant(state.emotions);
  state.internal = {
    satiation: state.internal?.satiation ?? {},
    ...(input.previousState.internal?.motive
      ? { motive: input.previousState.internal.motive }
      : {}),
    mood: updateMood(
      previousMood,
      moodSampleFrom(state),
      nowMs,
      Number.isFinite(input.previousState.evolution?.baseline)
        ? input.previousState.evolution.baseline
        : input.previousState.taiji.valence,
    ),
    rumination: trackRumination(
      previousRumination,
      activeDominant.name,
      activeDominant.intensity,
      nowMs,
    ),
  };

  return {
    state,
    emergence,
    emergenceBeforeNonUser,
    appraisal,
    appraisalUpdated,
    activityConcern: input.activityConcern,
    intrinsic: {
      accepted: intrinsicResult.accepted.map(candidate => ({
        eventId: candidate.eventId,
        type: candidate.type,
        evidenceRef: candidate.evidenceRef,
      })),
      rejected: intrinsicResult.rejected,
    },
    intrinsicCandidateCount: intrinsicCandidates.length,
  };
}
