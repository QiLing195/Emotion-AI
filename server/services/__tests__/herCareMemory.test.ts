import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFollowUpHint,
  findPendingFollowUp,
  loadCareMemory,
  recentCareAsks,
  recordCare,
  CARE_MEMORY_MAX,
  CARE_MEMORY_TTL_MS,
  FOLLOW_UP_MIN_AGE_MS,
} from '../herCareMemory.js';

let dir = '';
let path = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'care-mem-'));
  path = join(dir, 'activity_care.json');
});
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

const base = { category: 'job', label: '找工作', summary: '你像是在看工作机会', text: '最近投简历累不累？', evidence: ['BOSS直聘'] };

describe('她"关心过什么"的记忆（v1.96）', () => {
  it('记录并读回（按时间倒序）', () => {
    const t = 1_700_000_000_000;
    recordCare({ ...base, ts: t }, path, t);
    recordCare({ ...base, ts: t + 1000, text: '岗位看得怎么样？' }, path, t + 1000);
    const recs = recentCareAsks(5, path);
    expect(recs).toHaveLength(2);
    expect(recs[0].text).toBe('岗位看得怎么样？');
    expect(existsSync(path)).toBe(true);
  });

  it('同 id 覆盖、超上限裁剪、超保鲜期丢弃', () => {
    const now = 1_700_000_000_000;
    recordCare({ ...base, id: 'a', ts: now }, path, now);
    recordCare({ ...base, id: 'a', ts: now, text: '覆盖后' }, path, now);
    expect(recentCareAsks(5, path)).toHaveLength(1);
    expect(recentCareAsks(5, path)[0].text).toBe('覆盖后');
    for (let i = 0; i < CARE_MEMORY_MAX + 5; i++) {
      recordCare({ ...base, ts: now + i * 1000, text: 'x' + i }, path, now + i * 1000);
    }
    expect(loadCareMemory(path).records.length).toBeLessThanOrEqual(CARE_MEMORY_MAX);
    // 很老的一条（超 14 天）会被清掉
    const old = now + 10_000_000;
    recordCare({ ...base, ts: old - CARE_MEMORY_TTL_MS - 1, text: '老' }, path, old);
    expect(loadCareMemory(path).records.some(r => r.text === '老')).toBe(false);
  });

  it('接着问结果：只在 6h~48h 窗口内找，优先同类别', () => {
    const now = 1_700_000_000_000;
    recordCare({ ...base, category: 'meeting', label: '开会', text: '会开得怎么样？', ts: now - 10 * 3600_000 }, path, now);
    recordCare({ ...base, category: 'job', text: '投简历累不累？', ts: now - 8 * 3600_000 }, path, now);
    const p = findPendingFollowUp(now, { category: 'job', path });
    expect(p).not.toBeNull();
    expect(p!.text).toBe('投简历累不累？');
    // 太新（<6h）不找
    recordCare({ ...base, ts: now - 3600_000, text: '刚问的' }, path, now);
    expect(findPendingFollowUp(now, { category: 'job', path })!.text).toBe('投简历累不累？');
    // 太旧（>48h）不找
    const far = now + 60 * 3600_000;
    expect(findPendingFollowUp(far, { category: 'job', path })).toBeNull();
  });

  it('没有记录 / 空文件 → 不硬找', () => {
    expect(findPendingFollowUp(1_700_000_000_000, { path })).toBeNull();
    expect(recentCareAsks(5, path)).toEqual([]);
  });

  it('Prompt 线索：有上一次关心就带原话，没有就是空串', () => {
    expect(buildFollowUpHint(null)).toBe('');
    const hint = buildFollowUpHint({
      id: 'x', ts: 1, category: 'job', label: '找工作', summary: 's', text: '累不累？', evidence: [],
    });
    expect(hint).toContain('上次你为这件事关心过');
    expect(hint).toContain('累不累？');
    expect(hint).toContain('进展');
  });

  it('坏文件不抛错（当空处理）', async () => {
    const fs = await import('node:fs');
    fs.writeFileSync(path, '{ not json', 'utf8');
    expect(() => recentCareAsks(5, path)).not.toThrow();
    expect(recentCareAsks(5, path)).toEqual([]);
    expect(findPendingFollowUp(1, { path })).toBeNull();
    expect(FOLLOW_UP_MIN_AGE_MS).toBe(6 * 3600_000);
  });
});
