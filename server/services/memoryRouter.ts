/**
 * 统一记忆路由 (Memory Router)
 *
 * 三条独立路径 + 一个聚合器，替代碎片化的记忆注入：
 *   路径1 身份 (Identity):  从语义记忆提取用户名/AI昵称 — 始终注入
 *   路径2 事实 (Facts):     从语义记忆召回与当前话题相关的事实
 *   路径3 情景 (Episodes):  从情景记忆召回与当前情绪匹配的情景
 */

import type { EpisodicMemoryStore } from '../../src/lib/episodicMemory.js';

// ─── 类型 ───

export interface IdentityFact {
  type: 'user_name' | 'ai_nickname';
  text: string;
}

export interface TopicFact {
  text: string;
  relevance: number;
  valence: number;
}

export interface EpisodicRecall {
  narrative: string;
  eventSummary: string;
  emotion: string;
  weight: number;
}

export interface MemoryBlock {
  identity: IdentityFact[];
  facts: TopicFact[];
  episodes: EpisodicRecall[];
  isEmpty: boolean;
}

// ─── 同义词映射 ───

const SYNONYM_MAP: Record<string, string[]> = {
  '音乐': ['歌', '歌曲', '听歌', '旋律', '曲子', '乐', '唱'],
  '难过': ['伤心', '悲伤', '难受', '忧郁', '低落', '不开心', '哭', '痛苦', '郁闷'],
  '开心': ['快乐', '高兴', '喜悦', '欢喜', '幸福', '乐', '笑'],
  '喜欢': ['爱', '喜爱', '偏好', '中意', '钟情', '爱好'],
  '讨厌': ['恨', '不喜欢', '烦', '厌恶', '反感'],
  '电影': ['影片', '看片', '剧', '影视'],
  '书': ['读书', '看书', '阅读', '小说', '文学'],
  '游戏': ['玩', '打游戏', '手游', '端游'],
  '工作': ['上班', '打工', '搬砖', '职业', '干活'],
  '朋友': ['闺蜜', '兄弟', '伙伴', '知己', '好友'],
  '食物': ['吃', '美食', '好吃', '火锅', '饭', '菜', '甜品', '甜点'],
  '旅行': ['旅游', '出去玩', '度假', '海滩', '海边', '山', '景点'],
  '运动': ['跑步', '健身', '锻炼', '打球', '游泳'],
  '家': ['家里', '回家', '住处', '窝'],
};

function expandSynonyms(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    for (const [root, syns] of Object.entries(SYNONYM_MAP)) {
      if (root === kw || syns.includes(kw)) {
        expanded.add(root);
        for (const s of syns) expanded.add(s);
      }
    }
  }
  return [...expanded];
}

// ─── 路径 1: 身份记忆 ───

function extractIdentity(semanticMemory: Map<string, any>): IdentityFact[] {
  const results: IdentityFact[] = [];
  for (const [key, val] of semanticMemory) {
    const v = val as any;
    const totalV = v.totalValence ?? 0;
    if (/^(?:你好[,，]?)?我叫.{1,8}$|^我是.{1,8}$/.test(key) && totalV > 0) {
      results.push({ type: 'user_name', text: key });
    }
    if (/(?:以后|可以|就|想)?叫你?.{1,6}(?:吧|吗|呀|哦|啦)?$/.test(key) && totalV > 0) {
      results.push({ type: 'ai_nickname', text: key });
    }
  }
  return results.slice(0, 2);
}

// ─── 路径 2: 事实记忆 ───

function extractChineseKeywords(text: string): string[] {
  const cleaned = text.replace(/[，。！？、；：""''（）\s]+/g, ' ').trim();
  // Bigram + Trigram 中文分词
  const chineseOnly = cleaned.replace(/[^一-鿿]/g, '');
  const keywords: string[] = [];

  // Bigram
  for (let i = 0; i < chineseOnly.length - 1; i++) {
    keywords.push(chineseOnly.substring(i, i + 2));
  }
  // Trigram
  for (let i = 0; i < chineseOnly.length - 2; i++) {
    keywords.push(chineseOnly.substring(i, i + 3));
  }

  // 也保留空格分隔的整词
  const words = cleaned.split(' ');
  for (const w of words) {
    if (w.length >= 2 && /[一-鿿]/.test(w)) {
      keywords.push(w);
    }
  }

  return [...new Set(keywords)].slice(0, 10);
}

function recallFacts(
  message: string,
  semanticMemory: Map<string, any>,
  maxResults: number = 3,
): TopicFact[] {
  const rawKeywords = extractChineseKeywords(message);
  if (rawKeywords.length === 0) return [];
  const keywords = expandSynonyms(rawKeywords);

  const scored: TopicFact[] = [];
  const seen = new Set<string>();

  for (const [key, val] of semanticMemory) {
    if (seen.has(key)) continue;
    const v = val as any;
    const totalV = v.totalValence ?? 0;

    // 跳过问候、基础问答、过短消息
    if (key.length < 6) continue;
    if (/^(你好|hi|hello|嗨|在吗|嗯|哦|好|ok|你叫什么|你是谁|你是(?!不是)).{0,10}$/i.test(key)) continue;
    // 跳过身份类（已由路径1处理）
    if (/^我叫|^我是|叫你/.test(key)) continue;

    // 关键词匹配度（BM25 密度）
    let matchCount = 0;
    for (const kw of keywords) {
      if (key.includes(kw)) matchCount++;
    }
    if (matchCount === 0) continue;

    const density = matchCount / Math.max(key.length, 1);
    // 综合评分：匹配密度 × 情感显著性
    const score = density * 0.5 + Math.abs(totalV) * 0.3 + (v.occurrences ?? 1) * 0.1;
    if (score > 0.05) {
      seen.add(key);
      scored.push({ text: key, relevance: Math.min(score, 1), valence: totalV });
    }
  }

  scored.sort((a, b) => b.relevance - a.relevance);
  return scored.slice(0, maxResults);
}

// ─── 路径 3: 情景记忆 ───

function recallEpisodes(
  store: EpisodicMemoryStore,
  currentEmotion: { dominant: string; arousal: number },
  maxResults: number = 2,
): EpisodicRecall[] {
  if (store.episodes.length === 0) return [];

  const scored = store.episodes.map(ep => {
    let score = ep.recallWeight;

    if (ep.emotionalImpact.dominantEmotion === currentEmotion.dominant) {
      score *= 1.3;
    }
    if (currentEmotion.arousal > 0.5 && ep.emotionalImpact.arousalPeak > 0.6) {
      score *= 1.2;
    }

    const daysOld = (Date.now() - ep.timestamp) / (1000 * 60 * 60 * 24);
    score *= Math.pow(0.5, daysOld / 7);

    return { episode: ep, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, maxResults).map(s => ({
    narrative: s.episode.narrativeFragment,
    eventSummary: s.episode.eventSummary,
    emotion: s.episode.emotionalImpact.dominantEmotion,
    weight: s.episode.recallWeight,
  }));
}

// ─── 主入口 ───

export function routeMemory(
  message: string,
  semanticMemory: Map<string, any>,
  episodicStore: EpisodicMemoryStore,
  currentEmotion: { dominant: string; arousal: number },
  isShortMessage: boolean,
): MemoryBlock {
  const identity = extractIdentity(semanticMemory);

  if (isShortMessage) {
    return { identity, facts: [], episodes: [], isEmpty: identity.length === 0 };
  }

  const facts = recallFacts(message, semanticMemory, 3);
  const episodes = recallEpisodes(episodicStore, currentEmotion, 2);

  return {
    identity, facts, episodes,
    isEmpty: identity.length === 0 && facts.length === 0 && episodes.length === 0,
  };
}

/**
 * 将 MemoryBlock 格式化为 workspace 注入文本
 */
export function formatMemoryBlock(block: MemoryBlock): string | null {
  if (block.isEmpty) return null;

  const lines: string[] = [];
  lines.push('【记忆上下文 — 以下是真实的对话历史，不要编造】');

  if (block.identity.length > 0) {
    for (const id of block.identity) {
      if (id.type === 'user_name') lines.push(`对方的名字：${id.text}`);
      if (id.type === 'ai_nickname') lines.push(`对方叫你：${id.text}`);
    }
  }

  if (block.facts.length > 0) {
    lines.push('你们聊过这些（真实对话片段）：');
    for (const f of block.facts) {
      lines.push(`• ${f.text}`);
    }
  }

  if (block.episodes.length > 0) {
    lines.push('相关的记忆片段：');
    for (const e of block.episodes) {
      lines.push(`- ${e.narrative}`);
    }
  }

  lines.push('→ 只能引用上面列出的事实，不要编造上面没有的人、事、地点或经历。');

  return lines.join('\n');
}
