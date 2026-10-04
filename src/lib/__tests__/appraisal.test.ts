import { describe, it, expect } from 'vitest';
import {
  appraiseEvent,
  applyAppraisal,
  topicAnchor,
  APPRAISAL_MIN_INTENSITY,
  APPRAISAL_TOPIC_MIN_ANCHOR,
  APPRAISAL_TOTAL_CAP,
} from '../appraisal';
import { INITIAL_EMOTION_STATE } from '../emotionTypes';
import type { EmotionState, Motive } from '../emotionTypes';

function motive(content: string, kind: Motive['kind'] = 'open_loop', salience = 0.8): Motive {
  return {
    id: `m_${content}`,
    kind,
    content,
    source: {},
    salience,
    formedAt: 0,
    expiresAt: Date.now() + 86400_000,
    attempts: 0,
  };
}

describe('appraiseEvent — 用她自己的目标结构评价他这件事', () => {
  it('**核心**：他说的正是她挂着的那件事，且不好 → 她替他悬着（fear + 想靠近）', () => {
    const r = appraiseEvent({
      userText: '面试又挂了，好烦',
      userEmotion: 'sad',
      userIntensity: 0.8,
      concerns: [motive('他面试那事有消息了吗')],
    });
    expect(r.readings.map(x => x.kind)).toContain('touches_her_concern');
    expect(r.emotions.fear).toBeGreaterThan(0);   // 替他悬着
    expect(r.emotions.love).toBeGreaterThan(0);   // 想靠近（与"镜像难过"不同）
    expect(r.valence).toBeLessThan(0);
  });

  it('同一句话，她没挂着这件事时**不会凭空生出牵挂反应**（不硬编）', () => {
    const r = appraiseEvent({
      userText: '面试又挂了，好烦',
      userEmotion: 'sad',
      userIntensity: 0.8,
      concerns: [motive('他上次说的那家猫咖叫什么')],   // 与她挂着的无关
    });
    expect(r.readings.map(x => x.kind)).not.toContain('touches_her_concern');
    expect(r.note).not.toContain('挂着的');
    // 完全没有可评价之处时（他也没情绪）→ 明确说"不硬编反应"
    const quiet = appraiseEvent({
      userText: '今天吃了面', userEmotion: 'neutral', userIntensity: 0.2,
      concerns: [motive('他上次说的那家猫咖叫什么')],
    });
    expect(quiet.readings).toHaveLength(0);
    expect(quiet.note).toContain('无关');
  });

  it('她挂着的事有了好消息 → 松一口气（calm + joy）', () => {
    const r = appraiseEvent({
      userText: '面试过了！',
      userEmotion: 'joy',
      userIntensity: 0.9,
      concerns: [motive('他面试那事有消息了吗')],
    });
    const hit = r.readings.find(x => x.kind === 'touches_her_concern')!;
    expect(hit.emotions.calm).toBeGreaterThan(0);
    expect(r.valence).toBeGreaterThan(0);
  });

  it('提起了但那件事还没结果 → 悬着（不说结果最让人挂心）', () => {
    const r = appraiseEvent({
      userText: '今天去面试了',
      userEmotion: 'neutral',
      userIntensity: 0.3,
      concerns: [motive('他面试那事有消息了吗')],
    });
    const hit = r.readings.find(x => x.kind === 'touches_her_concern')!;
    expect(hit).toBeDefined();
    expect(hit.emotions.fear).toBeGreaterThan(0);
    expect(hit.reason).toContain('没说结果');
  });

  it('他情绪太弱 → 不评价（弱信号下"她怎么想"是编的）', () => {
    const r = appraiseEvent({
      userText: '还行吧',
      userEmotion: 'sad',
      userIntensity: APPRAISAL_MIN_INTENSITY - 0.05,
      concerns: [],
    });
    expect(r.readings.filter(x => x.kind === 'for_him')).toHaveLength(0);
  });

  it('心疼与镜像**不是同一件事**：for_him 只给关系性的一半', () => {
    const r = appraiseEvent({ userText: '好累', userEmotion: 'sad', userIntensity: 0.9, concerns: [] });
    const him = r.readings.find(x => x.kind === 'for_him')!;
    expect(him.emotions.love).toBeGreaterThan(him.emotions.sad ?? 0);   // 想靠近 > 跟着难过
    expect(him.reason).toContain('心疼');
  });

  it('他没情绪/中性 → 不产出 for_him', () => {
    const r = appraiseEvent({ userText: '今天吃了面', userEmotion: 'neutral', userIntensity: 0.9, concerns: [] });
    expect(r.readings).toHaveLength(0);
  });

  it('牵挂越紧迫，反应越强（用真实的动机紧迫度，不另造权重）', () => {
    // 用中性情绪，避免 for_him 一起触发后撞上总量上限把差异抹平
    const weak = appraiseEvent({
      userText: '面试又挂了', userEmotion: 'neutral', userIntensity: 0.3,
      concerns: [motive('他面试那事有消息了吗', 'open_loop', 0.3)],
    });
    const strong = appraiseEvent({
      userText: '面试又挂了', userEmotion: 'neutral', userIntensity: 0.3,
      concerns: [motive('他面试那事有消息了吗', 'open_loop', 1.0)],
    });
    expect(strong.emotions.fear).toBeGreaterThan(weak.emotions.fear);
  });

  it('已经了结的牵挂不再触发（satisfiedAt）', () => {
    const done = { ...motive('他面试那事有消息了吗'), satisfiedAt: Date.now() };
    const r = appraiseEvent({
      userText: '面试又挂了', userEmotion: 'sad', userIntensity: 0.8, concerns: [done],
    });
    expect(r.readings.map(x => x.kind)).not.toContain('touches_her_concern');
  });

  it('愿望/好奇不算"牵挂"（只认 open_loop / worry）', () => {
    const r = appraiseEvent({
      userText: '今天去面试了', userEmotion: 'neutral', userIntensity: 0.5,
      concerns: [motive('今天去面试了', 'wish' as Motive['kind'])],
    });
    expect(r.readings.map(x => x.kind)).not.toContain('touches_her_concern');
  });

  it('单轮总影响 ≤ APPRAISAL_TOTAL_CAP（她想得再多也不该盖过他这句话）', () => {
    const r = appraiseEvent({
      userText: '面试又挂了，我很难过',
      userEmotion: 'sad',
      userIntensity: 1,
      concerns: [motive('他面试那事有消息了吗', 'open_loop', 1)],
    });
    const abs = Object.values(r.emotions).reduce((s, v) => s + Math.abs(v), 0)
      + Math.abs(r.valence) + Math.abs(r.arousal);
    expect(abs).toBeLessThanOrEqual(APPRAISAL_TOTAL_CAP + 1e-9);
  });

  it('垃圾输入不抛错', () => {
    for (const bad of [null, undefined, {}, { userText: '' }, { userText: 'x', concerns: null }]) {
      expect(() => appraiseEvent(bad as never)).not.toThrow();
    }
  });
});

describe('applyAppraisal — 施加到状态（纯函数）', () => {
  const base = () => structuredClone(INITIAL_EMOTION_STATE) as EmotionState;

  it('没有评价时原样返回（连对象都不换）', () => {
    const s = base();
    const r = appraiseEvent({ userText: '嗯', userEmotion: 'neutral', userIntensity: 0, concerns: [] });
    expect(applyAppraisal(s, r)).toBe(s);
  });

  it('情绪落在 [0,1]、效价/唤醒不越界，且不修改原对象', () => {
    const s = base();
    const snapshot = structuredClone(s);
    const r = appraiseEvent({
      userText: '面试又挂了', userEmotion: 'sad', userIntensity: 1,
      concerns: [motive('他面试那事有消息了吗', 'open_loop', 1)],
    });
    const next = applyAppraisal(s, r);
    for (const v of Object.values(next.emotions)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(next.taiji.valence).toBeGreaterThanOrEqual(-1);
    expect(next.taiji.valence).toBeLessThanOrEqual(1);
    expect(next.taiji.arousal).toBeGreaterThanOrEqual(0);
    expect(next.taiji.arousal).toBeLessThanOrEqual(1);
    expect(s).toEqual(snapshot);          // 原状态没被改
    expect(next).not.toBe(s);
  });

  it('主题门限用**词面锚点**：够长、不是常见虚词（不用 2-gram 相似，实测它会误命中）', () => {
    expect(APPRAISAL_TOPIC_MIN_ANCHOR).toBe(2);
    // 真命中：共享实词「面试」
    expect(topicAnchor('他面试那事有消息了吗', '面试又挂了，好烦')).toBe('面试');
    expect(topicAnchor('他上次体检结果怎么样', '体检报告出来了')).toBe('体检');
    // 假命中：只共享"今天/昨天/结果"这类虚词 → 必须认不出来
    expect(topicAnchor('他今天面试怎么样', '今天吃了面')).toBeNull();
    expect(topicAnchor('他昨天说的那件事', '昨天看的那部电影不错')).toBeNull();
    expect(topicAnchor('他面试结果出来了吗', '今天结果还不错')).toBeNull();
    // 太短 / 空
    expect(topicAnchor('面试', '面')).toBeNull();
    expect(topicAnchor('', '面试')).toBeNull();
  });
});
