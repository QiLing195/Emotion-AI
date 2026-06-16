import React, { memo } from 'react';
import { MessageSquare, BrainCircuit, Bug, BugOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/Button';
import { Persona } from '../../store/useAIBrainStore';
import { getDominantEmotion } from '../../lib/emotionEngine';

export interface ChatHeaderProps {
  persona: Persona;
  onSimulateProactiveEvent: (event: string) => void;
  settings: any;
  showDebug?: boolean;
  onToggleDebug?: () => void;
  className?: string;
}

const ChatHeader = memo<ChatHeaderProps>(({
  persona,
  onSimulateProactiveEvent,
  settings,
  showDebug,
  onToggleDebug,
  className,
}) => {
  const dominantEmotion = persona.emotionState
    ? getDominantEmotion(persona.emotionState.emotions)
    : null;

  return (
    <div className={cn('flex items-center justify-between', className)}>
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-emerald-600" />
          {persona.name}
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {persona.tone || 'AI 女友'}
        </p>
      </div>

      <div className="flex items-center gap-4">
        {/* Simulate buttons (always visible, useful for testing) */}
        <div className="flex items-center gap-2">
          <Button
            onClick={() => onSimulateProactiveEvent('早晨起床')}
            variant="outline"
            size="sm"
            className="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors border border-indigo-200"
          >
            模拟: 早晨
          </Button>
          <Button
            onClick={() => onSimulateProactiveEvent('下班回家')}
            variant="outline"
            size="sm"
            className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-200"
          >
            模拟: 回家
          </Button>
          <Button
            onClick={() => onSimulateProactiveEvent('深夜未眠')}
            variant="outline"
            size="sm"
            className="px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-lg transition-colors border border-purple-200"
          >
            模拟: 深夜
          </Button>
        </div>

        {/* Emotion/Affinity Debug Panel (hidden behind debug mode) */}
        {showDebug && persona.dynamicEmotion && persona.emotionState && dominantEmotion && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <BrainCircuit className="w-4 h-4 text-purple-500" />
            <span>能量: {(persona.emotionState.taiji.arousal * 100).toFixed(0)}%</span>
            <span className="mx-1 text-slate-300">|</span>
            <span>
              情绪: {dominantEmotion.name} ({(Math.abs(dominantEmotion.intensity) * 100).toFixed(0)}%)
            </span>
            <span className="mx-1 text-slate-300">|</span>
            <span
              className={cn(
                'font-bold',
                persona.crisisState?.isCrisis ? 'text-red-500' : 'text-emerald-500'
              )}
            >
              好感:{' '}
              {persona.crisisState?.isCrisis
                ? 'L0 (警戒)'
                : Math.round(persona.affinityScore ?? 20)}
            </span>
          </div>
        )}

        {/* Connection status */}
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          {settings.provider} API 已连接
        </div>

        {/* Debug toggle button */}
        <button
          onClick={onToggleDebug}
          className={cn(
            'p-1.5 rounded-lg transition-colors',
            showDebug
              ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          )}
          title={showDebug ? '隐藏调试信息 (Ctrl+Shift+D)' : '显示调试信息 (Ctrl+Shift+D)'}
        >
          {showDebug ? <BugOff className="w-4 h-4" /> : <Bug className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}, chatHeaderPropsAreEqual);

// Only re-render when visible values change, not on every emotion tick
function chatHeaderPropsAreEqual(prev: ChatHeaderProps, next: ChatHeaderProps) {
  if (prev.showDebug !== next.showDebug) return false;
  if (prev.persona.dynamicEmotion !== next.persona.dynamicEmotion) return false;
  if (prev.persona.affinityScore !== next.persona.affinityScore) return false;
  if (prev.persona.crisisState?.isCrisis !== next.persona.crisisState?.isCrisis) return false;
  if (prev.persona.emotionState?.taiji.arousal !== next.persona.emotionState?.taiji.arousal) return false;
  if (prev.persona.emotionState?.emotions !== next.persona.emotionState?.emotions) {
    const a = prev.persona.emotionState?.emotions ?? {};
    const b = next.persona.emotionState?.emotions ?? {};
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const k of Object.keys(a)) {
      if (a[k] !== b[k]) return false;
    }
  }
  if (prev.settings.provider !== next.settings.provider) return false;
  if (prev.className !== next.className) return false;
  return true;
}

export default ChatHeader;