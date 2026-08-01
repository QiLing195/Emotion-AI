import { describe, expect, it } from 'vitest';
import { createRelationshipStateV2 } from '../../../src/lib/relationshipProgressionV2.js';
import {
  filterRelationshipMemoryItems,
  getRelationshipResponsePolicy,
  processSuccessfulRelationshipTurn,
  relationshipScoreV2,
} from '../relationshipRuntime.js';

const neutralAnalysis = {
  expressedEmotion: 'neutral',
  likelyCause: '日常交流',
  intensity: 0.1,
  directedAtAI: false,
};

describe('relationshipRuntime', () => {
  it('keeps ordinary conversation in the stranger stage', () => {
    let state = createRelationshipStateV2(1_700_000_000_000);
    for (let index = 0; index < 10; index++) {
      state = processSuccessfulRelationshipTurn(state, {
        userText: '你好，最近怎么样？',
        aiText: '我很好，谢谢你。',
        userAnalysis: neutralAnalysis,
        strategy: 'neutral',
        now: 1_700_000_000_000 + index * 60_000,
      }).state;
    }

    expect(state.stage).toBe('stranger');
    expect(relationshipScoreV2(state)).toBe(20);
  });

  it('does not let one confession skip stages', () => {
    const state = createRelationshipStateV2(1_700_000_000_000);
    const result = processSuccessfulRelationshipTurn(state, {
      userText: '我认真地喜欢你，想和你在一起。',
      aiText: '我也喜欢你，愿意和你在一起。',
      userAnalysis: { ...neutralAnalysis, expressedEmotion: 'love', intensity: 0.9, directedAtAI: true },
      strategy: 'desire',
      now: 1_700_000_100_000,
    });

    expect(result.state.stage).toBe('stranger');
    expect(result.events.some(event => event.actor === 'user'
      && ['explicit_confession', 'relationship_proposal'].includes(event.category))).toBe(true);
    expect(result.events.some(event => event.actor === 'ai' && event.category === 'explicit_acceptance')).toBe(false);
  });

  it('treats separate turns within 30 minutes as one session', () => {
    const first = processSuccessfulRelationshipTurn(createRelationshipStateV2(), {
      userText: '你好',
      aiText: '你好',
      userAnalysis: neutralAnalysis,
      strategy: 'neutral',
      now: 1_700_000_000_000,
    });
    const second = processSuccessfulRelationshipTurn(first.state, {
      userText: '又见面了',
      aiText: '很高兴继续聊',
      userAnalysis: neutralAnalysis,
      strategy: 'neutral',
      now: 1_700_000_600_000,
    });

    expect(new Set(second.state.evidence.map(event => event.sessionId)).size).toBe(1);
    expect(second.report.effectiveEventCount).toBe(2);
  });

  it('blocks old personal memories while the relationship is new', () => {
    const state = createRelationshipStateV2();
    const items = [
      { source: 'episodic', content: '当他说“有点困了，想抱着你睡”的时候' },
      { source: 'semantic', content: '用户喜欢计算机' },
      { source: 'pattern', content: '亲密话题' },
    ];

    expect(filterRelationshipMemoryItems(items, state, '非常好')).toEqual([]);
    expect(getRelationshipResponsePolicy(state).allowProactiveMemory).toBe(false);
    expect(getRelationshipResponsePolicy(state).prompt).toContain('不要声称“你之前说过”');
  });

  it('allows only relevant non-intimate memories at the friend stage', () => {
    const state = createRelationshipStateV2();
    state.stage = 'friend';
    const items = [
      { source: 'episodic', content: '你之前说过喜欢学习计算机技术' },
      { source: 'episodic', content: '你之前说想抱着我一起睡' },
      { source: 'semantic', content: '你喜欢旅行' },
    ];

    expect(filterRelationshipMemoryItems(items, state, '最近在学习计算机')).toEqual([items[0]]);
  });

  it('does not reward AI memory claims at the stranger stage', () => {
    const result = processSuccessfulRelationshipTurn(createRelationshipStateV2(), {
      userText: '非常好',
      aiText: '我记得你之前说过一件事。',
      userAnalysis: neutralAnalysis,
      strategy: 'neutral',
      now: 1_700_000_000_000,
    });

    expect(result.events.some(event => event.category === 'remembered_detail')).toBe(false);
  });
});
