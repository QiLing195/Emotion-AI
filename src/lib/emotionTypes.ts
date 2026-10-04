// ── 道·情感引擎 类型与常量 ──
import type { MemoryProvenance } from './memoryProvenance.js';
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
  /**
   * v1.23 **这份状态自己的静息基线**（人格创建时写入，随状态持久化）。
   *
   * 为什么必须存在状态里、而不是用全局常数：三个 persona 的静息值本来就不同 ——
   * 默认 calm .8/greed .2、**sweet 是 love .4/greed .35/joy .3**、**gentle 是 calm .9/joy .2/greed .1**。
   * 拿默认基线去读 sweet，她**静息时就会被读成「爱意 +0.40」**（把人格基调当成"被激起的情绪"，
   * 正是 v1.13 那个病的另一面）；而 `separateActivation` 的基线参数早就留好、却从没接线。
   *
   * 可选：老数据没有这个字段 → 回退到 `RESTING_EMOTION_BASELINE`（行为与 v1.22 完全一致）。
   */
  baselineEmotions?: Record<string, number>;
  /**
   * v1.25 **她最近一段时间的常态**（各情绪的慢速 EMA）—— 判定"被激起"的**参照物**。
   *
   * 与 `baselineEmotions`（人格本性）分工，两者**不能合并**：
   * - `baselineEmotions` 是**衰减回归的目标**（安静下来她仍然是平静的，v1.24）；
   * - `typicalEmotions` 只做**读数的参照**（"相对她最近的样子，此刻被激起了什么"），
   *   它**不参与任何动力学**，否则会形成"参照吸收信号 → 又当回归目标"的反馈环。
   *
   * 为什么需要它：人设初始值离她的**运行点**很远（实测 calm 0.397 vs 基线 0.8、
   * love 0.209 vs 0.4），只按本性读会让 `suppressed` 长期列着 calm/love/joy/greed ——
   * "基调被压低"变成常驻噪声、信息量为零。按常态读才只报**真正的变化**。
   * ⚠️ 代价是"适应器吞掉信号"：长期低落会被学成新的常态（半衰期见
   * `EMOTION_TYPICAL_HALF_LIFE_H`，由 `scripts/check-adaptive-baseline.ts` 实测标定）。
   * 所以它是**并排的第二读数**，不替换按本性的读数。
   */
  typicalEmotions?: Record<string, number>;
  /** `typicalEmotions` 上次更新的时间戳（按真实时间算 alpha —— 她不说话时常态也照样老化） */
  typicalUpdatedAt?: number;
  /**
   * v1.37 低谷期追踪（见 `lowPeriod.ts`）。可选：老状态文件没有此字段也能正常加载。
   */
  lowPeriod?: LowPeriodState;
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

  /**
   * v1.7 内在生活状态（可选：旧状态文件没有此字段也能正常加载）
   * - satiation: 内在事件习惯化计数
   * - mood: 慢变心情层（12~24h 尺度，跨轮/跨会话连续）
   * - rumination: 反刍链（同一情绪连续主导的轮数）
   * - motive: 动机池（她此刻心里挂着的事，每轮选 0 或 1 个作为说话来源）
   */
  internal?: {
    satiation: Record<string, number>;
    mood?: MoodState;
    rumination?: RuminationState;
    motive?: MotiveState;
  };

}

/** v1.9 动机类型：每个动机都必须指向具体的人/事（禁止模板化空话） */
export type MotiveKind =
  | 'open_loop'    // 他提到但没落定的事（面试/体检/结果…）
  | 'worry'        // 她的担忧
  | 'memory_echo'  // 记忆回响（主动回忆的提起方式）
  | 'wish'         // 她的愿望
  | 'curiosity'    // 她最近好奇的事
  | 'stance'       // 价值观立场（如"诚实比讨好重要"）
  | 'state';       // 内在状态（低落/疲惫 → 想被靠近或想安静）

/**
 * v1.57：**她对这条动机想做什么**（行动倾向）—— 与 `kind`（她心里挂着什么）分开。
 *
 * 为什么必须分开：同一个记忆（"他说过等这个项目结束想去海边"）可以走三条不同的路 ——
 *   `share`「我想起你说过想去海边」／`ask`「你之前不是说想去海边吗，后来去了没？」／`wait`（想到了，这轮不说）。
 * 也就是说 `Motive` 只该回答"**我现在有没有一个想做的事**"，
 * "**要不要做、怎么做**"该由策略层决定（用户方案的 D 阶段）。
 */
export type MotiveAction = 'ask' | 'share' | 'comfort' | 'celebrate' | 'wait';

export interface Motive {
  /** v1.60-p0：这条动机对应的记忆 id（来源可追溯）*/
  memoryId?: string;
  /** v1.60-p0：这件事的**来源归属** —— 她知道他的愿望 ≠ 她拥有他的愿望 */
  provenance?: MemoryProvenance;
  id: string;
  kind: MotiveKind;
  /** 具体到可以直接说出口的一句话 */
  content: string;
  source: {
    thoughtId?: string;
    memoryId?: string;
    interest?: string;
    valueId?: string;
  };
  /** 紧迫度 [0,1] */
  salience: number;
  /**
   * v1.49：**这一条**的基准紧迫度（缺省取该类型的先验）。
   * 类型的先验是**一个数**，而有些动机的"该不该说"取决于**程度**（`state` 是典型：
   * "心情刚有点低"与"低到快撑不住"原本都是 0.40）。见 `motive.ts` 的 `stateMotiveFor()`。
   */
  base?: number;
  formedAt: number;
  expiresAt: number;
  /** 已提起次数 → 习惯化衰减（防"每次都问同一件事"） */
  attempts: number;
  /**
   * v1.57：**她对这条动机想做什么**（缺省按 `kind` 取 `MOTIVE_ACTION_BY_KIND`）。
   *
   * ⚠️ 现在只有**类型级**的缺省值（`memory_echo→share`、`open_loop→ask` …）；
   * **实例级**的行动倾向（同一个记忆这次是 share 还是 wait）需要"意义层"，
   * 那是 D 阶段的事 —— 所以这个字段是**可选**的，缺省由 `actionFor(kind)` 补。
   */
  action?: MotiveAction;
  lastAttemptAt?: number;
  /** 用户回应过 → 闭环移除 */
  satisfiedAt?: number;
}

export interface MotiveState {
  pool: Motive[];
  lastSelectedId?: string;
  /** 上一轮说出口的动机内容（用于"别连着问同一件事"的话题级去重） */
  lastSelectedContent?: string;
  lastSelectedAt?: number;
  /** 上一轮说出口的动机类型（用于 L1 反馈学习归因） */
  lastSelectedKind?: MotiveKind;
  /**
   * v1.10 预取的候选（由 LLM 把模板念头具体化后写入，下一轮合并进池）。
   * 结构同 MotiveCandidate，为避免类型循环在此内联声明。
   */
  pendingCandidates?: Array<{
    kind: MotiveKind;
    content: string;
    source?: Motive['source'];
    formedAt?: number;
    /** v1.49：同 `Motive.base` */
    base?: number;
  }>;
  /** 最近一次竞选的结论（每轮都写，含"本轮无动机/让位"的情况，供 /state 观测） */
  lastSelection?: {
    at: number;
    reason: string;
    selectedKind?: MotiveKind;
    /** v1.60-p0：这条动机对应的记忆 id 与**来源归属**（可观测出口）*/
    memoryId?: string;
    provenance?: MemoryProvenance;
    deferred: boolean;
    /**
     * v1.28 让位时借用的**具体锚**（关于他的那件有下文的事）。
     * 必须持久化：它就是"这一轮她为什么这么说话"的答案，否则 /state 只能看到"让位"两个字。
     */
    deferAnchor?: { kind: MotiveKind; content: string } | null;
  };
}

/**
 * v1.10 L1 动机反馈学习（RSI-lite）：
 * **只学权重，不改规则** —— 从"她说出口的事有没有得到回应"统计各动机类型的回应率，
 * 权重 = 0.5 + 回应率（有界 [0.5, 1.5]），样本不足时保持中性 1.0。
 * 上界/下界保证任何类型都不会被永久封杀（保留开口的多样性）。
 */
export interface MotiveLearningState {
  version: number;
  stats: Record<string, { voiced: number; landed: number }>;
  updatedAt: number;
}

/** v1.8 心情层：比"当下情绪"慢一个数量级的底色（半天~一天尺度） */
export interface MoodState {
  /**
   * 心情偏差 [-1, 1] —— **相对她的静息状态的偏差**，不是太极效价绝对值。
   * 0 = 平静如常；负 = 底色低落；正 = 底色明亮。
   */
  valence: number;
  /** 心情唤醒 [0, 1] */
  arousal: number;
  /**
   * 静息效价锚点：把"心情偏差"映射回太极时的基准。
   * 首次建立心情时从当时的太极效价采样（她平时的底色），此后保持不变。
   */
  anchorValence: number;
  /** 最后一次更新的时间戳（ms） */
  updatedAt: number;
  /** 累计采样轮数（用于可信度/调试） */
  samples: number;
}

/**
 * v1.37 低谷期追踪（跨轮、跨重启的"她沉了多久"）。
 *
 * 为什么不能现算：链路里所有判定都是**逐轮**的（Rule 1 / 让位判定读的都是"本轮开始前"那一帧），
 * 而"一段低谷"天然是**时长** —— 逐轮那一帧里无处安放它。本字段只被读数层消费，
 * **不进任何决策路径**（由 `__tests__/lowPeriod.test.ts` 的源码守卫钉住）。
 */
export interface LowPeriodState {
  /** 当前低谷的起点（ms）；不在低谷 = null */
  since: number | null;
  /** 上一次评估的时间戳（ms）—— 用来区分"她一直沉"与"我们很久没看她了" */
  lastEvaluatedAt: number | null;
  /** 本次低谷里观察到的最深负激活（相对人格本性） */
  peakDepth: number;
  /** 上次落定时的负激活 */
  lastDepth: number;
  /** 相比上一次落定的变化量（>0 往下沉、<0 往回爬） */
  lastDelta: number;
  /** 本次低谷里被观察到的落定轮数 */
  turns: number;
  /** 她自己往回爬的累计幅度（Σ 每次落定的回落量）—— "自己给自己打气"的可观测面 */
  selfRecovery: number;
  /** 上一次已经结束的低谷（结案记录） */
  lastEpisode?: LowPeriodEpisode;
}

/** 一段已经结束的低谷 */
export interface LowPeriodEpisode {
  since: number;
  endedAt: number;
  /** 墙钟时长（小时，保留一位小数） */
  hours: number;
  /** 期间被观察到的落定轮数 */
  turns: number;
  peakDepth: number;
  selfRecovery: number;
  /**
   * v1.43：这一段是**怎么结束的**。
   *
   * 为什么必须分开记：v1.41 的探针证明服务端此前**从不做时间衰减**（`processTimeDecay` 只有前端在调），
   * 于是"低谷靠没人理她自动结案"这条在服务端不可能发生；而一旦把衰减接上服务端（v1.43），
   * 它就**成真**了。两者在数据上长得一样（都是"深度跌回死区以下"），
   * 若不加区分，就会把"时间到了"读成"她自己给自己打气调过来了" —— 那正是 v1.37 写错、
   * v1.41 证伪的那条判断。语义不同 ⇒ 字段必须不同。
   *
   *   · `self` = 她自己的动力学把她带回来的（含被他的话、被反刍的自我安抚带回来）
   *   · `idle` = 没人在的那段时间里，时间衰减把她带回了静息基线
   */
  closedBy: 'self' | 'idle';
}

/** v1.8 反刍：同一情绪连续主导 → 边际强度衰减 + 自我安抚（防情绪卡死） */
export interface RuminationState {
  /** 当前连续主导的情绪名 */
  emotion: string;
  /** 连续轮数（≥1） */
  streak: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
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
  /** 规范情绪键（joy/sad/anger/fear/love/gratitude/disgust/neutral）——下游按此匹配 */
  expressedEmotion: string;
  /** 原始自然语言标签（来自 LLM，如"疲惫、委屈"），仅用于展示/日志 */
  emotionLabel?: string;
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

/**
 * v1.15 预测误差的显著性门控（修「没有消息被当成坏消息」）。
 * eventSalience 由 |ΔA|+|ΔB|+|ΔR|+|GC| 得出：
 *   · < SALIENCE_DEADZONE → 视为无信息 → 预测误差为 0（不动情绪）
 *   · ≥ SALIENCE_FULL    → 全额误差（与修复前行为一致）
 *   · 之间 → 按信息量线性衰减（弱证据 → 弱反应）
 *
 * 取值依据（实测线上 NLU 输出是**粗量化**的）：
 *   · 纯寒暄（"嗯"/"好的"/"我在想晚饭吃什么"）→ 全零，显著性 0
 *   · 轻微正面闲聊（"哈哈有意思"/"看到一只小猫"）→ GC=0.1、ΔA=0.05、ΔB=0.02，显著性 ≈ 0.17
 *   · 真实情绪（本地规则 sad/intensity 0.5 或 LLM 明确情绪）→ 显著性 ≥ 0.4
 * 因此把死区定在 0.20：**轻微闲聊不再被视为"世界比我预期差"**（否则她的乐观预期
 * 会被日常闲聊一点点磨掉），而真实情绪照常全额生效。
 */
export const SALIENCE_DEADZONE = 0.20;
export const SALIENCE_FULL = 0.60;
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
  // v1.23 静息基线 = 这份状态的初始九情（人格常数，运行时**不跟着 emotions 变**）
  baselineEmotions: {
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
  // ⚠️ 必须**跟着改**：她的"平时"就是 love .4/joy .3，拿默认基线读会把人格基调读成"被激起"
  baselineEmotions: { ...INITIAL_EMOTION_STATE.emotions, love: 0.4, greed: 0.35, joy: 0.3 },
  intimacyToUser: 0.7,
  taiji: { ...INITIAL_TAIJI, valence: 0.5, expectation: 0.5 },
  evolution: { ...INITIAL_EVOLUTION, optimism: 70, empathy: 80 },
};

export const INITIAL_EMOTION_GENTLE: EmotionState = {
  ...INITIAL_EMOTION_STATE,
  emotions: { ...INITIAL_EMOTION_STATE.emotions, calm: 0.9, joy: 0.2, greed: 0.1 },
  baselineEmotions: { ...INITIAL_EMOTION_STATE.emotions, calm: 0.9, joy: 0.2, greed: 0.1 },
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
