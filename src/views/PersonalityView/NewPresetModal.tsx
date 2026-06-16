import React from 'react';

export interface NewPresetModalProps {
  isOpen: boolean;
  newPresetName: string;
  setNewPresetName: (name: string) => void;
  onSave: () => void;
  onClose: () => void;
}

const NewPresetModal: React.FC<NewPresetModalProps> = ({
  isOpen,
  newPresetName,
  setNewPresetName,
  onSave,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-5 animate-in zoom-in-95 duration-200">
        <div>
          <h3 className="text-lg font-bold text-slate-800">保存为新预设</h3>
          <p className="text-sm text-slate-500 mt-1">将当前的所有参数配置保存为一个新的人格模板。</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">预设名称</label>
          <input
            type="text"
            value={newPresetName}
            onChange={e => setNewPresetName(e.target.value)}
            placeholder="例如：傲娇女仆"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={!newPresetName.trim()}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            确认保存
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewPresetModal;