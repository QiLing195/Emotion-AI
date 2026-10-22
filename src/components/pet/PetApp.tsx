import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PET_SPRITE_KEYS, PET_SPRITE_PATH, fallbackChain, type PetSpriteState } from './petSprites';

/**
 * 桌宠页（v1.85）
 * - **透明**：html.pet-mode 已清掉 body 背景，窗口里只有她本人；
 * - **图片模式**：`public/pet/anya_<state>.png` 一张图一个状态，CSS 负责呼吸/跳动/摇摆/发抖等动作，
 *   状态切换淡入淡出；**缺图自动回落**（coffee→sit→idle 之类），一张都没有时退回纯 CSS 小人；
 * - 状态来源：她的情绪/低谷/小屋活动 + 你的交互 + 随机小动作。
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

type Action =
  | 'idle' | 'pat' | 'wave' | 'sleep' | 'happy' | 'walk' | 'stretch' | 'talk'
  | 'peanut' | 'coffee' | 'reading' | 'sit';

const POLICY_LABEL: Record<string, string> = {
  on_demand_10: '按需 + 定时 10 分钟',
  on_demand_5: '按需 + 定时 5 分钟',
  explicit_only: '只在你明确说的时候',
  auto_no_prompt: '她自己决定（不弹授权）',
};

const PET_CSS = `
  @keyframes anyaBreathe { 0%,100% { transform: scale(1,1) } 50% { transform: scale(1.02,0.985) } }
  @keyframes anyaBounce { 0%,100% { transform: translateY(0) } 45% { transform: translateY(-10px) } }
  @keyframes anyaWalk { 0%,100% { transform: translateX(-12px) rotate(-2deg) } 50% { transform: translateX(12px) rotate(2deg) } }
  @keyframes anyaShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }
  @keyframes anyaSway { 0%,100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
  @keyframes anyaShiver { 0%,100% { transform: translate(0,0) } 33% { transform: translate(1px,-1px) } 66% { transform: translate(-1px,1px) } }
  @keyframes petSway { 0%,100% { transform: rotate(-2.5deg) } 50% { transform: rotate(2.5deg) } }
  @keyframes patPop { 0% { transform: scale(1,1) } 30% { transform: scale(1.1,0.9) } 60% { transform: scale(0.95,1.05) } 100% { transform: scale(1,1) } }
  @keyframes waveArm { 0%,100% { transform: rotate(14deg) } 25% { transform: rotate(-58deg) } 50% { transform: rotate(-24deg) } 75% { transform: rotate(-64deg) } }
  @keyframes heartUp { 0% { opacity: 0; transform: translate(0,4px) scale(.6) } 25% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--hx,6px),-46px) scale(1.1) } }
  @keyframes zzzUp { 0% { opacity: 0; transform: translate(0,6px) scale(.8) } 30% { opacity: .95 } 100% { opacity: 0; transform: translate(14px,-26px) scale(1.15) } }
  @keyframes sparkle { 0% { opacity: 0; transform: scale(.4) rotate(0deg) } 40% { opacity: 1 } 100% { opacity: 0; transform: scale(1.25) rotate(60deg) } }
  @keyframes bubbleIn { 0% { opacity: 0; transform: translateY(6px) scale(.97) } 100% { opacity: 1; transform: translateY(0) scale(1) } }

  /* 图片状态机：一张图 + CSS 动作 */
  .anya-img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: bottom center;
              filter: drop-shadow(0 10px 18px rgba(0,0,0,.35)); transition: opacity .16s ease; }
  .anya-state { position: absolute; inset: 0; opacity: 0; transition: opacity .16s ease; }
  .anya-state.on { opacity: 1; }
  .anya-idle    { animation: anyaBreathe 3.8s ease-in-out infinite; transform-origin: 50% 92%; }
  .anya-happy   { animation: anyaBounce .9s ease-in-out infinite; }
  .anya-wave    { animation: anyaBounce 1.1s ease-in-out infinite; }
  .anya-pat     { animation: patPop .55s ease-out; }
  .anya-walk    { animation: anyaWalk 2.6s ease-in-out infinite; }
  .anya-sleepy  { animation: anyaBreathe 5.2s ease-in-out infinite; transform-origin: 50% 92%; }
  .anya-angry   { animation: anyaShake .5s ease-in-out infinite; }
  .anya-shocked { animation: anyaShiver .16s linear infinite; }
  .anya-sad     { animation: anyaSway 6s ease-in-out infinite; transform-origin: 50% 92%; }
  .anya-talk    { animation: anyaBreathe 2.6s ease-in-out infinite; }
  .anya-coffee, .anya-reading, .anya-sit, .anya-peanut, .anya-think { animation: anyaBreathe 4.4s ease-in-out infinite; transform-origin: 50% 92%; }
  .anya-blink   { animation: none; }

  /* CSS 小人（没有图片资源时的回退） */
  .pet-stage { animation: anyaBreathe 3.6s ease-in-out infinite; }
  .pet-head-idle { animation: petSway 5s ease-in-out infinite; transform-origin: 50% 100%; }
  .pet-stage.act-wave .arm-r { animation: waveArm .9s ease-in-out infinite; }
  .bubble-in { animation: bubbleIn .18s ease-out; }
`;

function resolveSprite(state: PetSpriteState, available: Set<PetSpriteState>): PetSpriteState | null {
  for (const key of fallbackChain(state)) {
    if (available.has(key)) return key;
  }
  return null;
}

export default function PetApp() {
  const [s, setS] = useState<PetState | null>(null);
  const [bubble, setBubble] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('idle');
  const [blink, setBlink] = useState(false);
  const [hearts, setHearts] = useState<number[]>([]);
  const [zzz, setZzz] = useState(false);
  const [available, setAvailable] = useState<Set<PetSpriteState>>(new Set());
  const [probed, setProbed] = useState(false);
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

  // 探测哪些状态图存在（一张都没有 ⇒ 回退纯 CSS 小人）
  useEffect(() => {
    let alive = true;
    const results = new Set<PetSpriteState>();
    let pending = PET_SPRITE_KEYS.length;
    for (const key of PET_SPRITE_KEYS) {
      const img = new Image();
      img.onload = () => {
        results.add(key);
        if (--pending <= 0 && alive) { setAvailable(new Set(results)); setProbed(true); }
      };
      img.onerror = () => {
        if (--pending <= 0 && alive) { setAvailable(new Set(results)); setProbed(true); }
      };
      img.src = PET_SPRITE_PATH(key) + '?v=1';
    }
    return () => { alive = false; };
  }, []);

  // 状态轮询
  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 3000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // 眨眼
  useEffect(() => {
    const t = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 150);
    }, 3600 + Math.random() * 2400);
    return () => window.clearInterval(t);
  }, []);

  // 空闲随机：小动作 + 她自己的生活（喝咖啡/读书/吃花生/坐着）
  useEffect(() => {
    const t = window.setInterval(() => {
      const low = Boolean(s?.lowPeriod?.active);
      const idleTooLong = Date.now() - lastTouch.current > 25_000;
      if (low && idleTooLong) { setAction('sleep'); setZzz(true); return; }
      if (action !== 'idle' && action !== 'sleep') return;
      setZzz(false);
      const pool: Action[] = ['idle', 'walk', 'stretch', 'wave', 'peanut', 'coffee', 'reading', 'sit'];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick === 'idle') { setAction('idle'); return; }
      playAction(pick, pick === 'walk' ? 2600 : 7000 + Math.random() * 6000);
    }, 12000 + Math.random() * 9000);
    return () => window.clearInterval(t);
  }, [action, s, playAction]);

  // 状态驱动：授权请求=震惊；情绪驱动=生气/开心
  useEffect(() => {
    if (s?.pendingApproval) { setAction('idle'); setZzz(false); }
    const low = Boolean(s?.lowPeriod?.active);
    if (!low && action === 'sleep') { setAction('idle'); setZzz(false); }
  }, [s, action]);

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
      if (d.ok) playAction('think', 5000);
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

  // 状态 → 图片状态（触发优先级：授权 > 交互动作 > 小屋活动 > 情绪 > 眨眼 > 待机）
  const spriteTarget = useMemo<PetSpriteState>(() => {
    if (s?.pendingApproval) return 'shocked';
    if (action === 'pat') return 'happy';
    if (action === 'happy') return 'happy';
    if (action === 'wave') return 'wave';
    if (action === 'walk') return 'walk';
    if (action === 'peanut') return 'peanut';
    if (action === 'coffee') return 'coffee';
    if (action === 'reading') return 'reading';
    if (action === 'sit' || action === 'stretch') return 'sit';
    if (action === 'sleep') return 'sleepy';
    if (talking) return 'talk';
    const roomLabel = room ?? '';
    if (/咖啡|喝水|茶/.test(roomLabel)) return 'coffee';
    if (/书|读|翻|看/.test(roomLabel)) return 'reading';
    if (/写|本子|划掉|整理|涂鸦/.test(roomLabel)) return 'sit';
    if (low) return 'sad';
    const top = s?.mood.top;
    if ((top === 'anger' || top === 'disgust') && (s?.mood.delta ?? 0) >= 0.1) return 'angry';
    if (blink) return 'blink';
    return 'idle';
  }, [s, action, room, low, talking, blink]);

  const resolved = resolveSprite(spriteTarget, available);
  const imageMode = probed && available.size > 0;
  const activeSprite = resolved ?? 'idle';

  const headColor = low ? '#8e9bb8' : '#f6c1cf';
  const bodyColor = low ? '#6b7896' : '#f7cbd5';

  return (
    <div className="pet-root relative flex h-screen w-screen flex-col items-center justify-end overflow-hidden" style={{ background: 'transparent' }}>
      <style>{PET_CSS}</style>

      {err && <div className="mb-1 rounded bg-rose-500/25 px-2 py-1 text-[10px] text-rose-100">{err}</div>}

      {bubble && (
        <div className="bubble-in mb-1 max-w-[260px] rounded-2xl border border-white/25 bg-[#1a1c2e]/90 px-3 py-1.5 text-center text-[12px] leading-snug text-slate-100 shadow-lg backdrop-blur">
          {bubble}
        </div>
      )}

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

      {/* ===== 她本人 ===== */}
      <div className="relative" style={{ width: 160, height: 200 }}>
        {hearts.map(h => (
          <span key={h} className="pointer-events-none absolute left-1/2 top-[40px] z-10 text-[15px]"
                style={{ animation: 'heartUp 1.5s ease-out forwards', ['--hx' as string]: `${(Math.random() * 40 - 20).toFixed(0)}px` }}>💗</span>
        ))}
        {zzz && <span className="pointer-events-none absolute right-[14px] top-[26px] z-10 text-[13px] font-semibold text-slate-200/80" style={{ animation: 'zzzUp 2.4s ease-out infinite' }}>z</span>}
        {(action === 'happy' || action === 'pat') && (
          <>
            <span className="pointer-events-none absolute left-[10px] top-[18px] z-10 text-[13px]" style={{ animation: 'sparkle 1.2s ease-out infinite' }}>✨</span>
            <span className="pointer-events-none absolute right-[8px] top-[34px] z-10 text-[12px]" style={{ animation: 'sparkle 1.2s ease-out .3s infinite' }}>✦</span>
          </>
        )}

        <button
          onClick={() => void touch()}
          onDoubleClick={() => wave()}
          title="摸摸她（双击挥手）"
          className="absolute inset-0 cursor-pointer border-none p-0 outline-none"
          style={{ background: 'transparent' }}
        >
          {imageMode ? (
            <div className={`anya-state on ${action === 'pat' ? 'anya-pat' : ''}`}>
              <img
                key={activeSprite}
                src={PET_SPRITE_PATH(activeSprite)}
                alt="anya"
                className={`anya-img anya-${activeSprite}`}
                draggable={false}
              />
            </div>
          ) : (
            /* 没有图片资源时的纯 CSS 小人（占位） */
            <div className="absolute inset-0">
              <div className="pet-head-idle absolute left-1/2 top-2 h-[86px] w-[86px] -translate-x-1/2 rounded-full"
                   style={{ background: headColor, boxShadow: '0 8px 22px rgba(0,0,0,.35)' }}>
                <div className="absolute left-[20px] top-[38px] flex gap-[22px]">
                  {[0, 1].map(i => (
                    <span key={i} className="block w-[9px] rounded-full bg-[#2a2633]" style={{ height: blink || action === 'sleep' ? 2 : 11 }} />
                  ))}
                </div>
                <div className="absolute left-1/2 top-[58px] h-[9px] w-[20px] -translate-x-1/2 rounded-b-full border-b-[2.5px] border-[#2a2633]"
                     style={{ transform: low ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)' }} />
              </div>
              <div className="absolute bottom-[24px] left-1/2 h-[64px] w-[56px] -translate-x-1/2 rounded-t-[26px] rounded-b-[18px]"
                   style={{ background: bodyColor, boxShadow: '0 8px 18px rgba(0,0,0,.28)' }} />
              <span className="absolute bottom-[36px] left-[24px] h-[26px] w-[11px] rounded-full" style={{ background: headColor, transform: 'rotate(12deg)' }} />
              <span className="absolute bottom-[36px] right-[24px] h-[26px] w-[11px] rounded-full" style={{ background: headColor, transform: 'rotate(-12deg)' }} />
            </div>
          )}
        </button>
      </div>

      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-300/90">
        <span className="rounded-full bg-black/25 px-2 py-[1px] backdrop-blur-sm">{mood}</span>
        {room && <span className="max-w-[140px] truncate rounded-full bg-black/20 px-2 py-[1px] text-slate-300/80 backdrop-blur-sm">小屋：{room}</span>}
        {action === 'sleep' && <span className="rounded-full bg-black/20 px-2 py-[1px] text-slate-400 backdrop-blur-sm">打盹</span>}
        {imageMode && <span className="rounded-full bg-black/20 px-2 py-[1px] text-slate-500 backdrop-blur-sm">图 {activeSprite}</span>}
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        <button className="rounded-lg bg-rose-500/85 px-2.5 py-1 text-[11px] text-white shadow" onClick={() => window.open('/', '_blank')}>聊天</button>
        <button className="rounded-lg bg-black/30 px-2.5 py-1 text-[11px] text-slate-100 backdrop-blur-sm hover:bg-black/40" onClick={() => void captureOnce()}>看一眼</button>
        <button className="rounded-lg bg-black/30 px-2.5 py-1 text-[11px] text-slate-100 backdrop-blur-sm hover:bg-black/40" onClick={() => setShowSettings(v => !v)}>设置</button>
        <button className="rounded-lg bg-black/25 px-2 py-1 text-[11px] text-slate-400 backdrop-blur-sm" onClick={() => window.close()}>藏起来</button>
      </div>

      <div className="absolute left-0 top-0 h-9 w-full" style={{ WebkitAppRegion: 'drag' } as CSSProperties} />
    </div>
  );
}
