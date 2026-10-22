/**
 * 她的"回头再问"（v1.75）—— `set_followup` 工具的落地层。
 *
 * 为什么要有它：动机池里的 `open_loop` 是**规则抽取**出来的（面试/体检…），
 * 她没法自己"答应下来一件事，到点再提"。set_followup 补的就是这个：
 *   她说「明天再问你面试结果」→ 记一条 followup → 到点由**主动消息**（现有 proactive 通路）发出。
 *
 * 边界（防止变成"定时骚扰"）：
 *   · 只存**她说出口的那句话**（不重新生成，避免编造）；
 *   · 仍然走 proactive 的全部闸门（配额/时间窗/空闲/低谷矜持）；
 *   · 最多 20 条未发；过期（>7 天）自动作废；发过即标记，不重发。
 *
 * 文件：`memories/her_followups.json`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCnTime, toLocalIso } from './cnTimeParse.js';

export const HER_FOLLOWUPS_PATH = 'memories/her_followups.json';
export const MAX_PENDING = 20;
export const MAX_AGE_MS = 7 * 24 * 3_600_000;
/** 可排的最远时间：14 天（"下周三"这类 6~7 天后的提醒要能排上） */
export const MAX_HORIZON_HOURS = 14 * 24;
/** 最近可排：0.5 小时（避免"马上提醒"变成骚扰） */
export const MIN_HORIZON_HOURS = 0.5;

export function herFollowupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_HER_FOLLOWUP === 'true';
}

export interface Followup {
  id: string;
  what: string;
  dueAt: number;
  createdAt: number;
  sentAt: number | null;
  cancelled: boolean;
}

export interface FollowupStore {
  schema: 'her-followups-v1';
  items: Followup[];
}

export function loadFollowups(path = HER_FOLLOWUPS_PATH): FollowupStore {
  try {
    if (!existsSync(path)) return { schema: 'her-followups-v1', items: [] };
    const raw = JSON.parse(readFileSync(path, 'utf8')) as FollowupStore;
    if (!raw || raw.schema !== 'her-followups-v1' || !Array.isArray(raw.items)) {
      return { schema: 'her-followups-v1', items: [] };
    }
    return raw;
  } catch {
    return { schema: 'her-followups-v1', items: [] };
  }
}

export function saveFollowups(store: FollowupStore, path = HER_FOLLOWUPS_PATH): boolean {
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 解析本地时间字符串（YYYY-MM-DDTHH:mm 或 YYYY-MM-DD HH:mm）→ 毫秒；失败返回 null */
export function parseDueAtLocal(input: string | null | undefined): number | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function validateFollowup(what: string, dueInHours: number): { ok: boolean; what: string; dueInHours: number; reason?: string } {
  const text = String(what ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, what: '', dueInHours, reason: 'empty' };
  if (text.length < 4 || text.length > 120) return { ok: false, what: text, dueInHours, reason: 'length_out_of_range(4~120)' };
  if (/(作为(一个)?(AI|人工智能|语言模型)|我是AI|系统提示)/i.test(text)) {
    return { ok: false, what: text, dueInHours, reason: 'meta_description' };
  }
  const hours = Number(dueInHours);
  if (!Number.isFinite(hours) || hours < MIN_HORIZON_HOURS || hours > MAX_HORIZON_HOURS) {
    return { ok: false, what: text, dueInHours, reason: 'due_in_hours_out_of_range(0.5~72)' };
  }
  return { ok: true, what: text, dueInHours: hours };
}

/** 记一条"到点再问"。超过未发上限时**拒绝**（不静默丢弃，让她知道可以说"记不下了"） */
export function addFollowup(input: {
  what: string; dueInHours: number; dueAtLocal?: string | null; now?: number; path?: string;
}): { ok: boolean; reason?: string; dueAt?: number; pending?: number } {
  const now = input.now ?? Date.now();
  const path = input.path ?? HER_FOLLOWUPS_PATH;

  // 优先用"他说出口的具体时间"（本地时间字符串）——避免模型把"明天下午三点"算成 +3h
  let dueAtFromLocal: number | null = null;
  if (input.dueAtLocal) {
    dueAtFromLocal = parseDueAtLocal(input.dueAtLocal);
    if (dueAtFromLocal === null) return { ok: false, reason: 'due_at_local_unparsable（要 YYYY-MM-DDTHH:mm）' };
    const hours = (dueAtFromLocal - now) / 3_600_000;
    if (hours < 0.1 || hours > MAX_HORIZON_HOURS) return { ok: false, reason: "due_at_local_out_of_range（" + hours.toFixed(1) + "h，需 0.1~" + MAX_HORIZON_HOURS + "h）" };
  }

  // 先按模型给的时间校验
  let v = dueAtFromLocal === null
    ? validateFollowup(input.what, input.dueInHours)
    : { ok: true as const, what: String(input.what ?? '').trim(), dueInHours: 0 };

  // v1.79 文本兜底：**只有当模型给的时间不合法**时，才从话里解析中文时间（避免覆盖合法输入）
  if (!v.ok && dueAtFromLocal === null) {
    const parsed = parseCnTime(String(input.what ?? ''), now);
    if (parsed) {
      const hours = (parsed.dueAt - now) / 3_600_000;
      if (hours >= 0.1 && hours <= MAX_HORIZON_HOURS) {
        dueAtFromLocal = parsed.dueAt;
        input = { ...input, dueAtLocal: toLocalIso(parsed.dueAt) };
        v = { ok: true as const, what: String(input.what ?? '').trim(), dueInHours: 0 };
      }
    }
  }
  if (!v.ok) return { ok: false, reason: (v as { reason?: string }).reason };
  if (dueAtFromLocal !== null && (v.what.length < 4 || v.what.length > 120)) {
    return { ok: false, reason: 'length_out_of_range(4~120)' };
  }
  const store = loadFollowups(path);
  const pending = store.items.filter(i => !i.cancelled && i.sentAt === null && now - i.createdAt < MAX_AGE_MS);
  if (pending.length >= MAX_PENDING) return { ok: false, reason: `pending_full（已排 ${pending.length} 条，先等它们说完）` };
  const dueAt = dueAtFromLocal ?? (now + v.dueInHours * 3_600_000);
  const item: Followup = {
    id: `fu_${now}_${Math.random().toString(36).slice(2, 8)}`,
    what: v.what, dueAt, createdAt: now, sentAt: null, cancelled: false,
  };
  const next: FollowupStore = { schema: 'her-followups-v1', items: [...store.items, item].slice(-100) };
  if (!saveFollowups(next, path)) return { ok: false, reason: 'write_failed' };
  return { ok: true, dueAt, pending: pending.length + 1 };
}

/** 到点、未发、未取消、未过期 → 按到点时间升序 */
export function dueFollowups(now = Date.now(), path = HER_FOLLOWUPS_PATH): Followup[] {
  return loadFollowups(path).items
    .filter(i => !i.cancelled && i.sentAt === null && i.dueAt <= now && now - i.createdAt < MAX_AGE_MS)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function markFollowupSent(id: string, now = Date.now(), path = HER_FOLLOWUPS_PATH): boolean {
  const store = loadFollowups(path);
  const item = store.items.find(i => i.id === id);
  if (!item) return false;
  item.sentAt = now;
  return saveFollowups(store, path);
}

export function listFollowups(path = HER_FOLLOWUPS_PATH): Followup[] {
  return loadFollowups(path).items;
}

/**
 * 是否该由"到点追问"接管这一轮 proactive（v1.75，纯函数，便于单测）。
 * 规则：proactive 闸门必须已放行；且存在到点未发的追问 ⇒ 用它替代动机生成的那条。
 */
export function pickDueFollowup(
  gatesAllowed: boolean,
  now = Date.now(),
  path = HER_FOLLOWUPS_PATH,
): { take: boolean; item: Followup | null; dueCount: number } {
  if (!gatesAllowed) return { take: false, item: null, dueCount: 0 };
  const due = dueFollowups(now, path);
  return { take: due.length > 0, item: due[0] ?? null, dueCount: due.length };
}

/**
 * v1.80：到点**不是**把她当初那句话原样发出去，而是给她一条"自己想起来的"线索，
 * 让她在 proactive 通路里**用自己的话**重说一遍（语气/情绪/措辞都由她当时的状​态决定）。
 */
export function buildRecallHint(item: Followup): string {
  const summary = String(item.what ?? '').trim();
  return `（这件事是你自己记在心里的，不是谁提醒你的）${summary}`;
}