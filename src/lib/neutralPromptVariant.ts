import { STRATEGY_PROMPT_SNIPPETS } from './dialogueStrategy.js';

export type NeutralPromptEmotion =
  | 'optimism' | 'pride' | 'gratitude' | 'relief' | 'frustration'
  | 'embarrassment' | 'anger' | 'disgust' | 'guilt' | 'grievance'
  | 'affection' | 'loneliness' | 'disappointment';

export const NEUTRAL_PROMPT_EMOTION_SECTIONS: Readonly<Record<NeutralPromptEmotion, string>> = {
  optimism: '乐观 — 做啦啦队，别做哲学家',
  pride: '自豪 — 具体夸，别客套',
  gratitude: '感激 — 接住，别推开',
  relief: '释然 — 安静肯定，别上课',
  frustration: '烦躁 — 帮ta把烦躁倒出来，别急着当客服',
  embarrassment: '尴尬 — 用轻松化解，别假装没看见',
  anger: '愤怒 — 站队，别讲道理',
  disgust: '厌恶 — 匹配厌恶的力度，别用"挺烦的"糊弄',
  guilt: '内疚 — 陪着，别急着原谅',
  grievance: '委屈 — 站队，别找平衡',
  affection: '爱意 — 接住柔软，别点评',
  loneliness: '孤独 — 陪着，别启蒙',
  disappointment: '失望 — 承认落差，别急着翻篇',
};

export interface NeutralPromptVariantInput {
  strategy: string;
  strategySnippet: string;
  emotion: string | null | undefined;
  /** Must be an externally calibrated value; absent means no candidate selection. */
  confidence?: number | null;
  mixed?: boolean;
}

export interface NeutralPromptVariantResult {
  strategySnippet: string;
  applied: boolean;
  reason: 'not_neutral_strategy' | 'mixed_emotion' | 'unknown_emotion' | 'low_or_missing_confidence'
    | 'no_explicit_user_affect' | 'neutral_source_mismatch' | 'neutral_sections_changed' | 'selected';
  selection: string | null;
}

export interface NeutralPromptAnalysisEvidence {
  expressedEmotion: string;
  likelyCause: string;
  evidence?: string;
  directedAtAI?: boolean;
}

export interface NeutralPromptEvidenceInput {
  strategy: string;
  strategySnippet: string;
  userText: string;
  analysis: NeutralPromptAnalysisEvidence;
  localAnalysis: NeutralPromptAnalysisEvidence;
}

const AFFECT_CUES: ReadonlyArray<{ family: string; pattern: RegExp }> = [
  { family: 'joy', pattern: /开心|高兴|快乐|幸福|兴奋|喜悦/u },
  { family: 'sadness', pattern: /难过|伤心|悲伤|失望|委屈|低落|孤独|孤单|心累/u },
  { family: 'anger', pattern: /生气|愤怒|气死|火大|气愤|烦躁|心烦|烦透|很烦|特别烦/u },
  { family: 'fear', pattern: /担心|害怕|焦虑|紧张|恐惧|不安/u },
  { family: 'disgust', pattern: /恶心|反感|厌恶/u },
  { family: 'love', pattern: /爱你|喜欢你|想你|爱上|喜欢我/u },
  { family: 'gratitude', pattern: /谢谢|感谢|感激/u },
  { family: 'embarrassment', pattern: /尴尬|难堪|羞愧/u },
  { family: 'guilt', pattern: /内疚|自责|愧疚/u },
  { family: 'relief', pattern: /释然|想开|不再强求/u },
];

/** Conservative lexical veto, not a classifier or confidence estimate. */
export function hasMultipleAffectFamilies(userText: string): boolean {
  const unquoted = userText.replace(/[“「『‘"][^”」』’"]{1,240}[”」』’"]/gu, ' ');
  const found = new Set<string>();
  for (const { family, pattern } of AFFECT_CUES) {
    const globalPattern = new RegExp(pattern.source, 'gu');
    for (const match of unquoted.matchAll(globalPattern)) {
      const index = match.index ?? 0;
      const clauseStart = Math.max(
        unquoted.lastIndexOf('，', index), unquoted.lastIndexOf(',', index),
        unquoted.lastIndexOf('。', index), unquoted.lastIndexOf('；', index),
        unquoted.lastIndexOf(';', index), unquoted.lastIndexOf('但', index),
        unquoted.lastIndexOf('不过', index),
      ) + 1;
      const prefix = unquoted.slice(clauseStart, index);
      const negated = /(?:并不|并没有|没有|没|不太|不|未|不是|并非|说不上|谈不上|算不上)(?:那么|太|很|特别)?\s*$/u.test(prefix);
      if (!negated) found.add(family);
    }
  }
  return found.size > 1;
}

function hasUnnegatedCue(text: string, cue: RegExp): boolean {
  const unquoted = text.replace(/[“「『‘"][^”」』’"]{1,240}[”」』’"]/gu, ' ');
  const pattern = new RegExp(cue.source, 'gu');
  for (const match of unquoted.matchAll(pattern)) {
    const index = match.index ?? 0;
    const clauseStart = Math.max(
      unquoted.lastIndexOf('，', index), unquoted.lastIndexOf(',', index),
      unquoted.lastIndexOf('。', index), unquoted.lastIndexOf('；', index),
      unquoted.lastIndexOf(';', index), unquoted.lastIndexOf('但', index),
      unquoted.lastIndexOf('不过', index), unquoted.lastIndexOf('可是', index),
      unquoted.lastIndexOf('然而', index),
    ) + 1;
    const prefix = unquoted.slice(clauseStart, index);
    if (!/(?:并不|并没有|没有|没|不太|不|未|不是|并非|说不上|谈不上|算不上)(?:那么|太|很|特别)?\s*$/u.test(prefix)) return true;
  }
  return false;
}

function isExplicitFirstPersonAffect(userText: string, evidence: string, emotion: string): boolean {
  const unquoted = userText.replace(/[“「『‘"][^”」』’"]{1,240}[”」』’"]/gu, ' ');
  if (!evidence || !unquoted.includes(evidence)) return false;
  const clauses = unquoted.split(/[，,。！？!?；;\n]+/u);
  const thirdParty = /(?:我(?:的)?(?:朋友|同事|室友|同学|爸爸?|妈妈|家人|老板)|朋友|同事|室友|同学|他|她)/u;
  if (emotion === 'gratitude' && clauses.some(clause => /^\s*(?:谢谢|感谢|感激)(?:你)?/u.test(clause) && !thirdParty.test(clause))) {
    return true;
  }
  // Local NLU evidence often spans the whole turn (including punctuation).
  // Preserve an explicit first-person affect statement across clause boundaries.
  const evidencePrefix = evidence.trim();
  if (/不确定[^，,。！？!?；;]{0,24}(?:孤单|孤独|失望)/u.test(evidencePrefix)) return false;
  if (evidencePrefix.includes('我') && !thirdParty.test(evidencePrefix)) return true;
  if (!thirdParty.test(evidencePrefix)
      && /^我(?:自己|最近|今天|现在|真的|很|特别|太|有点|有些|挺|真|已经|又|觉得|感到|心里|对[^，,。！？!?；;]{0,12})?/u.test(evidencePrefix)
      && !/^我(?:自己|最近|今天|现在|真的|很|特别|太|有点|有些|挺|真|已经|又|觉得|感到|心里|对[^，,。！？!?；;]{0,12})?(?:不|没|没有|并不|不是|从来不|未曾)/u.test(evidencePrefix)) {
    return true;
  }
  for (const clause of clauses) {
    const index = clause.indexOf(evidence);
    if (index < 0) continue;
    const prefix = clause.slice(0, index).trim();
    const evidenceContext = `${prefix}${evidence}`.trim();
    if (thirdParty.test(evidenceContext)) continue;
    if (/^我(?:自己|最近|今天|现在|真的|很|特别|太|有点|有些|挺|真|已经|又|觉得|感到|心里|对[^，,。！？!?；;]{0,12})?(?:不|没|没有|并不|不是|从来不|未曾)/u.test(evidenceContext)) return false;
    if (/^我(?:自己|最近|今天|现在|真的|很|特别|太|有点|有些|挺|真|已经|又|觉得|感到|心里|对[^，,。！？!?；;]{0,12})?/u.test(evidenceContext)
        && evidenceContext.length > 1) return true;
    // Direct thanks are a first-person speech act even when the pronoun is omitted.
    if (emotion === 'gratitude' && /^(?:\s*|我(?:想)?\s*)(?:谢谢|感谢|感激)(?:你)?/u.test(clause)) return true;
  }
  return false;
}

/**
 * Runtime-safe evidence gate. It uses agreement and explicit text cues as
 * eligibility checks, never converts uncertainty/intensity into confidence.
 */
export function buildNeutralPromptVariantFromEvidence(input: NeutralPromptEvidenceInput): NeutralPromptVariantResult {
  const fallback = (reason: NeutralPromptVariantResult['reason']): NeutralPromptVariantResult => ({
    strategySnippet: input.strategySnippet,
    applied: false,
    reason,
    selection: null,
  });
  if (input.strategy !== 'neutral') return fallback('not_neutral_strategy');
  const localCause = String(input.localAnalysis.likelyCause ?? '');
  const modelCause = String(input.analysis.likelyCause ?? '');
  if (/混合|引用|转述|否定|双重否定/.test(`${localCause} ${modelCause}`)
      || hasMultipleAffectFamilies(input.userText)) return fallback('mixed_emotion');
  if (input.analysis.expressedEmotion !== input.localAnalysis.expressedEmotion) return fallback('unknown_emotion');
  if (typeof input.localAnalysis.evidence !== 'string'
      || !input.localAnalysis.evidence
      || !input.userText.includes(input.localAnalysis.evidence)) return fallback('unknown_emotion');
  if (!isExplicitFirstPersonAffect(
    input.userText,
    input.localAnalysis.evidence,
    input.localAnalysis.expressedEmotion,
  )) return fallback('no_explicit_user_affect');

  let emotion: NeutralPromptEmotion | null = null;
  const text = input.userText;
  const unquotedText = text.replace(/[“「『‘"][^”」』’"]{1,240}[”」』’"]/gu, ' ');
  const explicitLoneliness = hasUnnegatedCue(text, /孤单|孤独/u);
  const explicitDisappointment = hasUnnegatedCue(text, /失望/u);
  const mentionsLoneliness = /孤单|孤独/u.test(unquotedText);
  const mentionsDisappointment = /失望/u.test(unquotedText);
  if (mentionsLoneliness && mentionsDisappointment) return fallback('mixed_emotion');
  switch (input.localAnalysis.expressedEmotion) {
    case 'love':
      if (/爱你|喜欢你|想你|爱上|喜欢我/u.test(text)) emotion = 'affection';
      break;
    case 'gratitude':
      if (/谢谢|感谢|感激/u.test(text)) emotion = 'gratitude';
      break;
    case 'disgust':
      if (/恶心|反感|厌恶/u.test(text)) emotion = 'disgust';
      break;
    case 'anger':
      if (/烦躁|烦透|烦死|很烦|特别烦|心烦/u.test(text)) emotion = 'frustration';
      else if (/生气|愤怒|气死|火大|气愤/u.test(text)) emotion = 'anger';
      break;
    case 'sad':
      if (explicitLoneliness) emotion = 'loneliness';
      else if (explicitDisappointment) emotion = 'disappointment';
      break;
  }
  if (!emotion) return fallback('unknown_emotion');

  // Evidence eligibility is established above; do not invent a confidence score.
  return buildSelectedNeutralPromptVariant(input.strategy, input.strategySnippet, emotion);
}

function buildSelectedNeutralPromptVariant(
  strategy: string,
  strategySnippet: string,
  emotion: NeutralPromptEmotion,
): NeutralPromptVariantResult {
  const unchanged = (reason: NeutralPromptVariantResult['reason']): NeutralPromptVariantResult => ({
    strategySnippet,
    applied: false,
    reason,
    selection: null,
  });
  if (strategy !== 'neutral') return unchanged('not_neutral_strategy');
  const title = NEUTRAL_PROMPT_EMOTION_SECTIONS[emotion];
  const baseline = STRATEGY_PROMPT_SNIPPETS.neutral;
  if (!strategySnippet.startsWith(baseline)) return unchanged('neutral_source_mismatch');

  const firstEmotionHeading = baseline.indexOf('## 特定情绪场景');
  const sharedTail = baseline.indexOf('## 禁止事项');
  const emotionHeadings = [...baseline.matchAll(/^### (.+)$/gm)];
  const sectionHeading = emotionHeadings.find((match) => match[1] === title);
  if (firstEmotionHeading < 0 || sharedTail < 0 || !sectionHeading || sectionHeading.index === undefined) {
    return unchanged('neutral_sections_changed');
  }

  const headings = emotionHeadings.map((match) => match.index!);
  const sectionIndex = emotionHeadings.indexOf(sectionHeading);
  const sectionEnd = sectionIndex + 1 < headings.length ? headings[sectionIndex + 1] : sharedTail;
  const sharedPrefix = baseline.slice(0, firstEmotionHeading).trimEnd();
  const sharedEnding = baseline.slice(sharedTail).trimStart();
  const selectedSection = baseline.slice(sectionHeading.index, sectionEnd).trim();
  const candidateBase = `${sharedPrefix}\n\n${selectedSection}\n\n${sharedEnding}`;
  const dynamicSuffix = strategySnippet.slice(baseline.length);
  return {
    strategySnippet: candidateBase + dynamicSuffix,
    applied: true,
    reason: 'selected',
    selection: title,
  };
}

/**
 * Creates an experimental neutral-strategy variant without mutating the input.
 * Only the exact frozen neutral base is replaced; any dynamic suffix (for
 * example ExpressionPlan/body-state guidance) remains byte-for-byte unchanged.
 * Missing/untrusted selection evidence always keeps the original snippet.
 */
export function buildNeutralPromptVariant(input: NeutralPromptVariantInput): NeutralPromptVariantResult {
  const unchanged = (
    reason: NeutralPromptVariantResult['reason'],
  ): NeutralPromptVariantResult => ({
    strategySnippet: input.strategySnippet,
    applied: false,
    reason,
    selection: null,
  });

  if (input.strategy !== 'neutral') return unchanged('not_neutral_strategy');
  if (input.mixed === true) return unchanged('mixed_emotion');
  const emotion = input.emotion as NeutralPromptEmotion | null | undefined;
  const title = emotion ? NEUTRAL_PROMPT_EMOTION_SECTIONS[emotion] : undefined;
  if (!title) return unchanged('unknown_emotion');
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0.75) {
    return unchanged('low_or_missing_confidence');
  }
  return buildSelectedNeutralPromptVariant(input.strategy, input.strategySnippet, emotion);
}
