// ── v1.0 统一记忆召回 (Unified Memory Retrieval) ──
// 单一入口 recall() 查询所有记忆来源，返回排序去重结果
//
// 记忆来源：
//   1. 情景记忆 (episodic) — 关键情感时刻的叙事片段
//   2. 语义记忆 (semantic) — 已学习的偏好/事实
//   3. 好奇心发现 (curiosity) — Web/AI 探索产生的知识
//   4. 认知模式 (pattern) — 兴趣集群与共现模式
//
// 排序策略：
//   - 默认：情感一致性 + 时间衰减（零依赖，始终可用）
//   - 增强：embedding 余弦相似度（需要 API key，可选）

import type { EmotionState } from './emotionEngine';
import { activationOf } from './emotionActivation';
import type { EpisodicMemoryStore, EpisodicMemory } from './episodicMemory';
import { recallRelevantMemoriesScored } from './episodicMemory';
import type { Discovery } from '../curiosity/types';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type MemorySource = 'episodic' | 'semantic' | 'curiosity' | 'pattern';

export interface MemoryItem {
  id: string;
  source: MemorySource;
  /** 可展示的文本内容 */
  content: string;
  /** 相关性分数 [0, 1] */
  relevanceScore: number;
  /** 情感匹配标签（如果与当前情绪相关） */
  emotionalMatch: string | null;
  timestamp: number;
  /** 来源特定的元数据 */
  metadata: Record<string, any>;
}

export interface RecallQuery {
  /** 用户当前消息（用于关键词/语义匹配） */
  text: string;
  /** 当前情感状态（用于情感一致性排序） */
  emotionState: EmotionState;
  /** 最大返回条数 */
  maxResults?: number;
  /** 各来源的最大条数 */
  sourceCaps?: Partial<Record<MemorySource, number>>;
  /** 预计算的查询 embedding（可选，增强语义匹配） */
  queryEmbedding?: number[];
  /** 语义记忆池（由 server 注入） */
  semanticMemories?: SemanticMemoryEntry[];
  /** 好奇心发现池（由 server 注入） */
  curiosityDiscoveries?: Discovery[];
  /** 认知模式池（由 server 注入） */
  patternCandidates?: PatternMemoryEntry[];
}

export interface RecallResult {
  items: MemoryItem[];
  /** 各来源贡献 */
  sources: Record<MemorySource, number>;
  /** 总耗时（ms） */
  latencyMs: number;
}

export interface SemanticMemoryEntry {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  embedding?: number[];
  tags?: string[];
}

export interface PatternMemoryEntry {
  topic: string;
  relatedTopics: string[];
  cooccurrence: number;
}

// ════════════════════════════════════════════════════════════
// 2. 默认配置
// ════════════════════════════════════════════════════════════

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_SOURCE_CAPS: Record<MemorySource, number> = {
  episodic: 4,
  semantic: 3,
  curiosity: 2,
  pattern: 1,
};

// ════════════════════════════════════════════════════════════
// 3. 核心召回函数
// ════════════════════════════════════════════════════════════

export function recall(
  episodicStore: EpisodicMemoryStore,
  query: RecallQuery,
): RecallResult {
  const t0 = Date.now();
  const caps = { ...DEFAULT_SOURCE_CAPS, ...query.sourceCaps };
  // v1.20：改用**激活态**读数。原来这里是 `getDominantEmotion(...name)`（绝对值 argmax），
  // 而 calm 的人格基调就是 0.8，于是 `dominant.name` 几乎永远是 'calm' ——
  // 「按情绪召回」彻底退化成「按文本召回」：静息记忆恒拿 ×1.5 情感一致性加分、
  // 标签加分永远查 `getRelatedTags('calm')`，另一面真正被激起的 love/sad 反而召不回同类记忆。
  // 与 v1.16 在 `memoryGraph.traverse` / `dialogueStrategy.selectRedirectTopic` 修的是同一个病。
  // 静息时 name 用 'resting'（不是任何情绪键）→ 各项情绪加分自然全部不成立，这是对的。
  const activation = activationOf(query.emotionState);
  const dominant = {
    name: activation.activeEmotion ?? 'resting',
    intensity: activation.activeIntensity,
  };

  const items: MemoryItem[] = [];

  // ── 来源 1: 情景记忆 ──
  const episodicItems = recallEpisodic(episodicStore, dominant, caps.episodic, query.queryEmbedding);
  items.push(...episodicItems);

  // ── 来源 2: 语义记忆 ──
  if (query.semanticMemories && query.semanticMemories.length > 0) {
    const semanticItems = recallSemantic(
      query.semanticMemories,
      query.text,
      dominant,
      caps.semantic,
      query.queryEmbedding,
    );
    items.push(...semanticItems);
  }

  // ── 来源 3: 好奇心发现 ──
  if (query.curiosityDiscoveries && query.curiosityDiscoveries.length > 0) {
    const curiosityItems = recallCuriosity(
      query.curiosityDiscoveries,
      query.text,
      dominant,
      caps.curiosity,
    );
    items.push(...curiosityItems);
  }

  // ── 来源 4: 认知模式 ──
  if (query.patternCandidates && query.patternCandidates.length > 0) {
    const patternItems = recallPatterns(
      query.patternCandidates,
      query.text,
      caps.pattern,
    );
    items.push(...patternItems);
  }

  // ── 全局排序 + 去重 ──
  const ranked = rankAndDedupe(items, query.maxResults ?? DEFAULT_MAX_RESULTS);

  // 统计来源
  const sources: Record<MemorySource, number> = {
    episodic: 0, semantic: 0, curiosity: 0, pattern: 0,
  };
  for (const item of ranked) {
    sources[item.source]++;
  }

  return { items: ranked, sources, latencyMs: Date.now() - t0 };
}

// ════════════════════════════════════════════════════════════
// 4. 来源特定召回
// ════════════════════════════════════════════════════════════

function recallEpisodic(
  store: EpisodicMemoryStore,
  dominant: { name: string; intensity: number },
  cap: number,
  queryEmbedding?: number[],
): MemoryItem[] {
  const scored = recallRelevantMemoriesScored(store, dominant, cap, queryEmbedding);
  return scored
    // 空叙事不算记忆（v1.13 把"自相矛盾"的旧叙事清空后留下的条目会变成一条空 bullet）
    .filter(s => (s.episode.narrativeFragment ?? '').length > 0)
    .map(({ episode: ep, score }) => ({
      id: ep.id,
      source: 'episodic' as const,
      content: ep.narrativeFragment,
      // v1.20：这里原来写的是裸 `ep.recallWeight` —— 而 `rankAndDedupe` 会按这个字段**重排**，
      // 于是上面算出来的「情感一致性 ×1.5 / 标签重合 / 时间衰减」在最终顺序里被整体丢掉
      // （只有"进前 cap 名"那一刀还看得到它们）。改成用真正算出来的分。
      relevanceScore: Math.min(1, score),
      emotionalMatch: ep.emotionalImpact.dominantEmotion,
      timestamp: ep.timestamp,
      metadata: {
        tags: ep.tags,
        valenceDelta: ep.emotionalImpact.valenceDelta,
        arousalPeak: ep.emotionalImpact.arousalPeak,
      },
    }));
}

function recallSemantic(
  memories: SemanticMemoryEntry[],
  queryText: string,
  dominant: { name: string; intensity: number },
  cap: number,
  queryEmbedding?: number[],
): MemoryItem[] {
  const keywords = extractKeywords(queryText);
  const emotionKw = EMOTION_MEMORY_KEYWORDS[dominant.name] ?? [];

  const now = Date.now();

  const scored = memories.map(m => {
    let score = 0;

    // 语义相似度（如果 embedding 可用）
    if (queryEmbedding && m.embedding && m.embedding.length > 0) {
      score += cosineSimilarity(queryEmbedding, m.embedding) * 10;
    }

    // 关键词匹配（fallback/增强）
    for (const kw of keywords) {
      if (m.content.includes(kw)) score += kw.length * 0.3;
    }

    // 情绪一致性
    for (const ekw of emotionKw) {
      if (m.content.includes(ekw)) score += 2;
    }

    // 时间衰减
    const daysOld = m.createdAt
      ? (now - new Date(m.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      : 30;
    score *= Math.pow(0.5, daysOld / 30);

    // 类型权重
    if (m.type === 'preference') score *= 1.5;
    if (m.type === 'ai_experience') score *= 1.2;

    return { memory: m, score };
  });

  return scored
    .filter(s => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(s => ({
      id: s.memory.id,
      source: 'semantic' as const,
      content: s.memory.content.slice(0, 200),
      relevanceScore: Math.min(1, s.score / 20),
      emotionalMatch: dominant.intensity > 0.3 ? dominant.name : null,
      timestamp: s.memory.createdAt ? new Date(s.memory.createdAt).getTime() : 0,
      metadata: { type: s.memory.type, tags: s.memory.tags },
    }));
}

function recallCuriosity(
  discoveries: Discovery[],
  queryText: string,
  dominant: { name: string; intensity: number },
  cap: number,
): MemoryItem[] {
  const keywords = extractKeywords(queryText);

  const scored = discoveries.map(d => {
    let score = 0;

    // 话题匹配
    for (const kw of keywords) {
      if (d.topic.includes(kw) || d.title.includes(kw) || d.content.includes(kw)) {
        score += kw.length * 0.4;
      }
    }

    // 质量权重
    score *= (0.5 + d.quality * 0.5);

    // 未分享的发现加分（新鲜度）
    if (!d.shared) score *= 1.3;

    // 时间衰减
    const daysOld = (Date.now() - d.timestamp) / (1000 * 60 * 60 * 24);
    score *= Math.pow(0.5, daysOld / 14); // 发现衰减比记忆快

    return { discovery: d, score };
  });

  return scored
    .filter(s => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(s => ({
      id: s.discovery.id,
      source: 'curiosity' as const,
      content: `${s.discovery.title}: ${s.discovery.content.slice(0, 120)}`,
      relevanceScore: Math.min(1, s.score / 15),
      emotionalMatch: null,
      timestamp: s.discovery.timestamp,
      metadata: { topic: s.discovery.topic, sourceType: s.discovery.sourceType, quality: s.discovery.quality },
    }));
}

function recallPatterns(
  patterns: PatternMemoryEntry[],
  queryText: string,
  cap: number,
): MemoryItem[] {
  const scored = patterns.map(p => {
    let score = 0;
    // 用话题名直接匹配查询文本（中文话题名被 trigram 切割会失效）
    const allTopics = [p.topic, ...p.relatedTopics];
    for (const topic of allTopics) {
      if (queryText.includes(topic)) score += 3;
    }
    score *= (0.5 + p.cooccurrence * 0.5);
    return { pattern: p, score };
  });

  return scored
    .filter(s => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map(s => ({
      id: `pattern_${s.pattern.topic}`,
      source: 'pattern' as const,
      content: `兴趣集群: ${s.pattern.topic} ↔ ${s.pattern.relatedTopics.slice(0, 3).join(', ')}`,
      relevanceScore: Math.min(1, s.score / 10),
      emotionalMatch: null,
      timestamp: 0,
      metadata: { topic: s.pattern.topic, relatedTopics: s.pattern.relatedTopics },
    }));
}

// ════════════════════════════════════════════════════════════
// 5. 排序与去重
// ════════════════════════════════════════════════════════════

function rankAndDedupe(items: MemoryItem[], maxResults: number): MemoryItem[] {
  // 按分数降序
  const sorted = [...items].sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 去重：移除内容高度相似的项目（Jaccard 近似）
  const deduped: MemoryItem[] = [];
  const seenTokens = new Set<string>();

  for (const item of sorted) {
    const tokens = extractKeywords(item.content);
    const overlap = tokens.filter(t => seenTokens.has(t)).length;
    // 如果重叠超过 30%，跳过
    if (tokens.length > 0 && overlap / tokens.length > 0.3) continue;

    for (const t of tokens) seenTokens.add(t);
    deduped.push(item);
  }

  return deduped.slice(0, maxResults);
}

// ════════════════════════════════════════════════════════════
// 6. 共享工具（与 memoryEngine 保持一致）
// ════════════════════════════════════════════════════════════

function extractKeywords(text: string): string[] {
  const cleanText = text.replace(/[^一-龥a-zA-Z0-9]/g, '');
  const keywords = new Set<string>();
  // 完整词（直接包含匹配）
  if (cleanText.length >= 1) keywords.add(cleanText); // 完整文本
  // tri-grams（语义窗口）
  for (let i = 0; i < cleanText.length - 2; i++) {
    keywords.add(cleanText.substring(i, i + 3));
  }
  // bi-grams（短词兼容：2 字中文词如 火锅/摄影/旅行）
  for (let i = 0; i < cleanText.length - 1; i++) {
    keywords.add(cleanText.substring(i, i + 2));
  }
  return Array.from(keywords);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const EMOTION_MEMORY_KEYWORDS: Record<string, string[]> = {
  joy: ['开心', '高兴', '快乐', '哈哈', '美好', '幸福'],
  sad: ['难过', '伤心', '哭', '悲伤', '失落', '痛苦'],
  anger: ['生气', '愤怒', '烦', '讨厌', '不爽'],
  fear: ['害怕', '担心', '焦虑', '紧张', '不安'],
  love: ['爱', '温暖', '甜蜜', '心动', '幸福'],
  disgust: ['恶心', '反感', '讨厌'],
  calm: ['平静', '放松', '安心', '舒服', '自在'],
  lust: ['心跳', '渴望', '冲动', '诱惑'],
  greed: ['想要', '渴望', '贪', '更多'],
};
