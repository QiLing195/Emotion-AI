// ponytail: 浏览器语音输出 — SpeechSynthesis API，零依赖

let speaking = false;
let pendingQueue: string[] = [];

// 优先有情感的中文女声（按表现力排序）
const VOICE_PREFERENCE = [
  'Xiaoxiao',   // Edge: 活泼少女 — 最有情感表现力
  'Xiaoyi',     // Edge: 温柔姐姐
  'Xiaochen',   // Edge: 沉静女声
  'Yunxi',      // Edge: 青年男声
  'Yunyang',    // Edge: 专业男声
];

function findBestVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();

  // 1. 优先匹配偏好列表中的语音（Edge 自然语音，有情感）
  for (const pref of VOICE_PREFERENCE) {
    const match = voices.find(v =>
      v.lang.startsWith('zh') && v.name.includes(pref));
    if (match) return match;
  }

  // 2. 任意中文女声
  const female = voices.find(v =>
    v.lang.startsWith('zh') && /女|female|girl|Xiao|Yun/.test(v.name));
  if (female) return female;

  // 3. 任意中文
  return voices.find(v => v.lang.startsWith('zh')) || null;
}

// 移除括号内容（中英文括号）、markdown、emoji
function cleanText(text: string): string {
  return text
    .replace(/[（(][^）)]*[）)]/g, '')   // 去掉括号及内容
    .replace(/[*_~`#\[\]]/g, '')         // markdown 符号
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '') // emoji
    .replace(/\s+/g, ' ')
    .trim();
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

function doSpeak(text: string): void {
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findBestVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;    // 稍慢一点，更有感情
  utterance.pitch = 1.05;
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

  speechSynthesis.cancel();
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

export function initVoiceOutput(): void {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => {
    speechSynthesis.getVoices();
  };
}
