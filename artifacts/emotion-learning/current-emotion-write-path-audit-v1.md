# AI Friend 当前情绪状态写入链路审计 v1

审计日期：2026-11-02
审计类型：CodeGraph 静态调用链审查；未运行服务、未执行实验。
目的：在增加 MEGM 影子 adapter 前，记录当前线上情绪来源、状态写入顺序、开关和可观测性，避免把目标架构误当成现状。

## 结论

**当前情绪处理不是隔离的双环。** 用户情绪分析会作为直接刺激改变 `EmotionState`，随后又可能经过 contagion 和 AI Friend 自有 appraisal 再次改变同一状态；后面还会经过内在事件、心情和反刍调制。多个纯函数按顺序变换同一个回合状态，`applyCharacterEmotionStage` 是主要编排点。

至少要把四类事分开审查：

1. 用户说了什么、分析器如何归因；
2. 角色自己的状态受了哪些写入；
3. 当前来源指标如何归因这些变化；
4. 回复表达最终读取了哪些状态和证据。

本审计未证明逻辑错误或效果好坏，只确认实际数据路径与需要控制的实验变量。

## 逐步状态变换

| 顺序 | 位置 / 函数 | 输入与触发条件 | 改变什么 | 开关与可观测性 |
|---|---|---|---|---|
| 0a | `aiCoordinator.ts:702–734` `processTimeDecay` | 距上次交互时间；间隔大于 0 且服务端衰减未禁用 | 就地更新当前状态（衰减到本轮开始） | `serverDecayDisabled()`；有 `depthBeforeDecay` 辅助记录 |
| 0b | `aiCoordinator.ts:736–750` `updateTypicalEmotions` / `updateLowPeriod` | 本轮直接刺激之前的状态 | 更新 typical/低谷追踪参照字段 | 属参照/时序元数据，不是本轮情绪刺激；低谷更新仅记录 |
| 1 | `aiCoordinator.ts:807–829` `applyEvent → applyEmotionUpdate → updateEmotionState` | 存在 `input.emotionEvent`；该事件来自情绪分析器 | 更新 valence、arousal、sancai、九情等；形成 `directStimulusAfter` 快照 | 无 emotionEvent 时跳过；`applyEvent` 纯函数；`external` 来源只记录到该快照 |
| 2 | `characterEmotionStage.ts:70–84` `applyEmotionalContagion` | 有 `userAnalysis`，且情绪强度 ≥0.2、共情值 ≥10 | 直接改角色九情和 valence；按情绪类别和 empathy 计算映射幅度 | 在本阶段没有单独的 contagion 开关；`appraisalEnabled` 不会关闭 contagion。记入 `contagion` 来源 |
| 3 | `characterEmotionStage.ts:86–105` `appraiseEvent → applyAppraisal` | 有 `userAnalysis` 且 coordinator 传入 `appraisalEnabled=true`；有 appraisal readings 才写状态 | 根据用户文本、用户情绪/强度和 open-loop/worry concern readings 改九情、valence、arousal | coordinator 使用 `DISABLE_APPRAISAL !== 'true'`；记入 `appraisal` 来源。该模块不是 MEGM 引擎，而是 AI Friend 现有在线 appraisal |
| 4 | `characterEmotionStage.ts:108–166` 内在事件验证与 `applyInternalEvents` | idle、interest、thought、discovery、insight、activity concern 等候选经校验 | 改九情、valence、arousal；每轮最多接受 3 个候选，总影响上限 `INTERNAL_TOTAL_CAP=0.1` | 候选包含 eventId/source/evidenceRef/confidence/TTL；重复项由 `seen` 去重；记入 `internal` 来源 |
| 5 | `characterEmotionStage.ts:168–187` `applyMoodBias` | 上一轮 mood 存在且 samples > 0 | 依据上轮 mood、当前主导情绪及上轮 valence 调整状态 | 记入 `mood` 来源 |
| 6 | `characterEmotionStage.ts:189–198` `ruminationModulation` | 每轮调用 | 依据上轮 rumination 和时间调整状态 | 记入 `rumination` 来源 |
| 7 | `characterEmotionStage.ts:208–228` mood/rumination trackers | 完成上述写入之后 | 更新下一轮 mood 与 rumination 追踪状态 | `EmotionState` 中的内部追踪字段 |
| 8 | `aiCoordinator.ts:978` | `applyCharacterEmotionStage` 返回 | 将最终 `emotionStage.state` 赋给本轮 `updatedEmotionState` | 后续回复/服务状态使用最终状态 |

## 情绪分析进入状态链的来源

`emotionAnalyzer.ts:227–263` 先运行本地用户情绪识别作为 fallback；有 API 设置时请求 LLM，sanitize `EmotionEvent` 和 `UserEmotionAnalysis`，合并本地检测到的混合/引用不确定性，随后做归因一致性裁决。失败或无 API key 时回到本地分析与 `fallbackEmotionEvent`。

`emotionEvent` 进入第 1 步的直接刺激；`userAnalysis` 又分别进入第 2 步 contagion 和第 3 步 appraisal。因此同一个分析结果有多个下游影响路径。`directedAtAI`/`intent` 有利于区分指向，但并不自动表示情绪分析为事实，也不自动隔离状态传播。

## 状态写入者与字段范围

本轮并非只有两位写入者。按当前调用链，至少有如下连续变换：

- `processTimeDecay`：跨轮时间衰减；
- `updateEmotionState`：事件刺激驱动的综合状态变换；
- `applyEmotionalContagion`：用户情绪映射到角色情绪和 valence；
- `applyAppraisal`：AI Friend 当前角色评价结果改角色情绪、valence、arousal；
- `applyInternalEvents`：角色内在活动/idle 等事件影响情绪、valence、arousal；
- `applyMoodBias` 与 `ruminationModulation`：后续调制；
- `updateMood` / `trackRumination`：更新跨轮内部追踪。

所以“单一状态写入者”在当前系统是**未来收敛目标**。短期可以保留纯函数变换，但必须有一个可审计的编排者、明确顺序、每步前后快照和来源记录；不应把多个变换称为已隔离的环。

## 可观测性和实验控制

- `recordEmotionSourceChange` 用统一快照比较各阶段前后 valence、arousal 和情绪总变化，来源包括 direct/external、contagion、appraisal、internal、mood、rumination。它能回答“变化记在哪个来源桶”，但不单独证明该来源因果合理或用户情绪识别正确。
- **当前已确认的开关**：`DISABLE_APPRAISAL=true` 会让 coordinator 传入 `appraisalEnabled=false`；它不关闭 contagion。
- **当前未找到独立 contagion 环境开关**：`CharacterEmotionStageInput` 有 `appraisalEnabled`，没有对应 `contagionEnabled` 字段；若要做无 contagion arm，应先通过独立 runner/构造输入实现并验证，不能以关闭 appraisal 代替。
- 关闭直接刺激、contagion、appraisal 可能还改变后续 mood、rumination、低谷/表达策略读数；每个实验臂必须记录所有开关和状态快照，说明估计的是哪一条路径的增量。
- `emotionAnalysis.source`、归因裁决、`EmotionSourceSnapshot`、各阶段来源差分可用于审计；本次未检查运行时日志是否在所有场景都完整落盘，需 pilot 实测。

## 角色参照现状

已存在候选参照来源：`EmotionState.evolution`、`baselineEmotions`、`typicalEmotions`、`internal.motive`；`IdentityNarrative` 含 personalitySnapshot/coreValues，但它由经历、人格演化、价值系统和情绪状态生成；价值系统与关系状态也可持久化。它们各自用途和证据强度不同。

本次静态审查没有找到一份独立、版本化、由项目负责人确认的 `RoleConstitution`，能区分稳定价值、目标和硬边界。故 MEGM 的角色 appraisal 对无法对应到可靠角色参照的维度应输出 `unknown/no_reading`。该契约需要项目负责人确认内容，工程师不应从自动生成的 IdentityNarrative 反向编造。

## 下一步建议

1. 冻结此 as-is 表并在隔离 runner 中核对诊断字段，特别是每一阶段的 delta 是否与 `emergence` 分桶一致。
2. 构造配对 arm：当前生产；关闭 appraisal 但保留 contagion；隔离 runner 中关闭 contagion 但保留 appraisal；两者都关闭作为诊断基线。先验证这些 runner 没有改动输入、状态初始化、提示和其他写入。
3. 在拆分测试前，先由项目负责人提供或确认 5–8 条角色宪章条目；没有条目时只测用户理解与回复策略，不声称已验证角色自身 appraisal。
4. 独立标注场景；涵盖即时自述与跨时间自述（例如“我这周一直很难受”），并保留引述/第三方/纠正/未知样本。
5. 完成 baseline 数据后，再冻结 MEGM 维度到 appraisal 记录的逐字段映射；不在当前审计中改变任何状态写入代码。

## 静态来源位置

- `server/services/emotionAnalyzer.ts:117–171, 212–263`
- `server/services/aiCoordinator.ts:702–750, 807–850, 958–978`
- `src/lib/stateReducer.ts:136–169`
- `src/lib/emotionEngine.ts:351–438`
- `src/lib/emotionReinforcement.ts:103–144`
- `src/lib/characterEmotionStage.ts:63–228`
- `src/lib/appraisal.ts:175–294`
- `src/lib/emotionInternal.ts:79–126, 169–198`
- `src/lib/emergenceMetrics.ts:54–67, 165–179`
