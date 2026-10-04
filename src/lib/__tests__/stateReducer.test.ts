// ── stateReducer 测试 ──
// 验证 applyEvent 的确定性、事件契约
// 注：replayState / validateEventApplication 已删除（回放无法复现真实状态 ——
//     权威管道有 7 路直接改状态、不发事件；详见 stateReducer.ts 末尾说明）

import { describe, it, expect } from 'vitest';
import { applyEvent, buildEmotionUpdatedPayload } from '../stateReducer';
import { INITIAL_EMOTION_STATE, getDominantEmotion } from '../emotionEngine';
import { DEFAULT_DRIFT_CONFIG } from '../personalityEvolution';
import type { EmotionEvent, EmotionState } from '../emotionEngine';
import type { BusEvent } from '../../eventBus';

// ════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════

function makeEmotionUpdatedEvent(stimulus: EmotionEvent, state: EmotionState): BusEvent {
  return {
    id: 'test_evt_1',
    type: 'EmotionUpdated',
    level: 'cognitive',
    source: 'emotion',
    timestamp: Date.now(),
    data: buildEmotionUpdatedPayload({
      stimulus,
      context: {
        baseA: 0.5,
        baseB: 0.5,
        baseR: 0.5,
        emotionalStability: 0.5,
        empathy: 50,
        optimism: 50,
      },
    }),
    sessionId: 'test_session',
  };
}

function makePositiveEvent(): EmotionEvent {
  return {
    deltaA: 0.3,
    deltaB: -0.1,
    deltaR: 0,
    GC: 0.5,
    intent: 'user',
  };
}

function makeNegativeEvent(): EmotionEvent {
  return {
    deltaA: -0.2,
    deltaB: 0.3,
    deltaR: 0,
    GC: -0.4,
    intent: 'user',
  };
}

// ════════════════════════════════════════════════════════════
// 测试
// ════════════════════════════════════════════════════════════

describe('applyEvent', () => {
  describe('EmotionUpdated', () => {
    it('正向事件应该提升效价', () => {
      const state = structuredClone(INITIAL_EMOTION_STATE);
      const event = makeEmotionUpdatedEvent(makePositiveEvent(), state);

      const newState = applyEvent(state, event);

      // 正向事件 → 效价上升、joy/love 强度上升
      expect(newState.taiji.valence).toBeGreaterThan(state.taiji.valence);
      const dominant = getDominantEmotion(newState.emotions);
      expect(['joy', 'love', 'calm']).toContain(dominant.name);
    });

    it('负向事件应该降低效价', () => {
      const state = structuredClone(INITIAL_EMOTION_STATE);
      const event = makeEmotionUpdatedEvent(makeNegativeEvent(), state);

      const newState = applyEvent(state, event);

      // 负向事件 → 效价下降
      expect(newState.taiji.valence).toBeLessThan(state.taiji.valence);
    });

    it('不应该修改原状态（纯函数）', () => {
      const state = structuredClone(INITIAL_EMOTION_STATE);
      const originalValence = state.taiji.valence;
      const originalArousal = state.taiji.arousal;

      const event = makeEmotionUpdatedEvent(makePositiveEvent(), state);
      applyEvent(state, event);

      // 原状态不变
      expect(state.taiji.valence).toBe(originalValence);
      expect(state.taiji.arousal).toBe(originalArousal);
    });

    it('相同输入产生相同输出（确定性）', () => {
      const state1 = structuredClone(INITIAL_EMOTION_STATE);
      const state2 = structuredClone(INITIAL_EMOTION_STATE);

      const event1 = makeEmotionUpdatedEvent(makePositiveEvent(), state1);
      const event2 = makeEmotionUpdatedEvent({
        ...makePositiveEvent(), // 同样的 stimulus
      }, state2);

      const result1 = applyEvent(state1, event1);
      const result2 = applyEvent(state2, event2);

      // 结果应该一致（注意：内部有微量噪声，允许小误差）
      expect(Math.abs(result1.taiji.valence - result2.taiji.valence)).toBeLessThan(0.05);
      expect(Math.abs(result1.taiji.arousal - result2.taiji.arousal)).toBeLessThan(0.05);
      expect(getDominantEmotion(result1.emotions).name)
        .toBe(getDominantEmotion(result2.emotions).name);
    });
  });

  describe('StrategyFeedback', () => {
    it('奖励信号应该增加 rewardTally', () => {
      const state = structuredClone(INITIAL_EMOTION_STATE);
      const initialTally = state.reinforcement.rewardTally;

      const newState = applyEvent(state, {
        id: 'test_reward',
        type: 'StrategyFeedback',
        level: 'cognitive',
        source: 'strategy',
        timestamp: Date.now(),
        data: { type: 'reward', source: 'attention', value: 0.5 },
      });

      expect(newState.reinforcement.rewardTally).toBeGreaterThan(initialTally);
    });

    it('惩罚信号应该增加 punishmentTally', () => {
      const state = structuredClone(INITIAL_EMOTION_STATE);
      const initialTally = state.reinforcement.punishmentTally;

      const newState = applyEvent(state, {
        id: 'test_punish',
        type: 'StrategyFeedback',
        level: 'cognitive',
        source: 'strategy',
        timestamp: Date.now(),
        data: { type: 'punishment', source: 'conflict', value: 0.3 },
      });

      expect(newState.reinforcement.punishmentTally).toBeGreaterThan(initialTally);
    });
  });

  describe('观测事件（不应改变状态）', () => {
    const observationEvents: Array<{ type: string; data: any }> = [
      { type: 'UserMessageReceived', data: { text: '你好' } },
      { type: 'ExplorationStarted', data: { query: 'test' } },
      { type: 'ExplorationCompleted', data: { topicsSearched: 3 } },
      { type: 'DiscoveryStored', data: { title: '发现' } },
      { type: 'InterestDetected', data: { interest: 'AI' } },
      { type: 'StateSaved', data: {} },
      { type: 'StateLoaded', data: {} },
    ];

    for (const obs of observationEvents) {
      it(`${obs.type} 不应该改变状态`, () => {
        const state = structuredClone(INITIAL_EMOTION_STATE);
        const newState = applyEvent(state, {
          id: 'test_obs',
          type: obs.type as any,
          level: 'cognitive',
          source: 'system',
          timestamp: Date.now(),
          data: obs.data,
        });

        // 观测事件应该返回原状态引用或不改变任何值
        expect(newState.taiji.valence).toBe(state.taiji.valence);
        expect(newState.taiji.arousal).toBe(state.taiji.arousal);
        expect(newState.emotions.calm).toBe(state.emotions.calm);
      });
    }
  });
});

describe('buildEmotionUpdatedPayload', () => {
  it('正确组装 stimulus + context + output', () => {
    const stimulus: EmotionEvent = { deltaA: 0.2, deltaB: -0.1, deltaR: 0, intent: 'user' };
    const context = { baseA: 0.5, baseB: 0.5, baseR: 0.5, emotionalStability: 0.5, empathy: 60, optimism: 55 };

    const payload = buildEmotionUpdatedPayload({
      stimulus,
      context,
      dominant: 'joy',
      valence: 0.4,
      arousal: 0.6,
    });

    expect(payload.stimulus).toEqual(stimulus);
    expect(payload.context).toEqual(context);
    expect(payload.dominant).toBe('joy');
    expect(payload.valence).toBe(0.4);
    expect(payload.arousal).toBe(0.6);
  });
});

describe('StateDecayed', () => {
  it('时间衰减使效价和唤醒向中性回归', () => {
    // 从高唤醒/高正效价开始
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.valence = 0.8;
    state.taiji.arousal = 0.9;

    const newState = applyEvent(state, {
      id: 'test_decay',
      type: 'StateDecayed',
      level: 'system',
      source: 'emotion',
      timestamp: Date.now(),
      data: { hoursElapsed: 24 }, // 一天离线
    });

    // 效价向中性回归
    expect(newState.taiji.valence).toBeLessThan(0.8);
    // 唤醒向 0.5 回归
    expect(newState.taiji.arousal).toBeLessThan(0.9);
    expect(newState.taiji.arousal).toBeGreaterThan(0.4);
  });

  it('长时间离线使情绪接近基线', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.emotions.joy = 0.9;
    state.emotions.anger = 0.7;

    const newState = applyEvent(state, {
      id: 'test_long_decay',
      type: 'StateDecayed',
      level: 'system',
      source: 'emotion',
      timestamp: Date.now(),
      data: { hoursElapsed: 168 }, // 一周
    });

    // 几乎所有情绪应该接近 0
    expect(Math.abs(newState.emotions.joy)).toBeLessThan(0.3);
    expect(Math.abs(newState.emotions.anger)).toBeLessThan(0.3);
  });

  it('零小时不改变状态', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);

    const newState = applyEvent(state, {
      id: 'test_no_decay',
      type: 'StateDecayed',
      level: 'system',
      source: 'emotion',
      timestamp: Date.now(),
      data: { hoursElapsed: 0 },
    });

    expect(newState.taiji.valence).toBe(state.taiji.valence);
    expect(newState.taiji.arousal).toBe(state.taiji.arousal);
  });
});

describe('PersonalityDrifted', () => {
  it('用户表达爱意 → 信任上升', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.evolution.trust = 50;
    state.emotions.love = 0.6;

    const newState = applyEvent(state, {
      id: 'test_drift_love',
      type: 'PersonalityDrifted',
      level: 'cognitive',
      source: 'emotion',
      timestamp: Date.now(),
      data: {
        userMessage: '我爱你',
        userSentiment: {
          expressedEmotion: 'love',
          likelyCause: 'user',
          intensity: 0.7,
          directedAtAI: true,
        },
        config: DEFAULT_DRIFT_CONFIG,
      },
    });

    expect(newState.evolution.trust).toBeGreaterThan(50);
  });

  it('用户袒露脆弱 → 开放度上升', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.evolution.trust = 60;
    state.evolution.openness = 50;

    const newState = applyEvent(state, {
      id: 'test_drift_vulnerable',
      type: 'PersonalityDrifted',
      level: 'cognitive',
      source: 'emotion',
      timestamp: Date.now(),
      data: {
        userMessage: '我有个秘密想告诉你，但我害怕你会嫌弃',
        userSentiment: null,
        config: DEFAULT_DRIFT_CONFIG,
      },
    });

    expect(newState.evolution.openness).toBeGreaterThan(50);
  });

  it('无触发漂移条件 → 状态不变', () => {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.evolution.trust = 50;
    state.evolution.openness = 50;
    state.evolution.playfulness = 50;
    state.evolution.empathy = 50;

    const newState = applyEvent(state, {
      id: 'test_drift_neutral',
      type: 'PersonalityDrifted',
      level: 'cognitive',
      source: 'emotion',
      timestamp: Date.now(),
      data: {
        userMessage: '今天天气不错',
        userSentiment: null,
        config: DEFAULT_DRIFT_CONFIG,
      },
    });

    // 没有任何漂移触发 → evolution 参数不变
    expect(newState.evolution.trust).toBe(50);
    expect(newState.evolution.openness).toBe(50);
  });
});
