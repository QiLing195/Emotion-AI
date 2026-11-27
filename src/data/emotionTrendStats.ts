import {
  EmotionAnnotation,
  QuadrantId,
  getIntensity,
} from './affectLexicon';

export type TrendRangeFilter = '7d' | '30d' | 'all';

export interface DailyEmotionPoint {
  readonly date: string;
  readonly shortDate: string;
  readonly count: number;
  readonly avgValence: number;
  readonly avgArousal: number;
  readonly avgIntensity: number;
  readonly quadrantCounts: Record<QuadrantId, number>;
  readonly dominantLabel: string;
}

export interface EmotionTrendSummary {
  readonly points: DailyEmotionPoint[];
  readonly totalCount: number;
  readonly dayCount: number;
  readonly avgValence: number;
  readonly avgArousal: number;
  readonly valenceVolatility: number;
  readonly positiveRatio: number;
  readonly dateSpanLabel: string;
}

const DATE_PREFIX_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;

/**
 * 从 createdAt 字符串中提取规范化的 YYYY-MM-DD 日期键。
 * 兼容 "2026-11-25 11:30"、ISO 8601 及 "2026/11/25" 格式。
 */
export function extractDateKey(createdAt: string): string | null {
  const trimmed = createdAt.trim();
  if (!trimmed) return null;

  const prefixMatch = trimmed.match(DATE_PREFIX_PATTERN);
  if (prefixMatch) {
    const year = Number(prefixMatch[1]);
    const month = Number(prefixMatch[2]);
    const day = Number(prefixMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  const dt = new Date(parsed);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function dateKeyToUtcMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 按日期聚合情绪标注记录，生成用于时间折线图的每日序列与波动摘要指标。
 * 时间窗口（7d / 30d）以当前数据集中最新记录日期为锚点，避免历史导入数据出现空窗。
 */
export function buildDailyEmotionTrend(
  annotations: readonly EmotionAnnotation[],
  range: TrendRangeFilter = 'all'
): EmotionTrendSummary {
  const buckets = new Map<
    string,
    {
      count: number;
      valenceSum: number;
      arousalSum: number;
      intensitySum: number;
      quadrantCounts: Record<QuadrantId, number>;
      labelCounts: Map<string, number>;
    }
  >();

  for (const item of annotations) {
    const dateKey = extractDateKey(item.createdAt);
    if (!dateKey) continue;

    let bucket = buckets.get(dateKey);
    if (!bucket) {
      bucket = {
        count: 0,
        valenceSum: 0,
        arousalSum: 0,
        intensitySum: 0,
        quadrantCounts: {
          'high-positive': 0,
          'low-positive': 0,
          'high-negative': 0,
          'low-negative': 0,
        },
        labelCounts: new Map<string, number>(),
      };
      buckets.set(dateKey, bucket);
    }

    bucket.count += 1;
    bucket.valenceSum += item.valence;
    bucket.arousalSum += item.arousal;
    bucket.intensitySum += getIntensity(item.valence, item.arousal);
    bucket.quadrantCounts[item.quadrant] += 1;

    const label = item.primaryLabel.trim() || '未命名';
    bucket.labelCounts.set(label, (bucket.labelCounts.get(label) ?? 0) + 1);
  }

  const allSortedDates = Array.from(buckets.keys()).sort();
  if (allSortedDates.length === 0) {
    return {
      points: [],
      totalCount: 0,
      dayCount: 0,
      avgValence: 0,
      avgArousal: 0,
      valenceVolatility: 0,
      positiveRatio: 0,
      dateSpanLabel: '暂无日期数据',
    };
  }

  const latestMs = dateKeyToUtcMs(allSortedDates[allSortedDates.length - 1]);
  const windowDays = range === '7d' ? 7 : range === '30d' ? 30 : null;
  const minAllowedMs =
    windowDays !== null ? latestMs - (windowDays - 1) * 86_400_000 : -Infinity;

  const filteredDates = allSortedDates.filter(
    (dateKey) => dateKeyToUtcMs(dateKey) >= minAllowedMs
  );

  let totalCount = 0;
  let totalValenceSum = 0;
  let totalArousalSum = 0;
  let totalPositive = 0;

  const points: DailyEmotionPoint[] = filteredDates.map((dateKey) => {
    const bucket = buckets.get(dateKey)!;
    totalCount += bucket.count;
    totalValenceSum += bucket.valenceSum;
    totalArousalSum += bucket.arousalSum;
    totalPositive +=
      bucket.quadrantCounts['high-positive'] +
      bucket.quadrantCounts['low-positive'];

    let dominantLabel = '中性';
    let dominantFreq = -1;
    for (const [label, freq] of bucket.labelCounts.entries()) {
      if (freq > dominantFreq) {
        dominantFreq = freq;
        dominantLabel = label;
      }
    }

    return {
      date: dateKey,
      shortDate: dateKey.slice(5),
      count: bucket.count,
      avgValence: roundTo(bucket.valenceSum / bucket.count, 2),
      avgArousal: roundTo(bucket.arousalSum / bucket.count, 2),
      avgIntensity: roundTo(bucket.intensitySum / bucket.count, 2),
      quadrantCounts: { ...bucket.quadrantCounts },
      dominantLabel,
    };
  });

  const avgValence = totalCount > 0 ? roundTo(totalValenceSum / totalCount, 2) : 0;
  const avgArousal = totalCount > 0 ? roundTo(totalArousalSum / totalCount, 2) : 0;

  const meanDailyValence =
    points.reduce((sum, p) => sum + p.avgValence, 0) / points.length;
  const variance =
    points.reduce((sum, p) => sum + (p.avgValence - meanDailyValence) ** 2, 0) /
    points.length;
  const valenceVolatility = roundTo(Math.sqrt(variance), 2);
  const positiveRatio =
    totalCount > 0 ? Math.round((totalPositive / totalCount) * 100) : 0;

  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const dateSpanLabel =
    firstDate === lastDate ? firstDate : `${firstDate} 至 ${lastDate}`;

  return {
    points,
    totalCount,
    dayCount: points.length,
    avgValence,
    avgArousal,
    valenceVolatility,
    positiveRatio,
    dateSpanLabel,
  };
}

export interface EmotionLabelFrequency {
  readonly label: string;
  readonly count: number;
  readonly ratio: number;
  readonly weight: number;
  readonly quadrant: QuadrantId;
  readonly avgValence: number;
  readonly avgArousal: number;
}

/**
 * 统计情绪标注中的主情绪标签词频分布，按出现次数降序排列并输出 [0, 1] 归一化权重。
 */
export function buildEmotionLabelFrequencies(
  annotations: readonly EmotionAnnotation[]
): EmotionLabelFrequency[] {
  if (annotations.length === 0) return [];

  const buckets = new Map<
    string,
    {
      count: number;
      valenceSum: number;
      arousalSum: number;
      quadrantCounts: Record<QuadrantId, number>;
    }
  >();

  for (const item of annotations) {
    const label = item.primaryLabel.trim() || '未命名';
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = {
        count: 0,
        valenceSum: 0,
        arousalSum: 0,
        quadrantCounts: {
          'high-positive': 0,
          'low-positive': 0,
          'high-negative': 0,
          'low-negative': 0,
        },
      };
      buckets.set(label, bucket);
    }

    bucket.count += 1;
    bucket.valenceSum += item.valence;
    bucket.arousalSum += item.arousal;
    bucket.quadrantCounts[item.quadrant] += 1;
  }

  const total = annotations.length;
  const rawList = Array.from(buckets.entries()).map(([label, bucket]) => {
    let dominantQuadrant: QuadrantId = 'high-positive';
    let maxQuadrantCount = -1;
    for (const qId of [
      'high-positive',
      'low-positive',
      'high-negative',
      'low-negative',
    ] as const) {
      if (bucket.quadrantCounts[qId] > maxQuadrantCount) {
        maxQuadrantCount = bucket.quadrantCounts[qId];
        dominantQuadrant = qId;
      }
    }

    return {
      label,
      count: bucket.count,
      ratio: roundTo(bucket.count / total, 4),
      quadrant: dominantQuadrant,
      avgValence: roundTo(bucket.valenceSum / bucket.count, 2),
      avgArousal: roundTo(bucket.arousalSum / bucket.count, 2),
    };
  });

  rawList.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.label.localeCompare(b.label, 'zh-CN');
  });

  const maxCount = rawList[0].count;
  const minCount = rawList[rawList.length - 1].count;
  const span = maxCount - minCount;

  return rawList.map((entry) => ({
    ...entry,
    weight: span === 0 ? 1 : roundTo((entry.count - minCount) / span, 3),
  }));
}

