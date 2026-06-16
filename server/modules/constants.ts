// server.ts 独立常量（从 server.ts 逐块抽取）
// 依赖: 无（纯数值常量）

// ═══ 核心情感参数 ═══
export const P = {
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


// ═══ 文件路径 ═══
export const MEMORY_FILE = "./memories/semantic_memory.json";
export const LAYER4_STATE_FILE = "./memories/layer4_state.json";
export const HYPOTHESES_FILE = "./memories/hypotheses.json";
export const PATTERNS_FILE = "./memories/world_patterns.json";
export const WORLD_MODEL_FILE = "./memories/world_model.json";
export const SELF_MODEL_FILE = "./memories/self_model.json";
export const LOG_DIR = "./memories";
export const PUA_LOG_PATH = "./memories/pua_analysis_log.jsonl";

// ═══ 冲突/恢复关键词 ═══
export const CONFLICT_KEYWORDS: RegExp[] = [
  /你不懂|你不理解|你根本不知道|你没在听/,
  /算了|随便|无所谓了|不想说了|不说了/,
  /你又来了|你总是|你每次都|你怎么又/,
  /生气|烦|讨厌你|受不了|无语/,
  /你太.*了|你怎么这么/,
  /别说了|住口|够了/,
  /不想理你|走开|别烦我/,
];
export const RECOVERY_KEYWORDS: RegExp[] = [
  /好吧|原谅你了|没事了|不吵了|不生气了/,
  /我也有不对|我的错|怪我/,
  /和好|抱抱|爱你|想你/,
];

// ═══ 阈值/配置常量 ═══
export const CONFLICT_WINDOW_MS = 15 * 60_000; // 15 分钟窗口
export const CONFLICT_ABUSE_THRESHOLD = 3; // 窗口内 3 次触发边界升级
export const CONSOLIDATION_INTERVAL = 10; // 每 10 轮对话整合一次
export const PARADIGM_COOLDOWN_TICKS = 20; // 范革冷却
export const MAX_HISTORY = 12; // PUA 分析最大历史

export const ROMANCE_KEYWORDS = [
    /老公|老婆|男朋友|女朋友|恋爱|约会|结婚|求婚|彩礼|见家长|见父母/,
    /想你|爱你|想你了|我爱你|我喜欢你|好想你|亲爱(的)?/,
    /抱抱|亲亲|牵手|约会|情侣|二人世界/,
];

export const FRIENDSHIP_KEYWORDS = [
    /兄弟|闺蜜|老铁|哥们|姐妹|朋友|死党|基友|损友/,
    /约饭|开黑|逛街|喝酒|聚聚|好久不见|改天聚|出来坐坐/,
    /开黑|打游戏|上分|组队|团建|聚会/,
];

export const BANTER_MARKERS = [/哈哈|233|😂|🤣|笑死|笑尿|我笑了|开玩笑|逗你(的|玩)/];;

export const BANTER_NICKNAMES = [/兄弟|老铁|闺蜜|哥们|姐妹|大姐|老弟|同志/];;

export const BANTER_INSULT_PATTERNS = [/你[个这].*[傻笨呆废]|菜鸡|弱鸡|垃圾.*(你|啊|了)|不行啊你/];;

export const INSULT_ATTACK_PATTERNS = [/你.*(就是|真|太).*[傻笨蠢废烂]|你.*(不配|没资格|差远了)/];;

export const SARCASM_INDICATORS: [RegExp, number][] = [
    [/😅|🙃|🤡/,                             0.40],
    [/呵呵/,                                  0.35],
    [/[。！]\.{3,}|[。！]\.{2,}$/,            0.30],  // "厉害。。"
    [/你[好真][棒行厉害牛]啊/,                0.25],   // "你好棒啊"（讽刺）
    [/就这|就这就这/,                         0.30],
    [/典|太典了|经典/,                        0.25],
    [/不会吧不会吧/,                          0.30],
];;

// ═══ NLU 词法分析 ═══
export const NEGATIONS: [RegExp, number, number][] = [
    [/不(是|会|能|想|要|太|再)?\B/,       3,  -1.0],   // 不喜欢、不太好、不会
    [/没(有|什么|人|事)?\B/,               2,  -1.0],   // 没喜欢、没什么
    [/(?<!特)别\B/,                         3,  -1.0],   // 别去、别这样（不匹配"特别"）
    [/毫无|从[不没有]|未曾/,               4,  -0.8],   // 毫无感觉、从未
    [/(并非|决[不非]|绝[对]?不)/,          5,  -0.9],
];;
export const INTENSIFIERS: [RegExp, number][] = [
    [/有点|有些|稍微|些许|略[微]?/,             0.50],
    [/比较|还算|还算|还算|还算/,                0.75],
    [/挺|蛮|相当|颇为/,                         1.20],
    [/很|非常|十分|特别|尤为|极其|无比/,        1.50],
    [/超级|超[级]?|巨[大]?|贼/,                  1.80],
    [/爆[炸了]?|死[了]?|疯[了]?|坏[了]?/,        2.00],
    [/透[了]?|极[了]?|到[了]?[极疯死]/,          2.00],
    [/太(.*)了/,                                1.80],
    [/最/,                                      1.60],
];;

export const EMOJI_MAP: Record<string, { valence: number; arousal: number; dominance: number }> = {
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
};;

export const PUA_ANALYSIS_SYSTEM_PROMPT = `你是一个关系言语行为分析器。你将收到一段对话历史和当前发言者的最新消息。你的任务是分析当前发言者可能使用了哪些情感操控或伤害性沟通策略（PUA模式），并给出结构化的JSON结论。

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


export const SENTIMENT_PROMPT = `你是一个中文情感分析器。分析用户消息的真实情感意图，输出JSON：
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


export const DOMINANT_MAP: Record<string, string> = {
    neutral: '平静/倦怠', joy: '喜悦/激动', calm: '平静/倦怠', sad: '失落/忧郁',
    fear: '焦虑/不安', anger: '愤怒/痛苦', love: '温暖/爱意',
    disgust: '厌恶/反感', lust: '渴望/心动', greed: '渴望/期待',
};;

export const NEGATION_RULES: any[] = [
    { negWords: ['不', '没', '没有', '别', '不要'], targetWords: ['爱', '喜欢', '可爱', '好', '想', '要', '开心', '漂亮', '棒', '善良', '温柔', '重要'], flipTo: 'negative' },
    { negWords: ['不能不', '不得不', '不会不'], targetWords: ['爱', '喜欢', '好'], flipTo: 'positive' },
    { negWords: ['一点都不', '完全不', '根本不', '丝毫不'], targetWords: ['爱', '喜欢', '可爱', '好', '开心', '漂亮', '温柔', '重要'], flipTo: 'negative' },
    { negWords: ['只会', '不过是', '只不过'], targetWords: ['装', '作', '假', '虚伪', '可爱', '撒娇'], flipTo: 'negative' },
    { negWords: [], targetWords: ['讨厌', '恨', '烦死了', '恶心', '滚', '去死', '废物', '傻逼', '神经病', '脑残', '白痴', '智障', '蠢货', '垃圾', '混蛋'], flipTo: 'negative' },
];;

export const PHASE_DURATION_THRESHOLDS = {
    R1: { min: 0, max: 90 },     // 0-3个月
    R2: { min: 90, max: 365 },   // 3-12个月
    R3: { min: 180, max: 730 },  // 6个月-2年
    R4: { min: 730, max: Infinity },
};;

// ═══ 自主循环常量 ═══
// CLOSURE_PATTERNS: see server.ts (complex pattern)
export const QUIET_HOURS = { start: 23, end: 8 };
export const AUTONOMY_CYCLE_MS = 10 * 60 * 1000;
export const IDLE_SKIP_MIN = 8;
export const CONTACT_BASE_THRESHOLD = 0.65;
export const CONTACT_IGNORE_PENALTY = 0.05;
export const CONTACT_MAX_THRESHOLD = 0.85;
export const CONTACT_RELIEF = 0.15;
export const CONTACT_DAILY_CAP = 3;

// ═══ 更多自主循环常量 ═══
export const QUIET_HOURS_RATE_MULTIPLIER = 0.2;
export const QUIET_HOURS_THRESHOLD_BOOST = 0.15;
export const MAX_PENDING_UNREAD = 2;
export const CLOSURE_GRACE_MIN = 180;
export const CLOSURE_RATE_MULTIPLIER = 0.3;
export const POST_QUIET_COOLDOWN_MIN = 60;
export const POST_QUIET_THRESHOLD_BOOST = 0.15;
export const POST_QUIET_MAX_MSGS = 1;

// 节律相关
export const RHYTHM_WINDOW_DAYS = 14;
export const RHYTHM_EMA_ALPHA = 0.25;
