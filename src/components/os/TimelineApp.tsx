import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * "她的状态线" OS 应用：时间线浏览 + 沙盒分叉回放（只读）。
 * 数据来自 v1.60 Stage 1/3/2 的两个只读端点：
 *   GET  /api/timeline         （需 ENABLE_TIMELINE_REPLAY=true）
 *   POST /api/replay/branch    （决策层分叉，不回档）
 */
type TimelineRecord = {
  kind: 'state_change' | 'branch' | 'outcome';
  ts: number;
  round: number;
  [k: string]: unknown;
};

interface ReplayCandidate {
  choice: string;
  snippet: string;
  allowsSelfStateVoice: boolean;
  allowsCause: boolean;
  learnedWeight: number;
  learnedBias: number;
  graduatedSamples: number;
  note: string;
}

interface ReplayResult {
  ok: boolean;
  reason?: string;
  from: null | { round: number; causeChainQuoted: string | null; lowActive: boolean; lowTurns: number; candidates: string[] };
  actual: null | { chosen: string; replyExcerpt: string; outcome: string | null };
  candidates: ReplayCandidate[];
  limitations: string[];
}

const KIND_META: Record<string, { label: string; cls: string }> = {
  state_change: { label: '状态', cls: 'bg-indigo-400/15 text-indigo-200 border-indigo-300/25' },
  branch: { label: '分支', cls: 'bg-rose-400/15 text-rose-200 border-rose-300/25' },
  outcome: { label: '结果', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-300/25' },
};

const CHOICE_LABEL: Record<string, string> = {
  voice_with_cause: '说状态+原因',
  voice: '只说状态',
  silence: '不说自己',
  defer: '让位（先接他）',
  comfort: '安慰他',
  landed: '接住了',
  missed: '没接住',
  unclear: '不确定',
};

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TimelineApp() {
  const [nodes, setNodes] = useState<TimelineRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);   // round
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [onlyChoice, setOnlyChoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/timeline?limit=80');
      if (r.status === 404) { setErr('回放端点未开启：启动服务时设 ENABLE_TIMELINE_REPLAY=true'); return; }
      const data = await r.json();
      if (!data?.ok) { setErr(String(data?.error ?? '读取失败')); return; }
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedNode = useMemo(() => nodes.find(n => n.round === selected) ?? null, [nodes, selected]);

  const runReplay = useCallback(async (round: number) => {
    setReplayBusy(true);
    setReplay(null);
    try {
      const r = await fetch('/api/replay/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromRound: round }),
      });
      const data = (await r.json()) as ReplayResult;
      setReplay(data);
      setOnlyChoice(null);
    } catch (e) {
      setReplay({ ok: false, reason: e instanceof Error ? e.message : '回放失败', from: null, actual: null, candidates: [], limitations: [] });
    } finally {
      setReplayBusy(false);
    }
  }, []);

  const shown = replay ? (onlyChoice ? replay.candidates.filter(c => c.choice === onlyChoice) : replay.candidates) : [];

  return (
    <div className="flex h-full min-h-0 bg-[#0f1120]/60 text-slate-200">
      {/* 左：节点流 */}
      <div className="flex w-[54%] min-w-0 flex-col border-r border-white/10">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-[12px] font-semibold">她的状态线</span>
          <span className="text-[11px] text-slate-400">{nodes.length} 个节点</span>
          <button onClick={() => void load()} className="ml-auto rounded-md border border-white/15 px-2 py-0.5 text-[11px] hover:bg-white/10">
            {loading ? '读取中…' : '刷新'}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {err && <div className="m-2 rounded-lg border border-amber-300/30 bg-amber-400/10 p-2 text-[11px] text-amber-200">{err}</div>}
          {!err && nodes.length === 0 && !loading && (
            <div className="m-2 text-[11px] leading-relaxed text-slate-400">
              还没有节点。时间线只在 <code className="rounded bg-white/10 px-1">ENABLE_EMOTION_TIMELINE=true</code> 时写入。
            </div>
          )}
          {nodes.map(n => {
            const meta = KIND_META[n.kind] ?? KIND_META.state_change;
            const isSel = n.round === selected;
            return (
              <button
                key={`${n.kind}-${n.ts}-${n.round}`}
                data-testid={`tl-node-${n.kind}-${n.round}`}
                onClick={() => { setSelected(n.round); setReplay(null); }}
                className={`mb-1.5 block w-full rounded-lg border px-2.5 py-2 text-left transition ${isSel ? 'border-rose-300/50 bg-rose-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-1.5 py-[1px] text-[10px] ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[11px] text-slate-400">#{n.round}</span>
                  <span className="text-[11px] text-slate-500">{timeOf(n.ts)}</span>
                  <span className="ml-auto text-[10px] text-slate-500">{n.kind}</span>
                </div>
                <NodeSummary node={n} />
              </button>
            );
          })}
        </div>
      </div>

      {/* 右：详情 / 回放 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-[12px] font-semibold">详情与分叉回放</span>
          {selectedNode?.kind === 'branch' && (
            <button
              data-testid="tl-replay"
              onClick={() => selected !== null && void runReplay(selected)}
              disabled={replayBusy}
              className="ml-auto rounded-md bg-rose-500/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            >
              {replayBusy ? '回放中…' : '分叉回放这一轮'}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[11px] leading-relaxed">
          {!selectedNode && <div className="text-slate-400">从左侧选一个节点。选「分支」节点可以回放"如果换个选择会怎样"。</div>}
          {selectedNode && <NodeDetail node={selectedNode} />}

          {replay && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2.5">
              {!replay.ok ? (
                <div className="text-amber-200">回放不可用：{replay.reason}</div>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                    <span className="rounded bg-indigo-400/15 px-1.5 py-[1px] text-indigo-200">决策层回放</span>
                    <span>轮次 #{replay.from?.round}</span>
                    {replay.from?.causeChainQuoted && <span className="text-slate-400">起因「{replay.from.causeChainQuoted}」</span>}
                    {replay.actual && <span className="text-slate-400">实际：{CHOICE_LABEL[replay.actual.chosen] ?? replay.actual.chosen} · {CHOICE_LABEL[replay.actual.outcome ?? ''] ?? replay.actual.outcome ?? '待定'}</span>}
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <button onClick={() => setOnlyChoice(null)} className={`rounded border px-1.5 py-[1px] text-[10px] ${onlyChoice === null ? 'border-rose-300/50 bg-rose-400/15 text-rose-100' : 'border-white/15 text-slate-300 hover:bg-white/10'}`}>全部候选</button>
                    {replay.candidates.map(c => (
                      <button key={c.choice} onClick={() => setOnlyChoice(c.choice)} className={`rounded border px-1.5 py-[1px] text-[10px] ${onlyChoice === c.choice ? 'border-rose-300/50 bg-rose-400/15 text-rose-100' : 'border-white/15 text-slate-300 hover:bg-white/10'}`}>
                        {CHOICE_LABEL[c.choice] ?? c.choice}
                      </button>
                    ))}
                  </div>
                  {shown.map(c => (
                    <div key={c.choice} data-testid={`tl-cand-${c.choice}`} className="mb-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-100">{CHOICE_LABEL[c.choice] ?? c.choice}</span>
                        <span className="text-[10px] text-slate-400">权重 {c.learnedWeight.toFixed(2)} · 样本 {c.graduatedSamples}</span>
                        <span className="text-[10px] text-slate-400">自我状态 {c.allowsSelfStateVoice ? '✓' : '✗'} · 原因 {c.allowsCause ? '✓' : '✗'}</span>
                      </div>
                      <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[10px] leading-relaxed text-slate-300">{c.snippet}</pre>
                      <div className="mt-1 text-[10px] text-slate-500">{c.note}</div>
                    </div>
                  ))}
                  <div className="mt-1 text-[10px] text-slate-500">
                    {replay.limitations.join(' · ')}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeSummary({ node }: { node: TimelineRecord }) {
  if (node.kind === 'state_change') {
    const before = node.before as { valence?: number } | undefined;
    const after = node.after as { valence?: number } | undefined;
    const delta = node.delta as { valence?: number } | undefined;
    const trigger = node.trigger as { quoted?: string | null; hisEmotion?: string | null } | undefined;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        {trigger?.hisEmotion && <span>他:{trigger.hisEmotion}</span>}
        {trigger?.quoted && <span className="truncate">「{trigger.quoted}」</span>}
        <span className="tabular-nums">v {fmt(before?.valence)} → {fmt(after?.valence)}</span>
        <span className={`tabular-nums ${Number(delta?.valence ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>Δ{fmt(delta?.valence, true)}</span>
      </div>
    );
  }
  if (node.kind === 'branch') {
    const br = node.branch as { chosen?: string; usedVoiceSnippet?: boolean; causeQuoted?: string | null } | undefined;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        <span className="text-rose-200">选择:{CHOICE_LABEL[br?.chosen ?? ''] ?? br?.chosen}</span>
        <span>许可片段 {br?.usedVoiceSnippet ? '开' : '关'}</span>
        {br?.causeQuoted && <span className="truncate">原因「{br.causeQuoted}」</span>}
      </div>
    );
  }
  const out = node.outcome as { hisReaction?: string; herDeltaValence?: number } | undefined;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
      <span className={out?.hisReaction === 'landed' ? 'text-emerald-300' : 'text-slate-400'}>{CHOICE_LABEL[out?.hisReaction ?? ''] ?? out?.hisReaction}</span>
      <span className="tabular-nums">她Δv {fmt(out?.herDeltaValence, true)}</span>
    </div>
  );
}

function NodeDetail({ node }: { node: TimelineRecord }) {
  return (
    <div>
      <div className="mb-1 text-[11px] text-slate-300">
        <span className="rounded border border-white/15 px-1.5 py-[1px] text-[10px]">{KIND_META[node.kind]?.label ?? node.kind}</span>
        <span className="ml-2 text-slate-400">#{node.round} · {timeOf(node.ts)}</span>
      </div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[10px] leading-relaxed text-slate-300">{JSON.stringify(node, null, 2)}</pre>
    </div>
  );
}

function fmt(v: unknown, signed = false): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(3)}`;
}
