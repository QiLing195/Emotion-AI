// v5.1: Sprint B-1 — 三维成熟度模型
// 只做 Interest → PatternCandidate / PatternConfirmed
// 不碰 Insight / Discovery / Context Assembly

import type { Interest } from './types.js';
import { getExplorationCountToday, getExplorationDayKey, setExplorationCountToday, setExplorationDayKey } from './state.js';
import type { EmotionContext } from '../types/shared.js';

// ════════════════════════════════════════════════════════════
// 0. 宏六爻 — 兴趣模式生命周期（闭环+复活）
// ════════════════════════════════════════════════════════════

/** 模式生命周期阶段 — 闭环，支持复苏 */
export enum PatternLifecycle {
  EMERGING = 'emerging',       // 萌芽 — 新兴趣刚刚出现
  GROWING = 'growing',         // 生长 — 频次和关联在增长
  ESTABLISHED = 'established', // 稳固 — 成熟模式，情绪签名稳定
  DORMANT = 'dormant',         // 休眠 — 长期未提及，情感淡化
  REACTIVATED = 'reactivated', // 复苏 — 沉睡模式被重新唤醒
  ARCHIVED = 'archived',       // 归藏 — 超过阈值未提及，不再主动检索
}

// ════════════════════════════════════════════════════════════
// 1. 配置 — 所有阈值集中管理，通过 Discovery Yield 反馈调参
// ════════════════════════════════════════════════════════════

export const PatternConfig = {
  // 三维权重（和为 1.0）
  frequencyWeight: 0.4,
  persistenceWeight: 0.3,
  connectednessWeight: 0.3,

  // 成熟度门槛
  candidateScore: 0.45,
  confirmedScore: 0.75,

  // Frequency 归一化基准
  minFrequencyForCandidate: 3,

  // Persistence 参数
  persistenceWindowMs: 24 * 60 * 60 * 1000, // 时间窗口 = 1 天

  // Connectedness 参数
  cooccurWindowMs: 60 * 60 * 1000, // 共现窗口 = 1 小时（同一会话）
  minCooccurForEdge: 2,            // 至少共现 2 次才算有效边

  // Phase 1: 情绪加权参数（Emotion-Cognition Deep Coupling）
  semanticWeight: 0.4,             // 语义匹配权重
  emotionResonanceWeight: 0.4,     // 情绪共鸣权重（余弦相似度）
  driveAdjustmentWeight: 0.2,      // 驱动力调整权重
  neutralSignatureScore: 0.5,      // 无情绪签名时的中性得分 [0, 1]
  emotionalSignatureAlpha: 0.3,    // EMA 平滑系数（新情绪数据的权重）
};

// ════════════════════════════════════════════════════════════
// 2. 导出类型
// ════════════════════════════════════════════════════════════

export interface PatternCandidate {
  topic: string;
  frequency: number;
  persistence: number;       // 出现过的不同时间窗口数
  connectedness: number;     // 关联的邻居节点数
  maturityScore: number;     // 加权合成 0~1
  stage: 'candidate' | 'confirmed';
  neighbors: string[];       // 关联节点列表（可观测性）
  /** Phase 1: 情绪签名 — 该 pattern 被提及时的情绪向量 EMA 滑动平均 */
  emotionalSignature?: Record<string, number>;
  /** Phase 2: 模式生命周期阶段 */
  lifecycle: PatternLifecycle;
  /** 进入当前 lifecycle 阶段的时间戳 */
  lifecycleSince: number;
  /** 最后被提及的时间戳 */
  lastMentionedAt: number;
  /** 是否为复苏模式（从 DORMANT/ARCHIVED 重新激活） */
  isReactivated: boolean;
  computedAt: number;
}

// ════════════════════════════════════════════════════════════
// 3. 内部状态 — 原始 mention 日志 + 共现图
// ════════════════════════════════════════════════════════════

/** topic → mention timestamps */
const _mentions = new Map<string, number[]>();

/** "topicA||topicB" → co-occurrence count */
const _cooccur = new Map<string, number>();

// Phase 1: 情绪签名存储
/** topic → 各情绪维度的 EMA 累加值 */
const _topicEmotionSum = new Map<string, Record<string, number>>();
/** topic → 情绪记录次数（用于调试，不影响 EMA） */
const _topicEmotionCount = new Map<string, number>();

// Phase 2: 宏六爻生命周期存储
/** topic → 当前生命周期阶段 */
const _topicLifecycle = new Map<string, PatternLifecycle>();
/** topic → 进入当前阶段的起始时间戳 */
const _topicLifecycleSince = new Map<string, number>();
/** topic → 最后被提及的时间戳 */
const _topicLastMentioned = new Map<string, number>();

/**
 * 更新某个 topic 的情绪签名滑动平均（EMA）。
 * 每次 recordMention 时调用，使签名随对话积累而逐渐收敛。
 */
function updateEmotionalSignature(
  topic: string,
  newEmotions: Record<string, number>,
): void {
  const alpha = PatternConfig.emotionalSignatureAlpha;
  if (!_topicEmotionSum.has(topic)) {
    // 首次记录 → 直接用当前情绪作为初始签名
    const init: Record<string, number> = {};
    for (const key of Object.keys(newEmotions)) {
      init[key] = newEmotions[key];
    }
    _topicEmotionSum.set(topic, init);
    _topicEmotionCount.set(topic, 1);
    return;
  }
  const sum = _topicEmotionSum.get(topic)!;
  const count = _topicEmotionCount.get(topic)!;
  // EMA: newValue = oldValue * (1 - alpha) + incomingValue * alpha
  for (const key of Object.keys(newEmotions)) {
    sum[key] = (sum[key] || 0) * (1 - alpha) + newEmotions[key] * alpha;
  }
  _topicEmotionCount.set(topic, count + 1);
}

// ── 公开 API：外部调用以录入数据 ──

/**
 * 记录一次兴趣提及。应在 extractInterests() 返回结果后立即调用。
 * @param topics  本轮消息中检测到的所有兴趣
 * @param ts      消息时间戳（默认 Date.now()）
 */
export function recordMention(
  topics: string[],
  ts: number = Date.now(),
  emotionCtx?: EmotionContext,
): void {
  for (const topic of topics) {
    if (!_mentions.has(topic)) _mentions.set(topic, []);
    _mentions.get(topic)!.push(ts);
    // 上限保护
    if (_mentions.get(topic)!.length > 200) {
      _mentions.get(topic)!.shift();
    }
    // Phase 1: 记录情绪签名
    if (emotionCtx) {
      updateEmotionalSignature(topic, emotionCtx.primaryEmotions);
    }
    // Phase 2: 记录最后提及时间
    _topicLastMentioned.set(topic, ts);
  }

  // 记录共现
  if (topics.length >= 2) {
    for (let i = 0; i < topics.length; i++) {
      for (let j = i + 1; j < topics.length; j++) {
        const key = [topics[i], topics[j]].sort().join('||');
        _cooccur.set(key, (_cooccur.get(key) || 0) + 1);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// 4. 三维计算
// ════════════════════════════════════════════════════════════

/**
 * 维度 1：Frequency — 原始提及次数，归一化到 [0, 1]。
 * 以当前所有兴趣中的最高频次为基准。
 */
function computeFrequency(topic: string): number {
  const mentions = _mentions.get(topic);
  if (!mentions || mentions.length === 0) return 0;
  return mentions.length;
}

function normalizeFrequency(raw: number, allRaw: number[]): number {
  const max = Math.max(...allRaw, 1);
  return Math.min(1, raw / max);
}

/**
 * 维度 2：Persistence — 出现过的不同时间窗口数，归一化到 [0, 1]。
 * 窗口大小由 PatternConfig.persistenceWindowMs 定义（默认 1 天）。
 */
function computePersistence(topic: string, now: number): number {
  const mentions = _mentions.get(topic);
  if (!mentions || mentions.length === 0) return 0;

  const windowMs = PatternConfig.persistenceWindowMs;
  const windows = new Set<number>();
  for (const ts of mentions) {
    windows.add(Math.floor(ts / windowMs));
  }
  return windows.size;
}

function normalizePersistence(raw: number, allRaw: number[]): number {
  const max = Math.max(...allRaw, 1);
  return Math.min(1, raw / max);
}

/**
 * 维度 3：Connectedness — 该 topic 在共现图中连接的不同邻居节点数。
 * 归一化到 [0, 1]。
 */
function computeConnectedness(topic: string): { count: number; neighbors: string[] } {
  const neighbors = new Set<string>();
  for (const [key, count] of _cooccur) {
    if (count < PatternConfig.minCooccurForEdge) continue;
    const [a, b] = key.split('||');
    if (a === topic) neighbors.add(b);
    if (b === topic) neighbors.add(a);
  }
  return { count: neighbors.size, neighbors: [...neighbors] };
}

function normalizeConnectedness(raw: number, allRaw: number[]): number {
  const max = Math.max(...allRaw, 1);
  return Math.min(1, raw / max);
}

// ════════════════════════════════════════════════════════════
// 4b. 模式生命周期转换
// ════════════════════════════════════════════════════════════

/** 休眠阈值：N 天未提及 → 进入休眠 */
const DORMANT_DAYS = 30;
/** 归藏阈值：N 天未提及 → 进入归藏 */
const ARCHIVE_DAYS = 90;

/**
 * 根据当前成熟度、上次提及时间、上次生命周期阶段，计算新的生命周期阶段。
 * 支持复苏：ARCHIVED/DORMANT → REACTIVATED
 */
function computeLifecycle(
  topic: string,
  maturityScore: number,
  stage: 'candidate' | 'confirmed' | null,
  prevLifecycle: PatternLifecycle | undefined,
  prevLifecycleSince: number | undefined,
  lastMentionedAt: number | undefined,
  now: number,
): { lifecycle: PatternLifecycle; lifecycleSince: number; isReactivated: boolean } {
  const daysSinceLastMention = lastMentionedAt
    ? (now - lastMentionedAt) / (24 * 60 * 60 * 1000)
    : Infinity;
  const daysSincePhaseChange = prevLifecycleSince
    ? (now - prevLifecycleSince) / (24 * 60 * 60 * 1000)
    : 0;

  // ── 复苏检测（最高优先级）──
  // 如果之前处于休眠/归藏，且最近被提及（<7天），标记为复苏
  if (
    (prevLifecycle === PatternLifecycle.DORMANT || prevLifecycle === PatternLifecycle.ARCHIVED) &&
    daysSinceLastMention < 7 &&
    maturityScore >= PatternConfig.candidateScore
  ) {
    return {
      lifecycle: PatternLifecycle.REACTIVATED,
      lifecycleSince: now,
      isReactivated: true,
    };
  }

  // ── 归藏：超过阈值且已经是休眠/归藏 ──
  if (daysSinceLastMention > ARCHIVE_DAYS) {
    return {
      lifecycle: PatternLifecycle.ARCHIVED,
      lifecycleSince: prevLifecycle === PatternLifecycle.ARCHIVED ? (prevLifecycleSince || now) : now,
      isReactivated: false,
    };
  }

  // ── 休眠：超过阈值未提及（不限成熟度——ESTABLISHED 也会随时间休眠）──
  if (daysSinceLastMention > DORMANT_DAYS) {
    return {
      lifecycle: PatternLifecycle.DORMANT,
      lifecycleSince: prevLifecycle === PatternLifecycle.DORMANT ? (prevLifecycleSince || now) : now,
      isReactivated: false,
    };
  }

  // ── 正常流转 ──
  if (!stage || maturityScore < PatternConfig.candidateScore) {
    return {
      lifecycle: PatternLifecycle.EMERGING,
      lifecycleSince: prevLifecycle === PatternLifecycle.EMERGING ? (prevLifecycleSince || now) : now,
      isReactivated: false,
    };
  }

  if (maturityScore >= PatternConfig.confirmedScore) {
    return {
      lifecycle: PatternLifecycle.ESTABLISHED,
      lifecycleSince: prevLifecycle === PatternLifecycle.ESTABLISHED ? (prevLifecycleSince || now) : now,
      isReactivated: false,
    };
  }

  return {
    lifecycle: PatternLifecycle.GROWING,
    lifecycleSince: prevLifecycle === PatternLifecycle.GROWING ? (prevLifecycleSince || now) : now,
    isReactivated: false,
  };
}

// ════════════════════════════════════════════════════════════
// 5. 成熟度合成
// ════════════════════════════════════════════════════════════

function computeMaturityScore(
  fNorm: number,
  pNorm: number,
  cNorm: number,
): number {
  return (
    PatternConfig.frequencyWeight * fNorm +
    PatternConfig.persistenceWeight * pNorm +
    PatternConfig.connectednessWeight * cNorm
  );
}

function classifyStage(score: number): 'candidate' | 'confirmed' | null {
  if (score >= PatternConfig.confirmedScore) return 'confirmed';
  if (score >= PatternConfig.candidateScore) return 'candidate';
  return null;
}

// ════════════════════════════════════════════════════════════
// 6. 公开查询 API — 策略层只调用这些，不接触内部阈值
// ════════════════════════════════════════════════════════════

/**
 * 对所有已追踪的 Interest 运行成熟度评估，返回 PatternCandidate[]。
 * 应在对话轮次后或周期性（如每天一次）调用。
 *
 * @param interests  当前活跃的 Interest[]（来自 interestModel）
 * @param now        评估时间戳
 */
export function evaluatePatterns(
  interests: Interest[],
  now: number = Date.now(),
): PatternCandidate[] {
  if (interests.length === 0) return [];

  // 收集原始值
  const topics = interests.map(i => i.topic);
  const freqRaw = topics.map(t => computeFrequency(t));
  const persRaw = topics.map(t => computePersistence(t, now));
  const connResults = topics.map(t => computeConnectedness(t));
  const connRaw = connResults.map(c => c.count);

  // 归一化
  const fNorm = freqRaw.map(f => normalizeFrequency(f, freqRaw));
  const pNorm = persRaw.map(p => normalizePersistence(p, persRaw));
  const cNorm = connRaw.map(c => normalizeConnectedness(c, connRaw));

  // 合成 + 分类
  const results: PatternCandidate[] = [];
  for (let i = 0; i < topics.length; i++) {
    const score = computeMaturityScore(fNorm[i], pNorm[i], cNorm[i]);
    const stage = classifyStage(score);

    if (stage === null) continue; // 未达到 Candidate 门槛，不输出

    // Phase 1: 附加情绪签名（如果已有记录）
    const emotionSum = _topicEmotionSum.get(topics[i]);
    const emotionalSignature = emotionSum ? { ...emotionSum } : undefined;

    // Phase 2: 计算生命周期
    const lastMentioned = _topicLastMentioned.get(topics[i]) || 0;
    const prevLifecycle = _topicLifecycle.get(topics[i]);
    const prevLifecycleSince = _topicLifecycleSince.get(topics[i]);
    const { lifecycle, lifecycleSince, isReactivated } = computeLifecycle(
      topics[i], score, stage, prevLifecycle, prevLifecycleSince, lastMentioned, now,
    );
    // 持久化生命周期状态
    _topicLifecycle.set(topics[i], lifecycle);
    _topicLifecycleSince.set(topics[i], lifecycleSince);

    results.push({
      topic: topics[i],
      frequency: freqRaw[i],
      persistence: persRaw[i],
      connectedness: connRaw[i],
      maturityScore: Math.round(score * 1000) / 1000,
      stage,
      neighbors: connResults[i].neighbors.slice(0, 10),
      computedAt: now,
      emotionalSignature,
      lifecycle,
      lifecycleSince,
      lastMentionedAt: lastMentioned,
      isReactivated,
    });
  }

  // 按 maturityScore 降序
  results.sort((a, b) => b.maturityScore - a.maturityScore);

  // 日志输出（可观测性）
  for (const r of results) {
    console.log(
      `[Pattern] ${r.topic}: F=${r.frequency} P=${r.persistence} C=${r.connectedness} ` +
      `→ score=${r.maturityScore.toFixed(3)} → ${r.stage}` +
      (r.neighbors.length > 0 ? ` (neighbors: ${r.neighbors.join(', ')})` : ''),
    );
  }

  return results;
}

/** 返回所有 PatternCandidate（含 confirmed），按 score 降序 */
export function getPatternCandidates(
  interests: Interest[],
  now?: number,
): PatternCandidate[] {
  return evaluatePatterns(interests, now).filter(
    p => p.stage === 'candidate' || p.stage === 'confirmed',
  );
}

/** 只返回 stage === 'confirmed' 的 Pattern */
export function getPatternConfirmed(
  interests: Interest[],
  now?: number,
): PatternCandidate[] {
  return evaluatePatterns(interests, now).filter(
    p => p.stage === 'confirmed',
  );
}

/**
 * 给定当前情绪状态，返回按「情绪相关性」排名的 Pattern（Phase 1）。
 *
 * 三维评分：
 *   1. semanticScore (0.4) — 基于 interest weight 的语义匹配度
 *   2. emotionResonance (0.4) — 当前情绪与 pattern 历史情绪签名的余弦相似度
 *   3. driveAdjustment (0.2) — 强化驱动力偏置
 *
 * 无情绪上下文时降级为纯 maturityScore 排序（向后兼容）。
 *
 * @param interests  当前活跃的 Interest[]
 * @param emotionCtx 当前情绪上下文（来自 extractEmotionContext）
 * @param now        评估时间戳
 */
export function getRelevantPatterns(
  interests: Interest[],
  emotionCtx?: EmotionContext | null,
  now?: number,
): PatternCandidate[] {
  const basePatterns = getPatternConfirmed(interests, now);

  // 无情绪上下文 → 降级为 maturityScore 排序（向后兼容）
  if (!emotionCtx) {
    console.log('[Pattern] getRelevantPatterns: 无情绪上下文，使用 maturityScore 降级排序');
    return basePatterns;
  }

  const { primaryEmotions, drives, dominantState } = emotionCtx;

  // 计算每个 pattern 的情绪相关性得分
  const scored = basePatterns.map(pattern => {
    // 1. 语义匹配得分：从 interests 中查找对应 weight
    const interest = interests.find(i => i.topic === pattern.topic);
    const semanticScore = interest ? interest.weight : 0.3; // 未匹配到的给基础分

    // 2. 情绪共鸣得分：当前情绪 vs pattern 情绪签名
    let emotionResonance = PatternConfig.neutralSignatureScore; // 默认中性
    if (pattern.emotionalSignature) {
      const cosRaw = cosineSimilarity(primaryEmotions, pattern.emotionalSignature);
      // 余弦范围 [-1, 1] 映射到 [0, 1]
      emotionResonance = (cosRaw + 1) / 2;
    }

    // 3. 驱动力调整得分
    const driveAdjust = applyDriveBias(pattern.emotionalSignature, drives);

    // 加权合成
    const relevanceScore =
      semanticScore * PatternConfig.semanticWeight +
      emotionResonance * PatternConfig.emotionResonanceWeight +
      driveAdjust * PatternConfig.driveAdjustmentWeight;

    return { pattern, relevanceScore, semanticScore, emotionResonance, driveAdjust };
  });

  // 按 relevanceScore 降序
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 日志输出（可观测性，匹配 evaluatePatterns 风格）
  console.log(
    `[Pattern] getRelevantPatterns: 主导情绪=${dominantState}, ` +
    `greed=${drives.greedDrive.toFixed(2)}, fear=${drives.fearAvoidance.toFixed(2)}, ` +
    `共${scored.length}个confirmed模式`,
  );
  for (const { pattern, relevanceScore, semanticScore, emotionResonance, driveAdjust } of scored.slice(0, 5)) {
    console.log(
      `[Pattern]   ${pattern.topic}: ` +
      `semantic=${semanticScore.toFixed(3)} emotion=${emotionResonance.toFixed(3)} ` +
      `drive=${driveAdjust.toFixed(3)} → relevance=${relevanceScore.toFixed(3)} ` +
      `(maturity=${pattern.maturityScore.toFixed(3)})` +
      (pattern.emotionalSignature ? ' [情绪签名]' : ' [无签名]'),
    );
  }

  return scored.map(s => s.pattern);
}

/** 按生命周期阶段筛选模式 */
export function getPatternsByPhase(
  interests: Interest[],
  phase: PatternLifecycle,
  now?: number,
): PatternCandidate[] {
  return evaluatePatterns(interests, now).filter(p => p.lifecycle === phase);
}

/** 获取所有休眠/归藏的模式 */
export function getDormantPatterns(interests: Interest[], now?: number): PatternCandidate[] {
  return evaluatePatterns(interests, now).filter(
    p => p.lifecycle === PatternLifecycle.DORMANT || p.lifecycle === PatternLifecycle.ARCHIVED,
  );
}

// ════════════════════════════════════════════════════════════
// 6b. 情绪加权辅助函数（Phase 1: Emotion-Cognition Deep Coupling）
// ════════════════════════════════════════════════════════════

/**
 * 计算两个情绪向量的余弦相似度。
 * 任一向量为零向量时返回中性值，避免冷启动时的新 topic 被惩罚。
 *
 * @returns 余弦相似度 [-1, 1]，映射到 [0, 1] 区间供评分使用
 */
export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  if (keys.size === 0) return PatternConfig.neutralSignatureScore;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of keys) {
    const va = a[key] || 0;
    const vb = b[key] || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return PatternConfig.neutralSignatureScore;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 根据强化驱动力偏置模式相关性。
 *
 * - fearAvoidance 高 → 偏向 calm/safe 情绪签名的模式（安抚型检索）
 * - greedDrive 高 → 偏向 joy/lust 情绪签名的模式（探索型检索）
 *
 * @returns [0, 1] 调整系数。0.5 = 中性无调整，>0.5 = 正向偏置，<0.5 = 负向偏置
 */
export function applyDriveBias(
  signature: Record<string, number> | undefined,
  drives: { greedDrive: number; fearAvoidance: number },
): number {
  if (!signature) return 0.5; // 无签名 → 中性

  let bias = 0.5;
  const { greedDrive, fearAvoidance } = drives;
  const threshold = 0.4; // 驱动力超过此阈值才开始生效

  // 恐惧回避：偏向安全/平静的模式（calm, love），惩罚恐惧模式
  if (fearAvoidance > threshold) {
    const calmScore = signature.calm || 0;
    const loveScore = signature.love || 0;
    const joyScore = signature.joy || 0;
    const fearPenalty = signature.fear || 0;
    const safetyBonus = ((calmScore + loveScore + joyScore) / 3) - fearPenalty;
    bias += safetyBonus * (fearAvoidance - threshold) * 0.8;
  }

  // 贪婪驱动：偏向新鲜/愉悦的模式（joy, lust, greed）
  if (greedDrive > threshold) {
    const joyScore = signature.joy || 0;
    const lustScore = signature.lust || 0;
    const greedScore = signature.greed || 0;
    const noveltyBonus = (joyScore + lustScore + greedScore) / 3;
    bias += noveltyBonus * (greedDrive - threshold) * 0.8;
  }

  return Math.max(0, Math.min(1, bias));
}

// ════════════════════════════════════════════════════════════
// 7. 维护与调试
// ════════════════════════════════════════════════════════════

/** 清空 mention 日志（测试/重置用） */
export function resetMentions(): void {
  _mentions.clear();
  _cooccur.clear();
  _topicEmotionSum.clear();
  _topicEmotionCount.clear();
  _topicLifecycle.clear();
  _topicLifecycleSince.clear();
  _topicLastMentioned.clear();
}

/** 获取 mention 日志大小（调试用） */
export function getMentionStats(): { topics: number; cooccurEdges: number } {
  let totalMentions = 0;
  for (const [, timestamps] of _mentions) {
    totalMentions += timestamps.length;
  }
  return {
    topics: _mentions.size,
    cooccurEdges: _cooccur.size,
  };
}

// ════════════════════════════════════════════════════════════
// 8. 持久化 SerDes（Phase 2 PR 2: 情感记忆持久化）
// ════════════════════════════════════════════════════════════

/** 可 JSON 序列化的好奇心状态快照 */
export interface CuriosityStateSnapshot {
  /** topic → mention timestamps */
  mentions: Record<string, number[]>;
  /** "topicA||topicB" → co-occurrence count */
  cooccur: Record<string, number>;
  /** topic → 各情绪维度的 EMA 累加值 */
  emotionalSignatures: Record<string, Record<string, number>>;
  /** topic → 情绪记录次数 */
  emotionalCounts: Record<string, number>;
  /** topic → 生命周期阶段 */
  lifecycles?: Record<string, string>;
  /** topic → 进入当前阶段的起始时间戳 */
  lifecycleSince?: Record<string, number>;
  /** topic → 最后提及时间 */
  lastMentioned?: Record<string, number>;
  /** 今日探索次数（防重启丢失） */
  explorationCountToday?: number;
  /** 探索计数的日期标记 */
  explorationDayKey?: string;
}

/**
 * 导出所有模块级状态为可 JSON 序列化的快照。
 * 用于持久化到磁盘。
 */
export function exportCuriosityState(): CuriosityStateSnapshot {
  const mentions: Record<string, number[]> = {};
  for (const [k, v] of _mentions) {
    mentions[k] = [...v];
  }

  const cooccur: Record<string, number> = {};
  for (const [k, v] of _cooccur) {
    cooccur[k] = v;
  }

  const emotionalSignatures: Record<string, Record<string, number>> = {};
  for (const [k, v] of _topicEmotionSum) {
    emotionalSignatures[k] = { ...v };
  }

  const emotionalCounts: Record<string, number> = {};
  for (const [k, v] of _topicEmotionCount) {
    emotionalCounts[k] = v;
  }

  const lifecycles: Record<string, string> = {};
  for (const [k, v] of _topicLifecycle) {
    lifecycles[k] = v;
  }

  const lifecycleSince: Record<string, number> = {};
  for (const [k, v] of _topicLifecycleSince) {
    lifecycleSince[k] = v;
  }

  const lastMentioned: Record<string, number> = {};
  for (const [k, v] of _topicLastMentioned) {
    lastMentioned[k] = v;
  }

  return {
    mentions, cooccur, emotionalSignatures, emotionalCounts,
    lifecycles, lifecycleSince, lastMentioned,
    explorationCountToday: getExplorationCountToday(),
    explorationDayKey: getExplorationDayKey(),
  };
}

/**
 * 从快照恢复所有模块级状态。
 * 先清空现有状态再导入，确保与快照完全一致。
 *
 * 向后兼容：snapshot 中缺失的字段会被安全跳过（使用空对象兜底）。
 */
export function importCuriosityState(snapshot: CuriosityStateSnapshot): void {
  resetMentions();

  // 恢复 mentions
  if (snapshot.mentions) {
    for (const [k, v] of Object.entries(snapshot.mentions)) {
      _mentions.set(k, [...v]);
    }
  }

  // 恢复 cooccur
  if (snapshot.cooccur) {
    for (const [k, v] of Object.entries(snapshot.cooccur)) {
      _cooccur.set(k, v);
    }
  }

  // 恢复情绪签名（EMA 累加值）
  if (snapshot.emotionalSignatures) {
    for (const [k, v] of Object.entries(snapshot.emotionalSignatures)) {
      _topicEmotionSum.set(k, { ...v });
    }
  }

  // 恢复情绪计数
  if (snapshot.emotionalCounts) {
    for (const [k, v] of Object.entries(snapshot.emotionalCounts)) {
      _topicEmotionCount.set(k, v);
    }
  }

  // 恢复生命周期状态
  if (snapshot.lifecycles) {
    for (const [k, v] of Object.entries(snapshot.lifecycles)) {
      _topicLifecycle.set(k, v as PatternLifecycle);
    }
  }
  if (snapshot.lifecycleSince) {
    for (const [k, v] of Object.entries(snapshot.lifecycleSince)) {
      _topicLifecycleSince.set(k, v);
    }
  }
  if (snapshot.lastMentioned) {
    for (const [k, v] of Object.entries(snapshot.lastMentioned)) {
      _topicLastMentioned.set(k, v);
    }
  }
  // 恢复探索每日计数器（防重启丢失）
  if (snapshot.explorationCountToday !== undefined) setExplorationCountToday(snapshot.explorationCountToday);
  if (snapshot.explorationDayKey) setExplorationDayKey(snapshot.explorationDayKey);

  console.log(
    `[Pattern] importCuriosityState: ` +
    `mentions=${_mentions.size} cooccur=${_cooccur.size} ` +
    `emotionSignatures=${_topicEmotionSum.size} lifecycles=${_topicLifecycle.size}`,
  );
}

/**
 * 清理归藏/过期的模式条目，防止 Map 无限制增长。
 *
 * 清理条件：lifecycle = ARCHIVED 且超过 ARCHIVE_DAYS + 30 天未提及。
 * 安全边际：多等 30 天防止误删刚复苏的模式。
 *
 * 建议每 24 小时调用一次（在探索周期或服务器启动时）。
 *
 * @returns 清理的 topic 数量
 */
export function pruneArchivedPatterns(): number {
  const now = Date.now();
  const GRACE_PERIOD_MS = (ARCHIVE_DAYS + 30) * 24 * 60 * 60 * 1000;
  const toRemove: string[] = [];

  for (const [topic, lifecycle] of _topicLifecycle) {
    if (lifecycle !== PatternLifecycle.ARCHIVED) continue;
    const lastMentioned = _topicLastMentioned.get(topic) ?? 0;
    if (now - lastMentioned < GRACE_PERIOD_MS) continue;
    toRemove.push(topic);
  }

  for (const topic of toRemove) {
    _mentions.delete(topic);
    _topicEmotionSum.delete(topic);
    _topicEmotionCount.delete(topic);
    _topicLifecycle.delete(topic);
    _topicLifecycleSince.delete(topic);
    _topicLastMentioned.delete(topic);

    // 清理涉及该 topic 的共现边
    for (const [key] of _cooccur) {
      if (key.startsWith(topic + '|') || key.endsWith('|' + topic)) {
        _cooccur.delete(key);
      }
    }
  }

  if (toRemove.length > 0) {
    console.log(
      `[Pattern] pruneArchivedPatterns: 清理 ${toRemove.length} 个过期模式 ` +
      `(剩余 topics=${_topicLifecycle.size}, cooccurEdges=${_cooccur.size})`,
    );
  }

  return toRemove.length;
}
