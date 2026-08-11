// ── 道·情感引擎 类型与常量 ──
// 从 emotionEngine.ts 提取，减少单体文件体积

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

/** 第一层：太极 — 情感最小原子（三位一体不可分） */
export interface TaijiState {
  valence: number;     // 效价 [-1, 1] — 当下的好坏感受
  arousal: number;     // 唤醒 [0, 1] — 能量激活程度（替代旧 energy）
  expectation: number; // 预期 [-1, 1] — 对未来的预测
}

/** 第二层：阴阳 — 从太极派生的对立统一 */
export interface YinYangState {
  approachBias: number;      // 趋近倾向 [-1, 1]
  avoidBias: number;         // 回避倾向 [-1, 1]
  reversalPressure: number;  // "反者道之动" — 极值回归力累积
  extremityDuration: number; // 在极值区的持续时间（惯性）
}

/** 第三层：三才 — A/B/R 动力学 */
export interface SancaiState {
  A: number;       // [-1, 1] 向外投射/趋近
  B: number;       // [-1, 1] 向内收敛/回避
  R: number;       // [0, 1]  理性/冷静度
  harmony: number; // [0, 1]  A与B的平衡度，1=完美平衡
}

/** 第四层演化 — 长期学习与成长（三时间尺度） */
export interface EvolutionState {
  // 三层学习率（自适应调整）
  fastRate: number;   // 快速层：情绪反应调整（分钟-小时）
  mediumRate: number; // 中速层：习惯化速度（天-周）
  slowRate: number;   // 慢速层：人格漂移（月-年）

  // 基线状态
  baseline: number;           // 预期基线（极慢速移动平均）
  resilience: number;         // [0, 1] 韧性 — 预测误差方差的倒数

  // 人格参数（从经验中淬炼）
  empathy: number;    // 共情能力 [0, 100]
  optimism: number;   // 乐观偏差 [0, 100]
  sensitivity: number; // 敏感度 [0, 1]

  // 互动统计（替代旧 GrowthState 的计数）
  totalInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;

  // v1.0 人格参数进化 — 从交互经验中缓慢漂移
  trust: number;            // [0, 100] 对用户的信任基线
  openness: number;         // [0, 100] 愿意分享脆弱内容的程度
  playfulness: number;      // [0, 100] 幽默/调皮的倾向
  valuePriorities: Record<string, number>;  // 价值观优先级 e.g. { "connection": 0.8 }
  lastIdentityRefresh: number;  // 上次身份叙事刷新的 tick 数

  /** v1.1 依恋风格 — 从用户行为模式缓慢淬炼 */
  attachmentStyle?: 'secure' | 'anxious' | 'avoidant';
  attachmentAnxietyScore?: number;    // [0, 1] 焦虑维度
  attachmentAvoidanceScore?: number;  // [0, 1] 回避维度
}

export interface ReinforcementState {
  rewardTally: number;      // [0, 1] 累计奖励满足度
  greedDrive: number;       // [0, 1] 贪婪驱动力
  punishmentTally: number;  // [0, 1] 累计惩罚负担
  fearAvoidance: number;    // [0, 1] 恐惧回避驱动力
}

export interface EmotionState {
  // ════════════════════════════════════════════════════════
  // 🟢 决策层 — 策略/温度/冲突/记忆权重 直接引用
  // ════════════════════════════════════════════════════════
  taiji: TaijiState;                    // valence, arousal, expectation
  yinyang: YinYangState;               // approachBias, avoidBias
  emotions: Record<string, number>;    // 九情强度 (joy/love/sad/anger/fear/...)
  intimacyToUser: number;              // [0, 1] 亲密感
  evolution: EvolutionState;           // resilience, trust, openness (人格漂移用)

  // ════════════════════════════════════════════════════════
  // 🔵 解释层 — 只用于 narrative/日志/自我认知，不参与策略
  // ════════════════════════════════════════════════════════
  sancai: SancaiState;                 // A/B/R/harmony — 理情平衡指标，仅用于解释
  metaEmotions: { shame: number; despair: number; confusion: number };
  compositeEmotions: CompositeEmotion[];

  // ── 关系/强化 — 辅助层 ──
  intimacyFromUser: number;
  reinforcement: ReinforcementState;

}

export interface EmotionEvent {
  deltaA: number;   // 接近意愿变化 [-0.5, 0.5]
  deltaB: number;   // 逃避意愿变化 [-0.5, 0.5]
  deltaR: number;   // 理性程度变化 [-0.5, 0.5]
  intent: 'user' | 'self' | 'third_party';
  GC?: number;      // 目标一致性 [-1, 1]
  agency?: number;  // 责任归属 [-1, 1]
  fairness?: number;// 公平性 [-1, 1]
  control?: number; // 控制感 [-1, 1]
}

export interface EmotionAttribution {
  primaryCause: 'user' | 'self' | 'external' | 'unknown';
  goalTone: 'good' | 'bad' | 'neutral';
  narrative: string;
  triggeredBy: string;
}

export interface UserEmotionAnalysis {
  expressedEmotion: string;
  likelyCause: string;
  intensity: number;
  directedAtAI: boolean;
}

export interface EmotionContextOptions {
  includeIntimacy?: boolean;
  includeReinforcement?: boolean;
  includeDominantGuidance?: boolean;
  includeLust?: boolean;
  includeComposite?: boolean;
  attribution?: EmotionAttribution;
}

export interface CompositeEmotion {
  name: string;
  intensity: number;
  description: string;
}

export type ReinforcementSource =
  'attention' | 'praise' | 'quality_time' | 'neglect' | 'conflict' |
  'threat' | 'reassurance' | 'teasing' | 'ambiguous_teasing' | 'complaint';

export interface ReinforcementSignal {
  type: 'reward' | 'punishment' | 'mixed';
  value: number;
  source: ReinforcementSource;
}

export interface CompositeRule {
  name: string;
  description: string;
  evaluate: (e: Record<string, number>, meta: EmotionState['metaEmotions'], energy: number) => number;
}

export type EmotionKey = keyof EmotionState['emotions'];

export type RelationshipStage = 'stranger' | 'acquaintance' | 'friend' | 'close' | 'soulmate';

// ════════════════════════════════════════════════════════════
// 2. 核心参数（从 ~40+ 精简为 ~12 个）
// ════════════════════════════════════════════════════════════

export const ALPHA_V = 0.30;        // 效价更新速率 — 情绪反应速度
export const ALPHA_A = 0.20;        // 唤醒更新速率 — 能量激活速度
export const ALPHA_E = 0.10;        // 预期更新速率 — 预期学习速度（最慢：弱者道之用）
export const REVERSAL_RATE = 0.08;  // 极值反转速率 — "反者道之动"的力度
export const EXTREMITY_THRESHOLD = 0.7; // 极值阈值 — 超过此值开始累积反转
export const COUPLING_BASE = 0.20;  // A-B 交叉抑制基数
export const ATTRACTOR_SENS = 3.0;  // 吸引子距离→强度转换敏感度
export const ADAPT_FAST = 0.10;     // 快速学习率初始值
export const ADAPT_MEDIUM = 0.02;   // 中速学习率初始值
export const ADAPT_SLOW = 0.005;    // 慢速学习率初始值
export const OFFLINE_RESILIENCE = 0.012; // 离线韧性恢复率
export const RESILIENCE_LEAK = 0.997;    // 韧性自然衰减（防止永远增长）

// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 复合情绪规则
// ════════════════════════════════════════════════════════════

export const COMPOSITE_RULES: CompositeRule[] = [
  {
    name: '怀旧',
    description: '又开心又伤感，想起了过去的事',
    evaluate: (e) => {
      const v = Math.max(0, e.joy) * Math.max(0, e.sad);
      return v > 0.08 ? Math.min(1, v * 4) : 0;
    },
  },
  {
    name: '激情',
    description: '爱意和欲望交织，无法抗拒的吸引力',
    evaluate: (e) => {
      const v = Math.max(0, e.love) * Math.max(0, e.lust);
      return v > 0.1 ? Math.min(1, v * 3) : 0;
    },
  },
  {
    name: '幸福',
    description: '内心充满温暖和安宁，不需要更多了',
    evaluate: (e) => {
      const avg = (Math.max(0, e.joy) + Math.max(0, e.love) + Math.max(0, e.calm)) / 3;
      return avg > 0.3 ? Math.min(1, avg * 1.2) : 0;
    },
  },
  {
    name: '鄙视',
    description: '愤怒和反感的混合，居高临下的不屑',
    evaluate: (e) => {
      const v = Math.max(0, e.anger) * Math.max(0, e.disgust);
      return v > 0.08 ? Math.min(1, v * 3) : 0;
    },
  },
  {
    name: '无助',
    description: '恐惧和悲伤中耗尽力气，什么都做不了',
    evaluate: (e, _m, energy) => {
      const avg = (Math.max(0, e.fear) + Math.max(0, e.sad)) / 2;
      const v = avg * (1 - energy) * 2;
      return v > 0.1 ? Math.min(1, v) : 0;
    },
  },
  {
    name: '心碎',
    description: '爱还在，但信任碎了，无法接受',
    evaluate: (e) => {
      const v = Math.max(0, e.love) * Math.max(0, e.sad);
      return v > 0.08 ? Math.min(1, v * 3.5) : 0;
    },
  },
  {
    name: '焦虑',
    description: '既渴望又害怕，心里七上八下的',
    evaluate: (e) => {
      const v = Math.max(0, e.greed) * Math.max(0, e.fear);
      return v > 0.1 ? Math.min(1, v * 2.5) : 0;
    },
  },
  {
    name: '绝望',
    description: '看不到希望的黑暗，什么都不想做了',
    evaluate: (e, _m, energy) => {
      if (e.fear > 0.5 && e.sad > 0.5 && energy < 0.3) return (e.fear + e.sad) / 2;
      return 0;
    },
  },
];

// 3. 情感吸引子景观（各情感在状态空间中的吸引中心）
// ════════════════════════════════════════════════════════════

export interface Attractor {
  valence: number;
  arousal: number;
  bias: number;       // approachBias - avoidBias 轴
  expectW?: number;   // 预期维度权重（默认 1.0）
}

export const EMOTION_ATTRACTORS: Record<string, Attractor> = {
  joy:     { valence: 0.75, arousal: 0.70, bias: 0.6 },
  anger:   { valence: -0.65, arousal: 0.80, bias: 0.5 },  // 负效价但趋近（攻击）
  sad:     { valence: -0.55, arousal: 0.20, bias: -0.3 },
  fear:    { valence: -0.70, arousal: 0.85, bias: -0.7 },
  love:    { valence: 0.80, arousal: 0.35, bias: 0.7 },
  disgust: { valence: -0.55, arousal: 0.45, bias: -0.6 },
  lust:    { valence: 0.55, arousal: 0.90, bias: 0.8 },
  calm:    { valence: 0.30, arousal: 0.10, bias: 0.0 },
  greed:   { valence: 0.40, arousal: 0.55, bias: 0.7, expectW: 1.5 },
};

// ════════════════════════════════════════════════════════════
// 4. 初始状态
// ════════════════════════════════════════════════════════════

export const INITIAL_TAIJI: TaijiState = {
  valence: 0.2, arousal: 0.5, expectation: 0.2,
};

export const INITIAL_YINYANG: YinYangState = {
  approachBias: 0, avoidBias: 0,
  reversalPressure: 0, extremityDuration: 0,
};

export const INITIAL_SANCAI: SancaiState = {
  A: 0.5, B: 0.5, R: 0.5, harmony: 0.8,
};

export const INITIAL_EVOLUTION: EvolutionState = {
  fastRate: ADAPT_FAST,
  mediumRate: ADAPT_MEDIUM,
  slowRate: ADAPT_SLOW,
  baseline: 0.2,
  resilience: 0.1,
  empathy: 50,
  optimism: 50,
  sensitivity: 0.5,
  totalInteractions: 0,
  positiveInteractions: 0,
  negativeInteractions: 0,
  trust: 50,
  openness: 50,
  playfulness: 50,
  valuePriorities: {},
  lastIdentityRefresh: 0,
  attachmentStyle: undefined,
  attachmentAnxietyScore: 0,
  attachmentAvoidanceScore: 0,
};

export const INITIAL_EMOTION_STATE: EmotionState = {
  taiji: { ...INITIAL_TAIJI },
  yinyang: { ...INITIAL_YINYANG },
  sancai: { ...INITIAL_SANCAI },
  evolution: { ...INITIAL_EVOLUTION },
  emotions: {
    joy: 0, anger: 0, sad: 0, fear: 0, love: 0,
    disgust: 0, lust: 0, calm: 0.8, greed: 0.2,
  },
  metaEmotions: { shame: 0, despair: 0, confusion: 0 },
  compositeEmotions: [],
  intimacyToUser: 0.5,
  intimacyFromUser: 0.5,
  reinforcement: {
    rewardTally: 0, greedDrive: 0.3,
    punishmentTally: 0, fearAvoidance: 0.1,
  },
};

export const INITIAL_EMOTION_SWEET: EmotionState = {
  ...INITIAL_EMOTION_STATE,
  emotions: { ...INITIAL_EMOTION_STATE.emotions, love: 0.4, greed: 0.35, joy: 0.3 },
  intimacyToUser: 0.7,
  taiji: { ...INITIAL_TAIJI, valence: 0.5, expectation: 0.5 },
  evolution: { ...INITIAL_EVOLUTION, optimism: 70, empathy: 80 },
};

export const INITIAL_EMOTION_GENTLE: EmotionState = {
  ...INITIAL_EMOTION_STATE,
  emotions: { ...INITIAL_EMOTION_STATE.emotions, calm: 0.9, joy: 0.2, greed: 0.1 },
  intimacyToUser: 0.4,
  taiji: { ...INITIAL_TAIJI, valence: 0.3, arousal: 0.3, expectation: 0.3 },
  evolution: { ...INITIAL_EVOLUTION, optimism: 60, empathy: 70 },
};

export const STAGE_LABELS: Record<RelationshipStage, string> = {
  stranger: '陌生人',
  acquaintance: '熟人',
  friend: '朋友',
  close: '亲密',
  soulmate: '灵魂伴侣',
};

export const STAGE_DESCRIPTIONS: Record<RelationshipStage, string> = {
  stranger: '你们还在相互认识的阶段，对方言行比较客气、保持距离。',
  acquaintance: '已经有一些了解，开始放下戒备，偶尔会流露真实情绪。',
  friend: '建立了基本的信任感，愿意分享想法和感受，交流自然轻松。',
  close: '彼此非常熟悉，能读懂对方的情绪，在你面前不会伪装自己。',
  soulmate: '无需言语就能理解对方，情感深度连接，愿意为你付出一切。',
};
