import React from 'react';
import { HeartPulse, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Persona } from '../../store/useAIBrainStore';

export interface EmotionSettingsProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
}

const EmotionSettings: React.FC<EmotionSettingsProps> = ({
  persona,
  setPersona,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-rose-500" />
          情感系统
        </h3>
        <p className="text-sm text-slate-500 mt-1">配置AI的情感感知与共情表达能力</p>
      </div>

      <div className="p-6 space-y-8">
        <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div>
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <HeartPulse className="w-4 h-4 text-slate-500" />
              动态情感引擎 (Dynamic Emotion)
            </h4>
            <p className="text-xs text-slate-500 mt-1">允许AI根据对话上下文自动分析并切换当前情绪状态</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.dynamicEmotion}
              onChange={e => setPersona({...persona, dynamicEmotion: e.target.checked})}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500"></div>
          </label>
        </div>

        {persona.dynamicEmotion && persona.emotionState && (
          <div className="p-4 rounded-xl border border-rose-100 bg-white shadow-sm space-y-4">
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500" />
              当前实时情绪状态 (Live Emotion State)
            </h4>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(persona.emotionState.emotions).map(([name, intensity]: [string, number], idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 font-medium capitalize">{name}</span>
                    <span className={intensity > 0 ? "text-rose-500" : "text-slate-400"}>
                      {Math.abs(intensity).toFixed(2)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", intensity > 0 ? "bg-rose-500" : "bg-slate-300")}
                      style={{ width: `${Math.abs(intensity) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs text-slate-500">整体能量水平 (Energy)</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-500"
                      style={{ width: `${persona.emotionState.taiji.arousal * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-600">{(persona.emotionState.taiji.arousal * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500 block mb-1">活跃情绪 (复合)</span>
                <div className="flex gap-1 justify-end">
                  {Object.entries(persona.emotionState.emotions)
                    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Math.abs(entry[1]) > 0.05)
                    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
                    .slice(0, 3)
                    .map(([name], idx) => (
                      <span key={idx} className="px-2 py-1 bg-rose-50 text-rose-600 rounded-md text-xs font-medium border border-rose-100 capitalize">
                        {name}
                      </span>
                    ))}
                  {Object.entries(persona.emotionState.emotions).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Math.abs(entry[1]) > 0.05).length === 0 && (
                    <span className="px-2 py-1 bg-slate-50 text-slate-500 rounded-md text-xs font-medium border border-slate-200">
                      Neutral
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              共情感知力 (Empathy Level)
            </label>
            <span className="text-sm text-slate-500 font-mono">{persona.empathy}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={persona.empathy}
            onChange={e => setPersona({...persona, empathy: parseInt(e.target.value)})}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>客观理性</span>
            <span>适度共情</span>
            <span>高度敏感</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
              情感表达丰富度 (Expression Richness)
            </label>
            <span className="text-sm text-slate-500 font-mono">{persona.expressiveness}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={persona.expressiveness}
            onChange={e => setPersona({...persona, expressiveness: parseInt(e.target.value)})}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
          <div className="flex justify-between text-xs text-slate-400">
            <span>克制内敛</span>
            <span>自然流畅</span>
            <span>丰富生动 (多语气词/Emoji)</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmotionSettings;