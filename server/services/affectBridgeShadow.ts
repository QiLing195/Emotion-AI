/**
 * Read-only affect attribution diagnostics. This module never mutates emotion state,
 * chooses a reply, or grants permission to probe the user.
 */
import type { UserEmotionAnalysis } from '../../src/lib/emotionTypes.js';

export type AffectSubject = 'user' | 'third_party' | 'multiple' | 'unknown';
export type AffectReportKind = 'explicit_self_report' | 'quoted_or_third_party' | 'inferred' | 'mixed' | 'unknown';
export type AffectTemporalScope = 'moment' | 'interval' | 'historical' | 'hypothetical' | 'unknown';
export type AffectEngagementBoundary = 'open' | 'declined_to_expand' | 'unknown';
export type ConcernOwner = 'user' | 'character' | 'third_party' | 'unknown';
export type ConcernOwnerRelation = 'same_owner_topic_overlap' | 'different_owner_topic_overlap';
export interface RoleConcernReference {
  owner: ConcernOwner;
  topic: string;
  eventReference: string;
}

export interface AffectReportShadow {
  /** Person experiencing the affect; distinct from who reports it. */
  subject: 'user' | 'third_party' | 'unknown';
  /** Immediate source of the affect claim stated in this message. */
  reportedBy: 'user' | 'third_party' | 'unknown';
  /** Legacy pattern label retained for existing diagnostics; do not use for the new mapping contract. */
  emotion: string;
  /** Exact cue phrase captured from the user's text. */
  emotionText: string;
  /** Explicit, conservative mapping. Unsupported labels stay unknown; never fall back to neutral. */
  emotionMapping: {
    version: 'shadow-emotion-map-v0.1';
    canonical: 'joy' | 'sad' | 'anger' | 'fear' | 'love' | 'gratitude' | 'disgust' | 'unknown';
  };
  evidence: string[];
  causeEvidence: string[];
  temporalScope: AffectTemporalScope;
  uncertainty: number;
  /** Optional, only when an upstream resolver links the text to a known event. */
  eventReference?: string;
}

export interface AffectBridgeShadow {
  schemaVersion: 'affect-bridge-v0.4';
  source: 'local_pattern_shadow';
  subject: AffectSubject;
  affectReportKind: AffectReportKind;
  reports: AffectReportShadow[];
  engagementBoundary: AffectEngagementBoundary;
}

const EMOTION_CUES: ReadonlyArray<{ emotion: string; pattern: RegExp }> = [
  { emotion: 'sad', pattern: /难过|伤心|不开心|低落|忧郁|悲伤|委屈|心累|难受/gu },
  { emotion: 'joy', pattern: /很开心|开心|高兴|快乐|幸福|兴奋/gu },
  { emotion: 'anger', pattern: /生气|愤怒|恼火|烦死|讨厌/gu },
  { emotion: 'fear', pattern: /焦虑|害怕|担心|紧张|不安/gu },
  { emotion: 'love', pattern: /爱你|喜欢你|想你/gu },
  { emotion: 'gratitude', pattern: /感谢|谢谢|感激/gu },
  { emotion: 'disgust', pattern: /恶心|反感|厌恶/gu },
  // Legacy calm label is retained for existing diagnostics; the shadow canonical
  // map below deliberately leaves this label unknown until the ontology is approved.
  { emotion: 'calm', pattern: /倒还好|还好|平静|冷静|不慌|松了口气|放心|释然|安心|轻松/gu },
  // Recognized affect phrases without an approved legacy category or canonical map.
  { emotion: 'unknown', pattern: /不满意|满意|失望/gu },
];
const QUOTE_PATTERN = /[“「『‘"]([^”」』’"]{1,160})[”」』’"]/gu;
const DOUBLE_NEGATION_PATTERN = /不是不(?:太|很)?(?:难过|开心|高兴|在意|喜欢)/u;
const DECLINED_PATTERN = /不想(?:现在|继续|再|展开)?(?:谈|聊|说)|暂时不(?:谈|聊|说)|先不(?:谈|聊|说)/u;
const HYPOTHETICAL_PATTERN = /如果|假如|万一|要是|可能会|也许会|将会/u;
const RELIEF_PATTERN = /松了口气|放心|释然|安心|轻松/u;
const UNAPPROVED_SHADOW_CUES = /焦虑|担心|紧张|不安/u;
const SENTENCE_END = /[。！？!?；;\n]/u;

interface Mention { emotion: string; emotionText: string; start: number; end: number; text: string; }
interface QuoteSpan { start: number; end: number; contentStart: number; contentEnd: number; text: string; }

function emotionMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  for (const cue of EMOTION_CUES) {
    cue.pattern.lastIndex = 0;
    for (const match of text.matchAll(cue.pattern)) {
      const start = match.index ?? -1;
      if (start >= 0) mentions.push({ emotion: cue.emotion, emotionText: match[0], start, end: start + match[0].length, text: match[0] });
    }
  }
  // If “不是不难过” appears, preserve the negated construction as the evidence
  // span and mark the report inferred below rather than treating it as direct joy/sadness.
  const doubleNegation = DOUBLE_NEGATION_PATTERN.exec(text);
  if (doubleNegation) {
    const start = doubleNegation.index;
    const end = start + doubleNegation[0].length;
    const existing = mentions.find(item => item.emotion === 'sad' && item.start >= start && item.end <= end);
    if (existing) {
      const pronoun = /我(?:自己)?$/u.exec(text.slice(Math.max(0, start - 4), start));
      existing.start = start - (pronoun?.[0].length ?? 0);
      existing.end = end;
      existing.text = text.slice(existing.start, end);
    }
  }
  for (const mention of mentions) {
    const prefix = text.slice(Math.max(0, mention.start - 16), mention.start);
    const context = /(?:我自己|我|她|他|自己)?(?:最近|这周|这段时间|今天|现在)?(?:真的|特别|非常|挺|很|有点)?(?:并不|并没有|没有|没|不太|不)?(?:太|很)?$/u.exec(prefix)?.[0] ?? '';
    if (context) {
      mention.start -= context.length;
      mention.text = text.slice(mention.start, mention.end);
    }
  }
  return mentions
    .filter(mention => !isNegatedReport(mention))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

function isNegatedReport(mention: Mention): boolean {
  // “不开心” is a lexicalized sadness report. Other direct negations such as
  // “不难过” and “不担心” must not be treated as positive reports of that affect.
  if (DOUBLE_NEGATION_PATTERN.test(mention.text)) return false;
  if (mention.emotion === 'joy' && /(?:并不|并没有|没有|没|不太|不)(?:太|很)?开心/u.test(mention.text)) return true;
  if (mention.emotion === 'sad' && /(?:我|自己)?(?:并不|并没有|没有|不|没)(?:觉得)?(?:太|很)?(?:难过|伤心|低落|悲伤|委屈|心累|难受)/u.test(mention.text)) return true;
  if (mention.emotion === 'fear' && /(?:我|自己)?(?:并不|并没有|没有|不|没)(?:觉得)?(?:太|很)?(?:焦虑|害怕|担心|紧张|不安)/u.test(mention.text)) return true;
  return false;
}

function quoteSpans(text: string): QuoteSpan[] {
  const quotes: QuoteSpan[] = [];
  for (const match of text.matchAll(QUOTE_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const contentStart = start + 1;
    quotes.push({ start, end: start + match[0].length, contentStart, contentEnd: contentStart + match[1].length, text: match[1] });
  }
  return quotes;
}

function containingQuote(mention: Mention, quotes: QuoteSpan[]): QuoteSpan | undefined {
  return quotes.find(quote => mention.start >= quote.contentStart && mention.end <= quote.contentEnd);
}

function isAttributedThirdParty(text: string, quote: QuoteSpan): boolean {
  const lead = text.slice(Math.max(0, quote.start - 24), quote.start);
  return /(?:朋友|同事|室友|同学|邻居|网友|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人|班长|老师|老板|经理|医生|导师|她|他).{0,8}(?:说|表示|觉得|写|提到|讲|提醒)/u.test(lead);
}

function isAttributedUserAfterQuote(text: string, quote: QuoteSpan): boolean {
  const tail = text.slice(quote.end, quote.end + 48).split(/[。！？!?；;\n]/u, 1)[0] ?? '';
  return /(?:这|那)(?:句|句话|话)(?:内容)?(?:就是|是)?我[^。！？!?；;\n]{0,12}(?:说|写|提到)(?:了|的)?/u.test(tail);
}

function quoteReporter(text: string, quote: QuoteSpan): AffectReportShadow['reportedBy'] {
  if (isAttributedThirdParty(text, quote)) return 'third_party';
  const lead = text.slice(Math.max(0, quote.start - 24), quote.start);
  if (/我[^。！？!?；;\n]{0,16}(?:说|表示|写|提到)(?:了)?/u.test(lead)) return 'user';
  if (isAttributedUserAfterQuote(text, quote)) return 'user';
  return 'unknown';
}

function reportSubject(text: string, mention: Mention, quotes: QuoteSpan[]): AffectReportShadow['subject'] {
  const quote = containingQuote(mention, quotes);
  if (quote) {
    const reporter = quoteReporter(text, quote);
    const quoteLead = quote.text.slice(0, Math.max(0, mention.start - quote.contentStart));
    if (reporter === 'third_party' && (/你(?:自己|最近|今天|现在)?[^。！？!?；;，,]{0,12}$/u.test(quoteLead) || /^你(?:自己)?/u.test(mention.text))) return 'user';
    if (/我(?:自己|最近|今天|现在)?[^。！？!?；;，,]{0,12}$/u.test(quoteLead) || /^我(?:自己)?/u.test(mention.text)) {
      return reporter === 'unknown' ? 'unknown' : reporter;
    }
    if (/(?:她|他|对方|朋友|同事|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人)(?:自己|最近|今天|现在)?[^。！？!?；;，,]{0,12}$/u.test(quoteLead)
      || /^(?:她|他|对方|朋友|同事|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人)/u.test(mention.text)) {
      return reporter === 'unknown' ? 'unknown' : 'third_party';
    }
    return 'unknown';
  }
  if (/^我(?:自己)?/u.test(mention.text)) return 'user';
  if (/^(?:她|他|对方|朋友|同事|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人)/u.test(mention.text)) return 'third_party';
  const clauseStart = Math.max(
    text.lastIndexOf('。', mention.start - 1), text.lastIndexOf('！', mention.start - 1),
    text.lastIndexOf('？', mention.start - 1), text.lastIndexOf(';', mention.start - 1),
    text.lastIndexOf('\n', mention.start - 1),
    ...quotes.filter(item => item.end <= mention.start).map(item => item.end),
  ) + 1;
  const prefix = text.slice(clauseStart, mention.start);
  const possessiveThirdParty = /^我(?:的)?(?:朋友|同事|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人)/u.test(prefix);
  const thirdPartyReportingUser = possessiveThirdParty
    && /(?:说|表示|告诉|提醒|转告|转述|提到|讲)我(?:自己)?[^。！？!?；;\n]{0,24}$/u.test(prefix);
  if (thirdPartyReportingUser) return 'user';
  if (possessiveThirdParty && !/(?:说|表示|告诉|提到)我(?:自己)?$/u.test(prefix)) return 'third_party';
  const lastUserCue = Math.max(prefix.lastIndexOf('我'), prefix.lastIndexOf('你'));
  const lastThirdPartyCue = Math.max(prefix.lastIndexOf('她'), prefix.lastIndexOf('他'));
  if (lastUserCue >= 0 || lastThirdPartyCue >= 0) {
    if (lastThirdPartyCue > lastUserCue) return 'third_party';
    if (lastUserCue > lastThirdPartyCue) return 'user';
  }
  if (/^(?:她|他|对方|朋友|同事|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人)(?:最近|今天|这周|这段时间|现在)?/u.test(prefix)) return 'third_party';
  if (!possessiveThirdParty && /我(?:自己|也|现在|今天|最近|这周|这段时间)?[^。！？!?；;\n]{0,12}$/u.test(prefix)) return 'user';
  return 'unknown';
}

function reportSource(text: string, mention: Mention, quotes: QuoteSpan[]): AffectReportShadow['reportedBy'] {
  const quote = containingQuote(mention, quotes);
  if (quote) return quoteReporter(text, quote);
  const clauseStart = Math.max(
    text.lastIndexOf('。', mention.start - 1), text.lastIndexOf('！', mention.start - 1),
    text.lastIndexOf('？', mention.start - 1), text.lastIndexOf(';', mention.start - 1),
    text.lastIndexOf('\n', mention.start - 1),
    ...quotes.filter(item => item.end <= mention.start).map(item => item.end),
  ) + 1;
  const prefix = text.slice(clauseStart, mention.start);
  if (/^(?:有人|别人|某人|听说|据说).{0,24}(?:说|表示|告诉|转告|转述|提到|讲|提醒)(?:我|你|她|他)?[^。！？!?；;\n]{0,24}$/u.test(prefix)) return 'unknown';
  if (/^(?:我(?:的)?(?:朋友|同事|室友|同学|邻居|网友|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人|哥哥)|她|他|对方|朋友|同事|室友|同学|邻居|网友|妹妹|姐姐|哥哥|弟弟|妈妈|爸爸|家人|班长|老师|老板|经理|医生|导师).{0,24}(?:说|表示|告诉|提醒|转告|转述|提到|讲)(?:我|你|她|他)?[^。！？!?；;\n]{0,24}$/u.test(prefix)) {
    return 'third_party';
  }
  return 'user';
}

function causeSpan(text: string, mention: Mention, quote?: QuoteSpan): string[] {
  if (quote) {
    const reportedText = quote.text;
    const causalMarker = /因为|由于/u.exec(reportedText);
    if (causalMarker) {
      const emotionStart = Math.max(0, mention.start - quote.contentStart);
      return [reportedText.slice(causalMarker.index, emotionStart).trim()].filter(Boolean);
    }
    // A temporal frame such as “结果没出来前” does not itself assert causation.
    if (/(?:让|使)(?:我|她|他)/u.test(reportedText)) return [reportedText];
    return [];
  }
  const sentenceStart = Math.max(
    text.lastIndexOf('。', mention.start - 1), text.lastIndexOf('！', mention.start - 1),
    text.lastIndexOf('？', mention.start - 1), text.lastIndexOf('!', mention.start - 1),
    text.lastIndexOf('?', mention.start - 1), text.lastIndexOf(';', mention.start - 1),
    text.lastIndexOf('\n', mention.start - 1),
  ) + 1;
  let sentenceEnd = text.length;
  for (const match of text.slice(mention.end).matchAll(/[。！？!?；;\n]/gu)) {
    sentenceEnd = mention.end + (match.index ?? 0);
    break;
  }
  const sentence = text.slice(sentenceStart, sentenceEnd).trim();
  const mentionLocal = mention.start - sentenceStart;
  const seeCause = /(?:看到|得知|发现|因为|由于)/u.exec(sentence);
  if (seeCause && seeCause.index < mentionLocal) {
    const markerEnd = seeCause.index + seeCause[0].length;
    return [sentence.slice(markerEnd, mentionLocal + mention.text.length).trim()].filter(Boolean);
  }
  const explicitLink = /(?:这件事|这|它)(?:让我|使我)|所以我|因此我|结果(?:让我|使我)/u.exec(sentence);
  if (explicitLink && explicitLink.index < mentionLocal) return [sentence.slice(0, mentionLocal + mention.text.length).trim()];
  return [];
}

function temporalScope(text: string): AffectTemporalScope {
  if (/上次|上回|那次|昨天|前天|去年|上个月|当时|以前|之前|曾经|那时候|过去/u.test(text)) return 'historical';
  if (/明天|后天|下周|下个月|明年|将来/u.test(text) || HYPOTHETICAL_PATTERN.test(text)) return 'hypothetical';
  if (/这周|最近|一直|半个月|这段时间|这几天|每天|.{0,8}(?:前|期间|之后)/u.test(text)) return 'interval';
  return 'moment';
}

function reportUncertainty(mention: Mention, subject: AffectReportShadow['subject'], analysis: UserEmotionAnalysis, quoted: boolean, hypothetical: boolean): number {
  const inferred = DOUBLE_NEGATION_PATTERN.test(mention.text);
  if (hypothetical) return 0.7;
  const base = typeof analysis.uncertainty === 'number' ? analysis.uncertainty : 0.4;
  // A known phrase with an unmapped ontology label is not an attribution ambiguity.
  // Keep source confidence separate; the gate will reject the unsupported mapping.
  if (mention.emotion === 'unknown') return Math.min(0.3, base);
  // A detected construction is not an ambiguous report merely because it is negated.
  // Keep the uncertainty for the inferred polarity, while the explicit report itself
  // remains eligible for a later human-calibrated gate.
  if (inferred) return 0.5;
  if (subject === 'unknown') return 0.7;
  if (subject === 'third_party') return quoted ? Math.max(0.2, Math.min(0.3, base)) : 0.4;
  if (subject === 'user' && mention.emotion === 'calm' && RELIEF_PATTERN.test(mention.text)) return 0.15;
  if (analysis.expressedEmotion === mention.emotion) return Math.min(0.3, analysis.uncertainty ?? 0.1);
  return quoted ? 0.6 : 0.4;
}

export function analyzeAffectBridgeShadow(userText: string, analysis: UserEmotionAnalysis): AffectBridgeShadow {
  const text = userText.slice(0, 2_000);
  const quotes = quoteSpans(text);
  const mentions = emotionMentions(text);
  const reports = mentions.map(mention => {
    const quote = containingQuote(mention, quotes);
    const subject = reportSubject(text, mention, quotes);
    const reportedBy = reportSource(text, mention, quotes);
    const reportContext = quote?.text ?? text.slice(
      Math.max(0, text.lastIndexOf('。', mention.start - 1) + 1, text.lastIndexOf('；', mention.start - 1) + 1,
        text.lastIndexOf('，', mention.start - 1) + 1, text.lastIndexOf(',', mention.start - 1) + 1),
      (() => {
        const tail = text.slice(mention.end).search(SENTENCE_END);
        return tail < 0 ? text.length : mention.end + tail;
      })(),
    );
    return {
      subject,
      reportedBy,
      emotion: mention.emotion,
      emotionText: mention.emotionText,
      emotionMapping: {
        version: 'shadow-emotion-map-v0.1' as const,
        canonical: (!UNAPPROVED_SHADOW_CUES.test(mention.emotionText)
          && ['joy', 'sad', 'anger', 'fear', 'love', 'gratitude', 'disgust'].includes(mention.emotion)
          ? mention.emotion
          : 'unknown') as AffectReportShadow['emotionMapping']['canonical'],
      },
      evidence: [mention.text],
      causeEvidence: causeSpan(text, mention, quote),
      temporalScope: temporalScope(reportContext),
      uncertainty: Math.min(1, reportUncertainty(mention, subject, analysis, Boolean(quote), HYPOTHETICAL_PATTERN.test(reportContext))),
    };
  });
  const subjects = new Set(reports.map(report => report.subject).filter(subject => subject !== 'unknown'));
  const subject: AffectSubject = subjects.size > 1
    ? 'multiple'
    : subjects.size === 1 ? [...subjects][0] as 'user' | 'third_party' : 'unknown';
  const hasQuoted = reports.some((_, index) => Boolean(containingQuote(mentions[index], quotes)));
  const attributionPairs = new Set(reports.map(report => `${report.subject}:${report.reportedBy}`));
  const inferred = reports.some(report => DOUBLE_NEGATION_PATTERN.test(report.evidence[0] ?? '')
    || (report.uncertainty >= 0.7 && HYPOTHETICAL_PATTERN.test(text)));
  const affectReportKind: AffectReportKind = subject === 'multiple' || attributionPairs.size > 1 || (new Set(reports.map(report => report.emotion)).size > 1)
    ? 'mixed'
    : inferred ? 'inferred'
      : subject === 'third_party' || reports.some(report => report.reportedBy !== 'user') || hasQuoted ? 'quoted_or_third_party'
        : subject === 'user' && reports.every(report => report.reportedBy === 'user') ? 'explicit_self_report' : 'unknown';
  const engagementBoundary: AffectEngagementBoundary = DECLINED_PATTERN.test(text) ? 'declined_to_expand' : 'unknown';
  return { schemaVersion: 'affect-bridge-v0.4', source: 'local_pattern_shadow', subject, affectReportKind, reports, engagementBoundary };
}

export interface AffectBridgeGateResult {
  disposition: 'care_response_candidate' | 'ambiguous_affect_context' | 'no_reading';
  reason: string;
  delta: 0;
  anchor?: string;
  concernOwnerRelation?: ConcernOwnerRelation;
  eventIdentity: 'same_event' | 'different_event' | 'unlinked';
}

const STOP_ANCHORS = new Set(['结果', '事情', '我们', '他们', '这个', '那个', '因为', '所以', '现在', '最近']);
function longestCommonSubstring(a: string, b: string): string {
  const aa = [...a], bb = [...b];
  let best = '', prev = new Array(bb.length + 1).fill(0);
  for (let i = 1; i <= aa.length; i += 1) {
    const curr = new Array(bb.length + 1).fill(0);
    for (let j = 1; j <= bb.length; j += 1) {
      if (aa[i - 1] === bb[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > [...best].length) best = aa.slice(i - curr[j], i).join('');
      }
    }
    prev = curr;
  }
  return best;
}

export function evaluateAffectBridgeShadow(
  shadow: AffectBridgeShadow,
  roleContext: { confirmed: boolean; valuesPresent: boolean; concern: string; reference?: RoleConcernReference } | null,
): AffectBridgeGateResult {
  const abstain = (disposition: AffectBridgeGateResult['disposition'], reason: string): AffectBridgeGateResult => ({ disposition, reason, delta: 0, eventIdentity: 'unlinked' });
  if (shadow.engagementBoundary === 'declined_to_expand') return abstain('ambiguous_affect_context', 'user_declined_affect_discussion');
  if (!shadow.reports.length) return abstain('no_reading', 'no_current_user_affect_report');
  if (shadow.subject === 'multiple' || shadow.affectReportKind === 'mixed') return abstain('ambiguous_affect_context', 'multiple_or_mixed_affect_sources');
  if (shadow.subject !== 'user') return abstain('ambiguous_affect_context', 'not_explicit_user_self_report');
  const report = shadow.reports.find(item => item.subject === 'user');
  if (!report) return abstain('ambiguous_affect_context', 'not_explicit_user_self_report');
  if (report.reportedBy !== 'user') return abstain('ambiguous_affect_context', 'not_user_authored_affect_report');
  if (shadow.affectReportKind !== 'explicit_self_report') return abstain('ambiguous_affect_context', 'not_explicit_user_self_report');
  if (report?.temporalScope === 'historical' || report?.temporalScope === 'hypothetical') {
    return abstain('no_reading', 'affect_not_current');
  }
  if (report?.temporalScope === 'unknown') return abstain('ambiguous_affect_context', 'affect_temporal_scope_unconfirmed');
  if (!report || report.uncertainty > 0.3) return abstain('ambiguous_affect_context', 'uncertainty_not_low');
  if (!report.evidence.length) return abstain('ambiguous_affect_context', 'evidence_not_bound_to_current_message');
  if (!roleContext?.confirmed || !roleContext.valuesPresent) return abstain('no_reading', 'role_constitution_unconfirmed');
  if (!roleContext.reference || roleContext.reference.owner === 'unknown' || !roleContext.reference.topic.trim()) return abstain('no_reading', 'role_concern_owner_unconfirmed');
  if (!roleContext.reference.eventReference.trim()) return abstain('no_reading', 'role_concern_event_reference_unconfirmed');
  if (!roleContext.concern.trim()) return abstain('no_reading', 'no_current_concern');
  if (report.emotionMapping.canonical === 'unknown') return abstain('no_reading', 'emotion_not_in_shadow_map');
  if (!report.causeEvidence.length) return abstain('no_reading', 'cause_evidence_missing_or_unbound');
  const anchor = longestCommonSubstring(roleContext.concern.trim(), report.causeEvidence.join(' '));
  if ([...anchor].length < 3 || STOP_ANCHORS.has(anchor)) return abstain('no_reading', 'no_evidence_match_to_current_concern');
  const concernOwnerRelation: ConcernOwnerRelation = roleContext.reference.owner === report.subject
    ? 'same_owner_topic_overlap'
    : 'different_owner_topic_overlap';
  const eventIdentity = report.eventReference === roleContext.reference.eventReference
    ? 'same_event'
    : report.eventReference ? 'different_event' : 'unlinked';
  return {
    disposition: 'care_response_candidate',
    reason: 'explicit_user_affect_and_role_concern_topic_overlap',
    delta: 0,
    anchor,
    concernOwnerRelation,
    eventIdentity,
  };
}
