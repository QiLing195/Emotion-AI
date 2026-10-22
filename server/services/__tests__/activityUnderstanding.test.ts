import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_KEYWORDS,
  classifyActivity,
  describeUnderstanding,
  understandActivity,
} from '../activityUnderstanding.js';
import type { ActivityView } from '../activityWatcher.js';

function view(entries: Array<{ title: string; process?: string; minutesAgo: number }>, enabled = true): ActivityView {
  return {
    enabled,
    entries: entries.map((e, i) => ({ title: e.title, process: e.process ?? 'x', minutesAgo: e.minutesAgo, ts: Date.now() - e.minutesAgo * 60_000 - i })),
  };
}

describe('活动理解层（v1.94）', () => {
  it('关键词：招聘类窗口归到 job', () => {
    expect(classifyActivity('「杭州招聘」-2026年杭州人才招聘信息 - BOSS直聘 - Google Chrome', 'chrome')).toBe('job');
  });

  it('关键词：代码/终端归到 dev，视频归到 video，听歌归到 music', () => {
    expect(classifyActivity('index.ts - ai_friend-3 - Visual Studio Code', 'code')).toBe('dev');
    expect(classifyActivity('(5) 杂谈|关于创业、管理 - YouTube - Google Chrome', 'chrome')).toBe('video');
    expect(classifyActivity('网易云音乐', 'cloudmusic')).toBe('music');
  });

  it('进程名也能命中（标题看不出时靠进程）', () => {
    expect(classifyActivity('', 'WeChat')).toBe('chat');
  });

  it('认不出来返回 null（不硬猜）', () => {
    expect(classifyActivity('某个毫无特征的窗口', 'unknown.exe')).toBeNull();
  });

  it('多条同类窗口 → 主导类别与置信度', () => {
    const u = understandActivity(view([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: 'BOSS直聘 - 简历投递', minutesAgo: 3 },
      { title: '拉勾 - 后端工程师', minutesAgo: 5 },
      { title: 'YouTube', minutesAgo: 6 },
    ]));
    expect(u).not.toBeNull();
    expect(u!.category).toBe('job');
    expect(u!.confidence).toBeCloseTo(0.75, 2);
    expect(u!.windows).toBe(4);
    expect(u!.vague).toBe(false);
    expect(u!.summary).toContain('工作');
    expect(u!.evidence.length).toBeGreaterThan(0);
    // 至少一句能读的人话
    expect(describeUnderstanding(u)).toContain('窗口');
  });

  it('只有 1 条记录 → 标 vague（证据不足，不把话说死）', () => {
    const u = understandActivity(view([{ title: 'BOSS直聘', minutesAgo: 1 }]));
    expect(u!.vague).toBe(true);
  });

  it('窗口混杂且主导类别不到 40% → vague', () => {
    const u = understandActivity(view([
      { title: 'BOSS直聘', minutesAgo: 1 },
      { title: 'YouTube', minutesAgo: 2 },
      { title: '网易云音乐', minutesAgo: 3 },
    ]));
    expect(u!.category).toBe('job');
    expect(u!.vague).toBe(true);
  });

  it('全认不出 → 明说看不出，不编造类别', () => {
    const u = understandActivity(view([{ title: '无特征窗口', minutesAgo: 1 }, { title: '另一个窗口', minutesAgo: 2 }]));
    expect(u!.category).toBe('unknown');
    expect(u!.vague).toBe(true);
    expect(u!.summary).toContain('看不出');
  });

  it('太久以前的窗口不算"现在"（默认 45 分钟外丢弃）', () => {
    const u = understandActivity(view([{ title: 'BOSS直聘', minutesAgo: 3 }, { title: 'YouTube', minutesAgo: 300 }]));
    expect(u!.windows).toBe(1);
  });

  it('没开采样 / 空记录 → null 或明确"没看到"，不抛错', () => {
    expect(understandActivity(view([{ title: 'BOSS直聘', minutesAgo: 1 }], false))).toBeNull();
    expect(understandActivity(null)).toBeNull();
    const empty = understandActivity(view([]));
    expect(empty!.vague).toBe(true);
    expect(empty!.windows).toBe(0);
  });

  it('关键词表里没有重复类别键（避免归类歧义）', () => {
    const keys = ACTIVITY_KEYWORDS.map(k => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
