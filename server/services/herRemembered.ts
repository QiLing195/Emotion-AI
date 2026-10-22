/**
 * 「她记着的事」只读视图（v1.81）
 *
 * 给她的小屋界面用：她写过的便签 + 她记着但还没到点/已到点的事。
 * **只读**：不写、不改状态、不产生消息；数据新鲜度由调用方轮询。
 *
 * 为什么单独一层：界面要的"人话相对时间"和筛选规则（未发/未取消/有上限）值得单测，
 * 不要在前端里散着写（前端改了没人测）。
 */

export interface NoteRow {
  note: string;
  agoMinutes: number;
}

export interface UpcomingRow {
  what: string;
  dueAt: number;
  /** 距离到点还有多少分钟（负数=已到点但还没被想起） */
  inMinutes: number;
  due: boolean;
}

export interface RememberedView {
  notesEnabled: boolean;
  followupEnabled: boolean;
  notes: NoteRow[];
  upcoming: UpcomingRow[];
}

export interface RawNote { ts?: number; note?: string }
export interface RawFollowup { what?: string; dueAt?: number; sentAt?: number | null; cancelled?: boolean }

export const MAX_NOTES_SHOWN = 3;
export const MAX_UPCOMING_SHOWN = 4;

/** 取最近便签（原样返回，不做相对时间） */
export function pickRecentNotes(notes: RawNote[], limit = MAX_NOTES_SHOWN): RawNote[] {
  return [...notes]
    .filter(n => typeof n?.note === 'string' && n.note.trim().length > 0)
    .sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0))
    .slice(0, limit);
}

/** 取还没到点（或刚到点没发）的事，按到点时间升序 */
export function pickUpcoming(items: RawFollowup[], limit = MAX_UPCOMING_SHOWN): RawFollowup[] {
  return [...items]
    .filter(i => typeof i?.what === 'string' && i.what.trim().length > 0)
    .filter(i => !i.cancelled && i.sentAt === null)
    .filter(i => Number.isFinite(Number(i.dueAt)))
    .sort((a, b) => Number(a.dueAt) - Number(b.dueAt))
    .slice(0, limit);
}

/** 相对时间（人话；界面用） */
export function relativeDue(dueAt: number, now: number): string {
  const m = Math.round((dueAt - now) / 60_000);
  if (m < 0) return '已经到点了';
  if (m < 60) return `${Math.max(1, m)} 分钟后`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时后`;
  const d = Math.round(h / 24);
  if (d <= 1) return '明天';
  return `${d} 天后`;
}

export function buildRememberedView(input: {
  notesEnabled: boolean;
  followupEnabled: boolean;
  notes: RawNote[];
  followups: RawFollowup[];
  now: number;
}): RememberedView {
  const notes: NoteRow[] = input.notesEnabled
    ? pickRecentNotes(input.notes).map(n => ({
      note: String(n.note).trim(),
      agoMinutes: Math.max(0, Math.round((input.now - Number(n.ts ?? input.now)) / 60_000)),
    }))
    : [];
  const upcoming: UpcomingRow[] = input.followupEnabled
    ? pickUpcoming(input.followups).map(i => {
      const dueAt = Number(i.dueAt);
      const inMinutes = Math.round((dueAt - input.now) / 60_000);
      return { what: String(i.what).trim(), dueAt, inMinutes, due: inMinutes <= 0 };
    })
    : [];
  return {
    notesEnabled: input.notesEnabled,
    followupEnabled: input.followupEnabled,
    notes,
    upcoming,
  };
}
