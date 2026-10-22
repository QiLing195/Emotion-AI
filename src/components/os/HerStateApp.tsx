import { useEffect, useState } from 'react';

/**
 * 「她现在」OS 应用（v1.63，v1.93 合并）：实时显示
 *   ① 此刻情绪 + 低谷  ② 她的小屋（真实活动）
 *   ③ **她记着的事 + 她看到的活动**（合并成一张卡：心里挂着的 / 眼前看到的）
 * 数据：GET /api/her-state（只读，3s 轮询）。
 */
interface ActivityRow { title: string; process: string; minutesAgo: number; ts: number }

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
  /** v1.81 她记着的事（只读） */
  remembered?: {
    notesEnabled: boolean;
    followupEnabled: boolean;
    notes: Array<{ note: string; agoMinutes: number }>;
    upcoming: Array<{ what: string; dueAt: number; inMinutes: number; due: boolean }>;
  };
  /** v1.93 她看到的活动（只读、标题级）；v1.94 增加"她的理解" */
  activity?: {
    enabled: boolean;
    entries: ActivityRow[];
    note?: string;
    /** 一句话理解（界面标题行） */
    understandingLine?: string;
    understanding?: {
      summary: string;
      category: string;
      label: string;
      confidence: number;
      windows: number;
      spanMinutes: number;
      categories: Array<{ key: string; label: string; count: number; share: number }>;
      evidence: string[];
      vague: boolean;
    } | null;
  };
  now?: number;
}

/** 到点的相对说法（界面用，与 server/services/herRemembered.ts 的 relativeDue 同步维护） */
function dueText(r: { inMinutes: number }): string {
  const m = r.inMinutes;
  if (m <= 0) return '到点了';
  if (m < 60) return `${Math.max(1, m)} 分钟后`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时后`;
  return `${Math.round(h / 24)} 天后`;
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
  const remembered = s?.remembered;
  const activity = s?.activity;
  const hasRemembered = Boolean(remembered && (remembered.notesEnabled || remembered.followupEnabled) &&
    (remembered.notes.length > 0 || remembered.upcoming.length > 0));

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#0f1120]/70 p-4 text-slate-200">
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
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
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
                {s.room.history.slice().reverse().slice(0, 3).map((h, i) => (
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
            {s?.roomEnabled
              ? '小屋现在没记录到活动——她可能刚回到小屋，或者下一次活动还没到。'
              : <>小屋活动只在 <code className="rounded bg-white/10 px-1">ENABLE_HER_ROOM=true</code> 时记录；开着她会有"此刻在做什么"的真实状态。</>}
          </div>
        )}
      </div>

      {/* ★ v1.93 合并卡：她记着的事（心里）＋ 她看到的活动（眼前） */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">她记着的事 · 她看到的活动</div>
          <div className="text-[10px] text-slate-500">只读 · 不发消息</div>
        </div>

        {/* 心里挂着的 / 写下的便签 */}
        <div className="mt-2">
          <div className="mb-1 text-[10px] text-slate-500">心里挂着的、写下的</div>
          {!remembered || (!remembered.notesEnabled && !remembered.followupEnabled) ? (
            <div className="text-[11px] text-slate-500">便签与"到点提醒"都还没开启。</div>
          ) : !hasRemembered ? (
            <div className="text-[11px] text-slate-500">她现在没特别记着什么事。</div>
          ) : (
            <>
              {remembered.upcoming.map((u, i) => (
                <div key={'u' + i} className="flex items-baseline justify-between gap-2 text-[11px] text-slate-300">
                  <span className="truncate">{u.what}</span>
                  <span className={`shrink-0 text-[10px] ${u.due ? 'text-rose-300' : 'text-slate-500'}`}>{dueText(u)}</span>
                </div>
              ))}
              {remembered.notes.map((n, i) => (
                <div key={'n' + i} className="flex items-baseline justify-between gap-2 text-[11px] text-slate-300">
                  <span className="truncate">{n.note}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {n.agoMinutes < 1 ? '刚刚' : n.agoMinutes < 60 ? `${n.agoMinutes} 分钟前` : `${Math.round(n.agoMinutes / 60)} 小时前`}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 眼前看到的（她的理解 + 原始窗口标题；标题级、敏感已隐藏） */}
        <div className="mt-3 border-t border-white/10 pt-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-500">眼前看到的</div>
            <div className="text-[10px] text-slate-600">标题级 · 敏感窗口已隐藏</div>
          </div>

          {/* v1.94 她的理解：规则归纳出来的一句"你在干什么" */}
          {activity?.enabled && activity.understandingLine && (
            <div className="mt-1 rounded-lg border border-sky-300/20 bg-sky-400/[0.07] px-2 py-1.5">
              <div className="text-[10px] text-sky-300/80">她的理解</div>
              <div className="mt-0.5 text-[12px] leading-snug text-slate-100">{activity.understandingLine}</div>
              {activity.understanding && activity.understanding.categories.length > 1 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {activity.understanding.categories.map(c => (
                    <span key={c.key} className="rounded bg-white/10 px-1.5 py-[1px] text-[10px] text-slate-300">
                      {c.label} ×{c.count}
                    </span>
                  ))}
                </div>
              )}
              {activity.understanding?.vague && (
                <div className="mt-1 text-[10px] text-slate-500">证据还不够足，所以她没把话说死。</div>
              )}
            </div>
          )}

          {!activity || !activity.enabled ? (
            <div className="mt-1 text-[11px] text-slate-500">
              {activity?.note ?? '活动采样没开（ENABLE_ACTIVITY_WATCH），她看不到你在用什么。'}
            </div>
          ) : activity.entries.length === 0 ? (
            <div className="mt-1 text-[11px] text-slate-500">{activity.note ?? '还没有采样记录。'}</div>
          ) : (
            <div className="mt-1">
              <div className="mb-0.5 text-[10px] text-slate-600">原始窗口（她看到的就是这些）</div>
              {activity.entries.map((a, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 text-[11px] text-slate-400">
                  <span className="truncate">
                    {a.title}
                    {a.process ? <span className="ml-1 text-[10px] text-slate-500">· {a.process}</span> : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {a.minutesAgo < 1 ? '刚刚' : `${a.minutesAgo} 分钟前`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-[10px] text-slate-500">每 3 秒刷新 · 只读（不写、不改她的状态）</div>
    </div>
  );
}
