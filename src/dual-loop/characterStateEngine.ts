import {
  CharacterEmotionState,
  EmotionEngineMode,
  EmotionVector2D,
  StateTransitionRecord,
} from './contracts';
import { MAX_STEP_DELTA, clipDelta } from './roleAppraisal';

export const DEFAULT_HALF_LIFE_HOURS = 6;
export const STATE_ENGINE_RULE_VERSION = 'state-engine-v2.0';

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return round4(Math.max(-1, Math.min(1, value)));
}

export function createInitialCharacterState(
  timestamp: string,
  baselineValence = 0.15,
  baselineArousal = 0
): CharacterEmotionState {
  return {
    valence: clampAxis(baselineValence),
    arousal: clampAxis(baselineArousal),
    baselineValence: clampAxis(baselineValence),
    baselineArousal: clampAxis(baselineArousal),
    lastUpdatedAt: timestamp,
    lastEventId: 'init',
    ruleVersion: STATE_ENGINE_RULE_VERSION,
  };
}

export function computeDecayedVector(
  state: CharacterEmotionState,
  nowIso: string,
  halfLifeHours: number = DEFAULT_HALF_LIFE_HOURS
): EmotionVector2D {
  const prevMs = Date.parse(state.lastUpdatedAt);
  const nowMs = Date.parse(nowIso);
  const elapsedHours =
    Number.isFinite(prevMs) && Number.isFinite(nowMs) && nowMs > prevMs
      ? (nowMs - prevMs) / (1000 * 60 * 60)
      : 0;

  const safeHalfLife = Math.max(0.25, halfLifeHours);
  const decayFactor = Math.pow(0.5, elapsedHours / safeHalfLife);

  return {
    valence: clampAxis(
      state.baselineValence + decayFactor * (state.valence - state.baselineValence)
    ),
    arousal: clampAxis(
      state.baselineArousal + decayFactor * (state.arousal - state.baselineArousal)
    ),
  };
}

export interface CommitTransitionParams {
  readonly currentState: CharacterEmotionState;
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly timestamp: string;
  readonly mode: EmotionEngineMode;
  readonly roleAppraisalDelta: EmotionVector2D;
  readonly characterSimulationDelta?: EmotionVector2D;
  /** 仅在显式消融基线臂中允许传入，默认强制归零 */
  readonly legacyContagionDelta?: EmotionVector2D;
  readonly enableLegacyContagion?: boolean;
  readonly matchedConcernId?: string;
  readonly supersededEventId?: string;
  readonly supersededRoleDelta?: EmotionVector2D;
  readonly evidenceIds: readonly string[];
  readonly containsSimulationSource?: boolean;
  readonly halfLifeHours?: number;
}

/**
 * 全系统唯一的角色情绪状态写入入口（Single-Writer Invariant）。
 * - shadow_only 模式下：roleAppraisal 与 characterSimulation 增量强制归零，仅保留衰减/基线与审计快照。
 * - 当存在 supersededRoleDelta（用户纠正前序事件）时，按差值（newDelta - priorDelta）修正，避免重复叠加。
 * - 任何情况下均保证最终状态严格落在 [-1, 1]^2 且单步增量不超过 MAX_STEP_DELTA。
 */
export function commitCharacterEmotionTransition(
  params: CommitTransitionParams
): {
  readonly nextState: CharacterEmotionState;
  readonly record: StateTransitionRecord;
} {
  const { currentState, mode, enableLegacyContagion = false } = params;

  const before: EmotionVector2D = {
    valence: currentState.valence,
    arousal: currentState.arousal,
  };

  const decayed = computeDecayedVector(
    currentState,
    params.timestamp,
    params.halfLifeHours
  );

  const priorRole = params.supersededRoleDelta ?? { valence: 0, arousal: 0 };
  const roleAppraisal: EmotionVector2D =
    mode === 'shadow_only'
      ? { valence: 0, arousal: 0 }
      : {
          valence: clipDelta(
            params.roleAppraisalDelta.valence - priorRole.valence,
            MAX_STEP_DELTA
          ),
          arousal: clipDelta(
            params.roleAppraisalDelta.arousal - priorRole.arousal,
            MAX_STEP_DELTA
          ),
        };

  const rawSim = params.characterSimulationDelta ?? { valence: 0, arousal: 0 };
  const characterSimulation: EmotionVector2D =
    mode === 'shadow_only'
      ? { valence: 0, arousal: 0 }
      : {
          valence: clipDelta(rawSim.valence, MAX_STEP_DELTA),
          arousal: clipDelta(rawSim.arousal, MAX_STEP_DELTA),
        };

  const rawContagion = params.legacyContagionDelta ?? { valence: 0, arousal: 0 };
  const legacyContagion: EmotionVector2D = enableLegacyContagion
    ? {
        valence: clipDelta(rawContagion.valence, MAX_STEP_DELTA),
        arousal: clipDelta(rawContagion.arousal, MAX_STEP_DELTA),
      }
    : { valence: 0, arousal: 0 };

  // 在 shadow_only 且未开启旧传染基线时，保持线上状态零写入（不改变原状态坐标）
  const freezeOnlineState = mode === 'shadow_only' && !enableLegacyContagion;

  const after: EmotionVector2D = freezeOnlineState
    ? before
    : {
        valence: clampAxis(
          decayed.valence +
            roleAppraisal.valence +
            characterSimulation.valence +
            legacyContagion.valence
        ),
        arousal: clampAxis(
          decayed.arousal +
            roleAppraisal.arousal +
            characterSimulation.arousal +
            legacyContagion.arousal
        ),
      };

  const nextState: CharacterEmotionState = {
    ...currentState,
    valence: after.valence,
    arousal: after.arousal,
    lastUpdatedAt: freezeOnlineState ? currentState.lastUpdatedAt : params.timestamp,
    lastEventId: freezeOnlineState ? currentState.lastEventId : params.eventId,
    ruleVersion: STATE_ENGINE_RULE_VERSION,
  };

  const record: StateTransitionRecord = {
    eventId: params.eventId,
    idempotencyKey: params.idempotencyKey,
    mode,
    before,
    decayed: freezeOnlineState ? before : decayed,
    deltasBySource: {
      roleAppraisal,
      characterSimulation,
      legacyContagion,
    },
    after,
    matchedConcernId: params.matchedConcernId,
    supersededEventId: params.supersededEventId,
    evidenceIds: [...params.evidenceIds],
    containsSimulationSource: Boolean(
      params.containsSimulationSource ||
        characterSimulation.valence !== 0 ||
        characterSimulation.arousal !== 0
    ),
    ruleVersion: STATE_ENGINE_RULE_VERSION,
    timestamp: params.timestamp,
  };

  return { nextState, record };
}
