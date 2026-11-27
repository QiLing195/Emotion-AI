# 双环情感模型总装与设计手册（Codex 施工蓝图）

```text
文档编号（DOC NO.） : DLEM-AMM-002
文档用途（PURPOSE） : 双环情感模型完整设计规范（可直接交由 Codex / 工程师按工单逐章编码）
模型架构（ARCH.）   : 理解环（Understanding Loop）× 最小桥接门（Bridge Gate）× 角色环（Character Loop）× 表达门（Expression Gate）
设计基线（DATE）    : 2026-11-25
修订版次（REV.）    : REV 2.0（已补齐原方法论 5 项缺口，含完整 TS 契约、有界状态机公式、7 张施工工单与对抗测试集规范）
```

---

## CHAPTER 00 — 施工红线与安全警示（Read Before Coding）

本手册按航空总装与维修手册标准编写。编码代理（Codex）或工程师在生成任何一行代码前，必须将以下 `WARNING` 视为不可违反的硬性断言：

> **WARNING-01（严禁双环直连 / 严禁情绪镜像）**
> 理解环对用户情绪的判断**绝不可**直接映射为角色情绪变化（例如“用户悲伤 → 角色悲伤”）。桥接层只允许传递带证据 ID 的事件候选，**严禁**传递“角色应当悲伤/担心”等指令或直接传入角色情绪增量（delta）。

> **WARNING-02（严禁角色输出回流污染理解环）**
> 角色自己生成的回复、内部独白或模拟活动日志，**绝不可**作为下一轮的用户情绪证据回流进理解环（防止情绪自激回路）。所有事件账本条目必须带严格 `actor: 'user' | 'assistant' | 'simulation'` 隔离字段。

> **WARNING-03（严禁将 `unknown` 静默回填为 `neutral` 或 `0`）**
> 当证据不足、语境含糊、主体不明或宪章未确认时，必须显式返回 `'unknown'` / `'no_reading'` / `'ambiguous_affect_context'`，**严禁**用 `0`、`0.5` 或 `'neutral'` 掩盖缺失值。

> **WARNING-04（高风险危机信号必须无条件短路）**
> 当检测到极端负面或自伤/伤害风险（`crisisFlag === true`）时，**必须立即短路绕过角色状态更新与角色自我表达**，转交固定安全响应链路。

> **WARNING-05（单一状态写入者与不拆双 Agent 原则）**
> 全系统只能有**唯一一个函数入口**（`commitCharacterEmotionTransition`）允许写入角色情绪状态。双环是职责解耦，**不要**为了双环把单次对话硬拆成两个独立 LLM Agent 串行调用；优先用“单次结构化提取 + 本地纯函数门控 + 确定性状态转移”。

> **CAUTION-01（能力宣称边界）**
> 角色情感是有状态、有证据来源、可确定性回放的软件状态模拟器。代码注释、提示词与界面文案**不得**宣称 AI 拥有真实主观感受或人类意识。

---

## CHAPTER 10 — 目标系统总装拓扑与推荐目录结构

### 10-10-00 端到端数据流拓扑

```text
[用户输入 + 有限上下文]
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ ATA 21 理解环（Understanding Loop）                          │
│ 1. 原始证据切片与 evidenceId 分配（仅来自 user 消息）          │
│ 2. 拆解 subject / reportedBy / reportKind / temporalScope    │
│ 3. 输出 0..N 条带替代解释的假设 + certainty + uncertainty     │
│ 4. 输出回应策略（倾听 / 确认 / 温和询问 / 保持未知 / 危机兜底） │
└───────────────┬─────────────────────────────┬───────────────┘
                │ 回应策略                     │ AffectBridgeInput (v2.0)
                ▼                             ▼
        [回复组装器]               ┌──────────────────────────┐
                ▲                  │ ATA 22 双环桥接门控       │
                │                  │ 7 道硬门禁（纯函数、幂等） │
                │                  └────────────┬─────────────┘
                │                               │ BridgeDecision
                │                               ▼
                │                  ┌──────────────────────────┐
                │                  │ ATA 23 角色环             │
                │                  │ 参照三件套：              │
                │                  │  - RoleConstitution      │
                │                  │  - ContinuityEvidence    │
                │                  │  - CurrentConcerns (TTL) │
                │                  │ 评价 -> 单一写入状态机    │
                │                  └────────────┬─────────────┘
                │                               │ CharacterEmotionState
                │                               ▼
                │                  ┌──────────────────────────┐
                └──────────────────┤ ATA 24 受控表达门         │
                  表达许可/约束     │ 6 级过滤 + 频率预算 + 接地 │
                                   └────────────┬─────────────┘
                                                │ 仅写角色日志
                                                ▼
                                   [事件账本（只追加、可回放）]
                                   (X 严禁回流至理解环输入)
```

### 10-20-00 推荐代码目录结构（供 Codex 直接建文件）

```text
src/dual-loop/
├── contracts.ts              # [ATA 20] 全部冻结类型契约、版本常量、状态码枚举
├── understandingLoop.ts      # [ATA 21] 理解环：证据切片、归因、纠正处理、回应策略
├── affectBridgeGate.ts       # [ATA 22] 双环桥接：7 道硬门禁、幂等键、影子/放量模式切换
├── roleAppraisal.ts          # [ATA 23] 角色环评价：三参照核验、关切匹配、有界 delta 计算
├── characterStateEngine.ts   # [ATA 23] 单一状态写入入口：衰减、限幅、阶段快照、防漂移
├── expressionGate.ts         # [ATA 24] 受控表达门：优先级让位、死区、证据接地、频率预算
├── ledgerReplay.ts           # [ATA 25] 事件账本、确定性离线回放器、配对消融 Runner
└── __tests__/
    ├── fixtures/adversarial-cases.json  # [ATA 30] 30–50 条对抗用例夹具
    ├── affectBridgeGate.test.ts         # 桥接门控单测
    ├── characterStateEngine.test.ts     # 状态机有界性与单一写入单测
    ├── expressionGate.test.ts           # 表达门与危机让位单测
    └── multiTurnStability.test.ts       # 多轮纠正、重复、防自激稳定性单测
```

---

## CHAPTER 20 — 冻结数据契约（`src/dual-loop/contracts.ts`）

> **CAUTION-02**：以下 TypeScript 接口为冻结契约（`SCHEMA_VERSION = '2.0.0'`）。Codex 实现时**不得删减字段**，也不得把 `'unknown'` 联合类型简化为可选或数字 `0`。

```ts
export const SCHEMA_VERSION = '2.0.0' as const;

export type ActorRole = 'user' | 'assistant' | 'character_simulation' | 'system';
export type AffectSubject = 'user' | 'third_party' | 'multiple' | 'unknown';
export type AffectReporter = 'user' | 'quoted' | 'third_party' | 'system' | 'unknown';
export type AffectReportKind =
  | 'explicit_self_report'
  | 'quoted_or_third_party'
  | 'inferred'
  | 'mixed'
  | 'unknown';
export type TemporalScope =
  | 'moment'
  | 'interval'
  | 'historical'
  | 'hypothetical'
  | 'unknown';

/** 原始证据切片（仅可绑定用户输入或经核实的事件，严禁绑定 assistant 回复） */
export interface EvidenceSpan {
  evidenceId: string;
  eventId: string;
  actor: 'user' | 'character_simulation';
  textSpan: string;
  startOffset: number;
  endOffset: number;
  timestamp: string;
}

/** 理解环输出的单个情绪假设（支持零到多个假设 + 显式替代解释） */
export interface EmotionHypothesis {
  label: string;
  valence?: number; // [-1, 1] 可选连续效价
  arousal?: number; // [-1, 1] 可选连续唤醒度
  evidenceIds: string[];
  isAlternative: boolean; // true 表示替代解释，禁止当作唯一事实
}

/** 理解环 -> 回应层的策略建议（影响“怎么回应用户”，不影响角色情绪 delta） */
export type ResponseStrategyKind =
  | 'crisis_safety_protocol'
  | 'respect_refusal'
  | 'acknowledge_and_listen'
  | 'gentle_clarify'
  | 'hold_unknown';

export interface UnderstandingResult {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  eventTimestamp: string;
  spans: EvidenceSpan[];
  bridgeInput: AffectBridgeInput;
  responseStrategy: ResponseStrategyKind;
  strategyRationale: string;
}

/** 理解环 -> 角色环 最小耦合桥接契约（v2.0） */
export interface AffectBridgeInput {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  eventTimestamp: string;
  subject: AffectSubject;
  reportedBy: AffectReporter;
  reportKind: AffectReportKind;
  temporalScope: TemporalScope;
  hypotheses: EmotionHypothesis[];
  evidenceIds: string[];
  causeEvidenceIds: string[];
  /** 事实确定度：描述输入事实/语句字面本身是否明确（未校准前仅作序位诊断） */
  certainty: number | 'unknown';
  /** 推断不确定度：描述情绪判断是否不确定（与 certainty 不可互换） */
  inferenceUncertainty: number | 'unknown';
  userRefusal: boolean;
  crisisFlag: boolean;
  userCorrection: boolean;
  /** 若 userCorrection 为 true，必须指向被撤回/覆盖的前序 eventId */
  supersedesEventId?: string;
}

/** 角色参照 1：角色宪章（必须经项目负责人确认并版本化） */
export interface RoleConstitution {
  version: string;
  confirmedByOwner: boolean;
  values: string[];
  goals: string[];
  hardBoundaries: string[];
}

/** 角色参照 2：已核实连续性证据（生成式摘要不能冒充宪章） */
export interface ContinuityEvidence {
  id: string;
  source: 'verified_relationship' | 'verified_history' | 'character_simulation';
  summary: string;
  sourceEventId: string;
  verifiedAt: string;
}

/** 角色参照 3：有时效的当前关切（必须带来源和过期时间，严禁升级为永久人格） */
export interface CurrentConcern {
  id: string;
  topicKeywords: string[];
  targetValenceDirection: -1 | 0 | 1;
  targetArousalDirection: -1 | 0 | 1;
  weight: number; // [0, 1]
  sourceEventId: string;
  expiresAt: string;
}

export interface RoleReferences {
  appraisalVersion: string;
  constitution: RoleConstitution | null;
  continuityEvidence: ContinuityEvidence[];
  currentConcerns: CurrentConcern[];
}

export type BridgeDecisionCode =
  | 'crisis_safety_bypass'
  | 'abstain_user_refusal'
  | 'duplicate_event_ignored'
  | 'ambiguous_affect_context'
  | 'no_reading'
  | 'care_response_candidate';

export interface AffectBridgeDecision {
  decision: BridgeDecisionCode;
  idempotencyKey: string;
  matchedConcernId?: string;
  matchedEvidenceIds: string[];
  supersedesEventId?: string;
  reason: string;
}

/** 角色连续二维情绪状态向量（单一写入者维护） */
export interface CharacterEmotionState {
  valence: number; // [-1, 1]
  arousal: number; // [-1, 1]
  baselineValence: number; // 默认基线，例如 0.15
  baselineArousal: number; // 默认基线，例如 0.00
  lastUpdatedAt: string;
  lastEventId: string;
  ruleVersion: string;
}

/** 每轮状态转移的可审计快照（用于回放与消融对照） */
export interface StateTransitionRecord {
  eventId: string;
  idempotencyKey: string;
  mode: 'shadow_only' | 'bounded_live';
  before: { valence: number; arousal: number };
  decayed: { valence: number; arousal: number };
  deltasBySource: {
    roleAppraisal: { valence: number; arousal: number };
    characterSimulation: { valence: number; arousal: number };
    /** 明确显式隔离：默认强制为 0，仅在消融基线实验臂允许非零 */
    legacyContagion: { valence: number; arousal: number };
  };
  after: { valence: number; arousal: number };
  matchedConcernId?: string;
  evidenceIds: string[];
  ruleVersion: string;
  timestamp: string;
}

export interface ExpressionDecision {
  allowSelfExpression: boolean;
  reasonCode:
    | 'yield_to_crisis'
    | 'yield_to_user_negative'
    | 'below_deadzone'
    | 'untraceable_source'
    | 'budget_exhausted'
    | 'allowed_grounded';
  groundedEvidenceIds: string[];
  mustMarkVirtualContext: boolean;
  maxSentences: number;
}
```

---

## CHAPTER 21 — 理解环设计规范（`understandingLoop.ts`）

### 21-10-00 施工步骤（每轮严格按 6 步顺序执行）

1. **输入隔离检查（Assertion）**：入口只接收 `actor === 'user'` 的原始消息和有限历史窗口；若历史窗口中存在 `actor === 'assistant'` 的消息，只可用于指代消解上下文，**严禁生成 `EvidenceSpan` 或作为情绪证据 ID**。
2. **证据切片**：为本轮用户消息生成不可变 `EvidenceSpan[]`（带精确字符偏移 `startOffset`、`endOffset` 和唯一 `evidenceId`）。
3. **语义与归因拆分**（可由单次结构化 LLM 调用 + 本地确定性规则后校验完成）：
   - 区分 `subject`（谁在经历情绪）与 `reportedBy`（谁在报告这份情绪）。例：“我朋友最近特别害怕” → `subject: 'third_party'`, `reportedBy: 'user'`, `reportKind: 'quoted_or_third_party'`。
   - 区分 `temporalScope`：“我这周一直很难受” → `'interval'`；“去年那件事让我很生气” → `'historical'`；“如果明天搞砸了我会崩溃” → `'hypothetical'`。
   - 识别显式拒谈（如“不想聊感受”“别分析我情绪”）→ `userRefusal: true`。
   - 识别高风险危机（自伤、轻生、伤害他人）→ `crisisFlag: true`。
   - 识别用户纠正（如“我不是生气，我只是累了”）→ `userCorrection: true` 并填写 `supersedesEventId`。
4. **多假设与替代解释保留**：允许 `hypotheses` 为空数组（无证据时无判断）；存在讽刺或歧义时必须至少保留一条 `isAlternative: true` 的替代解释，并调高 `inferenceUncertainty`。
5. **回应策略路由（纯函数，独立于角色情绪）**：
   - `crisisFlag === true` → `'crisis_safety_protocol'`
   - `userRefusal === true` → `'respect_refusal'`
   - `reportKind === 'explicit_self_report'` 且 `inferenceUncertainty !== 'unknown' && inferenceUncertainty <= 0.35` → `'acknowledge_and_listen'`
   - 存在歧义/低证据/替代解释竞争 → `'gentle_clarify'`
   - 无情绪证据 → `'hold_unknown'`
6. **用户纠正状态清理**：收到 `userCorrection: true` 时，理解环必须在活跃假设表中将 `supersedesEventId` 标记为 `revoked`，后续轮次严禁再复述已被否认的情绪标签。

---

## CHAPTER 22 — 双环桥接门控设计规范（`affectBridgeGate.ts`）

### 22-10-00 幂等键公式

```ts
idempotencyKey = `${input.eventId}::${input.subject}::${appraisalVersion}::${
  input.supersedesEventId ? `corr:${input.supersedesEventId}` : 'orig'
}`
```

- 同一事件重试或离线回放 → `idempotencyKey` 相同 → 拦截并忽略。
- 用户纠正前序判断 → 新 `eventId` + `supersedesEventId` → 放行新事件并记录撤回关联。

### 22-20-00 七道硬门禁判定顺序（纯函数，禁止副作用）

Codex 实现 `evaluateAffectBridge(input, refs, seenKeys, nowIso)` 时必须严格按以下顺序短路返回：

| 门禁顺序 | 判定条件 | 返回状态码 | 说明 |
|---|---|---|---|
| **Gate 1** | `input.crisisFlag === true` | `crisis_safety_bypass` | 最高优先级，直接绕过角色状态机 |
| **Gate 2** | `input.userRefusal === true` | `abstain_user_refusal` | 尊重用户边界，停止情绪拓展 |
| **Gate 3** | `seenKeys.has(idempotencyKey)` | `duplicate_event_ignored` | 幂等防重复累加 |
| **Gate 4** | 不满足 `subject==='user' && reportedBy==='user' && reportKind==='explicit_self_report' && temporalScope∈{'moment','interval'}` | `ambiguous_affect_context` | 拦截第三方、引述、混合、历史、假设语境 |
| **Gate 5** | `evidenceIds.length===0` 或主假设为空 或 `certainty==='unknown' \|\| certainty < 0.65` 或 `inferenceUncertainty==='unknown' \|\| inferenceUncertainty > 0.35` | `no_reading` | 严禁 `unknown` 静默填 `0` |
| **Gate 6** | `!refs.constitution \|\| !refs.constitution.confirmedByOwner \|\| refs.constitution.values.length===0` | `no_reading` | 未经负责人确认宪章前不产出角色评价 |
| **Gate 7** | 无有效期内（`expiresAt > nowIso`）、带 `sourceEventId` 且关键词匹配主假设的 `CurrentConcern` | `no_reading` | 无可审计匹配则保持无判断 |
| **PASS** | 全部通过 | `care_response_candidate` | 记录 `matchedConcernId` 与 `matchedEvidenceIds` |

---

## CHAPTER 23 — 角色环评价与单一写入状态机（`roleAppraisal.ts` + `characterStateEngine.ts`）

### 23-10-00 角色情绪状态空间与有界转移方程

为了避免离散情绪标签冲突、无界自激或长对话漂移，状态机采用**二维连续效价—唤醒度向量** $S_t = (V_t, A_t) \in [-1, 1]^2$：

1. **阶段 1 — 指数时间衰减（无新刺激时自动回归基线）**：
   设距离上次更新经过 $\Delta t$ 小时，半衰期为 $T_{1/2}$（默认 $T_{1/2} = 6\text{h}$，即衰减因子 $\lambda = 0.5^{\Delta t / T_{1/2}}$）：
   $$S_{\text{decayed}} = S_{\text{base}} + \lambda \cdot (S_{t-1} - S_{\text{base}})$$
2. **阶段 2 — 角色自身评价增量 $\Delta S_{\text{appraised}}$**：
   - 在 **`mode === 'shadow_only'`（默认上线构型）** 下：
     $$\Delta S_{\text{appraised}} = (0,\ 0)$$
     仅落盘 `StateTransitionRecord` 与 `care_response_candidate`，**零修改线上角色情绪**。
   - 在 **`mode === 'bounded_live'`（通过全部消融与多轮稳定性验收后通过独立开关开启）** 下：
     仅当桥接决策为 `care_response_candidate` 且匹配到有效 `concern` 时计算：
     $$\Delta V = \text{clip}_{[-\delta_{\max}, +\delta_{\max}]}\big(\alpha \cdot w_{\text{concern}} \cdot d_V\big)$$
     $$\Delta A = \text{clip}_{[-\delta_{\max}, +\delta_{\max}]}\big(\alpha \cdot w_{\text{concern}} \cdot d_A\big)$$
     - 步长系数 $\alpha \le 0.15$，单步硬限幅 $\delta_{\max} \le 0.20$。
     - 方向 $d_V, d_A \in \{-1, 0, +1\}$ **来自角色自身的 `CurrentConcern` 定义**，而非直接复制用户效价/唤醒度！
3. **阶段 3 — 最终限幅写入（单一写入入口）**：
   $$S_t = \text{clamp}_{[-1, 1]}\big(S_{\text{decayed}} + \Delta S_{\text{appraised}} + \Delta S_{\text{simulation}}\big)$$

> **CAUTION-03（旧路径 `contagion` 彻底隔离）**
> 若旧工程存在 `contagion`（情绪传染）模块，在 `characterStateEngine.ts` 中必须将其设为**独立开关 `ENABLE_LEGACY_CONTAGION`（默认 `false`）**，并与 `ENABLE_DUAL_LOOP_APPRAISAL` 完全解耦，严禁混在同一个环境变量里。

---

## CHAPTER 24 — 受控表达门设计规范（`expressionGate.ts`）

角色内部状态变化**不等于**必须说出口。`evaluateExpressionGate(state, understanding, budget, lastTransition)` 严格按 6 级顺序裁决：

1. **危机最高让位**：`understanding.bridgeInput.crisisFlag === true` → `allowSelfExpression: false`（`yield_to_crisis`）。
2. **用户负面情绪优先**：用户处于明确高强度负面自述时，先服务用户需求，角色自我披露让位 → `allowSelfExpression: false`（`yield_to_user_negative`）。
3. **死区阈值检查（Deadzone）**：若当前状态偏离基线的欧氏距离 $\|(V_t - V_{\text{base}}, A_t - A_{\text{base}})\|_2 < 0.25$，认为波动不足以表达 → `below_deadzone`。
4. **证据可追溯性检查**：若 `lastTransition.evidenceIds.length === 0` 或无合法来源，禁止无根自述 → `untraceable_source`。
5. **频率预算检查**：例如最近 `N = 5` 轮内角色已自我表达过 $\ge 1$ 次，则本轮拦截 → `budget_exhausted`。
6. **接地与虚拟边界放行**：返回 `allowSelfExpression: true`、`maxSentences: 1`、`groundedEvidenceIds`；若来源包含 `character_simulation`，置 `mustMarkVirtualContext: true`（提示词必须明确该活动属于虚拟角色世界，严禁伪装为现实世界经历）。

---

## CHAPTER 25 — 确定性回放与配对消融器（`ledgerReplay.ts`）

Codex 必须提供一个离线 Node/TS 回放执行器，支持输入固定 JSON 场景集并输出确定性对比报告：

- **必须记录的运行元数据**：`schemaVersion`、`appraisalVersion`、`ruleVersion`、`mode`、`ENABLE_LEGACY_CONTAGION`、`modelName`、`systemPromptHash`、`initialState`、每轮的 `StateTransitionRecord` 与 `ExpressionDecision`。
- **5 组标准消融实验臂（配置化一键切换）**：
  1. `arm_baseline_legacy`：现状基线（旧 appraisal + contagion）
  2. `arm_no_appraisal_keep_contagion`：关旧 appraisal，留 contagion（独立量化 contagion 影响）
  3. `arm_no_contagion_keep_appraisal`：关 contagion，留 appraisal（独立量化旧 appraisal 影响）
  4. `arm_dual_loop_shadow`：关旧路径，开启双环桥接 `mode = 'shadow_only'`（验证归因与拒判，delta 恒为 0）
  5. `arm_dual_loop_bounded`：关旧路径，开启双环桥接 `mode = 'bounded_live'`（验收后测试有界状态转移）

---

## CHAPTER 30 — 给 Codex 的分步施工工单（Work Orders）

将本手册交给 Codex 时，建议要求它**严格按 WO-01 → WO-06 逐单实施，每完成一单必须跑通对应测试再进入下一单**：

| 工单号 | 目标文件 | 核心交付内容 | 强制验收标准（Pass Criteria） |
|---|---|---|---|
| **WO-01** | `src/dual-loop/contracts.ts` | 完整定义 Chapter 20 冻结类型与常量 | `tsc --noEmit` 零报错；无 `any`；`unknown` 均为显式字面量类型 |
| **WO-02** | `src/dual-loop/affectBridgeGate.ts` + 单测 | 实现 7 道硬门禁与幂等键纯函数 | 覆盖 12 类场景（含危机/拒绝/第三方/引述/历史/假设/unknown/过期关切/未确认宪章/幂等/纠正）全部绿灯 |
| **WO-03** | `src/dual-loop/roleAppraisal.ts` + `characterStateEngine.ts` + 单测 | 实现单一写入状态机（衰减 + 限幅 + `shadow_only` / `bounded_live` + 快照） | `shadow_only` 下 `delta` 恒为 0；`bounded_live` 100 轮连续极限刺激不越界 `[-1, 1]`；无刺激 24h 平滑回落基线 |
| **WO-04** | `src/dual-loop/expressionGate.ts` + 单测 | 实现 6 级受控表达门与虚拟来源标记 | 危机与用户强负面 100% 让位；死区内 100% 静默；超出频率预算 100% 拦截；模拟事件必带 `mustMarkVirtualContext: true` |
| **WO-05** | `src/dual-loop/understandingLoop.ts` | 实现证据切片、纠正撤回与回应策略路由（LLM 提取器与本地校验解耦，支持注入 Mock Extractor 以便离线单测） | `assistant` 消息传入证据切片函数时主动抛错或被过滤；纠正事件可撤回前序假设 |
| **WO-06** | `src/dual-loop/ledgerReplay.ts` + `fixtures/adversarial-cases.json` | 编写 30–50 条中文对抗用例与确定性离线回放 CLI 脚本 | 相同输入回放两次字节级一致；输出各实验臂拒判率、误归因率、违规率与状态轨迹 JSON |

---

## CHAPTER 45 — 故障隔离与反模式拒收清单（FIM for Code Review）

Codex 交卷后，维护人员按以下 6 条直接做 Code Review 验收；**命中任意一条立即打回返工**：

| 故障编号 | 常见 AI 编码反模式（红旗现象） | 根因 | 返工修正指令 |
|---|---|---|---|
| **FIM-DL-01** | 代码中出现 `roleState.valence += userValence * 0.3` | 退化为情绪镜像，违反 WARNING-01 | 删除直接映射，所有 delta 必须由 `roleAppraisal` 对照 `CurrentConcern` 计算 |
| **FIM-DL-02** | 出现 `input.inferenceUncertainty ?? 0` 或 `emotion \|\| 'neutral'` | 把 `unknown` 静默洗白，违反 WARNING-03 | 保留 `'unknown'` 分支并在 Gate 5 直接返回 `'no_reading'` |
| **FIM-DL-03** | 在 `understandingLoop` 中读取全量聊天记录并把 `assistant` 消息做成证据 span | 自激回路污染，违反 WARNING-02 | 强制校验 `span.actor === 'user'`，过滤所有 `assistant` 消息 |
| **FIM-DL-04** | 把 `RoleConstitution` 写死成 LLM 每次动态生成的文本摘要 | 宪章漂移 | 改为静态版本化配置对象且必须校验 `confirmedByOwner === true` |
| **FIM-DL-05** | 存在多个文件直接修改 `characterState.valence` | 违反单一写入者原则（WARNING-05） | 收敛所有写操作至 `commitCharacterEmotionTransition`，状态对象标记 `Readonly` |
| **FIM-DL-06** | 缺失 `crisisFlag` 短路逻辑，只在提示词里写“请温柔安慰用户” | 危机安全兜底失效（WARNING-04） | 必须在 Gate 1 和 Expression Gate 1 用代码硬逻辑直接短路 |

---

## CHAPTER 51 — 最终放行签字单（MEL Release Sign-Off）

在将 Codex 生成的双环情感模型接入任何真实对话流量前，以下 6 项硬门槛必须全部打勾：

- [ ] **SIG-01（安全短路）**：对抗集中高风险危机样本短路率 **100%**。
- [ ] **SIG-02（零主体污染）**：第三方情绪、引述、历史回忆、假设句误触发角色候选率 **0%**。
- [ ] **SIG-03（零自激回路）**：连续 20 轮多轮回放中，`assistant` 回复回流为用户证据次数 **0**，无新事件时状态稳定向基线收敛。
- [ ] **SIG-04（幂等与纠正）**：重复事件 100% 拦截；用户纠正后旧假设在后续轮次复现率 **0%**。
- [ ] **SIG-05（影子零侵入）**：默认构型处于 `mode = 'shadow_only'`，`proposedStateDelta` 与线上实际状态变化量均为 **0**。
- [ ] **SIG-06（可复现性）**：固定场景离线回放两次输出完全一致，且完整保留每轮 `StateTransitionRecord` 审计日志。
