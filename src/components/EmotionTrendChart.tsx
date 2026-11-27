import React, { useMemo, useState } from 'react';
import {
  EmotionAnnotation,
  QUADRANTS,
  QuadrantId,
  formatCoord,
} from '../data/affectLexicon';
import {
  DailyEmotionPoint,
  TrendRangeFilter,
  buildDailyEmotionTrend,
} from '../data/emotionTrendStats';

type ChartViewMode = 'quadrant' | 'affect';

interface EmotionTrendChartProps {
  annotations: EmotionAnnotation[];
  selectedDate: string | null;
  hasActiveTableFilters?: boolean;
  onSelectDate: (date: string | null) => void;
}

const QUADRANT_ORDER: readonly QuadrantId[] = [
  'high-positive',
  'low-positive',
  'high-negative',
  'low-negative',
];

const AFFECT_SERIES = [
  { key: 'avgValence' as const, label: '日均效价（V）', color: '#2563EB' },
  { key: 'avgArousal' as const, label: '日均唤醒度（A）', color: '#D97706' },
];

const RANGE_OPTIONS: ReadonlyArray<{ id: TrendRangeFilter; label: string }> = [
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'all', label: '全部日期' },
];

const MODE_OPTIONS: ReadonlyArray<{ id: ChartViewMode; label: string }> = [
  { id: 'quadrant', label: '象限分布趋势' },
  { id: 'affect', label: '效价与唤醒度波动' },
];

const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;
const MARGIN = { top: 20, right: 24, bottom: 36, left: 46 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

function buildLinePath(coords: ReadonlyArray<{ x: number; y: number }>): string {
  if (coords.length === 0) return '';
  return coords
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(' ');
}

function getXPosition(index: number, total: number): number {
  if (total <= 1) {
    return MARGIN.left + PLOT_WIDTH / 2;
  }
  return MARGIN.left + (index / (total - 1)) * PLOT_WIDTH;
}

export const EmotionTrendChart: React.FC<EmotionTrendChartProps> = ({
  annotations,
  selectedDate,
  hasActiveTableFilters = false,
  onSelectDate,
}) => {
  const [mode, setMode] = useState<ChartViewMode>('quadrant');
  const [range, setRange] = useState<TrendRangeFilter>('all');
  const [visibleQuadrants, setVisibleQuadrants] = useState<
    Record<QuadrantId, boolean>
  >({
    'high-positive': true,
    'low-positive': true,
    'high-negative': true,
    'low-negative': true,
  });
  const [visibleAffect, setVisibleAffect] = useState<{
    avgValence: boolean;
    avgArousal: boolean;
  }>({
    avgValence: true,
    avgArousal: true,
  });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const summary = useMemo(
    () => buildDailyEmotionTrend(annotations, range),
    [annotations, range]
  );

  const { points } = summary;

  // 计算象限分布模式的 Y 轴上限（确保整数刻度美观且最小为 4）
  const maxQuadrantCount = useMemo(() => {
    let maxVal = 0;
    for (const point of points) {
      for (const qId of QUADRANT_ORDER) {
        if (visibleQuadrants[qId]) {
          maxVal = Math.max(maxVal, point.quadrantCounts[qId]);
        }
      }
    }
    if (maxVal <= 3) return 4;
    if (maxVal <= 8) return Math.ceil(maxVal / 2) * 2;
    return Math.ceil(maxVal / 4) * 4;
  }, [points, visibleQuadrants]);

  const yTicks = useMemo(() => {
    if (mode === 'affect') {
      return [1, 0.5, 0, -0.5, -1];
    }
    const step = maxQuadrantCount / 4;
    return [4, 3, 2, 1, 0].map((i) => Math.round(i * step * 10) / 10);
  }, [mode, maxQuadrantCount]);

  const getYPosition = (value: number): number => {
    if (mode === 'affect') {
      const clamped = Math.max(-1, Math.min(1, value));
      const normalized = (1 - clamped) / 2;
      return MARGIN.top + normalized * PLOT_HEIGHT;
    }
    const normalized = Math.max(0, Math.min(1, value / maxQuadrantCount));
    return MARGIN.top + (1 - normalized) * PLOT_HEIGHT;
  };

  // 控制横轴刻度密度，避免日期较多时文字重叠
  const xTickStep = useMemo(() => {
    if (points.length <= 8) return 1;
    return Math.ceil(points.length / 7);
  }, [points.length]);

  const activeIndex = useMemo(() => {
    if (hoveredIndex !== null && hoveredIndex < points.length) {
      return hoveredIndex;
    }
    if (selectedDate) {
      const idx = points.findIndex((p) => p.date === selectedDate);
      if (idx >= 0) return idx;
    }
    return null;
  }, [hoveredIndex, selectedDate, points]);

  const activePoint: DailyEmotionPoint | null =
    activeIndex !== null ? points[activeIndex] ?? null : null;

  const toggleQuadrantSeries = (qId: QuadrantId) => {
    setVisibleQuadrants((prev) => {
      const enabledCount = QUADRANT_ORDER.filter((id) => prev[id]).length;
      if (prev[qId] && enabledCount === 1) {
        return prev;
      }
      return { ...prev, [qId]: !prev[qId] };
    });
  };

  const toggleAffectSeries = (key: 'avgValence' | 'avgArousal') => {
    setVisibleAffect((prev) => {
      if (prev[key] && !prev[key === 'avgValence' ? 'avgArousal' : 'avgValence']) {
        return prev;
      }
      return { ...prev, [key]: !prev[key] };
    });
  };

  const handleDateClick = (date: string) => {
    onSelectDate(selectedDate === date ? null : date);
  };

  return (
    <section
      className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      aria-label="情绪时间分布趋势统计折线图"
    >
      {/* 头部标题与交互切换控制栏 */}
      <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            情绪随日期变化趋势
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {summary.dateSpanLabel}
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span>点击折线节点可按日期联动筛选下方日志</span>
            {hasActiveTableFilters && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="text-blue-700">已同步当前检索条件</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="tablist"
            aria-label="趋势图表维度"
          >
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={mode === opt.id}
                onClick={() => setMode(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  mode === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="tablist"
            aria-label="统计时间范围"
          >
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={range === opt.id}
                onClick={() => setRange(opt.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  range === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 周期关键统计指标条（无卡片嵌套，发丝线分隔） */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/50">
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">覆盖天数 / 样本数</p>
          <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {summary.dayCount} 天 / {summary.totalCount} 条
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">积极情绪占比</p>
          <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-emerald-700">
            {summary.totalCount > 0 ? `${summary.positiveRatio}%` : '—'}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">区间均值（V / A）</p>
          <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {summary.totalCount > 0
              ? `${formatCoord(summary.avgValence)} / ${formatCoord(summary.avgArousal)}`
              : '—'}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">日均效价波动率（SD）</p>
          <p className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-slate-900">
            {summary.dayCount > 0 ? summary.valenceVolatility.toFixed(2) : '—'}
          </p>
        </div>
      </div>

      {/* 折线图主画布区域 */}
      {points.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">
            当前筛选条件下暂无可绘制的日期统计数据
          </p>
          <p className="text-xs text-slate-500 mt-1">
            新增带有记录日期的情绪标注或放宽筛选条件后，系统将自动生成时间分布折线图。
          </p>
        </div>
      ) : (
        <div className="p-4 sm:p-5 space-y-4">
          {/* 交互式图例（点击可单独开关曲线） + 日期选中提示 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {mode === 'quadrant'
                ? QUADRANT_ORDER.map((qId) => {
                    const meta = QUADRANTS[qId];
                    const enabled = visibleQuadrants[qId];
                    return (
                      <button
                        key={qId}
                        type="button"
                        onClick={() => toggleQuadrantSeries(qId)}
                        aria-pressed={enabled}
                        className={`inline-flex items-center gap-2 text-xs font-medium transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded ${
                          enabled
                            ? 'text-slate-700 opacity-100'
                            : 'text-slate-400 opacity-50 line-through'
                        }`}
                      >
                        <span
                          className="w-3 h-0.5 rounded-full inline-block"
                          style={{ backgroundColor: meta.dotColor }}
                          aria-hidden="true"
                        />
                        <span>{meta.shortLabel}</span>
                      </button>
                    );
                  })
                : AFFECT_SERIES.map((series) => {
                    const enabled = visibleAffect[series.key];
                    return (
                      <button
                        key={series.key}
                        type="button"
                        onClick={() => toggleAffectSeries(series.key)}
                        aria-pressed={enabled}
                        className={`inline-flex items-center gap-2 text-xs font-medium transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-blue-600 rounded ${
                          enabled
                            ? 'text-slate-700 opacity-100'
                            : 'text-slate-400 opacity-50 line-through'
                        }`}
                      >
                        <span
                          className="w-3 h-0.5 rounded-full inline-block"
                          style={{ backgroundColor: series.color }}
                          aria-hidden="true"
                        />
                        <span>{series.label}</span>
                      </button>
                    );
                  })}
            </div>

            {selectedDate && (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span>
                  已锁定日期：
                  <span className="font-mono tabular-nums font-medium text-slate-900">
                    {selectedDate}
                  </span>
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onSelectDate(null)}
                  className="text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
                >
                  清除日期筛选
                </button>
              </div>
            )}
          </div>

          {/* 响应式 SVG 折线图 */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
              className="w-full min-w-[540px] h-auto select-none"
              role="img"
              aria-label={
                mode === 'quadrant'
                  ? '各情绪象限每日标注数量折线图'
                  : '每日平均效价与唤醒度波动折线图'
              }
              onMouseLeave={() => setHoveredIndex(null)}
            >
              {/* 水平网格线与 Y 轴刻度 */}
              {yTicks.map((tick) => {
                const y = getYPosition(tick);
                const isZeroBaseline = mode === 'affect' && tick === 0;
                return (
                  <g key={tick}>
                    <line
                      x1={MARGIN.left}
                      y1={y}
                      x2={CHART_WIDTH - MARGIN.right}
                      y2={y}
                      stroke={isZeroBaseline ? '#94A3B8' : '#E2E8F0'}
                      strokeWidth={isZeroBaseline ? 1.25 : 1}
                      strokeDasharray={isZeroBaseline ? '4 4' : undefined}
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono tabular-nums"
                    >
                      {mode === 'affect'
                        ? tick > 0
                          ? `+${tick.toFixed(1)}`
                          : tick.toFixed(1)
                        : Number.isInteger(tick)
                          ? String(tick)
                          : tick.toFixed(1)}
                    </text>
                  </g>
                );
              })}

              {/* Y 轴单位标注 */}
              <text
                x={MARGIN.left}
                y={12}
                textAnchor="start"
                className="fill-slate-400 text-[10px]"
              >
                {mode === 'quadrant' ? '标注条数' : '均值坐标 [-1, +1]'}
              </text>

              {/* 悬停或选中垂直辅助线 */}
              {activeIndex !== null && (
                <line
                  x1={getXPosition(activeIndex, points.length)}
                  y1={MARGIN.top}
                  x2={getXPosition(activeIndex, points.length)}
                  y2={MARGIN.top + PLOT_HEIGHT}
                  stroke="#CBD5E1"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}

              {/* 折线主体 */}
              {mode === 'quadrant'
                ? QUADRANT_ORDER.map((qId) => {
                    if (!visibleQuadrants[qId]) return null;
                    const meta = QUADRANTS[qId];
                    const coords = points.map((pt, idx) => ({
                      x: getXPosition(idx, points.length),
                      y: getYPosition(pt.quadrantCounts[qId]),
                    }));
                    return (
                      <g key={qId}>
                        {coords.length >= 2 && (
                          <path
                            d={buildLinePath(coords)}
                            fill="none"
                            stroke={meta.dotColor}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {coords.map((coord, idx) => {
                          const isHighlighted =
                            activeIndex === idx ||
                            selectedDate === points[idx].date;
                          return (
                            <circle
                              key={`${qId}-${points[idx].date}`}
                              cx={coord.x}
                              cy={coord.y}
                              r={isHighlighted ? 4.5 : 3}
                              fill={isHighlighted ? meta.dotColor : '#FFFFFF'}
                              stroke={meta.dotColor}
                              strokeWidth={2}
                            />
                          );
                        })}
                      </g>
                    );
                  })
                : AFFECT_SERIES.map((series) => {
                    if (!visibleAffect[series.key]) return null;
                    const coords = points.map((pt, idx) => ({
                      x: getXPosition(idx, points.length),
                      y: getYPosition(pt[series.key]),
                    }));
                    return (
                      <g key={series.key}>
                        {coords.length >= 2 && (
                          <path
                            d={buildLinePath(coords)}
                            fill="none"
                            stroke={series.color}
                            strokeWidth={2.25}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {coords.map((coord, idx) => {
                          const isHighlighted =
                            activeIndex === idx ||
                            selectedDate === points[idx].date;
                          return (
                            <circle
                              key={`${series.key}-${points[idx].date}`}
                              cx={coord.x}
                              cy={coord.y}
                              r={isHighlighted ? 4.5 : 3.25}
                              fill={isHighlighted ? series.color : '#FFFFFF'}
                              stroke={series.color}
                              strokeWidth={2}
                            />
                          );
                        })}
                      </g>
                    );
                  })}

              {/* X 轴日期标签 */}
              {points.map((pt, idx) => {
                const showLabel =
                  idx === 0 ||
                  idx === points.length - 1 ||
                  idx % xTickStep === 0;
                if (!showLabel) return null;
                const x = getXPosition(idx, points.length);
                const isSelected = selectedDate === pt.date;
                return (
                  <text
                    key={`xlabel-${pt.date}`}
                    x={x}
                    y={CHART_HEIGHT - 12}
                    textAnchor="middle"
                    className={`text-[10px] font-mono tabular-nums ${
                      isSelected
                        ? 'fill-blue-700 font-semibold'
                        : 'fill-slate-500'
                    }`}
                  >
                    {pt.shortDate}
                  </text>
                );
              })}

              {/* 透明列级交互热区（支持悬停、点击和键盘聚焦） */}
              {points.map((pt, idx) => {
                const x = getXPosition(idx, points.length);
                const step =
                  points.length > 1 ? PLOT_WIDTH / (points.length - 1) : PLOT_WIDTH;
                const hitWidth = Math.max(24, Math.min(step, 72));
                return (
                  <rect
                    key={`hit-${pt.date}`}
                    x={x - hitWidth / 2}
                    y={MARGIN.top}
                    width={hitWidth}
                    height={PLOT_HEIGHT}
                    fill="transparent"
                    className="cursor-pointer focus:outline-none"
                    tabIndex={0}
                    role="button"
                    aria-label={`${pt.date}，共 ${pt.count} 条记录，日均效价 ${formatCoord(pt.avgValence)}，日均唤醒度 ${formatCoord(pt.avgArousal)}，点击按该日期筛选`}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onFocus={() => setHoveredIndex(idx)}
                    onBlur={() => setHoveredIndex(null)}
                    onClick={() => handleDateClick(pt.date)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleDateClick(pt.date);
                      }
                    }}
                  />
                );
              })}
            </svg>
          </div>

          {/* 底部单日详情读数条（悬停或选中日期时即时展示，无浮层遮挡折线） */}
          <div className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            {activePoint ? (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {activePoint.date}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>
                    共{' '}
                    <strong className="font-mono tabular-nums text-slate-900">
                      {activePoint.count}
                    </strong>{' '}
                    条
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>
                    高频标签：
                    <strong className="text-slate-900">
                      {activePoint.dominantLabel}
                    </strong>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono tabular-nums">
                    效价 {formatCoord(activePoint.avgValence)} / 唤醒度{' '}
                    {formatCoord(activePoint.avgArousal)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-slate-600">
                  {QUADRANT_ORDER.map((qId) => (
                    <span key={qId} className={QUADRANTS[qId].accentText}>
                      {QUADRANTS[qId].shortLabel} {activePoint.quadrantCounts[qId]}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-slate-500">
                {points.length === 1
                  ? '当前仅包含 1 个日期的数据点；新增不同日期的标注后将自动连成连续趋势曲线。'
                  : '将鼠标移至折线节点可查看单日象限细分与日均坐标，点击节点可筛选该日记录。'}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
