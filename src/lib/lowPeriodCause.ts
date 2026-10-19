/**
 * 低谷的「原因」派生（v1.60，纯函数）
 *
 * 为什么需要它：
 *   实测（2026-10-19，5×2 复现）她 4/4 都说「我这两天有点沉，心里闷闷的，**说不上来为什么**」——
 *   归因 0/4。查下来是结构性的：MoodState 只有 valence/arousal、LowPeriodState 只记深度与结束方式，
 *   **没有任何"为什么"**；而 state 动机的校验还明文写着"不要解释原因"。
 *
 * 但"给原因"绝不能变成"编造她的生活"（她并没有工作/同事/朋友那些外部生活，v1.49c 的禁外部事件
 * 名词就是为此）。所以本模块只从**状态里真实存在**的信号派生原因，且不引入任何外部事件：
 *   ① 动机池里她心里挂着的事（open_loop / worry / memory_echo）—— 那本身就是有依据的
 *   ② 反刍链（同一情绪连续主导 ≥3 轮）—— "缓不过来"有内部依据
 *   ③ 都没有 ⇒ 诚实地说"说不上来为什么"（不编）
 *
 * 刻意**不**包含：内在事件（孤独/重逢）与 appraisal 读数 —— 它们**不落在 EmotionState 里**
 * （每轮临时计算），在这里读不到；若将来要接，必须先让它们可持久化，否则就是凭循环猜原因。
 */

export type LowPeriodCauseKind = 'carrying_his_matter' | 'rumination' | 'unknown';

export interface LowPeriodCause {
  kind: LowPeriodCauseKind;
  /** 可以直接放进页面的**一句原因**（已保证不含外部事件名词） */
  phrase: string;
  /** 派生依据（审计用） */
  evidence: string;
}

/** 她心里挂着的事（这三类本身就是"有具体所指"的动机） */
const CARRYING_KINDS = new Set(['open_loop', 'worry', 'memory_echo']);

/**
 * 对外部生活名词的护栏：原因句里**不得**出现她并不拥有的生活（与 v1.49c 的 state 校验同一原则）。
 * 这里只需要挡住我们能想到的类别；真正的保证来自"派生只从三类信号来"。
 */
const FORBIDDEN_LIFE_NOUNS = /工作|上班|同事|老板|公司|朋友|闺蜜|同学|学校|老师|家里|妈妈|爸爸|父母|天气|下雨|出差|旅行|超市|做饭|加班|项目/;

export interface DeriveLowPeriodCauseInput {
  /** 反刍链（`EmotionState.internal.rumination`） */
  rumination?: { emotion?: string; streak?: number } | null;
  /** 动机池（`EmotionState.internal.motive.pool`）—— 只读 kind/salience */
  motivePool?: Array<{ kind?: string; salience?: number }> | null;
  /** 本次低谷已落定的轮数（低谷读数里的 turns；只作为审计证据，不参与判定） */
  lowTurns?: number;
}

function pickCarryingMotive(pool?: Array<{ kind?: string; salience?: number }> | null): string | null {
  if (!pool || pool.length === 0) return null;
  let best: { kind: string; salience: number } | null = null;
  for (const m of pool) {
    const kind = String(m?.kind ?? '');
    if (!CARRYING_KINDS.has(kind)) continue;
    const salience = Number(m?.salience ?? 0);
    if (!Number.isFinite(salience)) continue;
    if (!best || salience > best.salience) best = { kind, salience };
  }
  return best ? best.kind : null;
}

/**
 * 派生"她为什么沉"。**顺序即优先级**，且每一档都有真实依据。
 */
export function deriveLowPeriodCause(input: DeriveLowPeriodCauseInput = {}): LowPeriodCause {
  const carrying = pickCarryingMotive(input.motivePool);
  if (carrying) {
    return {
      kind: 'carrying_his_matter',
      phrase: '心里一直挂着一件还没落定的事',
      evidence: `motive_pool:${carrying}`,
    };
  }

  const streak = Number(input.rumination?.streak ?? 0);
  const emotion = String(input.rumination?.emotion ?? '');
  if (Number.isFinite(streak) && streak >= 3) {
    return {
      kind: 'rumination',
      phrase: '这几天情绪一直缓不过来，像卡在同一个地方',
      evidence: `rumination:${emotion || 'unknown'}/${streak}`,
    };
  }

  return {
    kind: 'unknown',
    phrase: '说不上来为什么',
    evidence: `low_turns:${Number(input.lowTurns ?? 0)}`,
  };
}

/** 自检：原因句里不得出现她并不拥有的外部生活名词（供测试与运行时断言） */
export function causePhraseIsGrounded(phrase: string): boolean {
  return typeof phrase === 'string' && phrase.length > 0 && !FORBIDDEN_LIFE_NOUNS.test(phrase);
}
