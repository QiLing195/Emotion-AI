import { describe, expect, it } from 'vitest';
import { recallMemoryForTurn } from '../memoryRecallStage';
import type { MemoryItem } from '../unifiedMemory';
import type { EmotionState } from '../emotionEngine';

function emotionState(): EmotionState {
  return {
    taiji: { valence: 0, arousal: 0, expectation: 0 },
    yinyang: { approachBias: 0, avoidBias: 0, reversalPressure: 0, extremityDuration: 0 },
    sancai: { A: 0, B: 0, R: 0, harmony: 0 },
    evolution: {
      baseline: 0, empathy: 50, optimism: 50, trust: 50, openness: 50, playfulness: 50,
      sensitivity: 0.5, resilience: 0.5, valuePriorities: {}, lastIdentityRefresh: 0,
      fastRate: 0, mediumRate: 0, slowRate: 0, totalInteractions: 0, positiveInteractions: 0, negativeInteractions: 0,
    },
    emotions: {}, metaEmotions: { shame: 0, despair: 0, confusion: 0 }, compositeEmotions: [],
    intimacyToUser: 0, intimacyFromUser: 0,
    reinforcement: { rewardTally: 0, greedDrive: 0, punishmentTally: 0, fearAvoidance: 0 },
  };
}

function memory(emotionalMatch: string | null, relevanceScore: number): MemoryItem {
  return {
    id: emotionalMatch ?? 'neutral', source: 'episodic', content: 'memory', relevanceScore,
    emotionalMatch, timestamp: 1, metadata: {},
  };
}

describe('recallMemoryForTurn', () => {
  it('applies the Shadow bias only to negative memories and preserves traversal order', () => {
    const sourceItems = [memory('sad', 0.5), memory('fear', 0.8), memory('joy', 0.5), memory(null, 0.4)];
    const graph = {
      traverse: () => ({
        activatedNodes: sourceItems.map((item, depth) => ({
          node: {
            id: item.id, source: 'episodic', content: item.content, tags: [],
            emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: item.emotionalMatch ?? 'calm' },
            weight: 1, createdAt: 1, lastActivatedAt: 1, activationCount: 0, decayRate: 1,
            sourceId: item.id, metadata: {}, archived: false,
          },
          activation: item.relevanceScore,
          depth,
        })),
        visitedCount: sourceItems.length,
        sources: { episodic: sourceItems.length, semantic: 0, discovery: 0, thought: 0 },
      }),
    };

    const result = recallMemoryForTurn({
      graph: graph as never,
      text: 'test',
      emotionState: emotionState(),
      shadowMemoryModulation: { negativityBias: 0.2, selectiveAttention: [] },
      traversal: { maxDepth: 2, maxResults: 5 },
    });

    expect(result.map(item => item.id)).toEqual(['sad', 'fear', 'joy', 'neutral']);
    expect(result.map(item => item.relevanceScore)).toEqual([0.6, 0.96, 0.5, 0.4]);
    expect(sourceItems[0].relevanceScore).toBe(0.5);
  });

  it('does not boost at or below the existing threshold and caps scores at one', () => {
    const sourceItems = [memory('anger', 0.9)];
    const graph = {
      traverse: () => ({
        activatedNodes: sourceItems.map(item => ({
          node: {
            id: item.id, source: 'episodic', content: item.content, tags: [],
            emotionalSignature: { valence: 0, arousal: 0, dominantEmotion: 'anger' },
            weight: 1, createdAt: 1, lastActivatedAt: 1, activationCount: 0, decayRate: 1,
            sourceId: item.id, metadata: {}, archived: false,
          },
          activation: item.relevanceScore, depth: 0,
        })),
        visitedCount: 1,
        sources: { episodic: 1, semantic: 0, discovery: 0, thought: 0 },
      }),
    };

    const atThreshold = recallMemoryForTurn({
      graph: graph as never, text: 'test', emotionState: emotionState(),
      shadowMemoryModulation: { negativityBias: 0.1, selectiveAttention: [] },
    });
    const aboveThreshold = recallMemoryForTurn({
      graph: graph as never, text: 'test', emotionState: emotionState(),
      shadowMemoryModulation: { negativityBias: 0.2, selectiveAttention: [] },
    });

    expect(atThreshold[0].relevanceScore).toBe(0.9);
    expect(aboveThreshold[0].relevanceScore).toBe(1);
  });
});
