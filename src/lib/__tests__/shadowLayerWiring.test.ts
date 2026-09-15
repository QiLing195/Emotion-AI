// ── 潜意识层接线 测试（v1.13）──
// 背景：498 行实现此前基本空转 —— shadowEmotionMod 定义后不消费、
//       detectTraits 的 strategyStats 传 null（策略证据永不产生）、状态不持久化。
// 必须锁死：①调制真的施加到太极 ②限幅（底色级慢变量不许盖过用户当下的话）
//           ③策略统计能产生证据并激活 trait ④状态可序列化/恢复（持久化契约）

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShadowLayer,
  applyShadowEmotionBias,
  SHADOW_MAX_TURN_BIAS,
  type ShadowState,
} from '../shadowLayer';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState } from '../emotionTypes';

const T0 = 1_700_000_000_000;

function state(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

// 清空的 ThoughtGraphState（只提供 detectTraits 需要的最小结构）
function emptyThoughtState(): any {
  return { nodes: [], edges: [], dissonances: [], stats: {} };
}

// ════════════════════════════════════════════════════════════
// 1. 情感出口：调制真的施加，且有硬上限
// ════════════════════════════════════════════════════════════

describe('applyShadowEmotionBias — 潜意识的情感出口', () => {
  it('零偏置时返回原对象（不产生无谓克隆）', () => {
    const s = state();
    const out = applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: 0, arousalBias: 0, alphaVMultiplier: 1,
    });
    expect(out).toBe(s);
  });

  it('正/负偏置按方向调整太极效价与唤醒', () => {
    const s = state();
    const darker = applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: -0.15, arousalBias: 0.1, alphaVMultiplier: 1,
    });
    expect(darker.taiji.valence).toBeLessThan(s.taiji.valence);
    expect(darker.taiji.arousal).toBeGreaterThan(s.taiji.arousal);
  });

  it('单轮影响被限幅到 SHADOW_MAX_TURN_BIAS（不许盖过用户当下的话）', () => {
    const s = state();
    const out = applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: -0.2, arousalBias: 0.2, alphaVMultiplier: 1,
    });
    expect(s.taiji.valence - out.taiji.valence).toBeLessThanOrEqual(SHADOW_MAX_TURN_BIAS + 1e-9);
    expect(out.taiji.arousal - s.taiji.arousal).toBeLessThanOrEqual(SHADOW_MAX_TURN_BIAS + 1e-9);
  });

  it('不修改入参（纯函数）', () => {
    const s = state();
    const before = structuredClone(s.taiji);
    applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: -0.1, arousalBias: 0.1, alphaVMultiplier: 1,
    });
    expect(s.taiji).toEqual(before);
  });

  it('太极夹在合法区间', () => {
    const s = state();
    s.taiji.valence = 0.995;
    s.taiji.arousal = 0.998;
    const out = applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: 0.2, arousalBias: 0.2, alphaVMultiplier: 1,
    });
    expect(out.taiji.valence).toBeLessThanOrEqual(1);
    expect(out.taiji.arousal).toBeLessThanOrEqual(1);
  });

  it('可以自定义上限（供引擎级调用）', () => {
    const s = state();
    const out = applyShadowEmotionBias(s, {
      stickyEmotions: [], valenceBias: -0.2, arousalBias: 0, alphaVMultiplier: 1,
    }, 0.01);
    expect(out.taiji.valence).toBeCloseTo(s.taiji.valence - 0.01, 6);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 检测：策略统计证据（此前传 null，永不产生）
// ════════════════════════════════════════════════════════════

describe('detectTraits — 策略统计证据接线', () => {
  let layer: ShadowLayer;
  beforeEach(() => { layer = new ShadowLayer(); });

  it('无策略统计时不产生 strategy_stat 证据', () => {
    layer.detectTraits(emptyThoughtState(), null, null, 50);
    const anyStrategyEvidence = layer.getState().traits
      .some(t => t.evidence.some(e => e.source === 'strategy_stat'));
    expect(anyStrategyEvidence).toBe(false);
  });

  it('喂入策略统计后会产生 strategy_stat 证据并提升置信度', () => {
    // 反复"讨好/道歉"型策略使用且失败率高 → 期望触发某个 trait 的策略证据
    const strategyStats = {
      empathize: { uses: 30, successes: 2 },
      repair: { uses: 25, successes: 3 },
      boundary: { uses: 20, successes: 18 },
    };
    const before = layer.getState().traits.map(t => t.confidence);
    layer.detectTraits(emptyThoughtState(), null, strategyStats, 60);
    const after = layer.getState();
    const hasStrategyEvidence = after.traits.some(t => t.evidence.some(e => e.source === 'strategy_stat'));
    const raised = after.traits.some((t, i) => t.confidence > before[i]);
    expect(hasStrategyEvidence).toBe(true);
    expect(raised).toBe(true);
  });

  it('反复检测会让置信度持续累积并可能激活 trait', () => {
    const strategyStats = {
      empathize: { uses: 40, successes: 1 },
      repair: { uses: 40, successes: 1 },
    };
    for (let i = 0; i < 40; i++) {
      layer.detectTraits(emptyThoughtState(), null, strategyStats, 50 + i);
    }
    const active = layer.getActiveTraits();
    expect(active.length).toBeGreaterThan(0);
    expect(layer.getState().stats.totalDetections).toBeGreaterThan(0);
  });

  it('记录 lastDetectionRound（供调用方做"≥50 轮"门控）', () => {
    layer.detectTraits(emptyThoughtState(), null, null, 123);
    expect(layer.getState().stats.lastDetectionRound).toBe(123);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 持久化契约：状态可序列化并恢复
// ════════════════════════════════════════════════════════════

describe('潜意识状态持久化契约', () => {
  it('getState 深拷贝（外部改动不影响内部）', () => {
    const layer = new ShadowLayer();
    const snapshot = layer.getState();
    snapshot.traits[0].confidence = 0.99;
    expect(layer.getState().traits[0].confidence).not.toBe(0.99);
  });

  it('loadState 能恢复置信度与证据（重启不清零）', () => {
    const a = new ShadowLayer();
    a.detectTraits(emptyThoughtState(), null, { empathize: { uses: 30, successes: 1 } }, 50);
    const saved: ShadowState = JSON.parse(JSON.stringify(a.getState()));

    const b = new ShadowLayer();
    b.loadState(saved);
    expect(b.getState().traits.map(t => t.confidence))
      .toEqual(saved.traits.map(t => t.confidence));
    expect(b.getState().stats.totalDetections).toBe(saved.stats.totalDetections);
  });

  it('恢复后聚合调制与原来一致（持久化后行为不漂移）', () => {
    const a = new ShadowLayer();
    for (let i = 0; i < 40; i++) {
      a.detectTraits(emptyThoughtState(), null, { empathize: { uses: 40, successes: 1 } }, 50 + i);
    }
    const b = new ShadowLayer();
    b.loadState(JSON.parse(JSON.stringify(a.getState())));
    expect(b.getEmotionModulation()).toEqual(a.getEmotionModulation());
  });

  it('调制参数在契约范围内（[-0.2,0.2] / [0.8,1.2]）', () => {
    const layer = new ShadowLayer();
    for (let i = 0; i < 60; i++) {
      layer.detectTraits(emptyThoughtState(), null, {
        empathize: { uses: 40, successes: 1 },
        boundary: { uses: 40, successes: 38 },
      }, 50 + i);
    }
    const mod = layer.getEmotionModulation();
    expect(Math.abs(mod.valenceBias)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(mod.arousalBias)).toBeLessThanOrEqual(0.2);
    expect(mod.alphaVMultiplier).toBeGreaterThanOrEqual(0.8);
    expect(mod.alphaVMultiplier).toBeLessThanOrEqual(1.2);
  });
});
