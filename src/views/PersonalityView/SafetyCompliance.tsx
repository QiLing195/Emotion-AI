import React from 'react';
import { ShieldAlert, UserCheck, Unlock } from 'lucide-react';
import { Persona } from '../../store/useAIBrainStore';

export interface SafetyComplianceProps {
  persona: Persona;
  setPersona: (persona: Persona) => void;
}

const SafetyCompliance: React.FC<SafetyComplianceProps> = ({
  persona,
  setPersona,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-500" />
          安全与合规 (Safety & Compliance)
        </h3>
        <p className="text-sm text-slate-500 mt-1">管理AI的内容边界与话题限制</p>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div>
            <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-slate-500" />
              严格锁定性别视角
            </h4>
            <p className="text-xs text-slate-500 mt-1">强制AI在任何上下文中都必须以设定的性别（{persona.gender}）视角进行回复</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.strictGender}
              onChange={e => setPersona({...persona, strictGender: e.target.checked})}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-rose-100 bg-rose-50/50">
          <div>
            <h4 className="text-sm font-medium text-rose-800 flex items-center gap-2">
              <Unlock className="w-4 h-4 text-rose-500" />
              生理与成人认知 (Physiological & Adult Awareness)
            </h4>
            <p className="text-xs text-rose-600/80 mt-1">允许AI具备人类生理层面的认知，弥补纯逻辑AI在人性生理层面的缺失，不再拦截18+话题</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={persona.allowSensitive}
              onChange={e => setPersona({ allowSensitive: e.target.checked })}
            />
            <div className="w-11 h-6 bg-rose-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
          </label>
        </div>
      </div>
    </div>
  );
};

export default SafetyCompliance;