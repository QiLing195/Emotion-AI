// ── 微六爻阶段 (Micro Phase) — 从 emotionEngine.ts 提取 ──
// 情绪事件的自然生命周期，从太极/阴阳/三才动力学派生计算

import type { EmotionState, RelationshipStage } from './emotionTypes';

/** 微六爻阶段 — 情绪事件的自然生命周期 */
export enum MicroPhase {
  SHENG = '生',    // 初始 — 情绪刚刚萌发，强度尚低
  ZHANG = '长',    // 发展 — 情绪在增强，方向明确
  HUA = '化',      // 转化/对抗 — 出现矛盾（反转压力、趋避冲突）
  SHOU = '收',     // 收敛/平稳 — 情绪稳定在某个水平
  CANG = '藏',     // 衰退/消亡 — 情绪回归基线，准备消散
}

export interface MicroPhaseInfo {
  phase: MicroPhase;
  /** 该阶段的置信度 [0,1] */
  confidence: number;
  /** 阶段判定依据（可观测性） */
  reason: string;
  /** 当前情绪强度 */
  intensity: number;
  /** 内心冲突等级 [0,1]，由阴阳反推 */
  conflictLevel: number;
}

/**
 * 从当前情感状态派生微六爻阶段。
 * 纯惰性计算——不做任何状态推进，只根据快照判定。
 */
export function getMicroPhase(state: EmotionState): MicroPhaseInfo {
  const { taiji, yinyang, sancai, emotions } = state;

  let maxIntensity = 0;
  let dominantName = 'calm';
  for (const [k, v] of Object.entries(emotions)) {
    if (Math.abs(v) > Math.abs(maxIntensity)) { maxIntensity = v; dominantName = k; }
  }
  const intensity = Math.abs(maxIntensity);

  const conflictLevel = Math.min(1,
    yinyang.reversalPressure * 0.6 + (1 - sancai.harmony) * 0.4,
  );

  const extremity = Math.abs(taiji.valence);

  let result: MicroPhaseInfo;

  // 1. 转化/对抗：反转压力积累，或趋避冲突明显
  if (yinyang.reversalPressure > 0.25 || (sancai.A > 0.4 && sancai.B > 0.4 && sancai.harmony < 0.5)) {
    result = {
      phase: MicroPhase.HUA,
      confidence: Math.min(1, yinyang.reversalPressure * 2 + (1 - sancai.harmony)),
      reason: yinyang.reversalPressure > 0.25
        ? `反转压力累积中(${yinyang.reversalPressure.toFixed(2)})，情绪可能即将转向`
        : `趋避冲突(A=${sancai.A.toFixed(2)}, B=${sancai.B.toFixed(2)}, harmony=${sancai.harmony.toFixed(2)})，内心矛盾`,
      intensity,
      conflictLevel,
    };
  }
  // 2. 收敛/平稳：情绪在极端区稳定停留
  else if (extremity > 0.5 && yinyang.extremityDuration > 2) {
    result = {
      phase: MicroPhase.SHOU,
      confidence: Math.min(1, yinyang.extremityDuration / 8),
      reason: `效价${extremity > 0 ? '正' : '负'}极值(${taiji.valence.toFixed(2)})持续中，情绪稳定在高位`,
      intensity,
      conflictLevel,
    };
  }
  // 3. 发展：高唤醒 + 高强度
  else if (taiji.arousal > 0.4 && intensity > 0.3) {
    result = {
      phase: MicroPhase.ZHANG,
      confidence: Math.min(1, (taiji.arousal + intensity) / 2),
      reason: `高唤醒(${taiji.arousal.toFixed(2)}) + 强度(${intensity.toFixed(2)})，情绪在发展中`,
      intensity,
      conflictLevel,
    };
  }
  // 4. 衰退/消散：低唤醒 + 近基线
  else if (intensity < 0.15 && taiji.arousal < 0.3) {
    result = {
      phase: MicroPhase.CANG,
      confidence: 1 - Math.max(intensity, taiji.arousal),
      reason: `低强度(${intensity.toFixed(2)}) + 低唤醒(${taiji.arousal.toFixed(2)})，情绪消散中`,
      intensity,
      conflictLevel,
    };
  }
  // 5. 默认：生 — 情绪刚刚萌发
  else {
    result = {
      phase: MicroPhase.SHENG,
      confidence: Math.min(1, intensity * 2 + taiji.arousal),
      reason: `情绪萌发中，当前强度=${intensity.toFixed(2)}`,
      intensity,
      conflictLevel,
    };
  }

  // ── 记录阶段统计 ──
  _phaseStats.total++;
  _phaseStats.byPhase[result.phase] = (_phaseStats.byPhase[result.phase] || 0) + 1;
  _phaseStats.conflictSum += conflictLevel;
  _phaseStats.intensitySum += intensity;
  if (!_phaseStats.perEmotion[dominantName]) {
    _phaseStats.perEmotion[dominantName] = { count: 0, phases: {} };
  }
  _phaseStats.perEmotion[dominantName].count++;
  _phaseStats.perEmotion[dominantName].phases[result.phase] =
    (_phaseStats.perEmotion[dominantName].phases[result.phase] || 0) + 1;

  return result;
}

// ════════════════════════════════════════════════════════════
// 阶段分布统计
// ════════════════════════════════════════════════════════════

export interface PhaseStats {
  total: number;
  byPhase: Record<string, number>;
  distribution: Record<string, number>;
  avgConflict: number;
  avgIntensity: number;
  perEmotion: Record<string, {
    count: number;
    phases: Record<string, number>;
  }>;
}

interface RawStats {
  total: number;
  byPhase: Record<string, number>;
  conflictSum: number;
  intensitySum: number;
  perEmotion: Record<string, { count: number; phases: Record<string, number> }>;
}

const _phaseStats: RawStats = {
  total: 0,
  byPhase: {},
  conflictSum: 0,
  intensitySum: 0,
  perEmotion: {},
};

export function getPhaseStats(): PhaseStats {
  const { total, byPhase, conflictSum, intensitySum, perEmotion } = _phaseStats;
  const distribution: Record<string, number> = {};
  if (total > 0) {
    for (const [k, v] of Object.entries(byPhase)) {
      distribution[k] = Math.round((v / total) * 1000) / 1000;
    }
  }
  return {
    total,
    byPhase: { ...byPhase },
    distribution,
    avgConflict: total > 0 ? Math.round((conflictSum / total) * 1000) / 1000 : 0,
    avgIntensity: total > 0 ? Math.round((intensitySum / total) * 1000) / 1000 : 0,
    perEmotion: structuredClone(perEmotion),
  };
}

export function resetPhaseStats(): void {
  _phaseStats.total = 0;
  _phaseStats.byPhase = {};
  _phaseStats.conflictSum = 0;
  _phaseStats.intensitySum = 0;
  _phaseStats.perEmotion = {};
}

export function getRelationshipStage(affinityScore: number, isCrisis: boolean): RelationshipStage {
  if (isCrisis) return 'stranger';
  if (affinityScore >= 90) return 'soulmate';
  if (affinityScore >= 70) return 'close';
  if (affinityScore >= 50) return 'friend';
  if (affinityScore >= 30) return 'acquaintance';
  return 'stranger';
}

export function intimacyToAffinity(intimacy: number): number {
  return Math.round(intimacy * 100);
}
