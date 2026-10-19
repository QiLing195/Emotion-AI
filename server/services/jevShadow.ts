/**
 * jev 影子模式（v1.59，**默认关**）
 *
 * 目的：把"她的状态 vs 他的情绪"这类**冲突判定**交给一次独立的 LLM 决策（jev），
 *      但在第一阶段**只记账、不生效** —— 她的行为与现状逐字节相同。
 *
 * 纪律（授权：2026-10-19 用户明确授权"实现 jev 影子模式"）：
 *   1) 零副作用：本模块只算、只写账本；绝不改 Prompt / 策略 / 回复 / 情绪状态
 *   2) 失败可退：超时 / 解析失败 / 校验失败 ⇒ 返回 null 决策 + errorCode，**绝不抛给主流程**
 *   3) 不阻塞：调用方用 `void` fire-and-forget（不 await），不增加单轮延迟
 *   4) 可回放：账本里存完整输入快照 + 输入摘要，可离线重跑同一决策
 *   5) 只接管冲突类：`rules_default` 始终随输入给出 —— jev 的任务是"要不要改"，不是从零决策
 *
 * v0 已知限制（记入每条账本的 `limitations`）：
 *   · `her_state.activated` 目前为空 —— v0 尚未接激活态（`separateActivation`），
 *     故 jev 看到的是 valence + lowPeriod + rumination，看不到"哪几个情绪被激起"
 */
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export type JevAction = 'share' | 'wait' | 'ask';
export type JevConflict = 'her_vs_his' | 'none';

export type JevErrorCode =
  | 'TIMEOUT'
  | 'CALL_FAILED'
  | 'VALIDATION_FAILED'
  | 'PARSE_FAILED';

export const JEV_ACTIONS: readonly JevAction[] = ['share', 'wait', 'ask'];
export const JEV_CONFLICTS: readonly JevConflict[] = ['her_vs_his', 'none'];
export const JEV_INNER_LINE_MAX = 20;
export const JEV_DEFAULT_TIMEOUT_MS = 1200;
export const JEV_MAX_CANDIDATES = 6;
export const JEV_DEFAULT_LEDGER = 'memories/jev_shadow.jsonl';

/** 只允许"大写字母开头 + 大写字母/数字/下划线"，避免自由文本混进 reason_code */
const REASON_CODE_RE = /^[A-Z][A-Z0-9_]{2,31}$/;
/** inner_line 不得夹带 Prompt 痕迹/引号（它是着色素材，不是回复） */
const INNER_LINE_FORBIDDEN_RE = /[【】「」“”"]/;

export interface JevCandidateRef {
  id: string;
  kind: string;
  salience: number;
  line: string;
}

export interface JevInput {
  version: 'jev-v0';
  her_state: {
    valence: number;
    /** v0 恒为空：见文件头"已知限制" */
    activated: Record<string, number>;
    low_period: { active: boolean; turns: number } | null;
    rumination: { dominant: string; streak: number } | null;
  };
  his_turn: { emotion: string; intensity: number; summary: string };
  recent: Array<{ who: 'her' | 'him'; intent?: string; emotion?: string }>;
  candidates: JevCandidateRef[];
  relationship: { stage: string; turns: number };
  rules_default: { action: JevAction; motive_id: string | null; reason_code: string };
}

export interface JevOutput {
  action: JevAction;
  motive_id: string | null;
  inner_line: string;
  conflict: JevConflict;
  reason_code: string;
}

export interface JevShadowRecord {
  turnId: string;
  ts: number;
  inputDigest: string;
  input: JevInput;
  jev: JevOutput | null;
  /** `null` = jev 没给出可用决策 */
  agree: boolean | null;
  latencyMs: number;
  errorCode: JevErrorCode | null;
  /** 账本自描述：为什么与规则不同（便于离线分歧分析） */
  changedAction: boolean;
  changedMotive: boolean;
  limitations: string[];
}

export interface AssembleJevInputArgs {
  herValence: number;
  lowPeriodActive: boolean;
  lowPeriodTurns: number;
  ruminationDominant: string | null;
  ruminationStreak: number;
  hisEmotion: string;
  hisIntensity: number;
  hisSummary: string;
  recent: Array<{ who: 'her' | 'him'; intent?: string; emotion?: string }>;
  candidates: Array<{ id: string; kind: string; salience: number; content: string }>;
  relationshipStage: string;
  relationshipTurns: number;
  rulesAction: JevAction;
  rulesMotiveId: string | null;
  rulesReasonCode: string;
}

/** 开关：默认关（关着时代码路径不存在，无任何网络调用） */
export function jevEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_JEV_DECISION === 'true';
}

function clampSigned(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function truncate(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, max).join('');
}

/** 组装 jev 输入（纯函数）：只做归一化/截断/去重/排序，不做任何判断 */
export function assembleJevInput(a: AssembleJevInputArgs): JevInput {
  const seen = new Set<string>();
  const candidates: JevCandidateRef[] = [];
  for (const c of [...(a.candidates ?? [])].sort((x, y) => (Number(y.salience) || 0) - (Number(x.salience) || 0))) {
    const id = truncate(c?.id, 24);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    candidates.push({
      id,
      kind: truncate(c?.kind, 20) || 'unknown',
      salience: clamp01(c?.salience),
      line: truncate(c?.content, 40),
    });
    if (candidates.length >= JEV_MAX_CANDIDATES) break;
  }

  const recent = (a.recent ?? []).slice(-2).map(r => ({
    who: r.who,
    ...(r.intent ? { intent: truncate(r.intent, 20) } : {}),
    ...(r.emotion ? { emotion: truncate(r.emotion, 20) } : {}),
  }));

  return {
    version: 'jev-v0',
    her_state: {
      valence: clampSigned(a.herValence),
      activated: {},
      low_period: a.lowPeriodActive
        ? { active: true, turns: Math.max(0, Math.round(Number(a.lowPeriodTurns) || 0)) }
        : null,
      rumination: a.ruminationDominant
        ? { dominant: truncate(a.ruminationDominant, 20), streak: Math.max(0, Math.round(Number(a.ruminationStreak) || 0)) }
        : null,
    },
    his_turn: {
      emotion: truncate(a.hisEmotion, 20) || 'neutral',
      intensity: clamp01(a.hisIntensity),
      summary: truncate(a.hisSummary, 60),
    },
    recent,
    candidates,
    relationship: {
      stage: truncate(a.relationshipStage, 20) || 'unknown',
      turns: Math.max(0, Math.round(Number(a.relationshipTurns) || 0)),
    },
    rules_default: {
      action: JEV_ACTIONS.includes(a.rulesAction) ? a.rulesAction : 'wait',
      motive_id: a.rulesMotiveId && seen.has(truncate(a.rulesMotiveId, 24)) ? truncate(a.rulesMotiveId, 24) : null,
      reason_code: REASON_CODE_RE.test(a.rulesReasonCode) ? a.rulesReasonCode : 'RULE_DEFAULT',
    },
  };
}

/** 构建 jev 的决策 prompt（纯函数，便于单测逐字比对） */
export function buildJevPrompt(input: JevInput): string {
  return [
    '你在替一段长期亲密关系里的 AI 角色做**这一轮的内心决策**（不是写回复）。',
    '输入里已经给了规则层的决策 `rules_default`。你的任务是判断**要不要改**它。',
    '',
    '只在"她的状态"与"他的情绪"冲突时改判（conflict=her_vs_his）；其余情况原样返回 KEEP_DEFAULT。',
    '硬约束：',
    '1) 不得让她用自己没有的情绪去服务他的好消息；不得假装高兴，也不得冷处理。',
    '2) 她在低谷时允许"低位回应"：可以只是安静陪着（wait），或说一句自己的状态，而不是追问。',
    '3) 安全线不由你决定：让位、主动消息配额、记忆接地都不在你的权限内。',
    `4) inner_line ≤ ${JEV_INNER_LINE_MAX} 字，第一人称，不带引号/括号，不解释原因。`,
    '5) 只输出 JSON，不要解释，不要代码块。',
    '',
    '输出格式（严格）：',
    '{"action":"share|wait|ask","motive_id":"<candidates 里的 id 或 null>","inner_line":"…","conflict":"her_vs_his|none","reason_code":"大写_下划线"}',
    '',
    '--- 输入 ---',
    JSON.stringify(input),
  ].join('\n');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 输入摘要：用于"同一输入是否被重复决策"的离线核对 */
export function jevInputDigest(input: JevInput): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/**
 * 解析并**严格校验** jev 输出。
 * 任一不满足 ⇒ 返回 null（调用方按"没有可用决策"记账，绝不影响主流程）。
 */
export function parseJevOutput(raw: string | null | undefined, input: JevInput): JevOutput | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const o = parsed as Record<string, unknown>;
  if (!JEV_ACTIONS.includes(o.action as JevAction)) return null;
  if (!JEV_CONFLICTS.includes(o.conflict as JevConflict)) return null;
  if (typeof o.reason_code !== 'string' || !REASON_CODE_RE.test(o.reason_code)) return null;
  if (typeof o.inner_line !== 'string') return null;

  const line = o.inner_line.replace(/\s+/g, ' ').trim();
  const len = Array.from(line).length;
  if (len < 1 || len > JEV_INNER_LINE_MAX) return null;
  if (INNER_LINE_FORBIDDEN_RE.test(line)) return null;

  const rawMotiveId = o.motive_id;
  let motiveId: string | null = null;
  if (rawMotiveId !== null && rawMotiveId !== undefined) {
    if (typeof rawMotiveId !== 'string') return null;
    if (!input.candidates.some(c => c.id === rawMotiveId)) return null;
    motiveId = rawMotiveId;
  }

  return {
    action: o.action as JevAction,
    motive_id: motiveId,
    inner_line: line,
    conflict: o.conflict as JevConflict,
    reason_code: o.reason_code,
  };
}

/** 影子模式下"是否与规则一致"：action 与选中的动机都要一致 */
export function jevAgrees(jev: JevOutput, input: JevInput): boolean {
  return jev.action === input.rules_default.action
    && (jev.motive_id ?? null) === (input.rules_default.motive_id ?? null);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : JEV_DEFAULT_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('jev timeout') as Error & { jevTimeout?: boolean };
      err.jevTimeout = true;
      reject(err);
    }, timeoutMs);
    p.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

/** 追加一条影子账本记录（append-only；失败静默 —— 记账绝不拖累主流程） */
export function appendJevShadowRecord(record: JevShadowRecord, logPath = JEV_DEFAULT_LEDGER): void {
  try {
    const dir = dirname(logPath);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    /* 账本写失败不影响任何行为 */
  }
}

export interface RunJevShadowOptions {
  turnId: string;
  input: JevInput;
  callModel: (system: string, user: string) => Promise<string>;
  timeoutMs?: number;
  logPath?: string;
  now?: () => number;
}

export const JEV_SYSTEM_PROMPT = '你是角色内心决策器。只输出 JSON，不要解释。';

/**
 * 跑一次影子决策并记账。
 * **绝不抛异常**；返回的记录可用于日志/离线分析。
 */
export async function runJevShadow(opts: RunJevShadowOptions): Promise<JevShadowRecord> {
  const now = opts.now ?? Date.now;
  const started = now();
  let jev: JevOutput | null = null;
  let errorCode: JevErrorCode | null = null;

  try {
    const raw = await withTimeout(
      opts.callModel(JEV_SYSTEM_PROMPT, buildJevPrompt(opts.input)),
      opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS,
    );
    jev = parseJevOutput(raw, opts.input);
    if (!jev) errorCode = 'PARSE_FAILED';
  } catch (e) {
    const isTimeout = Boolean((e as { jevTimeout?: boolean } | null)?.jevTimeout);
    errorCode = isTimeout ? 'TIMEOUT' : 'CALL_FAILED';
  }

  const record: JevShadowRecord = {
    turnId: opts.turnId,
    ts: started,
    inputDigest: jevInputDigest(opts.input),
    input: opts.input,
    jev,
    agree: jev ? jevAgrees(jev, opts.input) : null,
    latencyMs: Math.max(0, now() - started),
    errorCode,
    changedAction: Boolean(jev) && jev!.action !== opts.input.rules_default.action,
    changedMotive: Boolean(jev) && (jev!.motive_id ?? null) !== (opts.input.rules_default.motive_id ?? null),
    limitations: ['activated-not-wired', 'shadow-only'],
  };

  appendJevShadowRecord(record, opts.logPath ?? JEV_DEFAULT_LEDGER);
  return record;
}
