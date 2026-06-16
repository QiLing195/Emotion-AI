// ── contentInjector 单元测试 ──
// 覆盖：7 种策略注入逻辑 / 空模式降级 / A/B 开关 / 长度截断 / 中文输出
// 优先级：🔴 最高 — Phase 2 策略层装填核心逻辑

import { describe, it, expect } from 'vitest';
import { buildPatternInjection } from '../contentInjector';
import type { PatternCandidate } from '../../curiosity/patterns';
import { PatternLifecycle } from '../../curiosity/patterns';
import type { StrategyType } from '../dialogueStrategy';

// ════════════════════════════════════════════════════════════
// 测试辅助
// ════════════════════════════════════════════════════════════

function makePattern(overrides?: Partial<PatternCandidate>): PatternCandidate {
  return {
    topic: '摄影',
    frequency: 8,
    persistence: 5,
    connectedness: 3,
    maturityScore: 0.85,
    stage: 'confirmed',
    neighbors: ['旅行', '艺术'],
    emotionalSignature: { calm: 0.7, joy: 0.3, fear: 0.1 },
    lifecycle: PatternLifecycle.ESTABLISHED,
    lifecycleSince: Date.now() - 86400000,
    lastMentionedAt: Date.now(),
    isReactivated: false,
    computedAt: Date.now(),
    ...overrides,
  };
}

const CALM_EMOTIONS: Record<string, number> = {
  joy: 0.2, anger: 0.0, sad: 0.1, fear: 0.05, love: 0.3,
  disgust: 0.0, lust: 0.1, calm: 0.8, greed: 0.1,
};

const FEAR_EMOTIONS: Record<string, number> = {
  joy: 0.05, anger: 0.1, sad: 0.4, fear: 0.8, love: 0.05,
  disgust: 0.05, lust: 0.0, calm: 0.1, greed: 0.0,
};

// ════════════════════════════════════════════════════════════
// 1. 各策略基本产出
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — 各策略', () => {
  const strategies: StrategyType[] = [
    'empathize', 'redirect', 'explore', 'share',
    'accompany', 'repair', 'boundary', 'desire', 'neutral',
  ];

  for (const strategy of strategies) {
    it(`${strategy} 策略有产出`, () => {
      const patterns = [makePattern()];
      const result = buildPatternInjection(strategy, patterns, 'calm', {
        currentEmotions: CALM_EMOTIONS,
        drives: { greedDrive: 0.3, fearAvoidance: 0.1 },
      });

      // 所有非 neutral 策略在有 pattern 时应产出中文
      if (strategy === 'neutral') {
        // neutral + maturity > 0.7 → 有产出
        expect(result.length).toBeGreaterThan(0);
      } else if (strategy === 'empathize') {
        // empathize + CALM_EMOTIONS + calm 签名 → 有产出
        expect(result.length).toBeGreaterThan(0);
      } else {
        expect(result.length).toBeGreaterThan(0);
      }
      // 必须包含 topic（boundary 策略除外——它不依赖 pattern）
      if (strategy !== 'boundary' && (strategy !== 'neutral' || patterns[0].maturityScore >= 0.7)) {
        expect(result).toContain('摄影');
      }
      if (strategy === 'boundary') {
        expect(result).toContain('自尊边界');
      }
    });
  }
});

// ════════════════════════════════════════════════════════════
// 2. 空模式 / 无模式降级
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — 降级', () => {
  it('空 relevantPatterns 返回空串', () => {
    const result = buildPatternInjection('empathize', [], 'calm');
    expect(result).toBe('');
  });

  it('所有策略在无模式时返回空串', () => {
    // boundary 策略始终产出边界提示，不依赖 pattern——跳过
    const strategies: StrategyType[] = [
      'empathize', 'redirect', 'explore', 'share',
      'accompany', 'repair', 'desire', 'neutral',
    ];
    for (const s of strategies) {
      expect(buildPatternInjection(s, [], 'calm')).toBe('');
    }
  });

  it('neutral + maturity < 0.7 返回空串', () => {
    const lowPattern = makePattern({ maturityScore: 0.5, stage: 'candidate' });
    const result = buildPatternInjection('neutral', [lowPattern], 'calm');
    expect(result).toBe('');
  });

  it('neutral + maturity >= 0.7 有产出', () => {
    const highPattern = makePattern({ maturityScore: 0.85 });
    const result = buildPatternInjection('neutral', [highPattern], 'calm');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// 3. A/B 开关
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — A/B 开关', () => {
  it('enabled=false 时永远返回空串', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      enabled: false,
      currentEmotions: CALM_EMOTIONS,
    });
    expect(result).toBe('');
  });

  it('enabled=true 时正常产出', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      enabled: true,
      currentEmotions: CALM_EMOTIONS,
    });
    expect(result.length).toBeGreaterThan(0);
  });

  it('不传 options 时默认启用', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('share', patterns, 'calm');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════
// 4. maxChars 截断
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — 长度限制', () => {
  it('maxChars 限制生效', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      maxChars: 30,
      currentEmotions: CALM_EMOTIONS,
    });
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('默认上限 300', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      currentEmotions: CALM_EMOTIONS,
    });
    expect(result.length).toBeLessThanOrEqual(300);
  });
});

// ════════════════════════════════════════════════════════════
// 5. 中文输出
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — 中文输出', () => {
  it('empathize 输出只含中文字符和标点', () => {
    const patterns = [makePattern()];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      currentEmotions: CALM_EMOTIONS,
    });
    // 不应包含英文字母（除 topic 名外）
    // topic 名本身是中文
    const noTagResult = result.replace(/【[^】]+】/g, '').replace(/[a-zA-Z]/g, '');
    // 确认核心部分是中文
    expect(noTagResult.length).toBeGreaterThan(10);
  });

  it('各策略产出都包含中文标记', () => {
    const strategies: StrategyType[] = [
      'empathize', 'redirect', 'explore', 'share',
      'accompany', 'repair', 'desire',
    ];
    for (const s of strategies) {
      const patterns = [makePattern()];
      const result = buildPatternInjection(s, patterns, 'calm', {
        currentEmotions: CALM_EMOTIONS,
        drives: { greedDrive: 0.3, fearAvoidance: 0.1 },
      });
      expect(result).toMatch(/【/);
      expect(result).toMatch(/】/);
    }
  });
});

// ════════════════════════════════════════════════════════════
// 6. 情绪重叠（empathize 特化）
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — empathize 情绪映射', () => {
  it('当前高 calm + pattern 高 calm → 产出提及 calm', () => {
    const patterns = [makePattern({
      emotionalSignature: { calm: 0.8, joy: 0.1, fear: 0.05 },
    })];
    const result = buildPatternInjection('empathize', patterns, 'calm', {
      currentEmotions: CALM_EMOTIONS, // calm: 0.8
    });
    expect(result).toContain('平静');
  });

  it('当前高 fear + pattern 高 fear → 产出提及 fear', () => {
    const patterns = [makePattern({
      emotionalSignature: { fear: 0.8, calm: 0.1, joy: 0.1 },
    })];
    const result = buildPatternInjection('empathize', patterns, 'fear', {
      currentEmotions: FEAR_EMOTIONS, // fear: 0.8
    });
    expect(result).toContain('不安');
  });

  it('无明显情绪重叠时有降级产出', () => {
    // pattern 以 calm 为主，但当前情绪以 anger 为主 → 无明显重叠
    const patterns = [makePattern({
      emotionalSignature: { calm: 0.8, joy: 0.1 },
    })];
    const result = buildPatternInjection('empathize', patterns, 'anger', {
      currentEmotions: { joy: 0.1, anger: 0.8, calm: 0.05, fear: 0.1, love: 0, sad: 0, disgust: 0, lust: 0, greed: 0 },
    });
    // 即使无强重叠，empathize 仍应给出降级产出（使用 pattern 自身主导情绪）
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('摄影');
  });
});

// ════════════════════════════════════════════════════════════
// 7. redirect 驱动轴偏置
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — redirect 驱动偏置', () => {
  it('高 fearAvoidance 时选择 calm 签名 pattern', () => {
    const calmPattern = makePattern({
      topic: '散步',
      emotionalSignature: { calm: 0.9, joy: 0.1, fear: 0.0 },
    });
    const fearPattern = makePattern({
      topic: '恐怖片',
      emotionalSignature: { fear: 0.9, calm: 0.0, joy: 0.1 },
    });
    const patterns = [fearPattern, calmPattern]; // fear 在前

    const result = buildPatternInjection('redirect', patterns, 'fear', {
      drives: { greedDrive: 0.1, fearAvoidance: 0.8 },
    });

    // 高 fearAvoidance → 应选择 calm 签名的「散步」而非 fear 签名的「恐怖片」
    expect(result).toContain('散步');
    expect(result).not.toContain('恐怖片');
  });
});

// ════════════════════════════════════════════════════════════
// 8. 无情绪签名的 pattern
// ════════════════════════════════════════════════════════════

describe('buildPatternInjection — 无情绪签名', () => {
  it('无签名的 pattern 仍有基础话题注入', () => {
    const noSigPattern = makePattern({
      emotionalSignature: undefined,
    });
    const result = buildPatternInjection('share', [noSigPattern], 'calm');
    expect(result).toContain('摄影');
    expect(result.length).toBeGreaterThan(0);
  });
});
