// ── v1.4 语音语气层 (Voice Tone) ──
// 让"她的声音"随情感状态变化 —— 这是"有感情的声音"的第一层：
// 把情感引擎的主导情绪映射为语音韵律参数（pitch/rate/volume），
// 供任意 TTS 后端消费：
//   - edge-tts（现有，支持 --rate/--pitch/--volume）
//   - 浏览器 SpeechSynthesis（rate/pitch/volume 属性）
//   - 未来的情感 TTS（Chatterbox/CosyVoice…）只需把 emotion 转成自然语言语气指令
// 纯逻辑模块，无 io 依赖。

/** 语音可表达的情绪白名单（对齐情感引擎九情 + 常用温柔/安慰态） */
export type VoiceEmotion =
  | 'joy' | 'sad' | 'anger' | 'fear' | 'love' | 'calm'
  | 'disgust' | 'lust' | 'greed' | 'neutral';

/** 韵律档位：edge-tts/browser 通用 */
export interface VoiceToneProfile {
  /** 语速相对基准的百分比偏移（+变快 / −变慢），edge-tts 用 +X%/-X% */
  ratePct: number;
  /** 音高偏移 Hz（edge-tts 用 +XHz/-XHz）；browser 侧折算为 pitch */
  pitchHz: number;
  /** 音量偏移百分比 */
  volumePct: number;
  /** 人类可读的语气描述（供未来情感 TTS 转自然语言指令） */
  label: string;
}

export const EMOTION_TONES: Record<VoiceEmotion, VoiceToneProfile> = {
  joy:     { ratePct: 8,  pitchHz: 3,  volumePct: 5,  label: '轻快明亮，带着笑意' },
  sad:     { ratePct: -15, pitchHz: -4, volumePct: -5, label: '低沉缓慢，声音轻轻的' },
  anger:   { ratePct: 5,  pitchHz: 2,  volumePct: 8,  label: '带着一点情绪，语气略重' },
  fear:    { ratePct: -10, pitchHz: 2,  volumePct: -8, label: '小心翼翼，放轻声音' },
  love:    { ratePct: -3,  pitchHz: 1,  volumePct: 0,  label: '温柔而柔软，像哄人一样' },
  calm:    { ratePct: -5,  pitchHz: 0,  volumePct: -3, label: '平静安稳，不疾不徐' },
  disgust: { ratePct: 0,   pitchHz: 0,  volumePct: 0,  label: '平平淡淡' },
  lust:    { ratePct: -6,  pitchHz: -1, volumePct: -6, label: '低声，带着一点克制' },
  greed:   { ratePct: 3,   pitchHz: 1,  volumePct: 2,  label: '语气里有一点期待' },
  neutral: { ratePct: 0,   pitchHz: 0,  volumePct: 0,  label: '自然平常' },
};

const KNOWN_EMOTIONS = new Set<string>(Object.keys(EMOTION_TONES));

/** 是否平台支持的情绪值（服务端校验用，防任意注入） */
export function isVoiceEmotion(value: unknown): value is VoiceEmotion {
  return typeof value === 'string' && KNOWN_EMOTIONS.has(value);
}

/** 兜底：未知 → neutral */
export function sanitizeEmotion(value: unknown): VoiceEmotion {
  return isVoiceEmotion(value) ? value : 'neutral';
}

/**
 * 从情感状态取值最大者得到主导情绪，映射到语音情绪。
 * 情感引擎九情之外的名字（如关系层临时情绪）→ neutral。
 * v1.6 起委托给 pickVoiceEmotion（含静息情绪让位），保留此函数以兼容既有调用点。
 */
export function dominantVoiceEmotion(
  emotions: Record<string, number> | undefined | null,
): VoiceEmotion {
  return pickVoiceEmotion(emotions).emotion;
}

/** 取某情绪的语气档位（未知/缺省 → neutral） */
export function resolveEmotionTone(
  emotion: VoiceEmotion | string | undefined | null = 'neutral',
): VoiceToneProfile {
  return EMOTION_TONES[sanitizeEmotion(emotion)];
}

/** 浏览器 SpeechSynthesis 参数折算（rate≈1±、pitch≈1±、volume 0..1） */
export function browserSpeechParams(profile: VoiceToneProfile): { rate: number; pitch: number; volume: number } {
  return {
    rate: Math.min(2, Math.max(0.5, 1 + profile.ratePct / 100)),
    pitch: Math.min(2, Math.max(0.1, 1 + profile.pitchHz / 40)),
    volume: Math.min(1, Math.max(0.1, 1 + profile.volumePct / 100)),
  };
}

/** edge-tts 命令行参数（含正负号 + 单位） */
export function edgeTtsArgs(profile: VoiceToneProfile): string[] {
  const signed = (v: number, unit: string): string => `${v >= 0 ? '+' : ''}${v}${unit}`;
  return [
    '--rate', signed(profile.ratePct, '%'),
    '--pitch', signed(profile.pitchHz, 'Hz'),
    '--volume', signed(profile.volumePct, '%'),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.6 CosyVoice 情绪强化（本地实测标定，非拍脑袋）
//
// 源码事实（cosyvoice/cli/frontend.py#L209）：instruct2 = zero_shot(...) 之后
// **删掉 llm_prompt_speech_token** —— 参考音频只剩「音色」作用，**韵律完全由
// instruct 文本决定**。所以：① 换参考音不会带来情绪 ② 指令措辞是唯一入口。
//
// 四轮实测结论（E:\deepseek\cv-out\emo2~emo6，每条件 3~4 次重复，用
// tts-tools/prosody-analyze.py 量化「语速 / 音高跨度 / 力度起伏」）：
//   1. 官方 instruct_list（cosyvoice/utils/common.py#L28）全部是
//      "You are a helpful assistant. 请非常X地说一句话。" 这种英文前缀模板 ——
//      与旧版"用…的语气说这句话"不同分布，改用它更稳。故新增 CV_PREFIX。
//   2. 「难过」推得动：强化指令把语速从 5.68 字/s 压到 3.18 字/s（时长近翻倍），
//      且 n=3 复现。**指令已经吃满，不要再叠语速旋钮**（叠了 3.35 字/s，无进一步收益）。
//   3. 「开心」推不动：4 种指令文案（含官方模板 / 强化 / [laughter]）与
//      "平静自然"地板在语速、音高跨度、力度起伏上**全部落在噪声内**
//      （地板音高跨度 9.34st 甚至比开心的 8.62st 更宽）。
//      → 开心只能靠**数值语速旋钮**（mel 时间插值）拉开：
//        1.15x 使语速 4.96 → 6.44 字/s（超出噪声），1.30x 无额外收益，
//        且 1.15x 会收窄音高跨度（7.51st）—— 所以取 1.15，不贪 1.30。
//   4. 音色保持官方默认女声（用户选定），不做音色实验。
//   5. 细粒度控制符 [laughter]/[breath] 实测**无效**（[breath] 使停顿占比
//      19%~37% 双向乱跳，与不加无系统差异；[laughter] 同理），故不采用 ——
//      不为了"看起来高级"留一堆没证据的旋钮。
//
// 设计：情绪名决定「方向」，强度决定「幅度」；语速旋钮只给指令推不动的情绪用。
// ─────────────────────────────────────────────────────────────────────────────

/** CosyVoice2 官方指令模板前缀（instruct_list 全部以此开头，见 common.py#L28） */
export const CV_PREFIX = 'You are a helpful assistant. ';

/** 强化档阈值：主导情绪强度达到该值用 strong 措辞，否则 mild */
export const COSYVOICE_STRONG_INTENSITY = 0.35;

/** 语速安全区间（mel 时间插值，超出会明显失真） */
export const COSYVOICE_SPEED_RANGE = { min: 0.85, max: 1.3 } as const;

export interface CosyVoiceToneProfile {
  /** 温和档指令（情绪强度低 / 日常闲聊） */
  mild: string;
  /** 强化档指令（情绪强度高） */
  strong: string;
  /** 语速倍数（>1 更快）。**只给"指令推不动"的情绪准备** —— 实测开心只有这个杠杆有效 */
  speed: number;
}

export const COSYVOICE_TONES: Record<VoiceEmotion, CosyVoiceToneProfile> = {
  joy: {
    mild: CV_PREFIX + '请开心地说一句话。',
    strong: CV_PREFIX + '请非常开心、语调明显上扬、语速轻快、带着笑声地说一句话。',
    speed: 1.15, // 指令对开心无效，靠语速拉开（实测 4.96 → 6.44 字/s）
  },
  sad: {
    mild: CV_PREFIX + '请有点低落、慢慢地说一句话。',
    strong: CV_PREFIX + '请非常伤心、声音低沉无力、语速缓慢、带着哭腔地说一句话。',
    speed: 1.0, // 指令已把语速压到 3.18 字/s，再叠旋钮无收益
  },
  anger: {
    mild: CV_PREFIX + '请有点生气地说一句话。',
    strong: CV_PREFIX + '请非常生气、语气严厉加重、语速偏快、音量提高地说一句话。',
    speed: 1.08,
  },
  fear: {
    mild: CV_PREFIX + '请有点紧张地说一句话。',
    strong: CV_PREFIX + '请非常害怕、声音发抖、小心翼翼地说一句话。',
    speed: 0.95,
  },
  love: {
    mild: CV_PREFIX + '请温柔地说一句话。',
    strong: CV_PREFIX + '请非常温柔、充满爱意、声音轻柔放慢、像在耳边哄人一样说一句话。',
    speed: 0.95,
  },
  calm: {
    mild: CV_PREFIX + '请平静自然地说一句话。',
    strong: CV_PREFIX + '请平静安稳、不疾不徐地说一句话。',
    speed: 1.0,
  },
  disgust: {
    mild: CV_PREFIX + '请平淡地说一句话。',
    strong: CV_PREFIX + '请非常厌恶、冷淡疏离地说一句话。',
    speed: 0.98,
  },
  lust: {
    mild: CV_PREFIX + '请低声、轻轻地说一句话。',
    strong: CV_PREFIX + '请用很低、很轻、带一点克制的耳语般的声音说一句话。',
    speed: 0.95,
  },
  greed: {
    mild: CV_PREFIX + '请带着一点期待地说一句话。',
    strong: CV_PREFIX + '请非常期待、兴奋地催促着说一句话。',
    speed: 1.08,
  },
  neutral: {
    mild: CV_PREFIX + '请平静自然地说一句话。',
    strong: CV_PREFIX + '请平静自然地说一句话。',
    speed: 1.0,
  },
};

/** 静息情绪：长期占据最大值，若不做让位，她的声音会永远是"平静" */
const RESTING_EMOTIONS = new Set<string>(['calm', 'neutral']);

/** 静息情绪让位余量：另有情绪逼近静息值到该差距内时，改用它作为声音情绪 */
export const CALM_YIELD_MARGIN = 0.12;

/**
 * 选出发声情绪 + 强度。
 *
 * 线上实测：情感引擎里 `calm` 常驻最高（实测 calm 0.44 / greed 0.36 / joy 0.17），
 * 若直接取"数值最大者"，她永远以 calm 发声 —— 这本身就是"声音平"的一个成因。
 * 故：当最高者是静息情绪、而另有情绪逼近到 CALM_YIELD_MARGIN 以内时，改用后者。
 * 差距大于余量（她真的平静）时仍然选 calm。
 */
export function pickVoiceEmotion(
  emotions: Record<string, number> | undefined | null,
): { emotion: VoiceEmotion; intensity: number } {
  if (!emotions) return { emotion: 'neutral', intensity: 0 };
  // ⚠️ 只收**非零**值：全零向量（例如插值到末端的九情全为 0）若不过滤，
  // reduce 会随手挑到第一个键（对象顺序决定），返回一个强度为 0 的假"主导情绪"。
  // 实测踩到：句内弧线末段曾因此报出 `sad intensity=0`。
  const known = Object.entries(emotions).filter(
    ([name, value]) => KNOWN_EMOTIONS.has(name) && typeof value === 'number'
      && Number.isFinite(value) && Math.abs(value) > 0,
  ) as Array<[string, number]>;
  if (known.length === 0) return { emotion: 'neutral', intensity: 0 };

  const [topName, topValue] = known.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
  if (RESTING_EMOTIONS.has(topName)) {
    const runner = known
      .filter(([name]) => !RESTING_EMOTIONS.has(name))
      .reduce<[string, number] | null>((a, b) => (!a || Math.abs(b[1]) > Math.abs(a[1]) ? b : a), null);
    if (runner && Math.abs(topValue) - Math.abs(runner[1]) <= CALM_YIELD_MARGIN) {
      return { emotion: sanitizeEmotion(runner[0]), intensity: Math.abs(runner[1]) };
    }
  }
  return { emotion: sanitizeEmotion(topName), intensity: Math.abs(topValue) };
}

/**
 * 情绪强度 → 0~1 的表达强度。未传强度（老客户端/其它调用点）视为满强度 ——
 * 情绪名本身已是明确信号，不该因为缺参数退回"念稿"。
 */
export function cosyVoiceStrength(intensity?: number | null): number {
  if (typeof intensity !== 'number' || !Number.isFinite(intensity)) return 1;
  return Math.min(1, Math.max(0, Math.abs(intensity) / COSYVOICE_STRONG_INTENSITY));
}

/**
 * 情绪 → CosyVoice instruct2 指令（必须以 <|endofprompt|> 结尾）。
 * 强度 ≥ 0.5 用强化档；0.5 以下用温和档（避免日常闲聊也演得夸张）。
 */
export function cosyVoiceInstruct(
  emotion?: VoiceEmotion | string | null,
  intensity?: number | null,
): string {
  const tone = COSYVOICE_TONES[sanitizeEmotion(emotion)];
  const body = cosyVoiceStrength(intensity) >= 0.5 ? tone.strong : tone.mild;
  return `${body}<|endofprompt|>`;
}

/**
 * 情绪 → 语速倍数。强度不足时只施加一半偏移（日常闲聊不需要演），
 * 并钳制在 COSYVOICE_SPEED_RANGE 内（超出 mel 插值会明显失真）。
 */
export function cosyVoiceSpeed(
  emotion?: VoiceEmotion | string | null,
  intensity?: number | null,
): number {
  const base = COSYVOICE_TONES[sanitizeEmotion(emotion)].speed;
  const applied = 1 + (base - 1) * Math.max(0.5, cosyVoiceStrength(intensity));
  const clamped = Math.min(COSYVOICE_SPEED_RANGE.max, Math.max(COSYVOICE_SPEED_RANGE.min, applied));
  return Math.round(clamped * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.9 状态驱动的发声（State → Vocal Performance）
//
// 为什么需要它：v1.6~v1.8 只把「主导情绪标签 + 强度」送进 TTS，而她真实状态里
// 的 taiji.valence / arousal / expectation、12h 心情底色、反刍链**全被丢弃**。
// 后果：两种完全不同的内心状态，只要主导标签相同，声音就一模一样 —— 这正是
// "机械、没有状态"的来源（例如「平静但心里发沉」与「真的平静」听起来无差别）。
//
// 设计原则（按"这条通道是否被实测证明有效"来分配权重，不平均用力）：
//   · **语速是唯一被证明稳定可控的连续通道**（n=6 定案 p=0.013）→ 唤醒度只调它
//   · **参考音的音色是唯一被证明能改"发闷/明亮"的杠杆**（频谱重心 p=0.004）
//     → 效价只切音色（dark / default），而不是再堆形容词
//   · 文本形容词有上限：过长的指令实测并不更好，故修饰语**最多 2 条**，
//     且基础档里已经表达过的维度不重复说（避免自相矛盾，如"非常开心"又"语速偏慢"）
//
// 边界（必须诚实）：CosyVoice2 是**全局条件**——一次生成只有一段指令、一个语速、
// 一份参考音，**没有逐帧控制**。所以本层能表达"她此刻处于什么状态"，
// 但表达不了"一句话之内状态怎么走"（那需要 ≥2 次合成拼接，见 CLAUDE.md v1.8）。
// ─────────────────────────────────────────────────────────────────────────────

/** 发声所用的状态快照。字段全部可选；缺省即中性，**也兼容只传 emotion+intensity 的老调用点**。 */
export interface VoiceStateSnapshot {
  /** 主导情绪（白名单外会被归一到 neutral） */
  emotion?: string | null;
  /** 主导情绪强度 [0,1] */
  intensity?: number | null;
  /** 太极效价 [-1,1]：正 = 舒服，负 = 难受 */
  valence?: number | null;
  /** 唤醒度 [0,1]：高 = 紧绷/兴奋，低 = 疲软 */
  arousal?: number | null;
  /** 预期 [-1,1]：正 = 前倾期待，负 = 下沉无望 */
  expectation?: number | null;
  /** 12h 心情底色（相对静息基线的偏差） */
  mood?: { valence?: number | null; arousal?: number | null } | null;
  /** 反刍链：同一情绪连续主导的轮数 */
  rumination?: { emotion?: string | null; streak?: number | null } | null;
  /**
   * 九情强度向量（可选）。有它时**句内状态弧线**才能在向量上插值，
   * 让"哪一刻由哪种情绪主导"自然交接，而不是机械地在两段之间换标签。
   */
  emotions?: Record<string, number> | null;
}

export interface VocalPerformance {
  /** instruct2 指令（含 <|endofprompt|>） */
  instruct: string;
  /** 语速倍数 */
  speed: number;
  /** 音色：default = 官方默认女声；dark = 暗音色（胸腔共鸣、发闷） */
  timbre: 'default' | 'dark';
  /** 本次发声由哪些状态维度推动（可观测，便于线上核对状态是否真的进了声音） */
  drivers: string[];
}

/** 状态进入声音的门槛与权重（低于门槛就当她"没什么特别要表达的"，不演） */
export const VOICE_STATE_THRESHOLDS = {
  /**
   * 唤醒度死区：|arousal − 0.5| 小于它就**既不调语速也不记账**。
   * 原因（实测踩到）：arousal=0.478 会算出 −0.0035 的语速偏移（四舍五入后毫无影响），
   * 却让 drivers 报出 "arousal:low" —— 观测口径被噪声污染。
   * 与 v1.15「无信号即无误差」同一条原则：**别对噪声做动作，也别把噪声写进诊断**。
   */
  arousalDeadzone: 0.06,
  /** 效价低于此值 → 换暗音色（"发闷/胸腔共鸣"，实测 p=0.004） */
  darkValence: -0.15,
  /** 效价高于此值 → 记一笔"明亮"（音色仍是默认女声） */
  brightValence: 0.4,
  /** 预期绝对值达到此值 → 计入语速 */
  expectationThreshold: 0.2,
  /** 心情底色偏离中性达到此值才计入 */
  activeMood: 0.2,
  /** 反刍连续 ≥ 这些轮 → 计入 */
  ruminationStreak: 3,
  /**
   * 时间维度对语速的权重（各自乘到 speedDelta 上）。
   *
   * ⚠️ 为什么这些维度**只调语速、不写进指令**（v1.9 实测教训，emo12）：
   * 一旦把它们写进指令，模型会大幅拖慢语速且幅度完全不可控 ——
   * 「今天整体底色就有点沉」使时长 3.64s → 5.91s（+62%）、
   * 「像有件事还没放下」使时长 3.64s → 8.31s（**+128%**）（各 n=3，方向一致）。
   * 而语速旋钮是**有界**的（COSYVOICE_SPEED_RANGE），所以时间维度一律走旋钮；
   * 文字只留给情绪基础档（它带来的快/慢正是我们要的效果，且已被 n=6 定案测量过）。
   */
  weightArousal: 0.16,
  weightExpectation: 0.04,
  weightMood: 0.05,
  weightRumination: 0.05,
} as const;

const CV_END = '<|endofprompt|>';

function stateNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 状态快照的结构化来源（只声明用得到的字段，避免与 EmotionState 强耦合）。
 * `/api/chat` 回包里是原始 EmotionState（有 `taiji`）；`/state` 是扁平化过的
 * （valence/arousal/expectation 在顶层）—— 两种都接受。
 */
export interface VoiceStateSource {
  taiji?: { valence?: number; arousal?: number; expectation?: number } | null;
  valence?: number | null;
  arousal?: number | null;
  expectation?: number | null;
  emotions?: Record<string, number> | null;
  internal?: {
    mood?: { valence?: number; arousal?: number } | null;
    rumination?: { emotion?: string; streak?: number } | null;
  } | null;
}

/**
 * 从完整情感状态抽出"发声所需的状态快照"。
 *
 * 放在 `src/lib` 而不是 UI 里，是为了让"**哪些状态维度真的进了声音**"成为一份
 * 可单测、可审阅的清单 —— 而不是散落在组件里、下次改代码时又悄悄丢掉几个维度。
 */
export function buildVoiceState(
  state: VoiceStateSource | null | undefined,
  picked?: { emotion: VoiceEmotion; intensity: number },
): VoiceStateSnapshot {
  const chosen = picked ?? pickVoiceEmotion(state?.emotions);
  const t = state?.taiji ?? null;
  return {
    emotion: chosen.emotion,
    intensity: chosen.intensity,
    valence: stateNum(t?.valence) ?? stateNum(state?.valence),
    arousal: stateNum(t?.arousal) ?? stateNum(state?.arousal),
    expectation: stateNum(t?.expectation) ?? stateNum(state?.expectation),
    mood: state?.internal?.mood
      ? { valence: stateNum(state.internal.mood.valence), arousal: stateNum(state.internal.mood.arousal) }
      : null,
    rumination: state?.internal?.rumination
      ? {
          emotion: state.internal.rumination.emotion ?? null,
          streak: stateNum(state.internal.rumination.streak),
        }
      : null,
    // 拷一份，避免后续插值/修改影响到引擎里的原对象
    emotions: state?.emotions ? { ...state.emotions } : null,
  };
}

/**
 * 把可变的情感状态**冻结**成纯数据（"用户这句话之前"的状态必须这样取）。
 *
 * ⚠️ 踩坑提醒：`aiEngine.emotionState` 是活对象，`applyEvent` 可能就地改它 ——
 * 所以必须在跑这一轮**之前**就拷出来，晚点再读拿到的已经是"之后"的状态了。
 */
export function freezeVoiceStateSource(state: unknown): VoiceStateSource | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, any>;
  const t = s.taiji ?? {};
  const emotions = (s.emotions && typeof s.emotions === 'object')
    ? { ...(s.emotions as Record<string, number>) } : null;
  return {
    taiji: {
      valence: stateNum(t.valence) ?? undefined,
      arousal: stateNum(t.arousal) ?? undefined,
      expectation: stateNum(t.expectation) ?? undefined,
    },
    emotions,
    internal: {
      mood: s.internal?.mood
        ? { valence: stateNum(s.internal.mood.valence) ?? undefined,
            arousal: stateNum(s.internal.mood.arousal) ?? undefined }
        : null,
      rumination: s.internal?.rumination
        ? { emotion: s.internal.rumination.emotion, streak: stateNum(s.internal.rumination.streak) ?? undefined }
        : null,
    },
  } as VoiceStateSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// v1.11 句内状态弧线（voice arc）
//
// 用户要的："不是把一句话分段，而是理解说这句话所在的状态和情感，然后自然地表达出来"。
// 落地方式：一句话里她的状态从 A 走到 B，就按小句位置在 A→B 之间取中间状态，
// 每段用各自的状态发声；后段以**前段的音频**为参考音（v1.10 实测这一招方向正确），
// 只 trim 最外侧的静音、**不伪造间隙** —— 逗号停顿交给模型自己，避免"拼接感"。
// ─────────────────────────────────────────────────────────────────────────────

/** 状态移动多少才值得切分（低于它就退回单次合成：零额外代价，也不无端夸张） */
export const VOICE_ARC_MIN_VALENCE_DELTA = 0.12;
/** 一句话默认切几段的上限 */
export const VOICE_ARC_MAX_SEGMENTS = 3;
/**
 * 段数**硬上限**（延迟护栏）。
 *
 * 为什么是 3：每段 = 一次合成，延迟近似线性叠加（实测每多一段 ≈ +2.4s）。
 * 而"感情有几个相位"在这套模型里最多三个 ——
 * **12h 心情底色**（她开口时带着的）→ **本轮用户事件**（说到中间才真正进来）→ **落定后的状态**。
 *
 * ⚠️ 上限是 3，**不代表默认就用 3**：实际段数由 `resolveArcSegments()` 按感情算，
 * 多数情况是 2（用户听感裁定"两段好一点"），只有中段确实有自己的情绪时才走 3。
 */
export const VOICE_ARC_HARD_MAX = 3;

/**
 * 中段要"赢得干净"才算一个独立相位（防止在打平手的向量上抖动出第 3 段）。
 * 与 v1.15「无信号即无误差」同一条原则：**不对噪声做动作**。
 */
export const VOICE_ARC_MID_MARGIN = 1.15;

/**
 * 按中文句读把小句切开，**保留标点**；超过上限时把其余全部并入最后一段（绝不丢字）。
 * 顿号"、"不算分句点 —— 它太细，切了会碎片化。
 */
export function splitClauses(text: string, maxSegments = VOICE_ARC_MAX_SEGMENTS): string[] {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];
  const matched = trimmed.match(/[^，。！？；…\n]+[，。！？；…]*/g) ?? [trimmed];
  const parts = matched.map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return [trimmed];
  if (parts.length <= maxSegments) return parts;
  const head = parts.slice(0, maxSegments - 1);
  const tail = parts.slice(maxSegments - 1).join('');
  return [...head, tail];
}

/**
 * 中段是不是**一个独立的感情相位**？
 *
 * 判据：把 before→after 插值到中点，看**中段实际会发出的那个情绪**（`pickVoiceEmotion`，
 * 与实际生成时用的完全是同一个函数 —— 不共用就会出现"判定说切 3 段、中段却发出起点情绪"）
 * 是不是既不是起点、也不是终点。
 *
 * 这一条直接对应"三段要有三段的感情变化"：
 * - 若中段情绪 == 起点（例：sad → **sad** → calm），第 3 段只是把第 1 段念两遍，
 *   多一段只多一次接缝和延迟 —— 这时就该用 2 段。
 * - 只有中点被第三种情绪接管（例：sad → **love** → joy）时，中段才有自己的话要说。
 *
 * 另加"赢得干净"的门槛（中段 ≥ 前后两种情绪在中点的值 × `VOICE_ARC_MID_MARGIN`）：
 * 线性插值出的中点常常是几个情绪的胶着状态，胶着时判出来的主导是噪声，不该据此切段。
 */
export function hasIndependentMiddle(
  before?: VoiceStateSnapshot | null,
  after?: VoiceStateSnapshot | null,
): boolean {
  if (!before || !after) return false;
  const mid = lerpEmotions(before.emotions, after.emotions, 0.5);
  if (!mid) return false;
  const m = pickVoiceEmotion(mid)?.emotion;
  if (!m) return false;
  const from = sanitizeEmotion(before.emotion);
  const to = sanitizeEmotion(after.emotion);
  if (m === from || m === to) return false;
  const top = Math.abs(mid[m] ?? 0);
  const rival = Math.max(Math.abs(mid[from] ?? 0), Math.abs(mid[to] ?? 0));
  return top > 0 && top >= rival * VOICE_ARC_MID_MARGIN;
}

/**
 * 这一句到底切几段 —— **由感情决定，不由配置决定**。
 *
 * 上限 3（延迟护栏），下限 2（状态移动了才走到这里）；只有中段是独立相位时才用满 3。
 * 返回 0 表示"不值得切"（调用方走单次整句）。
 */
export function resolveArcSegments(
  before: VoiceStateSnapshot | null | undefined,
  after: VoiceStateSnapshot | null | undefined,
  clauseCount: number,
): number {
  const usable = Math.min(Math.max(1, Math.floor(clauseCount)), VOICE_ARC_HARD_MAX);
  if (usable < 2) return 0;
  if (usable >= 3 && hasIndependentMiddle(before, after)) return 3;
  return 2;
}

/** 中点的主导情绪（只为诊断：说明"这一轮为什么没切第 3 段"） */
export function middleVoiceEmotion(
  before?: VoiceStateSnapshot | null,
  after?: VoiceStateSnapshot | null,
): string | null {
  const mid = lerpEmotions(before?.emotions, after?.emotions, 0.5);
  if (!mid) return null;
  return pickVoiceEmotion(mid)?.emotion ?? null;
}

/**
 * 段数的**人话理由**（`/state → voiceArc.segmentReason`、设置页诊断面板都读它）。
 * 需求原话是"段数根据感情自然调整"，那就必须能回答"这一轮为什么是 2 段不是 3 段"。
 */
export function arcSegmentReason(
  before: VoiceStateSnapshot | null | undefined,
  after: VoiceStateSnapshot | null | undefined,
  segments: number,
): string {
  if (segments < 2) return '状态没移动（或句子切不开）→ 单次整句，没有接缝';
  if (segments >= 3) return '中段有自己的主导情绪 → 3 段（三段各有话说）';
  const mid = middleVoiceEmotion(before, after);
  if (!mid) return '没有九情向量 → 按 2 段';
  if (mid === sanitizeEmotion(before?.emotion)) {
    return `中段仍是「${mid}」和开头同一种情绪 → 2 段（第 3 段只会把它再念一遍）`;
  }
  if (mid === sanitizeEmotion(after?.emotion)) {
    return `中段已经是「${mid}」和结尾同一种情绪 → 2 段`;
  }
  return `中段「${mid}」与前后两种情绪都太接近（没拉开差距）→ 2 段`;
}


/**
 * 解析段数上限（调参/诊断用）：请求体覆盖 > 环境变量 `COSYVOICE_ARC_MAX_SEGMENTS` > 默认。
 * 非法值一律忽略；结果钳制到 **[1, VOICE_ARC_HARD_MAX]** ——
 * 段数是延迟的**乘数**（每段一次合成），绝不接受无界输入。
 */
export function resolveArcMaxSegments(
  requestOverride?: unknown,
  envOverride?: unknown,
): number {
  const pick = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
    return Number.isFinite(n) ? n : null;
  };
  const raw = pick(requestOverride) ?? pick(envOverride) ?? VOICE_ARC_MAX_SEGMENTS;
  return Math.min(VOICE_ARC_HARD_MAX, Math.max(1, Math.floor(raw)));
}

/**
 * 这一轮值不值得做句内弧线？只在"她的状态确实移动了"时才切分：
 * 主导情绪换人，或效价移动超过阈值。否则返回 false（调用方走单次合成）。
 */
export function shouldUseVoiceArc(
  before?: VoiceStateSnapshot | null,
  after?: VoiceStateSnapshot | null,
): boolean {
  if (!before || !after) return false;
  const bv = stateNum(before.valence);
  const av = stateNum(after.valence);
  if (bv !== null && av !== null && Math.abs(av - bv) >= VOICE_ARC_MIN_VALENCE_DELTA) return true;
  return sanitizeEmotion(before.emotion) !== sanitizeEmotion(after.emotion);
}

function lerpNumber(a: number | null | undefined, b: number | null | undefined, t: number): number | null {
  const x = stateNum(a);
  const y = stateNum(b);
  if (x === null && y === null) return null;
  return (x ?? y as number) + ((y ?? x as number) - (x ?? y as number)) * t;
}

function lerpEmotions(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined,
  t: number,
): Record<string, number> | null {
  if (!a && !b) return null;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = ((a?.[k] ?? 0) + ((b?.[k] ?? 0) - (a?.[k] ?? 0)) * t);
  return out;
}

/**
 * 把 before → after 的状态移动铺成 n 段。第 i 段取 t = i/(n-1) 处的状态。
 * 情绪标签由**插值后的九情向量**重新取主导 —— 这样"交接点"是算出来的，不是硬切的。
 */
export function buildVoiceArc(
  before: VoiceStateSnapshot,
  after: VoiceStateSnapshot,
  segments: number,
): VoiceStateSnapshot[] {
  const n = Math.max(2, Math.floor(segments));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const emo = lerpEmotions(before.emotions, after.emotions, t);
    const picked = emo ? pickVoiceEmotion(emo) : null;
    const moodV = lerpNumber(before.mood?.valence, after.mood?.valence, t);
    const moodA = lerpNumber(before.mood?.arousal, after.mood?.arousal, t);
    const streak = lerpNumber(before.rumination?.streak, after.rumination?.streak, t);
    return {
      emotion: sanitizeEmotion(picked?.emotion ?? (t < 1 ? before.emotion : after.emotion)),
      intensity: picked?.intensity ?? lerpNumber(before.intensity, after.intensity, t),
      valence: lerpNumber(before.valence, after.valence, t),
      arousal: lerpNumber(before.arousal, after.arousal, t),
      expectation: lerpNumber(before.expectation, after.expectation, t),
      mood: (moodV === null && moodA === null) ? null : { valence: moodV, arousal: moodA },
      rumination: streak === null ? null : { emotion: after.rumination?.emotion ?? null, streak },
      emotions: emo,
    };
  });
}

/**
 * 从客户端请求体提取状态快照。
 *
 * 约定：客户端把她的状态**原样**放进 `voiceState`（不解释、不加工）；
 * 同时仍旧传 `emotion`/`intensity` —— 那是浏览器语音与 edge-tts 兜底通道要用的，
 * 也保证老客户端不传 `voiceState` 时行为不变。
 *
 * 校验原则：只接受有限数字，越界钳制，非法/缺失一律忽略（退回中性）。
 * **绝不把客户端传来的字符串当指令文本**（那等于把 TTS 的指令通道开放给任意输入）。
 */
export function voiceStateFromPayload(payload: unknown): VoiceStateSnapshot {
  const p = (payload ?? {}) as Record<string, unknown>;
  const vs = (typeof p.voiceState === 'object' && p.voiceState !== null
    ? p.voiceState
    : {}) as Record<string, unknown>;
  const moodRaw = typeof vs.mood === 'object' && vs.mood !== null ? vs.mood as Record<string, unknown> : null;
  const rumRaw = typeof vs.rumination === 'object' && vs.rumination !== null
    ? vs.rumination as Record<string, unknown> : null;
  // 九情向量：只保留白名单键 + 有限数字 + 钳制到 [-1,1]。
  // 少了它，句内弧线就只能单侧插值（实测表现：末段九情全归 0 → 退化成 neutral）。
  const emoRaw = typeof vs.emotions === 'object' && vs.emotions !== null
    ? vs.emotions as Record<string, unknown> : null;
  const emotions: Record<string, number> | null = (() => {
    if (!emoRaw) return null;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(emoRaw)) {
      if (!KNOWN_EMOTIONS.has(k)) continue;
      const n = stateNum(v);
      if (n !== null) out[k] = clampRange(n, -1, 1);
    }
    return out;
  })();

  // 新字段优先；新字段缺失时退回顶层的老字段（emotion/intensity）
  const emotionValue = typeof vs.emotion === 'string'
    ? vs.emotion
    : (typeof p.emotion === 'string' ? p.emotion : null);

  return {
    emotion: emotionValue,
    intensity: stateNum(vs.intensity) ?? stateNum(p.intensity),
    valence: stateNum(vs.valence),
    arousal: stateNum(vs.arousal),
    expectation: stateNum(vs.expectation),
    mood: moodRaw ? { valence: stateNum(moodRaw.valence), arousal: stateNum(moodRaw.arousal) } : null,
    rumination: rumRaw
      ? { emotion: typeof rumRaw.emotion === 'string' ? rumRaw.emotion : null, streak: stateNum(rumRaw.streak) }
      : null,
    emotions,
  };
}

/**
 * 状态向量 → 一次发声。
 *
 * 这是"她此刻的状态"到"她的声音"的唯一权威映射：由服务端调用（情绪引擎在那边），
 * 客户端只负责把原始状态原样转发，不参与解释。
 */
export function resolveVocalPerformance(
  state?: VoiceStateSnapshot | null,
): VocalPerformance {
  const emotion = sanitizeEmotion(state?.emotion);
  const tone = COSYVOICE_TONES[emotion];
  const base = (cosyVoiceStrength(state?.intensity) >= 0.5 ? tone.strong : tone.mild)
    .replace(/。$/, '');
  const drivers: string[] = [];
  const W = VOICE_STATE_THRESHOLDS;
  /** 时间维度的语速累加量（有界），最终由 COSYVOICE_SPEED_RANGE 收口 */
  let speedDelta = 0;

  // ① 唤醒度 → 语速（唯一被证明稳定可控的连续通道）
  const arousalRaw = stateNum(state?.arousal);
  const arousal = arousalRaw === null ? null : clampRange(arousalRaw, 0, 1);
  if (arousal !== null && Math.abs(arousal - 0.5) > W.arousalDeadzone) {
    speedDelta += (arousal - 0.5) * W.weightArousal;
    drivers.push(`arousal:${arousal < 0.5 ? 'low' : 'high'}`);
  }

  // ② 效价 → 音色（"发闷 / 明亮"只能靠参考音，实测 p=0.004）
  let timbre: VocalPerformance['timbre'] = 'default';
  const valenceRaw = stateNum(state?.valence);
  const valence = valenceRaw === null ? null : clampRange(valenceRaw, -1, 1);
  if (valence !== null && valence <= W.darkValence) {
    timbre = 'dark';
    drivers.push('valence:dark');
  } else if (valence !== null && valence >= W.brightValence) {
    drivers.push('valence:bright');
  }

  // ③ 预期 → 语速（下沉变慢 / 前倾变快）
  const expRaw = stateNum(state?.expectation);
  const exp = expRaw === null ? null : clampRange(expRaw, -1, 1);
  if (exp !== null && Math.abs(exp) >= W.expectationThreshold) {
    speedDelta += exp * W.weightExpectation;
    drivers.push(`expectation:${exp < 0 ? 'low' : 'high'}`);
  }

  // ④ 12h 心情底色 → 语速（底色沉则整体慢一点）
  const moodVRaw = stateNum(state?.mood?.valence);
  const moodV = moodVRaw === null ? null : clampRange(moodVRaw, -1, 1);
  if (moodV !== null && Math.abs(moodV) >= W.activeMood) {
    speedDelta += moodV * W.weightMood;
    drivers.push(`mood:${moodV < 0 ? 'low' : 'high'}`);
  }

  // ⑤ 反刍 → 语速（还在想同一件事，会慢下来）
  const streak = stateNum(state?.rumination?.streak);
  if (streak !== null && streak >= W.ruminationStreak) {
    speedDelta -= W.weightRumination;
    drivers.push('rumination');
  }

  // 指令：**只由情绪基础档决定**（见 weightXxx 的注释：状态一旦写进指令，
  // 模型会不可控地大幅拖慢语速）。这也让指令始终短、可预测。
  const body = base;

  const baseSpeed = cosyVoiceSpeed(emotion, state?.intensity);
  const speed = Math.round(
    Math.min(
      COSYVOICE_SPEED_RANGE.max,
      Math.max(COSYVOICE_SPEED_RANGE.min, baseSpeed + speedDelta),
    ) * 100,
  ) / 100;

  return { instruct: `${body}。${CV_END}`, speed, timbre, drivers };
}

// ─────────────────────────────────────────────────────────────────────────────
// 发声诊断的展示逻辑（`/state → voice` / `voiceArc`）
// 放在 src/lib 而不是组件里：这样"怎么读这次发声"是可单测的逻辑，
// 也便于以后在聊天页复用同一套说法。
// ─────────────────────────────────────────────────────────────────────────────

export interface VoicePerformanceView {
  instruct: string;
  speed: number;
  timbre: string;
  drivers: string[];
}

export interface VoiceArcSegmentView {
  emotion: string;
  intensity: number | null;
  valence: number | null;
  arousal: number | null;
  timbre: string;
  speed: number;
}

export interface VoiceArcView {
  used: boolean;
  clauses?: string[];
  segments?: number;
  segmentReason?: string;
  timbreUsed?: string;
  states?: VoiceArcSegmentView[];
  reason?: string;
}

const TIMBRE_LABELS: Record<string, string> = {
  default: '默认女声',
  dark: '暗音色（发闷·胸腔共鸣）',
};

/** 音色提示 → 人话（未知值原样返回，便于暴露后端新增了没同步的取值） */
export function timbreLabel(t?: string | null): string {
  return TIMBRE_LABELS[t ?? ''] ?? (t || '未知');
}

function fix2(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';
}

/**
 * 把发声诊断整理成人能读的几行。
 * 关键是要能看出**状态到底有没有进到声音里**（drivers）以及**有没有走句内弧线**（used）。
 */
export function describeVoicePerformance(
  voice: VoicePerformanceView | null | undefined,
  arc: VoiceArcView | null | undefined,
): string[] {
  const lines: string[] = [];
  if (!voice) {
    lines.push('还没有发声记录 —— 聊一句或播一次语音后，这里会显示她这次是怎么发声的。');
    return lines;
  }

  lines.push(`指令：${voice.instruct.replace('<|endofprompt|>', '')}`);
  lines.push(`语速 ${fix2(voice.speed)} · 音色 ${timbreLabel(voice.timbre)}`);
  lines.push(voice.drivers?.length
    ? `状态驱动：${voice.drivers.join('、')}`
    : '状态驱动：无（她此刻状态没偏离静息值，所以不额外夸张）');

  if (!arc) return lines;

  if (arc.used && arc.states?.length) {
    lines.push(`句内弧线：是（${arc.states.length} 段）· 音色由第 1 段决定：${timbreLabel(arc.timbreUsed)}`);
    if (arc.segmentReason) lines.push(`  段数理由：${arc.segmentReason}`);
    arc.states.forEach((s, i) => {
      const head = i === 0 ? '起' : (i === arc.states!.length - 1 ? '落' : `第${i + 1}段`);
      lines.push(`  ${head} ${s.emotion}（强度 ${fix2(s.intensity)}）· 效价 ${fix2(s.valence)}`
        + ` · 唤醒 ${fix2(s.arousal)} · 语速 ${fix2(s.speed)}`);
    });
    if (arc.clauses?.length) lines.push(`  分句：${arc.clauses.join(' / ')}`);
  } else {
    lines.push(`句内弧线：否（${arc.reason || '这一轮她的状态没有移动'}）—— 走单次整句合成，没有接缝`);
  }
  return lines;
}
