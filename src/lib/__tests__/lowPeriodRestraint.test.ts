// ── v1.42 「她自己在低谷时，他说的是平常事」该给她什么指令 ──
//
// 这一跑是 v1.39 的**同题重做、换杠杆**：
//   v1.39 把「少追问」做在**动机层**（她沉时整块不给"关于他的待办"），真管道结果是**反的**
//     （追问 +0.33、字数 +15.5）：让位改变的是"问什么"不是"问不问"，
//     而且拿掉的那块本身还带着一条**收窄指令**。
//   v1.42 把变量放回**策略片段**（本项目真正推得动行为的杠杆一直在内容块：v1.29/v1.30）。
//
// 下面这些测试钉的是**门**（任何一层不过都要逐字回到旧片段）、**白名单**（不是黑名单，
// 将来新增的策略默认不受影响）、以及**负向通路不被污染**（v1.31 刚把"他明确负面时的承认"
// 从 0.13 提到 0.81，那条路不许被这条改动碰到）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  STRATEGY_PROMPT_SNIPPETS, LOW_PERIOD_RESTRAINT_SNIPPET, LOW_PERIOD_RESTRAINT_TARGETS,
  LOW_PERIOD_STANCE_SNIPPET, resolveStrategySnippet, lowPeriodRestraintEnabled,
} from '../dialogueStrategy';
import type { StrategyType } from '../dialogueStrategy';
import { CANONICAL_EMOTIONS } from '../emotionCanonical';

const origStance = process.env.ENABLE_LOW_PERIOD_STANCE;
const origRestraint = process.env.ENABLE_LOW_PERIOD_RESTRAINT;
afterEach(() => {
  if (origStance === undefined) delete process.env.ENABLE_LOW_PERIOD_STANCE;
  else process.env.ENABLE_LOW_PERIOD_STANCE = origStance;
  if (origRestraint === undefined) delete process.env.ENABLE_LOW_PERIOD_RESTRAINT;
  else process.env.ENABLE_LOW_PERIOD_RESTRAINT = origRestraint;
});

/** 她已成段低谷 + 他说的是平常事（未归一/未知标签也算平常事） */
const ORDINARY = { inEstablishedLowPeriod: true, hisEmotion: 'neutral' };

describe('v1.42 低谷期「少追问」片段', () => {
  it('开关默认关：逐字返回原片段（默认行为与旧版完全一致）', () => {
    expect(lowPeriodRestraintEnabled()).toBe(false);
    for (const s of ['neutral', 'explore', 'empathize', 'accompany'] as StrategyType[]) {
      expect(resolveStrategySnippet(s, ORDINARY)).toBe(STRATEGY_PROMPT_SNIPPETS[s]);
    }
  });

  it('开关只认字面 true（与其余低谷开关同一套约定）', () => {
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = '1';
    expect(lowPeriodRestraintEnabled()).toBe(false);
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'TRUE';
    expect(lowPeriodRestraintEnabled()).toBe(false);
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    expect(lowPeriodRestraintEnabled()).toBe(true);
  });

  it('三层门都过才替换：已成段低谷 + 他是平常事 + 策略在白名单里', () => {
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    expect(resolveStrategySnippet('neutral', ORDINARY)).toBe(LOW_PERIOD_RESTRAINT_SNIPPET);
    expect(resolveStrategySnippet('explore', ORDINARY)).toBe(LOW_PERIOD_RESTRAINT_SNIPPET);

    // ① 不在低谷（或只是"这一轮被推了一下"）→ 不换
    expect(resolveStrategySnippet('neutral', { ...ORDINARY, inEstablishedLowPeriod: false }))
      .toBe(STRATEGY_PROMPT_SNIPPETS.neutral);
    // ③ 策略不在白名单 → 不换
    for (const s of ['share', 'desire', 'redirect', 'empathize', 'accompany'] as StrategyType[]) {
      expect(resolveStrategySnippet(s, ORDINARY), s).toBe(STRATEGY_PROMPT_SNIPPETS[s]);
    }
  });

  it('他**明确负面**时一律不换 —— 单开一条改动不许污染 v1.31 那条"承认"通路', () => {
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    for (const e of ['sad', 'anger', 'fear', 'disgust']) {
      for (const s of ['neutral', 'explore', 'empathize', 'accompany'] as StrategyType[]) {
        expect(resolveStrategySnippet(s, { inEstablishedLowPeriod: true, hisEmotion: e }), `${e}/${s}`)
          .toBe(STRATEGY_PROMPT_SNIPPETS[s]);
      }
    }
    // 未归一/自然语言标签也要按归一键判 —— 「有点累」是 sad，不是平常事
    for (const raw of ['有点累', 'tired', 'worried', '焦虑', '烦']) {
      expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: raw }), raw)
        .toBe(STRATEGY_PROMPT_SNIPPETS.neutral);
    }
  });

  it('校验「平常事」的判据落在归一的 8 键上（不另立词表）：只有 neutral 与"没分析"算', () => {
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    // 正向三键走的是 v1.38 的立场片段，不是这一条
    for (const e of ['joy', 'gratitude', 'love']) {
      expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: e }), e)
        .not.toBe(LOW_PERIOD_RESTRAINT_SNIPPET);
    }
    // neutral / 没做分析 / 空串 / 未知标签（归一兜底为 neutral）
    for (const e of ['neutral', null, undefined, '']) {
      expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: e }), String(e))
        .toBe(LOW_PERIOD_RESTRAINT_SNIPPET);
    }
    // 断言"平常事 = 归一后 neutral"这件事本身，而不是靠上一条的枚举碰巧成立
    expect(CANONICAL_EMOTIONS).toHaveLength(8);
    expect([...CANONICAL_EMOTIONS].filter(e => e === 'neutral')).toEqual(['neutral']);
  });

  it('两个低谷开关互不干扰：他报喜时永远走 v1.38 那块，restraint 开不开都一样', () => {
    // stance 关、restraint 开：他报喜 → 旧片段（restraint 不许顺手接管好消息）
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    delete process.env.ENABLE_LOW_PERIOD_STANCE;
    expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: 'joy' }))
      .toBe(STRATEGY_PROMPT_SNIPPETS.neutral);
    // stance 开、restraint 关：他报喜 → stance 片段
    process.env.ENABLE_LOW_PERIOD_STANCE = 'true';
    delete process.env.ENABLE_LOW_PERIOD_RESTRAINT;
    expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: 'joy' }))
      .toBe(LOW_PERIOD_STANCE_SNIPPET);
    // 两个都开也各走各的
    process.env.ENABLE_LOW_PERIOD_RESTRAINT = 'true';
    expect(resolveStrategySnippet('neutral', { inEstablishedLowPeriod: true, hisEmotion: 'joy' }))
      .toBe(LOW_PERIOD_STANCE_SNIPPET);
    expect(resolveStrategySnippet('neutral', ORDINARY)).toBe(LOW_PERIOD_RESTRAINT_SNIPPET);
  });

  it('白名单是白名单：加了新策略它默认**不受**这条改动影响', () => {
    expect([...LOW_PERIOD_RESTRAINT_TARGETS].sort()).toEqual(['explore', 'neutral']);
    // 守门策略不在白名单里（与 v1.38 同一条原则）
    for (const s of ['crisis', 'boundary', 'repair'] as StrategyType[]) {
      expect(LOW_PERIOD_RESTRAINT_TARGETS.has(s), s).toBe(false);
    }
  });

  it('片段结构：不许有可被整句照抄的内容（v1.38 实测例句被逐字复制了 5/16 条）', () => {
    // 教训：给"许可"可以，给"可抄的句子"不行。这条比 v1.38 那条更硬 ——
    // 直接禁止片段里出现引号与第一人称：没有可抄的自述，就不可能再量到"漏到输出里"的假收益。
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).not.toMatch(/[「」""'']/);
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).not.toContain('我');
  });

  it('片段本身写死了底线：准许不推进对话，但不许冷处理、不许变成讲自己的事', () => {
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('不要求你推进对话');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('少问');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('冷淡');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('不要转身讲自己的事');
  });

  /**
   * v1.46：第一版（v1.42）把"少问"兑现成了**泛泛的安慰** —— 真管道实测 `echo` 0.93→0.40
   * （A 问"是常规体检还是哪里不舒服"，B 说"别一个人扛着""你心里有数就行"）。
   * 根因是我自己那两句：把"让他知道你在"写成**目标**、把"落在他那件事上"写成**许可**。
   * 下面钉住修法，防止哪天又被顺手改回去（"接住"这种词很容易再变回泛泛的安慰）。
   */
  it('v1.46 修法：必须落在他那件具体的事上；"安慰"被明确划到绕开那一侧', () => {
    // ① 要求她先点出那件事里最具体的一点（这是 `echo` 掉下去的正对治）
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('最具体的那一点');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('用你自己的话');
    // ② 撤掉第一版那句把"让他知道你在"当目标的许可
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).not.toContain('让他知道你在');
    // ③ 撤掉"不问也可以"这种许可式措辞
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).not.toContain('不问也可以');
    // ③b **第四跑的反面教材**：我那句"真要问，就落在那件事上"等于把问句的门又打开了 ——
    //     模型就用"问他一个关于那件事的问题"来满足"点出那件事"，`questions` 从 0.33 弹回 0.93。
    //     这一轮不许再把问句当成一条出路。
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).not.toContain('真要问');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('不问他下文');
    // ④ 把"冷淡的反面"从"安慰"改指回"看着他这件事"
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('冷淡的反面也不是安慰');
    expect(LOW_PERIOD_RESTRAINT_SNIPPET).toContain('真的看着他这件事');
  });
});
