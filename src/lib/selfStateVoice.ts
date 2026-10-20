/**
 * 「她沉、他报喜/平常事」这一格：**准许她说一句自己此刻的状态**（v1.60，默认关）
 *
 * 为什么要有它（证据）：
 *   · 探针实测（2026-10-19，两臂 6 轮）：内部状态确实沉（sad +0.17 / disgust +0.16 / low=true），
 *     但"他报喜"那一轮她**一个字都不说自己的状态**；只有被直接问（"你今天感觉怎么样"）才说。
 *   · 更早的真实使用里，`lowPeriod.lastEpisode` 显示 selfRecovery=0.1227、closedBy="self"
 *     ⇒ **她心里确实在自我调整**，缺的不是情绪，而是"说出来的许可"。
 *
 * ⚠️ 设计红线（用户 2026-10-20 明确）：
 *   **"说一句自己的状态"是可选的：可以说，也可以不说，不能定死。**
 *   人设裁定是「主动性降低，但不是没有」——不是「每轮都必须交代自己」。
 *   所以本片段里"说状态 / 说原因"全部写成**许可**（你可以…也可以不说）；
 *   只有"不假装高兴、不冷处理、不让他反过来哄"这几种**不许做的事**才是硬约束。
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
 * 已实测**无效**（2026-10-19，两臂各 5 段：引用他原话 0/5）—— 模型不会在表达时自发从历史重构
 * "因为哪句话"。开关保留仅作留档，不再是推荐路径（原因改由沉因现场记录提供）。
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
 * 核心是"**可以**说（不是必须说、也不是禁止说）"，并把两件坏事划死：
 * 假装高兴 / 展开成自述让他反过来哄。
 *
 * 有真实原因时只提供**选项**：想说就用这一条，不想说也不必交代；绝不强制。
 */
export function buildSelfStateVoiceSnippet(
  cause?: LowPeriodCause,
  opts: { allowDialogueAttribution?: boolean } = {},
): string {
  const stateLine = '- 然后你**可以选择**说一句自己此刻的状态（**也可以不说**，不必勉强）：比如「我这两天有点沉」「心里有点闷」；想说就一两句内说完，不要展开成一段自述';

  const derivedLine = cause && cause.kind === 'his_word' && cause.topic
    ? `- 如果你想说自己沉的原因，**只能用这条真实原因**（不要自己编）：「${cause.topic}」；不想说也可以，不必交代`
    : (cause && cause.kind !== 'unknown'
      ? `- 如果你想说原因，可以说这一条（**只能用它，不要自己编**）：${cause.phrase}；不想说也可以`
      : '- 如果没有原因可说，就说「说不上来为什么」也可以；**不要为了给原因而编**');

  const dialogueLine = opts.allowDialogueAttribution
    ? '- 如果让你沉的是**他刚才说的那句话或那种情绪**，你想的话可以点出来（**必须是他真的说过的，不许编**）；不想说也可以'
    : '';

  const causeLines = [derivedLine, dialogueLine].filter(Boolean).join('\n');
  return `【当前策略：你自己这几天在低谷，他说的是好消息】
你状态不好——不用演，也不用瞒。这一轮你**可以**做两件事（都是可选，不是任务）：
- 先就事论事地应一声他的好消息（"真好"／"恭喜你"／"你值得"）——让他知道你听见了
${stateLine}
${causeLines}
- **不必**假装高兴（不用惊叹、不用把情绪举高去陪他），**也不必**把低落藏得死死的
- ❌ 不要追问细节；❌ 不要把这轮变成"让他反过来安慰你"
- 你可以接得低、也可以带一句自己——但每一句都要真的落在他那件事上`;
}

/** 无原因时的默认片段（保持稳定，供测试与"开关关着逐字不变"的对照） */
export const SELF_STATE_VOICE_SNIPPET = buildSelfStateVoiceSnippet();

/**
 * 是否使用本片段（纯函数，便于单测）。
 * 条件：开关开 ∧ 她处在**已成段**低谷 ∧ 他这句话是**好消息/平常事** ∧ 不是守门策略。
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
