import { useEffect, useState } from 'react';

/**
 * 「她现在」OS 应用（v1.63）：实时显示她的情绪 + 小屋活动 + 低谷。
 * 数据：GET /api/her-state（只读，3s 轮询）。
 */
interface HerState {
  ok: boolean;
  roomEnabled: boolean;
  room: {
    active: boolean;
    activity: null | { id: string; label: string; since: number; minutes: number };
    minutes: number;
    turns: number;
    history: Array<{ label: string; since: number; until: number }>;
  };
  emotion: { top: string | null; delta: number };
  lowPeriod: null | { active: boolean; established: boolean; turns: number; phase: string };
  now?: number;
}

const EMOTION_LABEL: Record<string, string> = {
  joy: '开心', love: '爱意', sad: '难过', fear: '不安', anger: '生气',
  disgust: '厌烦', calm: '平静', greed: '渴望', lust: '心动',
};

function ago(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  return `${Math.round(m / 60)} 小时前`;
}

export default function HerStateApp() {
  const [s, setS] = useState<HerState | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/her-state');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = (await r.json()) as HerState;
        if (alive) { setS(data); setErr(null); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : '读取失败');
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const now = s?.now ?? Date.now();
  const top = s?.emotion.top ?? null;
  const lp = s?.lowPeriod;

  return (
    <div className="flex h-full flex-col gap-3 bg-[#0f1120]/70 p-4 text-slate-200">
      {err && <div className="rounded-lg border border-amber-300/30 bg-amber-400/10 p-2 text-[11px] text-amber-200">{err}</div>}

      {/* 此刻情绪 */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-400">此刻情绪</div>
        <div className="mt-1 flex items-end gap-2">
          <div className="text-2xl font-semibold text-rose-200">
            {top ? (EMOTION_LABEL[top] ?? top) : '静息'}
          </div>
          {top && s?.emotion.delta ? (
            <div className={`pb-1 text-[12px] tabular-nums ${s.emotion.delta >= 0 ? 'text-rose-300' : 'text-slate-300'}`}>
              +{s.emotion.delta.toFixed(2)}
            </div>
          ) : null}
        </div>
        {lp && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className={`rounded border px-1.5 py-[1px] ${lp.established ? 'border-rose-300/40 bg-rose-400/10 text-rose-200' : 'border-white/15 text-slate-300'}`}>
              {lp.established ? '低谷已成段' : lp.active ? '低谷中' : '不在低谷'}
            </span>
            {lp.turns > 0 && <span className="text-slate-400">已 {lp.turns} 轮</span>}
            {lp.phase && lp.phase !== 'none' && <span className="text-slate-500">{lp.phase}</span>}
          </div>
        )}
      </div>

      {/* 小屋 */}
      <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">她的小屋</div>
          <div className="text-[10px] text-slate-500">{s?.roomEnabled ? '真实活动 · 非编造' : '小屋未开启'}</div>
        </div>
        {s?.room.active && s.room.activity ? (
          <>
            <div className="mt-2 text-[15px] leading-relaxed text-slate-100">{s.room.activity.label}</div>
            <div className="mt-1 text-[11px] text-slate-400">
              {ago(s.room.activity.since, now)}开始 · 已 {s.room.minutes} 分钟
            </div>
            {s.room.history.length > 0 && (
              <div className="mt-3 border-t border-white/10 pt-2">
                <div className="mb-1 text-[10px] text-slate-500">之前</div>
                {s.room.history.slice().reverse().slice(0, 4).map((h, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2 text-[11px] text-slate-400">
                    <span className="truncate">{h.label}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{ago(h.since, now)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
            小屋活动只在 <code className="rounded bg-white/10 px-1">ENABLE_HER_ROOM=true</code> 时记录；开着她会有"此刻在做什么"的真实状态。
          </div>
        )}
      </div>

      <div className="text-[10px] text-slate-500">每 3 秒刷新 · 只读（不写、不改她的状态）</div>
    </div>
  );
}
