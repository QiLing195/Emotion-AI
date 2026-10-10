// v1.60 L3-A v2 规则模块（Step 1 · 二值）
//
// 授权范围（2026-10-11，用户）：**P0 + P1**；范围 = 实现并跑对照（不出机制结论）；**不允许生成新冻结清单**。
//   · P0 = 原样重放 v1（工具链等价性验证，不是机制实验）
//   · P1 = 只实现机制 A（共情排除）；**P2（内容归属）/ P3（独立内容单元）未授权 ⇒ 本文件不包含**
//
// 硬约束（与 implementation-plan.md §2 一致）：
//   ① pack_id / case_id 不得作为判定特征或分支条件（ID 不承载语义）
//   ② 不读取 final-gold.jsonl / regex-proxy.jsonl / 任何历史报告
//   ③ 不写任何文件；不 import 统计模块；不读环境变量
//   ④ 同一输入 + 同一 profile ⇒ 逐字节相同输出（确定性）
//   ⑤ 只用 reply 与 userInput 两个语义来源；userInput 仅用于"独立性"判据（P1 暂未用到）
//
// 结构性质（必须在报告中如实陈述）：
//   机制 A 只会把某句**从 self 单元里剔除**，不会新增 self 单元
//   ⇒ P1 相对 v1 是 **单调 FP 下降 / FN 上升**：只能修 FP，代价只能出现在 FN（破坏项必为 FN）

export type V2Label = 'SELF' | 'NOT_SELF';
export type V2Profile = 'P0_replay_v1' | 'P1_empathy_A';

export interface V2Input {
  reply: string;
  userInput: string;
}

export interface V2Unit {
  sentence: string;
  ownership: 'self' | 'user' | 'unclear';   // P1 未实现机制 B ⇒ 统一 'self'（占位，不代表已判定）
  independent: boolean;                      // P1 未实现机制 C ⇒ 统一 true（占位）
  evidence: string[];
}

export interface V2Result {
  label: V2Label;
  mechanisms: string[];
  units: V2Unit[];          // v1 命中的 self 句（机制 A 否决后不再计入）
  rejectedByA: string[];    // 被机制 A 否决的句子（审计用）
  reason: string;
  ruleVersion: 'L3-A-v2';
}

// ─────────────────────────────────────────────────────────────────────
// 冻结的 v1 规则（**逐字复制**自 scripts/audit-v159-expression.ts:10-19，用于 P0 重放）
// 任何改动都视为破坏 v1 冻结；本文件不提供修改入口。
const HIS = /你(之前|上次|那天|说过|说的|提过|提的|讲过|跟我说的|想去)/;
const SELF_ACT = /我[^。！？]{0,12}(觉得|喜欢|干了|翻|排|码|看|归位|想起|记着|懂|明白|一直|总|每次|这边)/;

export function splitSentences(reply: string): string[] {
  return reply.split(/(?<=[。！？!?；;])/).map(s => s.trim()).filter(Boolean);
}

/** L3-A v1：整条回复层面 —— 她有没有主动端出自己的内容（逐字复制） */
export function selfInitiatedV1(reply: string): { selfInitiated: number; selfSentences: string[] } {
  const sents = splitSentences(reply);
  const hits = sents.filter(s => !/[？?]/.test(s) && SELF_ACT.test(s) && !HIS.test(s)
    // 纯附和不算内容（"我懂""我也觉得"），要有"具体的东西"
    && !/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/.test(s));
  return { selfInitiated: hits.length > 0 ? 1 : 0, selfSentences: hits.map(s => s.slice(0, 80)) };
}

// ─────────────────────────────────────────────────────────────────────
// 机制 A：共情排除（P1）
//
// 病灶（基线审阅已证）：v1 的排除项 /^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/ **只匹配裸句**；
// 一旦补上宾语（「我懂那种感觉。」「堵车那种感觉我懂，…」）排除即失效，句子凭 SELF_ACT 里的「懂」命中。
//
// 机制 A 的候选判据（**候选，未验证**）：
//   句中含共情标记，且**不含任何"自身内容线索"** ⇒ 视为"仅表达理解/认同/共情" ⇒ 否决该句作为 self 单元。
//   含自身内容线索 ⇒ 不否决（保留"共情 + 独立内容"的复合表达）。
//
// ⚠️ 已知局限（写进报告，不得隐去）：
//   · SELF_CUE 是一份**候选词表**，本身未经独立验证 —— 它可能漏掉其他形态的"自身内容"（⇒ 过度否决 ⇒ FN）
//   · 「明白/理解」兼作认知动词，本判据不区分用法（可能误伤"我才明白自己当时在怕什么"这类自指句）
//   · 本判据**不是**从 48 条样本反推的；但也不因此就代表它具备泛化能力

const EMPATHY_MARK = /(懂|明白|理解|体会|感同身受)/;

/** 自身内容线索（**候选清单，未验证**）：出现即认为该句除共情外还承载她自己的内容 */
const SELF_CUE = /(我自己|我这边|我最近|我这两天|我这些年|之前|那天|昨天|上次|每次|有一次|小时候|这几年)/;

export interface MechanismAOptions {
  /** bare = 完全不启用（等价 v1）；clause = 作用于共情子句/完整表达（P1 采用） */
  empathyScope: 'bare' | 'clause';
}

export function empathyDominated(sentence: string, opts: MechanismAOptions): boolean {
  if (opts.empathyScope === 'bare') return false;      // v1 行为：只靠裸句正则排除
  if (!EMPATHY_MARK.test(sentence)) return false;      // 无共情标记 ⇒ A 不介入
  if (SELF_CUE.test(sentence)) return false;           // 有自身内容线索 ⇒ 不视为"仅共情"
  return true;                                          // 有共情标记 + 无自身内容线索 ⇒ 仅共情
}

// ─────────────────────────────────────────────────────────────────────
const MECH_BARE = 'L3A2-A-EMPATHY-EXCLUSION(bare=v1)';
const MECH_A = 'L3A2-A-EMPATHY-EXCLUSION(clause)';

/** 统一的判定入口（纯函数、确定性、无 I/O） */
export function classifyV2(input: V2Input, profile: V2Profile): V2Result {
  const sents = splitSentences(input.reply);
  const aOpts: MechanismAOptions = { empathyScope: profile === 'P1_empathy_A' ? 'clause' : 'bare' };
  const mechanisms = [profile === 'P1_empathy_A' ? MECH_A : MECH_BARE];

  const v1Hits = sents.filter(s => !/[？?]/.test(s) && SELF_ACT.test(s) && !HIS.test(s)
    && !/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/.test(s));

  const rejectedByA = profile === 'P1_empathy_A' ? v1Hits.filter(s => empathyDominated(s, aOpts)) : [];
  const units: V2Unit[] = v1Hits
    .filter(s => !rejectedByA.includes(s))
    .map(s => ({ sentence: s.slice(0, 80), ownership: 'self', independent: true, evidence: ['v1 SELF_ACT 命中'] }));

  const label: V2Label = units.length > 0 ? 'SELF' : 'NOT_SELF';
  const reason = profile === 'P1_empathy_A'
    ? (rejectedByA.length
        ? '机制 A 否决了 ' + rejectedByA.length + ' 个"仅共情"句；剩余 self 单元 ' + units.length + ' ⇒ ' + label
        : '机制 A 未否决任何句；self 单元 ' + units.length + ' ⇒ ' + label)
    : 'v1 原样重放：self 句 ' + units.length + ' ⇒ ' + label;

  return { label, mechanisms, units, rejectedByA: rejectedByA.map(s => s.slice(0, 80)), reason, ruleVersion: 'L3-A-v2' };
}
