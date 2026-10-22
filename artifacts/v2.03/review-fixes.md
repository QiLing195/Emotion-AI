# v2.03：按静态审查修「情绪识别 / 多通路重复影响 / 归因矛盾 / 来源重复计数」

> 对应审查结论（master `42a8043`）的四条 P1 + 两条 P2。按审查建议的顺序：先识别与归因，再计算口径，再来源指标，最后表达规则。
> 每条都写：问题 → 改了什么 → 证据。

## P1-1 否定的亲密表达被识别成 love

**改了什么**

- `src/lib/emotionNLU.ts`：在关键词匹配**之前**加否定/拒绝表（`不喜欢你 / 不喜欢 / 不爱(你) / 没喜欢过 / 不感兴趣 / 没感觉 / 讨厌你 / 烦你`）→ `anger`；
  - 双重否定 `不讨厌` → `love` 且低强度（不是拒绝）；
  - **引用/转述**（`「…」`、`他说/她说/我朋友/我同事…`）→ `directedAtAI=false`、强度 ×0.6、`uncertainty=0.6`；
  - **混合情绪**（正负词同时命中）→ 强度 ×0.85、`uncertainty=0.45`、cause 标"情绪可能混合"；
  - 所有返回值新增 `evidence`（前 80 字）与 `uncertainty`。
- `src/lib/emotionCanonical.ts`：否定别名优先表补 `不喜欢你/不喜欢/不爱你/不爱→anger`、`不讨厌→love`、`没感觉→neutral`（LLM 返回自然语言标签时也不会落进 love）。
- `server/services/emotionAnalyzer.ts`：英文 fallback 补 `don't/do not/not + love|like|miss + you` → anger。

**证据**

```
单测 src/lib/__tests__/emotionNegation.test.ts（6 条）：
  "我不喜欢你" → anger, directedAtAI=true
  "我不爱你了" → anger
  "我不讨厌你" → love（双重否定），uncertainty>0
  "他说他不喜欢我，我有点难过" → directedAtAI=false、cause 含"引用"、intensity<0.7
  "拿到offer很开心但又担心" → cause 含"混合"、uncertainty>0.3
  canonicalEmotion('不喜欢你')==='anger'
真机（LLM 路径）：发 "我不喜欢你这样说话。" → user.expressedEmotion=anger（不是 love）
```

## P1-2 一条输入经多条通路重复改变状态，缺跨来源总预算

**改了什么**

- 新增 `src/lib/turnBudget.ts`：`applyNonUserTurnBudget(state, base, cap)`
  - `base` = **直接刺激之后**的状态快照；
  - 非用户来源（传染/评价/内在/心情/反刍/shadow）累计变化（九情 L1 + |Δvalence| + |Δarousal|）超过 `cap`（默认 `0.25`）时**等比缩回**，方向不变；
  - 用户话语的直接刺激**不在预算内**（用户信号优先）。
- `server/services/aiCoordinator.ts`：在反刍层之后、external 记账之前执行预算；超预算时同时调 `scaleSourcesForBudget()` 把**已经记账的非用户来源**按同一比例缩回，保证"来源之和 ≈ 状态实际变化"（否则超额部分会变成凭空消失的账）。
- 新环境变量 `TURN_NONUSER_CAP`（默认 0.25）；`/state.turnBudget` 可观测 `{scale,totalBefore,cap,removed}`；日志 `[Budget] 非用户来源超预算 … 缩放到 …`。

**证据**

```
单测 src/lib/__tests__/turnBudget.test.ts（3 条）：未超预算原样 / 超预算缩后总变化≈cap 且方向不变 / 来源记账同步缩放
接线测试 server/services/__tests__/aiCoordinator.test.ts：TURN_NONUSER_CAP=0.01 时 getLastTurnBudget().scale<1 且 removed.emotionAbs>0
真机（默认 cap）：一句"我不喜欢你这样说话。" → [Budget] 0.443 > 0.25，缩放到 0.56；/state.turnBudget 同上
```

**没做的（诚实）**：没有把评价层/传染层删掉或合并成单一来源。现在口径是"各来源各司其职 + 单轮总预算"，
而不是"只保留一个综合影响"。如果以后要收敛成单一口径，应单独做 A/B，而不是在调参时顺手改。

## P1-3 事件归因与用户情绪归因可以互相矛盾

**改了什么**

- 新增 `src/lib/emotionAttributionConsistency.ts`：`reconcileAttribution(event, analysis)`
  - `directedAtAI=true` 但 `intent≠user` → 矛盾；
  - `intent=user` 但 `directedAtAI=false` 且情绪非中性 → 矛盾；
  - 强度很低但事件幅度很大 → 证据不一致；
  - 引用/转述证据 + 判成指向她 → 不确定；
  - 矛盾时：`directedAtAI=false`、强度 ×0.6、`attribution={consensus:'downgraded',issues}`、`skipReinforcement=true`。
- `emotionAnalyzer`：**LLM 路径与本地 fallback 路径都过这一步**；结果带 `attribution`。
- `aiCoordinator`：奖惩强化前检查 `attribution.consensus !== 'downgraded'` 且 `uncertainty < 0.6`，否则不强化。
- `/api/chat.emotionAnalysis` 新增 `attribution`（可观测）；`UserEmotionAnalysis` 新增可选 `evidence / uncertainty / attribution`。

**证据**

```
单测 src/lib/__tests__/emotionAttributionConsistency.test.ts（6 条）
接线测试 emotionAnalyzer.test.ts（3 条）：矛盾 → downgraded + directedAtAI=false + 强度降低；一致 → 不动；本地 fallback "我不喜欢你" → anger
真机：/api/chat 返回 emotionAnalysis.attribution={"consensus":"consistent","issues":[]}
```

## P1-4 来源诊断重复计数（external 吞掉其它来源）

**改了什么**

- `aiCoordinator` 阶段 3：`applyEvent` 之后立刻拍 `directStimulusAfter` 快照；
- external 记账改为**只统计"本轮开始 → 直接刺激结束"**（delta 与九情 L1 都用这份快照），
  传染/评价/内在/心情/反刍仍各自记自己的来源。
- 之前 external 用 `valenceBeforeInternal - 本轮开始` 且九情用"开始→最终"，等于把后续所有来源又算了一遍。

**证据**

```
接线测试 aiCoordinator.test.ts：
  只发生直接刺激（userAnalysis=null）时，external 增加；contagion/appraisal 增量为 0
真机 /state.emergence.breakdown（一轮强情绪）：
  external 0.291 / contagion 0.032 / appraisal 0.052 / internal 0.002 / mood 0 / rumination 0
  （external 明显大于各内部来源，不再是把它们加总的"总和"）
```

## P2-1 情绪识别缺少不确定度与证据范围

**改了什么**：`UserEmotionAnalysis` 增加可选 `evidence`（文本片段）与 `uncertainty`；本地识别给出基于引用/混合的数值；
`sanitizeUserAnalysis` 会保留模型或 fallback 的这两个字段；归因矛盾时强度打折。

**仍缺**：LLM 分析 Prompt 还没有要求模型输出"证据/不确定度"两个字段（现在靠代码侧的引用/混合启发式补）。
下一步可以让模型显式给 `evidence` 与 `consistency`，并抽"引用、反讽、混合、非指向"场景集进回归。

## P2-2 表达许可仍允许"说几句"

**改了什么**

- `emotionExpression.ts` 两处许可文案：`最多一句，简短 ≤30 字`，并明确"说完回到他的事"；
- 删掉"想说几句都行"的措辞；单测同步改为断言"最多一句 + ≤30 字 + 不含'想说几句都行'"。

## 新增 / 修改的测试

```
新增：src/lib/__tests__/emotionNegation.test.ts（6）
新增：src/lib/__tests__/emotionAttributionConsistency.test.ts（6）
新增：src/lib/__tests__/turnBudget.test.ts（3，含来源缩放）
追加：server/services/__tests__/emotionAnalyzer.test.ts（+3 归因接线）
追加：server/services/__tests__/aiCoordinator.test.ts（+2 external 隔离 / 预算）
全量：1942 tests / 108 files 通过；tsc 0
```

## 下一步（按审查建议）

1. 用修正后的来源指标重跑涌现自检（`npm run smoke:emotion`），确认 `internalShare` 不再被重复计数污染；
2. 补"引用/反讽/混合/非指向"场景集 + 连续多轮回放，确认一次误判不会累积成错误关系状态；
3. LLM 分析 Prompt 输出 `evidence` 与一致性，而不是只靠代码侧启发式；
4. 表达层的"每轮最多一个主意图 + 最多一个问题"仍靠 Prompt 约束，没有代码强制（下一步做 `ExpressionPlan`）。
