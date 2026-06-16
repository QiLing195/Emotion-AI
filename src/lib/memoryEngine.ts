import { EmotionState, getDominantEmotion } from './emotionEngine';

// Simple BM25-like keyword extraction and scoring
function extractKeywords(text: string): string[] {
  const cleanText = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const keywords = new Set<string>();

  for (let i = 0; i < cleanText.length - 2; i++) {
    keywords.add(cleanText.substring(i, i + 3));
  }

  return Array.from(keywords);
}

function calculateRelevance(memory: any, keywords: string[]): number {
  let score = 0;
  const memoryText = memory.content.toLowerCase();

  for (const keyword of keywords) {
    if (memoryText.includes(keyword.toLowerCase())) {
      score += keyword.length;
    }
  }

  if (memory.type === 'preference') score *= 1.5;
  if (memory.type === 'ai_experience') score *= 1.2;

  return score;
}

/** Keywords associated with each emotion for memory retrieval weighting. */
const EMOTION_MEMORY_KEYWORDS: Record<string, string[]> = {
  joy: ['开心', '高兴', '快乐', '哈哈', '美好', '幸福', '棒', '喜欢'],
  sad: ['难过', '伤心', '哭', '悲伤', '失落', '痛苦', '累', '疲惫'],
  anger: ['生气', '愤怒', '烦', '讨厌', '不爽', '无语', '可恶'],
  fear: ['害怕', '担心', '焦虑', '紧张', '不安', '慌', '恐惧'],
  love: ['爱', '温暖', '甜蜜', '心动', '幸福', '想', '亲', '抱'],
  disgust: ['恶心', '反感', '讨厌'],
  calm: ['平静', '放松', '安心', '舒服', '自在', '安宁'],
  lust: ['心跳', '渴望', '冲动', '诱惑', '迷人'],
  greed: ['想要', '渴望', '贪', '更多'],
};

function calculateTimeDecay(createdAt: string): number {
  const memoryDate = new Date(createdAt).getTime();
  const daysOld = Math.max(0, (Date.now() - memoryDate) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, daysOld / 30);
}

// Cosine similarity for embeddings
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function retrieveRelevantMemories(
  memories: any[],
  currentMessage: string,
  maxMemories: number = 20,
  queryEmbedding?: number[],
  emotionState?: EmotionState,
): any[] {
  if (!memories || memories.length === 0) return [];

  const sortedByTime = [...memories].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const recentMemories = sortedByTime.slice(0, 5);
  const recentIds = new Set(recentMemories.map(m => m.id));

  const keywords = extractKeywords(currentMessage);

  const scoredMemories = memories
    .filter(m => !recentIds.has(m.id))
    .map(memory => {
      let relevanceScore = 0;
      if (queryEmbedding && memory.embedding) {
        // Use semantic similarity if embeddings are available
        relevanceScore = cosineSimilarity(queryEmbedding, memory.embedding) * 10; // Scale up to match keyword scoring range roughly
      } else {
        // Fallback to keyword matching
        relevanceScore = calculateRelevance(memory, keywords);
      }

      // Emotion-weighted boost: memories matching current emotional tone
      // are more likely to be retrieved
      if (emotionState) {
        const dominant = getDominantEmotion(emotionState.emotions);
        if (dominant.intensity > 0.3) {
          const emotionKw = EMOTION_MEMORY_KEYWORDS[dominant.name] ?? [];
          let emotionScore = 0;
          for (const kw of emotionKw) {
            if (memory.content.toLowerCase().includes(kw)) emotionScore += 0.15;
          }
          if (dominant.name === 'sad' && (memory.type === 'event' || memory.type === 'ai_experience')) {
            emotionScore += 0.1; // sad events leave stronger traces
          }
          relevanceScore += emotionScore * 3;
        }
      }

      const timeDecay = calculateTimeDecay(memory.createdAt);
      const finalScore = relevanceScore > 0 ? relevanceScore * timeDecay : 0;
      return { memory, score: finalScore };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const relevantMemories = scoredMemories
    .slice(0, maxMemories - recentMemories.length)
    .map(item => item.memory);

  const finalSelection = [...recentMemories, ...relevantMemories];

  return finalSelection.sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

// Memory Decay and Tiering Logic
export function updateMemoryTiers(memories: any[]): any[] {
  const now = new Date().getTime();
  const updatedMemories = [...memories];
  let changed = false;

  for (let i = 0; i < updatedMemories.length; i++) {
    const memory = updatedMemories[i];
    const lastAccessed = memory.lastAccessedAt ? new Date(memory.lastAccessedAt).getTime() : new Date(memory.createdAt).getTime();
    const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
    const accessCount = memory.accessCount || 0;

    let newTier = memory.tier;

    // Decay: Hot -> Warm if not accessed in 30 days
    if (memory.tier === 'hot' && daysSinceAccess > 30) {
      newTier = 'warm';
    }
    // Decay: Warm -> Cold if not accessed in 90 days
    else if (memory.tier === 'warm' && daysSinceAccess > 90) {
      newTier = 'cold';
    }
    // Promote: Warm/Cold -> Hot if accessed frequently recently
    else if ((memory.tier === 'warm' || memory.tier === 'cold') && accessCount > 5 && daysSinceAccess < 7) {
      newTier = 'hot';
    }

    if (newTier !== memory.tier) {
      updatedMemories[i] = { ...memory, tier: newTier };
      changed = true;
    }
  }

  return changed ? updatedMemories : memories;
}