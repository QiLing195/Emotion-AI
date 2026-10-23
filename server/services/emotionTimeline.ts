/**
 * 情感状态时间线（v1.60 Stage 1）—— **只写，不读，不影响行为**。
 *
 * 为什么需要它（本会话实测暴露的缺口）：
 *   · 原因只能"现场猜"：沉因记录只活在进程内存里（重启丢、会过期）；
 *   · 状态只有"当前值"：没有任何地方能回答"她是**怎么**一步步变成现在这样的"；
 *   · 冻结基线里"自我打气"表达 0/24、0/316，而内部 selfRecovery=0.1227 —— 缺一条
 *     "我这次又是怎么缓过来的"的可回溯链路。
 *
 * 设计约束（对齐"状态外置、转移确定性、可审计"的原则）：
 *   ① **只 append**：一行一个节点，不改任何状态、不参与决策（Stage 1 的读路径为空）。
 *   ② **事实层，不经 LLM 改写**：数字直接从 EmotionState 取；引文只取他的原话（≤12 字），
 *      且 **默认不落盘原文**（v2.23：落盘只有 sha256 前 16 位 + 字符数，原文只在同进程内存缓存里；
 *      `TIMELINE_STORE_QUOTE=true` 才恢复"把原话写进文件"的旧行为）。
 *   ③ 滚动与上限：单文件超过 MAX_BYTES 就滚动为 `.rot-<ts>`，只保留最近 KEEP_ROTATIONS 份。
 *   ④ 默认关：`ENABLE_EMOTION_TIMELINE=true` 才写；关着时连目录都不碰。
 *   ⑤ 写失败静默：日志问题绝不影响对话。
 *
 * 明确**不做**（留给后续阶段）：
 *   · 不读回（Stage 2 才让回复消费"最近 K 个节点"）
 *   · 不记录 branch/outcome（Stage 3）
 *   · 不做学习（Stage 4）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { EmotionState } from '../../src/lib/emotionTypes.js';
import { separateActivation } from '../../src/lib/emotionActivation.js';
import { lowPeriodOf } from '../../src/lib/lowPeriod.js';
import { quoteFromUserText } from '../../src/lib/lowPeriodCause.js';

export const TIMELINE_DEFAULT_PATH = 'memories/emotion_timeline.jsonl';
export const TIMELINE_MAX_BYTES = 2 * 1024 * 1024;   // 单文件 2MB
export const TIMELINE_KEEP_ROTATIONS = 14;          // 保留最近 14 份滚动文件

export function timelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_EMOTION_TIMELINE === 'true';
}

/**
 * v2.23：是否把「他的原话」**写到文件里**。默认 false（只存 hash/长度）。
 * 原因：`memories/emotion_timeline.jsonl` 也是隐私面；但原因链（她说"因为你说…"）需要原文。
 * 折中：原文进**同进程内存缓存**（bounded），读回时按 hash 还原；进程重启后原文丢失，
 * 原因链自然降级成"只说状态、不引原话"。要旧行为（原话落盘）就 `TIMELINE_STORE_QUOTE=true`。
 */
export function timelineStoreQuote(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TIMELINE_STORE_QUOTE === 'true';
}

const QUOTE_CACHE_MAX = 64;
const quoteCache = new Map<string, string>();

/** 引用摘要（不可逆，短；用于同进程读回/去重） */
export function quoteDigest(raw: string): string {
  return createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);
}

function rememberQuote(raw: string | null): string | null {
  if (!raw) return null;
  const hash = quoteDigest(raw);
  if (!quoteCache.has(hash)) {
    quoteCache.set(hash, raw);
    while (quoteCache.size > QUOTE_CACHE_MAX) {
      const oldest = quoteCache.keys().next().value;
      if (!oldest) break;
      quoteCache.delete(oldest);
    }
  }
  return hash;
}

/** 同进程内按摘要取回原文（跨重启/跨进程取不到） */
export function resolveQuoteFromCache(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return quoteCache.get(String(hash)) ?? null;
}

/** 测试用：模拟进程重启（清空内存缓存） */
export function clearTimelineQuoteCache(): void {
  quoteCache.clear();
}

function maskQuote(raw: string | null): { quoted: string | null; quotedHash: string | null; quotedLength: number | null } {
  if (!raw) return { quoted: null, quotedHash: null, quotedLength: null };
  if (timelineStoreQuote()) return { quoted: raw, quotedHash: null, quotedLength: null };
  const hash = rememberQuote(raw);
  return { quoted: null, quotedHash: hash, quotedLength: Array.from(raw).length };
}

/** v2.24：**强制**遮蔽（不看 TIMELINE_STORE_QUOTE），供历史清理脚本使用 */
function maskQuoteAlways(raw: string | null): { quoted: string | null; quotedHash: string | null; quotedLength: number | null } {
  if (!raw) return { quoted: null, quotedHash: null, quotedLength: null };
  return { quoted: null, quotedHash: quoteDigest(raw), quotedLength: Array.from(raw).length };
}

/**
 * v2.24：把一个**已经落盘**的节点重写成脱敏形态（纯函数）。
 * 旧文件里的 `trigger.quoted` / `branch.causeQuoted` 被替换成 hash/长度；返回是否真的改了。
 */
export function redactTimelineNode(node: TimelineRecord): { node: TimelineRecord; changed: boolean } {
  if (node.kind === 'state_change' && node.trigger?.quoted) {
    const masked = maskQuoteAlways(node.trigger.quoted);
    return {
      node: { ...node, trigger: { ...node.trigger, ...masked } },
      changed: true,
    };
  }
  if (node.kind === 'branch' && node.branch?.causeQuoted) {
    const masked = maskQuoteAlways(node.branch.causeQuoted);
    return {
      node: {
        ...node,
        branch: {
          ...node.branch,
          causeQuoted: masked.quoted,
          causeQuotedHash: masked.quotedHash,
          causeQuotedLength: masked.quotedLength,
        },
      },
      changed: true,
    };
  }
  return { node, changed: false };
}

/** 写盘前脱敏：默认不写原文，只写 hash/长度；原文进内存缓存 */
function sanitizeForStorage(node: TimelineRecord): TimelineRecord {
  if (timelineStoreQuote()) return node;
  if (node.kind === 'state_change' && node.trigger?.quoted) {
    return { ...node, trigger: { ...node.trigger, ...maskQuote(node.trigger.quoted) } };
  }
  if (node.kind === 'branch' && node.branch?.causeQuoted) {
    const masked = maskQuote(node.branch.causeQuoted);
    return {
      ...node,
      branch: {
        ...node.branch,
        causeQuoted: masked.quoted,
        causeQuotedHash: masked.quotedHash,
        causeQuotedLength: masked.quotedLength,
      },
    };
  }
  return node;
}

/** 读回时补原文（仅同进程缓存命中；命中不了就保持 null，原因链自动降级） */
export function hydrateTimelineNodes(nodes: TimelineRecord[]): TimelineRecord[] {
  return nodes.map(hydrateFromCache);
}

function hydrateFromCache(node: TimelineRecord): TimelineRecord {
  if (node.kind === 'state_change' && !node.trigger?.quoted && node.trigger?.quotedHash) {
    const raw = resolveQuoteFromCache(node.trigger.quotedHash);
    if (raw) return { ...node, trigger: { ...node.trigger, quoted: raw } };
  }
  if (node.kind === 'branch' && !node.branch?.causeQuoted && node.branch?.causeQuotedHash) {
    const raw = resolveQuoteFromCache(node.branch.causeQuotedHash);
    if (raw) return { ...node, branch: { ...node.branch, causeQuoted: raw } };
  }
  return node;
}

/** 触发来源（事实层：只记录"是什么推动了她"，不解释） */
export type TimelineTriggerSource =
  | 'his_word_negative'
  | 'his_word_positive'
  | 'his_word_neutral'
  | 'unknown';

export interface TimelineFrame {
  /** 太极效价 */
  valence: number;
  /** 相对人格本性被激起的 Top3（情绪键 → 偏移量，正=被激起） */
  top: Array<[string, number]>;
  /** 被压下去的基凋 Top2 */
  suppressedTop: Array<[string, number]>;
  low: {
    active: boolean;
    turns: number;
    depth: number;
    peakDepth: number;
    selfRecovery: number;
    phase: string;
  };
}

export interface EmotionTimelineNode {
  id: string;
  ts: number;
  round: number;
  turnId: string;
  kind: 'state_change';
  trigger: {
    source: TimelineTriggerSource;
    hisEmotion: string | null;
    hisIntensity: number | null;
    quoted: string | null;
    /** v2.23：原文不落盘时的引用摘要（sha256 前 16 位） */
    quotedHash?: string | null;
    quotedLength?: number | null;
  };
  before: TimelineFrame;
  after: TimelineFrame;
  delta: { valence: number; top: Array<[string, number]> };
  /** 关系多轴（若调用方提供）：只读快照，不做任何计算 */
  relationship?: Record<string, number>;
  version: 'tl-v0';
}

const NEGATIVE = new Set(['sad', 'anger', 'fear', 'disgust', 'anxiety', 'loneliness', 'grief', 'frustration']);
const POSITIVE = new Set(['joy', 'gratitude', 'love', 'excitement', 'happy']);

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function frameOf(state: EmotionState | null | undefined): TimelineFrame {
  if (!state) {
    return {
      valence: 0,
      top: [],
      suppressedTop: [],
      low: { active: false, turns: 0, depth: 0, peakDepth: 0, selfRecovery: 0, phase: 'none' },
    };
  }
  const act = separateActivation(state.emotions as unknown as Record<string, number>, state.baselineEmotions as unknown as Record<string, number> | undefined);
  const top = Object.entries(act.delta ?? {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([k, v]) => [k, round4(Number(v))] as [string, number]);
  const suppressedTop = Object.entries(act.suppressed ?? {})
    .filter(([, v]) => Number(v) < 0)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .slice(0, 2)
    .map(([k, v]) => [k, round4(Number(v))] as [string, number]);
  const lp = lowPeriodOf(state);
  return {
    valence: round4(Number(state.taiji?.valence ?? 0)),
    top,
    suppressedTop,
    low: {
      active: Boolean(lp.active),
      turns: Number(lp.turns ?? 0),
      depth: round4(Number(lp.depth ?? 0)),
      peakDepth: round4(Number(lp.peakDepth ?? 0)),
      selfRecovery: round4(Number(lp.selfRecovery ?? 0)),
      phase: String(lp.phase ?? 'none'),
    },
  };
}

function sourceOf(hisEmotion: string | null): TimelineTriggerSource {
  const e = String(hisEmotion ?? '').toLowerCase();
  if (!e) return 'unknown';
  if (NEGATIVE.has(e)) return 'his_word_negative';
  if (POSITIVE.has(e)) return 'his_word_positive';
  return 'his_word_neutral';
}

export interface BuildStateChangeNodeInput {
  ts: number;
  round: number;
  turnId: string;
  userText: string;
  hisEmotion: string | null | undefined;
  hisIntensity?: number | null;
  before: EmotionState | null | undefined;
  after: EmotionState | null | undefined;
  relationshipAxes?: Record<string, number> | null;
}

/** 构建一个 state_change 节点（纯函数，不做 IO） */
export function buildStateChangeNode(input: BuildStateChangeNodeInput): EmotionTimelineNode {
  const before = frameOf(input.before);
  const after = frameOf(input.after);
  const hisEmotion = input.hisEmotion ? String(input.hisEmotion) : null;
  const negative = NEGATIVE.has(String(hisEmotion ?? '').toLowerCase());
  // 引文只从**他这一轮的原话**里截（negative 才引，避免把好消息截成"原因"）
  const quoted = negative ? quoteFromUserText(String(input.userText ?? '')) : null;
  const topDelta = after.top.map(([k, v]) => {
    const prev = before.top.find(([bk]) => bk === k)?.[1] ?? 0;
    return [k, round4(v - prev)] as [string, number];
  });
  return {
    id: `tl_${input.round}_${input.ts}`,
    ts: input.ts,
    round: input.round,
    turnId: input.turnId,
    kind: 'state_change',
    trigger: {
      source: sourceOf(hisEmotion),
      hisEmotion,
      hisIntensity: typeof input.hisIntensity === 'number' ? round4(input.hisIntensity) : null,
      quoted,
    },
    before,
    after,
    delta: { valence: round4(after.valence - before.valence), top: topDelta },
    ...(input.relationshipAxes
      ? {
          relationship: Object.fromEntries(
            Object.entries(input.relationshipAxes)
              .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
              .map(([k, v]) => [k, round4(Number(v))]),
          ),
        }
      : {}),
    version: 'tl-v0',
  };
}

function rotateIfNeeded(path: string): void {
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size < TIMELINE_MAX_BYTES) return;
    const dir = dirname(path);
    const base = path.split(/[\\/]/).pop() ?? 'emotion_timeline.jsonl';
    renameSync(path, `${dir}/${base}.rot-${Date.now()}`);
    const rots = readdirSync(dir).filter(n => n.startsWith(`${base}.rot-`)).sort();
    while (rots.length > TIMELINE_KEEP_ROTATIONS) {
      const old = rots.shift();
      if (old) { try { unlinkSync(`${dir}/${old}`); } catch { /* 忽略 */ } }
    }
  } catch { /* 滚动失败不影响写入 */ }
}

/** 追加一个节点（写失败静默；返回是否写入成功） */
export function appendTimelineNode(node: TimelineRecord, path = TIMELINE_DEFAULT_PATH): boolean {
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateIfNeeded(path);
    appendFileSync(path, `${JSON.stringify(sanitizeForStorage(node))}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读最近 k 个节点（Stage 2 的读路径；Stage 1 只用它做验证/测试） */
export function readRecentNodes(k: number, path = TIMELINE_DEFAULT_PATH): TimelineRecord[] {
  try {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.max(0, k)).map(l => hydrateFromCache(JSON.parse(l) as TimelineRecord));
  } catch {
    return [];
  }
}

// ════════════════════════════════════════════════════════════
// Stage 2：原因链（读最近 K 个节点，取"最早那起因"+"最近一次变化"）
// ════════════════════════════════════════════════════════════

export interface CauseChainEntry {
  round: number;
  ts: number;
  source: string;
  quoted: string | null;
  deltaValence: number;
}

export interface TimelineCause {
  kind: 'his_word' | 'unknown';
  /** **最早那条负向引文**（= 起因事件），双保险地也保留最近一条 */
  quoted: string | null;
  round: number | null;
  latestQuoted: string | null;
  latestRound: number | null;
  chain: CauseChainEntry[];
  evidence: string;
}

/**
 * 从最近节点里构建"原因链"。
 *
 * 为什么取**最早**而不是最近：a3 实测（5 段）中"最近一次负向"往往是他的情绪句
 * （"心里堵得慌/什么都不想干"），而不是起因事件（"被领导当众骂了"）—— 后者才是她真正说得出、
 * 且对用户有意义的原因。所以 origin 取窗口内**最早**的那条负向引文，chain 保留到最近的演化。
 *
 * ⚠️ 为什么还要 `lookbackNodes`：Stage 2 首跑（5 段）日志证明**起因事件常常落在低谷跨线之前**
 * —— 他先说"被领导当众骂了一顿"（深度还没过 0.12），下一句"心里堵得慌"才把深度推过线。
 * 若窗口从 `sinceTs` 才开始，起因事件就被滤掉，origin 退化成情绪句（实测 5/5 如此）。
 * 所以要回看跨线前的若干个节点。
 *
 * @param nodes 最近的节点（调用方用 readRecentNodes 读，按时间升序）
 * @param opts.sinceTs 当前这段低谷的起点（用于定位窗口中心；null = 不过滤）
 * @param opts.lookbackNodes 跨线前回看多少个节点（默认 3）
 */
export function buildCauseChain(
  nodes: TimelineRecord[],
  opts: { sinceTs?: number | null; maxChain?: number; lookbackNodes?: number } = {},
): TimelineCause {
  const since = typeof opts.sinceTs === 'number' ? opts.sinceTs : null;
  const maxChain = Math.max(1, Math.min(5, opts.maxChain ?? 3));
  const lookback = Math.max(0, Math.min(10, opts.lookbackNodes ?? 3));
  let from = 0;
  if (since !== null) {
    const startIdx = nodes.findIndex(n => n.ts >= since);
    from = startIdx < 0 ? 0 : Math.max(0, startIdx - lookback);
  }
  const window = nodes
    .slice(from)
    .filter((n): n is EmotionTimelineNode => n.kind === 'state_change');
  const negatives = window.filter(n => n.trigger.source === 'his_word_negative');
  if (negatives.length === 0) {
    return {
      kind: 'unknown',
      quoted: null,
      round: null,
      latestQuoted: null,
      latestRound: null,
      chain: [],
      evidence: `no_negative_node(since=${since ?? 'any'},from=${from})`,
    };
  }
  const chain = negatives.slice(-maxChain).map(n => ({
    round: n.round,
    ts: n.ts,
    source: n.trigger.source,
    quoted: n.trigger.quoted,
    deltaValence: round4(n.delta.valence),
  }));
  const origin = negatives[0];                    // 窗口内**最早**的负向 = 起因
  const latest = negatives[negatives.length - 1];
  return {
    kind: 'his_word',
    quoted: origin.trigger.quoted,
    round: origin.round,
    latestQuoted: latest.trigger.quoted,
    latestRound: latest.round,
    chain,
    evidence: `origin_round=${origin.round};negatives=${negatives.length};lookback=${lookback};from=${from}`,
  };
}

// ════════════════════════════════════════════════════════════
// Stage 3：分支节点 + 结果节点 + 路径隔离（segment）
// ════════════════════════════════════════════════════════════

/** 她这一轮的**决策分支**（有限枚举，不做自由文本 —— 自由分支无法统计/学习） */
export type BranchKind = 'voice_with_cause' | 'voice' | 'silence' | 'defer' | 'comfort';

export interface TimelineBranchNode {
  id: string;
  ts: number;
  round: number;
  turnId: string;
  kind: 'branch';
  /** 路径隔离：同一段低谷 = 同一个 segment（不同段/分支不共享中间状态） */
  segment: string;
  branch: {
    chosen: BranchKind;
    candidates: BranchKind[];
    authority: 'rules' | 'jev';
    usedVoiceSnippet: boolean;
    causeQuoted: string | null;
    /** v2.23：原文不落盘时的引用摘要 */
    causeQuotedHash?: string | null;
    causeQuotedLength?: number | null;
    /** 她这一轮说的原话前 80 字（outcome 要用它判断"他接住了吗"） */
    replyExcerpt: string;
  };
  context: { lowActive: boolean; lowTurns: number; hisEmotion: string | null };
}

export interface TimelineOutcomeNode {
  id: string;
  ts: number;
  round: number;
  turnId: string;
  kind: 'outcome';
  segment: string;
  /** 指向被评估的那条 branch 的 round */
  refRound: number;
  outcome: { hisReaction: 'landed' | 'missed' | 'unclear'; herDeltaValence: number; hisEmotion: string | null };
}

export type TimelineRecord = EmotionTimelineNode | TimelineBranchNode | TimelineOutcomeNode;

/** 路径隔离标识：一段低谷一个 segment（没有低谷段时用 none —— 分支只在低谷期记） */
export function segmentOf(lowActive: boolean, since: number | null | undefined): string {
  if (!lowActive || typeof since !== 'number') return 'seg_none';
  return `seg_${since}`;
}

const COMFORT_RE = /(抱抱|抱一下|别怕|我陪|在这儿|心疼|辛苦了|别硬撑)/;
const SELF_STATE_RE = /我(?:这两天|今天|最近|这边|也)?[^。！？]{0,8}(沉|闷|空|难受|累|堵|缓|力气|提不起)/;
const NEGATIVE_HIS = new Set(['sad', 'anger', 'fear', 'disgust', 'anxiety', 'loneliness', 'grief', 'frustration']);

const STOP_CHARS = /[的了是我你他她？?，。！、…～\s]/g;

/** 两条文本是否有 ≥minLen 个连续实字重合（用于"她有没有说出那个原因"） */
function sharesAnchor(a: string, b: string, minLen = 3): boolean {
  const x = String(a ?? '').replace(STOP_CHARS, '');
  const y = String(b ?? '').replace(STOP_CHARS, '');
  if (x.length < minLen || y.length < minLen) return false;
  for (let len = Math.min(10, x.length); len >= minLen; len--) {
    for (let i = 0; i + len <= x.length; i++) {
      if (y.includes(x.slice(i, i + len))) return true;
    }
  }
  return false;
}

/**
 * 分支分类（**确定性**，不调模型）：把"她这一轮的选择"归到五类。
 * 只在她处在低谷时调用（不在低谷就不是"低位决策"）。
 */
export function classifyBranch(input: {
  usedVoiceSnippet: boolean;
  causeQuoted: string | null;
  reply: string;
  hisEmotion: string | null;
}): { chosen: BranchKind; candidates: BranchKind[] } {
  const reply = String(input.reply ?? '');
  const hisNeg = NEGATIVE_HIS.has(String(input.hisEmotion ?? '').toLowerCase());
  if (hisNeg) {
    const chosen: BranchKind = COMFORT_RE.test(reply) ? 'comfort' : 'defer';
    return { chosen, candidates: ['defer', 'comfort'] };
  }
  const candidates: BranchKind[] = ['voice_with_cause', 'voice', 'silence'];
  if (input.usedVoiceSnippet) {
    const cause = String(input.causeQuoted ?? '');
    if (cause.length >= 2 && sharesAnchor(reply, cause, 3)) {
      return { chosen: 'voice_with_cause', candidates };
    }
    if (SELF_STATE_RE.test(reply)) return { chosen: 'voice', candidates };
    return { chosen: 'silence', candidates };
  }
  // 没开片段：她仍可能自己说了状态（那就是 voice，不是 silence）
  return { chosen: SELF_STATE_RE.test(reply) ? 'voice' : 'silence', candidates };
}

/** 结果分类（**确定性**）：他下一轮有没有接住她那句话 */
export function classifyOutcome(herReply: string, hisNextText: string): 'landed' | 'missed' | 'unclear' {
  const her = String(herReply ?? '').trim();
  const his = String(hisNextText ?? '').trim();
  if (!her || !his) return 'unclear';
  // ① 共享实词锚点：≥2 个连续实字重合（去掉高频虚词）
  const stop = /[的了是我你他她？，。！、…～\s]/g;
  const a = her.replace(stop, '');
  const b = his.replace(stop, '');
  for (let len = Math.min(8, a.length); len >= 2; len--) {
    for (let i = 0; i + len <= a.length; i++) {
      const sub = a.slice(i, i + len);
      if (b.includes(sub)) return 'landed';
    }
  }
  // ② 他明确回应她（问句 / 对着她说 / 表态）
  if (/[？?]$/.test(his) || /(你|你说|你觉得|你呢|我是问)/.test(his)) return 'landed';
  return 'missed';
}

export function buildBranchNode(input: {
  ts: number;
  round: number;
  turnId: string;
  lowActive: boolean;
  lowSince: number | null | undefined;
  lowTurns: number;
  hisEmotion: string | null;
  usedVoiceSnippet: boolean;
  causeQuoted: string | null;
  reply: string;
  authority?: 'rules' | 'jev';
}): TimelineBranchNode {
  const { chosen, candidates } = classifyBranch({
    usedVoiceSnippet: input.usedVoiceSnippet,
    causeQuoted: input.causeQuoted,
    reply: input.reply,
    hisEmotion: input.hisEmotion,
  });
  return {
    id: `tl_br_${input.round}_${input.ts}`,
    ts: input.ts,
    round: input.round,
    turnId: input.turnId,
    kind: 'branch',
    segment: segmentOf(input.lowActive, input.lowSince),
    branch: {
      chosen,
      candidates,
      authority: input.authority ?? 'rules',
      usedVoiceSnippet: input.usedVoiceSnippet,
      causeQuoted: input.causeQuoted,
      replyExcerpt: Array.from(String(input.reply ?? '')).slice(0, 80).join(''),
    },
    context: { lowActive: input.lowActive, lowTurns: input.lowTurns, hisEmotion: input.hisEmotion },
  };
}

export function buildOutcomeNode(input: {
  ts: number;
  round: number;
  turnId: string;
  segment: string;
  refRound: number;
  herReply: string;
  hisNextText: string;
  hisEmotion: string | null;
  herDeltaValence: number;
}): TimelineOutcomeNode {
  return {
    id: `tl_out_${input.round}_${input.ts}`,
    ts: input.ts,
    round: input.round,
    turnId: input.turnId,
    kind: 'outcome',
    segment: input.segment,
    refRound: input.refRound,
    outcome: {
      hisReaction: classifyOutcome(input.herReply, input.hisNextText),
      herDeltaValence: round4(Number(input.herDeltaValence) || 0),
      hisEmotion: input.hisEmotion,
    },
  };
}


