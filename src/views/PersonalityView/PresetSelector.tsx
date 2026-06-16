import React from 'react';
import { Users, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Preset } from '../../store/useAIBrainStore';

export interface PresetSelectorProps {
  presets: Preset[];
  activePresetId: string;
  onPresetChange: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onOpenModal: () => void;
}

const PresetSelector: React.FC<PresetSelectorProps> = ({
  presets,
  activePresetId,
  onPresetChange,
  onDeletePreset,
  onOpenModal,
}) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200 bg-slate-50/50">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          人格预设切换
        </h3>
        <p className="text-sm text-slate-500 mt-1">一键切换 AI 的性格模板，或者在下方自由微调。</p>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {presets.map(preset => (
            <div key={preset.id} className="relative group">
              <button
                onClick={() => onPresetChange(preset.id)}
                className={cn(
                  "w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all text-center",
                  activePresetId === preset.id
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {preset.label}
              </button>
              {preset.id.startsWith('custom_') && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeletePreset(preset.id); }}
                  className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-rose-600"
                  title="删除预设"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={onOpenModal}
            className="px-4 py-3 rounded-xl border border-dashed border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 text-sm font-medium transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            保存为新预设
          </button>
        </div>
      </div>
    </div>
  );
};

export default PresetSelector;