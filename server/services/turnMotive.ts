// ── v1.58 C-1（第一半）：**唯一**的动机选择入口 —— 纯函数，**零副作用** ──
//
// 背景（为什么需要它）：动机选择原本写在 `server.ts` 的路由处理体里（约 797–876 行），
// 而它**依赖 `turnOutput.updatedEmotionState`**（策略之后才有的状态）⇒ 策略层看不到本轮动机。
// 要重排，第一步是让这段逻辑**可以被别处调用**。
//
// 纪律（用户明确要求，也是这次重排里最重要的账本保护条件）：
//   · 这个函数**只读不写**：不 `setMotiveLearning` / 不 `save` / 不 emit。
//     学习账本的更新（`classifyOutcomeFor` + `learnFromOutcome` + `setMotiveLearning` + `save`）
//     被**单独提出去**，作为一轮里**恰好一次**的显式步骤（原先藏在动机选择内部）。
//   · 否则"协调器调用一次、server 复用一次"就会**重复记账**。
//
// ⚠️ 本文件是**逐字搬迁**（candidates 构造 + `selectMotive` 调用），没有行为改动。
//    搬迁后 `server.ts` 调它一次，结果继续被 Prompt 块复用。

import {
  hasStateMotive,
  memoryEchoMotive,
  moderateDeferEnabled,
  openLoopMotiveContent,
  resolveOpenLoops,
  selectMotive,
  stateMotiveFor,
  valueStanceMotive,
  extractOpenLoops,
} from '../../src/lib/motive.js';
import { lowPeriodOf } from '../../src/lib/lowPeriod.js';
import type {
  EmotionState,
  MotiveLearningState,
  MotiveState,
} from '../../src/lib/emotionTypes.js';
import type { MotiveCandidate } from '../../src/lib/motive.js';
import type { UserEmotionAnalysis } from '../../src/lib/emotionEngine.js';

/** `decideProactiveRecall()` 的产出里，动机层真正用到的那两样 */
export interface ProactiveRecallSlice {
  memory?: { id: string; eventSummary?: string } | null;
  injectionText?: string | null;
}

export interface TurnMotiveInput {
  /** **刺激之前**的状态（让位判定问的是"她本来沉不沉"，v1.28） */
  currentEmotionState: EmotionState;
  /** **刺激之后**的状态（`stance` 的价值优先级 / `state` 的心情读数） */
  updatedEmotionState: EmotionState;
  /** 他这一句 */
  userText: string;
  /** 最近的消息（回溯"之前提到"的未完待续） */
  recentMessages?: Array<{ role?: string; content?: unknown }>;
  herNegativeBeforeTurn: { emotion: string; intensity: number };
  userAnalysis?: UserEmotionAnalysis | null;
  /** 主动回忆闸门的结论（记忆回响候选的唯一来源） */
  proactiveDecision?: ProactiveRecallSlice | null;
  learning: MotiveLearningState;
  now: number;
}

export interface TurnMotiveSelection {
  selected: ReturnType<typeof selectMotive>['selected'];
  deferAnchor: ReturnType<typeof selectMotive>['deferAnchor'];
  deferredToUser: boolean;
  nextState: MotiveState;
  pendingCandidates?: MotiveCandidate[];
}

/**
 * v1.58：**本轮她心里挂着什么** —— 唯一入口、纯函数。
 *
 * 输入是"他的这一句 + 她的两个状态 + 回忆闸门结论 + 学习账本"；输出是入选的那一条
 * （含 `kind` / `content` / `salience`）以及要写回状态的部分。**不产生任何写操作**。
 */
export function resolveTurnMotive(input: TurnMotiveInput): TurnMotiveSelection {
  const nowMs = input.now;
  const prevMotive = input.currentEmotionState?.internal?.motive;

  const historyUserTexts = (input.recentMessages ?? [])
    .filter(m => m.role === 'user' && typeof m.content === 'string')
    .slice(-6)
    .map(m => m.content as string);

  const poolState = resolveOpenLoops(prevMotive ?? { pool: [] }, input.userText, nowMs);
  const candidates: MotiveCandidate[] = [];

  // ① 未完待续：他说过但没落定的事（当前消息用"刚说"措辞，历史回溯用"之前提到"）
  const loopSources: Array<{ text: string; current: boolean }> = [
    { text: input.userText, current: true },
    ...[...historyUserTexts].reverse().map(text => ({ text, current: false })),
  ];
  for (const src of loopSources) {
    const hit = extractOpenLoops(src.text, 1)[0];
    if (hit) {
      candidates.push({ kind: 'open_loop', content: openLoopMotiveContent(hit, src.current) });
    }
  }

  // ② 记忆回响：主动回忆闸门选中的旧事（已有 approach/injectionText）
  const recall = input.proactiveDecision;
  if (recall?.memory && recall.injectionText) {
    // v1.54：把**记忆原文**也传进去 —— 动机内容该是"她真能说出口的一句"，不是元指令
    const echo = memoryEchoMotive(recall.injectionText, recall.memory.id, recall.memory.eventSummary);
    if (echo) candidates.push(echo);
  }

  // ③ 价值观立场：她最珍视的价值
  const valueEntries = Object.entries(input.updatedEmotionState?.evolution?.valuePriorities ?? {})
    .sort((a, b) => b[1] - a[1]);
  const topValue = valueEntries[0];
  if (topValue && topValue[1] >= 0.6) {
    const stance = valueStanceMotive(topValue[0]);
    if (stance) candidates.push({ kind: 'stance', content: stance, source: { valueId: topValue[0] } });
  }

  // ④ 内在状态：底色心情偏离中性 → 她今天的状态本身就是想说的事
  //    见 `motive.ts` 的 `stateMotiveFor()`（连续映射）与 `hasStateMotive()`（防两句自述同时在池里）
  const moodNow = input.updatedEmotionState?.internal?.mood;
  const stateAlready = hasStateMotive(poolState.pool ?? [], poolState.pendingCandidates ?? []);
  if (moodNow && moodNow.samples > 0 && !stateAlready) {
    const stateMotive = stateMotiveFor(moodNow.valence);
    if (stateMotive) {
      candidates.push({ kind: 'state', content: stateMotive.content, base: stateMotive.base });
    }
  }

  return selectMotive({
    state: poolState,
    candidates: candidates.filter(c => c.content),
    userText: input.userText,
    // v1.28：传**刺激之前**的量 —— 让位问的是"她本来沉不沉"
    herNegativeBeforeTurn: input.herNegativeBeforeTurn,
    userIntensity: input.userAnalysis?.intensity ?? 0,
    // v1.31：把他的**情绪键**也交给让位判定（`DISABLE_MODERATE_DEFER=true` 时不传 ⇒ 门槛回 0.6）
    userEmotion: moderateDeferEnabled() ? (input.userAnalysis?.expressedEmotion ?? null) : undefined,
    // v1.39：她自己的低谷读数（开关默认关；结构参数 ⇒ 不传就是旧行为）
    herLowPeriod: lowPeriodOf(input.currentEmotionState),
    learning: input.learning,
    now: nowMs,
  });
}
