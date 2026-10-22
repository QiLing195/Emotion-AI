/**
 * 语音唤醒配置（v1.90）：唤醒词可以不改文件、直接在桌宠里改。
 * 读写 scripts/voice-config.json；保存后由 voiceWatch 重启识别进程生效。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const VOICE_CONFIG_PATH = join('scripts', 'voice-config.json');
export const MAX_WAKE_WORDS = 6;
export const MAX_WAKE_WORD_LEN = 12;
export const MIN_WAKE_WORDS = 1;

export interface VoiceConfig {
  wakeWords: string[];
  wakeMinConfidence: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  wakeWords: ['二丫'],
  wakeMinConfidence: 0.93,
};

export function loadVoiceConfig(): VoiceConfig {
  if (!existsSync(VOICE_CONFIG_PATH)) return { ...DEFAULT_VOICE_CONFIG, wakeWords: [...DEFAULT_VOICE_CONFIG.wakeWords] };
  try {
    const raw = JSON.parse(readFileSync(VOICE_CONFIG_PATH, 'utf8')) as Partial<VoiceConfig>;
    const words = Array.isArray(raw.wakeWords)
      ? raw.wakeWords.map(w => String(w).trim()).filter(w => w.length > 0 && w.length <= MAX_WAKE_WORD_LEN)
      : [];
    const conf = Number(raw.wakeMinConfidence);
    return {
      wakeWords: words.length ? Array.from(new Set(words)).slice(0, MAX_WAKE_WORDS) : [...DEFAULT_VOICE_CONFIG.wakeWords],
      wakeMinConfidence: Number.isFinite(conf) && conf >= 0.5 && conf <= 0.99 ? conf : DEFAULT_VOICE_CONFIG.wakeMinConfidence,
    };
  } catch {
    return { ...DEFAULT_VOICE_CONFIG, wakeWords: [...DEFAULT_VOICE_CONFIG.wakeWords] };
  }
}

export interface SaveVoiceConfigResult {
  ok: boolean;
  config?: VoiceConfig;
  error?: string;
}

/** 校验 + 保存（不合法就整次拒绝，不写半截配置） */
export function saveVoiceConfig(input: { wakeWords?: unknown; wakeMinConfidence?: unknown }): SaveVoiceConfigResult {
  const rawWords = Array.isArray(input.wakeWords) ? input.wakeWords : String(input.wakeWords ?? '').split(/[,，、\s]+/);
  const words: string[] = [];
  for (const w of rawWords) {
    const s = String(w ?? '').trim();
    if (!s) continue;
    if (s.length > MAX_WAKE_WORD_LEN) return { ok: false, error: `唤醒词太长（最多 ${MAX_WAKE_WORD_LEN} 个字）：${s}` };
    if (!words.includes(s)) words.push(s);
  }
  if (words.length < MIN_WAKE_WORDS) return { ok: false, error: '至少要有一个唤醒词' };
  if (words.length > MAX_WAKE_WORDS) return { ok: false, error: `唤醒词最多 ${MAX_WAKE_WORDS} 个` };

  const conf = Number(input.wakeMinConfidence ?? DEFAULT_VOICE_CONFIG.wakeMinConfidence);
  if (!Number.isFinite(conf) || conf < 0.5 || conf > 0.99) {
    return { ok: false, error: '置信度门槛必须在 0.50 ~ 0.99 之间' };
  }

  const config: VoiceConfig = { wakeWords: words, wakeMinConfidence: Math.round(conf * 100) / 100 };
  try {
    const dir = dirname(VOICE_CONFIG_PATH);
    if (dir && !existsSync(dir)) writeFileSync(dir, '', 'utf8');   // 理论上 scripts/ 一定存在
    writeFileSync(VOICE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return { ok: true, config };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
