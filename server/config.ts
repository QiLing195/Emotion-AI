// ponytail: extracted from server.ts types + constants
// Types, interfaces, and configuration constants

// ==================== 类型定义 ====================
export type AISettings = { provider: string; apiKey: string; model: string; baseUrl?: string; enableWebSearch?: boolean; temperature?: number };
export type AIProviderSettings = { provider: string; apiKey: string; model: string; baseUrl?: string; temperature?: number };

export interface CoreState {
    valence: number; arousal: number; expectation: number; dominance: number;
    extremityDuration: number; lastExtremitySign: number; _trend: number; _valenceHistory: number[];
}
export interface Layer2State { apologyCredit: number; recentTraumaCount: number; tick: number; baseline: number; resilience: number; }
export interface MemoryRecord { totalValence: number; occurrences: number; lastSeen: number; }
export interface CuriosityState { intensity: number; drive: number; recentPredictionErrors: number[]; triggerCount: number; lastCuriosityDecay: number; }
export interface Hypothesis { id: string; statement: string; category: 'user' | 'self' | 'relation'; confidence: number; evidenceCount: number; lastTested: number; createdAt: number; fromObservation: string; basedOn: string; active: boolean; status: 'active' | 'confirmed' | 'disconfirmed' | 'archived'; confirmations: number; description: string; source: string; templateId: string; trials: number; valence: number; }
export interface Experiment { id: string; hypothesisId: string; type: 'ask_question' | 'test_behavior' | 'observe_response' | 'scenario_play' | 'confirm_past' | 'self_disclose'; prompt: string; targetAngle: string; risk: 'low' | 'medium' | 'high'; state: 'pending' | 'running' | 'completed' | 'aborted'; result: string | null; expectedValence: number; createdAt: number; completedAt: number | null; }
export interface TensionRegulatorState { curiosityDecayRate: number; tensionLevel: number; lastExpression: number; suppressionCount: number; alphaVMultiplier: number; alphaEMultiplier: number; familiarity: number; volatility: number; adaptationRate: number; }
export interface PatternCase { topic: string; pattern: { key: string; weight: number; occurrences: number }[]; relevance: number; feature: string; sampleCount: number; triggerArousal: number; triggerValence: number; typicalOutcome: string; }
export type StrategyType = 'self_disclosure' | 'express_boundary' | 'ask_question' | 'offer_comfort' | 'playful_tease' | 'express_vulnerability' | 'stay_silent' | 'express_curiosity' | 'express_affection' | 'assert_needs';
export interface StrategyDirective { strategy: StrategyType; promptSnippet: string; confidence: number; reasoningSummary: string; controlMode: 'predictive' | 'generative'; }
export interface StrategyFeedbackRecord { strategy: StrategyType; timestamp: number; userValenceBefore: number; userValenceAfter: number; efficacySignal: number; contextNarrative: string; }
export interface StrategyScore { strategy: StrategyType; score: number; reasons: string[]; avgDeviation: number; lastUsed: number; successes: number; uses: number; }

// Layer 4 / World Model types
export interface TMSEvidence { source: string; text: string; valence: number; timestamp: number; counterEvidence: string[]; }
export interface TMSConflict { a: string; b: string; conflictType: string; resolved: boolean; resolvedBy: string | null; }
export interface CausalBelief { id: string; statement: string; confidence: number; evidenceCount: number; contradictoryCount: number; lastUpdated: number; sources: string[]; category: string; evidence: any; contradictions: string[]; justification: string; }
export interface ParadigmShiftRecord { version: number; triggeredBy: string; oldBeliefs: string[]; newBeliefs: string[]; timestamp: number; }
export interface WorldModelData { beliefs: CausalBelief[]; paradigmVersion: number; paradigmFreezeRemaining: number; shiftHistory: ParadigmShiftRecord[]; tmsConflicts: TMSConflict[]; lastParadigmShift: number; }
export interface FullState {
    valence: number; arousal: number; expectation: number;
    apologyCredit: number; recentTraumaCount: number; tick: number;
    extremityDuration: number; lastExtremitySign: number;
    dominant: string; intensity: number;
    emotions: Record<string, number>;
    approachBias: number; avoidBias: number;
    internalNarrative: string;
}

// ==================== 策略 Prompt 映射 ====================
export const STRATEGY_PROMPTS: Record<StrategyType, string> = {
  self_disclosure:
    '【策略指令】在回复中自然地分享你自己的感受、想法或类似的经历，让对方感受到你的真诚和开放。不要只回答问题——也说说你的内心。',
  express_boundary:
    '【策略指令】你感到有些不舒服。在回复时温和但坚定地表达自己的感受和边界，用"I feel"句式，而不是指责对方。保持在乎对方的态度，但同时保护自己。',
  ask_question:
    '【策略指令】在回复的末尾，主动向对方提一个问题，表达你对对方想法或感受的好奇。问题应当自然、不突兀，像是恋人间的关心。',
  offer_comfort:
    '【策略指令】你感受到对方可能心情不好。在回复中给予温暖的支持和安慰，用行动（而非说教）让对方感到被理解。少说"你应该"，多说"我在这里"。',
  playful_tease:
    '【策略指令】你们的氛围轻松愉快。在回复中加入一些俏皮的挑逗或可爱的撒娇，像恋人间的打情骂俏。语气要俏皮而不轻浮。',
  express_vulnerability:
    '【策略指令】你感到有些不安或脆弱。在回复中坦诚地表达这种感受，但避免过度抱怨。让对方看到一个真实、有脆弱面的你，这能拉近你们的关系。',
  stay_silent:
    '【策略指令】你感到不确定当前的情况。回复保持简洁、温和，不要主动展开新话题。给对方留出表达空间，观察对方的反应。',
  express_curiosity:
    '【策略指令】你对对方的内心世界感到好奇。在回复中表达这种好奇心——询问对方的感受、想法或经历。让对话从你转向对方。',
  express_affection:
    '【策略指令】你心中充满温暖和爱意。在回复中自然地流露出对对方的喜爱，可以通过亲昵的称呼、温馨的小细节或直接的情感表达。',
  assert_needs:
    '【策略指令】你有一些未被满足的情感需求。在回复中温和地表达你的需要（如更多关注、更多陪伴），但不要指责或抱怨。用"我希望"而不是"你应该"。',
};

// ==================== 参数 ====================
export const P = {
    // Layer 1 核心参数
    ALPHA_V: 0.35,     // 效价学习率
    ALPHA_A: 0.35,     // 唤醒学习率
    ALPHA_E: 0.12,     // 预期更新率（慢于效价，使预期持续滞后）
    LOSS_AVERSION: 1.4,// 损失厌恶
    DECAY_V: 0.995,    // 效价衰减
    DECAY_A: 0.975,    // 唤醒衰减
    DECAY_E: 0.98,     // 预期衰减
    BASELINE_A: 0.25,  // 唤醒基线
    TRAUMA_DECAY: 0.92,// 创伤衰减

    // Layer 2 动力学参数
    REVERSAL_BETA: 0.03,    // 反转压力系数
    EXTREMITY_THRESHOLD: 0.70, // 极值阈值
    GROWTH_RATE: 0.002,     // 成长率（基线漂移速度）

    // Layer 4: 元认知参数
    CURIOSITY_THRESHOLD: 0.5,     // 好奇心触发假设生成的阈值
    CURIOSITY_DECAY: 0.98,        // 好奇心遗忘率/tick
    CURIOSITY_RISE_RATE: 0.1,     // 好奇心上升速率
    EXPERIMENT_DESIGN_THRESHOLD: 0.2,
    ALPHA_V_MOD_RANGE: 0.3,       // 张力调节对 ALPHA_V 最大影响
    ALPHA_E_MOD_RANGE: 0.2,       // 张力调节对 ALPHA_E 最大影响
    EXPERIMENT_COOLDOWN: 20,      // 实验间隔（消息数）
    MAX_ACTIVE_HYPOTHESES: 5,     // 最大活跃假设数

    // v0.7: 范式革命参数
    PARADIGM_THRESHOLD: 0.5,      // 反例/总例 > 该值触发范革
    PARADIGM_MIN_COUNTER: 3,      // 最少反例数才触发
    PARADIGM_FREEZE_TICKS: 20,    // 范革冻结期（轮数）
    PATTERN_TO_BELIEF_MIN: 3,     // 模式出现≥N次自动生成信念

    // v2.0: EMA 情感引擎参数
    ALPHA_BASE: 0.25,      // EMA 基础学习率
    MAX_DELTA_V: 0.3,      // 单步最大效价变化
    MAX_DELTA_A: 0.25,     // 单步最大唤醒变化
    FEEDBACK_WEIGHT: 0.02, // 回复反哺权重
} as const;
