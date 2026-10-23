/**
 * v2.16：单轮生成总预算（P1）
 *
 * 之前每次模型调用**没有总时限**：SDK 默认超时很长，`retryAsync` 还会再叠 3 次重试，
 * 一次卡死就可能把整轮对话拖到几分钟。这里引入一个**可共享的 deadline**：
 *
 * - 一轮对话创建一个 `GenerationBudget`（默认总预算 `TURN_GEN_BUDGET_MS=25000`）；
 * - agent 的多轮工具调用 / 收尾生成 / 接地重写**共享同一个 budget**；
 * - 单次模型调用另有 `GEN_CALL_TIMEOUT_MS=15000` 上限（取二者较小值）；
 * - 预算耗尽后**不再发起新调用**（也不重试），由调用方走确定性兜底；
 * - 后台旁路调用（主动消息/jev/提醒重写）没有传入 budget 时，按**单次调用预算**自我约束，
 *   不会无限等。
 *
 * 注意：`raceWithDeadline` 只让**等待方**及时返回，并不保证取消底层 socket；
 * 这对"别拖住整轮"的目标足够（SDK 内部超时仍会自己结束）。
 */

export const GEN_BUDGET_DEFAULTS = {
  turnTotalMs: 25_000,
  callMs: 15_000,
  minTotalMs: 1_000,
  maxTotalMs: 180_000,
  minCallMs: 500,
  /** 剩余时间低于这个值就不再重试（重试也大概率来不及） */
  retryReserveMs: 700,
} as const;

export class GenerationBudgetExceededError extends Error {
  constructor(message = 'generation budget exceeded') {
    super(message);
    this.name = 'GenerationBudgetExceededError';
  }
}

export interface GenerationBudgetSnapshot {
  totalMs: number;
  callMs: number;
  elapsedMs: number;
  remainingMs: number;
  expired: boolean;
  calls: number;
  timeouts: number;
}

function readEnvNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export interface GenerationBudgetOptions {
  /** 整轮总预算（ms）；不传则读 TURN_GEN_BUDGET_MS */
  totalMs?: number;
  /** 单次模型调用上限（ms）；不传则读 GEN_CALL_TIMEOUT_MS */
  callMs?: number;
  now?: () => number;
  env?: NodeJS.ProcessEnv;
}

export class GenerationBudget {
  readonly totalMs: number;
  readonly callMs: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private _calls = 0;
  private _timeouts = 0;

  constructor(opts: GenerationBudgetOptions = {}) {
    const env = opts.env ?? process.env;
    const d = GEN_BUDGET_DEFAULTS;
    const total = clamp(
      opts.totalMs ?? readEnvNumber(env, 'TURN_GEN_BUDGET_MS', d.turnTotalMs),
      d.minTotalMs,
      d.maxTotalMs,
    );
    const call = clamp(
      opts.callMs ?? readEnvNumber(env, 'GEN_CALL_TIMEOUT_MS', d.callMs),
      d.minCallMs,
      total,
    );
    this.totalMs = total;
    this.callMs = call;
    this.now = opts.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt);
  }

  remainingMs(): number {
    return Math.max(0, this.totalMs - this.elapsedMs());
  }

  expired(): boolean {
    return this.remainingMs() <= 0;
  }

  get calls(): number {
    return this._calls;
  }

  get timeouts(): number {
    return this._timeouts;
  }

  /** 本次模型调用最多可等多久（0 表示没时间了） */
  timeoutForCall(): number {
    return Math.max(0, Math.min(this.callMs, this.remainingMs()));
  }

  /** 登记一次调用并返回其超时；预算已耗尽时抛错（调用方应走兜底） */
  beginCall(): number {
    if (this.expired()) {
      throw new GenerationBudgetExceededError(`no generation budget left (elapsed ${this.elapsedMs()}ms / total ${this.totalMs}ms)`);
    }
    this._calls++;
    return this.timeoutForCall();
  }

  noteTimeout(): void {
    this._timeouts++;
  }

  snapshot(): GenerationBudgetSnapshot {
    return {
      totalMs: this.totalMs,
      callMs: this.callMs,
      elapsedMs: this.elapsedMs(),
      remainingMs: this.remainingMs(),
      expired: this.expired(),
      calls: this._calls,
      timeouts: this._timeouts,
    };
  }
}

/** 没有整轮 budget 的旁路调用：把"单次上限"同时当作总预算，避免重试叠成无限等 */
export function singleCallBudget(env: NodeJS.ProcessEnv = process.env): GenerationBudget {
  const d = GEN_BUDGET_DEFAULTS;
  const ms = clamp(readEnvNumber(env, 'GEN_CALL_TIMEOUT_MS', d.callMs), d.minCallMs, d.maxTotalMs);
  return new GenerationBudget({ totalMs: ms, callMs: ms, env });
}

/** 给一个 promise 加 deadline；超时抛 GenerationBudgetExceededError（不会取消底层任务） */
export function raceWithDeadline<T>(promise: Promise<T>, ms: number, label = 'generation_call'): Promise<T> {
  if (ms <= 0) {
    return Promise.reject(new GenerationBudgetExceededError(`${label}: no time left`));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GenerationBudgetExceededError(`${label}: exceeded ${ms}ms`));
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
