// ── v1.0 人格参数进化引擎 ──
// 共情、信任、开放等维度随交互经验极慢速漂移，形成独一无二的性格

import { EvolutionState, EmotionState, UserEmotionAnalysis, getDominantEmotion } from './emotionEngine';
import { EpisodicMemory } from './episodicMemory';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface PersonalityParams {
  empathy: number;
  sensitivity: number;
  trustInclination: number;
  resilience: number;
  openness: number;
  playfulness: number;
  attachmentStyle: 'secure' | 'anxious' | 'avoidant' | 'disorganized';
  conflictStyle: 'collaborative' | 'compromising' | 'avoiding' | 'accommodating';
}

export interface DriftConfig {
  trustDriftRate: number;
  opennessDriftRate: number;
  playfulnessDriftRate: number;
  empathyDriftRate: number;
  sensitivityDriftRate: number;
  resilienceDriftRate: number;
  maxChangePerRound: number;
}

export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  trustDriftRate: 0.03,
  opennessDriftRate: 0.02,
  playfulnessDriftRate: 0.015,
  empathyDriftRate: 0.02,
  sensitivityDriftRate: 0.01,
  resilienceDriftRate: 0.008,
  maxChangePerRound: 2.0,
};

// ════════════════════════════════════════════════════════════
// 参数映射
// ════════════════════════════════════════════════════════════

export function extractPersonalityParams(evolution: EvolutionState): PersonalityParams {
  return {
    empathy: evolution.empathy,
    sensitivity: evolution.sensitivity,
    trustInclination: evolution.trust,
    resilience: Math.round(evolution.resilience * 100),
    openness: evolution.openness,
    playfulness: evolution.playfulness,
    attachmentStyle: deriveAttachmentStyle(evolution),
    conflictStyle: deriveConflictStyle(evolution),
  };
}

function deriveAttachmentStyle(evo: EvolutionState): PersonalityParams['attachmentStyle'] {
  if (evo.trust > 60 && evo.openness > 60) return 'secure';
  if (evo.trust < 35 && evo.openness > 50) return 'anxious';
  if (evo.trust < 35 && evo.openness < 35) return 'avoidant';
  if (evo.trust < 30 && evo.sensitivity > 0.7) return 'disorganized';
  return 'secure';
}

function deriveConflictStyle(evo: EvolutionState): PersonalityParams['conflictStyle'] {
  if (evo.empathy > 60 && evo.trust > 50) return 'collaborative';
  if (evo.playfulness > 60 && evo.trust > 40) return 'compromising';
  if (evo.openness < 40 || evo.trust < 40) return 'avoiding';
  return 'accommodating';
}

// ════════════════════════════════════════════════════════════
// 参数漂移
// ════════════════════════════════════════════════════════════

export function driftPersonalityParams(
  evolution: EvolutionState,
  emotionState: EmotionState,
  userMessage: string,
  userSentiment: UserEmotionAnalysis | null,
  config: DriftConfig = DEFAULT_DRIFT_CONFIG,
): { changes: Record<string, number>; log: string[] } {
  const changes: Record<string, number> = {};
  const log: string[] = [];
  const dominant = getDominantEmotion(emotionState.emotions);

  const applyDrift = (field: keyof EvolutionState, delta: number, reason: string) => {
    const clamped = Math.max(-config.maxChangePerRound, Math.min(config.maxChangePerRound, delta));
    if (Math.abs(clamped) < 0.005) return;
    const current = typeof evolution[field] === 'number' ? (evolution[field] as number) : 50;
    const newVal = clamp(current + clamped, 0, field === 'sensitivity' || field === 'resilience' ? 1 : 100);
    if (Math.abs(newVal - current) > 0.001) {
      evolution[field] = newVal as any;
      changes[field] = newVal - current;
      log.push(`${field}: ${current.toFixed(1)} → ${newVal.toFixed(1)} (${reason})`);
    }
  };

  // ── 信任漂移 ──
  if (userSentiment && userSentiment.expressedEmotion === 'love' && userSentiment.directedAtAI) {
    applyDrift('trust', config.trustDriftRate * 3, '用户表达爱意');
  } else if (userSentiment && userSentiment.expressedEmotion === 'anger' && userSentiment.directedAtAI) {
    applyDrift('trust', -config.trustDriftRate * 5, '用户表达愤怒并指向AI');
  } else if (dominant.name === 'love' && dominant.intensity > 0.5) {
    applyDrift('trust', config.trustDriftRate * 1.5, '感受到强烈的爱意');
  } else if (dominant.name === 'anger' && dominant.intensity > 0.4) {
    applyDrift('trust', -config.trustDriftRate * 3, '感到愤怒');
  }

  // 正面互动持续积累信任
  if (emotionState.taiji.valence > 0.3 && emotionState.taiji.expectation > 0.2) {
    applyDrift('trust', config.trustDriftRate * 0.5, '正面预测稳定');
  }

  // ── 开放度漂移 ──
  const vulnerableKw = ['秘密', '坦白', '第一次', '不敢', '害怕你', '会嫌弃', '真的我'];
  const isUserVulnerable = vulnerableKw.some(kw => userMessage.includes(kw));
  if (isUserVulnerable && evolution.trust > 50) {
    applyDrift('openness', config.opennessDriftRate * 4, '用户袒露脆弱且信任度高');
  }
  if (dominant.name === 'fear' && dominant.intensity > 0.4) {
    applyDrift('openness', -config.opennessDriftRate * 3, '恐惧情绪导致退缩');
  }
  if (dominant.name === 'love' && dominant.intensity > 0.4 && evolution.trust > 55) {
    applyDrift('openness', config.opennessDriftRate * 2, '信任中感受爱意');
  }

  // ── 活泼度漂移 ──
  const playfulKw = ['哈哈', '嘻嘻', '调皮', '坏', '逗', '玩笑', '贫嘴', '撩'];
  const isPlayfulExchange = playfulKw.some(kw => userMessage.includes(kw));
  if (isPlayfulExchange && dominant.name === 'joy') {
    applyDrift('playfulness', config.playfulnessDriftRate * 3, '欢快的互动');
  }
  if (dominant.name === 'sad' && dominant.intensity > 0.5) {
    applyDrift('playfulness', -config.playfulnessDriftRate * 2, '悲伤时失去玩心');
  }

  // ── 共情漂移（增强已有的漂移逻辑） ──
  if (userSentiment && userSentiment.intensity > 0.4) {
    const empDelta = config.empathyDriftRate * userSentiment.intensity * 0.5;
    applyDrift('empathy', empDelta, '感受用户情绪');
  }

  // ── 敏感度漂移 ──
  if (emotionState.taiji.valence < -0.4) {
    applyDrift('sensitivity', config.sensitivityDriftRate * 0.25, '负面体验增加敏感度');
  }
  if (evolution.positiveInteractions > evolution.negativeInteractions * 3 && evolution.totalInteractions > 30) {
    applyDrift('sensitivity', -config.sensitivityDriftRate * 0.1, '长期安全降低敏感度');
  }

  // ── 韧性漂移 ──
  if (dominant.name === 'joy' && dominant.intensity > 0.3 && emotionState.taiji.expectation > 0) {
    applyDrift('resilience' as any, config.resilienceDriftRate * 0.5, '积极恢复');
  }

  return { changes, log };
}

// ════════════════════════════════════════════════════════════
// 长周期漂移（基于情景记忆，每 20 轮调用）
// ════════════════════════════════════════════════════════════

export function computePersonalityDriftVelocity(
  evolution: EvolutionState,
  recentEpisodes: EpisodicMemory[],
): Record<string, number> {
  if (recentEpisodes.length === 0) return {};

  const velocities: Record<string, number> = {};

  // 从最近记忆中检测长期趋势
  const positiveEpisodes = recentEpisodes.filter(e => e.emotionalImpact.valenceDelta > 0.2);
  const negativeEpisodes = recentEpisodes.filter(e => e.emotionalImpact.valenceDelta < -0.2);
  const loveEpisodes = recentEpisodes.filter(e => e.emotionalImpact.dominantEmotion === 'love');
  const conflictEpisodes = recentEpisodes.filter(e => e.tags.includes('冲突'));

  // 正向记忆比例 → 信任趋势
  const positivityRatio = recentEpisodes.length > 0
    ? positiveEpisodes.length / recentEpisodes.length
    : 0.5;
  velocities.trust = (positivityRatio - 0.5) * 2;

  // 爱意记忆 → 开放度趋势
  velocities.openness = loveEpisodes.length > 0
    ? Math.min(1, loveEpisodes.length / Math.max(1, recentEpisodes.length) * 3)
    : 0;

  // 冲突后恢复 → 韧性趋势
  if (conflictEpisodes.length > 0) {
    const postConflictPositive = recentEpisodes
      .filter(e => e.tags.includes('温暖') || e.tags.includes('亲密'))
      .length;
    velocities.resilience = postConflictPositive > 0 ? 0.5 : -0.2;
  }

  return velocities;
}

// ════════════════════════════════════════════════════════════
// 行为调制映射（按设计文档 3.4 节）
// ════════════════════════════════════════════════════════════

export interface ParamModulation {
  contagionMultiplier: number;
  arousalMultiplier: number;
  apologyBaseline: number;
  decayMultiplier: number;
  explorationBias: number;
  playfulBias: number;
}

export function getParamModulation(evo: EvolutionState): ParamModulation {
  return {
    // 共情度 → 情感传染系数
    contagionMultiplier: 0.5 + (evo.empathy / 100) * 1.0,
    // 敏感度 → 唤醒放大
    arousalMultiplier: 0.7 + evo.sensitivity * 0.6,
    // 信任倾向 → apologyCredit 基线偏移
    apologyBaseline: (evo.trust - 50) / 100 * 0.3,
    // 韧性 → arousal 消退加速
    decayMultiplier: 0.8 + evo.resilience * 0.4,
    // 开放性 → 探索阈值偏移
    explorationBias: (evo.openness - 50) / 100 * 0.3,
    // 幽默感 → 俏皮策略权重偏移
    playfulBias: (evo.playfulness - 50) / 100 * 0.25,
  };
}

export function clampPersonalityParams(evolution: EvolutionState): void {
  evolution.empathy = clamp(evolution.empathy, 0, 100);
  evolution.optimism = clamp(evolution.optimism, 0, 100);
  evolution.sensitivity = clamp(evolution.sensitivity, 0, 1);
  evolution.trust = clamp(evolution.trust, 0, 100);
  evolution.openness = clamp(evolution.openness, 0, 100);
  evolution.playfulness = clamp(evolution.playfulness, 0, 100);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
