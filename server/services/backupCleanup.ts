/**
 * v2.26：备份文件清理（`.bak` / `.pre-redact-*`，可选时间线轮转 `.rot-*`）。
 *
 * 为什么需要：删除/迁移会留下备份副本（隐私面 + 磁盘）；v2.24 的时间线历史清理也会生成
 * `.pre-redact-*` 备份。这个模块只做**列出/筛选/删除**，默认行为由 CLI 决定（dry-run 优先）。
 *
 * 安全边界：
 *  - 只列**普通文件**（跳过 symlink / 目录 / 读不到的项）；
 *  - 只按文件名模式匹配，绝不接受任意路径；
 *  - 删除失败不抛，返回 failed 列表。
 */
import { lstatSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface BackupFile {
  name: string;
  path: string;
  bytes: number;
  mtimeMs: number;
}

export interface ListBackupOptions {
  /** 是否把时间线/其它 `.rot-*` 轮转也算备份（默认否：它们更像"历史数据"） */
  includeRotations?: boolean;
}

const BAK_RE = /\.bak($|[-.])/i;
const PRE_REDACT_RE = /\.pre-redact-/i;
const ROT_RE = /\.rot-/i;

/** 判断一个文件名是否算"可清理的备份" */
export function isBackupName(name: string, opts: ListBackupOptions = {}): boolean {
  if (!name || name.startsWith('.')) return false;
  if (BAK_RE.test(name) || PRE_REDACT_RE.test(name)) return true;
  if (opts.includeRotations && ROT_RE.test(name)) return true;
  return false;
}

/** 列出目录下所有备份文件（普通文件；失败返回空数组） */
export function listBackupFiles(dir: string, opts: ListBackupOptions = {}): BackupFile[] {
  const out: BackupFile[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!isBackupName(name, opts)) continue;
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (!st.isFile()) continue; // 跳过 symlink/目录
      out.push({ name, path: p, bytes: statSync(p).size, mtimeMs: st.mtimeMs });
    } catch { /* 跳过读不到/已消失 */ }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export interface SelectBackupOptions {
  /** 只清理早于 N 天的（null/undefined = 不限） */
  olderThanDays?: number | null;
  now?: number;
}

/** 按时间筛选（默认全部） */
export function selectBackups(files: BackupFile[], opts: SelectBackupOptions = {}): BackupFile[] {
  const now = opts.now ?? Date.now();
  const days = opts.olderThanDays;
  if (days == null || !Number.isFinite(days)) return files.slice();
  const cutoff = now - Math.max(0, days) * 24 * 3600_000;
  return files.filter(f => f.mtimeMs <= cutoff);
}

export interface PurgeResult {
  removed: BackupFile[];
  failed: Array<{ name: string; error: string }>;
  bytesFreed: number;
}

/** 删除给定备份（失败不抛） */
export function purgeBackups(files: BackupFile[]): PurgeResult {
  const removed: BackupFile[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  let bytesFreed = 0;
  for (const f of files) {
    try {
      unlinkSync(f.path);
      removed.push(f);
      bytesFreed += f.bytes;
    } catch (e) {
      failed.push({ name: f.name, error: (e as Error).message });
    }
  }
  return { removed, failed, bytesFreed };
}

/** 一行摘要（CLI / 审计用） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
