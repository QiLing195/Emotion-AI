/**
 * 低谷的「原因」派生（v1.60，纯函数）
 *
 * 为什么需要它：
 *   实测（2026-10-19，5×2 复现）她 4/4 都说「我这两天有点沉，心里闷闷的，**说不上来为什么**」——
 *   归因 0/4。查下来是结构性的：MoodState 只有 valence/arousal、LowPeriodState 只记深度与结束方式，
 *   **没有任何"为什么"**；而 state 动机的校验还明文写着"不要解释原因"。
 *   随后"近路"实验（允许她从对话记录自行归因）**两臂 0/5 无效** ⇒ 模型不会在表达时自发重构"因为哪句话"。
 *   ⇒ 原因必须由**状态层在"沉"发生的那一刻**记下来。本模块就是那个纯函数部分。
 *
 * 两条派生路径（都只允许真实来源，不编造）：
 *   ① `deriveSinkCause()`：**沉的那一刻**的现场 —— 上一轮他那句话/他的情绪（引文直接摘自他的话）；
 *      或者反刍 ≥3 轮（内因）。这是首选，因为它天然"不会过期"。
 *   ② `deriveLowPeriodCause()`：**池子派生**（动机池里她挂着的事 / 反刍）—— 作为兜底。
 *
 * 反例教训（必须记着）：
 *   · 池子派生会**卡在旧话题**上：5 段实验里我种了 5 个不同话题，池里的 open_loop 始终是「体检」，
 *     于是她 5 次都说是"体检" ⇒ 从"说得空"变成"说错了"。所以现场记录优先于池子派生。
 *   · 外部生活名词护栏（v1.49c）只约束**她自己**的生活；`his_word` 是**他的原话**，不受该护栏约束。
 */

export type LowPeriodCauseKind = 'his_word' | 'carrying_his_matter' | 'rumination' | 'unknown';

export interface LowPeriodCause {
  kind: LowPeriodCauseKind;
  /** 可以直接放进页面的**一句原因** */
  phrase: string;
  /** 派生依据（审计用） */
  evidence: string;
  /** 具体话题（只有在锚点/引文里取到时才有；用于报告"具体化率"） */
  topic?: string;
}

/** 她心里挂着的事（这三类本身就是"有具体所指"的动机） */
const CARRYING_KINDS = new Set(['open_loop', 'worry', 'memory_echo']);

/** 负向情绪（判定"他那句话把我带下去了"） */
const NEGATIVE_EMOTIONS = new Set(['sad', 'anger', 'fear', 'disgust', 'anxiety', 'loneliness', 'grief', 'frustration']);

/**
 * 对她**自己**生活名词的护栏：原因句里不得出现她并不拥有的生活（与 v1.49c 的 state 校验同一原则）。
 * ⚠️ 只对"她自己的归因"生效；`his_word`（他的原话）不受此限。
 */
const FORBIDDEN_LIFE_NOUNS = /工作|上班|同事|老板|公司|朋友|闺蜜|同学|学校|老师|家里|妈妈|爸爸|父母|天气|下雨|出差|旅行|超市|做饭|加班|项目/;

/** open_loop 内容里的引号锚点就是他原话里的话题：`他刚说要去「体检」…` */
const ANCHOR_RE = /「([^」]{1,12})」/;

/** 引文截取：取第一小句，最多 12 字（保持是他真说过的话） */
export function quoteFromUserText(userText: string, maxLen = 12): string | null {
  const text = String(userText ?? '').trim();
  if (!text) return null;
  const firstClause = text.split(/[，。！？!?；;、\n]/)[0].trim();
  const src = firstClause || text;
  const chars = Array.from(src);
  if (chars.length === 0) return null;
  const quoted = chars.slice(0, maxLen).join('').replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '');
  return quoted.length >= 2 ? quoted : null;
}

/**
 * **现场派生**：在"她沉下去/沉得更深"的那一轮，用**上一轮他那句话/他的情绪**当原因。
 * 这是首选路径：引文天然来自真实对话，不会像池子那样卡在旧话题上。
 */
export function deriveSinkCause(stimulus: { userText?: string; hisEmotion?: string } | null | undefined): LowPeriodCause | null {
  if (!stimulus) return null;
  const emotion = String(stimulus.hisEmotion ?? '').toLowerCase();
  if (NEGATIVE_EMOTIONS.has(emotion)) {
    const quoted = quoteFromUserText(String(stimulus.userText ?? ''));
    if (quoted) {
      return {
        kind: 'his_word',
        phrase: `因为你说「${quoted}」，我听着也跟着沉下去了`,
        evidence: `sink:his_word:${emotion}`,
        topic: quoted,
      };
    }
  }
  return null;
}

export interface DeriveLowPeriodCauseInput {
  /** 反刍链（`EmotionState.internal.rumination`） */
  rumination?: { emotion?: string; streak?: number } | null;
  /** 动机池（`EmotionState.internal.motive.pool`）—— 只读 kind/salience/content */
  motivePool?: Array<{ kind?: string; salience?: number; content?: string }> | null;
  /** 本次低谷已落定的轮数（低谷读数里的 turns；只作为审计证据，不参与判定） */
  lowTurns?: number;
}

function pickCarryingMotive(
  pool?: Array<{ kind?: string; salience?: number; content?: string }> | null,
): { kind: string; salience: number; content: string } | null {
  if (!pool || pool.length === 0) return null;
  let best: { kind: string; salience: number; content: string } | null = null;
  for (const m of pool) {
    const kind = String(m?.kind ?? '');
    if (!CARRYING_KINDS.has(kind)) continue;
    const salience = Number(m?.salience ?? 0);
    if (!Number.isFinite(salience)) continue;
    if (!best || salience > best.salience) {
      best = { kind, salience, content: String(m?.content ?? '') };
    }
  }
  return best;
}

/** 从动机内容里取引号锚点（= 他原话里的话题）；取不到返回 null */
export function extractAnchoredTopic(content: string): string | null {
  const m = ANCHOR_RE.exec(String(content ?? ''));
  if (!m) return null;
  const topic = m[1].trim();
  if (!topic) return null;
  if (FORBIDDEN_LIFE_NOUNS.test(topic)) return null;
  return topic;
}

/** **池子派生**（兜底）：动机池里她挂着的事 / 反刍 ≥3 轮；都没有 ⇒ unknown */
export function deriveLowPeriodCause(input: DeriveLowPeriodCauseInput = {}): LowPeriodCause {
  const carrying = pickCarryingMotive(input.motivePool);
  if (carrying) {
    const topic = extractAnchoredTopic(carrying.content);
    if (topic) {
      return {
        kind: 'carrying_his_matter',
        phrase: `心里一直挂着你说的「${topic}」那件事`,
        evidence: `motive_pool:${carrying.kind}:anchor`,
        topic,
      };
    }
    return {
      kind: 'carrying_his_matter',
      phrase: '心里一直挂着一件还没落定的事',
      evidence: `motive_pool:${carrying.kind}`,
    };
  }

  const streak = Number(input.rumination?.streak ?? 0);
  const emotion = String(input.rumination?.emotion ?? '');
  if (Number.isFinite(streak) && streak >= 3) {
    return {
      kind: 'rumination',
      phrase: '这几天情绪一直缓不过来，像卡在同一个地方',
      evidence: `rumination:${emotion || 'unknown'}/${streak}`,
    };
  }

  return {
    kind: 'unknown',
    phrase: '说不上来为什么',
    evidence: `low_turns:${Number(input.lowTurns ?? 0)}`,
  };
}

/**
 * 自检：原因句是否"有据"。
 * · `his_word`：引文必须真的出现在他的原话里（不允许改写、不允许编）
 * · 其余：不得出现她并不拥有的外部生活名词
 */
export function causePhraseIsGrounded(phrase: string, kind: LowPeriodCauseKind = 'carrying_his_matter', sourceText?: string): boolean {
  if (typeof phrase !== 'string' || phrase.length === 0) return false;
  if (kind === 'his_word') {
    const quoted = ANCHOR_RE.exec(phrase)?.[1] ?? null;
    if (!quoted) return false;
    if (typeof sourceText !== 'string') return true;   // 无源文本时按记录时的校验算
    return sourceText.includes(quoted);
  }
  return !FORBIDDEN_LIFE_NOUNS.test(phrase);
}
