// ── proactiveMessenger 单元测试（v1.12 动机驱动主动消息）──
// 边界：主动消息是"打扰"，标准必须比 in-chat 动机更高。
// 必须锁死：①正在聊天时绝不插话 ②心里没事时不打扰 ③persona 阈值越高越矜持
//           ④万能问候一律拦下 ⑤配额/时间窗由 rhythmController 负责，本层只看结果

import { describe, it, expect } from 'vitest';
import {
  evaluateProactiveGates,
  requiredMotiveSalience,
  passesMotiveThreshold,
  buildProactivePrompt,
  sanitizeProactiveMessage,
  describeProactiveDecision,
  PROACTIVE_MIN_IDLE_MINUTES,
  PROACTIVE_MAX_CHARS,
} from '../proactiveMessenger';
import type { Motive } from '../../../src/lib/emotionTypes';

function motive(overrides: Partial<Motive> = {}): Motive {
  return {
    id: 'm1',
    kind: 'open_loop',
    content: '他之前提到「面试」，还没说后来怎么样了——我想知道结果',
    source: {},
    salience: 0.8,
    formedAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    attempts: 0,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. 门槛
// ════════════════════════════════════════════════════════════

describe('requiredMotiveSalience — persona 阈值越高越矜持', () => {
  it('30 → 0.30（比较主动）；90 → 0.65（很矜持）', () => {
    expect(requiredMotiveSalience(30)).toBeCloseTo(0.30, 5);
    expect(requiredMotiveSalience(90)).toBeCloseTo(0.65, 5);
  });

  it('中间值单调递增', () => {
    expect(requiredMotiveSalience(60)).toBeGreaterThan(requiredMotiveSalience(45));
  });

  it('越界输入被夹住', () => {
    expect(requiredMotiveSalience(0)).toBeCloseTo(0.30, 5);
    expect(requiredMotiveSalience(999)).toBeCloseTo(0.65, 5);
    expect(requiredMotiveSalience(undefined)).toBeCloseTo(requiredMotiveSalience(65), 5);
  });
});

describe('evaluateProactiveGates — 打扰前的所有非动机条件', () => {
  const base = { idleMinutes: 600, quotaAllowed: true, relationshipStage: 'friend', enabled: true };

  it('全部满足 → 放行', () => {
    expect(evaluateProactiveGates(base).allowed).toBe(true);
  });

  it('正在聊天（空闲不足）→ 不打扰', () => {
    const r = evaluateProactiveGates({ ...base, idleMinutes: PROACTIVE_MIN_IDLE_MINUTES - 1 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('距上次互动仅');
  });

  it('用户关闭主动消息 → 不打扰', () => {
    expect(evaluateProactiveGates({ ...base, enabled: false }).reason).toContain('关闭');
  });

  it('陌生人阶段 → 不打扰（唐突）', () => {
    expect(evaluateProactiveGates({ ...base, relationshipStage: 'stranger' }).reason).toContain('陌生人');
  });

  it('配额/时间窗未放行 → 透传原因', () => {
    const r = evaluateProactiveGates({ ...base, quotaAllowed: false, quotaReason: '已达今日主动消息上限 (2条)' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('上限');
  });
});

describe('passesMotiveThreshold — 心里没事就不打扰', () => {
  it('没有动机 → 不主动', () => {
    const r = passesMotiveThreshold(null, 65);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('心里没有挂着的事');
  });

  it('紧迫度低于门槛 → 不主动，并说明差距', () => {
    const r = passesMotiveThreshold(motive({ salience: 0.4 }), 90);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不够想你');
  });

  it('紧迫度达到门槛 → 可以主动', () => {
    expect(passesMotiveThreshold(motive({ salience: 0.8 }), 65).ok).toBe(true);
  });

  it('同一个动机在低阈值下可以发、高阈值下不发（矜持度生效）', () => {
    const m = motive({ salience: 0.5 });
    expect(passesMotiveThreshold(m, 30).ok).toBe(true);   // 门槛 0.30
    expect(passesMotiveThreshold(m, 90).ok).toBe(false);  // 门槛 0.65
  });
});

// ════════════════════════════════════════════════════════════
// 2. Prompt 与清洗
// ════════════════════════════════════════════════════════════

describe('buildProactivePrompt', () => {
  it('带上"心里挂着的事"并要求短、禁万能问候、不得编造', () => {
    const prompt = buildProactivePrompt({
      motive: motive(),
      moodDescription: '心情有点低落',
      minutesSinceLast: 300,
      relationshipStageLabel: 'friend',
      recentUserTexts: ['面试的事我还是没底'],
    });
    expect(prompt).toContain('面试');
    expect(prompt).toContain('心情有点低落');
    expect(prompt).toContain('约 5 小时');
    expect(prompt).toContain('禁止万能问候');
    expect(prompt).toContain('不要编造');
    expect(prompt).toContain('面试的事我还是没底');
  });

  it('缺少可选信息时不出现 undefined', () => {
    const prompt = buildProactivePrompt({ motive: motive() });
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('只输出消息正文');
  });
});

describe('sanitizeProactiveMessage — 拦下不能发的消息', () => {
  it('正常短消息通过', () => {
    expect(sanitizeProactiveMessage('刚看到楼下那只猫又来了，想起你上次说喜欢。'))
      .toBe('刚看到楼下那只猫又来了，想起你上次说喜欢。');
  });

  it('万能问候一律拦下', () => {
    expect(sanitizeProactiveMessage('今天过得怎么样？')).toBeNull();
    expect(sanitizeProactiveMessage('在干嘛呢')).toBeNull();
    expect(sanitizeProactiveMessage('最近怎么样')).toBeNull();
    expect(sanitizeProactiveMessage('忙不忙')).toBeNull();
  });

  it('剥掉引号与前缀', () => {
    expect(sanitizeProactiveMessage('消息：\"面试的事我还记着呢\"')).toBe('面试的事我还记着呢');
  });

  it('只有动作描写 → 不算消息', () => {
    expect(sanitizeProactiveMessage('（停顿）')).toBeNull();
  });

  it('空/非字符串安全', () => {
    expect(sanitizeProactiveMessage('')).toBeNull();
    expect(sanitizeProactiveMessage(null)).toBeNull();
    expect(sanitizeProactiveMessage(undefined)).toBeNull();
  });

  it('过长会被截断到上限的两倍以内', () => {
    const long = '我想起你上次说的那件事。'.repeat(20);
    const out = sanitizeProactiveMessage(long)!;
    expect(out.length).toBeLessThanOrEqual(PROACTIVE_MAX_CHARS * 2);
  });
});

describe('describeProactiveDecision — 日志可读', () => {
  it('分别说明闸门/动机哪一关没过', () => {
    expect(describeProactiveDecision({
      gates: { allowed: false, reason: '距上次互动仅 10 分钟（需 ≥120）' },
      motive: { ok: true, reason: 'x' },
    })).toContain('距上次互动');
    expect(describeProactiveDecision({
      gates: { allowed: true, reason: 'ok' },
      motive: { ok: false, reason: '心里没有挂着的事 → 不主动打扰' },
    })).toContain('不主动打扰');
    expect(describeProactiveDecision({
      gates: { allowed: true, reason: 'ok' },
      motive: { ok: true, reason: '动机「open_loop」够格主动' },
    })).toContain('主动：');
  });
});
