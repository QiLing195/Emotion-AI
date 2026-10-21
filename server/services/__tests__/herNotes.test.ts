import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HER_NOTES_PATH,
  addNote,
  herNotesEnabled,
  listNotes,
  validateNote,
} from '../herNotes.js';
import {
  MAX_PENDING,
  addFollowup,
  dueFollowups,
  herFollowupEnabled,
  listFollowups,
  loadFollowups,
  markFollowupSent,
  pickDueFollowup,
  parseDueAtLocal,
  validateFollowup,
} from '../herFollowups.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'her-')), 'x.json');

describe('便签（remember_this 的落地层）', () => {
  it('开关默认关', () => {
    expect(herNotesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(herNotesEnabled({ ENABLE_HER_NOTES: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('校验：太短/太长/元描述 一律拒绝', () => {
    expect(validateNote('嗯').ok).toBe(false);
    expect(validateNote('长'.repeat(200)).ok).toBe(false);
    expect(validateNote('作为一个AI，我要记住这件事').ok).toBe(false);
    expect(validateNote('他说下周体检，记得问一句').ok).toBe(true);
  });

  it('写入后可读回，且只追加', () => {
    const path = tmp();
    expect(addNote('他说下周体检，记得问一句', path).ok).toBe(true);
    expect(addNote('他说周末想去公园走走', path).ok).toBe(true);
    const notes = listNotes(10, path);
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toContain('体检');
    expect(notes[1].note).toContain('公园');
  });

  it('非法便签不会写进文件', () => {
    const path = tmp();
    expect(addNote('嗯', path).ok).toBe(false);
    expect(listNotes(10, path)).toHaveLength(0);
  });
});

describe('到点追问（set_followup 的落地层）', () => {
  it('开关默认关', () => {
    expect(herFollowupEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(herFollowupEnabled({ ENABLE_HER_FOLLOWUP: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('校验：时间 0.5~72 小时，内容 4~120 字', () => {
    expect(validateFollowup('回头问问面试结果', 12).ok).toBe(true);
    expect(validateFollowup('回头问问面试结果', 0.1).ok).toBe(false);
    expect(validateFollowup('回头问问面试结果', 400).ok).toBe(false);
    expect(validateFollowup('嗯', 5).ok).toBe(false);
  });

  it('到点前不 due、到点后 due、发过即不再 due', () => {
    const path = tmp();
    const now = 1_700_000_000_000;
    const r = addFollowup({ what: '明天问问面试结果', dueInHours: 12, now, path });
    expect(r.ok).toBe(true);
    expect(dueFollowups(now + 11 * 3_600_000, path)).toHaveLength(0);
    const due = dueFollowups(now + 12 * 3_600_000 + 1000, path);
    expect(due).toHaveLength(1);
    expect(markFollowupSent(due[0].id, now + 12 * 3_600_000 + 2000, path)).toBe(true);
    expect(dueFollowups(now + 13 * 3_600_000, path)).toHaveLength(0);
  });

  it('未发上限：排满后拒绝（明确告知，不静默丢）', () => {
    const path = tmp();
    const now = 1_700_000_000_000;
    for (let i = 0; i < MAX_PENDING; i++) {
      expect(addFollowup({ what: `第${i}件事回头问一句`, dueInHours: 5, now: now + i, path }).ok).toBe(true);
    }
    const extra = addFollowup({ what: '再来一条', dueInHours: 5, now: now + 100, path });
    expect(extra.ok).toBe(false);
    expect(String(extra.reason)).toContain('pending_full');
  });

  it('坏文件 ⇒ 当没有（不抛错）', () => {
    const path = HER_NOTES_PATH.replace('her_notes.jsonl', 'nope.json');
    expect(loadFollowups(path).items).toHaveLength(0);
    expect(listFollowups(path)).toHaveLength(0);
  });
});

describe('到点追问的接管判定（纯函数，供 proactive 用）', () => {
  it('闸门没放行 ⇒ 不接管', () => {
    const path = tmp();
    const now = 1_700_000_000_000;
    addFollowup({ what: '回头问问面试结果', dueInHours: 1, now: now - 7_200_000, path });
    expect(pickDueFollowup(false, now, path).take).toBe(false);
  });

  it('闸门放行 + 有到点项 ⇒ 接管，并给出条数', () => {
    const path = tmp();
    const now = 1_700_000_000_000;
    addFollowup({ what: '回头问问面试结果', dueInHours: 1, now: now - 7_200_000, path });
    addFollowup({ what: '体检结果记得问他', dueInHours: 1, now: now - 7_200_000, path });
    const r = pickDueFollowup(true, now, path);
    expect(r.take).toBe(true);
    expect(r.dueCount).toBe(2);
    expect(r.item?.what).toBeTruthy();
  });

  it('闸门放行但没有到点项 ⇒ 不接管（交回动机生成）', () => {
    const path = tmp();
    expect(pickDueFollowup(true, Date.now(), path).take).toBe(false);
  });
});
describe('具体时间（dueAtLocal）—— 修"明天下午三点被算成 +3h"', () => {
  it('能解析本地时间字符串；坏格式 ⇒ null', () => {
    const ms = parseDueAtLocal('2026-10-23T15:00');
    expect(ms).toBe(new Date(2026, 9, 23, 15, 0, 0, 0).getTime());
    expect(parseDueAtLocal('明天下午三点')).toBeNull();
    expect(parseDueAtLocal('')).toBeNull();
  });

  it('给了具体时间 ⇒ 用时间字符串，不用 dueInHours', () => {
    const path = tmp();
    const now = new Date(2026, 9, 21, 22, 0, 0, 0).getTime();
    const r = addFollowup({ what: '下午三点了——面试结果有消息了吗？', dueInHours: 3, dueAtLocal: '2026-10-22T15:00', now, path });
    expect(r.ok).toBe(true);
    expect(r.dueAt).toBe(new Date(2026, 9, 22, 15, 0, 0, 0).getTime());
  });

  it('具体时间已过去/太远 ⇒ 拒绝并说明范围', () => {
    const path = tmp();
    const now = new Date(2026, 9, 21, 22, 0, 0, 0).getTime();
    expect(addFollowup({ what: '回头问一句面试结果', dueInHours: 3, dueAtLocal: '2026-10-21T10:00', now, path }).ok).toBe(false);
    expect(addFollowup({ what: '回头问一句面试结果', dueInHours: 3, dueAtLocal: '2026-11-30T10:00', now, path }).ok).toBe(false);
  });
});
describe('文本时间兜底（v1.79）：没给合法时间但话里带时间', () => {
  it('"明天下午三点"⇒ 自动按文本排上', () => {
    const path = tmp();
    const now = new Date(2026, 9, 21, 23, 0, 0, 0).getTime();
    const r = addFollowup({ what: '明天下午三点提醒他问面试结果', dueInHours: 0, now, path });
    expect(r.ok).toBe(true);
    expect(new Date(r.dueAt!).getDate()).toBe(22);
    expect(new Date(r.dueAt!).getHours()).toBe(15);
  });

  it('话里没有时间且 dueInHours 非法 ⇒ 如实失败', () => {
    const path = tmp();
    const r = addFollowup({ what: '记得问问他那件事', dueInHours: 0, now: Date.now(), path });
    expect(r.ok).toBe(false);
  });
});