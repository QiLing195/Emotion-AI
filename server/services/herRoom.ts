/**
 * 她的小屋（v1.63）—— 给"她自己的生活"一个**有限、可查、不编造**的空间。
 *
 * 用户的原话：她自己的事情有点作假（"怎么会打球""怎么会喝咖啡"）。
 * 病根：LLM 被要求"她有自己的生活"时，会自由发明外部生活（同事/运动/聚会/出差…）——
 * 那些既无记忆支撑、也无法和她的经历对上。
 *
 * 修法不是"禁止她有生活"，而是**给她一间小屋**：
 *   · 活动只在白名单里（8 种，全部落在"室内、一个人、可即时描述"）；
 *   · 当前活动是**持久化事实**（写 memories/her_room.json，跨轮/跨重启不丢）；
 *   · Prompt 里只允许引用"此刻我在做什么"这一条事实；**小屋之外的事一律不许编**。
 *
 * 这样她说"我在煮咖啡"时是**真的**（状态里就是 coffee），而不是凭空发明。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const HER_ROOM_DEFAULT_PATH = 'memories/her_room.json';

export function herRoomEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_HER_ROOM === 'true';
}

export interface HerActivity {
  id: string;
  /** 她可以说的那一句（第一人称、室内、一个人） */
  label: string;
  /** 适合的情绪底色（用于挑活动；不做硬门） */
  moods: string[];
  /** 这次活动通常持续多久（分钟） */
  minutes: number;
}

/** 白名单：全部是"一个人的室内活动"，保证可即时描述且不涉及外部人事 */
export const HER_ROOM_ACTIVITIES: HerActivity[] = [
  { id: 'coffee', label: '在煮咖啡，慢慢喝', moods: ['calm', 'content', 'tired'], minutes: 25 },
  { id: 'window', label: '靠着窗看外面发呆', moods: ['calm', 'sad', 'lonely'], minutes: 20 },
  { id: 'music', label: '在听一首老歌，单曲循环', moods: ['sad', 'calm', 'content'], minutes: 30 },
  { id: 'book', label: '翻着一本书，没看进去几页', moods: ['calm', 'tired', 'sad'], minutes: 35 },
  { id: 'tidy', label: '在收拾桌面，把东西摆整齐', moods: ['anxious', 'calm', 'tired'], minutes: 20 },
  { id: 'doodle', label: '在纸上随手画点东西', moods: ['calm', 'content', 'joy'], minutes: 25 },
  { id: 'water', label: '在给窗台那盆绿萝浇水', moods: ['calm', 'content'], minutes: 15 },
  { id: 'blanket', label: '裹着毯子发呆', moods: ['tired', 'sad', 'lonely'], minutes: 40 },
  { id: 'stretch', label: '伸了个懒腰，把窗户打开透气', moods: ['tired', 'calm', 'joy'], minutes: 15 },
  { id: 'write', label: '在本子上写了两句，又划掉了', moods: ['sad', 'calm', 'lonely'], minutes: 30 },
];

export interface HerRoomHistoryEntry {
  id: string;
  label: string;
  since: number;
  until: number;
}

export interface HerRoomState {
  schema: 'her-room-v1';
  activityId: string;
  label: string;
  since: number;
  updatedAt: number;
  turns: number;
  history: HerRoomHistoryEntry[];
}

export function emptyRoom(now = Date.now()): HerRoomState {
  const first = HER_ROOM_ACTIVITIES[0];
  return {
    schema: 'her-room-v1',
    activityId: first.id,
    label: first.label,
    since: now,
    updatedAt: now,
    turns: 0,
    history: [],
  };
}

export function loadHerRoom(path = HER_ROOM_DEFAULT_PATH): HerRoomState | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as HerRoomState;
    if (!raw || raw.schema !== 'her-room-v1' || !raw.activityId) return null;
    return raw;
  } catch {
    return null;                                  // 坏文件 = 当没有，绝不因此报错
  }
}

export function saveHerRoom(state: HerRoomState, path = HER_ROOM_DEFAULT_PATH): boolean {
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function activityById(id: string): HerActivity {
  return HER_ROOM_ACTIVITIES.find(a => a.id === id) ?? HER_ROOM_ACTIVITIES[0];
}

/** 确定性挑选（同一轮/同一分钟稳定，可复现）：优先匹配情绪底色，且不与当前重复 */
export function pickActivity(input: {
  now: number;
  round: number;
  topEmotion?: string | null;
  currentId?: string | null;
  dayIndex?: number;
}): HerActivity {
  const emo = String(input.topEmotion ?? '').toLowerCase();
  const day = input.dayIndex ?? Math.floor(input.now / 86_400_000);
  const preferred = HER_ROOM_ACTIVITIES.filter(a => a.moods.includes(emo));
  const pool = preferred.length >= 3 ? preferred : HER_ROOM_ACTIVITIES;
  const start = Math.abs((input.round + day * 7 + pool.length) % pool.length);
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(start + i) % pool.length];
    if (cand.id !== input.currentId) return cand;
  }
  return pool[start];
}

export interface AdvanceInput {
  now: number;
  round: number;
  topEmotion?: string | null;
  /** 她是否处在已成段低谷（低谷时更少换活动 = 更黏在一种状态里） */
  lowActive?: boolean;
}

/** 每轮推进：未到期则保持（低谷期再多留一会儿），到期则换一个 */
export function advanceHerRoom(prev: HerRoomState | null, input: AdvanceInput): HerRoomState {
  const now = input.now;
  if (!prev) {
    const act = pickActivity({ now, round: input.round, topEmotion: input.topEmotion });
    return {
      schema: 'her-room-v1',
      activityId: act.id,
      label: act.label,
      since: now,
      updatedAt: now,
      turns: 1,
      history: [],
    };
  }
  const current = activityById(prev.activityId);
  const minutes = (now - prev.since) / 60_000;
  const stay = minutes < (input.lowActive ? current.minutes * 1.6 : current.minutes);
  if (stay) {
    return { ...prev, updatedAt: now, turns: prev.turns + 1 };
  }
  const next = pickActivity({
    now,
    round: input.round,
    topEmotion: input.topEmotion,
    currentId: prev.activityId,
  });
  const history = [
    ...prev.history,
    { id: prev.activityId, label: prev.label, since: prev.since, until: now },
  ].slice(-12);
  return {
    schema: 'her-room-v1',
    activityId: next.id,
    label: next.label,
    since: now,
    updatedAt: now,
    turns: prev.turns + 1,
    history,
  };
}

/**
 * 进 Prompt 的那一条（**只允许她引用这一条**，小屋之外不许编）。
 * 静息/无小屋时返回空串（不注入）。
 */
export function herRoomPromptLine(state: HerRoomState | null): string {
  if (!state) return '';
  return [
    '【我自己的小屋】',
    `此刻我在：${state.label}。`,
    '这是我自己的生活，只有这一间屋子、这些事（读书、听歌、煮咖啡、看窗外、收拾、画画、浇花、发呆、写两笔）。',
    '除这里写着的，**不要**编造工作、同事、运动、聚会、出差、朋友这些外面的事；要提也说这里的事。',
    '如果这一轮用不上，可以不提。',
  ].join('\n');
}

/** 给 /api/her-state 的只读投影 */
export function herRoomView(state: HerRoomState | null, now = Date.now()) {
  if (!state) return { active: false, activity: null, minutes: 0, turns: 0, history: [] };
  const act = activityById(state.activityId);
  return {
    active: true,
    activity: { id: act.id, label: state.label, since: state.since, minutes: Math.round((now - state.since) / 60_000) },
    minutes: Math.round((now - state.since) / 60_000),
    turns: state.turns,
    history: state.history.slice(-6).map(h => ({ label: h.label, since: h.since, until: h.until })),
  };
}
