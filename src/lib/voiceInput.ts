// ponytail: 浏览器语音输入 — SpeechRecognition API，零依赖

type VoiceCallback = (text: string) => void;

let recognition: any = null;

export function startVoiceInput(onResult: VoiceCallback, onEnd?: () => void): boolean {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Voice] SpeechRecognition not supported');
    return false;
  }

  if (recognition) {
    recognition.abort();
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event: any) => {
    const text = event.results[0]?.[0]?.transcript?.trim();
    if (text) onResult(text);
  };

  recognition.onerror = (event: any) => {
    console.warn('[Voice] recognition error:', event.error);
    if (event.error === 'no-speech') return; // 静默忽略
    recognition = null;
  };

  recognition.onend = () => {
    recognition = null;
    onEnd?.();
  };

  recognition.start();
  return true;
}

export function stopVoiceInput(): void {
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
}

export function isVoiceSupported(): boolean {
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}
