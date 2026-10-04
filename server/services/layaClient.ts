/**
 * Laya 决策层的**传输层**（v1.33）。
 *
 * 协议：`laya-serve`（`pip install "laya[serve]"`）暴露的 `POST /v1/systemone`，
 * 与 TypeSafe Jev 的 HTTP 协议同形。本文件负责：
 *   · 环境变量 → 配置（每次调用现读，与项目其它开关一致，可运行时切换）
 *   · 超时 + 熔断（一个可选的第二个意见，绝不能拖慢/拖死主链路）
 *   · 统计（次数/失败/延迟/model），供 `/state` 与 A/B 脚本观测
 *
 * **它永远不抛异常、永远不返回半成品**：出任何问题都返回 `null`，
 * 调用方（`aiCoordinator` 阶段 4）于是用规则链的结论。
 *
 * 环境变量：
 * | 变量 | 默认 | 说明 |
 * |---|---|---|
 * | `LAYA_STRATEGY` | `off` | `off` 一次网络都不发 / `shadow` 只记账 / `on` 可改判 |
 * | `LAYA_ENDPOINT` | `http://127.0.0.1:8790` | sidecar 地址（`LAYA_PORT` 默认 8000，本项目用 8790 避让 3000/5173） |
 * | `LAYA_API_KEY` | 空 | 设置后带 `Authorization: Bearer` |
 * | `LAYA_MODEL` | `multilingual` | 显式指定 checkpoint（中文输入必须走多语言那个） |
 * | `LAYA_TIMEOUT_MS` | `1500` | 单次超时；**实测 CPU 单次前向 0.3~2s**，太短会全部熔断 |
 * | `LAYA_MIN_CONFIDENCE` | `0.5` | 低于此置信度不采纳模型意见 |
 * | `LAYA_BREAKER_FAILS` | `3` | 连续失败多少次后熔断 |
 * | `LAYA_BREAKER_COOLDOWN_MS` | `60000` | 熔断时长 |
 * | `LAYA_KEEP_ACCOMPANY` | `true` | 规则给 `accompany` 时不让模型碰（`false` 回退到 v1.33 首次实测那套） |
 * | `LAYA_DUMP_STATE` | 空 | 只读诊断口：把真正发出去的 state 文本追加到这个文件（与 `DUMP_PROMPT` 同一套路） |
 */
import { appendFileSync } from 'node:fs';
import {
  buildLayaQuestions,
  buildLayaStateText,
  parseLayaResponse,
  type LayaCriteriaLang,
  type LayaStrategyMode,
  type LayaStrategyVerdict,
  type LayaTurnInput,
} from '../../src/lib/layaDecision.js';
import type { StrategyType } from '../../src/lib/dialogueStrategy.js';

// ────────────────────────────────────────────────────────────
// 配置
// ────────────────────────────────────────────────────────────

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * 解析模式。**只认 `shadow` / `on` 为开启**，其余（含拼错）一律 `off` ——
 * 一个拼错的开关不该悄悄打开一条外部依赖通路。
 */
export function layaStrategyMode(): LayaStrategyMode {
  const raw = envStr('LAYA_STRATEGY', 'off').toLowerCase();
  return raw === 'on' || raw === 'shadow' ? raw : 'off';
}

export function layaEndpoint(): string {
  return envStr('LAYA_ENDPOINT', 'http://127.0.0.1:8790').replace(/\/+$/, '');
}

export function layaTimeoutMs(): number {
  return Math.max(100, envNum('LAYA_TIMEOUT_MS', 1500));
}

export function layaMinConfidence(): number {
  return Math.min(1, Math.max(0, envNum('LAYA_MIN_CONFIDENCE', 0.5)));
}

/**
 * 规则给出 `accompany`（她本来就沉在里面 ⇒ 少说、陪着）时，**不让模型改判**。
 *
 * 默认 **true**；`LAYA_KEEP_ACCOMPANY=false` 回退到 v1.33 首次实测的那套行为
 * （任何非守门策略都可以被改判）—— 那一套的 A/B 数据（48 对配对）就是"该收窄"的直接依据：
 * `accompany → empathize` 让追问 0.06→0.83、劝解 0.28→0.89、字数 +104%。
 * 开关写法与项目其它开关一致（`!== 'false'`，写错不会静默改变行为）。
 */
export function layaKeepAccompany(): boolean {
  return process.env.LAYA_KEEP_ACCOMPANY !== 'false';
}

function breakerFails(): number {
  return Math.max(1, envNum('LAYA_BREAKER_FAILS', 3));
}

function breakerCooldownMs(): number {
  return Math.max(1000, envNum('LAYA_BREAKER_COOLDOWN_MS', 60_000));
}

// ────────────────────────────────────────────────────────────
// 熔断 + 统计
// ────────────────────────────────────────────────────────────

interface LayaStats {
  calls: number;
  ok: number;
  failed: number;
  breakerSkips: number;
  breakerOpened: number;
  lastLatencyMs: number;
  lastModel: string | null;
  lastError: string | null;
  lastAt: number | null;
}

const stats: LayaStats = {
  calls: 0, ok: 0, failed: 0, breakerSkips: 0, breakerOpened: 0,
  lastLatencyMs: 0, lastModel: null, lastError: null, lastAt: null,
};

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

export function layaStats(): LayaStats & { consecutiveFailures: number; breakerOpen: boolean; breakerOpenUntil: number } {
  return {
    ...stats,
    consecutiveFailures,
    breakerOpen: Date.now() < breakerOpenUntil,
    breakerOpenUntil,
  };
}

/** A/B 脚本与测试用：清空熔断与统计。 */
export function resetLayaBreaker(): void {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
  stats.calls = 0; stats.ok = 0; stats.failed = 0; stats.breakerSkips = 0;
  stats.breakerOpened = 0; stats.lastLatencyMs = 0; stats.lastModel = null;
  stats.lastError = null; stats.lastAt = null;
}

function recordFailure(reason: string): void {
  stats.failed += 1;
  stats.lastError = reason;
  consecutiveFailures += 1;
  if (consecutiveFailures >= breakerFails() && Date.now() >= breakerOpenUntil) {
    breakerOpenUntil = Date.now() + breakerCooldownMs();
    stats.breakerOpened += 1;
    console.warn(`[Laya] 连续 ${consecutiveFailures} 次失败（${reason}）→ 熔断 ${Math.round(breakerCooldownMs() / 1000)}s，本层暂时不参与决策`);
  }
}

// ────────────────────────────────────────────────────────────
// 一次裁决
// ────────────────────────────────────────────────────────────

export type LayaFetch = typeof fetch;

export interface PredictLayaArgs {
  input: LayaTurnInput;
  /** 此刻真正可选的策略（已过情境抑制表） */
  allowed: readonly StrategyType[];
  /** 注入用（测试）；默认全局 fetch */
  fetchImpl?: LayaFetch;
  /** 覆盖模式（A/B 脚本要强制 on 而不改环境变量） */
  mode?: Exclude<LayaStrategyMode, 'off'>;
  /** 选项描述语言（默认 zh；`scripts/probe-laya-strategy.ts` 用它做对照） */
  criteriaLang?: LayaCriteriaLang;
}

/**
 * 问一次 Laya。**任何异常 → `null`**（不抛、不阻塞）。
 */
export async function predictLayaStrategy(args: PredictLayaArgs): Promise<LayaStrategyVerdict | null> {
  const configured = layaStrategyMode();
  const mode = args.mode ?? (configured === 'off' ? null : configured);
  if (!mode) return null;

  if (Date.now() < breakerOpenUntil) {
    stats.breakerSkips += 1;
    return null;
  }

  const body = {
    state: buildLayaStateText(args.input),
    questions: buildLayaQuestions(args.allowed, args.criteriaLang ?? 'zh'),
    model: envStr('LAYA_MODEL', 'multilingual'),
  };
  // 只读诊断口（与 `DUMP_PROMPT` 同一套路）：把**真正发出去的 state 文本**落盘。
  // 为什么需要：同一批输入在两次 A/B 里"被改判"的比例是 8/8 与 3/8 —— 模型是确定性的
  // （同请求连发三次逐位相同），所以差异**只可能来自这段文本**。没有这个口就只能猜。
  if (process.env.LAYA_DUMP_STATE) {
    try {
      appendFileSync(process.env.LAYA_DUMP_STATE, `\n===== ${new Date().toISOString()} =====\n${body.state}\n`, 'utf8');
    } catch { /* 诊断失败不影响主流程 */ }
  }
  const apiKey = process.env.LAYA_API_KEY?.trim();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const fetchImpl = args.fetchImpl ?? fetch;
  const started = Date.now();
  stats.calls += 1;
  stats.lastAt = started;
  try {
    const res = await fetchImpl(`${layaEndpoint()}/v1/systemone`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(layaTimeoutMs()),
    });
    if (!res.ok) {
      recordFailure(`HTTP ${res.status}`);
      return null;
    }
    const json: unknown = await res.json();
    const latencyMs = Date.now() - started;
    const verdict = parseLayaResponse(json, { mode, latencyMs });
    if (!verdict) {
      recordFailure('响应无法解析出 stance 标签');
      return null;
    }
    consecutiveFailures = 0;
    stats.ok += 1;
    stats.lastLatencyMs = latencyMs;
    stats.lastModel = verdict.model;
    stats.lastError = null;
    return verdict;
  } catch (err) {
    recordFailure(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    return null;
  }
}

/** 供 `/state` / 自检脚本用：sidecar 活着吗。 */
export async function layaHealth(fetchImpl: LayaFetch = fetch): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchImpl(`${layaEndpoint()}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j = (await res.json()) as { status?: string; loaded?: unknown; device?: string };
    return { ok: j.status === 'ok', detail: `status=${j.status} device=${j.device} loaded=${JSON.stringify(j.loaded)}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
