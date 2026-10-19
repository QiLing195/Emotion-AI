import { describe, it, expect } from 'vitest';
import {
  deriveLowPeriodCause,
  extractAnchoredTopic,
  causePhraseIsGrounded,
  type LowPeriodCause,
} from '../lowPeriodCause.js';
import { buildSelfStateVoiceSnippet, SELF_STATE_VOICE_SNIPPET } from '../selfStateVoice.js';

describe('deriveLowPeriodCause（只能从真实信号派生）', () => {
  it('动机池里有"她心里挂着的事"（open_loop/worry/memory_echo）⇒ carrying_his_matter，取最高 salience', () => {
    const c = deriveLowPeriodCause({
      motivePool: [
        { kind: 'stance', salience: 0.9 },        // 不是"挂着的事"，不参与
        { kind: 'open_loop', salience: 0.6 },
        { kind: 'worry', salience: 0.8 },
      ],
    });
    expect(c.kind).toBe('carrying_his_matter');
    expect(c.evidence).toBe('motive_pool:worry');
  });

  it('没有挂着的动机，但反刍链 ≥3 轮 ⇒ rumination', () => {
    const c = deriveLowPeriodCause({ rumination: { emotion: 'sad', streak: 3 } });
    expect(c.kind).toBe('rumination');
    expect(c.evidence).toBe('rumination:sad/3');
  });

  it('反刍不足 3 轮 ⇒ unknown（不硬给原因）', () => {
    const c = deriveLowPeriodCause({ rumination: { emotion: 'sad', streak: 2 } });
    expect(c.kind).toBe('unknown');
    expect(c.phrase).toBe('说不上来为什么');
  });

  it('什么都没有 ⇒ unknown', () => {
    expect(deriveLowPeriodCause({}).kind).toBe('unknown');
    expect(deriveLowPeriodCause().kind).toBe('unknown');
  });

  it('优先级：挂着的动机 > 反刍', () => {
    const c = deriveLowPeriodCause({
      motivePool: [{ kind: 'memory_echo', salience: 0.3 }],
      rumination: { emotion: 'sad', streak: 9 },
    });
    expect(c.kind).toBe('carrying_his_matter');
  });
});

describe('原因具体化：话题词只从锚点取（他原话里的「…」）', () => {
  it('open_loop 内容带锚点 ⇒ 原因句点名话题（不猜、不改写）', () => {
    const c = deriveLowPeriodCause({
      motivePool: [{ kind: 'open_loop', salience: 0.8, content: '他刚说要去「体检」，我想知道具体是什么情况、他心里怎么想' }],
    });
    expect(c.kind).toBe('carrying_his_matter');
    expect(c.topic).toBe('体检');
    expect(c.phrase).toContain('体检');
    expect(c.phrase).toContain('你说的');   // 归属给他的原话，不是她的生活
  });

  it('没有锚点 ⇒ 退回泛化表述（不硬编话题）', () => {
    const c = deriveLowPeriodCause({
      motivePool: [{ kind: 'worry', salience: 0.7, content: '我有点担心他' }],
    });
    expect(c.kind).toBe('carrying_his_matter');
    expect(c.topic).toBeUndefined();
    expect(c.phrase).toContain('还没落定');
  });

  it('锚点里若是禁用的外部生活名词 ⇒ 不采用（保守回落泛化）', () => {
    expect(extractAnchoredTopic('他刚说要去「公司加班」')).toBeNull();
    expect(extractAnchoredTopic('他刚说要去「体检」')).toBe('体检');
    expect(extractAnchoredTopic('没有引号的内容')).toBeNull();
  });

  it('具体化后的原因句仍通过 grounded 检查', () => {
    const c = deriveLowPeriodCause({
      motivePool: [{ kind: 'open_loop', salience: 0.8, content: '他刚说要去「面试」，我想知道结果' }],
    });
    expect(causePhraseIsGrounded(c.phrase)).toBe(true);
  });
});

describe('原因句必须不夹带她并不拥有的外部生活（防编造）', () => {
  it('所有档位的 phrase 都通过 grounded 检查', () => {
    const cases: Array<Parameters<typeof deriveLowPeriodCause>[0]> = [
      { motivePool: [{ kind: 'open_loop', salience: 0.5 }] },
      { rumination: { emotion: 'sad', streak: 3 } },
      {},
    ];
    for (const input of cases) {
      const c = deriveLowPeriodCause(input);
      expect(causePhraseIsGrounded(c.phrase), `${c.kind}: ${c.phrase}`).toBe(true);
    }
  });

  it('护栏本身有效：含"工作/同事/朋友/天气"的句子应被判不 grounded', () => {
    expect(causePhraseIsGrounded('因为工作上的事')).toBe(false);
    expect(causePhraseIsGrounded('朋友今天没回我')).toBe(false);
    expect(causePhraseIsGrounded('天气太差了')).toBe(false);
    expect(causePhraseIsGrounded('心里一直挂着一件还没落定的事')).toBe(true);
  });
});

describe('片段构建（有原因 / 无原因）', () => {
  it('无原因时与静态常量逐字相同，并要求诚实说"说不上来"', () => {
    expect(buildSelfStateVoiceSnippet()).toBe(SELF_STATE_VOICE_SNIPPET);
    expect(SELF_STATE_VOICE_SNIPPET).toContain('说不上来为什么');
    expect(SELF_STATE_VOICE_SNIPPET).toContain('不要为了给原因而编');
  });

  it('有原因时把该原因写进片段，并要求"只能用这一条"', () => {
    const cause: LowPeriodCause = {
      kind: 'carrying_his_matter',
      phrase: '心里一直挂着一件还没落定的事',
      evidence: 'motive_pool:open_loop',
    };
    const s = buildSelfStateVoiceSnippet(cause);
    expect(s).toContain(cause.phrase);
    expect(s).toContain('只能用它，不要自己编');
    expect(s).not.toContain('说不上来为什么');
  });

  it('unknown 原因仍走"说不上来"分支（不把 unknown 当原因）', () => {
    const s = buildSelfStateVoiceSnippet({ kind: 'unknown', phrase: '说不上来为什么', evidence: '' });
    expect(s).toContain('说不上来为什么');
  });
});
