#!/usr/bin/env node
/**
 * v2.24：旧时间线历史清理（把历史里的用户原话替换成 hash/长度）
 *
 * 背景：v2.23 起新写入的 `emotion_timeline.jsonl` 默认只存 `quotedHash`/`quotedLength`，
 * 但**旧文件**里仍有 `trigger.quoted` / `branch.causeQuoted` 原文。这个脚本负责把历史也抹平。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/redact-timeline-history.ts            # 只报告（dry-run）
 *   node node_modules/tsx/dist/cli.mjs scripts/redact-timeline-history.ts --apply    # 实际写回（先备份）
 *   ... --dir=<memories目录>  --no-backup  --keep-rotations
 *
 * 默认：备份成 `<file>.pre-redact-<时间戳>`；失败不写回；幂等（已脱敏的节点不动）。
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { redactTimelineNode, type TimelineRecord } from '../server/services/emotionTimeline.js';

const args = process.argv.slice(2);
const opt = (name: string): string | null => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const dir = opt('dir') ?? process.env.MEMORIES_DIR ?? 'memories';
const apply = flag('apply');
const noBackup = flag('no-backup');
const includeRotations = !flag('keep-rotations');

if (!existsSync(dir)) {
  console.error(`目录不存在: ${dir}`);
  process.exit(2);
}

const base = 'emotion_timeline.jsonl';
const files = readdirSync(dir)
  .filter(n => n === base || (includeRotations && n.startsWith(`${base}.rot-`)))
  .sort()
  .map(n => join(dir, n));

if (files.length === 0) {
  console.log(`没有找到 ${base}（目录: ${dir}）`);
  process.exit(0);
}

interface FileResult { file: string; nodes: number; changed: number; rawBefore: number; rawAfter: number; bytesBefore: number; bytesAfter: number; backup: string | null; }
const results: FileResult[] = [];
const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');

for (const file of files) {
  const beforeText = readFileSync(file, 'utf8');
  const bytesBefore = statSync(file).size;
  const lines = beforeText.split('\n').filter(Boolean);
  let changed = 0;
  let rawBefore = 0;
  let rawAfter = 0;
  const out: string[] = [];
  const hasRawQuote = (n: TimelineRecord): boolean =>
    (n.kind === 'state_change' && Boolean(n.trigger?.quoted)) ||
    (n.kind === 'branch' && Boolean(n.branch?.causeQuoted));
  for (const line of lines) {
    let node: TimelineRecord;
    try { node = JSON.parse(line) as TimelineRecord; } catch { out.push(line); continue; }
    if (hasRawQuote(node)) rawBefore++;
    const r = redactTimelineNode(node);
    if (r.changed) changed++;
    if (hasRawQuote(r.node)) rawAfter++;
    out.push(JSON.stringify(r.node));
  }
  const afterText = `${out.join('\n')}${out.length ? '\n' : ''}`;
  const bytesAfter = Buffer.byteLength(afterText, 'utf8');
  let backup: string | null = null;

  if (apply && changed > 0) {
    if (!noBackup) {
      backup = `${file}.pre-redact-${stamp}`;
      copyFileSync(file, backup);
    }
    const tmp = `${file}.tmp-redact-${process.pid}`;
    writeFileSync(tmp, afterText, 'utf8');
    renameSync(tmp, file);
  }

  results.push({ file: basename(file), nodes: lines.length, changed, rawBefore, rawAfter, bytesBefore, bytesAfter, backup });
}

console.log(`# 时间线历史清理（${apply ? 'APPLY' : 'DRY-RUN'}）目录: ${dir}`);
console.log('| 文件 | 节点 | 需脱敏 | 原话(前) | 原话(后) | 大小 | 备份 |');
console.log('|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(`| ${r.file} | ${r.nodes} | ${r.changed} | ${r.rawBefore} | ${r.rawAfter} | ${Math.round(r.bytesBefore / 1024)}KB → ${Math.round(r.bytesAfter / 1024)}KB | ${r.backup ? basename(r.backup) : '—'} |`);
}
const totalChanged = results.reduce((n, r) => n + r.changed, 0);
const totalRaw = results.reduce((n, r) => n + r.rawBefore, 0);
console.log('');
if (!apply) {
  console.log(`共 ${totalChanged} 个节点含原话，可脱敏；加 --apply 实际写回（会先备份）。`);
} else {
  console.log(`已脱敏 ${totalChanged} 个节点（处理前原话字段 ${totalRaw} 处）。`);
}
