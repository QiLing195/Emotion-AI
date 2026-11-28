import { createHash } from 'node:crypto';
import type { JsonValue } from '../contracts/dao-v31/schema.ts';

/** Decimal quantization, with midpoint ties away from zero. */
export function round6(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('A projection number must be finite');
  // Decimal parsing rounds the shortest decimal representation and avoids
  // binary multiplication moving exact half-way inputs across the boundary.
  const magnitude = Math.abs(value);
  if (magnitude >= 2 ** 33) return value;
  if (magnitude < 0.0000005) return 0;
  if (magnitude < 0.000001) return Math.sign(value) * 0.000001;
  const [whole, fraction = ''] = magnitude.toString().split('.');
  const units = Number(whole) * 1_000_000 + Number(fraction.padEnd(7, '0').slice(0, 6))
    + Number(Number(fraction[6]) >= 5);
  if (units === 0) return 0;
  return Math.sign(value) * (units / 1_000_000);
}

/** Encode sorted object keys recursively, preserving array order and JSON values. */
export function canonicalJson(value: JsonValue): string {
  const active = new Set<object>();
  function encode(node: JsonValue): string {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return JSON.stringify(node);
    if (typeof node === 'number') return JSON.stringify(round6(node));
    if (typeof node !== 'object') throw new TypeError('A projection must contain JSON values');
    if (active.has(node)) throw new TypeError('A projection must not contain cycles');
    active.add(node);
    try {
      if (Array.isArray(node)) {
        return '[' + Array.from(node, (item: JsonValue) => encode(item)).join(',') + ']';
      }
      const prototype: unknown = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('A projection must contain plain objects');
      return '{' + Object.keys(node).sort().map((key) =>
        JSON.stringify(key) + ':' + encode((node as Readonly<Record<string, JsonValue>>)[key]),
      ).join(',') + '}';
    } finally {
      active.delete(node);
    }
  }

  return encode(value);
}

export function projectionHash(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Each event/version pair initializes an isolated Mulberry32 generator. */
export function seededPrng(eventId: string, projectionVersion: string): () => number {
  let state = createHash('sha256').update(JSON.stringify([eventId, projectionVersion]), 'utf8').digest().readUInt32BE();
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000;
  };
}
