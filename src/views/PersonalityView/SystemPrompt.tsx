import React from 'react';
import { Terminal } from 'lucide-react';
import { Persona } from '../../store/useAIBrainStore';

export interface SystemPromptProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
}

const SystemPrompt: React.FC<SystemPromptProps> = ({
  persona,
  setPersona,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Terminal className="w-5 h-5 text-slate-600" />
          System Prompt (高级)
        </h3>
        <p className="text-sm text-slate-500 mt-1">直接修改发送给大模型的系统提示词</p>
      </div>

      <div className="p-6">
        <textarea
          value={persona.systemPrompt}
          onChange={e => setPersona({...persona, systemPrompt: e.target.value})}
          rows={6}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all font-mono text-sm text-slate-700 leading-relaxed resize-none"
        />
        <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
          * 提示词将与记忆检索结果拼接后发送给 DeepSeek 模型。
        </p>
      </div>
    </div>
  );
};

export default SystemPrompt;