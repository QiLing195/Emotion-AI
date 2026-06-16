import { useState, useEffect, useRef, useCallback } from 'react';
import { bus, type BusEvent, type EventName, EVENT_META, type EventLevel } from '../../eventBus';
import { X, Clock, Activity, Brain, Settings } from 'lucide-react';

const CATEGORIES: string[] = ['用户', '好奇心', '自主', '策略', '情感', '系统'];

const LEVEL_LABELS: Record<EventLevel, string> = {
  cognitive: '认知层',
  system: '系统层',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatPayload(data: any): string {
  if (!data) return '-';
  try {
    const s = typeof data === 'string' ? data : JSON.stringify(data);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  } catch {
    return '-';
  }
}

export default function TimelineViewer({ onClose, highlightChainId }: { onClose: () => void; highlightChainId?: string | null }) {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(new Set(CATEGORIES));
  const [levelFilter, setLevelFilter] = useState<EventLevel | 'all'>('cognitive');
  const [paused, setPaused] = useState(false);
  const [selectedChain, setSelectedChain] = useState<string | null>(highlightChainId ?? null);

  // 外部高亮请求 → 自动选中该链
  useEffect(() => {
    if (highlightChainId) setSelectedChain(highlightChainId);
  }, [highlightChainId]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/events?n=500');
      if (res.ok) {
        const serverEvents: BusEvent[] = await res.json();
        const localEvents = bus.recentEvents(500);
        const seen = new Set(localEvents.map((e: BusEvent) => `${e.timestamp}-${e.type}`));
        const merged = [...localEvents];
        for (const e of serverEvents) {
          if (!seen.has(`${e.timestamp}-${e.type}`)) {
            merged.push(e);
          }
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
      if (!paused) refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [paused, refresh]);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events]);

  const handleScroll = (e: any) => {
    const t = e.currentTarget;
    const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  const toggleCategory = (cat: string) => {
    setEnabledCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const filtered = events.filter(e => {
    const meta = EVENT_META[e.type];
    if (!meta) return false;
    // 层级过滤
    if (levelFilter !== 'all' && e.level !== levelFilter) return false;
    // 用 source 匹配已选择的类别
    const sourceMap: Record<string, string[]> = {
      '用户': ['user'],
      '好奇��': ['curiosity'],
      '自主': ['autonomy'],
      '策略': ['strategy'],
      '情感': ['emotion'],
      '系统': ['system', 'memory', 'world'],
    };
    let catMatch = false;
    for (const cat of enabledCategories) {
      const sources = sourceMap[cat];
      if (sources && sources.includes(e.source)) {
        catMatch = true;
        break;
      }
    }
    return catMatch;
  });

  // 当选中一条链时，高亮同链事件
  const chainEvents = selectedChain
    ? events.filter(e => e.correlationId === selectedChain)
    : [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[420px] bg-slate-900 text-slate-100 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-sm">认知时间线</span>
          <span className="text-xs text-slate-500">({filtered.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused(!paused)}
            className={`px-2 py-1 text-xs rounded ${paused ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-300'} hover:opacity-80`}
          >
            {paused ? '已暂停' : '实时'}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Level Toggle */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700 shrink-0">
        <span className="text-[11px] text-slate-500 mr-1">层级:</span>
        {(['cognitive', 'system', 'all'] as const).map(level => (
          <button
            key={level}
            onClick={() => setLevelFilter(level)}
            className={`px-2 py-0.5 text-[11px] rounded-full border transition-colors ${
              levelFilter === level
                ? level === 'cognitive' ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300'
                : level === 'system' ? 'border-slate-500 bg-slate-700 text-slate-300'
                : 'border-amber-500 bg-amber-900/50 text-amber-300'
                : 'border-slate-700 bg-transparent text-slate-500'
            }`}
          >
            {level === 'all' ? '全部' : LEVEL_LABELS[level]}
          </button>
        ))}
        {selectedChain && (
          <button
            onClick={() => setSelectedChain(null)}
            className="ml-auto px-2 py-0.5 text-[11px] rounded-full border border-amber-600 bg-amber-900/30 text-amber-400"
          >
            链 {selectedChain.slice(-6)} ✕
          </button>
        )}
      </div>

      {/* Category Filters */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-700 shrink-0">
        {CATEGORIES.map(cat => {
          const active = enabledCategories.has(cat);
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                active
                  ? 'border-slate-500 bg-slate-700 text-slate-100'
                  : 'border-slate-700 bg-transparent text-slate-500'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Event Table */}
      <div className="flex-1 overflow-auto" onScroll={handleScroll}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
            <Clock className="w-8 h-8" />
            <p className="text-sm">等待认知事件...</p>
            <p className="text-xs text-slate-600">当前筛选: {LEVEL_LABELS[levelFilter as EventLevel] || '全部'}</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400 z-10">
              <tr>
                <th className="text-left px-2 py-2 font-medium w-[68px]">时间</th>
                <th className="text-left px-1 py-2 font-medium">事件</th>
                <th className="text-left px-1 py-2 font-medium w-[48px]">来源</th>
                <th className="text-left px-1 py-2 font-medium w-[60px]">因果</th>
                <th className="text-left px-1 py-2 font-medium">payload</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const meta = EVENT_META[e.type];
                const isInChain = selectedChain && e.correlationId === selectedChain;
                return (
                  <tr
                    key={`${e.id || e.timestamp}-${i}`}
                    className={`border-b border-slate-800 hover:bg-slate-800/50 transition-colors ${
                      isInChain ? 'bg-amber-900/20' : ''
                    }`}
                  >
                    <td className="px-2 py-1.5 text-slate-500 font-mono whitespace-nowrap text-[11px]">
                      <div>{formatTime(e.timestamp)}</div>
                      {e.level === 'cognitive' ? (
                        <span className="text-indigo-400 text-[10px]" title="认知层">🧠</span>
                      ) : (
                        <span className="text-slate-600 text-[10px]" title="系统层">⚙️</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5">
                      <button
                        className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap hover:opacity-80"
                        style={{ backgroundColor: e.level === 'cognitive' ? '#6366f1' + '22' : '#6b7280' + '22', color: e.level === 'cognitive' ? '#818cf8' : '#9ca3af' }}
                        onClick={() => e.correlationId && setSelectedChain(e.correlationId)}
                        title={e.correlationId ? '点击追踪整条链' : undefined}
                      >
                        {meta.label}
                      </button>
                    </td>
                    <td className="px-1 py-1.5 text-slate-500 text-[11px]">{meta.label === '兴趣衰减' ? '好奇心' : meta.label === '状态保存' || meta.label === '状态加载' ? '系统' : meta.source}</td>
                    <td className="px-1 py-1.5 text-[10px]">
                      {e.causedBy ? (
                        <span className="text-amber-500" title={`causedBy: ${e.causedBy}`}>←{e.causedBy.slice(-8)}</span>
                      ) : e.correlationId ? (
                        <span className="text-indigo-500 cursor-pointer hover:underline" title="链起点" onClick={() => setSelectedChain(e.correlationId!)}>┐</span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-slate-400 font-mono max-w-[140px] truncate text-[11px]">
                      {formatPayload(e.data)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Chain Inspector (footer) */}
      {selectedChain && chainEvents.length > 0 && (
        <div className="h-32 border-t border-amber-800 bg-slate-800/50 overflow-auto p-2 shrink-0">
          <div className="text-[11px] text-amber-400 font-medium mb-1">
            认知链追踪: {selectedChain.slice(-12)}
            <span className="text-slate-500 ml-2">({chainEvents.length} 事件)</span>
          </div>
          <div className="space-y-0.5">
            {chainEvents.map((e, i) => (
              <div key={e.id} className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className="text-slate-600 w-12 shrink-0">{formatTime(e.timestamp)}</span>
                <span className="text-amber-500">{i > 0 ? '  ← ' : ''}</span>
                <span className="text-slate-300">{EVENT_META[e.type]?.label || e.type}</span>
                <span className="text-slate-600 truncate">{formatPayload(e.data)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
