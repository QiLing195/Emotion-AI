import { describe, expect, it } from 'vitest';
import { advanceYi, candidateDynamics, DAY, initialYi, inhibitOverload, MINUTE, zeroInput } from './dynamics.ts';

const values = (state: typeof initialYi) => [state.A, state.B, ...Object.values(state.regulation)];

describe('M2a mathematical gate', () => {
  it('uses the same A1 and B1 for symmetric overload inhibition and preserves nonnegative energy', () => {
    expect(inhibitOverload(0.8, 0.6, 0.5)).toMatchObject({ A: 0.685714, B: 0.514286, removed: 0.2 });
    const swapped = inhibitOverload(0.6, 0.8, 0.5);
    expect(swapped).toMatchObject({ A: 0.514286, B: 0.685714, removed: 0.2 });
    expect(inhibitOverload(0.2, 0.3, 1)).toEqual({ A: 0.2, B: 0.3, removed: 0 });
  });

  it('has the same idle equilibrium under long time steps', () => {
    expect(advanceYi(initialYi, zeroInput, 365 * DAY)).toEqual(initialYi);
  });

  it('preserves nonnegativity across input corners and rejects invalid candidates', () => {
    for (const positive of [0, 1]) for (const negative of [0, 1]) for (const pressure of [0, 1]) {
      expect(values(advanceYi(initialYi, { positive, negative, pressure }, 0)).every((item) => item >= 0)).toBe(true);
    }
    expect(() => inhibitOverload(-0.1, 1, 0.5)).toThrow();
    expect(() => advanceYi(initialYi, zeroInput, -1)).toThrow();
  });

  it('keeps all state coordinates bounded during sustained extreme pressure', () => {
    let state = initialYi;
    for (let index = 0; index < 250; index++) {
      state = advanceYi(state, { positive: 1, negative: 1, pressure: 1 }, 0);
      expect(values(state).every((item) => Number.isFinite(item) && item <= 1 && item >= 0)).toBe(true);
    }
    expect(state.regulation.regulation).toBeLessThan(initialYi.regulation.regulation);
  });

  it('damps small perturbations near the idle equilibrium', () => {
    const perturbed = { ...initialYi, A: 0.001, B: 0.001,
      regulation: { ...initialYi.regulation, regulation: 0.651, stressLoad: 0.001, adaptation: 0.001 } };
    const next = advanceYi(perturbed, zeroInput, 30 * MINUTE);
    const distance = (state: typeof initialYi) => values(state).reduce((total, item, i) => total + Math.abs(item - values(initialYi)[i]), 0);
    expect(distance(next)).toBeLessThan(distance(perturbed));
  });

  it('does not amplify oscillations across one thousand alternating turns', () => {
    let state = initialYi;
    const samples: number[] = [];
    for (let index = 0; index < 1000; index++) {
      state = advanceYi(state, { positive: Number(index % 2 === 0), negative: index % 2, pressure: 0.12 }, 5 * MINUTE);
      samples.push(state.A - state.B);
    }
    expect(Math.abs(samples[999] - samples[997])).toBeLessThan(0.001);
    expect(Math.abs(samples[998] - samples[996])).toBeLessThan(0.001);
    expect(Math.max(...samples.slice(-40)) - Math.min(...samples.slice(-40))).toBeLessThan(0.5);
  });

  it('is insensitive to a small gain perturbation over repeated stimuli', () => {
    const adjusted = { ...candidateDynamics, positiveGain: candidateDynamics.positiveGain + 0.005 };
    let baseline = initialYi;
    let perturbed = initialYi;
    for (let index = 0; index < 200; index++) {
      const input = { positive: 0.7, negative: 0.4, pressure: 0.2 };
      baseline = advanceYi(baseline, input, 5 * MINUTE);
      perturbed = advanceYi(perturbed, input, 5 * MINUTE, adjusted);
    }
    expect(Math.abs(perturbed.A - baseline.A)).toBeGreaterThan(0);
    expect(Math.abs(perturbed.A - baseline.A)).toBeLessThan(0.02);
  });

  it('recovers regulation and releases saturation after extreme stimuli stop', () => {
    let stressed = initialYi;
    for (let index = 0; index < 250; index++) {
      stressed = advanceYi(stressed, { positive: 0.4, negative: 1, pressure: 1 }, MINUTE);
    }
    const recovered = advanceYi(stressed, zeroInput, 2 * DAY);
    expect(recovered.A + recovered.B + recovered.regulation.stressLoad).toBeLessThan(0.00001);
    expect(recovered.regulation.regulation).toBeCloseTo(initialYi.regulation.regulation, 5);
  });
});
