// ── autonomyConfig 纯函数测试 ──

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTONOMY_CONFIG,
  isQuietHour,
  isPostQuietCooldown,
  getCurrentThreshold,
  getLonelinessRate,
  detectClosure,
  getDayKey,
} from '../autonomyConfig';

const cfg = { ...DEFAULT_AUTONOMY_CONFIG };
const af = (h: number) => 1.0; // 全时段可用

// helper: 创建指定时间戳
function ts(hour: number, minute = 0): number {
  const d = new Date('2026-06-25T00:00:00');
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

describe('isQuietHour', () => {
  it('静默时段内返回 true', () => {
    expect(isQuietHour(ts(23, 30), cfg)).toBe(true);
    expect(isQuietHour(ts(0, 0), cfg)).toBe(true);
    expect(isQuietHour(ts(7, 59), cfg)).toBe(true);
  });

  it('非静默时段返回 false', () => {
    expect(isQuietHour(ts(8, 0), cfg)).toBe(false);
    expect(isQuietHour(ts(14, 0), cfg)).toBe(false);
    expect(isQuietHour(ts(22, 59), cfg)).toBe(false);
  });
});

describe('isPostQuietCooldown', () => {
  it('冷却窗口内返回 true', () => {
    expect(isPostQuietCooldown(ts(8, 30), cfg)).toBe(true);
  });

  it('冷却窗口外返回 false', () => {
    expect(isPostQuietCooldown(ts(9, 30), cfg)).toBe(false);
    expect(isPostQuietCooldown(ts(14, 0), cfg)).toBe(false);
  });
});

describe('getCurrentThreshold', () => {
  it('无忽略时为基础阈值', () => {
    expect(getCurrentThreshold(0, cfg)).toBe(cfg.contactBaseThreshold);
  });

  it('忽略连击增加阈值', () => {
    const t0 = getCurrentThreshold(0, cfg);
    const t3 = getCurrentThreshold(3, cfg);
    expect(t3).toBeGreaterThan(t0);
  });

  it('不超过上限', () => {
    expect(getCurrentThreshold(100, cfg)).toBeLessThanOrEqual(cfg.contactMaxThreshold);
  });

  it('自定义配置生效', () => {
    const c = { ...cfg, contactBaseThreshold: 0.5, contactIgnorePenalty: 0.1 };
    expect(getCurrentThreshold(2, c)).toBe(0.7);
  });
});

describe('getLonelinessRate', () => {
  it('短空闲时速率最低', () => {
    const r10 = getLonelinessRate(10, ts(14, 0), cfg, af, 0);
    const r60 = getLonelinessRate(60, ts(14, 0), cfg, af, 0);
    const r200 = getLonelinessRate(200, ts(14, 0), cfg, af, 0);
    expect(r10).toBeLessThan(r60);
    expect(r60).toBeLessThan(r200);
  });

  it('静默时段速率降低', () => {
    const day = getLonelinessRate(60, ts(14, 0), cfg, af, 0);
    const night = getLonelinessRate(60, ts(0, 0), cfg, af, 0);
    expect(night).toBeLessThan(day);
  });

  it('宽限期内速率降低', () => {
    const now = ts(14, 0);
    const inGrace = getLonelinessRate(60, now, cfg, af, now - 30 * 60000); // 30分钟前刚结束
    const normal = getLonelinessRate(60, now, cfg, af, 0);
    expect(inGrace).toBeLessThan(normal);
  });

  it('宽限期外正常速率', () => {
    const now = ts(14, 0);
    const outside = getLonelinessRate(60, now, cfg, af, now - 300 * 60000); // 5小时前
    const normal = getLonelinessRate(60, now, cfg, af, 0);
    expect(outside).toBe(normal);
  });
});

describe('detectClosure', () => {
  it('识别晚安', () => {
    expect(detectClosure('我困了，先睡了')).toBe(true);
    expect(detectClosure('晚安')).toBe(true);
  });

  it('识别忙碌', () => {
    expect(detectClosure('我先去开会了')).toBe(true);
    expect(detectClosure('要忙一下，回头聊')).toBe(true);
  });

  it('非结束语返回 false', () => {
    expect(detectClosure('今天天气真好')).toBe(false);
    expect(detectClosure('')).toBe(false);
  });

  it('识别拜拜', () => {
    expect(detectClosure('拜拜，明天见')).toBe(true);
    expect(detectClosure('bye!')).toBe(true);
  });
});

describe('getDayKey', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    const key = getDayKey(ts(14, 30));
    expect(key).toBe('2026-06-25');
  });
});
