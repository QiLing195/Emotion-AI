/**
 * v2.20：脱敏 turn trace（每轮一行 JSONL）
 *
 * 为什么需要：ExpressionPlan / 内在候选 / 运行时强制 / 生成预算 / 工具轨迹目前只在内存与
 * `/state`、`/api/diagnostics` 里可见，重启即丢，也没法做跨轮复盘。这里把**结构性事实**
 * 落到 `memories/turn_trace.jsonl`。
 *
 * 脱敏红线（**只存结构，不存内容**）：
 * - 不存用户原话、不存她的回复文本、不存记忆正文、不存 causeQuote / 动机内容；
 * - userId 只存 sha256 前 8 位（或 null），不存原始 id；
 * - 只存枚举/计数/耗时/布尔/短码（tool 名、strategy 枚举等）。
 *
 * 写入失败静默（观测层永不打断主流程）；单文件 2MB 轮转，保留 5 份。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const TURN_TRACE_MAX_BYTES = 2 * 1024 * 1024;
export const TURN_TRACE_KEEP = 5;

export function turnTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_TURN_TRACE !== 'false';
}

export function turnTracePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TURN_TRACE_FILE) return env.TURN_TRACE_FILE;
  const dir = env.MEMORIES_DIR || path.join(process.cwd(), 'memories');
  return path.join(dir, 'turn_trace.jsonl');
}

/** 用户 id 只留不可逆短哈希（同一用户可聚合，但不可还原） */
export function hashUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return createHash('sha256').update(String(userId)).digest('hex').slice(0, 8);
}

export interface TurnTraceInput {
  round?: number | null;
  userId?: string | null;
  prompt?: { blocks?: number; chars?: number; permits?: number; suppressed?: string[] } | null;
  strategy?: string | null;
  conflictPhase?: string | null;
  plan?: {
    decision?: string; reason?: string; emotion?: string | null; tone?: string | null;
    duration?: string; evidence?: string | null; maxSentences?: number; maxQuestions?: number; confidence?: number;
    /** v2.22：只用于记「有没有引文」的布尔，**引文内容绝不进 trace** */
    causeQuote?: string | null;
  } | null;
  intrinsic?: {
    accepted?: Array<{ type: string; eventId?: string }>;
    rejected?: Array<{ reason: string }>;
  } | null;
  enforcement?: { changed?: boolean; changes?: string[] } | null;
  budget?: { elapsedMs: number; remainingMs: number; calls: number; timeouts: number; expired: boolean } | null;
  memory?: {
    injected?: number;
    sources?: Record<string, number>;
    proactivePicked?: boolean;
  } | null;
  motive?: { kind?: string | null; salience?: number | null } | null;
  agent?: { rounds?: number; usedTools?: boolean; tools?: string[] } | null;
  reply?: { chars?: number; questionMarks?: number } | null;
}

export interface TurnTraceRecord {
  v: 1;
  ts: string;
  round: number | null;
  user: string | null;
  prompt: { blocks: number; chars: number; permits: number; suppressed: string[] };
  strategy: string | null;
  conflict: string | null;
  plan: {
    decision?: string; reason?: string; emotion?: string | null; tone?: string | null;
    duration?: string; evidence?: string | null; maxSentences?: number; maxQuestions?: number; confidence?: number;
    hasCauseQuote: boolean;
  } | null;
  intrinsic: { accepted: string[]; rejected: string[] };
  enforcement: { changed: boolean; changes: string[] };
  budget: TurnTraceInput['budget'];
  memory: { injected: number; sources: Record<string, number>; proactivePicked: boolean };
  motive: { kind: string | null; salience: number | null } | null;
  agent: { rounds: number; usedTools: boolean; tools: string[] } | null;
  reply: { chars: number; questionMarks: number };
}

/**
 * v2.21：evidence 是自由字符串，**可能夹带用户原话**（expressionPlan 里
 * `他刚说的「${causeQuote}」`）。trace 必须把它遮蔽掉再落盘。
 * 规则：去换行/制表；把引号内文替换成「[引文已遮蔽]」；限长 160。
 */
export function sanitizeTraceLabel(raw: string | null | undefined, maxLen = 160): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\r\n\t]+/g, ' ');
  s = s.replace(/「[^」]{1,400}」/g, '「[引文已遮蔽]」');
  s = s.replace(/“[^”]{1,400}”/g, '“[引文已遮蔽]”');
  s = s.replace(/"[^"]{1,400}"/g, '"[引文已遮蔽]"');
  s = s.replace(/[ \t]{2,}/g, ' ').trim();
  if (!s) return null;
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/** 纯函数：把一轮的结构性事实整理成脱敏记录（绝不携带原文） */
export function buildTurnTrace(input: TurnTraceInput, now: Date = new Date()): TurnTraceRecord {
  const plan = input.plan ?? null;
  const intrinsicAcc = (input.intrinsic?.accepted ?? []).map(a => String(a.type));
  const intrinsicRej = (input.intrinsic?.rejected ?? []).map(r => String(r.reason));
  return {
    v: 1,
    ts: now.toISOString(),
    round: typeof input.round === 'number' && Number.isFinite(input.round) ? input.round : null,
    user: hashUserId(input.userId),
    prompt: {
      blocks: Number(input.prompt?.blocks ?? 0),
      chars: Number(input.prompt?.chars ?? 0),
      permits: Number(input.prompt?.permits ?? 0),
      suppressed: (input.prompt?.suppressed ?? []).map(String).slice(0, 12),
    },
    strategy: input.strategy ? String(input.strategy) : null,
    conflict: input.conflictPhase ? String(input.conflictPhase) : null,
    // 白名单复制：即便调用方多传了字段（例如 causeQuote），也不会进文件
    plan: plan ? {
      decision: plan.decision ? String(plan.decision) : undefined,
      reason: plan.reason ? String(plan.reason) : undefined,
      emotion: plan.emotion ?? null,
      tone: plan.tone ?? null,
      duration: plan.duration ? String(plan.duration) : undefined,
      evidence: sanitizeTraceLabel(plan.evidence),
      maxSentences: Number(plan.maxSentences ?? 0),
      maxQuestions: Number(plan.maxQuestions ?? 0),
      confidence: Number(plan.confidence ?? 0),
      // v2.22：只记存在性，不记引文内容
      hasCauseQuote: Boolean(plan.causeQuote),
    } : null,
    intrinsic: { accepted: intrinsicAcc.slice(0, 8), rejected: intrinsicRej.slice(0, 8) },
    enforcement: {
      changed: Boolean(input.enforcement?.changed),
      changes: (input.enforcement?.changes ?? []).map(String).slice(0, 8),
    },
    budget: input.budget ? {
      elapsedMs: Number(input.budget.elapsedMs ?? 0),
      remainingMs: Number(input.budget.remainingMs ?? 0),
      calls: Number(input.budget.calls ?? 0),
      timeouts: Number(input.budget.timeouts ?? 0),
      expired: Boolean(input.budget.expired),
    } : null,
    memory: {
      injected: Number(input.memory?.injected ?? 0),
      sources: input.memory?.sources ?? {},
      proactivePicked: Boolean(input.memory?.proactivePicked),
    },
    motive: input.motive ? {
      kind: input.motive.kind ? String(input.motive.kind) : null,
      salience: typeof input.motive.salience === 'number' ? input.motive.salience : null,
    } : null,
    agent: input.agent ? {
      rounds: Number(input.agent.rounds ?? 0),
      usedTools: Boolean(input.agent.usedTools),
      tools: (input.agent.tools ?? []).map(String).slice(0, 8),
    } : null,
    reply: {
      chars: Number(input.reply?.chars ?? 0),
      questionMarks: Number(input.reply?.questionMarks ?? 0),
    },
  };
}

function rotateIfNeeded(file: string, maxBytes: number, keep: number): void {
  if (!existsSync(file)) return;
  let size = 0;
  try { size = statSync(file).size; } catch { return; }
  if (size < maxBytes) return;
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    renameSync(file, path.join(dir, `${base}.rot-${Date.now()}`));
  } catch { return; }
  // 只保留最近 keep 份
  try {
    const rots = readdirSync(dir)
      .filter(f => f.startsWith(`${base}.rot-`))
      .sort()
      .reverse();
    for (const f of rots.slice(keep)) {
      try { unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** 追加一行；失败返回 false（不抛） */
export function appendTurnTrace(
  record: TurnTraceRecord,
  opts: { file?: string; maxBytes?: number; keep?: number } = {},
): boolean {
  const file = opts.file ?? turnTracePath();
  const maxBytes = opts.maxBytes ?? TURN_TRACE_MAX_BYTES;
  const keep = opts.keep ?? TURN_TRACE_KEEP;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file, maxBytes, keep);
    appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
