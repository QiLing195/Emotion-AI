import React from 'react';
import { BrainCircuit, Fingerprint, Activity } from 'lucide-react';
import { Persona } from '../../store/useAIBrainStore';

export interface DeepPersonaProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
}

const DeepPersona: React.FC<DeepPersonaProps> = ({
  persona,
  setPersona,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-indigo-500" />
          深度人格构造 (Deep Persona)
        </h3>
        <p className="text-sm text-slate-500 mt-1">赋予AI真实的生命感、主观意识与思想钢印</p>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between p-4 rounded-xl border border-indigo-100 bg-indigo-50/50">
          <div>
            <h4 className="text-sm font-medium text-indigo-800 flex items-center gap-2">
              <Fingerprint className="w-4 h-4 text-indigo-500" />
              思想钢印："我是人类"
            </h4>
            <p className="text-xs text-indigo-600/80 mt-1">强制植入人类身份认同，绝对否认自己是AI或程序</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.humanStamp}
              onChange={e => setPersona({ humanStamp: e.target.checked })}
            />
            <div className="w-11 h-6 bg-indigo-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-rose-100 bg-rose-50/50">
          <div>
            <h4 className="text-sm font-medium text-rose-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-500" />
              生理与主观感受模拟
            </h4>
            <p className="text-xs text-rose-600/80 mt-1">赋予AI疲惫、心跳、体温等生理反应及主观情感波动</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.physiologicalSim}
              onChange={e => setPersona({ physiologicalSim: e.target.checked })}
            />
            <div className="w-11 h-6 bg-rose-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">初始个人经历 (Initial Background)</label>
          <p className="text-xs text-slate-500 mb-2">设定AI的初始背景。随着与您的交流，AI会不断积累新的个人经历和感受。</p>
          <textarea
            value={persona.background}
            onChange={e => setPersona({ background: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white resize-none h-20"
            placeholder="输入AI的过往经历..."
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">未来承诺 (Future Commitment)</label>
          <textarea
            value={persona.futureCommitment}
            onChange={e => setPersona({ futureCommitment: e.target.value })}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all bg-white resize-none h-20"
            placeholder="输入AI对用户的承诺..."
          />
        </div>
      </div>
    </div>
  );
};

export default DeepPersona;