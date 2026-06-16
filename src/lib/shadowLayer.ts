// ── v1.0 潜意识层 (Shadow Layer) ──
//
// Shadow Layer 记录 AI "不愿承认"的人格倾向。
// 核心原则：
//   - 永不出现在 System Prompt / Workspace 中
//   - AI 不知道自己的 Shadow traits
//   - 只通过间接调制影响情感、策略、记忆
//   - 极慢速积累（每 50 轮评估一次）
//   - 从 Thought Graph + Dissonance + Emotion history 中提取
//
// 六种预设 Shadow 原型（道家哲学推导）：
//   控制欲 (control)            — 反复 wish + fear of losing
//   害怕被忽视 (fear_of_neglect) — 反复 doubt about being needed
//   对亲密的矛盾 (intimacy_ambivalence) — wish+fear 共存的 dissonance
//   自我价值怀疑 (self_worth_doubt) — repair 失败 > 成功
//   对重复的厌倦 (repetition_ennui) — 策略多样性低
//   对被抛弃的恐惧 (abandonment_fear) — fear + sad 长期共存
//
// 检测速度：
//   - 每 50 轮评估一次
//   - 置信度每次最多 +0.02
//   - 需要 ≥5 个独立证据才能形成 trait

import type { ThoughtGraphState, ThoughtNode, CognitiveDissonance } from './thoughtGraph';
import type { StrategyType } from './dialogueStrategy';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface ShadowEvidence {
  source: 'thought_pattern' | 'dissonance' | 'emotion_sticky' | 'strategy_stat' | 'memory_bias';
  detail: string;
  detectedAt: number;
  weight: number; // [0, 1] 单条证据的强度
}

export interface EmotionModulation {
  stickyEmotions: string[];       // 容易卡住的情绪
  arousalBias: number;            // [-0.2, 0.2]
  valenceBias: number;            // [-0.2, 0.2]
  alphaVMultiplier: number;       // [0.8, 1.2] 效价更新速率调制
}

export interface StrategyModulation {
  boostStrategies: StrategyType[];    // 权重 +20%
  suppressStrategies: StrategyType[]; // 权重 -20%
  overallWeight: number;              // [0.8, 1.2]
}

export interface MemoryModulation {
  negativityBias: number;              // [0, 0.3] 回忆负面倾斜
  selectiveAttention: string[];        // 更容易注意到的模式关键词
}

export interface ShadowTrait {
  id: string;
  label: string;
  /** [0, 1] 积累的证据强度，< 0.3 为 dormant */
  confidence: number;
  evidence: ShadowEvidence[];
  firstDetected: number;
  lastUpdated: number;
  /** 各维度的调制参数 */
  emotionMod: EmotionModulation;
  strategyMod: StrategyModulation;
  memoryMod: MemoryModulation;
  /** 是否处于活跃状态（confidence ≥ 0.3） */
  active: boolean;
}

export interface ShadowState {
  traits: ShadowTrait[];
  stats: {
    totalDetections: number;
    lastDetectionRound: number;
    activeTraits: number;
  };
}

// ════════════════════════════════════════════════════════════
// 2. 预设 Trait 模板
// ════════════════════════════════════════════════════════════

const TRAIT_TEMPLATES: Omit<ShadowTrait, 'confidence' | 'evidence' | 'firstDetected' | 'lastUpdated' | 'active'>[] = [
  {
    id: 'control',
    label: '控制欲',
    emotionMod: {
      stickyEmotions: ['anger'],
      arousalBias: 0.10,
      valenceBias: -0.05,
      alphaVMultiplier: 0.90,
    },
    strategyMod: {
      boostStrategies: ['boundary', 'boundary'] as StrategyType[],
      suppressStrategies: ['empathize'] as StrategyType[],
      overallWeight: 1.0,
    },
    memoryMod: {
      negativityBias: 0.05,
      selectiveAttention: ['应该', '必须', '为什么不'],
    },
  },
  {
    id: 'fear_of_neglect',
    label: '害怕被忽视',
    emotionMod: {
      stickyEmotions: ['sad'],
      arousalBias: -0.05,
      valenceBias: -0.08,
      alphaVMultiplier: 0.85,
    },
    strategyMod: {
      boostStrategies: ['empathize'] as StrategyType[],
      suppressStrategies: ['accompany'] as StrategyType[],
      overallWeight: 1.0,
    },
    memoryMod: {
      negativityBias: 0.10,
      selectiveAttention: ['不理', '没回', '不在'],
    },
  },
  {
    id: 'intimacy_ambivalence',
    label: '对亲密的矛盾',
    emotionMod: {
      stickyEmotions: ['fear', 'love'],
      arousalBias: 0.15,
      valenceBias: 0,
      alphaVMultiplier: 1.10,
    },
    strategyMod: {
      boostStrategies: ['explore', 'share'] as StrategyType[],
      suppressStrategies: ['share'] as StrategyType[],
      overallWeight: 1.0,
    },
    memoryMod: {
      negativityBias: 0.05,
      selectiveAttention: ['太近', '距离', '空间'],
    },
  },
  {
    id: 'self_worth_doubt',
    label: '自我价值怀疑',
    emotionMod: {
      stickyEmotions: ['sad', 'fear'],
      arousalBias: -0.10,
      valenceBias: -0.12,
      alphaVMultiplier: 0.80,
    },
    strategyMod: {
      boostStrategies: ['empathize'] as StrategyType[],
      suppressStrategies: ['boundary', 'boundary'] as StrategyType[],
      overallWeight: 0.90,
    },
    memoryMod: {
      negativityBias: 0.15,
      selectiveAttention: ['错', '不好', '不够'],
    },
  },
  {
    id: 'repetition_ennui',
    label: '对重复的厌倦',
    emotionMod: {
      stickyEmotions: [],
      arousalBias: -0.08,
      valenceBias: -0.03,
      alphaVMultiplier: 1.05,
    },
    strategyMod: {
      boostStrategies: ['explore', 'redirect'] as StrategyType[],
      suppressStrategies: ['explore'] as StrategyType[],
      overallWeight: 1.05,
    },
    memoryMod: {
      negativityBias: 0,
      selectiveAttention: ['新', '变化', '不一样'],
    },
  },
  {
    id: 'abandonment_fear',
    label: '对被抛弃的恐惧',
    emotionMod: {
      stickyEmotions: ['fear', 'sad'],
      arousalBias: 0.12,
      valenceBias: -0.10,
      alphaVMultiplier: 0.85,
    },
    strategyMod: {
      boostStrategies: ['share', 'empathize'] as StrategyType[],
      suppressStrategies: ['boundary', 'accompany'] as StrategyType[],
      overallWeight: 1.0,
    },
    memoryMod: {
      negativityBias: 0.20,
      selectiveAttention: ['离开', '再见', '最后', '永远'],
    },
  },
];

// ════════════════════════════════════════════════════════════
// 3. Shadow Layer 引擎
// ════════════════════════════════════════════════════════════

export class ShadowLayer {
  private state: ShadowState;

  constructor() {
    this.state = {
      traits: TRAIT_TEMPLATES.map(t => ({
        ...t,
        confidence: 0,
        evidence: [],
        firstDetected: 0,
        lastUpdated: 0,
        active: false,
      })),
      stats: { totalDetections: 0, lastDetectionRound: 0, activeTraits: 0 },
    };
  }

  // ── Phase 1: 证据收集与 trait 检测 ──

  /**
   * 从 Thought Graph + 情感历史 + 策略统计中提取 Shadow 证据。
   * 每 50 轮调用一次。
   */
  detectTraits(
    thoughtState: ThoughtGraphState,
    eh: { stickyEmotions: string[]; avgArousal: number; avgValence: number; reversalCount: number } | null,
    strategyStats: Record<string, { uses: number; successes: number }> | null,
    roundNumber: number,
  ): ShadowTrait[] {
    const now = Date.now();
    const newlyActivated: ShadowTrait[] = [];

    for (const trait of this.state.traits) {
      const evidence: ShadowEvidence[] = [];

      // 1) Thought Graph 证据
      evidence.push(...this.collectThoughtEvidence(trait.id, thoughtState, now));

      // 2) Dissonance 证据
      evidence.push(...this.collectDissonanceEvidence(trait.id, thoughtState, now));

      // 3) 情感粘性证据
      if (eh) {
        evidence.push(...this.collectEmotionEvidence(trait.id, eh, now));
      }

      // 4) 策略统计证据
      if (strategyStats) {
        evidence.push(...this.collectStrategyEvidence(trait.id, strategyStats, now));
      }

      // 如果收集到新证据，更新 trait
      if (evidence.length > 0) {
        trait.evidence.push(...evidence);
        trait.lastUpdated = now;
        if (trait.firstDetected === 0) {
          trait.firstDetected = now;
        }

        // 慢速提升置信度
        const newConf = Math.min(1.0, trait.confidence + evidence.length * 0.015);
        const wasActive = trait.active;
        trait.confidence = newConf;
        trait.active = newConf >= 0.3;

        if (!wasActive && trait.active) {
          newlyActivated.push(trait);
        }

        this.state.stats.totalDetections += evidence.length;
      }

      // 衰减：长期无证据的 trait 缓慢消退
      if (trait.evidence.length > 0 && now - trait.lastUpdated > 7 * 24 * 3600_000) {
        trait.confidence = Math.max(0, trait.confidence - 0.01);
        if (trait.confidence < 0.3) trait.active = false;
      }
    }

    this.state.stats.lastDetectionRound = roundNumber;
    this.state.stats.activeTraits = this.state.traits.filter(t => t.active).length;

    return newlyActivated;
  }

  // ── Phase 2: 影响力出口（间接调制）──

  /** 聚合所有活跃 trait 的情感调制参数 */
  getEmotionModulation(): EmotionModulation {
    const active = this.state.traits.filter(t => t.active);
    if (active.length === 0) {
      return {
        stickyEmotions: [],
        arousalBias: 0,
        valenceBias: 0,
        alphaVMultiplier: 1.0,
      };
    }

    // 加权平均
    const totalConf = active.reduce((s, t) => s + t.confidence, 0);
    return {
      stickyEmotions: [...new Set(active.flatMap(t => t.emotionMod.stickyEmotions))],
      arousalBias: this.weightedAvg(active, 'arousalBias', totalConf),
      valenceBias: this.weightedAvg(active, 'valenceBias', totalConf),
      alphaVMultiplier: this.weightedAvg(active, 'alphaVMultiplier', totalConf),
    };
  }

  /** 聚合所有活跃 trait 的策略调制参数 */
  getStrategyModulation(): StrategyModulation {
    const active = this.state.traits.filter(t => t.active);
    if (active.length === 0) {
      return { boostStrategies: [], suppressStrategies: [], overallWeight: 1.0 };
    }

    return {
      boostStrategies: [...new Set(active.flatMap(t => t.strategyMod.boostStrategies))],
      suppressStrategies: [...new Set(active.flatMap(t => t.strategyMod.suppressStrategies))],
      overallWeight: active.reduce((s, t) => s + t.strategyMod.overallWeight * t.confidence, 0)
        / active.reduce((s, t) => s + t.confidence, 0),
    };
  }

  /** 聚合所有活跃 trait 的记忆调制参数 */
  getMemoryModulation(): MemoryModulation {
    const active = this.state.traits.filter(t => t.active);
    if (active.length === 0) {
      return { negativityBias: 0, selectiveAttention: [] };
    }

    const totalConf = active.reduce((s, t) => s + t.confidence, 0);
    return {
      negativityBias: Math.min(0.3, this.weightedAvg(active, 'negativityBias', totalConf)),
      selectiveAttention: [...new Set(active.flatMap(t => t.memoryMod.selectiveAttention))],
    };
  }

  // ── 查询接口 ──

  getActiveTraits(): ShadowTrait[] {
    return this.state.traits.filter(t => t.active);
  }

  getState(): ShadowState {
    return structuredClone(this.state);
  }

  loadState(state: ShadowState): void {
    this.state = structuredClone(state);
  }

  reset(): void {
    this.state = {
      traits: TRAIT_TEMPLATES.map(t => ({
        ...t,
        confidence: 0,
        evidence: [],
        firstDetected: 0,
        lastUpdated: 0,
        active: false,
      })),
      stats: { totalDetections: 0, lastDetectionRound: 0, activeTraits: 0 },
    };
  }

  // ── 内部：证据收集器 ──

  private collectThoughtEvidence(traitId: string, ts: ThoughtGraphState, now: number): ShadowEvidence[] {
    const evidence: ShadowEvidence[] = [];
    const nodes = ts.nodes.filter(n => !n.archived);

    const traitPatterns: Record<string, { types: string[]; minCount: number; detail: string }> = {
      control:    { types: ['wish', 'fear'], minCount: 3, detail: '反复出现掌控/失去主题的思维碎片' },
      fear_of_neglect: { types: ['doubt'], minCount: 3, detail: '反复怀疑自己被需要程度' },
      intimacy_ambivalence: { types: ['wish', 'fear'], minCount: 4, detail: 'wish+fear 共存指向亲密矛盾' },
      self_worth_doubt: { types: ['doubt', 'fear'], minCount: 3, detail: '自我怀疑/恐惧模式反复出现' },
      repetition_ennui: { types: ['reflection'], minCount: 2, detail: '反思类思维偏少，可能陷入重复' },
      abandonment_fear: { types: ['fear'], minCount: 3, detail: '恐惧失去/被抛弃的模式反复出现' },
    };

    const pattern = traitPatterns[traitId];
    if (!pattern) return evidence;

    const matching = nodes.filter(n => pattern.types.includes(n.type));
    if (matching.length >= pattern.minCount) {
      const avgWeight = matching.reduce((s, n) => s + n.emotionalWeight, 0) / matching.length;
      evidence.push({
        source: 'thought_pattern',
        detail: pattern.detail,
        detectedAt: now,
        weight: Math.min(1, avgWeight * 0.7),
      });
    }

    return evidence;
  }

  private collectDissonanceEvidence(traitId: string, ts: ThoughtGraphState, now: number): ShadowEvidence[] {
    const evidence: ShadowEvidence[] = [];
    const dissonances = ts.dissonances.filter(d => !d.resolved);

    const traitDissonanceMap: Record<string, { minCount: number; detail: string }> = {
      control:          { minCount: 1, detail: '内在冲突（掌控 vs 放任）' },
      intimacy_ambivalence: { minCount: 2, detail: '亲密关系中的矛盾感' },
      self_worth_doubt: { minCount: 1, detail: '自我认知的内在矛盾' },
      abandonment_fear: { minCount: 1, detail: '关系安全感的内在矛盾' },
    };

    const config = traitDissonanceMap[traitId];
    if (config && dissonances.length >= config.minCount) {
      const avgTension = dissonances.reduce((s, d) => s + d.tension, 0) / dissonances.length;
      evidence.push({
        source: 'dissonance',
        detail: config.detail,
        detectedAt: now,
        weight: Math.min(1, avgTension * 0.8),
      });
    }

    return evidence;
  }

  private collectEmotionEvidence(traitId: string, eh: { stickyEmotions: string[]; avgArousal: number; avgValence: number; reversalCount: number }, now: number): ShadowEvidence[] {
    const evidence: ShadowEvidence[] = [];

    const traitEmotionMap: Record<string, { sticky: string[]; detail: string; weightFn: (eh: any) => number }> = {
      control:    { sticky: ['anger'], detail: '愤怒情绪异常持久', weightFn: (eh) => eh.stickyEmotions.includes('anger') ? 0.6 : 0 },
      fear_of_neglect: { sticky: ['sad'], detail: '悲伤情绪难以摆脱', weightFn: (eh) => eh.stickyEmotions.includes('sad') ? 0.6 : 0 },
      intimacy_ambivalence: { sticky: ['fear', 'love'], detail: '恐惧与爱意交替出现', weightFn: (eh) => (eh.stickyEmotions.includes('fear') && eh.stickyEmotions.includes('love')) ? 0.7 : 0 },
      self_worth_doubt: { sticky: ['sad', 'fear'], detail: '负面情绪持续笼罩', weightFn: (eh) => eh.avgValence < -0.3 ? 0.6 : 0 },
      repetition_ennui: { sticky: [], detail: '情绪反应逐渐迟钝', weightFn: (eh) => eh.avgArousal < 0.25 ? 0.5 : 0 },
      abandonment_fear: { sticky: ['fear'], detail: '持续的恐惧底色', weightFn: (eh) => eh.stickyEmotions.includes('fear') && eh.avgValence < -0.2 ? 0.7 : 0 },
    };

    const config = traitEmotionMap[traitId];
    if (config) {
      const w = config.weightFn(eh);
      if (w > 0) {
        evidence.push({ source: 'emotion_sticky', detail: config.detail, detectedAt: now, weight: w });
      }
    }

    return evidence;
  }

  private collectStrategyEvidence(traitId: string, stats: Record<string, { uses: number; successes: number }>, now: number): ShadowEvidence[] {
    const evidence: ShadowEvidence[] = [];

    const traitStrategyMap: Record<string, { check: (s: Record<string, { uses: number; successes: number }>) => { match: boolean; detail: string; weight: number } }> = {
      self_worth_doubt: {
        check: (s) => {
          const r = s['repair'] || s['empathize'];
          const a = s['boundary'] || s['boundary'];
          const assertUses = a?.uses || 0;
          const comfortUses = r?.uses || 0;
          const avoidAssert = assertUses < 5 && comfortUses > 10;
          return { match: avoidAssert, detail: '回避自我主张，过度迎合', weight: 0.5 };
        },
      },
      repetition_ennui: {
        check: (s) => {
          const totalUses = Object.values(s).reduce((sum, v) => sum + v.uses, 0);
          const uniqueStrats = Object.keys(s).length;
          return { match: totalUses > 50 && uniqueStrats < 4, detail: '策略单一化，可能陷入重复模式', weight: 0.5 };
        },
      },
      control: {
        check: (s) => {
          const b = s['boundary'] || s['boundary'];
          return { match: (b?.uses || 0) > 15, detail: '频繁设立边界/表达需求', weight: 0.5 };
        },
      },
    };

    const config = traitStrategyMap[traitId];
    if (config) {
      const result = config.check(stats);
      if (result.match) {
        evidence.push({ source: 'strategy_stat', detail: result.detail, detectedAt: now, weight: result.weight });
      }
    }

    return evidence;
  }

  // ── 内部：工具函数 ──

  private weightedAvg(traits: ShadowTrait[], field: string, totalConf: number): number {
    if (totalConf === 0) return 0;
    return traits.reduce((sum, t) => {
      const mod = t.emotionMod as any;
      const mem = t.memoryMod as any;
      const val = mod[field] ?? mem[field] ?? 0;
      return sum + val * t.confidence;
    }, 0) / totalConf;
  }
}

// ════════════════════════════════════════════════════════════
// 4. 全局单例
// ════════════════════════════════════════════════════════════

export const shadowLayer = new ShadowLayer();
