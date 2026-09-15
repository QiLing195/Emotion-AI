import React, { useEffect, useRef, useState } from 'react';
import { useAIBrainStore, generateSystemPrompt, ChatMessage as ChatMessageType } from '../store/useAIBrainStore';
import { getDominantEmotion, getMicroPhase, getRelationshipStage, STAGE_LABELS } from '../lib/emotionEngine';
import { XIAONUAN_STAGE_LABELS, resolveLoverStage } from '../lib/xiaoNuanStages';
import { STAGE_LABELS_V2 } from '../lib/relationshipProgressionV2';
import { initVoiceOutput, speakText } from '../lib/voiceOutput';
import { dominantVoiceEmotion } from '../lib/voiceTone';

function MessageBubble({ msg }: { msg: ChatMessageType }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] px-4 py-3 text-sm leading-relaxed animate-fade-in-up ${
        isUser ? 'msg-user' : msg.role === 'system' ? 'bg-red-50 text-red-700 rounded-2xl' : 'msg-ai'
      }`}>
        {msg.content}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="msg-ai px-4 py-3">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 bg-rose-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2.5 h-2.5 bg-coral-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2.5 h-2.5 bg-rose-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

interface ChatViewProps {
  voiceOn: boolean;
  voiceText: string;
  onVoiceTextConsumed: () => void;
}

export default function ChatView({ voiceOn, voiceText, onVoiceTextConsumed }: ChatViewProps) {
  const chatMessages = useAIBrainStore(s => s.chatMessages);
  const addChatMessage = useAIBrainStore(s => s.addChatMessage);
  const persona = useAIBrainStore(s => s.persona);
  const settings = useAIBrainStore(s => s.settings);
  const setPersona = useAIBrainStore(s => s.setPersona);
  const setLastTurnInfo = useAIBrainStore(s => s.setLastTurnInfo);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const dominantEmotion = persona.emotionState ? getDominantEmotion(persona.emotionState.emotions) : null;
  const affinityScore = persona.affinityScore ?? 20;
  const relationshipStage = getRelationshipStage(affinityScore, persona.crisisState?.isCrisis ?? false);
  const displayStageLabel = persona.relationshipStageV2
    ? STAGE_LABELS_V2[persona.relationshipStageV2]
    : persona.useLoverStages
      ? XIAONUAN_STAGE_LABELS[resolveLoverStage(affinityScore)]
      : STAGE_LABELS[relationshipStage];
  const hasApiKey = !!settings.apiKey || !!settings.serverConfigured;

  useEffect(() => {
    initVoiceOutput();
  }, []);

  useEffect(() => {
    if (!voiceText) return;
    setInput(voiceText);
    onVoiceTextConsumed();
    if (voiceOn) {
      setTimeout(() => commitUserMessage(voiceText), 50);
    }
  }, [voiceText]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── v1.12 动机驱动主动消息：轮询服务端待投递队列（她主动找你）──
  // 服务端只在"空闲 ≥2h + 心里挂着的事够紧迫 + 配额/时间窗放行"时才会投递，
  // 这里只负责显示与播报，不做任何判断。
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/proactive/pending');
        if (!res.ok) return;
        const data = await res.json();
        const list: Array<{ id: string; text: string; createdAt: string }> = data?.messages ?? [];
        if (stopped || list.length === 0) return;
        for (const m of list) {
          addChatMessage({
            id: m.id ?? `proactive_${Date.now()}`,
            role: 'assistant',
            content: m.text,
            timestamp: m.createdAt ?? new Date().toISOString(),
            type: 'text',
          } as ChatMessageType);
          const latestState = useAIBrainStore.getState().persona.emotionState;
          const voiceEmotion = dominantVoiceEmotion(latestState?.emotions);
          const ttsEnabled = voiceOn && (settings.tts?.enabled ?? true);
          speakText(m.text, ttsEnabled, voiceEmotion, { provider: settings.tts?.provider ?? 'cosyvoice' });
          console.log('[Proactive] 她主动发来一条消息');
        }
      } catch { /* 服务未就绪时静默重试 */ }
    };
    const timer = setInterval(poll, 20_000);
    void poll();
    return () => { stopped = true; clearInterval(timer); };
  }, [addChatMessage, voiceOn, settings.tts?.enabled, settings.tts?.provider]);

  const syncServerState = (data: any) => {
    const updates: Partial<typeof persona> = {};
    if (data.emotionState) updates.emotionState = data.emotionState;
    if (data._affinity?.score) updates.affinityScore = data._affinity.score;
    if (data.relationship?.stage) updates.relationshipStageV2 = data.relationship.stage;
    if (Object.keys(updates).length > 0) setPersona(updates);

    const emoState = useAIBrainStore.getState().persona.emotionState;
    if (!emoState) return;
    try {
      const phaseInfo = getMicroPhase(emoState);
      useAIBrainStore.getState().pushTrailPoint(emoState.taiji.valence, emoState.taiji.arousal, phaseInfo.phase);
    } catch {
      useAIBrainStore.getState().pushTrailPoint(emoState.taiji.valence, emoState.taiji.arousal);
    }
  };

  const commitUserMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;

    setIsTyping(true);
    abortControllerRef.current = new AbortController();

    try {
      if (!settings.apiKey && !settings.serverConfigured && settings.provider !== 'custom') {
        throw new Error('Please configure an API key in Settings, or set it in the backend .env file.');
      }

      const recentMessages = chatMessages.slice(-20).map(msg => ({
        role: (msg.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: msg.content,
      })).concat({ role: 'user' as const, content: text });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          // 传 userId 让服务端在 Firestore 可用时落库消息（App.tsx 以 guest 读取同步）
          userId: 'guest',
          persona: {
            ...persona,
            emotionState: undefined,
            systemPrompt: generateSystemPrompt(persona),
          },
          settings,
          recentMessages,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as any).error || `Server error ${response.status}`);
      }

      const data = await response.json();
      const aiText = data.response || data.text || '';
      if (aiText) {
        addChatMessage({
          id: `ai_${Date.now()}`,
          role: 'assistant',
          content: aiText,
          timestamp: new Date().toISOString(),
          type: 'text',
        } as ChatMessageType);
        // v1.4/v1.5 语气随情感：服务端返回的最新情感状态驱动语音；provider 决定用哪个 TTS
        const latestState = data.emotionState ?? useAIBrainStore.getState().persona.emotionState;
        const voiceEmotion = dominantVoiceEmotion(latestState?.emotions);
        // 语音播报：MediaPanel 开关 且 设置里未显式关闭 TTS（默认开）→ 文字与语音同时给
        // provider 默认 cosyvoice（本地情感 TTS）；服务未启动时秒级失败 → 自动回退浏览器语音
        const ttsEnabled = voiceOn && (settings.tts?.enabled ?? true);
        speakText(aiText, ttsEnabled, voiceEmotion, { provider: settings.tts?.provider ?? 'cosyvoice' });
      }

      syncServerState(data);
      if (data.relevantPatterns) {
        setLastTurnInfo(data.relevantPatterns, data.strategy || null, data.strategyReason || '');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      addChatMessage({
        id: `err_${Date.now()}`,
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
        type: 'error',
      } as ChatMessageType);
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || isTyping) return;
    addChatMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      type: 'text',
    } as ChatMessageType);
    setInput('');
    commitUserMessage(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      <header className="h-14 flex items-center justify-between px-5 glass-warm shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-moon-800">{persona.name || 'AI Friend'}</span>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full transition-all duration-500 ${
            persona.useLoverStages ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'
          }`}>
            {displayStageLabel}
          </span>
          {dominantEmotion && (
            <span className="text-xs text-moon-400">
              {dominantEmotion.name} {Math.abs(dominantEmotion.intensity).toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${hasApiKey ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-5 py-5">
        {chatMessages.map(msg => (
          <div key={msg.id}>
            <MessageBubble msg={msg} />
          </div>
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </main>

      <footer className="shrink-0 p-4 glass-warm">
        <div className="flex items-end gap-3">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 resize-none rounded-2xl border border-rose-100 bg-white/80 px-4 py-3 text-sm text-moon-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
            rows={1}
            disabled={isTyping}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="h-11 px-5 rounded-2xl bg-rose-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-rose-600 transition-colors"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
