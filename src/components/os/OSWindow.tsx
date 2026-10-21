import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface WinState {
  open: boolean;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface OSWindowProps {
  title: string;
  icon?: ReactNode;
  accent?: string;
  state: WinState;
  focused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onToggleMax: () => void;
  children: ReactNode;
}

const TASKBAR_H = 30;   // 顶部菜单栏
const DOCK_H = 74;      // 底部 Dock 预留

/**
 * OS 风格窗口：标题栏拖动、右下角缩放、双击标题栏最大化。
 * 位置/尺寸由外部状态持有（窗口管理器在 OSShell）。
 */
export default function OSWindow({
  title, icon, accent = 'from-rose-400/70 to-orange-300/60',
  state, focused, onFocus, onClose, onMinimize, onToggleMax, children,
}: OSWindowProps) {
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  const [live, setLive] = useState<WinState>(state);

  // 跟随外部状态（最大化/恢复/移动由管理器决定）
  useEffect(() => { setLive(state); }, [state]);

  const onTitlePointerDown = useCallback((e: ReactPointerEvent) => {
    if (state.maximized) return;
    onFocus();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { dx: e.clientX - state.x, dy: e.clientY - state.y };
  }, [state.maximized, state.x, state.y, onFocus]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (dragRef.current) {
      const nx = Math.max(-40, Math.min(window.innerWidth - 120, e.clientX - dragRef.current.dx));
      const ny = Math.max(TASKBAR_H, Math.min(window.innerHeight - 80, e.clientY - dragRef.current.dy));
      setLive(s => ({ ...s, x: nx, y: ny }));
    } else if (resizeRef.current) {
      const r = resizeRef.current;
      setLive(s => ({
        ...s,
        w: Math.max(280, r.w + (e.clientX - r.sx)),
        h: Math.max(200, r.h + (e.clientY - r.sy)),
      }));
    }
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    setLive(s => { onFocus(); return s; });
  }, [onFocus]);

  const onResizePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    onFocus();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    resizeRef.current = { sx: e.clientX, sy: e.clientY, w: live.w, h: live.h };
  }, [live.w, live.h, onFocus]);

  if (!state.open || state.minimized) return null;

  const style: CSSProperties = state.maximized
    ? { left: 0, top: TASKBAR_H, width: '100vw', height: `calc(100vh - ${TASKBAR_H}px - ${DOCK_H}px)` }
    : { left: live.x, top: live.y, width: live.w, height: live.h };

  return (
    <section
      className={`fixed flex flex-col overflow-hidden rounded-xl border border-white/15 bg-[#151725]/95 text-slate-100 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.75)] backdrop-blur-xl os-window ${focused ? 'os-focused' : 'os-unfocused'}`}
      style={{ ...style, zIndex: state.z }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onFocus}
      role="dialog"
      aria-label={title}
    >
      {/* 标题栏 */}
      <header
        className="flex h-9 shrink-0 items-center gap-2 border-b border-white/10 bg-white/[0.06] px-3 select-none"
        onPointerDown={onTitlePointerDown}
        onDoubleClick={onToggleMax}
      >
        <div className="flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
          <button
            onClick={onClose}
            className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-125"
            title="关闭"
            aria-label="关闭窗口"
          />
          <button
            onClick={onMinimize}
            className="h-3 w-3 rounded-full bg-[#febc2e] transition hover:brightness-125"
            title="最小化"
            aria-label="最小化窗口"
          />
          <button
            onClick={onToggleMax}
            className="h-3 w-3 rounded-full bg-[#28c840] transition hover:brightness-125"
            title="最大化"
            aria-label="最大化窗口"
          />
        </div>
        <div className={`mx-auto flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-slate-200/90`}>
          {icon ? <span className={`flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br ${accent} text-[10px]`}>{icon}</span> : null}
          <span className="truncate">{title}</span>
        </div>
        <div className="w-12" />
      </header>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      {/* 缩放手柄 */}
      {!state.maximized && (
        <div
          onPointerDown={onResizePointerDown}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          title="拖拽调整大小"
          style={{ background: 'linear-gradient(135deg, transparent 45%, rgba(255,255,255,0.28) 46%, rgba(255,255,255,0.28) 56%, transparent 57%)' }}
        />
      )}
    </section>
  );
}
