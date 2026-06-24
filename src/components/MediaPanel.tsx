// ponytail: 媒体面板 — 摄像头预览 + 音频控制
import React, { useRef, useEffect, useState } from 'react';
import { startVoiceInput, stopVoiceInput, isVoiceSupported } from '../lib/voiceInput';
import { speakText, stopSpeaking, initVoiceOutput } from '../lib/voiceOutput';

interface Props {
  voiceOn: boolean;
  onVoiceToggle: (on: boolean) => void;
  onSpeechResult: (text: string) => void;
}

export default function MediaPanel({ voiceOn, onVoiceToggle, onSpeechResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [cameraErr, setCameraErr] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => { initVoiceOutput(); }, []);

  // 摄像头
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      setCameraErr('');
    } catch {
      setCameraErr('摄像头不可用');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  useEffect(() => () => stopCamera(), []);

  // 语音输入
  const handleMic = () => {
    if (listening) {
      stopVoiceInput();
      setListening(false);
      return;
    }
    setListening(true);
    startVoiceInput(
      (text) => { onSpeechResult(text); setListening(false); },
      () => setListening(false)
    );
  };

  const voiceSupported = isVoiceSupported();

  return (
    <div className="h-full flex flex-col bg-[#0d0d1a] border-l border-[#1e1e2e] text-white">
      {/* 摄像头区域 — 上半部分 */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 min-h-0">
        <div className="relative w-full aspect-[4/5] max-h-full bg-[#111122] rounded-xl overflow-hidden border border-[#2a2a3e] flex items-center justify-center">
          {cameraOn ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-[#555] p-4">
              <div className="text-3xl mb-2">📷</div>
              <div className="text-xs">{cameraErr || '摄像头未开启'}</div>
            </div>
          )}
        </div>
        <button
          onClick={cameraOn ? stopCamera : startCamera}
          className={`mt-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
            cameraOn
              ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
              : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
          }`}
        >
          {cameraOn ? '关闭摄像头' : '开启摄像头'}
        </button>
      </div>

      {/* 音频控制 — 下半部分 */}
      <div className="p-4 border-t border-[#1e1e2e] bg-[#0a0a16] space-y-3">
        <div className="text-xs text-[#666] uppercase tracking-wider text-center">音频控制</div>

        {/* 语音开关 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#aaa]">语音朗读</span>
          <button
            onClick={() => { onVoiceToggle(!voiceOn); if (voiceOn) stopSpeaking(); }}
            className={`w-12 h-6 rounded-full transition-all relative ${
              voiceOn ? 'bg-rose-500' : 'bg-[#333]'
            }`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
              voiceOn ? 'left-6' : 'left-0.5'
            }`} />
          </button>
        </div>

        {/* 麦克风按钮 */}
        {voiceSupported && (
          <button
            onClick={handleMic}
            disabled={!voiceOn}
            className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : voiceOn
                  ? 'bg-[#1a1a2e] text-[#ccc] border border-[#333] hover:border-rose-500/50'
                  : 'bg-[#111] text-[#555] cursor-not-allowed'
            }`}
          >
            {listening ? '🎤 正在聆听...' : '🎤 语音输入'}
          </button>
        )}

        {/* 状态提示 */}
        <div className="text-center text-[10px] text-[#555]">
          {voiceOn ? '语音模式已开启' : '点击上方开关启用语音'}
        </div>
      </div>
    </div>
  );
}
