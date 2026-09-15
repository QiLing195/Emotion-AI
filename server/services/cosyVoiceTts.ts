// ── CosyVoice2 本地 TTS 客户端（v1.5）──
// 把 AI 女友的文本 + 情绪发给本地 CosyVoice FastAPI 服务（默认 127.0.0.1:50000），
// 拿回 raw PCM(int16, 24kHz) 并补 WAV 头，供浏览器 <audio> 直接播放。
// 设计要点：
//  - 服务未启动/请求失败 → 抛 CosyVoiceUnavailableError，由 /api/tts 返回 502，
//    前端会自动回退浏览器语音（不会让聊天报错）；
//  - 情绪 → instruct2 指令复用 src/lib/voiceTone（与 edge-tts 韵律同源）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cosyVoiceInstruct } from '../../src/lib/voiceTone.js';
import type { VoiceEmotion } from '../../src/lib/voiceTone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** CosyVoice 服务地址（可用环境变量覆盖） */
const COSYVOICE_URL = process.env.COSYVOICE_URL || 'http://127.0.0.1:50000';
/** 参考音（3 秒左右清晰人声；可用环境变量覆盖） */
const DEFAULT_PROMPT_WAV = process.env.COSYVOICE_PROMPT_WAV
  || path.join(__dirname, '..', 'assets', 'voice_prompt.wav');
/** 单次合成的超时（长文本需要更久；CosyVoice RTF≈2.5~3.5） */
const SYNTH_TIMEOUT_MS = Number(process.env.COSYVOICE_TIMEOUT_MS || 180_000);

export const COSYVOICE_SAMPLE_RATE = 24000;

export class CosyVoiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CosyVoiceUnavailableError';
  }
}

/** raw PCM int16 mono → WAV(RIFF) 字节（浏览器 <audio> 需要文件头） */
export function pcmToWav(pcm: Buffer, sampleRate = COSYVOICE_SAMPLE_RATE, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);                    // fmt chunk size
  header.writeUInt16LE(1, 20);                     // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** 参考音是否可用（缺失时给出明确错误，便于排查） */
export function promptWavPath(): string {
  return DEFAULT_PROMPT_WAV;
}

export interface CosyVoiceSynthesisOptions {
  text: string;
  emotion?: VoiceEmotion | string | null;
  /** 覆盖参考音路径（默认 server/assets/voice_prompt.wav） */
  promptWav?: string;
  /** 覆盖服务地址（默认 COSYVOICE_URL） */
  serviceUrl?: string;
}

/**
 * 调用 CosyVoice 本地服务合成语音。
 * @returns 带 WAV 头的音频 Buffer
 * @throws CosyVoiceUnavailableError 服务不可用 / 参考音缺失 / 超时
 */
export async function synthesizeCosyVoice(opts: CosyVoiceSynthesisOptions): Promise<Buffer> {
  const text = opts.text?.trim();
  if (!text) throw new CosyVoiceUnavailableError('empty text');

  const promptPath = opts.promptWav || DEFAULT_PROMPT_WAV;
  if (!fs.existsSync(promptPath)) {
    throw new CosyVoiceUnavailableError(`参考音缺失: ${promptPath}（请把一段 3 秒清晰人声放到该路径，或设置 COSYVOICE_PROMPT_WAV）`);
  }

  const base = (opts.serviceUrl || COSYVOICE_URL).replace(/\/+$/, '');
  const form = new FormData();
  form.append('tts_text', text);
  form.append('instruct_text', cosyVoiceInstruct(opts.emotion));
  const promptBuf = fs.readFileSync(promptPath);
  form.append('prompt_wav', new Blob([new Uint8Array(promptBuf)], { type: 'audio/wav' }), 'prompt.wav');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${base}/inference_instruct2`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? `合成超时(>${SYNTH_TIMEOUT_MS / 1000}s)` : (err?.message || '连接失败');
    throw new CosyVoiceUnavailableError(`CosyVoice 服务不可用（${base}）：${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new CosyVoiceUnavailableError(`CosyVoice 返回 HTTP ${resp.status}`);
  }

  const pcm = Buffer.from(await resp.arrayBuffer());
  if (pcm.length < 1000) {
    throw new CosyVoiceUnavailableError(`CosyVoice 返回音频过短（${pcm.length} 字节）`);
  }
  return pcmToWav(pcm);
}

/** 服务健康探测（供 /api/tts 选择通道或诊断用，不影响主流程） */
export async function cosyVoiceHealth(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${COSYVOICE_URL.replace(/\/+$/, '')}/docs`, { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
