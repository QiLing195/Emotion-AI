// ── Laya 决策层单元测试（v1.33）──
// 这个文件锁死的是**纯逻辑**：state 文本怎么拼、问题怎么发、响应怎么解、裁决门怎么过。
// 网络那一层在 `server/services/__tests__/layaClient.test.ts`。
//
// 必须锁死的六条：
//   ① state 里**必须**有他刚说的那句话（规则链看不到它，这是加这层的唯一理由）
//   ② 选项只发**允许的**策略，且描述是**短标签**（长否定句实测把模型带偏到 redirect）
//   ③ 响应解析：拿不到就 null，绝不猜（"允许为空"原则）
//   ④ 置信度优先取**首选标签自己的概率**（不是 checkpoint 的汇总 confidence）
//   ⑤ 守门策略（crisis/boundary/repair）**永远不外包**
//   ⑥ 抑制表是硬边界：模型选了被抑制的策略也必须被挡下

import { describe, it, expect } from 'vitest';
import {
  buildLayaStateText,
  buildLayaQuestions,
  parseLayaResponse,
  applyLayaVerdict,
  LAYA_CHOOSABLE_STRATEGIES,
  LAYA_GUARDRAIL_STRATEGIES,
  LAYA_KEEP_ACCOMPANY_STRATEGIES,
  LAYA_STRATEGY_CRITERIA,
  LAYA_STANCE_QUESTION_ID,
  LAYA_STATE_MAX_CHARS,
  type LayaStrategyVerdict,
} from '../layaDecision';

const LAYAS_ALL = LAYA_CHOOSABLE_STRATEGIES;

// ── 辅助 ──

/** 实测形状（`laya/agent.py::_decode_answers` + 本机 0.3.9 真响应）。 */
function realResponse(choice: string, probs: Record<string, number>, confidence?: number) {
  return {
    model: 'laya-rl-agent',
    answers: {
      [LAYA_STANCE_QUESTION_ID]: {
        type: 'choice',
        choice,
        probabilities: probs,
        confidence: confidence ?? 0,
        action: { act_probability: 0.5 },
      },
    },
    usage: { input_tokens: 220, output_tokens: 0 },
    routing: { model: 'multilingual', repo: 'convaiinnovations/laya/multilingual', reason: "explicit model='multilingual'" },
  };
}

function verdict(over: Partial<LayaStrategyVerdict> = {}): LayaStrategyVerdict {
  return {
    mode: 'on',
    strategy: 'empathize',
    confidence: 0.6,
    distribution: [{ label: 'empathize', p: 0.6 }, { label: 'neutral', p: 0.3 }],
    model: 'multilingual',
    latencyMs: 500,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════
// 1. state 文本
// ════════════════════════════════════════════════════════════

describe('buildLayaStateText — 他说的那句话必须在里面', () => {
  it('带上他的原话（这是加这一层的唯一理由：规则链读不到文本）', () => {
    const t = buildLayaStateText({ userText: '我今天面试又挂了' });
    expect(t).toContain('我今天面试又挂了');
  });

  it('把"他自己平静"和"她本来就沉在里面"分开写 —— 这两件事的处置完全不同', () => {
    const calm = buildLayaStateText({
      userText: '嗯',
      herNegativeBeforeTurn: { emotion: 'sad', intensity: 0 },
    });
    const sinking = buildLayaStateText({
      userText: '嗯',
      herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.18 },
    });
    expect(calm).toContain('这一轮开始前她自己是平静的');
    expect(sinking).toContain('sad +0.18');
    expect(sinking).not.toContain('这一轮开始前她自己是平静的');
  });

  it('超长的话会被截断（不给 state 挤爆 1024 上下文的余地）', () => {
    const t = buildLayaStateText({ userText: '啊'.repeat(500) });
    expect(t.length).toBeLessThanOrEqual(LAYA_STATE_MAX_CHARS);
    expect(t).toContain('…');
  });

  it('总长度有硬上限', () => {
    const t = buildLayaStateText({
      userText: '我很累'.repeat(80),
      herActivationNote: '难过 +0.5 与 爱意 +0.4 并存；平静被压低 −0.3',
      recentUserMessages: ['第一句'.repeat(40), '第二句'.repeat(40)],
      consecutiveNegativeRounds: 5,
      idleMinutes: 600,
      timeSlot: 'night',
    });
    expect(t.length).toBeLessThanOrEqual(LAYA_STATE_MAX_CHARS);
  });

  it('不编造没给的字段（没传效价就不写效价）', () => {
    const t = buildLayaStateText({ userText: '在吗' });
    expect(t).not.toContain('效价');
    expect(t).not.toContain('他此刻的情绪');
  });

  it('只取最后 2 条历史（state 是有限预算）', () => {
    const t = buildLayaStateText({
      userText: '现在',
      recentUserMessages: ['一', '二', '三', '四'],
    });
    expect(t).toContain('他之前说过');
    expect(t).not.toContain('「一」');
    expect(t).not.toContain('「二」');
    expect(t).toContain('「三」');
    expect(t).toContain('「四」');
  });
});

// ════════════════════════════════════════════════════════════
// 2. 问题定义
// ════════════════════════════════════════════════════════════

describe('buildLayaQuestions — 只发允许的选项，描述必须短', () => {
  it('默认发全部可裁决策略，且不含守门策略', () => {
    const q = buildLayaQuestions()[LAYA_STANCE_QUESTION_ID];
    expect(Object.keys(q.criteria)).toEqual([...LAYA_CHOOSABLE_STRATEGIES]);
    for (const g of LAYA_GUARDRAIL_STRATEGIES) {
      expect(q.criteria[g]).toBeUndefined();
    }
  });

  it('只发传进来的那一档（抑制掉的策略不该浪费一次前向）', () => {
    const q = buildLayaQuestions(['empathize', 'accompany'])[LAYA_STANCE_QUESTION_ID];
    expect(Object.keys(q.criteria)).toEqual(['empathize', 'accompany']);
  });

  it('选项描述是**短标签**（实测长否定句把模型带偏到 redirect，见 criteria 注释里的表）', () => {
    for (const desc of Object.values(LAYA_STRATEGY_CRITERIA)) {
      expect(desc.length).toBeLessThanOrEqual(12);
      expect(desc).not.toMatch(/不再|不急着|不要/);
    }
  });

  it('英文档是另一套描述（诊断用：把"读不懂中文"和"不会做这件事"分开）', () => {
    const zh = buildLayaQuestions(LAYAS_ALL, 'zh')[LAYA_STANCE_QUESTION_ID];
    const en = buildLayaQuestions(LAYAS_ALL, 'en')[LAYA_STANCE_QUESTION_ID];
    expect(zh.criteria.empathize).not.toBe(en.criteria.empathize);
    expect(Object.keys(zh.criteria)).toEqual(Object.keys(en.criteria));
  });
});

// ════════════════════════════════════════════════════════════
// 3. 响应解析（"允许为空"）
// ════════════════════════════════════════════════════════════

describe('parseLayaResponse — 解不出来就 null，绝不猜', () => {
  it('真实响应形状能解出标签与分布', () => {
    const v = parseLayaResponse(
      realResponse('empathize', { empathize: 0.5841, accompany: 0.2216, neutral: 0.0528 }, 0.4188),
      { mode: 'on', latencyMs: 640 },
    );
    expect(v).not.toBeNull();
    expect(v!.strategy).toBe('empathize');
    expect(v!.model).toBe('multilingual');
    expect(v!.latencyMs).toBe(640);
    // 分布按概率降序，方便直接看"第二名是谁"
    expect(v!.distribution.map((d) => d.label)).toEqual(['empathize', 'accompany', 'neutral']);
  });

  it('置信度取**首选标签自己的概率**，不是 checkpoint 的 confidence 汇总值', () => {
    // 实测 `confidence` 是归一化熵（`confidence_from_probs`），候选多时会明显低于首选概率。
    // 门限判的是"这个标签有多可信"，所以必须用首选自己的概率。
    const v = parseLayaResponse(
      realResponse('empathize', { empathize: 0.5841, accompany: 0.2216 }, 0.4188),
      { mode: 'on' },
    );
    expect(v!.confidence).toBeCloseTo(0.5841, 4);
  });

  it('首选标签不在 probabilities 里 → 退回 confidence 字段（不谎报 0 以外的数）', () => {
    const v = parseLayaResponse(
      realResponse('empathize', { accompany: 0.9 }, 0.77),
      { mode: 'on' },
    );
    expect(v!.confidence).toBeCloseTo(0.77, 4);
  });

  it('标签大小写/空格都能归一（模型不一定照抄 key）', () => {
    for (const raw of ['Empathize', ' empathize ', 'EMPATHIZE', 'empathize\n', 'emPaThize']) {
      const got = parseLayaResponse(realResponse(raw, { empathize: 0.9 }), { mode: 'on' });
      expect(got?.strategy).toBe('empathize');
    }
  });

  it('不是策略名的标签一律 null（哪怕它看起来像个 checkpoint 名）', () => {
    expect(parseLayaResponse(realResponse('typed-decisions', { x: 0.9 }), { mode: 'on' })).toBeNull();
  });

  it('模型回的是**描述文本**而不是 key：只认唯一命中', () => {
    const v = parseLayaResponse(
      realResponse('先接住他的情绪', { empathize: 0.9 }),
      { mode: 'on' },
    );
    expect(v!.strategy).toBe('empathize');
  });

  it('彻底不认识 → null（回退规则，而不是瞎选一个）', () => {
    expect(parseLayaResponse(realResponse('完全没见过的标签', { x: 1 }), { mode: 'on' })).toBeNull();
  });

  it('结构不对 → null（不是抛异常：一个可选的第二意见没资格弄坏主链路）', () => {
    expect(parseLayaResponse(null, { mode: 'on' })).toBeNull();
    expect(parseLayaResponse('nope', { mode: 'on' })).toBeNull();
    expect(parseLayaResponse({}, { mode: 'on' })).toBeNull();
    expect(parseLayaResponse({ answers: {} }, { mode: 'on' })).toBeNull();
    expect(parseLayaResponse({ answers: { stance: null } }, { mode: 'on' })).toBeNull();
    expect(parseLayaResponse({ answers: { stance: { type: 'choice' } } }, { mode: 'on' })).toBeNull();
  });

  it('没有 probabilities 也能解出标签（只是分布为空、置信度 0）', () => {
    const v = parseLayaResponse(
      { answers: { stance: { type: 'choice', choice: 'accompany' } } },
      { mode: 'on' },
    );
    expect(v!.strategy).toBe('accompany');
    expect(v!.distribution).toEqual([]);
    expect(v!.confidence).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════
// 4. 裁决门
// ════════════════════════════════════════════════════════════

describe('applyLayaVerdict — 规则是默认值，模型要改判得逐条过关', () => {
  const base = {
    ruleStrategy: 'neutral' as const,
    ruleConfidence: 0.5,
    allowed: [...LAYAS_ALL],
    minConfidence: 0.5,
  };

  it('没有意见 → 用规则，记 no_verdict', () => {
    const r = applyLayaVerdict({ ...base, verdict: null });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('no_verdict');
  });

  it('守门策略不外包 —— crisis/boundary/repair 三条全部挡住', () => {
    for (const g of LAYA_GUARDRAIL_STRATEGIES) {
      const r = applyLayaVerdict({
        ...base,
        ruleStrategy: g,
        verdict: verdict({ strategy: 'empathize', confidence: 0.99 }),
      });
      expect(r.strategy).toBe(g);
      expect(r.audit.outcome).toBe('guard');
    }
    // 反向：模型选了守门策略也不认（它压根不在 criteria 里）
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ strategy: 'crisis', confidence: 0.99 }),
    });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('suppressed');
  });

  it('抑制表是硬边界：allowed 里没有的策略选了也白选', () => {
    const r = applyLayaVerdict({
      ...base,
      allowed: ['neutral', 'empathize'],
      verdict: verdict({ strategy: 'redirect', confidence: 0.9 }),
    });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('suppressed');
    expect(r.audit.note).toContain('redirect');
  });

  it('置信度不够 → 用规则，记 low_confidence', () => {
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ strategy: 'empathize', confidence: 0.49 }),
    });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('low_confidence');
  });

  it('门限是闭区间下界：正好等于门槛算通过', () => {
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ strategy: 'empathize', confidence: 0.5 }),
    });
    expect(r.strategy).toBe('empathize');
    expect(r.audit.outcome).toBe('applied');
  });

  it('与规则一致 → 记 agree（这是"一致率"的来源）', () => {
    const r = applyLayaVerdict({
      ...base,
      ruleStrategy: 'empathize',
      verdict: verdict({ strategy: 'empathize', confidence: 0.9 }),
    });
    expect(r.strategy).toBe('empathize');
    expect(r.audit.outcome).toBe('agree');
  });

  it('一致但不太自信 → 还是 agree（置信度只在**要改判**时才有意义）', () => {
    // 这条是在真管道上踩出来的：一开始置信度关卡排在"一致"前面，
    // 于是"模型和规则想的一样、只是不自信"被记成 low_confidence，
    // 把最重要的**一致率**指标污染掉了。
    const r = applyLayaVerdict({
      ...base,
      ruleStrategy: 'neutral',
      verdict: verdict({ strategy: 'neutral', confidence: 0.11 }),
    });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('agree');
  });

  it('shadow 模式：记下"想改判成什么"，但一个字都不改', () => {
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ mode: 'shadow', strategy: 'accompany', confidence: 0.9 }),
    });
    expect(r.strategy).toBe('neutral');
    expect(r.audit.outcome).toBe('shadow');
    expect(r.audit.picked).toBe('accompany');
    expect(r.audit.note).toContain('【shadow】');
  });

  it('全部过关 → 采纳模型的，且审计里留着改判理由', () => {
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ strategy: 'accompany', confidence: 0.72 }),
    });
    expect(r.strategy).toBe('accompany');
    expect(r.audit.outcome).toBe('applied');
    expect(r.audit.note).toContain('neutral');
    expect(r.audit.note).toContain('accompany');
    expect(r.audit.note).toContain('0.72');
  });

  it('审计里始终带着原始分布与模型名（否则线上看不出它是不是在乱选）', () => {
    const r = applyLayaVerdict({
      ...base,
      verdict: verdict({ strategy: 'accompany', confidence: 0.2, model: 'multilingual' }),
    });
    expect(r.audit.distribution.length).toBeGreaterThan(0);
    expect(r.audit.model).toBe('multilingual');
    expect(r.audit.confidence).toBeCloseTo(0.2, 4);
  });
});

// ════════════════════════════════════════════════════════════
// 5. ruleWinsFor —— 不让模型碰的那一档（v1.33 收窄）
// ════════════════════════════════════════════════════════════

describe('applyLayaVerdict — ruleWinsFor（默认只保护 accompany）', () => {
  const gateBase = {
    ruleConfidence: 0.78,
    allowed: [...LAYAS_ALL],
    minConfidence: 0.5,
    ruleWinsFor: LAYA_KEEP_ACCOMPANY_STRATEGIES,
  };

  it('规则给 accompany 时，再自信也不改（记 rule_wins）', () => {
    // 这正是真管道 A/B 里最常发生的那一步：accompany → empathize（18/48）
    // ⇒ 追问 0.06→0.83、劝解 0.28→0.89、字数 +104%
    const r = applyLayaVerdict({
      ...gateBase,
      ruleStrategy: 'accompany',
      verdict: verdict({ strategy: 'empathize', confidence: 0.99 }),
    });
    expect(r.strategy).toBe('accompany');
    expect(r.audit.outcome).toBe('rule_wins');
    expect(r.audit.picked).toBe('empathize');   // 仍然记下"它想改成什么"
    expect(r.audit.note).toContain('不让模型碰');
  });

  it('只保护那一档：其余策略照旧可以被改判', () => {
    const r = applyLayaVerdict({
      ...gateBase,
      ruleStrategy: 'explore',
      verdict: verdict({ strategy: 'empathize', confidence: 0.9 }),
    });
    expect(r.strategy).toBe('empathize');
    expect(r.audit.outcome).toBe('applied');
  });

  it('一致仍记 agree（不因为落在保护档里就变成 rule_wins）', () => {
    const r = applyLayaVerdict({
      ...gateBase,
      ruleStrategy: 'accompany',
      verdict: verdict({ strategy: 'accompany', confidence: 0.3 }),
    });
    expect(r.audit.outcome).toBe('agree');
  });

  it('不传 ruleWinsFor = 不设限（回退到 v1.33 首次实测那套"什么都能改"）', () => {
    const r = applyLayaVerdict({
      ruleStrategy: 'accompany',
      ruleConfidence: 0.78,
      verdict: verdict({ strategy: 'empathize', confidence: 0.9 }),
      allowed: [...LAYAS_ALL],
      minConfidence: 0.5,
    });
    expect(r.strategy).toBe('empathize');
    expect(r.audit.outcome).toBe('applied');
  });

  it('守门策略优先于规则保护（crisis 记 guard 而不是 rule_wins）', () => {
    const r = applyLayaVerdict({
      ...gateBase,
      ruleStrategy: 'crisis',
      verdict: verdict({ strategy: 'empathize', confidence: 0.9 }),
    });
    expect(r.audit.outcome).toBe('guard');
  });
});
