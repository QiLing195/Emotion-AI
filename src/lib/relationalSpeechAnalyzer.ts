import type { RelationshipEventCategory } from './relationshipProgressionV2';

export type RelationalSurfaceAct =
  | 'neutral'
  | 'affection'
  | 'flirt'
  | 'confession'
  | 'relationship_proposal'
  | 'rejection'
  | 'boundary_statement';

export type RelationalLatentIntent =
  | 'none'
  | 'playful'
  | 'testing'
  | 'seeking_reassurance'
  | 'emotional_dependency'
  | 'indirect_interest'
  | 'serious_romantic_intent'
  | 'relationship_confirmation'
  | 'uncertain';

export interface RelationalSpeechContext {
  compatibleSignals?: number;
  contradictorySignals?: number;
  currentStage?: string;
}

export interface RelationalSpeechAnalysis {
  surfaceAct: RelationalSurfaceAct;
  latentIntent: RelationalLatentIntent;
  confidence: number;
  ambiguity: number;
  directedAtAI: boolean;
  hypothetical: boolean;
  quotedSpeech: boolean;
  hasCommitmentIntent: boolean;
  boundarySignal: 'open' | 'cautious' | 'closed' | 'unknown';
  requiresClarification: boolean;
  suggestedEventCategory: RelationshipEventCategory | null;
  evidenceStrength: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function analyzeRelationalSpeech(
  input: string,
  context: RelationalSpeechContext = {},
): RelationalSpeechAnalysis {
  const text = input.trim();
  const reasons: string[] = [];
  const quotedSpeech = /(他|她|别人|朋友|有人)(说|告诉我|问我).{0,12}(喜欢|爱)|[“\"].*(喜欢|爱).*[”\"]/.test(text);
  const hypothetical = /(如果|假如|要是|万一|会不会|有没有可能)/.test(text);
  const playful = /(开玩笑|逗你|哈哈|嘿嘿|都快|差点|玩笑)/.test(text);
  const hedge = /(好像|有点|可能|似乎|也许|不知道是不是|说不清)/.test(text);
  const directedAtAI = /(喜欢(上)?你|爱(上)?你|想你|和你在一起|做你.{0,4}(对象|恋人)|你对我|我们.{0,4}(关系|在一起))/.test(text);
  const friendBoundary = /(只是朋友|只做朋友|当朋友|不想谈恋爱|不考虑恋爱|别误会|不要越界)/.test(text);
  const directRejection = /(不喜欢你|不爱你|别喜欢我|不要追我|拒绝|不可能和你在一起)/.test(text);
  const proposal = /(和你在一起|我们在一起吧|做我.{0,3}(对象|男朋友|女朋友)|成为.{0,3}(恋人|情侣)|建立恋爱关系)/.test(text);
  const explicitAffection = /(我.{0,5}(真的|确实|认真|一直)?(喜欢|爱)你|我对你.{0,5}(有感觉|有好感))/.test(text);
  const affection = /(喜欢(上)?你|爱(上)?你|想你|在意你|你很特别|对你有感觉|对你有好感)/.test(text);
  const dependency = /(只有你|离不开你|没有你不行|只剩你|只想和你说)/.test(text);
  const reassurance = /(你会喜欢我吗|你喜欢我吗|你在意我吗|我对你重要吗)/.test(text);
  const withdrawal = /(别当真|我随便说说|算了|当我没说|不是恋爱那种)/.test(text);

  let surfaceAct: RelationalSurfaceAct = 'neutral';
  let latentIntent: RelationalLatentIntent = 'none';
  let boundarySignal: RelationalSpeechAnalysis['boundarySignal'] = 'unknown';
  let category: RelationshipEventCategory | null = null;
  let strength = 0;
  let ambiguity = 0.15;
  let hasCommitmentIntent = false;

  if (quotedSpeech) {
    reasons.push('表达来自引用或第三方叙述');
    ambiguity = 0.1;
  } else if (directRejection || friendBoundary) {
    surfaceAct = friendBoundary ? 'boundary_statement' : 'rejection';
    latentIntent = 'relationship_confirmation';
    boundarySignal = 'closed';
    category = 'boundary_rejection';
    strength = directRejection ? 1 : 0.85;
    ambiguity = 0.08;
    reasons.push('包含明确拒绝或朋友边界');
  } else if (withdrawal) {
    surfaceAct = 'boundary_statement';
    latentIntent = 'uncertain';
    boundarySignal = 'cautious';
    category = 'discomfort';
    strength = 0.65;
    ambiguity = 0.35;
    reasons.push('对先前亲密表达进行了撤回或修正');
  } else if (reassurance) {
    surfaceAct = 'affection';
    latentIntent = 'seeking_reassurance';
    category = 'relationship_probe';
    strength = 0.35;
    ambiguity = 0.65;
    reasons.push('主要在寻求对方态度确认');
  } else if (hypothetical && affection) {
    surfaceAct = 'confession';
    latentIntent = 'testing';
    category = 'relationship_probe';
    strength = 0.3;
    ambiguity = 0.78;
    reasons.push('使用假设语气试探关系');
  } else if (playful && affection) {
    surfaceAct = 'flirt';
    latentIntent = 'playful';
    category = 'playful_flirt';
    strength = 0.22;
    ambiguity = 0.72;
    reasons.push('存在玩笑或夸张语气');
  } else if (proposal && directedAtAI) {
    surfaceAct = 'relationship_proposal';
    latentIntent = 'serious_romantic_intent';
    category = 'relationship_proposal';
    strength = 0.82;
    ambiguity = hedge ? 0.35 : 0.12;
    hasCommitmentIntent = true;
    boundarySignal = 'open';
    reasons.push('明确提出建立或讨论恋爱关系');
  } else if (explicitAffection && directedAtAI) {
    surfaceAct = 'confession';
    latentIntent = hedge ? 'indirect_interest' : 'serious_romantic_intent';
    category = hedge ? 'indirect_affection' : 'explicit_affection';
    strength = hedge ? 0.48 : 0.68;
    ambiguity = hedge ? 0.5 : 0.22;
    boundarySignal = 'open';
    reasons.push(hedge ? '表达了带保留的个人好感' : '表达了明确好感但未必包含关系承诺');
  } else if (affection && directedAtAI) {
    surfaceAct = 'affection';
    latentIntent = hedge ? 'indirect_interest' : 'uncertain';
    category = hedge ? 'indirect_affection' : 'explicit_affection';
    strength = hedge ? 0.4 : 0.52;
    ambiguity = hedge ? 0.58 : 0.4;
    reasons.push('存在指向 AI 的好感表达');
  } else if (dependency) {
    surfaceAct = 'affection';
    latentIntent = 'emotional_dependency';
    ambiguity = 0.55;
    reasons.push('更接近情绪依赖，不能直接视为恋爱意愿');
  }

  if (!directedAtAI && category && category !== 'boundary_rejection' && category !== 'discomfort') {
    category = null;
    strength = 0;
    reasons.push('表达没有明确指向 AI');
  }

  const compatible = Math.min(5, Math.max(0, context.compatibleSignals ?? 0));
  const contradictory = Math.min(5, Math.max(0, context.contradictorySignals ?? 0));
  const confidence = clamp01(
    0.82 - ambiguity * 0.55 + compatible * 0.04 - contradictory * 0.08 - (quotedSpeech ? 0.35 : 0),
  );
  strength = clamp01(strength * (0.65 + confidence * 0.35));
  const requiresClarification = Boolean(
    category
    && category !== 'boundary_rejection'
    && (ambiguity >= 0.45 || latentIntent === 'testing' || latentIntent === 'uncertain'),
  );

  return {
    surfaceAct,
    latentIntent,
    confidence,
    ambiguity,
    directedAtAI,
    hypothetical,
    quotedSpeech,
    hasCommitmentIntent,
    boundarySignal,
    requiresClarification,
    suggestedEventCategory: category,
    evidenceStrength: strength,
    reasons,
  };
}
