import React, { useState, useEffect, useCallback } from 'react';
import { bus, type CognitiveObservatory, type WindowSpec, EVENT_META } from '../../eventBus';
import {
  trendTracker,
  type TrendObservatory,
  type TrendPoint,
  type TrendDirection,
  type MetricTimeSeries,
  type VolatilityLevel,
  type AnomalyReport,
  type AnomalyFlag,
  type AnomalySeverity,
} from '../../lib/trendTracker';
import Sparkline from './Sparkline';
import { attributionEngine, inferBaselineObservatory, type MetricAttribution, type CausalNode } from '../../lib/attributionEngine';
import { patternDetector, type DiscoveredPattern } from '../../lib/patternDetector';
import { rankCases, compareChains, type CaseRanking, type ChainComparison } from '../../lib/caseAnalyzer';
import { patternLibrary, type PatternRecord, type Recommendation, type LibraryStats } from '../../lib/patternLibrary';
import {
  Brain, GitFork, Lightbulb, Zap, Sparkles,
  ChevronDown, ChevronUp, TrendingUp, Footprints, ArrowUp, ArrowDown, Minus,
  Gauge, Activity, AlertTriangle, AlertOctagon, Search, Layers,
} from 'lucide-react';

// ── 格式化工具 ──
function pct(r: number | null): string {
  if (r === null || r === undefined) return '—';
  return (r * 100).toFixed(0) + '%';
}
function f1(n: number): string { return n.toFixed(1); }
function f2(n: number): string { return n.toFixed(2); }
function f3(n: number): string { return n.toFixed(3); }

// ── 窗口选项 ──
const WINDOW_OPTIONS: { label: string; spec: WindowSpec }[] = [
  { label: '15m', spec: { kind: 'minutes', value: 15 } },
  { label: '30m', spec: { kind: 'minutes', value: 30 } },
  { label: '60m', spec: { kind: 'minutes', value: 60 } },
  { label: '全部', spec: { kind: 'session' } },
];

// ── 需要计算时序的指标 ──
const TRACKED_SERIES = [
  'chainQualityScore',
  'curiosityIndex',
  'explorationYield',
  'branchEntropy',
  'learningVelocity',
] as const;

// ── Lift 颜色编码 ──
function liftColor(lift: number): string {
  if (lift >= 5.0) return 'text-emerald-300';
  if (lift >= 3.0) return 'text-emerald-400';
  if (lift >= 2.0) return 'text-amber-400';
  if (lift >= 1.0) return 'text-slate-400';
  return 'text-slate-600';
}

// ── 健康评分颜色 ──
function healthColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-rose-400';
}

function healthBg(score: number): string {
  if (score >= 80) return 'bg-emerald-400/20';
  if (score >= 60) return 'bg-amber-400/20';
  if (score >= 40) return 'bg-orange-400/20';
  return 'bg-rose-400/20';
}

// ── 趋势方向颜色 ──
function trendColor(dir: TrendDirection): string {
  if (dir === 'up') return 'text-emerald-400';
  if (dir === 'down') return 'text-rose-400';
  return 'text-slate-500';
}

// ── 异常严重度颜色 ──
function anomalyColor(severity: AnomalySeverity): string {
  if (severity === 'alert') return 'text-rose-400';
  if (severity === 'warning') return 'text-amber-400';
  return 'text-slate-500';
}

// ── 波动等级颜色 ──
function volatilityColor(level: VolatilityLevel): string {
  if (level === 'low') return 'text-emerald-500';
  if (level === 'medium') return 'text-amber-500';
  return 'text-rose-500';
}

function volatilityLabel(level: VolatilityLevel): string {
  if (level === 'low') return '稳定';
  if (level === 'medium') return '波动';
  return '剧烈';
}

// ── Sparkline 颜色映射 ──
const SERIES_COLORS: Record<string, string> = {
  chainQualityScore: '#a78bfa',  // violet-400
  curiosityIndex: '#818cf8',     // indigo-400
  explorationYield: '#34d399',   // emerald-400
  branchEntropy: '#22d3ee',      // cyan-400
  learningVelocity: '#fbbf24',   // amber-400
};

// ── 趋势箭头组件 ──
function TrendArrow({ point, showDelta }: { point: TrendPoint | undefined; showDelta?: boolean }) {
  if (!point || point.delta === null) return null;
  const cls = trendColor(point.direction);
  const icon = point.direction === 'up'
    ? <ArrowUp className="w-2.5 h-2.5 inline" />
    : point.direction === 'down'
      ? <ArrowDown className="w-2.5 h-2.5 inline" />
      : <Minus className="w-2.5 h-2.5 inline" />;
  return (
    <span className={`${cls} font-mono text-[9px] ml-0.5 inline-flex items-center gap-px`}>
      {icon}{showDelta !== false && <span>{point.delta > 0 ? '+' : ''}{f1(point.delta)}</span>}
    </span>
  );
}

// ── 波动标签 ──
function VolatilityTag({ level }: { level: VolatilityLevel }) {
  return (
    <span className={`text-[8px] ml-1 px-1 rounded ${volatilityColor(level)} bg-slate-800/50`}>
      {volatilityLabel(level)}
    </span>
  );
}

// ── 带趋势的单个指标条（用于健康度横幅中的小格） ──
function TrendCell({ label, value, point }: { label: string; value: string; point: TrendPoint | undefined }) {
  return (
    <div className="text-center">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-300 font-mono inline-flex items-center">
        {value}
        <TrendArrow point={point} />
      </div>
    </div>
  );
}

// ── 边缘标签解析 ──
function edgeLabel(edge: string): { from: string; to: string } {
  const [from, to] = edge.split('→');
  return {
    from: EVENT_META[from as keyof typeof EVENT_META]?.label || from,
    to: EVENT_META[to as keyof typeof EVENT_META]?.label || to,
  };
}

// ── 组件 ──
export default function CognitiveObservatory({ visible, onToggle, onInspectChain }: { visible: boolean; onToggle: () => void; onInspectChain?: (correlationId: string) => void }) {
  const [obs, setObs] = useState<CognitiveObservatory | null>(null);
  const [trends, setTrends] = useState<TrendObservatory | null>(null);
  const [timeSeries, setTimeSeries] = useState<Map<string, MetricTimeSeries>>(new Map());
  const [anomalies, setAnomalies] = useState<AnomalyReport | null>(null);
  const [attributions, setAttributions] = useState<MetricAttribution[]>([]);
  const [causalTraces, setCausalTraces] = useState<Map<string, CausalNode>>(new Map());
  const [patterns, setPatterns] = useState<DiscoveredPattern[]>([]);
  const [expandedAttr, setExpandedAttr] = useState<Set<string>>(new Set());
  const [expandedCausal, setExpandedCausal] = useState<Set<string>>(new Set());
  const [replayingChain, setReplayingChain] = useState<string | null>(null);
  const [replayEvents, setReplayEvents] = useState<any[]>([]);
  const [caseRanking, setCaseRanking] = useState<CaseRanking | null>(null);
  const [chainComparison, setChainComparison] = useState<ChainComparison | null>(null);
  const [libStats, setLibStats] = useState<LibraryStats | null>(null);
  const [libTopPatterns, setLibTopPatterns] = useState<PatternRecord[]>([]);
  const [libAntiPatterns, setLibAntiPatterns] = useState<PatternRecord[]>([]);
  const [libRecs, setLibRecs] = useState<Recommendation[]>([]);
  const [windowSpec, setWindowSpec] = useState<WindowSpec>({ kind: 'minutes', value: 30 });
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['cognition', 'emotion']));

  const refresh = useCallback(() => {
    try {
      const snapshot = bus.getCognitiveObservatory(windowSpec);
      setObs(snapshot);
      // 记录到趋势追踪器（内部自动去重，30s 一个点）
      trendTracker.record(snapshot);
      // 获取趋势（对比 5 分钟前）
      setTrends(trendTracker.getTrends(5));
      // 计算所有追踪指标的时序数据
      const ts = new Map<string, MetricTimeSeries>();
      for (const key of TRACKED_SERIES) {
        ts.set(key, trendTracker.getTimeSeries(key as any, 30));
      }
      setTimeSeries(ts);
      // 异常检测 + 归因
      const anomReport = trendTracker.getAnomalies();
      setAnomalies(anomReport);
      if (anomReport.flags.some(f => f.severity !== 'normal')) {
        const baseObs = inferBaselineObservatory(snapshot, anomReport.flags);
        setAttributions(attributionEngine.attributeAnomalies(anomReport.flags, snapshot, baseObs));
        // 因果下钻
        const traces = new Map<string, CausalNode>();
        for (const f of anomReport.flags) {
          if (f.severity !== 'normal') {
            traces.set(f.key, attributionEngine.traceRootCause(f, snapshot));
          }
        }
        setCausalTraces(traces);
      } else {
        setAttributions([]);
        setCausalTraces(new Map());
      }

      // 模式发现
      patternDetector.recordEdges(snapshot);
      const snapCount = trendTracker.getHistory().length;
      setPatterns(patternDetector.discover(snapshot, ts, snapCount));

      // 案例排行
      if (snapshot.chainDetail.length > 0) {
        setCaseRanking(rankCases(snapshot.chainDetail));
      }

      // 模式库积累
      patternLibrary.ingest(snapshot.chainDetail);
      setLibStats(patternLibrary.getStats());
      setLibTopPatterns(patternLibrary.getTopPatterns(4));
      setLibAntiPatterns(patternLibrary.getAntiPatterns(4));
      setLibRecs(patternLibrary.getRecommendations());
    } catch { /* bus not ready */ }
  }, [windowSpec]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const attrFor = (key: string) => attributions.find(a => a.metricKey === key);
  const causalFor = (key: string) => causalTraces.get(key);
  const isAttrExpanded = (key: string) => expandedAttr.has(key);
  const isCausalExpanded = (key: string) => expandedCausal.has(key);
  const toggleAttr = (key: string) => {
    setExpandedAttr(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleCausal = (key: string) => {
    setExpandedCausal(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleReplayChain = (corrSuffix: string) => {
    if (replayingChain === corrSuffix) {
      setReplayingChain(null);
      setReplayEvents([]);
      setChainComparison(null);
      return;
    }
    // 用后缀匹配完整的 correlationId
    const allEvents = bus.getLog();
    const matched = allEvents.find(e => e.correlationId?.endsWith(corrSuffix));
    if (matched?.correlationId) {
      const chain = bus.traceChain(matched.correlationId);
      setReplayEvents(chain);
      setReplayingChain(corrSuffix);
      onInspectChain?.(matched.correlationId);

      // 如果回放的是失败链，自动做对比诊断
      const failedDetail = obs?.chainDetail.find(cd => cd.correlationId === corrSuffix);
      if (failedDetail && failedDetail.yield !== 'stored' && obs) {
        const comp = compareChains(failedDetail, obs.chainDetail);
        if (comp) setChainComparison(comp);
        else setChainComparison(null);
      } else {
        setChainComparison(null);
      }
    }
  };

  if (!visible) return null;

  const isEmpty = !obs || obs.structure.chainCount === 0;
  const t = trends; // shorthand
  const ts = (key: string) => timeSeries.get(key);

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 bg-slate-900/95 text-slate-100 shadow-2xl rounded-xl border border-slate-700 backdrop-blur max-h-[75vh] overflow-y-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 sticky top-0 bg-slate-900/95 z-10">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-xs">认知观测台</span>
          {obs && (
            <span className={`text-xs font-bold font-mono ml-1 ${healthColor(obs.cognition.chainQualityScore)}`}>
              {obs.cognition.chainQualityScore}
            </span>
          )}
          {t && <TrendArrow point={t.cognition.chainQualityScore} />}
        </div>
        <div className="flex items-center gap-0.5">
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
        <div className="px-4 py-8 text-center text-slate-500 text-sm">
          <Sparkles className="w-5 h-5 mx-auto mb-2 opacity-50" />
          <p>尚无认知数据</p>
          <p className="text-xs mt-1 text-slate-600">等待首次认知活动...</p>
          {t && t.snapshotCount > 0 && (
            <p className="text-xs mt-1 text-slate-500">
              趋势数据已积累 {t.snapshotCount} 个快照，等待新链产生
            </p>
          )}
        </div>
      ) : (
        <>
          {/* ── Anomaly Banner ── */}
          {anomalies && anomalies.summary && (
            <div className={`mx-3 mt-2 px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-[10px] ${
              anomalies.flags.some(f => f.severity === 'alert')
                ? 'bg-rose-400/10 border border-rose-500/30 text-rose-300'
                : 'bg-amber-400/10 border border-amber-500/30 text-amber-300'
            }`}>
              {anomalies.flags.some(f => f.severity === 'alert')
                ? <AlertOctagon className="w-3 h-3 shrink-0" />
                : <AlertTriangle className="w-3 h-3 shrink-0" />
              }
              <span className="truncate">{anomalies.summary}</span>
            </div>
          )}

          {/* ── Cognitive Health Score ── */}
          <div className={`mx-3 mt-2 px-3 py-2 rounded-lg ${healthBg(obs!.cognition.chainQualityScore)} border border-slate-700/50`}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400">认知健康度</span>
              <span className="flex items-center gap-1">
                <span className={`text-lg font-bold font-mono ${healthColor(obs!.cognition.chainQualityScore)}`}>
                  {obs!.cognition.chainQualityScore}
                </span>
                {t && <TrendArrow point={t.cognition.chainQualityScore} />}
                {ts('chainQualityScore') && (
                  <VolatilityTag level={ts('chainQualityScore')!.volatilityLevel} />
                )}
              </span>
            </div>
            {/* Sparkline for quality score */}
            {ts('chainQualityScore') && ts('chainQualityScore')!.values.length >= 4 && (
              <div className="mt-1 flex items-center gap-1.5">
                <Sparkline
                  data={ts('chainQualityScore')!.values}
                  width={180}
                  height={22}
                  color={SERIES_COLORS.chainQualityScore}
                  showArea
                />
                {ts('chainQualityScore')!.slope !== null && (
                  <span className={`text-[9px] font-mono ${ts('chainQualityScore')!.slope > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {ts('chainQualityScore')!.slope > 0 ? '+' : ''}{f3(ts('chainQualityScore')!.slope!)}/min
                  </span>
                )}
              </div>
            )}
            <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
              <TrendCell label="好奇心" value={String(obs!.cognition.curiosityIndex)} point={t?.cognition.curiosityIndex} />
              <TrendCell label="效率" value={pct(obs!.cognition.cognitiveEfficiency)} point={t?.cognition.cognitiveEfficiency} />
              <TrendCell label="学习速度" value={`${f1(obs!.cognition.learningVelocity)}/min`} point={t?.cognition.learningVelocity} />
            </div>
          </div>

          {/* ── Layer 1: Structure ── */}
          <Section
            id="structure"
            title="认知结构"
            icon={<GitFork className="w-3 h-3 text-indigo-400" />}
            expanded={expandedSections.has('structure')}
            onToggle={() => toggleSection('structure')}
            summary={<>
              {obs!.structure.chainCount} 链<TrendArrow point={t?.structure.chainCount} showDelta={false} />
              {' · '}深度 {f1(obs!.structure.avgDepth)}<TrendArrow point={t?.structure.avgDepth} showDelta={false} />
              {' · '}深链 {pct(obs!.structure.deepChainRatio)}<TrendArrow point={t?.structure.deepChainRatio} showDelta={false} />
            </>}
          >
            <div className="space-y-1.5">
              <TrendRow label="认知链" value={String(obs!.structure.chainCount)} point={t?.structure.chainCount} />
              <TrendRow label="平均深度" value={f1(obs!.structure.avgDepth)} point={t?.structure.avgDepth} />
              <Row label="最大深度" value={String(obs!.structure.maxDepth)} />
              <Row label="孤立链比" value={pct(obs!.structure.isolatedRatio)} sub="≤2 事件" />
              <div className="flex items-center gap-1">
                <TrendRow label="深链占比" value={pct(obs!.structure.deepChainRatio)} point={t?.structure.deepChainRatio} sub="≥4 事件" />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'deepChainRatio')} attr={attrFor('deepChainRatio')} expanded={isAttrExpanded('deepChainRatio')} onToggle={() => toggleAttr('deepChainRatio')} />
              </div>
              {isAttrExpanded('deepChainRatio') && attrFor('deepChainRatio') && <AttributionPanel attr={attrFor('deepChainRatio')!} causal={causalFor('deepChainRatio')} causalExpanded={isCausalExpanded('deepChainRatio')} onToggleCausal={() => toggleCausal('deepChainRatio')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
              <div className="flex items-center gap-1 text-[10px] pt-0.5">
                <span className="text-slate-500 w-10 shrink-0">分布</span>
                <div className="flex-1 flex rounded-full overflow-hidden h-2 bg-slate-800">
                  {obs!.structure.depthDistribution.shallow > 0 && (
                    <div className="bg-slate-500 h-full" style={{ flex: obs!.structure.depthDistribution.shallow }} title={`浅层 ${obs!.structure.depthDistribution.shallow}`} />
                  )}
                  {obs!.structure.depthDistribution.medium > 0 && (
                    <div className="bg-amber-500 h-full" style={{ flex: obs!.structure.depthDistribution.medium }} title={`中层 ${obs!.structure.depthDistribution.medium}`} />
                  )}
                  {obs!.structure.depthDistribution.deep > 0 && (
                    <div className="bg-indigo-500 h-full" style={{ flex: obs!.structure.depthDistribution.deep }} title={`深层 ${obs!.structure.depthDistribution.deep}`} />
                  )}
                </div>
                <span className="text-slate-500 text-[9px]">
                  浅{obs!.structure.depthDistribution.shallow} 中{obs!.structure.depthDistribution.medium} 深{obs!.structure.depthDistribution.deep}
                </span>
              </div>
            </div>
          </Section>

          {/* ── Layer 2: Graph ── */}
          <Section
            id="graph"
            title="认知图谱"
            icon={<Footprints className="w-3 h-3 text-cyan-400" />}
            expanded={expandedSections.has('graph')}
            onToggle={() => toggleSection('graph')}
            summary={<>
              <span className="inline-flex items-center">
                熵 {obs!.graph.branchEntropy !== null ? f2(obs!.graph.branchEntropy) : '—'}<TrendArrow point={t?.graph.branchEntropy} showDelta={false} />
                {ts('branchEntropy') && <VolatilityTag level={ts('branchEntropy')!.volatilityLevel} />}
              </span>
              {' · '}{obs!.graph.edgeCount} 边<TrendArrow point={t?.graph.edgeCount} showDelta={false} />
            </>}
          >
            <div className="space-y-1.5">
              <TrendRow label="因果边" value={String(obs!.graph.edgeCount)} point={t?.graph.edgeCount} />
              <TrendRow label="分叉率" value={pct(obs!.graph.forkRate)} point={t?.graph.forkRate} sub="分叉节点/总节点" />
              <div className="flex items-center gap-1">
                <TrendRow label="分支熵" value={obs!.graph.branchEntropy !== null ? f2(obs!.graph.branchEntropy) : '—'} point={t?.graph.branchEntropy} sub="行为不确定度" />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'branchEntropy')} attr={attrFor('branchEntropy')} expanded={isAttrExpanded('branchEntropy')} onToggle={() => toggleAttr('branchEntropy')} />
              </div>
              {isAttrExpanded('branchEntropy') && attrFor('branchEntropy') && <AttributionPanel attr={attrFor('branchEntropy')!} causal={causalFor('branchEntropy')} causalExpanded={isCausalExpanded('branchEntropy')} onToggleCausal={() => toggleCausal('branchEntropy')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
              {/* Branch entropy sparkline */}
              {ts('branchEntropy') && ts('branchEntropy')!.values.length >= 4 && (
                <div className="flex items-center gap-1.5">
                  <Sparkline
                    data={ts('branchEntropy')!.values}
                    width={120}
                    height={16}
                    color={SERIES_COLORS.branchEntropy}
                  />
                  {ts('branchEntropy')!.slope !== null && (
                    <span className={`text-[9px] font-mono ${ts('branchEntropy')!.slope > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {ts('branchEntropy')!.slope > 0 ? '+' : ''}{f3(ts('branchEntropy')!.slope!)}/min
                    </span>
                  )}
                </div>
              )}
              {obs!.graph.topEdges.length > 0 && (
                <div className="pt-1.5 border-t border-slate-800">
                  <div className="text-[10px] text-slate-500 mb-1">高频路径</div>
                  <div className="space-y-0.5">
                    {obs!.graph.topEdges.slice(0, 3).map((e, i) => {
                      const { from, to } = edgeLabel(e.edge);
                      return (
                        <div key={i} className="flex items-center text-[10px] gap-1">
                          <span className="text-indigo-400 truncate max-w-[80px]">{from}</span>
                          <span className="text-slate-600">→</span>
                          <span className="text-cyan-400 truncate max-w-[80px]">{to}</span>
                          <span className="text-slate-500 font-mono ml-auto">{e.count}次</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* ── Layer 3: Behavior ── */}
          <Section
            id="behavior"
            title="认知行为"
            icon={<Lightbulb className="w-3 h-3 text-emerald-400" />}
            expanded={expandedSections.has('behavior')}
            onToggle={() => toggleSection('behavior')}
            summary={<>
              产出率 {pct(obs!.behavior.explorationYield)}<TrendArrow point={t?.behavior.explorationYield} showDelta={false} />
              {' · '}新颖率 {pct(obs!.behavior.noveltyRate)}<TrendArrow point={t?.behavior.noveltyRate} showDelta={false} />
            </>}
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <TrendRow label="探索产出率" value={pct(obs!.behavior.explorationYield)} point={t?.behavior.explorationYield} sub="有效探索/总探索" />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'explorationYield')} attr={attrFor('explorationYield')} expanded={isAttrExpanded('explorationYield')} onToggle={() => toggleAttr('explorationYield')} />
              </div>
              {isAttrExpanded('explorationYield') && attrFor('explorationYield') && <AttributionPanel attr={attrFor('explorationYield')!} causal={causalFor('explorationYield')} causalExpanded={isCausalExpanded('explorationYield')} onToggleCausal={() => toggleCausal('explorationYield')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
              {/* Exploration yield sparkline */}
              {ts('explorationYield') && ts('explorationYield')!.values.length >= 4 && (
                <div className="flex items-center gap-1.5 ml-16">
                  <Sparkline
                    data={ts('explorationYield')!.values}
                    width={100}
                    height={14}
                    color={SERIES_COLORS.explorationYield}
                  />
                  {ts('explorationYield')!.slope !== null && (
                    <span className={`text-[9px] font-mono ${ts('explorationYield')!.slope > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ts('explorationYield')!.slope > 0 ? '+' : ''}{f3(ts('explorationYield')!.slope!)}/min
                    </span>
                  )}
                </div>
              )}
              <TrendRow label="新颖率" value={pct(obs!.behavior.noveltyRate)} point={t?.behavior.noveltyRate} sub="新话题占比" />
              <TrendRow label="重复率" value={pct(obs!.behavior.duplicateRate)} point={t?.behavior.duplicateRate} sub="重复跳过/总发现" />
              <div className="flex items-center gap-1">
                <TrendRow label="策略转化" value={pct(obs!.behavior.strategyConversion)} point={t?.behavior.strategyConversion} sub="策略选择/探索开始" />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'strategyConversion')} attr={attrFor('strategyConversion')} expanded={isAttrExpanded('strategyConversion')} onToggle={() => toggleAttr('strategyConversion')} />
              </div>
              {isAttrExpanded('strategyConversion') && attrFor('strategyConversion') && <AttributionPanel attr={attrFor('strategyConversion')!} causal={causalFor('strategyConversion')} causalExpanded={isCausalExpanded('strategyConversion')} onToggleCausal={() => toggleCausal('strategyConversion')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
            </div>
          </Section>

          {/* ── Layer 4: Cognition ── */}
          <Section
            id="cognition"
            title="认知智能"
            icon={<Zap className="w-3 h-3 text-amber-400" />}
            expanded={expandedSections.has('cognition')}
            onToggle={() => toggleSection('cognition')}
            summary={<>
              好奇心 {obs!.cognition.curiosityIndex}<TrendArrow point={t?.cognition.curiosityIndex} showDelta={false} />
              {' · '}学习 {f1(obs!.cognition.learningVelocity)}/min<TrendArrow point={t?.cognition.learningVelocity} showDelta={false} />
            </>}
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <TrendRow label="好奇心指数" value={String(obs!.cognition.curiosityIndex)} point={t?.cognition.curiosityIndex} />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'curiosityIndex')} attr={attrFor('curiosityIndex')} expanded={isAttrExpanded('curiosityIndex')} onToggle={() => toggleAttr('curiosityIndex')} />
              </div>
              {isAttrExpanded('curiosityIndex') && attrFor('curiosityIndex') && <AttributionPanel attr={attrFor('curiosityIndex')!} causal={causalFor('curiosityIndex')} causalExpanded={isCausalExpanded('curiosityIndex')} onToggleCausal={() => toggleCausal('curiosityIndex')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
              {ts('curiosityIndex') && ts('curiosityIndex')!.values.length >= 4 && (
                <div className="flex items-center gap-1.5 ml-16">
                  <Sparkline
                    data={ts('curiosityIndex')!.values}
                    width={100}
                    height={14}
                    color={SERIES_COLORS.curiosityIndex}
                  />
                  {ts('curiosityIndex')!.slope !== null && (
                    <span className={`text-[9px] font-mono ${ts('curiosityIndex')!.slope > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ts('curiosityIndex')!.slope > 0 ? '+' : ''}{f3(ts('curiosityIndex')!.slope!)}/min
                    </span>
                  )}
                </div>
              )}
              <TrendRow label="认知效率" value={pct(obs!.cognition.cognitiveEfficiency)} point={t?.cognition.cognitiveEfficiency} sub="发现/总事件" />
              <TrendRow label="学习速度" value={`${f1(obs!.cognition.learningVelocity)}/min`} point={t?.cognition.learningVelocity} sub="每分钟新增发现" />
              <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'learningVelocity')} attr={attrFor('learningVelocity')} expanded={isAttrExpanded('learningVelocity')} onToggle={() => toggleAttr('learningVelocity')} />
              {isAttrExpanded('learningVelocity') && attrFor('learningVelocity') && <AttributionPanel attr={attrFor('learningVelocity')!} causal={causalFor('learningVelocity')} causalExpanded={isCausalExpanded('learningVelocity')} onToggleCausal={() => toggleCausal('learningVelocity')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
              {ts('learningVelocity') && ts('learningVelocity')!.values.length >= 4 && (
                <div className="flex items-center gap-1.5 ml-16">
                  <Sparkline
                    data={ts('learningVelocity')!.values}
                    width={100}
                    height={14}
                    color={SERIES_COLORS.learningVelocity}
                  />
                  {ts('learningVelocity')!.slope !== null && (
                    <span className={`text-[9px] font-mono ${ts('learningVelocity')!.slope > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ts('learningVelocity')!.slope > 0 ? '+' : ''}{f3(ts('learningVelocity')!.slope!)}/min
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1">
                <TrendRow label="综合质量分" value={String(obs!.cognition.chainQualityScore)} point={t?.cognition.chainQualityScore} sub="加权综合评分" />
                <AnomalyDot flag={anomalies?.flags.find(f => f.key === 'chainQualityScore')} attr={attrFor('chainQualityScore')} expanded={isAttrExpanded('chainQualityScore')} onToggle={() => toggleAttr('chainQualityScore')} />
              </div>
              {isAttrExpanded('chainQualityScore') && attrFor('chainQualityScore') && <AttributionPanel attr={attrFor('chainQualityScore')!} causal={causalFor('chainQualityScore')} causalExpanded={isCausalExpanded('chainQualityScore')} onToggleCausal={() => toggleCausal('chainQualityScore')} onReplayChain={handleReplayChain} replayingId={replayingChain} replayEvents={replayEvents} chainComparison={chainComparison} />}
            </div>
          </Section>

          {/* ── Trend status footer ── */}
          {t && t.snapshotCount > 0 && (
            <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-900/60 flex items-center gap-2 text-[9px] text-slate-500">
              <Activity className="w-3 h-3" />
              <span>{t.lookbackMinutes}min 回望</span>
              <span>·</span>
              <span>{t.snapshotCount} 点</span>
              {t.snapshotCount < 10 && (
                <span className="text-amber-500 ml-auto">积累中...</span>
              )}
              {t.snapshotCount >= 10 && ts('chainQualityScore')?.trend && (
                <span className={`ml-auto ${
                  ts('chainQualityScore')!.trend === 'rising' ? 'text-emerald-400' :
                  ts('chainQualityScore')!.trend === 'falling' ? 'text-rose-400' :
                  ts('chainQualityScore')!.trend === 'volatile' ? 'text-amber-400' :
                  'text-slate-500'
                }`}>
                  {ts('chainQualityScore')!.trend === 'rising' ? '📈 上升' :
                   ts('chainQualityScore')!.trend === 'falling' ? '📉 下降' :
                   ts('chainQualityScore')!.trend === 'volatile' ? '🌊 波动' :
                   '➡️ 平稳'}
                </span>
              )}
            </div>
          )}

          {/* ── Pattern Library ── */}
          {libStats && libStats.totalChains >= 4 && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-900/80">
              <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1 justify-between">
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-violet-400" />
                  模式库
                </span>
                <span className="text-slate-600">
                  {libStats.totalPatterns} 模式 · {libStats.totalChains} 链 · 成功率 {(libStats.overallSuccessRate*100).toFixed(0)}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* 成功模式 */}
                {libTopPatterns.length > 0 && (
                  <div>
                    <div className="text-emerald-400 text-[9px] mb-1">🏆 成功模式</div>
                    {libTopPatterns.slice(0, 3).map((p, i) => {
                      const rate = p.successes / p.total;
                      return (
                        <div key={i} className="text-[8px] mb-0.5">
                          <span className="text-slate-300 font-mono">{p.signature}</span>
                          <span className="text-slate-500 ml-1">
                            ×{p.total} {(rate*100).toFixed(0)}% 深{p.avgDepth.toFixed(1)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* 反模式 */}
                {libAntiPatterns.length > 0 && (
                  <div>
                    <div className="text-rose-400 text-[9px] mb-1">⚠ 反模式</div>
                    {libAntiPatterns.slice(0, 3).map((p, i) => {
                      const rate = p.failures / p.total;
                      return (
                        <div key={i} className="text-[8px] mb-0.5">
                          <span className="text-slate-300 font-mono">{p.signature}</span>
                          <span className="text-slate-500 ml-1">
                            ×{p.total} {(rate*100).toFixed(0)}%失败
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 自动建议 */}
              {libRecs.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-slate-800">
                  <div className="text-[9px] text-violet-400 mb-1">💡 建议</div>
                  {libRecs.slice(0, 2).map((r, i) => (
                    <div key={i} className={`text-[8px] rounded px-1.5 py-0.5 mb-0.5 ${
                      r.severity === 'high' ? 'bg-rose-400/5 border border-rose-500/20 text-rose-300' :
                      r.severity === 'medium' ? 'bg-amber-400/5 border border-amber-500/20 text-amber-300' :
                      'bg-slate-800/50 text-slate-400'
                    }`}>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-slate-500">{r.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Layer 5: Emotion ── */}
          <Section
            id="emotion"
            title="情感状态"
            icon={<Activity className="w-3 h-3 text-pink-400" />}
            expanded={expandedSections.has('emotion')}
            onToggle={() => toggleSection('emotion')}
            summary={<>
              {obs!.emotion.dominantEmotion}
              {obs!.emotion.reversalCount > 0 && ` · ${obs!.emotion.reversalCount}次反转`}
              {obs!.emotion.phaseTransitions > 0 && ` · ${obs!.emotion.phaseTransitions}次阶段转换`}
            </>}
          >
            <div className="space-y-1.5">
              <Row label="主导情绪" value={obs!.emotion.dominantEmotion} />
              <Row label="效价" value={f2(obs!.emotion.valence)} sub={obs!.emotion.valence > 0 ? '积极' : obs!.emotion.valence < 0 ? '消极' : '中性'} />
              <Row label="唤醒度" value={f2(obs!.emotion.arousal)} />
              <Row label="能量" value={`${(obs!.emotion.taiji.arousal * 100).toFixed(0)}%`} />
              <Row label="情绪熵" value={obs!.emotion.emotionEntropy !== null ? f2(obs!.emotion.emotionEntropy) : '—'} sub="多样性" />
              {obs!.emotion.reversalCount > 0 && <Row label="情绪反转" value={String(obs!.emotion.reversalCount)} />}
              {obs!.emotion.phaseTransitions > 0 && <Row label="阶段转换" value={String(obs!.emotion.phaseTransitions)} />}
              {obs!.emotion.topEmotions.length > 0 && (
                <div className="pt-1 border-t border-slate-800 text-[10px]">
                  <span className="text-slate-500">情绪强度 Top 3: </span>
                  {obs!.emotion.topEmotions.map((e, i) => (
                    <span key={e.name} className="text-slate-400 ml-1">
                      {e.name} {e.intensity.toFixed(2)}
                      {i < obs!.emotion.topEmotions.length - 1 ? ',' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {/* ── Case Ranking ── */}
          {caseRanking && (caseRanking.best.length > 0 || caseRanking.worst.length > 0) && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-900/80">
              <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1">
                <Layers className="w-3 h-3 text-amber-400" />
                案例排行
              </div>
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                {caseRanking.best.length > 0 && (
                  <div>
                    <div className="text-emerald-400 mb-1">✅ 最佳链</div>
                    {caseRanking.best.slice(0, 3).map((c, i) => (
                      <div key={i} className="text-slate-400 truncate" title={c.eventSeq}>
                        {c.correlationId} 深{c.depth} {c.eventSeq.slice(0, 20)}...
                      </div>
                    ))}
                  </div>
                )}
                {caseRanking.worst.length > 0 && (
                  <div>
                    <div className="text-rose-400 mb-1">❌ 最差链</div>
                    {caseRanking.worst.slice(0, 3).map((c, i) => (
                      <div key={i} className="text-slate-400 truncate" title={c.eventSeq}>
                        {c.correlationId} 深{c.depth} {c.eventSeq.slice(0, 20)}...
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Pattern Discovery ── */}
          {patterns.length > 0 && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-900/80">
              <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1">
                <Search className="w-3 h-3 text-violet-400" />
                模式发现
              </div>
              <div className="space-y-1">
                {patterns.map((p, i) => (
                  <div key={i} className={`text-[10px] rounded px-1.5 py-1 ${
                    p.importance === 'high' ? 'bg-violet-400/5 border border-violet-500/20' :
                    p.importance === 'medium' ? 'bg-slate-800/50' : ''
                  }`}>
                    <div className="flex items-center gap-1">
                      <span>{p.icon}</span>
                      <span className={`${p.importance === 'high' ? 'text-violet-300' : 'text-slate-300'}`}>{p.title}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5 ml-4">{p.detail}</div>
                    <div className="text-slate-600 ml-4 text-[9px]">{p.evidence}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Strongest Causal Edges (always visible footer) ── */}
          {obs!.graph.strongestEdges.length > 0 && (
            <div className="px-3 py-2 border-t border-slate-700 bg-slate-900/80">
              <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                最强因果边
                <span className="text-slate-600 ml-1">(Lift)</span>
              </div>
              <div className="space-y-0.5">
                {obs!.graph.strongestEdges.slice(0, 5).map((e, i) => {
                  const { from, to } = edgeLabel(e.edge);
                  const liftVal = e.lift;
                  return (
                    <div key={i} className="flex items-center text-[10px] gap-1">
                      <span className="text-indigo-400 truncate max-w-[72px]">{from}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-cyan-400 truncate max-w-[72px]">{to}</span>
                      <span className={`font-mono ml-auto ${liftColor(liftVal)}`}>
                        ×{f2(liftVal)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 可折叠区域组件 ──
function Section({ id, title, icon, expanded, onToggle, summary, children }: {
  id: string;
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  summary: React.ReactNode;
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

// ── 异常标记（可点击展开归因）──
function AnomalyDot({ flag, attr, expanded, onToggle }: {
  flag: AnomalyFlag | undefined;
  attr?: MetricAttribution;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  if (!flag || flag.severity === 'normal') return null;
  const cls = flag.severity === 'alert'
    ? 'text-rose-400 bg-rose-400/10 hover:bg-rose-400/20'
    : 'text-amber-400 bg-amber-400/10 hover:bg-amber-400/20';
  const icon = flag.severity === 'alert'
    ? <AlertOctagon className="w-2.5 h-2.5 inline" />
    : <AlertTriangle className="w-2.5 h-2.5 inline" />;
  return (
    <button
      onClick={onToggle}
      className={`${cls} font-mono text-[8px] ml-1 px-1 rounded inline-flex items-center gap-px cursor-pointer transition-colors`}
      title={attr ? '点击查看归因' : undefined}
    >
      {icon}{flag.zScore !== null ? `${flag.zScore > 0 ? '+' : ''}${flag.zScore.toFixed(1)}σ` : '?'}
    </button>
  );
}

// ── 归因展开面板 ──
function AttributionPanel({ attr, causal, causalExpanded, onToggleCausal, onReplayChain, replayingId, replayEvents, chainComparison }: {
  attr: MetricAttribution;
  causal?: CausalNode;
  causalExpanded?: boolean;
  onToggleCausal?: () => void;
  onReplayChain?: (id: string) => void;
  replayingId?: string | null;
  replayEvents?: any[];
  chainComparison?: ChainComparison | null;
}) {
  return (
    <div className="ml-16 mb-1.5 text-[9px] bg-slate-800/60 rounded px-2 py-1.5 border border-slate-700/50">
      <div className="text-slate-500 mb-1 flex items-center gap-1">
        <Layers className="w-2.5 h-2.5" />
        归因分析
        <span className="text-slate-600">
          ({attr.current.toFixed(attr.current < 10 ? 2 : 0)} {attr.delta > 0 ? '+' : ''}{attr.delta.toFixed(attr.delta < 1 ? 2 : 0)})
        </span>
      </div>
      <div className="space-y-0.5">
        {attr.factors.map((f, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-slate-400">{f.label}</span>
            <span className="flex items-center gap-1">
              <span className="text-slate-500">{f.detail}</span>
              <span className={`font-mono ${f.contribution > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(f.contribution < 1 ? 3 : 1)}
              </span>
              <span className="text-slate-600">{f.contributionPct}%</span>
            </span>
          </div>
        ))}
      </div>
      {/* 深层原因按钮 */}
      {causal && (
        <button
          onClick={onToggleCausal}
          className="mt-1.5 text-[8px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5 transition-colors"
        >
          <Search className="w-2.5 h-2.5" />
          {causalExpanded ? '收起根因分析' : '深层原因 ↓'}
        </button>
      )}
      {causalExpanded && causal && <CausalTree node={causal} depth={0} onReplayChain={onReplayChain} replayingId={replayingId} replayEvents={replayEvents} chainComparison={chainComparison} />}
    </div>
  );
}

// ── 因果树递归渲染 ──
function CausalTree({ node, depth, onReplayChain, replayingId, replayEvents, chainComparison }: {
  node: CausalNode; depth: number;
  onReplayChain?: (id: string) => void;
  replayingId?: string | null;
  replayEvents?: any[];
  chainComparison?: ChainComparison | null;
}) {
  const indent = depth * 2;
  const hasChildren = node.children.length > 0;

  // 检测是否为链节点（label 以 "链 " 开头，detail 包含 "→"）
  const isChainNode = node.label.startsWith('链 ') && node.detail.includes('→');

  return (
    <div className="mt-1" style={{ marginLeft: `${indent * 4}px` }}>
      <div className="flex items-start gap-1">
        <span className="text-indigo-400 mt-0.5 shrink-0">
          {depth === 0 ? '┌' : hasChildren ? '├' : '└'}
        </span>
        <div className="flex-1 min-w-0">
          {isChainNode ? (
            <button
              onClick={() => {
                const id = node.label.replace('链 ', '').trim();
                onReplayChain?.(id);
              }}
              className="text-left hover:bg-slate-800/50 rounded px-0.5 -mx-0.5 transition-colors cursor-pointer group"
            >
              <span className="text-indigo-300 group-hover:text-indigo-200">{node.label}</span>
              <span className="text-slate-500 ml-1 group-hover:text-slate-400">{node.detail}</span>
              <span className="text-[8px] text-slate-600 ml-1 opacity-0 group-hover:opacity-100">▶ 回放</span>
            </button>
          ) : (
            <>
              <span className="text-slate-300">{node.label}</span>
              <span className="text-slate-500 ml-1">{node.detail}</span>
            </>
          )}
          {/* 内联事件回放 */}
          {isChainNode && replayingId && node.label.includes(replayingId) && replayEvents && replayEvents.length > 0 && (
            <div className="mt-1 mb-1 text-[8px] bg-slate-800/80 rounded px-1.5 py-1 border border-indigo-500/20">
              <div className="text-indigo-400 mb-0.5">事件序列 ({replayEvents.length})</div>
              {replayEvents.map((ev: any, i: number) => {
                const meta = EVENT_META[ev.type as keyof typeof EVENT_META];
                return (
                  <div key={i} className="flex items-center gap-1 py-0.5 border-b border-slate-800 last:border-0">
                    <span className="text-slate-600 w-12 shrink-0">{new Date(ev.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ev.level === 'cognitive' ? '#818cf8' : '#64748b' }} />
                    <span className="text-slate-300 truncate">{meta?.label || ev.type}</span>
                    {ev.data?.topic && <span className="text-slate-500 truncate max-w-[60px]">"{ev.data.topic}"</span>}
                    {ev.data?.strategy && <span className="text-amber-500 truncate max-w-[60px]">{ev.data.strategy}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {/* 对比诊断 */}
          {isChainNode && replayingId && node.label.includes(replayingId) && chainComparison && (
            <div className="mt-1 text-[8px] bg-amber-400/5 rounded px-1.5 py-1 border border-amber-500/20">
              <div className="text-amber-400 mb-0.5">对比诊断: 最相似成功链 {chainComparison.compared.correlationId}</div>
              <div className="flex items-center gap-1 text-slate-400">
                <span>共同前缀:</span>
                <span className="text-slate-300">{chainComparison.sharedPrefix}→</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-rose-400 font-mono">✗ {chainComparison.failedEvent}</span>
                <span className="text-slate-600">vs</span>
                <span className="text-emerald-400 font-mono">✓ {chainComparison.successEvent}</span>
              </div>
              <div className="text-slate-500 mt-0.5">{chainComparison.summary}</div>
            </div>
          )}
        </div>
      </div>
      {node.children.map((child, i) =>
        <React.Fragment key={i}>
          <CausalTree node={child} depth={depth + 1} onReplayChain={onReplayChain} replayingId={replayingId} replayEvents={replayEvents} chainComparison={chainComparison} />
        </React.Fragment>
      )}
    </div>
  );
}

// ── 带趋势箭头的指标行 ──
function TrendRow({ label, value, point, sub, anomalyKey }: {
  label: string; value: string; point: TrendPoint | undefined; sub?: string; anomalyKey?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-slate-500 w-16 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-200 font-mono inline-flex items-center">
        {value}
        <TrendArrow point={point} />
      </span>
      {sub && <span className="text-[10px] text-slate-600 truncate">{sub}</span>}
    </div>
  );
}

// ── 普通指标行（无趋势） ──
function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-slate-500 w-16 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-slate-200 font-mono">{value}</span>
      {sub && <span className="text-[10px] text-slate-600 truncate">{sub}</span>}
    </div>
  );
}
