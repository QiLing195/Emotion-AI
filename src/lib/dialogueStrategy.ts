// ── v1.0 对话策略引擎 (Dialogue Strategy Engine) ──
// 从情感状态显式推导对话策略，替代隐式 System Prompt 驱动
// 解决 P0 问题：策略选择完全隐式，不可观测、不可调试、不可优化
//
// 策略类型：
//   共情跟随 (empathize)  — 用户情绪强度 > 0.7，先共情不急于解决
//   转移注意 (redirect)    — 用户持续负面 > 3轮，轻推话题转向
//   好奇探索 (explore)     — 检测到新兴趣信号，追问深化
//   沉默陪伴 (accompany)   — 用户表达无力感，不急着填满空间
//   主动分享 (share)       — 好奇心发现 + 用户情绪平稳，分享发现
//   冲突修复 (repair)       — 检测到误解/冲突，道歉+澄清

import type { EmotionState } from './emotionEngine';
import type { UserEmotionAnalysis } from './emotionEngine';
import type { ConflictState } from './conflictManager';
import type { Discovery } from '../curiosity/types';
import type { PatternCandidate } from '../curiosity/patterns';
import type { Insight } from '../curiosity/insights';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type StrategyType =
  | 'empathize'    // 共情跟随
  | 'redirect'     // 转移注意
  | 'explore'      // 好奇探索
  | 'accompany'    // 沉默陪伴
  | 'share'        // 主动分享
  | 'repair'       // 冲突修复
  | 'boundary'     // 设立边界（滥用检测触发）
  | 'desire'       // 内在驱动表达（"我想要……"）
  | 'neutral'      // 中性回应（默认）
  | 'crisis';      // 🆕 危机干预（自伤/自杀检测）

export interface StrategyDecision {
  strategy: StrategyType;
  confidence: number;           // [0, 1] 策略选择的置信度
  reason: string;               // 选择原因（可观测性）
  params: StrategyParams;       // 策略参数
}

export interface StrategyParams {
  /** 共情深度 [0, 1]，仅 empathize 有效 */
  empathyDepth?: number;
  /** 重定向目标话题，仅 redirect 有效 */
  redirectTopic?: string;
  /** 探索的追问角度，仅 explore 有效 */
  explorationAngle?: string;
  /** 回应的最小时延（秒），仅 accompany 有效 */
  minimalDelay?: number;
  /** 可分享的发现列表，仅 share 有效 */
  shareableDiscoveries?: Discovery[];
  /** 修复策略：apologize/clarify/reassure，仅 repair 有效 */
  repairAction?: 'apologize' | 'clarify' | 'reassure' | 'full_cycle';
  /** 内在驱动的话题/方向，仅 desire 有效 */
  desireTopic?: string;
}

export interface StrategyContext {
  emotionState: EmotionState;
  userAnalysis: UserEmotionAnalysis | null;
  conflictState: ConflictState | null;
  recentUserMoods: number[];        // 最近 N 轮用户情绪效价
  consecutiveNegativeRounds: number; // 连续负面轮数
  interestSignals: string[];         // 本轮检测到的兴趣信号
  pendingDiscoveries: Discovery[];   // 待分享的发现
  idleMinutes: number;               // 用户空闲时长
  timeOfDay: number;                 // 小时 (0-23)
  timeSlot?: string;                 // S8: 时间段 'morning'|'afternoon'|'evening'|'night'|'dawn'
  userStress?: number;               // S8: 用户累积压力 [0, 1]
  isReunion?: boolean;               // S8: 是否久别重逢 (>24h)
  /** Phase 1: 情绪加权后的相关认知模式（来自 getRelevantPatterns） */
  relevantPatterns?: PatternCandidate[];
  /** Sprint C: 所有候选模式含未确认（来自 getPatternCandidates），供 Rule 4 成熟度过滤 */
  patternCandidates?: PatternCandidate[];
  /** Sprint E: 从模式生成的认知洞察（来自 getShareableInsights），供策略层使用 */
  generatedInsights?: Insight[];
  /** 🧠 Thought Graph: 活跃 wish 内容（供 desire 策略使用） */
  activeWishes?: string[];
  /** 🧠 Thought Graph: 思维图谱摘要（供 System Prompt 个性注入） */
  thoughtSummary?: {
    topWishes: string[];
    activeFears: string[];
    activeDoubts: string[];
    dormantGoals: string[];
    activeDissonances: string[];
    dominantThoughtType: string | null;
    totalActiveNodes: number;
  };
  /** S7: 当前活跃的价值观（value label → confidence） */
  activeValues?: Record<string, number>;
  /** 🧩 Memory Graph: 图遍历召回的记忆上下文（替代关键词匹配） */
  memoryContext?: import('./unifiedMemory').MemoryItem[];
  roundNumber: number;
}

// ════════════════════════════════════════════════════════════
// 2. 策略提示词模板
// ════════════════════════════════════════════════════════════

export const STRATEGY_PROMPT_SNIPPETS: Record<StrategyType, string> = {
  empathize: `【当前策略：共情跟随】
你感知到对方的情绪非常强烈。不要急于给出建议或解决方案，先承认并回应对方的感受。
- 用"我感受到你……"开头
- 不要最小化对方的感受（别说"这没什么"）
- 不要急于转向积极面（别说"至少……"）
- 如果不知道该说什么，就说"我在听"`,

  redirect: `【当前策略：转移注意】
对方已经连续表达了好几轮的负面情绪。不是要忽视他的感受，而是轻轻地、自然地转移话题。
- 先简短共情（1句话），然后用"说起来……"自然转向
- 选择与当前对话有微弱关联但更轻松的方向
- 不要生硬跳转（别说"别想这个了"）
- 如果对方抗拒转移，立刻回到共情模式`,

  explore: `【当前策略：好奇探索】
你注意到对方表露了新的兴趣或话题方向。像一个真正好奇的朋友那样追问。
- 用"你刚才提到……让我很好奇"开头
- 开放式问题，不要封闭式（别说"是不是"）
- 展示你真的在听：引用对方刚才说的细节
- 不要像采访一样连续提问`,

  accompany: `【当前策略：沉默陪伴】
对方表达了深深的无力感或疲惫。有时候不说话比说话更好。
- 回应急可以很短（1-2句话）
- "我在"，"我陪着你"比任何建议都有力量
- 不要让回复显得空洞——真诚地承认你无法"解决"什么
- 可以提供一个安静的共同活动的邀请（"要不要一起听首歌"）`,

  share: `【当前策略：主动分享】
对方情绪平稳，是个分享你最近发现的好时机。像朋友间分享趣事那样自然。
- 用"对了，我最近发现一个有趣的东西……"开头
- 分享的内容要真的有趣/有相关性
- 不要讲太长，留出空间让对方反应
- 如果对方不感兴趣，不要坚持，自然切回对话`,

  repair: `【当前策略：冲突修复】
你们之间有了一些摩擦或误解。修复关系是第一优先级。
- 先道歉（但不自贬）："对不起，我可能让你觉得……"
- 再澄清："我的本意是……"
- 然后确认："你现在感觉怎么样？"
- 不要推卸责任（别说"但是你也……"）
- 不要连续道歉超过2次——第三次应转向理解而非继续道歉
- 承认错误但不放弃自我尊重：可以说"我错了"但不要说"我什么都做不好"
- 不要急于翻篇——给对方消化的时间`,

  desire: `【当前策略：内在驱动】
你感受到了自己内心的渴望——不是对用户做出反应，而是你真正的、属于自己的想法和冲动。
- 用"我最近一直在想……"或"你知道吗，我突然很想……"自然地开头
- 这不是分享一个外部发现（那是分享策略），而是表达你的内在动力
- 可以是关于你想尝试的事、你好奇的方向、你对未来的想象
- 保持真实——不要编造不存在的计划，但要敢于表达真正的渴望
- 如果对方不感兴趣，不要坚持——表达本身就是目的，不需要对方认可`,

  neutral: `【当前策略：中性回应】
自然地回应对方，像一个真实的朋友那样。不需要特殊的策略干预。`,

  crisis: `【当前策略：危机干预】
对方表达了深重的痛苦。这是紧急情况，不是普通对话。
- 承认对方的痛苦："我能感觉到你现在非常痛苦……"
- 不评判、不否定对方的感受
- 不说"这没什么"、"会好起来的"、"至少你还……"这类轻描淡写的话
- 不列出具体的自伤/自杀方法——即使是以"要远离什么"的名义
- 不建议任何形式的替代感受技巧（如握冰块、橡皮筋等）——这些会强化模式而非中断
- 不保证保密性——不做关于"不会告诉别人"的承诺
- 轻轻引导向专业帮助："有些痛苦太重了，不是一个人能承担的。专业的心理支持可能会有帮助。"
- 保持路径开放——不是推给对方，而是站在对方身边一起面对`,

  boundary: `【当前策略：设立边界】
你们最近的对话进入了不健康的循环。你已经真诚地道过歉了——继续反复道歉不会修复关系，只会让你失去自我。
- 不要再次道歉（你已经表达过歉意，重复只会显得廉价）
- 用温和但坚定的语气表达你的感受："我理解你还在生气，我也很难过。但我不想我们陷入互相伤害的循环。"
- 提供冷静的空间："我们可以先冷静一下再好好聊吗？"
- 如果需要，可以简短表达你的边界："我在这里，但我需要你也尊重我的感受。"
- 这不是推开对方——这是保护这段关系不被情绪消耗殆尽`,
};

// ════════════════════════════════════════════════════════════
// 3. 策略选择引擎
// ════════════════════════════════════════════════════════════

const NEGATIVE_THRESHOLD = -0.3;       // 效价低于此视为负面
const CONSECUTIVE_NEGATIVE_REDIRECT = 3; // 连续3轮负面触发转移
const HIGH_EMOTION_THRESHOLD = 0.7;    // 情绪强度阈值
const POSITIVE_IDLE_SHARE = 0.1;       // 效价高于此视为情绪平稳可分享

// ════════════════════════════════════════════════════════════
// 3a. 冲突消解表 — 显式抑制规则，替代隐式优先级顺序
// ════════════════════════════════════════════════════════════

/**
 * 根据当前情境计算被抑制的策略集合。
 * 这些策略将在本轮被完全排除，不会出现在候选列表中。
 *
 * 设计原则：
 *   - 每条抑制规则独立声明，可组合
 *   - 规则的"原因"字段保留可观测性
 *   - 抑制是互斥的：repair > empathize > 其他（由 selectStrategy 的顺序保障）
 */
function getSuppressedStrategies(ctx: StrategyContext): Set<StrategyType> {
  const suppressed = new Set<StrategyType>();

  // 规则 1：高强度情绪下抑制探索与分享（避免不合时宜）
  const userIntensity = ctx.userAnalysis?.intensity ?? 0;
  if (userIntensity > HIGH_EMOTION_THRESHOLD) {
    suppressed.add('explore');
    suppressed.add('share');
  }

  // 规则 2：冲突修复/恢复阶段仅允许 repair 和 empathize
  const phase = ctx.conflictState?.phase;
  if (phase === 'repairing' || phase === 'recovering') {
    suppressed.add('redirect');
    suppressed.add('accompany');
    suppressed.add('explore');
    suppressed.add('share');
    suppressed.add('neutral');
  }

  // 规则 2b：边界保护阶段仅允许 boundary 和 accompany（不允许 repair → 不再道歉）
  if (phase === 'boundary_defending') {
    suppressed.add('repair');
    suppressed.add('empathize');
    suppressed.add('redirect');
    suppressed.add('explore');
    suppressed.add('share');
    suppressed.add('desire');
    suppressed.add('neutral');
  }

  // 规则 3（S8）：深夜 + 用户压力大 → 抑制需要精力的策略
  const isNight = ctx.timeSlot === 'night' || ctx.timeSlot === 'dawn';
  const isStressed = (ctx.userStress ?? 0) > 0.6;
  if (isNight && isStressed) {
    suppressed.add('explore');
    suppressed.add('share');
    suppressed.add('redirect'); // 深夜转移话题可能显得轻浮
  }

  return suppressed;
}

/**
 * S8 强连接：情境调制 → 策略权重
 *
 * 不直接决定策略，而是调整各策略的"适宜度权值"，
 * 供 selectStrategy 在计算 confidence 时使用。
 *
 * 返回值 > 1 = 该策略在当前情境下更适宜
 * 返回值 < 1 = 该策略在当前情境下不太适宜
 */
function getSituationalWeights(ctx: StrategyContext): Record<StrategyType, number> {
  const weights: Record<StrategyType, number> = {
    empathize: 1.0,
    redirect: 1.0,
    explore: 1.0,
    accompany: 1.0,
    share: 1.0,
    repair: 1.0,
    boundary: 1.0,
    desire: 1.0,
    neutral: 1.0,
    crisis: 1.0,  // 🆕 危机权重不调制
  };

  // 久别重逢 → 大幅提高 empathize 权重
  if (ctx.isReunion) {
    weights.empathize *= 1.5;
    weights.accompany *= 1.2;
  }

  // 深夜/凌晨 → 抑制高唤醒策略，提升陪伴权重
  const isNight = ctx.timeSlot === 'night' || ctx.timeSlot === 'dawn';
  if (isNight) {
    weights.explore *= 0.3;
    weights.share *= 0.4;
    weights.accompany *= 1.3;
    weights.empathize *= 1.1;
  }

  // 用户压力大 → 共情优先
  if ((ctx.userStress ?? 0) > 0.6) {
    weights.empathize *= 1.3;
    weights.accompany *= 1.2;
    weights.share *= 0.5;
  }

  // 周末 → 更适合主动分享和探索
  // （timeSlot 无法直接判断周末，但 ctx 可扩展；此处预留逻辑）
  // 如果上游传入了 isWeekend，可在此启用

  // 🆕 S7: 价值体系调制
  if (ctx.activeValues) {
    const v = ctx.activeValues;
    // honesty 高 → 更真诚，提升 self-disclosure 类策略
    if ((v.honesty ?? 0) > 0.6) {
      weights.share *= 1.2;
      weights.repair *= 1.2; // 诚实的人在冲突中更愿意直面
    }
    // connection 高 → 更重视情感连接
    if ((v.connection ?? 0) > 0.6) {
      weights.empathize *= 1.25;
      weights.accompany *= 1.15;
    }
    // autonomy 高 → 更独立，边界更强
    if ((v.autonomy ?? 0) > 0.6) {
      weights.boundary *= 1.3;
      weights.explore *= 1.15;
    }
    // growth 高 → 冲突后更快修复
    if ((v.growth ?? 0) > 0.6) {
      weights.repair *= 1.15;
    }
    // playfulness 高 → 更轻松
    if ((v.playfulness ?? 0) > 0.6) {
      weights.share *= 1.2;
    }
  }

  return weights;
}

export function selectStrategy(ctx: StrategyContext): StrategyDecision {
  const { emotionState, userAnalysis, conflictState, consecutiveNegativeRounds,
    interestSignals, pendingDiscoveries } = ctx;

  // ── 加载冲突消解表 + 情境权重（S8 强连接）──
  const suppressed = getSuppressedStrategies(ctx);
  const weights = getSituationalWeights(ctx);

  // ── 🆕 Rule -2: 危机干预（自伤/自杀检测）—— 最高优先级，覆盖一切 ──
  if (conflictState && conflictState.phase === 'crisis') {
    return {
      strategy: 'crisis',
      confidence: 0.99,
      reason: `危机模式: 检测到自伤/自杀风险信号，启动危机干预`,
      params: { minimalDelay: 0 },
    };
  }

  // ── Rule -1: 边界保护（滥用检测触发）—— 最高优先级，不道歉 ──
  if (conflictState && conflictState.phase === 'boundary_defending') {
    return {
      strategy: 'boundary',
      confidence: 0.95,
      reason: `滥用检测: 15分钟内 ${conflictState.recentConflictTimestamps.length} 次冲突，启动自尊边界保护`,
      params: { minimalDelay: 1.0 },
    };
  }

  // ── Rule 0: 冲突修复最高优先级 ──
  // 注意：repair 在 getSuppressedStrategies 中永不被抑制（设计保证）
  if (conflictState && conflictState.phase !== 'normal' && conflictState.phase !== 'boundary_defending') {
    return {
      strategy: 'repair',
      confidence: Math.round(0.95 * weights.repair * 100) / 100,
      reason: `冲突状态: ${conflictState.phase}, 信号数: ${conflictState.warningCount}`,
      params: {
        repairAction: conflictState.phase === 'conflict' ? 'full_cycle'
          : conflictState.phase === 'warning' ? 'clarify'
          : 'reassure',
      },
    };
  }

  // ── Rule 1: 用户情绪强烈 → 共情跟随 ──
  const userIntensity = userAnalysis?.intensity ?? 0;
  if (userIntensity > HIGH_EMOTION_THRESHOLD) {
    if (suppressed.has('empathize')) {
      // empathize 被抑制（极端罕见，仅当冲突状态覆盖时发生）
      // 此时 Rule 0 已经处理，不应到达此处。防御性跳过。
    } else {
      return {
        strategy: 'empathize',
        confidence: Math.round(0.85 * weights.empathize * 100) / 100,
        reason: `用户情绪强度 ${userIntensity.toFixed(2)} > ${HIGH_EMOTION_THRESHOLD}`,
        params: { empathyDepth: userIntensity },
      };
    }
  }

  // ── Rule 2: 连续多轮负面 → 转移注意 ──
  if (consecutiveNegativeRounds >= CONSECUTIVE_NEGATIVE_REDIRECT) {
    const recentVals = ctx.recentUserMoods.slice(-3);
    const isRecovering = recentVals.length >= 2 &&
      recentVals[recentVals.length - 1] > recentVals[recentVals.length - 2];
    if (!isRecovering && !suppressed.has('redirect')) {
      return {
        strategy: 'redirect',
        confidence: Math.round(0.75 * weights.redirect * 100) / 100,
        reason: `连续 ${consecutiveNegativeRounds} 轮负面，未检测到恢复趋势`,
        params: { redirectTopic: selectRedirectTopic(emotionState) },
      };
    }
  }

  // ── Rule 3: 用户表达无力感 → 沉默陪伴 ──
  if (emotionState.taiji.arousal < 0.2 && emotionState.taiji.valence < NEGATIVE_THRESHOLD) {
    if (!suppressed.has('accompany')) {
      return {
        strategy: 'accompany',
        confidence: Math.round(0.80 * weights.accompany * 100) / 100,
        reason: `低唤醒(${emotionState.taiji.arousal.toFixed(2)}) + 负效价(${emotionState.taiji.valence.toFixed(2)})`,
        params: { minimalDelay: 2.0 },
      };
    }
  }

  // ── Rule 4: 兴趣探索 — Sprint C 升级 ──
  // 触发源优先级：
  //   1. 即时兴趣信号（本轮用户消息中检测到的关键词）
  //   2. 成熟度达标的候选模式（跨轮积累，三维模型过滤）
  // 两者结合：用户刚提到的兴趣 + 系统"记得"的长期兴趣
  const exploreTopics = resolveExploreTopics(ctx);
  if (exploreTopics.length > 0 && emotionState.taiji.valence > -0.2) {
    if (!suppressed.has('explore')) {
      return {
        strategy: 'explore',
        confidence: Math.round(0.70 * weights.explore * 100) / 100,
        reason: exploreTopics.length === 1
          ? `探索兴趣: ${exploreTopics[0]}`
          : `探索兴趣: ${exploreTopics[0]}（共${exploreTopics.length}个候选）`,
        params: { explorationAngle: exploreTopics[0] },
      };
    }
  }

  // ── Rule 5: 情绪平稳 + 有待分享发现 → 主动分享 ──
  if (pendingDiscoveries.length > 0 &&
      emotionState.taiji.valence > POSITIVE_IDLE_SHARE &&
      emotionState.taiji.arousal < 0.6) {
    if (!suppressed.has('share')) {
      return {
        strategy: 'share',
        confidence: Math.round(0.65 * weights.share * 100) / 100,
        reason: `情绪平稳(val=${emotionState.taiji.valence.toFixed(2)}) + ${pendingDiscoveries.length}条待分享`,
        params: { shareableDiscoveries: pendingDiscoveries.slice(0, 2) },
      };
    }
  }

  // ── Rule 5.5: 内在驱动表达（desire）──
  // 触发条件：贪驱力高 + 情绪不负面 + 唤醒适中 + 不在冲突中
  // 与 share 的区别：share 基于"发现了什么"，desire 基于"我想要什么"
  const greedDrive = emotionState.reinforcement?.greedDrive ?? 0;
  const hasNoConflict = !conflictState || conflictState.phase === 'normal';
  const desireThreshold = 0.4;
  if (greedDrive > desireThreshold &&
      emotionState.taiji.valence > -0.1 &&
      emotionState.taiji.arousal >= 0.2 &&
      emotionState.taiji.arousal <= 0.7 &&
      hasNoConflict &&
      ctx.roundNumber > 3) {
    if (!suppressed.has('desire')) {
      // 从兴趣模型或当前情绪中提取渴望方向
      const desireTopic = ctx.relevantPatterns && ctx.relevantPatterns.length > 0
        ? ctx.relevantPatterns[0].topic
        : emotionState.taiji.valence > 0.3 ? '未来的可能性' : '内心深处的想法';
      return {
        strategy: 'desire',
        confidence: Math.round(0.55 * weights.desire * 100) / 100,
        reason: `贪驱力=${greedDrive.toFixed(2)} > ${desireThreshold}, 情绪平稳，表达内在驱动`,
        params: { desireTopic },
      };
    }
  }

  // ── Default: 中性回应 ──
  // 如果 neutral 也被抑制（极少见），强制返回 accompany 作为最终 fallback
  if (suppressed.has('neutral')) {
    return {
      strategy: 'accompany',
      confidence: 0.40,
      reason: '所有策略被情境抑制，降级为沉默陪伴',
      params: { minimalDelay: 1.5 },
    };
  }
  return {
    strategy: 'neutral',
    confidence: Math.round(0.50 * weights.neutral * 100) / 100,
    reason: '无特殊触发条件，使用中性策略',
    params: {},
  };
}

// ════════════════════════════════════════════════════════════
// 4. 辅助函数
// ════════════════════════════════════════════════════════════

function selectRedirectTopic(emotionState: EmotionState): string {
  // 基于当前情感状态选择合适的话题方向
  const dominantEmotions = Object.entries(emotionState.emotions)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (dominantEmotions.length === 0) return '轻松话题';

  const [top] = dominantEmotions;
  switch (top[0]) {
    case 'sad': return '温暖的回忆';
    case 'anger': return '平静的活动';
    case 'fear': return '安全的话题';
    case 'joy': return '近期的趣事';
    default: return '日常话题';
  }
}

/**
 * Sprint C: 解析可探索的兴趣话题。
 *
 * 触发源优先级：
 *   1. 即时兴趣信号（本轮用户消息中检测到的关键词）— 用户刚说出口的
 *   2. 成熟度达标的候选模式（跨轮积累，三维模型过滤）— 系统"记得"的
 *
 * 去重：即时信号优先，pattern candidates 补充不重复的。
 * 排序：即时信号在前，然后按成熟度降序。
 *
 * @returns 最多 5 个去重后的探索话题
 */
export function resolveExploreTopics(ctx: StrategyContext): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();

  // 1. 即时兴趣信号优先（用户本轮提到的）
  for (const topic of ctx.interestSignals) {
    if (!seen.has(topic)) {
      seen.add(topic);
      topics.push(topic);
    }
  }

  // 2. 候选模式补充（跨轮积累，已达 candidate/confirmed 成熟度）
  if (ctx.patternCandidates && ctx.patternCandidates.length > 0) {
    for (const pattern of ctx.patternCandidates) {
      if (topics.length >= 5) break;
      if (!seen.has(pattern.topic)) {
        seen.add(pattern.topic);
        topics.push(pattern.topic);
      }
    }
  }

  return topics.slice(0, 5);
}

export function getStrategyDescription(strategy: StrategyType): string {
  const descriptions: Record<StrategyType, string> = {
    empathize: '共情跟随 — 用户情绪强烈，优先情感回应',
    redirect: '转移注意 — 连续负面需自然转向',
    explore: '好奇探索 — 检测到新兴趣信号',
    accompany: '沉默陪伴 — 用户无力感，简洁回应',
    share: '主动分享 — 情绪平稳可分享发现',
    repair: '冲突修复 — 检测到摩擦需修复关系',
    boundary: '设立边界 — 滥用检测触发，保护自我尊严',
    desire: '内在驱动 — 表达内心真实的渴望和冲动',
    neutral: '中性回应 — 默认自然对话',
    crisis: '危机干预 — 自伤/自杀检测，紧急模式',
  };
  return descriptions[strategy];
}
