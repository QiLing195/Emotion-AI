import { describe, it, expect } from 'vitest';
import { analyzeUserSentiment } from '../emotionNLU.js';
import { canonicalEmotion } from '../emotionCanonical.js';

describe('v2.03：否定亲密表达不能被识别成 love（审查 P1-1）', () => {
  it('"我不喜欢你" → anger，且指向她', () => {
    const a = analyzeUserSentiment('我不喜欢你');
    expect(a.expressedEmotion).toBe('anger');
    expect(a.directedAtAI).toBe(true);
    expect(a.likelyCause).toContain('否定');
  });

  it('"我不爱你了" → anger，不是 love', () => {
    const a = analyzeUserSentiment('我不爱你了');
    expect(a.expressedEmotion).toBe('anger');
  });

  it('"我不讨厌你" → 双重否定，不是 anger', () => {
    const a = analyzeUserSentiment('我不讨厌你');
    expect(a.expressedEmotion).toBe('love');
    expect(a.uncertainty).toBeGreaterThan(0);
  });

  it('引用/转述里的"喜欢"不指向她，且强度降低', () => {
    const a = analyzeUserSentiment('他说他不喜欢我，我有点难过');
    expect(a.directedAtAI).toBe(false);
    expect(a.likelyCause).toContain('引用');
    expect(a.intensity).toBeLessThan(0.7);
  });

  it('同时有正/负信号 → 标"情绪可能混合"并提高不确定度', () => {
    const a = analyzeUserSentiment('我刚拿到offer很开心，但又有点担心做不好');
    expect(a.likelyCause).toContain('混合');
    expect(a.uncertainty).toBeGreaterThan(0.3);
  });

  it('规范化的否定别名也不落进 love', () => {
    expect(canonicalEmotion('不喜欢你')).toBe('anger');
    expect(canonicalEmotion('不爱你')).toBe('anger');
    expect(canonicalEmotion('不讨厌')).toBe('love');
  });
});
