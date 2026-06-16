// ── conflictManager 状态机单元测试 ──
// 覆盖：5 阶段状态转移 / 信号检测 / 修复评估 / 信任损伤
// 优先级：🔴 高 — 冲突逻辑影响对话安全

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictManager } from '../conflictManager';
import type { EmotionEvent, UserEmotionAnalysis } from '../emotionEngine';

// ── 测试辅助：构造 EmotionEvent ──
function makeEmotionEvent(overrides: Partial<EmotionEvent> = {}): EmotionEvent {
  return {
    deltaA: 0, deltaB: 0, deltaR: 0,
    GC: 0,
    agency: 0,
    intent: 'user',
    ...overrides,
  };
}

function makeUserAnalysis(overrides: Partial<UserEmotionAnalysis> = {}): UserEmotionAnalysis {
  return {
    intensity: 0,
    expressedEmotion: 'neutral',
    directedAtAI: false,
    likelyCause: 'unknown',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. 信号检测
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 信号检测', () => {
  let cm: ConflictManager;

  beforeEach(() => {
    cm = new ConflictManager();
  });

  it('应检测到冲突关键词', () => {
    const signals = cm.detectSignals('你根本不知道我在说什么', null, null);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].type).toBe('keyword');
  });

  it('应检测到归因于 AI 的负面情绪', () => {
    const event = makeEmotionEvent({ agency: -0.5 });
    const signals = cm.detectSignals('嗯', event, null);
    expect(signals.some(s => s.type === 'agency_blame')).toBe(true);
  });

  it('应检测到目标不一致 (GC < -0.5)', () => {
    const event = makeEmotionEvent({ GC: -0.7 });
    const signals = cm.detectSignals('好的', event, null);
    expect(signals.some(s => s.type === 'goal_mismatch')).toBe(true);
  });

  it('应检测到用户负面指向 AI', () => {
    const ua = makeUserAnalysis({ directedAtAI: true, intensity: 0.7, expressedEmotion: 'anger' });
    const signals = cm.detectSignals('我不喜欢你这样', null, ua);
    expect(signals.some(s => s.type === 'user_negative_directed')).toBe(true);
  });

  it('正常对话不应产生信号', () => {
    const event = makeEmotionEvent({ GC: 0.3, agency: 0.2 });
    const signals = cm.detectSignals('今天天气真好', event, null);
    expect(signals.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 状态机转换路径
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 状态机转换', () => {
  let cm: ConflictManager;

  beforeEach(() => {
    cm = new ConflictManager();
  });

  it('normal → warning：累积 3 个警告信号', () => {
    const event = makeEmotionEvent({ agency: -0.4 });
    // 第 1 轮：1 个 agency_blame 信号
    cm.update(cm.detectSignals('嗯', event, null), '嗯');
    expect(cm.getState().phase).toBe('normal');

    // 第 2 轮：再加 1 个（warningCount = 2）
    cm.update(cm.detectSignals('嗯', event, null), '嗯');
    expect(cm.getState().phase).toBe('normal');

    // 第 3 轮：加关键词信号（warningCount ≥ 3，触发 warning）
    cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    expect(cm.getState().phase).toBe('warning');
  });

  it('warning → normal：检测到恢复信号', () => {
    // 先进入 warning（3 个匹配关键词的信号）
    cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    cm.update(cm.detectSignals('你又来了', null, null), '你又来了');
    cm.update(cm.detectSignals('随便吧', null, null), '随便吧');
    expect(cm.getState().phase).toBe('warning');

    // 用户发送恢复信号
    cm.update([], '原谅你了，没事');
    expect(cm.getState().phase).toBe('normal');
  });

  it('warning → conflict：再累积 2 个信号达到 5', () => {
    // 5 个信号 → conflict
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    expect(cm.getState().phase).toBe('conflict');
  });

  it('conflict → repairing → recovering → normal（完整修复周期）', () => {
    // 进入 conflict
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('随便吧', null, null), '随便吧');
    }
    expect(cm.getState().phase).toBe('conflict');

    // 执行修复
    cm.executeRepair('full_cycle');
    expect(cm.getState().phase).toBe('repairing');

    // 评估修复有效 → recovering
    cm.evaluateRepair(0.3);
    expect(cm.getState().phase).toBe('recovering');

    // 用户发送恢复信号 → normal
    cm.update([], '好吧，没事了');
    expect(cm.getState().phase).toBe('normal');
  });

  it('repairing 中修复无效应回到 conflict', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('别说了', null, null), '别说了');
    }
    cm.executeRepair('apologize');
    expect(cm.getState().phase).toBe('repairing');

    // 修复后用户继续表达负面 — 使用匹配关键词的文本
    cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    expect(cm.getState().phase).toBe('conflict');
  });

  it('recovering 中再次出现冲突信号应回到 conflict', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('走开', null, null), '走开');
    }
    cm.executeRepair('full_cycle');
    cm.evaluateRepair(0.4);
    expect(cm.getState().phase).toBe('recovering');

    // recovering 中需 ≥2 个信号同时出现才触发退回 conflict
    // 单次 update 携带关键词 + 归因信号 = 2 signals
    const event = makeEmotionEvent({ agency: -0.5 });
    cm.update(cm.detectSignals('你又来了', event, null), '你又来了');
    expect(cm.getState().phase).toBe('conflict');
  });
});

// ════════════════════════════════════════════════════════════
// 3. 修复协议
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 修复协议', () => {
  let cm: ConflictManager;

  beforeEach(() => {
    cm = new ConflictManager();
  });

  it('首次修复建议应为 full_cycle', () => {
    expect(cm.suggestRepairStrategy()).toBe('full_cycle');
  });

  it('apologize 之后应建议 clarify', () => {
    cm.executeRepair('apologize');
    expect(cm.suggestRepairStrategy()).toBe('clarify');
  });

  it('needsRepair 在 conflict 且无修复操作时应为 true', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('别说了', null, null), '别说了');
    }
    expect(cm.needsRepair()).toBe(true);
  });

  it('executeRepair 后 needsRepair 应为 false', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('走开', null, null), '走开');
    }
    cm.executeRepair('full_cycle');
    expect(cm.needsRepair()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 4. 信任损伤
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 信任损伤', () => {
  let cm: ConflictManager;

  beforeEach(() => {
    cm = new ConflictManager();
  });

  it('每次进入 conflict 应累积 0.15 信任损伤', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('随便', null, null), '随便');
    }
    expect(cm.getState().trustDamageAccumulated).toBeCloseTo(0.15, 1);
  });

  it('成功修复后 restoreTrust 应减少损伤', () => {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('走开', null, null), '走开');
    }
    cm.restoreTrust(0.05);
    expect(cm.getState().trustDamageAccumulated).toBeCloseTo(0.10, 1);
  });

  it('信任损伤不应超过 1.0', () => {
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 5; j++) {
        cm.update(cm.detectSignals('走开', null, null), '走开');
      }
      // 每次 conflict 后 reset 或保持 phase 不变
      // 多次累积后 reach 1.0 cap
    }
    // 即使多次冲突，信任损伤被封顶在 1.0
    expect(cm.getState().trustDamageAccumulated).toBeLessThanOrEqual(1.0);
  });
});

// ════════════════════════════════════════════════════════════
// 5. 边界条件
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 边界条件', () => {
  it('空文本不应产生关键词信号', () => {
    const cm = new ConflictManager();
    const signals = cm.detectSignals('', null, null);
    expect(signals.every(s => s.type !== 'keyword')).toBe(true);
  });

  it('reset 后状态应归零', () => {
    const cm = new ConflictManager();
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('走开', null, null), '走开');
    }
    expect(cm.getState().phase).toBe('conflict');
    cm.reset();
    expect(cm.getState().phase).toBe('normal');
    expect(cm.getState().warningCount).toBe(0);
    expect(cm.getState().totalConflicts).toBe(0);
  });

  it('isInConflict 在 warning 和 conflict 阶段应返回 true', () => {
    const cm = new ConflictManager();
    expect(cm.isInConflict()).toBe(false);

    // 进入 warning
    cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    cm.update(cm.detectSignals('随便吧', null, null), '随便吧');
    cm.update(cm.detectSignals('烦死了', null, null), '烦死了');
    expect(cm.isInConflict()).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// 6. 滥用检测与边界保护（boundary_defending）
// ════════════════════════════════════════════════════════════

describe('ConflictManager — 滥用检测与边界保护', () => {
  let cm: ConflictManager;

  beforeEach(() => {
    cm = new ConflictManager();
  });

  function triggerConflict(): void {
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    // 如果不是 boundary_defending，执行修复 → 评估有效 → 恢复到 normal（为下一次冲突做准备）
    if (cm.getState().phase === 'conflict') {
      cm.executeRepair('full_cycle');
      cm.evaluateRepair(0.3);
      cm.update([], '原谅你了，没事');
    }
  }

  it('单次冲突不应触发边界保护', () => {
    triggerConflict();
    expect(cm.getState().phase).toBe('normal');
    expect(cm.getState().abuseDetected).toBe(false);
  });

  it('15 分钟内 3 次冲突应触发 boundary_defending', () => {
    triggerConflict(); // conflict #1
    triggerConflict(); // conflict #2
    triggerConflict(); // conflict #3 — 应在 transitionTo 中被拦截

    // 第 3 次冲突应触发 abuse detection → boundary_defending
    // 重新进入 conflict 循环
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    // 第 3 次进入 conflict 前，detectAbuse 应拦截
    // 注意：前2次 triggerConflict 已经恢复了，但 recentConflictTimestamps 保留
    // 第3次在 15 分钟内触发 conflict → boundary_defending
    expect(cm.getState().phase).toBe('boundary_defending');
    expect(cm.getState().abuseDetected).toBe(true);
  });

  it('boundary_defending 中收到恢复信号应回到 normal', () => {
    // 先进入 boundary_defending
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) {
        cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
      }
      if (cm.getState().phase === 'conflict') {
        cm.executeRepair('full_cycle');
        cm.evaluateRepair(0.3);
        cm.update([], '原谅你了，没事');
      }
    }
    // 第 3 轮 final conflict → boundary_defending
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    expect(cm.getState().phase).toBe('boundary_defending');

    // 用户表达恢复意愿
    cm.update([], '好吧，我也有不对的地方');
    expect(cm.getState().phase).toBe('normal');
    expect(cm.getState().abuseDetected).toBe(false);
  });

  it('boundary_defending 中持续攻击应保持边界状态，不进入 conflict', () => {
    // 进入 boundary_defending（同前）
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) {
        cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
      }
      if (cm.getState().phase === 'conflict') {
        cm.executeRepair('full_cycle');
        cm.evaluateRepair(0.3);
        cm.update([], '原谅你了，没事');
      }
    }
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    expect(cm.getState().phase).toBe('boundary_defending');

    // 用户继续攻击 — 应保持在 boundary_defending，不进入 conflict
    cm.update(cm.detectSignals('你根本不懂我', null, null), '你根本不懂我');
    cm.update(cm.detectSignals('随便吧', null, null), '随便吧');
    expect(cm.getState().phase).toBe('boundary_defending');
    // 不应升级为 conflict — 边界保护在起作用
    expect(cm.getState().phase).not.toBe('conflict');
  });

  it('reset 后滥用检测状态应清零', () => {
    // 进入 boundary_defending
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) {
        cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
      }
      if (cm.getState().phase === 'conflict') {
        cm.executeRepair('full_cycle');
        cm.evaluateRepair(0.3);
        cm.update([], '原谅你了，没事');
      }
    }
    for (let i = 0; i < 5; i++) {
      cm.update(cm.detectSignals('你总是这样', null, null), '你总是这样');
    }
    expect(cm.getState().phase).toBe('boundary_defending');

    cm.reset();
    expect(cm.getState().phase).toBe('normal');
    expect(cm.getState().abuseDetected).toBe(false);
    expect(cm.getState().recentConflictTimestamps).toEqual([]);
    expect(cm.getState().boundarySetAt).toBeNull();
  });
});
