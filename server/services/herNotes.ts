/**
 * 她自己的便签（v1.75）—— `remember_this` 工具的落地层。
 *
 * 为什么要"审计"：这是她**唯一主动写入自己长期状态**的通路（其它都是系统派生）。
 * 因此：只追加、不改写；有长度与内容校验；单文件滚动；失败静默（不打断对话）。
 *
 * 文件：`memories/her_notes.jsonl`（每行 {ts, note}）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const HER_NOTES_PATH = 'memories/her_notes.jsonl';
export const NOTE_MAX_CHARS = 80;
export const NOTE_MIN_CHARS = 4;
const MAX_BYTES = 512_000;
const KEEP_ROTATIONS = 3;

export function herNotesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_HER_NOTES === 'true';
}

export interface NoteRecord {
  ts: number;
  note: string;
}

/** 校验：太短/太长/元描述/角色幻觉 一律拒绝（返回 reason） */
export function validateNote(raw: string): { ok: boolean; note: string; reason?: string } {
  const note = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!note) return { ok: false, note: '', reason: 'empty' };
  if (note.length < NOTE_MIN_CHARS) return { ok: false, note, reason: `too_short（少于 ${NOTE_MIN_CHARS} 字）` };
  if (note.length > NOTE_MAX_CHARS) return { ok: false, note, reason: `too_long（多于 ${NOTE_MAX_CHARS} 字）` };
  if (/(作为(一个)?(AI|人工智能|语言模型)|我是AI|系统提示|prompt)/i.test(note)) {
    return { ok: false, note, reason: 'meta_description' };
  }
  return { ok: true, note };
}

function rotate(path: string): void {
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size < MAX_BYTES) return;
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = i === 1 ? path : `${path}.${i - 1}`;
      const to = `${path}.${i}`;
      if (existsSync(from)) {
        try { renameSync(from, to); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

export function addNote(note: string, path = HER_NOTES_PATH): { ok: boolean; reason?: string; count?: number } {
  const v = validateNote(note);
  if (!v.ok) return { ok: false, reason: v.reason };
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotate(path);
    const rec: NoteRecord = { ts: Date.now(), note: v.note };
    appendFileSync(path, JSON.stringify(rec) + '\n', 'utf8');
    return { ok: true, count: listNotes(20, path).length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'write_failed' };
  }
}

export function listNotes(limit = 10, path = HER_NOTES_PATH): NoteRecord[] {
  try {
    if (!existsSync(path)) return [];
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l) as NoteRecord; } catch { return null; }
    }).filter((r): r is NoteRecord => Boolean(r && typeof r.note === 'string'));
    return rows.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}
