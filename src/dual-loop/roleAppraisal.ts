import {
  AffectBridgeDecision,
  CharacterSimulationEvent,
  EmotionEngineMode,
  EmotionVector2D,
  RoleReferences,
} from './contracts';

export const DEFAULT_APPRAISAL_ALPHA = 0.15;
export const MAX_STEP_DELTA = 0.2;
export const MAX_SIMULATION_DELTA = 0.1;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function clipDelta(value: number, limit = MAX_STEP_DELTA): number {
  const safeLimit = Math.max(0, Math.min(MAX_STEP_DELTA, limit));
  return round4(Math.max(-safeLimit, Math.min(safeLimit, value)));
}

/**
 * 角色环评价增量计算（严禁直接读取或复制用户情绪坐标！）
 * - shadow_only 模式：恒返回 (0, 0)
 * - bounded_live 模式：仅根据匹配到的角色自身 CurrentConcern 方向与权重计算有界增量
 */
export function computeRoleAppraisalDelta(
  decision: AffectBridgeDecision,
  refs: RoleReferences,
  mode: EmotionEngineMode,
  alpha: number = DEFAULT_APPRAISAL_ALPHA
): EmotionVector2D {
  if (mode === 'shadow_only') {
    return { valence: 0, arousal: 0 };
  }

  if (decision.decision !== 'care_response_candidate' || !decision.matchedConcernId) {
    return { valence: 0, arousal: 0 };
  }

  const concern = refs.currentConcerns.find(
    (item) => item.id === decision.matchedConcernId
  );
  if (!concern) {
    return { valence: 0, arousal: 0 };
  }

  const safeAlpha = Math.max(0, Math.min(DEFAULT_APPRAISAL_ALPHA, alpha));
  const safeWeight = Math.max(0, Math.min(1, concern.weight));

  return {
    valence: clipDelta(safeAlpha * safeWeight * concern.targetValenceDirection),
    arousal: clipDelta(safeAlpha * safeWeight * concern.targetArousalDirection),
  };
}

/**
 * 角色世界模拟事件增量计算（source 必须为 character_simulation，限幅 <= 0.10）
 */
export function computeSimulationDelta(
  simulationEvent: CharacterSimulationEvent | undefined,
  mode: EmotionEngineMode
): EmotionVector2D {
  if (!simulationEvent || mode === 'shadow_only') {
    return { valence: 0, arousal: 0 };
  }
  const clampedIntensity = Math.max(0, Math.min(1, simulationEvent.intensity));
  return {
    valence: clipDelta(
      MAX_SIMULATION_DELTA * clampedIntensity * simulationEvent.valenceDirection,
      MAX_SIMULATION_DELTA
    ),
    arousal: clipDelta(
      MAX_SIMULATION_DELTA * clampedIntensity * simulationEvent.arousalDirection,
      MAX_SIMULATION_DELTA
    ),
  };
}
