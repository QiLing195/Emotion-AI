// ── 情绪标签规范化 (Emotion Canonicalization) ──
// 为什么需要它：
//   LLM 情感识别返回的是**自然语言**标签（实测："疲惫、委屈"、"gratitude and warmth"），
//   而下游全部按固定英文键匹配：
//     · emotionReinforcement.ts → CONTAGION_MAP（情绪传染）
//     · emotionReinforcement.ts → suggestReinforcement（奖惩强化）
//     · personalityEvolution.ts → 'love' / 'anger' 判断
//   于是"LLM 识别成中文"会导致这些通路**静默失效**（不报错，只是永远不触发）。
//
// 本模块把这层风险收敛到一处：任何来源（LLM / 本地词典 / 前端）的标签都先经过
// canonicalEmotion() 归一，再由下游按固定键消费。
//
// 纯逻辑模块：无 io/React 依赖。

export const CANONICAL_EMOTIONS = [
  'joy', 'sad', 'anger', 'fear', 'love', 'gratitude', 'disgust', 'neutral',
] as const;

export type CanonicalEmotion = (typeof CANONICAL_EMOTIONS)[number];

/**
 * v1.36：**正面**情绪键（"他这句话是好事"）。
 *
 * 为什么需要它：`dialogueStrategy` 的 Rule 1 只看**强度**（`userIntensity >= 0.7`）——
 * 于是「我今天升职了！」（joy，0.75）和「我面试又挂了」（sad，0.80）走**同一条分支**。
 * 实测（v1.34 账本 s10）：他说升职，规则给出 **`accompany`（安静陪着）**；
 * 而 `empathize` 的片段里本来就有一整段「**积极情绪的共鸣**」（"我升职了！"正是它举的例子）。
 * 也就是说**对的片段早就在那儿，只是被劫持了**。
 *
 * 刻意只收"他这边是好事"的三个键；`neutral` **不算**正面 ——
 * 中性高唤醒仍走旧行为，不去猜他到底高兴还是难受。
 * 与 `motive.NEGATIVE_USER_EMOTIONS`（sad/anger/fear/disgust）互为补集，
 * `emotionCanonical.test.ts` 里有一条不变量钉住两者不重叠。
 */
export const POSITIVE_USER_EMOTIONS: ReadonlySet<string> = new Set(['joy', 'gratitude', 'love']);

/** 他这句话是不是"好事"（按键判断；未归一/未知键一律 false ⇒ 保持旧行为） */
export function isPositiveUserEmotion(emotion: string | null | undefined): boolean {
  return typeof emotion === 'string' && POSITIVE_USER_EMOTIONS.has(emotion);
}

/**
 * 别名表：键为小写别名（含中文词/短语、英文同义词、常见口语），值为规范键。
 * 匹配规则（见 canonicalEmotion）：先精确匹配，再按**别名长度降序**做包含匹配，
 * 这样「不开心」不会被「开心」抢先命中。
 */
const ALIASES: Record<string, CanonicalEmotion> = {
  // ── 否定形式优先（必须比对应的肯定词长，才能先命中）──
  不开心: 'sad', 不高兴: 'sad', 不愉快: 'sad', 不快乐: 'sad', 不爽: 'anger', 不舒服: 'sad',
  没精神: 'sad', 没劲: 'sad', 不想说话: 'sad',

  // ── joy ──
  joy: 'joy', happy: 'joy', happiness: 'joy', glad: 'joy', excited: 'joy', excitement: 'joy',
  cheerful: 'joy', delight: 'joy', 开心: 'joy', 高兴: 'joy', 快乐: 'joy', 喜悦: 'joy',
  愉快: 'joy', 兴奋: 'joy', 欢喜: 'joy', 雀跃: 'joy', 满足: 'joy', 幸福: 'joy', 惊喜: 'joy',

  // ── sad（含疲惫/委屈：没有独立规范键，归入负向低落）──
  sad: 'sad', sadness: 'sad', unhappy: 'sad', down: 'sad', depressed: 'sad', heartbroken: 'sad',
  lonely: 'sad', hurt: 'sad', disappointed: 'sad', tired: 'sad', exhausted: 'sad', drained: 'sad',
  难过: 'sad', 伤心: 'sad', 悲伤: 'sad', 委屈: 'sad', 失落: 'sad', 沮丧: 'sad', 低落: 'sad',
  心痛: 'sad', 心碎: 'sad', 孤独: 'sad', 寂寞: 'sad', 疲惫: 'sad', 心累: 'sad', 累了: 'sad',
  累: 'sad', 失望: 'sad', 想哭: 'sad', 苦笑: 'sad',

  // ── anger ──
  anger: 'anger', angry: 'anger', mad: 'anger', furious: 'anger', annoyed: 'anger',
  irritated: 'anger', frustrated: 'anger', resentment: 'anger',
  生气: 'anger', 愤怒: 'anger', 恼火: 'anger', 火大: 'anger', 气死: 'anger', 烦躁: 'anger',
  不爽快: 'anger', 烦: 'anger', 讨厌: 'anger',

  // ── fear ──
  fear: 'fear', afraid: 'fear', scared: 'fear', worried: 'fear', anxious: 'fear', anxiety: 'fear',
  nervous: 'fear', insecure: 'fear', uneasy: 'fear',
  害怕: 'fear', 恐惧: 'fear', 担心: 'fear', 焦虑: 'fear', 不安: 'fear', 紧张: 'fear',
  忐忑: 'fear', 心慌: 'fear',

  // ── love ──
  love: 'love', affection: 'love', warmth: 'love', caring: 'love', tenderness: 'love',
  romantic: 'love', attached: 'love',
  爱: 'love', 喜欢: 'love', 想你: 'love', 想念: 'love', 依恋: 'love', 亲密: 'love',
  温柔: 'love', 心动: 'love', 想你啦: 'love',

  // ── gratitude ──
  gratitude: 'gratitude', grateful: 'gratitude', thankful: 'gratitude', appreciation: 'gratitude',
  appreciative: 'gratitude', thank: 'gratitude', thanks: 'gratitude', touched: 'gratitude',
  感激: 'gratitude', 感谢: 'gratitude', 谢谢: 'gratitude', 感动: 'gratitude', 受宠若惊: 'gratitude',
  贴心: 'gratitude', 暖心: 'gratitude', 有心: 'gratitude',

  // ── disgust ──
  disgust: 'disgust', disgusted: 'disgust', gross: 'disgust', hate: 'disgust',
  contempt: 'disgust', repulsed: 'disgust',
  厌恶: 'disgust', 反感: 'disgust', 恶心: 'disgust', 鄙视: 'disgust', 嫌弃: 'disgust',

  // ── neutral ──
  neutral: 'neutral', calm: 'neutral', everyday: 'neutral', small_talk: 'neutral',
  中性: 'neutral', 平静: 'neutral', 日常: 'neutral', 普通: 'neutral', 无聊: 'neutral',
};

/** 别名按长度降序（保证"最长优先"匹配，避免「不开心」被「开心」抢先） */
const ALIAS_ENTRIES: Array<[string, CanonicalEmotion]> = Object.entries(ALIASES)
  .sort((a, b) => b[0].length - a[0].length);

/**
 * 把任意情绪标签归一为规范键。无法识别时返回 fallback（默认 'neutral'）。
 * 匹配顺序：精确（小写） → 包含（最长别名优先）。
 */
export function canonicalEmotion(
  raw: string | null | undefined,
  fallback: CanonicalEmotion = 'neutral',
): CanonicalEmotion {
  if (typeof raw !== 'string') return fallback;
  const text = raw.trim().toLowerCase();
  if (!text) return fallback;
  const exact = ALIASES[text];
  if (exact) return exact;
  for (const [alias, canonical] of ALIAS_ENTRIES) {
    if (text.includes(alias)) return canonical;
  }
  return fallback;
}

/**
 * 保留可读标签：返回规范化键 + 原始自然语言标签（原文与键不同时才有 label）。
 * 供 UI/日志展示"疲惫、委屈"这种人话，同时让下游拿到 'sad'。
 */
export function canonicalizeWithLabel(
  raw: string | null | undefined,
  fallback: CanonicalEmotion = 'neutral',
): { emotion: CanonicalEmotion; label?: string } {
  const emotion = canonicalEmotion(raw, fallback);
  const text = typeof raw === 'string' ? raw.trim() : '';
  const label = text && text.toLowerCase() !== emotion ? text.slice(0, 50) : undefined;
  return { emotion, label };
}
