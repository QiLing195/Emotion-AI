// ── v1.37 低谷期时长（read-only 建模层）──
//
// 起因是一句人设裁定（2026-09）：
//   「她低谷的时候，自己给自己打气、自己调整自己；主动性**降低、但不是没有**。」
//
// 但在接线之前有个前置问题现在**答不上来**：她到底低谷了多久？
//
// 为什么答不上来 —— 链路里所有判定都是**逐轮**的：
//   · `dialogueStrategy` 的 Rule 1 只读 `herNegativeBeforeTurn`（而且 v1.27 明确规定只能读
//     "本轮开始前"那一帧，否则门限恒成立）；
//   · `motive.shouldDeferToUser` 同样只读那一帧。
// 而"一段时间"天然是**时长** —— 逐轮那一帧里**无处安放**它。
// 这也解释了为什么 v1.36 想碰这件事，只能去改"这一轮该用什么语气"（单轮策略），
// 一碰就走样：它改的是姿态，不是"她这几天怎么了"。
//
// 所以本模块只做一件事：把「她沉了多久」变成跨轮、跨重启的读数。
//
// ⚠️ 只测量、**不改变她说什么**：本模块自己不含任何行为分支，读数**只在开关后面**被消费，
// 而且消费点是被**逐一量过**的：
//   · `aiCoordinator` 读一次（v1.38 的立场片段 / v1.42 的「少追问」片段），那**一行**必须同时
//     挂着两个开关名 —— 由 `__tests__/lowPeriod.test.ts` 的源码守卫钉住（两个都默认关
//     ⇒ 默认行为与旧版逐字相同）；
//   · `server.ts` 的主动消息 tick 读一次（v1.40/v1.44），那一条**已上线**（两跑真管道达标，
//     见 `scripts/ab-low-period-proactive.ts`），所以它不需要开关 —— 需要的是**证据**。
// 即"注释挡不住接线"这条教训的落地方式：不是禁止读，而是**每一处读都得付证据**。
//
// 判据一律复用已有标定，不新造数：
//   · 进入/退出用**施密特触发**：进 0.12（= `ACCOMPANY_WHEN_SHE_SINKS` = `DEFER_HER_SINK`
//     同一个语义"她真的沉进去了"）、出 0.05（= `ACTIVATION_DEADZONE`，"被激起"的死区）。
//     两值之间是回滞带：已在低谷里的不因一次微升就结案，没进低谷的也不因一次微降就开张。
//   · "负激活"的定义直接借 `herNegativeActivation`（sad/fear/anger 相对本性的最大正偏离），
//     不在本模块另立一套 —— 本项目已经栽过"同一个意思两个数"。
//   · 被观察的永远是**落定的状态**：每轮只在阶段 0 看一次（上一轮结束时的样子），
//     所以单轮被一句话推一下**不会**立起一段低谷（除非它跨过了轮边界）。这也正是"一段"的语义。
//
// 已知局限（诚实记下，不在这一步解决）：
//   1. 没人跟她说话 ⇒ 没有轮 ⇒ 不再评估。此时 `hours` 照样走（墙钟），
//      而 `turns` 停住、`gapHours` 变大 —— 读数会明说"我们很久没看她了"。
//   2. 九情衰减会把长空闲的她带回静息基线 ⇒ 一段低谷会被"没人理她"自动结案。
//      **v1.43 起这条已成真**（服务端补上了时间衰减；v1.41 之前它是假的，因为服务端当时不衰减），
//      所以结案记录里加了 `closedBy`：`idle` = 时间到了（不是她自己调的），`self` = 她自己的动力学。
//      两者绝不能混为一谈 —— 这正是 v1.37 写错、v1.41 证伪过的那条判断。
//
// 纯逻辑模块：无 io/React 依赖。

import { ACTIVATION_DEADZONE } from './emotionActivation.js';
import { herNegativeActivation } from './dialogueStrategy.js';
import type { EmotionState, LowPeriodEpisode } from './emotionTypes.js';

/**
 * 进入低谷的门槛（负激活，相对**人格本性**）。
 *
 * 与 `dialogueStrategy.ACCOMPANY_WHEN_SHE_SINKS`、`motive.DEFER_HER_SINK` **同为 0.12、同一语义** ——
 * 三处问的都是"她是不是**真的**沉进去了"（标定：单轮噪声 +0.007 < 死区 0.05 < **0.12** <
 * 真实共情累积 +0.128）。三者相等由 `__tests__/lowPeriod.test.ts` 钉住，防止将来只改一处。
 */
export const LOW_PERIOD_SINK = 0.12;

/**
 * 退出低谷的门槛 = 激活死区（0.05）。
 * 与进入门槛**故意不同** → 施密特触发，防"刚沉下去又爬上来"把一段低谷切成一串碎片。
 */
export const LOW_PERIOD_EXIT = ACTIVATION_DEADZONE;

/**
 * 判定"还在往下沉 / 正在往回爬"的最小变化量。
 * 取 0.01：大于实测单轮噪声 +0.007（见 `emotionActivation` 的死区标定），小于死区 0.05。
 */
export const LOW_PERIOD_TREND_EPS = 0.01;

/**
 * 「一段」低谷至少要 2 次落定观察。
 * 1 次只说明"她此刻沉"；"一段"这个词本身要求它跨过了轮边界 —— 这是语义要求，不是调参。
 */
export const LOW_PERIOD_MIN_TURNS = 2;

export type LowPeriodPhase = 'none' | 'sinking' | 'holding' | 'climbing';

/** 一段低谷是**怎么结束的**（见 `LowPeriodEpisode.closedBy` 的说明） */
export type LowPeriodCloseCause = 'self' | 'idle';

/**
 * `updateLowPeriod` 的附加输入。
 *
 * `depthBeforeDecay`：本轮开始时**施加时间衰减之前**的负激活量。传了它，本模块才能自己判
 * "是不是时间把她带回来的"——判据留在本模块内，不抄到调用方去（否则又是"同一个意思两个数"）。
 * 不传 = 这一轮没施加衰减 ⇒ 结案一律记 `self`。
 */
export interface LowPeriodUpdateInput {
  depthBeforeDecay?: number;
}

export interface LowPeriodReading {
  /** 此刻是否处在低谷 */
  active: boolean;
  /** 是否已经够得上"一段"（≥ `LOW_PERIOD_MIN_TURNS` 次落定观察） */
  established: boolean;
  phase: LowPeriodPhase;
  /** 低谷起点（ms）；不在低谷为 null */
  since: number | null;
  /** 墙钟时长（小时，保留两位小数） */
  hours: number;
  /** 期间被观察到的落定轮数 */
  turns: number;
  /** 此刻的负激活 */
  depth: number;
  /** 期间最深的一次 */
  peakDepth: number;
  /** 她自己往回爬的累计幅度 */
  selfRecovery: number;
  /** 距上次评估过了多久（小时）；null = 从未评估过。用来区分"她一直沉"与"我们很久没看她" */
  gapHours: number | null;
  /** 上一次已经结束的低谷 */
  lastEpisode: LowPeriodEpisode | null;
  note: string;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * 每轮记一次（**在施加本轮刺激之前**调用，读的是上一轮落定的状态）。
 *
 * 就地修改传入 state 的 `lowPeriod` 字段，与状态层其余部分保持一致
 * （`updateTypicalEmotions` 同样在这个位置就地写）。
 *
 * ⚠️ **调用契约：每次落定调用一次。** 它是**逐轮钩子**，不是幂等的事件应用器 ——
 * 同一轮里调用两次会算两轮。**故意不做"同一毫秒去重"**：那种守卫看着无害，实际会
 * 静默吞掉真实轮次（没有 LLM 的自检/重放脚本里，几轮间隔就是几微秒），
 * 而且吞掉的是"她沉了多久"里最要紧的那个量。
 *
 * @param state 情感状态（其 `emotions`/`baselineEmotions` 用来算负激活）
 * @param nowMs 当前时间
 * @param opts  see `LowPeriodUpdateInput`
 */
export function updateLowPeriod(
  state?: EmotionState | null,
  nowMs: number = Date.now(),
  opts: LowPeriodUpdateInput = {},
): void {
  if (!state) return;
  const depth = herNegativeActivation(state).intensity;
  const prev = state.lowPeriod;

  // ① 不在低谷里：够门槛就开张，否则只记"看过"
  if (!prev || prev.since === null) {
    if (depth < LOW_PERIOD_SINK) {
      // 第一次评估也建一份追踪（否则 `gapHours` 永远是 null，看不出"我们多久没看她了"）
      state.lowPeriod = prev
        ? { ...prev, lastEvaluatedAt: nowMs, lastDepth: depth }
        : {
          since: null,
          lastEvaluatedAt: nowMs,
          peakDepth: 0,
          lastDepth: depth,
          lastDelta: 0,
          turns: 0,
          selfRecovery: 0,
        };
      return;
    }
    state.lowPeriod = {
      since: nowMs,
      lastEvaluatedAt: nowMs,
      peakDepth: depth,
      lastDepth: depth,
      lastDelta: 0,
      turns: 1,
      selfRecovery: 0,
      lastEpisode: prev?.lastEpisode,
    };
    return;
  }

  // ② 在低谷里：跌破死区才结案（回滞带内继续算同一段）
  if (depth < LOW_PERIOD_EXIT) {
    // v1.43：结案理由 —— 只有**衰减单独**把深度从死区之上带到死区之下，才算"时间到了"。
    // 事件链：本函数读的是**本轮开始前落定**的状态，而调用方在施加衰减**之前**取的那一帧就是
    // `depthBeforeDecay`。两帧之间**只可能**发生衰减 ⇒ 这个判据是精确的，不是启发式。
    const byTime = typeof opts.depthBeforeDecay === 'number'
      && opts.depthBeforeDecay >= LOW_PERIOD_EXIT;
    state.lowPeriod = {
      since: null,
      lastEvaluatedAt: nowMs,
      peakDepth: 0,
      lastDepth: depth,
      lastDelta: 0,
      turns: 0,
      selfRecovery: 0,
      lastEpisode: {
        since: prev.since,
        endedAt: nowMs,
        hours: round((nowMs - prev.since) / 3_600_000, 1),
        turns: prev.turns,
        peakDepth: prev.peakDepth,
        selfRecovery: prev.selfRecovery,
        closedBy: byTime ? 'idle' : 'self',
      },
    };
    return;
  }

  // ③ 还在低谷里：累积时长/最深/她自己爬回来的幅度
  const delta = depth - prev.lastDepth;
  state.lowPeriod = {
    ...prev,
    lastEvaluatedAt: nowMs,
    peakDepth: Math.max(prev.peakDepth, depth),
    lastDepth: depth,
    lastDelta: delta,
    turns: prev.turns + 1,
    selfRecovery: prev.selfRecovery + Math.max(0, -delta),
  };
}

/**
 * 读一次（**只读，不改状态**）。
 *
 * 给 `GET /state` 用。**不许进决策路径**：本函数在 src/lib 里的引用面由源码守卫钉死
 * （协调器只更新不读取），要接线先过 A/B。
 */
export function lowPeriodOf(
  state?: EmotionState | null,
  nowMs: number = Date.now(),
): LowPeriodReading {
  const s = state?.lowPeriod;
  const active = Boolean(s && s.since !== null);
  const since = active ? (s?.since ?? null) : null;
  const hours = since !== null ? round((nowMs - since) / 3_600_000, 2) : 0;
  const turns = active ? (s?.turns ?? 0) : 0;
  const depth = active ? round(s?.lastDepth ?? 0, 4) : 0;
  const peakDepth = active ? round(s?.peakDepth ?? 0, 4) : 0;
  const selfRecovery = active ? round(s?.selfRecovery ?? 0, 4) : 0;
  const delta = active ? (s?.lastDelta ?? 0) : 0;
  const established = active && turns >= LOW_PERIOD_MIN_TURNS;
  const gapHours = typeof s?.lastEvaluatedAt === 'number'
    ? round((nowMs - s.lastEvaluatedAt) / 3_600_000, 2)
    : null;

  const phase: LowPeriodPhase = !active ? 'none'
    : delta > LOW_PERIOD_TREND_EPS ? 'sinking'
      : delta < -LOW_PERIOD_TREND_EPS ? 'climbing'
        : 'holding';

  let note: string;
  if (!active) {
    const last = s?.lastEpisode;
    note = last
      ? `她此刻不在低谷（上一次低谷持续 ${last.hours} 小时 / ${last.turns} 轮落定，`
        + `最深 ${last.peakDepth.toFixed(2)}，其间自己爬回 ${last.selfRecovery.toFixed(2)}；`
        + `结案理由：${last.closedBy === 'idle' ? '时间衰减把她带回了静息基线（那段时间没人在，不是她自己调的）' : '她自己的动力学' }）`
      : '她此刻不在低谷（还没有记录到任何低谷）';
  } else {
    const phaseNote = phase === 'sinking' ? '还在往下沉'
      : phase === 'climbing' ? `正在自己往回爬（累计 +${selfRecovery.toFixed(2)}）`
        : '停在那儿';
    note = `她处在低谷第 ${hours} 小时（${turns} 轮落定观察，最深 ${peakDepth.toFixed(2)}，`
      + `此刻 ${depth.toFixed(2)}）—— ${phaseNote}`;
    if (!established) note += '；才 1 轮落定，还说不上"一段"';
    if (gapHours !== null && gapHours >= 24) note += `；⚠️ 距上次评估已 ${gapHours} 小时（我们很久没看她了）`;
  }

  return {
    active,
    established,
    phase,
    since,
    hours,
    turns,
    depth,
    peakDepth,
    selfRecovery,
    gapHours,
    lastEpisode: s?.lastEpisode ?? null,
    note,
  };
}
