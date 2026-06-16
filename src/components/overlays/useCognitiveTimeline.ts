// v6.0: 认知示波器数据层
// 从 EventBus + /api/events 拉取事件，提取时序数据供 Canvas 渲染

import { useState, useEffect, useCallback, useMemo } from 'react';
import { bus, type BusEvent, EVENT_META } from '../../eventBus';

export interface TimelineEvent extends BusEvent {
  _label: string;
  _sourceLabel: string;
  _color: string;
}

export interface EmotionSample {
  timestamp: number;
  valence: number;
  arousal: number;
  dominant: string;
}

export interface PhaseBand {
  from: number;
  to: number;
  phase: string;
}

/** 策略区间：离散状态用色块，不用波形 */
export interface StrategySpan {
  from: number;
  to: number;
  strategy: string;
  controlMode: string;
}

/** 好奇心 + 认知负载采样点 */
export interface CuriositySample {
  timestamp: number;
  activeInterests: number;
  explorationCount: number;
  cognitiveLoad: number; // composite 0-1
}

const SOURCE_COLORS: Record<string, string> = {
  user: '#60a5fa',
  curiosity: '#34d399',
  autonomy: '#fbbf24',
  strategy: '#a78bfa',
  emotion: '#f87171',
  system: '#94a3b8',
  memory: '#c084fc',
  world: '#fb923c',
};

const SOURCE_LABELS: Record<string, string> = {
  user: '用户',
  curiosity: '好奇',
  autonomy: '自主',
  strategy: '策略',
  emotion: '情感',
  system: '系统',
  memory: '记忆',
  world: '世界',
};

const STRATEGY_COLORS: Record<string, string> = {
  empathize: '#f59e0b',
  redirect: '#3b82f6',
  explore: '#10b981',
  accompany: '#8b5cf6',
  share: '#ec4899',
  repair: '#ef4444',
  neutral: '#6b7280',
};

export type ZoomLevel = '15s' | '1m' | '5m' | '15m' | '1h' | 'all';

export const ZOOM_WINDOWS: Record<ZoomLevel, number> = {
  '15s': 15_000,
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  'all': 0,
};

export interface TimelineData {
  events: TimelineEvent[];
  emotionSamples: EmotionSample[];
  phaseBands: PhaseBand[];
  strategySpans: StrategySpan[];
  curiositySamples: CuriositySample[];
  viewStart: number;
  viewEnd: number;
  zoom: ZoomLevel;
  totalEvents: number;
  closedLoopRate: number | null;
}

function parseTimelineEvent(e: BusEvent): TimelineEvent {
  const meta = EVENT_META[e.type];
  return {
    ...e,
    _label: meta?.label || e.type,
    _sourceLabel: SOURCE_LABELS[e.source] || e.source,
    _color: SOURCE_COLORS[e.source] || '#94a3b8',
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 提取情感采样点：从 EmotionUpdated 事件中取 valence/arousal */
function extractEmotionSamples(events: BusEvent[]): EmotionSample[] {
  return events
    .filter(e => e.type === 'EmotionUpdated' && e.data && typeof e.data.valence === 'number')
    .map(e => ({
      timestamp: e.timestamp,
      valence: clamp(e.data.valence, -1, 1),
      arousal: clamp(e.data.arousal, 0, 1),
      dominant: e.data.dominant || 'neutral',
    }));
}

/** 提取阶段区间：从 PhaseTransitioned 事件构建连续的时间段 */
function extractPhaseBands(events: BusEvent[], fallbackStart: number): PhaseBand[] {
  const transitions = events
    .filter(e => e.type === 'PhaseTransitioned' && e.data)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (transitions.length === 0) {
    return [{ from: fallbackStart, to: Date.now(), phase: 'R1' }];
  }

  const bands: PhaseBand[] = [];
  const firstFrom = transitions[0].data.from || 'R1';
  bands.push({ from: fallbackStart, to: transitions[0].timestamp, phase: firstFrom });

  for (let i = 0; i < transitions.length - 1; i++) {
    bands.push({
      from: transitions[i].timestamp,
      to: transitions[i + 1].timestamp,
      phase: transitions[i].data.to || transitions[i].data.from || 'R1',
    });
  }

  const last = transitions[transitions.length - 1];
  bands.push({
    from: last.timestamp,
    to: Date.now(),
    phase: last.data.to || 'R2',
  });

  return bands;
}

/** 提取策略区间：从 StrategySelected 事件构建甘特图 */
function extractStrategySpans(events: BusEvent[], fallbackEnd: number): StrategySpan[] {
  const selections = events
    .filter(e => e.type === 'StrategySelected' && e.data)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (selections.length === 0) return [];

  const spans: StrategySpan[] = [];
  for (let i = 0; i < selections.length; i++) {
    const nextTs = i < selections.length - 1 ? selections[i + 1].timestamp : fallbackEnd;
    spans.push({
      from: selections[i].timestamp,
      to: nextTs,
      strategy: selections[i].data.strategy || 'neutral',
      controlMode: selections[i].data.controlMode || 'auto',
    });
  }
  return spans;
}

/** 提取好奇心热度 + 认知负载 */
function extractCuriositySamples(events: BusEvent[], viewStart: number, viewEnd: number): CuriositySample[] {
  // 从事件流中追踪兴趣激活数量和探索活动
  let activeInterests = 0;
  let explorationCount = 0;
  const samples: CuriositySample[] = [];

  // 把窗口内相关事件按时间排序
  const relevant = events
    .filter(e =>
      e.type === 'InterestDetected' ||
      e.type === 'InterestDecayed' ||
      e.type === 'ExplorationStarted' ||
      e.type === 'ExplorationCompleted' ||
      e.type === 'EmotionUpdated',
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const e of relevant) {
    if (e.type === 'InterestDetected') {
      activeInterests += (e.data?.topics?.length || 1);
    } else if (e.type === 'InterestDecayed') {
      activeInterests = Math.max(0, activeInterests - (e.data?.removed || 0));
    } else if (e.type === 'ExplorationStarted') {
      explorationCount++;
    } else if (e.type === 'ExplorationCompleted') {
      explorationCount = Math.max(0, explorationCount - 1);
    }

    // 计算认知负载：情感冲突 + 好奇心压力
    const curiosityPressure = Math.min(activeInterests / 15, 1);
    const explorationPressure = Math.min(explorationCount / 3, 1);
    const cognitiveLoad = clamp(
      curiosityPressure * 0.5 + explorationPressure * 0.35 + 0.15,
      0, 1,
    );

    samples.push({
      timestamp: e.timestamp,
      activeInterests,
      explorationCount,
      cognitiveLoad: Math.round(cognitiveLoad * 100) / 100,
    });
  }

  // 确保窗口边界有采样点
  if (samples.length === 0) {
    samples.push({ timestamp: viewStart, activeInterests: 0, explorationCount: 0, cognitiveLoad: 0.1 });
  }

  return samples;
}

/** 计算闭环率：DiscoveryStored → DiscoveryShared → UserMessageReceived 的完整链路比例 */
function computeClosedLoopRate(events: BusEvent[]): number | null {
  const discoveries = events.filter(e => e.type === 'DiscoveryStored').length;
  const shared = events.filter(e => e.type === 'DiscoveryShared').length;
  if (discoveries === 0) return null;
  return Math.round((shared / discoveries) * 100);
}

export function useCognitiveTimeline() {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>('5m');
  const [viewEnd, setViewEnd] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/events?n=500');
      if (res.ok) {
        const serverEvents: BusEvent[] = await res.json();
        const localEvents = bus.recentEvents(500);
        const seen = new Set(localEvents.map((e: BusEvent) => `${e.timestamp}-${e.type}`));
        const merged = [...localEvents];
        for (const e of serverEvents) {
          if (!seen.has(`${e.timestamp}-${e.type}`)) merged.push(e);
        }
        merged.sort((a, b) => a.timestamp - b.timestamp);
        setEvents(merged);
      }
    } catch {
      setEvents(bus.recentEvents(500));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!paused) {
        refresh();
        setViewEnd(Date.now());
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [paused, refresh]);

  const data = useMemo<TimelineData>(() => {
    const windowMs = ZOOM_WINDOWS[zoom];
    const viewStart = windowMs > 0 ? viewEnd - windowMs : (events.length > 0 ? events[0].timestamp : viewEnd - 300_000);

    const inWindow = events.filter(e => e.timestamp >= viewStart && e.timestamp <= viewEnd);

    return {
      events: inWindow.map(parseTimelineEvent),
      emotionSamples: extractEmotionSamples(inWindow),
      phaseBands: extractPhaseBands(events, viewStart),
      strategySpans: extractStrategySpans(inWindow, viewEnd),
      curiositySamples: extractCuriositySamples(inWindow, viewStart, viewEnd),
      viewStart,
      viewEnd,
      zoom,
      totalEvents: events.length,
      closedLoopRate: computeClosedLoopRate(events),
    };
  }, [events, zoom, viewEnd]);

  const jumpTo = useCallback((ts: number) => {
    setViewEnd(ts + (ZOOM_WINDOWS[zoom] || 300_000) / 2);
  }, [zoom]);

  return {
    data,
    paused,
    setPaused,
    zoom,
    setZoom,
    viewEnd,
    setViewEnd,
    refresh,
    jumpTo,
  };
}

export { STRATEGY_COLORS };
