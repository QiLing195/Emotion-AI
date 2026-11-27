import React from 'react';
import { Search, Trash2, Compass, Pencil } from 'lucide-react';
import {
  EmotionAnnotation,
  QUADRANTS,
  QuadrantId,
  formatCoord,
  getIntensity,
} from '../data/affectLexicon';
import { extractDateKey } from '../data/emotionTrendStats';

interface AnnotationTableProps {
  annotations: EmotionAnnotation[];
  searchQuery?: string;
  quadrantFilter?: 'all' | QuadrantId;
  dateFilter?: string | null;
  labelFilter?: string | null;
  selectedId: string | null;
  compact?: boolean;
  onSearchChange?: (value: string) => void;
  onQuadrantFilterChange?: (value: 'all' | QuadrantId) => void;
  onClearDateFilter?: () => void;
  onClearLabelFilter?: () => void;
  onInspect: (annotation: EmotionAnnotation) => void;
  onEdit: (annotation: EmotionAnnotation) => void;
  onDelete: (id: string) => void;
  onCreateFirst: () => void;
}

const FILTER_OPTIONS: Array<{ id: 'all' | QuadrantId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'high-positive', label: '积极 · 高唤醒' },
  { id: 'low-positive', label: '积极 · 低唤醒' },
  { id: 'high-negative', label: '消极 · 高唤醒' },
  { id: 'low-negative', label: '消极 · 低唤醒' },
];

export const AnnotationTable: React.FC<AnnotationTableProps> = ({
  annotations,
  searchQuery = '',
  quadrantFilter = 'all',
  dateFilter = null,
  labelFilter = null,
  selectedId,
  compact = false,
  onSearchChange,
  onQuadrantFilterChange,
  onClearDateFilter,
  onClearLabelFilter,
  onInspect,
  onEdit,
  onDelete,
  onCreateFirst,
}) => {
  const normalizedQuery = compact ? '' : searchQuery.trim().toLowerCase();
  const activeQuadrant = compact ? 'all' : quadrantFilter;
  const activeDate = compact ? null : dateFilter;
  const activeLabel = compact ? null : labelFilter;

  const filtered = annotations.filter((item) => {
    const matchesQuadrant =
      activeQuadrant === 'all' || item.quadrant === activeQuadrant;
    if (!matchesQuadrant) return false;
    if (activeDate && extractDateKey(item.createdAt) !== activeDate) {
      return false;
    }
    if (activeLabel && (item.primaryLabel.trim() || '未命名') !== activeLabel) {
      return false;
    }
    if (!normalizedQuery) return true;
    return (
      item.utterance.toLowerCase().includes(normalizedQuery) ||
      item.primaryLabel.toLowerCase().includes(normalizedQuery) ||
      item.context.toLowerCase().includes(normalizedQuery)
    );
  });

  const hasActiveFilters =
    !compact &&
    (activeQuadrant !== 'all' ||
      normalizedQuery.length > 0 ||
      Boolean(activeDate) ||
      Boolean(activeLabel));

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {!compact && (
        <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange?.(event.target.value)}
              placeholder="按文本内容、情绪标签或来源场景筛选…"
              aria-label="筛选标注记录"
              className="w-full pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none transition-colors"
            />
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md overflow-x-auto"
            role="tablist"
            aria-label="按象限筛选"
          >
            {FILTER_OPTIONS.map((option) => {
              const active = activeQuadrant === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onQuadrantFilterChange?.(option.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm font-medium text-slate-900">
            {hasActiveFilters
              ? '没有符合当前筛选条件的标注记录'
              : '暂无情绪标注记录'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {hasActiveFilters
              ? '可调整搜索关键词或切换回“全部”象限查看完整数据集。'
              : '在效价—唤醒度平面上选点，或输入文本运行 AI 情绪分析来记录第一条标注。'}
          </p>
          <div className="mt-4">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={() => {
                  onSearchChange?.('');
                  onQuadrantFilterChange?.('all');
                  onClearDateFilter?.();
                  onClearLabelFilter?.();
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              >
                清除筛选
              </button>
            ) : (
              <button
                type="button"
                onClick={onCreateFirst}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                记录第一条
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-2.5 pl-4 pr-3">文本内容</th>
                <th className="py-2.5 px-3 whitespace-nowrap">情绪与象限</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">效价</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">唤醒度</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">强度</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">记录时间</th>
                <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((item) => {
                const quadrant = QUADRANTS[item.quadrant];
                const isSelected = item.id === selectedId;
                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-3 pl-4 pr-3 max-w-md">
                      <p className="text-slate-900 leading-snug line-clamp-2">
                        {item.utterance}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {item.context}
                      </p>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap align-top">
                      <div className="font-medium text-slate-900">
                        {item.primaryLabel}
                      </div>
                      <div className={`text-xs mt-0.5 ${quadrant.accentText}`}>
                        {quadrant.shortLabel}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      {formatCoord(item.valence)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      {formatCoord(item.arousal)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      {getIntensity(item.valence, item.arousal).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap align-top">
                      {item.createdAt}
                    </td>
                    <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap align-top">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onInspect(item)}
                          title="在情绪平面上查看"
                          aria-label={`在情绪平面上查看“${item.primaryLabel}”记录`}
                          className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
                        >
                          <Compass className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          title="编辑标注"
                          aria-label={`编辑“${item.primaryLabel}”记录`}
                          className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item.id)}
                          title="删除标注"
                          aria-label={`删除“${item.primaryLabel}”记录`}
                          className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
