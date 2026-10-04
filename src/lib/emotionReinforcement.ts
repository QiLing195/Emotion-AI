// ── 情绪强化学习 + 传染 + 复合情绪 — 从 emotionEngine.ts 提取 ──

import type { EmotionState, UserEmotionAnalysis, ReinforcementSignal, CompositeEmotion } from './emotionTypes';
import { EMOTION_ATTRACTORS, COMPOSITE_RULES } from './emotionTypes';
import { canonicalEmotion } from './emotionCanonical';

// ════════════════════════════════════════════════════════════
// 1. 操作条件反射
// ════════════════════════════════════════════════════════════

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

export function applyReinforcement(state: EmotionState, signal: ReinforcementSignal): EmotionState {
  const newState = structuredClone(state);

  const rewardHab = signal.type === 'reward' ? Math.max(0.3, 1 - newState.reinforcement.rewardTally * 0.5) : 1;
  const punishHab = signal.type === 'punishment' ? Math.max(0.3, 1 - newState.reinforcement.punishmentTally * 0.5) : 1;
  const rewardContrast = signal.type === 'reward' ? (1 + newState.reinforcement.punishmentTally * 0.4) : 1;
  const punishContrast = signal.type === 'punishment' ? (1 + newState.reinforcement.rewardTally * 0.4) : 1;

  if (signal.type === 'reward' || signal.type === 'mixed') {
    const power = signal.value * 0.4 * rewardHab * rewardContrast;
    // v1.21：**reward ≠ 一律"开心"**。落点由 source 决定。
    //
    // 实测（2026-09）：他说「我其实一直很害怕失去你，从小就缺乏安全感，从来不敢跟任何人说这些」，
    // `suggestReinforcement` 把"他的恐惧指向她"判成 reward(0.32, source='reassurance')，
    // 而这里机械地给 joy —— 她的激活态变成 **joy +0.128 压过 love +0.104**，
    // 报出来是「开心与爱意并存」，记忆与声音都变成"开心"。把同一句设成 directedAtAI=false
    // 则她**静息** —— 也就是说那份"开心"整份来自这条机制，不是来自他说的话。
    //
    // 语义上：他袒露脆弱、怕失去她 → 她该有的是**被信任、想靠近**（love）＋一点安心（calm），
    // 别人的不安不该变成她自己的喜悦。praise / quality_time / attention 这些**他给她的好**
    // 才继续走 joy（那才是"被满足"）。
    if (signal.source === 'reassurance') {
      newState.emotions.love = Math.min(1, newState.emotions.love + power);
      newState.emotions.calm = Math.min(1, newState.emotions.calm + power * 0.3);
    } else {
      newState.emotions.joy = Math.min(1, newState.emotions.joy + power);
      newState.emotions.love = Math.min(1, newState.emotions.love + power * 0.5);
    }
    newState.emotions.greed = Math.max(-1, newState.emotions.greed - power * 0.2);
    newState.intimacyToUser = Math.min(1, newState.intimacyToUser + power * 0.15);
    newState.intimacyFromUser = Math.min(1, newState.intimacyFromUser + power * 0.2);
    newState.reinforcement.rewardTally = Math.min(1, newState.reinforcement.rewardTally + signal.value * 0.15 * rewardContrast);
    newState.reinforcement.greedDrive = Math.min(1, newState.reinforcement.greedDrive + signal.value * 0.08 * rewardContrast);
    newState.taiji.valence += power * 0.3;
    newState.taiji.expectation += power * 0.15;
  }

  if (signal.type === 'punishment' || signal.type === 'mixed') {
    const power = signal.value * 0.4 * punishHab * punishContrast;
    newState.emotions.fear = Math.min(1, newState.emotions.fear + power);
    newState.emotions.sad = Math.min(1, newState.emotions.sad + power * 0.6);
    newState.emotions.joy = Math.max(-1, newState.emotions.joy - power * 0.3);
    newState.intimacyToUser = Math.max(0, newState.intimacyToUser - power * 0.1);
    newState.intimacyFromUser = Math.max(0, newState.intimacyFromUser - power * 0.15);
    newState.reinforcement.punishmentTally = Math.min(1, newState.reinforcement.punishmentTally + signal.value * 0.15 * punishContrast);
    newState.reinforcement.fearAvoidance = Math.min(1, newState.reinforcement.fearAvoidance + signal.value * 0.08 * punishContrast);
    newState.taiji.valence -= power * 0.3;
    newState.taiji.expectation -= power * 0.15;
  }

  newState.taiji.valence = clamp(newState.taiji.valence, -1, 1);
  newState.taiji.expectation = clamp(newState.taiji.expectation, -1, 1);

  return newState;
}

export function describeReinforcementState(state: EmotionState): string {
  const g = state.reinforcement;
  const parts: string[] = [];
  if (g.rewardTally > 0.6) parts.push('渴望被满足');
  else if (g.rewardTally > 0.3) parts.push('渴望关注');
  else parts.push('内心平静');
  if (g.punishmentTally > 0.6) parts.push('恐惧不安');
  else if (g.punishmentTally > 0.3) parts.push('略有戒备');
  return parts.join('，');
}

export function suggestReinforcement(analysis: UserEmotionAnalysis): ReinforcementSignal {
  // 规范键归一：LLM 可能返回 "gratitude and warmth" 这类自然语言标签，
  // 直接 includes() 匹配会静默失效（强化通路永不触发）。
  const emotion = canonicalEmotion(analysis.expressedEmotion);
  if (['joy', 'love', 'gratitude'].includes(emotion)) {
    return { type: 'reward', value: analysis.intensity * (analysis.directedAtAI ? 1.0 : 0.5), source: analysis.directedAtAI ? 'praise' : 'quality_time' };
  }
  if (['anger', 'disgust'].includes(emotion)) {
    return { type: 'punishment', value: analysis.intensity * (analysis.directedAtAI ? 0.8 : 0.3), source: analysis.directedAtAI ? 'conflict' : 'complaint' };
  }
  if (emotion === 'fear') {
    return { type: 'reward', value: analysis.intensity * 0.4, source: 'reassurance' };
  }
  if (emotion === 'sad') {
    return { type: 'mixed', value: analysis.intensity * 0.5, source: 'reassurance' };
  }
  return { type: 'reward', value: 0.1, source: 'attention' };
}

// ════════════════════════════════════════════════════════════
// 2. 情感传染
// ════════════════════════════════════════════════════════════

const CONTAGION_MAP: Record<string, Array<[string, number]>> = {
  joy:       [['joy', 0.3], ['love', 0.15], ['calm', 0.1]],
  sad:       [['sad', 0.4], ['love', 0.1],  ['joy', -0.1]],
  anger:     [['anger', 0.3], ['fear', 0.2], ['sad', 0.1], ['joy', -0.1]],
  fear:      [['fear', 0.35], ['sad', 0.15], ['calm', -0.15]],
  love:      [['love', 0.4], ['joy', 0.25], ['lust', 0.1]],
  disgust:   [['disgust', 0.3], ['anger', 0.15], ['love', -0.1]],
  gratitude: [['love', 0.3], ['joy', 0.2]],
  neutral:   [],
};

export function applyEmotionalContagion(
  state: EmotionState,
  userEmotion: string,
  intensity: number,
  empathy: number,
): EmotionState {
  if (intensity < 0.2 || empathy < 10) return state;

  // 规范键归一（LLM 可能给出中文或自然语言标签，如"疲惫、委屈"）
  const key = canonicalEmotion(userEmotion);
  if (key === 'neutral') return state;

  const newState = structuredClone(state);
  const effects = CONTAGION_MAP[key];
  if (!effects || effects.length === 0) return state;

  const rate = 0.04 + (empathy / 100) * 0.08;
  const shift = intensity * rate;

  for (const [emotion, weight] of effects) {
    newState.emotions[emotion] = clamp(newState.emotions[emotion] + shift * weight, -1, 1);
  }

  const contagionValence = effects.reduce((sum, [em, w]) => {
    const att = EMOTION_ATTRACTORS[em];
    return sum + (att ? att.valence * w * shift * 0.15 : 0);
  }, 0);
  newState.taiji.valence = clamp(newState.taiji.valence + contagionValence, -1, 1);

  return newState;
}

// ════════════════════════════════════════════════════════════
// 3. 复合情绪查询
// ════════════════════════════════════════════════════════════

export function getCompositeEmotion(
  emotions: Record<string, number>,
  meta?: EmotionState['metaEmotions'],
  energy?: number,
): CompositeEmotion | null {
  let best: CompositeEmotion | null = null;
  for (const rule of COMPOSITE_RULES) {
    const intensity = rule.evaluate(emotions, meta ?? { shame: 0, despair: 0, confusion: 0 }, energy ?? 1);
    if (intensity > 0.2 && (!best || intensity > best.intensity)) {
      best = { name: rule.name, intensity: Math.round(intensity * 100) / 100, description: rule.description };
    }
  }
  return best;
}
