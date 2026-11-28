import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../contracts/dao-v31/index.ts';
import { canonicalJson, projectionHash, round6, seededPrng } from './determinism.ts';

describe('M0 deterministic projection primitives', () => {
  it.each([
    [1.2345674, 1.234567],
    [1.2345675, 1.234568],
    [-1.2345675, -1.234568],
    [0.0000004999999999, 0],
    [-0.0000005, -0.000001],
    [-0, 0],
    [8_589_934_592.125, 8_589_934_592.125],
  ])('quantizes %s to %s', (input, result) => expect(round6(input)).toBe(result));

  it('sorts nested keys including integer-like keys and preserves array order', () => {
    const input = { b: [{ y: 0, x: -0.123456789 }, null], '2': true, '10': '值', a: 0.9999995 };
    expect(canonicalJson(input)).toBe('{"10":"值","2":true,"a":1,"b":[{"x":-0.123457,"y":0},null]}');
    expect(projectionHash({ nested: { b: 2.00000001, a: 1 } })).toBe(projectionHash({ nested: { a: 1, b: 2 } }));
    expect(projectionHash([1, 2])).not.toBe(projectionHash([2, 1]));
  });

  it('rejects invalid numbers, sparse arrays, non-JSON objects and cyclic state', () => {
    const cycle: Record<string, JsonValue> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow('cycles');
    expect(() => canonicalJson([Number.NaN])).toThrow('finite');
    expect(() => round6(Infinity)).toThrow('finite');
    expect(() => canonicalJson(new Array<JsonValue>(1))).toThrow('JSON');
    expect(() => canonicalJson(new Date(0) as unknown as JsonValue)).toThrow('plain objects');
  });

  it('reproduces a stable event/version sequence without global randomness', () => {
    const sequence = (eventId: string, version: string) => {
      const random = seededPrng(eventId, version);
      return Array.from({ length: 64 }, () => random());
    };
    const first = sequence('event-1', '1.0.0');
    expect(first).toEqual(sequence('event-1', '1.0.0'));
    expect(first).not.toEqual(sequence('event-2', '1.0.0'));
    expect(first).not.toEqual(sequence('event-1', '1.1.0'));
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(first.slice(0, 3)).toEqual([0.7596226721070707, 0.9953006526920944, 0.5773043399676681]);
  });
});
