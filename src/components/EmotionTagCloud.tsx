import React, { useMemo } from 'react';
import {
  EmotionAnnotation,
  QUADRANTS,
  formatCoord,
} from '../data/affectLexicon';
import {
  EmotionLabelFrequency,
  buildEmotionLabelFrequencies,
} from '../data/emotionTrendStats';

interface EmotionTagCloudProps {
  annotations: EmotionAnnotation[];
  selectedLabel: string | null;
  hasActiveTableFilters?: boolean;
  onSelectLabel: (label: string | null) => void;
}

function getTierClass(weight: number, isOnlyTier: boolean): string {
  if (isOnlyTier) return 'text-base font-semibold';
  if (weight >= 0.75) return 'text-xl font-semibold tracking-tight';
  if (weight >= 0.45) return 'text-lg font-semibold';
  if (weight >= 0.2) return 'text-base font-medium';
  return 'text-sm font-medium';
}

export const EmotionTagCloud: React.FC<EmotionTagCloudProps> = ({
  annotations,
  selectedLabel,
  hasActiveTableFilters = false,
  onSelectLabel,
}) => {
  const frequencies = useMemo(
    () => buildEmotionLabelFrequencies(annotations),
    [annotations]
  );

  const topEntry: EmotionLabelFrequency | null = frequencies[0] ?? null;
  const allEqualFreq =
    frequencies.length > 0 &&
    frequencies[0].count === frequencies[frequencies.length - 1].count;

  const handleToggleLabel = (label: string) => {
    onSelectLabel(selectedLabel === label ? null : label);
  };

  return (
    <section
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      aria-label="高频情绪标签云"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            情绪标签云
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {topEntry ? (
              <>
                <span>
                  共{' '}
                  <span className="font-mono tabular-nums text-slate-700">
                    {frequencies.length}
                  </span>{' '}
                  个标签
                </span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>
                  最高频：
                  <span className="font-medium text-slate-800">
                    {topEntry.label}
                  </span>
                  （
                  <span className="font-mono tabular-nums">
                    {topEntry.count}
                  </span>{' '}
                  次，占比{' '}
                  <span className="font-mono tabular-nums">
                    {Math.round(topEntry.ratio * 100)}%
                  </span>
                  ）
                </span>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span>点击标签可自动过滤下方趋势图与标注条目</span>
                {hasActiveTableFilters && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="text-blue-700">已同步当前检索条件</span>
                  </>
                )}
              </>
            ) : (
              <span>暂无可供词频统计的情绪标签</span>
            )}
          </p>
        </div>

        {selectedLabel && (
          <div className="flex items-center gap-2 text-xs text-slate-600 shrink-0">
            <span>
              已选标签：
              <strong className="font-semibold text-slate-900">
                {selectedLabel}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onSelectLabel(null)}
              className="text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
            >
              清除标签筛选
            </button>
          </div>
        )}
      </div>

      {frequencies.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <p className="text-xs text-slate-500">
            当前筛选条件下暂无情绪标签，新增标注或清除筛选后将自动生成词频标签云。
          </p>
        </div>
      ) : (
        <div className="px-4 sm:px-5 py-4">
          <div
            className="flex flex-wrap items-baseline gap-x-4 gap-y-2"
            role="group"
            aria-label="按情绪标签词频筛选"
          >
            {frequencies.map((item) => {
              const isSelected = selectedLabel === item.label;
              const isDimmed = selectedLabel !== null && !isSelected;
              const quadrantMeta = QUADRANTS[item.quadrant];
              const pct = Math.round(item.ratio * 100);

              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => handleToggleLabel(item.label)}
                  aria-pressed={isSelected}
                  title={`${item.label}：出现 ${item.count} 次（占比 ${pct}%），日均效价 ${formatCoord(item.avgValence)}，点击${isSelected ? '取消' : '按此标签'}筛选`}
                  className={`inline-flex items-baseline gap-1 px-2.5 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${getTierClass(
                    item.weight,
                    allEqualFreq
                  )} ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : isDimmed
                        ? 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'
                        : `${quadrantMeta.accentText} hover:bg-slate-100`
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] font-normal ${
                      isSelected ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
