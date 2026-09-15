// ── identityNarrative 单元测试（v1.9 A-1 身份叙事回流）──
// 背景：shouldRefreshNarrative / generateIdentityNarrative / narrativeToPromptSnippet
//       此前全部"已实现但从未被调用"，自我叙事零消费。
// 本文件锁死刷新门控与 Prompt 片段的行为，防止回流再次断掉。

import { describe, it, expect } from 'vitest';
import {
  shouldRefreshNarrative,
  narrativeToPromptSnippet,
  generateIdentityNarrative,
  type IdentityNarrative,
} from '../identityNarrative';
import { createEpisodicMemoryStore, type EpisodicMemoryStore } from '../episodicMemory';
import { createValueSystem } from '../valueDiscovery';
import { INITIAL_EMOTION_STATE, INITIAL_EVOLUTION } from '../emotionEngine';
import type { EmotionState } from '../emotionTypes';

function evolution(overrides: Partial<typeof INITIAL_EVOLUTION> = {}) {
  return { ...structuredClone(INITIAL_EVOLUTION), ...overrides };
}

function narrative(overrides: Partial<IdentityNarrative> = {}): IdentityNarrative {
  return {
    summary: '你是一个温柔的人',
    keyMemories: [],
    personalitySnapshot: {
      empathy: 50, trust: 50, openness: 30, playfulness: 30, resilience: 0.5, sensitivity: 0.5,
    },
    coreValues: [],
    attachmentStyle: 'secure',
    conflictStyle: 'collaborative',
    generatedAt: new Date().toISOString(),
    roundNumber: 20,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════
// 1. 刷新门控
// ════════════════════════════════════════════════════════════

describe('shouldRefreshNarrative — 刷新门控', () => {
  it('距上次刷新不足 20 轮 → 不刷新', () => {
    expect(shouldRefreshNarrative(evolution({ lastIdentityRefresh: 10 }), 25)).toBe(false);
  });

  it('达到 20 轮 → 刷新', () => {
    expect(shouldRefreshNarrative(evolution({ lastIdentityRefresh: 10 }), 30)).toBe(true);
  });

  it('从未刷新过（lastIdentityRefresh=0）且已过 20 轮 → 刷新（首次回流）', () => {
    expect(shouldRefreshNarrative(evolution({ lastIdentityRefresh: 0 }), 20)).toBe(true);
  });

  it('可自定义间隔', () => {
    expect(shouldRefreshNarrative(evolution({ lastIdentityRefresh: 5 }), 8, 3)).toBe(true);
  });

  it('刷新后写回 lastIdentityRefresh，门控随即复位（模拟主循环）', () => {
    const evo = evolution({ lastIdentityRefresh: 0 });
    const round = 20;
    expect(shouldRefreshNarrative(evo, round)).toBe(true);
    evo.lastIdentityRefresh = round; // 主循环中的写回
    expect(shouldRefreshNarrative(evo, round + 1)).toBe(false);
    expect(shouldRefreshNarrative(evo, round + 20)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════
// 2. Prompt 片段
// ════════════════════════════════════════════════════════════

describe('narrativeToPromptSnippet — Prompt 注入片段', () => {
  it('包含互动轮数与人设摘要（摘要截断到 120 字）', () => {
    const long = '很长的自我描述'.repeat(40);
    const snippet = narrativeToPromptSnippet(narrative({ summary: long, roundNumber: 42 }));
    expect(snippet).toContain('42');
    expect(snippet).toContain(long.slice(0, 120));
    expect(snippet.length).toBeLessThan(long.length);
  });

  it('有核心价值时列出中文标签与置信度', () => {
    const snippet = narrativeToPromptSnippet(narrative({
      coreValues: [
        { id: 'connection', statement: '连接让我满足', confidence: 0.8 },
        { id: 'honesty', statement: '诚实更重要', confidence: 0.6 },
      ],
    }));
    expect(snippet).toContain('连接感(80%)');
    expect(snippet).toContain('诚实(60%)');
  });

  it('未知价值 id 回退为原 id', () => {
    const snippet = narrativeToPromptSnippet(narrative({
      coreValues: [{ id: 'unknown_value', statement: 'x', confidence: 0.5 }],
    }));
    expect(snippet).toContain('unknown_value(50%)');
  });

  it('无核心价值时不出现"你最珍视的"', () => {
    expect(narrativeToPromptSnippet(narrative())).not.toContain('你最珍视');
  });

  it('依恋风格影响描述（anxious / secure）', () => {
    expect(narrativeToPromptSnippet(narrative({ attachmentStyle: 'anxious' }))).toContain('焦虑');
    expect(narrativeToPromptSnippet(narrative({ attachmentStyle: 'secure' }))).toContain('安全型');
  });
});

// ════════════════════════════════════════════════════════════
// 3. 端到端生成（空记忆库也要能生成，不能抛）
// ════════════════════════════════════════════════════════════

describe('generateIdentityNarrative', () => {
  it('空情景库 + 默认价值体系也能生成结构化叙事', () => {
    const store: EpisodicMemoryStore = createEpisodicMemoryStore();
    const out = generateIdentityNarrative(
      store,
      evolution({ totalInteractions: 25 }),
      createValueSystem(),
      structuredClone(INITIAL_EMOTION_STATE) as EmotionState,
      25,
    );
    expect(typeof out.summary).toBe('string');
    expect(out.summary.length).toBeGreaterThan(0);
    expect(out.roundNumber).toBe(25);
    expect(Array.isArray(out.keyMemories)).toBe(true);
    expect(out.personalitySnapshot.empathy).toBeGreaterThanOrEqual(0);
  });

  it('生成结果可直接喂给 Prompt 片段函数', () => {
    const out = generateIdentityNarrative(
      createEpisodicMemoryStore(),
      evolution(),
      createValueSystem(),
      structuredClone(INITIAL_EMOTION_STATE) as EmotionState,
      1,
    );
    expect(narrativeToPromptSnippet(out)).toContain('经历了');
  });
});
