# 当前情绪写入链验证记录 v1

日期：2026-11-02
对应审计：[current-emotion-write-path-audit-v1.md](current-emotion-write-path-audit-v1.md)
范围：既有本地单元测试 + 一次进程内纯函数对照；不调用模型 API、不启动服务、不写项目持久化记忆。

## 结果

### 已通过的既有单元测试

```text
5 个测试文件通过，119/119 tests 通过：
- src/lib/__tests__/characterEmotionStage.test.ts
- src/lib/__tests__/appraisal.test.ts
- src/lib/__tests__/emotionInternal.test.ts
- src/lib/__tests__/moodLayer.test.ts
- server/services/__tests__/aiCoordinator.test.ts

另跑 src/lib/__tests__/rumination.test.ts：32/32 tests 通过。
```

相关覆盖：direct stimulus 与 contagion/internal 的来源分桶；AI Coordinator 在无 userAnalysis 时 external 有增量、contagion/appraisal 无增量；appraisal 纯函数；内在事件和 mood/rumination 基础逻辑。测试通过只说明这些断言成立，不等于生产模型判断正确。

### `appraisalEnabled` 开关的进程内对照

使用 `INITIAL_EMOTION_STATE`、固定 `userAnalysis={expressedEmotion:'sad', intensity:0.7}`、无直接刺激、无 concerns/活动/心情输入，分别调用 `applyCharacterEmotionStage`，唯一变量是 `appraisalEnabled`：

| 条件 | `appraisalUpdated` | appraisal readings | contagion source | appraisal source | internal/mood/rumination | Δsad |
|---|---:|---:|---:|---:|---:|---:|
| appraisal disabled | false | 0 | 0.035406 | 0 | 0 / 0 / 0 | +0.0224 |
| appraisal enabled | true | 1 | 0.035406 | 0.084 | 0 / 0 / 0 | +0.0364 |

结论：关闭 `appraisalEnabled` 后，**传染仍会改变角色情绪**；开启 appraisal 后，额外发生 appraisal 状态变化。此对照验证的是 stage 纯函数参数，不是完整 HTTP/API 服务实验。

## 目前能与不能确认的开关

- 已在 `aiCoordinator.ts` 静态确认 `DISABLE_APPRAISAL=true` 会把 `appraisalEnabled` 设为 false。
- 未找到独立 contagion 开关；`applyCharacterEmotionStage` 在有 `userAnalysis` 时直接运行 contagion。
- 已运行的 Coordinator 单测证明 `userAnalysis=null` 时 appraisal 和 contagion 分桶均不增加，但这同时移除了两者的输入，不能作为仅关闭 contagion 的干净实验臂。
- 本次没有运行完整 `processTurn` 的环境变量臂对照，因此 `DISABLE_APPRAISAL` 的端到端隔离仍属“静态 wiring + stage 纯函数已验证”，不是完整管道验证。

## 来源账目验证范围

已通过的集成断言覆盖 `external` 截止于 direct-stimulus snapshot，以及 contagion、internal 分桶确有变化；直接 stage 对照覆盖 contagion/appraisal 的差分。mood 和 rumination 的独立纯逻辑测试通过，但这次没有构造一个单一 fixture 同时使每个阶段产生非零值并核验每个来源总和。因此，**完整逐字段因果账本仍未验收**；后续若需要严格关口，应补一条隔离的 integration fixture，显式构造 previousMood、rumination streak、internal candidate，并逐阶段比对 state snapshot 与来源增量。

## 下一步关口

当前可以进入映射契约的独立标注/字段对齐准备；仍不能打开新 MEGM 影子状态写入。若要做干净的 contagion ablation，应在隔离 runner 中增加只供实验构造的 `userAnalysis` / contagion 输入控制，或引入明确的 stage 输入开关并验证该开关不触碰 direct stimulus、appraisal、internal、mood、rumination、提示和记忆。不要为了省事把 `DISABLE_APPRAISAL` 当作 contagion ablation。
