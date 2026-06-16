import React, { useState, useEffect, useCallback } from 'react';
import { bus, type ChainStatsV2, type WindowSpec, EVENT_META } from '../../eventBus';
import {
  BarChart3, ChevronDown, ChevronUp, Brain, GitFork, Sparkles, Footprints,
  Lightbulb, Zap, Hash, AlertTriangle,
} from 'lucide-react';

// ── 格式化工具 ──
function pct(r: number | null): string {
  if (r === null || r === undefined) return '—';
  return (r * 100).toFixed(0) + '%';
}
function f1(n: number): string { return n.toFixed(1); }
function f2(n: number): string { return n.toFixed(2); }

// ── 窗口选项 ──
const WINDOW_OPTIONS: { label: string; spec: WindowSpec }[] = [
  { label: '15m', spec: { kind: 'minutes', value: 15 } },
  { label: '30m', spec: { kind: 'minutes', value: 30 } },
  { label: '60m', spec: { kind: 'minutes', value: 60 } },
  { label: '全部', spec: { kind: 'session' } },
];

// ── Lift 颜色编码 ──
function liftColor(lift: number | null): string {
  if (lift === null) return 'text-slate-600';
  if (lift >= 3.0) return 'text-emerald-400';
  if (lift >= 1.5) return 'text-amber-400';
  if (lift >= 1.0) return 'text-slate-400';
  return 'text-slate-600';
}

// ── 链标签颜色 ──
const CHAIN_LABEL_COLORS: Record<string, string> = {
  '探索型链': 'text-cyan-400',
  '对话修复链': 'text-rose-400',
  '策略收敛链': 'text-amber-400',
  '浅回应链': 'text-slate-400',
  '其他链': 'text-slate-500',
};

// ── 组件 ──
export default function ChainStatistics({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const [stats, setStats] = useState<ChainStatsV2 | null>(null);
  const [windowSpec, setWindowSpec] = useState<WindowSpec>({ kind: 'minutes', value: 30 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['L1']));

  const refresh = useCallback(() => {
    try {
      setStats(bus.getChainStatsV2(windowSpec));
    } catch { /* bus not ready */ }
  }, [windowSpec]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggleLayer = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (!visible) return null;

  const isEmpty = !stats || stats.chainCount === 0;
  const hasDataQualityIssue = stats && stats.totalEvents > 0
    && stats.eventsWithoutCorrelation > stats.totalEvents * 0.5
    && stats.chainCount === 0;

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 bg-slate-900/95 text-slate-100 shadow-2xl rounded-xl border border-slate-700 backdrop-blur max-h-[70vh] overflow-y-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 sticky top-0 bg-slate-900/95 z-10">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-xs">认知统计</span>
          {stats && <span className="text-[10px] text-slate-500 font-mono">{stats.totalEvents}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {/* Window pills */}
          {WINDOW_OPTIONS.map(opt => {
            const active = windowSpec.kind === opt.spec.kind
              && (opt.spec.kind === 'session' || (windowSpec.kind === 'minutes' && windowSpec.value === (opt.spec as any).value));
            return (
              <button
                key={opt.label}
                onClick={() => setWindowSpec(opt.spec)}
                className={`px-1.5 py-0.5 text-[10px] rounded font-mono transition-colors ${
                  active ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          <button onClick={onToggle} className="p-0.5 text-slate-500 hover:text-slate-300 rounded ml-0.5">
            <span className="text-[10px]">✕</span>
          </button>
        </div>
      </div>

      {/* ── Empty State ── */}
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-slate-500 text-sm">
          <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-50" />
          <p>尚无认知链数据</p>
          <p className="text-xs mt-1 text-slate-600">等待首次认知活动...</p>
        </div>
      ) : (
        <>
          {/* ── Data Quality Warning ── */}
          {hasDataQualityIssue && (
            <div className="flex items-start gap-1.5 px-3 py-2 mx-3 mt-2 bg-amber-900/20 border border-amber-800/40 rounded-lg text-[10px] text-amber-400">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>大部分事件缺少因果链关联 — 统计数据可能不完整</span>
            </div>
          )}

          {/* ── Layer 1: Structure ── */}
          <Layer
            id="L1"
            title="认知结构"
            icon={<GitFork className="w-3 h-3 text-indigo-400" />}
            expanded={expanded.has('L1')}
            onToggle={() => toggleLayer('L1')}
            summary={`${stats!.chainCount} 链 · 深度 ${f1(stats!.avgDepth)} · 分叉熵 ${stats!.forkEntropy !== null ? f2(stats!.forkEntropy) : '—'}`}
          >
            <div className="space-y-2">
              {/* Chain stats */}
              <StatRow label="认知链" value={String(stats!.chainCount)} />
              <StatRow label="平均深度" value={f1(stats!.avgDepth)} />
              <StatRow label="分叉熵" value={stats!.forkEntropy !== null ? f2(stats!.forkEntropy) : '—'} sub="认知不确定度" />
              <StatRow label="孤立链" value={pct(stats!.isolatedRatio)} sub="≤2 事件" />
              <StatRow label="深度链" value={String(stats!.deepChainCount)} sub="≥4 事件" />
              {/* Depth distribution bar */}
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-slate-500 w-10 shrink-0">分布</span>
                {stats!.depthDistribution.shallow > 0 && (
                  <span className="text-slate-400" title="浅层">浅{stats!.depthDistribution.shallow}</span>
                )}
                {stats!.depthDistribution.medium > 0 && (
                  <span className="text-amber-400" title="中层">中{stats!.depthDistribution.medium}</span>
                )}
                {stats!.depthDistribution.deep > 0 && (
                  <span className="text-indigo-400" title="深层">深{stats!.depthDistribution.deep}</span>
                )}
              </div>
            </div>
          </Layer>

          {/* ── Layer 2: Behavior ── */}
          <Layer
            id="L2"
            title="认知行为"
            icon={<Lightbulb className="w-3 h-3 text-emerald-400" />}
            expanded={expanded.has('L2')}
            onToggle={() => toggleLayer('L2')}
            summary={`产出率 ${pct(stats!.discovery.explorationYield)} · 新颖性 ${pct(stats!.discovery.noveltyRate)}`}
          >
            <div className="space-y-2">
              <StatRow
                label="探索产出率"
                value={pct(stats!.discovery.explorationYield)}
                sub={`${stats!.discovery.totalStored} 存储 / ${stats!.discovery.totalExplorations} 探索`}
              />
              <StatRow
                label="新颖率"
                value={pct(stats!.discovery.noveltyRate)}
                sub={stats!.windowMinutes !== null ? '窗口内新话题占比' : '话题多样性'}
              />
              {/* Per-type entropy top 3 */}
              {stats!.perTypeEntropy.length > 0 && (
                <div className="pt-1 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 mb-1">分叉熵 Top 3</div>
                  {stats!.perTypeEntropy.slice(0, 3).map(pe => (
                    <div key={pe.type} className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400 truncate flex-1">{pe.label}</span>
                      <span className="text-slate-300 font-mono ml-2">{f2(pe.entropy)}</span>
                      <span className="text-slate-600 ml-1">({pe.uniqueTargets}向)</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Layer>

          {/* ── Layer 3: Efficiency ── */}
          <Layer
            id="L3"
            title="认知效率"
            icon={<Zap className="w-3 h-3 text-amber-400" />}
            expanded={expanded.has('L3')}
            onToggle={() => toggleLayer('L3')}
            summary={`去重率 ${pct(stats!.dedupRatio)} · 子边 ${stats!.topEdgesPMI.length}`}
          >
            <div className="space-y-2">
              <StatRow
                label="去重效率"
                value={pct(stats!.discovery.dedupEfficiency)}
                sub={`${stats!.discovery.totalSkipped} 跳过 / ${stats!.discovery.totalStored + stats!.discovery.totalSkipped} 总计`}
              />

              {/* PMI Edge Table */}
              {stats!.topEdgesPMI.length > 0 && (
                <div className="pt-1 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 mb-1">Top PMI/Lift 因果边</div>
                  <div className="space-y-0.5">
                    {stats!.topEdgesPMI.map((e, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px] gap-1">
                        <span className="text-indigo-400 truncate">{e.fromLabel}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-amber-400 truncate">{e.toLabel}</span>
                        <span className="text-slate-500 font-mono ml-auto">{e.count}</span>
                        <span className={`font-mono w-10 text-right ${liftColor(e.lift)}`}>
                          {e.lift !== null ? `×${f2(e.lift)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw frequency edges for comparison */}
              {stats!.topEdgesRaw.length > 0 && (
                <div className="pt-1">
                  <div className="text-[10px] text-slate-600 mb-1">原始频次 Top 3 (对比)</div>
                  <div className="space-y-0.5 opacity-50">
                    {stats!.topEdgesRaw.slice(0, 3).map((e, i) => (
                      <div key={i} className="flex items-center text-[10px] text-slate-500 gap-1">
                        <span className="truncate">{e.edge}</span>
                        <span className="font-mono ml-auto">{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Layer>

          {/* ── Chain Labels Summary (always visible) ── */}
          {stats!.chainLabels.some(c => c.count > 0) && (
            <div className="px-3 py-2 border-t border-slate-800 flex flex-wrap gap-x-3 gap-y-0.5">
              {stats!.chainLabels.filter(c => c.count > 0).map(c => (
                <span key={c.label} className={`text-[10px] ${CHAIN_LABEL_COLORS[c.label] || 'text-slate-500'}`}>
                  {c.label} {c.count}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 可折叠层组件 ──
function Layer({ id, title, icon, expanded, onToggle, summary, children }: {
  id: string;
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-2 hover:bg-slate-800/50 transition-colors text-left"
      >
        {icon}
        <span className="text-[11px] font-medium text-slate-300">{title}</span>
        <span className="text-[10px] text-slate-500 truncate flex-1 ml-1">{summary}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-slate-600 shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-600 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pl-7">
          {children}
        </div>
      )}
    </div>
  );
}

// ── 统计行组件 ──
function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-slate-500 w-14 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-200 font-mono">{value}</span>
      {sub && <span className="text-[10px] text-slate-600 truncate">{sub}</span>}
    </div>
  );
}
