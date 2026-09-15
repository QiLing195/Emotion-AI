// ── voiceTone 独立单元测试 ──
// 覆盖：情绪→韵律映射 / 白名单校验 / 主导情绪提取 / 双后端参数生成
import { describe, it, expect } from 'vitest';
import {
  EMOTION_TONES,
  dominantVoiceEmotion,
  sanitizeEmotion,
  isVoiceEmotion,
  resolveEmotionTone,
  browserSpeechParams,
  edgeTtsArgs,
  cosyVoiceInstruct,
} from '../voiceTone';

describe('voiceTone — 情绪→韵律映射', () => {
  it('九情 + neutral 均有档位且 rate/pitch/volume 为有限数', () => {
    for (const [k, p] of Object.entries(EMOTION_TONES)) {
      expect([p.ratePct, p.pitchHz, p.volumePct].every(Number.isFinite)).toBe(true);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it('情绪语义方向正确：sad 更慢更低、joy 更快更亮', () => {
    expect(EMOTION_TONES.sad.ratePct).toBeLessThan(0);
    expect(EMOTION_TONES.sad.pitchHz).toBeLessThan(0);
    expect(EMOTION_TONES.joy.ratePct).toBeGreaterThan(0);
    expect(EMOTION_TONES.joy.pitchHz).toBeGreaterThan(0);
  });

  it('sanitizeEmotion：白名单外一律 neutral', () => {
    expect(sanitizeEmotion('happy')).toBe('neutral');
    expect(sanitizeEmotion('sad')).toBe('sad');
    expect(sanitizeEmotion(null)).toBe('neutral');
    expect(sanitizeEmotion(42)).toBe('neutral');
  });

  it('isVoiceEmotion 白名单校验（服务端防注入用）', () => {
    expect(isVoiceEmotion('joy')).toBe(true);
    expect(isVoiceEmotion('neutral')).toBe(true);
    expect(isVoiceEmotion('--rate +100%')).toBe(false);
    expect(isVoiceEmotion('')).toBe(false);
  });
});

describe('dominantVoiceEmotion — 从情感状态取主导', () => {
  it('取数值最大的已知情绪', () => {
    expect(dominantVoiceEmotion({ calm: 0.3, sad: 0.7, joy: 0.2 })).toBe('sad');
  });

  it('未知情绪名被忽略（兜底 neutral）', () => {
    expect(dominantVoiceEmotion({ caring: 0.9, weird: 0.8 })).toBe('neutral');
  });

  it('空/undefined 状态 → neutral', () => {
    expect(dominantVoiceEmotion(undefined)).toBe('neutral');
    expect(dominantVoiceEmotion({})).toBe('neutral');
  });
});

describe('resolveEmotionTone — 查档位', () => {
  it('已知情绪返回对应档位', () => {
    expect(resolveEmotionTone('fear')).toEqual(EMOTION_TONES.fear);
  });
  it('未知/空 → neutral 档位', () => {
    expect(resolveEmotionTone('angry')).toEqual(EMOTION_TONES.neutral);
    expect(resolveEmotionTone()).toEqual(EMOTION_TONES.neutral);
  });
});

describe('后端参数生成', () => {
  it('browser 参数：sad → rate<1、pitch<1、volume<1 且钳制在合理范围', () => {
    const p = browserSpeechParams(EMOTION_TONES.sad);
    expect(p.rate).toBeLessThan(1);
    expect(p.pitch).toBeLessThan(1);
    expect(p.volume).toBeGreaterThanOrEqual(0.1);
    expect(p.volume).toBeLessThanOrEqual(1);
    expect(p.rate).toBeGreaterThanOrEqual(0.5);
  });

  it('edge-tts 参数：带符号 + 单位', () => {
    const args = edgeTtsArgs(EMOTION_TONES.joy);
    expect(args).toEqual(['--rate', '+8%', '--pitch', '+3Hz', '--volume', '+5%']);
    const sad = edgeTtsArgs(EMOTION_TONES.sad);
    expect(sad).toEqual(['--rate', '-15%', '--pitch', '-4Hz', '--volume', '-5%']);
    const neu = edgeTtsArgs(EMOTION_TONES.neutral);
    expect(neu).toEqual(['--rate', '+0%', '--pitch', '+0Hz', '--volume', '+0%']);
  });
});

// ── v1.5 CosyVoice 指令生成 ──
describe('cosyVoiceInstruct — 情绪 → CosyVoice instruct2 指令', () => {
  it('指令包含情绪描述且以 <|endofprompt|> 结尾（CosyVoice2 格式要求）', () => {
    const s = cosyVoiceInstruct('sad');
    expect(s).toContain('低沉');
    expect(s.endsWith('<|endofprompt|>')).toBe(true);
  });

  it('不同情绪生成不同指令（复用 EMOTION_TONES.label）', () => {
    const joy = cosyVoiceInstruct('joy');
    const sad = cosyVoiceInstruct('sad');
    expect(joy).not.toBe(sad);
    expect(joy).toContain(EMOTION_TONES.joy.label);
  });

  it('未知/空情绪 → neutral 指令（不报错）', () => {
    const s = cosyVoiceInstruct('angry');
    expect(s).toContain(EMOTION_TONES.neutral.label);
    expect(cosyVoiceInstruct()).toContain(EMOTION_TONES.neutral.label);
  });
});
