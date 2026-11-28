import { createHash } from 'node:crypto';
import type { JsonValue } from '../contracts/dao-v31/index.ts';

/** Preserve persisted JSON numbers exactly for idempotency and backup integrity. */
export function exactJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(exactJson).join(',') + ']';
  const record = value as Readonly<Record<string, JsonValue>>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + exactJson(record[key])).join(',') + '}';
}

export function integrityHash(value: JsonValue): string {
  return createHash('sha256').update(exactJson(value)).digest('hex');
}

/** Internal typed DTOs occasionally contain present-but-undefined optional fields. */
export function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
