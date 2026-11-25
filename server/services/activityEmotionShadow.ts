import {
  CARE_MAX_SAMPLE_GAP_MS,
  toActivityConcern,
  type ActivityCategory,
  type ActivityUnderstanding,
} from './activityUnderstanding.js';

export interface ActivityEmotionShadowState {
  category: ActivityCategory | null;
  since: number;
  lastSampleAt: number;
  sampleCount: number;
}

export interface ActivityEmotionShadowDiagnostics {
  mode: 'shadow_only';
  observedCategory: ActivityCategory | null;
  sampleCount: number;
  elapsedMs: number;
  candidates: {
    oneMinute: boolean;
    twoMinutes: boolean;
    fiveMinutes: boolean;
  };
  reason:
    | 'no_activity_understanding'
    | 'insufficient_evidence'
    | 'not_a_concern_category'
    | 'window_started'
    | 'category_changed'
    | 'sample_gap_reset'
    | 'clock_reversal_reset'
    | 'observing'
    | 'threshold_candidates_reached';
  updatedAt: number;
}

export interface ActivityEmotionShadowStep {
  state: ActivityEmotionShadowState;
  diagnostics: ActivityEmotionShadowDiagnostics;
}

export function emptyActivityEmotionShadow(): ActivityEmotionShadowState {
  return { category: null, since: 0, lastSampleAt: 0, sampleCount: 0 };
}

function result(
  state: ActivityEmotionShadowState,
  now: number,
  reason: ActivityEmotionShadowDiagnostics['reason'],
): ActivityEmotionShadowStep {
  const elapsedMs = state.category ? Math.max(0, now - state.since) : 0;
  const enoughSamples = state.sampleCount >= 2;
  const candidates = {
    oneMinute: enoughSamples && elapsedMs >= 60_000,
    twoMinutes: enoughSamples && elapsedMs >= 2 * 60_000,
    fiveMinutes: enoughSamples && elapsedMs >= 5 * 60_000,
  };
  return {
    state,
    diagnostics: {
      mode: 'shadow_only',
      observedCategory: state.category,
      sampleCount: state.sampleCount,
      elapsedMs,
      candidates,
      reason,
      updatedAt: now,
    },
  };
}

export function stepActivityEmotionShadow(
  previous: ActivityEmotionShadowState,
  understanding: ActivityUnderstanding | null,
  now: number,
): ActivityEmotionShadowStep {
  if (!understanding) return result(emptyActivityEmotionShadow(), now, 'no_activity_understanding');

  const concern = toActivityConcern(understanding);
  if (!concern) {
    const reason = understanding.vague
      ? 'insufficient_evidence'
      : 'not_a_concern_category';
    return result(emptyActivityEmotionShadow(), now, reason);
  }

  const category = concern.category;
  if (previous.category === null) {
    return result({ category, since: now, lastSampleAt: now, sampleCount: 1 }, now, 'window_started');
  }
  if (previous.category !== category) {
    return result({ category, since: now, lastSampleAt: now, sampleCount: 1 }, now, 'category_changed');
  }

  const sampleGap = now - previous.lastSampleAt;
  if (sampleGap < 0) {
    return result({ category, since: now, lastSampleAt: now, sampleCount: 1 }, now, 'clock_reversal_reset');
  }
  if (sampleGap > CARE_MAX_SAMPLE_GAP_MS) {
    return result({ category, since: now, lastSampleAt: now, sampleCount: 1 }, now, 'sample_gap_reset');
  }

  const state = {
    category,
    since: previous.since,
    lastSampleAt: now,
    sampleCount: previous.sampleCount + 1,
  };
  const diagnostics = result(state, now, 'observing');
  const hasCandidate = Object.values(diagnostics.diagnostics.candidates).some(Boolean);
  if (!hasCandidate) return diagnostics;
  return result(state, now, 'threshold_candidates_reached');
}
