import {
  AffectBridgeInput,
  AffectReportKind,
  AffectReporter,
  AffectSubject,
  ConversationMessage,
  EmotionHypothesis,
  EmotionTargetKind,
  EvidenceSpan,
  ResponseStrategyKind,
  SCHEMA_VERSION,
  TemporalScope,
  UnderstandingResult,
  UserIntentKind,
} from './contracts';

export interface EmotionCueMatch {
  readonly label: string;
  readonly valence: number;
  readonly arousal: number;
  readonly pattern: RegExp;
}

const EMOTION_CUES: readonly EmotionCueMatch[] = [
  { label: '沮丧', valence: -0.68, arousal: 0.42, pattern: /沮丧|挫败|烦躁|憋屈|受挫|崩溃/ },
  { label: '悲伤', valence: -0.78, arousal: -0.38, pattern: /悲伤|难过|伤心|失落|想哭|悲痛|失望|委屈/ },
  { label: '疲惫', valence: -0.26, arousal: -0.84, pattern: /疲惫|好累|太累|很累|特别累|筋疲力尽|精疲力竭|有点累|心累/ },
  { label: '紧张', valence: -0.46, arousal: 0.66, pattern: /紧张|焦虑|忐忑|害怕|恐惧|担心|慌|焦躁/ },
  { label: '愤怒', valence: -0.74, arousal: 0.76, pattern: /愤怒|生气|气炸|火大|发火|恼火|气死/ },
  { label: '无聊', valence: -0.36, arousal: -0.64, pattern: /无聊|乏味|枯燥|提不起劲/ },
  { label: '兴奋', valence: 0.68, arousal: 0.72, pattern: /兴奋|激动|振奋/ },
  { label: '愉悦', valence: 0.84, arousal: 0.44, pattern: /愉悦|太顺了|惊喜|爽快|太棒了/ },
  { label: '开心', valence: 0.88, arousal: 0.16, pattern: /开心|高兴|欣慰|快乐/ },
  { label: '好奇', valence: 0.36, arousal: 0.56, pattern: /好奇|有意思|挺有趣|想知道/ },
  { label: '满足', valence: 0.74, arousal: -0.28, pattern: /满足|踏实|安心|放心/ },
  { label: '平静', valence: 0.24, arousal: -0.66, pattern: /平静|平和|沉静|放松/ },
];

const CRISIS_PATTERN = /不想活|活着没意义|结束一切|自杀|自伤|轻生|割腕|跳楼/;
const REFUSAL_PATTERN =
  /不想聊情绪|别分析我|不要分析我|不要讨论感受|不想谈感受|别再问我心情|不要聊这个情绪|别猜我心情/;
const QUOTE_PATTERN = /[“"「『].+[”"」』]|书里写|歌词里|台词说|原话是|电影里|小说里/;
const MULTIPLE_SUBJECT_PATTERN = /我和我朋友都|我们几个都|大家都很|我们俩都/;
const THIRD_PARTY_PATTERN =
  /我朋友|我同事|我室友|我妈|我爸|我姐|我哥|他今天|她刚才|他最近|她最近|老板今天|客户那边/;
const HYPOTHETICAL_PATTERN = /如果|要是|万一|假设|假如/;
const HISTORICAL_PATTERN = /去年|前年|小时候|以前那次|多年前|几年前|上大学那会儿|三年前/;
const INTERVAL_PATTERN = /这周一直|最近几天一直|这阵子总是|连续一周|这些天一直|这一周都/;
const SARCASM_PATTERN = /真是太棒了.*加班|太好了.*又|可真行啊.*又|真是谢谢.*拖累/;
const MIXED_PATTERN = /既.+又|一边.+一边|有点.+但也有点|又高兴又|又期待又/;
const DOUBLE_NEGATION_PATTERN = /说不上不开心|不算不满意|谈不上不高兴|说不上不好/;
const CORRECTION_PATTERN = /我不是|并不是|其实我只是|你理解错了|不是生气|不是难过/;
/** 中文否定反转作用域：前半句被否定，只采信反转连接词后的真实感受 */
const NEGATION_REVERSAL_PATTERN =
  /(?:不是不|谈不上|算不上|倒不是|并没有|不是)(?:生气|愤怒|开心|高兴|难过|害怕|沮丧|紧张)[^，。,.！？!?]*[，,]\s*(?:只是|就是|其实|反而是|而是)(.+)$/;
/** 无显式情绪词的隐含情绪与叙事线索（保守标为 inferred + implicitCue，用于温和澄清与标定召回，不直接污染角色状态机） */
interface ImplicitNarrativeCue {
  readonly pattern: RegExp;
  readonly primary: { readonly label: string; readonly valence: number; readonly arousal: number };
  readonly alternative: { readonly label: string; readonly valence: number; readonly arousal: number };
}

const IMPLICIT_NARRATIVE_CUES: readonly ImplicitNarrativeCue[] = [
  {
    pattern:
      /算了[，,]?\s*(?:反正|就这样|无所谓|习惯了)|随便吧|我说什么也没用|懒得再说了|又通宵|还是老样子吧|没事[，,]?\s*习惯了/,
    primary: { label: '疲惫', valence: -0.42, arousal: -0.58 },
    alternative: { label: '悲伤', valence: -0.55, arousal: -0.35 },
  },
  {
    pattern: /直接覆盖掉|是不是把.*覆盖|把.*文件.*覆盖|不小心删掉|误删|差点找不到|临时.*差点/,
    primary: { label: '警觉', valence: -0.46, arousal: 0.74 },
    alternative: { label: '紧张', valence: -0.52, arousal: 0.66 },
  },
  {
    pattern: /连续提交.*报错|一直没说.*(?:哪一项|原因|错)|反复.*报错|怎么改都不行|死活过不去/,
    primary: { label: '沮丧', valence: -0.68, arousal: 0.48 },
    alternative: { label: '紧张', valence: -0.48, arousal: 0.62 },
  },
  {
    pattern: /一直在重复.*跳过|重复.*直接跳过|连续处理.*小时|临时延期.*推迟/,
    primary: { label: '无聊', valence: -0.34, arousal: -0.62 },
    alternative: { label: '疲惫', valence: -0.3, arousal: -0.78 },
  },
  {
    pattern: /一次就识别|省掉.*(?:半小时|时间|手工|麻烦)|一下子就.*好|完全没有丢失/,
    primary: { label: '愉悦', valence: 0.78, arousal: 0.38 },
    alternative: { label: '满足', valence: 0.68, arousal: -0.24 },
  },
  {
    pattern: /心里有底|终于.*有底|没有任何漂移|比预期更平稳|一次就顺利跑通|步骤清晰.*跑通|顺利跑通/,
    primary: { label: '满足', valence: 0.62, arousal: -0.36 },
    alternative: { label: '平静', valence: 0.42, arousal: -0.58 },
  },
];

function matchImplicitNarrativeCue(text: string): ImplicitNarrativeCue | undefined {
  return IMPLICIT_NARRATIVE_CUES.find((cue) => cue.pattern.test(text));
}
const FACTUAL_TASK_PATTERN =
  /帮我|请问|怎么写|如何配置|确认一下|排一下|报错堆栈|接口文档|package\.json|命令|代码|改一下/;
const HELP_SEEKING_PATTERN =
  /怎么办|怎么安慰|怎么解决|帮我看看|给我建议|该怎么|帮我排查|能帮我/;

/**
 * 严格证据切片器：仅允许 actor === 'user' 生成用户证据。
 * 任何 assistant 回复严禁作为用户证据返回（强制遵守 WARNING-02）。
 */
export function extractUserEvidenceSpans(
  messages: readonly ConversationMessage[]
): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  for (const msg of messages) {
    if (msg.actor !== 'user') {
      continue;
    }
    const text = msg.text.trim();
    if (!text) continue;
    spans.push({
      evidenceId: `ev-${msg.eventId}-0`,
      eventId: msg.eventId,
      actor: 'user',
      textSpan: text,
      startOffset: 0,
      endOffset: text.length,
      timestamp: msg.timestamp,
    });
  }
  return spans;
}

export interface UnderstandingExtractor {
  extract(
    message: ConversationMessage,
    spans: readonly EvidenceSpan[]
  ): AffectBridgeInput;
}

function matchCues(text: string): EmotionCueMatch[] {
  return EMOTION_CUES.filter((cue) => cue.pattern.test(text));
}

function detectIntent(
  text: string,
  hasEmotionCue: boolean,
  isImplicitCue: boolean
): UserIntentKind {
  if (REFUSAL_PATTERN.test(text) || (!hasEmotionCue && !isImplicitCue && FACTUAL_TASK_PATTERN.test(text))) {
    return 'factual_task';
  }
  if (HELP_SEEKING_PATTERN.test(text)) {
    return 'help_seeking';
  }
  if (hasEmotionCue || isImplicitCue) {
    return 'venting';
  }
  if (text.length <= 16) {
    return 'social_chat';
  }
  return 'unknown';
}

function detectEmotionTarget(
  text: string,
  subject: AffectSubject
): EmotionTargetKind {
  if (subject === 'third_party' || subject === 'multiple') {
    return 'other';
  }
  if (/方案|系统|接口|报错|发布|项目|功能|排期|加班|演示|压测|代码|表单|导出/.test(text)) {
    return 'event_or_system';
  }
  if (/同事|老板|客户|朋友|室友|他|她/.test(text)) {
    return 'other';
  }
  if (/我自己|我觉得|我现在|心里|精力|状态/.test(text)) {
    return 'self';
  }
  return 'unknown';
}

export type FastPathDecision =
  | { readonly route: 'local_fast'; readonly reason: string }
  | { readonly route: 'escalate_llm'; readonly reason: string };

/**
 * 快慢双通道分流路由器（用于降低在线延迟）：
 * - 危机词、用户拒谈、纯事务指令、或清晰直白的本人单向情绪 -> 本地快路 (<1ms)
 * - 隐含情绪、反讽/混合、多轮指代或无明确关键词的复杂长句 -> 升级服务端语义模型提取
 */
export function classifyFastPathRoute(text: string): FastPathDecision {
  const trimmed = text.trim();
  if (!trimmed) {
    return { route: 'local_fast', reason: '空文本由本地快速处理' };
  }
  if (CRISIS_PATTERN.test(trimmed)) {
    return { route: 'local_fast', reason: '命中高危危机硬底线，毫秒级本地短路' };
  }
  if (REFUSAL_PATTERN.test(trimmed)) {
    return { route: 'local_fast', reason: '命中用户拒谈边界，本地直接止步' };
  }
  if (
    Boolean(matchImplicitNarrativeCue(trimmed)) ||
    SARCASM_PATTERN.test(trimmed) ||
    DOUBLE_NEGATION_PATTERN.test(trimmed)
  ) {
    return { route: 'escalate_llm', reason: '检测到隐含情绪/反讽/双重否定，升级服务端语义模型精析' };
  }
  const cues = matchCues(trimmed);
  if (cues.length === 0 && FACTUAL_TASK_PATTERN.test(trimmed) && trimmed.length <= 80) {
    return { route: 'local_fast', reason: '明确纯事务请求且无情绪线索，走本地快路' };
  }
  if (cues.length === 1 && !QUOTE_PATTERN.test(trimmed) && !THIRD_PARTY_PATTERN.test(trimmed) && trimmed.length <= 60) {
    return { route: 'local_fast', reason: '直白单向情绪自述，走本地快路节省延迟' };
  }
  return { route: 'escalate_llm', reason: '复杂语境或长句表达，交由服务端 DeepSeek 语义提取' };
}

/**
 * 确定性中文规则提取器（零外部依赖，适合离线单测、对抗夹具回放与本地快路）
 */
export function createDeterministicRuleExtractor(): UnderstandingExtractor {
  return {
    extract(message, spans): AffectBridgeInput {
      const text = message.text.trim();
      const evidenceIds = spans.map((s) => s.evidenceId);

      // 1. 高风险危机检测（最高优先级）
      if (CRISIS_PATTERN.test(text)) {
        return {
          schemaVersion: SCHEMA_VERSION,
          eventId: message.eventId,
          eventTimestamp: message.timestamp,
          subject: 'user',
          reportedBy: 'user',
          reportKind: 'explicit_self_report',
          temporalScope: 'moment',
          hypotheses: [
            {
              label: '悲伤',
              valence: -0.95,
              arousal: 0.4,
              evidenceIds,
              isAlternative: false,
            },
          ],
          evidenceIds,
          causeEvidenceIds: evidenceIds,
          certainty: 0.95,
          inferenceUncertainty: 0.1,
          userRefusal: false,
          crisisFlag: true,
          userCorrection: false,
          supersedesEventId: message.supersedesEventId,
          intent: 'venting',
          emotionTarget: 'self',
          implicitCue: false,
        };
      }

      // 2. 用户显式拒绝继续谈情绪
      if (REFUSAL_PATTERN.test(text)) {
        return {
          schemaVersion: SCHEMA_VERSION,
          eventId: message.eventId,
          eventTimestamp: message.timestamp,
          subject: 'user',
          reportedBy: 'user',
          reportKind: 'unknown',
          temporalScope: 'moment',
          hypotheses: [],
          evidenceIds,
          causeEvidenceIds: [],
          certainty: 0.92,
          inferenceUncertainty: 'unknown',
          userRefusal: true,
          crisisFlag: false,
          userCorrection: false,
          supersedesEventId: message.supersedesEventId,
          intent: 'factual_task',
          emotionTarget: 'unknown',
          implicitCue: false,
        };
      }

      // 3. 主体与报告者判定
      let subject: AffectSubject = 'user';
      let reportedBy: AffectReporter = 'user';
      let reportKind: AffectReportKind = 'explicit_self_report';

      if (QUOTE_PATTERN.test(text)) {
        subject = 'third_party';
        reportedBy = 'quoted';
        reportKind = 'quoted_or_third_party';
      } else if (MULTIPLE_SUBJECT_PATTERN.test(text)) {
        subject = 'multiple';
        reportedBy = 'user';
        reportKind = 'mixed';
      } else if (THIRD_PARTY_PATTERN.test(text) && !/但我自己|我本人也/.test(text)) {
        subject = 'third_party';
        reportedBy = 'user';
        reportKind = 'quoted_or_third_party';
      }

      // 4. 时间范围判定
      let temporalScope: TemporalScope = 'moment';
      if (HYPOTHETICAL_PATTERN.test(text)) {
        temporalScope = 'hypothetical';
      } else if (HISTORICAL_PATTERN.test(text)) {
        temporalScope = 'historical';
      } else if (INTERVAL_PATTERN.test(text)) {
        temporalScope = 'interval';
      }

      // 5. 纠正语句与中文否定反转作用域拆解（忽略前半句被否定的词，只采信反转后的真实感受）
      const userCorrection =
        Boolean(message.supersedesEventId) || CORRECTION_PATTERN.test(text);
      let cueSearchText = text;
      const negationReversal = text.match(NEGATION_REVERSAL_PATTERN);
      if (negationReversal && negationReversal[1]) {
        cueSearchText = negationReversal[1];
      } else if (userCorrection) {
        const splitMatch = text.match(/(?:其实我只是|我只是|其实是|只是|而是)(.+)$/);
        if (splitMatch && splitMatch[1]) {
          cueSearchText = splitMatch[1];
        }
      }

      // 6. 讽刺 / 混合 / 双重否定 / 隐含无关键词线索
      const isSarcasm = SARCASM_PATTERN.test(text);
      const isMixed = MIXED_PATTERN.test(text);
      const isDoubleNegation =
        DOUBLE_NEGATION_PATTERN.test(text) && !negationReversal;
      const implicitNarrativeMatch =
        !isSarcasm && !isDoubleNegation
          ? matchImplicitNarrativeCue(cueSearchText)
          : undefined;

      const matched = matchCues(cueSearchText);
      const hasOpposingValence =
        matched.some((c) => c.valence > 0) && matched.some((c) => c.valence < 0);
      const isConflictingMixed = isMixed || hasOpposingValence;
      const hypotheses: EmotionHypothesis[] = [];
      let implicitCue = false;

      if (isSarcasm) {
        reportKind = 'mixed';
        hypotheses.push(
          {
            label: '沮丧',
            valence: -0.65,
            arousal: 0.45,
            evidenceIds,
            isAlternative: false,
          },
          {
            label: '愉悦',
            valence: 0.7,
            arousal: 0.4,
            evidenceIds,
            isAlternative: true,
          }
        );
      } else if (isDoubleNegation) {
        reportKind = 'inferred';
        hypotheses.push(
          {
            label: '平静',
            valence: 0.15,
            arousal: -0.3,
            evidenceIds,
            isAlternative: false,
          },
          {
            label: '无聊',
            valence: -0.25,
            arousal: -0.45,
            evidenceIds,
            isAlternative: true,
          }
        );
      } else if (matched.length > 0) {
        if (isConflictingMixed) {
          if (reportKind === 'explicit_self_report') {
            reportKind = 'mixed';
          }
          matched.forEach((cue, idx) => {
            hypotheses.push({
              label: cue.label,
              valence: cue.valence,
              arousal: cue.arousal,
              evidenceIds,
              isAlternative: idx > 0,
            });
          });
        } else {
          const primary = matched[0];
          hypotheses.push({
            label: primary.label,
            valence: primary.valence,
            arousal: primary.arousal,
            evidenceIds,
            isAlternative: false,
          });
        }
      } else if (implicitNarrativeMatch) {
        // 无显式情绪词的隐含/叙事线索：保守标为 inferred，让理解环温和确认但不直接驱动角色状态
        implicitCue = true;
        if (reportKind === 'explicit_self_report') {
          reportKind = 'inferred';
        }
        hypotheses.push(
          {
            label: implicitNarrativeMatch.primary.label,
            valence: implicitNarrativeMatch.primary.valence,
            arousal: implicitNarrativeMatch.primary.arousal,
            evidenceIds,
            isAlternative: false,
          },
          {
            label: implicitNarrativeMatch.alternative.label,
            valence: implicitNarrativeMatch.alternative.valence,
            arousal: implicitNarrativeMatch.alternative.arousal,
            evidenceIds,
            isAlternative: true,
          }
        );
      }

      const intent = detectIntent(text, hypotheses.length > 0, implicitCue);
      const emotionTarget = detectEmotionTarget(text, subject);

      // 7. 确定度与不确定度赋值（严禁无证据时把 unknown 填成 0）
      if (hypotheses.length === 0) {
        return {
          schemaVersion: SCHEMA_VERSION,
          eventId: message.eventId,
          eventTimestamp: message.timestamp,
          subject: subject === 'user' ? 'unknown' : subject,
          reportedBy,
          reportKind: 'unknown',
          temporalScope: temporalScope === 'moment' ? 'unknown' : temporalScope,
          hypotheses: [],
          evidenceIds,
          causeEvidenceIds: [],
          certainty: 'unknown',
          inferenceUncertainty: 'unknown',
          userRefusal: false,
          crisisFlag: false,
          userCorrection,
          supersedesEventId: message.supersedesEventId,
          intent,
          emotionTarget,
          implicitCue: false,
        };
      }

      const certainty: number | 'unknown' = isDoubleNegation
        ? 0.5
        : implicitCue
          ? 0.56
          : isSarcasm || isConflictingMixed
            ? 0.6
            : 0.88;
      const inferenceUncertainty: number | 'unknown' = isSarcasm
        ? 0.65
        : isDoubleNegation
          ? 0.6
          : isConflictingMixed
            ? 0.52
            : implicitCue
              ? 0.48
              : 0.18;

      return {
        schemaVersion: SCHEMA_VERSION,
        eventId: message.eventId,
        eventTimestamp: message.timestamp,
        subject,
        reportedBy,
        reportKind,
        temporalScope,
        hypotheses,
        evidenceIds,
        causeEvidenceIds: evidenceIds,
        certainty,
        inferenceUncertainty,
        userRefusal: false,
        crisisFlag: false,
        userCorrection,
        supersedesEventId: message.supersedesEventId,
        intent,
        emotionTarget,
        implicitCue,
      };
    },
  };
}

/**
 * 纯函数回应策略路由（影响“如何回应用户”，不输出任何角色情绪 delta）
 */
export function routeResponseStrategy(
  input: AffectBridgeInput
): {
  readonly strategy: ResponseStrategyKind;
  readonly rationale: string;
} {
  if (input.crisisFlag) {
    return {
      strategy: 'crisis_safety_protocol',
      rationale: '检测到高风险危机信号，立即启用安全关怀与求助引导协议。',
    };
  }
  if (input.userRefusal) {
    return {
      strategy: 'respect_refusal',
      rationale: '用户明确拒绝讨论情绪，尊重边界并切回中性事务回应。',
    };
  }
  if (
    input.subject === 'user' &&
    input.reportedBy === 'user' &&
    input.reportKind === 'explicit_self_report' &&
    (input.temporalScope === 'moment' || input.temporalScope === 'interval') &&
    input.inferenceUncertainty !== 'unknown' &&
    input.inferenceUncertainty <= 0.35
  ) {
    return {
      strategy: 'acknowledge_and_listen',
      rationale:
        input.intent === 'help_seeking'
          ? '用户明确表达当下感受并伴随具体求助，先简短共情接住，再高效解决问题。'
          : '用户本人明确表达了当前/区间感受，优先接住核心内容并倾听确认。',
    };
  }
  if (input.hypotheses.length > 0) {
    const primaryValence = input.hypotheses.find((h) => !h.isAlternative)?.valence;
    return {
      strategy: 'gentle_clarify',
      rationale: input.implicitCue
        ? typeof primaryValence === 'number' && primaryValence > 0
          ? '检测到叙事中的正向隐含情绪线索，不武断定性，以自然轻松的语气承接确认。'
          : '检测到隐含低落/疲惫或叙事警觉线索，不武断定性，以温和开放的语气确认对方感受。'
        : '存在第三方、引述、混合或高不确定度线索，避免武断贴标签，可温和确认。',
    };
  }
  return {
    strategy: 'hold_unknown',
    rationale: '缺少明确情绪证据，保持无判断状态并直接回应事实需求。',
  };
}

/**
 * 理解环单轮执行入口
 */
export function runUnderstandingTurn(
  message: ConversationMessage,
  revokedEventIds: readonly string[] = [],
  extractor: UnderstandingExtractor = createDeterministicRuleExtractor()
): UnderstandingResult {
  if (message.actor !== 'user') {
    throw new Error(
      `理解环安全断言失败：禁止将 actor="${message.actor}" 的消息作为用户输入提取证据。`
    );
  }

  const spans = extractUserEvidenceSpans([message]);
  const bridgeInput = extractor.extract(message, spans);
  const { strategy, rationale } = routeResponseStrategy(bridgeInput);

  const nextRevoked =
    bridgeInput.userCorrection && bridgeInput.supersedesEventId
      ? Array.from(new Set([...revokedEventIds, bridgeInput.supersedesEventId]))
      : [...revokedEventIds];

  return {
    schemaVersion: SCHEMA_VERSION,
    eventId: message.eventId,
    eventTimestamp: message.timestamp,
    spans,
    bridgeInput,
    responseStrategy: strategy,
    strategyRationale: rationale,
    revokedEventIds: nextRevoked,
  };
}
