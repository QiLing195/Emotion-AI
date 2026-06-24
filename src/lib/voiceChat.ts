// ponytail: 实时语音聊天 — continuous STT + VAD + auto turn-taking

type VoiceChatCallback = (text: string, isFinal: boolean) => void;

let recognition: any = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSpeechTime = 0;
let accumulatedText = '';

const SILENCE_THRESHOLD_MS = 1500; // 停顿 1.5 秒视为说完
const MAX_ACCUMULATE_MS = 10000;    // 最多累积 10 秒

export function startVoiceChat(
  onSpeech: VoiceChatCallback,
  onStatus?: (status: 'listening' | 'processing' | 'silence' | 'error', msg?: string) => void
): boolean {
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onStatus?.('error', '浏览器不支持语音识别');
    return false;
  }

  stopVoiceChat();

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;   // 实时中间结果
  recognition.maxAlternatives = 1;
  recognition.continuous = true;        // 持续监听

  accumulatedText = '';

  recognition.onresult = (event: any) => {
    lastSpeechTime = Date.now();
    clearSilenceTimer();

    let interim = '';
    let final = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        final += result[0]?.transcript || '';
      } else {
        interim += result[0]?.transcript || '';
      }
    }

    if (final) {
      accumulatedText += final;
      onSpeech(accumulatedText.trim(), true);
      accumulatedText = '';
      onStatus?.('processing', '思考中...');
    } else if (interim) {
      const display = accumulatedText + interim;
      onSpeech(display.trim(), false);
      onStatus?.('listening', '聆听中...');

      // 重置静默计时器
      startSilenceTimer(onSpeech, onStatus);
    }
  };

  recognition.onerror = (event: any) => {
    if (event.error === 'no-speech') {
      onStatus?.('silence', '等待说话...');
      return;
    }
    if (event.error === 'aborted') return;
    console.warn('[VoiceChat] error:', event.error);
    onStatus?.('error', event.error);

    // 自动重连
    setTimeout(() => {
      try { recognition?.start(); } catch {}
    }, 500);
  };

  recognition.onend = () => {
    // 非主动停止 → 自动重启
    if (recognition) {
      try { recognition.start(); } catch {}
    }
  };

  recognition.start();
  onStatus?.('silence', '等待说话...');
  return true;
}

function startSilenceTimer(onSpeech: VoiceChatCallback, onStatus?: any) {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (accumulatedText.trim()) {
      onSpeech(accumulatedText.trim(), true);
      accumulatedText = '';
      onStatus?.('processing', '思考中...');
    }
    onStatus?.('silence', '等待说话...');
  }, SILENCE_THRESHOLD_MS);
}

function clearSilenceTimer() {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

export function stopVoiceChat(): void {
  clearSilenceTimer();
  if (recognition) {
    try { recognition.abort(); } catch {}
    recognition = null;
  }
  accumulatedText = '';
}

export function isVoiceChatSupported(): boolean {
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}
