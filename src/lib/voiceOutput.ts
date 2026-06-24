// ponytail: 浏览器语音输出 — SpeechSynthesis API，零依赖

let speaking = false;
let pendingQueue: string[] = [];

function findChineseVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  // 优先中文女声
  const preferred = voices.find(v =>
    v.lang.startsWith('zh') && v.name.includes('Xiaoxiao'));
  if (preferred) return preferred;
  // 任意中文女声
  const female = voices.find(v =>
    v.lang.startsWith('zh') && /女|female|girl/i.test(v.name));
  if (female) return female;
  // 任意中文
  return voices.find(v => v.lang.startsWith('zh')) || null;
}

export function speakText(text: string, autoPlay = false): void {
  if (!autoPlay) return;

  // 清理文本中的 markdown 和 emoji
  const clean = text
    .replace(/[*_~`#\[\]()]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return;

  if (speaking) {
    pendingQueue.push(clean);
    return;
  }

  doSpeak(clean);
}

function doSpeak(text: string): void {
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findChineseVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.0;
  utterance.pitch = 1.1;
  utterance.volume = 1.0;

  speaking = true;

  utterance.onend = () => {
    speaking = false;
    if (pendingQueue.length > 0) {
      const next = pendingQueue.shift()!;
      doSpeak(next);
    }
  };

  utterance.onerror = () => {
    speaking = false;
    pendingQueue = [];
  };

  speechSynthesis.cancel(); // 打断当前播放
  speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  speechSynthesis.cancel();
  speaking = false;
  pendingQueue = [];
}

export function isSpeaking(): boolean {
  return speaking;
}

// 预加载语音列表（Chrome 需要异步获取）
export function initVoiceOutput(): void {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => {
    speechSynthesis.getVoices();
  };
}
