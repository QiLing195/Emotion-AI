import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import {
  PET_SPRITE_KEYS, PET_SPRITE_PATH, PET_SPRITE_FRAME_PATH, PET_MAX_FRAMES, PET_FRAME_FPS,
  fallbackChain, type PetSpriteState,
} from './petSprites';

declare global {
  interface Window {
    /** desktop/preload.cjs 注入；浏览器里直接跑 /pet 时不存在（要判空） */
    petWindow?: {
      moveBy: (dx: number, dy: number) => void;
    dragBegin?: () => void;
    dragMove?: () => void;
    dragEnd?: () => void;
      getPosition: () => Promise<{ x: number; y: number } | null>;
      openChat: () => void;
      showMenu: () => void;
      openPath: (p: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

/**
 * 桌宠页（v1.90）
 * - 透明、**无按钮**：只留她本人（可拖动/可摸/双击挥手），交互靠**语音唤醒**；
 * - 语音：说唤醒词（默认「二丫」）→ 冒泡"嗯？" → 说一句话 → 走 /api/chat → 用**气泡**回话（不出声）；
 * - 桌面图标：她能读你桌面（只读），想打开某个东西时会弹授权卡；
 * - 右键 = 菜单（打开聊天 / 唤醒词设置 / 退出）；Ctrl+Shift+P 聊天；Ctrl+Shift+Q 退出。
 */
interface PetState {
  ok: boolean;
  now: number;
  mood: { top: string | null; delta: number; label: string };
  lowPeriod: null | { active: boolean; established: boolean; turns: number; phase: string };
  room: { enabled: boolean; active: boolean; label: string | null; minutes: number };
  screen: { policy: string; lastCaptureAt: number | null; lastCaptureOk: boolean | null; capturesToday: number };
  pendingApproval?: boolean;
  pendingDesktopAction?: { id: string; kind: 'open' | 'move' | 'rename'; path: string; name: string; reason: string; targetName?: string; createdAt: number } | null;
  policies?: string[];
  voice?: { enabled: boolean; running: boolean; ready: boolean; seq: number };
}

interface VoiceEvent {
  seq: number;
  ts: number;
  kind: 'ready' | 'wake' | 'utterance' | 'no_speech' | 'error';
  text: string;
}

type Action =
  | 'idle' | 'pat' | 'wave' | 'sleep' | 'happy' | 'walk' | 'stretch' | 'talk'
  | 'peanut' | 'coffee' | 'reading' | 'sit' | 'shocked';

const PET_CSS = `
  @keyframes anyaBreathe { 0%,100% { transform: scale(1,1) } 50% { transform: scale(1.02,0.985) } }
  @keyframes anyaBounce { 0%,100% { transform: translateY(0) } 45% { transform: translateY(-10px) } }
  @keyframes anyaWalk { 0%,100% { transform: translateX(-12px) rotate(-2deg) } 50% { transform: translateX(12px) rotate(2deg) } }
  @keyframes anyaShake { 0%,100% { transform: translateX(0) } 25% { transform: translateX(-3px) } 75% { transform: translateX(3px) } }
  @keyframes anyaSway { 0%,100% { transform: rotate(-2deg) } 50% { transform: rotate(2deg) } }
  @keyframes anyaShiver { 0%,100% { transform: translate(0,0) } 33% { transform: translate(1px,-1px) } 66% { transform: translate(-1px,1px) } }
  @keyframes petSway { 0%,100% { transform: rotate(-2.5deg) } 50% { transform: rotate(2.5deg) } }
  @keyframes patPop { 0% { transform: scale(1,1) } 30% { transform: scale(1.1,0.9) } 60% { transform: scale(0.95,1.05) } 100% { transform: scale(1,1) } }
  @keyframes heartUp { 0% { opacity: 0; transform: translate(0,4px) scale(.6) } 25% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--hx,6px),-46px) scale(1.1) } }
  @keyframes zzzUp { 0% { opacity: 0; transform: translate(0,6px) scale(.8) } 30% { opacity: .95 } 100% { opacity: 0; transform: translate(14px,-26px) scale(1.15) } }
  @keyframes sparkle { 0% { opacity: 0; transform: scale(.4) rotate(0deg) } 40% { opacity: 1 } 100% { opacity: 0; transform: scale(1.25) rotate(60deg) } }
  @keyframes bubbleIn { 0% { opacity: 0; transform: translateY(6px) scale(.97) } 100% { opacity: 1; transform: translateY(0) scale(1) } }
  @keyframes listenRing { 0%,100% { opacity: .12; transform: scale(1) } 50% { opacity: .40; transform: scale(1.05) } }

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
  .pet-stage { animation: anyaBreathe 3.6s ease-in-out infinite; }
  .pet-head-idle { animation: petSway 5s ease-in-out infinite; transform-origin: 50% 100%; }
  .bubble-in { animation: bubbleIn .18s ease-out; }
  .listen-ring { animation: listenRing 2.4s ease-in-out infinite; }
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
  const [err, setErr] = useState<string | null>(null);
  const [action, setAction] = useState<Action>('idle');
  const [blink, setBlink] = useState(false);
  const [hearts, setHearts] = useState<number[]>([]);
  const [zzz, setZzz] = useState(false);
  const [available, setAvailable] = useState<Set<PetSpriteState>>(new Set());
  const [probed, setProbed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const [frameUrls, setFrameUrls] = useState<string[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [awake, setAwake] = useState(false);
  const [voiceLabel, setVoiceLabel] = useState('');
  // v1.97 唤醒词从配置读（原来写死「安雅」，换成「二丫」后提示不对）
  const wakeWordRef = useRef('二丫');
  const [undoAt, setUndoAt] = useState<number | null>(null);
  const bubbleTimer = useRef<number | null>(null);
  const actionTimer = useRef<number | null>(null);
  const lastTouch = useRef<number>(Date.now());
  const dragRef = useRef<{ down: boolean; startX: number; startY: number; moved: number }>({ down: false, startX: 0, startY: 0, moved: 0 });
  const suppressClick = useRef(0);
  const voiceSeq = useRef(0);
  const busyReply = useRef(false);

  const say = useCallback((text: string, ms = 4500) => {
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

  // 探测状态图
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
      img.src = PET_SPRITE_PATH(key) + '?v=2';
    }
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 4000);
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

  // 空闲随机小动作（咖啡/读书/吃花生/坐着/散步）
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

  useEffect(() => {
    if (s?.pendingApproval) { setZzz(false); }
    const low = Boolean(s?.lowPeriod?.active);
    if (!low && action === 'sleep') { setAction('idle'); setZzz(false); }
  }, [s, action]);

  // ===== 语音：处理一句话 =====
  const handleUtterance = useCallback(async (text: string) => {
    if (!text.trim() || busyReply.current) return;
    busyReply.current = true;
    setAwake(false);
    setAction('talk');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, userId: 'pet-voice', recentMessages: [] }),
      });
      const d = await r.json() as { response?: string; text?: string; reply?: string };
      const reply = String(d.response ?? d.text ?? d.reply ?? '').trim();
      say(reply || '……嗯。', Math.min(14000, 4200 + reply.length * 130));
    } catch {
      say('我这边走神了，再说一次？', 3000);
    } finally {
      busyReply.current = false;
      setAction('idle');
    }
  }, [say]);

  // ===== 语音：轮询事件 =====
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/pet/voice?after=${voiceSeq.current}`);
        if (!r.ok) return;
        const d = await r.json() as { enabled?: boolean; ready?: boolean; seq?: number; events?: VoiceEvent[] };
        if (!alive) return;
        setVoiceLabel(d.enabled ? (d.ready ? `等你说「${wakeWordRef.current}」` : '麦克风准备中…') : '语音未开启');
        for (const ev of d.events ?? []) {
          voiceSeq.current = Math.max(voiceSeq.current, ev.seq);
          if (ev.kind === 'wake') {
            setAwake(true);
            playAction('happy', 900);
            say('嗯？我在。', 4500);
          } else if (ev.kind === 'utterance') {
            void handleUtterance(ev.text);
          } else if (ev.kind === 'no_speech') {
            setAwake(false);
            say('没听清，再说一遍？', 2400);
          } else if (ev.kind === 'error') {
            setAwake(false);
            setVoiceLabel('麦克风出问题了');
          }
        }
      } catch { /* server 不在就静默 */ }
    };
    void tick();
    const t = window.setInterval(tick, 600);
    return () => { alive = false; window.clearInterval(t); };
  }, [handleUtterance, playAction, say]);

  const mood = s?.mood.label ?? '静息';
  const low = Boolean(s?.lowPeriod?.active);
  const room = s?.room.active ? s.room.label : null;
  const talking = bubble.length > 0;
  const silence = awake && !talking;
  const spriteTarget = useMemo<PetSpriteState>(() => {
    if (dragging) return 'shocked';
    if (action === 'shocked') return 'shocked';
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
  }, [s, action, room, low, talking, blink, dragging]);

  const resolved = resolveSprite(spriteTarget, available);
  const imageMode = probed && available.size > 0;
  const activeSprite = resolved ?? 'idle';

  // v1.97 唤醒词来自服务端配置（设置窗口改完这里也跟着变；读不到就用默认）
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/pet/voice/config');
        if (!r.ok) return;
        const d = await r.json() as { wakeWords?: string[] };
        const w = (d.wakeWords ?? []).find(x => x && x.trim());
        if (w) wakeWordRef.current = w;
      } catch { /* 配置读不到就用默认 */ }
    })();
  }, []);

  // 她"随口提一句"的主动消息（桌面回声等）：轮询待投递队列，用气泡显示
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/proactive/pending');
        if (!r.ok || !alive) return;
        const d = await r.json() as { messages?: Array<{ text?: string }> };
        for (const m of d.messages ?? []) {
          if (m.text) say(m.text, 12000);
        }
      } catch { /* server 不在就静默 */ }
    };
    const t = window.setInterval(tick, 12000);
    return () => { alive = false; window.clearInterval(t); };
  }, [say]);
  // 帧（可选多帧）
  useEffect(() => {
    let alive = true;
    setFrameUrls([]);
    setFrameIdx(0);
    const probe = (i: number) => new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `${PET_SPRITE_FRAME_PATH(activeSprite, i)}?v=2`;
    });
    (async () => {
      const found: string[] = [];
      for (let i = 1; i <= PET_MAX_FRAMES; i++) {
        if (!(await probe(i))) break;
        found.push(PET_SPRITE_FRAME_PATH(activeSprite, i));
      }
      if (alive) setFrameUrls(found);
    })();
    return () => { alive = false; };
  }, [activeSprite]);

  useEffect(() => {
    if (frameUrls.length < 2) return;
    const fps = PET_FRAME_FPS[activeSprite] ?? 6;
    const t = window.setInterval(() => setFrameIdx(i => (i + 1) % frameUrls.length), Math.max(40, Math.round(1000 / fps)));
    return () => window.clearInterval(t);
  }, [frameUrls, activeSprite]);

  // ===== 交互：摸 / 拖 / 双击 =====
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
      say(d.text ?? '嗯？', 2600);
    } catch { say('……'); }
  };

  const wave = () => { playAction('wave', 2200); say('嘿，我在这儿。', 2600); };

  // v2.07：整窗可拖 —— 之前只有底部 170x212 的她本人能拖，窗口上方约 190px 透明区域
  // 没有任何事件目标，所以"往上拖"常常抓空。现在在整个窗口根节点上处理，
  // 只排除按钮/输入等交互控件；拖动时在主进程里按屏幕光标位移移动窗口。
  const onPetPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) return;
    dragRef.current = { down: true, startX: e.screenX, startY: e.screenY, moved: 0 };
    window.petWindow?.dragBegin?.();
    const onMove = (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st.down) return;
      st.moved = Math.abs(ev.screenX - st.startX) + Math.abs(ev.screenY - st.startY);
      if (st.moved > 3) {
        if (!draggingRef.current) { draggingRef.current = true; setDragging(true); }
        window.petWindow?.dragMove?.();
      }
    };
    const onUp = () => {
      const st = dragRef.current;
      const wasDrag = draggingRef.current || st.moved > 3;
      st.down = false;
      draggingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.petWindow?.dragEnd?.();
      if (wasDrag) {
        setDragging(false);
        suppressClick.current = Date.now();
        playAction('shocked', 500);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const onPetPointerUp = () => { /* 拖动结束统一由 window 级 pointerup 处理 */ };
  const onPetPointerMove = () => { /* 同上 */ };
  const onPetDoubleClick = () => {
    if (Date.now() - suppressClick.current < 400) return;
    wave();
  };
  const onRootClick = (e: ReactMouseEvent) => {
    if (Date.now() - suppressClick.current < 400) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) return;
    void touch();
  };
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    window.petWindow?.showMenu();
  };


  const spriteSrc = frameUrls.length > 1
    ? frameUrls[Math.min(frameIdx, frameUrls.length - 1)]
    : PET_SPRITE_PATH(activeSprite);

  const headColor = low ? '#8e9bb8' : '#f6c1cf';
  const bodyColor = low ? '#6b7896' : '#f7cbd5';

  return (
    <div
      className="pet-root relative flex h-screen w-screen flex-col items-center justify-end overflow-hidden"
      style={{ background: 'transparent', cursor: dragging ? 'grabbing' : 'grab' }}
      onContextMenu={onContextMenu}
      onPointerDown={onPetPointerDown}
      onDoubleClick={onPetDoubleClick}
      onClick={onRootClick}
    >
      <style>{PET_CSS}</style>

      {err && <div className="mb-1 rounded bg-rose-500/25 px-2 py-1 text-[10px] text-rose-100">{err}</div>}

      {/* 气泡：她只用气泡说话，不出声 */}
      {bubble && (
        <div className="bubble-in mb-1 max-w-[268px] rounded-2xl border border-white/25 bg-[#1a1c2e]/90 px-3 py-1.5 text-center text-[12px] leading-snug text-slate-100 shadow-lg backdrop-blur">
          {bubble}
        </div>
      )}

      {/* 屏幕授权卡（她请求看你屏幕时才出现；这是安全确认，不是功能按钮） */}
      {s?.pendingApproval && (
        <div className="mb-1 w-[268px] rounded-2xl border border-amber-300/40 bg-[#241f14]/90 p-2.5 text-center shadow-lg backdrop-blur">
          <div className="text-[12px] text-amber-100">她想看一眼你的屏幕</div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-lg bg-emerald-500/90 py-1 text-[11px] font-medium text-white" onClick={async () => {
              await fetch('/api/pet/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'screen' }) });
              say('那我看一眼。', 2400);
              void refresh();
            }}>允许</button>
            <button className="flex-1 rounded-lg bg-white/10 py-1 text-[11px] text-slate-200" onClick={async () => {
              await fetch('/api/pet/deny', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
              say('好，不看。', 2200);
              void refresh();
            }}>拒绝</button>
          </div>
        </div>
      )}

      {/* 桌面图标授权卡（她想打开/移动/重命名你桌面上的东西时才出现） */}
      {s?.pendingDesktopAction && (
        <div className="mb-1 w-[268px] rounded-2xl border border-sky-300/40 bg-[#12202e]/92 p-2.5 text-center shadow-lg backdrop-blur">
          <div className="text-[12px] text-sky-100">
            {s.pendingDesktopAction.kind === 'move' ? '她想把桌面上的这个移走：'
              : s.pendingDesktopAction.kind === 'rename' ? '她想把桌面上的这个改名：'
              : '她想打开桌面上的：'}
          </div>
          <div className="mt-0.5 break-all text-[11px] font-medium text-white">
            {s.pendingDesktopAction.name}
            {s.pendingDesktopAction.kind === 'move' && s.pendingDesktopAction.targetName && (
              <span className="text-slate-300"> → {s.pendingDesktopAction.targetName}</span>
            )}
            {s.pendingDesktopAction.kind === 'rename' && s.pendingDesktopAction.targetName && (
              <span className="text-slate-300"> → {s.pendingDesktopAction.targetName}</span>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-lg bg-emerald-500/90 py-1 text-[11px] font-medium text-white" onClick={async () => {
              const act = s.pendingDesktopAction!;
              if (act.kind === 'open') {
                const r = await window.petWindow?.openPath(act.path);
                if (r?.ok) {
                  await fetch('/api/pet/desktop/opened', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: act.name }) });
                } else {
                  await fetch('/api/pet/desktop/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) });
                }
                say(r?.ok ? '打开了。' : (r?.error === 'blocked_type' ? '这个类型不能直接打开。' : '没打开成功。'), 2600);
              } else {
                const r = await fetch('/api/pet/desktop/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: act.id }) });
                const d = await r.json() as { ok?: boolean; reason?: string; undoAvailable?: boolean };
                if (d.undoAvailable) {
                  setUndoAt(Date.now());
                  window.setTimeout(() => setUndoAt(null), 20000);
                }
                say(d.ok ? '弄好了，不满意可以撤销。' : ('没弄成：' + (d.reason ?? '未知原因')), 3200);
              }
              void refresh();
            }}>允许</button>
            <button className="flex-1 rounded-lg bg-white/10 py-1 text-[11px] text-slate-200" onClick={async () => {
              await fetch('/api/pet/desktop/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false }) });
              say('好，不动。', 2200);
              void refresh();
            }}>拒绝</button>
          </div>
        </div>
      )}

      {/* 撤销小条（移动/重命名后 20 秒内可撤销） */}
      {undoAt && (
        <div className="mb-1 flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-[10px] text-slate-200 backdrop-blur">
          已改好了
          <button className="rounded-full bg-white/15 px-2 py-[1px] text-[10px] text-white" onClick={async () => {
            const r = await fetch('/api/pet/desktop/undo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const d = await r.json() as { ok?: boolean; reason?: string };
            say(d.ok ? '撤销了。' : ('撤销失败：' + (d.reason ?? '')), 2600);
            setUndoAt(null);
            void refresh();
          }}>撤销</button>
        </div>
      )}

      {/* ===== 她本人 ===== */}
      <div className="relative" style={{ width: 170, height: 212 }}>
        {awake && (
          <span className="listen-ring pointer-events-none absolute inset-x-3 bottom-3 top-4 rounded-full border border-rose-200/40" />
        )}
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

        <div
          title={dragging ? '放我下来…' : '摸她 / 按住拖动 / 双击挥手 / 右键菜单'}
          className="absolute inset-0 select-none border-none p-0 outline-none"
          style={{ background: 'transparent', touchAction: 'none' }}
        >
          {imageMode ? (
            <div className={`anya-state on ${action === 'pat' ? 'anya-pat' : ''}`}>
              <img src={spriteSrc} alt="anya" className={`anya-img anya-${activeSprite}`} draggable={false} />
            </div>
          ) : (
            <div className="pet-stage absolute inset-0">
              <div className="pet-head-idle absolute left-1/2 top-2 h-[92px] w-[92px] -translate-x-1/2 rounded-full"
                   style={{ background: headColor, boxShadow: '0 8px 22px rgba(0,0,0,.35)' }}>
                <div className="absolute left-[22px] top-[40px] flex gap-[24px]">
                  {[0, 1].map(i => (
                    <span key={i} className="block w-[9px] rounded-full bg-[#2a2633]" style={{ height: blink || action === 'sleep' ? 2 : 11 }} />
                  ))}
                </div>
                <div className="absolute left-1/2 top-[62px] h-[9px] w-[20px] -translate-x-1/2 rounded-b-full border-b-[2.5px] border-[#2a2633]"
                     style={{ transform: low ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)' }} />
              </div>
              <div className="absolute bottom-[26px] left-1/2 h-[68px] w-[60px] -translate-x-1/2 rounded-t-[28px] rounded-b-[20px]"
                   style={{ background: bodyColor, boxShadow: '0 8px 18px rgba(0,0,0,.28)' }} />
            </div>
          )}
        </div>
      </div>

      {/* 状态小字（非按钮）：情绪 / 聆听提示 */}
      <div className="mb-2 mt-1 flex items-center gap-1.5 text-[10px] text-slate-300/90">
        <span className="rounded-full bg-black/25 px-2 py-[1px] backdrop-blur-sm">{mood}</span>
        {room && <span className="max-w-[130px] truncate rounded-full bg-black/20 px-2 py-[1px] text-slate-300/80 backdrop-blur-sm">小屋：{room}</span>}
        {voiceLabel && <span className={`rounded-full px-2 py-[1px] backdrop-blur-sm ${awake ? 'bg-rose-500/25 text-rose-100' : 'bg-black/20 text-slate-400'}`}>{silence ? '听着…' : voiceLabel}</span>}
      </div>

    </div>
  );
}