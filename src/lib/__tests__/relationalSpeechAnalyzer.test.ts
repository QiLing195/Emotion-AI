import { describe, expect, it } from 'vitest';
import { analyzeRelationalSpeech } from '../relationalSpeechAnalyzer';

describe('relationalSpeechAnalyzer', () => {
  it.each([
    ['如果我喜欢你呢？', 'testing', 'relationship_probe', true],
    ['你这么懂我，我都快爱上你了哈哈', 'playful', 'playful_flirt', true],
    ['我好像有点喜欢你', 'indirect_interest', 'indirect_affection', true],
    ['我真的喜欢你', 'serious_romantic_intent', 'explicit_affection', false],
    ['我喜欢你，想认真和你在一起', 'serious_romantic_intent', 'relationship_proposal', false],
  ])('classifies %s by latent intent', (text, intent, category, clarification) => {
    const result = analyzeRelationalSpeech(text);
    expect(result.latentIntent).toBe(intent);
    expect(result.suggestedEventCategory).toBe(category);
    expect(result.requiresClarification).toBe(clarification);
  });

  it('does not treat quoted affection as a user confession', () => {
    const result = analyzeRelationalSpeech('她说她喜欢我，我不知道怎么办');
    expect(result.quotedSpeech).toBe(true);
    expect(result.suggestedEventCategory).toBeNull();
  });

  it('treats friendship boundaries as strong rejection evidence', () => {
    const result = analyzeRelationalSpeech('我喜欢你，但我们还是只做朋友吧');
    expect(result.boundarySignal).toBe('closed');
    expect(result.suggestedEventCategory).toBe('boundary_rejection');
  });

  it('does not convert emotional dependency into romantic evidence', () => {
    const result = analyzeRelationalSpeech('现在只有你愿意听我说这些');
    expect(result.latentIntent).toBe('emotional_dependency');
    expect(result.suggestedEventCategory).toBeNull();
  });

  it('uses prior consistency to adjust confidence without changing the speech act', () => {
    const low = analyzeRelationalSpeech('我好像有点喜欢你', { contradictorySignals: 3 });
    const high = analyzeRelationalSpeech('我好像有点喜欢你', { compatibleSignals: 3 });
    expect(high.confidence).toBeGreaterThan(low.confidence);
    expect(high.suggestedEventCategory).toBe(low.suggestedEventCategory);
  });
});
