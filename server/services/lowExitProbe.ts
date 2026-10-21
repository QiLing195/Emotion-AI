/**
 * 低谷退出探针的**落盘层**（v1.70）——只记录，不改行为。
 *
 * 用途：给"低谷能不能自己出来"这件事做**只读观测**：
 *   现有规则只在 depth < 0.05 时退出，而 depth 依赖时间衰减 ⇒ 快对话里她出不来。
 *   本探针每轮记录"新规则会不会让她在这一轮退出"，攒够语料后再决定是否真的改动力学。
 *
 * 开关：`ENABLE_LOW_EXIT_PROBE=true`（默认关）。
 * 文件：`memories/low_exit_probe.jsonl`（有界 1MB 滚动，保留 3 份）。
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  evaluateLowExitProbe,
  positiveActivationOf,
  type LowExitProbeResult,
} from '../../src/lib/lowExitProbe.js';

export const LOW_EXIT_PROBE_PATH = 'memories/low_exit_probe.jsonl';
const MAX_BYTES = 1_000_000;
const KEEP_ROTATIONS = 3;

export function lowExitProbeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_LOW_EXIT_PROBE === 'true';
}

interface ProbeAccumulator {
  climbingStreak: number;
  accum: number;
  /** 本段低谷内第一次"会退出"的轮次（用于算"提前多少轮"） */
  firstWouldExitRound: number | null;
  /** 实际退出发生在哪一轮（段结束后回填） */
  actualExitRound: number | null;
}

const acc: ProbeAccumulator = {
  climbingStreak: 0,
  accum: 0,
  firstWouldExitRound: null,
  actualExitRound: null,
};

export function resetProbeAccumulator(): void {
  acc.climbingStreak = 0;
  acc.accum = 0;
  acc.firstWouldExitRound = null;
  acc.actualExitRound = null;
}

export interface ProbeTurnInput {
  round: number;
  active: boolean;
  depth: number;
  peakDepth: number;
  phase: string;
  delta: number;
  /** activation delta（正=被激起） */
  activationDelta?: Record<string, number> | null;
  path?: string;
}

export interface ProbeTurnRecord {
  ts: number;
  round: number;
  active: boolean;
  depth: number;
  peakDepth: number;
  phase: string;
  positiveActivation: number;
  accum: number;
  climbingStreak: number;
  wouldExit: boolean;
  reason: string;
  firstWouldExitRound: number | null;
}

function rotate(path: string): void {
  try {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < MAX_BYTES) return;
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = i === 1 ? path : `${path}.${i - 1}`;
      const to = `${path}.${i}`;
      if (existsSync(from)) {
        try { renameSync(from, to); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

/** 每轮调用一次：判定 + 落盘（失败静默，永不打断主流程） */
export function recordLowExitProbe(input: ProbeTurnInput): ProbeTurnRecord {
  const positiveActivation = positiveActivationOf(input.activationDelta);
  if (!input.active) {
    // 段结束：回填实际退出轮次（用于离线算"探针比现状早多少轮"）
    if (acc.firstWouldExitRound !== null) acc.actualExitRound = input.round;
    resetProbeAccumulator();
  }
  const r: LowExitProbeResult = evaluateLowExitProbe({
    active: input.active,
    depth: input.depth,
    peakDepth: input.peakDepth,
    phase: input.phase,
    delta: input.delta,
    positiveActivation,
    prevClimbingStreak: acc.climbingStreak,
    prevAccum: acc.accum,
  });
  acc.climbingStreak = r.climbingStreak;
  acc.accum = r.accum;
  if (input.active && r.wouldExit && acc.firstWouldExitRound === null) {
    acc.firstWouldExitRound = input.round;
  }
  const record: ProbeTurnRecord = {
    ts: Date.now(),
    round: input.round,
    active: input.active,
    depth: Math.round(input.depth * 1000) / 1000,
    peakDepth: Math.round(input.peakDepth * 1000) / 1000,
    phase: input.phase,
    positiveActivation,
    accum: Math.round(r.accum * 1000) / 1000,
    climbingStreak: r.climbingStreak,
    wouldExit: r.wouldExit,
    reason: r.reason,
    firstWouldExitRound: acc.firstWouldExitRound,
  };
  const path = input.path ?? LOW_EXIT_PROBE_PATH;
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotate(path);
    appendFileSync(path, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* 观测层失败不影响主流程 */ }
  return record;
}

export function probeSummary(): ProbeAccumulator {
  return { ...acc };
}
