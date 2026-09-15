// ── v1.7 内在情绪源 (Internal Emotion Sources) ──
// 补上情绪涌现最关键的缺口：**情绪不再只由"用户当前这句话"驱动**。
//
// 内在生活 → 情绪：
//   · 独处久了          → sad 上升 + 想念(love) 微增（孤独感）
//   · 用户久别回来      → joy/love 回升、sad 回落（重逢修复，防"带怨气冷启动"）
//   · 思维图谱产生念头  → wish→love/greed；fear/doubt→fear
//   · 兴趣被检测        → joy/calm 微增
//   · 好奇心发现/洞察    → joy 微增
//
// 防"自嗨漂移 / 闭环正反馈发散"三件套（等价于防过拟合）：
//   ① 弱强度         —— 单个内在事件影响 ≤0.05 量级
//   ② 习惯化         —— 同一事件重复触发效果递减（satiation 计数）
//   ③ 单轮总量上限   —— INTERNAL_TOTAL_CAP，超出按比例缩放
//   ④ 用户信号优先   —— 外部事件（用户说的话）不经此路径，权重天然更高
//
// 纯逻辑模块：无 io/React 依赖。

import type { EmotionState } from './emotionTypes';

export type InternalEventType =
  | 'loneliness'        // 独处/久未互动
  | 'reunion'           // 用户久别回来
  | 'thought_wish'      // 思维图谱：愿望/渴望
  | 'thought_fear'      // 思维图谱：恐惧/担忧
  | 'thought_doubt'     // 思维图谱：怀疑/不确定
  | 'interest'          // 检测到用户兴趣
  | 'discovery'         // 好奇心发现
  | 'insight'           // 生成的洞察
  | 'proactive_ignored'; // 主动消息被忽略

export interface InternalEffect {
  /** 九情增量（正负皆可） */
  emotions?: Record<string, number>;
  /** 太极效价增量 */
  valence?: number;
  /** 唤醒增量 */
  arousal?: number;
}

/** 各内在事件的基础影响（弱强度：单事件 ≤0.08，多数 0.02~0.05） */
export const INTERNAL_EFFECTS: Record<InternalEventType, InternalEffect> = {
  loneliness: { emotions: { sad: 0.05, love: 0.04, calm: -0.02 }, valence: -0.05 },
  reunion: { emotions: { joy: 0.08, love: 0.07, sad: -0.06, fear: -0.02 }, valence: 0.08 },
  thought_wish: { emotions: { love: 0.03, greed: 0.03 }, valence: 0.02 },
  thought_fear: { emotions: { fear: 0.04, sad: 0.02 }, valence: -0.03 },
  thought_doubt: { emotions: { fear: 0.02, calm: -0.01 }, valence: -0.02 },
  interest: { emotions: { joy: 0.03, calm: 0.01 }, valence: 0.02 },
  discovery: { emotions: { joy: 0.04 }, valence: 0.03 },
  insight: { emotions: { joy: 0.02, calm: 0.02 }, valence: 0.02 },
  proactive_ignored: { emotions: { sad: 0.03, fear: 0.02 }, valence: -0.03 },
};

/** 单轮全部内在事件的总影响上限（防闭环发散；超出按比例缩放） */
export const INTERNAL_TOTAL_CAP = 0.1;
/** 习惯化：同一事件第 n 次触发时效果 = base / (1 + satiation * HABITUATION) */
export const HABITUATION = 1.2;
/** 每轮 satiation 的自然消退（避免永久脱敏） */
export const SATIATION_DECAY = 0.85;

export interface InternalEventInput {
  type: InternalEventType;
  /** 0~1，默认 1（乘在 base 上） */
  intensity?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 应用一批内在事件到情感状态。
 * - 习惯化：读 state.internal.satiation（不存在则视为 0），应用后 +1 并整体衰减
 * - 总量上限：所有事件的情绪/效价总绝对影响超过 INTERNAL_TOTAL_CAP 时等比缩放
 */
export function applyInternalEvents(
  state: EmotionState,
  events: InternalEventInput[],
): EmotionState {
  if (!events || events.length === 0) return state;
  const newState = structuredClone(state);

  // 兼容旧状态：补齐 internal 槽位
  const satiation: Record<string, number> = { ...(newState.internal?.satiation ?? {}) };

  const emotionDelta: Record<string, number> = {};
  let valenceDelta = 0;
  let arousalDelta = 0;

  for (const ev of events) {
    const base = INTERNAL_EFFECTS[ev.type];
    if (!base) continue;
    const habituation = 1 / (1 + (satiation[ev.type] ?? 0) * HABITUATION);
    const k = clamp(ev.intensity ?? 1, 0, 1) * habituation;
    if (k <= 0) continue;
    for (const [emo, amount] of Object.entries(base.emotions ?? {})) {
      emotionDelta[emo] = (emotionDelta[emo] ?? 0) + amount * k;
    }
    valenceDelta += (base.valence ?? 0) * k;
    arousalDelta += (base.arousal ?? 0) * k;
    satiation[ev.type] = (satiation[ev.type] ?? 0) + 1;
  }

  // ── 总量上限：情绪与效价一起算，超出等比缩放 ──
  const emotionAbs = Object.values(emotionDelta).reduce((s, v) => s + Math.abs(v), 0);
  const totalAbs = emotionAbs + Math.abs(valenceDelta);
  const scale = totalAbs > INTERNAL_TOTAL_CAP ? INTERNAL_TOTAL_CAP / totalAbs : 1;

  for (const [emo, amount] of Object.entries(emotionDelta)) {
    if (newState.emotions[emo] === undefined) newState.emotions[emo] = 0;
    newState.emotions[emo] = clamp(newState.emotions[emo] + amount * scale, -1, 1);
  }
  newState.taiji.valence = clamp(newState.taiji.valence + valenceDelta * scale, -1, 1);
  newState.taiji.arousal = clamp(newState.taiji.arousal + arousalDelta * scale, 0, 1);

  // ── 习惯化状态更新（整体消退，避免永久脱敏）──
  for (const key of Object.keys(satiation)) {
    satiation[key] = Math.max(0, satiation[key] * SATIATION_DECAY);
  }
  newState.internal = { ...newState.internal, satiation };

  return newState;
}

// ════════════════════════════════════════════════════════════
// 从情境推导内在事件（供 chat 管道调用）
// ════════════════════════════════════════════════════════════

export interface IdleContext {
  /** 用户上次互动距现在多少分钟（undefined = 未知，不产生孤独事件） */
  idleMinutes?: number;
  /** 本轮检测到的用户兴趣数量 */
  interestCount?: number;
  /** 显式思维类型（来自 ThoughtSeed.type，优先于文本分类） */
  thoughtTypes?: InternalEventType[];
  /** 思维内容（无类型时按关键词兜底分类） */
  newThoughts?: string[];
  /** 本轮是否有可分享的发现/洞察 */
  hasDiscovery?: boolean;
  hasInsight?: boolean;
}

/** 把 ThoughtType（wish/fear/doubt/goal/hypothesis/reflection）映射为内在事件 */
export function thoughtTypeToInternal(type: string): InternalEventType | null {
  switch (type) {
    case 'wish':
    case 'goal':
      return 'thought_wish';
    case 'fear':
      return 'thought_fear';
    case 'doubt':
    case 'hypothesis':
      return 'thought_doubt';
    default:
      return null; // reflection 等偏中性，不驱动情绪
  }
}

/** 由思维内容粗分类（无结构化类型时的兜底） */
export function classifyThought(text: string): InternalEventType {
  if (/害怕|担心|恐惧|不安|焦虑|怕失去/.test(text)) return 'thought_fear';
  if (/不确定|疑惑|困惑|纠结|怀疑/.test(text)) return 'thought_doubt';
  return 'thought_wish';
}

/**
 * 把情境翻译成内在事件列表：
 * - 久别重逢（>24h）→ reunion 修复，且**不再**叠加 loneliness（避免又修复又孤独）
 * - 独处 3h 以上 → loneliness（强度随空闲时长增长，12h 封顶）
 * - 思维（优先用显式类型）/ 兴趣 / 发现 / 洞察 → 对应弱事件
 */
export function deriveInternalEvents(ctx: IdleContext): InternalEventInput[] {
  const events: InternalEventInput[] = [];
  const idle = ctx.idleMinutes;

  if (idle !== undefined && idle > 1440) {
    events.push({ type: 'reunion', intensity: 1 });
  } else if (idle !== undefined && idle > 180) {
    // 3h 起有孤独感，12h 达到最强
    events.push({ type: 'loneliness', intensity: clamp((idle - 180) / (720 - 180), 0.2, 1) });
  }

  if ((ctx.interestCount ?? 0) > 0) events.push({ type: 'interest', intensity: 1 });
  if (ctx.thoughtTypes && ctx.thoughtTypes.length > 0) {
    for (const t of ctx.thoughtTypes) events.push({ type: t, intensity: 0.8 });
  } else {
    for (const thought of ctx.newThoughts ?? []) {
      events.push({ type: classifyThought(thought), intensity: 0.8 });
    }
  }
  if (ctx.hasDiscovery) events.push({ type: 'discovery', intensity: 1 });
  if (ctx.hasInsight) events.push({ type: 'insight', intensity: 1 });

  return events;
}
