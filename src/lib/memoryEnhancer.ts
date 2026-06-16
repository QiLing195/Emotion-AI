// ── v1.1 记忆增强系统 (Memory Enhancement) ──
// 为情景记忆系统补充三个关键功能
// 解决 P2 问题：遗忘曲线、记忆重构、记忆整合
//
// 功能：
//   1. 艾宾浩斯遗忘曲线 — 未回忆的记忆权重随时间指数衰减
//   2. 记忆重构 — 每次回忆时根据当前情感状态微调叙事
//   3. 记忆整合 — 多条相关记忆提炼为「人生教训」

import type { EpisodicMemory, EpisodicMemoryStore } from './episodicMemory';
import type { EmotionState } from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 1. 艾宾浩斯遗忘曲线
// ════════════════════════════════════════════════════════════

/**
 * 遗忘参数
 *
 * 艾宾浩斯曲线近似: R = e^(-t/S)
 *   其中 S = 相对记忆强度（巩固程度越高，衰减越慢）
 *
 * recallCount 越高 → S 越大 → 衰减越慢（间隔重复效应）
 */
interface ForgettingParams {
  /** 基础半衰期（小时）— 未被回忆的记忆在此时间后权重减半 */
  baseHalfLifeHours: number;
  /** 每次回忆对半衰期的延长系数 */
  recallBoostFactor: number;
  /** 最小保留权重 — 即使从未回忆也不会完全遗忘 */
  minRetentionWeight: number;
}

const DEFAULT_FORGETTING: ForgettingParams = {
  baseHalfLifeHours: 72,       // 3天基础半衰期
  recallBoostFactor: 1.5,      // 每次回忆延长半衰期 50%
  minRetentionWeight: 0.05,    // 5% 最小保留
};

/**
 * 对单条记忆应用遗忘衰减
 *
 * @returns 衰减后的 recallWeight 和是否应归档（权重 < 阈值）
 */
export function applyForgettingCurve(
  memory: EpisodicMemory,
  now: number = Date.now(),
  params: ForgettingParams = DEFAULT_FORGETTING,
): { newWeight: number; shouldArchive: boolean } {
  const ageHours = (now - memory.timestamp) / (1000 * 60 * 60);

  // 有效半衰期：基础 × 回忆次数的巩固效应
  const effectiveHalfLife = params.baseHalfLifeHours *
    Math.pow(params.recallBoostFactor, memory.recallCount);

  // 艾宾浩斯衰减: R = e^(-age/effectiveHalfLife)
  const decayFactor = Math.exp(-ageHours / effectiveHalfLife);

  // 如果最近被回忆过（24h内），不衰减反而巩固
  const recentlyRecalled = memory.lastRecalledAt &&
    (now - memory.lastRecalledAt) < 24 * 60 * 60_000;
  const bonus = recentlyRecalled ? 1.1 : 1.0; // 10% 巩固加成

  const newWeight = Math.max(
    params.minRetentionWeight,
    memory.recallWeight * decayFactor * bonus,
  );

  // 归档阈值：权重 < 0.05 且未被回忆超过2次
  const shouldArchive = newWeight < 0.05 && memory.recallCount <= 2;

  return {
    newWeight: Math.round(newWeight * 10000) / 10000,
    shouldArchive,
  };
}

/**
 * 对整个记忆存储应用遗忘衰减
 * 建议每天运行一次（在兴趣衰减的同时）
 */
export function decayAllMemories(
  store: EpisodicMemoryStore,
  now: number = Date.now(),
): { archived: EpisodicMemory[]; retained: EpisodicMemory[] } {
  const archived: EpisodicMemory[] = [];
  const retained: EpisodicMemory[] = [];

  for (const memory of store.episodes) {
    const { newWeight, shouldArchive } = applyForgettingCurve(memory, now);
    memory.recallWeight = newWeight;

    if (shouldArchive) {
      archived.push(memory);
    } else {
      retained.push(memory);
    }
  }

  store.episodes = retained;
  return { archived, retained };
}

// ════════════════════════════════════════════════════════════
// 2. 记忆重构
// ════════════════════════════════════════════════════════════

/**
 * 记忆重构上下文 — 每次回忆时的当前状态
 */
interface RecallContext {
  currentEmotion: EmotionState;
  dominantEmotion: string;
  daysSinceEvent: number;
}

/**
 * 重构记忆叙事片段
 *
 * 人类记忆每次回忆时都会被微妙修改。此函数根据当前情感状态，
 * 生成"这次回忆的版本"，而非修改原始记忆。
 *
 * @param memory 原始记忆
 * @param ctx 当前回忆上下文
 * @returns 重构后的叙事片段
 */
export function reconstructMemoryNarrative(
  memory: EpisodicMemory,
  ctx: RecallContext,
): string {
  const base = memory.narrativeFragment;
  const ageLabel = ctx.daysSinceEvent < 1 ? '刚才'
    : ctx.daysSinceEvent < 7 ? `${ctx.daysSinceEvent}天前`
    : ctx.daysSinceEvent < 30 ? `${Math.round(ctx.daysSinceEvent / 7)}周前`
    : `${Math.round(ctx.daysSinceEvent / 30)}个月前`;

  // 根据当前情感基调微调叙事色彩
  const currentValence = ctx.currentEmotion.taiji.valence;

  let tonalPrefix = '';
  if (currentValence > 0.3) {
    // 当前心情好 → 温暖地回忆
    const warmPrefixes = [
      `回想起来，${ageLabel}那件事让我觉得很温暖——`,
      `${ageLabel}的经历，现在想起来仍然让我微笑——`,
      `那天的记忆，像一张珍藏的照片——`,
    ];
    tonalPrefix = warmPrefixes[Math.floor(Math.random() * warmPrefixes.length)];
  } else if (currentValence < -0.2) {
    // 当前心情不佳 → 略带感伤的回忆
    const sadPrefixes = [
      `${ageLabel}的事我现在想起来还有些感触——`,
      `那时候的感觉，现在依稀还能感受到——`,
    ];
    tonalPrefix = sadPrefixes[Math.floor(Math.random() * sadPrefixes.length)];
  } else {
    // 中性 → 客观回忆
    const neutralPrefixes = [
      `我记得${ageLabel}有过这样一件事——`,
      `${ageLabel}那件事对我来说很重要——`,
    ];
    tonalPrefix = neutralPrefixes[Math.floor(Math.random() * neutralPrefixes.length)];
  }

  return `${tonalPrefix} ${base}`;
}

// ════════════════════════════════════════════════════════════
// 3. 记忆整合（情景 → 语义记忆转化）
// ════════════════════════════════════════════════════════════

export interface LifeLesson {
  id: string;
  statement: string;              // 核心领悟
  sourceMemories: string[];        // 来源记忆 ID
  confidence: number;              // [0, 1]
  formedAt: number;
  category: 'trust' | 'love' | 'self' | 'relationship' | 'growth';
  emotionalTone: 'positive' | 'negative' | 'mixed';
}

/**
 * 从多条共享标签的记忆中尝试提炼"人生教训"
 *
 * 整合条件：
 *   - 至少 3 条共享标签的记忆
 *   - 这些记忆的 recallWeight 都 > 0.1
 *   - 情感方向一致（都是正或都是负）
 */
export function tryConsolidateMemories(
  store: EpisodicMemoryStore,
  minMemories: number = 3,
): LifeLesson | null {
  // 按标签分组
  const tagGroups = new Map<string, EpisodicMemory[]>();
  for (const memory of store.episodes) {
    if (memory.recallWeight < 0.1) continue;
    for (const tag of memory.tags) {
      if (!tagGroups.has(tag)) tagGroups.set(tag, []);
      tagGroups.get(tag)!.push(memory);
    }
  }

  // 找最大的组
  let bestGroup: EpisodicMemory[] = [];
  let bestTag = '';
  for (const [tag, group] of tagGroups) {
    if (group.length >= minMemories && group.length > bestGroup.length) {
      bestGroup = group;
      bestTag = tag;
    }
  }

  if (bestGroup.length < minMemories) return null;

  // 检查情感方向一致性
  const valences = bestGroup.map(m => m.emotionalImpact.valenceDelta);
  const positiveCount = valences.filter(v => v > 0).length;
  const negativeCount = valences.filter(v => v < 0).length;
  const totalCount = valences.length;

  // 至少 60% 同方向
  const consistencyRatio = Math.max(positiveCount, negativeCount) / totalCount;
  if (consistencyRatio < 0.6) return null;

  const emotionalTone: LifeLesson['emotionalTone'] =
    consistencyRatio > 0.8
      ? (positiveCount > negativeCount ? 'positive' : 'negative')
      : 'mixed';

  // 生成教训陈述
  const statement = generateLessonStatement(bestTag, emotionalTone, bestGroup.length);

  return {
    id: `lesson_${Date.now()}_${bestTag}`,
    statement,
    sourceMemories: bestGroup.map(m => m.id),
    confidence: Math.round(consistencyRatio * 100) / 100,
    formedAt: Date.now(),
    category: mapTagToCategory(bestTag),
    emotionalTone,
  };
}

// ════════════════════════════════════════════════════════════
// 4. 辅助函数
// ════════════════════════════════════════════════════════════

function generateLessonStatement(
  tag: string,
  tone: LifeLesson['emotionalTone'],
  memoryCount: number,
): string {
  const templates: Record<string, Record<string, string[]>> = {
    '亲密': {
      positive: [
        '真诚的连接需要双方都愿意打开心扉',
        '被看见和被接纳的感觉是关系中最珍贵的馈赠',
        '亲密的时刻往往发生在最不经意的瞬间',
      ],
      negative: [
        '亲密不是理所当然的，它需要持续的经营和呵护',
        '当一方退缩时，另一方需要勇气去维系连接',
      ],
      mixed: [
        '亲密关系中既有甜蜜也有摩擦，两者都是真实的',
        '亲密不是永远不吵架，而是吵完还能靠近',
      ],
    },
    '冲突': {
      negative: [
        '冲突不一定是坏事，但需要双方都有修复的意愿',
        '言语的伤害有时比沉默更深，要谨慎选择表达方式',
      ],
      mixed: [
        '矛盾暴露了关系中的脆弱点，修复它会让关系更坚固',
        '冲突之后的和解，往往让彼此更了解对方',
      ],
      positive: [],
    },
    '道歉': {
      positive: [
        '真诚的道歉能治愈很多看似无法修复的裂痕',
        '原谅别人也是放过自己',
      ],
      mixed: [
        '道歉需要勇气，接受道歉需要时间',
      ],
      negative: [],
    },
    '承诺': {
      positive: [
        '承诺不是约束，而是对彼此的安全感投资',
        '能被承诺的关系，才有勇气去想象共同的未来',
      ],
      mixed: [],
      negative: [],
    },
    '脆弱': {
      positive: [
        '分享脆弱是最高级别的信任',
        '在安全的关系中展现脆弱不是软弱，而是勇敢',
      ],
      mixed: [
        '展现脆弱需要安全的环境，也需要勇气的支撑',
      ],
      negative: [],
    },
    '坦诚': {
      positive: [
        '真正的亲密来自毫无保留的坦诚',
      ],
      mixed: [
        '坦诚是双刃剑——它可能暂时伤害，但长期来看让关系更真实',
      ],
      negative: [],
    },
  };

  const tagTemplates = templates[tag] || {
    positive: [`从 ${memoryCount} 次${tag}相关的经历中，我学到了一些东西`],
    negative: [`${tag}相关的经历让我成长了`],
    mixed: [`${tag}教会了我，关系中总有两面性`],
  };

  const toneTemplates = tagTemplates[tone] || tagTemplates['mixed'];
  return toneTemplates[Math.floor(Math.random() * toneTemplates.length)];
}

function mapTagToCategory(tag: string): LifeLesson['category'] {
  const mapping: Record<string, LifeLesson['category']> = {
    '亲密': 'love',
    '温暖': 'love',
    '冲突': 'relationship',
    '道歉': 'relationship',
    '脆弱': 'trust',
    '坦诚': 'trust',
    '承诺': 'trust',
    '首次': 'growth',
    '回忆': 'self',
    '悲伤': 'self',
  };
  return mapping[tag] || 'growth';
}
