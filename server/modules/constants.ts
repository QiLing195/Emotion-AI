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
