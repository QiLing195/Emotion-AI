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

  it('v2.05：正负同现（拿到 offer 但怕做不好）→ 混合，uncertainty ≥ 0.4', () => {
    const a = analyzeUserSentiment('拿到 offer 了，但又有点怕自己做不好。');
    expect(a.likelyCause).toContain('混合');
    expect(a.uncertainty ?? 0).toBeGreaterThanOrEqual(0.4);
  });

  it('规范化的否定别名也不落进 love', () => {
    expect(canonicalEmotion('不喜欢你')).toBe('anger');
    expect(canonicalEmotion('不爱你')).toBe('anger');
    expect(canonicalEmotion('不讨厌')).toBe('love');
  });

  it('普通情绪否定不命中肯定词的反向类别', () => {
    expect(analyzeUserSentiment('我不开心').expressedEmotion).toBe('sad');
    expect(analyzeUserSentiment('我不高兴').expressedEmotion).toBe('sad');
    expect(analyzeUserSentiment('我不难过').expressedEmotion).toBe('neutral');
    expect(analyzeUserSentiment('我不担心').expressedEmotion).toBe('neutral');
    expect(analyzeUserSentiment('我不生气').expressedEmotion).toBe('neutral');
  });

  it('把“拿到好消息但不开心”识别为混合信号，不重复计入开心', () => {
    const analysis = analyzeUserSentiment('我拿到 offer 了，但还是不开心。');
    expect(analysis.expressedEmotion).toBe('sad');
    expect(analysis.likelyCause).toContain('混合');
    expect(analysis.uncertainty).toBeGreaterThan(0.3);
  });

  it('身体疲劳不把开心误降为混合情绪，但“心累”仍保留负向信号', () => {
    const physicalFatigue = analyzeUserSentiment('我今天有点累，不过拿到 offer 了，我很开心。');
    expect(physicalFatigue.expressedEmotion).toBe('joy');
    expect(physicalFatigue.likelyCause).not.toContain('混合');
    expect(physicalFatigue.uncertainty).toBe(0.25);

    const emotionalFatigue = analyzeUserSentiment('我拿到 offer 了，很开心，但最近一直心累。');
    expect(emotionalFatigue.likelyCause).toContain('混合');
    expect(emotionalFatigue.uncertainty).toBeGreaterThan(0.3);
  });
});

describe('情绪细分线索', () => {
  it('明确自述孤单时识别为 sad，而不是 neutral', () => {
    expect(analyzeUserSentiment('我最近觉得很孤单').expressedEmotion).toBe('sad');
  });

  it('失望但明确说不上生气时，不把否定的生气算成有效情绪', () => {
    const analysis = analyzeUserSentiment('我对这次结果很失望，但还说不上生气');
    expect(analysis.expressedEmotion).toBe('sad');
    expect(analysis.likelyCause).not.toContain('混合');
  });
});
