// ── CosyVoice2 本地 TTS 客户端（v1.5 / v1.6）──
// 把 AI 女友的文本 + 情绪 + 情绪强度发给本地 CosyVoice FastAPI 服务（默认 127.0.0.1:50000），
// 拿回 raw PCM(int16, 24kHz) 并补 WAV 头，供浏览器 <audio> 直接播放。
// 设计要点：
//  - 服务未启动/请求失败 → 抛 CosyVoiceUnavailableError，由 /api/tts 返回 502，
//    前端会自动回退浏览器语音（不会让聊天报错）；
//  - 情绪 → instruct2 指令复用 src/lib/voiceTone（与 edge-tts 韵律同源）；
//  - v1.6 双端点：官方 runtime/python/fastapi/server.py **不透出 speed**，
//    而 cosyvoice.cli.cosyvoice.CosyVoice2.inference_* 本身支持（实现见 cli/model.py 的
//    token2wav：对 mel 做时间插值）。实测「开心」用指令文案推不动，只有语速有效，
//    所以先试带 speed 的 /tts，遇到 404/405（说明跑的是官方 server）再回退
//    /inference_instruct2 —— 回退时**只丢语速，情绪指令照常生效**，不影响任何既有部署。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { cosyVoiceInstruct, cosyVoiceSpeed } from '../../src/lib/voiceTone.js';
import type { VocalPerformance, VoiceEmotion } from '../../src/lib/voiceTone.js';

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

/** 支持 speed 的增强端点（本仓库 tts-tools/cosyvoice-server.py 追加） */
const ENHANCED_ENDPOINT = '/tts';
/** 官方端点（无 speed，参数名为 tts_text） */
const OFFICIAL_ENDPOINT = '/inference_instruct2';

/** 端点探测结果缓存：避免每次合成都先撞一次 404 */
let resolvedEndpoint: string | null = null;

/** 仅测试用：重置端点探测缓存 */
export function __resetEndpointCache(): void {
  resolvedEndpoint = null;
}

/**
 * 暗音色参考音（胸腔共鸣、发闷）。
 * 用于 valence 为负的状态：instruct2 通道里参考音频**决定音色**（韵律才被丢弃），
 * 实测换成它后频谱重心 −164Hz、高频比 −21%（均 p=0.004），且语速/音高/停顿不变。
 * 缺失时静默回退默认参考音 —— 少一份资产不该让 TTS 报错。
 */
const DARK_PROMPT_WAV = process.env.COSYVOICE_PROMPT_WAV_DARK
  || path.join(__dirname, '..', 'assets', 'voice_prompt_dark.wav');

/** 按音色提示选参考音（缺文件则回退默认） */
export function promptWavForTimbre(timbre: 'default' | 'dark'): string {
  if (timbre === 'dark' && fs.existsSync(DARK_PROMPT_WAV)) return DARK_PROMPT_WAV;
  return DEFAULT_PROMPT_WAV;
}

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
  /** 情绪强度 0~1（来自情感引擎）：决定温和档/强化档指令与语速偏移幅度 */
  intensity?: number | null;
  /**
   * v1.9 状态驱动的发声结果（由 `resolveVocalPerformance` 从**完整状态**算出）。
   * 传了它就用它（含音色选择）；没传则退回"情绪标签 + 强度"的老行为。
   */
  performance?: VocalPerformance;
  /** 覆盖参考音路径（默认 server/assets/voice_prompt.wav） */
  promptWav?: string;
  /** 覆盖服务地址（默认 COSYVOICE_URL） */
  serviceUrl?: string;
}

/** 组装一次合成的表单体（端点不同、字段名不同） */
function buildForm(
  endpoint: string,
  text: string,
  instruct: string,
  promptBuf: Buffer,
  speed: number,
): FormData {
  const form = new FormData();
  form.append('prompt_wav', new Blob([new Uint8Array(promptBuf)], { type: 'audio/wav' }), 'prompt.wav');
  if (endpoint === ENHANCED_ENDPOINT) {
    form.append('text', text);
    form.append('mode', 'instruct2');
    form.append('instruct_text', instruct);
    form.append('speed', String(speed));
  } else {
    form.append('tts_text', text);
    form.append('instruct_text', instruct);
  }
  return form;
}

/**
 * 调用 CosyVoice 本地服务合成语音。
 * @returns 带 WAV 头的音频 Buffer
 * @throws CosyVoiceUnavailableError 服务不可用 / 参考音缺失 / 超时
 */
export async function synthesizeCosyVoice(opts: CosyVoiceSynthesisOptions): Promise<Buffer> {
  const text = opts.text?.trim();
  if (!text) throw new CosyVoiceUnavailableError('empty text');

  const performance = opts.performance;
  // 参考音：显式指定 > 按音色提示选 > 默认
  const promptPath = opts.promptWav
    || (performance ? promptWavForTimbre(performance.timbre) : DEFAULT_PROMPT_WAV);
  if (!fs.existsSync(promptPath)) {
    throw new CosyVoiceUnavailableError(`参考音缺失: ${promptPath}（请把一段 3 秒清晰人声放到该路径，或设置 COSYVOICE_PROMPT_WAV）`);
  }

  const base = (opts.serviceUrl || COSYVOICE_URL).replace(/\/+$/, '');
  const instruct = performance ? performance.instruct : cosyVoiceInstruct(opts.emotion, opts.intensity);
  const speed = performance ? performance.speed : cosyVoiceSpeed(opts.emotion, opts.intensity);
  const promptBuf = fs.readFileSync(promptPath);

  // 已探明端点就直接用；否则先试增强端点，再回退官方端点
  const attempts: string[] = resolvedEndpoint
    ? [resolvedEndpoint]
    : [ENHANCED_ENDPOINT, OFFICIAL_ENDPOINT];

  let lastError: CosyVoiceUnavailableError | null = null;
  for (const endpoint of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        body: buildForm(endpoint, text, instruct, promptBuf, speed),
        signal: controller.signal,
      });
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? `合成超时(>${SYNTH_TIMEOUT_MS / 1000}s)` : (err?.message || '连接失败');
      lastError = new CosyVoiceUnavailableError(`CosyVoice 服务不可用（${base}）：${reason}`);
      break; // 连不上服务，换端点也没意义
    } finally {
      clearTimeout(timer);
    }

    // 404/405 = 这个服务没有该端点（例如跑的是官方 server）→ 换下一个
    if ((resp.status === 404 || resp.status === 405) && endpoint !== OFFICIAL_ENDPOINT) {
      lastError = new CosyVoiceUnavailableError(`CosyVoice 无 ${endpoint} 端点（HTTP ${resp.status}）`);
      continue;
    }
    if (!resp.ok) {
      lastError = new CosyVoiceUnavailableError(`CosyVoice 返回 HTTP ${resp.status}`);
      break;
    }

    const pcm = Buffer.from(await resp.arrayBuffer());
    if (pcm.length < 1000) {
      lastError = new CosyVoiceUnavailableError(`CosyVoice 返回音频过短（${pcm.length} 字节）`);
      break;
    }
    resolvedEndpoint = endpoint;
    return pcmToWav(pcm);
  }

  throw lastError ?? new CosyVoiceUnavailableError('CosyVoice 合成失败');
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.11 句内状态弧线：逐段合成 + 后段以前段音频为参考音
//
// 依据（v1.10 接缝工程，emo14，用户听感确认 D 更自然）：
//   · 后段拿**前段音频**当 prompt_wav：`frontend_instruct2` 保留了
//     `flow_prompt_speech_token` / `prompt_speech_feat`，所以后段的 flow/声码器
//     是从前段结尾的 mel 接着走的 → 接缝 MFCC 比值 1.28→0.94、逗号停顿 358→662ms
//     （天然 818ms）。用户听感："A 两者感情衔接的 gap 有点大；D 比较自然"。
//   · **不伪造间隙**：只 trim 最外侧静音，段与段之间的停顿交给模型自己产生。
//   · 音色**只由第一段决定**：链式参考音会让后段继承前段音色，
//     所以若让后段换参考音是无效的（且会在句中出现音色断层）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 段与段之间的间隙（ms）。
 *
 * ⚠️ 这个值是**实测标定**出来的，不是拍的：
 *   · 整句一次生成时，模型在逗号处的天然停顿 ≈ 760~818ms（emo14/emo15 实测）
 *   · 但**单独生成一个小句**时，它只贡献 ≈270ms 的边界静音（看不到后文，不会拖长）
 *   · 所以必须由我们补足差额，否则成品逗号处明显偏赶 ——
 *     实测第一版补 220ms 时总停顿仅 317ms，而用户认可的 D_chain 是 662ms（他挑中的那条 980ms）。
 * 取 450ms：加上模型自身的 ~270ms ≈ 720ms，与天然停顿同量级。
 */
const ARC_MIN_GAP_MS = Number(process.env.COSYVOICE_ARC_MIN_GAP_MS || 450);

export interface ArcSegment {
  text: string;
  performance: VocalPerformance;
}

export interface CosyVoiceArcOptions {
  segments: ArcSegment[];
  /** 覆盖参考音路径（默认按第一段的音色提示选） */
  promptWav?: string;
  serviceUrl?: string;
}

/** 找出有声区间的边界（含一点余量），供"只掐头/只掐尾/两头都掐"复用 */
function edgeBounds(pcm: Float32Array, sampleRate: number): { lo: number; hi: number } {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak <= 0) return { lo: 0, hi: pcm.length };
  const thresh = peak * 0.005;                     // ≈ −46dB，与调参脚本一致
  const frameLoud = (start: number): boolean => {
    let m = 0;
    for (let i = start; i < Math.min(start + win, pcm.length); i++) m = Math.max(m, Math.abs(pcm[i]));
    return m > thresh;
  };
  let lo = 0;
  let hi = pcm.length;
  while (lo < hi && !frameLoud(lo)) lo += win;
  while (hi > lo && !frameLoud(Math.max(0, hi - win))) hi -= win;
  const margin = Math.round(sampleRate * 0.04);     // 留 40ms，避免切掉音节自然衰减
  return { lo: Math.max(0, lo - margin), hi: Math.min(pcm.length, hi + margin) };
}

/** 掐掉首尾静音（只 trim 最外侧时用） */
function trimEdges(pcm: Float32Array, sampleRate: number): Float32Array {
  const { lo, hi } = edgeBounds(pcm, sampleRate);
  return pcm.slice(lo, hi);
}

/** 只掐头，保留尾部静音（首段用：逗号前的拖尾/停顿要留着） */
function trimHeadOnly(pcm: Float32Array, sampleRate: number): Float32Array {
  return pcm.slice(edgeBounds(pcm, sampleRate).lo);
}

/** 只掐尾，保留头部静音（末段用） */
function trimTailOnly(pcm: Float32Array, sampleRate: number): Float32Array {
  return pcm.slice(0, edgeBounds(pcm, sampleRate).hi);
}

/** raw PCM(int16 LE) → Float32 */
function pcmToFloat(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** Float32 → raw PCM(int16 LE) */
function floatToPcm(x: Float32Array): Buffer {
  const buf = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]));
    buf.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return buf;
}

/**
 * 逐段合成并拼成一段音频（句内状态弧线）。
 *
 * 第 1 段用情绪参考音；第 k(>1) 段用**第 k-1 段的音频**当参考音（flow 侧延续）。
 * 只 trim 最外侧静音；段间停顿取"模型自身停顿"，不足 ARC_MIN_GAP_MS 时补到该值。
 *
 * @throws CosyVoiceUnavailableError 任一段失败（调用方应回退到单次整句合成）
 */
export async function synthesizeCosyVoiceArc(opts: CosyVoiceArcOptions): Promise<Buffer> {
  const segments = (opts.segments || []).filter(s => s.text?.trim());
  if (segments.length === 0) throw new CosyVoiceUnavailableError('arc: no segments');
  if (segments.length === 1) {
    return synthesizeCosyVoice({
      text: segments[0].text,
      performance: segments[0].performance,
      promptWav: opts.promptWav,
      serviceUrl: opts.serviceUrl,
    });
  }

  const base = (opts.serviceUrl || COSYVOICE_URL).replace(/\/+$/, '');
  const refPaths: string[] = [];
  const tmp: string[] = [];
  try {
    const pieces: Float32Array[] = [];
    let promptPath = opts.promptWav || promptWavForTimbre(segments[0].performance.timbre);
    if (!fs.existsSync(promptPath)) {
      throw new CosyVoiceUnavailableError(`参考音缺失: ${promptPath}`);
    }

    for (let i = 0; i < segments.length; i++) {
      const raw = await postInstruct2(base, segments[i].text.trim(), segments[i].performance, promptPath);
      pieces.push(pcmToFloat(raw));
      if (i < segments.length - 1) {
        // 把本段音频落盘，作为下一段的参考音（flow 侧延续）
        const p = path.join(os.tmpdir(), `cv-arc-${process.pid}-${Date.now()}-${i}.wav`);
        fs.writeFileSync(p, pcmToWav(floatToPcm(pieces[i])));
        tmp.push(p);
        promptPath = p;
      }
    }
    refPaths.push(...tmp);

    // 拼接：**只 trim 最外侧**（首段的头、末段的尾），内侧静音一律保留 ——
    // 段与段之间的逗号停顿交给模型自己产生（用户认可的版本就是这么长的）。
    const merged: number[] = [];
    const gapSamples = Math.round(COSYVOICE_SAMPLE_RATE * ARC_MIN_GAP_MS / 1000);
    for (let i = 0; i < pieces.length; i++) {
      const isFirst = i === 0;
      const isLast = i === pieces.length - 1;
      let seg = pieces[i];
      if (isFirst && isLast) {
        seg = trimEdges(seg, COSYVOICE_SAMPLE_RATE);
      } else if (isFirst) {
        seg = trimHeadOnly(seg, COSYVOICE_SAMPLE_RATE);   // 首段：留着尾部（逗号前的停顿）
      } else if (isLast) {
        seg = trimTailOnly(seg, COSYVOICE_SAMPLE_RATE);   // 末段：留着头部
      }
      // 中间段（>2 段时）原样保留：内侧静音就是模型自己的气口
      for (let k = 0; k < seg.length; k++) merged.push(seg[k]);
      if (!isLast) for (let k = 0; k < gapSamples; k++) merged.push(0);
    }
    const out = new Float32Array(merged.length);
    out.set(merged);
    return pcmToWav(floatToPcm(out));
  } finally {
    for (const p of tmp) { try { fs.unlinkSync(p); } catch { /* 清理失败不影响结果 */ } }
  }
}

/** 单段 instruct2 请求（供弧线复用），返回 raw PCM */
async function postInstruct2(
  base: string,
  text: string,
  performance: VocalPerformance,
  promptBufPath: string,
): Promise<Buffer> {
  const promptBuf = fs.readFileSync(promptBufPath);
  const attempts: string[] = resolvedEndpoint ? [resolvedEndpoint] : [ENHANCED_ENDPOINT, OFFICIAL_ENDPOINT];
  let lastError: CosyVoiceUnavailableError | null = null;
  for (const endpoint of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SYNTH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        body: buildForm(endpoint, text, performance.instruct, promptBuf, performance.speed),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      const reason = err?.name === 'AbortError' ? `合成超时(>${SYNTH_TIMEOUT_MS / 1000}s)` : (err?.message || '连接失败');
      throw new CosyVoiceUnavailableError(`CosyVoice 服务不可用（${base}）：${reason}`);
    }
    clearTimeout(timer);
    if ((resp.status === 404 || resp.status === 405) && endpoint !== OFFICIAL_ENDPOINT) {
      lastError = new CosyVoiceUnavailableError(`CosyVoice 无 ${endpoint} 端点（HTTP ${resp.status}）`);
      continue;
    }
    if (!resp.ok) throw new CosyVoiceUnavailableError(`CosyVoice 返回 HTTP ${resp.status}`);
    const pcm = Buffer.from(await resp.arrayBuffer());
    if (pcm.length < 1000) throw new CosyVoiceUnavailableError(`CosyVoice 返回音频过短（${pcm.length} 字节）`);
    resolvedEndpoint = endpoint;
    return pcm;
  }
  throw lastError ?? new CosyVoiceUnavailableError('CosyVoice 合成失败');
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
