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
