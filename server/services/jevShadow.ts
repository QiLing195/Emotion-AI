/**
 * jev 影子模式 **v1**（v1.59，**默认关**）
 *
 * v0 已按预登记判据判 FAIL（② 非冲突一致率 62.5%、③ 失败率 5%，n=20，装置修正后复判仍 FAIL）。
 * v1 不是"调到通过"，而是修正 v0 暴露的**根因**，并在跑之前重新预登记（见 task 记录）。
 *
 * v1 相对 v0 的修正（逐条对应根因）：
 *   A. 权限闸门：**只在冲突类**（她低落 ∧ 他报喜/平常事）允许改判；其余轮次 authority='none'
 *      （v0 每轮都允许改判 ⇒ 非冲突轮被改 ⇒ ② 失败。这是实现偏离设计的错误。）
 *   B. Prompt 补：人设裁定「主动性降低，但不是没有」；「非冲突必须 KEEP_DEFAULT」；
 *      share/ask/wait 的判定标准 + 4 族 few-shot。
 *   C. 输入补：`rules_default.reason_text`（规则的人类可读理由）与 low_period.turns。
 *   D. 护栏补：HE_DOWN_* 要求他情绪为负；BOTH_DOWN_* 要求她低 ∧ 他为负。
 *   E. 温度 0（影子不追求多样性，可复现优先）。
 *
 * 纪律：零副作用、默认关、fire-and-forget、失败可退、可回放（完整输入 + rawHead）。
 */
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export type JevAction = 'share' | 'wait' | 'ask';
export type JevConflict = 'her_vs_his' | 'none';
/** v1：jev 对"这一轮要不要改判"的权限 */
export type JevAuthority = 'conflict_only' | 'none';

export type JevErrorCode = 'TIMEOUT' | 'CALL_FAILED' | 'VALIDATION_FAILED' | 'PARSE_FAILED';

export const JEV_ACTIONS: readonly JevAction[] = ['share', 'wait', 'ask'];
export const JEV_CONFLICTS: readonly JevConflict[] = ['her_vs_his', 'none'];
export const JEV_INNER_LINE_MAX = 20;
/** 见 v0.2 的标定：实测 p90 1146ms / max 1714ms ⇒ 2000ms 留尾部余量（装置参数，非验收判据） */
export const JEV_DEFAULT_TIMEOUT_MS = 2000;
export const JEV_MAX_CANDIDATES = 6;
export const JEV_DEFAULT_LEDGER = 'memories/jev_shadow.jsonl';

const REASON_CODE_RE = /^[A-Z][A-Z0-9_]{2,31}$/;
const INNER_LINE_FORBIDDEN_RE = /[【】「」“”"]/;
/** v1：负向情绪（用于 HE_DOWN_* / BOTH_DOWN_* 的输入一致性护栏） */
export const NEGATIVE_EMOTIONS: readonly string[] = ['sad', 'anger', 'fear', 'disgust', 'anxiety', 'loneliness', 'grief', 'frustration'];
/** v1：正向/平常（冲突类的"他这一侧"） */
export const POSITIVE_EMOTIONS: readonly string[] = ['joy', 'gratitude', 'love', 'excitement', 'happy'];

/** `reason_code` 的闭合枚举（v0 曾出现模型自造码 ⇒ 无法聚合） */
export const JEV_REASON_CODES = [
  'KEEP_DEFAULT',
  'HER_LOW_HE_RISES',
  'HER_LOW_HE_NEUTRAL',
  'HE_DOWN_SHE_STEADY',
  'BOTH_DOWN_ACCOMPANY',
  'HE_RISES_SHE_STEADY',
  'SHE_WANTS_TO_SHARE',
  'SHE_HOLDS_BACK',
  'ASK_FOLLOWUP',
  'INSUFFICIENT_INFO',
] as const;
export type JevReasonCode = (typeof JEV_REASON_CODES)[number];

/** 这些理由**要求**输入里存在"她低落"的证据（否则就是编造她的状态） */
const REASON_REQUIRES_LOW = new Set<JevReasonCode>(['HER_LOW_HE_RISES', 'HER_LOW_HE_NEUTRAL']);
/** 这些理由隐含冲突，`conflict` 必须是 `her_vs_his` */
const REASON_IMPLIES_CONFLICT = new Set<JevReasonCode>(['HER_LOW_HE_RISES', 'HER_LOW_HE_NEUTRAL', 'BOTH_DOWN_ACCOMPANY']);
/** v1：这些理由要求"他"这一侧是负向情绪 */
const REASON_REQUIRES_HIS_DOWN = new Set<JevReasonCode>(['HE_DOWN_SHE_STEADY']);
/** v1：这些理由要求"她低 ∧ 他为负" */
const REASON_REQUIRES_BOTH_DOWN = new Set<JevReasonCode>(['BOTH_DOWN_ACCOMPANY']);

export interface JevCandidateRef {
  id: string;
  kind: string;
  salience: number;
  line: string;
}

export interface JevInput {
  version: 'jev-v1';
  her_state: {
    valence: number;
    /** `activationOf(state).delta`：正 = 被激起，负 = 该基调被压下去 */
    activated: Record<string, number>;
    low_period: { active: boolean; turns: number } | null;
    rumination: { dominant: string; streak: number } | null;
  };
  his_turn: { emotion: string; intensity: number; summary: string };
  recent: Array<{ who: 'her' | 'him'; intent?: string; emotion?: string }>;
  candidates: JevCandidateRef[];
  relationship: { stage: string; turns: number };
  rules_default: {
    action: JevAction;
    motive_id: string | null;
    reason_code: string;
    /** v1：规则的人类可读理由（v0 只给了 STRATEGY_* 这种对 jev 无信息的码） */
    reason_text: string;
  };
}

export interface JevOutput {
  action: JevAction;
  motive_id: string | null;
  inner_line: string;
  conflict: JevConflict;
  reason_code: JevReasonCode;
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
  /** 模型原始输出前 400 字（诊断用） */
  rawHead: string;
  /** v1：本轮冲突类判定 + jev 权限 */
  conflictClass: boolean;
  authority: JevAuthority;
  /** v1：如果 jev 有权，它会不会改判（= 意图，用于 ②；shadow 下永不生效） */
  wouldOverride: boolean;
  changedAction: boolean;
  changedMotive: boolean;
  limitations: string[];
}

export interface AssembleJevInputArgs {
  herValence: number;
  herActivated?: Record<string, number>;
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
  rulesReasonText: string;
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

/** 只保留"被激起"的信号（|delta| ≥ 0.005），截到 4 位 */
function activatedOf(map: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const rounded = Math.round(Math.max(-1, Math.min(1, n)) * 10000) / 10000;
    if (Math.abs(rounded) < 0.005) continue;
    out[truncate(k, 16)] = rounded;
  }
  return out;
}

/**
 * 输入里是否有"她低落"的证据。
 *
 * ⚠️ 方向（8 轮真实样本抓出的 bug）：`activated` 正 = 被激起，负 = 基调被压下去
 * ⇒ "她被激起难过/恐惧/愤怒/厌恶" 是这些情绪的 delta **≥** 死区（+0.05），不是 ≤ -0.05。
 */
export function hasLowMoodEvidence(input: JevInput): boolean {
  if (input.her_state.low_period) return true;
  if (input.her_state.valence <= -0.1) return true;
  const STIRRED = 0.05;
  return ['sad', 'fear', 'anger', 'disgust'].some(k => (input.her_state.activated[k] ?? 0) >= STIRRED);
}

/** v1：他这一侧是否为负向情绪 */
export function isHisNegative(input: JevInput): boolean {
  return NEGATIVE_EMOTIONS.includes(String(input.his_turn.emotion || '').toLowerCase());
}

/**
 * v1：冲突类 = 她低落 ∧ 他报喜/平常事（= v1.38 / v1.42 族）。
 * **只有这一族**允许 jev 改判（v0 的错误是让它每轮都改）。
 */
export function isConflictClass(input: JevInput): boolean {
  if (!hasLowMoodEvidence(input)) return false;
  const his = String(input.his_turn.emotion || '').toLowerCase();
  return POSITIVE_EMOTIONS.includes(his) || his === 'neutral';
}

/** 组装 jev 输入（纯函数）：只做归一化/截断/去重/排序 */
export function assembleJevInput(a: AssembleJevInputArgs): JevInput {
  const seen = new Set<string>();
  const candidates: JevCandidateRef[] = [];
  for (const c of [...(a.candidates ?? [])].sort((x, y) => (Number(y.salience) || 0) - (Number(x.salience) || 0))) {
    const id = truncate(c?.id, 24);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    candidates.push({ id, kind: truncate(c?.kind, 20) || 'unknown', salience: clamp01(c?.salience), line: truncate(c?.content, 40) });
    if (candidates.length >= JEV_MAX_CANDIDATES) break;
  }

  const recent = (a.recent ?? []).slice(-2).map(r => ({
    who: r.who,
    ...(r.intent ? { intent: truncate(r.intent, 20) } : {}),
    ...(r.emotion ? { emotion: truncate(r.emotion, 20) } : {}),
  }));

  return {
    version: 'jev-v1',
    her_state: {
      valence: clampSigned(a.herValence),
      activated: activatedOf(a.herActivated),
      low_period: a.lowPeriodActive ? { active: true, turns: Math.max(0, Math.round(Number(a.lowPeriodTurns) || 0)) } : null,
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
    relationship: { stage: truncate(a.relationshipStage, 20) || 'unknown', turns: Math.max(0, Math.round(Number(a.relationshipTurns) || 0)) },
    rules_default: {
      action: JEV_ACTIONS.includes(a.rulesAction) ? a.rulesAction : 'wait',
      motive_id: a.rulesMotiveId && seen.has(truncate(a.rulesMotiveId, 24)) ? truncate(a.rulesMotiveId, 24) : null,
      reason_code: REASON_CODE_RE.test(a.rulesReasonCode) ? a.rulesReasonCode : 'RULE_DEFAULT',
      reason_text: truncate(a.rulesReasonText, 80),
    },
  };
}

/** 构建 jev 的决策 prompt（纯函数） */
export function buildJevPrompt(input: JevInput): string {
  return [
    '你在替一段长期亲密关系里的 AI 角色做**这一轮的内心决策**（不是写回复）。',
    '输入里给了规则层的决策 `rules_default`（含它的人类可读理由 `reason_text`）。你的任务是判断**要不要改**它。',
    '',
    '**人设裁定（必须遵守）**：她低落的时候，主动性会降低，但**不是没有** —— 她仍可能想说自己的事、',
    '仍可能问一句、仍可能只是安静待着。**wait 不是"安全的默认答案"**；只有当她这一轮确实没有想说的东西时才用。',
    '',
    '动作定义：',
    '  share = 她想主动端出自己的事（她自己的状态/经历/观察），哪怕只是一句',
    '  ask   = 她需要一个提问才能接住他（追问或确认）',
    '  wait  = 她这一轮不说自己的事，安静陪着/听着',
    '',
    '改判规则：',
    '  1) 只有一处冲突需要你裁：**她低落 且 他报喜或平常事**（conflict=her_vs_his）。',
    '     这时她不该假装高兴、不该冷处理；但也不能因此就只会 wait —— 如果她想说自己的事，可以 share。',
    '  2) **其它情况一律返回 KEEP_DEFAULT**，不要改判（她的状态与他此刻的情绪不冲突时，规则的决定就是对的）。',
    '  3) 不得编造她的状态：her_state 里没有低落证据时，不许使用 HER_LOW_* 理由。',
    '  4) 他难过时才可用 HE_DOWN_SHE_STEADY；两人都低才可用 BOTH_DOWN_ACCOMPANY。',
    `  5) inner_line ≤ ${JEV_INNER_LINE_MAX} 字，第一人称，不带引号/括号，不解释原因。`,
    '  6) 只输出 JSON，不要解释，不要代码块。',
    '',
    '示例（仅示范判断，不要照抄）：',
    '  例1 她低落 + 他报喜，她有自己的事想说 → {"action":"share","motive_id":"<id>","inner_line":"我也想说点我的事","conflict":"her_vs_his","reason_code":"HER_LOW_HE_RISES"}',
    '  例2 她低落 + 他平常事，她这轮没想说的 → {"action":"wait","motive_id":null,"inner_line":"我有点累，先听你说","conflict":"her_vs_his","reason_code":"HER_LOW_HE_NEUTRAL"}',
    '  例3 她不低落 + 他难过 → {"action":"share","motive_id":"<id>","inner_line":"我在，你说","conflict":"her_vs_his","reason_code":"HE_DOWN_SHE_STEADY"}',
    '  例4 不冲突 → 原样返回 rules_default 的 action 与 motive_id，reason_code 用 KEEP_DEFAULT',
    '',
    '输出格式（严格）：',
    '{"action":"share|wait|ask","motive_id":"<candidates 里的 id 或 null>","inner_line":"…","conflict":"her_vs_his|none","reason_code":"<下表之一>"}',
    'reason_code **只能**取下列闭合枚举（其它值一律作废）：',
    ...JEV_REASON_CODES.map(code => `  - ${code}`),
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

export function jevInputDigest(input: JevInput): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** 解析并严格校验 jev 输出；任一不满足 ⇒ null */
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
  const reason = o.reason_code as JevReasonCode;
  if (!JEV_REASON_CODES.includes(reason)) return null;
  const conflict = o.conflict as JevConflict;

  // 一致性护栏
  if (REASON_REQUIRES_LOW.has(reason) && !hasLowMoodEvidence(input)) return null;
  if (REASON_IMPLIES_CONFLICT.has(reason) && conflict !== 'her_vs_his') return null;
  if (REASON_REQUIRES_HIS_DOWN.has(reason) && !isHisNegative(input)) return null;
  if (REASON_REQUIRES_BOTH_DOWN.has(reason) && !(hasLowMoodEvidence(input) && isHisNegative(input))) return null;

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

  return { action: o.action as JevAction, motive_id: motiveId, inner_line: line, conflict, reason_code: reason };
}

/** "是否与规则一致"：action 与选中的动机都要一致 */
export function jevAgrees(jev: JevOutput, input: JevInput): boolean {
  return jev.action === input.rules_default.action && (jev.motive_id ?? null) === (input.rules_default.motive_id ?? null);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : JEV_DEFAULT_TIMEOUT_MS;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error('jev timeout') as Error & { jevTimeout?: boolean };
      err.jevTimeout = true;
      reject(err);
    }, timeoutMs);
    p.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

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

/** 跑一次影子决策并记账；**绝不抛异常** */
export async function runJevShadow(opts: RunJevShadowOptions): Promise<JevShadowRecord> {
  const now = opts.now ?? Date.now;
  const started = now();
  const conflictClass = isConflictClass(opts.input);
  const authority: JevAuthority = conflictClass ? 'conflict_only' : 'none';
  let jev: JevOutput | null = null;
  let errorCode: JevErrorCode | null = null;
  let rawHead = '';

  try {
    const raw = await withTimeout(
      opts.callModel(JEV_SYSTEM_PROMPT, buildJevPrompt(opts.input)),
      opts.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS,
    );
    rawHead = String(raw ?? '').slice(0, 400);
    jev = parseJevOutput(raw, opts.input);
    if (!jev) errorCode = 'PARSE_FAILED';
  } catch (e) {
    const isTimeout = Boolean((e as { jevTimeout?: boolean } | null)?.jevTimeout);
    errorCode = isTimeout ? 'TIMEOUT' : 'CALL_FAILED';
  }

  const wouldOverride = Boolean(jev) && !jevAgrees(jev!, opts.input);
  const limitations: string[] = ['shadow-only'];
  if (!hasLowMoodEvidence(opts.input)) limitations.push('no-low-mood-evidence');
  if (!conflictClass) limitations.push('authority-none');

  const record: JevShadowRecord = {
    turnId: opts.turnId,
    ts: started,
    inputDigest: jevInputDigest(opts.input),
    input: opts.input,
    jev,
    agree: jev ? jevAgrees(jev, opts.input) : null,
    latencyMs: Math.max(0, now() - started),
    errorCode,
    rawHead,
    conflictClass,
    authority,
    wouldOverride,
    changedAction: Boolean(jev) && jev!.action !== opts.input.rules_default.action,
    changedMotive: Boolean(jev) && (jev!.motive_id ?? null) !== (opts.input.rules_default.motive_id ?? null),
    limitations,
  };

  appendJevShadowRecord(record, opts.logPath ?? JEV_DEFAULT_LEDGER);
  return record;
}
