import { bounded, isUnit } from './dynamics.ts';
import { round6 } from './determinism.ts';
import { invalid } from './errors.ts';
import { isIdentifier } from './sessionAuth.ts';

export type PerceivedIntent = 'benevolent' | 'neutral' | 'hostile' | 'unknown';
export type CausalAgency = Readonly<{ self: number; user: number; environment: number }>;
export type AppraisalHypothesis = Readonly<{
  hypothesisId: string;
  interpretation: PerceivedIntent;
  evidenceFor: readonly string[];
  evidenceAgainst: readonly string[];
  confidence: number;
}>;
export type AppraisalInput = Readonly<{
  appraisalId: string;
  eventId: string;
  goalCongruence: number;
  causalAgency: CausalAgency;
  perceivedIntent: PerceivedIntent;
  fairness: number;
  controllability: number;
  confidence: number;
  evidence: readonly string[];
  intentEvidence: readonly string[];
  flags?: readonly ('multiple_explanations' | 'material_impact' | 'relationship_risk' | 'memory_conflict')[];
  alternatives?: readonly AppraisalHypothesis[];
}>;
export type AppraisalResult = AppraisalInput & Readonly<{
  uncertainty: number;
  counterfactualTriggered: boolean;
  competingConfidence: number;
}>;

const intents: readonly PerceivedIntent[] = ['benevolent', 'neutral', 'hostile', 'unknown'];
const allowedFlags = ['multiple_explanations', 'material_impact', 'relationship_risk', 'memory_conflict'];

export function assess(input: AppraisalInput): AppraisalResult {
  if (!input || !isIdentifier(input.appraisalId) || !isIdentifier(input.eventId)
    || !Number.isFinite(input.goalCongruence) || Math.abs(input.goalCongruence) > 1
    || ![input.fairness, input.controllability, input.confidence,
      input.causalAgency?.self, input.causalAgency?.user, input.causalAgency?.environment].every(isUnit)
    || Math.abs(input.causalAgency.self + input.causalAgency.user + input.causalAgency.environment - 1) > 0.000001
    || !intents.includes(input.perceivedIntent) || !Array.isArray(input.evidence) || !Array.isArray(input.intentEvidence)
    || input.evidence.length > 64 || !input.evidence.every(isIdentifier) || new Set(input.evidence).size !== input.evidence.length
    || (input.flags && (!Array.isArray(input.flags) || !input.flags.every((flag) => allowedFlags.includes(flag))))
    || (input.alternatives && (!Array.isArray(input.alternatives) || input.alternatives.length > 5))) {
    throw invalid('Appraisal factors or evidence are invalid');
  }
  const evidence = new Set(input.evidence);
  if (!input.intentEvidence.every((id) => evidence.has(id))) throw invalid('Intent evidence must belong to the appraisal');
  const perceivedIntent = input.intentEvidence.length ? input.perceivedIntent : 'unknown';
  const triggered = perceivedIntent === 'unknown' || Math.abs(input.goalCongruence) >= 0.75 || Boolean(input.flags?.length);
  const hypotheses = input.alternatives ?? [];
  const ids = new Set<string>();
  for (const alternative of hypotheses) {
    if (!alternative || !isIdentifier(alternative.hypothesisId) || ids.has(alternative.hypothesisId)
      || !intents.includes(alternative.interpretation) || !isUnit(alternative.confidence)
      || !Array.isArray(alternative.evidenceFor) || alternative.evidenceFor.length === 0 || !Array.isArray(alternative.evidenceAgainst)
      || [...alternative.evidenceFor, ...alternative.evidenceAgainst].some((id) => !evidence.has(id))
      || alternative.evidenceFor.some((id: string) => alternative.evidenceAgainst.includes(id))) {
      throw invalid('Counterfactual hypotheses require distinct, traceable evidence');
    }
    ids.add(alternative.hypothesisId);
  }
  const alternatives = triggered ? hypotheses.map((alternative) => ({
    hypothesisId: alternative.hypothesisId, interpretation: alternative.interpretation,
    confidence: round6(alternative.confidence), evidenceFor: [...alternative.evidenceFor], evidenceAgainst: [...alternative.evidenceAgainst],
  })) : [];
  const competingConfidence = alternatives.reduce((max, alternative) => alternative.interpretation !== perceivedIntent
    ? Math.max(max, alternative.confidence / (1 + 0.25 * alternative.evidenceAgainst.length)) : max, 0);
  const strongDisagreement = perceivedIntent !== 'unknown' && competingConfidence >= input.confidence;
  const intent = strongDisagreement ? 'unknown' : perceivedIntent;
  const reliability = input.evidence.length ? input.confidence * (1 - 0.5 * competingConfidence) : 0;
  const confidence = bounded(intent === 'unknown' ? Math.min(reliability, 0.5) : reliability);
  return {
    appraisalId: input.appraisalId, eventId: input.eventId, goalCongruence: round6(input.goalCongruence),
    causalAgency: { self: round6(input.causalAgency.self), user: round6(input.causalAgency.user), environment: round6(input.causalAgency.environment) },
    perceivedIntent: intent, fairness: round6(input.fairness), controllability: round6(input.controllability),
    confidence, uncertainty: bounded(1 - confidence), evidence: [...input.evidence], intentEvidence: [...input.intentEvidence],
    flags: [...(input.flags ?? [])], alternatives, competingConfidence: round6(competingConfidence), counterfactualTriggered: triggered,
  };
}

export function appraisalInput(input: AppraisalInput): AppraisalInput {
  assess(input);
  const { appraisalId, eventId, goalCongruence, causalAgency, perceivedIntent, fairness,
    controllability, confidence, intentEvidence, evidence, flags, alternatives } = input;
  return {
    appraisalId, eventId, goalCongruence, perceivedIntent, fairness, controllability, confidence,
    causalAgency: { self: causalAgency.self, user: causalAgency.user, environment: causalAgency.environment },
    evidence: [...evidence], intentEvidence: [...intentEvidence],
    ...(flags && { flags: [...flags] }),
    ...(alternatives && { alternatives: alternatives.map((item) => ({
      hypothesisId: item.hypothesisId, interpretation: item.interpretation, confidence: item.confidence,
      evidenceFor: [...item.evidenceFor], evidenceAgainst: [...item.evidenceAgainst],
    })) }),
  };
}
