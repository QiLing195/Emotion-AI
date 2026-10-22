import { describe, it, expect } from 'vitest';
import {
  MAX_NOTES_SHOWN,
  MAX_UPCOMING_SHOWN,
  buildRememberedView,
  pickRecentNotes,
  pickUpcoming,
  relativeDue,
} from '../herRemembered.js';

const NOW = new Date(2026, 9, 22, 12, 0, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('便签选取：最近 N 条、过滤空/坏数据', () => {
  it('按时间倒序取最近 3 条', () => {
    const rows = pickRecentNotes([
      { ts: NOW - 3 * HOUR, note: '旧的' },
      { ts: NOW - 1 * HOUR, note: '新的' },
      { ts: NOW - 2 * HOUR, note: '中间的' },
      { ts: NOW - 4 * HOUR, note: '更旧' },
    ]);
    expect(rows).toHaveLength(MAX_NOTES_SHOWN);
    expect(rows.map(r => r.note)).toEqual(['新的', '中间的', '旧的']);
  });

  it('空便签/缺字段被过滤（不显示空白行）', () => {
    const rows = pickRecentNotes([{ ts: NOW, note: '   ' }, { ts: NOW }, { ts: NOW, note: '有效' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('有效');
  });
});

describe('到点事项：只留未发、未取消，按时间升序', () => {
  it('已发/已取消/坏时间都不显示', () => {
    const rows = pickUpcoming([
      { what: '已发的', dueAt: NOW + HOUR, sentAt: NOW },
      { what: '取消的', dueAt: NOW + HOUR, sentAt: null, cancelled: true },
      { what: '时间坏掉的', dueAt: Number.NaN, sentAt: null },
      { what: '正常的', dueAt: NOW + HOUR, sentAt: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].what).toBe('正常的');
  });

  it('多条按到点时间升序、最多 4 条', () => {
    const rows = pickUpcoming(Array.from({ length: 6 }, (_, i) => ({
      what: `第${i}件`, dueAt: NOW + (6 - i) * HOUR, sentAt: null,
    })));
    expect(rows).toHaveLength(MAX_UPCOMING_SHOWN);
    expect(rows[0].what).toBe('第5件');
  });
});

describe('相对时间（人话）', () => {
  it('分钟/小时/天/已到点', () => {
    expect(relativeDue(NOW + 20 * MIN, NOW)).toBe('20 分钟后');
    expect(relativeDue(NOW + 3 * HOUR, NOW)).toBe('3 小时后');
    expect(relativeDue(NOW + 24 * HOUR, NOW)).toBe('明天');
    expect(relativeDue(NOW + 5 * 24 * HOUR, NOW)).toBe('5 天后');
    expect(relativeDue(NOW - MIN, NOW)).toBe('已经到点了');
  });
});

describe('组装视图：开关关着就是空（不泄露数据）', () => {
  it('两个开关都关 ⇒ 空列表 + enabled=false', () => {
    const v = buildRememberedView({
      notesEnabled: false, followupEnabled: false,
      notes: [{ ts: NOW, note: '不该出现' }],
      followups: [{ what: '也不该出现', dueAt: NOW + HOUR, sentAt: null }],
      now: NOW,
    });
    expect(v.notes).toHaveLength(0);
    expect(v.upcoming).toHaveLength(0);
    expect(v.notesEnabled).toBe(false);
  });

  it('开着 ⇒ 带相对时间与 due 标记', () => {
    const v = buildRememberedView({
      notesEnabled: true, followupEnabled: true,
      notes: [{ ts: NOW - 2 * HOUR, note: '他下周三体检' }],
      followups: [
        { what: '问问面试结果', dueAt: NOW + 2 * HOUR, sentAt: null },
        { what: '已经到点的事', dueAt: NOW - 5 * MIN, sentAt: null },
      ],
      now: NOW,
    });
    expect(v.notes[0].agoMinutes).toBe(120);
    expect(v.upcoming).toHaveLength(2);
    expect(v.upcoming[0].due).toBe(true);
    expect(v.upcoming[1].inMinutes).toBe(120);
  });
});
