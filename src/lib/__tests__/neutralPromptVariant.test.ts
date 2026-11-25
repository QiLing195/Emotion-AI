import { describe, expect, it } from 'vitest';
import { STRATEGY_PROMPT_SNIPPETS } from '../dialogueStrategy.js';
import { buildNeutralPromptVariantFromEvidence } from '../neutralPromptVariant.js';
import { analyzeUserEmotionLocally } from '../../../server/services/emotionAnalyzer.js';

describe('evidence-gated neutral prompt selection', () => {
  it('selects the loneliness section for an explicit first-person loneliness disclosure', () => {
    const userText = '我最近总觉得没人懂我，一个人挺孤单的。';
    const analysis = analyzeUserEmotionLocally(userText);
    const result = buildNeutralPromptVariantFromEvidence({
      strategy: 'neutral',
      strategySnippet: STRATEGY_PROMPT_SNIPPETS.neutral,
      userText,
      analysis,
      localAnalysis: analysis,
    });

    expect(analysis.expressedEmotion).toBe('sad');
    expect(result.applied).toBe(true);
    expect(result.selection).toBe('孤独 — 陪着，别启蒙');
  });

  it('recognizes first-person ownership when the pronoun appears in an earlier clause', () => {
    const userText = '最近总觉得没人懂我，一个人挺孤单的。';
    const analysis = analyzeUserEmotionLocally(userText);
    const result = buildNeutralPromptVariantFromEvidence({
      strategy: 'neutral',
      strategySnippet: STRATEGY_PROMPT_SNIPPETS.neutral,
      userText,
      analysis,
      localAnalysis: analysis,
    });

    expect(result.applied).toBe(true);
    expect(result.selection).toBe('孤独 — 陪着，别启蒙');
  });

  it('selects disappointment when anger is explicitly negated in the same turn', () => {
    const userText = '我对这次结果很失望，但还说不上生气';
    const analysis = analyzeUserEmotionLocally(userText);
    const result = buildNeutralPromptVariantFromEvidence({
      strategy: 'neutral',
      strategySnippet: STRATEGY_PROMPT_SNIPPETS.neutral,
      userText,
      analysis,
      localAnalysis: analysis,
    });

    expect(analysis.expressedEmotion).toBe('sad');
    expect(result.applied).toBe(true);
    expect(result.selection).toBe('失望 — 承认落差，别急着翻篇');
  });

  it('falls back when loneliness and disappointment subtypes are contrasted in one turn', () => {
    const userText = '我对结果很失望，但并不孤单。';
    const analysis = analyzeUserEmotionLocally(userText);
    const result = buildNeutralPromptVariantFromEvidence({
      strategy: 'neutral',
      strategySnippet: STRATEGY_PROMPT_SNIPPETS.neutral,
      userText,
      analysis,
      localAnalysis: analysis,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('mixed_emotion');
  });
});
