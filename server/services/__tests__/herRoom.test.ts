import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HER_ROOM_ACTIVITIES,
  advanceHerRoom,
  activityById,
  herRoomEnabled,
  herRoomPromptLine,
  herRoomView,
  loadHerRoom,
  pickActivity,
  saveHerRoom,
} from '../herRoom.js';

describe('开关与白名单（小屋只在她"一个人室内"活动）', () => {
  it('默认关，显式 true 才开', () => {
    expect(herRoomEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(herRoomEnabled({ ENABLE_HER_ROOM: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('白名单里没有外部生活（工作/同事/运动/聚会/出差）', () => {
    const all = HER_ROOM_ACTIVITIES.map(a => a.label).join('|');
    for (const bad of ['工作', '同事', '打球', '聚会', '出差', '公司', '朋友']) {
      expect(all.includes(bad), bad).toBe(false);
    }
    expect(HER_ROOM_ACTIVITIES.length).toBeGreaterThanOrEqual(8);
  });

  it('每个活动都有持续时长与情绪底色（否则无法调度）', () => {
    for (const a of HER_ROOM_ACTIVITIES) {
      expect(a.minutes).toBeGreaterThan(0);
      expect(a.moods.length).toBeGreaterThan(0);
      expect(a.label.length).toBeGreaterThan(4);
    }
  });
});

describe('调度（确定性、可复现、不重复）', () => {
  it('同一输入两次挑选结果一致', () => {
    const a = pickActivity({ now: 1_700_000_000_000, round: 7, topEmotion: 'sad' });
    const b = pickActivity({ now: 1_700_000_000_000, round: 7, topEmotion: 'sad' });
    expect(a.id).toBe(b.id);
  });

  it('不会挑到"当前正在做的那一个"', () => {
    const cur = HER_ROOM_ACTIVITIES[0];
    const next = pickActivity({ now: 1_700_000_000_000, round: 3, topEmotion: 'calm', currentId: cur.id });
    expect(next.id).not.toBe(cur.id);
  });

  it('未到时长 ⇒ 保持；到期 ⇒ 换一个（并进历史）', () => {
    const t0 = 1_700_000_000_000;
    const first = advanceHerRoom(null, { now: t0, round: 1, topEmotion: 'calm' });
    expect(first.turns).toBe(1);
    const stay = advanceHerRoom(first, { now: t0 + 60_000, round: 2, topEmotion: 'calm' });
    expect(stay.activityId).toBe(first.activityId);
    expect(stay.turns).toBe(2);
    const moved = advanceHerRoom(stay, { now: t0 + 120 * 60_000, round: 3, topEmotion: 'calm' });
    expect(moved.activityId).not.toBe(stay.activityId);
    expect(moved.history.length).toBe(1);
    expect(moved.history[0].id).toBe(stay.activityId);
  });

  it('低谷期更黏（同样的时长，低谷时保持、非低谷时换）', () => {
    const t0 = 1_700_000_000_000;
    const base = advanceHerRoom(null, { now: t0, round: 1, topEmotion: 'sad' });
    const act = activityById(base.activityId);
    const elapsed = act.minutes + 5;                          // 刚好超过普通时长
    const lowKeep = advanceHerRoom(base, { now: t0 + elapsed * 60_000, round: 2, topEmotion: 'sad', lowActive: true });
    const normalMove = advanceHerRoom(base, { now: t0 + elapsed * 60_000, round: 2, topEmotion: 'sad', lowActive: false });
    expect(lowKeep.activityId).toBe(base.activityId);
    expect(normalMove.activityId).not.toBe(base.activityId);
  });
});

describe('Prompt 行与只读投影', () => {
  it('Prompt 行：给出活动，并明令小屋之外不许编', () => {
    const room = advanceHerRoom(null, { now: 1_700_000_000_000, round: 1, topEmotion: 'calm' });
    const line = herRoomPromptLine(room);
    expect(line).toContain('我自己的小屋');
    expect(line).toContain(room.label);
    expect(line).toContain('不要');
    expect(line).toContain('工作');
  });

  it('没有小屋状态 ⇒ 不注入（空串）', () => {
    expect(herRoomPromptLine(null)).toBe('');
  });

  it('只读投影：活动/分钟/历史都在', () => {
    const t0 = 1_700_000_000_000;
    const room = advanceHerRoom(null, { now: t0, round: 1, topEmotion: 'calm' });
    const view = herRoomView(room, t0 + 5 * 60_000);
    expect(view.active).toBe(true);
    expect(view.activity?.label).toBe(room.label);
    expect(view.minutes).toBe(5);
    expect(view.turns).toBe(1);
  });
});

describe('持久化', () => {
  it('保存/读回往返；坏文件 ⇒ null 而不是抛错', () => {
    const dir = mkdtempSync(join(tmpdir(), 'room-'));
    const path = join(dir, 'her_room.json');
    const room = advanceHerRoom(null, { now: 1_700_000_000_000, round: 2, topEmotion: 'joy' });
    expect(saveHerRoom(room, path)).toBe(true);
    const back = loadHerRoom(path);
    expect(back?.activityId).toBe(room.activityId);
    expect(loadHerRoom(join(dir, 'missing.json'))).toBeNull();
  });
});
