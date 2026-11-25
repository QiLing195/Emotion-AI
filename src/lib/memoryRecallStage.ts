import type { EmotionState } from './emotionEngine';
import { queryMemoryGraph, type MemoryGraph, type TraversalConfig } from './memoryGraph';
import type { MemoryItem } from './unifiedMemory';
import type { MemoryModulation } from './shadowLayer';

export interface MemoryRecallStageInput {
  graph: MemoryGraph;
  text: string;
  emotionState: EmotionState;
  shadowMemoryModulation: MemoryModulation;
  traversal?: Partial<TraversalConfig>;
}

/**
 * Recalls graph memories for a turn, then applies Shadow's existing negative-memory bias.
 * Graph traversal may update activation metadata on the graph; the returned MemoryItems
 * are adjusted independently and preserve traversal order, matching the previous behavior.
 */
export function recallMemoryForTurn(input: MemoryRecallStageInput): MemoryItem[] {
  const items = queryMemoryGraph(
    input.graph,
    { text: input.text, emotionState: input.emotionState },
    input.traversal,
  );

  const bias = input.shadowMemoryModulation.negativityBias;
  if (bias <= 0.1) return items;

  return items.map(item => {
    if (item.emotionalMatch !== 'sad' && item.emotionalMatch !== 'fear' && item.emotionalMatch !== 'anger') {
      return item;
    }
    return { ...item, relevanceScore: Math.min(1, item.relevanceScore * (1 + bias)) };
  });
}
