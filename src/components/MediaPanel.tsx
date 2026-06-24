// ponytail: 媒体面板 — 摄像头预览 + 音频控制
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { startVoiceInput, stopVoiceInput, isVoiceSupported } from '../lib/voiceInput';
import { stopSpeaking, initVoiceOutput } from '../lib/voiceOutput';

interface Props {
  voiceOn: boolean;
  onVoiceToggle: (on: boolean) => void;
  onSpeechResult: (text: string) => void;
}

type CamStatus = 'off' | 'loading' | 'on' | 'error';

export default function MediaPanel({ voiceOn, onVoiceToggle, onSpeechResult }: Props) {
  const [cameraStatus, setCameraStatus] = useState<CamStatus>('off');
  const [camError, setCamError] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);

  // 用 callback ref 确保 video 元素挂载后立即绑定流
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
    }
  }, []);

  const voiceSupported = isVoiceSupported();
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  useEffect(() => { initVoiceOutput(); }, []);

  // 摄像头状态变为 'on' 后，确保已挂载的 video 绑定了流
  useEffect(() => {
    if (cameraStatus === 'on' && streamRef.current) {
      // 通过 querySelector 找到 video 元素（兜底 callback ref）
      const el = document.querySelector('#media-panel-cam') as HTMLVideoElement | null;
      if (el && !el.srcObject) {
        el.srcObject = streamRef.current;
      }
    }
  }, [cameraStatus]);

  // ── 摄像头 ──
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('浏览器不支持摄像头（需要 HTTPS 或 localhost）');
      setCameraStatus('error');
      return;
    }
    setCameraStatus('loading');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      streamRef.current = stream;
      setCameraStatus('on');
      setCamError('');
    } catch (err: any) {
      const name = err?.name || '';
      if (name === 'NotAllowedError') setCamError('摄像头权限被拒绝，请在浏览器设置中允许');
      else if (name === 'NotFoundError') setCamError('未检测到摄像头设备');
      else if (name === 'NotReadableError') setCamError('摄像头被其他应用占用');
      else setCamError(`摄像头错误: ${err?.message || '未知'}`);
      setCameraStatus('error');
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraStatus('off');
    setCamError('');
  };

  useEffect(() => () => stopCamera(), []);

  // ── AI 视觉：拍照让 AI 看到画面 ──
  const [visionResult, setVisionResult] = useState('');
  const [visionLoading, setVisionLoading] = useState(false);

  const captureAndAnalyze = async () => {
    if (cameraStatus !== 'on' || !streamRef.current) return;
    setVisionLoading(true);
    setVisionResult('');

    try {
      // 从 video 截取一帧
      const video = document.querySelector('#media-panel-cam') as HTMLVideoElement;
      if (!video) throw new Error('no video');

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no context');
      ctx.drawImage(video, 0, 0);

      const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      const res = await fetch('/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType: 'image/jpeg' }),
      });
      const data = await res.json();
      if (data.description) {
        setVisionResult(data.description);
      } else {
        setVisionResult('分析失败: ' + (data.error || 'unknown'));
      }
    } catch (err: any) {
      setVisionResult('截图失败: ' + (err?.message || 'error'));
    }
    setVisionLoading(false);
  };

  // ── 语音输入 ──
  const handleMic = () => {
    if (!isSecure) {
      setVoiceError('语音需要 HTTPS 连接');
      return;
    }
    if (!voiceSupported) {
      setVoiceError('浏览器不支持语音识别（请用 Chrome/Edge）');
      return;
    }
    setVoiceError('');

    if (listening) {
      stopVoiceInput();
      setListening(false);
      return;
    }
    setListening(true);
    const ok = startVoiceInput(
      (text) => {
        if (text) {
          onSpeechResult(text);
          setVoiceError('');
        }
        setListening(false);
      },
      () => setListening(false)
    );
    if (!ok) {
      setListening(false);
      setVoiceError('语音识别启动失败');
    }
  };

  // ── 渲染 ──
  return (
    <div className="h-full flex flex-col bg-[#0d0d1a] border-l border-[#1e1e2e] text-white">
      {/* ── 摄像头区域 — 上半部分 ── */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 min-h-0 gap-3">
        <div className="text-xs text-[#555] uppercase tracking-wider">摄像头</div>

        <div className="relative w-full aspect-[4/5] max-h-full bg-[#111122] rounded-xl overflow-hidden border border-[#2a2a3e] flex items-center justify-center">
          {cameraStatus === 'on' ? (
            <video
              id="media-panel-cam"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : cameraStatus === 'loading' ? (
            <div className="text-center text-[#666]">
              <div className="animate-spin text-2xl mb-2">⏳</div>
              <div className="text-xs">正在启动摄像头...</div>
            </div>
          ) : (
            <div className="text-center p-4">
              <div className="text-3xl mb-2">
                {cameraStatus === 'error' ? '⚠️' : '📷'}
              </div>
              <div className={`text-xs ${cameraStatus === 'error' ? 'text-amber-400' : 'text-[#555]'}`}>
                {cameraStatus === 'error' ? camError : '摄像头未开启'}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={cameraStatus === 'on' ? stopCamera : startCamera}
          disabled={cameraStatus === 'loading'}
          className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
            cameraStatus === 'on'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
              : cameraStatus === 'loading'
                ? 'bg-[#222] text-[#555] cursor-wait'
                : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30'
          }`}
        >
          {cameraStatus === 'on' ? '关闭摄像头' : cameraStatus === 'loading' ? '启动中...' : '开启摄像头'}
        </button>

        {/* AI 视觉按钮 */}
        {cameraStatus === 'on' && (
          <>
            <button
              onClick={captureAndAnalyze}
              disabled={visionLoading}
              className="w-full py-2 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all disabled:opacity-50"
            >
              {visionLoading ? '⏳ AI 正在看...' : '👁️ 让 AI 看看我在做什么'}
            </button>
            {visionResult && (
              <div className="w-full text-xs text-[#aaa] bg-[#111122] rounded-lg px-3 py-2 border border-[#2a2a3e]">
                <span className="text-emerald-400">AI 看到：</span>{visionResult}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 音频控制 — 下半部分 ── */}
      <div className="p-4 border-t border-[#1e1e2e] bg-[#0a0a16] space-y-3">
        <div className="text-xs text-[#666] uppercase tracking-wider text-center">音频控制</div>

        {!isSecure && (
          <div className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2 text-center">
            非安全连接 — 语音/摄像头需要 HTTPS
          </div>
        )}

        {/* 语音朗读开关 */}
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

        {voiceOn && (
          <div className="flex items-center gap-2 text-xs text-rose-400/80 bg-rose-400/5 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-pulse" />
            AI 回复将自动朗读
          </div>
        )}

        {/* 麦克风按钮 */}
        <button
          onClick={handleMic}
          disabled={!voiceOn || !isSecure}
          className={`w-full py-3 rounded-xl text-sm font-medium transition-all ${
            listening
              ? 'bg-red-500 text-white animate-pulse scale-[1.02]'
              : voiceOn && isSecure
                ? 'bg-[#1a1a2e] text-[#ccc] border border-[#333] hover:border-rose-500/50 hover:bg-[#222]'
                : 'bg-[#111] text-[#555] cursor-not-allowed'
          }`}
        >
          {listening ? '🎤 正在聆听...（点击停止）' : '🎤 语音输入'}
        </button>

        {voiceError && (
          <div className="text-xs text-red-400 text-center">{voiceError}</div>
        )}

        <div className="text-center text-[10px] text-[#555] space-y-0.5">
          {!voiceOn && <div>开启语音朗读后可使用麦克风</div>}
          {voiceOn && !listening && <div>点击麦克风开始说话</div>}
        </div>
      </div>
    </div>
  );
}
