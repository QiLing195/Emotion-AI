// ponytail: 媒体面板 — 摄像头预览 + 音频控制 + AI视觉
import React, { useEffect, useState, useCallback } from 'react';
import { startVoiceInput, stopVoiceInput, isVoiceSupported } from '../lib/voiceInput';
import { startVoiceChat, stopVoiceChat } from '../lib/voiceChat';
import { stopSpeaking, initVoiceOutput } from '../lib/voiceOutput';

interface Props {
  voiceOn: boolean;
  onVoiceToggle: (on: boolean) => void;
  onSpeechResult: (text: string, autoSend?: boolean) => void;
}

type CamStatus = 'off' | 'loading' | 'on' | 'error';
type VoiceMode = 'push' | 'chat';
type ChatStatus = 'idle' | 'silence' | 'listening' | 'processing' | 'error';

export default function MediaPanel({ voiceOn, onVoiceToggle, onSpeechResult }: Props) {
  const [cameraStatus, setCameraStatus] = useState<CamStatus>('off');
  const [camError, setCamError] = useState('');
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('push');
  const [listening, setListening] = useState(false);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle');
  const [chatText, setChatText] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const streamRef = React.useRef<MediaStream | null>(null);

  // ── AI 视觉 ──
  const [visionResult, setVisionResult] = useState('');
  const [visionLoading, setVisionLoading] = useState(false);

  const voiceSupported = isVoiceSupported();
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => { initVoiceOutput(); return () => { stopVoiceChat(); }; }, []);

  // callback ref for video
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && streamRef.current) node.srcObject = streamRef.current;
  }, []);

  useEffect(() => {
    if (cameraStatus === 'on' && streamRef.current) {
      const el = document.querySelector('#media-panel-cam') as HTMLVideoElement | null;
      if (el && !el.srcObject) el.srcObject = streamRef.current;
    }
  }, [cameraStatus]);

  // ── 摄像头 ──
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('需要 HTTPS 或 localhost'); setCameraStatus('error'); return;
    }
    setCameraStatus('loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      streamRef.current = stream;
      setCameraStatus('on'); setCamError('');
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError') setCamError('权限被拒绝');
      else if (name === 'NotFoundError') setCamError('未检测到摄像头');
      else setCamError('摄像头错误');
      setCameraStatus('error');
    }
  };
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setCameraStatus('off'); setCamError('');
  };

  // ── AI 视觉 ──
  const captureAndAnalyze = async () => {
    if (cameraStatus !== 'on') return;
    setVisionLoading(true); setVisionResult('');
    try {
      const video = document.querySelector('#media-panel-cam') as HTMLVideoElement;
      if (!video) throw new Error('no video');
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();
      setVisionResult(data.description || data.error || '分析失败');
    } catch (err: any) {
      setVisionResult('截图失败');
    }
    setVisionLoading(false);
  };

  // ── 语音聊天模式 ──
  const startChatMode = () => {
    if (!isSecure) { setVoiceError('需要 HTTPS'); return; }
    setVoiceError('');
    setChatText('');
    const ok = startVoiceChat(
      (text, isFinal) => {
        setChatText(text);
        if (isFinal && text) {
          onSpeechResult(text, true); // auto-send
          setChatText('');
        }
      },
      (status, msg) => {
        setChatStatus(status as ChatStatus);
        if (status === 'error') setVoiceError(msg || '语音错误');
      }
    );
    if (ok) setListening(true);
    else setVoiceError('启动失败');
  };

  const stopChatMode = () => {
    stopVoiceChat();
    setListening(false);
    setChatText('');
    setChatStatus('idle');
  };

  // ── 按钮模式 ──
  const handlePushMic = () => {
    if (listening) { stopVoiceInput(); setListening(false); return; }
    if (!isSecure) { setVoiceError('需要 HTTPS'); return; }
    setVoiceError('');
    setListening(true);
    startVoiceInput(
      (text) => { if (text) onSpeechResult(text, true); setListening(false); },
      () => setListening(false)
    );
  };

  const statusDots: Record<ChatStatus, string> = {
    idle: '⚪', silence: '🟢', listening: '🔴', processing: '🟡', error: '⚫'
  };

  return (
    <div className="h-full flex flex-col bg-[#0d0d1a] border-l border-[#1e1e2e] text-white">
      {/* ── 摄像头 ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-0 gap-3">
        <div className="text-xs text-[#555] uppercase tracking-wider">摄像头</div>
        <div className="relative w-full aspect-[4/5] max-h-full bg-[#111122] rounded-xl overflow-hidden border border-[#2a2a3e] flex items-center justify-center">
          {cameraStatus === 'on' ? (
            <video id="media-panel-cam" ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : cameraStatus === 'loading' ? (
            <div className="text-center text-[#666]"><div className="animate-spin text-2xl mb-2">⏳</div></div>
          ) : (
            <div className="text-center p-4">
              <div className="text-3xl mb-2">{cameraStatus === 'error' ? '⚠️' : '📷'}</div>
              <div className={`text-xs ${cameraStatus === 'error' ? 'text-amber-400' : 'text-[#555]'}`}>
                {cameraStatus === 'error' ? camError : '摄像头未开启'}
              </div>
            </div>
          )}
        </div>

        <button onClick={cameraStatus === 'on' ? stopCamera : startCamera} disabled={cameraStatus === 'loading'}
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
            cameraStatus === 'on' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
            cameraStatus === 'loading' ? 'bg-[#222] text-[#555]' :
            'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
          }`}>
          {cameraStatus === 'on' ? '关闭摄像头' : cameraStatus === 'loading' ? '启动中...' : '开启摄像头'}
        </button>

        {cameraStatus === 'on' && (
          <>
            <button onClick={captureAndAnalyze} disabled={visionLoading}
              className="w-full py-2 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all disabled:opacity-50">
              {visionLoading ? '⏳ 分析中...' : '👁️ 让 AI 看看我'}
            </button>
            {visionResult && (
              <div className="w-full text-xs text-[#aaa] bg-[#111122] rounded-lg px-3 py-2 border border-[#2a2a3e]">
                <span className="text-emerald-400">看到：</span>{visionResult}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 音频控制 ── */}
      <div className="p-4 border-t border-[#1e1e2e] bg-[#0a0a16] space-y-3">
        <div className="text-xs text-[#666] uppercase tracking-wider text-center">音频控制</div>

        {!isSecure && (
          <div className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 text-center">需要 HTTPS</div>
        )}

        {/* 语音朗读 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#aaa]">语音朗读</span>
          <button onClick={() => { onVoiceToggle(!voiceOn); if (voiceOn) stopSpeaking(); }}
            className={`w-12 h-6 rounded-full transition-all relative ${voiceOn ? 'bg-rose-500' : 'bg-[#333]'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${voiceOn ? 'left-6' : 'left-0.5'}`} />
          </button>
        </div>

        {/* 模式切换 */}
        <div className="flex rounded-lg overflow-hidden border border-[#333]">
          <button onClick={() => { stopChatMode(); setVoiceMode('push'); }}
            className={`flex-1 py-1.5 text-xs font-medium transition-all ${voiceMode === 'push' ? 'bg-[#1a1a2e] text-white' : 'text-[#555]'}`}>
            按键说话
          </button>
          <button onClick={() => { setVoiceMode('chat'); }}
            className={`flex-1 py-1.5 text-xs font-medium transition-all ${voiceMode === 'chat' ? 'bg-[#1a1a2e] text-white' : 'text-[#555]'}`}>
            语音聊天
          </button>
        </div>

        {/* 按键说话模式 */}
        {voiceMode === 'push' && (
          <button onClick={handlePushMic} disabled={!voiceOn || !isSecure}
            className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
              listening ? 'bg-red-500 text-white animate-pulse' :
              voiceOn && isSecure ? 'bg-[#1a1a2e] text-[#ccc] border border-[#333] hover:border-rose-500/50' :
              'bg-[#111] text-[#555] cursor-not-allowed'
            }`}>
            {listening ? '🎤 聆听中...' : '🎤 按住说话'}
          </button>
        )}

        {/* 语音聊天模式 */}
        {voiceMode === 'chat' && (
          <div className="space-y-2">
            {!listening ? (
              <button onClick={startChatMode} disabled={!voiceOn || !isSecure}
                className="w-full py-3 rounded-xl text-sm font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 transition-all">
                🎧 开始语音聊天
              </button>
            ) : (
              <>
                {/* 状态指示 */}
                <div className="flex items-center justify-between bg-[#111122] rounded-lg px-3 py-2 border border-[#2a2a3e]">
                  <span className="text-xs text-[#aaa]">{statusDots[chatStatus]} {
                    chatStatus === 'silence' ? '等待说话...' :
                    chatStatus === 'listening' ? '正在聆听' :
                    chatStatus === 'processing' ? 'AI 思考中' :
                    chatStatus === 'error' ? '出错了' : '就绪'
                  }</span>
                  <span className="text-[10px] text-[#555]">连续对话</span>
                </div>

                {/* 实时转写 */}
                {chatText && (
                  <div className="text-xs text-[#ccc] bg-[#111122] rounded-lg px-3 py-2 border border-[#2a2a3e] min-h-[2rem]">
                    {chatText}<span className="animate-pulse text-rose-400">|</span>
                  </div>
                )}

                <button onClick={stopChatMode}
                  className="w-full py-2 rounded-xl text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-all">
                  结束语音聊天
                </button>
              </>
            )}
          </div>
        )}

        {voiceError && <div className="text-xs text-red-400 text-center">{voiceError}</div>}
      </div>
    </div>
  );
}
