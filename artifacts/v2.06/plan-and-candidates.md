# v2.06：内在活动候选接口 + ExpressionPlan（不加自由 agent）

> 采纳建议：**暂不引入“自己产生情绪并直接说话”的 agent**。先把「来源可信 + 表达可控」补上。
> 你点名的第 1、2 项在当前 HEAD 已经是修好的（v2.04），下面先给证据，再写这轮新增的 3、4。

## 0. 先确认：归因轴与来源账本（v2.04 已修）

**归因轴**（`src/lib/emotionAttributionConsistency.ts:44-48`）：

```ts
// intent==='user' 的语义是"这件事和他有关"，不是"情绪指向 AI"；合理组合不判矛盾
if (next.directedAtAI && event && event.intent === 'third_party') {
  issues.push('directedAtAI=true 但 event.intent=third_party');
}
```

测试里也固定了：`intent=user + directedAtAI=false → consistent`、`intent=self + directedAtAI=true → consistent`、只有 `third_party + 指向她` 才降级。

**来源账本**（`aiCoordinator.ts`）：
- `emergence.mood/rumination/...` 各自记自己的增量；
- 预算用 `applySourceBudgetDelta(before, current, sources, scale)`：`before + (current-before)*scale`，**只缩本轮增量**；
- 预算结算在所有来源（**含 shadow**）之后；
- 无 `emotionEvent` 时基准退回“本轮开始前”，且 external 记 0。
- 真机连续两轮验证过：`contagion 0.043→0.079`、`appraisal 0.084→0.234`，无来源回退。

所以新接口可以安全地接在这条链上。

## 1. 内在活动候选接口（`src/lib/intrinsicActivity.ts`）

```ts
interface IntrinsicCandidate {
  eventId: string;       // 稳定 id，重复出现必须同 id（去重）
  type: string;
  source: 'idle'|'thought'|'interest'|'discovery'|'insight'|'activity';
  evidenceRef: string;   // 证据引用（idle:200m / thought:thought_wish / activity:job …）
  confidence: number;    // <0.4 拒绝
  expiresAt: number;     // 过期拒绝（旧事不能当成"现在"）
  intensity: number;     // clamp [0,1]
}
```

`validateIntrinsicCandidates()` 的拒绝原因：`duplicate / expired / no_evidence / low_confidence / invalid / over_budget`（单轮默认最多 3 个）。
`IntrinsicDedup` 是有界去重表（默认 200 个 id），防止进程内无限增长。
`INTRINSIC_DEFAULTS` 给每类默认时效/置信度：重逢 24h、孤独/活动关切 2h、思维/兴趣/发现/洞察 6h。

**接线**（`aiCoordinator` 内在事件阶段）：

```
deriveInternalEvents(...) → 映射成候选（eventId=轮次+类型+证据）
  → validateIntrinsicCandidates（去重/过期/证据/置信度/上限）
  → 只有 accepted 才 applyInternalEvents
  → /state.intrinsic 暴露 accepted/rejected；日志 [Intrinsic] 只记原因，不记正文
```

效果：**同一内在活动不会每轮反复施加**；没证据/过期候选不会变成“真实经历”。

## 2. ExpressionPlan（`src/lib/expressionPlan.ts`）

确定性计划器（不调模型），输出：

```ts
{
  decision: 'express' | 'silent',
  reason: 'his_negative_defer' | 'budget（…）' | 'resting（…）' | 'express:sad(sustained)' | …,
  emotion, tone,
  duration: 'transient' | 'sustained' | 'unknown',
  maxSentences: 1, maxQuestions: 1,
  evidence, causeQuote, sourceEventId, confidence
}
```

规则（顺序）：

1. 他明确负面情绪（sad/anger/fear/disgust，强度 ≥0.4）且不是问她 → **silent（让位）**；
2. 距上次表达 <3 轮且不是问她 → **silent（预算）**；
3. 没有超过死区、且**不并列**的可辨识情绪 → **silent（静息/不确定）**；
4. 时间尺度：只有 `低已成段 || |心情偏置|≥0.05 || 反刍 streak≥3` 才算 **sustained**；否则 **transient**；她直接被问且无持续来源时 **unknown**（只回答此刻，不延伸）；
5. 证据只列真实来源（低谷/心情层/反刍/内在候选/**本轮他刚说的话**）；没有证据就明确“说不清”，不许编；
6. `expressionPlanToSnippet()` 把它渲染成回复片段，并**显式禁止** transient 时说“这两天/一直/最近几天/这些天”。

同时修了一个证据错配：`causeQuote` 现在只接受**本轮用户原话**（之前会把上一轮“我老板骂我”当成这一轮的原因）。

**接线**：`ENABLE_UNIFIED_EXPRESSION=true` 时走计划器（旧 `buildUnifiedPermit` 保留为回退）；`/state.expressionPlan` 可观测。
本机 `.env` 已开启该开关用于验证（**仓库默认仍由 env 控制**，未写死；是否默认开需要单独 A/B）。

## 3. 验证：场景集 + 计划同轮记录（10/10）

`scripts/emotion-scenarios.mjs` 现在每轮记录 `expressionPlan` 与 `intrinsic`，并新增**全局检查**：

> 计划是 `transient` 时，回复不得出现“这两天/一直被…/最近几天/这些天”这类持续状态词。

最近一次运行（`SCENARIO_USER=emotion-scenarios-v10`）：

```
negation_direct ✅   negation_quoted ✅   third_party_anger ✅
mixed_emotion ✅     sad_no_self_focus ✅  ask_her_state ✅
ai_identity ✅       repeated_negation ✅  reunion_after_idle ✅
contradiction_repair ✅                     → 10/10
no_transient_duration_fabrication: 0 个失败
```

典型计划（`ask_her_state`，她处在低谷）：

```json
{"decision":"express","emotion":"disgust","duration":"sustained","confidence":0.84,
 "evidence":"低谷已持续成段；心情层偏置 -0.47；反刍层在运转；内在活动：thought_wish（thought:thought_wish）"}
```

对应回复：“闷，说不上来为什么。你呢，翻杭州的徒步路线翻出结果了吗？”——**一句自我状态 + 回到他的事**，没有编原因（计划 evidence 里没有他这句话）。

多数“他负面情绪”的轮次计划是 `silent / his_negative_defer`（先接住他，不插入她自己）。

## 4. 测试

```
新增 src/lib/__tests__/expressionPlan.test.ts（8 条）：
  resting→silent / 他负面→让位 / 预算→silent / transient 禁止持续词 /
  sustained 允许 / 心情偏置→sustained / 有原因→证据且置信更高 / 直接问→unknown
新增 src/lib/__tests__/intrinsicActivity.test.ts（7 条）：
  clamp / expired / no_evidence / duplicate / low_confidence / 单轮上限 / 去重表有界
全量：1962 tests / 110 files 通过；tsc 0
```

## 5. 刻意没做的

- **没有加自由 agent**：候选只接受规则/确定性来源；LLM 只能以后往这个接口“投候选”，不能改状态或发言；
- 没有让回复模型决定情绪/时间尺度/原因——这些都写在计划里；
- 没有默认开启统一表达（本机验证用 `.env`，仓库默认保持 env 控制，等 A/B）。

## 6. 下一步

1. 给 unified expression / ExpressionPlan 做真管道 A/B（开/关两臂，多轮场景 + 人工复核），达标再决定默认开；
2. 把 `expressionPlan` 与 `intrinsic` 的 accepted/rejected 写进脱敏 trace 文件（现在只在内存 + `/state`）；
3. 候选接口接“LLM 提候选”的实验臂（只投候选，不直接生效），与规则候选做对比；
4. 场景集补“反讽/第三人称/替朋友难过”。
