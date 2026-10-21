import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import OSWindow, { type WinState } from './OSWindow';

export interface OSAppDef {
  id: string;
  title: string;
  icon: ReactNode;
  accent?: string;
  content: ReactNode;
  /** 初始几何（未最大化时） */
  window: { x: number; y: number; w: number; h: number };
  defaultOpen?: boolean;
}

const TASKBAR_H = 30;
const DOCK_H = 74;
const GEO_KEY = 'os.windows.v1';
const SNAP_EDGE = 24;

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * OS 桌面外壳：壁纸 + 顶部菜单栏 + 底部 Dock + 可拖动/缩放/最小化/最大化的窗口。
 * 窗口状态由本组件持有；外部用 `window.dispatchEvent(new CustomEvent('os:open', { detail: id }))` 打开应用。
 */
export default function OSShell({ apps }: { apps: OSAppDef[] }) {
  const [wins, setWins] = useState<Record<string, WinState>>(() => {
    // 几何持久化：刷新后窗口还在原来的位置（open/minimized 状态不持久化，避免"打开却找不到"）
    let saved: Record<string, { x?: number; y?: number; w?: number; h?: number; maximized?: boolean }> = {};
    try { saved = JSON.parse(localStorage.getItem(GEO_KEY) ?? '{}') as typeof saved; } catch { saved = {}; }
    const init: Record<string, WinState> = {};
    let z = 10;
    for (const a of apps) {
      const s = saved[a.id] ?? {};
      init[a.id] = {
        open: Boolean(a.defaultOpen),
        minimized: false,
        maximized: Boolean(s.maximized),
        x: Number.isFinite(s.x) ? Number(s.x) : a.window.x,
        y: Number.isFinite(s.y) ? Number(s.y) : a.window.y,
        w: Number.isFinite(s.w) ? Number(s.w) : a.window.w,
        h: Number.isFinite(s.h) ? Number(s.h) : a.window.h,
        z: z++,
      };
    }
    return init;
  });
  const zRef = useRef(10 + apps.length);
  const clock = useClock();

  const focus = useCallback((id: string) => {
    setWins(prev => {
      const cur = prev[id];
      if (!cur) return prev;
      if (cur.z === Object.keys(prev).reduce((m, k) => Math.max(m, prev[k].z), 0)) return prev;
      return { ...prev, [id]: { ...cur, z: ++zRef.current } };
    });
  }, []);

  const open = useCallback((id: string) => {
    setWins(prev => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, open: true, minimized: false, z: ++zRef.current } };
    });
  }, []);

  const close = useCallback((id: string) => {
    setWins(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], open: false } } : prev));
  }, []);

  const minimize = useCallback((id: string) => {
    setWins(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], minimized: true } } : prev));
  }, []);

  const toggleMax = useCallback((id: string) => {
    setWins(prev => (prev[id] ? { ...prev, [id]: { ...prev[id], maximized: !prev[id].maximized, z: ++zRef.current } } : prev));
  }, []);

  const toggleFromDock = useCallback((id: string) => {
    const w = wins[id];
    if (!w) return;
    if (!w.open) open(id);
    else if (w.minimized) open(id);
    else if (w.z === Object.keys(wins).reduce((m, k) => Math.max(m, wins[k].z), 0)) minimize(id);
    else focus(id);
  }, [wins, open, minimize, focus]);

  // 外部（如 ModelPanel 的设置按钮）通过事件打开应用
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string' && wins[id]) open(id);
    };
    window.addEventListener('os:open', handler as EventListener);
    return () => window.removeEventListener('os:open', handler as EventListener);
  }, [wins, open]);

  // 几何持久化（位置/大小/最大化；不存 z 序）
  useEffect(() => {
    try {
      const slim: Record<string, { x: number; y: number; w: number; h: number; maximized: boolean }> = {};
      for (const id of Object.keys(wins)) {
        const w = wins[id] as WinState;
        slim[id] = { x: w.x, y: w.y, w: w.w, h: w.h, maximized: w.maximized };
      }
      localStorage.setItem(GEO_KEY, JSON.stringify(slim));
    } catch { /* 隐私模式等场景忽略 */ }
  }, [wins]);

  // 拖到边缘吸附：顶部→最大化；左右→半屏
  const commitGeometry = useCallback((id: string, g: { x: number; y: number; w: number; h: number }) => {
    setWins(prev => {
      const cur = prev[id];
      if (!cur) return prev;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fullH = vh - TASKBAR_H - DOCK_H;
      let next: WinState = { ...cur, x: g.x, y: g.y, w: g.w, h: g.h, maximized: false };
      if (g.y <= TASKBAR_H + 8) {
        next = { ...next, maximized: true };
      } else if (g.x <= SNAP_EDGE) {
        next = { ...next, x: 0, y: TASKBAR_H, w: Math.round(vw / 2), h: fullH };
      } else if (g.x + g.w >= vw - SNAP_EDGE) {
        next = { ...next, x: Math.round(vw / 2), y: TASKBAR_H, w: Math.round(vw / 2), h: fullH };
      }
      return { ...prev, [id]: next };
    });
  }, []);
  const topZ = useMemo(() => Object.keys(wins).reduce((m, k) => Math.max(m, wins[k].z), 0), [wins]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0d17] text-slate-100 os-no-select">
      {/* 壁纸 */}
      <div className="os-wallpaper absolute inset-0" />
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-24 h-[520px] w-[520px] rounded-full bg-rose-500/20 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 h-[560px] w-[560px] rounded-full bg-indigo-500/20 blur-[130px]" />
        <div className="absolute bottom-[-160px] left-1/3 h-[420px] w-[420px] rounded-full bg-amber-400/10 blur-[120px]" />
      </div>

      {/* 顶部菜单栏 */}
      <header className="absolute inset-x-0 top-0 z-[2000] flex h-[30px] items-center gap-4 border-b border-white/10 bg-black/35 px-3 text-[12px] text-slate-200/90 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-rose-400 to-orange-300 text-[9px] font-bold text-slate-900">道</span>
          <span className="font-semibold tracking-wide">道 · AI 女友</span>
        </div>
        <span className="text-slate-400/60">|</span>
        <button className="rounded px-2 py-0.5 hover:bg-white/10" onClick={() => open('timeline')}>时间线</button>
        <button className="rounded px-2 py-0.5 hover:bg-white/10" onClick={() => open('settings')}>设置</button>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-slate-300/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.55)]" />
            在线
          </span>
          <span className="tabular-nums">{clock}</span>
        </div>
      </header>

      {/* 窗口层 */}
      <main className="contents">
        {apps.map(app => (
          <div key={app.id} style={{ display: 'contents' }}>
          <OSWindow
            title={app.title}
            icon={app.icon}
            accent={app.accent}
            state={wins[app.id]}
            focused={wins[app.id].z === topZ && wins[app.id].open && !wins[app.id].minimized}
            onFocus={() => focus(app.id)}
            onClose={() => close(app.id)}
            onMinimize={() => minimize(app.id)}
            onToggleMax={() => toggleMax(app.id)}
            onCommit={geom => commitGeometry(app.id, geom)}
          >
            {app.content}
          </OSWindow>
          </div>
        ))}

        {/* 桌面提示 */}
        <div className="pointer-events-none absolute bottom-3 left-4 text-[11px] text-slate-300/45">
          拖拽标题栏移动 · 双击标题栏最大化 · 左下角圆点最小化 · 底部 Dock 切换应用
        </div>
      </main>

      {/* Dock */}
      <nav className="absolute inset-x-0 bottom-0 z-[2000] flex h-[74px] items-end justify-center pb-2">
        <div className="flex items-end gap-3 rounded-2xl border border-white/15 bg-white/[0.07] px-4 py-2 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          {apps.map(app => {
            const w = wins[app.id];
            const running = w.open && !w.minimized;
            return (
              <button
                key={app.id}
                onClick={() => toggleFromDock(app.id)}
                className="group relative flex flex-col items-center gap-1"
                title={app.title}
                aria-label={app.title}
              >
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${app.accent ?? 'from-slate-500/70 to-slate-700/70'} text-white shadow-lg transition-transform duration-150 group-hover:-translate-y-1.5 group-hover:scale-110`}>
                  {app.icon}
                </span>
                <span className={`h-1 w-1 rounded-full ${running ? 'bg-white/80' : 'bg-transparent'}`} />
                <span className="pointer-events-none absolute -top-8 whitespace-nowrap rounded-md border border-white/10 bg-black/80 px-2 py-0.5 text-[10px] text-slate-100 opacity-0 transition-opacity group-hover:opacity-100">
                  {app.title}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
