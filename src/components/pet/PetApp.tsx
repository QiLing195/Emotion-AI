import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * 桌宠页（v1.84）
 * - **透明**：不画任何底色（html.pet-mode 已把 body 背景清掉），窗口里只有她本人；
 * - **动作系统**：待机/眨眼/左右看/走动/伸懒腰/被摸/挥手/说话/睡觉/开心，纯 CSS 动画；
 * - 数据来自 /api/pet/state（3s 轮询），动作由状态 + 交互 + 随机小动作驱动。
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

type Action = 'idle' | 'pat' | 'wave' | 'sleep' | 'happy' | 'walk' | 'stretch' | 'talk';

const POLICY_LABEL: Record<string, string> = {
  on_demand_10: '按需 + 定时 10 分钟',
  on_demand_5: '按需 + 定时 5 分钟',
  explicit_only: '只在你明确说的时候',
  auto_no_prompt: '她自己决定（不弹授权）',
};

const PET_CSS = `
  @keyframes petBreathe { 0%,100% { transform: scale(1,1) } 50% { transform: scale(1.025,0.975) } }
  @keyframes petSway { 0%,100% { transform: rotate(-2.5deg) } 50% { transform: rotate(2.5deg) } }
  @keyframes patPop { 0% { transform: scale(1,1) } 30% { transform: scale(1.12,0.86) } 55% { transform: scale(0.94,1.08) } 100% { transform: scale(1,1) } }
  @keyframes waveArm { 0%,100% { transform: rotate(14deg) } 25% { transform: rotate(-58deg) } 50% { transform: rotate(-24deg) } 75% { transform: rotate(-64deg) } }
  @keyframes bounce { 0%,100% { transform: translateY(0) } 45% { transform: translateY(-14px) } }
  @keyframes walkX { 0%,100% { transform: translateX(-16px) rotate(-2deg) } 50% { transform: translateX(16px) rotate(2deg) } }
  @keyframes feetTap { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
  @keyframes zzzUp { 0% { opacity: 0; transform: translate(0,6px) scale(.8) } 30% { opacity: .95 } 100% { opacity: 0; transform: translate(14px,-26px) scale(1.15) } }
  @keyframes heartUp { 0% { opacity: 0; transform: translate(0,4px) scale(.6) } 25% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--hx,6px),-46px) scale(1.1) } }
  @keyframes sparkle { 0% { opacity: 0; transform: scale(.4) rotate(0deg) } 40% { opacity: 1 } 100% { opacity: 0; transform: scale(1.25) rotate(60deg) } }
  @keyframes talkMouth { 0%,100% { height: 6px; border-radius: 0 0 8px 8px } 50% { height: 13px; border-radius: 7px } }
  @keyframes stretchUp { 0%,100% { transform: rotate(12deg) translateY(0) } 50% { transform: rotate(-78deg) translateY(-6px) } }
  @keyframes sleepBreathe { 0%,100% { transform: scale(1,1) rotate(-4deg) } 50% { transform: scale(1.01,0.965) rotate(-4deg) } }
  .pet-root { user-select: none; -webkit-user-select: none; }
  .pet-stage { animation: petBreathe 3.6s ease-in-out infinite; }
  .pet-head-idle { animation: petSway 5s ease-in-out infinite; transform-origin: 50% 100%; }
  .pet-stage.act-sleep .pet-head-idle { animation: sleepBreathe 4.6s ease-in-out infinite; }
  .pet-stage.act-pat { animation: patPop .55s ease-out; }
  .pet-stage.act-wave .arm-r { animation: waveArm .9s ease-in-out infinite; }
  .pet-stage.act-happy { animation: bounce .9s ease-in-out infinite; }
  .pet-stage.act-walk { animation: walkX 2.6s ease-in-out infinite; }
  .pet-stage.act-walk .foot { animation: feetTap .42s ease-in-out infinite; }
  .pet-stage.act-stretch .arm-l { animation: stretchUp 1.5s ease-in-out infinite; }
  .pet-stage.act-stretch .arm-r { animation: stretchUp 1.5s ease-in-out infinite reverse; }
  .pet-mouth-open { transition: all .2s; }
  .pet-stage.act-talk .pet-mouth-open { animation: talkMouth .3s ease-in-out infinite; border-bottom-width: 0; background: #3a2b31; }
`;

export default function PetApp() {
  const [s, setS] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('idle');
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [hearts, setHearts] = useState<number[]>([]);
  const [zzz, setZzz] = useState(false);
  const bubbleTimer = useRef<number | null>(null);
  const actionTimer = useRef<number | null>(null);
  const lastTouch = useRef<number>(Date.now());

  const say = useCallback((text: string, ms = 3500) => {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(''), ms);
  }, []);

  const playAction = useCallback((next: Action, ms = 1200) => {
    if (actionTimer.current) window.clearTimeout(actionTimer.current);
    setAction(next);
    lastTouch.current = Date.now();
    if (next !== 'sleep') {
      actionTimer.current = window.setTimeout(() => setAction('idle'), ms);
    }
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

  // 轮询她的状态
  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // 眨眼
  useEffect(() => {
    const t = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 140);
    }, 3800 + Math.random() * 2200);
    return () => window.clearInterval(t);
  }, []);

  // 眼睛跟着鼠标（窗口内）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      setLook({ x: Math.max(-1, Math.min(1, nx)) * 2.4, y: Math.max(-1, Math.min(1, ny)) * 1.8 });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // 随机小动作（只有空闲/睡着时才会重新挑）
  useEffect(() => {
    const t = window.setInterval(() => {
      const low = Boolean(s?.lowPeriod?.active);
      const roomOpen = Boolean(s?.room.active);
      const idleTooLong = Date.now() - lastTouch.current > 25_000;
      if (low && idleTooLong && !roomOpen) { setAction('sleep'); setZzz(true); return; }
      if (action !== 'idle' && action !== 'sleep') return;
      setZzz(false);
      const pool: Action[] = ['idle', 'walk', 'stretch', 'wave'];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === 'idle') { setAction('idle'); return; }
      playAction(pick, pick === 'walk' ? 2600 : 1600);
    }, 7000 + Math.random() * 4000);
    return () => window.clearInterval(t);
  }, [action, s, playAction]);

  // 状态驱动：开心 / 睡觉
  useEffect(() => {
    const top = s?.mood.top;
    const delta = s?.mood.delta ?? 0;
    const low = Boolean(s?.lowPeriod?.active);
    if (top && (top === 'joy' || top === 'love') && delta >= 0.12 && bubble) {
      setAction('happy');
      const t = window.setTimeout(() => setAction('idle'), 1400);
      return () => window.clearTimeout(t);
    }
    if (low && !s?.room.active && Date.now() - lastTouch.current > 20_000) {
      setAction('sleep'); setZzz(true);
    } else if (action === 'sleep' && !low) {
      setAction('idle'); setZzz(false);
    }
  }, [s, bubble, action]);

  const touch = async () => {
    playAction('pat', 700);
    setHearts(prev => [...prev, Date.now()]);
    window.setTimeout(() => setHearts(prev => prev.slice(1)), 1600);
    try {
      const r = await fetch('/api/pet/interact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click' }),
      });
      const d = await r.json() as { text?: string };
      say(d.text ?? '嗯？');
    } catch { say('……'); }
  };

  const wave = () => { playAction('wave', 2200); say('嘿，我在这儿。', 2600); };

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
  const talking = bubble.length > 0;
  const actClass = `pet-stage act-${action}${talking && action === 'idle' ? ' act-talk' : ''}`;
  const headColor = low ? '#8e9bb8' : '#f6c1cf';
  const bodyColor = low ? '#6b7896' : '#f7cbd5';
  const eyesClosed = action === 'sleep';
  const happyEyes = action === 'pat' || action === 'happy';
  const eyeHeight = eyesClosed ? 2 : blink ? 2 : 11;

  return (
    <div className="pet-root relative flex h-screen w-screen flex-col items-center justify-end overflow-hidden" style={{ background: 'transparent' }}>
      <style>{PET_CSS}</style>

      {err && <div className="mb-1 rounded bg-rose-500/25 px-2 py-1 text-[10px] text-rose-100">{err}</div>}

      {/* 气泡 */}
      {bubble && (
        <div className="mb-1 max-w-[260px] rounded-2xl border border-white/25 bg-[#1a1c2e]/90 px-3 py-1.5 text-center text-[12px] leading-snug text-slate-100 shadow-lg backdrop-blur">
          {bubble}
        </div>
      )}

      {/* 授权卡 */}
      {s?.pendingApproval && (
        <div className="mb-1 w-[270px] rounded-2xl border border-amber-300/40 bg-[#241f14]/90 p-2.5 text-center shadow-lg backdrop-blur">
          <div className="text-[12px] text-amber-100">她想看一眼你的屏幕</div>
          <div className="mt-0.5 text-[10px] text-amber-200/70">
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
        <div className="mb-1 w-[270px] rounded-2xl border border-white/15 bg-[#16182a]/92 p-3 shadow-lg backdrop-blur">
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
            今日已看 {s?.screen.capturesToday ?? 0} 次 · 密码/银行类窗口会自动跳过
          </div>
        </div>
      )}

      {/* ===== 她本人（占位形象 + 动作） ===== */}
      <div className="relative" style={{ width: 150, height: 190 }}>
        {hearts.map(h => (
          <span
            key={h}
            className="pointer-events-none absolute left-1/2 top-[46px] text-[15px]"
            style={{ animation: 'heartUp 1.5s ease-out forwards', ['--hx' as string]: `${(Math.random() * 40 - 20).toFixed(0)}px` }}
          >💗</span>
        ))}
        {zzz && (
          <span className="pointer-events-none absolute right-[18px] top-[30px] text-[13px] font-semibold text-slate-200/80"
                style={{ animation: 'zzzUp 2.4s ease-out infinite' }}>z</span>
        )}
        {action === 'happy' && (
          <>
            <span className="pointer-events-none absolute left-[16px] top-[24px] text-[13px]" style={{ animation: 'sparkle 1.2s ease-out infinite' }}>✨</span>
            <span className="pointer-events-none absolute right-[14px] top-[40px] text-[12px]" style={{ animation: 'sparkle 1.2s ease-out .3s infinite' }}>✦</span>
          </>
        )}

        <button
          onClick={() => void touch()}
          onDoubleClick={() => wave()}
          title="摸摸她（双击挥手）"
          className={`absolute inset-0 cursor-pointer border-none p-0 outline-none ${actClass}`}
          style={{ background: 'transparent' }}
        >
          {/* 头 */}
          <div className="pet-head-idle absolute left-1/2 top-1 h-[92px] w-[92px] -translate-x-1/2 rounded-full"
               style={{
                 background: headColor,
                 boxShadow: action === 'pat' ? '0 0 0 6px rgba(246,193,207,.28), 0 10px 26px rgba(0,0,0,.35)' : '0 8px 22px rgba(0,0,0,.35)',
                 transition: 'box-shadow .25s',
               }}>
            {eyesClosed || happyEyes ? (
              <div className="absolute left-[18px] top-[40px] flex gap-[22px]">
                <span className="block h-[6px] w-[20px] rounded-t-full border-t-[3px] border-[#2a2633]" />
                <span className="block h-[6px] w-[20px] rounded-t-full border-t-[3px] border-[#2a2633]" />
              </div>
            ) : (
              <div className="absolute left-[22px] top-[36px] flex gap-[24px]">
                {[0, 1].map(i => (
                  <span key={i} className="relative flex items-end justify-center" style={{ width: 11, height: 12 }}>
                    <span className="block w-[9px] rounded-full bg-[#2a2633]" style={{ height: eyeHeight, transition: 'height .1s' }} />
                    <span className="absolute left-1/2 top-1/2 block h-[3px] w-[3px] rounded-full bg-white/85"
                          style={{ transform: `translate(calc(-50% + ${look.x}px), calc(-50% + ${look.y}px))` }} />
                  </span>
                ))}
              </div>
            )}
            {action === 'talk' || talking ? (
              <div className="pet-mouth-open absolute left-1/2 top-[60px] w-[16px] -translate-x-1/2 bg-[#3a2b31]" style={{ height: 7, borderRadius: '0 0 8px 8px' }} />
            ) : (
              <div className="absolute left-1/2 top-[60px] h-[9px] w-[20px] -translate-x-1/2 rounded-b-full border-b-[2.5px] border-[#2a2633]"
                   style={{ transform: low ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)' }} />
            )}
            {!low && (
              <>
                <span className="absolute left-[11px] top-[54px] h-[7px] w-[11px] rounded-full bg-rose-300/70" />
                <span className="absolute right-[11px] top-[54px] h-[7px] w-[11px] rounded-full bg-rose-300/70" />
              </>
            )}
          </div>

          {/* 身体 */}
          <div className="absolute bottom-[22px] left-1/2 h-[68px] w-[60px] -translate-x-1/2 rounded-t-[28px] rounded-b-[20px]"
               style={{ background: bodyColor, boxShadow: '0 8px 18px rgba(0,0,0,.28)' }} />
          <span className="arm-l absolute bottom-[36px] left-[22px] h-[28px] w-[12px] origin-top rounded-full"
                style={{ background: headColor, transform: 'rotate(12deg)' }} />
          <span className="arm-r absolute bottom-[36px] right-[22px] h-[28px] w-[12px] origin-top rounded-full"
                style={{ background: headColor, transform: 'rotate(-12deg)' }} />
          <span className="foot absolute bottom-[16px] left-[46px] h-[10px] w-[16px] rounded-full" style={{ background: low ? '#586380' : '#e9b3c1' }} />
          <span className="foot absolute bottom-[16px] right-[46px] h-[10px] w-[16px] rounded-full" style={{ background: low ? '#586380' : '#e9b3c1', animationDelay: '.2s' }} />
        </button>
      </div>

      {/* 状态小字 */}
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-300/90">
        <span className="rounded-full bg-black/25 px-2 py-[1px] backdrop-blur-sm">{mood}</span>
        {room && <span className="max-w-[140px] truncate rounded-full bg-black/20 px-2 py-[1px] text-slate-300/80 backdrop-blur-sm">小屋：{room}</span>}
        {action === 'sleep' && <span className="rounded-full bg-black/20 px-2 py-[1px] text-slate-400 backdrop-blur-sm">打盹</span>}
      </div>

      {/* 底部按钮 */}
      <div className="mb-2 flex items-center gap-1.5">
        <button className="rounded-lg bg-rose-500/85 px-2.5 py-1 text-[11px] text-white shadow" onClick={() => window.open('/', '_blank')}>聊天</button>
        <button className="rounded-lg bg-black/30 px-2.5 py-1 text-[11px] text-slate-100 backdrop-blur-sm hover:bg-black/40" onClick={() => void captureOnce()}>看一眼</button>
        <button className="rounded-lg bg-black/30 px-2.5 py-1 text-[11px] text-slate-100 backdrop-blur-sm hover:bg-black/40" onClick={() => setShowSettings(v => !v)}>设置</button>
        <button className="rounded-lg bg-black/25 px-2 py-1 text-[11px] text-slate-400 backdrop-blur-sm" onClick={() => window.close()}>藏起来</button>
      </div>

      {/* 顶部拖动条 */}
      <div className="absolute left-0 top-0 h-9 w-full" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />
    </div>
  );
}
