import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activityWatchEnabled,
  isActivitySamplerRunning,
  parseActivityLog,
  readRecentActivity,
  redactTitle,
} from '../activityWatcher.js';

const NOW = new Date(2026, 9, 22, 15, 0, 0, 0).getTime();
const MIN = 60_000;

let tmpFile = '';
const saveEnv = process.env.ENABLE_ACTIVITY_WATCH;

beforeEach(() => {
  tmpFile = join(mkdtempSync(join(tmpdir(), 'act-')), 'activity_log.jsonl');
});
afterEach(() => {
  if (saveEnv === undefined) delete process.env.ENABLE_ACTIVITY_WATCH;
  else process.env.ENABLE_ACTIVITY_WATCH = saveEnv;
});

describe('开关与脱敏', () => {
  it('默认关', () => {
    expect(activityWatchEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(activityWatchEnabled({ ENABLE_ACTIVITY_WATCH: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('敏感标题被隐藏（双保险：采样器做过一次，这里再防一次）', () => {
    expect(redactTitle('某某银行 - 个人网银')).toBe('[已隐藏：疑似敏感窗口]');
    expect(redactTitle('Password Manager')).toBe('[已隐藏：疑似敏感窗口]');
    expect(redactTitle('Visual Studio Code - server.ts')).toContain('server.ts');
    expect(redactTitle('   ')).toBe('');
  });
});

describe('解析 JSONL（坏行跳过，不抛错）', () => {
  it('正常行解析、坏行忽略、缺字段忽略', () => {
    const text = [
      JSON.stringify({ ts: 1, title: 'A', process: 'Code' }),
      'not json',
      JSON.stringify({ title: 'no ts' }),
      JSON.stringify({ ts: 2, title: 'B' }),
      '',
    ].join('\n');
    const rows = parseActivityLog(text);
    expect(rows.map(r => r.title)).toEqual(['A', 'B']);
  });
});

describe('读最近活动（给她看的视图）', () => {
  it('开关关着 ⇒ enabled=false 且不读文件', () => {
    delete process.env.ENABLE_ACTIVITY_WATCH;
    const v = readRecentActivity(5, NOW, tmpFile);
    expect(v.enabled).toBe(false);
    expect(v.entries).toHaveLength(0);
    expect(String(v.note)).toContain('没开');
  });

  it('文件不存在 ⇒ 如实说"还没有采样记录"', () => {
    process.env.ENABLE_ACTIVITY_WATCH = 'true';
    const v = readRecentActivity(5, NOW, tmpFile);
    expect(v.enabled).toBe(true);
    expect(v.entries).toHaveLength(0);
    expect(String(v.note)).toContain('还没有采样记录');
  });

  it('返回最近条目、连续同窗口去重、超时换算成分钟', () => {
    process.env.ENABLE_ACTIVITY_WATCH = 'true';
    writeFileSync(tmpFile, [
      JSON.stringify({ ts: NOW - 30 * MIN, title: 'Visual Studio Code', process: 'Code' }),
      JSON.stringify({ ts: NOW - 20 * MIN, title: 'Visual Studio Code', process: 'Code' }),
      JSON.stringify({ ts: NOW - 10 * MIN, title: 'Chrome - 某篇文章', process: 'chrome' }),
      JSON.stringify({ ts: NOW - 5 * MIN, title: '密码 - 银行', process: 'chrome' }),
    ].join('\n'), 'utf8');
    const v = readRecentActivity(10, NOW, tmpFile);
    expect(v.enabled).toBe(true);
    // 按时间倒序：最新的是"被隐藏"那条，其次 Chrome，最后（去重后）Visual Studio Code
    expect(v.entries.map(e => e.title)).toEqual([
      '[已隐藏：疑似敏感窗口]',
      'Chrome - 某篇文章',
      'Visual Studio Code',
    ]);
    expect(v.entries[0].minutesAgo).toBe(5);
    expect(v.entries[0].process).toBe('chrome');
  });

  it('limit 被夹到 1~20', () => {
    process.env.ENABLE_ACTIVITY_WATCH = 'true';
    writeFileSync(tmpFile, Array.from({ length: 25 }, (_, i) => JSON.stringify({ ts: NOW - i * MIN, title: `窗口${i}` })).join('\n'), 'utf8');
    expect(readRecentActivity(999, NOW, tmpFile).entries.length).toBeLessThanOrEqual(20);
    expect(readRecentActivity(0.2, NOW, tmpFile).entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('采样器进程', () => {
  it('未开启时不启动', () => {
    delete process.env.ENABLE_ACTIVITY_WATCH;
    expect(isActivitySamplerRunning()).toBe(false);
  });
});
