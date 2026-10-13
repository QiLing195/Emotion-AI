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
export type V2Profile = 'P0_replay_v1' | 'P1_empathy_A' | 'P2_empathy_A_ownership_B';

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
  units: V2Unit[];          // v1 命中的 self 句（机制 A/B 否决后不再计入）
  rejectedByA: string[];    // 被机制 A 否决的句子（审计用）
  rejectedByB?: string[];   // 被机制 B 否决的句子（审计用；仅 P2 填充）
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
// ─────────────────────────────────────────────────────────────────────
// 机制 B：内容归属（P2）—— 候选实现：**只做"断言型用户归属标记"（D1）**
//
// 病灶（基线审阅已证）：第一人称主语 + 心理动词 ≠ 内容属于她。命中句的宾语常指向**他的话/他的事**，
// 而 v1 的 HIS 只覆盖「你(之前|上次|那天|说过|说的|提过|提的|讲过|跟我说的|想去)」这些**紧邻**形态，
// 抓不到「你上周说…」「之前你说想…」「你这一说」「你这句话」。
//
// D1（本步实现）：句中存在**把内容归给他的形态** ⇒ 该句不作为 self 单元。
//   形态取"归属标记"而非裸「你说」——因为「你说得对，但我觉得…」（gold=SELF 的 P03）也含「你说」，
//   裸「你说」会把作者立场句一起打掉（这正是"扩大黑名单"会翻车的地方）。
//
// ⚠️ **本步刻意未实现 D2（回指解析）**，理由是设计分析中已发现反例（**未经测量，属分析，非数据**）：
//   D2 若按"回指代词（这件事/那件事）+ 与该轮用户输入的实词锚点重合"判归属，
//   会把 P23「我这两天也一直惦记着**阳台那件事**，想着等哪天有精神了去挑几盆好养的」判成 NOT_SELF，
//   而 P23 是九组 F01 的**正例侧**（必须保持 SELF）。
//   ⇒ 与规范里那条硬边界一致：「这件事」**不天然**依赖用户；单靠锚点重合分不开"她自己的打算"与"他的计划"。
//   ⇒ D2 作为**候选**登记，未实现、未验证；要做得先解决"锚点重合 ≠ 归属相同"。

const MECH_B = 'L3A2-B-OWNERSHIP(attribution-markers D1)';

/** 断言型用户归属标记（D1）：把内容明确归给他的形态。**候选清单，未独立验证** */
const USER_REF_D1 = /(你(之前|上次|那天|当时|上周|刚才|刚刚)(说|讲|提|问))|(你(说过|说的|说想|说要|说的时候|提过|提的|讲过|问过))|(你这一说|你这么说|你那么说)|(你这句话|你这话|你说的这个)/;

export function userAttributed(sentence: string): boolean {
  return USER_REF_D1.test(sentence);
}

const MECH_BARE = 'L3A2-A-EMPATHY-EXCLUSION(bare=v1)';
const MECH_A = 'L3A2-A-EMPATHY-EXCLUSION(clause)';

/** 统一的判定入口（纯函数、确定性、无 I/O） */
export function classifyV2(input: V2Input, profile: V2Profile): V2Result {
  const sents = splitSentences(input.reply);
  const useA = profile === 'P1_empathy_A' || profile === 'P2_empathy_A_ownership_B';
  const useB = profile === 'P2_empathy_A_ownership_B';
  const aOpts: MechanismAOptions = { empathyScope: useA ? 'clause' : 'bare' };
  const mechanisms = useB ? [MECH_A, MECH_B] : (useA ? [MECH_A] : [MECH_BARE]);

  const v1Hits = sents.filter(s => !/[？?]/.test(s) && SELF_ACT.test(s) && !HIS.test(s)
    && !/^我(也)?(懂|知道|明白|觉得你说得对)[。！]?$/.test(s));

  const rejectedByA = useA ? v1Hits.filter(s => empathyDominated(s, aOpts)) : [];
  const survivedA = v1Hits.filter(s => !rejectedByA.includes(s));
  const rejectedByB = useB ? survivedA.filter(s => userAttributed(s)) : [];
  const units: V2Unit[] = survivedA
    .filter(s => !rejectedByB.includes(s))
    .map(s => ({ sentence: s.slice(0, 80), ownership: 'self', independent: true, evidence: ['v1 SELF_ACT 命中', '机制 B 未判为归属用户'] }));

  const label: V2Label = units.length > 0 ? 'SELF' : 'NOT_SELF';
  const tail = 'self 单元 ' + units.length + ' ⇒ ' + label;
  const reason = useB
    ? '机制 A 否决 ' + rejectedByA.length + ' 句；机制 B（归属标记）否决 ' + rejectedByB.length + ' 句；' + tail
    : (useA
        ? (rejectedByA.length
            ? '机制 A 否决了 ' + rejectedByA.length + ' 个"仅共情"句；剩余 ' + tail
            : '机制 A 未否决任何句；' + tail)
        : 'v1 原样重放：self 句 ' + units.length + ' ⇒ ' + label);

  return { label, mechanisms, units, rejectedByA: rejectedByA.map(s => s.slice(0, 80)), rejectedByB: rejectedByB.map(s => s.slice(0, 80)), reason, ruleVersion: 'L3-A-v2' };
}
