import React from 'react';
import { useAIBrainStore } from '../store/useAIBrainStore';
import { Database, Clock, TrendingUp, Tag } from 'lucide-react';

const MemoryView: React.FC = () => {
  const memories = useAIBrainStore(s => s.memories);

  const tierCounts = {
    hot: memories.filter(m => m.tier === 'hot').length,
    warm: memories.filter(m => m.tier === 'warm').length,
    cold: memories.filter(m => m.tier === 'cold').length,
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">记忆管理</h1>
      <p className="text-slate-600">查看 AI 的长期记忆存储。访客模式下数据仅保存在当前会话中。</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-rose-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-rose-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">热点记忆</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{tierCounts.hot}</p>
          <p className="text-xs text-slate-400 mt-1">近期频繁访问</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Database className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">常温记忆</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{tierCounts.warm}</p>
          <p className="text-xs text-slate-400 mt-1">常规存储</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-slate-500">冷记忆</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{tierCounts.cold}</p>
          <p className="text-xs text-slate-400 mt-1">长期未访问（可被压缩）</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-6 border-b border-slate-200 bg-slate-50/50">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-500" />
            记忆列表
          </h3>
        </div>
        <div className="p-6">
          {memories.length === 0 ? (
            <div className="text-center py-12">
              <Database className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-500">暂无记忆内容</p>
              <p className="text-xs text-slate-400 mt-1">开始对话后，AI 将自动提取并存储记忆。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {memories.slice(0, 20).map(memory => (
                <div key={memory.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">{memory.type}</span>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{memory.tier}</span>
                    {memory.source && <span className="text-xs text-slate-400">{memory.source}</span>}
                  </div>
                  <p className="text-sm text-slate-700">{memory.content}</p>
                  {memory.createdAt && (
                    <p className="text-xs text-slate-400 mt-2">{new Date(memory.createdAt).toLocaleString('zh-CN')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MemoryView;
