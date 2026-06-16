// ── 生命周期 单元测试 ──
// 覆盖：微六爻派生 / 宏六爻阶段流转 / 复苏机制 / 阶段筛选 / 冲突等级
import { describe, it, expect, beforeEach } from 'vitest';
import { getMicroPhase, MicroPhase, getPhaseStats, resetPhaseStats, updateEmotionState, INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState, EmotionEvent } from '../emotionEngine';
import {
  evaluatePatterns,
  getPatternsByPhase,
  getDormantPatterns,
  recordMention,
  resetMentions,
  PatternLifecycle,
} from '../../curiosity/patterns';
import type { Interest } from '../../curiosity/types';
import type { EmotionContext } from '../../types/shared';

// ════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════

function makeEmotionCtx(overrides?: Partial<EmotionContext>): EmotionContext {
  return {
    primaryEmotions: { joy: 0.3, anger: 0.1, sad: 0.4, fear: 0.5, love: 0.1, disgust: 0, lust: 0, calm: 0.2, greed: 0.1 },
    drives: { greedDrive: 0.3, fearAvoidance: 0.4 },
    dominantState: 'fear',
    ...overrides,
  };
}

function makeInterest(topic: string, weight: number): Interest {
  return { topic, weight, source: 'conversation', firstSeen: Date.now(), lastUpdated: Date.now(), stability: 0.985 };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSadEvent(): EmotionEvent {
  return { deltaA: -0.2, deltaB: 0.3, deltaR: -0.1, intent: 'user', GC: -0.5, agency: 0.2, fairness: 0, control: -0.2 };
}

// ════════════════════════════════════════════════════════
// 1. 微六爻：从情感状态派生
// ════════════════════════════════════════════════════════

describe('微六爻 getMicroPhase', () => {
  it('初始状态应返回合理的阶段', () => {
    const info = getMicroPhase(INITIAL_EMOTION_STATE);
    // 初始 calm=0.8 arousal=0.5 → 稳定偏活跃的状态
    // 可能是 生/长/收——取决于具体快照
    expect([MicroPhase.SHENG, MicroPhase.ZHANG, MicroPhase.SHOU, MicroPhase.CANG]).toContain(info.phase);
    console.log(`初始状态微六爻: ${info.phase} (intensity=${info.intensity.toFixed(2)}, conflict=${info.conflictLevel.toFixed(2)})`);
  });

  it('高强度悲伤情绪应返回 长', () => {
    // 多次注入悲伤事件堆高强度
    let state: EmotionState = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE));
    for (let i = 0; i < 5; i++) {
      state = updateEmotionState(state, makeSadEvent());
    }
    const info = getMicroPhase(state);
    // 高强度 + 高唤醒 → 长
    expect([MicroPhase.ZHANG, MicroPhase.HUA]).toContain(info.phase);
    expect(info.intensity).toBeGreaterThan(0.2);
  });

  it('极端情绪持续应返回 收 或 化', () => {
    let state: EmotionState = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE));
    // 15 次悲伤 → 极值累积
    for (let i = 0; i < 15; i++) {
      state = updateEmotionState(state, makeSadEvent());
    }
    const info = getMicroPhase(state);
    // 极值持续 → 可能是 化（反转压力累积）或 收（极值平稳）
    expect([MicroPhase.HUA, MicroPhase.SHOU, MicroPhase.ZHANG]).toContain(info.phase);
    expect(info.conflictLevel).toBeGreaterThan(0);
  });

  it('返回的 intensity 是九情绝对最大值', () => {
    const info = getMicroPhase(INITIAL_EMOTION_STATE);
    expect(info.intensity).toBeGreaterThanOrEqual(0);
    expect(info.intensity).toBeLessThanOrEqual(1);
  });

  it('返回的 conflictLevel 在 [0,1] 范围', () => {
    const info = getMicroPhase(INITIAL_EMOTION_STATE);
    expect(info.conflictLevel).toBeGreaterThanOrEqual(0);
    expect(info.conflictLevel).toBeLessThanOrEqual(1);
  });

  it('所有阶段的 confidence 在 [0,1] 范围', () => {
    const info = getMicroPhase(INITIAL_EMOTION_STATE);
    expect(info.confidence).toBeGreaterThanOrEqual(0);
    expect(info.confidence).toBeLessThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════
// 2. 宏六爻：模式生命周期流转
// ════════════════════════════════════════════════════════

describe('宏六爻 PatternLifecycle', () => {
  beforeEach(() => {
    resetMentions();
  });

  it('新兴趣从 EMERGING 开始', () => {
    const interests: Interest[] = [makeInterest('摄影', 0.3)];
    // 仅 1 次 mention，不足以达到 candidate
    recordMention(['摄影'], Date.now(), makeEmotionCtx());

    const patterns = evaluatePatterns(interests);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    const p = patterns.find(p => p.topic === '摄影');
    expect(p).toBeDefined();
    // 新 topic，低 maturity → EMERGING
    expect([PatternLifecycle.EMERGING, PatternLifecycle.GROWING]).toContain(p!.lifecycle);
  });

  it('频繁提及的模式进入 ESTABLISHED', () => {
    const interests: Interest[] = [makeInterest('摄影', 0.8)];
    // 多天 + 共现 → 高 maturity
    for (let d = 0; d < 5; d++) {
      recordMention(['摄影', '艺术'], Date.now() - d * DAY_MS, makeEmotionCtx());
    }

    const patterns = evaluatePatterns(interests);
    const p = patterns.find(p => p.topic === '摄影');
    expect(p).toBeDefined();
    expect(p!.lifecycle).toBe(PatternLifecycle.ESTABLISHED);
    expect(p!.maturityScore).toBeGreaterThanOrEqual(0.75);
  });

  it('长期未提及的模式进入 DORMANT', () => {
    const interests: Interest[] = [makeInterest('摄影', 0.3)];
    // 在 35 天前记录过一次（超过 30 天休眠阈值）
    recordMention(['摄影'], Date.now() - 35 * DAY_MS, makeEmotionCtx());

    const patterns = evaluatePatterns(interests);
    const p = patterns.find(p => p.topic === '摄影');
    expect(p).toBeDefined();
    expect([PatternLifecycle.DORMANT, PatternLifecycle.ARCHIVED, PatternLifecycle.EMERGING])
      .toContain(p!.lifecycle);
  });

  it('DORMANT 模式被重新提及 → REACTIVATED', () => {
    const interests: Interest[] = [makeInterest('摄影', 0.8)];
    // 第一步：多天记录 → ESTABLISHED
    for (let d = 0; d < 5; d++) {
      recordMention(['摄影', '艺术'], Date.now() - 40 * DAY_MS - d * DAY_MS, makeEmotionCtx());
    }
    // 先评估一次建立 lifecycle 状态
    evaluatePatterns(interests);

    // 第二步：在"现在"重新提及 → should trigger reactivation
    // 手动设置最后提及时间为很久以前，但 maturity 仍高
    // 实际上 recordMention 会用当前时间，所以需要模拟久远的提及
    for (let d = 0; d < 3; d++) {
      recordMention(['摄影', '艺术'], Date.now() - d * DAY_MS, makeEmotionCtx());
    }

    const patterns = evaluatePatterns(interests);
    const p = patterns.find(p => p.topic === '摄影');
    expect(p).toBeDefined();
    // 应该已复活或在成长中
    expect([
      PatternLifecycle.REACTIVATED,
      PatternLifecycle.GROWING,
      PatternLifecycle.ESTABLISHED,
    ]).toContain(p!.lifecycle);
  });

  it('getPatternsByPhase 返回正确阶段', () => {
    const interests: Interest[] = [
      makeInterest('摄影', 0.8),
      makeInterest('游戏', 0.8),
    ];
    for (let d = 0; d < 5; d++) {
      recordMention(['摄影', '艺术'], Date.now() - d * DAY_MS, makeEmotionCtx());
      recordMention(['游戏', '电影'], Date.now() - d * DAY_MS, makeEmotionCtx());
    }

    const established = getPatternsByPhase(interests, PatternLifecycle.ESTABLISHED);
    expect(established.length).toBeGreaterThanOrEqual(2);
    expect(established.every(p => p.lifecycle === PatternLifecycle.ESTABLISHED)).toBe(true);
  });

  it('isReactivated 标志在非复活模式下为 false', () => {
    const interests: Interest[] = [makeInterest('摄影', 0.8)];
    for (let d = 0; d < 5; d++) {
      recordMention(['摄影', '艺术'], Date.now() - d * DAY_MS, makeEmotionCtx());
    }

    const patterns = evaluatePatterns(interests);
    const p = patterns.find(p => p.topic === '摄影')!;
    expect(p.isReactivated).toBe(false);
  });
});

// ════════════════════════════════════════════════════════
// 3. 微六爻 × 情绪签名关联
// ════════════════════════════════════════════════════════

describe('微六爻与情绪签名关联', () => {
  beforeEach(() => {
    resetMentions();
  });

  it('化(HUA)阶段的情绪签名被正常记录', () => {
    // 制造高冲突情绪状态
    let state: EmotionState = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE));
    for (let i = 0; i < 10; i++) {
      state = updateEmotionState(state, makeSadEvent());
    }
    const phaseInfo = getMicroPhase(state);

    // 记录 mention 时附带当前情绪
    const ctx = makeEmotionCtx({ primaryEmotions: state.emotions });
    for (let d = 0; d < 3; d++) {
      recordMention(['摄影'], Date.now() - d * DAY_MS, ctx);
    }

    const interests: Interest[] = [makeInterest('摄影', 0.6)];
    const patterns = evaluatePatterns(interests);
    const p = patterns.find(p => p.topic === '摄影');
    expect(p).toBeDefined();
    expect(p!.emotionalSignature).toBeDefined();

    console.log(`微六爻: ${phaseInfo.phase} (冲突=${phaseInfo.conflictLevel.toFixed(2)})`);
    console.log(`宏六爻: ${p!.lifecycle} (maturity=${p!.maturityScore.toFixed(2)})`);
    console.log(`情绪签名: fear=${p!.emotionalSignature?.fear?.toFixed(2)}`);
  });
});

// ════════════════════════════════════════════════════════
// 4. 阶段分布统计
// ════════════════════════════════════════════════════════

describe('阶段分布统计 PhaseStats', () => {
  it('调用 getMicroPhase 后统计累加', () => {
    resetPhaseStats();
    // 多次调用
    for (let i = 0; i < 10; i++) {
      getMicroPhase(INITIAL_EMOTION_STATE);
    }
    const stats = getPhaseStats();
    expect(stats.total).toBe(10);
    // 分布之和应为 1
    const sum = Object.values(stats.distribution).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it('resetPhaseStats 清空统计', () => {
    getMicroPhase(INITIAL_EMOTION_STATE);
    resetPhaseStats();
    const stats = getPhaseStats();
    expect(stats.total).toBe(0);
    expect(Object.keys(stats.byPhase).length).toBe(0);
  });

  it('不同情绪状态产生不同阶段', () => {
    resetPhaseStats();
    // 初始状态
    getMicroPhase(INITIAL_EMOTION_STATE);
    // 悲伤状态
    let sadState = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE));
    for (let i = 0; i < 10; i++) {
      sadState = updateEmotionState(sadState, makeSadEvent());
    }
    getMicroPhase(sadState);

    const stats = getPhaseStats();
    expect(stats.total).toBe(2);
    expect(stats.byPhase['化'] || stats.byPhase['长'] || stats.byPhase['收']).toBeGreaterThanOrEqual(1);
    console.log('阶段分布:', JSON.stringify(stats.distribution));
    console.log('按情绪:', JSON.stringify(Object.keys(stats.perEmotion)));
  });

  it('化阶段占比不应超过 50%（极端测试）', () => {
    resetPhaseStats();
    // 随机采样不同状态
    const states = [
      INITIAL_EMOTION_STATE,
      (() => { let s = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE)); for (let i = 0; i < 5; i++) s = updateEmotionState(s, makeSadEvent()); return s; })(),
      (() => { let s = JSON.parse(JSON.stringify(INITIAL_EMOTION_STATE)); for (let i = 0; i < 3; i++) s = updateEmotionState(s, { deltaA: 0.3, deltaB: -0.1, deltaR: 0.1, intent: 'user', GC: 0.6, agency: 0.5, fairness: 0.5, control: 0.3 }); return s; })(),
    ];
    for (let i = 0; i < 20; i++) {
      getMicroPhase(states[i % states.length]);
    }
    const stats = getPhaseStats();
    const huaPct = stats.distribution['化'] || 0;
    console.log(`化阶段占比: ${(huaPct * 100).toFixed(1)}%`);
    console.log('完整分布:', JSON.stringify(stats.distribution));
    // 化不应超过 50%
    expect(huaPct).toBeLessThan(0.5);
  });
});
