// v1.0: Sprint D — Pattern → Insight 解释层
// 从已确认的 Pattern 中生成可解释的洞察假设。
// 不依赖 LLM，纯规则驱动。Insight 是可错的（hypothesis），后续可被验证或推翻。
//
// 三类洞察：
//   1. correlation       — 共现关系解释（"A 和 B 经常一起出现"）
//   2. emotion_deviation — 情绪效价偏差（"聊 X 时情绪比平时高 Y%"）
//   3. frequency_shift   — 频率变化趋势（"最近对 X 的关注超过了 Y"）
//
// Surprise Test: Novel + Useful + Surprising 三维评分，过滤掉用户已知的 trivial 观察。

import type { PatternCandidate } from './patterns.js';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type InsightType = 'correlation' | 'emotion_deviation' | 'frequency_shift';

export interface Insight {
  id: string;
  /** 洞察类型 */
  type: InsightType;
  /** 简短标题（可展示给用户） */
  title: string;
  /** 完整描述（用于系统提示注入） */
  description: string;
  /** 主要关联话题 */
  topic: string;
  /** 关联话题 */
  relatedTopics: string[];
  /** 置信度 [0, 1] */
  confidence: number;
  /** Surprise Test 综合得分 [0, 1] */
  surpriseScore: number;
  /** Surprise Test 各维度得分 */
  surpriseDimensions: {
    novel: number;
    useful: number;
    surprising: number;
  };
  /** 上游 Pattern 引用（可追溯性） */
  sourceTopics: string[];
  /** 生成时间戳 */
  generatedAt: number;
  /** 是否已分享给用户 */
  shared: boolean;
}

export interface InsightConfig {
  /** Surprise Test 最低总分，低于此值的 insight 不会被分享 */
  minSurpriseScore: number;
  /** 情绪偏差检测：偏离中性值多少才视为显著（标准差倍数） */
  emotionDeviationThreshold: number;
  /** 频率变化：新旧比例超过多少倍视为显著 */
  frequencyShiftRatio: number;
  /** 最大关注话题数（用于频率对比） */
  maxFrequencyRivals: number;
  /** 共现：最少需要多少邻居节点才生成关联 insight */
  minNeighborsForCorrelation: number;
  /** 每日最多生成 insight 数（防 flood） */
  maxInsightsPerCycle: number;
}

export const DEFAULT_INSIGHT_CONFIG: InsightConfig = {
  minSurpriseScore: 0.45,
  emotionDeviationThreshold: 0.3,
  frequencyShiftRatio: 2.0,
  maxFrequencyRivals: 3,
  minNeighborsForCorrelation: 2,
  maxInsightsPerCycle: 5,
};

// ════════════════════════════════════════════════════════════
// 2. 内部状态
// ════════════════════════════════════════════════════════════

/** 已生成的 insight 池（用于去重和分享追踪） */
const _insights: Insight[] = [];

/** 已分享过的 insight title → 用于防止重复分享 */
const _sharedTitles = new Set<string>();

/** 今日生成的 insight 计数 */
let _todayCount = 0;
let _todayKey = '';

function getDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════
// 3. Insight 生成器
// ════════════════════════════════════════════════════════════

/**
 * 类型 1: 共现关系 Insight
 *
 * 从 Pattern 的 neighbors 中提取显著共现关系，
 * 生成 "你经常同时提到 A 和 B" 类型的洞察。
 */
function generateCorrelationInsights(
  patterns: PatternCandidate[],
  config: InsightConfig,
  now: number,
): Insight[] {
  const results: Insight[] = [];

  for (const pattern of patterns) {
    if (pattern.neighbors.length < config.minNeighborsForCorrelation) continue;
    if (pattern.stage !== 'confirmed') continue;

    // 为每个邻居生成一个关联 insight
    for (const neighbor of pattern.neighbors.slice(0, 3)) {
      // 去重：A↔B 和 B↔A 是同一条
      const pairKey = [pattern.topic, neighbor].sort().join('||');
      const alreadyExists = results.some(r =>
        [...r.sourceTopics].sort().join('||') === pairKey,
      );
      if (alreadyExists) continue;

      const neighborPattern = patterns.find(p => p.topic === neighbor);
      const neighborScore = neighborPattern?.maturityScore ?? 0;

      // 置信度 = 双方成熟度的调和平均
      const confidence = pattern.maturityScore > 0 && neighborScore > 0
        ? 2 * pattern.maturityScore * neighborScore / (pattern.maturityScore + neighborScore)
        : pattern.maturityScore * 0.5;

      // Surprise Test: Novel(双方都成熟 ? 低 : 中), Useful(高), Surprising(中)
      const novel = neighborPattern ? 0.4 : 0.7; // 新话题更 novel
      const useful = 0.7; // 关系发现总是有用
      const surprising = Math.min(0.8, pattern.connectedness * 0.15 + 0.4);

      results.push({
        id: `insight_corr_${now}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'correlation',
        title: `「${pattern.topic}」和「${neighbor}」`,
        description: buildCorrelationDescription(pattern.topic, neighbor, pattern, neighborPattern),
        topic: pattern.topic,
        relatedTopics: [neighbor],
        confidence: Math.round(confidence * 1000) / 1000,
        surpriseScore: Math.round((novel * 0.3 + useful * 0.4 + surprising * 0.3) * 1000) / 1000,
        surpriseDimensions: { novel, useful, surprising },
        sourceTopics: [pattern.topic, neighbor],
        generatedAt: now,
        shared: false,
      });
    }
  }

  return results;
}

function buildCorrelationDescription(
  topicA: string,
  topicB: string,
  patternA: PatternCandidate,
  patternB?: PatternCandidate,
): string {
  const aMaturity = patternA.maturityScore > 0.75 ? '稳定地' : '逐渐地';
  const parts: string[] = [];
  parts.push(`用户${aMaturity}将「${topicA}」和「${topicB}」联系在一起。`);

  if (patternA.emotionalSignature && patternB?.emotionalSignature) {
    // 检查两个 pattern 的情绪签名是否相似
    const aDominant = getDominantEmotionName(patternA.emotionalSignature);
    const bDominant = getDominantEmotionName(patternB.emotionalSignature);
    if (aDominant === bDominant && aDominant !== 'neutral') {
      parts.push(`两个话题都倾向于在「${EMOTION_CN[aDominant] || aDominant}」的情绪中出现。`);
    }
  }

  parts.push('这可能意味着它们之间存在某种功能关联（如：一个用于调节另一个带来的情绪）。');
  return parts.join('');
}

/**
 * 类型 2: 情绪效价偏差 Insight
 *
 * 检测 pattern 的情绪签名与全局平均之间的显著偏差。
 * "聊 X 时，joy 情绪比平时高 40%"
 */
function generateEmotionDeviationInsights(
  patterns: PatternCandidate[],
  config: InsightConfig,
  now: number,
): Insight[] {
  // 计算全局情绪均值基线
  const globalBaseline = computeGlobalEmotionBaseline(patterns);
  if (!globalBaseline) return [];

  const results: Insight[] = [];

  for (const pattern of patterns) {
    if (!pattern.emotionalSignature) continue;
    if (pattern.stage !== 'confirmed') continue;

    // 检测显著偏差
    const deviations = findSignificantDeviations(
      pattern.emotionalSignature,
      globalBaseline,
      config.emotionDeviationThreshold,
    );

    if (deviations.length === 0) continue;

    // 为每个显著偏差生成 insight
    for (const dev of deviations.slice(0, 2)) {
      const direction = dev.delta > 0 ? '偏高' : '偏低';
      const magnitude = Math.abs(dev.delta);
      const emotionLabel = EMOTION_CN[dev.emotion] || dev.emotion;

      // Surprise Test
      const novel = Math.min(0.9, 0.4 + magnitude * 0.5); // 偏差越大越 novel
      const useful = 0.8; // 情绪洞察总是有用
      const surprising = Math.min(0.9, 0.3 + magnitude * 0.6); // 偏差越大越 surprise

      results.push({
        id: `insight_emo_${now}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'emotion_deviation',
        title: `聊「${pattern.topic}」时${emotionLabel}${direction}`,
        description: buildEmotionDeviationDescription(
          pattern.topic, dev.emotion, direction, magnitude, emotionLabel,
        ),
        topic: pattern.topic,
        relatedTopics: [],
        confidence: Math.min(0.9, 0.5 + magnitude),
        surpriseScore: Math.round((novel * 0.3 + useful * 0.4 + surprising * 0.3) * 1000) / 1000,
        surpriseDimensions: { novel, useful, surprising },
        sourceTopics: [pattern.topic],
        generatedAt: now,
        shared: false,
      });
    }
  }

  return results;
}

function buildEmotionDeviationDescription(
  topic: string,
  _emotion: string,
  direction: string,
  magnitude: number,
  emotionLabel: string,
): string {
  const percent = Math.round(magnitude * 100);
  const dirWord = direction === '偏高' ? '更强烈地' : '较少地';
  return `用户在谈论「${topic}」时，${emotionLabel}情绪${direction}了约${percent}%（相比其他话题）。` +
    `这可能意味着这个话题与${emotionLabel}情绪有某种${dirWord}关联。`;
}

/**
 * 类型 3: 频率变化趋势 Insight
 *
 * 比较不同 pattern 的频率/持续性，发现"最近对 X 的关注超过了 Y"。
 */
function generateFrequencyShiftInsights(
  patterns: PatternCandidate[],
  config: InsightConfig,
  now: number,
): Insight[] {
  if (patterns.length < 2) return [];

  const results: Insight[] = [];
  const sorted = [...patterns].sort((a, b) => b.frequency - a.frequency);

  // 对比榜首和其他 topics
  const top = sorted[0];
  const rivals = sorted.slice(1, 1 + config.maxFrequencyRivals);

  for (const rival of rivals) {
    const ratio = top.frequency / Math.max(rival.frequency, 1);

    if (ratio < config.frequencyShiftRatio) continue;

    // Surprise Test
    const novel = Math.min(0.8, 0.3 + (ratio / 10)); // 比例悬殊更 novel
    const useful = 0.6;
    const surprising = Math.min(0.8, 0.3 + (ratio - 2) * 0.15);

    results.push({
      id: `insight_freq_${now}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'frequency_shift',
      title: `「${top.topic}」关注度超过「${rival.topic}」`,
      description: buildFrequencyShiftDescription(top, rival, ratio),
      topic: top.topic,
      relatedTopics: [rival.topic],
      confidence: Math.min(0.85, 0.4 + ratio * 0.05),
      surpriseScore: Math.round((novel * 0.3 + useful * 0.4 + surprising * 0.3) * 1000) / 1000,
      surpriseDimensions: { novel, useful, surprising },
      sourceTopics: [top.topic, rival.topic],
      generatedAt: now,
      shared: false,
    });
  }

  return results;
}

function buildFrequencyShiftDescription(
  top: PatternCandidate,
  rival: PatternCandidate,
  ratio: number,
): string {
  const times = ratio >= 3 ? '大幅' : '明显';
  return `用户最近对「${top.topic}」的关注${times}超过了「${rival.topic}」` +
    `（提及频率 ${top.frequency} vs ${rival.frequency}，约 ${ratio.toFixed(1)} 倍）。` +
    `这可能反映了兴趣重心在发生转移，或当前生活阶段与「${top.topic}」更相关。`;
}

// ════════════════════════════════════════════════════════════
// 4. Surprise Test — 过滤用户已知的 trivial 观察
// ════════════════════════════════════════════════════════════

/**
 * 对已生成的 Insight 批量评分（如果生成时未评分），
 * 并过滤低于最低阈值的。
 */
function applySurpriseFilter(
  insights: Insight[],
  config: InsightConfig,
): Insight[] {
  return insights.filter(i => {
    // 已评分的直接比对阈值
    if (i.surpriseScore > 0) {
      return i.surpriseScore >= config.minSurpriseScore;
    }

    // 兜底：使用维度得分重新计算
    const { novel, useful, surprising } = i.surpriseDimensions;
    const score = novel * 0.3 + useful * 0.4 + surprising * 0.3;
    return score >= config.minSurpriseScore;
  });
}

// ════════════════════════════════════════════════════════════
// 5. 公开 API — 策略层只调用这些
// ════════════════════════════════════════════════════════════

/**
 * 从已确认的 Pattern 中生成可分享的 Insight。
 *
 * 调用时机：在探索周期（每天一次）或对话轮次中。
 * 内部分三步：生成三类 Insight → 去重 → Surprise Test 过滤。
 *
 * @param patterns  已确认的 Pattern（来自 getPatternConfirmed）
 * @param config    可选配置覆盖
 * @param now       时间戳
 * @returns 按 surpriseScore 降序排列的可分享 Insight
 */
export function getShareableInsights(
  patterns: PatternCandidate[],
  config?: Partial<InsightConfig>,
  now: number = Date.now(),
): Insight[] {
  const cfg = { ...DEFAULT_INSIGHT_CONFIG, ...config };
  const confirmed = patterns.filter(p => p.stage === 'confirmed');
  if (confirmed.length === 0) return [];

  // 重置每日计数
  const today = getDayKey(now);
  if (today !== _todayKey) {
    _todayKey = today;
    _todayCount = 0;
  }

  // 生成三类 Insight
  const correlationInsights = generateCorrelationInsights(confirmed, cfg, now);
  const emotionInsights = generateEmotionDeviationInsights(confirmed, cfg, now);
  const frequencyInsights = generateFrequencyShiftInsights(confirmed, cfg, now);

  // 合并 + 去重（按 sourceTopics 签名）
  const allInsights = [
    ...correlationInsights,
    ...emotionInsights,
    ...frequencyInsights,
  ];
  const deduped = deduplicateInsights(allInsights);

  // Surprise Test 过滤
  const filtered = applySurpriseFilter(deduped, cfg);

  // 排序：surpriseScore 降序
  filtered.sort((a, b) => b.surpriseScore - a.surpriseScore);

  // 每日上限
  const remaining = cfg.maxInsightsPerCycle - _todayCount;
  const capped = filtered.slice(0, Math.max(0, remaining));
  _todayCount += capped.length;

  // 存储新 insight 到内部池
  for (const ins of capped) {
    _insights.push(ins);
    // 上限保护
    if (_insights.length > 200) _insights.shift();
  }

  console.log(
    `[Insight] 生成 ${allInsights.length} 条 → 去重后 ${deduped.length} → ` +
    `Surprise过滤后 ${filtered.length} → 限额后 ${capped.length} 条可分享`,
  );

  return capped;
}

/**
 * 标记 Insight 为已分享（在策略层使用后调用）。
 */
export function markInsightShared(insightId: string): void {
  const found = _insights.find(i => i.id === insightId);
  if (found) {
    found.shared = true;
    // 使用与 deduplicateInsights 一致的键逻辑
    const key = found.type === 'correlation' && found.sourceTopics.length === 2
      ? `corr:${[...found.sourceTopics].sort().join('||')}`
      : found.title;
    _sharedTitles.add(key);
  }
}

/**
 * 获取所有已生成但未分享的 Insight。
 */
export function getUnsharedInsights(): Insight[] {
  return _insights.filter(i => !i.shared);
}

// ════════════════════════════════════════════════════════════
// 6. 辅助函数
// ════════════════════════════════════════════════════════════

/** 情绪名 → 中文标签 */
const EMOTION_CN: Record<string, string> = {
  joy: '愉悦',
  sad: '悲伤',
  anger: '愤怒',
  fear: '恐惧',
  disgust: '厌恶',
  love: '喜爱',
  calm: '平静',
  lust: '渴望',
  greed: '期待',
};

function getDominantEmotionName(signature: Record<string, number>): string {
  let maxKey = 'neutral';
  let maxVal = 0;
  for (const [k, v] of Object.entries(signature)) {
    if (Math.abs(v) > Math.abs(maxVal)) {
      maxVal = v;
      maxKey = k;
    }
  }
  return maxKey;
}

function computeGlobalEmotionBaseline(
  patterns: PatternCandidate[],
): Record<string, number> | null {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  let totalPatterns = 0;

  for (const p of patterns) {
    if (!p.emotionalSignature) continue;
    totalPatterns++;
    for (const [k, v] of Object.entries(p.emotionalSignature)) {
      sums[k] = (sums[k] || 0) + v;
      counts[k] = (counts[k] || 0) + 1;
    }
  }

  if (totalPatterns < 2) return null; // 需要至少 2 个有签名的 pattern

  const baseline: Record<string, number> = {};
  for (const k of Object.keys(sums)) {
    baseline[k] = sums[k] / counts[k];
  }
  return baseline;
}

interface EmotionDeviation {
  emotion: string;
  delta: number;
}

function findSignificantDeviations(
  signature: Record<string, number>,
  baseline: Record<string, number>,
  threshold: number,
): EmotionDeviation[] {
  const deviations: EmotionDeviation[] = [];
  for (const [emotion, value] of Object.entries(signature)) {
    const baselineVal = baseline[emotion] ?? 0.5;
    const delta = value - baselineVal;
    if (Math.abs(delta) >= threshold) {
      deviations.push({ emotion, delta: Math.round(delta * 1000) / 1000 });
    }
  }
  return deviations.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function deduplicateInsights(insights: Insight[]): Insight[] {
  const seen = new Set<string>();
  return insights.filter(i => {
    // 关联型 insight 使用排序后的话题对作为去重键（A↔B = B↔A）
    const key = i.type === 'correlation' && i.sourceTopics.length === 2
      ? `corr:${[...i.sourceTopics].sort().join('||')}`
      : i.title;
    if (seen.has(key)) return false;
    if (_sharedTitles.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ════════════════════════════════════════════════════════════
// 7. 维护与调试
// ════════════════════════════════════════════════════════════

/** 清空所有 insight 状态（测试用） */
export function resetInsights(): void {
  _insights.length = 0;
  _sharedTitles.clear();
  _todayCount = 0;
  _todayKey = '';
}

/** 获取 insight 统计（调试用） */
export function getInsightStats(): { total: number; shared: number; unshared: number } {
  const total = _insights.length;
  const shared = _insights.filter(i => i.shared).length;
  return { total, shared, unshared: total - shared };
}

// ════════════════════════════════════════════════════════════
// 8. SerDes — 持久化（与 patterns.ts 风格一致）
// ════════════════════════════════════════════════════════════

export interface InsightStateSnapshot {
  insights: Insight[];
  sharedTitles: string[];
  todayCount: number;
  todayKey: string;
}

export function exportInsightState(): InsightStateSnapshot {
  return {
    insights: _insights.map(i => ({ ...i })),
    sharedTitles: [..._sharedTitles],
    todayCount: _todayCount,
    todayKey: _todayKey,
  };
}

export function importInsightState(snapshot: InsightStateSnapshot): void {
  resetInsights();
  if (snapshot.insights) {
    for (const i of snapshot.insights) {
      _insights.push({ ...i });
    }
  }
  if (snapshot.sharedTitles) {
    for (const t of snapshot.sharedTitles) {
      _sharedTitles.add(t);
    }
  }
  _todayCount = snapshot.todayCount ?? 0;
  _todayKey = snapshot.todayKey ?? '';

  console.log(
    `[Insight] importInsightState: ` +
    `insights=${_insights.length} sharedTitles=${_sharedTitles.size}`,
  );
}
