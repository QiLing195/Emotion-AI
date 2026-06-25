import React from 'react';
import { Sparkles, Volume2, Clock, Activity } from 'lucide-react';
import { Persona } from '../../store/useAIBrainStore';

export interface BehaviorParamsProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
}

const BehaviorParams: React.FC<BehaviorParamsProps> = ({
  persona,
  setPersona,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          行为参数 (初始基准)
        </h3>
        <p className="text-sm text-slate-500 mt-1">设定AI的初始行为倾向。随着长期记忆的积累，这些参数将发生自主演化。</p>
      </div>

      <div className="p-6 space-y-8">
        <div className="bg-amber-50 text-amber-700 p-4 rounded-xl text-sm flex items-start gap-3 border border-amber-100">
          <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-1">动态演化机制已开启</p>
            <p className="opacity-90">您在此设置的仅为"出厂初始值"。在后续的对话中，AI 会根据您的互动方式、共同经历以及长期记忆，自主微调这些行为参数，形成独一无二的灵魂。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                幽默程度 (Humor)
              </label>
              <span className="text-sm text-slate-500 font-mono">{persona.humor}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={persona.humor}
              onChange={e => setPersona({...persona, humor: parseInt(e.target.value)})}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>严肃专业</span>
              <span>插科打诨</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                好奇心 (Curiosity)
              </label>
              <span className="text-sm text-slate-500 font-mono">{persona.curiosity}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={persona.curiosity}
              onChange={e => setPersona({...persona, curiosity: parseInt(e.target.value)})}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>被动响应</span>
              <span>主动探索/提问</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                独立性 (Independence)
              </label>
              <span className="text-sm text-slate-500 font-mono">{persona.independence}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={persona.independence}
              onChange={e => setPersona({...persona, independence: parseInt(e.target.value)})}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>依赖顺从</span>
              <span>自主决策/反驳</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                乐观度 (Optimism)
              </label>
              <span className="text-sm text-slate-500 font-mono">{persona.optimism}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={persona.optimism}
              onChange={e => setPersona({...persona, optimism: parseInt(e.target.value)})}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>悲观/现实</span>
              <span>积极/治愈</span>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                主观能动性 (Proactive Score)
              </label>
              <span className="text-sm text-slate-500 font-mono">{persona.proactiveScore ?? 50}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={persona.proactiveScore ?? 50}
              onChange={e => setPersona({...persona, proactiveScore: parseInt(e.target.value)})}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>被动响应</span>
              <span>主动建议/探索</span>
            </div>
          </div>
        </div>

        {/* ── 自主性行为调校 ── */}
        <div className="border-t border-slate-100 pt-6">
          <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-indigo-500" />
            主动消息节奏
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  每日上限
                </label>
                <span className="text-sm text-slate-500 font-mono">{persona.proactiveFrequency ?? 3} 条</span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={persona.proactiveFrequency ?? 3}
                onChange={e => setPersona({...persona, proactiveFrequency: parseInt(e.target.value)})}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>克制</span>
                <span>频繁</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  触发敏感度
                </label>
                <span className="text-sm text-slate-500 font-mono">{persona.proactiveThreshold ?? 65}%</span>
              </div>
              <input
                type="range"
                min="30"
                max="90"
                value={persona.proactiveThreshold ?? 65}
                onChange={e => setPersona({...persona, proactiveThreshold: parseInt(e.target.value)})}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>高阈值(少打扰)</span>
                <span>低阈值(常联系)</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  静默开始
                </label>
                <span className="text-sm text-slate-500 font-mono">{persona.quietHourStart ?? 23}:00</span>
              </div>
              <input
                type="range"
                min="20"
                max="23"
                value={persona.quietHourStart ?? 23}
                onChange={e => setPersona({...persona, quietHourStart: parseInt(e.target.value)})}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>20:00起静默</span>
                <span>23:00起静默</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            控制AI主动发消息的频率、敏感度和静默时段。调高敏感度 = 更容易触发主动联系。
          </p>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div>
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-slate-500" />
              主动服务推荐
            </h4>
            <p className="text-xs text-slate-500 mt-1">允许AI根据传感器或时间主动发起对话（如早安问候）</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.proactive}
              onChange={e => setPersona({...persona, proactive: e.target.checked})}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default BehaviorParams;