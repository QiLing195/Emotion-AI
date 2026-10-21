import { describe, it, expect } from 'vitest';
import {
  EXPRESSION_BUDGET_TURNS,
  EXPRESSION_DEADZONE,
  buildEmotionExpression,
  buildUnifiedPermit,
  detectAsksAboutHer,
  unifiedExpressionEnabled,
  emotionExpressionEnabled,
} from '../emotionExpression.js';

describe('开关', () => {
  it('默认关，显式 true 才开', () => {
    expect(emotionExpressionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(emotionExpressionEnabled({ ENABLE_EMOTION_EXPRESSION: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('安全门：他明确负面时不表达自己（先接住他）', () => {
  it('他 sad ⇒ 不表达', () => {
    const r = buildEmotionExpression({ activated: { sad: 0.3 }, hisEmotion: 'sad', round: 10 });
    expect(r.snippet).toBeNull();
    expect(r.reason).toBe('his_negative_defer');
  });
  it('他 joy ⇒ 可以表达', () => {
    const r = buildEmotionExpression({ activated: { sad: 0.3 }, hisEmotion: 'joy', round: 10 });
    expect(r.snippet).toContain('可选');
    expect(r.cls).toBe('sad');
  });
});

describe('状态门：只表达"被激起"的、且主导要领先', () => {
  it('全部低于死区 ⇒ 静息，不表达', () => {
    const r = buildEmotionExpression({ activated: { joy: EXPRESSION_DEADZONE - 0.01 }, round: 5 });
    expect(r.snippet).toBeNull();
    expect(r.reason).toBe('resting_or_ambiguous');
  });
  it('并列（差距 < 死区）⇒ 不硬挑一个', () => {
    const r = buildEmotionExpression({ activated: { joy: 0.2, sad: 0.17 }, round: 5 });
    expect(r.snippet).toBeNull();
  });
  it('低谷期悲伤优先（即使别的更高）', () => {
    const r = buildEmotionExpression({ activated: { joy: 0.4, sad: 0.15 }, lowEstablished: true, round: 5 });
    expect(r.cls).toBe('sad');
  });
  it('greed/calm 不映射成表达类别', () => {
    const r = buildEmotionExpression({ activated: { greed: 0.5, calm: 0.4 }, round: 5 });
    expect(r.snippet).toBeNull();
  });
});

describe('预算：每 N 轮最多一次（防表演/索取回路）', () => {
  it('距上次表达不足 N 轮 ⇒ 不表达', () => {
    const r = buildEmotionExpression({
      activated: { joy: 0.3 }, round: 10, lastExpressedRound: 10 - (EXPRESSION_BUDGET_TURNS - 1),
    });
    expect(r.snippet).toBeNull();
    expect(r.reason).toContain('budget');
  });
  it('达到 N 轮 ⇒ 可以表达，并给出新的"上次表达轮次"', () => {
    const r = buildEmotionExpression({
      activated: { joy: 0.3 }, round: 10, lastExpressedRound: 10 - EXPRESSION_BUDGET_TURNS,
    });
    expect(r.snippet).not.toBeNull();
    expect(r.nextLastExpressedRound).toBe(10);
  });
});

describe('接地：原因只能引他的话，否则说不上来', () => {
  it('没有引文 ⇒ 明令"说不上来，不要编"', () => {
    const r = buildEmotionExpression({ activated: { sad: 0.3 }, round: 9 });
    expect(r.snippet).toContain('不要为了给原因编事');
  });
  it('有引文 ⇒ 允许引用且只允许这一条', () => {
    const r = buildEmotionExpression({ activated: { sad: 0.3 }, round: 9, causeQuote: '被领导当众骂了一顿' });
    expect(r.snippet).toContain('被领导当众骂了一顿');
    expect(r.snippet).toContain('只能');
  });
});

describe('不写成"情绪表演"：短句、可选、落回他', () => {
  it('片段含"可选/不说也行"且要求落回他那件事', () => {
    const r = buildEmotionExpression({ activated: { fear: 0.2 }, round: 11 });
    expect(r.snippet).toContain('不说也行');
    expect(r.snippet).toContain('落回他那件事');
    expect(r.snippet).toContain('不要借机要他安慰你');
  });
  it('同一轮/同一输入 ⇒ 句式稳定（可复现）', () => {
    const a = buildEmotionExpression({ activated: { joy: 0.25 }, round: 12 });
    const b = buildEmotionExpression({ activated: { joy: 0.25 }, round: 12 });
    expect(a.snippet).toBe(b.snippet);
  });
});

describe('变体轮换（按预算桶，确定性 + 相邻不重复）', () => {
  it('相邻两次表达（相隔一个预算周期）落在不同变体', () => {
    const a = buildEmotionExpression({ activated: { sad: 0.3 }, round: 100 });
    const b = buildEmotionExpression({ activated: { sad: 0.3 }, round: 100 + EXPRESSION_BUDGET_TURNS });
    const c = buildEmotionExpression({ activated: { sad: 0.3 }, round: 100 + EXPRESSION_BUDGET_TURNS * 2 });
    const got = [a, b, c].map(r => String(r.snippet).match(/例如：(.+?)。/)?.[1] ?? '');
    expect(new Set(got).size).toBe(3);
  });

  it('同一轮/同一输入 ⇒ 句式稳定（可复现）', () => {
    const x = buildEmotionExpression({ activated: { joy: 0.25 }, round: 12 });
    const y = buildEmotionExpression({ activated: { joy: 0.25 }, round: 12 });
    expect(x.snippet).toBe(y.snippet);
  });
});
describe('v1.65 统一接口（一个机构 + 允许多句）', () => {
  it('开关独立：ENABLE_UNIFIED_EXPRESSION', () => {
    expect(unifiedExpressionEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(unifiedExpressionEnabled({ ENABLE_UNIFIED_EXPRESSION: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('短许可：只给"可以说"+示例+不限句数，**不给格式骨架**', () => {
    const r = buildUnifiedPermit({ activated: { sad: 0.3 }, round: 100 });
    expect(r.snippet).toContain('你可以说一句自己（也可以不说）');
    expect(r.snippet).toContain('想说几句都行');
    expect(r.snippet).toContain('不用按格式');
    expect(r.snippet).toContain('落回他那件事');
    expect(r.snippet).not.toContain('状态：');
    expect(r.snippet).not.toContain('最后一句');
    expect(r.cls).toBe('sad');
  });

  it('有接地原因 ⇒ 只许引这一条；没有 ⇒ 说不上来不许编', () => {
    const withCause = buildUnifiedPermit({ activated: { sad: 0.3 }, round: 100, causeQuote: '被领导当众骂了一顿' });
    expect(withCause.snippet).toContain('被领导当众骂了一顿');
    expect(withCause.snippet).toContain('只能');
    const noCause = buildUnifiedPermit({ activated: { sad: 0.3 }, round: 100 });
    expect(noCause.snippet).toContain('别编');
  });

  it('安全门/预算门与旧接口一致', () => {
    expect(buildUnifiedPermit({ activated: { sad: 0.3 }, hisEmotion: 'sad', round: 100 }).reason).toBe('his_negative_defer');
    expect(buildUnifiedPermit({ activated: { sad: 0.3 }, round: 100, lastExpressedRound: 99 }).reason).toContain('budget');
    expect(buildUnifiedPermit({ activated: { joy: 0.01 }, round: 100 }).reason).toBe('resting_or_ambiguous');
  });

  it('相邻预算桶 ⇒ 示例句不同（短示例也轮换）', () => {
    const a = buildUnifiedPermit({ activated: { joy: 0.3 }, round: 100 });
    const b = buildUnifiedPermit({ activated: { joy: 0.3 }, round: 100 + EXPRESSION_BUDGET_TURNS });
    const ex = (s: string) => String(s).match(/比如：(.+)$/m)?.[1] ?? '';
    expect(ex(String(a.snippet))).not.toBe(ex(String(b.snippet)));
  });
});
describe('v1.66 问必答（他明确问她时可突破预算一次）', () => {
  it('识别"在问她"的句子，不误伤普通闲聊', () => {
    for (const s of ['你今天心情怎么样？', '你现在在做什么？', '你呢？', '你最近还好吗？']) {
      expect(detectAsksAboutHer(s), s).toBe(true);
    }
    for (const s of ['我今天被领导骂了', '那就好', '我先去忙了']) {
      expect(detectAsksAboutHer(s), s).toBe(false);
    }
  });

  it('预算未到 + 他在问她 ⇒ 允许表达（问必答）', () => {
    const r = buildUnifiedPermit({
      activated: { sad: 0.3 }, round: 100, lastExpressedRound: 99, hisAsksAboutHer: true,
    });
    expect(r.snippet).not.toBeNull();
    expect(r.reason).toContain('ok-short');
  });

  it('预算未到 + 他没问 ⇒ 仍然拦（保持不表演）', () => {
    const r = buildUnifiedPermit({
      activated: { sad: 0.3 }, round: 100, lastExpressedRound: 99, hisAsksAboutHer: false,
    });
    expect(r.snippet).toBeNull();
    expect(r.reason).toContain('budget');
  });

  it('他明确负面时，即使问她也不说（安全门优先）', () => {
    const r = buildUnifiedPermit({
      activated: { sad: 0.3 }, round: 100, hisAsksAboutHer: true, hisEmotion: 'sad',
    });
    expect(r.snippet).toBeNull();
    expect(r.reason).toBe('his_negative_defer');
  });
});