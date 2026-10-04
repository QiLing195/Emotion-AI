// ── v1.38 「她自己在低谷时，他带来好消息」该给她什么指令 ──
//
// 这一跑**只换片段文字、不动策略标签**。理由是项目历史：
//   · v1.31 判过「换策略标签无用」（已回滚，只留结论）；
//   · v1.36 把标签从 accompany 改成 empathize，A/B 没量到收益、B 臂还模板塌缩；
//   · 而真正推得动行为的杠杆一直在**内容块**（v1.29 片段改写、v1.30 整块不给）。
// 所以变量收成一个：同一个策略标签、两块不同的片段。
//
// 下面这些测试钉的是**三层门**（任何一层不过都要逐字回到旧片段），
// 以及守门策略永不被替换（与 Laya 的 `LAYA_GUARDRAIL_STRATEGIES` 同一原则）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  STRATEGY_PROMPT_SNIPPETS, LOW_PERIOD_STANCE_SNIPPET, LOW_PERIOD_STANCE_EXCLUDED,
  resolveStrategySnippet, lowPeriodStanceEnabled,
} from '../dialogueStrategy';
import type { StrategyType } from '../dialogueStrategy';

const original = process.env.ENABLE_LOW_PERIOD_STANCE;
afterEach(() => {
  if (original === undefined) delete process.env.ENABLE_LOW_PERIOD_STANCE;
  else process.env.ENABLE_LOW_PERIOD_STANCE = original;
});

const GATE = { inEstablishedLowPeriod: true, hisEmotion: 'joy' };

describe('v1.38 低谷立场片段', () => {
  it('开关默认关：逐字返回原片段（默认行为与旧版完全一致）', () => {
    expect(lowPeriodStanceEnabled()).toBe(false);
    for (const s of ['empathize', 'accompany', 'neutral'] as StrategyType[]) {
      expect(resolveStrategySnippet(s, GATE)).toBe(STRATEGY_PROMPT_SNIPPETS[s]);
    }
  });

  it('三层门都过才替换：开关 + 已成段低谷 + 他明确是好事', () => {
    process.env.ENABLE_LOW_PERIOD_STANCE = 'true';
    expect(resolveStrategySnippet('accompany', GATE)).toBe(LOW_PERIOD_STANCE_SNIPPET);
    // ② 不在低谷（或只是"这一轮被推了一下"）→ 不换
    expect(resolveStrategySnippet('accompany', { ...GATE, inEstablishedLowPeriod: false }))
      .toBe(STRATEGY_PROMPT_SNIPPETS.accompany);
    // ③ 他说的不是好事 → 不换（这正是负面对照两臂必须逐字相同的原因）
    for (const e of ['sad', 'anger', 'fear', 'disgust', null, undefined, 'neutral']) {
      expect(resolveStrategySnippet('accompany', { ...GATE, hisEmotion: e }))
        .toBe(STRATEGY_PROMPT_SNIPPETS.accompany);
    }
    // 三个正面键都算好事（与 v1.36 的 positiveNews 同一把尺子）
    for (const e of ['joy', 'gratitude', 'love']) {
      expect(resolveStrategySnippet('accompany', { ...GATE, hisEmotion: e }))
        .toBe(LOW_PERIOD_STANCE_SNIPPET);
    }
  });

  it('开关只认字面 true（与 ENABLE_STRATEGY_DIRECTION 同一套约定）', () => {
    process.env.ENABLE_LOW_PERIOD_STANCE = '1';
    expect(lowPeriodStanceEnabled()).toBe(false);
    process.env.ENABLE_LOW_PERIOD_STANCE = 'TRUE';
    expect(lowPeriodStanceEnabled()).toBe(false);
    process.env.ENABLE_LOW_PERIOD_STANCE = 'true';
    expect(lowPeriodStanceEnabled()).toBe(true);
  });

  it('守门策略永不被替换：危机 / 边界 / 修复（她状态不好不是改这三条的理由）', () => {
    process.env.ENABLE_LOW_PERIOD_STANCE = 'true';
    expect([...LOW_PERIOD_STANCE_EXCLUDED].sort()).toEqual(['boundary', 'crisis', 'repair']);
    for (const s of LOW_PERIOD_STANCE_EXCLUDED) {
      expect(resolveStrategySnippet(s, GATE)).toBe(STRATEGY_PROMPT_SNIPPETS[s]);
    }
  });

  it('片段里**不许有可被整句照抄的自述**（v1.38 实测：例句被逐字复制了 5/16 条）', () => {
    // 教训：给"许可"可以，给"可抄的句子"不行 —— 模型会把示例原样搬进回复，
    // 于是"她自己讲自己的事"那条读数就不再是她的行为，而是我的文本漏进了输出。
    for (const leak of ['我这两天', '我最近也', '我状态', '我有点闷']) {
      expect(LOW_PERIOD_STANCE_SNIPPET, `片段里出现了可被照抄的自述：「${leak}」`).not.toContain(leak);
    }
    // 但"准许交代一句"这个**许可**要留着（否则就从"允许低位"变成"不许提自己"）
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('顺口交代一句');
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('不要展开');
  });

  it('片段本身写死了两件事：准许低位回应、但不许冷处理', () => {
    // ① 准许"挺好的"这类低位措辞（现行 empathy/neutral 片段是**禁止**它的，所以必须显式悬置）
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('挺好的');
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('本轮不适用');
    // ② 划死底线：接了、只是接得低（不是不想接）
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('接了、只是接得低');
    // ③ 不许把这一轮变成"讲自己的事 / 让他来哄你"（那才是真的自闭成冷淡）
    expect(LOW_PERIOD_STANCE_SNIPPET).toContain('他不是来照顾你的');
  });
});
