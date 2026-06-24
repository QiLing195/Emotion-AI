// ── 精简聊天视图 ──
// 保留核心：流式响应、情感更新、情感传染链
// 移除：debug 模式、模拟按钮、TTS、图片上传、记忆后台提取
import React, { useState, useRef, useEffect } from 'react';
import { useAIBrainStore, generateSystemPrompt, ChatMessage as ChatMessageType } from '../store/useAIBrainStore';
import { getDominantEmotion, analyzeUserSentiment, suggestReinforcement, applyEmotionalContagion, getMicroPhase, getRelationshipStage, STAGE_LABELS, type EmotionEvent } from '../lib/emotionEngine';
import { XIAONUAN_STAGE_LABELS, getNextStageThreshold, resolveLoverStage } from '../lib/xiaoNuanStages';

// ── 单条消息气泡 ──
function MessageBubble({ msg }: { msg: ChatMessageType; key?: string }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[75%] px-4 py-3 text-sm leading-relaxed animate-fade-in-up ${
        isUser
          ? 'msg-user'
          : 'msg-ai'
      }`}>
        {msg.content}
      </div>
    </div>
  );
}

// ── 打字指示器 ──
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

export default function ChatView() {
  const chatMessages = useAIBrainStore(s => s.chatMessages);
  const addChatMessage = useAIBrainStore(s => s.addChatMessage);
  const persona = useAIBrainStore(s => s.persona);
  const settings = useAIBrainStore(s => s.settings);
  const updateEmotion = useAIBrainStore(s => s.updateEmotion);
  const applyReinforcement = useAIBrainStore(s => s.applyReinforcement);
  const setLastTurnInfo = useAIBrainStore(s => s.setLastTurnInfo);
  const advanceRelationshipStage = useAIBrainStore(s => s.advanceRelationshipStage);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isGeneratingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const dominantEmotion = persona.emotionState
    ? getDominantEmotion(persona.emotionState.emotions)
    : null;

  // 关系阶段显示（小暖恋爱模式 vs 通用模式）
  const affinityScore = persona.affinityScore ?? 20;
  const relationshipStage = getRelationshipStage(affinityScore, persona.crisisState?.isCrisis ?? false);
  const displayStageLabel = persona.useLoverStages
    ? XIAONUAN_STAGE_LABELS[resolveLoverStage(affinityScore)]
    : STAGE_LABELS[relationshipStage];
  const nextThreshold = persona.useLoverStages ? getNextStageThreshold(affinityScore) : null;

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── 核心：发送消息 → 流式接收 → 情感更新 ──
  const commitUserMessage = async (text: string) => {
    setIsTyping(true);
    isGeneratingRef.current = true;
    abortControllerRef.current = new AbortController();

    try {
      // 离线衰减检查
      const lastUserMsg = chatMessages.filter(m => m.role === 'user').slice(-1)[0];
      if (lastUserMsg) {
        useAIBrainStore.getState().calculateOfflineDecay(lastUserMsg.timestamp);
      }

      if (!settings.apiKey && settings.provider !== 'custom') {
        throw new Error('请先在设置中配置 API Key（打开浏览器 console 执行 localStorage.setItem("apiKey","your-key")）');
      }

      const recentMessages = chatMessages.slice(-20).map(msg => ({
        role: (msg.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: msg.content,
      }));

      const effectiveSystemPrompt = generateSystemPrompt(persona);

      // 发送请求
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          persona: { ...persona, systemPrompt: effectiveSystemPrompt },
          settings,
          recentMessages,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as any).error || `服务器错误 ${response.status}`);
      }

      // 流式读取
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
      }

      // 情感更新
      const emotionEvent = data.emotionEvent as EmotionEvent | undefined;
      if (emotionEvent) {
        updateEmotion(emotionEvent);
      }
      // Phase 3: 记录情绪轨迹点（含微六爻阶段）
      const emoState = useAIBrainStore.getState().persona.emotionState;
      if (emoState) {
        try {
          const phaseInfo = getMicroPhase(emoState);
          useAIBrainStore.getState().pushTrailPoint(emoState.taiji.valence, emoState.taiji.arousal, phaseInfo.phase);
        } catch {
          useAIBrainStore.getState().pushTrailPoint(emoState.taiji.valence, emoState.taiji.arousal);
        }
      }

      // 情感传染链
      if (aiText) {
        const userAnalysis = analyzeUserSentiment(text);
        const signal = suggestReinforcement(userAnalysis);
        applyReinforcement(signal);
        if (persona.emotionState) {
          applyEmotionalContagion(persona.emotionState, userAnalysis.expressedEmotion, userAnalysis.intensity, persona.emotionState.evolution.empathy);
        }
      }

      // Phase 2: 更新观测台面板数据
      if (data.relevantPatterns) {
        setLastTurnInfo(data.relevantPatterns, data.strategy || null, data.strategyReason || '');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') return;
      addChatMessage({
        id: `err_${Date.now()}`,
        role: 'system',
        content: `错误: ${error.message}`,
        timestamp: new Date().toISOString(),
        type: 'error',
      } as ChatMessageType);
    } finally {
      setIsTyping(false);
      isGeneratingRef.current = false;
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 从 settings 中提取 API key（可能在运行时通过 console 设置）
  const hasApiKey = !!settings.apiKey;

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full">
      {/* 顶部状态条 */}
      <header className="h-14 flex items-center justify-between px-5 glass-warm shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-moon-800">
            {persona.name || 'AI 女友'}
          </span>
          {/* 关系阶段徽章 */}
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full transition-all duration-500 ${
            persona.useLoverStages
              ? 'bg-rose-100 text-rose-600'
              : 'bg-slate-100 text-slate-500'
          }`}>
            {displayStageLabel}
          </span>
          {dominantEmotion && (
            <span className="text-xs font-medium text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full">
              {dominantEmotion.name} {dominantEmotion.intensity.toFixed(2)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-moon-400">
          {/* 手动推进关系按钮（仅恋爱模式） */}
          {nextThreshold !== null && (
            <button
              onClick={() => advanceRelationshipStage()}
              className="text-xs px-2.5 py-1 bg-rose-500 text-white rounded-full hover:bg-rose-600 transition-colors font-medium"
              title={`推进到下一阶段 (好感 > ${nextThreshold})`}
            >
              推进关系
            </button>
          )}
          {hasApiKey ? (
            <span className="w-2 h-2 rounded-full bg-teal-500" title="API Key 已配置" />
          ) : (
            <span className="text-rose-500">未配置 API Key</span>
          )}
          <span>{settings.provider} / {settings.model || 'default'}</span>
        </div>
      </header>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {chatMessages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center animate-fade-in-up">
              <div className="text-5xl mb-4 animate-float">🌸</div>
              <div className="text-moon-600 text-base font-medium">开始我们的对话吧</div>
              <div className="text-moon-400 text-sm mt-2 text-balance max-w-[280px]">
                每一句交谈，都会让彼此更靠近一点
              </div>
            </div>
          </div>
        )}
        {chatMessages.map(msg => (
          <MessageBubble msg={msg} key={msg.id} />
        ))}
        {isTyping && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="px-4 py-3 glass-warm shrink-0">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasApiKey ? '输入消息... (Enter 发送)' : '请先配置 API Key...'}
            disabled={isTyping || !hasApiKey}
            className="flex-1 bg-white/60 backdrop-blur border border-surface-300 rounded-2xl px-5 py-3 text-sm text-moon-800 placeholder-moon-400 focus:outline-none focus:border-coral-400 focus:ring-4 focus:ring-coral-400/15 disabled:opacity-40 transition-all"
          />
          <button
            onClick={handleSend}
            disabled={isTyping || !input.trim() || !hasApiKey}
            className="px-6 py-3 bg-gradient-to-br from-coral-400 to-rose-500 hover:from-coral-500 hover:to-rose-600 disabled:from-moon-200 disabled:to-moon-300 disabled:text-moon-400 text-white text-sm font-medium rounded-2xl transition-all disabled:cursor-not-allowed shadow-[0_2px_12px_rgba(244,63,110,0.3)] hover:shadow-[0_4px_18px_rgba(244,63,110,0.4)] hover:-translate-y-0.5"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
