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

describe('v1.95：关键词可配置 + 接进情绪/主动关心', () => {
  it('activity-keywords.json 可以整类覆盖关键词（不用改代码）', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const m = await import('../activityUnderstanding.js');
    const p = path.join(os.tmpdir(), `ak-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify({ categories: { job: { keywords: ['岗位速递'] } } }), 'utf8');
    m.resetKeywordTableCacheForTests();
    const table = m.loadKeywordTable(p);
    const job = table.find(d => d.key === 'job')!;
    expect(job.keywords).toEqual(['岗位速递']);
    // 覆盖后旧关键词不再命中 job（但可能命中别的类别，所以用无歧义词验证）
    expect(m.classifyActivity('BOSS直聘 - 杭州招聘', 'chrome', table)).not.toBe('job');
    expect(m.classifyActivity('岗位速递 - 某网站', 'chrome', table)).toBe('job');
    // 没覆盖的类别仍用默认
    expect(table.find(d => d.key === 'video')!.keywords.length).toBeGreaterThan(0);
    fs.unlinkSync(p);
    m.resetKeywordTableCacheForTests();
  });

  it('只有非 vague 的"关心类"活动才会变成 concern', async () => {
    const m = await import('../activityUnderstanding.js');
    const strong = m.understandActivity(view([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: 'BOSS直聘 - 简历投递', minutesAgo: 2 },
    ]));
    const concern = m.toActivityConcern(strong);
    expect(concern).not.toBeNull();
    expect(concern!.category).toBe('job');
    expect(concern!.type).toBe('activity_concern');
    expect(concern!.intensity).toBeGreaterThan(0.3);
    // 娱乐类不推动情绪
    const fun = m.understandActivity(view([
      { title: 'YouTube 视频', minutesAgo: 1 },
      { title: 'YouTube 视频2', minutesAgo: 2 },
    ]));
    expect(m.toActivityConcern(fun)).toBeNull();
    // 证据不足（vague）不推动
    const weak = m.understandActivity(view([{ title: 'BOSS直聘', minutesAgo: 1 }]));
    expect(m.toActivityConcern(weak)).toBeNull();
  });

  it('Prompt 行：只在看得清时给一行，关心类带提醒语气', async () => {
    const m = await import('../activityUnderstanding.js');
    const u = m.understandActivity(view([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: '拉勾 - 后端', minutesAgo: 2 },
    ]));
    const line = m.activityPromptLine(u);
    expect(line).toContain('【我看到的】');
    expect(line).toContain('找工作');
    expect(m.activityPromptLine(null)).toBe('');
  });

  it('持续观察：同类 ≥20 分钟才主动关心，之后 90 分钟冷却、每天 ≤2 次', async () => {
    const m = await import('../activityUnderstanding.js');
    const u = m.understandActivity(view([
      { title: 'BOSS直聘 - 杭州岗位', minutesAgo: 1 },
      { title: 'BOSS直聘 - 简历投递', minutesAgo: 2 },
    ]));
    const t0 = 1_700_000_000_000;
    let s = m.emptyCareStreak('2026-10-22');
    let d = m.updateCareStreak(s, u, t0, '2026-10-22');
    expect(d.shouldCare).toBe(false);
    expect(d.reason).toBe('new_category');
    s = d.streak;
    d = m.updateCareStreak(s, u, t0 + 5 * 60_000, '2026-10-22');
    expect(d.shouldCare).toBe(false);
    expect(d.reason).toBe('not_long_enough');
    s = d.streak;
    d = m.updateCareStreak(s, u, t0 + 21 * 60_000, '2026-10-22');
    expect(d.shouldCare).toBe(true);
    s = d.streak;
    d = m.updateCareStreak(s, u, t0 + 40 * 60_000, '2026-10-22');
    expect(d.shouldCare).toBe(false);
    expect(d.reason).toBe('cooldown');
    s = d.streak;
    // 过了冷却 → 第二次可以
    d = m.updateCareStreak(s, u, t0 + 21 * 60_000 + 91 * 60_000, '2026-10-22');
    expect(d.shouldCare).toBe(true);
    s = d.streak;
    // 第三次被每日上限挡住
    d = m.updateCareStreak(s, u, t0 + 21 * 60_000 + 200 * 60_000, '2026-10-22');
    expect(d.shouldCare).toBe(false);
    expect(d.reason).toBe('daily_cap');
  });

  it('活动不是关心类 → 清空持续状态（不累积）', async () => {
    const m = await import('../activityUnderstanding.js');
    const u = m.understandActivity(view([{ title: 'YouTube', minutesAgo: 1 }, { title: 'YouTube 2', minutesAgo: 2 }]));
    const d = m.updateCareStreak({ ...m.emptyCareStreak('x'), category: 'job', since: 1, samples: 5 }, u, 1000, 'x');
    expect(d.shouldCare).toBe(false);
    expect(d.streak.category).toBeNull();
  });

  it('内在事件：activity_concern 只给很轻的 fear/love，且受总上限约束', async () => {
    const { applyInternalEvents } = await import('../../../src/lib/emotionInternal.js');
    const { INITIAL_EMOTION_STATE } = await import('../../../src/lib/emotionTypes.js');
    const before = { ...INITIAL_EMOTION_STATE, internal: { ...(INITIAL_EMOTION_STATE as unknown as { internal?: object }).internal } } as never;
    const after = applyInternalEvents(before, [{ type: 'activity_concern', intensity: 1 }]);
    const b = (before as unknown as { emotions: Record<string, number> }).emotions;
    const a = (after as unknown as { emotions: Record<string, number> }).emotions;
    expect(a.fear - b.fear).toBeGreaterThan(0);
    expect(a.fear - b.fear).toBeLessThanOrEqual(0.05);
    expect(a.love - b.love).toBeGreaterThan(0);
  });
});