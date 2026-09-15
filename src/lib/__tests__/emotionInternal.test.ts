// ── emotionInternal 单元测试 (v1.7) ──
// 覆盖：内在事件 → 弱强度情绪变化 / 习惯化 / 单轮总量上限 /
//       情境推导（孤独·重逢·思维·兴趣·发现·洞察）/ 类型映射与文本兜底
// 优先级：🔴 高 — 情绪涌现的"内在源"，同时是防自嗨漂移的第一道闸门

import { describe, it, expect } from 'vitest';
import {
  applyInternalEvents,
  deriveInternalEvents,
  thoughtTypeToInternal,
  classifyThought,
  INTERNAL_EFFECTS,
  INTERNAL_TOTAL_CAP,
  HABITUATION,
  SATIATION_DECAY,
  type InternalEventInput,
  type InternalEventType,
} from '../emotionInternal';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState } from '../emotionTypes';

// ── 测试辅助 ──
function baseState(overrides: Partial<EmotionState> = {}): EmotionState {
  return structuredClone({ ...INITIAL_EMOTION_STATE, ...overrides }) as EmotionState;
}

/** 单次应用的事件集合，便于重复调用做习惯化测试 */
function applyOnce(state: EmotionState, events: InternalEventInput[]): EmotionState {
  return applyInternalEvents(state, events);
}

// ════════════════════════════════════════════════════════════
// 1. applyInternalEvents — 基础行为
// ════════════════════════════════════════════════════════════

describe('applyInternalEvents — 基础行为', () => {
  it('空事件列表应返回原对象（同一引用，零开销）', () => {
    const s = baseState();
    expect(applyInternalEvents(s, [])).toBe(s);
  });

  it('孤独事件应提升 sad / love，降低效价', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'loneliness' }]);
    expect(out.emotions.sad).toBeGreaterThan(s.emotions.sad);
    expect(out.emotions.love).toBeGreaterThan(s.emotions.love);
    expect(out.taiji.valence).toBeLessThan(s.taiji.valence);
  });

  it('重逢事件应提升 joy / love，压低 sad / fear', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'reunion' }]);
    expect(out.emotions.joy).toBeGreaterThan(s.emotions.joy);
    expect(out.emotions.love).toBeGreaterThan(s.emotions.love);
    expect(out.taiji.valence).toBeGreaterThan(s.taiji.valence);
  });

  it('不应修改传入的原始状态（结构化克隆，纯函数）', () => {
    const s = baseState();
    const snapshot = structuredClone(s);
    applyInternalEvents(s, [{ type: 'loneliness' }, { type: 'discovery' }]);
    expect(s.emotions).toEqual(snapshot.emotions);
    expect(s.taiji).toEqual(snapshot.taiji);
    expect(s.internal).toBeUndefined();
  });

  it('intensity=0 时不应产生任何变化', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'loneliness', intensity: 0 }]);
    expect(out.emotions.sad).toBeCloseTo(s.emotions.sad, 10);
    expect(out.taiji.valence).toBeCloseTo(s.taiji.valence, 10);
  });

  it('intensity 越大影响越大（单调）', () => {
    const s = baseState();
    const weak = applyInternalEvents(s, [{ type: 'discovery', intensity: 0.3 }]);
    const strong = applyInternalEvents(s, [{ type: 'discovery', intensity: 1 }]);
    expect(strong.emotions.joy).toBeGreaterThan(weak.emotions.joy);
  });

  it('未知事件类型应被安全跳过', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'not_a_type' as InternalEventType }]);
    expect(out.emotions).toEqual(s.emotions);
  });

  it('缺失的情绪键应被初始化为 0 再叠加', () => {
    const s = baseState();
    delete (s.emotions as Record<string, number>).joy;
    const out = applyInternalEvents(s, [{ type: 'discovery' }]);
    expect(out.emotions.joy).toBeGreaterThan(0);
  });

  it('九情应被夹在 [-1, 1]，唤醒夹在 [0, 1]', () => {
    const s = baseState();
    s.emotions.sad = 0.999;
    s.emotions.joy = -0.999;
    s.taiji.valence = 0.999;
    s.taiji.arousal = 0.999;
    const out = applyInternalEvents(s, [
      { type: 'loneliness' },
      { type: 'reunion' },
      { type: 'discovery' },
    ]);
    for (const v of Object.values(out.emotions)) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(out.taiji.valence).toBeLessThanOrEqual(1);
    expect(out.taiji.valence).toBeGreaterThanOrEqual(-1);
    expect(out.taiji.arousal).toBeLessThanOrEqual(1);
    expect(out.taiji.arousal).toBeGreaterThanOrEqual(0);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 防自嗨漂移三件套：总量上限
// ════════════════════════════════════════════════════════════

describe('applyInternalEvents — 单轮总量上限', () => {
  it('单个事件的绝对影响也不应超过 INTERNAL_TOTAL_CAP', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'loneliness' }]);
    const emotionAbs = Object.entries(INTERNAL_EFFECTS.loneliness.emotions ?? {})
      .reduce((sum, [emo]) => sum + Math.abs(out.emotions[emo] - s.emotions[emo]), 0);
    const valenceAbs = Math.abs(out.taiji.valence - s.taiji.valence);
    expect(emotionAbs + valenceAbs).toBeLessThanOrEqual(INTERNAL_TOTAL_CAP + 1e-9);
  });

  it('一次性灌入全部事件，总影响仍被压在 cap 内', () => {
    const s = baseState();
    const all = Object.keys(INTERNAL_EFFECTS) as InternalEventType[];
    const out = applyInternalEvents(s, all.map(type => ({ type, intensity: 1 })));
    const emotionAbs = Object.values(out.emotions)
      .reduce((sum, v, i) => sum + Math.abs(v - Object.values(s.emotions)[i]), 0);
    const valenceAbs = Math.abs(out.taiji.valence - s.taiji.valence);
    expect(emotionAbs + valenceAbs).toBeLessThanOrEqual(INTERNAL_TOTAL_CAP + 1e-6);
  });

  it('超限时按比例缩放：各情绪仍保持基础影响的方向与相对比例', () => {
    const s = baseState();
    const out = applyInternalEvents(s, [{ type: 'loneliness' }]);
    const base = INTERNAL_EFFECTS.loneliness.emotions!;
    const dSad = out.emotions.sad - s.emotions.sad;
    const dLove = out.emotions.love - s.emotions.love;
    // sad:love 基础比例 0.05:0.04
    expect(dSad / dLove).toBeCloseTo(base.sad / base.love, 5);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 防自嗨漂移三件套：习惯化 + 消退
// ════════════════════════════════════════════════════════════

describe('applyInternalEvents — 习惯化与消退', () => {
  it('首次应用后应在 state.internal.satiation 记录计数', () => {
    const out = applyInternalEvents(baseState(), [{ type: 'loneliness' }]);
    expect(out.internal?.satiation.loneliness).toBeGreaterThan(0);
  });

  it('同一事件重复触发效果递减（习惯化）', () => {
    let s = baseState();
    const deltas: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = s.emotions.sad;
      s = applyOnce(s, [{ type: 'loneliness' }]);
      deltas.push(s.emotions.sad - before);
    }
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeLessThan(deltas[i - 1]);
    }
    expect(deltas[3]).toBeLessThan(deltas[0] * 0.5);
  });

  it('习惯化应趋向一个温和的下界，而非归零（长期独处仍有感受）', () => {
    let s = baseState();
    for (let i = 0; i < 200; i++) s = applyOnce(s, [{ type: 'loneliness' }]);
    // 情绪已饱和到上界，复位后再测"稳态习惯化下的单轮增量"
    s.emotions.sad = 0;
    s.emotions.love = 0;
    s.taiji.valence = 0;
    const before = s.emotions.sad;
    s = applyOnce(s, [{ type: 'loneliness' }]);
    const tail = s.emotions.sad - before;
    expect(tail).toBeGreaterThan(0);
    // 稳态 satiation 收敛值让单轮影响只剩基线的 10%~20%
    expect(tail).toBeLessThan(0.01);
  });

  it('satiation 每轮按 SATIATION_DECAY 消退（不会永久脱敏）', () => {
    const first = applyInternalEvents(baseState(), [{ type: 'loneliness' }]);
    const s1 = first.internal!.satiation.loneliness;
    // 只关心消退系数：计数为 1 时，经过一轮其它事件后 → 1 * DECAY
    const second = applyInternalEvents(first, [{ type: 'discovery' }]);
    expect(second.internal!.satiation.loneliness).toBeCloseTo(s1 * SATIATION_DECAY, 10);
  });

  it('不同事件之间的习惯化互不干扰', () => {
    const s0 = applyInternalEvents(baseState(), [{ type: 'discovery' }]);
    const a = applyInternalEvents(s0, [{ type: 'discovery' }]);
    const b = applyInternalEvents(s0, [{ type: 'reunion' }]);
    const fresh = baseState();
    const deltaA = a.emotions.joy - s0.emotions.joy;
    const deltaFresh = applyInternalEvents(fresh, [{ type: 'discovery' }]).emotions.joy - fresh.emotions.joy;
    expect(deltaA).toBeLessThan(deltaFresh);
    // reunion 的 joy 未被 discovery 的习惯化影响（仍为全强度缩放后的值）
    const deltaB = b.emotions.joy - s0.emotions.joy;
    expect(deltaB).toBeGreaterThan(deltaA);
  });

  it('习惯化增速由 HABITUATION 决定', () => {
    const s = baseState();
    s.internal = { satiation: { loneliness: 1 } };
    const out = applyInternalEvents(s, [{ type: 'loneliness', intensity: 1 }]);
    // k = 1 / (1 + 1 * HABITUATION)
    const k = 1 / (1 + HABITUATION);
    const raw = INTERNAL_EFFECTS.loneliness.emotions!.sad * k;
    const rawAbs = Object.values(INTERNAL_EFFECTS.loneliness.emotions!)
      .reduce((sum, v) => sum + Math.abs(v * k), 0) + Math.abs(INTERNAL_EFFECTS.loneliness.valence! * k);
    const scale = rawAbs > INTERNAL_TOTAL_CAP ? INTERNAL_TOTAL_CAP / rawAbs : 1;
    expect(out.emotions.sad - s.emotions.sad).toBeCloseTo(raw * scale, 10);
  });
});

// ════════════════════════════════════════════════════════════
// 4. thoughtTypeToInternal / classifyThought
// ════════════════════════════════════════════════════════════

describe('thoughtTypeToInternal', () => {
  it('wish / goal 应映射为 thought_wish', () => {
    expect(thoughtTypeToInternal('wish')).toBe('thought_wish');
    expect(thoughtTypeToInternal('goal')).toBe('thought_wish');
  });

  it('fear 应映射为 thought_fear', () => {
    expect(thoughtTypeToInternal('fear')).toBe('thought_fear');
  });

  it('doubt / hypothesis 应映射为 thought_doubt', () => {
    expect(thoughtTypeToInternal('doubt')).toBe('thought_doubt');
    expect(thoughtTypeToInternal('hypothesis')).toBe('thought_doubt');
  });

  it('reflection 等中性类型应返回 null（不驱动情绪）', () => {
    expect(thoughtTypeToInternal('reflection')).toBeNull();
    expect(thoughtTypeToInternal('unknown')).toBeNull();
  });
});

describe('classifyThought', () => {
  it('恐惧类关键词 → thought_fear', () => {
    expect(classifyThought('担心她会离开')).toBe('thought_fear');
    expect(classifyThought('害怕被忘记')).toBe('thought_fear');
  });

  it('疑惑类关键词 → thought_doubt', () => {
    expect(classifyThought('不确定他今天为什么不说话')).toBe('thought_doubt');
    expect(classifyThought('有点困惑')).toBe('thought_doubt');
  });

  it('其余内容默认 → thought_wish（正向靠近）', () => {
    expect(classifyThought('想和他一起去海边')).toBe('thought_wish');
  });
});

// ════════════════════════════════════════════════════════════
// 5. deriveInternalEvents — 情境推导
// ════════════════════════════════════════════════════════════

describe('deriveInternalEvents — 孤独与重逢', () => {
  const types = (ctx: Parameters<typeof deriveInternalEvents>[0]) =>
    deriveInternalEvents(ctx).map(e => e.type);

  it('未知空闲时长 → 无事件', () => {
    expect(types({})).toEqual([]);
  });

  it('空闲 2 小时以内 → 无孤独事件', () => {
    expect(types({ idleMinutes: 120 })).toEqual([]);
  });

  it('空闲 3 小时以上 → 产生孤独事件', () => {
    expect(types({ idleMinutes: 200 })).toContain('loneliness');
  });

  it('孤独强度随空闲时长增长，12h 达到上限', () => {
    const at3h = deriveInternalEvents({ idleMinutes: 190 })[0];
    const at6h = deriveInternalEvents({ idleMinutes: 400 })[0];
    const at12h = deriveInternalEvents({ idleMinutes: 720 })[0];
    const at48h = deriveInternalEvents({ idleMinutes: 2000 });
    expect(at3h.intensity!).toBeLessThan(at6h.intensity!);
    expect(at6h.intensity!).toBeLessThan(at12h.intensity!);
    expect(at12h.intensity).toBeCloseTo(1, 5);
    // 超长空闲转为重逢（不叠加孤独）
    expect(at48h.map(e => e.type)).toEqual(['reunion']);
  });

  it('久别重逢（>24h）只产生 reunion，不叠加 loneliness', () => {
    const out = deriveInternalEvents({ idleMinutes: 1500 });
    expect(out.map(e => e.type)).not.toContain('loneliness');
    expect(out[0].type).toBe('reunion');
  });
});

describe('deriveInternalEvents — 兴趣 / 思维 / 发现 / 洞察', () => {
  it('检测到兴趣 → interest 事件', () => {
    expect(deriveInternalEvents({ interestCount: 2 }).map(e => e.type)).toContain('interest');
  });

  it('无兴趣 → 不产生 interest 事件', () => {
    expect(deriveInternalEvents({ interestCount: 0 }).map(e => e.type)).not.toContain('interest');
  });

  it('显式思维类型优先于文本兜底', () => {
    const out = deriveInternalEvents({
      thoughtTypes: ['thought_fear'],
      newThoughts: ['想和他一起去海边'],
    });
    expect(out.map(e => e.type)).toEqual(['thought_fear']);
  });

  it('无显式类型时按思维内容兜底分类', () => {
    const out = deriveInternalEvents({ newThoughts: ['害怕被忘记', '想一起去海边'] });
    expect(out.map(e => e.type)).toEqual(['thought_fear', 'thought_wish']);
  });

  it('发现与洞察分别产生弱正向事件', () => {
    expect(deriveInternalEvents({ hasDiscovery: true }).map(e => e.type)).toEqual(['discovery']);
    expect(deriveInternalEvents({ hasInsight: true }).map(e => e.type)).toEqual(['insight']);
  });

  it('多种内在源可叠加出现', () => {
    const out = deriveInternalEvents({
      idleMinutes: 300,
      interestCount: 1,
      thoughtTypes: ['thought_wish'],
      hasDiscovery: true,
      hasInsight: true,
    });
    expect(out.map(e => e.type).sort()).toEqual(
      ['discovery', 'insight', 'interest', 'loneliness', 'thought_wish'].sort(),
    );
  });

  it('推导结果可直接喂给 applyInternalEvents 且不越界', () => {
    const s = baseState();
    const events = deriveInternalEvents({
      idleMinutes: 720,
      interestCount: 3,
      thoughtTypes: ['thought_wish', 'thought_fear', 'thought_doubt'],
      hasDiscovery: true,
      hasInsight: true,
    });
    const out = applyInternalEvents(s, events);
    const emotionAbs = Object.keys(out.emotions)
      .reduce((sum, k) => sum + Math.abs(out.emotions[k] - s.emotions[k]), 0);
    expect(emotionAbs + Math.abs(out.taiji.valence - s.taiji.valence))
      .toBeLessThanOrEqual(INTERNAL_TOTAL_CAP + 1e-6);
    expect(out.taiji.arousal).toBeGreaterThanOrEqual(0);
    expect(out.taiji.arousal).toBeLessThanOrEqual(1);
  });
});
