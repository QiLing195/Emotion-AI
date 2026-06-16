// v6.0: 认知示波器 — Cognitive Oscilloscope
// 从事件日志升级为真正的认知动力学分析器
// Layer 0: 认知场背景 (phase bands)
// Layer 1: 情感波形 (valence/arousal)
// Layer 4: 事件泳道 (event swimlane)
// 支持时间缩放、点击展开因果链

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Clock, Brain, ZoomIn, ZoomOut, Pause, Play, Activity } from 'lucide-react';
import { useCognitiveTimeline, STRATEGY_COLORS, ZOOM_WINDOWS, type ZoomLevel, type TimelineEvent, type EmotionSample, type PhaseBand, type StrategySpan, type CuriositySample } from './useCognitiveTimeline';
import { EVENT_META } from '../../eventBus';

// ── 颜色常量 ──
const BG = '#0f172a';
const GRID = '#1e293b';
const TEXT_DIM = '#64748b';
const TEXT_BRIGHT = '#94a3b8';
const PHASE_COLORS: Record<string, string> = {
  R1: 'rgba(74,222,128,0.15)',   // green
  R2: 'rgba(96,165,250,0.15)',   // blue
  R3: 'rgba(167,139,250,0.15)',  // violet
  R4: 'rgba(251,146,60,0.15)',   // orange
  R5: 'rgba(148,163,184,0.12)',  // slate
};
const PHASE_STROKES: Record<string, string> = {
  R1: '#4ade80', R2: '#60a5fa', R3: '#a78bfa', R4: '#fb923c', R5: '#94a3b8',
};
const PHASE_LABELS: Record<string, string> = {
  R1: '初识', R2: '确认', R3: '深化', R4: '成熟', R5: '危机',
};
const SOURCE_COLORS: Record<string, string> = {
  user: '#60a5fa', curiosity: '#34d399', autonomy: '#fbbf24',
  strategy: '#a78bfa', emotion: '#f87171', system: '#94a3b8',
  memory: '#c084fc', world: '#fb923c',
};

// ── 布局常量 ──
const CANVAS_W = 860;
const CANVAS_H = 580;
const PADDING = { top: 6, bottom: 32, left: 48, right: 16 };
const PHASE_H = 24;
const EMOTION_H = 120;
const CURIOSITY_H = 56;
const STRATEGY_H = 22;
const EMOTION_Y = PADDING.top + PHASE_H + 2;
const CURIOSITY_Y = EMOTION_Y + EMOTION_H + 2;
const STRATEGY_Y = CURIOSITY_Y + CURIOSITY_H + 2;
const EVENT_Y = STRATEGY_Y + STRATEGY_H + 2;
const EVENT_H = CANVAS_H - EVENT_Y - PADDING.bottom;
const PLOT_W = CANVAS_W - PADDING.left - PADDING.right;

// ── 辅助函数 ──
function timeToX(ts: number, viewStart: number, viewEnd: number): number {
  const range = viewEnd - viewStart || 1;
  return PADDING.left + ((ts - viewStart) / range) * PLOT_W;
}

function xToTime(x: number, viewStart: number, viewEnd: number): number {
  const range = viewEnd - viewStart || 1;
  return viewStart + ((x - PADDING.left) / PLOT_W) * range;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ══════════════════════════════════════════════════════
// Canvas 渲染器
// ══════════════════════════════════════════════════════

function drawGrid(ctx: CanvasRenderingContext2D, viewStart: number, viewEnd: number) {
  const range = viewEnd - viewStart;
  // 自动选择合适的时间刻度
  let interval: number;
  if (range <= 20_000) interval = 2000;
  else if (range <= 70_000) interval = 5000;
  else if (range <= 360_000) interval = 30_000;
  else if (range <= 1_200_000) interval = 120_000;
  else interval = 600_000;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 0.5;
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';

  let t = Math.ceil(viewStart / interval) * interval;
  while (t <= viewEnd) {
    const x = timeToX(t, viewStart, viewEnd);
    ctx.beginPath();
    ctx.moveTo(x, PADDING.top);
    ctx.lineTo(x, CANVAS_H - PADDING.bottom);
    ctx.stroke();

    const label = range > 600_000 ? formatTimeShort(t) : new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: range <= 70_000 ? '2-digit' : undefined });
    ctx.fillText(label, x, CANVAS_H - 10);
    t += interval;
  }
}

function drawPhaseBands(
  ctx: CanvasRenderingContext2D,
  bands: PhaseBand[],
  viewStart: number,
  viewEnd: number,
) {
  const y = PADDING.top;
  const h = PHASE_H;

  for (const band of bands) {
    const x1 = Math.max(PADDING.left, timeToX(band.from, viewStart, viewEnd));
    const x2 = Math.min(CANVAS_W - PADDING.right, timeToX(band.to, viewStart, viewEnd));
    if (x2 < PADDING.left || x1 > CANVAS_W - PADDING.right) continue;

    const color = PHASE_COLORS[band.phase] || PHASE_COLORS.R1;
    const stroke = PHASE_STROKES[band.phase] || PHASE_STROKES.R1;
    const label = PHASE_LABELS[band.phase] || band.phase;

    ctx.fillStyle = color;
    ctx.fillRect(x1, y, x2 - x1, h);

    // 顶部细线标记阶段边界
    if (x1 > PADDING.left) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x1, y + h);
      ctx.stroke();
    }

    // 阶段标签（如果宽度足够）
    if (x2 - x1 > 40) {
      ctx.fillStyle = stroke;
      ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, (x1 + x2) / 2, y + h / 2 + 4);
    }
  }

  // 左侧标签
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('阶段', PADDING.left - 6, y + h / 2 + 3);
}

function drawEmotionWaveform(
  ctx: CanvasRenderingContext2D,
  samples: EmotionSample[],
  viewStart: number,
  viewEnd: number,
) {
  if (samples.length < 2) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('等待情感数据...', CANVAS_W / 2, EMOTION_Y + EMOTION_H / 2);
    return;
  }

  const y = EMOTION_Y;
  const h = EMOTION_H;

  // 裁剪区域
  ctx.save();
  ctx.beginPath();
  ctx.rect(PADDING.left, y, PLOT_W, h);
  ctx.clip();

  // 零线
  const zeroY = y + h / 2;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(PADDING.left, zeroY);
  ctx.lineTo(CANVAS_W - PADDING.right, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Valence 面积（暖色）
  ctx.beginPath();
  const firstV = samples[0];
  ctx.moveTo(timeToX(firstV.timestamp, viewStart, viewEnd), zeroY - (firstV.valence * h * 0.45));
  for (let i = 1; i < samples.length; i++) {
    const sx = timeToX(samples[i].timestamp, viewStart, viewEnd);
    const sy = zeroY - (samples[i].valence * h * 0.45);
    ctx.lineTo(sx, sy);
  }
  // 闭合到底部
  const lastX = timeToX(samples[samples.length - 1].timestamp, viewStart, viewEnd);
  ctx.lineTo(lastX, zeroY);
  ctx.closePath();
  const valenceGrad = ctx.createLinearGradient(0, y, 0, y + h);
  valenceGrad.addColorStop(0, 'rgba(248,113,113,0.25)');
  valenceGrad.addColorStop(0.5, 'rgba(248,113,113,0.05)');
  valenceGrad.addColorStop(1, 'rgba(96,165,250,0.15)');
  ctx.fillStyle = valenceGrad;
  ctx.fill();

  // Valence 线
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(timeToX(firstV.timestamp, viewStart, viewEnd), zeroY - (firstV.valence * h * 0.45));
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(timeToX(samples[i].timestamp, viewStart, viewEnd), zeroY - (samples[i].valence * h * 0.45));
  }
  ctx.stroke();

  // Arousal 线
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(timeToX(firstV.timestamp, viewStart, viewEnd), y + h - (firstV.arousal * h * 0.8));
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(timeToX(samples[i].timestamp, viewStart, viewEnd), y + h - (samples[i].arousal * h * 0.8));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.restore();

  // Y 轴标签
  ctx.fillStyle = '#f87171';
  ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('+1', PADDING.left - 6, y + 4);
  ctx.fillText('效价', PADDING.left - 6, y + 14);
  ctx.fillText(' 0', PADDING.left - 6, zeroY + 3);
  ctx.fillText('−1', PADDING.left - 6, y + h - 4);

  ctx.fillStyle = '#fb923c';
  ctx.fillText('唤醒', PADDING.left - 6, y + h - 14);
}

function drawCuriosityLoad(
  ctx: CanvasRenderingContext2D,
  samples: CuriositySample[],
  viewStart: number,
  viewEnd: number,
) {
  const y = CURIOSITY_Y;
  const h = CURIOSITY_H;
  const baseline = y + h - 2;

  if (samples.length < 2) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('等待好奇心数据...', CANVAS_W / 2, y + h / 2);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(PADDING.left, y, PLOT_W, h);
  ctx.clip();

  // 认知负载面积（暖色，上半部分）
  const loadTop = y + 4;
  const loadH = h * 0.55;
  ctx.beginPath();
  const firstS = samples[0];
  let sx = timeToX(firstS.timestamp, viewStart, viewEnd);
  let sy = loadTop + loadH - (firstS.cognitiveLoad * loadH);
  ctx.moveTo(sx, sy);
  for (let i = 1; i < samples.length; i++) {
    sx = timeToX(samples[i].timestamp, viewStart, viewEnd);
    sy = loadTop + loadH - (samples[i].cognitiveLoad * loadH);
    ctx.lineTo(sx, sy);
  }
  ctx.lineTo(sx, loadTop + loadH);
  ctx.lineTo(timeToX(firstS.timestamp, viewStart, viewEnd), loadTop + loadH);
  ctx.closePath();
  const loadGrad = ctx.createLinearGradient(0, loadTop, 0, loadTop + loadH);
  loadGrad.addColorStop(0, 'rgba(251,146,60,0.2)');
  loadGrad.addColorStop(1, 'rgba(251,146,60,0.02)');
  ctx.fillStyle = loadGrad;
  ctx.fill();

  // 认知负载线
  ctx.strokeStyle = '#fb923c';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(timeToX(firstS.timestamp, viewStart, viewEnd), loadTop + loadH - (firstS.cognitiveLoad * loadH));
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(timeToX(samples[i].timestamp, viewStart, viewEnd), loadTop + loadH - (samples[i].cognitiveLoad * loadH));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 好奇心柱状图（下半部分）
  const barY = loadTop + loadH + 4;
  const barH = h - loadH - 8;
  const maxInterests = Math.max(10, ...samples.map(s => s.activeInterests));
  const barW = Math.max(1.5, Math.min(8, PLOT_W / samples.length * 0.5));

  for (const sample of samples) {
    const bx = timeToX(sample.timestamp, viewStart, viewEnd);
    const bh = Math.max(1, (sample.activeInterests / maxInterests) * barH);
    ctx.fillStyle = sample.activeInterests > 5 ? 'rgba(52,211,153,0.6)' : 'rgba(52,211,153,0.3)';
    ctx.fillRect(bx - barW / 2, baseline - bh, barW, bh);
  }

  // 活跃探索标记
  for (const sample of samples) {
    if (sample.explorationCount > 0) {
      const ex = timeToX(sample.timestamp, viewStart, viewEnd);
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(ex, baseline - barH - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // 标签
  ctx.fillStyle = '#fb923c';
  ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('负载', PADDING.left - 6, loadTop + 10);

  ctx.fillStyle = '#34d399';
  ctx.fillText('好奇', PADDING.left - 6, barY + 8);
  ctx.fillText(`${samples[samples.length - 1]?.activeInterests || 0}`, PADDING.left - 6, barY + 18);
}

function drawStrategyTimeline(
  ctx: CanvasRenderingContext2D,
  spans: StrategySpan[],
  viewStart: number,
  viewEnd: number,
) {
  const y = STRATEGY_Y;
  const h = STRATEGY_H;

  ctx.fillStyle = 'rgba(15,23,42,0.4)';
  ctx.fillRect(PADDING.left, y, PLOT_W, h);

  // 标签
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('策略', PADDING.left - 6, y + h / 2 + 3);

  if (spans.length === 0) {
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '10px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('无策略数据', CANVAS_W / 2, y + h / 2 + 3);
    return;
  }

  for (const span of spans) {
    const x1 = Math.max(PADDING.left, timeToX(span.from, viewStart, viewEnd));
    const x2 = Math.min(CANVAS_W - PADDING.right, timeToX(span.to, viewStart, viewEnd));
    if (x2 < PADDING.left || x1 > CANVAS_W - PADDING.right) continue;

    const color = STRATEGY_COLORS[span.strategy] || '#6b7280';
    const padY = 3;

    // 色块
    ctx.fillStyle = color.replace(')', ',0.25)').replace('rgb', 'rgba');
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
    }
    ctx.fillRect(x1, y + padY, Math.max(2, x2 - x1), h - padY * 2);

    // 上边线
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x1, y + padY);
    ctx.lineTo(x2, y + padY);
    ctx.stroke();

    // 标签（如果宽度足够）
    if (x2 - x1 > 30) {
      ctx.fillStyle = color;
      ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      const label = span.strategy === 'empathize' ? '共情' : span.strategy === 'redirect' ? '转移' : span.strategy === 'explore' ? '探索' : span.strategy === 'accompany' ? '陪伴' : span.strategy === 'share' ? '分享' : span.strategy === 'repair' ? '修复' : '中性';
      ctx.fillText(label, (x1 + x2) / 2, y + h / 2 + 3);
    }
  }
}

function drawEventSwimlane(
  ctx: CanvasRenderingContext2D,
  events: TimelineEvent[],
  viewStart: number,
  viewEnd: number,
  hoveredEventId: string | null,
  selectedEventId: string | null,
) {
  const y = EVENT_Y;
  const h = EVENT_H;

  // 背景
  ctx.fillStyle = 'rgba(15,23,42,0.6)';
  ctx.fillRect(PADDING.left, y, PLOT_W, h);

  // 来源分类的 Y 层级
  const sources = ['user', 'curiosity', 'autonomy', 'strategy', 'emotion', 'system'];
  const rowH = h / sources.length;

  // 行标签和分隔线
  sources.forEach((src, i) => {
    const ry = y + i * rowH;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = '9px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(src === 'user' ? '用户' : src === 'curiosity' ? '好奇' : src === 'autonomy' ? '自主' : src === 'strategy' ? '策略' : src === 'emotion' ? '情感' : '系统', PADDING.left - 6, ry + rowH / 2 + 3);

    if (i > 0) {
      ctx.strokeStyle = 'rgba(30,41,59,0.5)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(PADDING.left, ry);
      ctx.lineTo(CANVAS_W - PADDING.right, ry);
      ctx.stroke();
    }
  });

  // 事件点
  const DOT_R = 3.5;
  const now = Date.now();
  for (const evt of events) {
    const srcIdx = sources.indexOf(evt.source);
    const rowIdx = srcIdx >= 0 ? srcIdx : sources.length - 1;
    const cy = y + rowIdx * rowH + rowH / 2;
    const cx = timeToX(evt.timestamp, viewStart, viewEnd);
    if (cx < PADDING.left - 5 || cx > CANVAS_W - PADDING.right + 5) continue;

    const isSelected = evt.id === selectedEventId;
    const isHovered = evt.id === hoveredEventId;
    const color = SOURCE_COLORS[evt.source] || '#94a3b8';
    const r = isSelected ? DOT_R + 3 : isHovered ? DOT_R + 1.5 : DOT_R;
    const alpha = evt.timestamp > now - 60_000 ? 1 : evt.timestamp > now - 300_000 ? 0.85 : 0.55;

    // 光晕（选中/悬停）
    if (isSelected || isHovered) {
      ctx.fillStyle = color.replace(')', `,${isSelected ? 0.3 : 0.18})`).replace('rgb', 'rgba');
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // 重要事件加边框
    if (evt.type === 'ReversalTriggered' || evt.type === 'PhaseTransitioned') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // 选中事件竖线
  if (selectedEventId) {
    const sel = events.find(e => e.id === selectedEventId);
    if (sel) {
      const sx = timeToX(sel.timestamp, viewStart, viewEnd);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  event: TimelineEvent,
  viewStart: number,
  viewEnd: number,
) {
  const cx = timeToX(event.timestamp, viewStart, viewEnd);
  const cy = EVENT_Y + EVENT_H / 2;

  const lines = [
    event._label,
    formatTime(event.timestamp),
    event.data ? JSON.stringify(event.data).slice(0, 60) : '-',
  ];

  const font = '10px "PingFang SC", "Microsoft YaHei", monospace';
  ctx.font = font;
  const textWidths = lines.map(l => ctx.measureText(l).width);
  const maxW = Math.max(...textWidths);
  const lineH = 14;
  const padX = 8;
  const padY = 4;
  const boxW = maxW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;

  let boxX = cx + 10;
  let boxY = cy - boxH - 10;
  if (boxX + boxW > CANVAS_W) boxX = cx - boxW - 10;
  if (boxY < 0) boxY = cy + 10;

  // 背景
  ctx.fillStyle = 'rgba(15,23,42,0.95)';
  ctx.strokeStyle = event._color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 4);
  ctx.fill();
  ctx.stroke();

  // 文本
  ctx.fillStyle = '#e2e8f0';
  ctx.font = font;
  ctx.textAlign = 'left';
  lines.forEach((l, i) => {
    ctx.fillText(l, boxX + padX, boxY + padY + lineH * (i + 1) - 2);
  });
}

// ══════════════════════════════════════════════════════
// 主组件
// ══════════════════════════════════════════════════════

export default function CognitiveOscilloscope({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, paused, setPaused, zoom, setZoom, setViewEnd, refresh } = useCognitiveTimeline();

  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; viewStart: number; viewEnd: number } | null>(null);

  // ── 渲染 ──
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    ctx.scale(dpr, dpr);

    // 清屏
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawGrid(ctx, data.viewStart, data.viewEnd);
    drawPhaseBands(ctx, data.phaseBands, data.viewStart, data.viewEnd);
    drawEmotionWaveform(ctx, data.emotionSamples, data.viewStart, data.viewEnd);
    drawCuriosityLoad(ctx, data.curiositySamples, data.viewStart, data.viewEnd);
    drawStrategyTimeline(ctx, data.strategySpans, data.viewStart, data.viewEnd);
    drawEventSwimlane(ctx, data.events, data.viewStart, data.viewEnd, hoveredEvent?.id ?? null, selectedEvent?.id ?? null);

    if (hoveredEvent && hoveredEvent.id !== selectedEvent?.id) {
      drawHoverTooltip(ctx, hoveredEvent, data.viewStart, data.viewEnd);
    }
  }, [data, hoveredEvent, selectedEvent]);

  useEffect(() => {
    render();
  }, [render]);

  // ── 鼠标交互 ──
  const findEventAt = useCallback((mx: number, my: number): TimelineEvent | null => {
    const sources = ['user', 'curiosity', 'autonomy', 'strategy', 'emotion', 'system'];
    const rowH = EVENT_H / sources.length;
    const relY = my - EVENT_Y;
    if (relY < 0 || relY > EVENT_H) return null;

    const rowIdx = Math.floor(relY / rowH);
    const source = sources[Math.min(rowIdx, sources.length - 1)];

    // 找到该 source 下离点击位置最近的事件
    let closest: TimelineEvent | null = null;
    let minDist = 15; // max hit radius in pixels
    for (const evt of data.events) {
      if (evt.source !== source) continue;
      const cx = timeToX(evt.timestamp, data.viewStart, data.viewEnd);
      const cy = EVENT_Y + rowIdx * rowH + rowH / 2;
      const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closest = evt;
      }
    }
    return closest;
  }, [data]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);

    if (isDragging && dragStart) {
      const dx = (e.clientX - dragStart.x) * (CANVAS_W / rect.width);
      const timeRange = dragStart.viewEnd - dragStart.viewStart;
      const timeDelta = -(dx / PLOT_W) * timeRange;
      setViewEnd(prev => prev + timeDelta);
      setDragStart({ x: e.clientX, viewStart: dragStart.viewStart, viewEnd: dragStart.viewEnd });
      return;
    }

    const found = findEventAt(mx, my);
    setHoveredEvent(found);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = found ? 'pointer' : isDragging ? 'grabbing' : 'default';
    }
  }, [isDragging, dragStart, findEventAt, setViewEnd]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, viewStart: data.viewStart, viewEnd: data.viewEnd });
  }, [data]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && dragStart) {
      const dx = Math.abs(e.clientX - dragStart.x);
      if (dx < 5) {
        // 是点击，不是拖拽
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
          const my = (e.clientY - rect.top) * (CANVAS_H / rect.height);
          const found = findEventAt(mx, my);
          setSelectedEvent(found);
        }
      }
    }
    setIsDragging(false);
    setDragStart(null);
  }, [isDragging, dragStart, findEventAt]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zooms: ZoomLevel[] = ['15s', '1m', '5m', '15m', '1h', 'all'];
    const idx = zooms.indexOf(zoom);
    if (e.deltaY < 0 && idx > 0) setZoom(zooms[idx - 1]);
    if (e.deltaY > 0 && idx < zooms.length - 1) setZoom(zooms[idx + 1]);
  }, [zoom, setZoom]);

  // ── 因果链数据 ──
  const causalityEvents = selectedEvent?.correlationId
    ? data.events.filter(e => e.correlationId === selectedEvent.correlationId).sort((a, b) => a.timestamp - b.timestamp)
    : [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-slate-900 shadow-2xl" style={{ width: '920px', maxWidth: '100vw' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-sm text-slate-100">认知示波器</span>
          <span className="text-[11px] text-slate-500">({data.totalEvents} 事件, {data.emotionSamples.length} 采样)</span>
          {data.closedLoopRate !== null && (
            <span className={`text-[11px] ml-2 px-1.5 py-0.5 rounded ${data.closedLoopRate >= 50 ? 'bg-emerald-900/50 text-emerald-400' : 'bg-amber-900/50 text-amber-400'}`}>
              闭环率 {data.closedLoopRate}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {(['15s', '1m', '5m', '15m', '1h', 'all'] as ZoomLevel[]).map(z => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                zoom === z
                  ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300'
                  : 'border-slate-700 bg-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {z}
            </button>
          ))}
          <button
            onClick={() => { setPaused(!paused); refresh(); }}
            className={`p-1.5 rounded text-xs ${paused ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300'} hover:opacity-80`}
            title={paused ? '恢复实时' : '暂停'}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-hidden bg-slate-950 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          style={{ width: CANVAS_W, height: CANVAS_H }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setIsDragging(false); setHoveredEvent(null); }}
          onWheel={handleWheel}
        />
      </div>

      {/* Inspector Footer */}
      {selectedEvent && (
        <div className="h-44 border-t border-slate-700 bg-slate-800/80 shrink-0 overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedEvent._color }} />
              <span className="text-xs font-medium text-slate-200">{selectedEvent._label}</span>
              <span className="text-[11px] text-slate-500">{formatTime(selectedEvent.timestamp)}</span>
              <span className="text-[10px] text-slate-600">{selectedEvent.id}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedEvent.correlationId && (
                <span className="text-[10px] text-indigo-400">链: {selectedEvent.correlationId.slice(-12)}</span>
              )}
              <button onClick={() => setSelectedEvent(null)} className="text-slate-500 hover:text-slate-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex gap-0">
            {/* 事件详情 */}
            <div className="flex-1 p-3">
              <div className="text-[11px] text-slate-400 mb-1">Payload</div>
              <pre className="text-[11px] text-slate-300 font-mono bg-slate-900/50 rounded p-2 max-h-20 overflow-auto whitespace-pre-wrap">
                {selectedEvent.data ? JSON.stringify(selectedEvent.data, null, 2) : '(无数据)'}
              </pre>
            </div>

            {/* 因果链 */}
            {causalityEvents.length > 1 && (
              <div className="w-72 border-l border-slate-700/50 p-3">
                <div className="text-[11px] text-amber-400 mb-1">
                  认知链 ({causalityEvents.length})
                </div>
                <div className="space-y-1 max-h-24 overflow-auto">
                  {causalityEvents.map((e, i) => (
                    <div
                      key={e.id}
                      onClick={() => setSelectedEvent(e)}
                      className={`flex items-center gap-1.5 text-[10px] rounded px-1.5 py-0.5 cursor-pointer transition-colors ${
                        e.id === selectedEvent.id ? 'bg-indigo-900/40 text-indigo-300' : 'text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: e._color }} />
                      <span className="text-slate-500 w-14 shrink-0">{formatTime(e.timestamp)}</span>
                      <span className="text-amber-600">{i > 0 ? '←' : '●'}</span>
                      <span className="truncate">{e._label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 空状态提示 */}
      {!selectedEvent && data.events.length > 0 && (
        <div className="h-8 border-t border-slate-800 bg-slate-900 flex items-center px-4 shrink-0">
          <span className="text-[10px] text-slate-600">
            拖拽平移 · 滚轮缩放 · 点击事件查看因果链 · {paused ? '已暂停' : '实时更新中'}
          </span>
        </div>
      )}
    </div>
  );
}
