// 情绪表示层：把「她的基调」和「她被激起的情绪」分开。
//
// ── 为什么需要它（2026-09 实测诊断）──────────────────────────────────────────
// `emotions` 是一个 9 维向量，里面**混着两种东西**：
//   ① 人格基调（静息值）：`INITIAL_EMOTION_STATE` 里 calm 0.8 / greed 0.2 —— 她"平时就是这样"
//   ② 被激起的情绪：用户的话/内在事件/心情造成的位移 —— 这一轮真正发生的事
//
// 任何对**绝对值**取 argmax 的消费者，拿到的基本永远是基调。实测：
//   线上向量 calm 0.439 / greed 0.359 / love .184 / lust .184 / joy .175 / sad .133 …
//   → argmax = calm，只领先 0.08；`getRelevantPatterns: 主导情绪=calm` 连打 20 行
//   用户情绪强度 0.80 持续 8 轮 → 她 sad 只到 0.128，calm 0.92 纹丝不动
//   用户愤怒 0.90（"骂老板"）→ 她 sad 0.007、anger≈0  ← 单轮噪声量级
// 语音层当初被迫加的 `CALM_YIELD_MARGIN`（"否则声音永远平静"）就是同一个病：
// **不是声音的问题，是表示的问题。**
//
// 本模块只做一件事：给出「相对人格基线，她此刻被激起了什么」。
// 它**不改变任何动力学**（不改 emotionEngine 的更新规则），是纯读法。
// ─────────────────────────────────────────────────────────────────────────────

import { INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET, INITIAL_EMOTION_GENTLE } from './emotionTypes';

/** 九情固定键（与情绪引擎的 `emotions` 向量一致） */
export const EMOTION_KEYS = ['joy', 'anger', 'sad', 'fear', 'love', 'disgust', 'lust', 'calm', 'greed'] as const;
export type EmotionKey = (typeof EMOTION_KEYS)[number];

/**
 * 人格静息基线（她"平时就是这样"）。
 *
 * **直接取 `INITIAL_EMOTION_STATE.emotions`，不在这里抄数字** —— 基线是人格常数，
 * 抄一份就会出现两处漂移（改了人格初始化，这里不跟着变，且不会有任何报错）。
 */
export const RESTING_EMOTION_BASELINE: Record<EmotionKey, number> = (() => {
  const src = (INITIAL_EMOTION_STATE.emotions ?? {}) as Record<string, unknown>;
  const out = {} as Record<EmotionKey, number>;
  for (const k of EMOTION_KEYS) {
    const v = src[k];
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return out;
})();

/**
 * 「被激起」的死区：偏离基线小于它就不算她真的被激起。
 *
 * 取 0.05 的依据是**实测标定**，不是拍脑袋（与 `moodLayer` 的死区同源，便于统一口径）：
 * - 单轮噪声：用户愤怒 0.90 的"骂老板"那轮，她的 sad 只动了 **+0.007**（< 0.01）
 * - 真实共情：用户持续低落 0.80 × 8 轮，她的 sad 累积到 **+0.128**
 * → 0.05 高于实测噪声约 7 倍，又不至于把真实但温和的共情滤掉。
 * 与 v1.15「无信号即无误差」同一条原则：**不对噪声做动作**。
 */
export const ACTIVATION_DEADZONE = 0.05;

/** 主导情绪要领先第二名多少，才算"她自己说得清"（否则是矛盾/模糊，下游不该硬演） */
export const ACTIVATION_MARGIN = 0.05;

/**
 * v1.48 她的状态块（进 Prompt 的那一段）是否改读**激发态** —— 开关，**默认关**。
 *
 * 为什么需要它：`buildEmotionContext()` 是她的状态进 Prompt 的**唯一**通路
 * （前端把它的输出拼进 `persona.systemPrompt`），而它的两行一直用**绝对值**读法：
 *   `当前情绪: calm(0.80), love(0.40), greed(0.35)` + `主导情绪: calm。回答时自然地流露出这种情绪。`
 * —— 正是 v1.13 判过的"基调冒充情绪"。v1.16"其余 argmax 读数全部切到激活态"的清单里没有它，
 * 债务表"刻意保留两处"（`contentInjector` / `/state` 兼容字段）里也没有它 ⇒ **漏网，不是刻意**。
 * 真管道探针（`scripts/probe-her-state-in-prompt.ts`）实测：她激活态是「难过（+0.06）」的那一轮，
 * Prompt 里对她说的却是「**主导情绪: calm。回答时自然地流露出这种情绪。**」。
 *
 * 关掉时**逐字节**与旧版相同（由回归测试钉住），所以它可以安全地留在代码里当 A/B 的另一臂。
 */
export function activationStateBlockEnabled(): boolean {
  return process.env.ENABLE_ACTIVATION_STATE === 'true';
}

/**
 * v1.48 状态块改读**激发态**之后，还要回答一个问题：**放在哪**。
 *
 * 第一跑（`scripts/ab-activation-state.ts`，56 格）只改了**前端 persona 里那段**（Prompt 开头，
 * 全文 ~2700 字里只有 ~150 字），实测**她的话一个字都没跟着动**（低位腔 19%→19%，1:1；
 * 基线腔反而 +0.06）——两臂的回复常常逐字相同。原因是位置：真正操纵她的是
 * **末尾**的【此刻我心里挂着的事】与策略片段，开头那一段在这个长度上被稀释掉了（v1.29 已量过）。
 *
 * 所以这个函数产出的是**末尾**的一条短提示（与 `moodPromptHint`/`ruminationPromptHint` 同一类），
 * 由服务端用它**权威的**状态拼（前端那份只是它自己的副本）。
 *
 * 两条纪律（与状态块一致）：
 *  ① **静息时不注入**（返回空串）—— 与心情/反刍提示同一约定："只在确有信号时注入"，
 *     否则每轮都会多出同一句"我很静息"，那本身就是新的机械感；
 *  ② 明说"不用把它说出来" —— 防她把自己的情绪当成一句要宣布的话（v1.38 的教训）。
 */
export function activationHint(
  state?: { emotions?: Record<string, number> | null; baselineEmotions?: Record<string, number> } | null,
): string {
  const a = activationOf(state);
  if (a.resting) return '';
  const parts: string[] = [];
  if (!a.clear && a.runnerUp) {
    parts.push(`${emotionLabel(a.activeEmotion)} +${a.activeIntensity.toFixed(2)} 与 `
      + `${emotionLabel(a.runnerUp)} +${a.runnerUpIntensity.toFixed(2)} 并存`);
  } else {
    parts.push(`${emotionLabel(a.activeEmotion)} +${a.activeIntensity.toFixed(2)}`);
  }
  let line = `【我此刻的状态】${parts.join('')}（相对我平时的底色）。`;
  if (a.suppressed.length > 0) {
    line += `另外，${a.suppressed.map(k => emotionLabel(k)).join('、')}被压低了`;
    line += `（${a.suppressed.map(k => a.delta[k].toFixed(2)).join('、')}）——我此刻并不在那个底色上。`;
  }
  line += '这些不用说出来，但它该在我这一轮的话里。';
  return line;
}

/**
 * 阈值比较的浮点容差。
 *
 * 踩过：`{sad: 0.3 + 0.05, love: 0.3}` 的差算出来是 `0.04999999999999999`，
 * 于是"刚好等于余量"被判成"不明确" —— 判据落在边界上是不可复现的行为，必须给容差。
 */
const EPS = 1e-9;

export interface EmotionActivation {
  /** 用的人格基线（便于诊断时确认口径） */
  baseline: Record<string, number>;
  /** 相对基线的偏离：正 = 被激起，负 = 该基调被压下去 */
  delta: Record<string, number>;
  /** 被激起（正偏离超死区）的情绪里最强的那个；没有 → null（她在静息） */
  activeEmotion: EmotionKey | null;
  activeIntensity: number;
  /** 第二强的被激起情绪（用于判断"说不清"/矛盾） */
  runnerUp: EmotionKey | null;
  runnerUpIntensity: number;
  /** 主导是否明确（领先 ≥ {@link ACTIVATION_MARGIN}） */
  clear: boolean;
  /** 明显**低于**基线的情绪，如 calm 被压低 = 她此刻并不平静 */
  suppressed: EmotionKey[];
  /** 静息：没有任何情绪被显著激起 */
  resting: boolean;
  /** 人话诊断 */
  note: string;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const EMOTION_LABELS: Record<string, string> = {
  joy: '开心', anger: '生气', sad: '难过', fear: '害怕', love: '爱意',
  disgust: '厌烦', lust: '渴望', calm: '平静', greed: '贪念（想要更多）',
};

/** 情绪键 → 人话（未知值原样返回，便于暴露引擎新增了没同步的键） */
export function emotionLabel(k?: string | null): string {
  return EMOTION_LABELS[k ?? ''] ?? (k || '未知');
}

/**
 * 把「绝对值向量」拆成「基调 + 激发态」。
 *
 * @param emotions  `state.emotions`（缺失/非法值按 0 处理）
 * @param baseline  人格基线；默认 {@link RESTING_EMOTION_BASELINE}。
 *                  将来接入人格切换时把 sweet/gentle 的基线传进来即可。
 */
export function separateActivation(
  emotions?: Record<string, number> | null,
  baseline: Record<string, number> = RESTING_EMOTION_BASELINE,
): EmotionActivation {
  const delta: Record<string, number> = {};
  for (const k of EMOTION_KEYS) {
    delta[k] = num(emotions?.[k]) - num(baseline[k]);
  }

  // 只有**正**偏离才算"被激起"；负偏离是"基调被压下去"，单独列出
  const raised = EMOTION_KEYS
    .filter(k => delta[k] >= ACTIVATION_DEADZONE - EPS)
    .sort((a, b) => delta[b] - delta[a]);
  const suppressed = EMOTION_KEYS
    .filter(k => delta[k] <= -(ACTIVATION_DEADZONE - EPS))
    .sort((a, b) => delta[a] - delta[b]);

  const activeEmotion = raised[0] ?? null;
  const activeIntensity = activeEmotion ? delta[activeEmotion] : 0;
  const runnerUp = raised[1] ?? null;
  const runnerUpIntensity = runnerUp ? delta[runnerUp] : 0;
  const clear = activeEmotion !== null && (activeIntensity - runnerUpIntensity) >= ACTIVATION_MARGIN - EPS;
  const resting = activeEmotion === null;

  const note = resting
    ? (suppressed.length
      ? `情绪上没被激起什么，但基调被压低了：${suppressed.map(k => `${emotionLabel(k)} ${delta[k].toFixed(2)}`).join('、')}`
      : '静息：她此刻没有明显情绪（下游不必硬演）')
    : (clear
      ? `${emotionLabel(activeEmotion)}（+${activeIntensity.toFixed(2)} 相对基调）`
      : `${emotionLabel(activeEmotion)}（+${activeIntensity.toFixed(2)}）与 ${emotionLabel(runnerUp)}（+${runnerUpIntensity.toFixed(2)}）并存 —— 她自己也没那么说得清`);

  return {
    baseline: { ...baseline },
    delta,
    activeEmotion,
    activeIntensity,
    runnerUp,
    runnerUpIntensity,
    clear,
    suppressed,
    resting,
    note,
  };
}

/**
 * v1.23 从**状态本身**读激活态 —— 基线取 `state.baselineEmotions`，不再用全局常数。
 *
 * 为什么：三个 persona 的静息值不同（默认 calm .8；**sweet love .4/joy .3**；**gentle calm .9**），
 * 拿默认基线去读 sweet，她**静息时就会被读成「爱意（+0.40）」** —— 人格基调被当成"被激起的情绪"，
 * 与 v1.13 修的那个病是同一枚硬币的两面。基线参数早就留好了（见 emotionActivation.test.ts
 * 里那条"sweet 人格的静息值不同"的用例），只是**从来没有接线**。
 *
 * 老数据没有 `baselineEmotions` → 回退到 {@link RESTING_EMOTION_BASELINE}，行为与 v1.22 完全一致。
 * 之所以让状态自己带基线：调用点（情景记忆/图谱/召回/策略/漂移/`/state`）手上只有 EmotionState，
 * 而**记忆标签与人格漂移读错基线**正是后果最重的两处 —— 状态是唯一能一路带到底的载体。
 */
export function activationOf(
  state?: { emotions?: Record<string, number> | null; baselineEmotions?: Record<string, number> } | null,
): EmotionActivation {
  return separateActivation(state?.emotions, state?.baselineEmotions ?? RESTING_EMOTION_BASELINE);
}

/**
 * v1.25 常态基线（`typicalEmotions`）的 EMA 半衰期，单位**小时**。
 *
 * 由 `scripts/check-adaptive-baseline.ts` 实测标定，取 72h（3 天）的理由：
 * - 太短（如 12h）：一个下午的低落就被学成"常态"，她**再也读不出自己难过**（适应器吞信号）；
 * - 太长（如 30 天）：人设初始值离运行点那么远（实测 calm .397 vs .8），要几周才收敛，
 *   期间 `suppressed` 一直是常驻噪声 —— 问题等于没解；
 * - 72h 下：稳态几轮内收敛（解决常驻噪声），而"他连续低落 8 轮"那种**小时级**的事仍全额可见。
 */
export const EMOTION_TYPICAL_HALF_LIFE_H = 72;

/**
 * 按真实流逝时间更新「她最近一段时间的常态」（慢速 EMA，逐情绪）。
 *
 * ⚠️ **必须在施加本轮刺激之前调用** —— 参照物要反映"过去"，否则会把本轮要检测的信号
 * 吸进参照里（自己把自己的位移抹平）。调用点在 `processTurn` 最开头，读的是**上一轮落定**的值。
 *
 * 冷启动（没有 `typicalEmotions`）从**人格本性**起算，而不是直接跳到当前值：
 * 第一次读数的口径与旧行为连续，随后在一个半衰期里自然收敛到她的真实运行点。
 *
 * 就地修改传入的 state（只写这两个字段），与状态层其余部分保持一致。
 */
export function updateTypicalEmotions(
  state?: {
    emotions?: Record<string, number> | null;
    baselineEmotions?: Record<string, number>;
    typicalEmotions?: Record<string, number>;
    typicalUpdatedAt?: number;
  } | null,
  nowMs: number = Date.now(),
  halfLifeHours: number = EMOTION_TYPICAL_HALF_LIFE_H,
): void {
  if (!state) return;
  const prev = state.typicalEmotions;
  if (!prev) {
    state.typicalEmotions = { ...(state.baselineEmotions ?? RESTING_EMOTION_BASELINE) };
    state.typicalUpdatedAt = nowMs;
    return;
  }
  const last = typeof state.typicalUpdatedAt === 'number' ? state.typicalUpdatedAt : nowMs;
  const hours = Math.max(0, (nowMs - last) / 3_600_000);
  // 时间没走 → 参照不动（同一毫秒内重复调用不该累积）
  const alpha = hours > 0 ? 1 - Math.pow(2, -hours / Math.max(0.001, halfLifeHours)) : 0;
  const next: Record<string, number> = {};
  for (const k of EMOTION_KEYS) {
    const p = num(prev[k]);
    const c = num(state.emotions?.[k]);
    next[k] = p + (c - p) * alpha;
  }
  state.typicalEmotions = next;
  state.typicalUpdatedAt = nowMs;
}

/**
 * v1.25 按**常态**读激活态："相对她最近的样子，此刻被激起了什么"。
 *
 * 与 {@link activationOf}（相对人格本性）**并排使用**，不是替代：
 * - `activationOf` 回答"她偏离自己的本性多远" —— 长期底色会一直挂在里面；
 * - `activationTypicalOf` 回答"她此刻**变了**多少" —— 只报真正的变化，但长期低落会被适应掉。
 * 两个都看，才既知道她此刻怎么了、也知道她最近一直是什么样。
 */
export function activationTypicalOf(
  state?: {
    emotions?: Record<string, number> | null;
    baselineEmotions?: Record<string, number>;
    typicalEmotions?: Record<string, number>;
  } | null,
): EmotionActivation {
  return separateActivation(
    state?.emotions,
    state?.typicalEmotions ?? state?.baselineEmotions ?? RESTING_EMOTION_BASELINE,
  );
}

/**
 * 由 persona id 解析静息基线（前端选人设时用它**盖进状态**）。
 * 认不出的人设返回 undefined → 由调用方保留状态里已有的基线（不乱猜）。
 */
export function baselineForPersona(personaId?: string | null): Record<EmotionKey, number> | undefined {
  if (!personaId) return undefined;
  return PERSONA_BASELINES[personaId];
}

/**
 * persona id → 静息基线。**直接取对应人设的初始九情**，不手抄数字
 * （抄一份就会与 `INITIAL_EMOTION_*` 漂移，且不会有任何报错）。
 * 依赖是懒加载的：`emotionTypes` 里已经有 `INITIAL_EMOTION_*`，这里只做映射与归一。
 */
const PERSONA_BASELINES: Record<string, Record<EmotionKey, number>> = {
  sweet_girlfriend: toBaseline(INITIAL_EMOTION_SWEET.emotions),
  gentle_girlfriend: toBaseline(INITIAL_EMOTION_GENTLE.emotions),
};

/** 把任意九情向量归一成"完整键 + 有限数值"的基线（缺键按 0） */
function toBaseline(emotions?: Record<string, number> | null): Record<EmotionKey, number> {
  const out = {} as Record<EmotionKey, number>;
  for (const k of EMOTION_KEYS) out[k] = num(emotions?.[k]);
  return out;
}

/**
 * 展示成几行（设置页诊断面板 / 自检脚本共用）。
 * 刻意把**两种读法并排**放出来：绝对 argmax（旧）vs 激发态（新）——
 * 不并排就看不出"主导情绪=平静"这个结论有多不可信。
 */
export function describeActivation(
  emotions?: Record<string, number> | null,
  baseline: Record<string, number> = RESTING_EMOTION_BASELINE,
): string[] {
  const a = separateActivation(emotions, baseline);
  const lines: string[] = [];
  const top = [...EMOTION_KEYS]
    .map(k => ({ k, v: num(emotions?.[k]), d: a.delta[k] }))
    .sort((x, y) => Math.abs(y.v) - Math.abs(x.v))[0];

  lines.push(`绝对值读法（旧）：主导 = ${emotionLabel(top?.k)} ${top ? top.v.toFixed(2) : '—'}`
    + '  ← 基调参与竞争，所以她"永远平静"');
  lines.push(`激发态读法（新）：${a.note}`);
  lines.push(`  相对基调的偏离：${EMOTION_KEYS
    .map(k => ({ k, d: a.delta[k] }))
    .sort((x, y) => y.d - x.d)
    .map(({ k, d }) => `${k} ${d >= 0 ? '+' : ''}${d.toFixed(2)}`)
    .join('  ')}`);
  if (a.suppressed.length) {
    lines.push(`  基调被压低：${a.suppressed.map(k => `${emotionLabel(k)} ${a.delta[k].toFixed(2)}`).join('、')}`
      + '（她此刻并不在这个基调上）');
  }
  return lines;
}
