/**
 * v2.00：用户可控的记忆闭环（查看 / 纠错 / 删除 / 导出）。
 *
 * 设计原则：
 *  - 纯函数式核心（store/graph 作为入参），便于单测；server 端点只做 IO 与持久化。
 *  - 删除要**传播**：episodic 主文件 + 图谱节点/边（否则 BFS 还能召回）+ 可选 `.bak` 副本。
 *  - 每次删除/更正写审计（`memories/memory_admin_audit.jsonl`），便于"为什么它不见了"可追。
 *  - 导出只读文本类记忆文件（json/jsonl），不打包截图二进制；路径做白名单。
 */
import { existsSync, readFileSync, readdirSync, statSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EpisodicMemory, EpisodicMemoryStore } from '../../src/lib/episodicMemory.js';
import type { MemoryGraph } from '../../src/lib/memoryGraph.js';

export const MEMORY_ADMIN_AUDIT_PATH = join('memories', 'memory_admin_audit.jsonl');

/** v2.00：数据目录（与 persistence 的 MEMORIES_DIR 同一套规则，便于测试隔离） */
export function memoriesDir(): string {
  const dir = process.env.MEMORIES_DIR ? resolve(process.env.MEMORIES_DIR) : 'memories';
  return dir;
}
/** 导出时读取的文件类型（顶层目录，不含 screens/） */
const EXPORTABLE_EXT = ['.json', '.jsonl', '.txt', '.md'];
/** 导出单文件上限（防止把巨大文件塞进响应） */
const EXPORT_MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface DeleteEpisodeResult {
  ok: boolean;
  reason?: string;
  id: string;
  removedEpisode: boolean;
  removedGraphNodes: number;
  scrubbedBackups: number;
}

export interface UpdateEpisodeResult {
  ok: boolean;
  reason?: string;
  id: string;
  changed: string[];
}

function auditPathFor(dir: string): string {
  return join(dir, 'memory_admin_audit.jsonl');
}

/** 追加一行审计（失败静默：审计不能打断用户操作） */
export function appendAudit(entry: Record<string, unknown>, dir = memoriesDir()): void {
  try {
    const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
    appendFileSync(auditPathFor(dir), line, 'utf8');
  } catch { /* ignore */ }
}

/**
 * 删除一条情景记忆：
 *  1) 从 store.episodes 移除（含归档条目）
 *  2) 从图谱移除 source='episodic' & sourceId=id 的节点及其边
 *  3) 可选：清理 `.bak*` 副本里的同 id 条目（防止"删了又被备份复活"）
 */
export function deleteEpisode(
  store: EpisodicMemoryStore,
  graph: MemoryGraph,
  id: string,
  opts: { backupDir?: string; purgeBackups?: boolean; dir?: string } = {},
): DeleteEpisodeResult {
  const dataDir = opts.dir ?? memoriesDir();
  const result: DeleteEpisodeResult = {
    ok: false, id, removedEpisode: false, removedGraphNodes: 0, scrubbedBackups: 0,
  };
  if (!id || typeof id !== 'string') { result.reason = 'invalid_id'; return result; }
  const idx = store.episodes.findIndex(e => e.id === id);
  if (idx >= 0) {
    store.episodes.splice(idx, 1);
    result.removedEpisode = true;
  }
  result.removedGraphNodes = graph.removeBySource('episodic', id);
  if (opts.purgeBackups) {
    result.scrubbedBackups = scrubBackups(opts.backupDir ?? dataDir, id);
  }
  result.ok = result.removedEpisode || result.removedGraphNodes > 0;
  if (!result.ok) result.reason = 'not_found';
  appendAudit({
    op: 'delete',
    id,
    removedEpisode: result.removedEpisode,
    removedGraphNodes: result.removedGraphNodes,
    scrubbedBackups: result.scrubbedBackups,
    ok: result.ok,
  }, dataDir);
  return result;
}

/**
 * 更正一条记忆（用户纠错）：只允许改文本字段与标签，不允许改 id/时间/召回权重。
 * 返回改了哪些字段；不存在的 id 返回 ok=false(reason=not_found)。
 */
export function updateEpisode(
  store: EpisodicMemoryStore,
  graph: MemoryGraph,
  id: string,
  patch: { eventSummary?: string; narrativeFragment?: string; tags?: string[] },
  opts: { dir?: string } = {},
): UpdateEpisodeResult {
  const dataDir = opts.dir ?? memoriesDir();
  const ep = store.episodes.find(e => e.id === id);
  if (!ep) return { ok: false, reason: 'not_found', id, changed: [] };
  const changed: string[] = [];
  if (typeof patch.eventSummary === 'string' && patch.eventSummary.trim() && patch.eventSummary.length <= 500) {
    ep.eventSummary = patch.eventSummary.trim();
    changed.push('eventSummary');
  }
  if (typeof patch.narrativeFragment === 'string' && patch.narrativeFragment.trim() && patch.narrativeFragment.length <= 200) {
    ep.narrativeFragment = patch.narrativeFragment.trim();
    changed.push('narrativeFragment');
  }
  if (Array.isArray(patch.tags)) {
    ep.tags = patch.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 8);
    changed.push('tags');
  }
  if (changed.length === 0) return { ok: false, reason: 'no_valid_field', id, changed };
  // 图谱节点内容同步（否则召回用的是旧文本）
  for (const node of graph.getAllNodes()) {
    if (node.source === 'episodic' && node.sourceId === id) {
      (node as unknown as { content: string }).content = ep.narrativeFragment || ep.eventSummary;
      (node as unknown as { tags: string[] }).tags = [...ep.tags];
    }
  }
  appendAudit({ op: 'update', id, changed }, dataDir);
  return { ok: true, id, changed };
}

/**
 * 清理 `.bak*` 文件里指定 id 的条目（只处理 episodic_memory.json.bak* 这类 JSON）。
 * 无法解析的文件跳过并计数为 0（不冒险改坏备份）。
 */
export function scrubBackups(dir: string, id: string): number {
  let scrubbed = 0;
  let names: string[] = [];
  try { names = readdirSync(dir).filter(n => n.includes('.bak')); } catch { return 0; }
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (!statSync(p).isFile() || statSync(p).size > 32 * 1024 * 1024) continue;
      const raw = readFileSync(p, 'utf8');
      const data = JSON.parse(raw) as { episodes?: EpisodicMemory[] } | EpisodicMemory[];
      const arr = Array.isArray(data) ? data : Array.isArray(data?.episodes) ? data.episodes : null;
      if (!arr) continue;
      const before = arr.length;
      const kept = arr.filter(e => e && e.id !== id);
      if (kept.length === before) continue;
      if (Array.isArray(data)) {
        // 数组形式的备份：直接写回过滤后的数组
        writeFileSync(p, JSON.stringify(kept, null, 2), 'utf8');
      } else {
        (data as { episodes: EpisodicMemory[] }).episodes = kept;
        writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
      }
      scrubbed += before - kept.length;
    } catch { /* 跳过无法解析/不可写 */ }
  }
  return scrubbed;
}

export interface MemoryExport {
  exportedAt: number;
  dir: string;
  files: Array<{ name: string; bytes: number; content: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * 导出记忆目录下的文本文件（不导出截图二进制、不导出 `.env`）。
 * 调用方负责把它作为 JSON 附件返回；这里不做脱敏（内容就是用户自己的数据）。
 */
export function exportMemories(dir = memoriesDir()): MemoryExport {
  const files: MemoryExport['files'] = [];
  const skipped: MemoryExport['skipped'] = [];
  let names: string[] = [];
  try { names = readdirSync(dir).sort(); } catch { return { exportedAt: Date.now(), dir, files, skipped }; }
  for (const name of names) {
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) { skipped.push({ name, reason: 'not_a_file' }); continue; }
      if (!EXPORTABLE_EXT.some(ext => name.endsWith(ext))) { skipped.push({ name, reason: 'binary_or_unsupported' }); continue; }
      if (st.size > EXPORT_MAX_FILE_BYTES) { skipped.push({ name, reason: 'too_large' }); continue; }
      files.push({ name, bytes: st.size, content: readFileSync(p, 'utf8') });
    } catch {
      skipped.push({ name, reason: 'read_failed' });
    }
  }
  return { exportedAt: Date.now(), dir, files, skipped };
}

/** 查看单条（界面/接口用；不含 embedding 这种大字段） */
export function viewEpisode(store: EpisodicMemoryStore, id: string): Record<string, unknown> | null {
  const ep = store.episodes.find(e => e.id === id);
  if (!ep) return null;
  const { embedding: _embedding, ...rest } = ep as EpisodicMemory & { embedding?: number[] };
  return rest;
}

export function exists(p: string): boolean {
  return existsSync(p);
}
