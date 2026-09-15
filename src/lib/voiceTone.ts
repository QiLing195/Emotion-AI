// ── v1.4 语音语气层 (Voice Tone) ──
// 让"她的声音"随情感状态变化 —— 这是"有感情的声音"的第一层：
// 把情感引擎的主导情绪映射为语音韵律参数（pitch/rate/volume），
// 供任意 TTS 后端消费：
//   - edge-tts（现有，支持 --rate/--pitch/--volume）
//   - 浏览器 SpeechSynthesis（rate/pitch/volume 属性）
//   - 未来的情感 TTS（Chatterbox/CosyVoice…）只需把 emotion 转成自然语言语气指令
// 纯逻辑模块，无 io 依赖。

/** 语音可表达的情绪白名单（对齐情感引擎九情 + 常用温柔/安慰态） */
export type VoiceEmotion =
  | 'joy' | 'sad' | 'anger' | 'fear' | 'love' | 'calm'
  | 'disgust' | 'lust' | 'greed' | 'neutral';

/** 韵律档位：edge-tts/browser 通用 */
export interface VoiceToneProfile {
  /** 语速相对基准的百分比偏移（+变快 / −变慢），edge-tts 用 +X%/-X% */
  ratePct: number;
  /** 音高偏移 Hz（edge-tts 用 +XHz/-XHz）；browser 侧折算为 pitch */
  pitchHz: number;
  /** 音量偏移百分比 */
  volumePct: number;
  /** 人类可读的语气描述（供未来情感 TTS 转自然语言指令） */
  label: string;
}

export const EMOTION_TONES: Record<VoiceEmotion, VoiceToneProfile> = {
  joy:     { ratePct: 8,  pitchHz: 3,  volumePct: 5,  label: '轻快明亮，带着笑意' },
  sad:     { ratePct: -15, pitchHz: -4, volumePct: -5, label: '低沉缓慢，声音轻轻的' },
  anger:   { ratePct: 5,  pitchHz: 2,  volumePct: 8,  label: '带着一点情绪，语气略重' },
  fear:    { ratePct: -10, pitchHz: 2,  volumePct: -8, label: '小心翼翼，放轻声音' },
  love:    { ratePct: -3,  pitchHz: 1,  volumePct: 0,  label: '温柔而柔软，像哄人一样' },
  calm:    { ratePct: -5,  pitchHz: 0,  volumePct: -3, label: '平静安稳，不疾不徐' },
  disgust: { ratePct: 0,   pitchHz: 0,  volumePct: 0,  label: '平平淡淡' },
  lust:    { ratePct: -6,  pitchHz: -1, volumePct: -6, label: '低声，带着一点克制' },
  greed:   { ratePct: 3,   pitchHz: 1,  volumePct: 2,  label: '语气里有一点期待' },
  neutral: { ratePct: 0,   pitchHz: 0,  volumePct: 0,  label: '自然平常' },
};

const KNOWN_EMOTIONS = new Set<string>(Object.keys(EMOTION_TONES));

/** 是否平台支持的情绪值（服务端校验用，防任意注入） */
export function isVoiceEmotion(value: unknown): value is VoiceEmotion {
  return typeof value === 'string' && KNOWN_EMOTIONS.has(value);
}

/** 兜底：未知 → neutral */
export function sanitizeEmotion(value: unknown): VoiceEmotion {
  return isVoiceEmotion(value) ? value : 'neutral';
}

/**
 * 从情感状态取值最大者得到主导情绪，映射到语音情绪。
 * 情感引擎九情之外的名字（如关系层临时情绪）→ neutral。
 */
export function dominantVoiceEmotion(
  emotions: Record<string, number> | undefined | null,
): VoiceEmotion {
  if (!emotions) return 'neutral';
  let bestName = '';
  let bestValue = -Infinity;
  for (const [name, value] of Object.entries(emotions)) {
    if (typeof value === 'number' && value > bestValue && KNOWN_EMOTIONS.has(name)) {
      bestName = name;
      bestValue = value;
    }
  }
  return sanitizeEmotion(bestName);
}

/** 取某情绪的语气档位（未知/缺省 → neutral） */
export function resolveEmotionTone(
  emotion: VoiceEmotion | string | undefined | null = 'neutral',
): VoiceToneProfile {
  return EMOTION_TONES[sanitizeEmotion(emotion)];
}

/** 浏览器 SpeechSynthesis 参数折算（rate≈1±、pitch≈1±、volume 0..1） */
export function browserSpeechParams(profile: VoiceToneProfile): { rate: number; pitch: number; volume: number } {
  return {
    rate: Math.min(2, Math.max(0.5, 1 + profile.ratePct / 100)),
    pitch: Math.min(2, Math.max(0.1, 1 + profile.pitchHz / 40)),
    volume: Math.min(1, Math.max(0.1, 1 + profile.volumePct / 100)),
  };
}

/** edge-tts 命令行参数（含正负号 + 单位） */
export function edgeTtsArgs(profile: VoiceToneProfile): string[] {
  const signed = (v: number, unit: string): string => `${v >= 0 ? '+' : ''}${v}${unit}`;
  return [
    '--rate', signed(profile.ratePct, '%'),
    '--pitch', signed(profile.pitchHz, 'Hz'),
    '--volume', signed(profile.volumePct, '%'),
  ];
}

/**
 * v1.5 CosyVoice 情绪指令：把语音档位的人读描述拼成 instruct2 指令。
 * CosyVoice2 的 inference_instruct2 要求指令以 <|endofprompt|> 结尾。
 * 复用同一份 EMOTION_TONES.label —— 情感引擎九情 → 自然语言语气，一处维护三端受益
 * （edge-tts 韵律 / 浏览器语音 / CosyVoice 语义指令）。
 */
export function cosyVoiceInstruct(emotion?: VoiceEmotion | string | null): string {
  const profile = resolveEmotionTone(emotion);
  return `用${profile.label}的语气说这句话<|endofprompt|>`;
}
