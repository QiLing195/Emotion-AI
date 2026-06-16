import React from 'react';
import { useAIBrainStore } from '../store/useAIBrainStore';
import { Heart, MessageSquare, Brain, Activity, RefreshCw } from 'lucide-react';

const DashboardView: React.FC = () => {
  const persona = useAIBrainStore(s => s.persona);
  const chatMessages = useAIBrainStore(s => s.chatMessages);
  const memories = useAIBrainStore(s => s.memories);
  const identityNarrative = useAIBrainStore(s => s.identityNarrative);
  const refreshIdentityNarrative = useAIBrainStore(s => s.refreshIdentityNarrative);
  const episodicStore = useAIBrainStore(s => s.episodicStore);

  const evo = persona.emotionState?.evolution;
  const totalInteractions = evo?.totalInteractions ?? 0;

  const personalityDims = [
    { label: '共情', value: evo?.empathy ?? 50, color: 'bg-pink-400' },
    { label: '信任', value: evo?.trust ?? 50, color: 'bg-blue-400' },
    { label: '开放', value: evo?.openness ?? 50, color: 'bg-green-400' },
    { label: '活泼', value: evo?.playfulness ?? 50, color: 'bg-yellow-400' },
    { label: '韧性', value: Math.round((evo?.resilience ?? 0.1) * 100), color: 'bg-purple-400' },
    { label: '敏感', value: Math.round((evo?.sensitivity ?? 0.5) * 100), color: 'bg-indigo-400' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">总览面板</h1>
      <p className="text-slate-600">欢迎使用 AI 家庭管家系统！当前为访客模式。</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Brain className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">当前人格</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{persona.name}</p>
          <p className="text-xs text-slate-400 mt-1">{persona.tone}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <MessageSquare className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">对话轮次</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{chatMessages.filter(m => m.role !== 'system').length}</p>
          <p className="text-xs text-slate-400 mt-1">历史消息</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Heart className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">好感度</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{Math.round(persona.affinityScore ?? 20)}</p>
          <p className="text-xs text-slate-400 mt-1">{persona.affinityMode === 'open' ? '开放' : persona.affinityMode === 'cautious' ? '谨慎' : '平衡'}</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Activity className="w-5 h-5 text-purple-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">情景记忆</span>
          </div>
          <p className="text-xl font-bold text-slate-800">{episodicStore.episodes.length}</p>
          <p className="text-xs text-slate-400 mt-1">关键情感时刻</p>
        </div>
      </div>

      {/* ── v1.0 人格概要 ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">人格概要</h2>
          <button
            onClick={() => refreshIdentityNarrative()}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            刷新分析
          </button>
        </div>

        {/* 人格维度进度条 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {personalityDims.map(dim => (
            <div key={dim.label} className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-xs text-slate-500">{dim.label}</span>
                <span className="text-xs text-slate-400">{dim.value}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${dim.color}`}
                  style={{ width: `${dim.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* 身份叙事 */}
        <div className="text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-4">
          {identityNarrative ? (
            <p>{identityNarrative.summary}</p>
          ) : (
            <p className="text-slate-400">
              {totalInteractions > 0
                ? `已进行 ${totalInteractions} 轮互动，点击「刷新分析」生成人格概要`
                : '进行更多对话以生成人格概要...'}
            </p>
          )}
        </div>

        {/* 情景记忆提示 */}
        {episodicStore.episodes.length > 0 && (
          <div className="mt-4 text-xs text-slate-400">
            已记录 {episodicStore.episodes.length} 个情感关键时刻
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardView;
