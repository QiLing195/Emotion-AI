import { describe, it, expect } from 'vitest';
import {
  PET_SPRITES,
  PET_SPRITE_KEYS,
  PET_SPRITE_PATH,
  fallbackChain,
  spriteLabel,
} from '../petSprites.js';

describe('桌宠状态清单（v1.85：单图状态 + 回落链）', () => {
  it('15 个状态，key 不重复', () => {
    expect(PET_SPRITE_KEYS).toHaveLength(15);
    expect(new Set(PET_SPRITE_KEYS).size).toBe(15);
  });

  it('路径约定 anya_<state>.png', () => {
    expect(PET_SPRITE_PATH('idle')).toBe('/pet/anya_idle.png');
    expect(PET_SPRITE_PATH('coffee')).toBe('/pet/anya_coffee.png');
  });

  it('每个状态都有中文名（占位图与界面用）', () => {
    for (const key of PET_SPRITE_KEYS) {
      expect(spriteLabel(key).length).toBeGreaterThan(1);
    }
    expect(spriteLabel('reading')).toContain('读书');
    expect(spriteLabel('coffee')).toContain('咖啡');
  });

  it('回落链：生活动作退到坐姿，再退待机', () => {
    expect(fallbackChain('coffee')).toEqual(['coffee', 'sit', 'idle']);
    expect(fallbackChain('reading')).toEqual(['reading', 'sit', 'idle']);
    expect(fallbackChain('idle')).toEqual(['idle']);
  });

  it('回落链最多 3 层且一定包含 idle（缺图不是死路）', () => {
    for (const key of PET_SPRITE_KEYS) {
      const chain = fallbackChain(key);
      expect(chain.length).toBeLessThanOrEqual(3);
      expect(chain).toContain('idle');
    }
  });

  it('每个状态的 fallback 本身是合法状态（防止手写配置打错字）', () => {
    const keys = new Set(PET_SPRITE_KEYS);
    for (const def of PET_SPRITES) {
      expect(keys.has(def.fallback)).toBe(true);
    }
  });
});
