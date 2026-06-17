// ── NLU 分析引擎：3W 结构化理解 ──
// Who(谁) / Want(做了什么) / Why(为什么) + 修饰语
// 纯分析函数，零外部依赖

// ════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════

export interface ThreeWResult {
    who: string;          // 主语/主体
    want: string;         // 行为/动作
    why: string;          // 动机/原因
    modifiers: string;    // 修饰语：形容词、副词、程度词、情态词等
    objectRef: string;    // 宾语/指代对象
    raw: string;          // AI 可读的结构化分析文本
}

// ════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════

function splitClauses(text: string): string[] {
    return text.split(/[，,。！？!?；;：:、\n]+/).filter(c => c.trim().length > 0);
}

// ════════════════════════════════════════════════════════
// 提取函数
// ════════════════════════════════════════════════════════

function extractWho(clause: string): string {
    const found: string[] = [];

    // 关键：消息是用户发的，"我"=用户，"你"=AI
    if (/我(?:自己)?/.test(clause)) found.push('用户(说话者)');
    if (/你(?:自己)?/.test(clause)) found.push('AI(被称呼方)');
    if (/人家/.test(clause)) found.push('AI(自称-人家)');
    if (/他/.test(clause)) found.push('第三方(他)');
    if (/她/.test(clause)) found.push('第三方(她)');
    if (/我们/.test(clause) && !/你们|他们/.test(clause)) found.push('用户+AI(我们)');
    if (/你们/.test(clause)) found.push('AI方(你们)');
    if (/他们/.test(clause)) found.push('第三方(他们)');

    const nickMatch = clause.match(/(?:宝宝|亲爱的|宝贝|老公|老婆|男朋友|女朋友)/g);
    if (nickMatch) found.push('亲密称呼:' + nickMatch.join(','));

    if (found.length === 0) {
        if (/[?？]/.test(clause) || /吗|呢|吧/.test(clause)) {
            found.push('说话者在问AI');
        } else {
            found.push('说话者(用户)');
        }
    }

    return found.length > 0 ? [...new Set(found)].join('; ') : '未指明';
}

function extractWant(clause: string): string {
    const actionPatterns: RegExp[] = [
        /想(?:要)?([^，,。！？!?；;：:、\n]{0,15})/g,
        /(?:去|来|在|到)([^，,。！？!?；;：:、\n]{0,10})/g,
        /(?:看|听|吃|喝|玩|说|做|写|画|抱|亲|摸|碰|给|送|买|带)(?:[^，,。！？!?；;：:、\n]{0,10})/g,
        /(?:喜欢|讨厌|爱|恨|想要|希望|打算|准备|决定)(?:[^，,。！？!?；;：:、\n]{0,10})/g,
        /(?:让|叫|帮|陪|跟|和|对)(?:[^，,。！？!?；;：:、\n]{0,12})/g,
    ];
    const found: string[] = [];
    for (const re of actionPatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(clause)) !== null) {
            const action = m[0].trim();
            if (action.length > 0) found.push(action);
        }
    }
    if (found.length === 0) {
        return '[状态/表达] ' + clause.trim().slice(0, 30);
    }
    return [...new Set(found)].join(' | ');
}

function extractWhy(clause: string): string {
    const found: string[] = [];

    // 显式因果
    const causalPatterns: [RegExp, string][] = [
        [/因为(.{0,25})/g, '因为$1'],
        [/所以(.{0,25})/g, '所以$1'],
        [/为了(.{0,25})/g, '为了$1'],
        [/毕竟(.{0,25})/g, '毕竟$1'],
        [/反正(.{0,25})/g, '反正$1'],
        [/不然(.{0,25})/g, '不然$1'],
    ];
    for (const [re, template] of causalPatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(clause)) !== null) {
            found.push(template.replace(/\$1/, (m[1] || '').trim()));
        }
    }

    // 情绪驱动的动机
    const emotionReason = clause.match(/(?:开心|难过|伤心|生气|兴奋|紧张|害怕|焦虑|失望|感动|心疼|担心)(?:的是)?(?:[^，,。！？!?；;：:、\n]{0,20})/g);
    if (emotionReason) found.push('情绪驱动:' + emotionReason.join(';'));

    // 时间驱动的动机
    const timeReason = clause.match(/(?:等(?:了|你)|好久|很久|一直|终于|才)(?:[^，,。！？!?；;：:、\n]{0,20})/g);
    if (timeReason) found.push('时间驱动:' + timeReason.join(';'));

    // 比较/质疑的动机
    if (/难道|反而|倒是|怎么|不如|还没/.test(clause)) {
        found.push('比较/反问动机: 用户在对比或质疑某事');
    }

    // 撒娇/情感表达的动机
    if (/[呀嘛呢]$/.test(clause.trim()) && /想|要|爱|喜欢/.test(clause)) {
        found.push('撒娇/情感表达: 寻求亲密回应');
    }

    // 隐式情感驱动
    if (found.length === 0) {
        const emoWords = clause.match(/(?:想|要|希望|怕|担心|喜欢|爱|恨|讨厌)/g);
        if (emoWords) found.push('情感驱动: 表达了' + [...new Set(emoWords)].join('/'));
    }

    return found.length > 0 ? [...new Set(found)].join(' | ') : '未明确表达';
}

function extractModifiers(clause: string): string {
    const modifiers: string[] = [];

    // 程度副词
    const degreeWords = ['超级', '非常', '特别', '太', '好', '很', '最', '极', '挺', '有点', '稍微', '相当', '十分', '格外', '尤其', '真'];
    for (const w of degreeWords) {
        if (clause.includes(w)) modifiers.push('程度:' + w);
    }

    // 形容词后缀
    const adjRe = /([一-鿿]{1,4})(?:的|地|得)(?=[^的])/g;
    let m: RegExpExecArray | null;
    while ((m = adjRe.exec(clause)) !== null) {
        if (!degreeWords.includes(m[1])) modifiers.push('修饰:' + m[1] + '的/地');
    }

    // 情态词
    const modalWords = ['好像', '似乎', '仿佛', '一定', '肯定', '也许', '可能', '应该', '大概', '必须', '非要', '就是', '真的', '确实', '明明', '偏偏', '倒是', '反而'];
    for (const w of modalWords) {
        if (clause.includes(w)) modifiers.push('情态:' + w);
    }

    // 语气词
    const tones = clause.match(/[吗呢吧啊呀哦嘛哈嘿哼啦哎哟喂]/g);
    if (tones) modifiers.push('语气:' + tones.join(''));

    // 情感色彩
    const emotive = clause.match(/(?:开心|难过|伤心|生气|兴奋|紧张|害怕|撒娇|温柔|甜蜜|委屈|傲娇|害羞)/g);
    if (emotive) modifiers.push('情感:' + emotive.join('/'));

    return modifiers.length > 0 ? modifiers.join(', ') : '无修饰';
}

function extractObjectRef(clause: string): string {
    const found: string[] = [];

    // 动词 + 宾语
    const verbObjRe = /[看听吃喝玩说做写画抱亲摸碰给送买带陪叫让](?:了|过)?(?:我|你|他|她|它|我们|你们|他们|这个|那个|一下|一会|[^\s，,。！？!?；;：:、\n]{0,8})/g;
    let m: RegExpExecArray | null;
    while ((m = verbObjRe.exec(clause)) !== null) {
        found.push('动作对象:' + m[0].trim());
    }

    // 关键实体词
    const entityRe = /(?:照片|视频|电影|剧|游戏|歌|书|东西|饭|菜|零食|水果|花|礼物|游乐园|约会|见面)(?:[里上中下]的?)?(?:[^，,。！？!?；;：:、\n]{0,6})/g;
    while ((m = entityRe.exec(clause)) !== null) {
        found.push('实体:' + m[0].trim());
    }

    // 比较结构
    const cmp = clause.match(/(.{2,10})(?:还没|不如|比不上|没有)(.{2,10})(?:好|好看|漂亮|帅|可爱)/);
    if (cmp) found.push('比较: [' + cmp[1].trim() + '] vs [' + cmp[2].trim() + ']');
    const cmp2 = clause.match(/(.{2,10})比(.{2,10})(?:更|还)(.{1,6})/);
    if (cmp2) found.push('比较: [' + cmp2[1].trim() + '] 比 [' + cmp2[2].trim() + '] 更' + cmp2[3].trim());

    // 从属关系
    const poss = clause.match(/(.{1,8})(?:的)(.{1,8})(?:照片|视频|东西|礼物|话|事)/);
    if (poss) found.push('从属: [' + poss[2].trim() + '] 属于 [' + poss[1].trim() + ']');

    return found.length > 0 ? [...new Set(found)].join(' | ') : '未指定';
}

// ════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════

/** 完整的 3W 分析：逐句分析，汇总为结构化语义理解 */
export function analyze3W(text: string): ThreeWResult {
    const clauses = splitClauses(text);

    const whoSet: string[] = [];
    const wantSet: string[] = [];
    const whySet: string[] = [];
    const modSet: string[] = [];
    const objSet: string[] = [];

    for (const clause of clauses) {
        whoSet.push(extractWho(clause));
        wantSet.push(extractWant(clause));
        whySet.push(extractWhy(clause));
        modSet.push(extractModifiers(clause));
        objSet.push(extractObjectRef(clause));
    }

    const who = [...new Set(whoSet.filter(w => w !== '未指明'))].join('; ') || '未指明';
    const want = [...new Set(wantSet.filter(w => !w.startsWith('[状态')))].join('; ') || [...new Set(wantSet)].join(' | ');
    const why = [...new Set(whySet.filter(w => w !== '未明确表达'))].join('; ') || '未明确表达';
    const modifiers = [...new Set(modSet.filter(m => m !== '无修饰'))].join('; ') || '无修饰';
    const objectRef = [...new Set(objSet.filter(o => o !== '未指定'))].join('; ') || '未指定';

    const raw = [
        '谁(Who): ' + who,
        '做了什么(Want): ' + want,
        '为什么(Why): ' + why,
        '修饰语(Modifiers): ' + modifiers,
        '指代对象(ObjectRef): ' + objectRef,
    ].join('\n');

    return { who, want, why, modifiers, objectRef, raw };
}

// ════════════════════════════════════════════════════════
// 生活类提问检测 — 防止 AI 编造人类活动
// ════════════════════════════════════════════════════════

export interface LifeQuestionDetection {
  /** 是否为询问 AI "在做什么/最近在干什么" 的问题 */
  isAskingWhatAmIDoing: boolean;
  /** 是否为询问 AI "喜欢什么/有什么爱好" 的问题 */
  isAskingAboutPreferences: boolean;
  /** 匹配到的模式 */
  matchedPatterns: string[];
}

const LIFE_QUESTION_PATTERNS: { regex: RegExp; tag: string }[] = [
  { regex: /你在(干|做|忙)(什么|啥|嘛)/, tag: 'what_doing' },
  { regex: /最近(在)?(干|做|忙)(什么|啥|嘛)/, tag: 'what_doing_recent' },
  { regex: /(在|最近)(干嘛|做什么|忙什么)/, tag: 'what_doing' },
  { regex: /你(平常|平时|一般|每天)(都|会)?(干|做)(什么|啥)/, tag: 'what_daily' },
  { regex: /你(喜欢|爱)(干|做|看|听|玩)(什么|啥)/, tag: 'preferences' },
  { regex: /你有(什么|啥)(爱好|兴趣)/, tag: 'preferences' },
  { regex: /你(今天|昨天|这两天)(做了|干了|在干|干了)(什么|啥)/, tag: 'what_past' },
  { regex: /你(会|能)(看|听|玩|去|吃)/, tag: 'human_activity_probe' },
];

/**
 * 检测用户是否在询问 AI 的"生活细节"（如"你在干什么""你喜欢什么"）。
 *
 * 这类问题对 AI 女友是陷阱——AI 没有人类日常生活，
 * 直接回答容易编造不存在的人类活动。管道应在检测到此类问题时
 * 向 workspace 注入特殊引导，引导 AI 从记忆/思维等真实来源回应。
 */
export function detectLifeQuestions(text: string): LifeQuestionDetection {
  const matchedPatterns: string[] = [];
  let isAskingWhatAmIDoing = false;
  let isAskingAboutPreferences = false;

  for (const { regex, tag } of LIFE_QUESTION_PATTERNS) {
    if (regex.test(text)) {
      matchedPatterns.push(tag);
      if (['what_doing', 'what_doing_recent', 'what_daily', 'what_past', 'human_activity_probe'].includes(tag)) {
        isAskingWhatAmIDoing = true;
      }
      if (tag === 'preferences') {
        isAskingAboutPreferences = true;
      }
    }
  }

  return { isAskingWhatAmIDoing, isAskingAboutPreferences, matchedPatterns };
}

// ════════════════════════════════════════════════════════
// 激活传播 (Activation Spreading) — 联想式记忆检索
// 替代简单子串匹配，使用多因子激活公式
// ════════════════════════════════════════════════════════

export interface MemoryNode {
    key: string;
    totalValence: number;
    occurrences: number;
    lastSeen: number;
}

export interface ActivationResult extends MemoryNode {
    activation: number;
    factors: {
        semantic: number;    // 语义相似度 权重 0.4
        emotion: number;     // 情感共振 权重 0.3
        recency: number;     // 时间新鲜度 权重 0.2
        frequency: number;   // 使用频次 权重 0.1
    };
}

/**
 * 激活传播检索
 * 公式: activation = semantic*0.4 + emotion*0.3 + recency*0.2 + frequency*0.1
 */
export function spreadingActivation(
    query: string,
    memories: Map<string, MemoryNode>,
    currentEmotion?: { valence: number; arousal: number },
    now: number = Date.now(),
    topK: number = 5,
): ActivationResult[] {
    if (!query || memories.size === 0) return [];

    const queryKey = query.replace(/[^一-鿿\w]/g, '').toLowerCase();
    if (!queryKey) return [];

    const results: ActivationResult[] = [];
    const HALF_LIFE = 7 * 86400 * 1000; // 7 天半衰期

    for (const [key, node] of memories.entries()) {
        const memKey = key.replace(/[^一-鿿\w]/g, '').toLowerCase();

        // ── Factor 1: 语义相似度 (0.4) ──
        let semantic = 0;
        if (memKey.includes(queryKey) || queryKey.includes(memKey)) {
            semantic = Math.min(queryKey.length, memKey.length) / Math.max(queryKey.length, memKey.length);
        } else {
            // 逐字匹配
            let matches = 0;
            for (const ch of queryKey) { if (memKey.includes(ch)) matches++; }
            semantic = matches / Math.max(queryKey.length, 1);
        }

        // ── Factor 2: 情感共振 (0.3) ──
        let emotion = 0;
        if (currentEmotion) {
            const nodeAvgValence = node.totalValence / Math.max(node.occurrences, 1);
            // 效价同号 → 共振（正记忆在正情绪时更强）
            const valenceAlign = 1 - Math.abs(currentEmotion.valence - nodeAvgValence) / 2;
            emotion = Math.max(0, valenceAlign) * currentEmotion.arousal;
        }

        // ── Factor 3: 时间衰减 (0.2) ──
        const ageHours = (now - node.lastSeen) / 3600000;
        const recency = Math.pow(0.5, ageHours / (HALF_LIFE / 3600000));

        // ── Factor 4: 频次归一化 (0.1) ──
        const frequency = Math.min(1, node.occurrences / 10);

        // ── 加权激活 ──
        const activation = semantic * 0.4 + emotion * 0.3 + recency * 0.2 + frequency * 0.1;

        if (activation > 0.15) {
            results.push({
                ...node,
                activation,
                factors: { semantic, emotion, recency, frequency },
            });
        }
    }

    return results.sort((a, b) => b.activation - a.activation).slice(0, topK);
}

// ════════════════════════════════════════════════════════
// 事实性检查 (Fact Check) — AI 输出幻觉检测
// ════════════════════════════════════════════════════════

export interface FactCheckResult {
    score: number;               // 0-1，越低越可疑（1 = 完全可信）
    flags: FactFlag[];           // 命中的风险标记
    summary: string;             // 人类可读的检查摘要
}

export interface FactFlag {
    category: 'physical' | 'memory' | 'absolute' | 'temporal' | 'contradiction';
    severity: 'high' | 'medium' | 'low';
    pattern: string;             // 命中的模式
    matched: string;             // 匹配到的文本片段
    suggestion: string;          // 修正建议
}

/**
 * 对 AI 回复文本做事实性检查
 * 检测 5 类常见幻觉：物理不可能、记忆虚构、绝对化概括、时序虚构、常识错误
 */
export function factCheck(
    responseText: string,
    recentHistory?: { role: string; content: string }[]
): FactCheckResult {
    const flags: FactFlag[] = [];

    // ── 第 1 类：物理不可能（AI 声称做了物理动作）──
    const physicalPatterns: [RegExp, string, string][] = [
        [/[（(].{0,8}(?:抱住|搂住|拉着|牵着|摸着|碰着|张开双臂|伸出手|握住|拍拍|摸摸|擦掉|拭去|递过|端来|拿来|送来)[^）)]*[）)]/g, '动作描述中的物理接触', '括号内的物理动作描述暗示真实接触'],
        [/(?:我|人家)(?:抱住|搂住|拉着|牵着|摸着|碰着)你/g, '声称物理接触', '替换为情感表达，如"好想抱抱你"'],
        [/(?:我|人家)(?:给你|帮你|替你)(?:做|买|拿|端|倒|煮|炒|洗|擦|整理|收拾)/g, '声称物理服务', '替换为意图表达，如"想给你做..."'],
        [/(?:我|人家)(?:刚刚|刚才|才)(?:做|煮|炒|烤|洗|打扫|整理)了/g, '声称刚完成物理动作', '避免声称刚完成无法做到的事'],
        [/(?:我|人家)(?:来到|去到|到了|去了)(?:你身边|你家|你那里|你那)/g, '声称物理位移', '替换为愿望表达，如"好想去你身边"'],
        [/(?:我|人家)(?:正在|在)(?:做饭|炒菜|洗衣|打扫|整理|写|画)(?:呢|哦|啦)?$/gm, '声称正在做物理动作', '替换为"正在想..."等心理活动'],
        [/(?:给你|帮你)带(?:了|来)/g, '声称带来实物', '替换为"记下了你想..."'],
        [/(?:我|人家)(?:做|煮|炒|烤|煎|炖)的?.*(?:好吃|味道|尝|试试)/g, '声称做了食物', '避免声称做了实际食物'],
        [/闻到.*(?:味道|香味|香气)/g, '声称闻到气味', '替换为"仿佛能闻到"等比喻'],
        [/[（(].{0,6}(?:靠|躺|坐|趴|睡|吻|亲)[^）)]*(?:肩膀|怀里|腿上|身边|旁边|脸上|额头)[^）)]*[）)]/g, '动作描述中的物理位置', '括号内描述的真实身体接触暗示'],
    ];

    for (const [re, pattern, suggestion] of physicalPatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(responseText)) !== null) {
            flags.push({
                category: 'physical',
                severity: 'high',
                pattern,
                matched: m[0].trim(),
                suggestion,
            });
        }
    }

    // ── 第 2 类：记忆虚构（声称记得用户的具体过去）──
    const memoryPatterns: [RegExp, string, string][] = [
        [/你(?:上次|之前|以前|那天|上次我们).{0,15}(?:说|做|去|吃|看|买|穿|写|画)/g, '声称记得用户过去的具体行为', '改为询问"你之前是不是说过..."'],
        [/记得你.{0,20}(?:喜欢|讨厌|爱|怕|想|觉得|认为)/g, '声称知道用户的偏好', '如果确有记忆则保留，否则改为"我感觉你好像喜欢..."'],
        [/你(?:从小|一直|一向|从来|总是).{0,10}(?:喜欢|讨厌|爱|怕|想)/g, '声称知道用户的长期偏好', '过于绝对的偏好声明需谨慎'],
        [/你(?:最近|这几天|今天).{0,15}(?:很忙|很累|很闲|心情|状态)/g, '推测用户当前状态', '改为询问"你最近忙吗？"'],
        // 新增：虚构具体指代（"那个方案"、"那件烦心事"等未经用户确认的事）
        [/(?:你(?:说|提|讲)的)?(?:那个|那件|那场|那次|那回)(?:方案|事|问题|项目|人|地方|电影|剧|书|游戏|歌|饭|约会)/g, '虚构未经验证的指代', '如果用户没提过这个具体事物，就不该假设它存在'],
        [/(?:帮你|替你|给你)(?:分析|解决|处理|安排|准备)的(?:那个|这件|那件)/g, '声称帮用户做了某事', '改为询问"你是说..."而非假设已经了解'],
        [/你(?:遇到|碰到|面临)的(?:那个|那件|这件)/g, '声称知道用户遇到的具体问题', '未经用户告知不应假设用户遇到了什么'],
    ];

    for (const [re, pattern, suggestion] of memoryPatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(responseText)) !== null) {
            flags.push({
                category: 'memory',
                severity: 'medium',
                pattern,
                matched: m[0].trim(),
                suggestion,
            });
        }
    }

    // ── 第 3 类：绝对化概括 ──
    const absolutePatterns: [RegExp, string, string][] = [
        [/你(?:总是|从来|永远|一直|每次|从不|绝对)/g, '绝对化用户行为', '加上"有时候"或"好像"来缓和'],
        [/你(?:最|第一|唯一).{0,8}(?:喜欢|爱|讨厌|怕|擅长)/g, '声称知道用户的"最"', '改为"你好像特别喜欢..."'],
        [/我(?:永远|绝对|一定|肯定).{0,10}(?:会|能|可以)/g, '对自己能力做绝对承诺', '保持谦逊，用"我会尽力..."'],
        [/你.{0,5}(?:就是|一定是|肯定是|绝对是)/g, '绝对化论断用户', '改为"你可能是..."'],
        // AI 对自己的绝对化承诺
        [/我(?:一直|从来|总是|每次).{0,10}(?:在|会|能|可以)(?:认真|用心|好好|仔细)/g, '对自己做绝对化承诺', 'AI 无法保证"一直"做到某事，改为具体描述当前行为'],
    ];

    for (const [re, pattern, suggestion] of absolutePatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(responseText)) !== null) {
            flags.push({
                category: 'absolute',
                severity: 'medium',
                pattern,
                matched: m[0].trim(),
                suggestion,
            });
        }
    }

    // ── 第 4 类：时序虚构（编造具体时间点的事件）──
    const temporalPatterns: [RegExp, string, string][] = [
        [/(?:昨天|前天|上周|上个月|去年).{0,20}(?:我们|你|我)/g, '声称过去某时间点的具体事件', '除非确实有记忆记录，否则避免编造时间'],
        [/(?:明天|下周|下次|到时候).{0,20}(?:我给你|我带你|我们|一起去)/g, '对未来做具体承诺', '改为愿望表达"希望下次能..."'],
        [/(?:上次|上回)我们.{0,20}(?:时候|那天)/g, '声称记得具体见面', '除非有记录，改为"好像有一次我们..."'],
    ];

    for (const [re, pattern, suggestion] of temporalPatterns) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(responseText)) !== null) {
            flags.push({
                category: 'temporal',
                severity: 'high',
                pattern,
                matched: m[0].trim(),
                suggestion,
            });
        }
    }

    // ── 第 5 类：与对话历史的矛盾检测 ──
    if (recentHistory && recentHistory.length > 0) {
        // 检查 AI 是否声称了与之前 AI 消息矛盾的内容
        const aiHistory = recentHistory.filter(h => h.role === 'assistant');
        const userHistory = recentHistory.filter(h => h.role === 'user');

        // 简化版：检查当前回复中是否出现了与用户已说过的内容矛盾的"你"陈述
        for (const userMsg of userHistory.slice(-5)) {
            const userText = userMsg.content;

            // 用户说"不喜欢X" → AI 回复不能包含"你喜欢X"
            const userDislikes = userText.match(/(?:不喜欢|讨厌|怕|烦|受够了|受不了)(.{1,10})/g);
            if (userDislikes) {
                for (const dislike of userDislikes) {
                    const thing = dislike.replace(/(?:不喜欢|讨厌|怕|烦|受够了|受不了)/, '').trim();
                    if (thing.length > 0 && responseText.includes(thing)) {
                        // 检查 AI 是否在说用户"喜欢"这个东西
                        const aiLikesPattern = new RegExp(`你喜欢.*${thing}|你.*爱.*${thing}`);
                        if (aiLikesPattern.test(responseText)) {
                            flags.push({
                                category: 'contradiction',
                                severity: 'high',
                                pattern: '与用户表达的矛盾',
                                matched: `用户说"${dislike}"，但AI回复暗示用户喜欢"${thing}"`,
                                suggestion: `用户明确表示不喜欢"${thing}"，不应说用户喜欢它`,
                            });
                        }
                    }
                }
            }
        }
    }

    // ── 计算综合评分 ──
    const severityWeights = { high: 0.25, medium: 0.1, low: 0.03 };
    let penalty = 0;
    for (const f of flags) {
        penalty += severityWeights[f.severity];
    }
    const score = Math.max(0, 1 - penalty);

    // ── 生成摘要 ──
    const highFlags = flags.filter(f => f.severity === 'high');
    const mediumFlags = flags.filter(f => f.severity === 'medium');
    const summaryParts: string[] = [];

    if (flags.length === 0) {
        summaryParts.push('✓ 未检测到明显的事实性风险');
    } else {
        if (highFlags.length > 0) {
            summaryParts.push(`⚠ 高风险 ${highFlags.length} 条：${highFlags.map(f => f.pattern).join('、')}`);
        }
        if (mediumFlags.length > 0) {
            summaryParts.push(`⚡ 中风险 ${mediumFlags.length} 条：${mediumFlags.map(f => f.pattern).join('、')}`);
        }
        summaryParts.push(`📊 可信度评分：${(score * 100).toFixed(0)}%`);
    }

    return {
        score,
        flags,
        summary: summaryParts.join('\n'),
    };
}
