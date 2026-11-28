import type { DaoEnv, DaoResponseData } from '../contracts/dao-v31/index.ts';
import { assess } from './appraisal.ts';
import type { AppraisalInput, AppraisalResult } from './appraisal.ts';
import { advanceYi, bounded, HOUR, initialYi, isUnit, zeroInput } from './dynamics.ts';
import type { YiState } from './dynamics.ts';
import { round6 } from './determinism.ts';
import { conflict, invalid } from './errors.ts';
import { initialClock, settleTime, validateClock } from './simulationClock.ts';
import type { ClockCommand, ClockState } from './simulationClock.ts';
import { isIdentifier } from './sessionAuth.ts';

export type EmotionProvenance = NonNullable<DaoResponseData<'getStateSnapshot'>['emotionProvenance']>;
type Layer = EmotionProvenance['layers'][number]['layer'];
export type LayerState = Readonly<Record<string, number>>;
export type EmotionRuntimeState = Readonly<{
  version: number; yi: YiState; clock: ClockState;
  basic: LayerState; cognitive: LayerState; relationship: LayerState;
  valence: number; arousal: number; provenance: EmotionProvenance | null;
}>;
export type EmotionCommand =
  | Readonly<{ kind: 'emotion'; eventId: string; appraisal: AppraisalInput; relationshipSignal: number; rules: '1.0.0' }>
  | Readonly<{ kind: 'settle'; eventId: string; env: DaoEnv; clock: ClockCommand; rules: '1.0.0' }>;

export const emotionRules = '1.0.0';
const emptyBasic = { Joy: 0, Anger: 0, Sadness: 0, Fear: 0, Disgust: 0 };
const emptyCognitive = { Shame: 0, Guilt: 0, Confusion: 0, Despair: 0 };
const emptyRelationship = { Attachment: 0, AffinityEstimate: 0, RelationshipConfidence: 0, Longing: 0 };
export const initialEmotion: EmotionRuntimeState = Object.freeze({
  version: 0, yi: initialYi, clock: initialClock,
  basic: Object.freeze(emptyBasic), cognitive: Object.freeze(emptyCognitive), relationship: Object.freeze(emptyRelationship),
  valence: 0, arousal: 0, provenance: null,
});

function layer(previous: LayerState, next: LayerState, id: Layer): EmotionProvenance['layers'][number] {
  return {
    layer: id, ruleId: 'emotion-v1-' + id,
    changes: Object.fromEntries(Object.entries(next).map(([key, value]) => [key, round6(value - previous[key])])),
  };
}

function evolve(previous: LayerState, target: LayerState, rate: number): LayerState {
  return Object.fromEntries(Object.entries(previous).map(([key, value]) =>
    [key, bounded(value + (target[key] - value) * rate)]));
}

function appraisalLayers(previous: EmotionRuntimeState, result: AppraisalResult, relevance: number) {
  const negative = Math.max(0, -result.goalCongruence);
  const positive = Math.max(0, result.goalCongruence);
  const { confidence, uncertainty, fairness, controllability, causalAgency, perceivedIntent } = result;
  const hostility = perceivedIntent === 'hostile' ? confidence : 0;
  const basic = evolve(previous.basic, {
    Joy: positive * confidence,
    Anger: negative * (1 - fairness) * causalAgency.user * hostility,
    Sadness: negative * confidence,
    Fear: negative * confidence * (1 - controllability),
    Disgust: negative * (1 - fairness) * hostility * 0.5,
  }, 0.25);
  const cognitive = evolve(previous.cognitive, {
    Shame: basic.Sadness * causalAgency.self * (1 - controllability) * confidence,
    Guilt: negative * causalAgency.self * controllability * confidence,
    Confusion: uncertainty * (positive + negative),
    Despair: basic.Fear * (1 - controllability) * confidence,
  }, 0.15);
  const relationship = evolve(previous.relationship, {
    Attachment: relevance * positive * confidence,
    AffinityEstimate: relevance * (0.5 + result.goalCongruence * confidence * 0.5),
    RelationshipConfidence: relevance * (1 - cognitive.Confusion) * confidence,
    Longing: relevance * negative * (1 - hostility) * confidence,
  }, 0.025);
  // One explicit modulation pass reads the just-computed L1, L2 and L3 values.
  const modulated = {
    ...basic,
    Sadness: bounded(basic.Sadness + cognitive.Guilt * 0.05 * (1 - relationship.RelationshipConfidence)),
    Fear: bounded(basic.Fear * (1 - relationship.RelationshipConfidence * 0.1)),
  };
  return { basic, cognitive, relationship, modulated };
}

export function validateEmotionCommand(change: EmotionCommand) {
  if (!isIdentifier(change.eventId) || change.rules !== emotionRules) throw invalid('Invalid emotion projection rule version or event ID');
  if (change.kind === 'emotion') {
    if (!isUnit(change.relationshipSignal)) throw invalid('Invalid relationship signal');
    assess(change.appraisal);
  } else {
    if (!['prod', 'exp'].includes(change.env)) throw invalid('Invalid clock scope');
    validateClock(change.clock);
    if (change.clock.settlementId !== change.eventId) throw invalid('Time settlement ID must equal event ID');
  }
}

export function projectEmotion(previous: EmotionRuntimeState, change: EmotionCommand): EmotionRuntimeState {
  let basic: LayerState;
  let cognitive: LayerState;
  let relationship: LayerState;
  let modulated: LayerState;
  let appraisal: AppraisalResult | undefined;
  let clock = previous.clock;
  let yi: YiState;
  if (change.kind === 'emotion') {
    appraisal = assess(change.appraisal);
    ({ basic, cognitive, relationship, modulated } = appraisalLayers(previous, appraisal, change.relationshipSignal));
    yi = advanceYi(previous.yi, {
      positive: Math.max(0, appraisal.goalCongruence) * appraisal.confidence,
      negative: Math.max(0, -appraisal.goalCongruence) * appraisal.confidence,
      pressure: Math.max(0, -appraisal.goalCongruence) * appraisal.confidence * (1 - appraisal.controllability),
    }, 0);
  } else {
    const result = settleTime(clock, change.clock, change.env);
    if (result.status !== 'settled') throw conflict('Time range has already been settled or rolled back');
    ({ state: clock } = result);
    yi = advanceYi(previous.yi, zeroInput, result.elapsedMs);
    basic = evolve(previous.basic, emptyBasic, 1 - Math.exp(-result.elapsedMs / (2 * HOUR)));
    cognitive = evolve(previous.cognitive, emptyCognitive, 1 - Math.exp(-result.elapsedMs / (6 * HOUR)));
    relationship = evolve(previous.relationship, emptyRelationship, 1 - Math.exp(-result.elapsedMs / (7 * 24 * HOUR)));
    modulated = basic;
  }
  const valence = round6(yi.A - yi.B);
  const arousal = bounded((yi.A + yi.B) / 2);
  const modulation = layer(basic, modulated, 'cross_layer');
  const provenance: EmotionProvenance = {
    eventId: change.eventId, ...(appraisal && { appraisalId: appraisal.appraisalId }),
    evidenceIds: appraisal?.evidence ?? [], calculationVersion: emotionRules,
    layers: [
      layer(previous.basic, basic, 'L1'), layer(previous.cognitive, cognitive, 'L2'),
      layer(previous.relationship, relationship, 'L3'),
      { ...modulation, changes: {
        ...modulation.changes, A: round6(yi.A - previous.yi.A), B: round6(yi.B - previous.yi.B),
        valence: round6(valence - previous.valence), arousal: round6(arousal - previous.arousal),
        regulation: round6(yi.regulation.regulation - previous.yi.regulation.regulation),
        stressLoad: round6(yi.regulation.stressLoad - previous.yi.regulation.stressLoad),
        adaptation: round6(yi.regulation.adaptation - previous.yi.regulation.adaptation),
      } },
    ],
  };
  return {
    version: previous.version + 1, clock, yi, basic: modulated, cognitive, relationship,
    valence, arousal, provenance,
  };
}
