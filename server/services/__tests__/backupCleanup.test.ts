import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isBackupName,
  listBackupFiles,
  selectBackups,
  purgeBackups,
  formatBytes,
} from '../backupCleanup.js';

let dir = '';

function touch(name: string, content = 'x'): string {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bak-clean-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('v2.26 备份文件名识别', () => {
  it('认 .bak / .bak.* / .pre-redact-*；不认主文件/隐藏文件', () => {
    expect(isBackupName('episodic_memory.json.bak')).toBe(true);
    expect(isBackupName('episodic_memory.json.bak.1789918011612')).toBe(true);
    expect(isBackupName('emotion_timeline.jsonl.pre-redact-20261023')).toBe(true);
    expect(isBackupName('emotion_state.json.bak-2026-09-15T14-43-20-304Z')).toBe(true);
    expect(isBackupName('episodic_memory.json')).toBe(false);
    expect(isBackupName('activity_log.jsonl')).toBe(false);
    expect(isBackupName('.env')).toBe(false);
  });

  it('默认不认 .rot-*；显式 includeRotations 才认', () => {
    expect(isBackupName('emotion_timeline.jsonl.rot-1700000000')).toBe(false);
    expect(isBackupName('emotion_timeline.jsonl.rot-1700000000', { includeRotations: true })).toBe(true);
  });
});

describe('v2.26 列出 / 筛选 / 删除', () => {
  it('只列普通文件，跳过目录', () => {
    touch('a.json.bak');
    touch('b.json.bak.123');
    touch('c.json');
    expect(listBackupFiles(dir).map(f => f.name).sort()).toEqual(['a.json.bak', 'b.json.bak.123']);
    expect(listBackupFiles(dir).every(f => f.bytes > 0)).toBe(true);
  });

  it('older-than 按 mtime 筛选', () => {
    const old = touch('old.json.bak');
    const fresh = touch('fresh.json.bak');
    const now = Date.now();
    utimesSync(old, new Date(now - 10 * 86_400_000), new Date(now - 10 * 86_400_000));
    utimesSync(fresh, new Date(now - 1 * 86_400_000), new Date(now - 1 * 86_400_000));
    const all = listBackupFiles(dir);
    const selected = selectBackups(all, { olderThanDays: 7, now });
    expect(selected.map(f => f.name)).toEqual(['old.json.bak']);
    expect(selectBackups(all, { olderThanDays: null, now }).length).toBe(2);
  });

  it('purge 真删；已消失的文件计入 failed 而不抛', () => {
    touch('a.json.bak');
    touch('b.json.bak');
    const files = listBackupFiles(dir);
    const result = purgeBackups(files);
    expect(result.removed.length).toBe(2);
    expect(result.failed.length).toBe(0);
    expect(result.bytesFreed).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'a.json.bak'))).toBe(false);

    // 已消失的路径：unlink 失败 → 计入 failed，不抛
    const gone = join(dir, 'gone.json.bak');
    writeFileSync(gone, 'x', 'utf8');
    rmSync(gone);
    const result2 = purgeBackups([{ name: 'gone.json.bak', path: gone, bytes: 1, mtimeMs: 0 }]);
    expect(result2.removed.length).toBe(0);
    expect(result2.failed.map(f => f.name)).toEqual(['gone.json.bak']);
  });

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2.0KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
  });
});
