/**
 * 她"关心过什么"的记忆（v1.96）。
 *
 * 解决的问题：主动关心过去是**每次独立判定** —— 同一件事她可能重复问，也接不上"上次问的结果"。
 * 这里只做三件事：
 *   ① 记下她主动关心过什么（类别/原话/证据/时间）；
 *   ② 找"该接着问结果"的那一条（问过 ≥6 小时、≤48 小时、优先同一类别）；
 *   ③ 给 Prompt 一段"上次你问过…这次别重复、可以问进展"的线索。
 *
 * 边界：只追加、有上限（20 条）与保鲜期（14 天）；读写失败静默（观测层不打断主流程）；
 *       不做任何"成功/失败"的裁判，也不改她的规则 —— 只是给她一条记忆。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CARE_MEMORY_PATH = join('memories', 'activity_care.json');
export const CARE_MEMORY_MAX = 20;
export const CARE_MEMORY_TTL_MS = 14 * 24 * 3600_000;
/** 问过多久之后才适合"接着问结果"（太短像追问，太久像忘了） */
export const FOLLOW_UP_MIN_AGE_MS = 6 * 3600_000;
export const FOLLOW_UP_MAX_AGE_MS = 48 * 3600_000;

export interface CareRecord {
  id: string;
  ts: number;
  category: string;
  label: string;
  summary: string;
  /** 她当时说的原话（≤40 字，已过清洗） */
  text: string;
  evidence: string[];
}

export interface CareMemoryFile {
  records: CareRecord[];
}

function readFile(path: string): CareMemoryFile {
  try {
    if (!existsSync(path)) return { records: [] };
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CareMemoryFile>;
    const records = Array.isArray(raw.records) ? raw.records : [];
    return {
      records: records
        .filter(r => r && typeof r === 'object'
          && typeof r.ts === 'number' && typeof r.text === 'string' && typeof r.category === 'string')
        .map(r => ({
          id: String(r.id ?? `care_${r.ts}`),
          ts: Number(r.ts),
          category: String(r.category),
          label: String(r.label ?? ''),
          summary: String(r.summary ?? ''),
          text: String(r.text),
          evidence: Array.isArray(r.evidence) ? r.evidence.filter(e => typeof e === 'string').slice(0, 3) : [],
        }))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, CARE_MEMORY_MAX),
    };
  } catch {
    return { records: [] };
  }
}

function writeFile(path: string, data: CareMemoryFile): boolean {
  try {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读全部（已按时间倒序、已裁剪） */
export function loadCareMemory(path = CARE_MEMORY_PATH): CareMemoryFile {
  return readFile(path);
}

/** 记一条"她主动关心过"（重复 id 覆盖；超上限丢最旧；超保鲜期丢弃） */
export function recordCare(rec: Omit<CareRecord, 'id'> & { id?: string }, path = CARE_MEMORY_PATH, now = Date.now()): CareRecord {
  const full: CareRecord = {
    id: rec.id ?? `care_${now}_${Math.random().toString(36).slice(2, 6)}`,
    ts: Number(rec.ts ?? now),
    category: String(rec.category ?? 'unknown'),
    label: String(rec.label ?? ''),
    summary: String(rec.summary ?? ''),
    text: String(rec.text ?? '').slice(0, 120),
    evidence: Array.isArray(rec.evidence) ? rec.evidence.filter(e => typeof e === 'string').slice(0, 3) : [],
  };
  const file = readFile(path);
  const kept = [full, ...file.records.filter(r => r.id !== full.id)]
    .filter(r => now - r.ts <= CARE_MEMORY_TTL_MS)
    .slice(0, CARE_MEMORY_MAX);
  writeFile(path, { records: kept });
  return full;
}

/** 最近几次关心（界面用） */
export function recentCareAsks(limit = 5, path = CARE_MEMORY_PATH): CareRecord[] {
  return readFile(path).records.slice(0, Math.max(1, Math.min(CARE_MEMORY_MAX, limit)));
}

/**
 * 找"该接着问结果"的那一条：问过 ≥6h、≤48h；优先同类别，其次任一类。
 * 没有就返回 null（不硬找）。
 */
export function findPendingFollowUp(
  now = Date.now(),
  opts: { category?: string; minAgeMs?: number; maxAgeMs?: number; path?: string } = {},
): CareRecord | null {
  const records = readFile(opts.path ?? CARE_MEMORY_PATH).records;
  const minAge = opts.minAgeMs ?? FOLLOW_UP_MIN_AGE_MS;
  const maxAge = opts.maxAgeMs ?? FOLLOW_UP_MAX_AGE_MS;
  const inWindow = records.filter(r => {
    const age = now - r.ts;
    return age >= minAge && age <= maxAge;
  });
  if (inWindow.length === 0) return null;
  if (opts.category) {
    const same = inWindow.find(r => r.category === opts.category);
    if (same) return same;
  }
  return inWindow[0] ?? null;
}

/** 给 Prompt 的"上次你问过"线索（没有就返回 ''） */
export function buildFollowUpHint(rec: CareRecord | null): string {
  if (!rec) return '';
  return `【上次你为这件事关心过】${rec.label || rec.summary || '他最近在忙的事'}——你当时说的是「${rec.text}」。`
    + '这次别重复同一句话：如果他又在做这件事，可以问一句**进展/结果**；如果他没回应过，问得轻一点。';
}
