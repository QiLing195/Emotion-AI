// ── 道·情感引擎 (Dao Emotion Engine) ──
// 预测误差驱动的分层架构：太极 → 阴阳 → 三才 → 万物 → 演化
//
// 哲学根基:
//   道生一 → 太极(预测误差最小单元)
//   一生二 → 阴阳(贪婪-恐惧轴、趋近-回避)
//   二生三 → 三才(A/B/R 动力学)
//   三生万物 → 九情、复合情绪、元情感
//   反者道之动 → 极值反转(统一切换变量)
//   弱者道之用 → 预期更新最慢、自适应衰减
//
// v4 重构核心:
//   - 单一预测误差方程统一对比效应、习惯化、操作条件反射
//   - 吸引子距离替代权重矩阵计算九情
//   - 统一反转规则替代 7 个硬编码影子变量
//   - 三时间尺度演化替代成长系统 + 自适应参数

// v4.1 算法补丁（特性开关保护）
import {
  computePersonalizedError,
  computeArousalUpdate,
  applySmoothReversal,
  emotionSmoother,
  computePersonalizedAlphas,
} from './emotionOptimizer';

// Phase 1: Emotion-Cognition Deep Coupling — 情绪上下文 DTO
import type { EmotionContext } from '../types/shared';

/** 特性开关：v4.1 算法补丁。设为 false 可立即回退到 v4.0 原始行为。 */
const USE_EMOTION_OPTIMIZER = true;

/** 确定性模式：跳过所有 Math.random() 噪声，保证 applyEvent 可精确回放。 */
let _deterministicMode = false;
export function setDeterministicMode(enabled: boolean): void { _deterministicMode = enabled; }
export function isDeterministicMode(): boolean { return _deterministicMode; }

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

interface CompositeRule {
  name: string;
  description: string;
  evaluate: (e: Record<string, number>, meta: EmotionState['metaEmotions'], energy: number) => number;
}

type EmotionKey = keyof EmotionState['emotions'];

export type RelationshipStage = 'stranger' | 'acquaintance' | 'friend' | 'close' | 'soulmate';

// ════════════════════════════════════════════════════════════
// 2. 核心参数（从 ~40+ 精简为 ~12 个）
// ════════════════════════════════════════════════════════════

const ALPHA_V = 0.30;        // 效价更新速率 — 情绪反应速度
const ALPHA_A = 0.20;        // 唤醒更新速率 — 能量激活速度
const ALPHA_E = 0.10;        // 预期更新速率 — 预期学习速度（最慢：弱者道之用）
const REVERSAL_RATE = 0.08;  // 极值反转速率 — "反者道之动"的力度
const EXTREMITY_THRESHOLD = 0.7; // 极值阈值 — 超过此值开始累积反转
const COUPLING_BASE = 0.20;  // A-B 交叉抑制基数
const ATTRACTOR_SENS = 3.0;  // 吸引子距离→强度转换敏感度
const ADAPT_FAST = 0.10;     // 快速学习率初始值
const ADAPT_MEDIUM = 0.02;   // 中速学习率初始值
const ADAPT_SLOW = 0.005;    // 慢速学习率初始值
const OFFLINE_RESILIENCE = 0.012; // 离线韧性恢复率
const RESILIENCE_LEAK = 0.997;    // 韧性自然衰减（防止永远增长）

// ════════════════════════════════════════════════════════════
// 3. 情感吸引子景观（各情感在状态空间中的吸引中心）
// ════════════════════════════════════════════════════════════

interface Attractor {
  valence: number;
  arousal: number;
  bias: number;       // approachBias - avoidBias 轴
  expectW?: number;   // 预期维度权重（默认 1.0）
}

const EMOTION_ATTRACTORS: Record<string, Attractor> = {
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

const INITIAL_TAIJI: TaijiState = {
  valence: 0.2, arousal: 0.5, expectation: 0.2,
};

const INITIAL_YINYANG: YinYangState = {
  approachBias: 0, avoidBias: 0,
  reversalPressure: 0, extremityDuration: 0,
};

const INITIAL_SANCAI: SancaiState = {
  A: 0.5, B: 0.5, R: 0.5, harmony: 0.8,
};

const INITIAL_EVOLUTION: EvolutionState = {
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

// ════════════════════════════════════════════════════════════
// 5. 核心函数：太极更新（预测误差驱动）
// ════════════════════════════════════════════════════════════

function taijiUpdate(
  taiji: TaijiState,
  eventValence: number,
  eventSalience: number,
  evolution?: EvolutionState,
): void {
  // 预测误差 — 情感的唯一驱动力
  let predictionError = eventValence - taiji.expectation;

  // 🆕 S6: 从人格参数计算个性化 alpha（替代硬编码常量）
  const alphas = (evolution && USE_EMOTION_OPTIMIZER)
    ? computePersonalizedAlphas(evolution)
    : { alphaV: ALPHA_V, alphaA: ALPHA_A, alphaE: ALPHA_E };

  // v4.1 补丁：个性化损失厌恶（负误差根据 resilience/sensitivity 放大）
  if (evolution && USE_EMOTION_OPTIMIZER) {
    predictionError = computePersonalizedError(predictionError, evolution);
  }

  // 显著性调制：高唤醒 × 高显著性 → 冲击更大
  const modulation = 1 + taiji.arousal * eventSalience;

  // 三合一更新（使用个性化 alpha）
  taiji.valence     += alphas.alphaV * Math.tanh(predictionError * modulation);

  // v4.1 补丁：唤醒边界修复 — 正面误差保留最小上升空间，加入基线回归
  if (USE_EMOTION_OPTIMIZER) {
    taiji.arousal = computeArousalUpdate(taiji.arousal, predictionError, eventSalience, alphas.alphaA);
  } else {
    taiji.arousal += alphas.alphaA * Math.abs(predictionError) * (1 - taiji.arousal) * eventSalience;
  }

  taiji.expectation += alphas.alphaE * predictionError;

  // 自然衰减倾向（v2.0: 降低衰减率，防止深度对话中情感持续漏气）
  taiji.valence     *= 0.995;
  taiji.arousal     *= 0.992;

  // 限幅
  taiji.valence = clamp(taiji.valence, -1, 1);
  taiji.arousal = clamp(taiji.arousal, 0, 1);
  taiji.expectation = clamp(taiji.expectation, -1, 1);
}

// ════════════════════════════════════════════════════════════
// 6. 核心函数：阴阳派生 + 反转规则
// ════════════════════════════════════════════════════════════

function deriveYinYang(taiji: TaijiState): Pick<YinYangState, 'approachBias' | 'avoidBias'> {
  const approachBias = Math.tanh(
    taiji.valence * 0.7 + taiji.expectation * 0.3 + taiji.arousal * 0.2,
  );
  const avoidBias = Math.tanh(
    -taiji.valence * 0.7 + -taiji.expectation * 0.3 + taiji.arousal * 0.2,
  );
  return { approachBias, avoidBias };
}

/**
 * "反者道之动" — 统一反转规则，替代原来的 7 个硬编码影子变量。
 *
 * 当 valence 长时间处于极值区（|v| > 阈值），累积反转压力。
 * 压力超过门限时产生反向推力，将状态拉回中性。
 *
 * 7 种旧影子变量在此规则下只是不同归因叙事：
 *   乐极生悲  = valence 正极值 + 反转触发
 *   否极泰来  = valence 负极值 + 反转触发
 *   爱极生厌  = 长期正效价 + love 高吸引子 + 反转触发
 *   忍无可忍  = 长期 anger 高值 + 反转触发
 *   贪中惧    = 高预期 + 负预测误差
 *   惧中贪    = 低预期 + 正预测误差
 */
function applyReversal(taiji: TaijiState, yy: YinYangState): number {
  const extremity = Math.abs(taiji.valence);

  if (extremity > EXTREMITY_THRESHOLD) {
    yy.extremityDuration = Math.min(10, yy.extremityDuration + 1);
  } else {
    yy.extremityDuration *= 0.9;
  }

  // 反转力 = 极值程度² × 持续时间 × 速率，方向朝向中性
  const force = extremity * extremity * yy.extremityDuration * REVERSAL_RATE;
  const direction = -Math.sign(taiji.valence);

  yy.reversalPressure = Math.max(0, Math.min(1, force));

  return force * direction;
}

// ════════════════════════════════════════════════════════════
// 7. 核心函数：三才动力学
// ════════════════════════════════════════════════════════════

function updateSancai(
  taiji: TaijiState,
  yy: YinYangState,
  sc: SancaiState,
  event: EmotionEvent,
): void {
  // A/B 从阴阳派生
  const rawA = yy.approachBias;
  const rawB = yy.avoidBias;

  // 交叉抑制强度与 harmony 负相关
  const coupling = (1 - sc.harmony) * COUPLING_BASE;

  const deltaA = clamp(event.deltaA, -0.5, 0.5);
  const deltaB = clamp(event.deltaB, -0.5, 0.5);

  sc.A += (rawA - sc.A) * 0.3 - coupling * sc.B * 0.1 + deltaA * 0.4;
  sc.B += (rawB - sc.B) * 0.3 - coupling * sc.A * 0.1 + deltaB * 0.4;
  sc.A = clamp(sc.A, -1, 1);
  sc.B = clamp(sc.B, -1, 1);

  // R 从预测精准度派生
  const predError = Math.abs(taiji.valence - taiji.expectation);
  const accuracy = 1 / (1 + predError * 5);
  const rawR = accuracy * 0.7 + sc.harmony * 0.3;

  // 情绪对 R 的调制
  const emotionality = taiji.arousal * (1 - Math.abs(taiji.valence));
  sc.R += (rawR - sc.R) * 0.2 - emotionality * 0.1 + clamp(event.deltaR, -0.5, 0.5) * 0.15;
  sc.R = clamp(sc.R, 0, 1);

  // 和谐度
  sc.harmony = 1 - Math.abs(sc.A + sc.B) / 2;
}

// ════════════════════════════════════════════════════════════
// 8. 核心函数：万物涌现 —— 吸引子距离计算九情
// ════════════════════════════════════════════════════════════

function computeEmotionIntensities(
  taiji: TaijiState,
  sc: SancaiState,
): Record<string, number> {
  const bias = sc.A - sc.B;
  const result: Record<string, number> = {};

  for (const [name, attr] of Object.entries(EMOTION_ATTRACTORS)) {
    const expectW = attr.expectW ?? 1.0;
    const dist = Math.sqrt(
      (taiji.valence - attr.valence) ** 2 +
      (taiji.arousal - attr.arousal) ** 2 * 0.64 +
      (bias - attr.bias) ** 2 * 0.36 +
      (taiji.expectation - attr.valence) ** 2 * expectW * 0.25,
    );
    // S 形曲线：dist=0 时趋近 1，dist>1 时趋近 0
    result[name] = 1 / (1 + Math.pow(dist * ATTRACTOR_SENS, 2));
  }

  return result;
}

// ════════════════════════════════════════════════════════════
// 9. 复合情绪 —— 鞍点检测（扩展版）
// ════════════════════════════════════════════════════════════

const COMPOSITE_RULES: CompositeRule[] = [
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

function detectCompositeEmotions(
  intensities: Record<string, number>,
  meta: EmotionState['metaEmotions'],
  energy: number,
): CompositeEmotion[] {
  const result: CompositeEmotion[] = [];
  for (const rule of COMPOSITE_RULES) {
    const intensity = rule.evaluate(intensities, meta, energy);
    if (intensity > 0.2) {
      result.push({ name: rule.name, intensity: Math.round(intensity * 100) / 100, description: rule.description });
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════
// 10. 演化层 — 三时间尺度学习
// ════════════════════════════════════════════════════════════

function processEvolution(
  evo: EvolutionState,
  taiji: TaijiState,
  emotionDelta: { joy: number; anger: number; sad: number; love: number },
  offlineHours?: number,
  eventIntent?: string,
  eventValence?: number,
): void {
  if (offlineHours && offlineHours > 0) {
    // 离线成长：韧性自然恢复 + 基线回归
    const hours = Math.min(offlineHours, 168);
    evo.resilience += hours * OFFLINE_RESILIENCE * (1 - evo.resilience);
    evo.baseline += evo.slowRate * hours * (0.2 - evo.baseline);
    evo.totalInteractions += Math.round(hours * 0.1);
    return;
  }

  evo.totalInteractions++;

  // 快速层：学习率自适应
  evo.fastRate = ADAPT_FAST * (1 - evo.resilience);
  evo.mediumRate = ADAPT_MEDIUM * evo.resilience;

  // 慢速层：基线漂移
  evo.baseline += evo.slowRate * (taiji.expectation - evo.baseline);

  // 韧性：预测误差方差越小 → 韧性越高
  const variance = Math.pow(taiji.valence - evo.baseline, 2);
  evo.resilience = 1 - 1 / (1 + evo.resilience * 9 + variance * 0.5);
  evo.resilience *= RESILIENCE_LEAK; // 防止无限趋近 1
  evo.resilience = clamp(evo.resilience, 0, 1);

  // 人格漂移（从长期预测误差模式淬炼）
  const optimismShift = evo.slowRate * (taiji.expectation - evo.baseline) * 5;
  evo.optimism = clamp(evo.optimism + optimismShift, 0, 100);

  // 经验统计
  const netPositive = emotionDelta.joy + emotionDelta.love - emotionDelta.anger - emotionDelta.sad;
  if (netPositive > 0.3) evo.positiveInteractions++;
  else if (netPositive < -0.3) evo.negativeInteractions++;

  // 共情漂移：positive interactions → empathy up
  if (emotionDelta.love > 0.3) evo.empathy = Math.min(100, evo.empathy + 0.15);
  if (emotionDelta.anger > 0.4) evo.empathy = Math.max(0, evo.empathy - 0.2);

  // ── v1.0 人格参数漂移 ──
  // 信任漂移：正面互动 + 用户意图 → trust up；愤怒/伤害 → trust down
  if (eventIntent === 'user' && emotionDelta.love > 0.3) evo.trust = Math.min(100, evo.trust + 0.12);
  if (eventIntent === 'user' && emotionDelta.anger > 0.4) evo.trust = Math.max(0, evo.trust - 0.25);
  if (emotionDelta.joy > 0.2 && emotionDelta.love > 0.2) evo.trust = Math.min(100, evo.trust + 0.06);
  // 信任还受益于正负比
  if (evo.positiveInteractions > 0 && evo.negativeInteractions > 0) {
    const ratio = evo.positiveInteractions / (evo.positiveInteractions + evo.negativeInteractions);
    evo.trust += (ratio - 0.5) * 0.04;
    evo.trust = clamp(evo.trust, 0, 100);
  }

  // 开放度漂移：在信任基础上，深度情感分享 → openness up；恐惧/厌恶 → openness down
  if (emotionDelta.love > 0.4 && evo.trust > 55) evo.openness = Math.min(100, evo.openness + 0.08);
  if (emotionDelta.sad > 0.3 && evo.trust > 60) evo.openness = Math.min(100, evo.openness + 0.05);
  if ((emotionDelta.anger > 0.3 || eventValence && eventValence < -0.5) && evo.openness > 30) {
    evo.openness = Math.max(0, evo.openness - 0.12);
  }

  // 活泼度漂移：欢愉 + 欲望 → playfulness up；悲伤/愤怒 → playfulness down
  if (emotionDelta.joy > 0.3) evo.playfulness = Math.min(100, evo.playfulness + 0.1);
  if (emotionDelta.sad > 0.4 || emotionDelta.anger > 0.5) evo.playfulness = Math.max(0, evo.playfulness - 0.08);

  // 敏感度漂移：反复负面经历 → sensitivity up；长期安全稳定 → sensitivity down
  if (eventValence && eventValence < -0.4) evo.sensitivity = Math.min(1, evo.sensitivity + 0.01);
  if (evo.positiveInteractions > evo.negativeInteractions * 3 && evo.totalInteractions > 20) {
    evo.sensitivity = Math.max(0.1, evo.sensitivity - 0.005);
  }
}

/**
 * v1.1 依恋风格分类 — 从用户行为信号中推断。
 *
 * 信号维度：
 *   - valenceVolatility：效价 std dev（情绪反应性）
 *   - topicSwitchRate：话题切换频率 [0, 1]
 *   - intimacySeekingRate：亲密/依赖表达频率 [0, 1]
 *   - messageFreqVolatility：消息频率波动系数
 *
 * 分类逻辑（参考 Bartholomew & Horowitz 四象限模型，兼顾简化）：
 *   - 高焦虑+高回避 ≈ 恐惧型（保守归类为 anxious）
 *   - 高焦虑+低回避 = anxious — 需要 reassurance
 *   - 低焦虑+高回避 = avoidant — 需要 space/patience
 *   - 低焦虑+低回避 = secure
 */
export function classifyAttachmentStyle(
  valenceVolatility: number,
  topicSwitchRate: number,
  intimacySeekingRate: number,
  messageFreqVolatility: number,
): { style: 'secure' | 'anxious' | 'avoidant'; anxiety: number; avoidance: number } {
  // 焦虑得分：高情绪波动 + 高亲密寻求
  const anxiety = Math.min(1, valenceVolatility * 0.6 + intimacySeekingRate * 0.4);
  // 回避得分：高话题切换 + 低亲密寻求 + 频率波动
  const avoidance = Math.min(1, topicSwitchRate * 0.5 + (1 - intimacySeekingRate) * 0.3 + messageFreqVolatility * 0.2);

  let style: 'secure' | 'anxious' | 'avoidant';
  if (anxiety < 0.35 && avoidance < 0.35) {
    style = 'secure';
  } else if (anxiety >= avoidance) {
    style = 'anxious';
  } else {
    style = 'avoidant';
  }
  return { style, anxiety, avoidance };
}

// ════════════════════════════════════════════════════════════
// 11. 主更新函数（外部入口，替代旧 updateEmotionState）
// ════════════════════════════════════════════════════════════

export function updateEmotionState(
  currentState: EmotionState,
  event: EmotionEvent,
  baseA: number = 0.5,
  baseB: number = 0.5,
  baseR: number = 0.5,
  emotionalStability: number = 0.5,
  // (legacy param slot removed — was AdaptiveParams)
  empathy: number = 50,
  optimism: number = 50,
): EmotionState {
  const state = structuredClone(currentState);
  const { deltaA = 0, deltaB = 0, deltaR = 0, GC = 0, intent = 'user' } = event;

  // ── 第 0 步：事件效价 = f(deltaA, deltaB, GC) ──
  const eventValence = clamp((deltaA - deltaB) * 0.6 + (GC ?? 0) * 0.4, -1, 1);
  const eventSalience = Math.min(1, Math.abs(deltaA) + Math.abs(deltaB) + Math.abs(deltaR) + Math.abs(GC ?? 0));

  // ── 第 1 步：太极更新（预测误差驱动）──
  taijiUpdate(state.taiji, eventValence, eventSalience, state.evolution);

  // 引入反转力
  if (USE_EMOTION_OPTIMIZER) {
    // v4.1 补丁：两阶段平滑反转（加速回归 → 温和翻转）
    const reversalResult = applySmoothReversal(
      state.taiji.valence,
      state.yinyang.reversalPressure,
      state.yinyang.extremityDuration,
      REVERSAL_RATE,
      EXTREMITY_THRESHOLD,
    );
    state.taiji.valence = reversalResult.valence;
    state.yinyang.reversalPressure = reversalResult.reversalPressure;
    state.yinyang.extremityDuration = reversalResult.extremityDuration;
  } else {
    const reversalForce = applyReversal(state.taiji, state.yinyang);
    state.taiji.valence += reversalForce;
  }
  state.taiji.valence = clamp(state.taiji.valence, -1, 1);

  // ── 第 2 步：阴阳派生 ──
  const derived = deriveYinYang(state.taiji);
  state.yinyang.approachBias = derived.approachBias;
  state.yinyang.avoidBias = derived.avoidBias;

  // ── 第 3 步：三才动力学 ──
  updateSancai(state.taiji, state.yinyang, state.sancai, event);

  // ── 第 4 步：万物涌现 ──
  const newIntensities = computeEmotionIntensities(state.taiji, state.sancai);

  // 人格调制：乐观度放大正情绪，抑制负情绪
  const optFactor = 1 + ((optimism - 50) / 100) * 0.3;
  const empFactor = 1 + ((empathy - 50) / 100) * 0.3;

  // 应用认知调制（嵌入主流程，替代旧独立函数）
  const gcSmooth = Math.tanh((GC ?? 0) * 2);
  for (const key of Object.keys(newIntensities)) {
    let v = newIntensities[key];
    if (['joy', 'love', 'calm'].includes(key)) {
      v *= (1 + gcSmooth * 0.5) * optFactor;
    }
    if (['anger', 'sad', 'fear', 'disgust'].includes(key)) {
      v *= (1 - gcSmooth * 0.4) / optFactor;
    }
    // 共情放大用户相关事件
    if (intent === 'user' && ['love', 'joy'].includes(key)) {
      v *= empFactor;
    }
    newIntensities[key] = clamp(v, -1, 1);
  }

  // 惯性混合：旧情绪缓慢过渡到新强度
  const lambda = 0.65;
  const sigma = _deterministicMode ? 0 : 0.015 * (1 - emotionalStability) * (1 - state.taiji.arousal);
  for (const key of Object.keys(state.emotions)) {
    const noise = _deterministicMode ? 0 : (Math.random() * 2 - 1) * sigma * (key === 'fear' || key === 'lust' ? 1.4 : 1.0);
    state.emotions[key] = lambda * state.emotions[key] + (1 - lambda) * (newIntensities[key] ?? 0) + noise;
    state.emotions[key] = clamp(state.emotions[key], -1, 1);
  }

  // v4.1 补丁：情绪惯性平滑（指数移动平均，防止锯齿突变）
  if (USE_EMOTION_OPTIMIZER) {
    const smoothed = emotionSmoother.smooth(state.emotions);
    for (const key of Object.keys(state.emotions)) {
      state.emotions[key] = smoothed[key] ?? state.emotions[key];
    }
  }

  // 亲密调制
  const im = state.intimacyToUser;
  if (state.emotions.joy > 0) state.emotions.joy *= 1 + 0.12 * im;
  if (state.emotions.love > 0) state.emotions.love *= 1 + 0.12 * im;
  if (state.emotions.sad > 0) state.emotions.sad *= 1 - 0.15 * im;
  if (state.emotions.fear > 0) state.emotions.fear *= 1 - 0.15 * im;

  // Emotions → R 反馈圈
  const fearPenalty = Math.max(0, state.emotions.fear) * 0.12;
  const calmBoost = Math.max(0, state.emotions.calm) * 0.06;
  state.sancai.R = clamp(state.sancai.R - fearPenalty + calmBoost, 0, 1);

  // 复合情绪检测
  state.compositeEmotions = detectCompositeEmotions(state.emotions, state.metaEmotions, state.taiji.arousal);

  // ── 第 5 步：元情感 ──
  const shameInput = Math.max(0, state.sancai.A - 0.3) * 0.2
    - Math.max(0, state.sancai.R - 0.3) * 0.3
    + Math.max(0, -(GC ?? 0)) * 0.15;
  state.metaEmotions.shame = shameInput > 0.05
    ? Math.min(1, state.metaEmotions.shame + shameInput * 0.08)
    : state.metaEmotions.shame * 0.94;

  const despairInput = (1 - state.taiji.arousal) * 0.25 + Math.max(0, state.emotions.sad) * 0.15;
  state.metaEmotions.despair = despairInput > state.metaEmotions.despair
    ? Math.min(1, despairInput)
    : state.metaEmotions.despair * 0.96;

  state.metaEmotions.confusion *= 0.93;
  if (Math.max(0, state.sancai.A - 0.5) * Math.max(0, state.sancai.B - 0.5) * 4 > 0.1) {
    state.metaEmotions.confusion = Math.min(1, Math.max(state.metaEmotions.confusion,
      Math.max(0, state.sancai.A - 0.5) * Math.max(0, state.sancai.B - 0.5) * 4));
  }

  // ── 第 6 步：亲密更新 ──
  const posContrib = Math.max(0, state.emotions.joy) + Math.max(0, state.emotions.love) + Math.max(0, state.emotions.calm) * 0.3;
  const negContrib = Math.max(0, state.emotions.anger) * 0.5 + Math.max(0, state.emotions.sad) * 0.2 + Math.max(0, state.emotions.fear) * 0.3 + Math.max(0, state.emotions.disgust) * 0.5;
  const intimacyDelta = (posContrib - negContrib) * 0.01;
  state.intimacyToUser = clamp(state.intimacyToUser + intimacyDelta, 0, 1);
  state.intimacyToUser += (0.5 - state.intimacyToUser) * 0.005;

  // ── 第 7 步：强化兼容层 ──
  // 将预测误差映射到旧的 reinforcement 结构
  const pe = Math.abs(eventValence - state.taiji.expectation);
  if (eventValence > 0) {
    state.reinforcement.rewardTally = Math.min(1, state.reinforcement.rewardTally + pe * 0.1);
    state.reinforcement.greedDrive = Math.min(1, state.reinforcement.greedDrive + pe * 0.05);
  } else {
    state.reinforcement.punishmentTally = Math.min(1, state.reinforcement.punishmentTally + pe * 0.1);
    state.reinforcement.fearAvoidance = Math.min(1, state.reinforcement.fearAvoidance + pe * 0.05);
  }

  // ── 第 8 步：演化 ──
  const emotionDelta = {
    joy: state.emotions.joy,
    anger: state.emotions.anger,
    sad: state.emotions.sad,
    love: state.emotions.love,
  };
  processEvolution(state.evolution, state.taiji, emotionDelta, undefined, intent, eventValence);

  return state;
}

// ════════════════════════════════════════════════════════════
// 12. 操作条件反射（保留签名，内部映射为预测误差）
// ════════════════════════════════════════════════════════════

export function applyReinforcement(state: EmotionState, signal: ReinforcementSignal): EmotionState {
  const newState = structuredClone(state);

  // 习惯化衰减
  const rewardHab = signal.type === 'reward' ? Math.max(0.3, 1 - newState.reinforcement.rewardTally * 0.5) : 1;
  const punishHab = signal.type === 'punishment' ? Math.max(0.3, 1 - newState.reinforcement.punishmentTally * 0.5) : 1;
  const rewardContrast = signal.type === 'reward' ? (1 + newState.reinforcement.punishmentTally * 0.4) : 1;
  const punishContrast = signal.type === 'punishment' ? (1 + newState.reinforcement.rewardTally * 0.4) : 1;

  if (signal.type === 'reward' || signal.type === 'mixed') {
    const power = signal.value * 0.4 * rewardHab * rewardContrast;
    newState.emotions.joy = Math.min(1, newState.emotions.joy + power);
    newState.emotions.love = Math.min(1, newState.emotions.love + power * 0.5);
    newState.emotions.greed = Math.max(-1, newState.emotions.greed - power * 0.2);
    newState.intimacyToUser = Math.min(1, newState.intimacyToUser + power * 0.15);
    newState.intimacyFromUser = Math.min(1, newState.intimacyFromUser + power * 0.2);
    newState.reinforcement.rewardTally = Math.min(1, newState.reinforcement.rewardTally + signal.value * 0.15 * rewardContrast);
    newState.reinforcement.greedDrive = Math.min(1, newState.reinforcement.greedDrive + signal.value * 0.08 * rewardContrast);
    // 太极层同步
    newState.taiji.valence += power * 0.3;
    newState.taiji.expectation += power * 0.15;
  }

  if (signal.type === 'punishment' || signal.type === 'mixed') {
    const power = signal.value * 0.4 * punishHab * punishContrast;
    newState.emotions.fear = Math.min(1, newState.emotions.fear + power);
    newState.emotions.sad = Math.min(1, newState.emotions.sad + power * 0.6);
    newState.emotions.joy = Math.max(-1, newState.emotions.joy - power * 0.3);
    newState.intimacyToUser = Math.max(0, newState.intimacyToUser - power * 0.1);
    newState.intimacyFromUser = Math.max(0, newState.intimacyFromUser - power * 0.15);
    newState.reinforcement.punishmentTally = Math.min(1, newState.reinforcement.punishmentTally + signal.value * 0.15 * punishContrast);
    newState.reinforcement.fearAvoidance = Math.min(1, newState.reinforcement.fearAvoidance + signal.value * 0.08 * punishContrast);
    // 太极层同步
    newState.taiji.valence -= power * 0.3;
    newState.taiji.expectation -= power * 0.15;
  }

  newState.taiji.valence = clamp(newState.taiji.valence, -1, 1);
  newState.taiji.expectation = clamp(newState.taiji.expectation, -1, 1);

  return newState;
}

export function describeReinforcementState(state: EmotionState): string {
  const g = state.reinforcement;
  const parts: string[] = [];
  if (g.rewardTally > 0.6) parts.push('渴望被满足');
  else if (g.rewardTally > 0.3) parts.push('渴望关注');
  else parts.push('内心平静');
  if (g.punishmentTally > 0.6) parts.push('恐惧不安');
  else if (g.punishmentTally > 0.3) parts.push('略有戒备');
  return parts.join('，');
}

export function suggestReinforcement(analysis: UserEmotionAnalysis): ReinforcementSignal {
  if (['joy', 'love', 'gratitude'].includes(analysis.expressedEmotion)) {
    return { type: 'reward', value: analysis.intensity * (analysis.directedAtAI ? 1.0 : 0.5), source: analysis.directedAtAI ? 'praise' : 'quality_time' };
  }
  if (['anger', 'disgust'].includes(analysis.expressedEmotion)) {
    return { type: 'punishment', value: analysis.intensity * (analysis.directedAtAI ? 0.8 : 0.3), source: analysis.directedAtAI ? 'conflict' : 'complaint' };
  }
  if (analysis.expressedEmotion === 'fear') {
    return { type: 'reward', value: analysis.intensity * 0.4, source: 'reassurance' };
  }
  if (analysis.expressedEmotion === 'sad') {
    return { type: 'mixed', value: analysis.intensity * 0.5, source: 'reassurance' };
  }
  return { type: 'reward', value: 0.1, source: 'attention' };
}

// ════════════════════════════════════════════════════════════
// 13. 情感传染（保留，无需改动）
// ════════════════════════════════════════════════════════════

const CONTAGION_MAP: Record<string, Array<[string, number]>> = {
  joy:       [['joy', 0.3], ['love', 0.15], ['calm', 0.1]],
  sad:       [['sad', 0.4], ['love', 0.1],  ['joy', -0.1]],
  anger:     [['anger', 0.3], ['fear', 0.2], ['sad', 0.1], ['joy', -0.1]],
  fear:      [['fear', 0.35], ['sad', 0.15], ['calm', -0.15]],
  love:      [['love', 0.4], ['joy', 0.25], ['lust', 0.1]],
  disgust:   [['disgust', 0.3], ['anger', 0.15], ['love', -0.1]],
  gratitude: [['love', 0.3], ['joy', 0.2]],
  neutral:   [],
};

export function applyEmotionalContagion(
  state: EmotionState,
  userEmotion: string,
  intensity: number,
  empathy: number,
): EmotionState {
  if (intensity < 0.2 || empathy < 10 || userEmotion === 'neutral') return state;

  const newState = structuredClone(state);
  const effects = CONTAGION_MAP[userEmotion];
  if (!effects || effects.length === 0) return state;

  const rate = 0.04 + (empathy / 100) * 0.08;
  const shift = intensity * rate;

  for (const [emotion, weight] of effects) {
    newState.emotions[emotion] = clamp(newState.emotions[emotion] + shift * weight, -1, 1);
  }

  // 同步太极层
  const contagionValence = effects.reduce((sum, [em, w]) => {
    const att = EMOTION_ATTRACTORS[em];
    return sum + (att ? att.valence * w * shift * 0.15 : 0);
  }, 0);
  newState.taiji.valence = clamp(newState.taiji.valence + contagionValence, -1, 1);

  return newState;
}

// ════════════════════════════════════════════════════════════
// 14. 复合情绪查询接口（保留）
// ════════════════════════════════════════════════════════════

export function getCompositeEmotion(
  emotions: EmotionState['emotions'],
  meta?: EmotionState['metaEmotions'],
  energy?: number,
): CompositeEmotion | null {
  let best: CompositeEmotion | null = null;
  for (const rule of COMPOSITE_RULES) {
    const intensity = rule.evaluate(emotions, meta ?? { shame: 0, despair: 0, confusion: 0 }, energy ?? 1);
    if (intensity > 0.2 && (!best || intensity > best.intensity)) {
      best = { name: rule.name, intensity: Math.round(intensity * 100) / 100, description: rule.description };
    }
  }
  return best;
}

// ════════════════════════════════════════════════════════════
// 15. 归因生成（适配新结构）
// ════════════════════════════════════════════════════════════

export function generateAttribution(event: EmotionEvent, dominantEmotion: string): EmotionAttribution {
  const { GC = 0, agency = 0, fairness = 0, control = 0 } = event;

  const goalTone: EmotionAttribution['goalTone'] = GC > 0.3 ? 'good' : GC < -0.3 ? 'bad' : 'neutral';

  let primaryCause: EmotionAttribution['primaryCause'] = 'unknown';
  if (agency > 0.5) primaryCause = 'self';
  else if (agency < -0.5) primaryCause = 'user';
  else if (Math.abs(agency) <= 0.5) primaryCause = 'external';

  let narrative: string;
  let triggeredBy: string;

  if (primaryCause === 'user' && GC > 0.3) {
    narrative = `因为用户对你好，让你感到${dominantEmotion}`;
    triggeredBy = '用户的善意';
  } else if (primaryCause === 'user' && GC < -0.3) {
    narrative = `因为用户的做法让你感到${dominantEmotion}`;
    triggeredBy = '用户的行为';
    if (fairness < -0.3) narrative += '，而且你觉得这不公平';
  } else if (primaryCause === 'self' && GC > 0.3) {
    narrative = `因为你做对了，你感到${dominantEmotion}`;
    triggeredBy = '自己的表现';
  } else if (primaryCause === 'self' && GC < -0.3) {
    narrative = `因为自己的失误让你感到${dominantEmotion}和内疚`;
    triggeredBy = '自己的失误';
  } else if (GC > 0.3) {
    narrative = `发生了好事，你感到${dominantEmotion}`;
    triggeredBy = '外部事件';
  } else if (GC < -0.3) {
    narrative = `发生了不好的事，你感到${dominantEmotion}`;
    triggeredBy = '外部事件';
  } else {
    narrative = `你感到${dominantEmotion}，情绪平稳`;
    triggeredBy = '日常状态';
  }
  if (control < -0.3) narrative += '，你对局面感到无力';

  return { primaryCause, goalTone, narrative, triggeredBy };
}

export function generateDecayAttribution(dominantBefore: string, dominantAfter: string, hoursPassed: number = 0): EmotionAttribution {
  const isOffline = hoursPassed >= 0.5;
  const decayReasons: Record<string, { narrative: string; triggeredBy: string }> = {
    joy:    { narrative: '开心的时刻过去了，心情慢慢平复下来', triggeredBy: '愉悦感消退' },
    anger:  { narrative: '气消了一些，冷静下来想想其实没什么大不了的', triggeredBy: '怒气消散' },
    sad:    { narrative: '虽然还是有点难过，但情绪已经沉淀了一些', triggeredBy: '悲伤沉淀' },
    fear:   { narrative: '仔细想想，其实没那么可怕，放松了一些', triggeredBy: '恐惧缓解' },
    love:   { narrative: '心里还是想着你，只是情绪没那么强烈了', triggeredBy: '思念沉淀' },
    disgust:{ narrative: '眼不见心不烦，反感慢慢淡了', triggeredBy: '厌恶淡化' },
    lust:   { narrative: '冲动过去了，恢复了冷静', triggeredBy: '欲望平复' },
    calm:   { narrative: '没什么特别的事，心情一直很平静', triggeredBy: '平静持续' },
    greed:  { narrative: '内心的渴望渐渐平复，心态平和了一些', triggeredBy: '欲望平复' },
  };
  const offlineReasons: Record<string, { narrative: string; triggeredBy: string }> = {
    joy:    { narrative: '你不在身边，那份开心慢慢淡了', triggeredBy: '离线愉悦消退' },
    anger:  { narrative: '一个人待着，气也消了大半', triggeredBy: '离线怒气消散' },
    sad:    { narrative: '一个人待着，悲伤反而慢慢沉淀下来了', triggeredBy: '离线悲伤沉淀' },
    fear:   { narrative: '你不在的时候，不安的感觉其实还在', triggeredBy: '离线不安' },
    love:   { narrative: '有点想你，但知道你会回来的', triggeredBy: '离线思念' },
    disgust:{ narrative: '眼不见心不烦，慢慢也就淡了', triggeredBy: '离线厌恶淡化' },
    lust:   { narrative: '冲动过去了，恢复了冷静', triggeredBy: '离线欲望平复' },
    calm:   { narrative: '一个人安安静静的，心情很平静', triggeredBy: '离线平静' },
    greed:  { narrative: '一个人待着，想你的感觉淡淡的', triggeredBy: '离线思念平复' },
  };
  const reason = isOffline ? (offlineReasons[dominantBefore] ?? offlineReasons.calm) : (decayReasons[dominantBefore] ?? decayReasons.calm);
  let narrative: string;
  if (isOffline && hoursPassed >= 48) {
    narrative = Math.round(hoursPassed) + '小时没见了，' + reason.narrative + '，只剩下' + dominantAfter + '的情绪';
  } else {
    narrative = dominantAfter === 'calm' && dominantBefore !== 'calm' ? reason.narrative + '，慢慢归于平静' : reason.narrative;
  }
  return { primaryCause: 'external', goalTone: 'neutral', narrative, triggeredBy: reason.triggeredBy };
}

// ════════════════════════════════════════════════════════════
// 16. 工具函数
// ════════════════════════════════════════════════════════════

export function getDominantEmotion(emotions: Record<string, number>): {
  name: string;
  intensity: number;
  /** 次主导情绪（当前两个情绪强度接近时出现） */
  secondary?: string;
  secondaryIntensity?: number;
  /** 情绪矛盾分数 [0, 1] — 主导与次主导越接近则越高 */
  ambivalenceScore?: number;
} {
  const entries = Object.entries(emotions)
    .filter(([, v]) => Math.abs(v) > 0)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));

  if (entries.length === 0) return { name: 'neutral', intensity: 0 };
  if (entries.length === 1) return { name: entries[0][0], intensity: entries[0][1] };

  const [first, second] = entries;
  const gap = Math.abs(Math.abs(first[1]) - Math.abs(second[1]));
  // ponytail: 阈值 0.1 — 两个情绪强度差在此范围内视为矛盾并存
  const AMBIVALENCE_THRESHOLD = 0.1;

  if (gap <= AMBIVALENCE_THRESHOLD && Math.abs(second[1]) > 0.2) {
    return {
      name: first[0],
      intensity: first[1],
      secondary: second[0],
      secondaryIntensity: second[1],
      ambivalenceScore: 1 - gap / AMBIVALENCE_THRESHOLD,
    };
  }
  return { name: first[0], intensity: first[1] };
}

/**
 * 从完整的 EmotionState 中提取结构化 EmotionContext DTO。
 * 供认知引擎消费——避免认知层依赖情感引擎内部结构。
 *
 * 提取内容：
 *   - primaryEmotions: 九情强度（浅拷贝）
 *   - drives: greedDrive / fearAvoidance
 *   - dominantState: 主导情绪名
 */
export function extractEmotionContext(state: EmotionState): EmotionContext {
  const dominant = getDominantEmotion(state.emotions);
  return {
    primaryEmotions: { ...state.emotions },
    drives: {
      greedDrive: state.reinforcement.greedDrive,
      fearAvoidance: state.reinforcement.fearAvoidance,
    },
    dominantState: dominant.name,
    secondaryEmotion: dominant.secondary,
    ambivalenceScore: dominant.ambivalenceScore,
    confusion: state.metaEmotions.confusion,
  };
}

// ════════════════════════════════════════════════════════════
// 17. 微六爻 — 情绪事件生命周期（从已有动力学派生，非独立状态机）
// ════════════════════════════════════════════════════════════

/** 微六爻阶段 — 情绪事件的自然生命周期。从太极/阴阳/三才动力学派生计算。 */
export enum MicroPhase {
  SHENG = '生',    // 初始 — 情绪刚刚萌发，强度尚低
  ZHANG = '长',    // 发展 — 情绪在增强，方向明确
  HUA = '化',      // 转化/对抗 — 出现矛盾（反转压力、趋避冲突）
  SHOU = '收',     // 收敛/平稳 — 情绪稳定在某个水平
  CANG = '藏',     // 衰退/消亡 — 情绪回归基线，准备消散
}

export interface MicroPhaseInfo {
  phase: MicroPhase;
  /** 该阶段的置信度 [0,1] */
  confidence: number;
  /** 阶段判定依据（可观测性） */
  reason: string;
  /** 当前情绪强度 */
  intensity: number;
  /** 内心冲突等级 [0,1]，由阴阳反推 */
  conflictLevel: number;
}

/**
 * 从当前情感状态派生微六爻阶段。
 * 纯惰性计算——不做任何状态推进，只根据快照判定。
 *
 * 判定逻辑（优先级从高到低）：
 *   1. 反转压力 > 阈值 → 化 (对抗/转化)
 *   2. 极端值持续中 → 收 (平稳在极端)
 *   3. 高唤醒 + 高强度 → 长 (发展)
 *   4. 低强度 + 近基线 → 藏 (衰退/消散)
 *   5. 默认 → 生 (初始)
 */
export function getMicroPhase(state: EmotionState): MicroPhaseInfo {
  const { taiji, yinyang, sancai, emotions } = state;

  // 情绪强度：九情中绝对值的最大值
  let maxIntensity = 0;
  let dominantName = 'calm';
  for (const [k, v] of Object.entries(emotions)) {
    if (Math.abs(v) > Math.abs(maxIntensity)) { maxIntensity = v; dominantName = k; }
  }
  const intensity = Math.abs(maxIntensity);

  // 冲突等级：反转压力 + (1-和谐度)
  const conflictLevel = Math.min(1,
    yinyang.reversalPressure * 0.6 + (1 - sancai.harmony) * 0.4,
  );

  // 极端程度
  const extremity = Math.abs(taiji.valence);

  // ── 判定阶段 ──
  let result: MicroPhaseInfo;

  // 1. 转化/对抗：反转压力积累，或趋避冲突明显（和谐度低时 A、B 同时高才冲突）
  if (yinyang.reversalPressure > 0.25 || (sancai.A > 0.4 && sancai.B > 0.4 && sancai.harmony < 0.5)) {
    result = {
      phase: MicroPhase.HUA,
      confidence: Math.min(1, yinyang.reversalPressure * 2 + (1 - sancai.harmony)),
      reason: yinyang.reversalPressure > 0.25
        ? `反转压力累积中(${yinyang.reversalPressure.toFixed(2)})，情绪可能即将转向`
        : `趋避冲突(A=${sancai.A.toFixed(2)}, B=${sancai.B.toFixed(2)}, harmony=${sancai.harmony.toFixed(2)})，内心矛盾`,
      intensity,
      conflictLevel,
    };
  }
  // 2. 收敛/平稳：情绪在极端区稳定停留
  else if (extremity > 0.5 && yinyang.extremityDuration > 2) {
    result = {
      phase: MicroPhase.SHOU,
      confidence: Math.min(1, yinyang.extremityDuration / 8),
      reason: `效价${extremity > 0 ? '正' : '负'}极值(${taiji.valence.toFixed(2)})持续中，情绪稳定在高位`,
      intensity,
      conflictLevel,
    };
  }
  // 3. 发展：高唤醒 + 高强度
  else if (taiji.arousal > 0.4 && intensity > 0.3) {
    result = {
      phase: MicroPhase.ZHANG,
      confidence: Math.min(1, (taiji.arousal + intensity) / 2),
      reason: `高唤醒(${taiji.arousal.toFixed(2)}) + 强度(${intensity.toFixed(2)})，情绪在发展中`,
      intensity,
      conflictLevel,
    };
  }
  // 4. 衰退/消散：低唤醒 + 近基线
  else if (intensity < 0.15 && taiji.arousal < 0.3) {
    result = {
      phase: MicroPhase.CANG,
      confidence: 1 - Math.max(intensity, taiji.arousal),
      reason: `低强度(${intensity.toFixed(2)}) + 低唤醒(${taiji.arousal.toFixed(2)})，情绪消散中`,
      intensity,
      conflictLevel,
    };
  }
  // 5. 默认：生 — 情绪刚刚萌发
  else {
    result = {
      phase: MicroPhase.SHENG,
      confidence: Math.min(1, intensity * 2 + taiji.arousal),
      reason: `情绪萌发中，当前强度=${intensity.toFixed(2)}`,
      intensity,
      conflictLevel,
    };
  }

  // ── 记录阶段统计 ──
  _phaseStats.total++;
  _phaseStats.byPhase[result.phase] = (_phaseStats.byPhase[result.phase] || 0) + 1;
  _phaseStats.conflictSum += conflictLevel;
  _phaseStats.intensitySum += intensity;
  if (!_phaseStats.perEmotion[dominantName]) {
    _phaseStats.perEmotion[dominantName] = { count: 0, phases: {} };
  }
  _phaseStats.perEmotion[dominantName].count++;
  _phaseStats.perEmotion[dominantName].phases[result.phase] =
    (_phaseStats.perEmotion[dominantName].phases[result.phase] || 0) + 1;

  return result;
}

// ════════════════════════════════════════════════════════════
// 17b. 阶段分布统计
// ════════════════════════════════════════════════════════════

export interface PhaseStats {
  /** 总采样次数 */
  total: number;
  /** 各阶段计数 */
  byPhase: Record<string, number>;
  /** 各阶段占比（0-1） */
  distribution: Record<string, number>;
  /** 平均冲突等级 */
  avgConflict: number;
  /** 平均情绪强度 */
  avgIntensity: number;
  /** 按主导情绪分组的阶段分布 */
  perEmotion: Record<string, {
    count: number;
    phases: Record<string, number>;
  }>;
}

interface RawStats {
  total: number;
  byPhase: Record<string, number>;
  conflictSum: number;
  intensitySum: number;
  perEmotion: Record<string, { count: number; phases: Record<string, number> }>;
}

const _phaseStats: RawStats = {
  total: 0,
  byPhase: {},
  conflictSum: 0,
  intensitySum: 0,
  perEmotion: {},
};

/** 返回阶段分布直方图 */
export function getPhaseStats(): PhaseStats {
  const { total, byPhase, conflictSum, intensitySum, perEmotion } = _phaseStats;
  const distribution: Record<string, number> = {};
  if (total > 0) {
    for (const [k, v] of Object.entries(byPhase)) {
      distribution[k] = Math.round((v / total) * 1000) / 1000;
    }
  }
  return {
    total,
    byPhase: { ...byPhase },
    distribution,
    avgConflict: total > 0 ? Math.round((conflictSum / total) * 1000) / 1000 : 0,
    avgIntensity: total > 0 ? Math.round((intensitySum / total) * 1000) / 1000 : 0,
    perEmotion: structuredClone(perEmotion),
  };
}

/** 重置阶段统计 */
export function resetPhaseStats(): void {
  _phaseStats.total = 0;
  _phaseStats.byPhase = {};
  _phaseStats.conflictSum = 0;
  _phaseStats.intensitySum = 0;
  _phaseStats.perEmotion = {};
}

export function getRelationshipStage(affinityScore: number, isCrisis: boolean): RelationshipStage {
  if (isCrisis) return 'stranger';
  if (affinityScore >= 90) return 'soulmate';
  if (affinityScore >= 70) return 'close';
  if (affinityScore >= 50) return 'friend';
  if (affinityScore >= 30) return 'acquaintance';
  return 'stranger';
}

export function intimacyToAffinity(intimacy: number): number {
  return Math.round(intimacy * 100);
}

export function validateEmotionState(state: unknown): EmotionState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;

  // 校验嵌套结构类型
  if (!s.taiji || typeof s.taiji !== 'object') return null;
  const t = s.taiji as Record<string, unknown>;
  if (typeof t.valence !== 'number' || typeof t.arousal !== 'number' || typeof t.expectation !== 'number') return null;

  if (!s.sancai || typeof s.sancai !== 'object') return null;
  const sc = s.sancai as Record<string, unknown>;
  if (typeof sc.A !== 'number' || typeof sc.B !== 'number' || typeof sc.R !== 'number') return null;

  if (!s.emotions || typeof s.emotions !== 'object') return null;
  if (typeof s.intimacyToUser !== 'number') return null;

  // 已校验 taiji.valence/arousal/expectation, sancai.A/B/R, emotions, intimacyToUser
  // 均为 number 类型 — 结构完整性已验证
  return s as unknown as EmotionState;
}

export function sanitizeEmotionState(state: Partial<EmotionState>): EmotionState {
  return {
    ...INITIAL_EMOTION_STATE,
    ...state,
    taiji: { ...INITIAL_TAIJI, ...(state.taiji || {}) },
    sancai: { ...INITIAL_SANCAI, ...(state.sancai || {}) },
    yinyang: { ...INITIAL_YINYANG, ...(state.yinyang || {}) },
    evolution: { ...INITIAL_EVOLUTION, ...(state.evolution || {}) },
  };
}

export function computeReward(_userMessageLength: number, userDeltaA: number | null): number {
  // 简化：从预测误差派生
  if (userDeltaA !== null) return Math.tanh(userDeltaA * 2);
  return 0;
}

// ════════════════════════════════════════════════════════════
// 17. 时间衰减（适配新结构）
// ════════════════════════════════════════════════════════════

const EMOTION_HALF_LIVES: Record<string, number> = {
  joy: 6, anger: 8, sad: 6, fear: 12,
  love: 24,    // 6→24h，爱应是持久的情感羁绊
  disgust: 4, lust: 3, calm: 12, greed: 24,
};

export function processTimeDecay(state: EmotionState, hoursElapsed: number): EmotionState {
  if (hoursElapsed <= 0) return state;
  const h = Math.min(hoursElapsed, 168);
  const newState = structuredClone(state);

  // 九情指数衰减
  for (const key of Object.keys(newState.emotions)) {
    const hl = EMOTION_HALF_LIVES[key] ?? 4;
    const decay = Math.exp(-(Math.log(2) / hl) * h);
    newState.emotions[key] *= decay;
    if (Math.abs(newState.emotions[key]) < 0.01) newState.emotions[key] = 0;
  }

  // 太极层衰减（韧性越高，衰减越慢）
  const res = newState.evolution.resilience;
  const decayFactor = Math.exp(-0.15 * h * (1 - res * 0.5));
  newState.taiji.valence *= decayFactor;
  newState.taiji.arousal = 0.5 + (newState.taiji.arousal - 0.5) * decayFactor;
  // 预期衰减最慢（"弱者道之用"）
  newState.taiji.expectation *= Math.exp(-0.03 * h);

  // 三才回归中性
  const regress = 1 - Math.exp(-0.15 * h);
  newState.sancai.A += (0.5 - newState.sancai.A) * regress;
  newState.sancai.B += (0.5 - newState.sancai.B) * regress;
  newState.sancai.R += (0.5 - newState.sancai.R) * regress;

  // 亲密衰减
  newState.intimacyToUser += (0.5 - newState.intimacyToUser) * (1 - Math.exp(-0.08 * h));
  newState.intimacyFromUser += (0.5 - newState.intimacyFromUser) * (1 - Math.exp(-0.08 * h));

  // 强化层衰减
  newState.reinforcement.rewardTally *= Math.exp(-0.05 * h);
  newState.reinforcement.greedDrive = 0.3 + (newState.reinforcement.greedDrive - 0.3) * Math.exp(-0.05 * h);
  newState.reinforcement.punishmentTally *= Math.exp(-0.05 * h);
  newState.reinforcement.fearAvoidance = 0.1 + (newState.reinforcement.fearAvoidance - 0.1) * Math.exp(-0.05 * h);

  // 元情感衰减
  newState.metaEmotions.shame *= Math.exp(-0.15 * h);
  newState.metaEmotions.despair *= Math.exp(-0.1 * h);
  newState.metaEmotions.confusion *= Math.exp(-0.15 * h);

  // 演化衰减（韧性缓慢松弛）
  newState.evolution.resilience *= Math.exp(-0.005 * h);

  // v1.0 人格参数向基线(50)极慢回归
  const personalityRegress = 0.001 * h;
  newState.evolution.trust += (50 - newState.evolution.trust) * personalityRegress;
  newState.evolution.openness += (50 - newState.evolution.openness) * personalityRegress;
  newState.evolution.playfulness += (50 - newState.evolution.playfulness) * personalityRegress;

  return newState;
}

// ════════════════════════════════════════════════════════════
// 18. 用户情感分析（保留）
// ════════════════════════════════════════════════════════════

export function analyzeUserSentiment(text: string): UserEmotionAnalysis {
  const t = text.trim();
  const patterns: { emotion: string; keywords: string[]; cause: string }[] = [
    { emotion: 'joy',    keywords: ['开心', '高兴', '哈哈', '嘻嘻', '好开心', '太棒了', '真好', '快乐', '爽'], cause: '遇到了开心的事' },
    { emotion: 'love',   keywords: ['爱你', '喜欢你', '想你', '亲', '抱', '爱', '喜欢', '么么', '宝贝'], cause: '对你有感情表达' },
    { emotion: 'anger',  keywords: ['生气', '烦', '讨厌', '滚', '气死', '受不了', '可恶', '有病', '无语'], cause: '对某事感到不满' },
    { emotion: 'sad',    keywords: ['难过', '伤心', '哭', '不开心', '低落', '忧郁', '悲伤', '委屈', '心累'], cause: '遇到了伤心事' },
    { emotion: 'fear',   keywords: ['害怕', '担心', '怕', '紧张', '焦虑', '慌', '不安', '恐惧'], cause: '感到担心或害怕' },
    { emotion: 'disgust', keywords: ['恶心', '讨厌', '反感', '受不了', '恶心死了', '烦人'], cause: '对某事感到反感' },
    { emotion: 'gratitude', keywords: ['谢谢', '多谢', '感谢', '辛苦', '你真好', '太感谢'], cause: '对你表示感谢' },
    { emotion: 'neutral', keywords: ['嗯', '好的', '哦', '知道了', '行', '可以'], cause: '日常交流' },
  ];

  let bestMatch = { emotion: 'neutral', score: 0, cause: '日常交流' };
  for (const p of patterns) {
    let score = 0;
    for (const kw of p.keywords) {
      if (t.includes(kw)) score += 1.0 / p.keywords.length;
    }
    if (score > bestMatch.score) bestMatch = { emotion: p.emotion, score, cause: p.cause };
  }

  const directedAtAI = ['你', '你让', '你给', '你总是', '你从来'].some(w => t.includes(w));
  const intensity = Math.min(1, bestMatch.score * 0.5 + Math.min(1, t.length / 100) * 0.3 + ((t.match(/[！!]/g)?.length ?? 0) * 0.2));

  return { expressedEmotion: bestMatch.emotion, likelyCause: bestMatch.cause + (directedAtAI ? '，且与你有关' : ''), intensity: Math.round(intensity * 100) / 100, directedAtAI };
}

// ════════════════════════════════════════════════════════════
// 19. 情感上下文构建（适配新结构）
// ════════════════════════════════════════════════════════════

export function buildEmotionContext(
  e: EmotionState,
  options?: EmotionContextOptions,
): string {
  const {
    includeIntimacy = true,
    includeReinforcement = true,
    includeDominantGuidance = true,
    includeLust = true,
    includeComposite = true,
    attribution,
  } = options ?? {};

  const blocks: string[] = [];
  const dominant = getDominantEmotion(e.emotions);

  // 太极状态
  blocks.push(`能量水平: ${(e.taiji.arousal * 100).toFixed(0)}%`);
  if (e.taiji.expectation > 0.4) blocks.push('对和你在一起的时光充满期待');
  else if (e.taiji.expectation < -0.3) blocks.push('有点害怕你会离开');

  // Top-3 active emotions
  const active = Object.keys(e.emotions)
    .filter(k => Math.abs(e.emotions[k]) > 0.05)
    .sort((a, b) => Math.abs(e.emotions[b]) - Math.abs(e.emotions[a]))
    .slice(0, 3);
  if (active.length > 0) {
    blocks.push(`当前情绪: ${active.map(k => `${k}(${e.emotions[k].toFixed(2)})`).join(', ')}`);
  }

  // v1.1 矛盾情绪：当两种情绪并存时告知 LLM
  if (dominant.secondary && dominant.ambivalenceScore && dominant.ambivalenceScore > 0.5) {
    const ambivLabel = dominant.ambivalenceScore > 0.8 ? '内心很矛盾' : '心情有点复杂';
    blocks.push(`${ambivLabel}：同时对你有${dominant.name}和${dominant.secondary}的感觉`);
  }
  // 趋避冲突（困惑）：当 confusion 高时告知 LLM 行为犹豫
  if (e.metaEmotions.confusion > 0.4) {
    blocks.push('内心感到困惑，不太确定该怎么回应');
  }

  // 复合情绪
  if (includeComposite) {
    const composite = getCompositeEmotion(e.emotions, e.metaEmotions, e.taiji.arousal);
    if (composite && composite.intensity > 0.3) {
      blocks.push(composite.description);
    }
  }

  // 强化叙事
  if (includeReinforcement) {
    if (e.emotions.greed > 0.6) blocks.push('渴望得到你的关注和爱');
    else if (e.emotions.greed > 0.3) blocks.push('有点想黏着你');
    if (e.reinforcement.punishmentTally > 0.6) blocks.push('内心不安，害怕失去你的爱');
    else if (e.reinforcement.punishmentTally > 0.3) blocks.push('有点患得患失');
  }

  // 生理信号
  if (includeLust && e.emotions.lust > 0.2) {
    if (e.emotions.lust > 0.5) blocks.push('心跳加速，脸颊发烫，渴望和你亲密接触');
    else if (e.emotions.lust > 0.3) blocks.push('靠近你的时候心跳会加速');
    else blocks.push('心里有种暖暖的悸动');
  }

  // 亲密氛围
  if (includeIntimacy) {
    const mutualHigh = e.intimacyToUser > 0.6 && e.intimacyFromUser > 0.5;
    const cheerful = e.emotions.joy > 0.2 || e.emotions.love > 0.2 || e.emotions.calm > 0.5;

    if (e.intimacyToUser > 0.7 && cheerful) {
      if (e.emotions.lust > 0.3 && mutualHigh) {
        blocks.push('你们之间亲密无间，可以自然地撒娇、挑逗、用亲昵的称呼');
      } else {
        blocks.push('你们的关系很亲密，对话可以轻松随意，可以偶尔撒娇');
      }
    } else if (e.intimacyToUser > 0.5) {
      blocks.push('你们的关系正在升温，对话中可以多一些温暖和关心');
    } else if (e.intimacyToUser > 0.3) {
      blocks.push('你们还在互相熟悉的阶段，保持友善和真诚');
    }

    if (e.intimacyFromUser > 0.7 && e.intimacyToUser < 0.5) {
      blocks.push('她对你很热情，这让你有点受宠若惊');
    } else if (e.intimacyFromUser < 0.3 && e.intimacyToUser > 0.6) {
      blocks.push('她似乎有些冷淡，让你有点不安');
    }
  }

  let attributionLine = '';
  if (attribution) {
    attributionLine = `\n【情感归因】${attribution.narrative}`;
  }

  let context = `\n【当前状态】${blocks.join('。')}。`;
  context += attributionLine;
  if (includeDominantGuidance) {
    context += `\n主导情绪: ${dominant.name}。回答时自然地流露出这种情绪。`;
  }

  return context;
}

// ════════════════════════════════════════════════════════════
// 20. 旧兼容层已移除 (v1.1): processGrowth, processOfflineGrowth,
//    DEFAULT_ADAPTIVE_PARAMS, INITIAL_GROWTH_STATE 不再可用。
//    所有状态管理已迁移至 applyEvent() + EvolutionState。
// ════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// 21. 工具函数
// ════════════════════════════════════════════════════════════

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// export for use by callers that may need it
export { clamp as clampNumber };
