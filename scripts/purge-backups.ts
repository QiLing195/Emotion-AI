#!/usr/bin/env node
/**
 * v2.26：批量清理备份文件（`.bak*` / `.pre-redact-*`；可选 `.rot-*`）
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/purge-backups.ts                 # dry-run
 *   node node_modules/tsx/dist/cli.mjs scripts/purge-backups.ts --apply         # 实际删除
 *   ... --dir=<memories目录>  --older-than=7  --include-rotations
 *
 * 注意：`--include-rotations` 会把时间线/其它 `.rot-*` 历史轮转也当备份删除；
 * 默认**不**碰它们（那些是历史数据，不是"备份副本"）。
 */
import { existsSync } from 'node:fs';
import {
  formatBytes,
  listBackupFiles,
  purgeBackups,
  selectBackups,
} from '../server/services/backupCleanup.js';

const args = process.argv.slice(2);
const opt = (name: string): string | null => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const dir = opt('dir') ?? process.env.MEMORIES_DIR ?? 'memories';
const apply = flag('apply');
const includeRotations = flag('include-rotations');
const olderRaw = opt('older-than');
const olderThanDays = olderRaw == null ? null : Number(olderRaw);

if (!existsSync(dir)) {
  console.error(`目录不存在: ${dir}`);
  process.exit(2);
}
if (olderRaw != null && (!Number.isFinite(olderThanDays) || (olderThanDays as number) < 0)) {
  console.error(`--older-than 必须是 >=0 的数字（收到: ${olderRaw}）`);
  process.exit(2);
}

const all = listBackupFiles(dir, { includeRotations });
const selected = selectBackups(all, { olderThanDays });
const totalBytes = selected.reduce((n, f) => n + f.bytes, 0);
const now = Date.now();

console.log(`# 备份清理（${apply ? 'APPLY' : 'DRY-RUN'}）目录: ${dir}`);
console.log(`  匹配备份: ${all.length} 个 / ${formatBytes(all.reduce((n, f) => n + f.bytes, 0))}`);
if (olderThanDays != null) console.log(`  只清理早于 ${olderThanDays} 天: ${selected.length} 个`);
console.log('');
if (selected.length === 0) {
  console.log('没有需要清理的备份。');
  process.exit(0);
}
console.log('| 文件 | 大小 | 年龄(天) |');
console.log('|---|---|---|');
for (const f of selected) {
  const ageDays = Math.max(0, Math.floor((now - f.mtimeMs) / 86_400_000));
  console.log(`| ${f.name} | ${formatBytes(f.bytes)} | ${ageDays} |`);
}
console.log('');

if (!apply) {
  console.log(`共 ${selected.length} 个、${formatBytes(totalBytes)}；加 --apply 实际删除。`);
  process.exit(0);
}

const result = purgeBackups(selected);
console.log(`已删除 ${result.removed.length} 个，释放 ${formatBytes(result.bytesFreed)}。`);
if (result.failed.length > 0) {
  console.log('删除失败：');
  for (const f of result.failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
