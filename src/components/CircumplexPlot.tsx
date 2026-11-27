import React, { useRef, useState } from 'react';
import {
  AFFECT_LEXICON,
  EmotionAnnotation,
  QUADRANTS,
  clampCoord,
  formatCoord,
} from '../data/affectLexicon';

interface CircumplexPlotProps {
  valence: number;
  arousal: number;
  annotations: EmotionAnnotation[];
  selectedAnnotationId: string | null;
  onChange: (valence: number, arousal: number) => void;
  onSelectAnnotation: (annotation: EmotionAnnotation) => void;
}

const VIEW_SIZE = 440;
const PAD = 44;
const PLOT_SPAN = VIEW_SIZE - PAD * 2;
const CENTER = VIEW_SIZE / 2;
const RADIUS = PLOT_SPAN / 2;

function toSvgX(valence: number): number {
  return CENTER + valence * RADIUS;
}

function toSvgY(arousal: number): number {
  return CENTER - arousal * RADIUS;
}

export const CircumplexPlot: React.FC<CircumplexPlotProps> = ({
  valence,
  arousal,
  annotations,
  selectedAnnotationId,
  onChange,
  onSelectAnnotation,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const updateFromClientPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * VIEW_SIZE;
    const relY = ((clientY - rect.top) / rect.height) * VIEW_SIZE;
    const nextValence = clampCoord((relX - CENTER) / RADIUS);
    const nextArousal = clampCoord((CENTER - relY) / RADIUS);
    onChange(nextValence, nextArousal);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const target = event.target as HTMLElement | SVGElement;
    if (target.dataset.pointInteractive === 'true') {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateFromClientPoint(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    updateFromClientPoint(event.clientX, event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const step = event.shiftKey ? 0.1 : 0.05;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onChange(clampCoord(valence + step), arousal);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onChange(clampCoord(valence - step), arousal);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      onChange(valence, clampCoord(arousal + step));
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onChange(valence, clampCoord(arousal - step));
    }
  };

  const activeX = toSvgX(valence);
  const activeY = toSvgY(arousal);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            效价—唤醒度环形平面
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            点击或拖拽平面任意位置定位情绪坐标，也可使用键盘方向键微调。
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(0, 0)}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0"
        >
          重置原点
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center py-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
          role="application"
          tabIndex={0}
          aria-label={`效价与唤醒度环形平面。当前效价 ${formatCoord(valence)}，唤醒度 ${formatCoord(arousal)}。可使用方向键调整。`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="w-full max-w-[440px] aspect-square select-none touch-none rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 cursor-crosshair"
        >
          {/* 象限柔和底色 */}
          <rect x={CENTER} y={PAD} width={RADIUS} height={RADIUS} fill="#F0FDF4" fillOpacity="0.55" />
          <rect x={PAD} y={PAD} width={RADIUS} height={RADIUS} fill="#FEF2F2" fillOpacity="0.55" />
          <rect x={PAD} y={CENTER} width={RADIUS} height={RADIUS} fill="#FFFBEB" fillOpacity="0.55" />
          <rect x={CENTER} y={CENTER} width={RADIUS} height={RADIUS} fill="#F0F9FF" fillOpacity="0.55" />

          {/* 边框 */}
          <rect
            x={PAD}
            y={PAD}
            width={PLOT_SPAN}
            height={PLOT_SPAN}
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="1"
          />

          {/* 同心强度环 */}
          {[0.33, 0.66, 1].map((ring) => (
            <circle
              key={ring}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS * ring}
              fill="none"
              stroke="#CBD5E1"
              strokeWidth="1"
              strokeDasharray={ring === 1 ? undefined : '3 3'}
            />
          ))}

          {/* 坐标轴 */}
          <line
            x1={PAD}
            y1={CENTER}
            x2={VIEW_SIZE - PAD}
            y2={CENTER}
            stroke="#94A3B8"
            strokeWidth="1.25"
          />
          <line
            x1={CENTER}
            y1={PAD}
            x2={CENTER}
            y2={VIEW_SIZE - PAD}
            stroke="#94A3B8"
            strokeWidth="1.25"
          />

          {/* 轴标签 */}
          <text
            x={CENTER}
            y={22}
            textAnchor="middle"
            className="fill-slate-600 text-[11px] font-medium"
          >
            高唤醒 (+1.0)
          </text>
          <text
            x={CENTER}
            y={VIEW_SIZE - 14}
            textAnchor="middle"
            className="fill-slate-600 text-[11px] font-medium"
          >
            低唤醒 (-1.0)
          </text>
          <text
            x={16}
            y={CENTER}
            textAnchor="middle"
            transform={`rotate(-90 16 ${CENTER})`}
            className="fill-slate-600 text-[11px] font-medium"
          >
            消极效价 (-1.0)
          </text>
          <text
            x={VIEW_SIZE - 16}
            y={CENTER}
            textAnchor="middle"
            transform={`rotate(90 ${VIEW_SIZE - 16} ${CENTER})`}
            className="fill-slate-600 text-[11px] font-medium"
          >
            积极效价 (+1.0)
          </text>

          {/* 词库参考锚点 */}
          {AFFECT_LEXICON.map((term) => {
            const x = toSvgX(term.valence);
            const y = toSvgY(term.arousal);
            return (
              <g
                key={term.id}
                data-point-interactive="true"
                onClick={() => onChange(term.valence, term.arousal)}
                className="cursor-pointer group"
              >
                <circle
                  data-point-interactive="true"
                  cx={x}
                  cy={y}
                  r={3}
                  className="fill-slate-300 group-hover:fill-blue-600 transition-colors"
                />
                <text
                  data-point-interactive="true"
                  x={x}
                  y={y - 7}
                  textAnchor="middle"
                  className="fill-slate-500 group-hover:fill-slate-900 text-[10px] font-medium transition-colors"
                >
                  {term.label}
                </text>
              </g>
            );
          })}

          {/* 已保存的标注点 */}
          {annotations.map((ann) => {
            const x = toSvgX(ann.valence);
            const y = toSvgY(ann.arousal);
            const isSelected = ann.id === selectedAnnotationId;
            const color = QUADRANTS[ann.quadrant].dotColor;
            return (
              <g
                key={ann.id}
                data-point-interactive="true"
                onClick={() => onSelectAnnotation(ann)}
                className="cursor-pointer"
              >
                <title>
                  {`${ann.primaryLabel}（效价 ${formatCoord(ann.valence)}，唤醒度 ${formatCoord(ann.arousal)}）：${ann.utterance}`}
                </title>
                <circle
                  data-point-interactive="true"
                  cx={x}
                  cy={y}
                  r={isSelected ? 7 : 5}
                  fill={color}
                  fillOpacity={isSelected ? 0.95 : 0.72}
                  stroke="#FFFFFF"
                  strokeWidth={1.75}
                />
              </g>
            );
          })}

          {/* 当前准星 */}
          <line
            x1={activeX}
            y1={PAD}
            x2={activeX}
            y2={VIEW_SIZE - PAD}
            stroke="#2563EB"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeOpacity="0.45"
          />
          <line
            x1={PAD}
            y1={activeY}
            x2={VIEW_SIZE - PAD}
            y2={activeY}
            stroke="#2563EB"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeOpacity="0.45"
          />

          {/* 当前激活标记 */}
          <circle
            cx={activeX}
            cy={activeY}
            r={12}
            fill="#2563EB"
            fillOpacity="0.14"
          />
          <circle
            cx={activeX}
            cy={activeY}
            r={6}
            fill="#2563EB"
            stroke="#FFFFFF"
            strokeWidth="2"
          />
        </svg>
      </div>

      <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-3 font-mono tabular-nums text-slate-700">
          <span>效价 {formatCoord(valence)}</span>
          <span className="text-slate-300" aria-hidden="true">/</span>
          <span>唤醒度 {formatCoord(arousal)}</span>
        </div>
        <span>平面已绘制 {annotations.length} 条标注</span>
      </div>
    </div>
  );
};
