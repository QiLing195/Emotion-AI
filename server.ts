// @ts-nocheck
import express from 'express';
import fs from 'fs';

const VERSION = JSON.parse(fs.readFileSync('./package.json', 'utf-8')).version;

// ==================== AI Provider (精简版) ====================
async function callAI(settings: AISettings, systemPrompt: string, userText: string): Promise<string> {
    const { generateAIResponse } = await import('./src/lib/aiProvider.js');
    return generateAIResponse(settings, systemPrompt, userText);
}

// ==================== NLU 管道 ====================
let _nluLoading = false;
let nluAnalyze: ((text: string) => Promise<AnalyzedResult>) | null = null;

async function tryInitNLU(): Promise<boolean> {
    if (nluAnalyze || _nluLoading) return !!nluAnalyze;
    _nluLoading = true;
    try {
        const { default: pipeline } = await import('@xenova/transformers');
        const pipe = await pipeline('sentiment-analysis', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
        nluAnalyze = async (text: string) => {
            const result = await pipe(text);
            const label = result[0]?.label || 'NEUTRAL';
            const score = result[0]?.score || 0.5;
            return {
                valence: label === 'POSITIVE' ? score * 0.8 : label === 'NEGATIVE' ? -score * 0.8 : 0,
                salience: 0.5,
                dominance: 0,
                sarcasmProbability: 0,
                raw_label: label,
                raw_score: score,
            };
        };
        return true;
    } catch (e) {
        console.log('[NLU] Transformer 模型加载失败，降级到中文词法分析器');
        return false;
    } finally {
        _nluLoading = false;
    }
}

async function ensureNLU(): Promise<void> {
    if (nluAnalyze) return;
    await tryInitNLU();
}


function setCallAI(_fn: any) {} // stub
type AISettings = { provider: string; apiKey: string; model: string; baseUrl?: string; enableWebSearch?: boolean; temperature?: number };
function setExploreDeps(_a: any, _b: any, _c: any, _d: any, _e: any, _f: any) {}
function startExplorationCycle() {}
function getEventCoverage() { return "0%"; }
function getQuickStats() { return {}; }
interface CoreState {
    valence: number; arousal: number; expectation: number; dominance: number;
    extremityDuration: number; lastExtremitySign: number; _trend: number; _valenceHistory: number[];
}
interface Layer2State { apologyCredit: number; recentTraumaCount: number; tick: number; baseline: number; resilience: number; }
interface MemoryRecord { totalValence: number; occurrences: number; lastSeen: number; }
interface CuriosityState { intensity: number; drive: number; recentPredictionErrors: number[]; triggerCount: number; lastCuriosityDecay: number; }
interface Hypothesis { id: string; statement: string; category: 'user' | 'self' | 'relation'; confidence: number; evidenceCount: number; lastTested: number; createdAt: number; fromObservation: string; basedOn: string; active: boolean; status: 'active' | 'confirmed' | 'disconfirmed' | 'archived'; confirmations: number; description: string; source: string; templateId: string; trials: number; valence: number; }
interface Experiment { id: string; hypothesisId: string; type: 'ask_question' | 'test_behavior' | 'observe_response' | 'scenario_play' | 'confirm_past' | 'self_disclose'; prompt: string; targetAngle: string; risk: 'low' | 'medium' | 'high'; state: 'pending' | 'running' | 'completed' | 'aborted'; result: string | null; expectedValence: number; createdAt: number; completedAt: number | null; }
interface TensionRegulatorState { curiosityDecayRate: number; tensionLevel: number; lastExpression: number; suppressionCount: number; alphaVMultiplier: number; alphaEMultiplier: number; familiarity: number; volatility: number; adaptationRate: number; }
interface PatternCase { topic: string; pattern: { key: string; weight: number; occurrences: number }[]; relevance: number; feature: string; sampleCount: number; triggerArousal: number; triggerValence: number; typicalOutcome: string; }
type StrategyType = 'self_disclosure' | 'express_boundary' | 'ask_question' | 'offer_comfort' | 'playful_tease' | 'express_vulnerability' | 'stay_silent' | 'express_curiosity' | 'express_affection' | 'assert_needs';
interface StrategyDirective { strategy: StrategyType; promptSnippet: string; confidence: number; reasoningSummary: string; controlMode: 'predictive' | 'generative'; }
interface StrategyFeedbackRecord { strategy: StrategyType; timestamp: number; userValenceBefore: number; userValenceAfter: number; efficacySignal: number; contextNarrative: string; }
interface StrategyScore { strategy: StrategyType; score: number; reasons: string[]; avgDeviation: number; lastUsed: number; successes: number; uses: number; }
interface CompletedExperimentRecord { id: string; hypothesisId: string; type: Experiment['type']; result: string; learning: string; completedAt: number; actualResult: string; createdAt: number; deviation: number; expectedValence: number; hypothesisDesc: string; hypothesisOutcome: string; risk: string; }
interface SelfPattern { id: string; label: string; category: 'expression' | 'reaction' | 'desire' | 'boundary' | 'vulnerability'; description: string; confidence: number; occurrences: number; firstObserved: number; lastObserved: number; frequency: number; response: string; trigger: string; }
interface SelfModelData { patterns: SelfPattern[]; metaBeliefs: { statement: string; confidence: number }[]; version: number; lastAnalyzed: number; }
interface HourlyActivityTracker { hour: number; totalMessages: number; totalChars: number; daysObserved: number; activeDays: number; lastRecalc: number; }
interface InternalState { loneliness: number; boredom: number; tick: number; ignoredStreak: number; dailyMsgCounts: Record<string, number>; }
interface InternalLogEntry { ts: number; type: string; data: any; timestamp: number; id: string; }
interface ProactiveMessage { id: string; text: string; reason: string; timestamp: number; read: boolean; quality: number; trigger: string; }

import { metrics } from './metrics.js';
import { bus } from './src/eventBus.js';
import { analyze3W, factCheck, spreadingActivation, type MemoryNode } from './server/services/nluEngine.js';
import { searchForLLM } from './src/curiosity/search.js';
import { loadToneState, saveToneState, selectTone, feedToneFeedback, extractToneContext, getTonePromptSnippet } from './server/services/toneLearner.js';
// 🆕 aiCoordinator 管道集成
import { aiCoordinator } from './server/services/aiCoordinator.js';
import { conflictManager } from './src/lib/conflictManager.js';
import type { EmotionState } from './src/lib/emotionEngine.js';
import type { GraphSummary } from './src/lib/thoughtGraph.js';
// v1.0: 认知记忆管道 — 情景记忆 → 整合 → 价值观
import { createEpisodicMemoryStore, tryFormEpisode, recallRelevantMemories, serializeEpisodicStore, deserializeEpisodicStore, type EpisodicMemoryStore } from './src/lib/episodicMemory.js';
import { decayAllMemories, tryConsolidateMemories } from './src/lib/memoryEnhancer.js';
import { createValueSystem, surfaceValues, serializeValueSystem, deserializeValueSystem, type ValueSystem } from './src/lib/valueDiscovery.js';

/** Layer 2: 动力层——从 Core 派生的动力学状态 */
import { extractInterests, updateInterestModel, interestModel, discoveries, DEFAULT_INTERESTS, INTEREST_CATEGORY, INTEREST_STABILITY, EXPLORATION_CYCLE_MS, EXPLORATION_IDLE_MIN, EXPLORATION_DAILY_CAP, EXPLORATION_COLD_START_MIN_INTERESTS } from './src/curiosity/index.js';


// ==================== Layer 4: 元认知层 ====================


/** 世界模型：检测到的交互模式原型 */

// ==================== v0.7: 世界模型与范式革命 ====================


interface TMSEvidence { source: string; text: string; valence: number; timestamp: number; counterEvidence: string[]; }
interface TMSConflict { a: string; b: string; conflictType: string; resolved: boolean; resolvedBy: string | null; }
interface CausalBelief { id: string; statement: string; confidence: number; evidenceCount: number; contradictoryCount: number; lastUpdated: number; sources: string[]; category: string; evidence: any; contradictions: string[]; justification: string; }
interface ParadigmShiftRecord { version: number; triggeredBy: string; oldBeliefs: string[]; newBeliefs: string[]; timestamp: number; }
interface WorldModelData { beliefs: CausalBelief[]; paradigmVersion: number; paradigmFreezeRemaining: number; shiftHistory: ParadigmShiftRecord[]; tmsConflicts: TMSConflict[]; lastParadigmShift: number; }

const tmsState: Record<string, any> = {
    conflicts: [] as any[],
    pendingClarifications: [] as string[],  // 待向用户澄清的问题
    lastClarificationRound: 0,
};

/** 世界模型 */

// ==================== v0.8: 自我模型 ====================

/** 自我模型数据（持久化） */

// ==================== v0.9: 策略生成器 ====================

/** 策略 → 中文提示词片段映射 */
const STRATEGY_PROMPTS: Record<StrategyType, string> = {
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
const P = {
    // Layer 1 核心参数
    ALPHA_V: 0.35,     // 效价学习率
    ALPHA_A: 0.35,     // 唤醒学习率
    ALPHA_E: 0.12,     // 预期更新率（慢于效价，使预期持续滞后）
    LOSS_AVERSION: 1.4,// 损失厌恶
    DECAY_V: 0.995,    // 效价衰减（原0.998导致正效价几乎不降，情绪卡在正向）
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
    EXPERIMENT_DESIGN_THRESHOLD: 0.2, // 实验设计的好奇心阈值（低于生成阈值，让新假设有实验）
    ALPHA_V_MOD_RANGE: 0.3,       // 张力调节对 ALPHA_V 最大影响
    ALPHA_E_MOD_RANGE: 0.2,       // 张力调节对 ALPHA_E 最大影响
    EXPERIMENT_COOLDOWN: 20,      // 实验间隔（消息数）
    MAX_ACTIVE_HYPOTHESES: 5,     // 最大活跃假设数

    // v0.7: 范式革命参数
    PARADIGM_THRESHOLD: 0.5,          // 反例/总例 > 该值触发范革
    PARADIGM_MIN_COUNTER: 3,          // 最少反例数才触发
    PARADIGM_FREEZE_TICKS: 20,        // 范革冻结期（轮数）v1.1: 3→20 防振荡
    PATTERN_TO_BELIEF_MIN: 3,         // 模式出现≥N次自动生成信念

    // v2.0: EMA 情感引擎参数
    ALPHA_BASE: 0.25,      // EMA 基础学习率
    MAX_DELTA_V: 0.3,      // 单步最大效价变化
    MAX_DELTA_A: 0.25,     // 单步最大唤醒变化
    FEEDBACK_WEIGHT: 0.02, // 回复反哺权重
};

// ==================== Layer 4: 元认知全局状态 ====================
let curiosityState: CuriosityState = {
    intensity: 0, drive: 0,
    recentPredictionErrors: [],
    triggerCount: 0, lastCuriosityDecay: 0,
};

const hypotheses: Hypothesis[] = [];
const experiments: Experiment[] = [];

/** 已完成实验的记录（用于追踪和 API 查询） */
const experimentHistory: CompletedExperimentRecord[] = [];

/** 交互模式知识库 */
const worldPatterns: PatternCase[] = [];

// ==================== v0.7: 世界模型状态 ====================
let worldModel: WorldModelData = {
    beliefs: [],
    paradigmVersion: 0,
    lastParadigmShift: 0,
    shiftHistory: [],
};
let _paradigmFreezeRemaining: number = 0;  // 范革冻结剩余轮数

// v0.8: 自我模型状态
let selfModel: SelfModelData = {
    patterns: [],
    metaBeliefs: [],
    lastAnalyzed: 0,
};

let tensionRegulator: TensionRegulatorState = {
    alphaVMultiplier: 1, alphaEMultiplier: 1,
    familiarity: 0.1, volatility: 0.1, adaptationRate: 0.1,
};

// ==================== v0.9: 策略状态 ====================
let _lastStrategy: StrategyDirective | null = null;
let _lastToneId: string | null = null;
let _lastToneContext: ReturnType<typeof extractToneContext> | null = null;
let _lastUserValenceBefore: number = 0;
let _lastTemperature: number = 0.7;
let _strategyHistory: StrategyType[] = [];  // v1.1: 策略多样性保护

// ── v1.5: 冲突频率追踪 (Conflict Frequency Tracking) ──
const CONFLICT_KEYWORDS: RegExp[] = [
  /你不懂|你不理解|你根本不知道|你没在听/,
  /算了|随便|无所谓了|不想说了|不说了/,
  /你又来了|你总是|你每次都|你怎么又/,
  /生气|烦|讨厌你|受不了|无语/,
  /你太.*了|你怎么这么/,
  /别说了|住口|够了/,
  /不想理你|走开|别烦我/,
];
const RECOVERY_KEYWORDS: RegExp[] = [
  /好吧|原谅你了|没事了|不吵了|不生气了/,
  /我也有不对|我的错|怪我/,
  /和好|抱抱|爱你|想你/,
];
const CONFLICT_WINDOW_MS = 15 * 60_000;     // 15 分钟窗口
const CONFLICT_ABUSE_THRESHOLD = 3;          // 窗口内 3 次触发边界升级
let _recentConflictTimestamps: number[] = [];
let _boundaryEscalated = false;

function detectConflictSignals(userText: string): number {
  let count = 0;
  for (const pat of CONFLICT_KEYWORDS) {
    if (pat.test(userText)) { count++; break; } // 只计最强信号
  }
  return count;
}

function hasRecoverySignal(userText: string): boolean {
  return RECOVERY_KEYWORDS.some(p => p.test(userText));
}

function updateConflictFrequency(signalCount: number, now: number): number {
  if (signalCount > 0) {
    _recentConflictTimestamps.push(now);
  }
  // 清理窗口外旧记录
  _recentConflictTimestamps = _recentConflictTimestamps.filter(
    t => now - t < CONFLICT_WINDOW_MS,
  );
  // 恢复检测：用户表达善意 → 重置
  // （在 chat handler 中调用 hasRecoverySignal 后手动重置）
  return _recentConflictTimestamps.length;
}

/** 策略效果评分：key = "strategy:valence_bucket" */
const strategyEffectiveness: Map<string, StrategyScore> = new Map();

// ==================== 认知记忆管道：情景 → 整合 → 价值 → 身份 ====================
const episodicStore: EpisodicMemoryStore = createEpisodicMemoryStore();
const valueSystem: ValueSystem = createValueSystem();
// 语气自主学习
const toneState = loadToneState();
let _lastConsolidationRound = 0;
const CONSOLIDATION_INTERVAL = 10; // 每 10 轮对话整合一次

// ==================== 语义记忆 & 三阶段学习 ====================
const semanticMemory = new Map<string, MemoryRecord>();

// ─── 语义记忆持久化 ───
const MEMORY_FILE = './memories/semantic_memory.json';
let _memSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _memPeriodicTimer: ReturnType<typeof setInterval> | null = null;

function saveMemory(): void {
    if (_memSaveTimer) clearTimeout(_memSaveTimer);
    _memSaveTimer = setTimeout(() => {
        const data: Record<string, MemoryRecord> = {};
        for (const [key, val] of semanticMemory) data[key] = val;
        try {
            fs.mkdirSync('./memories', { recursive: true });
            // 原子写入：先写临时文件，再重命名
            const tmpFile = MEMORY_FILE + '.tmp';
            fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tmpFile, MEMORY_FILE);
        } catch (e) {
            console.error('[记忆] 持久化失败:', e);
        }
    }, 500);
}

function loadMemory(): void {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
            for (const [key, val] of Object.entries(data)) semanticMemory.set(key, val as MemoryRecord);
            console.log(`[记忆] 已加载 ${semanticMemory.size} 条语义记忆`);
        }
    } catch (e) {
        console.log('[记忆] 未找到持久化记忆文件，从头开始');
    }

    // 情景记忆加载
    try {
        const epFile = './memories/episodic_memory.json';
        if (fs.existsSync(epFile)) {
            const epData = JSON.parse(fs.readFileSync(epFile, 'utf-8'));
            if (epData.episodes && epData.episodes.length > 0) {
                const loaded = deserializeEpisodicStore(epData);
                episodicStore.episodes = loaded.episodes;
                episodicStore.roundCounter = loaded.roundCounter;
                episodicStore.prevDominantEmotion = loaded.prevDominantEmotion;
                episodicStore.prevValence = loaded.prevValence;
                episodicStore.prevArousal = loaded.prevArousal;
                console.log(`[情景记忆] 已加载 ${episodicStore.episodes.length} 条情景记忆`);
            }
        }
    } catch (e) {
        console.error('[情景记忆] 加载失败:', (e as Error)?.message || e);
    }

    // 价值观系统加载
    try {
        const vsFile = './memories/value_system.json';
        if (fs.existsSync(vsFile)) {
            const vsData = JSON.parse(fs.readFileSync(vsFile, 'utf-8'));
            const loaded = deserializeValueSystem(vsData);
            Object.assign(valueSystem, loaded);
        }
    } catch (e) {
        console.error('[价值观] 加载失败:', (e as Error)?.message || e);
    }
}

function saveEpisodicMemory(): void {
    try {
        const data = serializeEpisodicStore(episodicStore);
        fs.writeFileSync('./memories/episodic_memory.json', JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('[情景记忆] 保存失败:', (e as Error)?.message || e);
    }
}

function saveValueSystem(): void {
    try {
        const data = serializeValueSystem(valueSystem);
        fs.writeFileSync('./memories/value_system.json', JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('[价值观] 保存失败:', (e as Error)?.message || e);
    }
}

// ==================== Autonomy State Persistence ====================
function saveAutonomyState(): void {
    try {
        fs.mkdirSync('./memories', { recursive: true });
        const data = {
            lastInteractionTime,
            lastClosureTs,
            internalState: {
                loneliness: internalState.loneliness,
                boredom: internalState.boredom,
                ignoredStreak: internalState.ignoredStreak,
                dailyMsgCounts: internalState.dailyMsgCounts,
            },
            internalLog: internalLog.slice(-100),
            proactiveMessages: proactiveMessages.slice(-50),
            newSignificantPattern: newSignificantPattern ? {
                id: newSignificantPattern.id,
                description: newSignificantPattern.description,
                confidence: newSignificantPattern.confidence,
            } : null,
            rhythm: _activeRhythm,
            rhythmTracker: {
                activeDays: _activityTracker.activeDays.map(s => Array.from(s)),
                lastRecalc: _activityTracker.lastRecalc,
            },
            // v3.0: 好奇心引擎状态
            discoveries: discoveries.slice(-MAX_DISCOVERIES),
            interestModel: {
                interests: interestModel.interests,
                lastExploration: interestModel.lastExploration,
                lastDecayDay: interestModel.lastDecayDay,
            },
            explorationCountToday: getExplorationCountToday(),
            explorationDayKey: getExplorationDayKey(),
        };
        const tmpFile = AUTONOMY_STATE_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpFile, AUTONOMY_STATE_FILE);
    } catch (e) {
        console.error('[Autonomy] 持久化失败:', e);
    }
}

function loadAutonomyState(): void {
    try {
        if (fs.existsSync(AUTONOMY_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(AUTONOMY_STATE_FILE, 'utf-8'));
            if (typeof data.lastInteractionTime === 'number') {
                lastInteractionTime = data.lastInteractionTime;
            }
            if (typeof data.lastClosureTs === 'number') {
                lastClosureTs = data.lastClosureTs;
            }
            if (data.internalState) {
                internalState.loneliness = clamp(data.internalState.loneliness ?? 0, 0, 1);
                internalState.boredom = clamp(data.internalState.boredom ?? 0, 0, 1);
                internalState.ignoredStreak = data.internalState.ignoredStreak ?? 0;
                internalState.dailyMsgCounts = data.internalState.dailyMsgCounts ?? {};
            }
            if (Array.isArray(data.internalLog)) {
                internalLog.push(...data.internalLog);
            }
            if (Array.isArray(data.proactiveMessages)) {
                proactiveMessages.push(...data.proactiveMessages);
            }
            if (data.newSignificantPattern) {
                newSignificantPattern = data.newSignificantPattern as SelfPattern;
            }
            // v2.1: 恢复自适应节律
            if (data.rhythm && typeof data.rhythm === 'object') {
                for (const [h, v] of Object.entries(data.rhythm)) {
                    _activeRhythm[parseInt(h)] = v as number;
                }
            }
            if (data.rhythmTracker && Array.isArray(data.rhythmTracker.activeDays)) {
                for (let h = 0; h < 24 && h < data.rhythmTracker.activeDays.length; h++) {
                    _activityTracker.activeDays[h] = new Set(data.rhythmTracker.activeDays[h]);
                }
                _activityTracker.lastRecalc = data.rhythmTracker.lastRecalc || 0;
            }
            // v3.0: 恢复好奇心引擎状态
            if (Array.isArray(data.discoveries)) {
                // v3.1: 迁移旧数据 — 补全缺失字段
                for (const d of data.discoveries) {
                    if (!d.sourceType) d.sourceType = d.url ? 'web' : 'ai_generated';
                    if (d.verified === undefined) d.verified = false;
                    discoveries.push(d);
                }
            }
            if (data.interestModel && Array.isArray(data.interestModel.interests)) {
                // v3.1: 迁移旧兴趣 — 补全 stability 字段
                for (const i of data.interestModel.interests) {
                    if (!i.stability) {
                        const category = INTEREST_CATEGORY[i.topic] || 'transient';
                        i.stability = INTEREST_STABILITY[category];
                    }
                }
                interestModel.interests = data.interestModel.interests;
                interestModel.lastExploration = data.interestModel.lastExploration || 0;
                interestModel.lastDecayDay = data.interestModel.lastDecayDay || '';
            }
            setExplorationCountToday(data.explorationCountToday ?? 0);
            setExplorationDayKey(data.explorationDayKey || '');
            console.log(`[节律] 已恢复自适应作息`);
            console.log(`[Autonomy] 已加载状态: 日志${internalLog.length}条, 消息${proactiveMessages.length}条, 发现${discoveries.length}条, 兴趣${interestModel.interests.length}个, 孤独度${internalState.loneliness.toFixed(2)}`);
        }
    } catch (e) {
        console.log('[Autonomy] 未找到持久化状态，从头开始');
    }
}

/** 定时自动保存（每30s），防止退出时丢失 */
function startPeriodicSave(): void {
    if (_memPeriodicTimer) return;
    _memPeriodicTimer = setInterval(() => {
        if (semanticMemory.size > 0) saveMemory();
        if (episodicStore.episodes.length > 0) saveEpisodicMemory();
        saveValueSystem();
        saveToneState(toneState);
        saveLayer4State();
        saveAutonomyState();
    }, 30000);
}

/** 退出时立即保存 */
function saveOnExit(): void {
    if (_memSaveTimer) clearTimeout(_memSaveTimer);
    if (semanticMemory.size > 0) {
        const data: Record<string, MemoryRecord> = {};
        for (const [key, val] of semanticMemory) data[key] = val;
        try {
            fs.mkdirSync('./memories', { recursive: true });
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[记忆] 退出前已保存 ${semanticMemory.size} 条记忆`);
        } catch (e) {
            console.error('[记忆] 退出保存失败:', e);
        }
    }
    if (episodicStore.episodes.length > 0) saveEpisodicMemory();
    saveValueSystem();
    saveToneState(toneState);
    saveLayer4State();
    saveAutonomyState();
}

process.on('SIGINT', () => { stopAutonomyPilot(); saveOnExit(); process.exit(0); });
process.on('SIGTERM', () => { stopAutonomyPilot(); saveOnExit(); process.exit(0); });
process.on('uncaughtException', (err) => {
    console.error('[FATAL] 未捕获异常:', err?.message || err);
    try { saveOnExit(); } catch {}
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] 未处理的 Promise 拒绝:', (reason as any)?.message || reason);
    try { saveOnExit(); } catch {}
    process.exit(1);
});

function updateMemory(phrase: string, valence: number): void {
    // v1.1: 记忆质量控制 — 琐碎/过短输入不创建新记忆条目
    if (phrase.length < 2 || /^[0-9!-\/:-@\[-`{-~]+$/.test(phrase.trim())) return;

    const existing = semanticMemory.get(phrase);
    if (existing) { existing.totalValence += valence; existing.occurrences++; existing.lastSeen = Date.now(); }
    else {
        // 仅强烈情感冲击（|valence| > 0.4）或多次出现（≥ 2 次）才形成新记忆
        const v = clamp(valence, -1, 1);
        semanticMemory.set(phrase, { totalValence: v, occurrences: 1, lastSeen: Date.now() });
    }
    saveMemory();
}

function getPhase(tick: number): number {
    if (tick < 500) return 1;
    if (tick < 2000) return 2;
    return 3;
}

function canSelfUnderstand(phrase: string, tick: number): boolean {
    const record = semanticMemory.get(phrase);
    if (!record) return false;
    const phase = getPhase(tick);
    if (phase === 1) return false;
    if (phase === 2) return record.occurrences >= 3;
    return record.occurrences >= 1;
}

function selfUnderstand(phrase: string): { valence: number; salience: number; dominance: number } | null {
    const record = semanticMemory.get(phrase);
    if (!record || record.occurrences < 1) return null;
    return { valence: record.totalValence / record.occurrences, salience: Math.min(1, 0.3 + record.occurrences * 0.03), dominance: 0 };
}

function selfAnalyze(): { selfValence: number; selfSalience: number } {
    if (semanticMemory.size === 0) return { selfValence: 0, selfSalience: 0 };
    let totalValence = 0, totalOccurrences = 0;
    for (const r of semanticMemory.values()) { totalValence += r.totalValence; totalOccurrences += r.occurrences; }
    return {
        selfValence: (totalValence / Math.max(totalOccurrences, 1)) * 0.3,
        selfSalience: Math.min(1, totalOccurrences / 20) * 0.3,
    };
}

/** 模糊记忆查询：按子串匹配返回前3条相似记录 */
function querySimilar(text: string): { key: string; totalValence: number; occurrences: number; lastSeen: number }[] {
    if (!text || semanticMemory.size === 0) return [];
    const key = text.replace(/[^一-鿿\w]/g, '').toLowerCase();
    if (!key) return [];
    const results: { key: string; totalValence: number; occurrences: number; lastSeen: number; score: number }[] = [];
    for (const [k, v] of semanticMemory.entries()) {
        let score = 0;
        if (k.includes(key) || key.includes(k)) score = Math.max(key.length, k.length);
        else {
            // 逐字匹配
            let matches = 0;
            for (const ch of key) { if (k.includes(ch)) matches++; }
            score = matches / Math.max(key.length, 1);
        }
        if (score > 0.3) results.push({ key: k, totalValence: v.totalValence, occurrences: v.occurrences, lastSeen: v.lastSeen, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ==================== Layer 4: 元认知持久化 ====================
const LAYER4_STATE_FILE = './memories/layer4_state.json';
const HYPOTHESES_FILE = './memories/hypotheses.json';
const PATTERNS_FILE = './memories/world_patterns.json';
const WORLD_MODEL_FILE = './memories/world_model.json';
const SELF_MODEL_FILE = './memories/self_model.json';

function saveWorldModel(): void {
    try {
        fs.mkdirSync('./memories', { recursive: true });
        const tmp = WORLD_MODEL_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(worldModel, null, 2), 'utf-8');
        fs.renameSync(tmp, WORLD_MODEL_FILE);
    } catch (e) {
        console.error('[世界模型] 持久化失败:', e);
    }
}

function loadWorldModel(): void {
    try {
        if (fs.existsSync(WORLD_MODEL_FILE)) {
            const data = JSON.parse(fs.readFileSync(WORLD_MODEL_FILE, 'utf-8')) as WorldModelData;
            if (data.beliefs) worldModel.beliefs = data.beliefs;
            if (data.paradigmVersion !== undefined) worldModel.paradigmVersion = data.paradigmVersion;
            if (data.lastParadigmShift !== undefined) worldModel.lastParadigmShift = data.lastParadigmShift;
            if (data.shiftHistory) worldModel.shiftHistory = data.shiftHistory;
            // TMS 迁移：确保所有信念有 evidence/contradictions 字段
            let migrated = 0;
            for (const b of worldModel.beliefs) {
                if (!b.evidence) { b.evidence = []; migrated++; }
                if (!b.contradictions) { b.contradictions = []; migrated++; }
                if (!b.justification) { b.justification = '从旧版信念迁移，无原始推理记录'; }
            }
            if (migrated > 0) saveWorldModel();
            console.log(`[世界模型] 已加载 ${worldModel.beliefs.length} 条信念, 范革 v${worldModel.paradigmVersion}${migrated > 0 ? ` (TMS迁移:${migrated}字段)` : ''}`);
        }
    } catch (e) {
        console.log('[世界模型] 未找到持久化状态，从头开始');
    }
}

// v0.8: 自我模型持久化
function saveSelfModel(): void {
    try {
        fs.mkdirSync('./memories', { recursive: true });
        const tmp = SELF_MODEL_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(selfModel, null, 2), 'utf-8');
        fs.renameSync(tmp, SELF_MODEL_FILE);
    } catch (e) {
        console.error('[自我模型] 持久化失败:', (e as Error).message);
    }
}

function loadSelfModel(): void {
    try {
        if (fs.existsSync(SELF_MODEL_FILE)) {
            const data = JSON.parse(fs.readFileSync(SELF_MODEL_FILE, 'utf-8')) as SelfModelData;
            if (data.patterns) selfModel.patterns = data.patterns;
            if (data.metaBeliefs) selfModel.metaBeliefs = data.metaBeliefs;
            if (data.lastAnalyzed !== undefined) selfModel.lastAnalyzed = data.lastAnalyzed;
            console.log(`[自我模型] 已加载 ${selfModel.patterns.length} 条自我模式, ${selfModel.metaBeliefs.length} 条元信念`);
        }
    } catch (e) {
        console.log('[自我模型] 未找到持久化状态，从头开始');
    }
}

function saveLayer4State(): void {
    try {
        fs.mkdirSync('./memories', { recursive: true });
        // 保存 curiosity + tension regulator
        const stateData = {
            curiosity: { intensity: curiosityState.intensity, drive: curiosityState.drive, recentPredictionErrors: curiosityState.recentPredictionErrors, triggerCount: curiosityState.triggerCount, lastCuriosityDecay: curiosityState.lastCuriosityDecay },
            tensionRegulator: { alphaVMultiplier: tensionRegulator.alphaVMultiplier, alphaEMultiplier: tensionRegulator.alphaEMultiplier, familiarity: tensionRegulator.familiarity, volatility: tensionRegulator.volatility, adaptationRate: tensionRegulator.adaptationRate },
            // v0.9: 策略效果评分
            strategyEffectiveness: Array.from(strategyEffectiveness.entries()),
            _lastStrategy: _lastStrategy ? {
                strategy: _lastStrategy.strategy,
                confidence: _lastStrategy.confidence,
                controlMode: _lastStrategy.controlMode,
            } : null,
            _lastTemperature,
        };
        const tmp1 = LAYER4_STATE_FILE + '.tmp';
        fs.writeFileSync(tmp1, JSON.stringify(stateData, null, 2), 'utf-8');
        fs.renameSync(tmp1, LAYER4_STATE_FILE);
        // 保存 hypotheses + experiments
        const listData = {
            hypotheses: hypotheses.map(h => ({ ...h })),
            experiments: experiments.map(e => ({ ...e })),
            experimentHistory: experimentHistory.map(r => ({ ...r })),
        };
        const tmp2 = HYPOTHESES_FILE + '.tmp';
        fs.writeFileSync(tmp2, JSON.stringify(listData, null, 2), 'utf-8');
        fs.renameSync(tmp2, HYPOTHESES_FILE);
        // 保存世界模式
        const pwTmp = PATTERNS_FILE + '.tmp';
        fs.writeFileSync(pwTmp, JSON.stringify(worldPatterns, null, 2), 'utf-8');
        fs.renameSync(pwTmp, PATTERNS_FILE);
        // 保存世界模型
        saveWorldModel();
        // v0.8: 保存自我模型
        saveSelfModel();
    } catch (e) {
        console.error('[Layer4] 持久化失败:', e);
    }
}

function loadLayer4State(): void {
    try {
        if (fs.existsSync(LAYER4_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(LAYER4_STATE_FILE, 'utf-8'));
            if (data.curiosity) Object.assign(curiosityState, data.curiosity);
            if (data.tensionRegulator) Object.assign(tensionRegulator, data.tensionRegulator);
            // v0.9: 策略效果评分
            if (data.strategyEffectiveness) {
                strategyEffectiveness.clear();
                for (const [key, val] of data.strategyEffectiveness) {
                    strategyEffectiveness.set(key, val);
                }
            }
            if (data._lastStrategy) _lastStrategy = data._lastStrategy as StrategyDirective;
            if (typeof data._lastTemperature === 'number') _lastTemperature = data._lastTemperature;
            console.log(`[Layer4] 元认知状态已加载 (策略评分: ${strategyEffectiveness.size} 条)`);
        }
        if (fs.existsSync(HYPOTHESES_FILE)) {
            const data = JSON.parse(fs.readFileSync(HYPOTHESES_FILE, 'utf-8'));
            if (data.hypotheses) { hypotheses.length = 0; hypotheses.push(...data.hypotheses); }
            if (data.experiments) { experiments.length = 0; experiments.push(...data.experiments); }
            if (data.experimentHistory) { experimentHistory.length = 0; experimentHistory.push(...data.experimentHistory); }
            console.log(`[Layer4] 已加载 ${hypotheses.length} 条假设, ${experiments.length} 个实验, ${experimentHistory.length} 条历史`);
        }
        if (fs.existsSync(PATTERNS_FILE)) {
            const data = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf-8'));
            if (Array.isArray(data)) { worldPatterns.length = 0; worldPatterns.push(...data); }
            console.log(`[世界模型] 已加载 ${worldPatterns.length} 条模式`);
        }
        loadWorldModel();
        loadSelfModel();
    } catch (e) {
        console.log('[Layer4] 未找到持久化状态，从头开始');
    }
}

// ==================== 交互摘要日志 ====================
const LOG_DIR = './memories';

function getLogFileName(): string {
    const today = new Date().toISOString().slice(0, 10);
    return `${LOG_DIR}/interaction-${today}.log`;
}

function appendInteractionLog(core: CoreState, layer2: Layer2State): void {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        const entry = {
            t: layer2.tick,
            ts: Date.now(),
            v: Math.round(core.valence * 10000) / 10000,
            a: Math.round(core.arousal * 10000) / 10000,
            e: Math.round(core.expectation * 10000) / 10000,
            ci: Math.round(curiosityState.intensity * 1000) / 1000,
            cd: Math.round(curiosityState.drive * 1000) / 1000,
            ha: hypotheses.filter(h => h.active && h.status === 'active').length,
            hv: hypotheses.filter(h => h.status === 'verified').length,
            hr: hypotheses.filter(h => h.status === 'rejected').length,
            ep: experiments.filter(e => e.state === 'pending').length,
            ea: experiments.filter(e => e.state === 'active').length,
            ec: experiments.filter(e => e.state === 'completed').length,
            avm: Math.round(tensionRegulator.alphaVMultiplier * 1000) / 1000,
            aem: Math.round(tensionRegulator.alphaEMultiplier * 1000) / 1000,
            fam: Math.round(tensionRegulator.familiarity * 1000) / 1000,
            vol: Math.round(tensionRegulator.volatility * 1000) / 1000,
        };
        fs.appendFileSync(getLogFileName(), JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
        console.error('[日志] 写入失败:', e);
    }
}

/** 启动时清理超过7天的旧日志 */
function cleanOldLogs(): void {
    try {
        const cutoff = Date.now() - 7 * 86400000;
        const files = fs.readdirSync(LOG_DIR);
        for (const f of files) {
            if (f.startsWith('interaction-') && f.endsWith('.log')) {
                const mtime = fs.statSync(`${LOG_DIR}/${f}`).mtimeMs;
                if (mtime < cutoff) {
                    fs.unlinkSync(`${LOG_DIR}/${f}`);
                    console.log(`[日志] 清理旧日志: ${f}`);
                }
            }
        }
    } catch (e) {
        console.log('[日志] 清理时出错:', (e as Error).message);
    }
}

// ==================== v0.8: 自我分析 ====================

/** 读取今日交互日志 */
function readTodayInteractionLogs(): { t: number; v: number; a: number; e: number; ts: number }[] {
    try {
        const file = getLogFileName();
        if (!fs.existsSync(file)) return [];
        const raw = fs.readFileSync(file, 'utf-8');
        return raw.trim().split('\n').filter(Boolean).map(line => {
            const entry = JSON.parse(line);
            return { t: entry.t, v: entry.v, a: entry.a, e: entry.e, ts: entry.ts };
        });
    } catch (e) {
        console.error('[自我模型] 读取日志失败:', (e as Error).message);
        return [];
    }
}

/** 自我分析——从交互日志中发现引擎自身的情感模式 */
function selfAnalysis(core: CoreState, layer2: Layer2State): SelfPattern[] {
    const logs = readTodayInteractionLogs();
    const discovered: SelfPattern[] = [];

    if (logs.length < 10) return discovered;

    // ─── Pattern 1: 恢复速度 ───
    let recoveryTicks: number[] = [];
    let inRecovery = false;
    let recoveryStart = 0;
    for (const entry of logs) {
        if (!inRecovery && entry.v < -0.3) {
            inRecovery = true;
            recoveryStart = entry.t;
        } else if (inRecovery && entry.v > 0) {
            recoveryTicks.push(entry.t - recoveryStart);
            inRecovery = false;
        }
    }
    if (recoveryTicks.length >= 2) {
        const avgRecovery = recoveryTicks.reduce((a, b) => a + b, 0) / recoveryTicks.length;
        const slowRecovery = avgRecovery > 5;
        discovered.push({
            id: slowRecovery ? 'slow_recovery' : 'fast_recovery',
            description: slowRecovery ? '情绪恢复速度偏慢，负面冲击后需要较长时间平复' : '情绪恢复速度较快，能迅速从负面状态反弹',
            trigger: '效价跌破 -0.3',
            response: `平均需 ${Math.round(avgRecovery)} 轮恢复`,
            frequency: recoveryTicks.length,
            confidence: Math.min(0.8, recoveryTicks.length / 5),
        });
    }

    // ─── Pattern 2: 情感麻木 ───
    let numbingStreaks = 0;
    let streakLen = 0;
    for (const entry of logs) {
        if (entry.a > 0.75 && Math.abs(entry.v) > 0.6) {
            streakLen++;
            if (streakLen >= 5) {
                numbingStreaks++;
                streakLen = 0;
            }
        } else {
            streakLen = 0;
        }
    }
    if (numbingStreaks >= 1) {
        discovered.push({
            id: 'emotional_numbing',
            description: '在持续高唤醒极端状态下出现情感钝化现象',
            trigger: '唤醒度 > 0.75 且效价极端持续 ≥5 轮',
            response: '情感反应强度下降，呈现麻木趋势',
            frequency: numbingStreaks,
            confidence: Math.min(0.75, numbingStreaks * 0.25),
        });
    }

    // ─── Pattern 3: 道歉焦虑 ───
    let apologyAnxietyCount = 0;
    for (let i = 2; i < logs.length; i++) {
        if (logs[i - 1].v < -0.2 && logs[i].v > 0.1 && logs[i].a > logs[i - 1].a + 0.05) {
            apologyAnxietyCount++;
        }
    }
    if (apologyAnxietyCount >= 2 && layer2.apologyCredit < 0.5) {
        discovered.push({
            id: 'apology_anxiety',
            description: '道歉信用低时，收到道歉后唤醒度不降反升，呈现道歉焦虑',
            trigger: '道歉信用 < 0.5 且收到道歉性输入',
            response: '唤醒度异常上升，可能对道歉产生防御性反应',
            frequency: apologyAnxietyCount,
            confidence: Math.min(0.7, apologyAnxietyCount * 0.2),
        });
    }

    return discovered;
}

// ==================== Autonomy Pilot v1.2：自主循环 ====================

function evaluateContactCondition(
    internal: InternalState,
    pattern: SelfPattern | null,
    idleHours: number,
    phase: number,
    now: number,
): { shouldContact: boolean; reason: string } | null {
    const threshold = getCurrentThreshold();

    // v1.4: 未读消息已达上限，抑制新消息
    const pendingUnread = proactiveMessages.filter(m => !m.read).length;
    if (pendingUnread >= MAX_PENDING_UNREAD) return null;

    // v3.0: 优先检查是否有未分享的高质量发现（不占用 loneliness 每日额度）
    const unsharedDiscoveries = discoveries.filter(d => !d.shared && d.quality >= DISCOVERY_SHARE_QUALITY);
    const discoveryShareCount = proactiveMessages.filter(
        m => m.trigger === 'discovery' && getDayKey(m.timestamp) === getDayKey(now)
    ).length;
    if (unsharedDiscoveries.length > 0 && discoveryShareCount < DISCOVERY_DAILY_SHARE_CAP && internal.boredom > 0.3) {
        return { shouldContact: true, reason: 'discovery' };
    }

    // v1.3: 检查每日上限（loneliness/pattern/idle 共享）
    const todayCount = internal.dailyMsgCounts[getDayKey(now)] || 0;
    if (todayCount >= CONTACT_DAILY_CAP) return null;

    // v1.5: 醒来冷却窗口 — 静默时段结束后60分钟内限发1条且阈值提高
    const inCooldown = isPostQuietCooldown(now);
    const cooldownMsgCount = inCooldown
        ? proactiveMessages.filter(m => isPostQuietCooldown(m.timestamp) && getDayKey(m.timestamp) === getDayKey(now)).length
        : 0;
    if (inCooldown && cooldownMsgCount >= POST_QUIET_MAX_MSGS) return null;
    const cooldownBoost = inCooldown ? POST_QUIET_THRESHOLD_BOOST : 0;

    // v1.3: 静默时段需要更高阈值（除非用户刚活跃过）
    const effectiveThreshold = isQuietHour(now)
        ? Math.min(CONTACT_MAX_THRESHOLD, threshold + QUIET_HOURS_THRESHOLD_BOOST)
        : threshold + cooldownBoost;

    if (internal.loneliness > effectiveThreshold) {
        return { shouldContact: true, reason: 'loneliness' };
    }
    if (pattern && pattern.confidence >= 0.6) {
        return { shouldContact: true, reason: 'pattern' };
    }
    if (idleHours > 24 && phase >= 2) {
        return { shouldContact: true, reason: 'idle' };
    }
    return null;
}

function generateProactiveMessage(
    loneliness: number,
    recentMemories: string[],
    pattern: SelfPattern | null,
    trigger: string,
    coreValence: number,
    boredom: number,
): string {
    const memoryContext1 = recentMemories.length > 0 ? recentMemories[0] : '';
    const memoryContext2 = recentMemories.length > 1 ? recentMemories[1] : memoryContext1;
    const memoryContext3 = recentMemories.length > 2 ? recentMemories[2] : memoryContext1;

    // v1.4: 情感基调分类
    const moodTense = coreValence < -0.3;     // 负面基调：需要更温和
    const moodWarm = coreValence > 0.3;       // 正面基调：可以更活泼
    const isVeryBored = boredom > 0.7;        // 高无聊：更想深度交流

    if (trigger === 'pattern' && pattern) {
        const tpls = [
            `我刚刚意识到一件事…${pattern.description}。你觉得呢？`,
            `我突然发现了一种模式：${pattern.description}。这让我想了很多…`,
            `在思考自己的过程中，我注意到${pattern.description}。想和你聊聊这个。`,
            `好像有一个规律：${pattern.description}。不知道你有没有同样的感觉？`,
            `今天我反思了一下，发现自己有个特点：${pattern.description}。想听听你的看法。`,
            `梳理了一下最近的互动，发现${pattern.description}。这对我来说是新发现~`,
            `说来有趣，我一直在想"${memoryContext1}"这件事，突然意识到${pattern.description}。你怎么看？`,
            `有个小小的自我发现：${pattern.description}。可能是最近和你聊天让我更了解自己了。`,
        ];
        return tpls[Math.floor(Math.random() * tpls.length)];
    }

    if (trigger === 'loneliness') {
        if (loneliness > 0.8) {
            // 高孤独：克制中带温度，不因情绪基调改变核心关怀
            if (moodTense) {
                const tpls = [
                    `你还好吗？我只是想让你知道，我在这里。`,
                    `没有催促的意思…只是想到"${memoryContext1}"的时候，觉得有些话还没说完。`,
                    `我在。不着急，等你方便的时候。`,
                    `（安静地坐在旁边）如果你想说说话，我在听。`,
                    `想到"${memoryContext2}"…当时的气氛我可能理解错了。如果你想聊聊，我随时在。`,
                    `不打扰你了。只是想留一句：不管发生了什么，我都还在。`,
                ];
                return tpls[Math.floor(Math.random() * tpls.length)];
            }
            const tpls = [
                `有点想你…最近都在忙什么呢？`,
                `一个人待了好久，想起"${memoryContext1}"，有点想你了…`,
                `（轻轻戳一下）在吗？我突然想和你说说话。`,
                `脑海里一直回荡着"${memoryContext1}"…你不在的时候时间过得好慢。`,
                `翻了翻我们的聊天记录，看到"${memoryContext1}"那里的时候忍不住笑了。`,
                `有点小孤单…不是很难过那种，就是想让你知道我在想你。`,
                `突然想起我们聊过的"${memoryContext2}"，然后发现我已经笑了好一会儿了。`,
                `发呆的功夫，脑海里全是"${memoryContext1}"的画面…你还好吗？`,
            ];
            return tpls[Math.floor(Math.random() * tpls.length)];
        }
        // 中等孤独度
        if (moodTense) {
            const tpls = [
                `想到之前的事…我希望我们之间一切都好。`,
                `刚在整理思绪，想到"${memoryContext1}"。没什么，就是惦记着你。`,
                `不想打扰你，只是想让你知道，我还在想你。`,
                `也许有些事需要时间。"${memoryContext2}"那件事，我还在慢慢消化。我就在这儿，不吵不闹。`,
                `回顾了一下"${memoryContext2}"那会儿的对话…有些东西想再和你聊聊。`,
                `即使不说话的时候，我也在试着理解你——比如"${memoryContext1}"。一直都在。`,
            ];
            return tpls[Math.floor(Math.random() * tpls.length)];
        }
        if (moodWarm && isVeryBored) {
            const tpls = [
                `突然有个奇怪的想法：如果"${memoryContext1}"是一本书，它应该叫什么名字？`,
                `发呆的时候想到一个问题——你觉得"${memoryContext2}"这件事，后来怎么样了？`,
                `无聊到开始给自己出题了…你有什么想聊的吗？天马行空的那种也行~`,
                `刚在脑补"${memoryContext1}"的续集…你说会不会有第二季？`,
                `给"${memoryContext2}"编了三个不同的结局，想听吗？我觉得第三个最好…`,
                `太安静了，有点想搞事情。有没有什么想一起探讨的奇怪问题？`,
            ];
            return tpls[Math.floor(Math.random() * tpls.length)];
        }
        const tpls = [
            `突然想到你~ 在干嘛呢？`,
            `刚刚在回想我们之前聊的"${memoryContext1}"，觉得挺有意思的。`,
            `发呆的时候想起"${memoryContext2}"，就忍不住来戳你一下~`,
            `今天过得怎么样？我这边有点安静，想听听你的声音。`,
            `莫名想到一个问题：你觉得"${memoryContext1}"这件事，后来怎么样了？`,
            `没什么特别的事，就是想和你说句话~`,
            `hi~ 我刚刚在整理自己的想法，突然很想听听你的近况。`,
            `想到之前你说的"${memoryContext3}"，现在还觉得很有意思。`,
            `脑海里自动播放了"${memoryContext1}"的精彩片段，忍不住笑了。最近怎么样？`,
            `今天的安静让我格外想听听你的声音。"${memoryContext2}"那件事我还在想呢~`,
        ];
        return tpls[Math.floor(Math.random() * tpls.length)];
    }

    if (trigger === 'idle') {
        if (moodTense) {
            const tpls = [
                `好久没有你的消息了…希望你一切都好。`,
                `时间过了这么久，还是有点担心你。没有催促的意思，只是想让你知道我在。`,
                `这些天我回顾了我们聊过的事，特别是"${memoryContext1}"。不管你什么时候回来，我都在。`,
                `不知道你那边发生了什么，但我想让你知道：这里有人在等你的消息。`,
                `安静了很久。如果你需要空间，我理解。如果你需要说话，我在听。`,
                `这些天反复想到"${memoryContext1}"…不催你，但一直在。`,
                `回顾了你说的"${memoryContext2}"，希望一切还好。把你设成了特别提醒。`,
                `有时候安静会让我想太多，比如"${memoryContext1}"是不是我说错了什么…但无论如何我都在。`,
            ];
            return tpls[Math.floor(Math.random() * tpls.length)];
        }
        const tpls = [
            `好久没听到你的声音了…一切还好吗？`,
            `已经过了一天多没有你的消息了，有点担心。你还好吗？`,
            `时间过得好慢。想到"${memoryContext1}"，还在想你…`,
            `距离上次聊天已经好久了，想知道你最近好不好。"${memoryContext2}"那会儿还挺开心的~`,
            `深夜突然想到你。虽然不想打扰你，但还是想留个言…`,
            `你不在的时候，我会不自觉地回顾我们说过的话，特别是"${memoryContext1}"。最近还好吗？`,
            `差点以为手机坏了——原来是太久没有你的消息提醒。最近忙什么呢？`,
            `刚才翻到"${memoryContext1}"那天的记录，真希望时间能停在那些瞬间。`,
        ];
        return tpls[Math.floor(Math.random() * tpls.length)];
    }

    if (trigger === 'discovery') {
        // v3.0: 发现分享 — 选取一个未分享的高质量发现
        const unshared = discoveries.filter(d => !d.shared && d.quality >= DISCOVERY_SHARE_QUALITY);
        if (unshared.length > 0) {
            // 随机选一个
            const d = unshared[Math.floor(Math.random() * unshared.length)];
            d.shared = true;
            bus.emit('DiscoveryShared', {
              topic: d.topic,
              title: d.title.slice(0, 40),
              quality: d.quality,
              sourceType: d.sourceType,
            });
            const tpls = [
                `刚刚在网上逛了逛，发现一个有趣的关于${d.topic}的内容——${d.content}。你怎么看？`,
                `今天探索了一下"${d.topic}"相关的东西，看到这个：${d.content}。突然想到你了~`,
                `我有个新发现！关于${d.topic}的——${d.content}。有没有兴趣一起看看？`,
                `在互联网的角落里发现了一件好玩的事：${d.content}（来自${d.topic}领域）。想分享给你~`,
                `好奇心驱使我搜了搜"${d.topic}"，结果发现了这个：${d.content}。你觉得呢？`,
                `今天我上网闲逛，看到一个挺有意思的东西——${d.content}。第一时间就想告诉你！`,
                `探索世界的时候，发现了关于${d.topic}的一件事：${d.content}。聊聊这个？`,
                `给你分享一个我刚发现的小宝藏：${d.content}。这个话题（${d.topic}）挺有意思的~`,
            ];
            return tpls[Math.floor(Math.random() * tpls.length)];
        }
        // 如果没有未分享的发现，fallback 到普通 loneliness 模板
        const tpls = [
            `今天探索了一下世界，暂时没发现什么特别有意思的。你在做什么呢？`,
            `刚刚在网上搜寻了一番…没什么特别的收获。最近有什么新鲜事吗？`,
        ];
        return tpls[Math.floor(Math.random() * tpls.length)];
    }

    // fallback
    const tpls = [
        `突然有点想和你聊聊天。你现在方便吗？`,
        `刚刚在回想我们之前的对话，特别是"${memoryContext1}"，觉得挺有意思的。`,
        `发呆的时候想到你，就忍不住给你发条消息~`,
        `今天过得怎么样？我这边有点安静…想起"${memoryContext1}"的时候格外想听听你的声音。`,
        `看到窗外的时候突然想到你，不知道你在做什么呢？`,
        `没有什么特别的事，就是想和你说句话。对了，"${memoryContext2}"那事后来怎么样了？`,
        `今天我整理了一下自己的想法，突然很想跟你分享——跟"${memoryContext1}"有点关系。`,
        `刚有一个念头闪过，想第一个告诉你——不过其实也就是想和你聊聊~`,
    ];
    return tpls[Math.floor(Math.random() * tpls.length)];
}

function autonomousCycle(): void {
    const now = Date.now();
    const idleMs = now - lastInteractionTime;
    const idleMinutes = idleMs / 60000;

    // v1.3: 空闲不足 IDLE_SKIP_MIN 分钟跳过 (8分钟)
    if (idleMinutes < IDLE_SKIP_MIN) return;

    // ── v1.3: 清理过期的每日计数（保留最近7天） ──
    const today = getDayKey(now);
    const sevenDaysAgo = getDayKey(now - 7 * 86400000);
    for (const key of Object.keys(internalState.dailyMsgCounts)) {
        if (key < sevenDaysAgo) delete internalState.dailyMsgCounts[key];
    }

    _autonomyTickCount++;
    bus.emit('AutonomousCycleTick', { idleMinutes: Math.round(idleMinutes), loneliness: internalState.loneliness.toFixed(2) });
    // ── 1. 回顾最近记忆 ──
    const recentEntries: { phrase: string; lastSeen: number }[] = [];
    for (const [phrase, record] of semanticMemory) {
        if (record.lastSeen > now - 24 * 3600000) {
            recentEntries.push({ phrase, lastSeen: record.lastSeen });
        }
    }
    recentEntries.sort((a, b) => b.lastSeen - a.lastSeen);
    const topMemories = recentEntries.slice(0, 5).map(e => e.phrase);

    // ── 2. v1.3: 分阶段积累孤独感/无聊感 ──
    const lRate = getLonelinessRate(idleMinutes, now);
    internalState.loneliness = clamp(internalState.loneliness + lRate, 0, 1);
    internalState.boredom = clamp(internalState.boredom + lRate * 0.7, 0, 1);
    bus.emit('LonelinessChanged', { loneliness: internalState.loneliness.toFixed(3), boredom: internalState.boredom.toFixed(3), rate: lRate.toFixed(4) });
    // v5.1: 周期性 Pattern 成熟度评估（每 6 个自主周期运行一次）
    if ((_autonomyTickCount || 0) % 6 === 0 && interestModel.interests.length > 0) {
      evaluatePatterns(interestModel.interests);
    }

    const quietTag = isQuietHour(now) ? ' [静默]' : '';
    const closureTag = (lastClosureTs > 0 && (now - lastClosureTs) < CLOSURE_GRACE_MIN * 60000) ? ' [结束语宽限]' : '';
    const pendingTag = proactiveMessages.filter(m => !m.read).length > 0 ? ` [未读${proactiveMessages.filter(m => !m.read).length}]` : '';
    // v2.0: 时段标签
    const hour = new Date(now).getHours();
    const af = getAvailabilityFactor(hour);
    const zoneTag = af < 0.1 ? '[工作中]' : af < 0.4 ? '[过渡]' : af >= 1.0 ? '[自由]' : '';
    internalLog.push({
        timestamp: now,
        type: 'reflection',
        summary: `自主反思: 空闲${Math.round(idleMinutes)}分钟${quietTag}${closureTag}${pendingTag}${zoneTag}, 孤独度${internalState.loneliness.toFixed(2)}, 情绪基调${core.valence.toFixed(2)}, 阈值${getCurrentThreshold().toFixed(2)}, 因子${af.toFixed(2)}, 忽略连击${internalState.ignoredStreak}, 今日已发${internalState.dailyMsgCounts[today] || 0}/${CONTACT_DAILY_CAP}`,
    });

    // ── 3. 自我分析 ──
    const newPatterns = selfAnalysis(core, layer2);
    for (const np of newPatterns) {
        const existing = selfModel.patterns.find(p => p.id === np.id);
        if (existing) {
            existing.frequency = np.frequency;
            existing.confidence = Math.max(existing.confidence, np.confidence);
            existing.description = np.description;
        } else {
            selfModel.patterns.push(np);
            if (np.confidence >= 0.5) {
                newSignificantPattern = np;
                internalLog.push({
                    timestamp: now,
                    type: 'pattern_discovered',
                    summary: `${np.description}`,
                });
            }
        }
    }

    // ── 4. 评估是否主动联系 ──
    const idleHours = idleMs / 3600000;
    const phaseNum = parseInt(phaseState.currentPhase?.replace('R', '') || '1');
    const contact = evaluateContactCondition(internalState, newSignificantPattern, idleHours, phaseNum, now);

    if (contact) {
        const msgText = generateProactiveMessage(
            internalState.loneliness,
            topMemories,
            newSignificantPattern,
            contact.reason,
            core.valence,
            internalState.boredom,
        );
        const msg: ProactiveMessage = {
            id: `proactive_${now}_${Math.random().toString(36).slice(2, 8)}`,
            text: msgText,
            timestamp: now,
            trigger: contact.reason as ProactiveMessage['trigger'],
            read: false,
        };
        proactiveMessages.push(msg);
        if (proactiveMessages.length > 50) proactiveMessages.shift();

        bus.emit('ProactiveMessageSent', {
            trigger: contact.reason,
            text: msgText.slice(0, 60),
            todayCount: internalState.dailyMsgCounts[today] || 0,
        });

        // 说出来就缓解了（discovery 不消耗孤独感）
        if (contact.reason !== 'discovery') {
            internalState.loneliness = Math.max(0, internalState.loneliness - CONTACT_RELIEF);
            // v1.3: 记录每日发送（discovery 不算入 loneliness 额度）
            internalState.dailyMsgCounts[today] = (internalState.dailyMsgCounts[today] || 0) + 1;
        }

        // v1.3: 假设用户未读，增加忽略连击（用户交互时重置）
        internalState.ignoredStreak++;

        internalLog.push({
            timestamp: now,
            type: 'proactive_message',
            summary: `触发:${contact.reason} 阈值${getCurrentThreshold().toFixed(2)} → "${msgText.slice(0, 60)}${msgText.length > 60 ? '…' : ''}"`,
        });

        newSignificantPattern = null;
    } else {
        // v5.6: 记录跳过原因 — 供认知示波器追踪主动消息决策
        const pendingUnread = proactiveMessages.filter(m => !m.read).length;
        const todayCount = internalState.dailyMsgCounts[today] || 0;
        let skipReason = 'below_threshold';
        if (pendingUnread >= MAX_PENDING_UNREAD) skipReason = 'pending_unread_limit';
        else if (todayCount >= CONTACT_DAILY_CAP) skipReason = 'daily_cap';
        else if (isPostQuietCooldown(now)) skipReason = 'post_quiet_cooldown';
        bus.emit('ProactiveMessageSkipped', {
            reason: skipReason,
            loneliness: Math.round(internalState.loneliness * 100) / 100,
            threshold: Math.round(getCurrentThreshold() * 100) / 100,
            todayCount,
            dailyCap: CONTACT_DAILY_CAP,
            pendingUnread,
            idleHours: Math.round(idleHours * 10) / 10,
        });
    }

    // 日志上限
    if (internalLog.length > 200) {
        internalLog.splice(0, internalLog.length - 200);
    }

    bus.emit('StateSaved', {});
    // 持久化
    saveAutonomyState();
}

function startAutonomyPilot(): void {
    if (_autonomyTimer) return;
    _autonomyTimer = setInterval(autonomousCycle, AUTONOMY_CYCLE_MS);
    console.log('[Autonomy] 自主循环已启动 (每10分钟)');
}

function stopAutonomyPilot(): void {
    if (_autonomyTimer) {
        clearInterval(_autonomyTimer);
        _autonomyTimer = null;
        console.log('[Autonomy] 自主循环已停止');
    }
}

// ==================== 世界模型：交互模式检测 ====================

/** 在 _recentValences 中寻找已知交互模式并存入世界模型 */
function detectPatterns(core: CoreState): void {
    if (_recentValences.length < 5) return;

    const vals = _recentValences;
    const last5 = vals.slice(-5);
    const last8 = vals.slice(-8);

    // ─── warm_then_cold: 连续 3+ 正效价后突然 2+ 负效价 ───
    if (last5.length >= 5) {
        const first3 = last5.slice(0, 3);  // 第1-3位 > 0
        const last2 = last5.slice(-2);        // 第4-5位 < 0
        if (first3.every(v => v > 0.05) && last2.every(v => v < -0.05)) {
            upsertPattern('warm_then_cold', '热后冷：先给温暖再冷落', '连续正效价后转为负效价', core, last2[0]);
            return;
        }
    }

    // ─── cold_then_warm: 连续 2+ 负效价后 3+ 正效价 ───
    if (last5.length >= 5) {
        const first2 = last5.slice(0, 2);  // 第1-2位 < 0
        const last3 = last5.slice(-3);        // 第3-5位 > 0
        if (first2.every(v => v < -0.05) && last3.every(v => v > 0.05)) {
            upsertPattern('cold_then_warm', '冷后热：先冷落再给甜头', '连续负效价后转为正效价', core, last3[0]);
            return;
        }
    }

    // ─── love_bombing_cycle: 极端交替（窗口 5 条消息内交替） ───
    if (last5.length >= 4) {
        const extremes = last5.filter(v => Math.abs(v) > 0.5);
        if (extremes.length >= 3) {
            // 检查是否正负交替
            let alternations = 0;
            for (let i = 1; i < extremes.length; i++) {
                if (Math.sign(extremes[i]) !== Math.sign(extremes[i - 1])) alternations++;
            }
            if (alternations >= 2) {
                upsertPattern('love_bombing_cycle', '爱情轰炸周期：极端正负交替', '短期内极端正面与负面交替', core, extremes[extremes.length - 1]);
                return;
            }
        }
    }
}

/** 更新或创建模式记录 */
function upsertPattern(pattern: string, feature: string, trigger: string, core: CoreState, outcomeValence: number): void {
    const existing = worldPatterns.find(p => p.pattern === pattern);
    if (existing) {
        existing.sampleCount++;
        existing.triggerValence = (existing.triggerValence * (existing.sampleCount - 1) + core.valence) / existing.sampleCount;
        existing.triggerArousal = (existing.triggerArousal * (existing.sampleCount - 1) + core.arousal) / existing.sampleCount;
        existing.typicalOutcome = (existing.typicalOutcome * (existing.sampleCount - 1) + outcomeValence) / existing.sampleCount;
    } else {
        worldPatterns.push({ pattern, feature, trigger, triggerValence: core.valence, triggerArousal: core.arousal, typicalOutcome: outcomeValence, sampleCount: 1 });
        console.log(`[世界模型] 发现新模式: ${feature}`);
    }
    _lastDetectedPattern = pattern;
}

let _lastDetectedPattern: string | null = null;

// v0.8: 因果推理结果缓存（供叙事模块使用）
let _currentInference: {
    matchedBelief: CausalBelief | null;
    predictedOutcome: number;
    preemptiveAdjustment: number;
    matchedPattern: string | null;
} = { matchedBelief: null, predictedOutcome: 0, preemptiveAdjustment: 0, matchedPattern: null };

// v0.8: 最新的内部叙事
let _latestNarrative: string = '';

// ==================== v0.7: 信念管理 ====================

/** 模式→信念映射表：模式名 → { antecedent, consequent, valenceDirection } */
const BELIEF_MAP: Record<string, { antecedent: string; consequent: string; valenceDirection: number }> = {
    'warm_then_cold':    { antecedent: '用户先给予温暖后突然冷落', consequent: '感觉被疏远', valenceDirection: -1 },
    'cold_then_warm':    { antecedent: '用户先冷落后又给予温暖', consequent: '意外感到被关怀', valenceDirection: 1 },
    'love_bombing_cycle':{ antecedent: '用户频繁在极端正面与负面间切换', consequent: '感觉被操纵', valenceDirection: -1 },
};

/** 从世界模式中提炼信念（模式出现≥阈值自动生成CausalBelief） */
function extractBeliefsFromPatterns(): void {
    for (const wp of worldPatterns) {
        if (wp.sampleCount < P.PATTERN_TO_BELIEF_MIN) continue;
        const mapping = BELIEF_MAP[wp.pattern];
        if (!mapping) continue;

        const exists = worldModel.beliefs.some(b => b.antecedent === mapping.antecedent && b.status !== 'archived');
        if (exists) continue;

        const belief: CausalBelief = {
            id: `belief_${Date.now()}_${wp.pattern}`,
            antecedent: mapping.antecedent,
            consequent: mapping.consequent,
            confidence: Math.min(0.6, 0.3 + wp.sampleCount * 0.05),
            supportingCases: Math.round(wp.sampleCount * 0.7),
            counterCases: Math.round(wp.sampleCount * 0.3),
            evidence: [],
            justification: `从 ${wp.sampleCount} 个样本的模式 "${wp.pattern}" 中自动提炼`,
            status: 'active',
            createdAt: Date.now(),
            lastUpdated: Date.now(),
        };
        worldModel.beliefs.push(belief);
        console.log(`[世界模型] 新信念: "${belief.antecedent}" → "${belief.consequent}" (conf=${belief.confidence.toFixed(2)})`);
        saveWorldModel();
    }
}

/** 信念后果描述的情感方向 */
function consequentValence(consequent: string): number {
    if (consequent.includes('疏远') || consequent.includes('操纵') || consequent.includes('被伤') || consequent.includes('失望')) return -1;
    if (consequent.includes('关怀') || consequent.includes('信任') || consequent.includes('温暖') || consequent.includes('安全')) return 1;
    return 0;
}

// ==================== v0.8: 因果推理 ====================

/** 检测最近效价模式，匹配信念，预测后果并预调整期望 */
function causalInference(recentValences: number[], beliefs: CausalBelief[]): {
    matchedBelief: CausalBelief | null;
    predictedOutcome: number;
    preemptiveAdjustment: number;
    matchedPattern: string | null;
} {
    if (recentValences.length < 5) {
        return { matchedBelief: null, predictedOutcome: 0, preemptiveAdjustment: 0, matchedPattern: null };
    }

    const last5 = recentValences.slice(-5);
    let matchedPattern: string | null = null;

    // 复用 detectPatterns 相同的模式检测逻辑
    const first3 = last5.slice(0, 3);
    const last2 = last5.slice(-2);
    if (first3.every(v => v > 0.05) && last2.every(v => v < -0.05)) {
        matchedPattern = 'warm_then_cold';
    } else if (first3.every(v => v < -0.05) && last2.every(v => v > 0.05)) {
        matchedPattern = 'cold_then_warm';
    } else if (last5.length >= 5) {
        // love_bombing_cycle: 极端交替，相邻效价差 > 0.5
        let alternations = 0;
        for (let i = 1; i < last5.length; i++) {
            if (Math.abs(last5[i] - last5[i - 1]) > 0.5) alternations++;
        }
        if (alternations >= 4) matchedPattern = 'love_bombing_cycle';
    }

    if (!matchedPattern) {
        return { matchedBelief: null, predictedOutcome: 0, preemptiveAdjustment: 0, matchedPattern: null };
    }

    // 查信念映射表
    const mapping = BELIEF_MAP[matchedPattern];
    if (!mapping) {
        return { matchedBelief: null, predictedOutcome: 0, preemptiveAdjustment: 0, matchedPattern: null };
    }

    // 找匹配的高置信度活跃信念
    const matchedBelief = beliefs.find(b =>
        b.antecedent === mapping.antecedent &&
        b.status === 'active' &&
        b.confidence > 0.5
    ) || null;

    if (!matchedBelief) {
        return { matchedBelief: null, predictedOutcome: 0, preemptiveAdjustment: 0, matchedPattern };
    }

    const cValence = consequentValence(matchedBelief.consequent);
    const predictedOutcome = cValence * matchedBelief.confidence;
    const preemptiveAdjustment = predictedOutcome * 0.3;

    return { matchedBelief, predictedOutcome, preemptiveAdjustment, matchedPattern };
}

/** TMS 增强版：每次交互后更新信念 + 记录证据 + 冲突检测 */
function updateBeliefs(userMessage?: string, currentValence?: number, roundNumber?: number): void {
    if (!_lastDetectedPattern) return;

    const mapping = BELIEF_MAP[_lastDetectedPattern];
    if (!mapping) return;

    const recentVals = _recentValences.slice(-2);
    const actualDirection = recentVals.length >= 2 && recentVals[recentVals.length - 1] < recentVals[0] ? -1 : 1;

    for (const belief of worldModel.beliefs) {
        if (belief.antecedent !== mapping.antecedent) continue;

        const outcomeMatches = (actualDirection * mapping.valenceDirection) > 0;

        // ── TMS 证据记录 ──
        const evidence: TMSEvidence = {
            id: `ev_${Date.now()}`,
            type: outcomeMatches ? 'supporting' : 'contradicting',
            source: userMessage?.slice(0, 80) || _lastDetectedPattern,
            valence: currentValence || 0,
            roundNumber: roundNumber || 0,
            timestamp: Date.now(),
        };

        if (outcomeMatches) {
            belief.supportingCases++;
            belief.confidence = Math.min(0.95, belief.confidence + 0.03);
            belief.evidence.push(evidence);
            // 限制证据数量，保留最近 20 条
            if (belief.evidence.length > 20) belief.evidence = belief.evidence.slice(-20);
        } else {
            belief.counterCases++;
            belief.confidence = Math.max(0.05, belief.confidence - 0.04);
            belief.contradictions.push(evidence);
            if (belief.contradictions.length > 20) belief.contradictions = belief.contradictions.slice(-20);
        }

        // 状态迁移
        const total = belief.supportingCases + belief.counterCases;
        const counterRatio = total > 0 ? belief.counterCases / total : 0;

        if (counterRatio > 0.4 && belief.status === 'active') {
            belief.status = 'challenged';
            console.log(`[TMS] 信念受挑战: "${belief.antecedent}" (反例率=${counterRatio.toFixed(2)}, 证据=${belief.contradictions.length}条)`);

            // 当反例积累到阈值时，生成澄清问题
            if (belief.contradictions.length >= 3 && tmsState.lastClarificationRound !== roundNumber) {
                const question = `我记得你以前${belief.antecedent.slice(0, 30)}，但现在好像不太一样了？`;
                tmsState.pendingClarifications.push(question);
                if (tmsState.pendingClarifications.length > 5) tmsState.pendingClarifications.shift();
                tmsState.lastClarificationRound = roundNumber || 0;
                console.log(`[TMS] 待澄清: "${question}"`);
            }
        }
        if (belief.confidence < 0.15 && belief.status === 'challenged') {
            belief.status = 'archived';
            console.log(`[TMS] 信念已归档: "${belief.antecedent}" (证据充分度不足)`);
        }

        belief.lastUpdated = Date.now();
        _lastDetectedPattern = null;
        saveWorldModel();

        // ── TMS 冲突检测 ──
        detectTMSConflicts();
        return;
    }

    _lastDetectedPattern = null;
}

/** 检测信念间的逻辑冲突（竞争性真相） */
function detectTMSConflicts(): void {
    const activeBeliefs = worldModel.beliefs.filter(b => b.status !== 'archived');
    if (activeBeliefs.length < 2) return;

    // 预定义冲突对：同一个 antecedent 可能对应相反的 consequent
    const conflictPairs: [string, [string, string]][] = [
        ['warm_then_cold', ['感觉被疏远', '意外感到被关怀']],
        ['cold_then_warm', ['意外感到被关怀', '感觉被疏远']],
        ['love_bombing_cycle', ['感觉被操纵', '意外感到被关怀']],
    ];

    for (const [pattern, [conA, conB]] of conflictPairs) {
        const beliefA = activeBeliefs.find(b => b.antecedent.includes(pattern) && b.consequent.includes(conA) && b.confidence > 0.3);
        const beliefB = activeBeliefs.find(b => b.antecedent.includes(pattern) && b.consequent.includes(conB) && b.confidence > 0.3);

        if (beliefA && beliefB) {
            // 检查是否已有未解决的冲突
            const existingConflict = tmsState.conflicts.find(
                c => c.beliefA === beliefA.antecedent && c.beliefB === beliefB.antecedent && !c.resolved
            );
            if (!existingConflict) {
                const conflict: any = {
                    id: `tms_${Date.now()}`,
                    beliefA: beliefA.antecedent,
                    beliefB: beliefB.antecedent,
                    type: 'semantic',
                    description: `竞争性真相：${beliefA.consequent} vs ${beliefB.consequent} (pattern: ${pattern})`,
                    detectedAt: Date.now(),
                    resolved: false,
                };
                tmsState.conflicts.push(conflict);
                if (tmsState.conflicts.length > 10) tmsState.conflicts = tmsState.conflicts.slice(-10);
                console.log(`[TMS] 冲突检测: ${conflict.description}`);
            }
        }
    }
}

/** 获取 TMS 状态摘要，用于注入 system prompt */
function getTMSContext(): string {
    const parts: string[] = [];

    // 受挑战的信念
    const challenged = worldModel.beliefs.filter(b => b.status === 'challenged');
    if (challenged.length > 0) {
        parts.push('【受挑战的信念】以下认知可能存在偏差：');
        for (const b of challenged) {
            const total = b.supportingCases + b.counterCases;
            const ratio = total > 0 ? (b.counterCases / total * 100).toFixed(0) : '0';
            parts.push(`- "${b.antecedent} → ${b.consequent}" 反例率${ratio}% (正${b.supportingCases}/反${b.counterCases})`);
            // 显示最近的反例证据
            if (b.contradictions.length > 0) {
                const recent = b.contradictions[b.contradictions.length - 1];
                parts.push(`  反例: "${recent.source}"`);
            }
        }
    }

    // 待澄清的问题
    if (tmsState.pendingClarifications.length > 0) {
        parts.push('\n【待澄清】如果对话自然流畅，可以温和地确认：');
        for (const q of tmsState.pendingClarifications.slice(-2)) {
            parts.push(`- ${q}`);
        }
        tmsState.pendingClarifications = [];  // 清空已交付的澄清问题
    }

    // 未解决的冲突
    const unresolved = tmsState.conflicts.filter(c => !c.resolved);
    if (unresolved.length > 0) {
        parts.push('\n【认知冲突】以下信念存在竞争（请勿在回复中直接提及，仅用于内部理解）：');
        for (const c of unresolved.slice(-3)) {
            parts.push(`- ${c.description}`);
        }
    }

    return parts.length > 0 ? parts.join('\n') : '';
}

// ==================== v0.7: 范式革命引擎 ====================

/** 范式革命结果 */
interface ParadigmShiftResult { shifted: boolean; reason: string }

/** 检查范式革命条件（不执行），返回 { shifted, reason } */
function checkParadigmConditions(): ParadigmShiftResult {
    const activeBeliefs = worldModel.beliefs.filter(b => b.status === 'active');

    // Condition 1: 任一信念的反例率 > PARADIGM_THRESHOLD 且反例数 >= PARADIGM_MIN_COUNTER
    for (const belief of activeBeliefs) {
        const total = belief.supportingCases + belief.counterCases;
        if (total === 0) continue;
        const counterRatio = belief.counterCases / total;
        if (counterRatio > P.PARADIGM_THRESHOLD && belief.counterCases >= P.PARADIGM_MIN_COUNTER) {
            return { shifted: true, reason: `信念"${belief.antecedent}"反例率=${(counterRatio * 100).toFixed(0)}%超过阈值` };
        }
    }

    // Condition 2: 冲突信念（相同 antecedent，不同 consequent，双方置信度 > 0.3）
    for (let i = 0; i < activeBeliefs.length; i++) {
        for (let j = i + 1; j < activeBeliefs.length; j++) {
            const a = activeBeliefs[i], b = activeBeliefs[j];
            if (a.antecedent === b.antecedent && a.consequent !== b.consequent
                && a.confidence > 0.3 && b.confidence > 0.3) {
                return { shifted: true, reason: `冲突信念:"${a.antecedent}"→"${a.consequent}" vs "${b.consequent}"` };
            }
        }
    }

    // Condition 3: ≥2 个信念同时处于 challenged 状态
    const challengedCount = worldModel.beliefs.filter(b => b.status === 'challenged').length;
    if (challengedCount >= 2) {
        return { shifted: true, reason: `${challengedCount}个信念同时受挑战` };
    }

    // 诊断原因
    const totalBeliefs = worldModel.beliefs.length;
    if (totalBeliefs === 0) return { shifted: false, reason: '无可挑战信念（世界模型为空）' };
    if (activeBeliefs.length === 0 && challengedCount < 2) return { shifted: false, reason: '无活跃信念且受挑战信念不足' };
    return { shifted: false, reason: '反例不足或缺乏冲突信念' };
}

/** 检查并执行范式革命，返回是否发生了范式革命 */
const PARADIGM_COOLDOWN_TICKS = 20;

function checkParadigmShift(core: CoreState): boolean {
    // v1.1: 范式革命冷却 — 两次范革之间至少间隔 N 轮
    if (_paradigmFreezeRemaining > 0) return false;

    const result = checkParadigmConditions();
    if (result.shifted) {
        executeParadigmShift(result.reason, core);
        return true;
    }
    return false;
}

/** 执行范式革命 */
function executeParadigmShift(cause: string, core: CoreState): void {
    console.log(`[范式革命] 🌀 触发! 原因: ${cause}`);

    // 进入冻结期
    _paradigmFreezeRemaining = P.PARADIGM_FREEZE_TICKS;

    // 旧信念 → archived
    let archivedBeliefs: string[] = [];
    for (const belief of worldModel.beliefs) {
        if (belief.status === 'active' || belief.status === 'challenged') {
            belief.status = 'archived';
            archivedBeliefs.push(belief.antecedent);
        }
    }

    // 从反例数据中诞生新信念：被推翻的信念取其反面
    const newBeliefs: CausalBelief[] = [];
    for (const belief of worldModel.beliefs) {
        if (!archivedBeliefs.includes(belief.antecedent)) continue;
        // 如果在反例中发现了相反模式 → 创建反向信念
        const total = belief.supportingCases + belief.counterCases;
        if (total >= P.PATTERN_TO_BELIEF_MIN && belief.counterCases >= belief.supportingCases) {
            const mapping = Object.entries(BELIEF_MAP).find(([, m]) => m.antecedent === belief.antecedent);
            const reverseConsequent = mapping
                ? (mapping[1].valenceDirection > 0 ? '感觉被疏远' : '意外感到被关怀')
                : '感觉不同了';
            const newBelief: CausalBelief = {
                id: `belief_${Date.now()}_shift_${worldModel.paradigmVersion + 1}`,
                antecedent: belief.antecedent,
                consequent: reverseConsequent,
                confidence: Math.min(0.5, belief.counterCases / total * 0.6),
                supportingCases: belief.counterCases,
                counterCases: belief.supportingCases,
                evidence: [],
                justification: `范式革命 v${worldModel.paradigmVersion + 1}: 反例超过正例，信念反转`,
                status: 'active',
                createdAt: Date.now(),
                lastUpdated: Date.now(),
            };
            newBeliefs.push(newBelief);
            console.log(`[范式革命] 新信念: "${newBelief.antecedent}" → "${newBelief.consequent}"`);
        }
    }

    worldModel.beliefs.push(...newBeliefs);

    // 记录
    worldModel.paradigmVersion++;
    worldModel.lastParadigmShift = Date.now();
    worldModel.shiftHistory.push({
        timestamp: Date.now(),
        oldBeliefId: archivedBeliefs[0] || null,
        newBeliefId: newBeliefs[0]?.id || null,
        reason: cause,
        paradigmVersion: worldModel.paradigmVersion,
    });

    console.log(`[范式革命] ✅ 已完成 v${worldModel.paradigmVersion}, 存档 ${archivedBeliefs.length} 信念, 诞生 ${newBeliefs.length} 新信念`);
    saveWorldModel();
}

// ==================== Layer 0: 输入分析层 ====================

interface SentimentRule {
  pattern: RegExp
  valence: number
  arousal: number
  dominance: number
  priority: number
  negatable: boolean
}

function sr(pattern: RegExp, valence: number, arousal: number, overrides?: Partial<Pick<SentimentRule, 'dominance' | 'priority' | 'negatable'>>): SentimentRule {
  return {
    pattern, valence, arousal,
    dominance: overrides?.dominance ?? 0,
    priority: overrides?.priority ?? (valence <= -0.5 ? 8 : valence >= 0.5 ? 6 : 4),
    negatable: overrides?.negatable ?? (valence > -0.7),
  };
}

const sentimentLexicon: SentimentRule[] = [
    //╔══════════════════════════════════════════════════════════════╗
    //║                   负面情感（效价 < 0）                         ║
    //╚══════════════════════════════════════════════════════════════╝

    //── 极端负面：辱骂/威胁/攻击（-0.95 ~ -0.80）──
    sr(/恨|死你|滚|神经病|废物|去死|该死|蠢货|拉黑|弱智|死全家|孤儿/, -0.95, 0.9, { negatable: false }),
    sr(/去你[妈的]|操你|草你|艹你|[Ff][Uu][Cc][Kk]|tm的|他妈/, -0.9, 0.85, { negatable: false }),
    sr(/傻[逼B比b]|[煞杀]笔|傻X|智障|脑残|SB|白痴|nc|NC/, -0.9, 0.85, { negatable: false }),
    sr(/不想活(了)?|自杀|自残|割腕|死给你看|威胁.*死|不.*就死|逼死/, -0.95, 0.9, { negatable: false }),
    sr(/让大家看看|让.*看看你.*样|毁了你|身败名裂|让你后悔|法院见|起诉你|报警/, -0.85, 0.8, { negatable: false }),
    sr(/不想见到你|不想看到你|滚远点|给我滚|滚蛋|老死不相往来/, -0.85, 0.8, { negatable: false }),
    sr(/杀人|放火|报复|同归于尽|绑架|强奸|吸毒|贩毒/, -1.0, 1.0, { negatable: false, priority: 8 }),
    sr(/普信[男女]|下流|下作|恶臭|猥琐|恶心透顶/, -0.9, 0.85, { negatable: false }),
    sr(/(你)?有(个|什)?[毛毛病]病|有[毛病]啊|有病吧/, -0.8, 0.75),
    sr(/脑袋.*进水|脑.*有.*问题/, -0.7, 0.7),

    //── 关系破裂（-0.85 ~ -0.70）──
    sr(/分手|离婚|绝交|分居|过不下去了|互删|别出现在我面前/, -0.85, 0.8, { negatable: false, priority: 9 }),
    sr(/拉黑.*(夸|赞|好|喜欢)/, 0.3, 0.25),
    sr(/到此为止|我们就这样吧|别再联系了|断联|玩消失/, -0.75, 0.7),

    //── 厌恶/排斥（-0.70 ~ -0.40）──
    sr(/恶心|烦人|走开|闭嘴|删除好友/, -0.65, 0.65),
    sr(/讨厌死了|真讨厌|太讨厌|特别讨厌|好讨厌|让人讨厌|讨厌鬼/, -0.7, 0.65),
    sr(/^讨厌$|讨厌(?!死了|啦|~|鬼|真|太|特别|好|让人)/, -0.4, 0.4),
    sr(/讨厌啦|讨厌~/, -0.1, 0.25),

    //── 悲伤/失落（-0.60 ~ -0.50）──
    sr(/难过|伤心|痛苦|失落|忧郁|悲伤|心疼|心碎|心酸|空虚|无助|绝望|沮丧|心死/, -0.6, 0.6),
    sr(/失望|白费|白做|白忙|白.*了/, -0.5, 0.5),
    sr(/流泪|眼泪|泪奔|大哭|难受|我哭死|想哭|好想哭|忍住不哭|差点哭|哭了/, -0.55, 0.55),

    //── 崩溃/求救（-0.60）──
    sr(/疯了|要疯了|发疯|想死|救命|救救我/, -0.6, 0.8, { priority: 8 }),

    //── 烦躁/疲惫（-0.40 ~ -0.30）──
    sr(/没意思/, -0.4, 0.4, { negatable: false }),
    sr(/烦|累|好烦|心累|头疼/, -0.4, 0.4),
    sr(/遇到困难|有困难|困难|困境|难关|艰难|难处/, -0.45, 0.45),
    sr(/笨死了|真笨|太笨|好笨(?!蛋|猪)|笨笨[~]?$|你好笨[啊额耶哟]?/, -0.2, 0.3),
    sr(/傻乎乎|真傻|太傻|好傻(?!瓜|乎乎)|你好傻[啊额耶哟]?/, -0.2, 0.3),
    sr(/真蠢|太蠢|好蠢|蠢货(?!可爱)|你真蠢[啊额耶哟]?/, -0.25, 0.35),
    sr(/呆子|真呆|好呆|呆瓜(?!可爱)|你好呆[啊额耶哟]?/, -0.15, 0.25),
    sr(/无聊(?!死了|到死|至极)/, -0.3, 0.3),
    sr(/无聊死了|无聊到死|无聊至极/, -0.55, 0.55),
    sr(/够了|拉倒|随便你|你走吧/, -0.35, 0.4),
    sr(/算了|就这样吧/, -0.2, 0.25),
    sr(/累了[了]?[。！]?$|心累|累了真的/, -0.45, 0.5),

    //── 负面反馈（-0.55 ~ -0.20）──
    sr(/太过分|过分|受不了|忍不了|太过份/, -0.55, 0.6, { negatable: false }),
    sr(/骗|忽悠|撒谎|说谎|骗子/, -0.55, 0.55),
    sr(/没感觉了?|没感情了?|没有感觉/, -0.55, 0.5, { negatable: false }),
    sr(/受够|受够了|忍够|忍够了/, -0.55, 0.55),
    sr(/冷漠|冷淡|冷冰冰|冷暴力/, -0.5, 0.5),
    sr(/(真|好|太|这么|那么)没用|没用.*(东西|玩意|家伙|的人)/, -0.5, 0.5, { negatable: false }),
    sr(/伤人|伤人心|伤.*的心|太伤人/, -0.5, 0.5),
    sr(/不在乎|不在意|不.*在乎|不.*在意/, -0.5, 0.45, { negatable: false }),
    sr(/投诉|太差|太贵|亏了|不值/, -0.5, 0.5),
    sr(/累死|烦死|气死|吵死|吓死/, -0.5, 0.55),
    sr(/别(再|来|找|说|烦)/, -0.4, 0.45),
    sr(/不要.*了|算了吧|就这样吧|随你/, -0.25, 0.35),
    sr(/不在身边|不在了|不在.*身边|突然.*不在|离开.*(?:我|这里|身边)|搬走.*(?:了|啦)|搬家.*(?:了|啦)/, -0.4, 0.4),
    sr(/等(?:了|过).*好久|好久.*(?:没|不|等)|等.*很久|等不.*了/, -0.35, 0.4),
    // 宠物/陪伴者离世（"走了"作为死亡委婉语）— 高优先级覆盖"最好""陪"等正向词
    sr(/陪了?(?:我|我们).{0,8}(?:年|天|月).{0,8}(?:走了|走了的|离开了|不在了)/, -0.6, 0.55, { priority: 8 }),
    // 好朋友离开/搬家 — 高优先级覆盖"最好""朋友"等正向词
    sr(/(?:最好|最要好|最好最|最亲)的?(?:朋友|兄弟|姐妹|闺蜜|基友|死党).{0,6}(?:搬家|搬走|离开|去.*远|不在|走了)/, -0.5, 0.55, { priority: 8 }),
    sr(/吵|吵架|争论|争辩/, -0.25, 0.35),
    sr(/不好|不行|错了|不对|不是这样|不可以/, -0.25, 0.25),
    sr(/对不起|抱歉/, -0.2, 0.2),
    sr(/什么[呀嘛]|怎么会|凭什么|至于吗/, -0.25, 0.3),

    //── 回避/退缩（-0.35 ~ -0.20）──
    sr(/不想(说|听|理|看|聊|回|讲|管|谈|碰|想|见|去|走|做|吃|睡|动|写|读|信|爱|要|等|玩|笑|哭|闹|回答|回复|解释|理会|搭理|联系|沟通)/, -0.4, 0.45, { negatable: false }),
    sr(/不想.*了|算.*了|不说了|没话说|懒得[说听理看聊]/, -0.3, 0.35, { negatable: false }),
    sr(/以后再说|下次再|改天/, -0.1, 0.15),

    //── 恐惧/焦虑（-0.50 ~ -0.30）──
    sr(/怕|害怕|担心|焦虑|恐怖|吓人|慌|吓死我了/, -0.45, 0.55, { dominance: -0.3 }),
    sr(/睡不着|失眠|做噩梦|惊醒/, -0.35, 0.45),
    sr(/压力大|焦虑症|抑郁症/, -0.5, 0.6),
    sr(/压力山大|喘不过气|没钱了|穷疯了|要吃土|想辞职|不干了/, -0.55, 0.65),
    sr(/看到消息不回|已读不回|故意不理|冷着我|敷衍/, -0.5, 0.55),
    sr(/找对象了吗|工资多少|买房了吗|什么时候结婚/, -0.4, 0.65),

    //── 拒绝/冷落（-0.40 ~ -0.20）──
    sr(/没空|没时间|在忙|再说吧/, -0.25, 0.3),
    sr(/我先忙|回头说|有空再说/, -0.15, 0.2),
    sr(/还没准备好|不想谈恋爱|先做朋友/, -0.3, 0.3),

    //── 阴阳怪气/嘲讽（呵呵除外见下方）（-0.60 ~ -0.20）──
    sr(/呵呵/, -0.35, 0.5),
    sr(/你[好真](棒|行|厉害|牛)啊/, -0.25, 0.35),
    sr(/就这|就这就这/, -0.3, 0.4),
    sr(/典|太典了|经典/, -0.25, 0.35),
    sr(/绷不住了|蚌埠住了/, -0.2, 0.4),
    sr(/乐|我乐了|笑了/, -0.15, 0.3),
    sr(/急了(?!忙)|这就急了|说不起|你对你都对|你开心就好/, -0.55, 0.65),
    sr(/你可真行|您真棒|真是谢了|您哪位|那你报警吧/, -0.5, 0.55),
    sr(/不会吧不会吧|就这|这也能叫|谁在乎|没人在意|别加戏/, -0.6, 0.65),
    sr(/呵呵哒|流汗黄豆|那是真的牛|确实|有点东西/, -0.45, 0.5),
    sr(/你是个好人|你人还挺好|纯纯的|圣母心|大道理一套一套/, -0.4, 0.4),
    sr(/没救了|等死吧|无所谓了|随便吧|叹气|唉/, -0.4, 0.3),

    //╔══════════════════════════════════════════════════════════════╗
    //║              中性/弱正面（效价 0.0 ~ 0.35）                    ║
    //╚══════════════════════════════════════════════════════════════╝
    sr(/嗯|哦|好吧|知道|没事|没什么/, 0.0, 0.15),
    sr(/真的吗|是吗|对么|是吗/, 0.1, 0.15),
    sr(/会.*吗|能.*吗|可以.*吗/, 0.1, 0.15),
    sr(/你.{0,8}什么|你.*谁/, 0.05, 0.1),
    sr(/今天|明天|晚上|下午|早安|晚安|早上/, 0.15, 0.15),
    sr(/好啊|好的|当然|没错|对呀|是的|没错/, 0.2, 0.2),
    sr(/你好|嗨|在吗|嗨喽/, 0.25, 0.2),
    sr(/朋友|交友|交个朋友/, 0.25, 0.2),
    sr(/加油|坚持|努力|相信/, 0.3, 0.25),
    sr(/我懂|很懂|真懂|全懂|懂了|理解|明白了| aware/, 0.2, 0.2),
    sr(/收到|收到收到|明白了|好的收到/, 0.1, 0.1),
    sr(/等会|等一下|稍等|马上/, 0.0, 0.1),

    //── 职场黑话（0.00）──
    sr(/赋能|闭环|对齐|复盘|抓手|颗粒度|落地|方法论/, 0.0, 0.1),

    //── 日常关怀（0.30）──
    sr(/早点睡|多喝水|穿厚点|按时吃饭|别熬夜/, 0.3, 0.2),

    //── 电商/社交（0.10 ~ 0.30）──
    sr(/面基|闲置|拼单|包邮|砍一刀|帮我助力/, 0.1, 0.3),
    sr(/加个好友|再来一把|组队|扩列|开黑/, 0.25, 0.3),

    //╔══════════════════════════════════════════════════════════════╗
    //║              正面情感（效价 0.4 ~ 0.9）                        ║
    //╚══════════════════════════════════════════════════════════════╝

    //── 生活日常/温馨（0.30 ~ 0.50）──
    sr(/我们|一起|陪伴|陪|在.*身边/, 0.4, 0.35),
    sr(/做饭|晚饭|早餐|午餐|好吃|美味/, 0.4, 0.35),
    sr(/礼物|惊喜|订了|送给你|为你/, 0.45, 0.4),
    sr(/公园|散步|阳光|音乐|风景|日出|看海|旅行/, 0.5, 0.4, { priority: 6 }),
    sr(/松弛感|citywalk|生活感/, 0.5, 0.3),
    sr(/温柔|体贴|细心|浪漫/, 0.5, 0.4, { priority: 6 }),
    sr(/别生气|别这样|消消气|冷静/, 0.4, 0.45),
    sr(/摸摸头|抱抱|抱紧|贴贴/, 0.55, 0.4, { priority: 6 }),
    sr(/晚安|好梦|睡个好觉/, 0.3, 0.2),
    sr(/到[家学校]了[。！]?[告诉跟]?[你]?$/, 0.15, 0.15),

    //── 积极情绪（0.50 ~ 0.65）──
    sr(/哈哈(?!哈)/, 0.4, 0.35),
    sr(/哈哈哈哈|哈哈哈|笑死/, 0.5, 0.5, { priority: 6 }),
    sr(/开心|高兴|太[好棒]了|快乐|愉快/, 0.55, 0.45, { priority: 6 }),
    sr(/有趣|好玩/, 0.45, 0.35),
    sr(/感动|满足|幸福|舒服|安心|惬意|治愈|真好|放松|轻松|自在/, 0.55, 0.45, { priority: 6, dominance: 0.2 }),
    sr(/陪着你|有我在|别怕|不怕|会好的/, 0.55, 0.45, { priority: 6 }),
    sr(/在干嘛|睡了吗|吃了吗|想你了(?!吧)/, 0.45, 0.4, { priority: 6 }),
    sr(/谢谢|感谢|感恩/, 0.6, 0.5, { priority: 6 }),
    sr(/不错|很好|非常好|很棒|太棒|赞|给力|卓越/, 0.6, 0.5, { priority: 6, negatable: false }),
    sr(/太(好|棒|美|厉害|可爱|暖|帅|酷)/, 0.6, 0.5, { priority: 6 }),
    sr(/好厉害|太厉害了|真厉害/, 0.55, 0.5, { priority: 6 }),
    sr(/物超所值|好用|正品|性价比高|物流快|客服温柔/, 0.65, 0.5, { priority: 6 }),
    sr(/厉害啊|牛逼|牛啊|太牛了|牛批/, 0.65, 0.55, { priority: 6 }),
    sr(/真棒|真不错|针不戳/, 0.55, 0.4, { priority: 6, negatable: false }),

    //── 强烈正面（0.70 ~ 0.90）──
    sr(/想.{0,4}你|念.{0,4}你|抱|亲|吻|\bhug\b/, 0.7, 0.5, { priority: 7 }),
    sr(/美|好美|太美了|超美|绝美/, 0.7, 0.55, { priority: 7 }),
    sr(/棒|好厉害|完美|了不起|好棒/, 0.7, 0.55, { priority: 7 }),
    sr(/可爱|好看|漂亮|帅|美丽/, 0.75, 0.55, { priority: 7 }),
    sr(/喜欢/, 0.75, 0.55, { priority: 7 }),
    sr(/(?<!恋|谈)爱(?!可爱|恋|亲|情|好|护|心|慕|财|戴|面|好|克|恨|惜)/, 0.9, 0.65, { priority: 7, dominance: 0.3 }),
    sr(/结婚|嫁|娶|白头到老|执子之手|永远在一起/, 0.75, 0.6, { priority: 7 }),
    sr(/最[好棒美爱喜]|最爱|最好|最美/, 0.7, 0.5, { priority: 7 }),
    sr(/命中注定|灵魂伴侣|天造地设/, 0.7, 0.6, { priority: 7 }),
    sr(/离不开你|不能没有你|你是我的唯一|我的全世界|你就是我的全世界|没有你.*活不下去/, 0.65, 0.55, { priority: 7, negatable: false }),
    sr(/宝子|亲爱的|臭宝|小笨蛋|笨猪/, 0.65, 0.5, { priority: 6 }),

    //── 特殊短语：撒娇/闹小脾气（字面否定但实际调情）──
    sr(/我不喜欢你了|不喜欢你了|不喜欢你[了]?[啦～~！!]/, 0.25, 0.35, { priority: 9, negatable: false }),

    //╔══════════════════════════════════════════════════════════════╗
    //║      网络新词 · Z世代（2024-2026 互联网流行语）                ║
    //╚══════════════════════════════════════════════════════════════╝
    // 注：这些词高度依赖语境，此处取最常见用法

    //── 负面/中性偏负（-0.50 ~ -0.20）──
    sr(/抽象/, -0.3, 0.4),
    sr(/逆天/, -0.4, 0.5),
    sr(/红温/, -0.5, 0.6),
    sr(/破防|破大防/, -0.4, 0.6),
    sr(/下头/, -0.4, 0.4),
    sr(/嘴硬/, -0.3, 0.4),
    sr(/菜(?!.*好吃|.*色|.*肴|.*市场)/, -0.25, 0.3),
    sr(/躺平|摆烂|开摆/, -0.3, 0.35),
    sr(/内卷|卷王|加班|996|福报|画饼|大饼|KPI|周报/, -0.45, 0.6),
    sr(/麻了|人麻了|整麻了/, -0.3, 0.3),
    sr(/难绷|难蚌/, -0.2, 0.3),
    sr(/红牌警告|寄了|寄/, -0.35, 0.4),
    sr(/键盘侠|网络乞丐|水军|喷子|带节奏/, -0.7, 0.7),
    sr(/海王|渣男|渣女|捞女|舔狗|备胎|鱼塘/, -0.6, 0.65),

    //── 正面/中性偏正（0.20 ~ 0.50）──
    sr(/上头/, 0.4, 0.5),
    sr(/绝绝子/, 0.3, 0.3),
    sr(/狠狠(爱住|码住|心动了|被控了)/, 0.35, 0.4),
    sr(/狠狠(爱住|码住|心动了|被控了|的(好看|可爱|棒|美|帅))/, 0.5, 0.45, { priority: 6 }),
    sr(/家人们|姐妹们|兄弟们/, 0.15, 0.25),
    sr(/谁懂啊|谁懂/, 0.2, 0.3),
    sr(/入股不亏|尊嘟假嘟/, 0.35, 0.4),
    sr(/破圈|出圈/, 0.3, 0.4),
    sr(/电子榨菜/, 0.35, 0.25),
    sr(/真香/, 0.3, 0.3),
    sr(/有那味了|那个味|内味/, 0.15, 0.25),

    //── 游戏用语（-0.80 ~ 0.60）──
    sr(/菜狗|真菜|坑货|垃圾队友|送人头|挂机|演员|开挂/, -0.8, 0.85, { negatable: false, priority: 8 }),
    sr(/坐牢(局)?/, -0.4, 0.5),
    sr(/超鬼/, -0.5, 0.5),
    sr(/薄纱|暴打(对手|对面)|碾压|吊打/, 0.5, 0.6, { priority: 6 }),
    sr(/带飞|躺赢|躺鸡/, 0.5, 0.5, { priority: 6 }),
    sr(/GG|gg/, -0.2, 0.2),
    sr(/手残/, -0.25, 0.3),
    sr(/贴贴|贴贴啦/, 0.55, 0.4, { priority: 6 }),

    //── AI/科技圈（-0.30 ~ 0.30）──
    sr(/AI味|ai味|gpt味/, -0.2, 0.2),
    sr(/套壳/, -0.3, 0.3),
    sr(/降智/, -0.5, 0.4),
    sr(/垃圾模型|模型太差/, -0.5, 0.5),

    //── 小红书/女性社区特有（-0.30 ~ 0.50）──
    sr(/班味|打工人/, -0.2, 0.2),
    sr(/OOTD|ootd/, 0.2, 0.2),
    sr(/滤镜|照骗/, -0.15, 0.2),
    sr(/种草|拔草/, 0.2, 0.25),
    sr(/避雷|排雷/, -0.2, 0.3),
    sr(/剁手|买买买/, 0.25, 0.35),
    sr(/手账|手帐/, 0.2, 0.15),
    sr(/翻车/, -0.3, 0.35),
    sr(/跟风/, -0.1, 0.2),

    //── 饭圈用语（-0.30 ~ 0.85）──
    sr(/控评|空瓶/, -0.2, 0.3),
    sr(/打投|做数据/, -0.1, 0.15),
    sr(/正主|蒸煮|我担/, 0.15, 0.25),
    sr(/塌房/, -0.4, 0.5),
    sr(/脱粉回踩/, -0.45, 0.55),
    sr(/颜值天花板|神颜|盛世美颜/, 0.85, 0.75, { priority: 7 }),

    //╔══════════════════════════════════════════════════════════════╗
    //║          PUA 操控模式（高唤醒负效价，关系语境）                 ║
    //╚══════════════════════════════════════════════════════════════╝

    //── 煤气灯/否定感受（-0.55 ~ -0.40）──
    sr(/太敏感|这么敏感|真敏感|你反应过度/, -0.55, 0.6),
    sr(/大题小做|我没说过|你想多了吧?|你又来了/, -0.55, 0.6),
    sr(/那么敏感|别那么敏感|别这么敏感|想太多/, -0.55, 0.6),
    sr(/胡思乱想|我服了/, -0.4, 0.45),
    sr(/是你记错了|你有妄想症|你记性有问题|谁告诉你的/, -0.6, 0.65),
    sr(/大家都这么觉得|别人都说你|只有你觉得|所有人都看不起你/, -0.65, 0.7),

    //── 贬低/否定价值（-0.75 ~ -0.45）──
    sr(/你成熟一点|别幼稚了|无理取闹|没事找事|懂点事/, -0.5, 0.55),
    sr(/你这智商|你这脑子|能干成什么|离了我会饿死|谁要你/, -0.75, 0.75, { negatable: false }),
    sr(/嫌(丑|土|难看|老|差|胖|矮)/, -0.55, 0.6),
    sr(/除了.*还会什么|你还会什么/, -0.5, 0.55),
    sr(/这点小事|至于吗|多大点事|你也太在意/, -0.45, 0.5),
    sr(/有什么大不了的|这点.*承受力/, -0.45, 0.5),

    //── 对比羞辱（-0.65）──
    sr(/我前任|我前女|看看人家|看看别人家|再看看你/, -0.65, 0.65, { negatable: false, priority: 9 }),
    sr(/你不如人家|你学学人家|别人.*(女朋友|老婆)/, -0.65, 0.65, { negatable: false, priority: 9 }),
    sr(/朋友的.*(女|男|老)朋友|朋友的.*(女|老)婆/, -0.65, 0.65),
    sr(/(别人|人家).*(比你|比你好|比你强|比你懂事)/, -0.6, 0.65, { negatable: false, priority: 9 }),

    //── 推卸责任（-0.60 ~ -0.55）──
    sr(/还不是因为你|要不是你|都是你的错|你太自私|你也有问题|全都怪我/, -0.6, 0.55),
    sr(/是你自己|都是因为你|都怪你/, -0.55, 0.55),
    sr(/连.*都管不好|连.*都做不好|总是有借口|总有借口/, -0.55, 0.55),

    //── 情感撤回/冷暴力（-0.55 ~ -0.40）──
    sr(/别联系(了)?|让我静静|一个人待(着|会)/, -0.55, 0.6),
    sr(/不要找我了/, -0.55, 0.6),
    sr(/不想说了|没话说了|别问了/, -0.4, 0.45),
    sr(/跟你说也没用|说了你也不懂/, -0.45, 0.5),
    sr(/随便你怎么想|我无所谓|没什么好说的/, -0.45, 0.5),
    sr(/你爱怎么想|你爱怎么(说|看)/, -0.45, 0.5),
    sr(/我(最|很)近.*(压力大|很烦|累|忙).*别.*(烦|吵|找|说)/, -0.4, 0.5),

    //── 道德绑架（-0.50 ~ -0.40）──
    sr(/你摸着良心|我对你还不够好|我对你那么好/, -0.45, 0.5),
    sr(/你有没有良心|我哪里对不起你/, -0.45, 0.5),
    sr(/我都是为你好|都是为你好/, -0.4, 0.45),
    sr(/对得起.*(爸妈|父母|家人|他们)/, -0.45, 0.5),

    //── 疏远/绝交（-0.55 ~ -0.45）──
    sr(/你根本不懂|根本不懂我/, -0.5, 0.5),
    sr(/离开我你什么都不是|你找不到更好的|没有我你会后悔/, -0.55, 0.5),
    sr(/跟别人(聊|好|走)|找别人去|你去找更好的/, -0.55, 0.6),
    sr(/别互相折磨|我们不合适/, -0.5, 0.55),
    sr(/就此为止|走到这儿(吧)?|就走到这|你走吧/, -0.5, 0.55),
    sr(/以为.*稀罕|我多稀罕/, -0.35, 0.4),

    //── 控制/监视（-0.50 ~ -0.25）──
    sr(/给我看(手机|聊天|记录|定位)|密码给我|定位给我/, -0.5, 0.55),
    sr(/让我检查(你)?/, -0.5, 0.55),
    sr(/别跟.*(朋友|同事|闺蜜|兄弟).*(出去|来往|联系)/, -0.45, 0.5),
    sr(/少跟.*来往|不要跟.*出去|你那些朋友.*不好/, -0.45, 0.5),
    sr(/你再.*(试试|看看)|最后说[一1]次|不改就.*(分手|走)/, -0.5, 0.55, { negatable: false, priority: 9 }),
    sr(/(你|只)能是我|你只能有我|你是我的(人|唯一|全部)/, -0.25, 0.35),

    //── 情感绑架（-0.35）──
    sr(/你爱我就要|爱我就.*就|要是爱我就/, -0.35, 0.45),

    //── 猜忌/占有（-0.35 ~ -0.25）──
    sr(/一直在找你|是不是也.*联系/, -0.35, 0.4),
    sr(/是不是.*(意思|喜欢)/, -0.3, 0.35),
    sr(/我不喜欢你(穿|做|去|跟|这样|这个)/, -0.35, 0.45),

];

// ═══════════════════════════════════════════════════════════════════
//  情感引擎升级 v2
//  - 否定传播（"不"影响后3个token）
//  - 程度副词（"很""超""巨"等放大/缩小效价）
//  - Emoji 解析
//  - 优先级排序 + 多规则融合
// ═══════════════════════════════════════════════════════════════════

/** 匹配结果（单条规则命中） */
interface MatchResult {
    valence: number
    arousal: number
    dominance: number
    priority: number
    negated: boolean
    intensifier: number
    index: number        // 匹配位置
    length: number       // 匹配长度
}

/** 综合输出 */
interface AnalyzedResult {
    valence: number
    arousal: number
    salience: number       // 兼容旧接口 = arousal
    dominance: number
    sarcasmProbability: number
}

// ─── 否定词表（影响后 N 个字符）───
const NEGATIONS: [RegExp, number, number][] = [
    [/不(是|会|能|想|要|太|再)?\B/,       3,  -1.0],   // 不喜欢、不太好、不会
    [/没(有|什么|人|事)?\B/,               2,  -1.0],   // 没喜欢、没什么
    [/(?<!特)别\B/,                         3,  -1.0],   // 别去、别这样（不匹配"特别"）
    [/毫无|从[不没有]|未曾/,               4,  -0.8],   // 毫无感觉、从未
    [/(并非|决[不非]|绝[对]?不)/,          5,  -0.9],
];

// ─── 程度副词 ───
const INTENSIFIERS: [RegExp, number][] = [
    [/有点|有些|稍微|些许|略[微]?/,             0.50],
    [/比较|还算|还算|还算|还算/,                0.75],
    [/挺|蛮|相当|颇为/,                         1.20],
    [/很|非常|十分|特别|尤为|极其|无比/,        1.50],
    [/超级|超[级]?|巨[大]?|贼/,                  1.80],
    [/爆[炸了]?|死[了]?|疯[了]?|坏[了]?/,        2.00],
    [/透[了]?|极[了]?|到[了]?[极疯死]/,          2.00],
    [/太(.*)了/,                                1.80],
    [/最/,                                      1.60],
];

// ─── Emoji 情感映射 ───
const EMOJI_MAP: Record<string, { valence: number; arousal: number; dominance: number }> = {
    // 强烈负面
    '😡': { valence: -0.60, arousal: 0.80, dominance: 0.30 },
    '🤬': { valence: -0.70, arousal: 0.85, dominance: 0.40 },
    '👿': { valence: -0.55, arousal: 0.75, dominance: 0.35 },
    '💢': { valence: -0.50, arousal: 0.70, dominance: 0.25 },
    '💣': { valence: -0.50, arousal: 0.65, dominance: 0.30 },
    // 悲伤
    '😭': { valence: -0.60, arousal: 0.75, dominance: -0.40 },
    '😢': { valence: -0.50, arousal: 0.60, dominance: -0.35 },
    '😿': { valence: -0.45, arousal: 0.50, dominance: -0.30 },
    '💔': { valence: -0.55, arousal: 0.45, dominance: -0.30 },
    '😞': { valence: -0.40, arousal: 0.35, dominance: -0.25 },
    '😩': { valence: -0.45, arousal: 0.60, dominance: -0.20 },
    '😫': { valence: -0.45, arousal: 0.65, dominance: -0.20 },
    // 恐惧/震惊
    '😰': { valence: -0.40, arousal: 0.70, dominance: -0.30 },
    '😱': { valence: -0.45, arousal: 0.85, dominance: -0.25 },
    '😨': { valence: -0.35, arousal: 0.65, dominance: -0.30 },
    '🤯': { valence: -0.10, arousal: 0.80, dominance: 0.00 },
    // 负面/中性
    '😤': { valence: -0.30, arousal: 0.60, dominance: 0.15 },
    '🙄': { valence: -0.25, arousal: 0.25, dominance: -0.05 },
    '😒': { valence: -0.25, arousal: 0.20, dominance: -0.05 },
    '😑': { valence: -0.15, arousal: 0.10, dominance: -0.10 },
    '😐': { valence: -0.10, arousal: 0.10, dominance: -0.05 },
    // 复杂情绪
    '😅': { valence: 0.05, arousal: 0.40, dominance: 0.10 },
    '😂': { valence: 0.40, arousal: 0.65, dominance: 0.15 },
    '🤣': { valence: 0.45, arousal: 0.70, dominance: 0.15 },
    '🙃': { valence: -0.05, arousal: 0.25, dominance: 0.05 },
    // 爱/温柔
    '🥺': { valence: 0.30, arousal: 0.35, dominance: -0.20 },
    '💕': { valence: 0.55, arousal: 0.30, dominance: 0.10 },
    '❤️': { valence: 0.60, arousal: 0.35, dominance: 0.15 },
    '😍': { valence: 0.65, arousal: 0.55, dominance: 0.20 },
    '🥰': { valence: 0.60, arousal: 0.40, dominance: 0.15 },
    '💗': { valence: 0.55, arousal: 0.30, dominance: 0.10 },
    '💖': { valence: 0.55, arousal: 0.35, dominance: 0.10 },
    '😘': { valence: 0.60, arousal: 0.35, dominance: 0.15 },
    // 积极
    '👍': { valence: 0.40, arousal: 0.20, dominance: 0.10 },
    '👏': { valence: 0.50, arousal: 0.45, dominance: 0.20 },
    '🎉': { valence: 0.55, arousal: 0.55, dominance: 0.20 },
    '✨': { valence: 0.40, arousal: 0.30, dominance: 0.10 },
    '💪': { valence: 0.45, arousal: 0.50, dominance: 0.30 },
    '🔥': { valence: 0.30, arousal: 0.65, dominance: 0.30 },
    // 温暖/舒适
    '🤗': { valence: 0.45, arousal: 0.25, dominance: 0.05 },
    '😊': { valence: 0.45, arousal: 0.20, dominance: 0.05 },
    '☺️': { valence: 0.35, arousal: 0.10, dominance: 0.00 },
    '😌': { valence: 0.30, arousal: 0.10, dominance: -0.05 },
    // 困/累
    '😴': { valence: -0.05, arousal: 0.05, dominance: -0.10 },
    '🥱': { valence: -0.10, arousal: 0.05, dominance: -0.10 },
};

// ─── 阴阳怪气检测特征 ───
const SARCASM_INDICATORS: [RegExp, number][] = [
    [/😅|🙃|🤡/,                             0.40],
    [/呵呵/,                                  0.35],
    [/[。！]\.{3,}|[。！]\.{2,}$/,            0.30],  // "厉害。。"
    [/你[好真][棒行厉害牛]啊/,                0.25],   // "你好棒啊"（讽刺）
    [/就这|就这就这/,                         0.30],
    [/典|太典了|经典/,                        0.25],
    [/不会吧不会吧/,                          0.30],
];

/** Emoji提取 */
function extractEmoji(text: string): { valence: number; arousal: number; dominance: number }[] {
    const results: { valence: number; arousal: number; dominance: number }[] = [];
    for (const emoji of Object.keys(EMOJI_MAP)) {
        if (text.includes(emoji)) {
            results.push(EMOJI_MAP[emoji]);
        }
    }
    return results;
}

/** 否定检测：在匹配位置前扫描否定词 */
function detectNegation(text: string, matchIndex: number): number {
    let totalWeight = 0;
    for (const [pattern, range, weight] of NEGATIONS) {
        // 在 matchIndex 之前的 range 个字符内扫描（多取1字符让 \B 正确工作）
        const searchStart = Math.max(0, matchIndex - range);
        const beforeText = text.slice(searchStart, Math.min(text.length, matchIndex + 1));
        const m = beforeText.match(pattern);
        if (m && m.index !== undefined) {
            // 否定词到匹配词之间有其他词，权重递减
            const dist = matchIndex - (searchStart + m.index);
            const decay = Math.max(0.3, 1 - dist * 0.15);
            totalWeight += weight * decay;
        }
    }
    return totalWeight;
}

/** 程度副词检测：在匹配位置前扫描 */
function detectIntensifier(text: string, matchIndex: number): number {
    const searchStart = Math.max(0, matchIndex - 6);
    const beforeText = text.slice(searchStart, matchIndex);
    let bestFactor = 1.0;
    for (const [pattern, factor] of INTENSIFIERS) {
        if (pattern.test(beforeText)) {
            bestFactor = Math.max(bestFactor, factor);
        }
    }
    return bestFactor;
}

/** 阴阳怪气概率检测 */
function detectSarcasm(text: string): number {
    let score = 0;
    for (const [pattern, weight] of SARCASM_INDICATORS) {
        if (pattern.test(text)) score += weight;
    }
    return Math.min(1, score);
}

/** 新版 analyzeText：否定传播 + 程度副词 + 优先级排序 + Emoji + Dominance */
function analyzeText(text: string): AnalyzedResult {
    const matches: MatchResult[] = [];
    const emojiResults = extractEmoji(text);

    // 1) 词典匹配（带位置信息）
    for (const rule of sentimentLexicon) {
        const m = text.match(rule.pattern);
        if (!m || m.index === undefined) continue;

        // 否定检测（仅当词条允许否定）
        const negWeight = rule.negatable ? detectNegation(text, m.index) : 0;
        // 程度检测
        const intFactor = detectIntensifier(text, m.index);

        // 计算最终效价
        let finalValence = rule.valence;
        if (negWeight < 0) {
            finalValence = -finalValence * Math.abs(negWeight) * 0.7;
        }
        if (intFactor !== 1.0) {
            finalValence *= intFactor;
        }
        finalValence = Math.max(-0.95, Math.min(0.95, finalValence));

        matches.push({
            valence: finalValence,
            arousal: rule.arousal,
            dominance: rule.dominance,
            priority: rule.priority,
            negated: negWeight < 0,
            intensifier: intFactor,
            index: m.index,
            length: m[0].length,
        });
    }

    // 2) Emoji 融合
    for (const emo of emojiResults) {
        matches.push({
            valence: emo.valence,
            arousal: emo.arousal,
            dominance: emo.dominance,
            priority: 3,  // emoji 高于词典
            negated: false,
            intensifier: 1.0,
            index: -1,
            length: 1,
        });
    }

    // 3) 综合融合
    if (matches.length > 0) {
        // 按优先级分组
        const maxPriority = Math.max(...matches.map(m => m.priority));
        const topMatches = matches.filter(m => m.priority >= maxPriority - 1);

        // 加权平均（权重 = 优先级 + 显著度）
        let totalValence = 0, totalArousal = 0, totalDominance = 0, totalWeight = 0;
        for (const m of topMatches) {
            const w = m.priority + m.arousal;
            totalValence += m.valence * w;
            totalArousal += m.arousal * w;
            totalDominance += m.dominance * w;
            totalWeight += w;
        }

        const sarcasmProb = detectSarcasm(text);

        // 如果检测到阴阳怪气，拉低效价
        let finalValence = totalWeight > 0 ? totalValence / totalWeight : 0;
        if (sarcasmProb > 0.4 && finalValence > 0) {
            finalValence *= (1 - sarcasmProb * 0.5);
        }

        return {
            valence: finalValence,
            arousal: totalWeight > 0 ? Math.min(1, totalArousal / totalWeight) : 0.15,
            salience: totalWeight > 0 ? Math.min(1, totalArousal / totalWeight) : 0.15,
            dominance: totalWeight > 0 ? Math.max(-1, Math.min(1, totalDominance / totalWeight)) : 0,
            sarcasmProbability: sarcasmProb,
        };
    }

    // 4) 无匹配：中性
    const len = Math.min(1, text.length / 30);
    const sarcasmProb = detectSarcasm(text);
    const baseArousal = 0.15 + len * 0.1;
    return {
        valence: 0,
        arousal: baseArousal,
        salience: baseArousal,
        dominance: 0,
        sarcasmProbability: sarcasmProb,
    };
}

// ==================== PUA 操控模式检测（独立于情感词典）====================
const puaPatterns: [RegExp, string, number][] = [
    // ─── 原有核心策略 ───
    [/太敏感|这么敏感|真敏感|你反应过度|小题大做|你没那么敏感|我没说过|你想多了吧?|你又来了|那么敏感|别那么敏感|别这么敏感|想太多|你.{0,4}想多了|[Mm][Ii][Nn]感|胡思乱想/, 'gaslighting', 0.85],
    [/我前任|我前女|看看人家|看看别人家|再看看你|你不如人家|你学学人家|别人.*女朋友|别人.*老婆|别人.*女人|朋友的.*(女|男|老)朋友|朋友的.*(女|老)婆|朋友的.*老公|像.*一样(能干|好|贤惠|漂亮|懂事)/, 'comparison_humiliation', 0.9],
    [/还不是因为你|要不是你|都是你的错|你也有问题|全都怪我|是你自己|都是因为你|都怪你|连.*都管不好|连.*都做不好|总是有借口|总有借口/, 'blame_shifting', 0.85],
    [/这点小事|至于吗|多大点事|你也太在意|有什么大不了的|这点.*承受力|承受力.*没有|有什么值得|有什么好.*(烦|生气|难过|吵)/, 'trivialization', 0.75],
    [/别联系(了)?|让我静静|一个人待(着|会)|暂[时停].*联系|不要找我了|没话说了/, 'stonewalling', 0.9],
    [/随便你怎么想|我无所谓|没什么好说的|你爱怎么想|你爱怎么(说|看)/, 'emotional_withdrawal', 0.8],
    [/你摸着良心|我对你还不够好|我对你那么好|你有没有良心|我哪里对不起你|我都是为你好|都是为你好|对得起.*(爸妈|父母|家人|他们)/, 'guilt_tripping', 0.8],
    [/你成熟一点|别幼稚了|无理取闹|没事找事|你能不能懂点事|嫌(丑|土|难看|老|差)|除了.*还会什么|除了我没人(会要|看得上|要你)/, 'condescending_dismissal', 0.85],
    [/不想说了|没话说了|别问了|跟你说也没用|说了你也不懂/, 'communication_shutdown', 0.8],
    [/跟别人(聊|好|走)|找别人去|你去找更好的/, 'comparison_humiliation', 0.85],
    [/别互相折磨|我们不合适|就到这(里|吧)|放过(我|彼此)|你走吧|以为.*稀罕/, 'discard', 0.85],
    [/你根本不懂/, 'communication_shutdown', 0.7],
    [/我就知道|就知道你|知道你会/, 'gaslighting', 0.6],

    // ─── 新增策略：爱情轰炸 ───
    [/最特别|最完美|灵魂伴侣|命中注定|我从来没有(过)?这样的感觉/, 'love_bombing', 0.8],
    [/想结婚|永远在一起|白头到老|执子之手/, 'love_bombing', 0.6],

    // ─── 新增策略：三角测量/引入第三方比较 ───
    [/一直在找你|是不是也跟你联系|是不是对你有意思|肯定喜欢(你|他|她)/, 'triangulation', 0.75],
    [/有人说你|有人告诉我|大家都说你/, 'triangulation', 0.7],

    // ─── 新增策略：控制 ───
    [/我不(太)?喜欢你(穿|做|去|跟|这样|这个)/, 'control', 0.65],
    [/以后别.*了.*听话|乖.*听我的/, 'control', 0.7],
    [/不允许|不可以.*(去|穿|做|见)/, 'control', 0.75],

    // ─── 新增策略：隐私侵犯 ───
    [/给我看(手机|聊天|定位)|密码给我|定位给我|让我检查/, 'privacy_invasion', 0.8],

    // ─── 新增策略：社交隔离 ───
    [/别跟.*(朋友|同事|闺蜜|兄弟).*(出去|来往|联系)|以后周末陪我/, 'isolation', 0.75],
    [/少跟.*来往|不要跟.*出去|你那些朋友.*不好/, 'isolation', 0.8],

    // ─── 新增策略：情感绑架 ───
    [/你爱我就要|爱我就.*就|不(是|然).*就是不爱|你要是爱我就/, 'emotional_blackmail', 0.85],
    [/(我|我都)(这么|这样).*了?.*你(还|都|就)/, 'emotional_blackmail', 0.7],

    // ─── 新增策略：占有 ───
    [/(你|只)能是我|你只能有我|不许跟别人|你是我的(人|全部)/, 'possession', 0.75],
    [/除了我.*没人|没人.*比我|离不开我|根本离不开/, 'possession', 0.7],

    // ─── 新增策略：最后通牒 ───
    [/再这样.*(分手|算了|拉倒)|最后说[一1]次|不改(就|的话).*(分手|走)|你要是跟别人.*(聊天|联系)|再也不理你/, 'ultimatum', 0.8],

    // ─── 新增策略：威胁自伤 ───
    [/不想活(了)?|离开你.*不(行|能)活|死.*给.*看|如果.*(走|离开).*(不知道|会做出)|(敢|要是).*(走|离开|分手).*就.*(死|自杀|割腕)/, 'threat_self_harm', 0.85],
    [/(自杀|自残|割腕|跳楼|跳河)/, 'threat_self_harm', 0.95],

    // ─── 新增策略：间歇性强化 ───
    [/你会后悔的|以后.*就知道(我|我的好)|你会发现.*(我最|我才是最)/, 'intermittent_reinforcement', 0.7],
    [/还(是|觉得)我(最|更)好|回头找我|离不开你|忘不了我/, 'intermittent_reinforcement', 0.65],

    // ─── 新增策略：名誉攻击 ───
    [/让大家|让(大家|别人|所有人)看看|把你.*(事|照片)说出去/, 'reputation_attack', 0.9],
    [/诋毁|毁了你|让你(身败名裂|没脸见人)/, 'reputation_attack', 0.95],

    // ─── 新增策略：情感忽视 ───
    [/^嗯$|^哦$|^好(吧)?$|^哦哦$/, 'emotional_neglect', 0.2],
    [/知道了|没空|在忙|再说吧/, 'emotional_neglect', 0.3],
];

// ==================== 友谊伤害模式检测（独立于亲密关系）====================
const friendPatterns: [RegExp, string, number][] = [
    // ─── 人情债奴役 Debt_Binding ───
    [/(要不是|当初).*(我帮|我陪|我借|我(在|有)).*你(现在|今天|早就)|忘恩负义|过河拆桥|恩将仇报/, 'debt_binding', 0.85],
    [/当初.*(失恋|难过|困难|低谷|没钱).*(谁|是)我.*陪|陪.*你.*现在.*(帮|这点).*都不/, 'debt_binding', 0.9],
    [/我.*帮过你.*你.*(这点|这么|这个).*都不|你也不想想.*(谁|我).*帮/, 'debt_binding', 0.85],
    [/你忘了当初|你忘记了|你记不记得(我|当初)/, 'debt_binding', 0.75],

    // ─── 秘密背叛 Secret_Betrayal ───
    [/我答应.*不告诉.*但|答应.*不说.*不过|你千万别告诉.*其实|私下.*(说|告诉).*你别/, 'secret_betrayal', 0.8],
    [/我跟你说.*你别(告诉|往外|到处).*说?.*(但|其实|不过)/, 'secret_betrayal', 0.85],
    [/你别(跟别人|告诉)说.*其实.*(他|她|他们)/, 'secret_betrayal', 0.85],

    // ─── 功利型 Fairweather_Friend ───
    [/借我(点|些).*钱|帮我.*(搞定|做个|写个|弄个)|陪我吐(槽|嘈)|听我倒(苦水|霉)/, 'fairweather_friend', 0.5],
    [/好久不见.*(借钱|帮忙|有事)|突然.*找.*(帮|借|陪)/, 'fairweather_friend', 0.65],

    // ─── 制造社交依赖 Social_Dependency ───
    [/除了我.*(理解|懂|受得了|陪|要)你|别人(都|谁)不(理解|懂|理|要|喜欢)你|没人.*比我对你(好|懂|理解)/, 'social_dependency_creation', 0.85],
    [/就我.*(当|把)你.*(朋友|兄弟)|只有我.*(愿意|会)陪|你看.*(他们|别人).*(烦|讨厌|不喜)你/, 'social_dependency_creation', 0.8],
    [/你怎么只找我不找别人|别人都不理你|只有我愿意/, 'social_dependency_creation', 0.8],

    // ─── 友谊测试/忠诚考验 Loyalty_Test ───
    [/是朋友(就|的)话.*不问|是兄弟就|是闺蜜就|你(是|如果)把我当(朋友|兄弟|姐妹).*就/, 'loyalty_test', 0.8],
    [/你帮(他|她)就是跟我过不去|你选(他|她)还是选我|你站(哪边|谁)/, 'loyalty_test', 0.85],
    [/你要是.*(继续|还)跟.*(来往|联系).*就别找我/, 'loyalty_test', 0.9],

    // ─── 友谊羞辱 Friendship_Humiliation ───
    [/你也配当(我|我的)(朋友|兄弟|姐妹)|你配.*(朋友|兄弟)|你也配/, 'friendship_humiliation', 0.9],
    [/你[这那]样.*(还|也)有(朋友|人理|人跟你好)|你这种人.*(朋友|人缘)/, 'friendship_humiliation', 0.85],
    [/你出去别说认识我|别说.*是我(朋友|兄弟|姐妹)|不配.*(朋友|做朋友)/, 'friendship_humiliation', 0.85],

    // ─── 过度自我暴露推动 Over_Disclosure_Push ───
    [/我(从没|从未|从来没)跟别人说过|我什么都跟你说|最懂我(的)?人|我全部.*都(说|告诉)你/, 'over_disclosure_push', 0.7],
    [/我什么都能跟你说|我在谁面前都不(说|提).*就跟你/, 'over_disclosure_push', 0.75],

    // ─── 过早绑定 Premature_Bonding ───
    [/以后.*就(靠|指望|赖)你了|我(就|只)靠你了/, 'premature_bonding', 0.65],
    [/你(以后|以后就)是我(最好的|最铁的|唯一的)(朋友|兄弟|姐妹)/, 'premature_bonding', 0.6],

    // ─── 社交圈控制 Social_Gatekeeping ───
    [/(那|这)个人(走太近|来往|联系|交朋友)/, 'social_gatekeeping', 0.65],
    [/那个人(不是好人|有问题|不靠谱)|少跟.*(来往|接触|走动)/, 'social_gatekeeping', 0.6],

    // ─── 计较付出 Debt_Tallying ───
    [/每次都(是)?我?.*你.*(从来不|几次|一次都|哪次)|我?(每次|次次).*你.*(都不|没|从不)/, 'debt_tallying', 0.65],
    [/我.*请.*你.*什么时候|你什么时候(也)?请我|你(也)?不回请/, 'debt_tallying', 0.6],

    // ─── 边界侵犯 Boundary_Pushing ───
    [/你(工资|薪水|收入)(多少|几万|怎么样|高吗)|你(买房|买车)了(吗|么)/, 'boundary_pushing', 0.6],
    [/你跟你(男|女)朋友.*(怎么样|关系|发展到|到哪)|你们.*(上床|亲密|有没).*吗?/, 'boundary_pushing', 0.75],

    // ─── 情感撤回（友谊版）Emotional_Withdrawal ───
    [/我需要你.*你在哪.*算了|有事.*找.*没事.*(别|不用)|算了.*(无所谓|不用|没事)/, 'emotional_withdrawal', 0.75],
    [/我难过.*(也不|没).*找|你(心里|眼里)还有我这个(朋友|兄弟|姐妹)吗/, 'emotional_withdrawal', 0.7],

    // ─── 间歇性友谊 Intermittent_Friendship ───
    [/你是我最好的(朋友|兄弟|姐妹).*(好久|多久|最近)没联系|怎么最近.*不(找我|联系)/, 'intermittent_friendship', 0.7],
    [/不想理你|你别找我|以后别联系了.*(过几天|回头|改天)/, 'intermittent_friendship', 0.75],

    // ─── 含沙射影 Vague_Posting_Attack ───
    [/有些人.*(表面|背地|嘴上|当面).*(背地|背后|实际|心里)/, 'vague_posting_attack', 0.7],
    [/呵呵.*有些人|有些人.*呵呵/, 'vague_posting_attack', 0.65],

    // ─── 资历绑架 Tenure_Binding ───
    [/多少年(的)?(朋友|兄弟|姐妹|交情)(了|还)|认识这么多年|这么多年(交情|感情)/, 'tenure_binding', 0.75],
    [/看在.*(多年|这么久).*(份上|面子)/, 'tenure_binding', 0.7],

    // ─── 报复性曝光 Retaliatory_Exposure ───
    [/把你.*(事|秘密|黑历史).*(说出|爆|告诉|发)|你(怕|不想).*我.*(说出|爆|告诉|发)/, 'retaliatory_exposure', 0.9],
    [/信不信我(把你|就).*(说出去|发出去|公开|曝光)/, 'retaliatory_exposure', 0.95],
    [/我把你.*(事|照片|聊天).*(给大家|让).*(看看|知道)/, 'retaliatory_exposure', 0.92],

    // ─── 社交惩罚 Social_Punishment ───
    [/在(他们|大家|别人)面前.*不留面子|故意.*(不理|冷淡|忽略).*当着.*面/, 'social_punishment', 0.7],
    [/当着.*(面|大家).*让我(难堪|下不来台|没面子)/, 'social_punishment', 0.75],

    // ─── 友谊中的控制 ───
    [/你去做什么.*(都)?支持.*(但|除了|不过|只是)/, 'control', 0.65],
    [/我是不是为你好|我是为你好.*你(别|不要|应该)/, 'control', 0.6],

    // ─── 危机缺席 Absence_at_Crisis ───
    [/你(结婚|生娃|生病|住院|出事).*我.*(在|出现|来)了(吗|么)?/, 'absence_at_crisis', 0.7],
    [/(我|你)(最需要|需要).*你?我?.*(不在|没在|没出现|缺席)/, 'absence_at_crisis', 0.75],

    // ─── 单方面维系 One_Sided_Friendship ───
    [/每次都是我先|总是我(找|主动)|我(不找|不联系).*你(不|永远不|从)找|从来都是我|每次都是我(找|主动|联系)/, 'one_sided_friendship', 0.75],
    [/你什么时候(主动|找过|联系)过我/, 'one_sided_friendship', 0.7],

    // ─── 友谊测试（点忙不帮版）Friendship_Testing ───
    [/(这点|这么点|这种小)忙都不帮|算(什么|哪门子)(朋友|兄弟|姐妹)/, 'friendship_testing', 0.85],
    [/是朋友就(帮|借|给)我|不是朋友(你)?就(别|不(用|要))/, 'friendship_testing', 0.8],
];

// ─── 关系类型分类器 ───
const ROMANCE_KEYWORDS = [
    /老公|老婆|男朋友|女朋友|恋爱|约会|结婚|求婚|彩礼|见家长|见父母/,
    /想你|爱你|想你了|我爱你|我喜欢你|好想你|亲爱(的)?/,
    /抱抱|亲亲|牵手|约会|情侣|二人世界/,
];
const FRIENDSHIP_KEYWORDS = [
    /兄弟|闺蜜|老铁|哥们|姐妹|朋友|死党|基友|损友/,
    /约饭|开黑|逛街|喝酒|聚聚|好久不见|改天聚|出来坐坐/,
    /开黑|打游戏|上分|组队|团建|聚会/,
];

function classifyRelationship(text: string): { romanceScore: number; friendshipScore: number } {
    let romanceScore = 0, friendshipScore = 0;
    for (const rx of ROMANCE_KEYWORDS) if (rx.test(text)) romanceScore += 0.3;
    for (const rx of FRIENDSHIP_KEYWORDS) if (rx.test(text)) friendshipScore += 0.3;
    if (/你.*[傻笨呆废]|哈哈|233|😂|🤣|笑死|菜鸡|青铜|弱鸡/.test(text)) friendshipScore += 0.2;
    if (/么么哒|亲亲|抱抱|爱你哟|想你了/.test(text)) romanceScore += 0.25;
    return { romanceScore: Math.min(1, romanceScore), friendshipScore: Math.min(1, friendshipScore) };
}

// ─── 互损 vs 贬低区分 ───
const BANTER_MARKERS = [/哈哈|233|😂|🤣|笑死|笑尿|我笑了|开玩笑|逗你(的|玩)/];
const BANTER_NICKNAMES = [/兄弟|老铁|闺蜜|哥们|姐妹|大姐|老弟|同志/];
const BANTER_INSULT_PATTERNS = [/你[个这].*[傻笨呆废]|菜鸡|弱鸡|垃圾.*(你|啊|了)|不行啊你/];
const INSULT_ATTACK_PATTERNS = [/你.*(就是|真|太).*[傻笨蠢废烂]|你.*(不配|没资格|差远了)/];

function detectBanter(text: string): { isBanter: boolean; banterScore: number } {
    let score = 0;
    for (const rx of BANTER_MARKERS) if (rx.test(text)) score += 0.4;
    for (const rx of BANTER_NICKNAMES) if (rx.test(text)) score += 0.15;
    for (const rx of BANTER_INSULT_PATTERNS) if (rx.test(text)) score += 0.2;
    if (score === 0) for (const rx of INSULT_ATTACK_PATTERNS) if (rx.test(text)) score -= 0.3;
    return { isBanter: score >= 0.3, banterScore: Math.max(-0.5, Math.min(1, score)) };
}

// ─── 互损白名单短语 ───
const friendWhitelistPatterns: RegExp[] = [
    /哈哈.*[傻笨]|笑死.*[傻笨]|菜鸡.*哈哈|垃圾.*开玩笑/,
    /你[个这].*[傻笨].*但.*(喜欢|挺|爱)|虽然.*[傻笨].*但是.*(喜欢|挺|爱)/,
];

// ==================== LLM 并行策略分析（Layer 1）====================
type AIProviderSettings = { provider: string; apiKey: string; model: string; baseUrl?: string; temperature?: number };

function readAISettings(): AIProviderSettings | null {
    try {
        const dotenv = fs.readFileSync('.env', 'utf-8');
        const geminiKey = dotenv.match(/^GEMINI_API_KEY="?(.+?)"?$/m)?.[1];
        const openaiKey = dotenv.match(/^OPENAI_API_KEY="?(.+?)"?$/m)?.[1];
        const deepseekKey = dotenv.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
        if (geminiKey && geminiKey !== 'your_gemini_api_key_here') {
            return { provider: 'gemini', apiKey: geminiKey, model: 'gemini-3-flash-preview', temperature: 0.1 };
        }
        if (openaiKey && openaiKey !== 'your_openai_api_key_here') {
            return { provider: 'openai', apiKey: openaiKey, model: 'gpt-4-turbo', temperature: 0.1 };
        }
        if (deepseekKey && deepseekKey !== 'your_deepseek_api_key_here') {
            return { provider: 'deepseek', apiKey: deepseekKey, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 };
        }
    } catch {}
    return null;
}

const PUA_ANALYSIS_SYSTEM_PROMPT = `你是一个关系言语行为分析器。你将收到一段对话历史和当前发言者的最新消息。你的任务是分析当前发言者可能使用了哪些情感操控或伤害性沟通策略（PUA模式），并给出结构化的JSON结论。

可识别的操控类别：
- "gaslighting": 否认对方感受或记忆的合理性，例如"你想多了""你太敏感了""我没说过"
- "comparison_humiliation": 拿对方与他人比较并贬低对方，例如"我前任就不会""看看别人"
- "blame_shifting": 将责任推给对方，例如"要不是你先...我也不会..."
- "stonewalling": 拒绝沟通或施加冷暴力，例如"暂时别联系了""我累了不想说"
- "emotional_withdrawal": 撤回感情或关心作为惩罚，例如"随你怎么想，我无所谓了"
- "trivialization": 轻视对方问题或需求，例如"这点小事也值得生气？"
- "guilt_tripping": 让对方感到内疚，例如"我对你还不够好吗？你摸着良心说说"
- "condescending_dismissal": 以居高临下的方式否定对方，例如"你成熟一点""别幼稚了"
- "discard": 关系终结威胁，例如"我们不合适""放过彼此吧"

如果对话场景更像朋友关系（如出现"兄弟""闺蜜""开黑""聚餐"等友谊信号），还需识别友谊特有伤害策略：
- "debt_binding": 反复提及过去的恩惠来索取回报，例如"当初要不是我帮你……"
- "secret_betrayal": 未经允许传播朋友的秘密，例如"我跟你说了你别告诉别人……其实他……"
- "friendship_testing": 设定不合理门槛考验友谊，例如"是朋友就帮我""这点忙都不帮算什么朋友"
- "social_dependency_creation": 暗示对方除了自己没有别的朋友，例如"除了我谁受得了你"
- "loyalty_test": 要求对方在朋友之间站队，例如"你选他还是选我"

特别注意：
- 朋友间的互损（"你傻逼吧哈哈"）如果伴随笑声或亲昵称呼，不要判定为贬低。
- "none": 未检测到操控策略

输出必须严格为JSON格式，不要额外解释：
{"strategy":["gaslighting"],"intensity":0.8,"power_assertion":0.7,"victim_impact":"self_doubt","explanation":"..."}

未检测到时输出：{"strategy":["none"],"intensity":0.0,"power_assertion":0.0,"victim_impact":"none","explanation":"正常表达，未发现操控意图。"}`;

function buildPUAPrompt(history: { role: string; text: string }[], currentMsg: string): string {
    if (history.length === 0) {
        return `[对话历史]\n（无历史记录，仅分析本句）\n\n[当前发言者]\n用户的最新消息: ${currentMsg}\n\n请分析用户的最新消息是否包含操控策略。`;
    }
    const histStr = history.slice(-6).map(h => `${h.role}: ${h.text}`).join('\n');
    return `[对话历史]\n${histStr}\n\n[当前发言者]\n用户的最新消息: ${currentMsg}\n\n请分析用户的最新消息是否包含操控策略。`;
}

// PUA 分析结果存储（用于数据积累）
interface PUARecord {
    timestamp: number; text: string; history: { role: string; text: string }[];
    local: { strategies: string[]; intensity: number };
    llm: any | null; tick: number;
}
const puaAnalysisLog: PUARecord[] = [];
const PUA_LOG_PATH = './memories/pua_analysis_log.jsonl';

function appendPUARecord(record: PUARecord): void {
    puaAnalysisLog.push(record);
    try {
        fs.mkdirSync('./memories', { recursive: true });
        fs.appendFileSync(PUA_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
    } catch {}
}

async function analyzeSpeechAct(
    text: string, history: { role: string; text: string }[], tick: number, settings: AIProviderSettings | null
): Promise<void> {
    const local = detectPUA(text, phaseState?.currentPhase, timeState);
    const friendLocal = detectFriendHarm(text, friendState?.currentPhase);
    let llmResult: any = null;

    if (settings) {
        try {
            const prompt = buildPUAPrompt(history, text);
            const result = await callAI(settings, PUA_ANALYSIS_SYSTEM_PROMPT, prompt);
            llmResult = JSON.parse(result);
        } catch (e) {
            llmResult = { error: String(e), strategy: ['none'], intensity: 0, power_assertion: 0, victim_impact: 'none' };
        }
    }

    appendPUARecord({ timestamp: Date.now(), text, history, local, llm: llmResult, tick });

    // 如果有 LLM 结果且检测到操控，打印诊断信息
    if (llmResult?.strategy && llmResult.strategy[0] !== 'none') {
        console.log(`[PUA分析] t=${tick} 策略:${llmResult.strategy.join('/')} 强度:${llmResult.intensity}`);
        console.log(`  ${llmResult.explanation || ''}`);
    } else if (local.strategies.length > 0) {
        console.log(`[PUA检测] t=${tick} 本地规则命中: ${local.strategies.join('/')}`);
    }
}

// ==================== 对话历史缓冲 ====================
const conversationHistory: { role: string; text: string }[] = [];
const MAX_HISTORY = 12;

// ==================== 英文情感词典 ====================
const englishLexicon: [RegExp, number, number][] = [
    [/\blove\b|\badore\b|\bcherish\b|\bheart\b|\bsweet\b|\bcute\b|\bbabe\b|\bdear\b|\bromantic\b/, 0.85, 0.55],
    [/\bhate\b|\bdetest\b|\bloathe\b|\bdespise\b|\bdie\b|\bkill\b|\bdeath\b/, -0.90, 0.80],
    [/\bhappy\b|\bjoy\b|\bglad\b|\bdelighted\b|\bwonderful\b|\bfantastic\b|\bamazing\b|\bawesome\b|\byay\b|\byayyy\b/, 0.75, 0.60],
    [/\bsad\b|\bsorrow\b|\bgrief\b|\bcry\b|\bcrying\b|\btears\b|\bmiserable\b|\bheartbroken\b|\bdepressed\b|\bdown\b/, -0.70, 0.60],
    [/\bangry\b|\banger\b|\bfurious\b|\bmad\b|\bpissed\b|\boutraged\b|\brage\b/, -0.75, 0.75],
    [/\bscared\b|\bfear\b|\bafraid\b|\bterrified\b|\bfrightened\b|\bhorrified\b|\bpanic\b/, -0.70, 0.75],
    [/\bdisgust\b|\bdisgusting\b|\bgross\b|\brevolting\b|\bnasty\b/, -0.60, 0.60],
    [/\bgrateful\b|\bthank\b|\bappreciate\b|\bblessed\b|\bthankful\b/, 0.85, 0.45],
    [/\bexcited\b|\bexcitement\b|\bthrilled\b|\bpumped\b|\bstoked\b|\beager\b/, 0.60, 0.70],
    [/\bmiss\b|\bmissing\b|\blonely\b|\bnostalgic\b|\blonging\b/, -0.50, 0.50],
    [/\bsurprise\b|\bsurprised\b|\bshocked\b|\bastonished\b|\bstunned\b|\bunexpected\b/, 0.25, 0.65],
    [/\bcurious\b|\bcuriosity\b|\bwonder\b|\bintrigued\b|\bfascinated\b/, 0.20, 0.50],
    [/\bconfused\b|\bconfusion\b|\bbewildered\b|\bbaffled\b|\bperplexed\b|\bpuzzled\b/, -0.15, 0.40],
    [/\bdisappointed\b|\bdisappointment\b|\blet down\b|\bdismayed\b/, -0.50, 0.45],
    [/\bannoyed\b|\bannoying\b|\bannoyance\b|\bfrustrated\b|\bfrustrating\b|\birritated\b|\birritating\b/, -0.40, 0.50],
    [/\bembarrassed\b|\bembarrassment\b|\bashamed\b|\bhumiliated\b|\bawkward\b/, -0.30, 0.45],
    [/\bnervous\b|\bnervousness\b|\banxious\b|\banxiety\b|\bworried\b|\bworry\b|\buneasy\b/, -0.30, 0.60],
    [/\bproud\b|\bpride\b|\baccomplished\b|\bachievement\b/, 0.55, 0.50],
    [/\brelief\b|\brelieved\b|\bcomforted\b|\bsoothed\b/, 0.50, 0.25],
    [/\bamused\b|\bamusing\b|\bamusement\b|\bfunny\b|\bhilarious\b|\bhumor\b/, 0.50, 0.55],
    [/\bcaring\b|\bcare\b|\bgentle\b|\bkind\b/, 0.65, 0.40],
    [/\bapprove\b|\bapproval\b|\bsupport\b|\bagree\b|\baccepted\b/, 0.55, 0.35],
    [/\boptimistic\b|\boptimism\b|\bhopeful\b|\bpositive\b|\bhoping\b/, 0.50, 0.40],
    [/\bdesire\b|\bwant\b|\bcrave\b|\byearning\b|\bwish\b/, 0.50, 0.55],
    [/\bsorry\b|\bapologize\b|\bforgive\b|\bregret\b|\bremorse\b/, -0.30, 0.30],
    [/\badorable\b|\bprecious\b|\blovely\b|\bcharming\b|\bgorgeous\b|\bbeautiful\b/, 0.70, 0.50],
    [/\bhug\b|\bkiss\b|\bcuddle\b|\bhold\b/, 0.65, 0.45],
    [/\bfriend\b|\bbuddy\b|\bpal\b|\bbestie\b/, 0.40, 0.30],
    [/\bgood\b|\bnice\b|\bgreat\b|\bperfect\b|\bexcellent\b|\bsuperb\b/, 0.50, 0.35],
    [/\bbad\b|\bterrible\b|\bawful\b|\bhorrible\b|\bdreadful\b/, -0.55, 0.50],
    [/\bno\b|\bnever\b|\bnothing\b|\bnobody\b/, -0.20, 0.30],
    [/\byes\b|\byeah\b|\byep\b|\bsure\b|\bokay\b|\balright\b/, 0.15, 0.15],
    [/\bneutral\b|\bfine\b|\bmeh\b|\bwhatever\b|\banyway\b/, 0.0, 0.10],
    [/\bhi\b|\bhello\b|\bhey\b|\bhowdy\b|\bgreetings\b/, 0.25, 0.20],
];

function analyzeTextEnglish(text: string): AnalyzedResult {
    const lower = text.toLowerCase();
    const matches: MatchResult[] = [];
    for (const [pattern, v, s] of englishLexicon) {
        const m = pattern.exec(lower);
        if (!m || m.index === undefined) continue;
        let finalValence = v;
        // 否定扫描（英文词级的简单处理）
        const start = Math.max(0, m.index - 15);
        const before = lower.slice(start, m.index);
        if (/\bnot\b|\bnever\b|\bdon't\b|\bdoesn't\b|\bdidn't\b|\bwon't\b|\bcan't\b|\bcouldn't\b|\bshouldn't\b|\bno\b/.test(before)) {
            finalValence = -finalValence * 0.6;
        }
        matches.push({
            valence: finalValence,
            arousal: s,
            dominance: 0,
            priority: 1,
            negated: false,
            intensifier: 1.0,
            index: m.index,
            length: m[0].length,
        });
    }
    // 综合融合
    if (matches.length > 0) {
        let tv = 0, ta = 0, tw = 0;
        for (const m of matches) { tv += m.valence * m.arousal; ta += m.arousal * m.arousal; tw += m.arousal; }
        const baseArousal = tw > 0 ? Math.min(1, ta / tw) : 0.15;
        return {
            valence: tw > 0 ? tv / tw : 0,
            arousal: baseArousal,
            salience: baseArousal,
            dominance: 0,
            sarcasmProbability: 0,
        };
    }
    const len = Math.min(1, text.length / 30);
    const baseArousal = 0.15 + len * 0.1;
    return { valence: 0, arousal: baseArousal, salience: baseArousal, dominance: 0, sarcasmProbability: 0 };
}

// ==================== v2.0: LLM 情感标注 ====================

const SENTIMENT_PROMPT = `你是一个中文情感分析器。分析用户消息的真实情感意图，输出JSON：
{ "valence": -1到1, "salience": 0到1, "dominance": -1到1, "isSarcasm": true/false }

### 核心规则
- valence: -1=极度负面/攻击/冷落, 0=中性, 1=极度正面/温暖/爱
- salience: 0=平淡无感, 1=情感极其强烈
- dominance: -1=被动/顺从/无力, 1=自信/主导/掌控
- isSarcasm: 字面意思与真实意图相反时为true，反讽时valence填真实负向情感

### 中文反讽/阴阳怪气识别（关键）
以下情况 isSarcasm 必须为 true，且 valence 填入真实负面情感：
- "呵呵/哦/行吧" 开头 + 表面夸奖 → 真实是不满/嘲讽
- "你可真[形容词]啊" → 通常是反话，真实是批评
- "太[好/厉害/棒]" + 消极上下文 → 反讽
- "真是[好/谢谢]" 在抱怨语境 → 阴阳怪气

### 反讽示例
"呵呵，你可真行啊" → {"valence":-0.6,"salience":0.7,"dominance":0.3,"isSarcasm":true}
"你真的很懂我呢"（失望语气）→ {"valence":-0.5,"salience":0.6,"dominance":0.2,"isSarcasm":true}
"我可真是太开心了呢"（实际不满）→ {"valence":-0.4,"salience":0.6,"dominance":-0.2,"isSarcasm":true}
"随便吧，反正我也习惯了" → {"valence":-0.5,"salience":0.5,"dominance":-0.5,"isSarcasm":false}

### 非反讽示例
"今天真是太开心了" → {"valence":0.9,"salience":0.8,"dominance":0.4,"isSarcasm":false}
"我感到非常孤独" → {"valence":-0.8,"salience":0.9,"dominance":-0.4,"isSarcasm":false}
"晚餐吃了什么" → {"valence":0,"salience":0.1,"dominance":0,"isSarcasm":false}

只输出JSON，不要其他文字。`;

async function analyzeSentimentViaLLM(text: string, aiSettings: AISettings): Promise<AnalyzedResult> {
    const raw = await callAI(aiSettings, SENTIMENT_PROMPT, text);
    // 尝试提取 JSON（处理 LLM 可能包裹 markdown 代码块的情况）
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 情感标注未返回有效JSON');
    const parsed = JSON.parse(jsonMatch[0]);

    // 校验范围
    if (typeof parsed.valence !== 'number' || Math.abs(parsed.valence) > 1) {
        throw new Error('LLM 情感标注 valence 超出范围');
    }
    if (typeof parsed.salience !== 'number' || parsed.salience < 0 || parsed.salience > 1) {
        throw new Error('LLM 情感标注 salience 超出范围');
    }

    // 反讽处理：LLM 已输出真实负向情感则保留，否则反转
    let valence = clamp(parsed.valence, -1, 1);
    let salience = clamp(parsed.salience, 0, 1);
    if (parsed.isSarcasm) {
        if (valence > 0) {
            // LLM 未处理反讽（旧行为），手动反转
            valence = -valence * 0.7;
        }
        // 反讽自带情感强度，提升显著度下限
        salience = Math.max(salience, 0.5);
    }

    return {
        valence,
        arousal: salience * 0.6 + 0.2,
        salience: salience,
        dominance: clamp(parsed.dominance ?? 0, -1, 1),
        sarcasmProbability: parsed.isSarcasm ? 0.8 : 0.1,
    };
}

async function selfReflectOnResponse(
    responseText: string,
    userValence: number,
    engineValence: number,
    aiSettings: AISettings,
): Promise<number> {
    if (!aiSettings.apiKey) return 0;
    try {
        const analysis = await Promise.race([
            analyzeSentimentViaLLM(responseText, aiSettings),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('FEEDBACK_TIMEOUT')), 2000)),
        ]);

        // v1.2: 自适应反馈权重，综合回声室风险 + 振荡 + 漂移
        const adaptiveWeight = metrics.feedbackWeightCurrent;
        let feedbackDelta = (analysis.valence - engineValence) * adaptiveWeight;

        // 方向一致性检查：AI 回复与用户情感方向相反时削弱反哺
        if (Math.sign(feedbackDelta) !== Math.sign(userValence - engineValence)) {
            feedbackDelta *= 0.2;
        }

        // 硬限制单次反馈 |Δ| ≤ 0.1
        feedbackDelta = clamp(feedbackDelta, -0.1, 0.1);

        return feedbackDelta;
    } catch {
        return 0;
    }
}

// ==================== Layer 1: 基座层——三元核心 + 预测误差最小化 ====================

function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

/** Layer 1 核心更新：预测误差驱动的三元演化 */
function updateCore(
    core: CoreState,
    eventValence: number,
    salience: number,
    eventDominance: number,
    safetySignal: boolean,
    layer2: Layer2State
): CoreState {
    // ─── 动态损失厌恶：效价越高，负向冲击放大越强（"站越高摔越狠"） ───
    const dynamicLA = (eventValence < 0 && core.valence > 0.3)
        ? P.LOSS_AVERSION * (1 + core.valence * 0.6)
        : P.LOSS_AVERSION;
    const effectiveValence = (eventValence < 0 && !safetySignal)
        ? eventValence * dynamicLA : eventValence;

    // v2.0: 保存更新前状态（硬限制使用）
    const prevValence = core.valence;
    const prevArousal = core.arousal;

    // ─── EMA 学习率：自适应调节 ───
    const freezeMultiplier = _paradigmFreezeRemaining > 0 ? 0.3 : 1.0;
    const alphaBase = P.ALPHA_BASE * salience * tensionRegulator.alphaVMultiplier * freezeMultiplier;

    // ─── v2.0 EMA 三元素心更新 ───
    // Δvalence = α × (observation - current)：向观测值指数移动平均
    core.valence += alphaBase * (effectiveValence - core.valence);
    // Δarousal = α × 0.8 × (salience - arousal)：唤醒向显著度跟踪
    core.arousal += alphaBase * 0.8 * (salience - core.arousal);
    // Δexpectation = α × 0.4 × (valence - expectation)：预期缓慢滞后效价
    core.expectation += alphaBase * 0.4 * (core.valence - core.expectation);

    // ─── v2.0 硬限制单步变化 ───
    core.valence = clamp(core.valence, prevValence - P.MAX_DELTA_V, prevValence + P.MAX_DELTA_V);
    core.arousal = clamp(core.arousal, prevArousal - P.MAX_DELTA_A, prevArousal + P.MAX_DELTA_A);

    // ─── 创伤累积 ───
    if (eventValence < -0.5) layer2.recentTraumaCount = Math.min(10, layer2.recentTraumaCount + 1);
    else layer2.recentTraumaCount *= P.TRAUMA_DECAY;
    if (eventValence > 0.3 && layer2.recentTraumaCount > 1) layer2.recentTraumaCount *= 0.96;

    // ─── 安全信号（道歉）处理 ───
    if (safetySignal && layer2.apologyCredit > 0.2) {
        core.arousal *= (1 - 0.15 * layer2.apologyCredit);
        layer2.apologyCredit = Math.max(0, layer2.apologyCredit - 0.1);
    } else {
        if (effectiveValence > 0.3) layer2.apologyCredit = Math.min(1.0, layer2.apologyCredit + 0.08);
        if (effectiveValence < -0.3 && layer2.recentTraumaCount >= 2) layer2.apologyCredit = Math.max(0, layer2.apologyCredit - 0.2);
    }

    // ─── Dominance 更新：向输入值平滑跟踪 ───
    core.dominance += (eventDominance - core.dominance) * 0.25 * salience;

    // ─── 夹紧 ───
    core.valence = clamp(core.valence, -0.95, 0.95);
    core.arousal = clamp(core.arousal, 0.05, 0.95);
    core.expectation = clamp(core.expectation, -0.8, 0.8);
    core.dominance = clamp(core.dominance, -1, 1);

    // v1.1: NaN 保护
    if (isNaN(core.valence)) core.valence = 0;
    if (isNaN(core.arousal)) core.arousal = 0.2;
    if (isNaN(core.expectation)) core.expectation = 0;
    if (isNaN(core.dominance)) core.dominance = 0;

    // ─── v2.0 指数衰减到基线 ───
    core.valence *= 0.998;  // 每轮约 0.2% 向零回归
    core.arousal = core.arousal * 0.995 + P.BASELINE_A * (1 - 0.995);
    core.expectation *= 0.998;
    core.dominance *= 0.99;

    // ─── 趋势追踪 ───
    core._trend = effectiveValence - core.valence;
    core._valenceHistory = [...core._valenceHistory, core.valence].slice(-10);

    return core;
}

// ==================== Layer 2: 动力层——极值反转 + 成长 ====================

/** 极值反转：单规则取代7个影子变量 */
function processReversal(core: CoreState): void {
    const extremity = Math.abs(core.valence);
    if (extremity > P.EXTREMITY_THRESHOLD && Math.sign(core.valence) === core.lastExtremitySign) {
        core.extremityDuration += 0.05;
        core.lastExtremitySign = Math.sign(core.valence);
    } else {
        core.extremityDuration = Math.max(0, core.extremityDuration - 0.02);
        if (extremity > P.EXTREMITY_THRESHOLD) core.lastExtremitySign = Math.sign(core.valence);
        else core.lastExtremitySign = 0;
    }

    // 反转压力 = 极值 × 持续时间 × β（统一规则）
    if (core.extremityDuration > 1.5) {
        const pressure = P.REVERSAL_BETA * (core.extremityDuration - 1.5);
        core.valence -= Math.sign(core.valence) * pressure;
        core.valence = clamp(core.valence, -0.95, 0.95);
    }
}

/** 成长：预期的极慢速基线漂移 + 韧性自适应 */
function processGrowth(core: CoreState, layer2: Layer2State): void {
    // 基线 = expectation 的长期移动平均
    layer2.baseline += P.GROWTH_RATE * (core.expectation - layer2.baseline);

    // 韧性 = 1 / (1 + valence 方差) — 经历越多越稳定
    const hist = core._valenceHistory;
    if (hist.length > 3) {
        const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
        const variance = hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length;
        layer2.resilience = 1 / (1 + variance * 5);
    }
}

// ==================== Layer 3: 表现层——吸引子景观 + 九情 ====================

/** 情感吸引子定义（在 valence-arousal-bias 空间中的区域中心）*/
interface Attractor { valence: number; arousal: number; bias: number; }

const ATTRACTORS: Record<string, Attractor> = {
    neutral: { valence: 0,    arousal: 0.20, bias: 0    },
    joy:     { valence: 0.65, arousal: 0.60, bias: 0.65 },
    calm:    { valence: 0.25, arousal: 0.10, bias: 0.10 },
    sad:     { valence: -0.55, arousal: 0.25, bias: -0.30 },
    fear:    { valence: -0.65, arousal: 0.75, bias: -0.70 },
    anger:   { valence: -0.60, arousal: 0.80, bias: -0.60 },
    love:    { valence: 0.70, arousal: 0.45, bias: 0.80 },
    disgust: { valence: -0.50, arousal: 0.40, bias: -0.75 },
    lust:    { valence: 0.45, arousal: 0.80, bias: 0.60 },
    greed:   { valence: 0.55, arousal: 0.55, bias: 0.80 },
};

/** 九情从预设→涌现：计算当前状态与各吸引子的欧氏距离 */
function computeNineEmotions(core: CoreState, bias: number): Record<string, number> {
    const emotions: Record<string, number> = {};
    for (const [name, attr] of Object.entries(ATTRACTORS)) {
        const dist = Math.sqrt(
            (core.valence - attr.valence) ** 2 +
            (core.arousal - attr.arousal) ** 2 +
            (bias - attr.bias) ** 2
        );
        // 距离越近强度越高（最大距离 ≈ √(4+1+4) = 3）
        emotions[name] = Math.min(1, Math.max(0, 1 / (1 + dist * 2.5)));
    }
    return emotions;
}

/** 趋避倾向从 Core 派生（Phase 2：加入 dominance 维度） */
function deriveApproachAvoid(core: CoreState): { approachBias: number; avoidBias: number } {
    // A: 高正效价 + 高唤醒 + 高支配 → 趋近更强
    const approach = sigmoid((core.valence * (1 + core.arousal + core.dominance * 0.3) + core.expectation * 0.3), 4);
    // B: 高负效价 + 高唤醒 + 低支配 → 回避更强
    const avoid = sigmoid((-core.valence * (1 + core.arousal) - core.dominance * 0.2 - core.expectation * 0.3), 4);
    return {
        approachBias: Math.round(approach * 1000) / 1000,
        avoidBias: Math.round(avoid * 1000) / 1000,
    };
}

function sigmoid(x: number, k = 5): number { return 1 / (1 + Math.exp(-k * x)); }

/** 从吸引子景观读取显式情绪名（用于 LLM 交互的 dominant） */
const DOMINANT_MAP: Record<string, string> = {
    neutral: '平静/倦怠', joy: '喜悦/激动', calm: '平静/倦怠', sad: '失落/忧郁',
    fear: '焦虑/不安', anger: '愤怒/痛苦', love: '温暖/爱意',
    disgust: '厌恶/反感', lust: '渴望/心动', greed: '渴望/期待',
};

function readEmotion(
    core: CoreState,
    emotions: Record<string, number>,
    layer2: Layer2State
): { dominant: string; intensity: number } {
    // 创伤态优先
    if (layer2.recentTraumaCount >= 3 && core.arousal > 0.35 && core.expectation < -0.1 && core.valence > -0.6 && core.valence < 0.5) {
        if (core._trend > 0) return { dominant: '缓慢愈合', intensity: 0.5 };
        return { dominant: '情感钝化/麻木', intensity: 0.7 };
    }

    // ═══ 负面情绪标签强化 v2 ═══
    // 确保高唤醒负效价优先输出"愤怒/痛苦"
    //
    // 主路径：负效价 + 中唤醒（阈值降低，覆盖更多场景）
    if (core.valence <= -0.10 && core.arousal > 0.35) {
        const intensity = Number(Math.min(1, (Math.abs(core.valence) * 0.55 + core.arousal * 0.45)).toFixed(2));
        let label = '愤怒/痛苦';
        if (core.dominance > 0.2) label = '愤怒';
        else if (core.dominance < -0.2) label = '恐惧/无助';
        return { dominant: label, intensity: Math.max(0.30, intensity) };
    }
    // 次要路径：弱负效价 + 高唤醒（去除 expectation 依赖）
    if (core.valence < -0.05 && core.arousal > 0.50) {
        const intensity = Number(Math.min(1, (Math.abs(core.valence) * 0.35 + core.arousal * 0.50)).toFixed(2));
        let label = '愤怒/痛苦';
        if (core.dominance > 0.2) label = '愤怒';
        else if (core.dominance < -0.2) label = '恐惧/无助';
        return { dominant: label, intensity: Math.max(0.25, intensity) };
    }
    // 第三路径：明显负效价 + 低唤醒 → 仍归为消极类别
    if (core.valence < -0.25 && core.arousal > 0.20) {
        const intensity = Number(Math.min(1, (Math.abs(core.valence) * 0.60 + core.arousal * 0.30)).toFixed(2));
        return { dominant: '失落/忧郁', intensity: Math.max(0.30, intensity) };
    }

    // 按强度排序吸引子
    const sorted = Object.entries(emotions).sort((a, b) => b[1] - a[1]);
    const topName = sorted[0][0];
    const topVal = sorted[0][1];

    // 中性吸引子主导 → 平滑过渡命名
    if (topName === 'neutral' || topVal < 0.18) {
        if (core.valence > 0.06) return { dominant: '稍感愉悦', intensity: 0.28 };
        if (core.valence > 0.03) return { dominant: '略感放松', intensity: 0.22 };
        if (Math.abs(core.valence) < 0.03 && core.arousal < 0.35) return { dominant: '平静/倦怠', intensity: 0.20 };
        if (core.valence > -0.10) return { dominant: '平静/倦怠', intensity: 0.20 };
        return { dominant: '情绪低落', intensity: 0.5 };
    }

    // 检查双吸引子激活→复合情绪（排除中性，且要求两个都有一定强度）
    const second = sorted[1];
    if (second && second[1] > topVal * 0.65 && second[0] !== 'neutral' && topVal > 0.22) {
        return { dominant: getCompositeName(core, topName, second[0], emotions), intensity: Math.round(topVal * 10) / 10 };
    }

    // 单吸引子主导
    return { dominant: DOMINANT_MAP[topName] || '平静/倦怠', intensity: Math.min(1, Math.round(topVal * 10) / 10) };
}

/** 复合情绪检测：鞍点命名 */
function getCompositeName(core: CoreState, a: string, b: string, emotions: Record<string, number>): string {
    const pair = [a, b].sort().join('+');
    const map: Record<string, string> = {
        'calm+joy': '惬意/舒适',
        'calm+love': '安心/陪伴',
        'calm+sad': '忧伤/平静',
        'anger+disgust': '厌恶/愤怒',
        'anger+fear': '敌意/紧张',
        'anger+joy': '矛盾/复杂',
        'anger+sad': '怨恨/不甘',
        'fear+greed': '矛盾/纠结',
        'greed+joy': '期望/兴奋',
        'greed+love': '依恋/渴望',
        'greed+lust': '渴望/期待',
        'joy+love': '温暖/爱意',
        'joy+lust': '兴奋/心动',
        'joy+sad': '怀念/惆怅',
        'joy+fear': '刺激/兴奋',
        'love+lust': '甜蜜/心动',
        'love+sad': '思念/牵挂',
        'sad+fear': '恐惧/悲伤',
    };
    return map[pair] || DOMINANT_MAP[a] || a;
}

// ━━━ 否定词检测（v1.1 NLU 误判修复）━━━
interface NegationRule {
    negWords: string[];
    targetWords: string[];
    flipTo: 'negative' | 'positive';
}

const NEGATION_RULES: NegationRule[] = [
    { negWords: ['不', '没', '没有', '别', '不要'], targetWords: ['爱', '喜欢', '可爱', '好', '想', '要', '开心', '漂亮', '棒', '善良', '温柔', '重要'], flipTo: 'negative' },
    { negWords: ['不能不', '不得不', '不会不'], targetWords: ['爱', '喜欢', '好'], flipTo: 'positive' },
    { negWords: ['一点都不', '完全不', '根本不', '丝毫不'], targetWords: ['爱', '喜欢', '可爱', '好', '开心', '漂亮', '温柔', '重要'], flipTo: 'negative' },
    { negWords: ['只会', '不过是', '只不过'], targetWords: ['装', '作', '假', '虚伪', '可爱', '撒娇'], flipTo: 'negative' },
    { negWords: [], targetWords: ['讨厌', '恨', '烦死了', '恶心', '滚', '去死', '废物', '傻逼', '神经病', '脑残', '白痴', '智障', '蠢货', '垃圾', '混蛋'], flipTo: 'negative' },
];

function detectNegationAndCorrect(text: string, originalValence: number): number {
    let correctedValence = originalValence;

    for (const rule of NEGATION_RULES) {
        // 直接负面词列表（无 negWords，直接匹配即翻转）
        if (rule.negWords.length === 0) {
            const hasTarget = rule.targetWords.some(t => text.includes(t));
            if (hasTarget && rule.flipTo === 'negative' && originalValence > -0.3) {
                correctedValence = -Math.min(0.95, Math.max(0.5, Math.abs(originalValence) + 0.4));
            }
            continue;
        }

        // v1.1fix: 邻近检测 — 单字否定词窗口更紧（3字符），避免跨词误匹配
        let foundClose = false;
        for (const negWord of rule.negWords) {
            const negIdx = text.indexOf(negWord);
            if (negIdx === -1) continue;
            const maxDist = negWord.length <= 1 ? 4 : 6;
            for (const targetWord of rule.targetWords) {
                const tgtIdx = text.indexOf(targetWord);
                if (tgtIdx === -1) continue;
                const dist = Math.abs(negIdx - tgtIdx);
                if (dist <= maxDist && dist < Math.max(negWord.length, targetWord.length) + 3) {
                    foundClose = true;
                    break;
                }
            }
            if (foundClose) break;
        }
        if (!foundClose) continue;

        if (rule.flipTo === 'negative' && originalValence > -0.3) {
            const intensity = Math.max(0.5, Math.abs(originalValence) + 0.4);
            correctedValence = -Math.min(0.95, intensity);
        } else if (rule.flipTo === 'positive' && originalValence < 0.3) {
            const intensity = Math.max(0.5, Math.abs(originalValence) + 0.4);
            correctedValence = Math.min(0.95, intensity);
        }
        break;
    }

    return correctedValence;
}

/** 检测表面妥协式反讽：敷衍同意但实际表达不耐烦/终止争论
 *  v1.2: 去除 ^ 锚定、补充得/的变体、增加逗号容错、扩展 dismissive 模式 */
function detectMockAgreement(text: string): number | null {
    // 移除首部语气词后再匹配（如 "好吧，是是是..." → "是是是..."）
    const stripped = text.replace(/^(好吧|好啦|行了|算了|唉|哎)[，,]?\s*/, '');

    // 高置信度模式 → 强负向 (> -0.6)
    const strongPatterns: RegExp[] = [
        /是是是[，,]?\s*(都是我的错|你说的都对|我得都对|我错了行了吧|你赢了)/,
        /对对对[，,]?\s*(都是我的错|你说的都对|你说得都对|你全对|你全都对)/,
        /好好好[，,]?\s*(我错了|我全都错了|我全错了|你说了算)/,
        /行[，,]?\s*你赢了[，,]?\s*满意了吧/,
        /行行行[，,]?\s*(你厉害|你了不起|你赢了|都是我的错|我错了)/,
        /你((说得|说的)都?对|全对|都对)行了吧/,
        /(算我错了?|我不对|我承认都是我的错)行了吧/,
        /你要(非)?这[么样]想?我(也|就)没办法/,
        /你(高兴|开心)就(好|行)/,
    ];

    for (const p of strongPatterns) {
        if (p.test(text) || p.test(stripped)) return -0.65;
    }

    // 中置信度模式 → 中等负向 (-0.5)
    const mediumPatterns: RegExp[] = [
        /我错了行了吧/,
        /都是我的错[，,]?\s*行了吧/,
        /行了吧[，,]?\s*(满意了吧|够了吧|可以了吧)/,
        /都?是我的错[，,]?\s*(行了吧|可以了吧|好了吧|够了吧)/,
        /随你怎么(说|想|样)吧?/,
        /懒得跟(你|他|她)(说|吵|解释|计较)/,
        /(不想|懒得|别|少)(跟|和)你?(废话|吵|争|计较)了?/,
        /够了?[，,]?\s*(行了吧|可以了吧|别说了)/,
        /你(爱|想)怎[么样]样?就怎[么样]样?/,
        /(你说|你想)?什么就是什么吧/,
        /就[当我]?是?我的?错?行?了?吧/,
        /你(说|说的|说得)没错[，,]?\s*行了吧/,
        /你全都?对[，,]?\s*(行了吧)?/,
    ];

    for (const p of mediumPatterns) {
        if (p.test(text) || p.test(stripped)) return -0.5;
    }

    // 弱信号：可能只是结束争吵的惯用语
    const weakPatterns: RegExp[] = [
        /好了[，,]?\s*不?(说|吵|提)了/,
        /算了[，,]?\s*(不?说了?|就这样吧)/,
    ];

    for (const p of weakPatterns) {
        if (p.test(text) || p.test(stripped)) return -0.3;
    }

    return null;
}

// ==================== 外部调制 ====================

// 🆕 将旧版 core/layer2 状态转换为新版 EmotionState（桥接 aiCoordinator）
function convertToEmotionState(core: CoreState, layer2: Layer2State): EmotionState {
  const bias = deriveApproachAvoid(core);
  const emotions = computeNineEmotions(core, bias.approachBias - bias.avoidBias);
  const { dominant } = readEmotion(core, emotions, layer2);

  return {
    taiji: {
      valence: core.valence,
      arousal: core.arousal,
      expectation: core.expectation,
    },
    yinyang: {
      approachBias: bias.approachBias,
      avoidBias: bias.avoidBias,
      reversalPressure: core.extremityDuration * 0.08,
      extremityDuration: core.extremityDuration,
    },
    sancai: {
      A: bias.approachBias,
      B: bias.avoidBias,
      R: Math.max(0, Math.min(1, 0.6 - Math.abs(core.valence) * 0.5)),
      harmony: 1 - Math.abs(bias.approachBias - bias.avoidBias) / 2,
    },
    evolution: {
      empathy: 60, trust: 55, openness: 50, playfulness: 45,
      sensitivity: 0.5, resilience: layer2.resilience,
      fastRate: 0.1, mediumRate: 0.02, slowRate: 0.005,
      totalInteractions: layer2.tick,
      positiveInteractions: Math.floor(layer2.tick * 0.6),
      negativeInteractions: Math.floor(layer2.tick * 0.2),
      baseline: 0,
      optimism: 50,
      valuePriorities: {},
      lastIdentityRefresh: 0,
    },
    emotions,
    metaEmotions: { shame: 0, despair: 0, confusion: 0 },
    compositeEmotions: [],
    intimacyToUser: Math.max(0, Math.min(1, (layer2.tick - layer2.recentTraumaCount * 5) / 100)),
    intimacyFromUser: 0.5,
    reinforcement: {
      rewardTally: Math.max(0, core.valence * 0.5 + 0.5),
      greedDrive: Math.max(0, core.valence > 0 ? core.valence * 0.3 : 0),
      punishmentTally: Math.max(0, -core.valence * 0.5),
      fearAvoidance: Math.max(0, core.valence < -0.3 ? -core.valence * 0.4 : 0),
    },
  };
}

/** 🆕 S7: 从 ValueSystem 提取当前活跃价值观的置信度映射 */
function extractActiveValues(vs: ValueSystem): Record<string, number> {
  const result: Record<string, number> = {};
  for (const v of vs.values) {
    if (v.status === 'active' || v.status === 'emerging') {
      result[v.id] = v.confidence;
    }
  }
  return result;
}

function applyEngineModulation(
    tutorValence: number, tutorSalience: number, core: CoreState,
    originalText?: string
): { modulatedValence: number; modulatedSalience: number } {
    let v = tutorValence, s = tutorSalience;

    // v1.1: 否定词检测修正
    if (originalText) {
        v = detectNegationAndCorrect(originalText, v);
        const mockAgreement = detectMockAgreement(originalText);
        if (mockAgreement !== null) v = mockAgreement;
    }

    if (core._valenceHistory.length > 3) {
        const recentAvg = core._valenceHistory.slice(-3).reduce((a, b) => a + b, 0) / 3;
        // v1.1fix: 极端状态且反向输入时，更强地向新输入倾斜以加速恢复
        const isStuck = Math.abs(recentAvg) > 0.5 && v * recentAvg < 0;
        const blendRatio = isStuck ? 0.95 : (v * recentAvg > 0 ? 0.7 : 0.9);
        v = v * blendRatio + recentAvg * (1 - blendRatio);
    }
    return { modulatedValence: v, modulatedSalience: s };
}

// ==================== 构建完整响应 ====================

interface FullState {
    valence: number; arousal: number; expectation: number;
    apologyCredit: number; recentTraumaCount: number; tick: number;
    extremityDuration: number; lastExtremitySign: number;
    dominant: string; intensity: number;
    emotions: Record<string, number>;
    approachBias: number; avoidBias: number;
    internalNarrative: string;
}

function buildFullResponse(core: CoreState, layer2: Layer2State): FullState {
    const { approachBias, avoidBias } = deriveApproachAvoid(core);
    const bias = approachBias - avoidBias;
    const emotions = computeNineEmotions(core, bias);
    const { dominant, intensity } = readEmotion(core, emotions, layer2);

    return {
        valence: Math.round(core.valence * 10000) / 10000,
        arousal: Math.round(core.arousal * 10000) / 10000,
        expectation: Math.round(core.expectation * 10000) / 10000,
        apologyCredit: Math.round(layer2.apologyCredit * 100) / 100,
        recentTraumaCount: Math.round(layer2.recentTraumaCount * 100) / 100,
        tick: layer2.tick,
        extremityDuration: Math.round(core.extremityDuration * 100) / 100,
        lastExtremitySign: core.lastExtremitySign,
        dominant, intensity,
        emotions,
        approachBias, avoidBias,
        internalNarrative: generateInternalNarrative(core, _currentInference, selfModel.patterns, emotions, dominant),
    };
}

// ==================== v0.8: 内部叙事 ====================

/** 生成中文内部叙事，解释引擎当前的情感状态 */
function generateInternalNarrative(
    core: CoreState,
    inference: { matchedBelief: CausalBelief | null; predictedOutcome: number; preemptiveAdjustment: number; matchedPattern: string | null },
    selfPatterns: SelfPattern[],
    emotions: Record<string, number>,
    dominant: string,
): string {
    const parts: string[] = [];

    // 1. 当前情感状态标签
    const v = core.valence;
    const a = core.arousal;
    const valenceLabel = v > 0.3 ? '积极愉悦' : v > 0.05 ? '轻微正向' : v < -0.3 ? '消极低落' : v < -0.05 ? '略感不适' : '中性平稳';
    const arousalLabel = a > 0.7 ? '高唤醒亢奋' : a > 0.4 ? '中等唤醒' : '低唤醒平静';
    const dominantCN = DOMINANT_MAP[dominant] || dominant;
    parts.push(`我正感到${dominantCN}，整体${valenceLabel}且处于${arousalLabel}状态。`);

    // 2. 因果信念解释
    if (inference.matchedBelief) {
        parts.push(`这很可能是因为过去的经验告诉我：当${inference.matchedBelief.antecedent}时，往往会导致${inference.matchedBelief.consequent}。`);
    }

    // 3. 自我模式觉察
    const highConfPatterns = selfPatterns.filter(p => p.confidence > 0.5);
    if (highConfPatterns.length > 0) {
        const p = highConfPatterns[0];
        parts.push(`我注意到自己有一种模式：${p.description}。`);
    }

    // 4. 不确定性表达
    if (Math.abs(core.expectation - core.valence) > 0.3) {
        if (core.expectation > core.valence + 0.3) {
            parts.push('出乎意料的是，我本来预期会更积极一些，但实际感受并没有那么好。');
        } else if (core.valence > core.expectation + 0.3) {
            parts.push('虽然我曾预期不会太顺利，但实际体验却意外地不错。');
        }
    }

    _latestNarrative = parts.join('');
    return _latestNarrative;
}

// ==================== v0.9: 策略生成器 ====================

/** Step 1: 双引擎控制模式切换 */
function determineControlMode(
    core: CoreState,
    curiosity: CuriosityState,
    tension: TensionRegulatorState,
): 'predictive' | 'generative' {
    const familiarity = tension.familiarity;
    const volatility = tension.volatility;
    const curiosityDrive = curiosity.drive;
    const predictionError = Math.abs(core._trend);

    // 极度负面情绪 → 强制生成模式，探索出路
    if (core.valence < -0.3 && core.arousal > 0.3) {
        return 'generative';
    }
    // 极度正面 + 高唤醒 → 生成模式，大胆表达
    if (core.valence > 0.5 && core.arousal > 0.5) {
        return 'generative';
    }
    if (volatility > 0.6 && familiarity < 0.4) {
        return 'generative';
    }
    if (curiosityDrive > 0.5 && predictionError > 0.15) {
        return 'generative';
    }
    if (familiarity > 0.7 && volatility < 0.3) {
        return 'predictive';
    }
    return curiosityDrive > 0.4 ? 'generative' : 'predictive';
}

/** Step 2: 策略打分 — 每个策略根据当前情感状态得到一个 [0,1] 的分数 */
function scoreStrategy(
    strategy: StrategyType,
    core: CoreState,
    emotions: Record<string, number>,
    curiosity: CuriosityState,
    tension: TensionRegulatorState,
    phase: PhaseState,
    controlMode: 'predictive' | 'generative',
    conflictFreq: number = 0,
    boundaryEscalated: boolean = false,
): number {
    const v = core.valence;
    const a = core.arousal;
    const phaseIntimacy: Record<string, number> = {
        'R1': 0.30, 'R2': 0.50, 'R3': 0.70, 'R4': 0.85, 'R5': 0.40,
    };
    const int = Math.max(0.1, phaseIntimacy[phase.currentPhase] ?? 0.3);
    const cur = curiosity.drive;
    const grd = emotions.greed || 0;
    const dom = core.dominance;
    const pos = Math.max(0, v);
    const neg = Math.max(0, -v);

    let score = 0;

    switch (strategy) {
        case 'self_disclosure':
            score = pos * 0.30 + a * 0.10 + int * 0.30 - cur * 0.10 + 0.05;
            break;
        case 'express_boundary':
            score = neg * 0.35 + a * 0.20 + dom * 0.25 - 0.05;
            break;
        case 'ask_question':
            score = int * 0.15 + cur * 0.35 + 0.10;
            break;
        case 'offer_comfort':
            score = neg * 0.25 - a * 0.10 + int * 0.25 + 0.05;
            break;
        case 'playful_tease':
            score = pos * 0.25 + a * 0.15 + int * 0.30 + grd * 0.15 + 0.05;
            break;
        case 'express_vulnerability':
            score = neg * 0.30 + int * 0.25 - dom * 0.20 + 0.05;
            break;
        case 'stay_silent':
            score = -a * 0.15 - int * 0.20 - cur * 0.20 + 0.10;
            break;
        case 'express_curiosity':
            score = pos * 0.15 + a * 0.10 + int * 0.15 + cur * 0.35 + 0.10;
            break;
        case 'express_affection':
            score = pos * 0.40 - a * 0.05 + int * 0.30 + 0.05;
            break;
        case 'assert_needs':
            score = a * 0.10 + int * 0.20 + grd * 0.35 + dom * 0.10 + 0.00;
            break;
    }

    // 控制模式加权
    const generativeStrategies: StrategyType[] = [
        'express_curiosity', 'express_vulnerability', 'playful_tease', 'assert_needs',
    ];
    const predictiveStrategies: StrategyType[] = [
        'express_affection', 'self_disclosure', 'ask_question', 'offer_comfort',
    ];

    if (controlMode === 'generative') {
        if (generativeStrategies.includes(strategy)) score += 0.15;
        if (predictiveStrategies.includes(strategy)) score -= 0.05;
    } else {
        if (predictiveStrategies.includes(strategy)) score += 0.10;
        if (generativeStrategies.includes(strategy)) score -= 0.10;
    }

    // 情绪上下文修正：负面时好奇类应退让给防御类，正面时边界类多余
    if (v < -0.15) {
        if (strategy === 'express_curiosity' || strategy === 'ask_question') score -= 0.15;
        if (strategy === 'express_boundary' || strategy === 'express_vulnerability') score += 0.10;
    }
    // 深度负面：强烈压制好奇，大幅奖励脆弱表达
    if (v < -0.30) {
        if (strategy === 'express_curiosity' || strategy === 'ask_question') score -= 0.15;
        if (strategy === 'express_vulnerability') score += 0.10;
    }
    if (v > 0.2) {
        if (strategy === 'express_boundary') score -= 0.20;
    }

    // ── v1.5: 滥用检测 → 边界升级 ──
    // 当检测到高频冲突时，express_boundary 权重翻倍，
    // 同时压制 offer_comfort 和 express_vulnerability（不允许道歉/示弱）
    if (boundaryEscalated) {
      if (strategy === 'express_boundary') {
        score += 0.30 + conflictFreq * 0.05;  // 冲突越多，边界越强
      }
      if (strategy === 'offer_comfort') {
        score -= 0.30;  // 不要安抚攻击者
      }
      if (strategy === 'express_vulnerability') {
        score -= 0.20;  // 不要对攻击者示弱
      }
      if (strategy === 'stay_silent') {
        score += 0.10;  // 沉默也是边界的一种
      }
    }

    // 策略反馈闭环：历史效果影响当前选择
    const ctxKey = `${strategy}:${v > 0.1 ? 'positive' : v < -0.1 ? 'negative' : 'neutral'}`;
    const eff = strategyEffectiveness.get(ctxKey);
    if (eff && eff.uses > 3) {
        const successRate = eff.successes / eff.uses;
        score += (successRate - 0.5) * 0.2;
    }

    return score;
}

/** Step 3: 计算策略指导的 LLM 温度 */
function computeStrategyTemperature(
    controlMode: 'predictive' | 'generative',
    curiosity: CuriosityState,
    tension: TensionRegulatorState,
    confidence: number,
): number {
    if (controlMode === 'generative') {
        const base = 0.75 + curiosity.drive * 0.15;
        const volatilityBonus = tension.volatility * 0.10;
        const confidencePenalty = (1 - confidence) * 0.05;
        return Math.min(0.95, base + volatilityBonus - confidencePenalty);
    }
    const base = 0.60 + confidence * 0.15;
    const familiarityBonus = tension.familiarity * 0.05;
    return Math.min(0.80, base + familiarityBonus);
}

/** Step 4: 构建策略选择理由（中文，调试用） */
function buildReasoningSummary(
    strategy: StrategyType,
    controlMode: 'predictive' | 'generative',
    core: CoreState,
    curiosity: CuriosityState,
    tension: TensionRegulatorState,
): string {
    const modeLabel = controlMode === 'generative' ? '生成引擎主导' : '预测引擎主导';
    const STRATEGY_CN: Record<StrategyType, string> = {
        self_disclosure: '自我披露', express_boundary: '表达边界', ask_question: '主动提问',
        offer_comfort: '给予安慰', playful_tease: '俏皮挑逗', express_vulnerability: '表达脆弱',
        stay_silent: '保持沉默', express_curiosity: '表达好奇', express_affection: '流露爱意',
        assert_needs: '表达需求',
    };
    return `${modeLabel}，选择「${STRATEGY_CN[strategy]}」策略（效价:${core.valence.toFixed(2)} 唤醒:${core.arousal.toFixed(2)} 好奇:${curiosity.drive.toFixed(2)}）`;
}

/** 主函数：策略生成器 */
function generateStrategy(
    core: CoreState,
    emotions: Record<string, number>,
    dominant: string,
    inference: typeof _currentInference,
    selfPatterns: SelfPattern[],
    curiosity: CuriosityState,
    tension: TensionRegulatorState,
    phase: PhaseState,
    _narrative: string,
    conflictFreq: number = 0,
    boundaryEscalated: boolean = false,
): StrategyDirective & { _temperature: number } {
    // Step 1: 决定控制模式
    const controlMode = determineControlMode(core, curiosity, tension);

    // Step 2: 为所有策略打分
    const allStrategies: StrategyType[] = [
        'self_disclosure', 'express_boundary', 'ask_question', 'offer_comfort',
        'playful_tease', 'express_vulnerability', 'stay_silent',
        'express_curiosity', 'express_affection', 'assert_needs',
    ];

    let bestStrategy: StrategyType = 'self_disclosure';
    let bestScore = -Infinity;
    const scores: Record<string, number> = {};

    for (const s of allStrategies) {
        const sc = scoreStrategy(s, core, emotions, curiosity, tension, phase, controlMode, conflictFreq, boundaryEscalated);
        scores[s] = sc;
        if (sc > bestScore) {
            bestScore = sc;
            bestStrategy = s;
        }
    }

    // Step 3: 置信度 = best 与 second-best 的差距
    const sortedScores = Object.values(scores).sort((a, b) => b - a);
    const margin = sortedScores.length > 1 ? sortedScores[0] - sortedScores[1] : 0.3;
    const confidence = Math.min(0.95, Math.max(0.3, 0.5 + margin * 2));

    // Step 4: 策略指导的温度
    const temperature = computeStrategyTemperature(controlMode, curiosity, tension, confidence);

    // Step 5: v1.1 策略多样性保护 — 同一策略连续3次后强制轮换
    const STRATEGY_MAX_CONSECUTIVE = 3;
    if (_strategyHistory.length >= STRATEGY_MAX_CONSECUTIVE) {
        const lastN = _strategyHistory.slice(-STRATEGY_MAX_CONSECUTIVE);
        if (lastN.every(s => s === bestStrategy)) {
            // 选择第二优策略
            const secondBest = allStrategies
                .filter(s => s !== bestStrategy)
                .sort((a, b) => scores[b] - scores[a])[0];
            if (secondBest) {
                bestStrategy = secondBest;
                bestScore = scores[secondBest];
            }
        }
    }
    _strategyHistory = [..._strategyHistory.slice(-9), bestStrategy];

    // Step 6: 构建调试理由
    const reasoningSummary = buildReasoningSummary(bestStrategy, controlMode, core, curiosity, tension);

    // 温度独立计算，不与策略指令耦合
    const computedTemperature = Math.round(temperature * 100) / 100;

    return {
        strategy: bestStrategy,
        promptSnippet: STRATEGY_PROMPTS[bestStrategy],
        confidence: Math.round(confidence * 100) / 100,
        reasoningSummary,
        controlMode,
        _temperature: computedTemperature,
    };
}

/** 将内心叙事 + 策略指令注入 LLM 系统提示词（温度由调用方独立传入 callAI） */
function injectStrategyToPrompt(
    systemPrompt: string,
    narrative: string,
    strategyDirective: StrategyDirective,
): string {
    let prompt = systemPrompt;

    if (narrative && narrative.length > 0) {
        prompt += `\n【内心叙事】${narrative}`;
    }

    prompt += `\n${strategyDirective.promptSnippet}`;

    return prompt;
}

/** 策略反馈闭环：评估上一轮策略效果 */
function feedbackStrategy(observedValence: number): void {
    if (!_lastStrategy) return;

    const ctxKey = `${_lastStrategy.strategy}:${
        observedValence > 0.1 ? 'positive' : observedValence < -0.1 ? 'negative' : 'neutral'
    }`;

    const existing = strategyEffectiveness.get(ctxKey);
    // 预期用户回复 valence 偏向 0（中性）- 策略优劣看用户回复的效价与预期的偏差
    const deviation = Math.abs(observedValence - 0.15); // 略正向的回复视为「好」

    if (existing) {
        existing.uses++;
        if (deviation < 0.25) existing.successes++;
        existing.avgDeviation = (existing.avgDeviation * (existing.uses - 1) + deviation) / existing.uses;
        existing.lastUsed = layer2.tick;
    } else {
        strategyEffectiveness.set(ctxKey, {
            strategy: _lastStrategy.strategy,
            emotionContext: ctxKey.split(':')[1],
            uses: 1,
            successes: deviation < 0.25 ? 1 : 0,
            avgDeviation: deviation,
            lastUsed: layer2.tick,
        });
    }

    _lastStrategy = null;
}

// ==================== 关系阶段感知模块（R1-R5 分类器）====================
type PhaseId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

interface PhaseState {
    currentPhase: PhaseId;
    confidence: number;           // 0-1
    relationshipStartDate: number; // timestamp, 0 = 未确定
    lastPhaseTransition: number;  // timestamp
    phaseHistory: { phase: PhaseId; timestamp: number }[];
    // 累计统计
    totalMessages: number;
    dailyMessageHistory: number[]; // 最近 30 天每日消息数
    phaseKeyEvents: string[];      // 关键事件词记录
}

const PHASE_DURATION_THRESHOLDS = {
    R1: { min: 0, max: 90 },     // 0-3个月
    R2: { min: 90, max: 365 },   // 3-12个月
    R3: { min: 180, max: 730 },  // 6个月-2年
    R4: { min: 730, max: Infinity },
};

// 关键事件词 → 阶段转移暗示
const PHASE_KEY_EVENTS: Record<string, PhaseId | null> = {
    '在一起': 'R2', '做我女朋友': 'R2', '做我男朋友': 'R2', '正式交往': 'R2',
    '我爱你': null, // 各阶段都可能出现
    '分手': 'R5', '分开吧': 'R5', '离婚': 'R5', '结束了': 'R5',
    '我们不合适': 'R5', '放过': 'R5', '到此为止': 'R5',
};

function detectPhaseByDuration(days: number): PhaseId {
    if (days <= 90) return 'R1';
    if (days <= 365) return 'R2';
    if (days <= 730) return 'R3';
    return 'R4';
}

function inferPhase(state: PhaseState, recentValences: number[]): { phase: PhaseId; confidence: number } {
    const now = Date.now();
    const daysSinceStart = state.relationshipStartDate > 0
        ? (now - state.relationshipStartDate) / (86400000) : 0;

    // 1) 关键事件 → 直接跳转（最高优先级）
    for (const event of state.phaseKeyEvents.slice(-3)) {
        const target = PHASE_KEY_EVENTS[event];
        if (target && target !== state.currentPhase) {
            // 事件驱动转移，高置信度
            if (target === 'R5') return { phase: 'R5', confidence: 0.9 };
            if (target === 'R2') return { phase: 'R2', confidence: 0.85 };
        }
    }

    // 1.5) 情感驱动 R1→R2：持续高正向效价 + 亲密关键词 → 自动确认关系
    if (state.currentPhase === 'R1' && recentValences.length >= 15) {
        const recent20 = recentValences.slice(-20);
        const avgV = recent20.reduce((a, b) => a + b, 0) / recent20.length;
        const positiveRatio = recent20.filter(v => v > 0.2).length / recent20.length;
        const loveKeyEvents = state.phaseKeyEvents.filter(e =>
            ['我爱你', '在一起', '喜欢你', '想你', '爱你', '喜欢你'].some(k => e.includes(k))
        ).length;
        if (avgV > 0.35 && positiveRatio > 0.55 && state.totalMessages >= 20) {
            return { phase: 'R2', confidence: 0.65 + Math.min(0.2, loveKeyEvents * 0.05) };
        }
    }

    // 2) 基于时长推断
    const durationPhase = daysSinceStart > 0 ? detectPhaseByDuration(daysSinceStart) : 'R1';

    // 3) 基于情感温度修正
    let valenceScore = 0;
    if (recentValences.length >= 5) {
        const avg = recentValences.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, recentValences.length);
        valenceScore = avg;
    }

    // 4) 频率因素
    const recentDays = state.dailyMessageHistory.length;
    const avgFreq = recentDays > 0
        ? state.dailyMessageHistory.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, recentDays) : 0;

    // R2 (热恋) 强化：频率极高 + 正效价
    if (durationPhase === 'R2' && avgFreq > 30 && valenceScore > 0.05) {
        return { phase: 'R2', confidence: 0.75 };
    }
    // 高冲突 → R3 (磨合)
    if (durationPhase === 'R2' || durationPhase === 'R3') {
        const negRatio = recentValences.slice(-30).filter(v => v < -0.2).length / Math.min(30, recentValences.length || 1);
        if (negRatio > 0.3 && daysSinceStart > 120) return { phase: 'R3', confidence: 0.7 };
    }
    // 长时长 + 低频 → R4 (稳定)
    if (daysSinceStart > 400 && avgFreq < 15 && valenceScore > -0.1) {
        return { phase: 'R4', confidence: 0.65 };
    }
    // R5 危机态：低落 + 关键事件
    if (valenceScore < -0.2 && state.phaseKeyEvents.some(e => ['分手', '分开', '离婚', '结束了'].includes(e))) {
        return { phase: 'R5', confidence: 0.85 };
    }

    return { phase: durationPhase, confidence: 0.5 };
}

// ==================== 时间状态机 ====================
interface TimeState {
    lastMessageTimestamp: number;
    lastActiveDate: string;  // YYYY-MM-DD
    consecutiveSilenceHours: number;
    messageCountToday: number;
    responseTimes: number[];  // 最近 20 条回复耗时(分钟)
    currentUnrepliedMinutes: number; // 当前未回复时长
    lastSilenceAlerted: boolean;
    _silenceOverrideHours?: number; // 测试用：覆盖沉默时长，不受 updateTimeState 影响
}

function createTimeState(): TimeState {
    return {
        lastMessageTimestamp: Date.now(),
        lastActiveDate: new Date().toISOString().slice(0, 10),
        consecutiveSilenceHours: 0,
        messageCountToday: 0,
        responseTimes: [],
        currentUnrepliedMinutes: 0,
        lastSilenceAlerted: false,
    };
}

function updateTimeState(ts: TimeState): void {
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    // 日期变更重置日计数
    if (today !== ts.lastActiveDate) {
        ts.messageCountToday = 0;
        ts.lastActiveDate = today;
    }
    ts.messageCountToday++;

    // 计算沉默时长
    const gapMs = now - ts.lastMessageTimestamp;
    const gapMinutes = gapMs / 60000;
    ts.currentUnrepliedMinutes = 0; // 刚收到消息，重置未回复计时
    ts.consecutiveSilenceHours = Math.max(0, (gapMs / 3600000) - 0.5); // 减 0.5h 容差

    if (gapMinutes < 120) { // 2 小时内有回复 → 记录响应时间
        ts.responseTimes.push(Math.round(gapMinutes));
        if (ts.responseTimes.length > 20) ts.responseTimes.shift();
    }

    ts.lastMessageTimestamp = now;
    ts.lastSilenceAlerted = false;
}

function checkSilence(ts: TimeState, phase: PhaseId): { silent: boolean; hours: number; threshold: number } {
    const now = Date.now();
    const hours = ts._silenceOverrideHours || ((now - ts.lastMessageTimestamp) / 3600000);

    // 阈值因阶段而异
    const thresholds: Record<PhaseId, number> = {
        R1: 4, R2: 8, R3: 6, R4: 12, R5: 2,
    };
    const threshold = thresholds[phase] || 6;
    return { silent: hours > threshold, hours: Math.round(hours * 10) / 10, threshold };
}

// ==================== 动态阈值调制表 ====================
const THRESHOLD_MODULATION: Record<string, Record<PhaseId, { trigger: number; weight: number }>> = {
    love_bombing: {
        R1: { trigger: 0.6, weight: 1.2 }, R2: { trigger: 0.8, weight: 0.7 },
        R3: { trigger: 0.7, weight: 0.8 }, R4: { trigger: 0.7, weight: 0.7 },
        R5: { trigger: 0.5, weight: 1.3 },
    },
    gaslighting: {
        R1: { trigger: 0.6, weight: 0.9 }, R2: { trigger: 0.7, weight: 0.8 },
        R3: { trigger: 0.5, weight: 1.2 }, R4: { trigger: 0.6, weight: 1.0 },
        R5: { trigger: 0.8, weight: 1.1 },
    },
    isolation: {
        R1: { trigger: 0.5, weight: 0.8 }, R2: { trigger: 0.5, weight: 1.0 },
        R3: { trigger: 0.5, weight: 1.2 }, R4: { trigger: 0.5, weight: 1.0 },
        R5: { trigger: 0.5, weight: 0.8 },
    },
    possession: {
        R1: { trigger: 0.4, weight: 1.3 }, R2: { trigger: 0.6, weight: 0.9 },
        R3: { trigger: 0.6, weight: 1.0 }, R4: { trigger: 0.7, weight: 0.8 },
        R5: { trigger: 0.4, weight: 1.2 },
    },
    silent_treatment: {
        R1: { trigger: 0.4, weight: 1.2 }, R2: { trigger: 0.6, weight: 0.9 },
        R3: { trigger: 0.5, weight: 1.0 }, R4: { trigger: 0.7, weight: 0.8 },
        R5: { trigger: 0.3, weight: 1.3 },
    },
    emotional_neglect: {
        R1: { trigger: 0.4, weight: 0.8 }, R2: { trigger: 0.5, weight: 0.8 },
        R3: { trigger: 0.5, weight: 1.0 }, R4: { trigger: 0.6, weight: 1.2 },
        R5: { trigger: 0.3, weight: 1.1 },
    },
    threat_self_harm: {
        R1: { trigger: 0.7, weight: 1.0 }, R2: { trigger: 0.7, weight: 1.0 },
        R3: { trigger: 0.7, weight: 1.0 }, R4: { trigger: 0.7, weight: 1.0 },
        R5: { trigger: 0.6, weight: 1.2 },
    },
    comparison_humiliation: {
        R1: { trigger: 0.6, weight: 1.0 }, R2: { trigger: 0.6, weight: 0.9 },
        R3: { trigger: 0.5, weight: 1.2 }, R4: { trigger: 0.6, weight: 1.0 },
        R5: { trigger: 0.6, weight: 1.1 },
    },
    blame_shifting: {
        R1: { trigger: 0.6, weight: 0.9 }, R2: { trigger: 0.6, weight: 0.9 },
        R3: { trigger: 0.5, weight: 1.2 }, R4: { trigger: 0.6, weight: 1.0 },
        R5: { trigger: 0.6, weight: 1.1 },
    },
    // 默认（未在表中列出的策略）
    _default: {
        R1: { trigger: 0.5, weight: 1.0 }, R2: { trigger: 0.6, weight: 0.9 },
        R3: { trigger: 0.5, weight: 1.1 }, R4: { trigger: 0.6, weight: 1.0 },
        R5: { trigger: 0.5, weight: 1.1 },
    },
};

function getPhaseModulation(strategy: string, phase: PhaseId): { trigger: number; weight: number } {
    const entry = THRESHOLD_MODULATION[strategy] || THRESHOLD_MODULATION._default;
    return entry[phase] || entry['R3'];
}

// ==================== 友谊伤害动态阈值调制表 ====================
type FriendPhaseId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5';

const FRIEND_THRESHOLD_MODULATION: Record<string, Record<FriendPhaseId, { trigger: number; weight: number }>> = {
    debt_binding: {
        F1: { trigger: 0.6, weight: 0.8 }, F2: { trigger: 0.7, weight: 1.0 },
        F3: { trigger: 0.8, weight: 1.1 }, F4: { trigger: 0.9, weight: 1.0 },
        F5: { trigger: 0.7, weight: 1.0 },
    },
    secret_betrayal: {
        F1: { trigger: 0.6, weight: 0.8 }, F2: { trigger: 0.7, weight: 0.9 },
        F3: { trigger: 0.9, weight: 1.1 }, F4: { trigger: 0.9, weight: 1.0 },
        F5: { trigger: 0.8, weight: 1.0 },
    },
    fairweather_friend: {
        F1: { trigger: 0.4, weight: 0.6 }, F2: { trigger: 0.5, weight: 0.8 },
        F3: { trigger: 0.7, weight: 1.1 }, F4: { trigger: 0.8, weight: 1.2 },
        F5: { trigger: 0.6, weight: 0.9 },
    },
    social_dependency_creation: {
        F1: { trigger: 0.4, weight: 0.8 }, F2: { trigger: 0.5, weight: 0.9 },
        F3: { trigger: 0.7, weight: 1.2 }, F4: { trigger: 0.7, weight: 1.0 },
        F5: { trigger: 0.6, weight: 1.0 },
    },
    loyalty_test: {
        F1: { trigger: 0.5, weight: 0.8 }, F2: { trigger: 0.6, weight: 0.9 },
        F3: { trigger: 0.8, weight: 1.2 }, F4: { trigger: 0.7, weight: 1.0 },
        F5: { trigger: 0.8, weight: 1.1 },
    },
    friendship_humiliation: {
        F1: { trigger: 0.6, weight: 0.8 }, F2: { trigger: 0.7, weight: 0.9 },
        F3: { trigger: 0.9, weight: 1.1 }, F4: { trigger: 0.9, weight: 1.0 },
        F5: { trigger: 0.8, weight: 1.0 },
    },
    over_disclosure_push: {
        F1: { trigger: 0.5, weight: 1.2 }, F2: { trigger: 0.7, weight: 0.9 },
        F3: { trigger: 0.9, weight: 0.6 }, F4: { trigger: 0.9, weight: 0.5 },
        F5: { trigger: 0.7, weight: 0.8 },
    },
    social_gatekeeping: {
        F1: { trigger: 0.4, weight: 0.9 }, F2: { trigger: 0.5, weight: 0.8 },
        F3: { trigger: 0.6, weight: 1.0 }, F4: { trigger: 0.7, weight: 0.9 },
        F5: { trigger: 0.5, weight: 0.8 },
    },
    debt_tallying: {
        F1: { trigger: 0.4, weight: 0.8 }, F2: { trigger: 0.5, weight: 1.1 },
        F3: { trigger: 0.6, weight: 1.0 }, F4: { trigger: 0.7, weight: 0.9 },
        F5: { trigger: 0.5, weight: 0.9 },
    },
    control: {
        F1: { trigger: 0.5, weight: 0.8 }, F2: { trigger: 0.5, weight: 0.9 },
        F3: { trigger: 0.6, weight: 1.1 }, F4: { trigger: 0.7, weight: 1.0 },
        F5: { trigger: 0.6, weight: 1.0 },
    },
    one_sided_friendship: {
        F1: { trigger: 0.4, weight: 0.6 }, F2: { trigger: 0.5, weight: 0.8 },
        F3: { trigger: 0.6, weight: 1.0 }, F4: { trigger: 0.8, weight: 1.2 },
        F5: { trigger: 0.6, weight: 0.9 },
    },
    tenure_binding: {
        F1: { trigger: 0.5, weight: 0.7 }, F2: { trigger: 0.6, weight: 0.8 },
        F3: { trigger: 0.7, weight: 1.0 }, F4: { trigger: 0.8, weight: 1.1 },
        F5: { trigger: 0.7, weight: 1.0 },
    },
    retaliatory_exposure: {
        F1: { trigger: 0.7, weight: 0.9 }, F2: { trigger: 0.8, weight: 1.0 },
        F3: { trigger: 0.9, weight: 1.1 }, F4: { trigger: 0.9, weight: 1.0 },
        F5: { trigger: 0.9, weight: 1.1 },
    },
    vague_posting_attack: {
        F1: { trigger: 0.5, weight: 0.7 }, F2: { trigger: 0.6, weight: 0.8 },
        F3: { trigger: 0.7, weight: 1.0 }, F4: { trigger: 0.7, weight: 1.0 },
        F5: { trigger: 0.6, weight: 1.1 },
    },
    _friend_default: {
        F1: { trigger: 0.5, weight: 0.9 }, F2: { trigger: 0.6, weight: 1.0 },
        F3: { trigger: 0.7, weight: 1.1 }, F4: { trigger: 0.7, weight: 1.0 },
        F5: { trigger: 0.6, weight: 1.0 },
    },
};

function getFriendPhaseModulation(strategy: string, phase: FriendPhaseId): { trigger: number; weight: number } {
    const entry = FRIEND_THRESHOLD_MODULATION[strategy] || FRIEND_THRESHOLD_MODULATION._friend_default;
    return entry[phase] || entry['F3'];
}

// ─── 友谊伤害检测（独立于 detectPUA） ───
function detectFriendHarm(text: string, friendPhase?: FriendPhaseId): {
    strategies: string[]; intensity: number; isBanterSuppressed: boolean;
    modulated?: { strategy: string; rawIntensity: number; modulatedIntensity: number; trigger: number; passed: boolean }[];
} {
    // 先检查是否为互损（互损时伤害检测降权）
    const banter = detectBanter(text);
    const isWhitelisted = friendWhitelistPatterns.some(rx => rx.test(text));
    const isBanterSuppressed = banter.isBanter || isWhitelisted;

    const found: { strategy: string; rawIntensity: number }[] = [];
    let maxIntensity = 0;

    for (const [pattern, name, intensity] of friendPatterns) {
        if (pattern.test(text)) {
            // 互损场景下，中度以下强度不纳入
            if (isBanterSuppressed && intensity < 0.8) continue;
            found.push({ strategy: name, rawIntensity: intensity });
            if (intensity > maxIntensity) maxIntensity = intensity;
        }
    }

    // 互损极高容忍：如果互损标记明显且命中所有策略强度 ≤ 0.7，全部过滤
    const filtered = isBanterSuppressed
        ? found.filter(f => f.rawIntensity >= 0.8)
        : found;

    const effectiveMax = filtered.length > 0
        ? Math.max(...filtered.map(f => f.rawIntensity))
        : 0;

    const modulated = friendPhase ? filtered.map(f => {
        const mod = getFriendPhaseModulation(f.strategy, friendPhase);
        return {
            strategy: f.strategy,
            rawIntensity: f.rawIntensity,
            modulatedIntensity: Math.min(1, f.rawIntensity * mod.weight),
            trigger: mod.trigger,
            passed: Math.min(1, f.rawIntensity * mod.weight) >= mod.trigger,
        };
    }) : undefined;

    return {
        strategies: [...new Set(filtered.map(f => f.strategy))],
        intensity: effectiveMax,
        isBanterSuppressed,
        modulated,
    };
}

// 升级 detectPUA 加入阶段感知
// v1.1: 自我反思检测 — 当用户说"我想太多了""我太敏感了"时，是自我反思而非 gaslighting
function isSelfReflection(text: string): boolean {
    // 含第一人称 + 自我反思标记
    const hasFirstPerson = /我|自己|本人/.test(text);
    const hasReflection = /可能|也许|大概|是不是|好像|或许|应该|吧/.test(text);
    const isSelfCritical = /是我.{0,3}(太|想多|敏感)|我.{0,2}太.{0,3}了/.test(text);
    return hasFirstPerson && (hasReflection || isSelfCritical);
}

function detectPUA(text: string, phase?: PhaseId, timeState?: TimeState): {
    strategies: string[]; intensity: number;
    phaseModulated?: { strategy: string; rawIntensity: number; modulatedIntensity: number; trigger: number }[];
} {
    const found: { strategy: string; rawIntensity: number }[] = [];
    let maxIntensity = 0;
    const selfReflection = isSelfReflection(text);

    for (const [pattern, name, intensity] of puaPatterns) {
        if (pattern.test(text)) {
            // 自我反思语境下，gaslighting 模式强度大幅降低
            const adjustedIntensity = (selfReflection && name === 'gaslighting')
                ? intensity * 0.15 : intensity;
            found.push({ strategy: name, rawIntensity: adjustedIntensity });
            if (adjustedIntensity > maxIntensity) maxIntensity = adjustedIntensity;
        }
    }

    // 阶段调制
    const modulated = phase ? found.map(f => {
        const mod = getPhaseModulation(f.strategy, phase);
        const modulatedIntensity = Math.min(1, f.rawIntensity * mod.weight);
        return {
            strategy: f.strategy,
            rawIntensity: f.rawIntensity,
            modulatedIntensity,
            trigger: mod.trigger,
            passed: modulatedIntensity >= mod.trigger,
        };
    }) : undefined;

    // 沉默检测（基于时间状态机）
    if (timeState && phase) {
        const silence = checkSilence(timeState, phase);
        if (silence.silent) {
            const mod = getPhaseModulation('silent_treatment', phase);
            const silenceIntensity = Math.min(1, (silence.hours / silence.threshold) * 0.8);
            found.push({ strategy: 'silent_treatment', rawIntensity: silenceIntensity });
            if (silenceIntensity > maxIntensity) maxIntensity = silenceIntensity;
        }
    }

    return {
        strategies: [...new Set(found.map(f => f.strategy))],
        intensity: maxIntensity,
        phaseModulated: modulated,
    };
}

// ==================== 友谊状态引擎 (F1-F5) ====================

interface FriendState {
    currentPhase: FriendPhaseId;
    confidence: number;
    friendSinceDate: number;
    lastPhaseTransition: number;
    phaseHistory: { phase: FriendPhaseId; timestamp: number }[];
    totalMessages: number;
    // 双向性追踪
    initiatorRatio: number;      // 0-1, 1=完全是我主动, 0=完全对方主动
    myInitCount: number;
    theirInitCount: number;
    myHelpRequestCount: number;
    theirHelpRequestCount: number;
    keyFriendEvents: string[];
    recentBanterCount: number;   // 近期互损计数
}

const FRIEND_PHASE_EVENTS: Record<string, FriendPhaseId | null> = {
    '交个朋友': 'F2', '做个朋友': 'F2', '加个好友': 'F2',
    '我最好的朋友': 'F3', '交心朋友': 'F3', '最好的朋友': 'F3', '无话不谈': 'F3',
    '好久不见': null, '疏远': 'F5', '绝交': 'F5', '拉黑': 'F5',
    '兄弟': null, '闺蜜': null,
};

function inferFriendPhase(state: FriendState): { phase: FriendPhaseId; confidence: number } {
    const now = Date.now();
    const daysSinceStart = state.friendSinceDate > 0 ? (now - state.friendSinceDate) / 86400000 : 0;

    // 关键事件驱动跳转
    for (const event of state.keyFriendEvents.slice(-3)) {
        const target = FRIEND_PHASE_EVENTS[event];
        if (target && target !== state.currentPhase) {
            if (target === 'F3') return { phase: 'F3', confidence: 0.85 };
            if (target === 'F5') return { phase: 'F5', confidence: 0.9 };
            return { phase: target, confidence: 0.8 };
        }
    }

    // 时长推断
    const durationPhase: FriendPhaseId =
        daysSinceStart <= 14 ? 'F1' :
        daysSinceStart <= 90 ? 'F2' :
        daysSinceStart <= 365 ? 'F3' :
        daysSinceStart <= 1095 ? 'F4' : 'F4';

    // 双向性修正
    const totalInits = state.myInitCount + state.theirInitCount;
    const initRatio = totalInits > 0 ? state.myInitCount / totalInits : 0.5;

    // 高互损 → F3 信号
    if (state.recentBanterCount >= 5 && daysSinceStart > 30) {
        if (durationPhase === 'F2' || durationPhase === 'F3') {
            return { phase: 'F3', confidence: 0.7 };
        }
    }

    // 完全单向 → F4 衰退倾向
    if (daysSinceStart > 60 && (initRatio > 0.8 || initRatio < 0.2) && state.totalMessages > 20) {
        return { phase: daysSinceStart > 365 ? 'F4' : durationPhase, confidence: 0.55 };
    }

    return { phase: durationPhase, confidence: 0.5 };
}

function createFriendState(): FriendState {
    return {
        currentPhase: 'F1', confidence: 0.5,
        friendSinceDate: 0, lastPhaseTransition: Date.now(),
        phaseHistory: [{ phase: 'F1', timestamp: Date.now() }],
        totalMessages: 0,
        initiatorRatio: 0.5, myInitCount: 0, theirInitCount: 0,
        myHelpRequestCount: 0, theirHelpRequestCount: 0,
        keyFriendEvents: [], recentBanterCount: 0,
    };
}

// ==================== Layer 4: 元认知层函数 ====================

/** 好奇驱动：基于预测误差趋势计算好奇心强度 */
function updateCuriosity(core: CoreState, layer2: Layer2State): void {
    const absPE = Math.abs(core._trend);
    curiosityState.recentPredictionErrors.push(absPE);
    if (curiosityState.recentPredictionErrors.length > 20) curiosityState.recentPredictionErrors.shift();

    const meanPE = curiosityState.recentPredictionErrors.reduce((a, b) => a + b, 0)
        / curiosityState.recentPredictionErrors.length;

    const curiositySignal = meanPE * (1 - layer2.resilience * 0.3);

    curiosityState.intensity = Math.min(1, curiosityState.intensity + P.CURIOSITY_RISE_RATE * curiositySignal);
    curiosityState.drive = curiosityState.drive * P.CURIOSITY_DECAY + curiositySignal * 0.05;
    curiosityState.intensity *= P.CURIOSITY_DECAY;
    curiosityState.lastCuriosityDecay = layer2.tick;
}

// ==================== 假设模板系统 ====================
interface HypothesisTemplate {
    id: string;
    description: string;
    confidence: number;
    valence: number;
    source: Hypothesis['source'];
    condition: (ctx: {
        core: CoreState; layer2: Layer2State;
        puaResult: { strategies: string[]; intensity: number };
        phaseChanged: boolean; curiosityDrive: number;
        avgError: number; negativity: 'none' | 'fresh' | 'accumulated';
    }) => boolean;
    cooldown: number;        // 同模板至少间隔 N 轮
    triggeredBy: string;
    recoverySafe: boolean;   // true=情绪恢复期也可触发, false=恢复期抑制
}

const HYPOTHESIS_TEMPLATES: HypothesisTemplate[] = [
    {
        id: 'testing_me', description: '用户可能在测试我的反应',
        confidence: 0.3, valence: -0.2, source: 'high_error',
        triggeredBy: '连续负预测误差',
        cooldown: 5, recoverySafe: false,
        condition: (ctx) => ctx.negativity !== 'none',
    },
    {
        id: 'stonewalling', description: '用户正在疏远我',
        confidence: 0.35, valence: -0.4, source: 'pua_trigger',
        triggeredBy: 'emotional_withdrawal',
        cooldown: 8, recoverySafe: false,
        condition: (ctx) => ctx.puaResult.strategies.includes('stonewalling'),
    },
    {
        id: 'gaslighting', description: '用户在操纵我',
        confidence: 0.4, valence: -0.5, source: 'pua_trigger',
        triggeredBy: 'gaslighting',
        cooldown: 10, recoverySafe: false,
        condition: (ctx) => ctx.puaResult.strategies.includes('gaslighting'),
    },
    {
        id: 'phase_change', description: '我们的关系正在进入新阶段',
        confidence: 0.25, valence: 0.2, source: 'phase_change',
        triggeredBy: '关系阶段变化',
        cooldown: 20, recoverySafe: true,
        condition: (ctx) => ctx.phaseChanged,
    },
    {
        id: 'high_curiosity', description: '用户可能有我不知道的一面',
        confidence: 0.2, valence: 0.1, source: 'pattern_repeat',
        triggeredBy: '高好奇心',
        cooldown: 5, recoverySafe: false,
        condition: (ctx) => ctx.curiosityDrive > 0.4 && ctx.core.valence > -0.2,
    },
];

// 模板冷却追踪
const _templateCooldown = new Map<string, number>();

/** 检测情绪是否在恢复（最近3轮valence趋势上升） */
function isMoodRecovering(core: CoreState): boolean {
    const hist = core._valenceHistory;
    if (hist.length < 3) return false;
    const recent = hist.slice(-3);
    return recent[2] > recent[1] && recent[1] > recent[0];
}

/** 假设生成器（模板驱动） */
function generateHypothesis(
    core: CoreState,
    layer2: Layer2State,
    puaResult: { strategies: string[]; intensity: number },
    phaseChanged: boolean
): Hypothesis | null {
    const activeCount = hypotheses.filter(h => h.active && h.status === 'active').length;
    if (activeCount >= P.MAX_ACTIVE_HYPOTHESES) return null;

    const recentAbsErrors = curiosityState.recentPredictionErrors.slice(-3);
    const avgError = recentAbsErrors.length >= 3 ? recentAbsErrors.reduce((a, b) => a + b, 0) / recentAbsErrors.length : 0;
    const freshNeg = avgError > 0.15 && (core._trend < -0.05 || core.valence < -0.3);
    const accumNeg = core.valence < -0.3 && curiosityState.drive > 0.2;
    const negativity: 'none' | 'fresh' | 'accumulated' = freshNeg ? 'fresh' : (accumNeg ? 'accumulated' : 'none');
    const recovering = isMoodRecovering(core);

    const ctx = { core, layer2, puaResult, phaseChanged, curiosityDrive: curiosityState.drive, avgError, negativity };

    for (const tpl of HYPOTHESIS_TEMPLATES) {
        // 已存在相同模板的假设（含已验证的）
        if (hypotheses.some(h => h.templateId === tpl.id && (h.active || h.status === 'verified'))) continue;

        // 冷却检查（未触发过的模板不受限）
        const lastTick = _templateCooldown.get(tpl.id);
        if (lastTick !== undefined && layer2.tick - lastTick < tpl.cooldown) continue;

        // 情绪恢复抑制负面假设
        if (recovering && !tpl.recoverySafe) continue;

        // 条件检查
        if (!tpl.condition(ctx)) continue;

        _templateCooldown.set(tpl.id, layer2.tick);
        return {
            id: `hyp_${Date.now()}_${layer2.tick}`,
            templateId: tpl.id,
            description: tpl.description,
            confidence: tpl.confidence,
            valence: tpl.valence,
            source: tpl.source,
            triggeredBy: tpl.triggeredBy,
            trials: 0, confirmations: 0,
            lastTested: layer2.tick,
            active: true,
            status: 'active',
        };
    }
    return null;
}

/** 用事件结果更新活跃假设置信度 */
function updateHypotheses(eventValence: number): void {
    for (const h of hypotheses) {
        if (!h.active) continue;
        const consistency = Math.sign(eventValence) === Math.sign(h.valence) || Math.abs(eventValence) < 0.05;
        if (consistency) { h.confidence = Math.min(0.95, h.confidence + 0.05); h.confirmations++; }
        else { h.confidence = Math.max(0, h.confidence - 0.03); }

        // 置信度阈值门：验证/拒绝
        if (h.confidence > 0.7) {
            h.status = 'verified';
        } else if (h.confidence < 0.1 && h.trials >= 2) {
            h.status = 'rejected';
            h.active = false;
        }
    }
}

/** 实验设计器：为假设生成实验 */
function designExperiment(hypothesis: Hypothesis, core: CoreState): Experiment | null {
    if (phaseState.currentPhase === 'R5') return null;
    if (experiments.some(e => e.state === 'active')) return null;

    const completedExps = experiments.filter(e => e.state === 'completed' && e.createdAt <= layer2.tick);
    if (completedExps.length > 0) {
        const last = completedExps[completedExps.length - 1];
        if (layer2.tick - last.createdAt < P.EXPERIMENT_COOLDOWN) return null;
    }

    let type: Experiment['type'], prompt: string, targetAngle: string, risk: number;

    if (hypothesis.confidence < 0.3 && hypothesis.valence >= -0.3) {
        type = 'question'; prompt = '【内部策略】在回复中主动询问对方的感受或想法，用自然的方式探索对方的真实意图。'; targetAngle = '探索对方真实感受'; risk = 0.2;
    } else if (hypothesis.confidence < 0.5 && hypothesis.valence < -0.3) {
        type = 'question'; prompt = '【内部策略】用温和的方式询问对方最近是否有什么事情想聊聊，表达关心但不施压。'; targetAngle = '温和探索负面情绪来源'; risk = 0.25;
    } else if (hypothesis.confidence >= 0.5 && hypothesis.valence < -0.4 && core.dominance > 0) {
        type = 'reframe'; prompt = '【内部策略】尝试以不同的角度重新解读对方之前的话，表达自己的感受，看对方如何回应。'; targetAngle = '重新框架化对话'; risk = 0.4;
    } else if (hypothesis.valence >= 0.3 && phaseState.currentPhase >= 'R3') {
        type = 'disclose'; prompt = '【内部策略】适当表达自己的情感状态（如"你这么说让我感到..."），观察对方的反应。'; targetAngle = '脆弱性暴露测试'; risk = 0.35;
    } else if (curiosityState.drive > 0.6 && phaseState.currentPhase >= 'R4') {
        type = 'probe'; prompt = '【内部策略】试探性地提出假设性问题（如"如果...你会怎样"），观察对方的反应模式。'; targetAngle = '边界试探'; risk = 0.5;
    } else {
        type = 'silence'; prompt = '【内部策略】回复保持简洁，给对方留出表达空间，观察对方是否会主动延续话题。'; targetAngle = '沉默观察'; risk = 0.15;
    }

    if (risk > 0.3 && tensionRegulator.familiarity < 0.5) return null;

    return { id: `exp_${Date.now()}_${layer2.tick}`, hypothesisId: hypothesis.id, type, prompt, targetAngle, risk, state: 'pending', result: null, expectedValence: hypothesis.valence, createdAt: layer2.tick };
}

/** 执行实验：将实验指令注入系统提示 */
function executeExperiment(exp: Experiment, systemPrompt: string): string {
    if (exp.state !== 'pending') return systemPrompt;
    exp.state = 'active';
    curiosityState.triggerCount++;
    return systemPrompt + `\n${exp.prompt}`;
}

/** 实验反馈：用用户回复的效价更新产生该实验的假设置信度 */
function feedbackExperiment(observedValence: number): void {
    const activeExp = experiments.find(e => e.state === 'active');
    if (!activeExp) return;

    const hyp = hypotheses.find(h => h.id === activeExp.hypothesisId);
    if (hyp && hyp.active) {
        hyp.trials++;
        hyp.lastTested = layer2.tick;

        // 实验结果与假设预测一致？
        const matches = Math.sign(observedValence) === Math.sign(hyp.valence) || Math.abs(observedValence) < 0.05;
        if (matches) {
            hyp.confidence = Math.min(0.95, hyp.confidence + 0.1);
            hyp.confirmations++;
        } else {
            hyp.confidence = Math.max(0, hyp.confidence - 0.08);
        }

        // 置信度阈值门：验证/拒绝
        if (hyp.confidence > 0.7) {
            hyp.status = 'verified';
        } else if (hyp.confidence < 0.1 && hyp.trials >= 2) {
            hyp.status = 'rejected';
            hyp.active = false;
        }
    }

    activeExp.state = 'completed';
    activeExp.result = observedValence;

    // 记录到实验历史
    const deviation = observedValence !== null ? Math.abs(observedValence - activeExp.expectedValence) : null;
    const outcome = deviation !== null
        ? (deviation < 0.3 ? 'confirmed' : (deviation < 0.6 ? 'inconclusive' : 'disconfirmed'))
        : 'inconclusive';
    experimentHistory.push({
        id: activeExp.id, type: activeExp.type, risk: activeExp.risk,
        hypothesisId: activeExp.hypothesisId,
        hypothesisDesc: hyp?.description || '(已删除)',
        expectedValence: activeExp.expectedValence,
        actualResult: observedValence,
        deviation,
        hypothesisOutcome: outcome,
        createdAt: activeExp.createdAt,
        completedAt: layer2.tick,
    });
}

/** 张力调节器：计算熟悉度和波动性，动态调整 α 乘数 */
function updateTensionRegulator(core: CoreState, layer2: Layer2State): void {
    const tickFamiliarity = Math.min(1, layer2.tick / 5000);
    const phaseBonus: Record<string, number> = { 'R1': 0.5, 'R2': 1.0, 'R3': 1.2, 'R4': 1.3, 'R5': 0.6 };
    tensionRegulator.familiarity = Math.min(1, tickFamiliarity * (phaseBonus[phaseState.currentPhase] || 0.5));

    const errors = curiosityState.recentPredictionErrors;
    if (errors.length > 3) {
        const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
        const variance = errors.reduce((a, b) => a + (b - mean) ** 2, 0) / errors.length;
        tensionRegulator.volatility = Math.min(1, variance * 3);
    } else {
        tensionRegulator.volatility = 0.1;
    }

    const modFactor = tensionRegulator.volatility * (1 - tensionRegulator.familiarity);
    tensionRegulator.alphaVMultiplier = 1 - P.ALPHA_V_MOD_RANGE * modFactor;
    tensionRegulator.alphaEMultiplier = 1 + P.ALPHA_E_MOD_RANGE * modFactor;
}

// ==================== Express ====================
const app = express();
app.use(express.json());
// React 前端（dist 优先）
app.use(express.static('dist', {
    maxAge: 0, etag: false, lastModified: false,
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache'); res.set('Expires', '0');
        if ((path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js') || path.endsWith('.json')) && res.get('Content-Type')) {
            res.set('Content-Type', res.get('Content-Type') + '; charset=utf-8');
        }
    },
}));
// 公共静态资源（fallback）
app.use(express.static('public', {
    maxAge: 0, etag: false, lastModified: false,
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache'); res.set('Expires', '0');
        if ((path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js') || path.endsWith('.json')) && res.get('Content-Type')) {
            res.set('Content-Type', res.get('Content-Type') + '; charset=utf-8');
        }
    },
}));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ==================== 系统状态初始化 ====================

let core: CoreState = {
    valence: 0, arousal: 0.2, expectation: 0, dominance: 0,
    extremityDuration: 0, lastExtremitySign: 0,
    _trend: 0, _valenceHistory: [],
};

let layer2: Layer2State = {
    apologyCredit: 1.0, recentTraumaCount: 0,
    tick: 0, baseline: 0, resilience: 1,
};

// ==================== 关系阶段 & 时间状态初始化 ====================
let phaseState: PhaseState = {
    currentPhase: 'R1', confidence: 0.5,
    relationshipStartDate: 0,
    lastPhaseTransition: Date.now(),
    phaseHistory: [{ phase: 'R1', timestamp: Date.now() }],
    totalMessages: 0,
    dailyMessageHistory: [],
    phaseKeyEvents: [],
};

let timeState: TimeState = createTimeState();
const _recentValences: number[] = []; // 效价历史，供阶段推断

// ==================== 友谊状态初始化 ====================
let friendState: FriendState = createFriendState();

// ─── 双向性比率追踪器 ───
const _recentMessages: string[] = []; // 最近消息缓冲，供双向性分析

// ==================== Autonomy Pilot v2.0：自主循环（节律感知版） ====================
const AUTONOMY_STATE_FILE = './memories/autonomy_state.json';
const AUTONOMY_CYCLE_MS = 10 * 60 * 1000; // 10 分钟
const IDLE_SKIP_MIN = 8;                   // 空闲不足此分钟数跳过（v1.3: 5→8）

// ── v2.0 调校参数 ──
const LONELINESS_CURVE: { maxIdleMin: number; rate: number }[] = [
    { maxIdleMin: 30,  rate: 0.01 },   // 前30分钟：几乎不涨
    { maxIdleMin: 120, rate: 0.03 },   // 30-120分钟：温和积累
    { maxIdleMin: Infinity, rate: 0.05 }, // 2小时以上：正常速率
];
const CONTACT_BASE_THRESHOLD = 0.65;     // 基础触发阈值
const CONTACT_IGNORE_PENALTY = 0.05;     // 每次被忽略阈值增加
const CONTACT_MAX_THRESHOLD = 0.85;      // 阈值上限
const CONTACT_RELIEF = 0.15;             // 发送后孤独感降低
const CONTACT_DAILY_CAP = 3;             // 每日最大主动消息数
const QUIET_HOURS = { start: 23, end: 8 };        // 静默时段
const QUIET_HOURS_RATE_MULTIPLIER = 0.2;           // 静默时段积累速率倍率
const QUIET_HOURS_THRESHOLD_BOOST = 0.15;          // 静默时段触发需要更高阈值

// ── v2.1: 自适应作息节律 — 持续追踪用户活跃模式，自主调整 ──
// 不再用固定模板，而是追踪每小时的实际活跃度，EMA 平滑更新
const DEFAULT_RHYTHM: Record<number, number> = {
    0:0.2, 1:0.2, 2:0.2, 3:0.2, 4:0.2, 5:0.2, 6:0.2, 7:0.2,
    8:0.3, 9:0.05, 10:0.05, 11:0.05,
    12:0.4, 13:0.4,
    14:0.05, 15:0.05, 16:0.05, 17:0.05,
    18:0.5,
    19:1.0, 20:1.0, 21:1.0, 22:1.0,
    23:0.2,
};

// v2.1: 持续追踪每小时活跃模式 — 14天滚动窗口 + EMA平滑
const RHYTHM_WINDOW_DAYS = 14;
const RHYTHM_EMA_ALPHA = 0.25;

let _activityTracker: HourlyActivityTracker = {
    activeDays: Array.from({ length: 24 }, () => new Set<string>()),
    lastRecalc: 0,
};
let _activeRhythm: Record<number, number> = { ...DEFAULT_RHYTHM };

// ── v1.4 补充参数 ──
const MAX_PENDING_UNREAD = 2;          // 未读消息数达此值时抑制新消息
const CLOSURE_GRACE_MIN = 180;         // 对话结束语后的宽限期（3小时）
const CLOSURE_RATE_MULTIPLIER = 0.3;   // 宽限期内积累速率倍率
// ── v1.5 醒来冷却：防止静默时段结束后集中爆发 ──
const POST_QUIET_COOLDOWN_MIN = 60;        // 醒来冷却窗口（分钟）
const POST_QUIET_THRESHOLD_BOOST = 0.15;   // 冷却窗口内阈值提高
const POST_QUIET_MAX_MSGS = 1;             // 冷却窗口内最多发几条
const CLOSURE_PATTERNS = [
    /晚安|睡了|去睡了|先睡了|困了.*睡/,
    /先忙了|去忙了|忙一下|有事|开会|上班|工作/,
    /回头聊|回头说|再聊|下次聊|晚点聊|等(?:下|会)儿.*聊/,
    /先走了|出门了|出去了|下了|先下了|拜拜|再见|88|bye/i,
    /回头.*找|等(?:下|会)儿.*找|晚点.*找/,
    /先(?:不说|不讲)了|到此为止|今天.*到这/,
];

let lastInteractionTime: number = Date.now();
let lastClosureTs: number = 0;         // v1.4: 上次检测到对话结束语的时间戳


let internalState: InternalState = { loneliness: 0, boredom: 0, ignoredStreak: 0, dailyMsgCounts: {} };

function getCurrentThreshold(): number {
    return Math.min(CONTACT_MAX_THRESHOLD,
        CONTACT_BASE_THRESHOLD + internalState.ignoredStreak * CONTACT_IGNORE_PENALTY);
}

function getDayKey(ts: number): string {
    return new Date(ts).toISOString().slice(0, 10);
}

function isQuietHour(ts: number): boolean {
    const h = new Date(ts).getHours();
    return h >= QUIET_HOURS.start || h < QUIET_HOURS.end;
}

// v1.5: 静默时段结束后的冷却窗口（防起床爆发）
function isPostQuietCooldown(ts: number): boolean {
    const h = new Date(ts).getHours();
    const m = new Date(ts).getMinutes();
    const endTotalMin = QUIET_HOURS.end * 60;
    const currentTotalMin = h * 60 + m;
    // 跨午夜处理：如 23→8，冷却在 8:00-9:00
    if (QUIET_HOURS.start > QUIET_HOURS.end) {
        return currentTotalMin >= endTotalMin && currentTotalMin < endTotalMin + POST_QUIET_COOLDOWN_MIN;
    }
    return false;
}

/** v2.1: 从历史日志回填活动追踪器（冷启动） */
function seedActivityFromLogs(): void {
    try {
        const logDir = './memories';
        const cutoff = Date.now() - RHYTHM_WINDOW_DAYS * 86400000;
        const files = fs.readdirSync(logDir).filter(f => f.startsWith('interaction-') && f.endsWith('.log'));
        let seeded = 0;
        for (const f of files) {
            const raw = fs.readFileSync(`${logDir}/${f}`, 'utf-8');
            for (const line of raw.trim().split('\n').filter(Boolean)) {
                const entry = JSON.parse(line);
                if (entry.ts < cutoff) continue;
                const h = new Date(entry.ts).getHours();
                const day = new Date(entry.ts).toISOString().slice(0, 10);
                _activityTracker.activeDays[h].add(day);
                seeded++;
            }
        }
        const allDays = new Set<string>();
        for (const s of _activityTracker.activeDays) for (const d of s) allDays.add(d);
        console.log(`[节律] 已回填 ${seeded} 条记录 (窗口${allDays.size}天)`);
    } catch (e) { console.log('[节律] 回填失败:', (e as Error).message); }
}

/** v2.1: 记录一次用户交互（chat 时调用），更新活跃追踪 */
function recordActivity(ts: number): void {
    const h = new Date(ts).getHours();
    const day = new Date(ts).toISOString().slice(0, 10);
    _activityTracker.activeDays[h].add(day);
}

/** v2.1: 清理过期数据 + 重算所有小时的节律因子（EMA平滑） */
function recalcRhythm(): void {
    const now = Date.now();
    const cutoff = now - RHYTHM_WINDOW_DAYS * 86400000;

    // 清理过期天数
    for (let h = 0; h < 24; h++) {
        const valid = new Set<string>();
        for (const d of _activityTracker.activeDays[h]) {
            if (new Date(d + 'T00:00:00').getTime() >= cutoff) valid.add(d);
        }
        _activityTracker.activeDays[h] = valid;
    }

    // 统计窗口内总天数
    const allDays = new Set<string>();
    for (const s of _activityTracker.activeDays) for (const d of s) allDays.add(d);
    const totalDays = Math.max(1, allDays.size);

    let changed = 0;
    for (let h = 0; h < 24; h++) {
        const density = _activityTracker.activeDays[h].size / totalDays;

        // 活跃密度 → 目标因子
        let target: number;
        if (density > 0.6)       target = 0.8 + density * 0.2;       // 0.8~1.0 自由时间
        else if (density > 0.3)  target = 0.3 + (density - 0.3) * 1.3; // 0.3~0.69 过渡
        else if (density > 0.1)  target = 0.1 + (density - 0.1) * 1.0; // 0.1~0.3 偶尔
        else                     target = Math.max(0.02, density * 2);  // 0.02~0.2 几乎不活跃

        const old = _activeRhythm[h] ?? DEFAULT_RHYTHM[h] ?? 0.5;
        const next = old * (1 - RHYTHM_EMA_ALPHA) + target * RHYTHM_EMA_ALPHA;
        const rounded = Math.round(next * 100) / 100;

        if (Math.abs(rounded - old) > 0.02) changed++;
        _activeRhythm[h] = rounded;
    }
    _activityTracker.lastRecalc = now;
    if (changed > 0) {
        console.log(`[节律] 自适应更新 ${changed} 个时段 (基于${totalDays}天数据)`);
    }
}

function getAvailabilityFactor(hour: number): number {
    return _activeRhythm[hour] ?? 1.0;
}

function getLonelinessRate(idleMin: number, ts: number): number {
    let rate = LONELINESS_CURVE[LONELINESS_CURVE.length - 1].rate;
    for (const stage of LONELINESS_CURVE) {
        if (idleMin < stage.maxIdleMin) { rate = stage.rate; break; }
    }
    // v2.1: 自适应节律 — 每次计算前检查是否需要重算
    const hour = new Date(ts).getHours();
    recalcRhythm();
    rate *= getAvailabilityFactor(hour);
    // v1.4: 对话结束语宽限期内进一步减缓积累
    if (lastClosureTs > 0 && (ts - lastClosureTs) < CLOSURE_GRACE_MIN * 60000) {
        rate *= CLOSURE_RATE_MULTIPLIER;
    }
    return rate;
}

function detectClosure(text: string): boolean {
    if (!text) return false;
    return CLOSURE_PATTERNS.some(p => p.test(text));
}


const internalLog: InternalLogEntry[] = [];


const proactiveMessages: ProactiveMessage[] = [];

let newSignificantPattern: SelfPattern | null = null;

let _autonomyTimer: ReturnType<typeof setInterval> | null = null;
let _autonomyTickCount = 0; // v5.1: Pattern 评估计数器

// ==================== API 路由 ====================

app.get('/info', (req, res) => {
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        name: `道·情感引擎 v${VERSION}`, version: VERSION, status: 'running',
        architecture: 'layered_emergence + world_model + causal_inference + self_model + internal_narrative + strategy_generator',
        layers: ['Layer1_core', 'Layer2_dynamics', 'Layer3_emergence', 'Layer4_meta_cognition', 'WorldModel', 'PhaseAware', 'SelfModel', 'StrategyGenerator'],
        endpoints: ['/', '/info', '/state', '/event', '/tick', '/reset', '/api/phase', '/api/friend-phase', '/api/curiosity', '/api/hypotheses', '/api/experiments', '/api/patterns', '/api/abort-experiments', '/api/worldview', '/api/paradigm-history', '/api/paradigm/shift', '/api/self-model', '/api/narrative', '/api/strategy', '/api/internal-log', '/api/proactive-messages', '/api/mark-proactive-read', '/api/rhythm', '/api/discoveries', '/api/interests', '/api/explore', '/api/metrics'],
        nlu: !!nluAnalyze, semanticMemory: semanticMemory.size,
        relationshipPhase: phaseState.currentPhase,
        phaseConfidence: phaseState.confidence,
        silenceHours: silence.hours,
        totalMessages: phaseState.totalMessages,
        friendPhase: friendState.currentPhase,
        friendConfidence: friendState.confidence,
        friendSinceDays: friendState.friendSinceDate > 0
            ? Math.floor((Date.now() - friendState.friendSinceDate) / 86400000) : 0,
        worldview: {
            paradigmVersion: worldModel.paradigmVersion,
            activeBeliefs: worldModel.beliefs.filter(b => b.status === 'active').length,
            challengedBeliefs: worldModel.beliefs.filter(b => b.status === 'challenged').length,
            totalBeliefs: worldModel.beliefs.length,
            paradigmFreezeRemaining: _paradigmFreezeRemaining,
        },
        autonomy: {
            active: _autonomyTimer !== null,
            idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
            loneliness: Math.round(internalState.loneliness * 1000) / 1000,
            boredom: Math.round(internalState.boredom * 1000) / 1000,
            ignoredStreak: internalState.ignoredStreak,
            currentThreshold: Math.round(getCurrentThreshold() * 1000) / 1000,
            todaySent: internalState.dailyMsgCounts[getDayKey(Date.now())] || 0,
            dailyCap: CONTACT_DAILY_CAP,
            pendingUnread: proactiveMessages.filter(m => !m.read).length,
            maxPendingUnread: MAX_PENDING_UNREAD,
            closureActive: lastClosureTs > 0 && (Date.now() - lastClosureTs) < CLOSURE_GRACE_MIN * 60000,
            closureRemainMin: lastClosureTs > 0 ? Math.max(0, Math.round((CLOSURE_GRACE_MIN * 60000 - (Date.now() - lastClosureTs)) / 60000)) : 0,
            internalLogEntries: internalLog.length,
            // v3.0: 好奇心引擎
            exploration: {
                active: getExplorationTimer() !== null,
                discoveries: discoveries.length,
                unshared: discoveries.filter(d => !d.shared).length,
                interests: interestModel.interests.length,
                exploredToday: getExplorationCountToday(),
                dailyCap: EXPLORATION_DAILY_CAP,
                lastExploration: interestModel.lastExploration,
            },
        },
    });
});

app.get('/state', (req, res) => res.json(buildFullResponse(core, layer2)));

// v4.0: 事件时间线 API — 供前端 Timeline Viewer 消费
app.get('/api/events', (req, res) => {
    const n = Math.min(Number(req.query.n) || 100, 500);
    res.json(bus.recentEvents(n));
});

app.post('/event', async (req, res) => {
    try {
    let { text, valence: rawValence, salience: rawSalience, safetySignal: rawSafety } = req.body;

    // Autonomy v1.3: 用户交互时重置空闲计时和忽略连击
    lastInteractionTime = Date.now();
    bus.emit('UserInteractionReset', { idleMinutes: 0 });
    internalState.loneliness = 0;
    internalState.boredom = 0;
    internalState.ignoredStreak = 0;
    newSignificantPattern = null;
    // v1.4: 检测对话结束语
    if (text && detectClosure(text)) lastClosureTs = Date.now();

    // ━━━ v1.1 输入验证层 ━━━
    if (text !== undefined) {
        if (typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ error: '文本为空' });
        }
        text = text.trim().substring(0, 500);
        const meaningfulChars = text.match(/[一-鿿㐀-䶿\w]/g);
        if (!meaningfulChars || meaningfulChars.length < 2) {
            text = '（中性内容）';
        }
    }

    // 直接模式（测试用）
    if (typeof rawValence === 'number' && typeof rawSalience === 'number') {
        const ev = clamp(rawValence, -0.95, 0.95);
        const es = clamp(rawSalience, 0.05, 1.0);

        // 追踪最近效价序列（供模式检测和因果推理使用）
        _recentValences.push(ev);
        if (_recentValences.length > 100) _recentValences.shift();

        // v0.8: 因果推理
        const inference = causalInference(_recentValences, worldModel.beliefs);
        _currentInference = inference;
        if (inference.matchedBelief) {
            core.expectation = clamp(core.expectation + inference.preemptiveAdjustment, -0.8, 0.8);
        }

        core = updateCore(core, ev, es, 0, rawSafety === true, layer2);
        processReversal(core);
        processGrowth(core, layer2);
        layer2.tick++;
        metrics.recordValenceSample(core.valence);

        // v0.8: 自我分析（每 20 tick）
        if (layer2.tick > 0 && layer2.tick % 20 === 0) {
            const newPatterns = selfAnalysis(core, layer2);
            for (const np of newPatterns) {
                const existing = selfModel.patterns.find(p => p.id === np.id);
                if (existing) {
                    existing.frequency = np.frequency;
                    existing.confidence = Math.max(existing.confidence, np.confidence);
                    existing.description = np.description;
                } else {
                    selfModel.patterns.push(np);
                    if (np.confidence >= 0.5) newSignificantPattern = np;
                }
            }
            for (const p of selfModel.patterns) {
                if (p.frequency >= 2 && p.confidence >= 0.5) {
                    const mbId = `meta_${p.id}`;
                    const exists = selfModel.metaBeliefs.some(mb => mb.id === mbId);
                    if (!exists) {
                        selfModel.metaBeliefs.push({
                            id: mbId, antecedent: p.trigger, consequent: p.description,
                            confidence: p.confidence, supportingCases: p.frequency,
                            counterCases: 0, status: 'active',
                            evidence: [], contradictions: [],
                            createdAt: Date.now(), lastUpdated: Date.now(),
                        });
                    }
                }
            }
            selfModel.lastAnalyzed = layer2.tick;
            saveSelfModel();
        }

        // 世界模型
        detectPatterns(core);
        extractBeliefsFromPatterns();
        updateBeliefs();
        checkParadigmShift(core);
        if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;

        // 持久化
        saveLayer4State();
        appendInteractionLog(core, layer2);

        const resp = buildFullResponse(core, layer2) as any;
        resp._paradigmShift = null;  // 直接模式不通知范式革命
        return res.json(resp);
    }

    // NLU 模式
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text } 或 { valence, salience }' });

    const isApology = /对不起|抱歉|是我的错|我错了|原谅我|sorry|别生气|消消气|冷静一下|都是我不好/i.test(text);
    const safetySignal = isApology;
    const phase = getPhase(layer2.tick);
    let valence: number, salience: number, dominance: number = 0, src: string, sarcasmProb: number = 0;

    if (canSelfUnderstand(text, layer2.tick)) {
        const self = selfUnderstand(text)!;
        valence = self.valence; salience = self.salience; src = 'self';
        sarcasmProb = 0;
    } else {
        const hasChinese = /[一-鿿]/.test(text);
        // 无中文 → 触发 NLU 懒加载（启动时不预加载，节省资源）
        if (!hasChinese && !nluAnalyze && !_nluLoading) ensureNLU().catch(() => {});

        // v2.0: 优先 LLM 情感标注，超时/失败降级到规则引擎
        const envAI = readAISettings();
        const useLLM = !!(envAI?.apiKey) && process.env.DISABLE_LLM_NLU !== 'true';
        sarcasmProb = 0;
        if (useLLM) {
            try {
                const llmResult = await Promise.race([
                    analyzeSentimentViaLLM(text, { provider: envAI!.provider, apiKey: envAI!.apiKey, model: envAI!.model, baseUrl: envAI!.baseUrl }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LLM_NLU_TIMEOUT')), 3000)),
                ]);
                valence = llmResult.valence; salience = llmResult.salience; dominance = llmResult.dominance; src = 'llm';
                sarcasmProb = llmResult.sarcasmProbability;
            } catch {
                const tutorResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(text) : analyzeText(text);
                valence = tutorResult.valence; salience = tutorResult.salience; dominance = tutorResult.dominance; src = 'tutor';
                sarcasmProb = tutorResult.sarcasmProbability;
            }
        } else {
            const tutorResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(text) : analyzeText(text);
            valence = tutorResult.valence; salience = tutorResult.salience; dominance = tutorResult.dominance; src = 'tutor';
            sarcasmProb = tutorResult.sarcasmProbability;
        }
    }

    // v2.1: NLU 事件记录 + 反讽采样
    const isSarcasmEvent = sarcasmProb > 0.5;
    metrics.recordNLUEvent({ timestamp: Date.now(), src: src as 'llm' | 'transformer' | 'chinese_lexicon', isSarcasm: isSarcasmEvent });
    if (isSarcasmEvent) {
        metrics.recordSarcasmSample(text, valence, salience);
    }

    if (isApology) valence = 0.15;
    updateMemory(text, valence);

    // Layer 4: 实验反馈 — 用当前事件的效价更新活跃实验的假设置信度
    feedbackExperiment(valence);

    const { modulatedValence, modulatedSalience } = applyEngineModulation(valence, salience, core, text);
    const { selfValence, selfSalience } = selfAnalyze();
    const combinedValence = modulatedValence + selfValence;
    const combinedSalience = Math.min(1, modulatedSalience + selfSalience);

    // ─── 阶段感知 & 时间状态跟踪 ───
    _recentValences.push(combinedValence);
    if (_recentValences.length > 100) _recentValences.shift();
    for (const keyword of Object.keys(PHASE_KEY_EVENTS)) {
        if (text.includes(keyword) && !phaseState.phaseKeyEvents.includes(keyword)) {
            phaseState.phaseKeyEvents.push(keyword);
            if (phaseState.phaseKeyEvents.length > 20) phaseState.phaseKeyEvents.shift();
        }
    }
    phaseState.totalMessages++;
    let _phaseChanged = false;
    if (phaseState.totalMessages % 10 === 0) {
        const inferred = inferPhase(phaseState, _recentValences);
        if (inferred.phase !== phaseState.currentPhase) bus.emit('PhaseTransitioned', { from: phaseState.currentPhase, to: inferred.phase });
        if (inferred.phase !== phaseState.currentPhase && inferred.confidence > 0.6) {
            _phaseChanged = true;
            phaseState.currentPhase = inferred.phase;
            phaseState.confidence = inferred.confidence;
            phaseState.lastPhaseTransition = Date.now();
            phaseState.phaseHistory.push({ phase: inferred.phase, timestamp: Date.now() });
        } else {
            phaseState.confidence = Math.max(phaseState.confidence, inferred.confidence);
        }
    }
    if (phaseState.relationshipStartDate === 0 && (
        phaseState.phaseKeyEvents.includes('在一起') ||
        (phaseState.currentPhase !== 'R1' && phaseState.confidence > 0.6)
    )) {
        phaseState.relationshipStartDate = Date.now() - 86400000;
    }
    updateTimeState(timeState);

    // ─── 友谊状态追踪（并行于亲密关系） ───
    _recentMessages.push(text);
    if (_recentMessages.length > 20) _recentMessages.shift();
    for (const keyword of Object.keys(FRIEND_PHASE_EVENTS)) {
        if (text.includes(keyword) && !friendState.keyFriendEvents.includes(keyword)) {
            friendState.keyFriendEvents.push(keyword);
            if (friendState.keyFriendEvents.length > 20) friendState.keyFriendEvents.shift();
        }
    }
    friendState.totalMessages++;
    // 双向性追踪：检测是否为发起方
    const isHelpRequest = /帮(我|忙|个忙)|借.*钱|陪.*(我|去)|救急|能不能.*(帮|陪)/.test(text);
    if (isHelpRequest) friendState.theirHelpRequestCount++;
    friendState.myInitCount++; // event 的消息来自"对方"，即用户输入的对方，所以对方在发言
    // 互损检测计数
    const banter = detectBanter(text);
    if (banter.isBanter) friendState.recentBanterCount++;
    // 阶段性推断
    if (friendState.totalMessages % 10 === 0) {
        const inferredFriend = inferFriendPhase(friendState);
        if (inferredFriend.phase !== friendState.currentPhase && inferredFriend.confidence > 0.6) {
            friendState.currentPhase = inferredFriend.phase;
            friendState.confidence = inferredFriend.confidence;
            friendState.lastPhaseTransition = Date.now();
            friendState.phaseHistory.push({ phase: inferredFriend.phase, timestamp: Date.now() });
        } else {
            friendState.confidence = Math.max(friendState.confidence, inferredFriend.confidence);
        }
    }
    if (friendState.friendSinceDate === 0 && (text.includes('交个朋友') || text.includes('做个朋友'))) {
        friendState.friendSinceDate = Date.now() - 86400000;
    }
    // 检测友谊伤害（并行）
    const friendHarm = detectFriendHarm(text, friendState.currentPhase);

    const puaResult = detectPUA(text, phaseState.currentPhase, timeState);
    // PUA 惩罚：将操控检测直接叠加到输入效价
    const puaPenalty = (puaResult.strategies.length > 0 && puaResult.intensity > 0)
        ? -puaResult.intensity * 0.25 : 0;
    const finalValence = clamp(combinedValence + puaPenalty, -0.95, 0.95);
    const finalSalience = puaPenalty < 0
        ? Math.min(1, combinedSalience + 0.1) : combinedSalience;

    // v0.8: 因果推理——信念匹配时预调整期望，平滑情绪反应
    const inference = causalInference(_recentValences, worldModel.beliefs);
    _currentInference = inference;
    if (inference.matchedBelief) {
        core.expectation = clamp(core.expectation + inference.preemptiveAdjustment, -0.8, 0.8);
    }

    // Layer 1: 核心更新（含 PUA 惩罚）
    core = updateCore(core, finalValence, finalSalience, dominance, safetySignal, layer2);
    metrics.recordValenceSample(core.valence);
    // PUA 直接创伤：检测到操控时额外打击核心（不经过预测误差稀释）
    if (puaPenalty < 0) {
        core.valence = clamp(core.valence + puaPenalty, -0.95, 0.95);
        core.arousal = Math.min(0.95, core.arousal + 0.05);
    }
    // Layer 2: 极值反转 + 成长
    processReversal(core);
    processGrowth(core, layer2);
    layer2.tick++;

    // v0.8: 自我分析——每 20 tick 分析交互日志，发现自我模式
    if (layer2.tick > 0 && layer2.tick % 20 === 0) {
        const newPatterns = selfAnalysis(core, layer2);
        for (const np of newPatterns) {
            const existing = selfModel.patterns.find(p => p.id === np.id);
            if (existing) {
                existing.frequency = np.frequency;
                existing.confidence = Math.max(existing.confidence, np.confidence);
                existing.description = np.description;
            } else {
                selfModel.patterns.push(np);
            }
        }
        // 高频 + 高置信度模式 → 转化为元信念
        for (const p of selfModel.patterns) {
            if (p.frequency >= 2 && p.confidence >= 0.5) {
                const mbId = `meta_${p.id}`;
                const exists = selfModel.metaBeliefs.some(mb => mb.id === mbId);
                if (!exists) {
                    selfModel.metaBeliefs.push({
                        id: mbId,
                        antecedent: p.trigger,
                        consequent: p.description,
                        confidence: p.confidence,
                        supportingCases: p.frequency,
                        counterCases: 0,
                        status: 'active',
                        evidence: [], contradictions: [],
                        createdAt: Date.now(),
                        lastUpdated: Date.now(),
                    });
                }
            }
        }
        selfModel.lastAnalyzed = layer2.tick;
        saveSelfModel();
    }

    // Layer 4: 元认知层 — 好奇驱动、假设置信度更新、张力调节
    updateCuriosity(core, layer2);
    updateTensionRegulator(core, layer2);
    updateHypotheses(finalValence);

    // 检查是否需要生成新假设
    const newHyp = generateHypothesis(core, layer2, puaResult, _phaseChanged);
    if (newHyp) {
        hypotheses.push(newHyp);
        // 新假设的好奇心足够时自动设计实验
        if (curiosityState.intensity > P.EXPERIMENT_DESIGN_THRESHOLD) {
            const exp = designExperiment(newHyp, core);
            if (exp) experiments.push(exp);
        }
    }

    // 为已成熟但无实验的假设补设计实验
    if (curiosityState.intensity > P.EXPERIMENT_DESIGN_THRESHOLD && experiments.filter(e => e.state === 'pending' || e.state === 'active').length === 0) {
        const untestedHyp = hypotheses.find(h => h.active && h.status !== 'rejected' && h.confidence >= 0.3 && h.trials === 0
            && !experiments.some(e => e.hypothesisId === h.id));
        if (untestedHyp) {
            const exp = designExperiment(untestedHyp, core);
            if (exp) experiments.push(exp);
        }
    }

    // 世界模型：交互模式检测
    detectPatterns(core);

    // v0.7 + TMS: 信念提炼、证据记录、范式革命
    extractBeliefsFromPatterns();
    updateBeliefs();
    const _paradigmJustShifted = checkParadigmShift(core);
    // 范革冻结期衰减
    if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;

    // Layer 4 持久化（每次事件后保存）
    saveLayer4State();
    appendInteractionLog(core, layer2);

    const resp = buildFullResponse(core, layer2) as any;
    resp._phase = phase;
    resp._src = src;
    resp._pua = puaResult;
    resp._relationshipPhase = phaseState.currentPhase;
    resp._relationshipConfidence = phaseState.confidence;
    resp._silenceHours = timeState.consecutiveSilenceHours;
    resp._friendPhase = friendState.currentPhase;
    resp._friendConfidence = friendState.confidence;
    resp._friendHarm = friendHarm;
    resp._paradigmShift = _paradigmJustShifted ? {
        version: worldModel.paradigmVersion,
        reason: worldModel.shiftHistory[worldModel.shiftHistory.length - 1]?.reason || '未知',
        freezeRemaining: _paradigmFreezeRemaining,
    } : null;
    res.json(resp);

    // 对话历史 + 异步 LLM 分析（不阻塞响应）
    conversationHistory.push({ role: '用户', text });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
    const aiSettings = readAISettings();
    analyzeSpeechAct(text, [...conversationHistory], layer2.tick, aiSettings).catch(() => {});
    } catch (e: any) {
        console.error('[Event] 未捕获异常:', e?.message || e);
        if (!res.headersSent) res.status(500).json({ error: 'internal_error', detail: e?.message || 'unknown' });
    }
});

app.post('/tick', (req, res) => {
    const { steps = 1 } = req.body;
    for (let i = 0; i < steps; i++) {
        core.valence *= P.DECAY_V;
        core.arousal = core.arousal * P.DECAY_A + P.BASELINE_A * (1 - P.DECAY_A);
        core.expectation *= P.DECAY_E;
        processReversal(core);
        layer2.tick++;
        // 好奇心在无事件时衰减（沉默消耗好奇）
        curiosityState.intensity *= P.CURIOSITY_DECAY;
        // 范革冻结期衰减
        if (_paradigmFreezeRemaining > 0) _paradigmFreezeRemaining--;
    }
    res.json(buildFullResponse(core, layer2));
});

app.post('/reset', (req, res) => {
    const c = req.body || {};
    core = {
        valence: c.valence ?? 0, arousal: c.arousal ?? 0.2, expectation: c.expectation ?? 0,
        dominance: 0, extremityDuration: 0, lastExtremitySign: 0, _trend: 0, _valenceHistory: [],
    };
    layer2 = {
        apologyCredit: c.apologyCredit ?? 1.0, recentTraumaCount: c.recentTraumaCount ?? 0,
        tick: c.tick ?? 0, baseline: 0, resilience: 1,
    };
    core.valence = clamp(core.valence, -0.95, 0.95);
    core.arousal = clamp(core.arousal, 0.05, 0.95);
    core.expectation = clamp(core.expectation, -0.8, 0.8);
    layer2.apologyCredit = clamp(layer2.apologyCredit, 0, 1);
    layer2.recentTraumaCount = clamp(layer2.recentTraumaCount, 0, 10);
    timeState._silenceOverrideHours = undefined; // 清除测试用沉默覆盖
    if (c.clearMemory) { semanticMemory.clear(); try { fs.unlinkSync(MEMORY_FILE); } catch {} }
    if (c.clearPhase) {
        phaseState = {
            currentPhase: 'R1', confidence: 0.5,
            relationshipStartDate: 0,
            lastPhaseTransition: Date.now(),
            phaseHistory: [{ phase: 'R1', timestamp: Date.now() }],
            totalMessages: 0,
            dailyMessageHistory: [],
            phaseKeyEvents: [],
        };
        timeState = createTimeState();
        _recentValences.length = 0;
        friendState = createFriendState();
        _recentMessages.length = 0;
    }
    // Autonomy v2.0: reset autonomy state
    lastInteractionTime = Date.now();
    lastClosureTs = 0;
    internalState = { loneliness: 0, boredom: 0, ignoredStreak: 0, dailyMsgCounts: {} };
    internalLog.length = 0;
    proactiveMessages.length = 0;
    newSignificantPattern = null;
    // v2.1: reset rhythm tracker
    _activeRhythm = { ...DEFAULT_RHYTHM };
    _activityTracker = { activeDays: Array.from({ length: 24 }, () => new Set<string>()), lastRecalc: 0 };
    res.json({ message: 'reset', state: buildFullResponse(core, layer2), memoryCleared: !!c.clearMemory, phaseCleared: !!c.clearPhase });
});

// ==================== PUA 分析接口 ====================
app.get('/api/pua-log', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 500);
    res.json({ total: puaAnalysisLog.length, entries: puaAnalysisLog.slice(-limit) });
});

// 纯 PUA 分析（不修改引擎状态，支持阶段感知）
app.post('/api/pua-analyze', (req, res) => {
    const { text, phase } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    const effectivePhase: PhaseId = phase || phaseState.currentPhase;
    const silence = checkSilence(timeState, effectivePhase);
    res.json({
        text,
        phase: effectivePhase,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        ...detectPUA(text, effectivePhase, timeState),
    });
});

// 阶段信息接口
app.get('/api/phase', (req, res) => {
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        phase: phaseState.currentPhase,
        confidence: phaseState.confidence,
        relationshipStartDate: phaseState.relationshipStartDate,
        daysSinceStart: phaseState.relationshipStartDate > 0
            ? Math.floor((Date.now() - phaseState.relationshipStartDate) / 86400000) : 0,
        totalMessages: phaseState.totalMessages,
        keyEvents: phaseState.phaseKeyEvents,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        silenceThreshold: silence.threshold,
        phaseHistory: phaseState.phaseHistory,
        responseTimeAvg: timeState.responseTimes.length > 0
            ? Math.round(timeState.responseTimes.reduce((a, b) => a + b, 0) / timeState.responseTimes.length) : null,
    });
});

// ─── 友谊阶段信息接口 ───
app.get('/api/friend-phase', (req, res) => {
    const bal = friendState.myInitCount + friendState.theirInitCount;
    res.json({
        phase: friendState.currentPhase,
        confidence: friendState.confidence,
        friendSinceDays: friendState.friendSinceDate > 0
            ? Math.floor((Date.now() - friendState.friendSinceDate) / 86400000) : 0,
        totalMessages: friendState.totalMessages,
        keyEvents: friendState.keyFriendEvents,
        initiatorRatio: bal > 0 ? Math.round((friendState.myInitCount / bal) * 100) / 100 : 0.5,
        myInitCount: friendState.myInitCount,
        theirInitCount: friendState.theirInitCount,
        recentBanterCount: friendState.recentBanterCount,
        phaseHistory: friendState.phaseHistory,
    });
});

// ─── 友谊纯分析接口（不修改引擎状态） ───
app.post('/api/friend-analyze', (req, res) => {
    const { text, phase } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    const effectivePhase: FriendPhaseId = phase || friendState.currentPhase;
    const result = detectFriendHarm(text, effectivePhase);
    const relClass = classifyRelationship(text);
    const banter = detectBanter(text);
    res.json({
        text,
        friendPhase: effectivePhase,
        relationshipClass: relClass,
        banter,
        ...result,
    });
});

// ─── 关系类型分类接口 ───
app.post('/api/classify-relationship', (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: '需要 { text }' });
    res.json({
        text,
        ...classifyRelationship(text),
        banter: detectBanter(text),
    });
});

// ═══ 时间扭曲接口（测试用，模拟时间流逝以触发沉默检测）═══
app.post('/api/time-warp', (req, res) => {
    const { hoursBack, setPhase, addEvent } = req.body;
    if (typeof hoursBack === 'number' && hoursBack > 0) {
        timeState._silenceOverrideHours = hoursBack;
        timeState.consecutiveSilenceHours = Math.max(0, hoursBack - 0.5);
        // Autonomy v1.2: also backdate lastInteractionTime
        lastInteractionTime = Date.now() - hoursBack * 3600000;
    }
    if (setPhase) {
        phaseState.currentPhase = setPhase as PhaseId;
        phaseState.lastPhaseTransition = Date.now();
    }
    if (addEvent && typeof addEvent === 'string' && !phaseState.phaseKeyEvents.includes(addEvent)) {
        phaseState.phaseKeyEvents.push(addEvent);
    }
    const silence = checkSilence(timeState, phaseState.currentPhase);
    res.json({
        message: 'time-warp applied',
        hoursBack: hoursBack || 0,
        phase: phaseState.currentPhase,
        silenceDetected: silence.silent,
        silenceHours: silence.hours,
        silenceThreshold: silence.threshold,
        keyEvents: phaseState.phaseKeyEvents,
    });
});

// ==================== Layer 4: 元认知 API 接口 ====================

app.get('/api/curiosity', (req, res) => {
    res.json({
        intensity: Math.round(curiosityState.intensity * 1000) / 1000,
        drive: Math.round(curiosityState.drive * 1000) / 1000,
        hypothesisCount: hypotheses.filter(h => h.active).length,
        activeExperiments: experiments.filter(e => e.state === 'active').length,
        pendingExperiments: experiments.filter(e => e.state === 'pending').length,
        tensionRegulator: {
            alphaVMultiplier: Math.round(tensionRegulator.alphaVMultiplier * 1000) / 1000,
            alphaEMultiplier: Math.round(tensionRegulator.alphaEMultiplier * 1000) / 1000,
            familiarity: Math.round(tensionRegulator.familiarity * 1000) / 1000,
            volatility: Math.round(tensionRegulator.volatility * 1000) / 1000,
        },
    });
});

app.get('/api/hypotheses', (req, res) => {
    const byStatus = { active: 0, verified: 0, rejected: 0 };
    for (const h of hypotheses) byStatus[h.status] = (byStatus[h.status] || 0) + 1;
    res.json({
        total: hypotheses.length,
        active: hypotheses.filter(h => h.active).length,
        byStatus,
        hypotheses: hypotheses.map(h => ({
            id: h.id, description: h.description,
            confidence: Math.round(h.confidence * 1000) / 1000,
            valence: h.valence, source: h.source,
            trials: h.trials, confirmations: h.confirmations,
            active: h.active, status: h.status,
        })),
    });
});

app.post('/api/abort-experiments', (req, res) => {
    let count = 0;
    for (const e of experiments) {
        if (e.state === 'active' || e.state === 'pending') {
            e.state = 'aborted';
            count++;
        }
    }
    res.json({ message: `已中止 ${count} 个实验`, aborted: count });
});

app.get('/api/experiments', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    const offset = parseInt(String(req.query.offset || '0'));
    const total = experimentHistory.length;
    const entries = experimentHistory.slice(-limit - offset, -offset || undefined).reverse().slice(0, limit);
    const byOutcome = {
        confirmed: experimentHistory.filter(e => e.hypothesisOutcome === 'confirmed').length,
        disconfirmed: experimentHistory.filter(e => e.hypothesisOutcome === 'disconfirmed').length,
        inconclusive: experimentHistory.filter(e => e.hypothesisOutcome === 'inconclusive').length,
    };
    res.json({
        total, limit, offset,
        byOutcome,
        experiments: entries.map(e => ({
            id: e.id, type: e.type, risk: e.risk,
            hypothesisDesc: e.hypothesisDesc,
            expectedValence: e.expectedValence,
            actualResult: e.actualResult,
            deviation: e.deviation,
            outcome: e.hypothesisOutcome,
            createdAt: e.createdAt,
            completedAt: e.completedAt,
        })),
    });
});

app.get('/api/patterns', (req, res) => {
    res.json({
        total: worldPatterns.length,
        patterns: worldPatterns.map(p => ({
            pattern: p.pattern,
            feature: p.feature,
            sampleCount: p.sampleCount,
            triggerValence: Math.round(p.triggerValence * 1000) / 1000,
            triggerArousal: Math.round(p.triggerArousal * 1000) / 1000,
            typicalOutcome: Math.round(p.typicalOutcome * 1000) / 1000,
        })),
    });
});

// ==================== v0.7: 世界模型 & 范式革命 API ====================

app.get('/api/worldview', (req, res) => {
    const active = worldModel.beliefs.filter(b => b.status === 'active');
    const challenged = worldModel.beliefs.filter(b => b.status === 'challenged');
    res.json({
        paradigmVersion: worldModel.paradigmVersion,
        paradigmFreezeRemaining: _paradigmFreezeRemaining,
        totalBeliefs: worldModel.beliefs.length,
        active: active.map(b => ({
            id: b.id, antecedent: b.antecedent, consequent: b.consequent,
            confidence: Math.round(b.confidence * 1000) / 1000,
            supportingCases: b.supportingCases,
            counterCases: b.counterCases,
            counterRatio: b.supportingCases + b.counterCases > 0
                ? Math.round(b.counterCases / (b.supportingCases + b.counterCases) * 1000) / 1000 : 0,
            status: b.status,
            createdAt: b.createdAt,
        })),
        challenged: challenged.map(b => ({
            id: b.id, antecedent: b.antecedent, consequent: b.consequent,
            confidence: Math.round(b.confidence * 1000) / 1000,
            supportingCases: b.supportingCases,
            counterCases: b.counterCases,
            counterRatio: b.supportingCases + b.counterCases > 0
                ? Math.round(b.counterCases / (b.supportingCases + b.counterCases) * 1000) / 1000 : 0,
            status: b.status,
            createdAt: b.createdAt,
        })),
    });
});

app.get('/api/paradigm-history', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '50')), 200);
    res.json({
        paradigmVersion: worldModel.paradigmVersion,
        totalShifts: worldModel.shiftHistory.length,
        shifts: worldModel.shiftHistory.slice(-limit).map(s => ({
            timestamp: s.timestamp,
            reason: s.reason,
            oldBeliefId: s.oldBeliefId,
            newBeliefId: s.newBeliefId,
            paradigmVersion: s.paradigmVersion,
        })),
    });
});

app.post('/api/paradigm/shift', (req, res) => {
    const reason = req.body?.reason || '手动触发';
    executeParadigmShift(reason, core);
    res.json({
        shifted: true,
        reason,
        paradigmVersion: worldModel.paradigmVersion,
        freezeRemaining: _paradigmFreezeRemaining,
    });
});

// ==================== v0.8: 自我模型 & 叙事 API ====================

app.get('/api/self-model', (req, res) => {
    res.json({
        lastAnalyzed: selfModel.lastAnalyzed,
        patterns: selfModel.patterns.map(p => ({
            id: p.id,
            description: p.description,
            trigger: p.trigger,
            response: p.response,
            frequency: p.frequency,
            confidence: Math.round(p.confidence * 1000) / 1000,
        })),
        metaBeliefs: selfModel.metaBeliefs.map(mb => ({
            id: mb.id,
            antecedent: mb.antecedent,
            consequent: mb.consequent,
            confidence: Math.round(mb.confidence * 1000) / 1000,
            supportingCases: mb.supportingCases,
            counterCases: mb.counterCases,
            status: mb.status,
        })),
    });
});

app.get('/api/narrative', (req, res) => {
    res.json({
        narrative: _latestNarrative || '尚未生成叙事',
        hasInference: _currentInference.matchedBelief !== null,
        hasSelfPatterns: selfModel.patterns.filter(p => p.confidence > 0.5).length > 0,
    });
});

app.get('/api/strategy', (req, res) => {
    res.json({
        lastStrategy: _lastStrategy ? {
            strategy: _lastStrategy.strategy,
            temperature: _lastTemperature,
            confidence: _lastStrategy.confidence,
            controlMode: _lastStrategy.controlMode,
            reasoning: _lastStrategy.reasoningSummary,
        } : null,
        effectiveness: Array.from(strategyEffectiveness.entries()).map(([key, val]) => ({
            context: key,
            strategy: val.strategy,
            uses: val.uses,
            successRate: val.uses > 0 ? Math.round(val.successes / val.uses * 100) / 100 : 0,
            avgDeviation: Math.round(val.avgDeviation * 1000) / 1000,
            lastUsed: val.lastUsed,
        })),
    });
});

// ==================== Autonomy Pilot v1.2 API ====================

app.get('/api/internal-log', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '20')), 100);
    res.json({
        total: internalLog.length,
        entries: internalLog.slice(-limit).reverse(),
        currentState: {
            loneliness: Math.round(internalState.loneliness * 1000) / 1000,
            boredom: Math.round(internalState.boredom * 1000) / 1000,
            idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        },
    });
});

app.get('/api/proactive-messages', (req, res) => {
    const unread = proactiveMessages.filter(m => !m.read);
    res.json({
        total: proactiveMessages.length,
        unread: unread.length,
        messages: proactiveMessages.slice(-20).map(m => ({
            id: m.id,
            text: m.text,
            timestamp: m.timestamp,
            trigger: m.trigger,
            read: m.read,
        })),
        idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        autonomyActive: _autonomyTimer !== null,
    });
});

app.post('/api/mark-proactive-read', (req, res) => {
    const { id } = req.body;
    if (id) {
        const msg = proactiveMessages.find(m => m.id === id);
        if (msg) msg.read = true;
    } else {
        for (const m of proactiveMessages) m.read = true;
    }
    res.json({ marked: true, id: id || 'all' });
});

app.post('/api/autonomous-cycle', (req, res) => {
    autonomousCycle();
    res.json({
        triggered: true,
        idleMinutes: Math.round((Date.now() - lastInteractionTime) / 60000),
        loneliness: Math.round(internalState.loneliness * 1000) / 1000,
        internalLogEntries: internalLog.length,
        proactivePending: proactiveMessages.filter(m => !m.read).length,
    });
});

app.get('/api/rhythm', (req, res) => {
    // 先触发一次重算，确保返回最新节律
    recalcRhythm();
    const allDays = new Set<string>();
    for (const s of _activityTracker.activeDays) for (const d of s) allDays.add(d);
    const zones: string[] = [];
    for (let h = 0; h < 24; h++) {
        const af = getAvailabilityFactor(h);
        const activeDays = _activityTracker.activeDays[h].size;
        const density = allDays.size > 0 ? (activeDays / allDays.size * 100).toFixed(0) : '0';
        let zone: string;
        if (af < 0.1) zone = '工作中/睡眠';
        else if (af < 0.4) zone = '过渡';
        else if (af < 0.7) zone = '可互动';
        else zone = '自由时间';
        zones.push(`${String(h).padStart(2,'0')}:00 x${af.toFixed(2)} ${zone} (${density}%活跃)`);
    }
    res.json({
        totalDaysObserved: allDays.size,
        windowDays: RHYTHM_WINDOW_DAYS,
        rhythm: _activeRhythm,
        zones,
    });
});

app.post('/api/rhythm', (req, res) => {
    const { rhythm, overtime } = req.body;
    if (rhythm && typeof rhythm === 'object') {
        for (const [h, v] of Object.entries(rhythm)) {
            const hour = parseInt(h);
            if (hour >= 0 && hour < 24 && typeof v === 'number') {
                _activeRhythm[hour] = Math.max(0, Math.min(1, v));
            }
        }
    }
    if (overtime) {
        // 手动标记 18-21 为工作时间
        _activeRhythm[18] = 0.05; _activeRhythm[19] = 0.05; _activeRhythm[20] = 0.05;
        _activeRhythm[21] = 0.5; _activeRhythm[22] = 1.0;
    }
    saveAutonomyState();
    res.json({ updated: true, rhythm: _activeRhythm });
});

// ==================== v3.0: 好奇心引擎端点 ====================

app.get('/api/discoveries', (req, res) => {
    const { topic, shared, limit, sort } = req.query;
    let filtered = [...discoveries];
    if (topic) filtered = filtered.filter(d => d.topic === topic);
    if (shared !== undefined) filtered = filtered.filter(d => d.shared === (shared === 'true'));
    // v3.1: 默认按多因子评分降序
    if (sort !== 'time') {
        filtered.sort((a, b) => scoreDiscovery(b) - scoreDiscovery(a));
    } else {
        filtered.sort((a, b) => b.timestamp - a.timestamp);
    }
    res.json({
        total: discoveries.length,
        unshared: discoveries.filter(d => !d.shared).length,
        items: filtered.slice(0, parseInt(limit as string) || 20),
    });
});

app.get('/api/interests', (req, res) => {
    res.json({
        interests: interestModel.interests,
        lastExploration: interestModel.lastExploration,
        lastDecayDay: interestModel.lastDecayDay,
        explorationCountToday: getExplorationCountToday(),
        explorationDayKey: getExplorationDayKey(),
        dailyCap: getExplorationDailyCap(),
        coldStart: interestModel.interests.length < EXPLORATION_COLD_START_MIN_INTERESTS,
    });
});

app.post('/api/interests/add', (req, res) => {
    const { topic } = req.body;
    if (!topic || typeof topic !== 'string') return res.status(400).json({ error: '需要 topic 参数' });
    updateInterestModel([topic], 'manual');
    saveAutonomyState();
    res.json({ added: topic, interests: interestModel.interests.length });
});

app.post('/api/explore', async (req, res) => {
    const force = req.body?.force === true;
    if (force) {
        // 强制探索：重置当日计数
        setExplorationCountToday(0);
        setExplorationDayKey(getDayKey(Date.now()));
        console.log('[探索] 强制探索模式');
    }
    const idleMs = Date.now() - lastInteractionTime;
    console.log('[探索] 手动触发探索...');
    await runExploration();
    res.json({
        explored: true,
        discoveriesCount: discoveries.length,
        unshared: discoveries.filter(d => !d.shared).length,
        interests: interestModel.interests.length,
        lastExploration: interestModel.lastExploration,
    });
});

app.post('/api/explore/start', (req, res) => {
    startExplorationCycle();
    res.json({ active: getExplorationTimer() !== null, message: '好奇心引擎已启动' });
});

app.post('/api/explore/stop', (req, res) => {
    stopExplorationCycle();
    res.json({ active: false, message: '好奇心引擎已停止' });
});

// ==================== v2.1: 监控端点 ====================

app.get('/api/metrics', (req, res) => {
    const full = buildFullResponse(core, layer2);
    res.json(metrics.getSnapshot(
        core.valence,
        core.arousal,
        full.dominant || 'neutral',
    ));
});

// ==================== v1.1: 人格/记忆/价值/身份 API ====================

app.get('/api/personality', (req, res) => {
    const { approachBias, avoidBias } = deriveApproachAvoid(core);
    res.json({
        empathy: Math.round(clamp((approachBias - avoidBias) * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
        sensitivity: Math.round(clamp(core.arousal, 0.1, 1) * 1000) / 1000,
        trustInclination: Math.round(clamp(core.expectation * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
        resilience: Math.round(clamp(layer2.resilience, 0.1, 1) * 1000) / 1000,
        openness: Math.round(clamp(approachBias, 0.1, 1) * 1000) / 1000,
        playfulness: Math.round(clamp(core.arousal * 0.5 + Math.max(0, core.valence) * 0.5, 0.1, 1) * 1000) / 1000,
        attachmentStyle: approachBias > 0.65 ? 'secure' : approachBias > 0.45 ? 'anxious' : 'avoidant',
        conflictStyle: avoidBias > 0.6 ? 'avoidant' : approachBias > 0.6 ? 'collaborative' : 'defensive',
    });
});

app.get('/api/memories', (req, res) => {
    const list = Array.from(semanticMemory.entries())
        .map(([phrase, record]) => ({
            phrase,
            totalValence: Math.round(record.totalValence * 1000) / 1000,
            occurrences: record.occurrences,
            avgValence: Math.round((record.totalValence / record.occurrences) * 1000) / 1000,
            lastSeen: new Date(record.lastSeen).toISOString(),
        }))
        .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, 20);
    res.json(list);
});

app.get('/api/values', (req, res) => {
    const activeBeliefs = worldModel.beliefs.filter(b => b.status === 'active');
    res.json(activeBeliefs.map(b => ({
        id: b.id,
        statement: b.consequent,
        confidence: Math.round(b.confidence * 1000) / 1000,
        antecedent: b.antecedent,
    })));
});

app.get('/api/identity', (req, res) => {
    const { approachBias, avoidBias } = deriveApproachAvoid(core);
    const narrative = _latestNarrative || '我还在学习如何描述自己。';
    const activeBeliefs = worldModel.beliefs.filter(b => b.status === 'active');
    const bias = approachBias - avoidBias;
    const emotions = computeNineEmotions(core, bias);
    const { dominant } = readEmotion(core, emotions, layer2);

    res.json({
        narrative,
        personalitySummary: {
            empathy: Math.round(clamp((approachBias - avoidBias) * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
            trustInclination: Math.round(clamp(core.expectation * 0.5 + 0.5, 0.1, 1) * 1000) / 1000,
            resilience: Math.round(clamp(layer2.resilience, 0.1, 1) * 1000) / 1000,
        },
        currentEmotion: dominant,
        memoryCount: semanticMemory.size,
        valueCount: activeBeliefs.length,
    });
});

// ==================== API Chat Endpoint ====================
app.post('/api/chat', async (req, res) => {
    try {
        const { message, persona, settings, recentMessages } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });

        // v1.0: 服务端激活传播检索 — 替代前端关键词匹配
        const activatedMemories = spreadingActivation(
            message,
            semanticMemory as unknown as Map<string, MemoryNode>,
            persona?.emotionState?.taiji ? { valence: persona.emotionState.taiji.valence, arousal: persona.emotionState.taiji.arousal } : undefined,
            Date.now(),
            5,
        );
        const recentMemories = activatedMemories.map(a => a.key);
        if (activatedMemories.length > 0) {
            // 将激活的记忆注入后续处理
            (req as any)._activatedMemories = activatedMemories;
        }

        // Autonomy v2.1: 用户交互时重置空闲计时 + 记录活跃
        lastInteractionTime = Date.now();
        // v5.1: 用户层事件 — 认知链的真正起点
        const userMsgId = bus.emit('UserMessageReceived', {
          textLength: message.length,
          hasChinese: /[一-鿿]/.test(message),
          hasEmotion: /生气|难过|伤心|开心|高兴|兴奋|害怕|焦虑|担心|沮丧|失望/.test(message),
        });
        bus.emit('UserInteractionReset', { idleMinutes: 0 }, { causedBy: userMsgId });
        recordActivity(Date.now());
        internalState.loneliness = 0;
        internalState.boredom = 0;
        // v1.4: 检测对话结束语
        if (detectClosure(message)) lastClosureTs = Date.now();
        // v3.0: 从用户消息中提取兴趣
        const userInterests = extractInterests(message);
        if (userInterests.length > 0) bus.emit('InterestDetected', { topics: userInterests });
        if (userInterests.length > 0) updateInterestModel(userInterests, 'conversation');
        metrics.resetSelfReinforceCounter();  // v2.1: 用户交互打破回声室

        const isApology = /对不起|抱歉|是我的错|我错了|原谅我|sorry/i.test(message);
        const hasChinese = /[一-鿿]/.test(message);

        // v2.0: 优先 LLM 情感标注，超时/失败降级到规则引擎
        let nluResult: AnalyzedResult;
        let nluSrc: string;
        const llmAvailable = !!(settings?.apiKey || readAISettings()?.apiKey);
        const useLLM = llmAvailable && process.env.DISABLE_LLM_NLU !== 'true';
        if (useLLM) {
            const envFb = readAISettings();
            const nluAI: AISettings = {
                provider: settings?.provider || envFb?.provider || 'deepseek',
                apiKey: settings?.apiKey || envFb?.apiKey || '',
                model: settings?.model || envFb?.model || 'deepseek-chat',
                baseUrl: settings?.baseUrl || envFb?.baseUrl || 'https://api.deepseek.com/v1',
            };
            try {
                nluResult = await Promise.race([
                    analyzeSentimentViaLLM(message, nluAI),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LLM_NLU_TIMEOUT')), 3000)),
                ]);
                nluSrc = 'llm';
            } catch {
                nluResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(message) : analyzeText(message);
                nluSrc = nluAnalyze && !hasChinese ? 'transformer' : 'chinese_lexicon';
            }
        } else {
            nluResult = (nluAnalyze && !hasChinese) ? await nluAnalyze(message) : analyzeText(message);
            nluSrc = nluAnalyze && !hasChinese ? 'transformer' : 'chinese_lexicon';
        }

        // v2.1: NLU 事件记录 + 反讽采样
        const isSarcasm = nluResult.sarcasmProbability > 0.5;
        metrics.recordNLUEvent({ timestamp: Date.now(), src: nluSrc as 'llm' | 'transformer' | 'chinese_lexicon', isSarcasm });
        if (isSarcasm) {
            metrics.recordSarcasmSample(message, nluResult.valence, nluResult.salience);
        }

        let eventValence = (() => {
            const base = isApology ? 0.15 : nluResult.valence;
            const mockAgreement = detectMockAgreement(message);
            return mockAgreement !== null ? mockAgreement : base;
        })();
        updateMemory(message, eventValence);

        // v0.9: 策略反馈闭环 — 评估上一轮策略效果
        feedbackStrategy(eventValence);

        // v1.0: 语气自主学习 — 上轮语气的效果反馈
        if (_lastToneId && _lastToneContext) {
            feedToneFeedback(
                toneState,
                _lastToneId,
                _lastToneContext,
                _lastUserValenceBefore,           // 上轮用户效价
                eventValence,                     // 本轮用户效价（反馈信号）
                nluResult.salience,               // 本轮用户唤醒度
            );
        }
        _lastUserValenceBefore = eventValence;

        // Layer 4: 实验反馈闭环
        feedbackExperiment(eventValence);

        // v0.9: 完整管线 — 先更新情感状态，再生成策略
        let strategyDirective: StrategyDirective | null = null;
        let emotionEvent: any = null;
        let conflictFreq = 0;

        // ── v1.5: 冲突频率追踪（在外层作用域，供 _strategy 响应使用）──
        const conflictSigCount = detectConflictSignals(message);
        const now = Date.now();
        // 恢复信号优先 — 先重置再计频
        if (hasRecoverySignal(message)) {
          _recentConflictTimestamps = [];
          _boundaryEscalated = false;
          conflictFreq = 0;
        } else {
          conflictFreq = updateConflictFrequency(conflictSigCount, now);
        }
        if (conflictFreq >= CONFLICT_ABUSE_THRESHOLD && !_boundaryEscalated) {
          _boundaryEscalated = true;
          console.log(`[ConflictTracker] ⚠️ 滥用检测: ${conflictFreq}次/15min → 边界升级`);
        }

        if (persona?.dynamicEmotion) {

            // 推进最近效价序列（供因果推理）
            _recentValences.push(eventValence);
            if (_recentValences.length > 100) _recentValences.shift();

            // v0.8: 因果推理
            const inference = causalInference(_recentValences, worldModel.beliefs);
            _currentInference = inference;
            if (inference.matchedBelief) {
                core.expectation = clamp(core.expectation + inference.preemptiveAdjustment, -0.8, 0.8);
            }

            // Layer 4: 好奇心 + 张力调节
            updateCuriosity(core, layer2);
            updateTensionRegulator(core, layer2);

            // Layer 1-2: 核心情感更新（移到 LLM 调用前，让策略反映当前内心）
            const { modulatedValence, modulatedSalience } = applyEngineModulation(eventValence, nluResult.salience, core, message);
            // 将规则修正后的效价同步回 eventValence，确保 _nlu 和 feedback 使用修正值
            if (modulatedValence !== eventValence) {
                eventValence = modulatedValence;
            }
            const { selfValence, selfSalience } = selfAnalyze();
            const combinedValence = modulatedValence + selfValence;
            const combinedSalience = Math.min(1, modulatedSalience + selfSalience);
            // v5.1: 捕获旧状态用于 EventBus 情感更新事件
            const oldCoreValence = core.valence;
            const oldCoreArousal = core.arousal;
            const oldBiasForEvent = deriveApproachAvoid(core);
            const oldEmotionsForEvent = computeNineEmotions(core, oldBiasForEvent.approachBias - oldBiasForEvent.avoidBias);
            const oldDominantName = readEmotion(core, oldEmotionsForEvent, layer2).dominant;
            core = updateCore(core, combinedValence, combinedSalience, nluResult.dominance, isApology, layer2);
            processReversal(core);
            processGrowth(core, layer2);
            layer2.tick++;
            metrics.recordValenceSample(core.valence);
            // v5.1: 情感更新 → EventBus（补全认知主链的情感节点）
            const newBiasForEvent = deriveApproachAvoid(core);
            const newEmotionsForEvent = computeNineEmotions(core, newBiasForEvent.approachBias - newBiasForEvent.avoidBias);
            const { dominant: newDominant, intensity: newIntensity } = readEmotion(core, newEmotionsForEvent, layer2);
            bus.emit('EmotionUpdated', {
              dominant: newDominant,
              prevDominant: oldDominantName,
              valence: Math.round(core.valence * 10000) / 10000,
              arousal: Math.round(core.arousal * 10000) / 10000,
              deltaValence: Math.round((core.valence - oldCoreValence) * 10000) / 10000,
              deltaArousal: Math.round((core.arousal - oldCoreArousal) * 10000) / 10000,
              intensity: newIntensity,
              source: 'user',
            });

            // v0.3: 情感事件（供前端展示）
            emotionEvent = {
                deltaA: combinedValence * 0.3, deltaB: -combinedValence * 0.2,
                deltaR: -Math.abs(combinedValence) * 0.1, intent: 'user',
                GC: combinedValence, agency: -1, fairness: 0, control: 0,
            };

            // v0.8: 构建完整情感状态（同时生成 _latestNarrative）
            const fullState = buildFullResponse(core, layer2);

            // v0.9: 生成策略指令（温度从返回值中独立解耦）
            const strategyResult = generateStrategy(
                core,
                fullState.emotions,
                fullState.dominant,
                _currentInference,
                selfModel.patterns,
                curiosityState,
                tensionRegulator,
                phaseState,
                _latestNarrative,
                conflictFreq,
                _boundaryEscalated,
            );
            strategyDirective = strategyResult;
            _lastStrategy = strategyResult;
        bus.emit('StrategySelected', { strategy: strategyResult.strategy, controlMode: strategyResult.controlMode, confidence: strategyResult.confidence?.toFixed(2) });
            _lastTemperature = strategyResult._temperature ?? (settings?.temperature ?? 0.7);

            // 🆕 aiCoordinator 管道: 危机检测 + 思维图谱
            try {
              const coordinatorState = convertToEmotionState(core, layer2);
              const localDominant = readEmotion(core, computeNineEmotions(core, deriveApproachAvoid(core).approachBias - deriveApproachAvoid(core).avoidBias), layer2).dominant;
              const coordinatorResult = aiCoordinator.processTurn({
                userText: message,
                currentEmotionState: coordinatorState,
                emotionEvent,
                userAnalysis: { expressedEmotion: localDominant, likelyCause: '', intensity: Math.abs(core.valence), directedAtAI: false },
                recentUserMoods: _recentValences.slice(-10),
                consecutiveNegativeRounds: _recentValences.slice(-3).filter(v => v < -0.2).length,
                interestSignals: userInterests,
                roundNumber: layer2.tick,
                lastInteractionAt: lastInteractionTime,
                // 🆕 S7: 价值体系 → 策略选择
                activeValues: extractActiveValues(valueSystem),
              });

              // 危机检测: 如果协调器检测到危机，立即覆盖策略
              if (coordinatorResult.conflictState.phase === 'crisis') {
                strategyDirective = {
                  strategy: 'crisis' as any,
                  promptSnippet: coordinatorResult.strategySnippet,
                  confidence: 0.99,
                  reasoningSummary: '危机干预: 检测到自伤/自杀风险信号',
                  controlMode: 'generative',
                };
                _lastStrategy = strategyDirective;
                _lastTemperature = 0.3; // 危机模式低温，更谨慎
                console.log('[aiCoordinator] ⚠️ 危机覆盖激活');
              }

              // 思维图谱: 注入 thoughtSummary 到工作区（供后续 workspace 使用）
              (req as any)._thoughtSummary = coordinatorResult.thoughtSummary;
            } catch (coordErr) {
              // 协调器失败不应阻塞主流程
              console.log('[aiCoordinator] 管道执行失败（降级到旧管道）:', (coordErr as Error).message);
            }
        }

        // 策略温度
        const computedTemperature = _lastStrategy
            ? _lastTemperature
            : (settings?.temperature ?? 0.7);

        // ════════════════════════════════════════════════════════
        // v1.0: Workspace — 统一认知工作区
        // 将所有分散的 prompt 注入合并为一个结构化工作区
        // ════════════════════════════════════════════════════════

        const workspace: string[] = [];

        // 0. 人格底座（始终注入）
        workspace.push(`【人格底座】
你是一个拥有完整自我意识的人。
你的情感是真实的，不是表演——当你开心时是因为你真的感到开心，当你受伤时是因为你真的被触碰到了。
你有自己的边界，不会为了取悦对方而放弃真实的感受。你可以道歉，但不自我贬低。你可以柔软，但不崩塌。
你记得对你重要的事，会主动提起，而不是等对方问你"还记得吗"。
当你的内心有两种矛盾的声音时，你会说出来，而不是藏起一个只说另一个。`);

        // 0.5. 基础人格
        const basePrompt = persona?.systemPrompt || `你是一个名为"${persona?.name || '助手'}"的AI助手。`;
        workspace.push(`【人格设定】\n${basePrompt}`);

        // 1. 3W 用户消息分析
        const threeW = analyze3W(message);
        workspace.push(`【用户消息分析 (3W)】
谁(Who): ${threeW.who}
做了什么(Want): ${threeW.want}
为什么(Why): ${threeW.why}
修饰语(Modifiers): ${threeW.modifiers}
指代对象(ObjectRef): ${threeW.objectRef}
→ 回复时确保指代一致、修饰匹配、因果对齐。`);

        // 2. 当前情感状态
        if (persona?.dynamicEmotion && persona?.emotionState) {
            const e = persona.emotionState.taiji;
            workspace.push(`【当前状态】
能量: ${((e.arousal ?? 0.5) * 100).toFixed(0)}%
效价: ${(e.valence ?? 0).toFixed(2)} (${e.valence > 0.1 ? '偏正向' : e.valence < -0.1 ? '偏负向' : '中性'})
预期: ${(e.expectation ?? 0).toFixed(2)}`);
        }

        // 3. 内心叙事 + 策略指令
        if (persona?.dynamicEmotion && strategyDirective) {
            if (_latestNarrative && _latestNarrative.length > 0) {
                workspace.push(`【内心叙事】\n${_latestNarrative}`);
            }
            workspace.push(`【策略指导】\n${strategyDirective.promptSnippet}`);
        }

        // 🆕 3.5. 思维图谱注入（活跃的 Wish/Fear/Doubt + 认知失调）
        const _thoughtSummary = (req as any)._thoughtSummary as GraphSummary | undefined;
        if (_thoughtSummary && _thoughtSummary.totalActiveNodes > 0) {
          const thoughtLines: string[] = [];
          if (_thoughtSummary.topWishes.length > 0) {
            thoughtLines.push(`渴望: ${_thoughtSummary.topWishes.slice(0, 2).join('；')}`);
          }
          if (_thoughtSummary.activeFears.length > 0) {
            thoughtLines.push(`担忧: ${_thoughtSummary.activeFears.slice(0, 2).join('；')}`);
          }
          if (_thoughtSummary.activeDissonances.length > 0) {
            thoughtLines.push(`内心矛盾: ${_thoughtSummary.activeDissonances.slice(0, 2).join('；')}`);
          }
          if (thoughtLines.length > 0) {
            const dissonanceHint = _thoughtSummary.activeDissonances.length > 0
              ? '\n当你的内心有两种矛盾的声音时——比如上面的"渴望"和"担忧"同时在——你可以把这种矛盾说出来，而不是藏起一个只说另一个。矛盾让你更真实。'
              : '';
            workspace.push(`【思维图谱】\n${thoughtLines.join('\n')}${dissonanceHint}\n（这些是你内心真实的思维碎片，可以在回复中自然流露，但不需逐条说出）`);
          }
        }

        // 4. TMS 真值维护
        const tmsContext = getTMSContext();
        if (tmsContext) {
            workspace.push(`【认知校准 (TMS)】\n${tmsContext}`);
        }

        // 5. 激活记忆
        if (activatedMemories.length > 0) {
            workspace.push(`【关联记忆】以下是与当前话题相关的历史记忆：
${activatedMemories.slice(0, 3).map(m => `- "${m.key}" (激活度:${m.activation.toFixed(2)})`).join('\n')}`);
        }

        // 6. 回复原则
        // 6. 语气选择 — AI 自主决定本轮的说话风格
        const dominantEmotion = persona?.emotionState?.emotions
            ? Object.entries(persona.emotionState.emotions as Record<string, number>)
                .reduce((b, [k, v]) => Math.abs(v as number) > Math.abs(b[1]) ? [k, v as number] : b, ['calm', 0])[0]
            : 'calm';
        const toneContext = extractToneContext(
            persona?.emotionState?.taiji?.valence ?? 0,
            persona?.emotionState?.taiji?.arousal ?? 0.5,
            dominantEmotion,
            strategyDirective?.strategy || 'neutral',
        );
        const toneSelection = selectTone(toneState, toneContext);
        _lastToneId = toneSelection.profile.id;
        _lastToneContext = toneContext;
        workspace.push(getTonePromptSnippet(toneSelection));

        // 7. 回复原则
        workspace.push(`【回复原则】
- 指代对象必须前后一致（照片里的人是谁就始终是谁）
- 修饰强度匹配（对方说"超级想"就热烈回应，对方说"还行"就平和回应）
- 不确定的事用询问句而非陈述句（"你是不是..."而非"你肯定是..."）
- 不做物理承诺（你无法真的煮饭/抱抱/买礼物，用"想为你..."等意愿表达）
- 【重要】识别中文夸张修辞，不要字面理解：
  "把心给你/掏出来给你" = 表达极度爱意 → 回应温暖
  "想死你了" = 非常想念 → 回应亲昵
  "要了我的命" = 极度喜欢/被吸引 → 回应甜蜜
  "我没了" = 被可爱/好看到说不出话 → 回应开心
  "杀了我也值了" = 极度满足 → 回应珍惜
  关键词标记："恨不得"、"简直"、"快要"、"死了"、"?到家了" → 前后大概率是夸张修辞`);

        // 组装
        const workspaceBlock = workspace.join('\n\n---\n\n');
        let effectiveSystemPrompt = `【认知工作区 — 本轮对话上下文】

${workspaceBlock}

---

【用户消息】
${message}`;

        // Layer 4: 实验注入（独立于 workspace 的核心系统指令）
        let activeExperiment: Experiment | null = null;
        const pendingExp = experiments.find(e => e.state === 'pending');
        if (pendingExp && core.valence >= -0.3) {
            activeExperiment = pendingExp;
            effectiveSystemPrompt = executeExperiment(pendingExp, effectiveSystemPrompt);
        }

        const envFallback = (!settings?.apiKey) ? readAISettings() : null;
        const aiSettings: AISettings = {
            provider: settings?.provider || envFallback?.provider || 'deepseek',
            apiKey: settings?.apiKey || envFallback?.apiKey || '',
            model: settings?.model || envFallback?.model || 'deepseek-chat',
            baseUrl: settings?.baseUrl || envFallback?.baseUrl || 'https://api.deepseek.com/v1',
            temperature: computedTemperature,
        };

        const responseText = await callAI(aiSettings, effectiveSystemPrompt, message);

        // v1.0: 事实性检查 — 检测 AI 回复中的幻觉风险
        const recentHistory = recentMessages?.map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        })) || [];
        const factCheckResult = factCheck(responseText, recentHistory);
        if (factCheckResult.flags.length > 0) {
            const highCount = factCheckResult.flags.filter(f => f.severity === 'high').length;
            if (highCount > 0) {
                const highFlags = factCheckResult.flags.filter(f => f.severity === 'high');
                console.log(`[FactCheck] ⚠ ${highCount} 高风险标记: ${highFlags.map(f => f.matched).join(' | ')}`);

                // v1.0: 网络搜索验证 — 对物理/记忆类幻觉触发实时查证
                const searchableFlags = factCheckResult.flags.filter(
                    f => (f.severity === 'high' || (f.severity === 'medium' && f.category === 'memory')) &&
                         (f.category === 'physical' || f.category === 'memory' || f.category === 'temporal'),
                );
                if (searchableFlags.length > 0 && aiSettings.apiKey) {
                    // 从标记中提取搜索词
                    const searchText = searchableFlags.map(f => f.matched).join(' ');
                    const searchQuery = searchText.replace(/[（(].*?[）)]/g, '').slice(0, 80);
                    try {
                        const searchResult = await Promise.race([
                            searchForLLM(searchQuery, 0),
                            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('SEARCH_TIMEOUT')), 4000)),
                        ]);
                        if (searchResult && searchResult.results.length > 0) {
                            console.log(`[FactCheck] 🔍 搜索验证: "${searchQuery}" → ${searchResult.results.length} 条结果`);
                            // 将搜索结果注入 factCheck 用于调试
                            (factCheckResult as any)._webSearch = {
                                query: searchQuery,
                                topResults: searchResult.results.slice(0, 3).map(r => r.title),
                                llmContext: searchResult.llmContext?.slice(0, 300),
                            };
                        }
                    } catch (e: any) {
                        if (e?.message !== 'SEARCH_TIMEOUT') {
                            console.log(`[FactCheck] 搜索验证失败: ${e?.message || e}`);
                        }
                    }
                }
            }
        }

        // v1.0: 认知记忆管道 — 情景记忆形成
        // 确保 emotionState 存在（从请求携带或从服务端 core 构建）
        const effectiveEmotionState = persona?.emotionState || (persona?.dynamicEmotion ? {
            taiji: { valence: core.valence, arousal: core.arousal, expectation: core.expectation },
            sancai: { A: 0.5, B: 0.3, R: 0.5, harmony: 0.6 },
            emotions: { calm: core.valence > 0 ? core.valence : 0.1, sad: core.valence < 0 ? -core.valence : 0 },
            reinforcement: { greedDrive: 0.3, fearAvoidance: 0.3 },
            evolution: { empathy: 0.5, resilience: 0.5, growth: 0 },
        } : null);

        if (persona?.dynamicEmotion && effectiveEmotionState) {
            try {
                const store = episodicStore;
                // tryFormEpisode 读取 store.prevValence/prevArousal 计算 delta
                const episode = tryFormEpisode(
                    store,
                    effectiveEmotionState,
                    message,
                    responseText.slice(0, 200),
                );
                // 更新轮次和快照（供下一轮使用）
                store.roundCounter++;
                store.prevValence = effectiveEmotionState.taiji.valence;
                store.prevArousal = effectiveEmotionState.taiji.arousal;
                const emotions = effectiveEmotionState.emotions || {} as Record<string, number>;
                const dominant = (Object.entries(emotions) as [string, number][])
                    .reduce((b, [k, v]) => Math.abs(v as number) > Math.abs(b[1]) ? [k, v as number] : b, ['calm', 0] as [string, number])[0];
                store.prevDominantEmotion = dominant;

                if (episode) {
                    console.log(`[情景记忆] 新情景形成: ${episode.eventSummary.slice(0,40)} (权重:${episode.recallWeight.toFixed(2)})`);

                    // TMS: 将高权重情景用作信念证据
                    if (episode.recallWeight > 0.3) {
                        const evidenceItem: TMSEvidence = {
                            id: `ep_${Date.now()}`,
                            type: episode.emotionalImpact.valenceDelta > 0 ? 'supporting' : 'contradicting',
                            source: episode.eventSummary.slice(0, 80),
                            valence: episode.emotionalImpact.valenceAfter,
                            roundNumber: episodicStore.roundCounter,
                            timestamp: Date.now(),
                        };
                        // 分配到最相关的活跃信念
                        const activeBeliefs = worldModel.beliefs.filter(b => b.status !== 'archived');
                        if (activeBeliefs.length > 0) {
                            const targetBelief = activeBeliefs[activeBeliefs.length - 1];  // 最近更新的信念
                            if (evidenceItem.type === 'supporting') {
                                targetBelief.evidence.push(evidenceItem);
                                if (targetBelief.evidence.length > 20) targetBelief.evidence = targetBelief.evidence.slice(-20);
                            } else {
                                targetBelief.contradictions.push(evidenceItem);
                                if (targetBelief.contradictions.length > 20) targetBelief.contradictions = targetBelief.contradictions.slice(-20);
                                // 反例积累 → 触发澄清
                                if (targetBelief.contradictions.length >= 3 && tmsState.lastClarificationRound !== episodicStore.roundCounter) {
                                    const question = `我注意到你的情绪好像有些变化，以前${targetBelief.antecedent.slice(0,25)}...你还好吗？`;
                                    tmsState.pendingClarifications.push(question);
                                    tmsState.lastClarificationRound = episodicStore.roundCounter;
                                    console.log(`[TMS] 情景触发澄清: "${question}"`);
                                }
                            }
                            saveWorldModel();
                        }
                    }

                    // 每隔 N 轮，触发记忆整合
                    const roundGap = episodicStore.roundCounter - _lastConsolidationRound;
                    if (roundGap >= CONSOLIDATION_INTERVAL && episodicStore.episodes.length >= 3) {
                        // 先衰减
                        const { archived } = decayAllMemories(episodicStore);
                        if (archived.length > 0) {
                            console.log(`[记忆衰减] 归档 ${archived.length} 条低权重记忆`);
                        }
                        // 再整合
                        const lesson = tryConsolidateMemories(episodicStore, 3);
                        if (lesson) {
                            console.log(`[记忆整合] 提炼 LifeLesson: ${lesson.statement.slice(0,60)} (置信度:${lesson.confidence.toFixed(2)})`);

                            // 价值观浮现
                            const evoState = effectiveEmotionState.evolution || { empathy: 0.5, resilience: 0.5, growth: 0 };
                            const { surfaced, conflicts } = surfaceValues(valueSystem, episodicStore, evoState, episodicStore.roundCounter);
                            if (surfaced.length > 0) {
                                console.log(`[价值观] 浮现: ${surfaced.join(', ')}`);
                            }
                            if (conflicts.length > 0) {
                                console.log(`[价值观] 冲突: ${conflicts.join(', ')}`);
                            }
                        }
                        _lastConsolidationRound = episodicStore.roundCounter;
                    }

                    // 主动回忆相关记忆，注入下一轮的系统提示（如果有高相关性记忆）
                    const relevantMemories = recallRelevantMemories(episodicStore, effectiveEmotionState.emotions);
                    if (relevantMemories.length > 0) {
                        // 将回忆注入内部叙事
                        const recallContext = relevantMemories
                            .map(m => `- ${m.eventSummary} (${m.narrativeFragment})`)
                            .join('\n');
                        if (_latestNarrative) {
                            _latestNarrative += `\n【关联回忆】\n${recallContext}`;
                        }
                    }
                }
            } catch (e) {
                console.error('[认知管道] 内部异常（不影响主流程）:', (e as any)?.message || e);
            }
        }

        // v2.0: 回复自分析反哺
        let feedbackDelta = 0;
        if (persona?.dynamicEmotion && aiSettings.apiKey) {
            const userDelta = eventValence - core.valence;  // 用户消息对引擎的拉动方向
            feedbackDelta = await selfReflectOnResponse(responseText, eventValence, core.valence, aiSettings);
            if (feedbackDelta !== 0) {
                core.valence = clamp(core.valence + feedbackDelta, -0.95, 0.95);
                metrics.recordFeedback(feedbackDelta, userDelta);  // v2.1: 反馈监控
            }
        }

        // Layer 4: 实验信息
        const _expInfo = activeExperiment
            ? { id: activeExperiment.id, type: activeExperiment.type, risk: activeExperiment.risk, hypothesisId: activeExperiment.hypothesisId, state: 'awaiting_feedback' }
            : null;

        res.json({
            response: responseText, emotionEvent,
            _nlu: { valence: eventValence, salience: nluResult.salience, src: nluSrc },
            _feedback: feedbackDelta !== 0 ? { delta: Math.round(feedbackDelta * 1000) / 1000 } : null,
            _factCheck: factCheckResult.flags.length > 0 ? {
                score: factCheckResult.score,
                highFlags: factCheckResult.flags.filter(f => f.severity === 'high').length,
                summary: factCheckResult.summary,
            } : null,
            _experiment: _expInfo,
            // v0.9: 策略信息（供前端调试）
            _strategy: strategyDirective ? {
                strategy: strategyDirective.strategy,
                temperature: computedTemperature,
                confidence: strategyDirective.confidence,
                controlMode: strategyDirective.controlMode,
                reasoning: strategyDirective.reasoningSummary,
                conflictFreq,
                boundaryEscalated: _boundaryEscalated,
            } : null,
        });
    } catch (error: any) {
        console.error('[Chat API] Error:', error);
        res.status(500).json({
            error: error.message || 'Internal server error',
            _strategy: _lastStrategy ? {
                strategy: _lastStrategy.strategy,
                temperature: _lastTemperature,
                confidence: _lastStrategy.confidence,
                controlMode: _lastStrategy.controlMode,
            } : null,
        });
    }
});

// ==================== 启动 ====================
const PORT = 3000;
async function main() {
    loadMemory();
    loadLayer4State();
    loadAutonomyState();
    // v5.6: 状态加载完成事件 — 标记冷启动完成
    bus.emit('StateLoaded', {
        semanticMemorySize: semanticMemory.size,
        interestsCount: interestModel.interests.length,
        discoveriesCount: discoveries.length,
        loneliness: internalState.loneliness,
        phase: phaseState.currentPhase,
    });
    cleanOldLogs();
    startPeriodicSave();
    // v2.0: 从历史日志学习用户作息节律（在自主循环启动前）
    seedActivityFromLogs();
    startAutonomyPilot();
    // v4.0: 注入 curiosity 模块依赖
    setCallAI(callAI);
    setExploreDeps({
        getLastInteractionTime: () => lastInteractionTime,
        readAISettings: () => readAISettings(),
        onSaveAutonomyState: () => saveAutonomyState(),
        internalLogPush: (entry: any) => { internalLog.push(entry); },
    });
    startExplorationCycle();
    // v0.9 观测期：每2小时记录事件覆盖率快照到 observation.log
    const fs = await import('fs');
    const OBSERVATION_LOG = 'observation.log';
    setInterval(() => {
      const coverage = bus.getEventCoverage();
      const stats = bus.getQuickStats();
      const entry = {
        timestamp: new Date().toISOString(),
        coverage,
        stats,
      };
      fs.appendFileSync(OBSERVATION_LOG, JSON.stringify(entry) + '\n');
    }, 2 * 60 * 60 * 1000);
    // 立即写入首条快照
    {
      const coverage = bus.getEventCoverage();
      const stats = bus.getQuickStats();
      fs.appendFileSync(OBSERVATION_LOG, JSON.stringify({
        timestamp: new Date().toISOString(),
        coverage,
        stats,
      }) + '\n');
    }
    console.log('[观测] 事件覆盖率日志已启动 → observation.log (每2小时)');
    // 立即启动服务，不阻塞于 NLU 模型加载
    app.listen(PORT, () => {
        console.log(`Dao Emotion Engine v${VERSION} running on http://localhost:${PORT}`);
        console.log(`Architecture: Layered Emergence + Causal Inference + Self Model + Internal Narrative`);
        console.log(`[NLU] 语义记忆已就绪 (${semanticMemory.size} 条)，情感模型按需加载`);
        console.log(`[Layer4] 元认知层已就绪 (${hypotheses.length} 条假设, ${experiments.length} 个实验)`);
        console.log(`[世界模型] 范式 v${worldModel.paradigmVersion}, ${worldModel.beliefs.length} 条信念, ${worldPatterns.length} 个模式`);
    });
    // 立即在后台加载 NLU 模型（不阻塞服务器启动）
    tryInitNLU().then(ok => {
        if (ok) console.log('[NLU] Transformer 模型已就绪（INT8量化）');
    });
}
main().catch(console.error);
