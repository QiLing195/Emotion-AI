/**
 * 桌宠视图（v1.83）：给 Electron 那个透明小窗口用的极简状态。
 * 只读 + 无副作用：不写记忆、不触发 LLM（互动回复由 server 端点单独处理）。
 */
import { lowPeriodOf } from '../../src/lib/lowPeriod.js';
import { separateActivation } from '../../src/lib/emotionActivation.js';
import { loadHerRoom, herRoomView, herRoomEnabled } from './herRoom.js';
import { readCaptureAudit, loadPetSettings } from './screenWatch.js';

export interface PetState {
  ok: boolean;
  now: number;
  mood: { top: string | null; delta: number; label: string };
  lowPeriod: { active: boolean; established: boolean; turns: number; phase: string } | null;
  room: { enabled: boolean; active: boolean; label: string | null; minutes: number };
  screen: {
    policy: string;
    lastCaptureAt: number | null;
    lastCaptureOk: boolean | null;
    capturesToday: number;
  };
}

const EMOTION_LABEL: Record<string, string> = {
  joy: '开心', love: '爱意', sad: '难过', fear: '不安', anger: '生气',
  disgust: '厌烦', calm: '平静', greed: '渴望', lust: '心动',
};

export function buildPetState(input: {
  emotionState: unknown;
  now?: number;
}): PetState {
  const now = input.now ?? Date.now();
  const es = input.emotionState as
    | ({ emotions?: Record<string, number>; baselineEmotions?: Record<string, number> } & Parameters<typeof lowPeriodOf>[0])
    | undefined;
  let top: string | null = null;
  let delta = 0;
  if (es?.emotions) {
    const act = separateActivation(es.emotions, es.baselineEmotions);
    const first = Object.entries(act.delta ?? {}).filter(([, v]) => Number(v) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    if (first) { top = first[0]; delta = Number(first[1]); }
  }
  const lp = es ? lowPeriodOf(es) : null;
  const settings = loadPetSettings();
  const audit = readCaptureAudit(50);
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const last = audit.find(r => r.ok) ?? null;

  return {
    ok: true,
    now,
    mood: {
      top,
      delta: Math.round(delta * 1000) / 1000,
      label: top ? (EMOTION_LABEL[top] ?? top) : '静息',
    },
    lowPeriod: lp
      ? { active: Boolean(lp.active), established: Boolean(lp.established), turns: Number(lp.turns ?? 0), phase: String(lp.phase ?? 'none') }
      : null,
    room: {
      enabled: herRoomEnabled(),
      active: Boolean(herRoomView(loadHerRoom()).active),
      label: herRoomView(loadHerRoom()).activity?.label ?? null,
      minutes: Number(herRoomView(loadHerRoom()).minutes ?? 0),
    },
    screen: {
      policy: settings.screenPolicy,
      lastCaptureAt: last?.ts ?? null,
      lastCaptureOk: last ? last.ok : null,
      capturesToday: audit.filter(r => r.ok && r.ts >= todayStart.getTime()).length,
    },
  };
}
