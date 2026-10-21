import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  timelineEnabled,
  buildStateChangeNode,
  appendTimelineNode,
  readRecentNodes,
  TIMELINE_MAX_BYTES,
  type EmotionTimelineNode,
} from '../emotionTimeline.js';
import type { EmotionState } from '../../../src/lib/emotionTypes.js';
import { INITIAL_EMOTION_STATE } from '../../../src/lib/emotionTypes.js';

function freshState(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function stateWithSad(delta = 0.2): EmotionState {
  const s = freshState();
  // 直接抬 sad，制造"被激起"的负向偏离（不走 NLU）
  s.emotions.sad = Math.min(1, s.emotions.sad + delta);
  return s;
}

describe('开关（默认关，关着不碰磁盘）', () => {
  it('默认关；只有显式 true 才开', () => {
    expect(timelineEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(timelineEnabled({ ENABLE_EMOTION_TIMELINE: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(timelineEnabled({ ENABLE_EMOTION_TIMELINE: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('节点构建（事实层：数字直接取状态、引文只取他的话）', () => {
  it('负向他的话 ⇒ trigger=his_word_negative，引文来自他的原话', () => {
    const before = freshState();
    const after = stateWithSad(0.3);
    const node = buildStateChangeNode({
      ts: 1700000000000,
      round: 7,
      turnId: 'u-7',
      userText: '我今天被领导当众骂了一顿，特别难受。',
      hisEmotion: 'sad',
      hisIntensity: 0.8,
      before,
      after,
      relationshipAxes: { trust: 0.61, familiarity: 3.2 },
    });
    expect(node.kind).toBe('state_change');
    expect(node.trigger.source).toBe('his_word_negative');
    expect(node.trigger.quoted).toBe('我今天被领导当众骂了一顿');
    expect(node.trigger.hisEmotion).toBe('sad');
    expect(node.trigger.hisIntensity).toBe(0.8);
    expect(node.relationship?.trust).toBeCloseTo(0.61, 4);
    // before/after 是真实读数，不是占位
    expect(node.after.top.some(([k]) => k === 'sad')).toBe(true);
    expect(node.delta.valence).toBeCloseTo(node.after.valence - node.before.valence, 4);
  });

  it('正向他的话 ⇒ 不取引文（避免把好消息截成"原因"）', () => {
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'x', userText: '我升职了！', hisEmotion: 'joy',
      before: freshState(), after: freshState(),
    });
    expect(node.trigger.source).toBe('his_word_positive');
    expect(node.trigger.quoted).toBeNull();
  });

  it('缺少状态时给零帧而不是崩（观测层必须永不抛）', () => {
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'x', userText: '', hisEmotion: null, before: null, after: undefined,
    });
    expect(node.before.valence).toBe(0);
    expect(node.after.top).toEqual([]);
    expect(node.trigger.source).toBe('unknown');
  });

  it('低谷字段来自 lowPeriod 读数（turns/selfRecovery/phase）', () => {
    const after = stateWithSad(0.25);
    after.lowPeriod = {
      since: 1000, lastEvaluatedAt: 2000, peakDepth: 0.2, lastDepth: 0.15,
      lastDelta: -0.01, turns: 4, selfRecovery: 0.06,
    };
    const node = buildStateChangeNode({
      ts: 2, round: 2, turnId: 'x', userText: '', hisEmotion: null,
      before: freshState(), after,
    });
    expect(node.after.low.active).toBe(true);
    expect(node.after.low.turns).toBe(4);
    expect(node.after.low.selfRecovery).toBeCloseTo(0.06, 4);
  });
});

describe('写入 / 滚动 / 读回', () => {
  it('追加一个节点后能读回，字段完整', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'u-1', userText: '我很难受', hisEmotion: 'sad',
      before: freshState(), after: stateWithSad(0.2),
    });
    expect(appendTimelineNode(node, path)).toBe(true);
    const back = readRecentNodes(1, path);
    expect(back).toHaveLength(1);
    expect(back[0].turnId).toBe('u-1');
    expect(back[0].trigger.source).toBe('his_word_negative');
  });

  it('超过上限会滚动，且读回只读当前文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-rot-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    // 直接塞一个大文件触发滚动
    writeFileSync(path, 'x'.repeat(TIMELINE_MAX_BYTES + 10), 'utf8');
    const node = buildStateChangeNode({
      ts: 3, round: 3, turnId: 'u-3', userText: '', hisEmotion: null,
      before: null, after: null,
    });
    expect(appendTimelineNode(node, path)).toBe(true);
    const rotated = readFileSync(path, 'utf8');
    expect(rotated.split('\n').filter(Boolean)).toHaveLength(1);   // 新文件只有新节点
    const nodes = readRecentNodes(5, path);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].turnId).toBe('u-3');
  });

  it('读回按时间顺序，且 k 生效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-k-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    for (let i = 0; i < 5; i++) {
      appendTimelineNode(buildStateChangeNode({
        ts: i, round: i, turnId: `u-${i}`, userText: '', hisEmotion: null, before: null, after: null,
      }) as EmotionTimelineNode, path);
    }
    expect(readRecentNodes(2, path).map(n => n.turnId)).toEqual(['u-3', 'u-4']);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });
});
