import { describe, it, expect } from 'vitest';
import {
  deriveLowPeriodCause,
  deriveSinkCause,
  quoteFromUserText,
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

describe('沉因现场记录（deriveSinkCause / quoteFromUserText）', () => {
  it('他这句话是负向 ⇒ 引文来自他的话，原因句带引号且可接地', () => {
    const text = '我今天被领导当众骂了一顿，特别难受。';
    const c = deriveSinkCause({ userText: text, hisEmotion: 'sad' });
    expect(c).not.toBeNull();
    expect(c!.kind).toBe('his_word');
    expect(c!.topic).toBeTruthy();
    expect(text.includes(c!.topic!)).toBe(true);          // 引文必须真的出自他的话
    expect(c!.phrase).toContain(c!.topic!);
    expect(causePhraseIsGrounded(c!.phrase, 'his_word', text)).toBe(true);
  });

  it('他不是负向情绪 ⇒ 不记（她的沉不能赖到好消息上）', () => {
    expect(deriveSinkCause({ userText: '我升职了', hisEmotion: 'joy' })).toBeNull();
    expect(deriveSinkCause({ userText: '在吗', hisEmotion: 'neutral' })).toBeNull();
  });

  it('没有可用原话 ⇒ 不记（不编引文）', () => {
    expect(deriveSinkCause({ userText: '', hisEmotion: 'sad' })).toBeNull();
    expect(deriveSinkCause(null)).toBeNull();
  });

  it('引文截取取第一小句且 ≤12 字', () => {
    const q = quoteFromUserText('我今天被领导当众骂了一顿，特别难受。');
    expect(q).toBe('我今天被领导当众骂了一顿');
    expect(Array.from(q!).length).toBeLessThanOrEqual(12);
  });

  it('his_word 的接地校验：引文不在他的话里 ⇒ 判为不 grounded', () => {
    const c = deriveSinkCause({ userText: '我今天特别难受', hisEmotion: 'sad' })!;
    expect(causePhraseIsGrounded(c.phrase, 'his_word', '我今天特别难受')).toBe(true);
    expect(causePhraseIsGrounded(c.phrase, 'his_word', '完全不同的一句话')).toBe(false);
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

  it('his_word（现场记录的原因）⇒ 强制要求用上，并给一句话内的位置示范', () => {
    const cause: LowPeriodCause = {
      kind: 'his_word',
      phrase: '因为你说「我今天被领导当众骂了一顿」，我听着也跟着沉下去了',
      evidence: 'sink:his_word:sad',
      topic: '我今天被领导当众骂了一顿',
    };
    const s = buildSelfStateVoiceSnippet(cause);
    expect(s).toContain('这一轮必须用上这条原因');
    expect(s).toContain('我今天被领导当众骂了一顿');
    expect(s).toContain('同一两句话内');
    expect(s).not.toContain('说不上来为什么');
  });

  it('unknown 原因仍走"说不上来"分支（不把 unknown 当原因）', () => {
    const s = buildSelfStateVoiceSnippet({ kind: 'unknown', phrase: '说不上来为什么', evidence: '' });
    expect(s).toContain('说不上来为什么');
  });
});
