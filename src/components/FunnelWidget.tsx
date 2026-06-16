// Sprint E: 认知漏斗小部件
// 显示 Interest → Pattern → Candidate → Confirmed → Insight → Shared 的管道转化
// 自动从 /api/cognitive/observatory 拉取数据

import React, { useState, useEffect, useCallback } from 'react';

interface FunnelData {
  counts: {
    interestDetected: number;
    patternCandidate: number;
    patternConfirmed: number;
    insightGenerated: number;
    discoveryShared: number;
  };
  conversionRates: {
    interestToCandidate: number;
    candidateToConfirmed: number;
    confirmedToInsight: number;
    insightToShared: number;
  };
  discoveryYield: {
    ratio: number;
    status: 'too_low' | 'conservative' | 'healthy' | 'generous' | 'broken';
    description: string;
  };
  timestamp: number;
}

interface ObservatoryData {
  funnel: FunnelData;
  recommendations: { action: string; details: string };
  eventCoverage: Record<string, number>;
  timestamp: number;
}

// ── 漏斗阶段配置 ──
const STAGES = [
  { key: 'interestDetected' as const, label: '兴趣', icon: '👁️', color: 'bg-indigo-500' },
  { key: 'patternCandidate' as const, label: '候选', icon: '🌱', color: 'bg-teal-500' },
  { key: 'patternConfirmed' as const, label: '确认', icon: '✅', color: 'bg-emerald-500' },
  { key: 'insightGenerated' as const, label: '洞察', icon: '💡', color: 'bg-amber-500' },
  { key: 'discoveryShared' as const, label: '分享', icon: '🚀', color: 'bg-rose-500' },
];

const STATUS_COLORS: Record<string, string> = {
  too_low: 'text-red-500 bg-red-50',
  conservative: 'text-amber-500 bg-amber-50',
  healthy: 'text-emerald-500 bg-emerald-50',
  generous: 'text-orange-500 bg-orange-50',
  broken: 'text-red-600 bg-red-100',
};

const STATUS_LABELS: Record<string, string> = {
  too_low: '过保守',
  conservative: '偏保守',
  healthy: '健康',
  generous: '偏宽松',
  broken: '失衡',
};

// ── 子组件：漏斗条 ──
function FunnelBar({ value, max, label, color, count }: {
  value: number; max: number; label: string; color: string; count: number;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 text-right text-moon-500 tabular-nums">{count}</span>
      <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="w-10 text-moon-400">{label}</span>
    </div>
  );
}

// ── 子组件：转化率箭头 ──
function ConversionArrow({ rate, fromLabel, toLabel }: {
  rate: number; fromLabel: string; toLabel: string;
}) {
  const pct = Math.round(rate * 100);
  const isGood = rate > 0.3;
  return (
    <div className="flex items-center gap-1 text-[10px] text-moon-400 px-8">
      <span className={isGood ? 'text-emerald-500' : 'text-amber-500'}>
        {fromLabel} → {toLabel}: {pct}%
      </span>
    </div>
  );
}

// ── 主组件 ──
export function FunnelWidget() {
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/cognitive/observatory?window=60');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 5000); // 每 5 秒刷新
    return () => clearInterval(timer);
  }, [fetchData]);

  if (error) {
    return (
      <div className="p-3 text-xs text-red-500">
        漏斗数据加载失败: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-3 text-xs text-moon-400 animate-pulse">
        加载认知漏斗数据...
      </div>
    );
  }

  const { funnel } = data;
  const maxCount = Math.max(...STAGES.map(s => funnel.counts[s.key]), 1);
  const dy = funnel.discoveryYield;

  return (
    <div className="space-y-2">
      {/* Discovery Yield 状态行 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-moon-700">认知漏斗</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[dy.status]}`}>
          DY {(dy.ratio * 100).toFixed(1)}% · {STATUS_LABELS[dy.status]}
        </span>
      </div>

      {/* 漏斗条 */}
      <div className="space-y-0.5">
        {STAGES.map((stage) => (
          <React.Fragment key={stage.key}>
            <FunnelBar
              value={Number(funnel.counts[stage.key]) || 0}
              max={maxCount}
              label={stage.label}
              color={stage.color}
              count={Number(funnel.counts[stage.key]) || 0}
            />
          </React.Fragment>
        ))}
      </div>

      {/* 转化率（可展开） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-moon-400 hover:text-moon-600 flex items-center gap-1 w-full"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        转化率详情
      </button>

      {expanded && (
        <div className="space-y-0.5 pl-2 border-l-2 border-slate-200">
          <ConversionArrow rate={funnel.conversionRates.interestToCandidate} fromLabel="兴趣" toLabel="候选" />
          <ConversionArrow rate={funnel.conversionRates.candidateToConfirmed} fromLabel="候选" toLabel="确认" />
          <ConversionArrow rate={funnel.conversionRates.confirmedToInsight} fromLabel="确认" toLabel="洞察" />
          <ConversionArrow rate={funnel.conversionRates.insightToShared} fromLabel="洞察" toLabel="分享" />
          {data.recommendations.action !== 'none' && (
            <div className="text-[10px] text-amber-600 mt-1 bg-amber-50 p-1.5 rounded">
              ⚡ {data.recommendations.details}
            </div>
          )}
        </div>
      )}

      {/* 事件覆盖摘要 */}
      <div className="text-[10px] text-moon-400 flex flex-wrap gap-1">
        {Object.entries(data.eventCoverage as Record<string, number>)
          .filter(([, count]) => (count as number) > 0)
          .sort(([, a], [, b]) => (b as number) - (a as number))
          .slice(0, 5)
          .map(([type, count]) => (
            <span key={type} className="bg-slate-100 px-1.5 py-0.5 rounded">
              {type.replace(/([A-Z])/g, '_$1').replace(/^_/, '')}: {count as number}
            </span>
          ))}
      </div>
    </div>
  );
}
