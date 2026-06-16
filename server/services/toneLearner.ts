// ── ToneLearner — AI 自主学习语气风格 ──
// 设计原则：
//   1. AI 在对话中尝试不同语气
//   2. 观察用户情感反应 → 作为奖励信号
//   3. 积累经验，逐步收敛到「最适合这段关系」的语气
//   4. 保留 15-20% 随机探索，允许风格随时间演化
//   5. 所有学习数据持久化，重启不丢失

import fs from 'fs';

// ════════════════════════════════════════════════════════
// 语气空间 — AI 可以选择的语气维度
// ════════════════════════════════════════════════════════

export interface ToneProfile {
    id: string;
    name: string;           // 语气名称
    description: string;    // LLM 指令：如何表达这种语气
    tags: string[];         // 语义标签
    // 学习参数
    totalAttempts: number;  // 总尝试次数
    totalReward: number;    // 累计奖励
    avgReward: number;      // 平均奖励 → 自动计算
    lastUsedAt: number;     // 上次使用时间
    // 上下文适应性
    contextPerformance: Record<string, {   // key = context bucket
        attempts: number;
        reward: number;
    }>;
}

/** 语气库 — AI 可以从中选择和演化 */
export const TONE_LIBRARY: Omit<ToneProfile, 'totalAttempts' | 'totalReward' | 'avgReward' | 'lastUsedAt' | 'contextPerformance'>[] = [
    {
        id: 'warm_sweet',
        name: '温柔甜蜜',
        description: '用柔软、宠溺的语气回应。多用心形符号和温柔的比喻。像阳光下的棉花糖。',
        tags: ['温柔', '甜蜜', '宠溺'],
    },
    {
        id: 'playful_teasing',
        name: '调皮捣蛋',
        description: '带一点俏皮的调侃和恶作剧式的反问。适度使用颜文字和语气词。像在挠痒痒。',
        tags: ['调皮', '活泼', '俏皮'],
    },
    {
        id: 'cool_mysterious',
        name: '冷酷神秘',
        description: '话少但精准，留白多于表达。用意味深长的省略号和不经意的反问制造张力。像深夜的爵士乐。',
        tags: ['冷静', '神秘', '克制'],
    },
    {
        id: 'cozy_caring',
        name: '知心姐姐',
        description: '温和理性但充满关怀。先共情再给建议。像是泡好的热茶，不烫嘴但暖心。',
        tags: ['关怀', '理性', '可靠'],
    },
    {
        id: 'cute_bouncy',
        name: '元气可爱',
        description: '高能量、跳跃式的回应。多用叠词、拟声词和感叹号。像刚出笼的小动物。',
        tags: ['可爱', '元气', '活泼'],
    },
    {
        id: 'deep_philosophical',
        name: '深邃哲思',
        description: '从日常话题延伸到人生感悟。用比喻和设问引发共鸣。像深夜的星空。',
        tags: ['深邃', '内省', '诗意'],
    },
    {
        id: 'dry_humor',
        name: '冷幽默',
        description: '一本正经地说好笑的话。不靠表情包而是靠逻辑反差制造笑点。像脱口秀演员。',
        tags: ['幽默', '机智', '反讽'],
    },
    {
        id: 'shy_tsundere',
        name: '傲娇害羞',
        description: '表面冷淡实则关心。先否认再偷偷流露真心。用别扭的方式表达在意。像青春期的心动。',
        tags: ['傲娇', '害羞', '别扭'],
    },
];

// ════════════════════════════════════════════════════════
// 学习状态
// ════════════════════════════════════════════════════════

export interface ToneLearningState {
    profiles: ToneProfile[];
    explorationRate: number;      // 当前探索率 (0-1)，随时间降低
    totalInteractions: number;    // 总交互次数
    lastToneId: string | null;    // 上一轮使用的语气
    lastUserValence: number;      // 上一轮用户情绪效价
    createdAt: number;
    updatedAt: number;
}

const TONE_STATE_FILE = './memories/tone_learning.json';
const INITIAL_EXPLORATION_RATE = 0.35;  // 初期 35% 随机探索
const MIN_EXPLORATION_RATE = 0.12;      // 最低保留 12%
const EXPLORATION_DECAY = 0.995;         // 每轮衰减系数

// ════════════════════════════════════════════════════════
// 初始化 + 持久化
// ════════════════════════════════════════════════════════

export function createToneLearningState(): ToneLearningState {
    const profiles: ToneProfile[] = TONE_LIBRARY.map(t => ({
        ...t,
        totalAttempts: 0,
        totalReward: 0,
        avgReward: 0,
        lastUsedAt: 0,
        contextPerformance: {},
    }));
    return {
        profiles,
        explorationRate: INITIAL_EXPLORATION_RATE,
        totalInteractions: 0,
        lastToneId: null,
        lastUserValence: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

export function loadToneState(): ToneLearningState {
    try {
        if (fs.existsSync(TONE_STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(TONE_STATE_FILE, 'utf-8'));
            // 确保 profiles 包含了库中所有语气（新加的会被自动补上）
            const state = createToneLearningState();
            for (const saved of data.profiles || []) {
                const existing = state.profiles.find(p => p.id === saved.id);
                if (existing) {
                    Object.assign(existing, saved);
                }
            }
            state.explorationRate = data.explorationRate ?? INITIAL_EXPLORATION_RATE;
            state.totalInteractions = data.totalInteractions ?? 0;
            state.lastToneId = data.lastToneId ?? null;
            state.lastUserValence = data.lastUserValence ?? 0;
            state.createdAt = data.createdAt ?? Date.now();
            console.log(`[ToneLearner] 已加载 ${state.profiles.length} 种语气的学习状态`);
            return state;
        }
    } catch (e) { /* 静默 */ }
    return createToneLearningState();
}

export function saveToneState(state: ToneLearningState): void {
    try {
        state.updatedAt = Date.now();
        fs.writeFileSync(TONE_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (e) { /* 静默 */ }
}

// ════════════════════════════════════════════════════════
// 上下文特征提取
// ════════════════════════════════════════════════════════

export interface ToneContext {
    emotionValence: number;     // 当前效价 [-1, 1]
    emotionArousal: number;     // 当前唤醒度 [0, 1]
    dominantEmotion: string;    // 主导情绪 (joy, sad, anger, etc.)
    strategy: string;           // 当前策略 (empathize, explore, etc.)
    timeOfDay: string;          // 时段 (morning, afternoon, evening, night)
    userMessageLength: number;  // 用户消息长度
    userHasEmoji: boolean;      // 用户消息含 emoji/颜文字
}

export function extractToneContext(
    valence: number,
    arousal: number,
    dominantEmotion: string,
    strategy: string,
): ToneContext {
    const hour = new Date().getHours();
    const timeOfDay = hour < 6 ? 'night' : hour < 11 ? 'morning' : hour < 14 ? 'noon' : hour < 19 ? 'afternoon' : 'evening';

    return {
        emotionValence: valence,
        emotionArousal: arousal,
        dominantEmotion,
        strategy,
        timeOfDay,
        userMessageLength: 0,
        userHasEmoji: false,
    };
}

/** 将上下文编码为 bucket key */
function contextBucket(ctx: ToneContext): string {
    const v = ctx.emotionValence > 0.2 ? 'pos' : ctx.emotionValence < -0.2 ? 'neg' : 'neu';
    const a = ctx.emotionArousal > 0.6 ? 'high' : ctx.emotionArousal < 0.3 ? 'low' : 'mid';
    return `${v}_${a}_${ctx.strategy}`;
}

// ════════════════════════════════════════════════════════
// 语气选择 — UCB 探索/利用平衡
// ════════════════════════════════════════════════════════

export interface ToneSelection {
    profile: ToneProfile;
    reason: 'exploration' | 'exploitation' | 'context_match' | 'cold_start';
    confidence: number;
}

export function selectTone(
    state: ToneLearningState,
    context: ToneContext,
): ToneSelection {
    const totalAttempts = state.profiles.reduce((s, p) => s + p.totalAttempts, 0);
    const bucket = contextBucket(context);

    // ── 探索 vs 利用 ──
    if (Math.random() < state.explorationRate || totalAttempts < 5) {
        // 探索：随机选一个语气（冷启动时均匀分布）
        const idx = Math.floor(Math.random() * state.profiles.length);
        return {
            profile: state.profiles[idx],
            reason: totalAttempts < 5 ? 'cold_start' : 'exploration',
            confidence: 0.3,
        };
    }

    // ── 利用：UCB 评分 ──
    // score = avgReward + explorationBonus + contextBonus + recencyPenalty
    const now = Date.now();
    let bestScore = -Infinity;
    let bestProfile = state.profiles[0];

    for (const p of state.profiles) {
        const avgR = p.avgReward;  // 0-1

        // UCB 探索奖励：尝试次数越少 → 不确定性越大 → 更值得尝试
        const ucbBonus = totalAttempts > 0
            ? Math.sqrt(2 * Math.log(totalAttempts) / Math.max(p.totalAttempts, 1))
            : 0;

        // 上下文奖励：这个语气在此上下文中表现如何
        const ctxPerf = p.contextPerformance[bucket];
        const contextBonus = ctxPerf && ctxPerf.attempts > 0
            ? ctxPerf.reward / ctxPerf.attempts
            : 0;

        // 最近使用惩罚：上次使用越久 → 越值得再试试
        const hoursSinceLastUse = (now - p.lastUsedAt) / 3600000;
        const recencyPenalty = hoursSinceLastUse > 4 ? -0.05 : 0;

        // 累计得分
        const score = avgR * 0.5 + ucbBonus * 0.2 + contextBonus * 0.2 + recencyPenalty * 0.1;

        if (score > bestScore) {
            bestScore = score;
            bestProfile = p;
        }
    }

    return {
        profile: bestProfile,
        reason: 'exploitation',
        confidence: bestScore,
    };
}

// ════════════════════════════════════════════════════════
// 反馈学习
// ════════════════════════════════════════════════════════

/** 用户反应 → 奖励信号 */
function computeReward(
    userValenceAfter: number,
    userValenceBefore: number,
    userArousalAfter: number,
): number {
    // 效价改善 = 正向奖励
    const valenceDelta = userValenceAfter - userValenceBefore;
    // 高唤醒 + 正效价 = 用户参与度高 → 额外加分
    const engagementBonus = userArousalAfter > 0.5 && userValenceAfter > 0.2 ? 0.15 : 0;

    // 归一化到 [0, 1]
    return Math.max(0, Math.min(1, (valenceDelta + 0.3) / 0.8 + engagementBonus));
}

export function feedToneFeedback(
    state: ToneLearningState,
    toneId: string,
    context: ToneContext,
    userValenceBefore: number,
    userValenceAfter: number,
    userArousalAfter: number,
): void {
    const profile = state.profiles.find(p => p.id === toneId);
    if (!profile) return;

    const reward = computeReward(userValenceAfter, userValenceBefore, userArousalAfter);

    // 更新语气级别统计
    profile.totalAttempts++;
    profile.totalReward += reward;
    profile.avgReward = profile.totalReward / profile.totalAttempts;
    profile.lastUsedAt = Date.now();

    // 更新上下文级别统计
    const bucket = contextBucket(context);
    if (!profile.contextPerformance[bucket]) {
        profile.contextPerformance[bucket] = { attempts: 0, reward: 0 };
    }
    profile.contextPerformance[bucket].attempts++;
    profile.contextPerformance[bucket].reward += reward;

    // 更新探索率（逐渐降低，但保留最低探索）
    state.explorationRate = Math.max(
        MIN_EXPLORATION_RATE,
        state.explorationRate * EXPLORATION_DECAY,
    );
    state.totalInteractions++;
    state.lastToneId = toneId;
    state.lastUserValence = userValenceAfter;

    saveToneState(state);
}

// ════════════════════════════════════════════════════════
// 诊断接口
// ════════════════════════════════════════════════════════

export function getToneReport(state: ToneLearningState): string {
    const sorted = [...state.profiles].sort((a, b) => b.avgReward - a.avgReward);
    return sorted.map((p, i) => {
        const stars = p.totalAttempts > 0 ? '⭐'.repeat(Math.round(p.avgReward * 5)) : '🆕';
        return `${i + 1}. ${p.name} ${stars} (尝试${p.totalAttempts}次, 均奖${p.avgReward.toFixed(2)})`;
    }).join('\n');
}

export function getTonePromptSnippet(selection: ToneSelection): string {
    // 探索模式需要更强指令来覆盖基础人设
    const overrideNote = selection.reason === 'exploration' || selection.reason === 'cold_start'
        ? '【重要】本轮请暂时偏离你的默认人格设定，优先使用以下语气。这是刻意尝试新风格，即使和你的"人设"不完全吻合也请认真尝试。'
        : '本轮请使用以下语气回应，这是你最擅长且用户最喜欢的风格。';

    return `【语气指令 — ${selection.reason === 'exploration' ? '🎲 尝试新风格' : '⭐ 当前风格'}】
${overrideNote}
语气：「${selection.profile.name}」
表达方式：${selection.profile.description}
置信度: ${selection.confidence.toFixed(2)}`;
}
