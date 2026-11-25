export interface UserAffectGroundingResult {
  text: string;
  changed: boolean;
  changes: string[];
}

export interface UserAffectContext {
  expressedEmotion?: string | null;
  bodyState?: { fatigue: 'none' | 'mild' | 'moderate' | 'strong' } | null;
}

const RELIEF_CLAIM = /(?:心里.{0,10}(?:松下|松了口气|松快|落地|轻松|放松|舒服)|(?:松了口气|松下来了|石头落地|终于轻松))/u;
const RELIEF_EVIDENCE = /(?:我.{0,10}(?:松了口气|轻松|放松|解脱)|心里.{0,8}(?:轻松|松快|放下|放松)|压力小了|不用担心了)/u;

/**
 * Remove claims that the user's work or situation made them feel relieved unless
 * the user stated that feeling. A positive emotion such as "开心" is not evidence
 * that the user feels relaxed.
 */
export function groundUserAffectClaims(
  text: string,
  userText: string,
  context: UserAffectContext = {},
): UserAffectGroundingResult {
  const source = String(text ?? '');
  if (!source) {
    return { text: source, changed: false, changes: [] };
  }

  const hasReliefEvidence = RELIEF_EVIDENCE.test(String(userText ?? ''));
  let removed = 0;
  const grounded = hasReliefEvidence ? source : source.split(/(?<=[。！？!?；;\n])/u).map(sentence => {
    const parts = sentence.split(/(?<=[，,])/u);
    const kept = parts.filter(part => {
      if (!RELIEF_CLAIM.test(part)) return true;
      removed += 1;
      return false;
    });
    if (kept.length === parts.length) return sentence;
    const joined = kept.join('');
    if (/[，,；;]\s*$/u.test(joined)) {
      const punctuation = sentence.match(/[。！？!?]$/u)?.[0] ?? '。';
      return joined.replace(/[，,；;]+\s*$/u, punctuation);
    }
    return joined;
  }).join('');

  let result = grounded.replace(/\n{3,}/g, '\n\n').trim();
  const changes: string[] = removed > 0 ? ['unsupported_user_relief_claim_removed:' + removed] : [];
  if (context.expressedEmotion === 'joy' && context.bodyState?.fatigue && context.bodyState.fatigue !== 'none') {
    const missingJoyAcknowledgement = !/(?:开心|高兴|快乐|兴奋)/u.test(result);
    const missingFatigueAcknowledgement = !/(?:累|疲惫|休息|歇|缓一缓|靠一会)/u.test(result);
    const additions = [
      ...(missingJoyAcknowledgement ? ['听起来你挺开心的。'] : []),
      ...(missingFatigueAcknowledgement ? ['身体也累了，先歇一会儿吧。'] : []),
    ];
    if (additions.length > 0) {
      result = [result, additions.join('')].filter(Boolean).join('\n\n');
      changes.push('mixed_user_state_acknowledgement_appended');
    }
  }
  return {
    text: result,
    changed: result !== source,
    changes,
  };
}
