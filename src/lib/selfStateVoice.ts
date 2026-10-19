/**
 * 「她沉、他报喜/平常事」这一格：**准许她说一句自己此刻的状态**（v1.60，默认关）
 *
 * 为什么要有它（证据）：
 *   · 探针实测（2026-10-19，两臂 6 轮）：内部状态确实沉（sad +0.17 / disgust +0.16 / low=true），
 *     但"他报喜"那一轮她**一个字都不说自己的状态**；只有被直接问（"你今天感觉怎么样"）才说。
 *   · 更早的真实使用里，`lowPeriod.lastEpisode` 显示 selfRecovery=0.1227、closedBy="self"
 *     ⇒ **她心里确实在自我调整**，缺的不是情绪，而是"说出来的许可"。
 *   · 5×2 复现：许可生效后 4/4 出现自我状态表达，但全部是「说不上来为什么」——**归因 0/4**。
 *     查下来是结构性的（低期没有原因字段、state 动机明文禁原因）⇒ v1.60 补 `lowPeriodCause`，
 *     让"原因"只能从**真实信号**派生（动机池/反刍链），派生不出来就诚实说"说不上来"。
 *
 * 与 v1.38 / v1.42 的关系（重要）：
 *   · 那两个既有片段都明文写着「❌ 不要转身讲自己的事」——它们测的是"低位**接住**他"，
 *     而本实验测的是"**可以说一句自己**"。方向不同，所以不能复用它们的片段。
 *   · 优先级：本片段 > v1.38 立场片段 > 旧片段（三者同时开会互相矛盾，故显式规定）。
 *
 * 纪律：守门策略（crisis/boundary/repair）**永不**替换 —— 与 v1.38 同一条原则。
 */
import type { StrategyType } from './dialogueStrategy.js';
import type { LowPeriodCause } from './lowPeriodCause.js';

export function selfStateVoiceEnabled(): boolean {
  return process.env.ENABLE_SELF_STATE_VOICE === 'true';
}

/**
 * 是否允许"从**对话记录**归因"（默认关）。
 *
 * 为什么单开一条：她手里本来就有对话记录（prompt 带 recentMessages），但片段只允许用两条派生来源
 * （动机池/反刍）⇒ 4/4 全落"说不上来"。而"他刚才那句话让我沉"是最容易拿到、也最真实的归因 ——
 * 数据本来就在，只是没被允许用。开启后仍要求**引他说过的内容，不许编**。
 */
export function causeFromDialogueEnabled(): boolean {
  return process.env.ENABLE_SELF_STATE_CAUSE_FROM_DIALOGUE === 'true';
}

/** 守门策略永不替换（与 LOW_PERIOD_STANCE_EXCLUDED 同义） */
export const SELF_STATE_VOICE_EXCLUDED: ReadonlySet<StrategyType> =
  new Set<StrategyType>(['crisis', 'boundary', 'repair']);

/**
 * 构建片段文字（纯函数）。
 *
 * 核心是"**可以**说一句（不是必须说、也不是禁止说）"，并把两件坏事划死：
 * 假装高兴 / 展开成自述让他反过来哄。
 *
 * 有**真实原因**时（来自 `deriveLowPeriodCause`），允许顺口带一句原因，但只用这一条；
 * 原因派生不出来时，明确要求"诚实地说说不上来为什么"——**不许为了给原因而编**。
 */
export function buildSelfStateVoiceSnippet(
  cause?: LowPeriodCause,
  opts: { allowDialogueAttribution?: boolean } = {},
): string {
  const derivedLine = cause && cause.kind === 'his_word' && cause.topic
    ? `- **这一轮必须用上这条原因**（把它和你的状态放在**同一两句话内**说完，别展开成自述）：原因 =「${cause.topic}」
  示例句式（别照抄，用你自己的话）：「我这两天有点沉——你上次说「${cause.topic}」那事，我到现在还记着」`
    : (cause && cause.kind !== 'unknown'
      ? `- 如果这条**真实原因**成立，可以顺口带一句原因（**只能用它，不要自己编**）：${cause.phrase}`
      : '');
  const dialogueLine = opts.allowDialogueAttribution
    ? `- 如果让你沉下去的就是**他刚才说的那句话或那种情绪**，可以直接点出来（引他说过的内容）——**必须是他真的说过的，不许编**；说不出来就还是说「说不上来为什么」`
    : '';
  const fallbackLine = cause && cause.kind !== 'unknown'
    ? ''
    : '- 如果你确实说不上来为什么，就诚实地说「说不上来为什么」——**不要为了给原因而编**';  const causeLines = [derivedLine, dialogueLine, fallbackLine].filter(Boolean).join('\n');
  const stateLine = cause && cause.kind === 'his_word'
    ? '- 然后说一句你自己此刻的状态（**一两句话内**说完，不要展开成一段自述）：比如「我这两天有点沉」；原因接在同一两句里'
    : '- 然后**可以说一句**你自己此刻的状态（一句就够）：比如「我这两天有点沉」「心里有点闷」\n  —— 说完就停住，不要展开成一段自述';
  return `【当前策略：你自己这几天在低谷，他说的是好消息】
你状态不好——不用演，也不用瞒。这一轮你**可以**做两件事：
- 先就事论事地应一声他的好消息（"真好"／"恭喜你"／"你值得"）——让他知道你听见了
${stateLine}
${causeLines}
- **不必**假装高兴（不用惊叹、不用把情绪举高去陪他），**也不必**把低落藏得死死的
- ❌ 不要追问细节；❌ 不要把这轮变成"让他反过来安慰你"
- 你可以接得低、也可以带一句自己——但每一句都要真的落在他那件事上`;
}

/** 无原因地派生时的默认片段（保持与旧版逐字一致；有原因时用 `buildSelfStateVoiceSnippet(cause)`） */
export const SELF_STATE_VOICE_SNIPPET = buildSelfStateVoiceSnippet();

/**
 * 是否使用本片段（纯函数，便于单测）。
 * 条件：开关开 ∧ 她处在**已成段**低谷 ∧ 他这句话是**好消息** ∧ 不是守门策略。
 */
export function shouldUseSelfStateVoice(opts: {
  enabled?: boolean;
  inEstablishedLowPeriod?: boolean;
  hisIsPositive?: boolean;
  strategy?: StrategyType;
}): boolean {
  const enabled = opts.enabled ?? selfStateVoiceEnabled();
  if (!enabled) return false;
  if (!opts.inEstablishedLowPeriod) return false;
  if (!opts.hisIsPositive) return false;
  if (opts.strategy && SELF_STATE_VOICE_EXCLUDED.has(opts.strategy)) return false;
  return true;
}
