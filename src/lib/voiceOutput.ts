// ponytail: 语音输出 — 优先服务端 Edge TTS，fallback 浏览器 SpeechSynthesis

let speaking = false;
let pendingQueue: string[] = [];
let audioEl: HTMLAudioElement | null = null;

// ── 服务端 TTS（Edge 情感语音）──
async function speakViaServer(text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: 'zh-CN-XiaoxiaoNeural' }),
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

// ── 浏览器 TTS（fallback）──
function speakViaBrowser(text: string): void {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang.startsWith('zh') && /Xiao|Yun|女/.test(v.name))
    || voices.find(v => v.lang.startsWith('zh'))
    || null;
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  utterance.pitch = 1.05;
  utterance.volume = 1.0;

  utterance.onend = () => { speaking = false; playNext(); };
  utterance.onerror = () => { speaking = false; pendingQueue = []; };

  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function playNext(): void {
  if (pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    doSpeak(next);
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

async function doSpeak(text: string): Promise<void> {
  if (!text) return;
  speaking = true;

  // 优先服务端 TTS（有情感的 Xiaoxiao 语音）
  const ok = await speakViaServer(text);
  if (!ok) {
    // fallback 浏览器原生 TTS
    speakViaBrowser(text);
  }
}

export function speakText(text: string, autoPlay = false): void {
  if (!autoPlay) return;

  const clean = cleanText(text);
  if (!clean) return;

  if (speaking) {
    pendingQueue.push(clean);
    return;
  }

  doSpeak(clean);
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
