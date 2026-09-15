// ── emotionCanonical 单元测试 ──
// 覆盖：规范键归一（中文/英文/自然语言短语）、否定优先、无匹配回落，
//       以及"LLM 中文标签导致传染/强化静默失效"这一真实故障的回归防护
// 背景：开启 LLM 情感识别后实测返回 "疲惫、委屈" / "gratitude and warmth"，
//       而 CONTAGION_MAP / suggestReinforcement 只认固定英文键 → 通路永不触发。

import { describe, it, expect } from 'vitest';
import {
  canonicalEmotion,
  canonicalizeWithLabel,
  isCanonicalEmotion,
  CANONICAL_EMOTIONS,
} from '../emotionCanonical';
import { applyEmotionalContagion, suggestReinforcement } from '../emotionReinforcement';
import { applyReinforcement } from '../emotionReinforcement';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState, UserEmotionAnalysis } from '../emotionTypes';

function baseState(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function analysis(overrides: Partial<UserEmotionAnalysis> = {}): UserEmotionAnalysis {
  return {
    expressedEmotion: 'joy',
    likelyCause: 'test',
    intensity: 0.8,
    directedAtAI: true,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. 规范键归一
// ════════════════════════════════════════════════════════════

describe('canonicalEmotion — 英文与规范键', () => {
  it('规范键原样返回', () => {
    for (const key of CANONICAL_EMOTIONS) {
      expect(canonicalEmotion(key)).toBe(key);
    }
  });

  it('常见英文同义词归一', () => {
    expect(canonicalEmotion('happy')).toBe('joy');
    expect(canonicalEmotion('depressed')).toBe('sad');
    expect(canonicalEmotion('furious')).toBe('anger');
    expect(canonicalEmotion('anxious')).toBe('fear');
    expect(canonicalEmotion('thankful')).toBe('gratitude');
  });

  it('大小写与空白无关', () => {
    expect(canonicalEmotion('  ANGER  ')).toBe('anger');
  });
});

describe('canonicalEmotion — 中文标签（LLM 实际输出）', () => {
  it('实测返回的「疲惫、委屈」→ sad', () => {
    expect(canonicalEmotion('疲惫、委屈')).toBe('sad');
  });

  it('实测返回的「gratitude and warmth」→ gratitude（含 warmth 仍优先 gratitude）', () => {
    // "gratitude and warmth" 同时含 love 别名 warmth，但 gratitude 更长 → 先命中
    expect(canonicalEmotion('gratitude and warmth')).toBe('gratitude');
  });

  it('各情绪的中文表达归一', () => {
    expect(canonicalEmotion('开心')).toBe('joy');
    expect(canonicalEmotion('难过')).toBe('sad');
    expect(canonicalEmotion('生气')).toBe('anger');
    expect(canonicalEmotion('担心')).toBe('fear');
    expect(canonicalEmotion('想你')).toBe('love');
    expect(canonicalEmotion('谢谢')).toBe('gratitude');
    expect(canonicalEmotion('反感')).toBe('disgust');
    expect(canonicalEmotion('平静')).toBe('neutral');
  });

  it('否定形式优先于肯定词（「不开心」不应变成 joy）', () => {
    expect(canonicalEmotion('不开心')).toBe('sad');
    expect(canonicalEmotion('不高兴')).toBe('sad');
    expect(canonicalEmotion('我今天很不开心')).toBe('sad');
  });
});

describe('canonicalEmotion — 边界', () => {
  it('无法识别时返回 fallback（默认 neutral）', () => {
    expect(canonicalEmotion('蓝色')).toBe('neutral');
    expect(canonicalEmotion('xyzzy')).toBe('neutral');
    expect(canonicalEmotion('蓝色', 'sad')).toBe('sad');
  });

  it('空值/非字符串安全', () => {
    expect(canonicalEmotion('')).toBe('neutral');
    expect(canonicalEmotion('   ')).toBe('neutral');
    expect(canonicalEmotion(null)).toBe('neutral');
    expect(canonicalEmotion(undefined)).toBe('neutral');
    expect(canonicalEmotion(123 as unknown as string)).toBe('neutral');
  });
});

describe('isCanonicalEmotion / canonicalizeWithLabel', () => {
  it('校验规范键', () => {
    expect(isCanonicalEmotion('sad')).toBe(true);
    expect(isCanonicalEmotion('难过')).toBe(false);
    expect(isCanonicalEmotion(undefined)).toBe(false);
  });

  it('保留可读标签：正文与键不同时给出 label', () => {
    expect(canonicalizeWithLabel('疲惫、委屈')).toEqual({ emotion: 'sad', label: '疲惫、委屈' });
    expect(canonicalizeWithLabel('sad')).toEqual({ emotion: 'sad', label: undefined });
    expect(canonicalizeWithLabel('')).toEqual({ emotion: 'neutral', label: undefined });
  });
});

// ════════════════════════════════════════════════════════════
// 2. 回归防护：中文标签必须能触发传染与强化
// ════════════════════════════════════════════════════════════

describe('回归：LLM 中文标签不再让通路静默失效', () => {
  it('传染：用户「疲惫、委屈」应让她 sad 上升（此前完全不动）', () => {
    const s = baseState();
    const out = applyEmotionalContagion(s, '疲惫、委屈', 0.8, 60);
    expect(out.emotions.sad).toBeGreaterThan(s.emotions.sad);
    expect(out).not.toBe(s); // 不再是原对象直返
  });

  it('传染：规范键行为不变', () => {
    const s = baseState();
    const out = applyEmotionalContagion(s, 'sad', 0.8, 60);
    expect(out.emotions.sad).toBeGreaterThan(s.emotions.sad);
  });

  it('传染：neutral / 低强度 / 低共情仍不触发', () => {
    const s = baseState();
    expect(applyEmotionalContagion(s, '平静', 0.9, 60)).toBe(s);
    expect(applyEmotionalContagion(s, 'sad', 0.1, 60)).toBe(s);
    expect(applyEmotionalContagion(s, 'sad', 0.9, 5)).toBe(s);
  });

  it('强化：用户感谢（中文/口语标签）应判定为 reward', () => {
    expect(suggestReinforcement(analysis({ expressedEmotion: 'gratitude and warmth' })).type).toBe('reward');
    expect(suggestReinforcement(analysis({ expressedEmotion: '谢谢' })).type).toBe('reward');
    // "你真贴心" 走 gratitude 分支（而非"未知 → attention 兜底"）
    expect(suggestReinforcement(analysis({ expressedEmotion: '你真贴心' }))).toEqual(
      expect.objectContaining({ type: 'reward', source: 'praise' }),
    );
    // 对照：完全无法识别的标签只给 attention 兜底
    expect(suggestReinforcement(analysis({ expressedEmotion: '蓝色' })).source).toBe('attention');
  });

  it('强化：用户生气/厌恶判定为 punishment（且指向她时更强）', () => {
    const toAI = suggestReinforcement(analysis({ expressedEmotion: '生气', directedAtAI: true, intensity: 0.8 }));
    const third = suggestReinforcement(analysis({ expressedEmotion: '生气', directedAtAI: false, intensity: 0.8 }));
    expect(toAI.type).toBe('punishment');
    expect(toAI.value).toBeGreaterThan(third.value);
  });

  it('强化：担心 → reassurance(reward)；难过 → mixed（安慰但带共情）', () => {
    expect(suggestReinforcement(analysis({ expressedEmotion: '担心' }))).toEqual(
      expect.objectContaining({ type: 'reward', source: 'reassurance' }),
    );
    expect(suggestReinforcement(analysis({ expressedEmotion: '难过' })).type).toBe('mixed');
  });

  it('强化后状态确实变化（端到端：标签 → 信号 → 状态）', () => {
    const s = baseState();
    const signal = suggestReinforcement(analysis({ expressedEmotion: '谢谢', intensity: 0.9 }));
    const out = applyReinforcement(s, signal);
    expect(out.emotions.joy).toBeGreaterThan(s.emotions.joy);
    expect(out.intimacyFromUser).toBeGreaterThanOrEqual(s.intimacyFromUser);
  });
});
