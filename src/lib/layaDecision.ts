/**
 * Laya 决策层（v1.33）—— 让一个**非自回归的小模型**参与"这一刻她该用哪种方式回应他"
 *
 * 为什么加这一层：`selectStrategy` 的规则链读的全是**数字**（NLU 强度、她的激活量、
 * 连续负面轮数……），它**看不到他说了什么**。"我没事"和"我没事吧？"在规则链眼里是同一句。
 * Laya 是 Jev 协议的那种单次前向的 typed-decision 模型（choice / score / noul），
 * 一次前向 ~0.3~2s（CPU），输入是**文本状态**，输出是**带概率的标签** —— 正好补上这块。
 *
 * ⚠️ **诚实的上限**（写在这里免得以后有人以为它能"理解情绪"）：
 *   上游 README 的 Honest limits 自己写着：base checkpoint 在 typed-decisions 零样本上
 *   **接近随机**（0.362 / 0.352 对 0.318 随机基线）。所以本层的定位是
 *   **"可测量的第二个意见"**，不是"更聪明的决策者"。默认关闭，靠真管道 A/B 裁定。
 *
 * 五条设计约束（与项目既有原则一致）：
 *  1. **纯逻辑**：本文件不发网络请求、不读环境变量（HTTP 在 `server/services/layaClient.ts`）。
 *  2. **允许为空**：解析不出来 → `null` → 调用方回退规则，绝不猜。
 *  3. **守门策略不外包**：crisis / boundary / repair 永远由规则决定（安全第一）。
 *  4. **抑制表是硬边界**：情境抑制掉的策略，模型也不能把它捡回来。
 *  5. **可观测**：每次裁决留一份 `LayaAudit`（选了什么、多自信、为什么没用）。
 */
import type { StrategyType } from './dialogueStrategy.js';

// ════════════════════════════════════════════════════════════
// 1. 契约
// ════════════════════════════════════════════════════════════

/** 运行模式。`off` = 一次网络都不发；`shadow` = 只记账不改判；`on` = 可改判。 */
export type LayaStrategyMode = 'off' | 'shadow' | 'on';

/**
 * **不外包给模型**的策略：危机干预、边界保护、冲突修复。
 *
 * 理由不是"模型做不好"，而是**错了的代价不对称**：这三条错了会伤人，
 * 而规则链在这三条上是确定的、可审计的、有回归测试锁死的。
 */
export const LAYA_GUARDRAIL_STRATEGIES: readonly StrategyType[] = ['crisis', 'boundary', 'repair'];

/**
 * 可以交给模型选的策略（= 规则链 Rule 1~5.5 + 默认 neutral 的全部可能输出）。
 *
 * 注意：这是**候选全集**，实际可选项还要过情境抑制表（`allowed`），
 * 两者取交集才是真正发给模型的 criteria。
 */
export const LAYA_CHOOSABLE_STRATEGIES: readonly StrategyType[] = [
  'empathize', 'accompany', 'redirect', 'explore', 'share', 'desire', 'neutral',
];

/**
 * 给模型看的选项描述。
 *
 * ⚠️ 上游 README 明确提醒：**choice 的 key 是原样渲染的**，别用 `true`/`false`/`yes`/`no`
 * 这种布尔词当标签（模型会去跟标签而不是跟选项描述）。
 *
 * ⚠️⚠️ **选项描述必须短，而且不要写成"不要做什么"**。这一条是实测出来的，不是审美：
 *
 * | 选项描述 | 8 个情景里命中"合理集" | 明显跑偏 | 平均最高概率 |
 * |---|---|---|---|
 * | 长句 + 否定式（"不再深挖这件事…不急着给建议…"） | **0/8**（8 个里 6 个都选 `redirect`） | 4/8 | 0.508 |
 * | 短标签（下面这一版） | 5/5（抽查的 5 个情景） | 0/5 | 0.10~0.40 |
 * | 英文短句（`..._EN`） | 6/8 | 1/8 | 0.435 |
 *
 * 长版把 `redirect` 那条写成了"**不再**深挖这件事，把话题轻轻带到别处去"，
 * 模型于是整体倒向 `redirect`（连"升职了很高兴"都选 redirect）。换成短标签后不再倒向它。
 * 也就是说：**零样本下这层模型的判别力很弱、极易被措辞带偏**（README 的 Honest limits
 * 自己写着 base checkpoint 在 typed-decisions 上接近随机）。
 * 结论：把它当"第二个意见"用、并靠置信度门限大量弃权，而不是当决策者。
 */
export const LAYA_STRATEGY_CRITERIA: Record<string, string> = {
  empathize: '先接住他的情绪',
  accompany: '少说话，陪着',
  redirect: '换个话题',
  explore: '追问细节',
  share: '说自己的事',
  desire: '说出自己想要的',
  neutral: '平淡回应',
};

/**
 * 同一组选项的**英文**描述（诊断用）。
 *
 * 为什么留一份英文：中文选项和中文 state 同时出现时，多语言 checkpoint 的表现明显更差
 * （见 `scripts/probe-laya-strategy.ts` 的实测表）。留一份英文是为了把"模型不会做这件事"
 * 和"它读不懂我们的中文选项"分开——**在拿到数据之前，不假设是哪一个**。
 */
export const LAYA_STRATEGY_CRITERIA_EN: Record<string, string> = {
  empathize: 'acknowledge his feeling first, no advice, no quick comfort',
  accompany: 'say very little, just quietly stay with him',
  redirect: 'move the topic gently elsewhere',
  explore: 'follow up and ask him for more detail',
  share: 'talk about her own things or what she just found',
  desire: 'say what she wants right now, or what she wants him to do',
  neutral: 'a plain reply with no particular lean',
};

export type LayaCriteriaLang = 'zh' | 'en';

/** 模型的原始输出（已归一化为项目自己的策略名）。 */
export interface LayaStrategyVerdict {
  mode: Exclude<LayaStrategyMode, 'off'>;
  /** 模型的首选（已确认在候选集内） */
  strategy: StrategyType;
  /** 首选标签的概率 [0,1] */
  confidence: number;
  /** 全部候选的分布（按概率降序） */
  distribution: { label: string; p: number }[];
  /** Router 实际用的 checkpoint（`routing.model`），用于排查语言误路由 */
  model: string | null;
  /** 端到端耗时（含网络），用于延迟预算 */
  latencyMs: number;
}

/**
 * 规则给了这些策略时，模型的意见**只记账、不采纳**（`outcome: 'rule_wins'`）。
 *
 * 为什么单挑 `accompany`（v1.33 实测，不是审美）：
 * 真管道配对 A/B（48 对，`scripts/ab-laya-strategy.ts`）里，模型 100% 会改判，
 * 而它最常做的一件事就是 `accompany → empathize`（18/48）。那正好是**项目花了三轮调好的一档**
 * —— "她本来就已经沉进去了 ⇒ 少说、陪着、不追问"（v1.29 的首选示例 + v1.30 的让位 omit +
 * v1.31 的让位门槛）。实测代价非常具体：他强度 ≥0.7 的三句里，改判后
 * **追问 0.06→0.83、劝解 0.28→0.89、字数 35.7→72.8（+104%）**，
 * 而且六次里四次以同一句二选一追问收尾（"是更想骂一骂……还是想跟我说说……"）。
 *
 * 所以这条不是"模型做不好"，是**这一档已经有实测过的答案了，不该让一个零样本模型把它改回去**。
 * 反过来，`explore → empathize/neutral` 那部分在同一批数据里方向是好的（更短、更少追问），
 * 所以只收窄这一档，不整体关掉。
 */
export const LAYA_KEEP_ACCOMPANY_STRATEGIES: readonly StrategyType[] = ['accompany'];

/** 每次裁决都留一份：她为什么改判 / 为什么没改判。 */
export interface LayaAudit {
  mode: Exclude<LayaStrategyMode, 'off'>;
  /** 模型最想选的（可能被守门 / 抑制 / 规整档 / 置信度挡下）。模型返回非法标签时为 null。 */
  picked: StrategyType | null;
  confidence: number;
  distribution: { label: string; p: number }[];
  model: string | null;
  latencyMs: number;
  outcome: LayaOutcome;
  note: string;
}

export type LayaOutcome =
  | 'applied'          // 模型改判且被采纳
  | 'agree'            // 模型与规则一致（无论谁对）
  | 'guard'            // 规则给的是守门策略，不外包
  | 'rule_wins'        // 规则给的策略在**不让模型碰**的那一档里（默认 `accompany`）
  | 'suppressed'       // 模型选的策略被情境抑制 / 不在候选集里
  | 'low_confidence'   // 模型置信度低于门槛
  | 'no_verdict'       // 模型没返回 / 解析失败 / 熔断
  | 'shadow';          // shadow 模式：只记账

// ════════════════════════════════════════════════════════════
// 2. 输入 → Laya 的 state 文本
// ════════════════════════════════════════════════════════════

export interface LayaTurnInput {
  /** 他这一轮说的话（必填） */
  userText: string;
  /** NLU 给的情绪标签（人话，中文即可） */
  userEmotionLabel?: string | null;
  /** NLU 给的情绪强度 [0,1] */
  userIntensity?: number | null;
  /** 他这句话的效价方向（>0 正面 / <0 负面） */
  userValence?: number | null;
  /** 她此刻的激活态人话（`activationOf(...).note`），没有就留空 */
  herActivationNote?: string | null;
  /** 她**本轮开始前**最强的负情绪激活量（与 Rule 1 同尺） */
  herNegativeBeforeTurn?: { emotion: string; intensity: number } | null;
  /** 她的太极效价 / 唤醒（原始量，模型看个大概） */
  herValence?: number | null;
  herArousal?: number | null;
  /** 连续负面轮数 */
  consecutiveNegativeRounds?: number | null;
  /** 他多久没说话了（分钟） */
  idleMinutes?: number | null;
  /** 'morning'|'afternoon'|'evening'|'night'|'dawn' */
  timeSlot?: string | null;
  /** 他前几轮说过的话（越近越靠后，只取最后 2 条） */
  recentUserMessages?: string[] | null;
}

/** 单条 state 上限：多语言 checkpoint 是 1024 上下文（options 占 head_max_len=256），
 *  留足余量的同时别让一句啰嗦的话把选项挤掉。 */
export const LAYA_STATE_MAX_CHARS = 480;
export const LAYA_USER_TEXT_MAX_CHARS = 160;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

const TIME_SLOT_ZH: Record<string, string> = {
  morning: '早上', afternoon: '下午', evening: '傍晚', night: '深夜', dawn: '凌晨',
};

/**
 * 把"她这一轮面对的局面"压成一段中文 state。
 *
 * 刻意只写**事实**，不写"她应该怎么办"—— 判断交给模型，措辞里带指令会污染它。
 * 顺序固定，方便在 `DUMP_PROMPT` 式的排查里逐行对切。
 */
export function buildLayaStateText(input: LayaTurnInput): string {
  const lines: string[] = [];

  lines.push(`他刚说的话：「${clip(input.userText, LAYA_USER_TEXT_MAX_CHARS)}」`);

  const emoBits: string[] = [];
  if (input.userEmotionLabel) emoBits.push(input.userEmotionLabel);
  if (typeof input.userIntensity === 'number') emoBits.push(`强度 ${input.userIntensity.toFixed(2)}`);
  if (typeof input.userValence === 'number') {
    emoBits.push(input.userValence >= 0.05 ? '偏正面'
      : input.userValence <= -0.05 ? '偏负面' : '中性');
  }
  if (emoBits.length > 0) lines.push(`他此刻的情绪：${emoBits.join('，')}`);

  const herBits: string[] = [];
  if (typeof input.herValence === 'number') herBits.push(`效价 ${input.herValence.toFixed(2)}`);
  if (typeof input.herArousal === 'number') herBits.push(`唤醒 ${input.herArousal.toFixed(2)}`);
  if (input.herActivationNote) herBits.push(input.herActivationNote);
  if (herBits.length > 0) lines.push(`她自己此刻：${herBits.join('；')}`);

  const neg = input.herNegativeBeforeTurn;
  if (neg && neg.intensity > 0) {
    lines.push(`这一轮开始前她本来就已经沉在里面：${neg.emotion} +${neg.intensity.toFixed(2)}（相对她的基调）`);
  } else {
    lines.push('这一轮开始前她自己是平静的（没有被之前的事带下去）');
  }

  const ctxBits: string[] = [];
  if (typeof input.consecutiveNegativeRounds === 'number' && input.consecutiveNegativeRounds > 0) {
    ctxBits.push(`最近连续 ${input.consecutiveNegativeRounds} 轮他的话都是负面的`);
  }
  if (typeof input.idleMinutes === 'number' && input.idleMinutes >= 1) {
    ctxBits.push(`距上次说话 ${Math.round(input.idleMinutes)} 分钟`);
  }
  if (input.timeSlot && TIME_SLOT_ZH[input.timeSlot]) ctxBits.push(`现在是${TIME_SLOT_ZH[input.timeSlot]}`);
  if (ctxBits.length > 0) lines.push(ctxBits.join('；'));

  const recent = (input.recentUserMessages ?? []).filter(Boolean).slice(-2);
  if (recent.length > 0) {
    lines.push(`他之前说过：${recent.map((m) => `「${clip(m, 60)}」`).join('　')}`);
  }

  return clip(lines.join('\n'), LAYA_STATE_MAX_CHARS);
}

/** Laya 的问题定义（Jev 协议：`{type, instructions, criteria}`）。 */
export interface LayaChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export const LAYA_STANCE_QUESTION_ID = 'stance';

/**
 * 构造发给 Laya 的问题。
 *
 * @param allowed 真正可选的策略（已过情境抑制表）。只把可选项发给模型 ——
 *   让它在"不能选的"里面挑一个再被拒，纯属浪费一次前向。
 * @param lang 选项描述用中文还是英文（诊断用；默认中文）
 */
export function buildLayaQuestions(
  allowed: readonly StrategyType[] = LAYA_CHOOSABLE_STRATEGIES,
  lang: LayaCriteriaLang = 'zh',
): Record<string, LayaChoiceQuestion> {
  const source = lang === 'en' ? LAYA_STRATEGY_CRITERIA_EN : LAYA_STRATEGY_CRITERIA;
  const criteria: Record<string, string> = {};
  for (const s of allowed) {
    const desc = source[s];
    if (desc) criteria[s] = desc;
  }
  return {
    [LAYA_STANCE_QUESTION_ID]: {
      type: 'choice',
      instructions: lang === 'en'
        ? 'He just finished speaking. Which way should she respond to him right now? (pick the single best one)'
        : '他现在说完了。此刻她最该用哪一种方式回应他？（只选一个最合适的）',
      criteria,
    },
  };
}

// ════════════════════════════════════════════════════════════
// 3. 响应 → 裁决
// ════════════════════════════════════════════════════════════

/** 认得出来的全部策略名（守门 + 可裁决；`neutral` 已在可裁决那一组里，不重复列） */
const ALL_STRATEGY_NAMES: readonly string[] = [
  ...LAYA_GUARDRAIL_STRATEGIES, ...LAYA_CHOOSABLE_STRATEGIES,
];

function asStrategy(v: unknown): StrategyType | null {
  if (typeof v !== 'string') return null;
  const key = v.trim().toLowerCase().replace(/[\s_-]+/g, '');
  for (const name of ALL_STRATEGY_NAMES) {
    if (name.toLowerCase() === key) return name as StrategyType;
  }
  // 模型没照 key 回，而是把描述里的词抄了回来（多语言 checkpoint 上实测可能发生）——
  // 只在**唯一命中**时接受，两个都像就放弃（宁可回退规则，也不猜）。
  const hits = Object.entries(LAYA_STRATEGY_CRITERIA)
    .filter(([, desc]) => typeof v === 'string' && v.includes(desc.slice(0, 6)));
  if (hits.length === 1) return hits[0][0] as StrategyType;
  return null;
}

interface LayaChoiceAnswer {
  type?: string;
  choice?: unknown;
  probabilities?: Record<string, unknown>;
  confidence?: unknown;
}

/**
 * 解析 `laya-serve` 的响应（`POST /v1/systemone` 返回 `router.predict()` 的结果）。
 *
 * 实测形状（`laya/agent.py::_decode_answers`）：
 * ```json
 * { "model": "...", "routing": { "model": "multilingual", ... },
 *   "answers": { "stance": { "type": "choice", "choice": "empathize",
 *                            "probabilities": {"empathize": 0.62, ...}, "confidence": 0.62 } },
 *   "usage": { "input_tokens": 0, "output_tokens": 0 } }
 * ```
 *
 * **任何一步不对就返回 null**（调用方回退规则）。这里不抛异常 ——
 * 一个可选的第二个意见，没有资格让主链路失败。
 */
export function parseLayaResponse(
  json: unknown,
  opts: { mode: Exclude<LayaStrategyMode, 'off'>; latencyMs?: number } = { mode: 'on' },
): LayaStrategyVerdict | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const answers = root.answers;
  if (!answers || typeof answers !== 'object') return null;
  const raw = (answers as Record<string, unknown>)[LAYA_STANCE_QUESTION_ID] as LayaChoiceAnswer | undefined;
  if (!raw || typeof raw !== 'object') return null;

  const strategy = asStrategy(raw.choice);
  if (!strategy) return null;

  const distribution: { label: string; p: number }[] = [];
  if (raw.probabilities && typeof raw.probabilities === 'object') {
    for (const [label, p] of Object.entries(raw.probabilities)) {
      const num = typeof p === 'number' ? p : Number(p);
      if (Number.isFinite(num)) distribution.push({ label, p: num });
    }
    distribution.sort((a, b) => b.p - a.p);
  }

  // 置信度优先取**首选标签自己的概率**（分布里查得到就查），
  // 因为 checkpoint 的 `confidence` 是 `confidence_from_probs(p, k)` 的变体，
  // 可能在候选数很少时给出与单个标签概率不同的量；两者不一致时以分布为准。
  let confidence = distribution.find((d) => d.label === strategy)?.p ?? NaN;
  if (!Number.isFinite(confidence)) {
    const c = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
    confidence = Number.isFinite(c) ? c : 0;
  }

  const routing = root.routing;
  const model = routing && typeof routing === 'object'
    ? ((routing as Record<string, unknown>).model as string | undefined) ?? null
    : null;

  return {
    mode: opts.mode,
    strategy,
    confidence,
    distribution,
    model,
    latencyMs: opts.latencyMs ?? 0,
  };
}

// ════════════════════════════════════════════════════════════
// 4. 裁决门（纯函数）
// ════════════════════════════════════════════════════════════

export interface LayaGateResult {
  strategy: StrategyType;
  audit: LayaAudit;
}

/**
 * 把模型的意见和规则的结论合起来 —— **规则始终是默认值**，模型要改判得逐条过关：
 *
 * | 关卡 | 条件 | 结果 |
 * |---|---|---|
 * | 1 | 没有裁决（没返回 / 解析失败 / 熔断） | 用规则，`no_verdict` |
 * | 2 | 规则给的是守门策略（crisis/boundary/repair） | 用规则，`guard` |
 * | 3 | 模型选的标签不在候选集（越界 / 被抑制） | 用规则，`suppressed` |
 * | 4 | 与规则相同 | 用规则，`agree`（记一笔一致率） |
 * | 5 | 规则给的策略在 `ruleWinsFor` 里（默认 `['accompany']`） | 用规则，`rule_wins` |
 * | 6 | 模型置信度 < `minConfidence` | 用规则，`low_confidence` |
 * | 7 | shadow 模式 | 用规则，`shadow` |
 * | 8 | 都过了 | **用模型的**，`applied` |
 *
 * ⚠️ 4 与 5/6 的顺序是**在真管道上实测改过来的**：一开始把置信度放在前面，
 * 于是"模型和规则想的一样、只是不太自信"被记成 `low_confidence` —— 那会把
 * **一致率**这个最重要的指标污染掉（一致而低置信明明是无害的）。
 * 置信度只在**要改判**的时候才有意义，所以它排在"一致"之后。
 * `rule_wins` 也排在"一致"之后（理由同上：一致就是一致，跟它本来会不会被挡无关）。
 */
export function applyLayaVerdict(args: {
  ruleStrategy: StrategyType;
  ruleConfidence: number;
  verdict: LayaStrategyVerdict | null;
  /** 未被情境抑制、可以交给模型的策略 */
  allowed: readonly StrategyType[];
  minConfidence: number;
  /**
   * 规则给了这些策略时**不让模型碰**（默认空 = 不设限）。
   * v1.33 起 `server.ts` 传 `LAYA_KEEP_ACCOMPANY_STRATEGIES`（见那段的实测理由）。
   */
  ruleWinsFor?: readonly StrategyType[];
}): LayaGateResult {
  const { ruleStrategy, verdict, allowed, minConfidence, ruleWinsFor } = args;
  const mode: Exclude<LayaStrategyMode, 'off'> = verdict?.mode ?? 'on';

  const baseAudit = {
    mode,
    picked: verdict?.strategy ?? null,
    confidence: verdict?.confidence ?? 0,
    distribution: verdict?.distribution ?? [],
    model: verdict?.model ?? null,
    latencyMs: verdict?.latencyMs ?? 0,
  };

  const keep = (outcome: LayaOutcome, note: string): LayaGateResult => ({
    strategy: ruleStrategy,
    audit: { ...baseAudit, outcome, note },
  });

  if (!verdict) return keep('no_verdict', '模型没有给出可解析的意见，用规则');

  if (LAYA_GUARDRAIL_STRATEGIES.includes(ruleStrategy)) {
    return keep('guard', `规则给的是守门策略 ${ruleStrategy}，不交给模型`);
  }
  if (!allowed.includes(verdict.strategy)) {
    return keep('suppressed', `模型选了 ${verdict.strategy}，但它不在此刻的候选集里`);
  }
  if (verdict.strategy === ruleStrategy) {
    return keep('agree', `模型与规则都是 ${ruleStrategy}（p=${verdict.confidence.toFixed(2)}）`);
  }
  if (ruleWinsFor && ruleWinsFor.includes(ruleStrategy)) {
    return keep('rule_wins',
      `规则给的是 ${ruleStrategy}（这一档不让模型碰），模型想改判成 ${verdict.strategy}（p=${verdict.confidence.toFixed(2)}）—— 不改`);
  }
  if (verdict.confidence < minConfidence) {
    return keep('low_confidence',
      `模型选 ${verdict.strategy} 但只有 p=${verdict.confidence.toFixed(2)} < ${minConfidence}`);
  }
  if (verdict.mode === 'shadow') {
    return keep('shadow',
      `【shadow】模型想改判 ${ruleStrategy} → ${verdict.strategy}（p=${verdict.confidence.toFixed(2)}），但没动`);
  }
  return {
    strategy: verdict.strategy,
    audit: {
      ...baseAudit,
      outcome: 'applied',
      note: `Laya 改判 ${ruleStrategy} → ${verdict.strategy}（p=${verdict.confidence.toFixed(2)}，模型 ${verdict.model ?? '?'}）`,
    },
  };
}

// ════════════════════════════════════════════════════════════
// 5. 落地
// ════════════════════════════════════════════════════════════
//
// 改判之后要补 `StrategyParams`（规则链没为这条策略算过参数），
// 那个补参数的函数放在**拥有策略语义的模块**里 —— `dialogueStrategy.ts` 的
// `paramsForStrategy()`，因为 `selectRedirectTopic` / `resolveExploreTopics` 都在那儿。
// 本文件刻意不 import 它们：`layaDecision.ts` 只认得"文本进、标签出"。
