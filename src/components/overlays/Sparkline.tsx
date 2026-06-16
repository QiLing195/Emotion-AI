// v5.25: SVG Sparkline — 纯 SVG 迷你趋势图，无外部依赖

import React from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;        // 线的颜色
  showDot?: boolean;     // 最后一个点
  showArea?: boolean;    // 底部渐变填充
  className?: string;
}

export default function Sparkline({
  data,
  width = 64,
  height = 18,
  color = '#818cf8',     // indigo-400
  showDot = true,
  showArea = false,
  className,
}: SparklineProps) {
  // 过滤无效值
  const valid = data.filter(v => typeof v === 'number' && !isNaN(v) && v !== -1);
  if (valid.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke="#334155" strokeWidth={0.5} strokeDasharray="2 2"
        />
      </svg>
    );
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1; // 防止除零（常量序列）

  const padding = 2; // 上下留白
  const chartH = height - padding * 2;
  const stepX = valid.length > 1 ? width / (valid.length - 1) : 0;

  // 将值映射到 SVG y 坐标（SVG y=0 在顶部）
  const points = valid.map((v, i) => {
    const x = i * stepX;
    const y = padding + chartH - ((v - min) / range) * chartH;
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  const areaPath = points.length > 0
    ? `${polyline} ${width},${height} 0,${height}`
    : '';

  const gradientId = `sparkline-grad-${color.replace('#', '')}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* 渐变填充 */}
      {showArea && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}

      {/* 底部参考线 */}
      <line
        x1={0} y1={height - 1} x2={width} y2={height - 1}
        stroke="#1e293b" strokeWidth={0.5}
      />

      {/* 面积填充 */}
      {showArea && (
        <polygon points={areaPath} fill={`url(#${gradientId})`} />
      )}

      {/* 折线 */}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 末点 */}
      {showDot && valid.length > 0 && (
        <circle
          cx={(valid.length - 1) * stepX}
          cy={padding + chartH - ((valid[valid.length - 1] - min) / range) * chartH}
          r={1.5}
          fill={color}
          stroke="transparent"
          strokeWidth={0}
        />
      )}
    </svg>
  );
}
