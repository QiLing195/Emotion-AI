// ── server.ts 类型定义（从 server.ts 抽取）──

// AI Settings
export type AISettings = { provider: string; apiKey: string; model: string; baseUrl?: string; enableWebSearch?: boolean; temperature?: number };

// Layer 1: 核心情感
export interface CoreState {
    valence: number;      // [-1, 1] 效价
    arousal: number;      // [0, 1]  唤醒度
    expectation: number;  // [-1, 1] 预期效价
    dominance: number;    // [-1, 1] 支配感（新增 Phase 2）
    extremityDuration: number; // 累计处于极值的时长（用于反转压力）
    lastExtremitySign: number; // 上次极值方向
    _trend: number;
    _valenceHistory: number[];
}

// Layer 2: 动力层
export interface Layer2State {
    apologyCredit: number;
    recentTraumaCount: number;
    tick: number;
    baseline: number;     // 预期的长期基线（成长）
    resilience: number;   // 韧性
}

export interface MemoryRecord { totalValence: number; occurrences: number; lastSeen: number; }

// Layer 4: 元认知层
export interface CuriosityState {
    intensity: number;          // [0, 1] 当前好奇心强度
    drive: number;              // [0, 1] 持续驱动力（带遗忘）
    recentPredictionErrors: number[];  // 最近 20 个 |predictionError|
    triggerCount: number;       // 触发实验的次数（用于衰减）
    lastCuriosityDecay: number; // 上次衰减的 tick
}

export interface Hypothesis {
    id: string;
    statement: string;
    category: 'user' | 'self' | 'relation';
    confidence: number;
    evidenceCount: number;
    lastTested: number;
    createdAt: number;
    fromObservation: string;
    basedOn: string;
    active: boolean;
    status: 'active' | 'confirmed' | 'disconfirmed' | 'archived';
}

export interface Experiment {
    id: string;
    hypothesisId: string;
    type: 'ask_question' | 'test_behavior' | 'observe_response' | 'scenario_play' | 'confirm_past' | 'self_disclose';
    prompt: string;
    targetAngle: string;
    risk: 'low' | 'medium' | 'high';
    state: 'pending' | 'running' | 'completed' | 'aborted';
    result: string | null;
    expectedValence: number;
    createdAt: number;
    completedAt: number | null;
}

export interface TensionRegulatorState {
    curiosityDecayRate: number;
    tensionLevel: number;
    lastExpression: number;
    suppressionCount: number;
    alphaVMultiplier: number;
    alphaEMultiplier: number;
    familiarity: number;
    volatility: number;
    adaptationRate: number;
}

export interface PatternCase {
    topic: string;
    pattern: { key: string; weight: number; occurrences: number }[];
    relevance: number;
}

// v0.7: 世界模型
export interface TMSEvidence { source: string; text: string; valence: number; timestamp: number; counterEvidence: string[]; }
export interface TMSConflict { a: string; b: string; type: 'contradiction' | 'tension' | 'update'; resolved: boolean; resolvedBy: string | null; }
export interface CausalBelief {
    id: string;
    statement: string;
    confidence: number;
    evidenceCount: number;
    contradictoryCount: number;
    lastUpdated: number;
    sources: string[];
    category: 'user_trait' | 'ai_trait' | 'relationship' | 'world';
    evidence: { for: number; against: number; total: number };
    contradictions: string[];
    justification: string;
}
export interface ParadigmShiftRecord { version: number; triggeredBy: string; oldBeliefs: string[]; newBeliefs: string[]; timestamp: number; }
export interface WorldModelData { beliefs: CausalBelief[]; paradigmVersion: number; paradigmFreezeRemaining: number; shiftHistory: ParadigmShiftRecord[]; tmsConflicts: TMSConflict[]; lastParadigmShift: number; }

// v0.8: 自我模型
export interface SelfPattern {
    id: string;
    label: string;
    category: 'expression' | 'reaction' | 'desire' | 'boundary' | 'vulnerability';
    description: string;
    confidence: number;
    occurrences: number;
    firstObserved: number;
    lastObserved: number;
}
export interface SelfModelData { patterns: SelfPattern[]; metaBeliefs: { statement: string; confidence: number }[]; version: number; lastAnalyzed: number; }

// v0.9: 策略
export type StrategyType =
    | 'self_disclosure' | 'express_boundary' | 'ask_question' | 'offer_comfort'
    | 'playful_tease' | 'express_vulnerability' | 'stay_silent'
    | 'express_curiosity' | 'express_affection' | 'assert_needs';

export interface StrategyDirective {
  strategy: StrategyType;
  promptSnippet: string;
  confidence: number;
  reasoningSummary: string;
  controlMode: 'predictive' | 'generative';
}

export interface StrategyFeedbackRecord {
    strategy: StrategyType;
    timestamp: number;
    userValenceBefore: number;
    userValenceAfter: number;
    efficacySignal: number;
    contextNarrative: string;
}
export interface StrategyScore { strategy: StrategyType; score: number; reasons: string[]; }

// Layer 4: 实验记录
export interface CompletedExperimentRecord { id: string; hypothesisId: string; type: Experiment['type']; result: string; learning: string; completedAt: number; }

// 节律/自主
export interface HourlyActivityTracker { hour: number; totalMessages: number; totalChars: number; daysObserved: number; activeDays: number; lastRecalc: number; }
export interface InternalState { loneliness: number; boredom: number; tick: number; ignoredStreak: number; dailyMsgCounts: Record<string, number>; }
export interface InternalLogEntry { ts: number; type: string; data: any; }
export interface ProactiveMessage { id: string; text: string; reason: string; timestamp: number; read: boolean; quality: number; }
