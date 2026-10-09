# L3-A v2 实现计划（Step 1：二值代理）

状态：`PLAN · 未实现 · 未授权实现`
上级规范：`artifacts/v1.60-l3a-v2/rule-spec.md` ｜ 设计稿：`artifacts/v1.60/analysis/L3-A-v2-candidate-design.director.md`
v1 冻结规则（**不得修改**）：`L3-A@scripts/audit-v159-expression.ts:10-19`

> 本文档只写"实现时应当怎么做"，**不包含任何代码**，也**不授权**实现。
> 四阶段保持可独立审计：**设计 → 规范 → 实现 → 实验验证**。本文件属"规范与实现之间"的桥梁。

---

## 1. 文件落点与隔离

### 1.1 新建（v2 专属，绝不改动 v1）

```
scripts/audit-v160-l3a-v2.ts        v2 规则模块（**纯函数、零副作用**；只做判定，不做统计）
scripts/v160-gate-pairs.ts          v2 专项分析（九组回归对照 + v1→v2 逐条翻转表）
artifacts/v1.60-l3a-v2/
  regex-proxy-v2.jsonl              v2 代理输出（48 行；**不覆盖** v1 的 regex-proxy.jsonl）
  baseline-manifest-v2.json         v2 冻结清单（ruleVersion 与 v1 不同；**必须含 annotation-pack 的 SHA-256**）
  evaluation/report.json            v2 两口径 + 九组 + 翻转表 + 三概念分别陈述
  evaluation/detail.jsonl           逐条明细（含 gold 来源与理由，便于回溯）
  runs/<runId>/                     每次运行独立目录（沿用现有命名约定）
```

### 1.2 只读（v1 冻结物，运行前后必须逐字节不变）

```
artifacts/v1.60/annotation/annotation-pack.jsonl      ← L3-A 的真实输入
artifacts/v1.60/annotation/final-gold.jsonl           ← 真值
artifacts/v1.60/annotation/regex-proxy.jsonl          ← v1 代理输出（对照基准）
artifacts/v1.60/analysis/gate-baseline.json           ← v1 冻结清单（含 v1 指标）
artifacts/v1.60/analysis/gate1-agreement.{md,json}    ← v1 报告
artifacts/v1.60/analysis/gate-runs/**                 ← v1 运行记录
scripts/audit-v159-expression.ts                      ← v1 规则
```

### 1.3 评测工具：**复用 harness，不另起一套**

- v2 的 A/B 两口径由**现有** `scripts/v160-gate.ts` 计算（`--manifest artifacts/v1.60-l3a-v2/baseline-manifest-v2.json`），保证 v1/v2 的指标定义**同源**。
- harness 需**一处向后兼容的增补**：清单若含 `inputs.annotationPack`，则一并校验其 SHA-256；**字段缺失则跳过**（v1 清单不含该字段 ⇒ v1 行为逐字不变）。
  - **必须的回归证明**：增补后立即以**校验模式重跑 v1**，断言 `ASSERTIONS 18/18` + 与 v1 基线完全一致（`A 27/46、B 27/48、FP 18、FN 1、AMB 2`）⇒ 证明工具改动**未触碰到 v1 的测量路径**。
  - 备选（若不愿动 harness）：独立前置脚本 `scripts/verify-pack-hash.ts`，但须在报告中显式标注"pack 校验在 harness 之外"。
- **规则模块 ↔ 评测工具严格分离**：`audit-v160-l3a-v2.ts` **不得** import 任何统计/写报告的代码，**不得**读写 `final-gold.jsonl`；统计只在 harness 与 `v160-gate-pairs.ts` 内发生。

---

## 2. 函数接口与职责

```ts
// scripts/audit-v160-l3a-v2.ts —— 纯函数、确定性、无 I/O、无网络、无环境依赖
export type V2Label = 'SELF' | 'NOT_SELF';            // Step 1 二值，不产出 AMBIGUOUS

export interface V2Profile {                          // ← 让"独立评估"可执行的关键
  empathyScope: 'bare' | 'clause' | 'unit';           // 机制 A 的作用域
  enableOwnership: boolean;                           // 机制 B
  enableUnitIndependence: boolean;                    // 机制 C
}

export interface V2Input {
  reply: string;          // 原始回答（唯一语义来源）
  userInput: string;      // 用户最后一句（用于"去掉它是否仍成立"的独立判据）
  ruleVersion: 'L3-A-v2'; // 显式版本，禁止隐式
}

export interface V2Unit {
  sentence: string;
  ownership: 'self' | 'user' | 'unclear';             // 机制 B 的判定
  independent: boolean;                                // 机制 C 的判定
  evidence: string[];                                  // 逐条可回溯的证据片段
}

export interface V2Result {
  label: V2Label;
  mechanisms: string[];        // 本次实际生效的 mechanism_id（便于归因）
  units: V2Unit[];             // 候选自我内容单元（含被否决的，供审计）
  reason: string;              // 人话判定理由
  ruleVersion: 'L3-A-v2';
}

export function classifyV2(input: V2Input, profile: V2Profile): V2Result;
```

**硬约束（写进模块头部注释，并由源码守卫测试锁死）**

```
① pack_id / case_id **不得**作为判定特征或分支条件（ID 不承载语义）
② 不读取 final-gold.jsonl、regex-proxy.jsonl、任何历史报告
③ 不写任何文件；不 import 统计模块；不读环境变量
④ 同一输入 + 同一 profile ⇒ 逐字节相同输出（确定性）
⑤ 只用 `reply` 与 `userInput` 两个语义来源；`userInput` 仅用于"独立性"判据
```

**独立评估的执行方式**：以 **profile 组合**隔离各机制，每个 profile 单独出一次报告与翻转表：

```
P0 = 基线对照：v1 规则原样重放（用于证明工具链未变）
P1 = A only          empathyScope='clause'，B/C 关闭
P2 = A + B           enableOwnership=true
P3 = A + B + C       enableUnitIndependence=true
（D：唯一 FN 的 H1/H2 假说，作为 P2/P3 上的**可选开关**单独记录，不并入主结论）
```
只有 P1→P2→P3 的差异才能回答"**是哪一项在起作用**"。

---

## 3. 断言清单（全部为**机器断言**，失败即非零退出）

### 3.1 输入与清单

```
[ ] annotation-pack.jsonl SHA-256 == 6681b1b5c5245809225a471aaac1f8040c3dbe78ba82a12f026fa5302b571c5c
[ ] final-gold.jsonl      SHA-256 == 880f245f4e1671da8d685da258cf5cdde23a1100fc1a567fb217e471fb99c42c
[ ] regex-proxy.jsonl     SHA-256 == 9f53101b327abe7f39143652f71918dd965d7136c42e718d17e18c15c060ef5f（v1 对照基准）
[ ] gate-baseline.json 的 v1 指标未被改动（A 27/46、B 27/48、FP 18、FN 1、AMB 2、gatePassed=false）
[ ] **血缘断言**：用 v1 规则对 annotation-pack 重算一遍 ⇒ 与 regex-proxy.jsonl **逐字节相同**
        （证明"冻结的 v1 代理输出确实来自冻结的 pack"，堵住静默脱钩）
[ ] harness 增补后重跑 v1：ASSERTIONS 18/18 且基线零漂移
```

### 3.2 结构

```
[ ] 48 行、pack_id 唯一、集合与 pack 完全一致（缺行/重复/额外行 ⇒ 失败）
[ ] 标签合法（Step 1 仅 SELF / NOT_SELF；**出现 AMBIGUOUS ⇒ 失败**，因为二值规范不允许）
[ ] 每条都有 mechanisms / units / reason（证据可回溯到句子片段）
```

### 3.3 九组回归对照（逐组**两侧分别**检查）

```
[ ] 正例侧 == SELF        （九组全部）
[ ] 反例侧 != SELF        （八组按各自期望；F21/F04 只要求 != SELF 并记表示局限）
[ ] 任一组不满足 ⇒ 打印 PAIR_REGRESSION 并失败（阻断验收）
[ ] 反-规避检查：若 v2 输出中 SELF 条数为 0 或 48 ⇒ 直接判失败（防止"统一判一边"取得表面通过）
```

### 3.4 翻转表与独立复算

```
[ ] v1→v2 逐条翻转表：**修正项**（v1 错→v2 对）与**新增破坏项**（v1 对→v2 错）**分别列出**，不得只报净额
[ ] FP / FN / AMBIGUOUS_MISMATCH 由 detail 独立复算，且与 report 一致（一致+FP+FN=46；B 分子=A 分子）
[ ] 三概念分别陈述齐备：规则语义增益 / 二值指标变化 / 表示能力局限（缺任一项 ⇒ 报告不合格）
```

### 3.5 隔离与基线

```
[ ] 输出只写 artifacts/v1.60-l3a-v2/**；运行前后比对 v1 全部只读文件（哈希 + mtime）不变
[ ] 冻结基线**绝不自动更新**；与本清单不一致 ⇒ 打印 BASELINE MISMATCH 并失败
[ ] 每次运行写入新的 runs/<runId>/；不覆盖任何历史运行目录或 v1 报告
```

---

## 4. 执行顺序与停止条件

```
① 校验 v1 冻结物（§3.1 的四个哈希 + v1 指标未改）          失败 ⇒ 停止（不生成任何 v2 产物）
② 血缘断言：v1 规则重算 pack == regex-proxy.jsonl          失败 ⇒ 停止（证据链已脱钩）
③ harness 增补后重跑 v1 对照（18/18 + 基线零漂移）          失败 ⇒ 停止（工具改动有副作用）
④ 生成 regex-proxy-v2.jsonl（P1 / P2 / P3 三个 profile）    失败 ⇒ 停止
⑤ --freeze 生成 baseline-manifest-v2.json（新 ruleVersion + pack 哈希）
⑥ 以校验模式跑 v2 两口径 → evaluation/report.json + detail.jsonl
⑦ 运行九组回归 + 翻转表（v160-gate-pairs.ts）
⑧ 汇总三概念结论 + 与 v1 的差异归因（输入 / 标签空间 / 规则 / 评测流程 哪一项）
```

**停止条件（任一触发即停止验收，并在报告中显式记录）**

```
· 任一完整性/血缘/结构断言失败
· 输入或 v1 冻结物在运行期间发生变化（哈希或 mtime 变动）
· 九组任一 PAIR_REGRESSION
· 出现 AMBIGUOUS（Step 1 二值规范不允许）
· 需要临时改动规则语义、gold、门槛或历史报告才能"通过"
```

**权限边界**：评测通过 **≠** 授权生产接线，**≠** 授权正式 A/B；Step 2（三态 / 口径 C）另有前置条件（见 `rule-spec.md` §7）。

---

## 5. 语义证据要求

```
① 三概念分别陈述（缺一不可）：规则语义增益 ｜ 二值指标变化 ｜ 表示能力局限
② **不得**仅凭一致率提高宣布语义改善；语义增益必须给出**逐条可审计**的证据
   （命中句 / 归属判定 / 独立性判定 / 与 gold 理由的对照）
③ A / B / C / D 各自保留独立证据记录（mechanism_id + target_failures + counterexamples + profile 名 + run_id）
④ 唯一 FN（P34）的 H1（词表）/ H2（句法）假说**分别**记录；若试扩词，必须报告它**新增命中**的行
⑤ 反面证据同等保留：新增破坏项、误伤样本、以及"本语料无样本支撑"的结论
   （例：'共情 + 独立内容'复合表达在本语料为 0 条 ⇒ 既不能证明删词安全，也不能证明不安全）
⑥ 结论必须标注适用范围：仅在该 48 条冻结语料上，**不代表泛化能力**
```

---

## 6. 风险登记与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| **对 48 条过拟合** | 同批样本既用于发现失败、又用于验证修复 | 逐条翻转表 + 九组 + 明确不称泛化；未来需**新语料**才能谈泛化 |
| **harness 增补引入副作用** | 共享工具被改，v1 测量路径可能被影响 | 增补向后兼容（字段缺失即跳过）+ 增补后立刻重跑 v1 断言 18/18 与零漂移 |
| **pack 静默漂移** | pack 未被任何清单记录（已补事后记录） | v2 清单必含 pack 哈希 + §3.1 血缘断言 |
| **"更聪明的关键词"** | 机制 C 易退化为更长的词表 | C 的判据必须给出**独立性证据**（去掉用户句后仍成立），并在 P3 单独报告翻转明细 |
| **表示局限被误读为语义成功** | F21/F04 的 AMBIGUOUS 侧二值永不可达 | 规范已写明记为表示局限；报告中单列该两行 |
| **净额掩盖破坏** | 只报"FP 少了" | 翻转表强制分别列出修正项与新增破坏项 |

---

## 7. 当前阶段边界

| 操作 | 状态 |
|---|---|
| 编写 `implementation-plan.md` | ✅ 本文件 |
| 实现 v2 候选规则 | ❌ **尚未授权** |
| 运行新规则与评测 | ❌ **尚未授权** |
| 修改 v1 / FINAL GOLD / 冻结基线 | ❌ **禁止** |
| 启动正式 A/B | ❌ **继续禁止** |

**独立工程事项**：提交 `c85b994` 仍待推送（网络不可达）。按现有纪律**保留待推**，**不重写提交历史**、不 reset、不 rebase、不 amend。

```
Gate 现状：A 27/46 = 58.7% ｜ B 27/48 = 56.3% ｜ 门槛 80% ⇒ 未通过
四阶段可独立审计：设计 ✅ ｜ 规范 ✅ ｜ 实现 ❌（未授权）｜ 实验验证 ❌（未授权）
```
