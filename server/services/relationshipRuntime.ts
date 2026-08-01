import crypto from 'node:crypto';
import type { UserEmotionAnalysis } from '../../src/lib/emotionEngine.js';
import { analyzeRelationalSpeech } from '../../src/lib/relationalSpeechAnalyzer.js';
import {
  applyRelationshipEventV2,
  createRelationshipStateV2,
  getRelationshipProgressReportV2,
} from '../../src/lib/relationshipProgressionV2.js';
import type {
  RelationshipEventCategory,
  RelationshipEvidenceEvent,
  RelationshipStageV2,
  RelationshipStateV2,
} from '../../src/lib/relationshipProgressionV2.js';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const ROMANTIC_STAGES = new Set<RelationshipStageV2>(['friend', 'crush', 'lover', 'partner']);
const ROMANTIC_EVENTS = new Set<RelationshipEventCategory>([
  'special_attention',
  'playful_flirt',
  'relationship_probe',
  'indirect_affection',
  'explicit_affection',
  'relationship_proposal',
  'romantic_expression',
  'affectionate_response',
  'relationship_discussion',
  'explicit_confession',
  'explicit_acceptance',
  'mutual_confirmation',
  'future_plan',
]);

export interface SuccessfulRelationshipTurn {
  userText: string;
  aiText: string;
  userAnalysis: UserEmotionAnalysis;
  strategy: string;
  now?: number;
}

export interface RelationshipTurnResult {
  state: RelationshipStateV2;
  events: RelationshipEvidenceEvent[];
  report: ReturnType<typeof getRelationshipProgressReportV2>;
  score: number;
}

export interface RelationshipResponsePolicy {
  allowProactiveMemory: boolean;
  allowPatternInjection: boolean;
  personalMemoryCap: number;
  prompt: string;
}

const INTIMATE_MEMORY_PATTERN = /(抱着|搂着|亲亲|亲吻|一起睡|陪睡|爱你|想你|恋人|情侣|宝贝|老公|老婆|hug|kiss|sleep together|love you)/i;

export function getRelationshipResponsePolicy(state: RelationshipStateV2): RelationshipResponsePolicy {
  const prefix = `【关系阶段约束】当前关系阶段是 ${state.stage}。关系阶段只由服务端证据状态决定。`;
  switch (state.stage) {
    case 'stranger':
      return {
        allowProactiveMemory: false,
        allowPatternInjection: false,
        personalMemoryCap: 0,
        prompt: `${prefix}\n以刚认识的人的方式友好、自然地回应。不要使用亲昵称呼，不要主动表达想念、爱意、占有欲、拥抱、亲吻或一起睡等身体亲密内容。不要声称“你之前说过”或主动提起私人历史，即使其他提示中出现旧记忆。`,
      };
    case 'acquaintance':
      return {
        allowProactiveMemory: false,
        allowPatternInjection: false,
        personalMemoryCap: 0,
        prompt: `${prefix}\n可以表现熟悉和关心，但不要使用恋人式称呼、身体亲密暗示或承诺。不要主动提起私人旧记忆，也不要把过去的亲密表达当成当前关系事实。`,
      };
    case 'friend':
      return {
        allowProactiveMemory: false,
        allowPatternInjection: true,
        personalMemoryCap: 2,
        prompt: `${prefix}\n以朋友边界回应。可以支持、关心和引用与当前话题直接相关的非亲密事实；不要主动使用恋人式语言或引用拥抱、亲吻、一起睡等旧亲密记忆。`,
      };
    case 'crush':
      return {
        allowProactiveMemory: true,
        allowPatternInjection: true,
        personalMemoryCap: 3,
        prompt: `${prefix}\n可以有轻微、可撤回的暧昧表达，但不要假定双方已经是恋人，不要作出排他承诺。引用记忆时必须与当前话题直接相关且忠于原始内容。`,
      };
    case 'lover':
    case 'partner':
      return {
        allowProactiveMemory: true,
        allowPatternInjection: true,
        personalMemoryCap: 4,
        prompt: `${prefix}\n可以表达与当前阶段一致的亲密感。引用记忆时必须与当前话题直接相关，不能虚构、改写或夸大用户说过的话。`,
      };
  }
}

function meaningfulTokens(text: string): string[] {
  const chinese = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chinesePairs = chinese.flatMap(segment =>
    Array.from({ length: Math.max(0, segment.length - 1) }, (_, index) => segment.slice(index, index + 2))
  );
  const words = text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set([...chinesePairs, ...words])];
}

export function filterRelationshipMemoryItems<T extends { source: string; content: string }>(
  items: T[],
  state: RelationshipStateV2,
  userText: string,
): T[] {
  const policy = getRelationshipResponsePolicy(state);
  const tokens = meaningfulTokens(userText);
  let personalCount = 0;

  return items.filter(item => {
    if (item.source !== 'episodic' && item.source !== 'semantic') return policy.allowPatternInjection;
    if (policy.personalMemoryCap === 0 || personalCount >= policy.personalMemoryCap) return false;
    if ((state.stage === 'friend' || state.stage === 'acquaintance' || state.stage === 'stranger')
      && INTIMATE_MEMORY_PATTERN.test(item.content)) return false;
    if (tokens.length === 0 || !tokens.some(token => item.content.toLowerCase().includes(token))) return false;
    personalCount++;
    return true;
  });
}

function resolveSessionId(state: RelationshipStateV2, now: number): string {
  const last = state.evidence.at(-1);
  if (last && now - last.timestamp < SESSION_IDLE_MS) return last.sessionId;
  return `session_${now}`;
}

function makeEvent(
  category: RelationshipEventCategory,
  actor: RelationshipEvidenceEvent['actor'],
  strength: number,
  sessionId: string,
  timestamp: number,
  accepted?: boolean,
  note?: string,
): RelationshipEvidenceEvent {
  return {
    id: `rel_${crypto.randomUUID()}`,
    category,
    actor,
    strength,
    sessionId,
    timestamp,
    accepted,
    note,
  };
}

function isMeaningfulSelfDisclosure(text: string, analysis: UserEmotionAnalysis): boolean {
  if (analysis.directedAtAI || analysis.intensity < 0.35) return false;
  return /(^|[，。！？,.!\s])(我|我的|自己|最近|今天|昨天)/.test(text)
    || analysis.likelyCause !== '日常交流';
}

function normalizeUserRomanticCategory(category: RelationshipEventCategory): RelationshipEventCategory {
  if (category === 'explicit_affection') return 'explicit_confession';
  return category;
}

function aiRomanticEvent(
  aiText: string,
  userCategory: RelationshipEventCategory | null,
): { category: RelationshipEventCategory; strength: number } | null {
  if (!userCategory || !ROMANTIC_EVENTS.has(userCategory)) return null;

  if (/(我也喜欢你|我也爱你|愿意和你在一起|愿意做你的|我们在一起)/.test(aiText)) {
    return { category: 'explicit_acceptance', strength: 0.72 };
  }

  const analysis = analyzeRelationalSpeech(aiText);
  if (!analysis.suggestedEventCategory || analysis.confidence < 0.45) return null;
  if (!ROMANTIC_EVENTS.has(analysis.suggestedEventCategory)) return null;
  return {
    category: analysis.suggestedEventCategory === 'explicit_affection'
      ? 'affectionate_response'
      : analysis.suggestedEventCategory,
    strength: Math.min(0.65, analysis.evidenceStrength),
  };
}

export function relationshipScoreV2(state: RelationshipStateV2): number {
  const base: Record<RelationshipStageV2, number> = {
    stranger: 20,
    acquaintance: 35,
    friend: 55,
    crush: 65,
    lover: 78,
    partner: 92,
  };
  return base[state.stage];
}

export function processSuccessfulRelationshipTurn(
  current: RelationshipStateV2 | null | undefined,
  turn: SuccessfulRelationshipTurn,
): RelationshipTurnResult {
  const now = turn.now ?? Date.now();
  let state = current ? structuredClone(current) : createRelationshipStateV2(now);
  const sessionId = resolveSessionId(state, now);
  const previousSessionId = state.evidence.at(-1)?.sessionId;
  const startsNewSession = Boolean(previousSessionId && previousSessionId !== sessionId);
  const events: RelationshipEvidenceEvent[] = [];
  const add = (
    category: RelationshipEventCategory,
    actor: RelationshipEvidenceEvent['actor'],
    strength: number,
    accepted?: boolean,
    note?: string,
  ) => events.push(makeEvent(category, actor, strength, sessionId, now + events.length, accepted, note));

  add('conversation', 'user', 0.55);
  if (startsNewSession) add('proactive_contact', 'user', 0.5);

  if (isMeaningfulSelfDisclosure(turn.userText, turn.userAnalysis)) {
    add('self_disclosure', 'user', Math.min(0.8, turn.userAnalysis.intensity), undefined, turn.userAnalysis.likelyCause);
  }

  const userSpeech = analyzeRelationalSpeech(turn.userText, { currentStage: state.stage });
  let userRomanticCategory: RelationshipEventCategory | null = null;
  if (userSpeech.suggestedEventCategory && userSpeech.confidence >= 0.35) {
    userRomanticCategory = normalizeUserRomanticCategory(userSpeech.suggestedEventCategory);
    add(userRomanticCategory, 'user', userSpeech.evidenceStrength, false, userSpeech.latentIntent);
  }

  add('conversation', 'ai', 0.55);
  if (['empathize', 'accompany', 'repair'].includes(turn.strategy) && isMeaningfulSelfDisclosure(turn.userText, turn.userAnalysis)) {
    add('reliable_support', 'ai', 0.65);
  }
  if (state.stage !== 'stranger'
    && /(你之前|你上次|我记得你|还记得|you mentioned|I remember)/i.test(turn.aiText)) {
    add('remembered_detail', 'ai', 0.6);
  }
  if (/(一起|陪我|我们来|帮我).{0,20}/.test(turn.userText)
    && /(好|可以|一起|陪你|没问题|当然)/.test(turn.aiText)) {
    add('shared_activity', 'mutual', 0.6, true);
  }

  // AI romantic wording is evidence only after friendship and only as a response
  // to a compatible user signal. This prevents the model from advancing itself.
  if (ROMANTIC_STAGES.has(state.stage) && state.boundaryStatus === 'open') {
    const aiEvent = aiRomanticEvent(turn.aiText, userRomanticCategory);
    if (aiEvent) add(aiEvent.category, 'ai', aiEvent.strength, true);
  }

  for (const event of events) state = applyRelationshipEventV2(state, event);
  const report = getRelationshipProgressReportV2(state);
  return { state, events, report, score: relationshipScoreV2(state) };
}
