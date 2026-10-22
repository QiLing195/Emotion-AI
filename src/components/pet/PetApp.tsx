import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * 桌宠页（v1.83）——Electron 透明窗口加载 /pet 时显示。
 * 只读展示她的状态（情绪/小屋/屏幕观察策略）+ 两个交互：摸她、看屏幕申请、打开聊天。
 * 占位形象：纯 CSS 画的简笔小人（等你给 PNG 后替换成 <img> 即可，接口不变）。
 */
interface PetState {
  ok: boolean;
  now: number;
  mood: { top: string | null; delta: number; label: string };
  lowPeriod: null | { active: boolean; established: boolean; turns: number; phase: string };
  room: { enabled: boolean; active: boolean; label: string | null; minutes: number };
  screen: { policy: string; lastCaptureAt: number | null; lastCaptureOk: boolean | null; capturesToday: number };
  pendingApproval?: boolean;
  policies?: string[];
}

const POLICY_LABEL: Record<string, string> = {
  on_demand_10: '按需 + 定时 10 分钟',
  on_demand_5: '按需 + 定时 5 分钟',
  explicit_only: '只在你明确说的时候',
  auto_no_prompt: '她自己决定（不弹授权）',
};

export default function PetApp() {
  const [s, setS] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [blink, setBlink] = useState(false);
  const bubbleTimer = useRef<number | null>(null);

  const say = useCallback((text: string, ms = 3500) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(''), ms);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/pet/state');
      const data = (await r.json()) as PetState;
      setS(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '断开了');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 3000);
    const b = window.setInterval(() => { setBlink(true); window.setTimeout(() => setBlink(false), 140); }, 4200);
    return () => { window.clearInterval(t); window.clearInterval(b); };
  }, [refresh]);

  const touch = async () => {
    try {
      const r = await fetch('/api/pet/interact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click' }),
      });
      const d = await r.json() as { text?: string };
      say(d.text ?? '嗯？');
    } catch { say('……'); }
  };

  const captureOnce = async () => {
    try {
      const r = await fetch('/api/pet/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json() as { ok?: boolean; reason?: string };
      say(d.ok ? '我去看看。' : (d.reason ?? '现在不行'), 4200);
    } catch { say('连不上。'); }
  };

  const approve = async (allow: boolean) => {
    try {
      await fetch(allow ? '/api/pet/approve' : '/api/pet/deny', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'screen' }),
      });
      say(allow ? '那我看一眼。' : '好，不看。', 2600);
      void refresh();
    } catch { /* ignore */ }
  };

  const setPolicy = async (policy: string) => {
    try {
      await fetch('/api/pet/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ screenPolicy: policy }),
      });
      void refresh();
    } catch { /* ignore */ }
  };

  const mood = s?.mood.label ?? '静息';
  const low = Boolean(s?.lowPeriod?.active);
  const room = s?.room.active ? s.room.label : null;
  const sleeping = low && !s?.room.active;
  const bodyColor = low ? '#6b7a9a' : '#f2b8c6';

  return (
    <div
      className="flex h-screen w-screen select-none flex-col items-center justify-end bg-transparent"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      {err && <div className="mb-1 rounded bg-rose-500/20 px-2 py-1 text-[10px] text-rose-100">{err}</div>}

      {/* 对话气泡 */}
      {bubble && (
        <div className="mb-2 max-w-[280px] rounded-2xl border border-white/20 bg-[#1a1c2e]/95 px-3 py-2 text-center text-[12px] text-slate-100 shadow-lg">
          {bubble}
        </div>
      )}

      {/* 授权卡（她想看屏幕时出现） */}
      {s?.pendingApproval && (
        <div className="mb-2 w-[280px] rounded-2xl border border-amber-300/40 bg-[#241f14]/95 p-2.5 text-center shadow-lg">
          <div className="text-[12px] text-amber-100">她想看一眼你的屏幕</div>
          <div className="mt-1 text-[10px] text-amber-200/70">
            {POLICY_LABEL[s?.screen.policy ?? ''] ?? s?.screen.policy} · 批准后 15 分钟内不再问
          </div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-lg bg-emerald-500/90 py-1 text-[11px] font-medium text-white" onClick={() => void approve(true)}>允许</button>
            <button className="flex-1 rounded-lg bg-white/10 py-1 text-[11px] text-slate-200" onClick={() => void approve(false)}>拒绝</button>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div className="mb-2 w-[280px] rounded-2xl border border-white/15 bg-[#16182a]/95 p-3 shadow-lg">
          <div className="text-[11px] font-medium text-slate-200">她看屏幕的方式</div>
          <div className="mt-1.5 space-y-1">
            {Object.entries(POLICY_LABEL).map(([key, label]) => (
              <button
                key={key}
                onClick={() => void setPolicy(key)}
                className={`w-full rounded-lg px-2 py-1 text-left text-[11px] ${s?.screen.policy === key ? 'bg-rose-500/30 text-rose-100' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {s?.screen.policy === key ? '● ' : '○ '}{label}
              </button>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            今日已看 {s?.screen.capturesToday ?? 0} 次 · 前台是密码/银行类窗口时会自动跳过
          </div>
        </div>
      )}

      {/* 占位形象：简笔小人（以后换成 PNG 只改这里） */}
      <div className="relative flex flex-col items-center" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <style>{`
          @keyframes petBreathe { 0%,100% { transform: scale(1,1) } 50% { transform: scale(1.02,0.98) } }
          @keyframes petSway { 0%,100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
          .pet-anim { animation: petBreathe 3.4s ease-in-out infinite; }
          .pet-head { animation: petSway 4.8s ease-in-out infinite; transform-origin: 50% 100%; }
        `}</style>

        <button
          onClick={() => void touch()}
          title="摸摸她"
          className="pet-anim relative h-[150px] w-[120px] cursor-pointer focus:outline-none"
          style={{ background: 'transparent', border: 'none' }}
        >
          {/* 头 */}
          <div className="pet-head absolute left-1/2 top-0 h-[86px] w-[86px] -translate-x-1/2 rounded-full"
               style={{ background: bodyColor, boxShadow: '0 8px 24px rgba(0,0,0,.35)', opacity: sleeping ? 0.85 : 1 }}>
            {/* 眼睛 */}
            <div className="absolute left-[20px] top-[34px] flex gap-[22px]">
              <span className="block rounded-full bg-[#1b1b26]" style={{ width: 9, height: blink ? 2 : 11, borderRadius: 6, transition: 'height .1s' }} />
              <span className="block rounded-full bg-[#1b1b26]" style={{ width: 9, height: blink ? 2 : 11, borderRadius: 6, transition: 'height .1s' }} />
            </div>
            {/* 嘴：低落时下弯，其余微笑 */}
            <div className="absolute left-1/2 top-[58px] h-[10px] w-[22px] -translate-x-1/2 rounded-b-full border-b-2 border-[#1b1b26]"
                 style={{ transform: low ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)' }} />
            {/* 腮红 */}
            {!low && (
              <>
                <span className="absolute left-[12px] top-[52px] h-[6px] w-[10px] rounded-full bg-rose-300/70" />
                <span className="absolute right-[12px] top-[52px] h-[6px] w-[10px] rounded-full bg-rose-300/70" />
              </>
            )}
          </div>
          {/* 身体 */}
          <div className="absolute bottom-[6px] left-1/2 h-[62px] w-[56px] -translate-x-1/2 rounded-t-[26px] rounded-b-[18px]"
               style={{ background: low ? '#5d6a86' : '#f7cbd5', boxShadow: '0 8px 20px rgba(0,0,0,.3)' }} />
          {/* 手 */}
          <span className="absolute bottom-[14px] left-[18px] h-[26px] w-[12px] rounded-full" style={{ background: bodyColor, transform: 'rotate(12deg)' }} />
          <span className="absolute bottom-[14px] right-[18px] h-[26px] w-[12px] rounded-full" style={{ background: bodyColor, transform: 'rotate(-12deg)' }} />
        </button>

        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-300">
          <span className="rounded-full bg-white/10 px-2 py-[1px]">{mood}</span>
          {room && <span className="max-w-[150px] truncate rounded-full bg-white/5 px-2 py-[1px] text-slate-400">在小屋：{room}</span>}
          {sleeping && <span className="rounded-full bg-white/5 px-2 py-[1px] text-slate-500">打盹</span>}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="mt-2 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
        <button className="rounded-lg bg-rose-500/90 px-2.5 py-1 text-[11px] text-white" onClick={() => window.open('/', '_blank')}>聊天</button>
        <button className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-200" onClick={() => void captureOnce()}>看一眼</button>
        <button className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] text-slate-200" onClick={() => setShowSettings(v => !v)}>设置</button>
        <button className="rounded-lg bg-white/5 px-2 py-1 text-[11px] text-slate-500" title="隐藏桌宠（Ctrl+Shift+Q 退出 Electron）" onClick={() => window.close()}>藏起来</button>
      </div>

      {/* 顶部拖动条 */}
      <div className="absolute left-0 top-0 h-8 w-full" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />
    </div>
  );
}
