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
 *   ② **事实层，不经 LLM 改写**：数字直接从 EmotionState 取，引文只取他的原话（≤12 字）。
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
  trigger: { source: TimelineTriggerSource; hisEmotion: string | null; hisIntensity: number | null; quoted: string | null };
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
export function appendTimelineNode(node: EmotionTimelineNode, path = TIMELINE_DEFAULT_PATH): boolean {
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    rotateIfNeeded(path);
    appendFileSync(path, `${JSON.stringify(node)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** 读最近 k 个节点（Stage 2 的读路径；Stage 1 只用它做验证/测试） */
export function readRecentNodes(k: number, path = TIMELINE_DEFAULT_PATH): EmotionTimelineNode[] {
  try {
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.max(0, k)).map(l => JSON.parse(l) as EmotionTimelineNode);
  } catch {
    return [];
  }
}
