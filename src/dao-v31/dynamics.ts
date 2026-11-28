import type { DaoResponseData } from '../contracts/dao-v31/index.ts';
import { round6 } from './determinism.ts';
import { invalid } from './errors.ts';

export type RegulationState = DaoResponseData<'getStateSnapshot'>['regulationState'];
export type YiState = Readonly<{ A: number; B: number; regulation: RegulationState }>;
export type YiInput = Readonly<{ positive: number; negative: number; pressure: number }>;
export const MINUTE = 60_000;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;

export const initialYi: YiState = Object.freeze({
  A: 0, B: 0, regulation: Object.freeze({
    regulation: 0.65, recoveryRate: 0.25, resilience: 0.6, stressLoad: 0, adaptation: 0,
  }),
});
export const zeroInput: YiInput = Object.freeze({ positive: 0, negative: 0, pressure: 0 });
export type DynamicsConfig = Readonly<{
  positiveGain: number; negativeGain: number; overload: number;
  aHalfLifeMs: number; bHalfLifeMs: number;
}>;
export const candidateDynamics: DynamicsConfig = Object.freeze({
  positiveGain: 0.28, negativeGain: 0.32, overload: 0.8,
  aHalfLifeMs: 45 * MINUTE, bHalfLifeMs: 55 * MINUTE,
});

export const bounded = (value: number) => round6(Math.max(0, Math.min(1, value)));
const decay = (milliseconds: number, halfLife: number) => Math.exp(-Math.LN2 * milliseconds / halfLife);
export const isUnit = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;

export function inhibitOverload(a1: number, b1: number, beta: number) {
  if (!Number.isFinite(a1) || !Number.isFinite(b1) || a1 < 0 || b1 < 0 || a1 + b1 > 4 || !isUnit(beta)) {
    throw invalid('Overload inhibition requires bounded nonnegative same-stage inputs');
  }
  const sum = a1 + b1;
  const proportionalLoss = beta * Math.max(0, sum - 1) / (sum + 1e-9);
  return {
    A: round6(a1 * (1 - proportionalLoss)),
    B: round6(b1 * (1 - proportionalLoss)),
    removed: round6(sum * proportionalLoss),
  };
}

export function advanceYi(previous: YiState, input: YiInput, elapsedMs: number, config = candidateDynamics): YiState {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0
    || ![previous.A, previous.B, ...Object.values(previous.regulation), input.positive, input.negative, input.pressure,
      config.positiveGain, config.negativeGain, config.overload].every(isUnit)
    || ![config.aHalfLifeMs, config.bHalfLifeMs].every((ms) => Number.isFinite(ms) && ms > 0)) {
    throw invalid('Invalid A/B/regulation dynamics inputs');
  }
  const { regulation: old, A, B } = previous;
  const a0 = A * decay(elapsedMs, config.aHalfLifeMs);
  const b0 = B * decay(elapsedMs, config.bHalfLifeMs);
  const a1 = a0 + config.positiveGain * input.positive * (0.7 + 0.3 * old.regulation) * (1 - a0 * 0.6);
  const b1 = b0 + config.negativeGain * input.negative * (1 - 0.45 * old.regulation) * (1 - b0 * 0.6);
  const inhibited = inhibitOverload(a1, b1, config.overload);
  const previousPressure = old.stressLoad * decay(elapsedMs, 2 * HOUR);
  const stressLoad = bounded(previousPressure + (1 - previousPressure) * (input.pressure * 0.25 + inhibited.removed * 0.1));
  const recoveryTarget = bounded(0.35 + old.resilience * 0.5);
  const recovery = 1 - decay(elapsedMs, HOUR / (0.25 + old.recoveryRate));
  const adaptation = bounded(old.adaptation * decay(elapsedMs, 30 * DAY)
    + (1 - decay(elapsedMs, 7 * DAY)) * previousPressure * 0.05 + input.pressure * 0.001 * (1 - old.adaptation));
  const updated = old.regulation + (recoveryTarget - old.regulation) * recovery
    - (input.pressure * 0.14 + inhibited.removed * 0.08) * old.regulation * (1 - old.resilience * 0.45);
  return {
    A: bounded(inhibited.A), B: bounded(inhibited.B),
    regulation: { ...old, regulation: bounded(updated), stressLoad, adaptation },
  };
}
