// ── v1.12 动机驱动主动消息 (Proactive Messenger) ──
// 解决问题：主动消息只有"定时器"的骨架（rhythmController 的 allowProactive 只被回传、从不执行），
// 而真正该决定"要不要主动找她/他"的是**她心里挂着的事**。
//
// 本模块把动机层接到主动消息出口：
//   动机紧迫度 ≥ 由 persona.proactiveThreshold 推导的门槛 → 才允许发
//   （阈值越高越"矜持"：30 → 0.30，90 → 0.65）
//
// 与 in-chat 动机的区别（主动消息是"打扰"，标准必须更高）：
//   · 空闲足够久（默认 ≥120 分钟）—— 正在聊天时绝不插话
//   · 时间窗与配额交给 rhythmController（9:00-22:00、每日上限、最小间隔 2h）
//   · 消息更短（≤2 句），且**禁止万能问候**（复用反机械化词表）
//   · 生成后同样跑记忆接地校验（复用 memoryGrounding）
//
// 纯逻辑部分（门槛判定 / prompt / 清洗）可单测。

import type { Motive } from '../../src/lib/emotionTypes';

/** 空闲多久才考虑主动（分钟）：正在聊天时不打扰 */
export const PROACTIVE_MIN_IDLE_MINUTES = 120;
/** 主动消息长度上限（字符）：短才有"她自己想起你"的质感 */
export const PROACTIVE_MAX_CHARS = 60;
/** 万能问候/空话（主动消息里一律禁止） */
const BANNED_PATTERNS = [
  /今天过得怎么样/, /最近怎么样/, /在干嘛/, /在吗/, /忙不忙/, /有什么想聊的/, /今天怎么样/,
];

export interface ProactiveGateInput {
  /** persona.proactive 开关 */
  enabled?: boolean;
  /** 距上次互动多少分钟 */
  idleMinutes: number;
  /** rhythmController.canSendProactive() 的结果 */
  quotaAllowed: boolean;
  quotaReason?: string;
  /** persona.proactiveThreshold（30~90），越高越矜持 */
  proactiveThreshold?: number;
  /** 关系阶段（stranger 阶段不主动） */
  relationshipStage?: string;
  /** 当前心情描述（仅用于日志/prompt） */
  moodDescription?: string;
  /**
   * v1.40 她是否处在**已成段**的低谷（结构参数：不传 = 旧行为）。
   * 打开开关时把空闲要求从 120 抬到 `LOW_PERIOD_PROACTIVE_IDLE_MINUTES` —— **推后，不是关掉**。
   */
  inLowPeriod?: boolean;
  /**
   * v1.44 今天已经主动发过几条（由 `rhythmController` 给，`null`/不传 = 这条判据不参与）。
   * 低谷 + 开关打开时，日上限收到 `LOW_PERIOD_PROACTIVE_DAILY_CAP`。
   */
  sentToday?: number;
}

/** 本轮真正生效的空闲要求（分钟） */
export function requiredProactiveIdleMinutes(inLowPeriod = false): number {
  return inLowPeriod && lowPeriodProactiveHoldEnabled()
    ? LOW_PERIOD_PROACTIVE_IDLE_MINUTES
    : PROACTIVE_MIN_IDLE_MINUTES;
}

/**
 * 本轮真正生效的**每日**上限；`null` = 本层不额外限制（交给 `rhythmController` 自己的配额）。
 */
export function requiredProactiveDailyCap(inLowPeriod = false): number | null {
  return inLowPeriod && lowPeriodProactiveHoldEnabled()
    ? LOW_PERIOD_PROACTIVE_DAILY_CAP
    : null;
}

/**
 * 由 persona.proactiveThreshold 推导"需要的动机紧迫度"。
 * 30 → 0.30（比较主动） … 90 → 0.65（很矜持）
 */
export function requiredMotiveSalience(proactiveThreshold = 65): number {
  const t = Math.max(30, Math.min(90, proactiveThreshold));
  return Math.round((0.30 + ((t - 30) / 60) * 0.35) * 100) / 100;
}

/**
 * v1.40/v1.44 「她自己在低谷」时主动消息更矜持 —— **已上线（默认开）**。
 *
 * 人设裁定（2026-09）：她低谷"自闭"时**自己给自己打气、自己调整自己；主动性降低、但不是没有**。
 * 两条杠杆合起来才叫"降低"：
 *   · v1.40 空闲要求 120 → **240** 分钟（推后）
 *   · v1.44 每日上限 2 → **1** 条（当天第一条照发 —— 底线由测试钉住）
 *
 * 为什么现在是默认开：两跑都在**真管道**上按事先判据达标（见
 * `scripts/ab-low-period-proactive.ts` 与 `low-period-proactive-rows.jsonl`）——
 * v1.40 那跑证明"推后"生效且底线守住；v1.44 那跑证明"一天少打扰一次"生效、
 * 底线"当天第一条照样发"守住、静息对照两臂都照常发。裁定原话就是"主动性降低但不是没有"。
 * `DISABLE_LOW_PERIOD_PROACTIVE_HOLD=true` 回退到旧行为（每 2h 可发、每日 2 条）。
 *
 * ⚠️ **为什么不抬"动机紧迫度"门槛**（第一版就是那么写的，已按实测改掉）：
 * 主动这条路上 `userText` 是空的 ⇒ `motiveRelevance('')` 只有 ~0.73，
 * 于是**可达的紧迫度上限只有 `open_loop` 0.80 × 0.73 ≈ 0.58**，而默认门槛已经是 **0.505**
 * —— 整条可达带只有 **0.505 ~ 0.58**（实测：种进去 0.80 的 open_loop，算出来是 0.57）。
 * 在这个带宽上把门槛抬 +0.15 ⇒ 上限够不着 ⇒ 那不是"降低"，是**关掉**，正好是裁定排除的那一档。
 * 抬门槛要能表达"降低但不是没有"，得先有一条比 0.07 更宽的可达带。
 * （顺带记录：persona `proactiveThreshold ≥ 90`（门槛 0.65）在**今天**就已经永远发不出来了。）
 */
export function lowPeriodProactiveHoldDisabled(): boolean {
  return process.env.DISABLE_LOW_PERIOD_PROACTIVE_HOLD === 'true';
}

/** 低谷期的两条杠杆是否生效（默认生效；`DISABLE_LOW_PERIOD_PROACTIVE_HOLD=true` 回退） */
export function lowPeriodProactiveHoldEnabled(): boolean {
  return !lowPeriodProactiveHoldDisabled();
}

/** 低谷期要求的空闲时长（分钟）：把"多久没说话才去打扰他"往后推一倍 */
export const LOW_PERIOD_PROACTIVE_IDLE_MINUTES = 240;

/**
 * v1.44 低谷期的**每日**上限（配额 2→1）。
 *
 * 为什么要加这一条：v1.40 的"推后"只改**最早能发的时刻**（2h→4h），而配额的每日上限与
 * 最小间隔（2h）一起看 ⇒ **一天能发的条数根本没变**。而裁定要的是"主动性**降低**"。诚实地讲：
 * 只推后 2 小时，对一个"一整天在低谷"的她几乎等于没改。这一条才真的让"一天少打扰他一次"。
 *
 * 与"不抬动机门槛"的关系（那条结论不变）：门槛抬不动是**物理**原因（可达带只有 ~0.07 宽，
 * 见 `lowPeriodProactiveHoldEnabled` 的说明）；配额是**独立的一条**，不碰那个带宽。
 * 两条合起来才是"降低但不是没有"：**当天第一条照发**，只是不再有第二条 —— 底线由测试钉住。
 */
export const LOW_PERIOD_PROACTIVE_DAILY_CAP = 1;

/** 主动消息的总闸门（除动机紧迫度之外的所有条件） */
export function evaluateProactiveGates(input: ProactiveGateInput): { allowed: boolean; reason: string } {
  if (input.enabled === false) return { allowed: false, reason: '用户关闭了主动消息' };
  if (input.relationshipStage === 'stranger') {
    return { allowed: false, reason: '还只是陌生人阶段，主动找他会显得唐突' };
  }
  const idleNeed = requiredProactiveIdleMinutes(input.inLowPeriod);
  if (input.idleMinutes < idleNeed) {
    return {
      allowed: false,
      reason: `距上次互动仅 ${Math.round(input.idleMinutes)} 分钟（需 ≥${idleNeed}）`,
    };
  }
  const dailyCap = requiredProactiveDailyCap(input.inLowPeriod);
  if (dailyCap !== null && typeof input.sentToday === 'number' && input.sentToday >= dailyCap) {
    return {
      allowed: false,
      reason: `她自己这几天在低谷：今天已经主动过一次（${input.sentToday}/${dailyCap}）`
        + `—— 降低，但不是没有`,
    };
  }
  if (!input.quotaAllowed) {
    return { allowed: false, reason: input.quotaReason ?? '节奏控制未放行（时间窗/配额/间隔）' };
  }
  return { allowed: true, reason: '闸门通过，等待动机竞选' };
}

/** 主动消息是否可以用这个动机发（紧迫度门槛更高；低谷期不再动这个门槛，见 v1.40 的说明） */
export function passesMotiveThreshold(
  motive: Motive | null,
  proactiveThreshold?: number,
): { ok: boolean; required: number; actual: number; reason: string } {
  const required = requiredMotiveSalience(proactiveThreshold);
  if (!motive) {
    return { ok: false, required, actual: 0, reason: '心里没有挂着的事 → 不主动打扰' };
  }
  const actual = motive.salience ?? 0;
  if (actual < required) {
    return {
      ok: false, required, actual,
      reason: `动机「${motive.kind}」紧迫度 ${actual.toFixed(2)} < 门槛 ${required}（不够想你，就不打扰）`,
    };
  }
  return { ok: true, required, actual, reason: `动机「${motive.kind}」够格主动：${motive.content.slice(0, 24)}` };
}

export interface ProactivePromptContext {
  motive: Motive;
  moodDescription?: string;
  minutesSinceLast?: number;
  relationshipStageLabel?: string;
  /** 最近几轮对话（避免主动消息与刚才说的话重复） */
  recentUserTexts?: string[];
}

/** 构造主动消息的生成 Prompt */
export function buildProactivePrompt(ctx: ProactivePromptContext): string {
  const lines = [
    '你在扮演一个有自己生活的女朋友，现在**主动**发一条消息给他（他有一段时间没说话了）。',
    '要求：',
    '1) 1~2 句，总长 ≤40 字，像随手发来的，不是小作文。',
    '2) 从"我心里挂着的事"出发——可以提那件事、说说你此刻的状态、或者只是分享一个念头。',
    '3) 禁止万能问候（"今天过得怎么样""在干嘛""忙不忙"），禁止连珠炮提问，最多一个问句。',
    '4) 不要编造细节：只能引用下面给你的内容，不确定的事就问，别编。',
    '5) 不要解释你为什么发这条消息，也不要说"我主动找你"这类元描述。',
    '只输出消息正文本身。',
    `\n【我心里挂着的事】${ctx.motive.content}`,
  ];
  if (ctx.moodDescription) lines.push(`【我此刻的状态】${ctx.moodDescription}`);
  if (ctx.minutesSinceLast && ctx.minutesSinceLast > 0) {
    const hours = Math.round(ctx.minutesSinceLast / 60);
    lines.push(`【距他上次说话】约 ${hours} 小时`);
  }
  if (ctx.relationshipStageLabel) lines.push(`【我们现在的阶段】${ctx.relationshipStageLabel}`);
  if (ctx.recentUserTexts?.length) {
    lines.push(`【他最近说过的话（别重复，也别追问同一件事）】\n${ctx.recentUserTexts.slice(-3).map(t => `- ${t.slice(0, 60)}`).join('\n')}`);
  }
  return lines.join('\n');
}

/** 清洗生成结果：去引号/前缀、限长、拦万能问候；返回 null 表示这条不能用 */
export function sanitizeProactiveMessage(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw
    .replace(/^\s*(消息|回复|主动消息)\s*[:：]\s*/, '')
    .replace(/^["'“”『「]+|["'“”』」]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (BANNED_PATTERNS.some(re => re.test(text))) return null;
  if (/^[（(]/.test(text) && text.length <= 6) return null; // 只有动作描写，不算消息
  if (text.length > PROACTIVE_MAX_CHARS * 2) text = text.slice(0, PROACTIVE_MAX_CHARS * 2).trim();
  return text;
}

/** 供日志/观测：这条主动消息的完整判定链 */
export function describeProactiveDecision(parts: {
  gates: { allowed: boolean; reason: string };
  motive: { ok: boolean; reason: string };
}): string {
  if (!parts.gates.allowed) return `不主动：${parts.gates.reason}`;
  if (!parts.motive.ok) return `不主动：${parts.motive.reason}`;
  return `主动：${parts.motive.reason}`;
}
