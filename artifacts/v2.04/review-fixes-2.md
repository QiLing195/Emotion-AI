# v2.04：修 v2.03 审查发现的三处（归因语义 / 历史累计 / 预算覆盖）

> 审查结论（`42a8043..HEAD`，含 `2c9cc35`、`d3ff52b`）指出三条，全部接受并修：
> 1. 把"事件关于用户"误当成"情绪指向 AI"；
> 2. 预算缩放改写了历史累计指标；
> 3. 预算没覆盖无 `emotionEvent` 的情况，且 shadow 在预算之后施加。

## 1. 归因语义错误（Standards P1）

**问题**：`reconcileAttribution` 把 `event.intent === 'user'`（这件事和他有关）与 `directedAtAI === false`（情绪不是冲她）判成矛盾。
但"他因工作难过、情绪不针对她"是**合理组合**，旧逻辑会把强度 ×0.6，影响后续情绪传染。

**修法**（`src/lib/emotionAttributionConsistency.ts`）：
- 删除该条矛盾判断；
- 只保留**明确第三方**的矛盾：`directedAtAI=true` 且 `event.intent==='third_party'`；
- 保留"低强度大事件""引用/转述却指向她"两条证据类判断；
- 注释写清 `intent` 语义：`'user'` = 事件关于他，**不是**"情绪指向 AI"。

**证据**：单测从"intent=user + directedAtAI=false → 降级"改为"→ 合理，不降级"；新增 "intent=self + directedAtAI=true → 合理" 与 "third_party 却指向她 → 降级"。
全量 1946 通过。

## 2. 预算缩放改写历史累计（Spec P1）

**问题**：`scaleSourcesForBudget(this.emergence, …)` 把**累计**统计整体 × scale，每轮超预算都会连带缩小过去轮次的 contagion/appraisal/internal/mood/rumination/shadow → `/state.emergence`、`internalShare` 不再代表真实历史。

**修法**（`src/lib/emergenceMetrics.ts` + `aiCoordinator.ts`）：
- 新增 `applySourceBudgetDelta(before, current, sources, scale)`：`next[s] = before[s] + (current[s] - before[s]) * scale`，**只缩放本轮增量**；
- coordinator 在非用户来源开始前拍 `emergenceBeforeNonUser` 快照，结算时用它而不是直接乘累计。

**证据**：
- 单测：`before.contagion=3.0`、`current=3.2`、scale=0.5 → `3.1`（历史 3.0 保留，只把 +0.2 缩成 +0.1）；external 不变。
- 真机连续两轮强情绪：`contagion 0.043→0.079`、`appraisal 0.084→0.234`、`rumination 0.081→0.081`、external 0.238→0.385 —— **没有任何来源回退** ✅。

## 3. 预算覆盖不全 + shadow 在预算之后（Spec P1）

**问题**：
- 预算只在 `directStimulusAfter` 存在（即 `emotionEvent` 非空）时结算；无直接事件时内部事件/心情/反刍绕开预算；
- shadow 偏置在原预算块之后施加，最终状态可以突破"包含 shadow"的上限。

**修法**：
- 预算**总是结算**：基准优先用 `directStimulusAfter`，没有时退回"本轮开始前"的状态；
- 预算块**移到 shadow 施加之后**（阶段 3.7 人格漂移之前），来源列表包含 `shadow`；
- 顺带修正 external 记账：没有 `emotionEvent` 时直接记 0（旧写法用"当前状态-开始"会把后来的非用户来源算进 external）。

**证据**：
- 新接线测试：`TURN_NONUSER_CAP=0.001` + 无 `emotionEvent`（仅 12h 孤独内部事件）→ `getLastTurnBudget().scale < 1`；
- 代码顺序检查：shadow 施加在 1122 行、预算结算在 1138 行（之后才是人格漂移）；
- 真机：`/state.turnBudget` 正常上报；连续两轮来源单调不回退。

## 测试

```
新增/更正：
  src/lib/__tests__/emotionAttributionConsistency.test.ts（8 条，含 v2.04 语义更正）
  src/lib/__tests__/turnBudget.test.ts（+1 历史累计不动）
  server/services/__tests__/aiCoordinator.test.ts（+1 无 emotionEvent 仍受预算约束）
  server/services/__tests__/emotionAnalyzer.test.ts（矛盾用例改为 third_party）
全量：1946 tests / 108 files 通过；tsc 0
```

## 仍未做（与上轮一致）

- LLM 分析 Prompt 还没要求模型输出 `evidence` / 一致性（现在靠代码侧启发式）；
- `ExpressionPlan`（主意图/语气/自我披露/提问上限）仍只写在 Prompt 里，没有运行时强制；
- 引用/反讽/混合/非指向场景集 + 连续多轮回放还没补。
