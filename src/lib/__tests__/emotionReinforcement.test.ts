// ── emotionReinforcement 测试 ──
// v1.21：`reward` 的情绪落点不再机械等于 joy，而由 `source` 决定。
//
// 背景实测：他说「我其实一直很害怕失去你，从小就缺乏安全感，从来不敢跟任何人说这些」，
// `suggestReinforcement` 把"他的恐惧指向她"判成 reward(source='reassurance')，
// 而旧实现一律给 joy → 她的激活态 joy +0.128 压过 love +0.104，报出来是「开心与爱意并存」。
// 把同一句设成 directedAtAI=false 则她**静息** —— 那份"开心"整份来自这条机制，不是来自他说的话。

import { describe, it, expect } from 'vitest';
import { applyReinforcement, suggestReinforcement } from '../emotionReinforcement';
import { INITIAL_EMOTION_STATE } from '../emotionTypes';
import type { EmotionState, UserEmotionAnalysis } from '../emotionTypes';

function base(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function analysis(over: Partial<UserEmotionAnalysis> = {}): UserEmotionAnalysis {
  return { expressedEmotion: 'fear', intensity: 0.8, directedAtAI: true, likelyCause: 'test', ...over };
}

describe('v1.21 reward 的情绪落点跟 source 走', () => {
  it('安慰（source=reassurance）：抬爱意与安心，**不**抬开心', () => {
    const s = base();
    const out = applyReinforcement(s, { type: 'reward', value: 0.32, source: 'reassurance' });
    expect(out.emotions.love).toBeGreaterThan(s.emotions.love);
    expect(out.emotions.calm).toBeGreaterThan(s.emotions.calm);
    // ← 关键：别人的不安不该变成她自己的喜悦
    expect(out.emotions.joy).toBe(s.emotions.joy);
  });

  it('他给她的好（source=praise）：照旧抬开心（"被满足"才是 joy）', () => {
    const s = base();
    const out = applyReinforcement(s, { type: 'reward', value: 1.0, source: 'praise' });
    expect(out.emotions.joy).toBeGreaterThan(s.emotions.joy);
  });

  it('两类都仍抬亲密与效价（关系性收益不因落点不同而丢失）', () => {
    for (const source of ['reassurance', 'praise'] as const) {
      const s = base();
      const out = applyReinforcement(s, { type: 'reward', value: 0.5, source });
      expect(out.intimacyToUser, source).toBeGreaterThan(s.intimacyToUser);
      expect(out.taiji.valence, source).toBeGreaterThan(s.taiji.valence);
      expect(out.reinforcement.rewardTally, source).toBeGreaterThan(s.reinforcement.rewardTally);
    }
  });

  it('端到端：他说"我怕失去你"（指向她）→ 她的爱意高于开心', () => {
    const signal = suggestReinforcement(analysis({ expressedEmotion: 'fear' }));
    expect(signal.source).toBe('reassurance');
    const out = applyReinforcement(base(), signal);
    expect(out.emotions.love).toBeGreaterThan(out.emotions.joy);
  });

  it('回归：被夸（joy/love/gratitude 指向她）仍然是 reward + praise', () => {
    for (const emo of ['joy', 'love', 'gratitude']) {
      const signal = suggestReinforcement(analysis({ expressedEmotion: emo, intensity: 0.9 }));
      expect(signal.type, emo).toBe('reward');
      expect(signal.source, emo).toBe('praise');
    }
  });
});
