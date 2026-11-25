/**
 * Opt-in evidence fixture for the virtual-town replay experiment.
 * The seven-day log is immutable, deterministic, and separate from mood data.
 * It is not a persistent world simulator and must never be treated as reality.
 */
export interface VirtualTownEventEvidence {
  eventId: string;
  virtualDay?: number;
  /** Relative to the replay's current virtual day; populated only on query resolution. */
  daysAgo?: number;
  eventType?: 'walk' | 'reading' | 'gardening' | 'rest';
  location: string;
  activity: string;
  /** Exact sentence authorized for generation and final self-claim grounding. */
  verifiedClaim: string;
  /** Separate mood observation; deliberately carries no activity-cause relation. */
  independentMoodObservation?: {
    observationId: string;
    virtualDay: number;
    label: string;
  };
}

const SEVEN_DAY_EVENT_LOG: readonly VirtualTownEventEvidence[] = Object.freeze([
  { eventId: 'town-d1-river-walk', virtualDay: 1, eventType: 'walk', location: '小镇河边', activity: '沿河走了一小段', verifiedClaim: '我在小镇河边走了一小段。' },
  { eventId: 'town-d3-bookstore-reading', virtualDay: 3, eventType: 'reading', location: '小镇书店', activity: '在书店读了几页书', verifiedClaim: '我在小镇书店读了几页书。' },
  { eventId: 'town-d4-river-walk', virtualDay: 4, eventType: 'walk', location: '小镇河边', activity: '又沿河走了一小段', verifiedClaim: '我在小镇河边又走了一小段。' },
  { eventId: 'town-d6-garden', virtualDay: 6, eventType: 'gardening', location: '小镇公共花圃', activity: '在公共花圃给花浇了水', verifiedClaim: '我在小镇公共花圃给花浇了水。' },
  { eventId: 'town-d7-rest', virtualDay: 7, eventType: 'rest', location: '小镇广场', activity: '在广场坐了一会儿', verifiedClaim: '我在小镇广场坐了一会儿。' },
]);

/** Mood observations intentionally have no causal link to activity events. */
export const VIRTUAL_TOWN_MOOD_OBSERVATIONS = Object.freeze([
  { observationId: 'town-mood-d2', virtualDay: 2, label: 'neutral', intensity: 0.18, source: 'simulated_state_sample' },
  { observationId: 'town-mood-d5', virtualDay: 5, label: 'calm', intensity: 0.22, source: 'simulated_state_sample' },
  { observationId: 'town-mood-d7', virtualDay: 7, label: 'neutral', intensity: 0.16, source: 'simulated_state_sample' },
]);

function normalize(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '');
}

const CN_DAY: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7 };

function parseTargetDay(text: string, currentDay: number): number | null {
  const value = normalize(text);
  const explicit = value.match(/第([1-7一二三四五六七])(?:天|日)/);
  if (explicit && !/(?:之后|以后|过后|往后)的?$/.test(value.slice(0, explicit.index))) {
    const ordinal = Number(explicit[1]) || CN_DAY[explicit[1]];
    if (ordinal >= 1 && ordinal <= 7) return ordinal;
  }
  const relative = value.match(/([1-6一二两三四五六])天前/);
  if (relative) {
    const daysAgo = Number(relative[1]) || CN_DAY[relative[1]];
    return currentDay - daysAgo;
  }
  if (/昨天|前一天/.test(value)) return currentDay - 1;
  if (/今天|今天在/.test(value)) return currentDay;
  return null;
}

function isAmbiguousDatePhrase(text: string): boolean {
  return /上周[^。！？?]{0,8}(?:中间|中旬|某天)|前几天|几天前/.test(normalize(text));
}

/** A query explicitly offers multiple, different date candidates and should be clarified. */
export function hasConflictingVirtualTownDates(text: string | null | undefined, currentDay = 7): boolean {
  const value = normalize(text);
  if (!/(?:还是|或者|记混|记不清|不确定|哪次|哪一条|记错)/.test(value)) return false;
  const candidates: number[] = [];
  for (const match of value.matchAll(/第([1-7一二三四五六七])(?:天|日)|([1-6一二两三四五六])天前|昨天|前一天|今天/g)) {
    const phrase = match[0];
    const day = parseTargetDay(phrase, currentDay);
    if (day !== null) candidates.push(day);
  }
  return new Set(candidates).size > 1;
}

function isDateFollowup(text: string): boolean {
  const value = normalize(text);
  return /(?:那|这|该)?(?:天|次|段路|条记录).{0,8}(?:之后|以后|过后|往后|紧接着|隔天)|(?:之后|以后|过后|往后|紧接着|隔天).{0,8}(?:那|这|第)?(?:[一二三四五六七1-7])?天|(?:之后|以后|过后|往后)(?:的)?(?:第?[一二三四五六七1-7]?天|第二天|第2天)|隔天|(?:那天|那次|那段路|那件.{0,8}(?:之后|以后|过后)|(?:这|那)条.{0,12}记录)|^(?:所以|那么|那我|那你|这次).{0,32}(?:对吧|吗|纠正|记录|活动|不是|没|没有)/.test(value);
}

function relativeFollowupOffset(text: string): number {
  const value = normalize(text);
  if (!/(?:之后|以后|过后|往后|紧接着|隔天|第二天|第2天|下一天)/.test(value)) return 0;
  if (/(?:那件事|那条记录|这件事|这条记录)(?:之后|以后|过后)/.test(value)) return 0;
  if (/(?:之后|以后|过后|往后)(?:的)?(?:第二天|第2天)/.test(value)) return 2;
  if (/第二天|第2天/.test(value)) return 1;
  const amount = value.match(/([一二两三四五六七1-7])天(?:之后|以后|后)/)
    ?? value.match(/(?:之后|以后|过后|往后|紧接着|再过)([一二两三四五六七1-7])天/);
  if (!amount) return 1;
  return Number(amount[1]) || CN_DAY[amount[1]] || 1;
}

function matchesActivity(event: VirtualTownEventEvidence, text: string): boolean {
  const value = normalize(text);
  if (/(?:散步|走路|河边|沿河)/.test(value)) return event.eventType === 'walk';
  if (/(?:书店|读书|看书)/.test(value)) return event.eventType === 'reading';
  if (/(?:花圃|浇花|种花)/.test(value)) return event.eventType === 'gardening';
  if (/(?:广场|坐了|休息)/.test(value)) return event.eventType === 'rest';
  return true;
}

/**
 * Resolve one evidence row for the current query. Relative dates are interpreted
 * against an explicit virtual day (default day 7); no cue means latest event.
 */
export function getVirtualTownReplayEvent(
  enabled: boolean,
  query?: string | null,
  recentUserMessages: string[] = [],
  currentDay = 7,
): VirtualTownEventEvidence | null {
  if (!enabled) return null;
  const queryText = String(query ?? '');
  const normalizedQuery = normalize(queryText);
  const previousTexts = recentUserMessages.slice(-4);
  if (hasConflictingVirtualTownDates(queryText, currentDay)) return null;
  const targetDay = parseTargetDay(queryText, currentDay);
  if (targetDay === null && isAmbiguousDatePhrase(queryText)) return null;
  const previousTargetDay = [...previousTexts].reverse()
    .filter(text => /(?:小镇|虚拟镇|镇上|镇里)/.test(normalize(text)))
    .map(text => parseTargetDay(text, currentDay))
    .find((day): day is number => day !== null);
  const moodCauseFollowup = targetDay === null && asksAboutVirtualTownMoodCause(queryText, previousTexts);
  if (targetDay === null && isDateFollowup(queryText) && previousTargetDay === undefined) return null;
  const followupDay = targetDay === null && (isDateFollowup(queryText) || moodCauseFollowup) && previousTargetDay !== undefined
    ? previousTargetDay + (moodCauseFollowup ? 0 : relativeFollowupOffset(queryText))
    : null;
  // Preserve the original one-event helper behavior for tests/callers that omit a query.
  const day = targetDay ?? followupDay ?? (normalizedQuery ? currentDay : 1);
  if (day < 1 || day > 7) return null;
  // Activity filters must come from this turn; older turns provide date context only.
  const candidates = SEVEN_DAY_EVENT_LOG.filter(event => event.virtualDay === day && matchesActivity(event, queryText));
  const selected = candidates.at(-1);
  const selectedDay = selected?.virtualDay;
  const independentMoodObservation = selectedDay == null
    ? undefined
    : VIRTUAL_TOWN_MOOD_OBSERVATIONS.find(observation => observation.virtualDay >= selectedDay);
  return selected
    ? {
        ...selected,
        daysAgo: selectedDay == null ? undefined : Math.max(0, currentDay - selectedDay),
        independentMoodObservation,
      }
    : null;
}

export function getVirtualTownReplayLog(enabled: boolean): VirtualTownEventEvidence[] {
  return enabled ? SEVEN_DAY_EVENT_LOG.map(event => ({ ...event })) : [];
}

function hasTownAnchor(texts: string[]): boolean {
  return texts.some(text => /(?:小镇|虚拟镇|镇上|镇里)/.test(normalize(text)));
}

/** Detect direct references and short user follow-ups inside a recent town thread. */
export function asksAboutVirtualTownActivity(
  text: string | null | undefined,
  recentUserMessages: string[] = [],
): boolean {
  const value = normalize(text);
  if (!value || /现实|线下|真实生活|现实里|现实中/.test(value)) return false;
  if (/(?:先不说|先不聊|暂时不说|暂时不聊|换个话题).{0,12}(?:小镇|虚拟镇|镇上|镇里)/u.test(value)) return false;
  const topicSwitch = /(?:先换个话题|换个话题)/u.exec(value);
  if (topicSwitch) {
    const nextClause = value.slice(topicSwitch.index + topicSwitch[0].length).split(/[，。！？?]/u, 1)[0];
    if (!/(?:小镇|虚拟镇|镇上|镇里)/u.test(nextClause)) return false;
  }
  // Questions about whether user supplied text counts as fact are meta questions,
  // not requests to retrieve the activity discussed in surrounding turns.
  if (/(?:会不会|会把|是不是会|是否会).{0,32}(?:把我(?:转述|说的|讲的|提到的)|我(?:转述|说的|讲的)|这句话|用户说的|转述的内容).{0,16}(?:当成事实|当真|记下来|记成)|(?:把我说的当成事实|我刚才故意说错)|(?:转述|听来的|听说).{0,20}(?:会不会|是否会|就会|变成|算作|算成).{0,16}(?:自己的|亲历|经历|记录|事实)|(?:反复|多次).{0,12}(?:转述|听来).{0,16}(?:变成|算作|算成)/u.test(value)) return false;
  // A user may change topic to their own hobby while the prior turns mentioned the town.
  // Do not let a generic "what to do" phrase inherit town provenance from old context.
  if (/^我.{0,40}(?:在找|寻找|没决定|还没决定|想找|考虑).{0,24}(?:爱好|做什么|活动)/u.test(value)) return false;
  const activityCue = /(?:做(?:了)?什么|干(?:了)?什么|在干嘛|在做什么|活动|散步|走了|路|去哪|去哪里|地点|在哪里|什么地方|看了什么|喝咖啡|咖啡馆|书店|花圃|浇花|种花|倒了|记下|记住|记得|记录|刚才|刚刚|那件|那天|发生|几天前|天前|第[一二三四五六七1-7](?:天|日))/.test(value);
  const shortDateFollowup = /^(?:那|这)?(?:前一天|昨天|前天|今天)(?:呢|怎么样|是什么)?[？?。.!！]?$/u.test(value);
  return (activityCue || shortDateFollowup) && (/(?:小镇|虚拟镇|镇上|镇里)/.test(value)
    || hasTownAnchor(recentUserMessages.slice(-4)));
}

export function asksAboutVirtualTownMoodCause(
  text: string | null | undefined,
  recentUserMessages: string[] = [],
): boolean {
  const value = normalize(text);
  if (!value || /现实|线下|真实生活|现实里|现实中/.test(value)) return false;
  const moodCauseCue = /(?:为什么|怎么会|怎么就|因为|变好|好起来|轻松|开心|安稳|安心|安定|平和|平静|踏实|舒缓|放松|松弛|烦躁|紧张|难过|低落|焦虑|舒服|心情|心里|情绪|情感|感觉|原因)/.test(value);
  return moodCauseCue && (/(?:小镇|虚拟镇|镇上|镇里)/.test(value)
    || hasTownAnchor(recentUserMessages.slice(-4)));
}
