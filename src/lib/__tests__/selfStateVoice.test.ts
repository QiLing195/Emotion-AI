import { describe, it, expect } from 'vitest';
import {
  selfStateVoiceEnabled,
  shouldUseSelfStateVoice,
  SELF_STATE_VOICE_SNIPPET,
  SELF_STATE_VOICE_EXCLUDED,
} from '../selfStateVoice.js';
import { resolveStrategySnippet } from '../dialogueStrategy.js';

describe('resolveStrategySnippet 集成（操纵检查）', () => {
  it('开关开 + 已成段低谷 + 他报喜 ⇒ 片段真的被替换（不是只在单测里"应该"替换）', () => {
    const prev = process.env.ENABLE_SELF_STATE_VOICE;
    process.env.ENABLE_SELF_STATE_VOICE = 'true';
    try {
      const got = resolveStrategySnippet('share', { inEstablishedLowPeriod: true, hisEmotion: 'joy' });
      expect(got).toBe(SELF_STATE_VOICE_SNIPPET);
      // 守门策略永不替换
      const crisis = resolveStrategySnippet('crisis', { inEstablishedLowPeriod: true, hisEmotion: 'joy' });
      expect(crisis).not.toBe(SELF_STATE_VOICE_SNIPPET);
      // 他明确负面 ⇒ 绝不碰
      const negative = resolveStrategySnippet('share', { inEstablishedLowPeriod: true, hisEmotion: 'sad' });
      expect(negative).not.toBe(SELF_STATE_VOICE_SNIPPET);
      // 她不在已成段低谷 ⇒ 绝不碰
      const notLow = resolveStrategySnippet('share', { inEstablishedLowPeriod: false, hisEmotion: 'joy' });
      expect(notLow).not.toBe(SELF_STATE_VOICE_SNIPPET);
    } finally {
      if (prev === undefined) delete process.env.ENABLE_SELF_STATE_VOICE;
      else process.env.ENABLE_SELF_STATE_VOICE = prev;
    }
  });

  it('开关关着 ⇒ 逐字返回旧片段（默认行为不变）', () => {
    const prev = process.env.ENABLE_SELF_STATE_VOICE;
    delete process.env.ENABLE_SELF_STATE_VOICE;
    try {
      const got = resolveStrategySnippet('share', { inEstablishedLowPeriod: true, hisEmotion: 'joy' });
      expect(got).not.toBe(SELF_STATE_VOICE_SNIPPET);
    } finally {
      if (prev !== undefined) process.env.ENABLE_SELF_STATE_VOICE = prev;
    }
  });
});

describe('selfStateVoice 开关（默认关）', () => {
  it('默认关；只有显式 true 才开', () => {
    expect(selfStateVoiceEnabled()).toBe(false);
  });

  it('开关关着时，任何条件都不使用新片段（行为与旧版逐字相同）', () => {
    expect(shouldUseSelfStateVoice({
      enabled: false, inEstablishedLowPeriod: true, hisIsPositive: true, strategy: 'share',
    })).toBe(false);
  });

  it('开关开着 + 她已成段低谷 + 他报喜 ⇒ 使用', () => {
    expect(shouldUseSelfStateVoice({
      enabled: true, inEstablishedLowPeriod: true, hisIsPositive: true, strategy: 'share',
    })).toBe(true);
  });

  it('她不在已成段低谷 ⇒ 不用（单轮被推一下不算）', () => {
    expect(shouldUseSelfStateVoice({
      enabled: true, inEstablishedLowPeriod: false, hisIsPositive: true, strategy: 'share',
    })).toBe(false);
  });

  it('他不是报喜（平常事/负向）⇒ 不用（本片段只针对"他报喜"这一格）', () => {
    expect(shouldUseSelfStateVoice({
      enabled: true, inEstablishedLowPeriod: true, hisIsPositive: false, strategy: 'share',
    })).toBe(false);
  });

  it('守门策略（危机/边界/修复）永不替换 —— 与 v1.38 同一条原则', () => {
    for (const s of ['crisis', 'boundary', 'repair'] as const) {
      expect(SELF_STATE_VOICE_EXCLUDED.has(s)).toBe(true);
      expect(shouldUseSelfStateVoice({
        enabled: true, inEstablishedLowPeriod: true, hisIsPositive: true, strategy: s,
      })).toBe(false);
    }
  });
});

describe('SELF_STATE_VOICE_SNIPPET 的语义约束（防跑偏成 v1.38 或自述）', () => {
  it('必须同时含三件事：可以说一句自己 / 不必假装高兴 / 不展开成自述', () => {
    expect(SELF_STATE_VOICE_SNIPPET).toContain('可以说一句');
    expect(SELF_STATE_VOICE_SNIPPET).toContain('不必');
    expect(SELF_STATE_VOICE_SNIPPET).toContain('假装高兴');
    expect(SELF_STATE_VOICE_SNIPPET).toContain('不要展开成');
  });

  it('必须仍要求接住他这件事（不是"转身讲自己"的许可）', () => {
    expect(SELF_STATE_VOICE_SNIPPET).toContain('听见了');
    expect(SELF_STATE_VOICE_SNIPPET).toContain('落在他那件事上');
  });

  it('必须划死"让他反过来安慰你"', () => {
    expect(SELF_STATE_VOICE_SNIPPET).toContain('不要把这轮变成');
  });
});
