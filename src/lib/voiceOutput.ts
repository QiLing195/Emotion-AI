// ponytail: 语音输出 — 服务端 TTS（edge-tts / CosyVoice2 本地情感），fallback 浏览器 SpeechSynthesis
// v1.4: 语音随情绪变化（tone：rate/pitch/volume），情绪值来自 voiceTone 白名单
// v1.5: 支持 provider 选择（cosyvoice = 本地情感 TTS，服务不可用自动回退浏览器）

import { resolveEmotionTone, browserSpeechParams, type VoiceEmotion } from './voiceTone';

export interface SpeakOptions {
  /** 'cosyvoice' 走本地情感 TTS；'browser' 直接用浏览器语音；其它/缺省走服务端 edge-tts */
  provider?: string;
}

let speaking = false;
let pendingQueue: Array<{ text: string; emotion?: VoiceEmotion; provider?: string }> = [];
let audioEl: HTMLAudioElement | null = null;

// ── 服务端 TTS（edge-tts 韵律 / CosyVoice 情感，均随情绪）──
async function speakViaServer(text: string, emotion?: VoiceEmotion, provider?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: 'zh-CN-XiaoxiaoNeural',
        emotion: emotion ?? 'neutral',
        provider: provider === 'cosyvoice' ? 'cosyvoice' : undefined,
      }),
    });
    if (!res.ok) return false;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (audioEl) {
      audioEl.pause();
      URL.revokeObjectURL(audioEl.src);
    }

    audioEl = new Audio(url);
    audioEl.onended = () => {
      speaking = false;
      URL.revokeObjectURL(url);
      audioEl = null;
      playNext();
    };
    audioEl.onerror = () => {
      speaking = false;
      URL.revokeObjectURL(url);
      audioEl = null;
    };

    await audioEl.play();
    return true;
  } catch {
    return false;
  }
}

// ── 浏览器 TTS（fallback，用 tone 折算 rate/pitch/volume）──
function speakViaBrowser(text: string, emotion?: VoiceEmotion): void {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith('zh') && /Xiao|Yun|女/.test(v.name))
    || voices.find(v => v.lang.startsWith('zh'))
    || null;
  if (voice) utterance.voice = voice;
  const params = browserSpeechParams(resolveEmotionTone(emotion));
  utterance.rate = params.rate;
  utterance.pitch = params.pitch;
  utterance.volume = params.volume;

  utterance.onend = () => { speaking = false; playNext(); };
  utterance.onerror = () => { speaking = false; pendingQueue = []; };

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function playNext(): void {
  if (pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    void doSpeak(next.text, next.emotion, next.provider);
  }
}

function cleanText(text: string): string {
  return text
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[*_~`#\[\]]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function doSpeak(text: string, emotion?: VoiceEmotion, provider?: string): Promise<void> {
  if (!text) return;
  speaking = true;

  // 显式选择浏览器语音 → 直接走本地合成，不请求服务端
  if (provider === 'browser') {
    speakViaBrowser(text, emotion);
    return;
  }

  // 服务端（cosyvoice 本地情感 / edge-tts）→ 失败回退浏览器
  const ok = await speakViaServer(text, emotion, provider);
  if (!ok) {
    speakViaBrowser(text, emotion);
  }
}

export function speakText(
  text: string,
  autoPlay = false,
  emotion?: VoiceEmotion,
  opts?: SpeakOptions,
): void {
  if (!autoPlay) return;

  const clean = cleanText(text);
  if (!clean) return;

  if (speaking) {
    pendingQueue.push({ text: clean, emotion, provider: opts?.provider });
    return;
  }

  void doSpeak(clean, emotion, opts?.provider);
}

export function stopSpeaking(): void {
  if (audioEl) {
    audioEl.pause();
    URL.revokeObjectURL(audioEl.src);
    audioEl = null;
  }
  speechSynthesis.cancel();
  speaking = false;
  pendingQueue = [];
}

export function initVoiceOutput(): void {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}
