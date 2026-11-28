import type { RuntimeProjection, ProjectionChange, RuntimeRecord } from './m1Types.ts';
import { projectionHash } from './determinism.ts';
import { isIdentifier } from './sessionAuth.ts';
import { invalid, conflict } from './errors.ts';
import type { WriteKind } from '../contracts/dao-v31/index.ts';

export const initialProjection: RuntimeProjection = {
  sequence: 0, stateVersion: 0, counters: {}, derived: {}, slots: {},
};

export const initialRuntime: RuntimeRecord = { state: initialProjection, hash: projectionHash({ ...initialProjection }) };

const count = (map: Readonly<Record<string, number>>, key: string) => Object.hasOwn(map, key) ? map[key] : 0;

const compatible: Record<WriteKind, ProjectionChange['kind']> = {
  commutative: 'increment', recomputable: 'sum', exclusive: 'set', governed: 'remove',
};

export function validateChange(kind: WriteKind, change: ProjectionChange) {
  if (change.kind === 'mark' || change.kind === 'restore') {
    if (kind !== 'governed') throw invalid('Only governed commits can mark or restore a boundary');
    if (change.kind === 'restore' && (!Number.isSafeInteger(change.manualRecords) || change.manualRecords < 0)) {
      throw invalid('Invalid restored record count');
    }
    return;
  }
  if (compatible[kind] !== change.kind) throw invalid('Projection command does not match its write class');
  if ('key' in change && !isIdentifier(change.key)) throw invalid('Invalid projection key');
  if (change.kind === 'set' && !Number.isSafeInteger(change.value)) throw invalid('Slot value must be a safe integer');
  if (change.kind === 'increment' && (!Number.isSafeInteger(change.amount) || change.amount < 0)) {
    throw invalid('Commutative counters require a nonnegative safe integer increment');
  }
  if (change.kind === 'sum' && (change.inputs.length === 0 || !change.inputs.every(isIdentifier))) {
    throw invalid('Recomputation requires valid counter inputs');
  }
  if (change.kind === 'remove' && (!change.keys.every(isIdentifier) || (change.decrement
    && (!isIdentifier(change.decrement.key) || !Number.isSafeInteger(change.decrement.amount) || change.decrement.amount < 0)))) {
    throw invalid('Invalid governed deletion');
  }
}

/** Projection depends only on the previous state, the persisted change, and sequence. */
export function project(previous: RuntimeProjection, change: ProjectionChange, sequence: number): RuntimeRecord {
  let { counters, derived, slots } = previous;
  switch (change.kind) {
    case 'increment': {
      const next = count(counters, change.key) + change.amount;
      if (!Number.isSafeInteger(next)) throw conflict('Counter overflow');
      counters = { ...counters, [change.key]: next };
      break;
    }
    case 'sum': {
      const total = change.inputs.reduce((sum, key) => sum + count(counters, key), 0);
      if (!Number.isSafeInteger(total)) throw conflict('Recomputed counter overflow');
      derived = { ...derived, [change.key]: total };
      break;
    }
    case 'set':
      slots = { ...slots, [change.key]: change.value };
      break;
    case 'remove': {
      const removed = new Set(change.keys);
      slots = Object.fromEntries(Object.entries(slots).filter(([key]) => !removed.has(key)));
      if (change.decrement) {
        const { key, amount } = change.decrement;
        const next = count(counters, key) - amount;
        if (next < 0) throw conflict('Governed counter would become negative');
        counters = { ...counters, [key]: next };
        // Derived materializations may depend on a removed counter or slot.
        derived = {};
      }
      break;
    }
    case 'restore':
      if (count(counters, 'manualRecords') !== 0) throw conflict('Portable restore requires an empty data scope');
      counters = { ...counters, manualRecords: change.manualRecords };
      break;
    case 'mark':
      break;
  }
  const state = { sequence, stateVersion: previous.stateVersion + 1, counters, derived, slots };
  return { state, hash: projectionHash(state) };
}
