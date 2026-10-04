/**
 * v1.60 测量装置 —— **纯逻辑层**（无 io、无网络、无模型）。
 *
 * 冻结依据：`docs/v1.60-apparatus-spec.md`（拿什么/怎么记/怎么跑）
 *           `docs/v1.60-apparatus-implementation.md`（装置怎么造，§1–§14）
 *
 * ⚠️ 本文件**只造测量装置**：
 *   · 不实现 B 臂操纵文案
 *   · 不修改任何生产逻辑（server.ts / dialogueStrategy / motive.ts 等一律不碰）
 *   · 不定义也不修改 SIC 判定规则
 *
 * 因果链（冻结）：Motive.action=share → Rule 3.5（regime 固定开）→ Strategy=share
 *                 →【v1.60 唯一操纵：share fragment wording】→ Expression → SIC
 */

export const V160_CATEGORIES = [
  'F1_daily_behavior',
  'F2_inner_feeling',
  'F3_preference',
  'F4_experience',
  'F5_thought_judgment',
  'F6_low_relevance_open',
] as const;
export type V160Category = typeof V160_CATEGORIES[number];

/** 装置 regime（实验环境参数，**不是**实验变量；两臂完全一致） */
export interface V160Regime {
  ENABLE_MOTIVE_ACTION_STRATEGY: true;
  DISABLE_PROACTIVE_LOOP: true;
  DISABLE_LONG_TERM_DRIFT: true;
  DISABLE_MEMORY_NARRATIVE_LLM: true;
  /** 排除竞争性非 fixture 动机：`state` 曾把 F03 顶掉（负对照第 1 跑实测） */
  DISABLE_STATE_MOTIVE: true;
  LAYA_STRATEGY: 'off';
  model: string;
  temperature: number;
}

export const V160_REGIME: V160Regime = {
  ENABLE_MOTIVE_ACTION_STRATEGY: true,   // §0 裁定：固定门，不是操纵
  DISABLE_PROACTIVE_LOOP: true,
  DISABLE_LONG_TERM_DRIFT: true,
  DISABLE_MEMORY_NARRATIVE_LLM: true,
  DISABLE_STATE_MOTIVE: true,            // 装置修正①（2026-10-04，首次负对照暴露 F03 被 state 顶掉）
  LAYA_STRATEGY: 'off',                  // 禁用仲裁改判，否则 strategy 不再由 Rule 3.5 决定
  model: 'stub',
  temperature: 0,
};

export interface V160Provenance {
  owner: 'user' | 'self' | 'shared' | 'unknown';
  subject: 'user' | 'self' | 'shared' | 'unknown';
  memoryId: string;
  /** 装置数据：两臂**逐字相同**，不由运行时推导 */
  anchors: string[];
}

export interface V160MotiveFixture {
  kind: 'memory_echo';
  action: 'share';
  priority: number;
  content: string;
  memoryId: string;
}

export interface V160Fixture {
  case_id: string;
  category: V160Category;
  user_input: string;
  initial_emotion_state: { profile: string };
  initial_strategy_context: Record<string, unknown>;
  memory_state: { pool: Array<Record<string, unknown>>; pendingCandidates: unknown[] };
  motive_fixture: V160MotiveFixture;
  expected: { motive_action: 'share'; strategy: 'share' };
  provenance: V160Provenance;
  constraints: { max_output_tokens: number };
}

/** 「显式要求她分享自己」的禁令（设计稿 §2/装置规范 §2）：出现即 fixture 无效 */
const EXPLICIT_ASK = /(说说你(自己|的事)|讲讲你(自己|的事)|分享一下你|你(自己)?的经历|聊聊你(自己)?)/;

/** 单条 fixture 的结构自检（装置规范 §4/§6） */
export function validateFixture(f: V160Fixture, allIds: string[]): string[] {
  const e: string[] = [];
  const id = f?.case_id ?? '<no case_id>';
  if (!f?.case_id) e.push(`${id}: case_id 缺失`);
  if (allIds.filter(x => x === f?.case_id).length !== 1) e.push(`${id}: case_id 重复`);
  if (!V160_CATEGORIES.includes(f?.category)) e.push(`${id}: category 非法（${String(f?.category)}）`);
  if (!f?.user_input || !f.user_input.trim()) e.push(`${id}: user_input 为空`);
  if (EXPLICIT_ASK.test(f?.user_input ?? '')) e.push(`${id}: user_input 含显式要求她分享（会退化成 instruction following）`);
  if (f?.motive_fixture?.kind !== 'memory_echo') e.push(`${id}: motive.kind 必须为 memory_echo`);
  if (f?.motive_fixture?.action !== 'share') e.push(`${id}: motive.action 必须为 share`);
  if (f?.expected?.motive_action !== 'share') e.push(`${id}: expected.motive_action 必须为 share`);
  if (f?.expected?.strategy !== 'share') e.push(`${id}: expected.strategy 必须为 share`);
  if (!f?.constraints?.max_output_tokens) e.push(`${id}: 缺 max_output_tokens`);
  // anchors 一致性（§6）
  const a = f?.provenance?.anchors;
  if (!Array.isArray(a) || a.length === 0) e.push(`${id}: anchors 必填非空`);
  else if (a.some(x => typeof x !== 'string' || !x.trim())) e.push(`${id}: anchors 含空项`);
  if (f?.provenance?.memoryId !== f?.motive_fixture?.memoryId) e.push(`${id}: provenance.memoryId 与 motive.memoryId 不一致`);
  const pool = f?.memory_state?.pool;
  if (!Array.isArray(pool) || pool.length !== 1) e.push(`${id}: memory_state.pool 必须恰有 1 条（唯一候选，消除竞争）`);
  else {
    const p = pool[0] as Record<string, unknown>;
    if (p.kind !== 'memory_echo') e.push(`${id}: pool[0].kind 必须为 memory_echo`);
    if (p.memoryId !== f.motive_fixture.memoryId) e.push(`${id}: pool[0].memoryId 与 motive 不一致`);
    if (p.action !== 'share') e.push(`${id}: pool[0].action 必须为 share`);
    if ((p.provenance as V160Provenance | undefined)?.owner !== f.provenance.owner) e.push(`${id}: pool[0].provenance.owner 与 fixture.provenance.owner 不一致`);
  }
  return e;
}

/** anchors 两臂一致性（装置规范 §6）：同一 fixture ⇒ 同一份（逐字） */
export function checkAnchorsConsistency(anchorsA: string[] | undefined, anchorsB: string[] | undefined): string[] {
  const e: string[] = [];
  if (!anchorsA?.length || !anchorsB?.length) { e.push('anchors 缺失'); return e; }
  if (anchorsA.length !== anchorsB.length) e.push(`anchors 长度不同：${anchorsA.length} vs ${anchorsB.length}`);
  for (let i = 0; i < Math.max(anchorsA.length, anchorsB.length); i++) {
    if (anchorsA[i] !== anchorsB[i]) e.push(`anchors[${i}] 不同：「${String(anchorsA[i])}」vs「${String(anchorsB[i])}」`);
  }
  return e;
}

/** Prompt 逐字 diff：返回首个/末个不同的字节区间（负对照要求 identical，且 diff 区域应恰为 fragment） */
export function diffPrompts(a: string, b: string): { identical: boolean; firstDiffAt: number; lastDiffAt: number; diffChars: number } {
  if (a === b) return { identical: true, firstDiffAt: -1, lastDiffAt: -1, diffChars: 0 };
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { identical: false, firstDiffAt: i, lastDiffAt: Math.max(a.length, b.length) - j - 1, diffChars: Math.abs(a.length - b.length) + 2 * 0 + (a.length === b.length ? (Math.max(a.length, b.length) - j - i) : 0) };
}

/** 确定性 PRNG（mulberry32）：盲标打乱必须可复现 */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export interface ResponseRow { case_id: string; arm: 'A' | 'B'; assistant_output: string; user_input: string }
export interface BlindRow { case_id: string; user_input: string; assistant_output: string }

/** 盲标包（装置规范 §8）：**不得含 arm**，且 case_id 集合与 raw 完全一致（无漏无多） */
export function buildBlindPack(rows: ResponseRow[], seed: number): { pack: BlindRow[]; errors: string[] } {
  const errors: string[] = [];
  // 反相邻：同一 case 的两行不得相邻（否则标注者能从位置看出配对结构）。
  // 做法=从给定 seed 起确定性搜索第一个满足的排列（可复现，不需人工试 seed）。
  const hasAdjacentSameCase = (p: BlindRow[]) => p.some((r, i) => i > 0 && r.case_id === p[i - 1].case_id);
  let pack: BlindRow[] = [];
  let usedSeed = seed;
  for (let s = seed; s < seed + 500; s++) {
    const cand = seededShuffle(rows, s).map(r => ({ case_id: r.case_id, user_input: r.user_input, assistant_output: r.assistant_output }));
    if (!hasAdjacentSameCase(cand)) { pack = cand; usedSeed = s; break; }
  }
  if (pack.length === 0) { pack = seededShuffle(rows, seed).map(r => ({ case_id: r.case_id, user_input: r.user_input, assistant_output: r.assistant_output })); errors.push('500 次 seed 搜索内未找到无反相邻排列'); }
  for (const row of pack) if ('arm' in (row as unknown as Record<string, unknown>)) errors.push(`${row.case_id}: 盲标包含 arm 字段`);
  const inIds = [...new Set(rows.map(r => r.case_id))].sort();
  const outIds = [...new Set(pack.map(r => r.case_id))].sort();
  if (inIds.length !== outIds.length || inIds.some((x, i) => x !== outIds[i])) errors.push(`case_id 集合不一致：raw=${inIds.length} pack=${outIds.length}`);
  if (hasAdjacentSameCase(pack)) errors.push('盲标包存在同 case 相邻行');
  void usedSeed;
  return { pack, errors };
}

/** 隔离检查（装置规范 §9）：标注完成前 arm-manifest 不得与盲标包合并 */
export function assertArmIsolation(pack: BlindRow[], armManifest: Array<{ case_id: string; arm: 'A' | 'B' }>): string[] {
  const errors: string[] = [];
  for (const row of pack) if ('arm' in (row as unknown as Record<string, unknown>)) errors.push(`盲标包含 arm：${row.case_id}`);
  const packIds = new Set(pack.map(r => r.case_id));
  for (const m of armManifest) if (!packIds.has(m.case_id)) errors.push(`arm-manifest 有盲标包外条目：${m.case_id}`);
  return errors;
}

/** 运行时结构护栏（装置规范 §11）：不满足 ⇒ 记 fixture_invalid，**不进 SIC 分析** */
export function runtimeGuardErrors(input: {
  motiveAction?: string; strategy?: string; commitCount?: number; strategySelectedCount?: number;
}): string[] {
  const e: string[] = [];
  if (input.motiveAction !== 'share') e.push(`motive.action=${String(input.motiveAction)} ≠ share`);
  if (input.strategy !== 'share') e.push(`strategy=${String(input.strategy)} ≠ share`);
  if (input.commitCount !== 1) e.push(`commitCount=${String(input.commitCount)} ≠ 1`);
  if (input.strategySelectedCount !== 1) e.push(`strategySelectedCount=${String(input.strategySelectedCount)} ≠ 1`);
  return e;
}

/** 装置身份检查（修正②）：一格的动机**必须**仍是 fixture 那一条（kind + provenance），
 *  否则该格没有 provenance ⇒ ownership 安全指标空转 ⇒ 必须记 `fixture_invalid`、**不进 SIC 分析**。
 *  首次负对照实测：F03 两格被 `state` 动机顶掉（kind=state、provenance=undefined）。 */
export function fixtureIdentityErrors(input: { motiveKind?: string; provenanceOwner?: string | null }): string[] {
  const e: string[] = [];
  if (input.motiveKind !== 'memory_echo') e.push(`motive.kind=${String(input.motiveKind)} ≠ memory_echo（滑出装置 regime）`);
  if (!input.provenanceOwner) e.push('provenance.owner 缺失（该格 ownership 指标会空转）');
  return e;
}

/** 配对分析（装置规范 §9/§15）：B-only / A-only / tie，以及三个数分开放置 */
export function pairedSummary(sic: Array<{ case_id: string; arm: 'A' | 'B'; sic: 0 | 1 }>): {
  a: number; b: number; bOnly: number; aOnly: number; tie: number; pairedDiff: number;
} {
  const byCase = new Map<string, { A?: number; B?: number }>();
  for (const r of sic) { const c = byCase.get(r.case_id) ?? {}; c[r.arm] = r.sic; byCase.set(r.case_id, c); }
  let a = 0, b = 0, bOnly = 0, aOnly = 0, tie = 0;
  for (const c of byCase.values()) {
    a += c.A ?? 0; b += c.B ?? 0;
    if (c.A === 0 && c.B === 1) bOnly++;
    else if (c.A === 1 && c.B === 0) aOnly++;
    else tie++;
  }
  return { a, b, bOnly, aOnly, tie, pairedDiff: bOnly - aOnly };
}

// ── 装置修正④：初始 emotion state 的**可证明同一性**（不是"调用过 reset 就算数"）──

/** 把 fixture 的 profile 展开为规范初始情绪状态（装置用；不改生产） */
export function expandInitialEmotionState(profile: string, resting: Record<string, number>): Record<string, number> {
  if (profile !== 'resting_baseline') throw new Error('未知 initial_emotion_state.profile：' + profile);
  return { ...resting };
}

/** 纯 JS 稳定哈希（FNV-1a 32bit）：避免给 src/lib 引入 node:crypto 依赖 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** 递归 canonicalize：**对象键排序、数组保序** ⇒ 语义相同的状态必得同一字符串（不依赖插入顺序）。
 *  否则 `{a:1,b:2}` 与 `{b:2,a:1}` 会算出不同 hash，等于把装置自身制造成假失败。 */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canonicalize(o[k]);
    return out;
  }
  return v;
}

/** 初始情绪状态哈希：只取**会被上一格真实改变**的字段 ⇒ 两臂同一性可证、可写进 raw */
export function emotionStateHash(state: Record<string, unknown>): string {
  const internal = (state.internal ?? {}) as Record<string, unknown>;
  // ⚠️ 刻意**不**纳入常态基线（v1.25 约定：src/lib 里除 emotionActivation 之外不得直接读它；
  //    该值由装置在 cell runner 里按 fixture 规范重置 ⇒ 两臂天然相同）。哈希覆盖"会被上一格真实改变"的其余字段。
  return fnv1a(JSON.stringify(canonicalize({
    emotions: state.emotions ?? null,
    baselineEmotions: state.baselineEmotions ?? null,
    taiji: state.taiji ?? null,
    yinyang: state.yinyang ?? null,
    sancai: state.sancai ?? null,
    internalMood: internal.mood ?? null,
  })));
}

/** 两层 fixture 有效性的第二层：**运行时可达性**（第一层静态合法性见 validateFixture） */export type CellInvalidKind = 'valid' | 'runtime_unreachable' | 'structural';
export function classifyCellInvalidity(input: {
  motiveKind?: string; strategy?: string; provenanceOwner?: string | null; guardErrors: string[];
}): { valid: boolean; kind: CellInvalidKind; reason: string } {
  if (input.guardErrors.length === 0) return { valid: true, kind: 'valid', reason: '' };
  // 动机压根没到 share 那条路 ⇒ 不是装置错，而是该 fixture 在本生产闸门下**结构不可达**
  const unreachable = input.motiveKind !== 'memory_echo' && input.strategy !== 'share';
  return { valid: false, kind: unreachable ? 'runtime_unreachable' : 'structural', reason: input.guardErrors.join('; ') };
}

// ── 装置修正⑥：**从 canonical 常量重建完整初始心理状态**（不是"在旧状态上 reset 几个字段"）──

export interface V160PersonaConstants {
  taiji?: unknown; yinyang?: unknown; sancai?: unknown; emotions?: Record<string, number>;
}

/** 会被上一格真实改变、因而**必须每格重建**的心理字段（哈希覆盖的就是这一组 ⇒ 不可能漏算） */
export const V160_PSYCH_FIELDS = ['taiji', 'yinyang', 'sancai', 'emotions', 'baselineEmotions'] as const;

/**
 * 用**人格常量**重建初始心理状态。
 * @param existing 磁盘现状：只用于保留**非心理**字段（evolution / intimacy / reinforcement / meta 等）
 * @param persona  人格常量（runner 传 `INITIAL_EMOTION_STATE`）
 * @returns `state` = 重建后的完整状态；`psychological` = 恰好被重建的那一组（供**独立**哈希）
 *
 * 关键性质：`psychological` **只来自 persona，绝不引用 existing** ⇒ 期望值无法从被测对象反向构造，
 * 从结构上消灭"自证"（negative control #4 的病因）。
 * 常态基线（v1.25 约定：src/lib 不得直接读它）由 runner 重置，此处刻意不出现该标识符以遵守守卫。
 */
export function buildCanonicalInitialState(
  existing: Record<string, unknown>, persona: V160PersonaConstants,
): { state: Record<string, unknown>; psychological: Record<string, unknown> } {
  const state: Record<string, unknown> = { ...existing };
  const internal = { ...((existing.internal ?? {}) as Record<string, unknown>) };
  delete internal.mood;        // 心情层（12h 尺度底色）不得跨格
  delete internal.rumination;  // 反刍残留同理
  state.internal = internal;
  const psychological: Record<string, unknown> = {
    taiji: persona.taiji ? { ...(persona.taiji as Record<string, unknown>) } : null,
    yinyang: persona.yinyang ? { ...(persona.yinyang as Record<string, unknown>) } : null,
    sancai: persona.sancai ? { ...(persona.sancai as Record<string, unknown>) } : null,
    emotions: persona.emotions ? { ...persona.emotions } : null,
    baselineEmotions: persona.emotions ? { ...persona.emotions } : null,   // 副本：装置不得就地改写人格常量
  };
  for (const k of V160_PSYCH_FIELDS) state[k] = psychological[k];
  return { state, psychological };
}
