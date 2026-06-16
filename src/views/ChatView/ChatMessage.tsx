import React, { memo } from 'react';
import { Bot, User, Info, BrainCircuit } from 'lucide-react';
import { cn, escapeHtml } from '../../lib/utils';
import { ChatMessage as ChatMessageType } from '../../store/useAIBrainStore';

export interface ChatMessageProps {
  message: ChatMessageType;
  className?: string;
  showDebug?: boolean;
}

const ChatMessage = memo<ChatMessageProps>(({ message, className, showDebug = false }) => {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="w-full text-center my-4">
        <span
          className="text-xs font-medium text-slate-400 bg-slate-100 px-3 py-1 rounded-full"
          dangerouslySetInnerHTML={{ __html: escapeHtml(message.content) }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-4 max-w-[80%]',
        isUser ? 'ml-auto flex-row-reverse' : 'mr-auto',
        className
      )}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1',
          isUser ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
        )}
      >
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'px-4 py-2.5 rounded-2xl text-sm shadow-sm flex flex-col gap-2',
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
          )}
        >
          {message.imageUrl && (
            <img
              src={message.imageUrl}
              alt="Uploaded"
              className="max-w-[200px] rounded-lg object-cover"
            />
          )}
          {message.content && (
            <span
              className="whitespace-pre-line"
              dangerouslySetInnerHTML={{ __html: escapeHtml(message.content) }}
            />
          )}
        </div>

        {/* Metadata for AI responses (debug only) */}
        {showDebug && isAssistant && (message.intent || message.tools || message.emotion || message.responseType) && (
          <div className="flex flex-wrap gap-2 mt-1">
            {message.emotion && (
              <span className="text-[10px] font-medium px-2 py-0.5 bg-rose-50 text-rose-600 rounded border border-rose-100 flex items-center gap-1">
                情绪: {message.emotion}
              </span>
            )}
            {message.intent && (
              <span className="text-[10px] font-medium px-2 py-0.5 bg-purple-50 text-purple-600 rounded border border-purple-100">
                意图: {message.intent}
              </span>
            )}
            {message.tools?.map((tool, idx) => (
              <span
                key={idx}
                className="text-[10px] font-medium px-2 py-0.5 bg-amber-50 text-amber-600 rounded border border-amber-100 font-mono"
              >
                调用: {tool}
              </span>
            ))}
            {message.responseType === 'suggestion' && (
              <span className="text-[10px] font-medium px-2 py-0.5 bg-blue-50 text-blue-600 rounded border border-blue-100 flex items-center gap-1">
                <Info className="w-3 h-3" />
                建议类内容，仅供参考
              </span>
            )}
            {message.responseType === 'reasoning' && (
              <span className="text-[10px] font-medium px-2 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200 flex items-center gap-1">
                <BrainCircuit className="w-3 h-3" />
                AI 推理分析
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;