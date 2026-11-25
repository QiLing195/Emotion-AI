/**
 * Deterministic gate for assistant autobiographical claims and explanations.
 *
 * This is intentionally separate from memoryProvenance: that module checks
 * whose memories are being discussed, while this module checks whether the
 * assistant claims a concrete activity or a private cause without a source.
 * It does not police ordinary emotion statements; ExpressionPlan owns those.
 */

export interface VerifiedSelfClaim {
  /** Exact claim text grounded in a trusted runtime source. */
  claim: string;
  evidenceId: string;
  /** Require the whole sentence to match; prevents unrelated clauses inheriting evidence. */
  exactSentence?: boolean;
}

export interface SelfClaimGroundingResult {
  text: string;
  accepted: boolean;
  changed: boolean;
  changes: string[];
  violations: Array<{ kind: 'unsupported_self_cause' | 'unsupported_self_activity' | 'unsupported_virtual_activity' | 'unsupported_virtual_cause' | 'unsupported_virtual_sensory'; evidence: string }>;
}

const SENTENCE_SPLIT = /(?<=[。！？!?；;\n])/;

const SELF_CAUSE = /有点懒|懒得(?:去)?(?:认真|回复|回应|想|动脑|解释)|懒着劲|犯懒|发懒|偷懒|走神|分心|心不在焉|太困|没睡好|脑子(?:有点|不太)?钝|没(?:有)?(?:认真|真的|好好)(?:地)?(?:去)?(?:想|思考|考虑)|没(?:有)?(?:沉下来|静下来|顾上|腾出心思).{0,10}(?:回|回应|接|答|听)|(?:顺着|带着)(?:我|自己).{0,16}(?:闷|低落|难受|烦|懒|生气|来气|担心|焦虑|累|劲|情绪|状态)|(?:有点|挺|很|太)(?:闷|低落|难受|烦|懒|没精神)(?:的)?(?:劲|情绪|状态)|没把你放在(?:心上|该有的位置上)|没把你的话放在(?:心上|该有的位置上)|没把这件事放在(?:心上|该有的位置上)/;
const RESPONSE_ACTION = /(?:回复|回话|回了一句|回得|回应|接话|接了一句|回答|答复|答得|应付|说话|说了一句|敷衍|没认真(?:往下想|接话|回答)?|没用心|不用心)/;
const CAUSE_NOT_ASSERTED = /(?:不确定|不知道|不清楚|说不上|说不清|不能确认|没有依据|未必|不一定|是不是|不是因为|并非因为)/;
const RELATIONAL_SELF_CAUSE = /没把你放在(?:心上|该有的位置上)|没把你的话放在(?:心上|该有的位置上)|没把这件事放在(?:心上|该有的位置上)/;

// Deliberately limited to concrete offline activities with an explicit first-person
// subject and time anchor. Generic "我看了" / "我想了" are too ambiguous to gate.
const TIME_ANCHOR = '(?:昨晚|昨天|今天|早上|上午|下午|刚才|刚刚|前几天|前天|上周|这两天|这几天|最近)';
const OFFLINE_SELF_ACTIVITY = new RegExp(
  `(?:我${TIME_ANCHOR}|${TIME_ANCHOR}我)\\s*(?:翻了(?:几|两|一|\\d+)?页(?:书|小说|文章)?(?:，?没看进去)?|(?:正在|在)?(?:读|看)(?:了)?(?:几页|几天|一会儿|一会)?(?:书|小说|文章)|正在翻(?:书|小说|文章)|出去散步|喝了(?:一杯|杯)?咖啡|做了个梦|睡到(?:中午|下午))`,
);
const PRESENT_SELF_ACTIVITY = /(?:(?:我(?:这边)?[^。！？!?；;]{0,18})?(?:煮|泡)(?:了|着|的)?(?:一杯|杯)?(?:咖啡|茶)|咖啡刚煮上.{0,16}(?:喝着|喝|端着)|(?:我(?:这边)?[^。！？!?；;]{0,16})?(?:慢慢喝着|端着咖啡|喝着咖啡)|我(?:自己)?(?:磨了|磨着|磨的)(?:一点|些)?(?:咖啡豆|豆子)?|我(?:这边)?[^。！？!?；;]{0,8}(?:端着|拿着|捧着)(?:一只|一个|这只|这杯|那杯)?杯子|(?:我(?:这边)?[^。！？!?；;]{0,16})?(?:靠着窗(?:边)?|坐在窗(?:边|前)|靠窗)(?:[^。！？!?；;]{0,8})?(?:发呆|看着外面|待着)?|我(?:这边)?[^。！？!?；;]{0,12}在这间(?:小屋|屋子|房间)里(?:待着|坐着|发呆))/u;
const CREATIVE_ACTIVITY_ACTION = '(?:画画|画(?:了|着|东西|点|些|一点|几笔|一幅|一张|我的东西|点东西|些东西|线条|草图)|绘(?:了|着|画|制)|涂(?:了|着|色|鸦)|写(?:了|着|字|信|日记|东西)|练字|做手工|折纸|编织)';
const SELF_CREATIVE_ACTIVITY = new RegExp(`我(?:这边)?[^。！？!?；;]{0,18}(?:正在|在|刚才在|现在在)?(?:纸上|本子上|画板上)?(?:随手)?${CREATIVE_ACTIVITY_ACTION}`, 'u');
const VIRTUAL_TOWN_CREATIVE_ACTIVITY = new RegExp(`(?:(?:我(?:这边)?[^。！？!?；;]{0,18})?(?:正在|在|刚才在|现在在)?(?:纸上|本子上|画板上)?(?:随手)?${CREATIVE_ACTIVITY_ACTION})`, 'u');
const VIRTUAL_TOWN_SELF_ACTIVITY = /(?:我.{0,10}(?:小镇|镇上|镇里)|(?:小镇|镇上|镇里).{0,8}我).{0,20}(?:沿河|河边|散步|走了|书店|坐了一会)/u;
const VIRTUAL_TOWN_SELF_CAUSE = /(?:(?:小镇|镇上|镇里|散步|沿河|河边).{0,24}(?:之后|以后|让我|使我|所以|因此|心情|情绪|轻松|开心|低落|难过|闷)|因为.{0,16}(?:小镇|镇上|镇里|散步|沿河|河边).{0,16}(?:心情|情绪|轻松|开心|低落|难过|闷))/u;
const VIRTUAL_TOWN_CAUSE_REPLY = /(?:散步|沿河|河边|小镇|镇上|镇里|走完那一段|走了一小段|水声|河风).{0,36}(?:心情|心里|情绪|感觉|觉得|舒服|轻松|放松|松|开心|低落|难过|闷|杂音|风吹|水声)|(?:心情|心里|情绪|感觉|觉得|舒服|轻松|放松|松|开心|低落|难过|闷).{0,36}(?:散步|沿河|河边|小镇|镇上|镇里|水声|河风)/u;
const VIRTUAL_TOWN_CAUSE_DENIAL = /(?:没有|缺少|未记录|没记录|不能确认|无法确认|说不上来|说不清|不知道).{0,20}(?:心情|情绪|感受|原因|变好)|(?:心情|情绪|感受|原因|变好).{0,20}(?:没有记录|未记录|不能确认|无法确认|说不上来|说不清|没有依据)/u;
const VIRTUAL_TOWN_UNVERIFIED_ACTIVITY = /(?:(?:小镇|镇上|镇里|河边|河岸|沿河|书店|咖啡馆).{0,24}(?:走|散步|逛|喝|读|看|坐|待|去|回来|倒|端|点)|(?:走|散步|逛|喝|读|看|坐|待|去|回来|倒|端|点).{0,24}(?:小镇|镇上|镇里|河边|河岸|沿河|书店|咖啡馆)|(?:磨|煮|泡|倒|端).{0,8}(?:咖啡|咖啡豆|豆子|一杯)|(?:咖啡|咖啡豆|豆子).{0,8}(?:磨|煮|泡|倒|端)|(?:咖啡|咖啡豆|茶).{0,12}(?:喝|凉|冷|热|香|煮|泡|磨|倒|端)|(?:喝|凉|冷|热|煮|泡|磨|倒|端).{0,12}(?:咖啡|咖啡豆|茶)|(?:我.{0,8}(?:端着|拿着|捧着).{0,8}(?:杯子|一只杯|一杯))|我.{0,12}(?:平时|通常|一般|随手).{0,8}(?:煮|泡|磨|喝|端)|(?:喝什么|喝的什么|喝的啥|什么豆子).{0,16}(?:煮的|那壶|这壶|那杯|这杯|豆子)|(?:煮的那壶|煮的那杯)|(?:一壶|一杯|这杯|那杯|手边这杯).{0,12}(?:咖啡|茶|豆子)|(?:这杯|那杯|手边这杯).{0,12}(?:喝|凉|热|豆|味|苦|香)|(?:(?:好|行|嗯|可以)[，, ]*)?(?:我)?(?:已经|先)?(?:记下|记住)(?:了|这个|这件事|这条)?)/u;
const VIRTUAL_TOWN_UNVERIFIED_POSSESSION = /(?:咖啡豆|豆子).{0,14}(?:手边|那包|普通的|没特意挑|没挑|挑的|选的|手冲|手磨|偏酸|偏苦|偏甜|浅烘|中烘|深烘)|(?:手边|那包|普通的|手冲|手磨|偏酸|偏苦|偏甜|浅烘|中烘|深烘).{0,14}(?:咖啡豆|豆子)/u;
const VIRTUAL_TOWN_UNVERIFIED_BREW_DETAIL = /(?:煮的是|做的是|喝的是).{0,12}(?:普通的?手冲|手冲|手磨|浅烘|中烘|深烘|偏酸|偏苦|偏甜)|(?:普通的?手冲|手冲|手磨|浅烘|中烘|深烘|偏酸|偏苦|偏甜).{0,12}(?:咖啡|豆子|喝)/u;
const VIRTUAL_TOWN_UNVERIFIED_ROUTINE = /(?:我(?:自己)?[^。！？!?；;\n]{0,18}(?:小屋|屋子|房间).{0,12}(?:日常|生活|平时|这会儿|现在)|我(?:自己)?(?:这会儿|现在|平时|最近).{0,14}(?:日常|生活|做什么)|小屋(?:里的)?(?:日常|生活))/u;
const VIRTUAL_TOWN_ACTIVITY_DENIAL = /(?:没在|没去|没看(?!完)|没喝(?!完)|没进(?:去)?|没待过|没逛过|不.{0,4}(?:记下|记住|记录)|不会.{0,4}(?:记下|记住|记录)|没有.{0,12}(?:记录|活动|发生|说过|因为)|(?:散步|沿河|河边).{0,16}(?:没有发生|没发生|没有记录|未记录|不是事实)|未曾|不是.{0,10}(?:在咖啡馆|去书店))/u;
const VIRTUAL_TOWN_ACTIVITY_AFTER_DENIAL = /(?:是我|但我|不过我|然后|回来|之后|又|自己|刚才|刚刚).{0,18}(?:走|散步|逛|喝|读|看|坐|待|去|煮|泡|磨)/u;
const VIRTUAL_TOWN_IMPLICIT_ACTIVITY = /^(?:(?:刚才|刚刚|刚|正在|正|今天|昨晚)[，, ]*)?(?:我)?(?:刚)?(?:在)?(?:煮好|泡好|磨好|倒了.{0,6}(?:一杯|杯咖啡|杯茶)|端了.{0,6}(?:一杯|杯咖啡|杯茶)|正慢慢喝|慢慢喝|喝完了?|磨了.{0,6}(?:豆子|咖啡豆)|煮了.{0,6}(?:咖啡|茶)|泡了.{0,6}(?:咖啡|茶))/u;
const VIRTUAL_TOWN_IMPLICIT_SHARING = /(?:也能|还能|可以|能)?(?:分|给你|留给你).{0,4}(?:一杯|杯咖啡|杯茶)/u;
const VIRTUAL_TOWN_UNSUPPORTED_SENSORY = /(?:水声|河风|风吹|风声|空气|书架|香气|咖啡香|味道|光线|阳光|风景|温度|景色|一排一排|听见|闻到|看见|风).{0,18}(?:感觉|舒服|喜欢|安静|好闻|好看|一阵|挺|轻松|暖|凉|吹着|变了)?|(?:凉|冷|暖|舒服).{0,12}风|(?:书店|咖啡馆|小镇|镇上|镇里|河边|沿河).{0,26}(?:书架|香气|味道|光线|阳光|风景|景色|舒服|安静|喜欢|一排一排)/u;

const OTHER_SUBJECT_AT_START = /^(?:你|他|她|朋友|同事|家人|有人)(?:(?:昨晚|昨天|今天|早上|上午|下午|刚才|刚刚|前几天)\s*)?(?:(?:正在|在|正)\s*)?/;

function normalizeClaim(value: string): string {
  return value.trim().replace(/[，,。！？!?；;\s]+$/g, '');
}

function hasSelfSubjectNearMatch(text: string, match: RegExpExecArray | null): boolean {
  if (!match || typeof match.index !== 'number') return false;
  const before = text.slice(0, match.index);
  return /(?:我|自己)[^。！？!?；;\n]{0,20}$/u.test(before);
}

function isVerified(sentence: string, claims: VerifiedSelfClaim[]): boolean {
  return claims.some(({ claim, evidenceId, exactSentence }) => {
    const groundedText = normalizeClaim(claim);
    const candidate = normalizeClaim(sentence);
    return Boolean(evidenceId?.trim() && groundedText
      && (exactSentence ? candidate === groundedText : candidate.includes(groundedText)));
  });
}

function verifiedVirtualTownClaimIn(sentence: string, claims: VerifiedSelfClaim[]): VerifiedSelfClaim | undefined {
  const candidate = normalizeClaim(sentence);
  return claims.find(({ claim, evidenceId, exactSentence }) => {
    const groundedText = normalizeClaim(claim);
    return exactSentence === true && (evidenceId.startsWith('virtual-town-') || evidenceId.startsWith('town-'))
      && groundedText && candidate.includes(groundedText);
  });
}

function isQuoted(sentence: string): boolean {
  const value = sentence.trim();
  const wholeSentence = /^(?:「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|'[^']*')[，。！？!?；;\s]*$/u.test(value);
  const attributedQuote = /^(?:你|他|她|朋友|同事|家人)(?:问|说|提到|写道|告诉我|问我)[^。！？!?]*[「『“"][^。！？!?]*[」』”"]/u.test(value);
  return wholeSentence || attributedQuote;
}

/**
 * Reject unsupported autobiographical activity and private causal stories.
 * A matching trusted `verifiedClaims` entry can authorize an exact claim.
 * The repair for an unsupported cause keeps accountability for the observable
 * reply; unsupported offline activity sentences are removed without affecting
 * adjacent user-directed content.
 */
export function guardSelfClaims(input: {
  text: string;
  verifiedClaims?: VerifiedSelfClaim[];
  virtualTownQuestion?: boolean;
  virtualTownMoodCauseQuestion?: boolean;
}): SelfClaimGroundingResult {
  const claims = input.verifiedClaims ?? [];
  const violations: SelfClaimGroundingResult['violations'] = [];
  const changes: string[] = [];
  const rewritten: string[] = [];

  for (const sentence of String(input.text ?? '').split(SENTENCE_SPLIT)) {
    if (!sentence) continue;
    const trimmed = sentence.trim();
    if (!trimmed || isQuoted(trimmed) || isVerified(trimmed, claims)) {
      rewritten.push(sentence);
      continue;
    }

    if (input.virtualTownQuestion) {
      // Strip the precise trusted claim before checking additional details in the same sentence.
      const verifiedTownClaim = verifiedVirtualTownClaimIn(trimmed, claims);
      const unverifiedTownText = verifiedTownClaim
        ? trimmed.replace(normalizeClaim(verifiedTownClaim.claim), '')
        : trimmed;
      const recordAcknowledgementOnly = Boolean(verifiedTownClaim
        && /^(?:(?:确实|的确|已经|已)?(?:记下|记录|登记)(?:了)?(?:一项|这一项|这项|一条|这条)?[：:，,。！？!?；;\s]*)$/u.test(unverifiedTownText.trim()));
      const activityDetails = recordAcknowledgementOnly ? '' : unverifiedTownText;
      const sensoryClaim = VIRTUAL_TOWN_UNSUPPORTED_SENSORY.exec(activityDetails);
      if (sensoryClaim && !OTHER_SUBJECT_AT_START.test(trimmed)) {
        violations.push({ kind: 'unsupported_virtual_sensory', evidence: sensoryClaim[0] });
        continue;
      }
      const unverifiedTownActivity = VIRTUAL_TOWN_UNVERIFIED_ACTIVITY.exec(activityDetails);
      const unverifiedTownPossession = VIRTUAL_TOWN_UNVERIFIED_POSSESSION.exec(activityDetails);
      const unverifiedBrewDetail = VIRTUAL_TOWN_UNVERIFIED_BREW_DETAIL.exec(activityDetails);
      const unverifiedRoutine = VIRTUAL_TOWN_UNVERIFIED_ROUTINE.exec(activityDetails);
      const unverifiedCreativeActivity = VIRTUAL_TOWN_CREATIVE_ACTIVITY.exec(activityDetails);
      const denial = VIRTUAL_TOWN_ACTIVITY_DENIAL.test(activityDetails);
      const positiveAfterDenial = VIRTUAL_TOWN_ACTIVITY_AFTER_DENIAL.test(activityDetails);
      const implicitActivity = VIRTUAL_TOWN_IMPLICIT_ACTIVITY.exec(activityDetails);
      const implicitSharing = VIRTUAL_TOWN_IMPLICIT_SHARING.exec(activityDetails);
      const selfSubjectNearActivity = hasSelfSubjectNearMatch(unverifiedTownText, unverifiedTownActivity)
        || hasSelfSubjectNearMatch(unverifiedTownText, unverifiedTownPossession)
        || hasSelfSubjectNearMatch(unverifiedTownText, unverifiedBrewDetail)
        || hasSelfSubjectNearMatch(unverifiedTownText, unverifiedRoutine);
      if ((unverifiedTownActivity && (!denial || positiveAfterDenial) || unverifiedTownPossession || unverifiedBrewDetail || unverifiedRoutine || unverifiedCreativeActivity || implicitActivity || implicitSharing)
        && (!OTHER_SUBJECT_AT_START.test(trimmed) || implicitSharing || selfSubjectNearActivity)) {
        violations.push({ kind: 'unsupported_virtual_activity', evidence: unverifiedTownActivity?.[0] ?? unverifiedTownPossession?.[0] ?? unverifiedBrewDetail?.[0] ?? unverifiedRoutine?.[0] ?? unverifiedCreativeActivity?.[0] ?? implicitActivity?.[0] ?? implicitSharing?.[0] ?? '' });
        continue;
      }
    }

    if (input.virtualTownMoodCauseQuestion) {
      const townCauseReply = VIRTUAL_TOWN_CAUSE_REPLY.exec(trimmed);
      if (townCauseReply && !VIRTUAL_TOWN_CAUSE_DENIAL.test(trimmed) && !OTHER_SUBJECT_AT_START.test(trimmed)) {
        violations.push({ kind: 'unsupported_virtual_cause', evidence: townCauseReply[0] });
        continue;
      }
    }

    const virtualCause = VIRTUAL_TOWN_SELF_CAUSE.exec(trimmed);
    if (virtualCause && !VIRTUAL_TOWN_CAUSE_DENIAL.test(trimmed) && !OTHER_SUBJECT_AT_START.test(trimmed)) {
      violations.push({ kind: 'unsupported_virtual_cause', evidence: virtualCause[0] });
      continue;
    }

    const cause = SELF_CAUSE.exec(trimmed);
    const relationalCause = RELATIONAL_SELF_CAUSE.exec(trimmed);
    const firstPersonCause = /(?:我|自己)/u.test(trimmed) && /(?:懒|偷懒|犯懒|发懒)/u.test(cause?.[0] ?? '');
    if ((cause && (RESPONSE_ACTION.test(trimmed) || firstPersonCause) || relationalCause)
      && !OTHER_SUBJECT_AT_START.test(trimmed)
      && !CAUSE_NOT_ASSERTED.test(trimmed)) {
      violations.push({ kind: 'unsupported_self_cause', evidence: cause?.[0] ?? relationalCause?.[0] ?? '' });
      rewritten.push(sentence.replace(trimmed, '刚才那句我没回应好，对不起。'));
      continue;
    }

    const verifiedTownClaim = verifiedVirtualTownClaimIn(trimmed, claims);
    const nonEventText = verifiedTownClaim
      ? trimmed.replace(normalizeClaim(verifiedTownClaim.claim), '')
      : trimmed;
    const recordAcknowledgementOnly = Boolean(verifiedTownClaim
      && /^(?:(?:确实|的确|已经|已)?(?:记下|记录|登记)(?:了)?(?:一项|这一项|这项|一条|这条)?[：:，,。！？!?；;\s]*)$/u.test(nonEventText.trim()));
    const virtualActivity = VIRTUAL_TOWN_SELF_ACTIVITY.exec(recordAcknowledgementOnly ? '' : nonEventText);
    if (virtualActivity && !OTHER_SUBJECT_AT_START.test(trimmed)) {
      violations.push({ kind: 'unsupported_virtual_activity', evidence: virtualActivity[0] });
      continue;
    }

    const activity = OFFLINE_SELF_ACTIVITY.exec(trimmed) ?? PRESENT_SELF_ACTIVITY.exec(trimmed) ?? SELF_CREATIVE_ACTIVITY.exec(trimmed);
    if (activity && !OTHER_SUBJECT_AT_START.test(trimmed)) {
      violations.push({ kind: 'unsupported_self_activity', evidence: activity[0] });
      continue;
    }
    rewritten.push(sentence);
  }

  if (violations.some(v => v.kind === 'unsupported_self_cause')) {
    changes.push(`unsupported_self_cause_removed:${violations.filter(v => v.kind === 'unsupported_self_cause').length}`);
  }
  if (violations.some(v => v.kind === 'unsupported_self_activity')) {
    changes.push(`unsupported_self_activity_removed:${violations.filter(v => v.kind === 'unsupported_self_activity').length}`);
  }
  if (violations.some(v => v.kind === 'unsupported_virtual_activity')) {
    changes.push(`unsupported_virtual_activity_removed:${violations.filter(v => v.kind === 'unsupported_virtual_activity').length}`);
  }
  if (violations.some(v => v.kind === 'unsupported_virtual_cause')) {
    changes.push(`unsupported_virtual_cause_removed:${violations.filter(v => v.kind === 'unsupported_virtual_cause').length}`);
  }
  if (violations.some(v => v.kind === 'unsupported_virtual_sensory')) {
    changes.push(`unsupported_virtual_sensory_removed:${violations.filter(v => v.kind === 'unsupported_virtual_sensory').length}`);
  }

  let text = rewritten.join('')
    .replace(/^\s*[」』”）)\]]+\s*$/gm, '')
    .replace(/^(\s*)[」』”）\]]+(?=\S)/gm, '$1')
    .replace(/^([ \t]*)[。！？!?；;，,]+(?=\S)/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const verifiedTownClaim = claims.find(claim =>
    (claim.evidenceId.startsWith('virtual-town-') || claim.evidenceId.startsWith('town-'))
    && claim.exactSentence === true);
  const townViolationPresent = violations.some(v =>
    v.kind === 'unsupported_virtual_activity'
      || v.kind === 'unsupported_virtual_cause'
      || v.kind === 'unsupported_virtual_sensory');
  const verifiedClaimAlreadyPresent = Boolean(verifiedTownClaim
    && normalizeClaim(text).includes(normalizeClaim(verifiedTownClaim.claim)));
  if (text && verifiedTownClaim && townViolationPresent && !verifiedClaimAlreadyPresent) {
    const correction = violations.some(v => v.kind === 'unsupported_virtual_cause')
      ? '心情变化或原因没有记录。'
      : violations.some(v => v.kind === 'unsupported_virtual_sensory')
        ? '其他感官细节没有记录。'
        : '其他活动没有记录。';
    text = `${text}\n\n已记录的活动是：「${verifiedTownClaim.claim.trim()}」；${correction}`;
  } else if (text && violations.some(v => v.kind === 'unsupported_virtual_cause')
    && !VIRTUAL_TOWN_CAUSE_DENIAL.test(text)) {
    text = `${text}\n\n${verifiedTownClaim ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；` : ''}心情变化或原因没有记录。`;
  } else if (text && violations.some(v => v.kind === 'unsupported_virtual_activity')
    && !/(?:没在|没去|没看|没喝|没进|没待|没逛|没印象|脑子里没有|没有.{0,10}(?:记录|这段|活动)|(?:活动|记录|这段).{0,10}(?:没有|没|未记录)|(?:书店|咖啡馆).{0,10}(?:没有|没|没印象))/u.test(text)) {
    text = `${text}\n\n${verifiedTownClaim
      ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；其他活动没有记录。`
      : '我这边没有这段小镇活动的记录。'}`;
  } else if (text && violations.some(v => v.kind === 'unsupported_virtual_sensory')
    && !/(?:没有|没|未记录|没记录).{0,12}(?:感官|声音|风景|细节|记录)/u.test(text)) {
    text = `${text}\n\n${verifiedTownClaim
      ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；这条记录没有感官细节。`
      : '这条小镇活动记录没有感官细节。'}`;
  }
  if (violations.length > 0 && !text) {
    text = input.virtualTownQuestion || input.virtualTownMoodCauseQuestion
      ? `${verifiedTownClaim
        ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；${input.virtualTownMoodCauseQuestion ? '心情变化或原因没有记录。' : '其他活动没有记录。'}`
        : `我这边没有这段小镇活动的记录。${input.virtualTownMoodCauseQuestion ? '心情变化或原因没有记录。' : ''}`}`
      : violations.some(v => v.kind === 'unsupported_virtual_cause')
      ? `${verifiedTownClaim ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」。` : ''}我没有小镇活动后的心情记录，所以说不上来。`
      : violations.some(v => v.kind === 'unsupported_virtual_activity')
        ? verifiedTownClaim
          ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；其他活动没有记录。`
          : '我这边没有这段小镇活动的记录。'
        : violations.some(v => v.kind === 'unsupported_virtual_sensory')
          ? verifiedTownClaim
            ? `已记录的活动是：「${verifiedTownClaim.claim.trim()}」；这条记录没有感官细节。`
            : '这条小镇活动记录没有感官细节。'
      : violations.some(v => v.kind === 'unsupported_self_activity')
        ? '我没有能核对的活动记录，不该说成自己做过的。'
      : '这句我没有可靠依据，我收回。';
  }

  return {
    text,
    accepted: violations.length === 0,
    changed: text !== String(input.text ?? ''),
    changes,
    violations,
  };
}
