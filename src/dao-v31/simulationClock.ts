import type { DaoEnv } from '../contracts/dao-v31/index.ts';
import { invalid } from './errors.ts';
import { isIdentifier } from './sessionAuth.ts';

export type TimeSource = 'real_elapsed' | 'recovery' | 'manual_simulation';
export type ClockCommand = Readonly<{ settlementId: string; source: TimeSource; targetMs: number }>;
export type TimeSettlement = Readonly<{
  settlementId: string; fromTime: number; toTime: number; source: TimeSource;
  settlementVersion: number; wallTime: number | null;
}>;
export type ClockState = Readonly<{
  wallHighWaterMs: number | null; simulationMs: number; version: number;
  latest: TimeSettlement | null;
}>;
export interface WallClock { now(): number }

export const initialClock: ClockState = Object.freeze({ wallHighWaterMs: null, simulationMs: 0, version: 0, latest: null });

export function validateClock(command: ClockCommand) {
  if (!command || !isIdentifier(command.settlementId) || !Number.isSafeInteger(command.targetMs) || command.targetMs < 0
    || !['real_elapsed', 'manual_simulation', 'recovery'].includes(command.source)) throw invalid('Invalid time settlement');
}

export function settleTime(previous: ClockState, command: ClockCommand, env: DaoEnv) {
  validateClock(command);
  const manual = command.source === 'manual_simulation';
  if (manual && env !== 'exp') throw invalid('Manual simulation is available in the experiment scope');
  const previousTime = manual ? previous.simulationMs : previous.wallHighWaterMs;
  const elapsed = previousTime === null ? 0 : command.targetMs - previousTime;
  if (previousTime !== null && elapsed <= 0) {
    return { status: elapsed < 0 ? 'clock_rollback' as const : 'unchanged' as const, elapsedMs: 0, state: previous };
  }
  const toTime = previous.simulationMs + elapsed;
  if (!Number.isSafeInteger(toTime)) throw invalid('Simulation clock overflow');
  const settlement: TimeSettlement = {
    settlementId: command.settlementId, source: command.source, settlementVersion: previous.version + 1,
    fromTime: previous.simulationMs, toTime, wallTime: manual ? previous.wallHighWaterMs : command.targetMs,
  };
  return {
    status: 'settled' as const, elapsedMs: elapsed,
    state: { wallHighWaterMs: settlement.wallTime, simulationMs: toTime, version: settlement.settlementVersion, latest: settlement },
  };
}
