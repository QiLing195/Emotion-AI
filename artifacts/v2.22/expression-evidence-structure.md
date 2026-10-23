# v2.22 从源头修掉 evidence 引文（不再依赖遮蔽）

> 接 v2.21 的遗留：`plan.evidence` 是自由字符串，v2.21 只能"事后遮蔽带引号的引文"。
> 这次把问题从源头拆掉：**evidence 只放结构化原因标签；引文只留在 `causeQuote` 字段，仅拼进 Prompt 片段。**

## 改动

### 1. `src/lib/expressionPlan.ts`

```ts
// 以前：
if (input.causeQuote) evidenceParts.push(`他刚说的「${input.causeQuote}」`);  // ← 用户原话进了 evidence

// 现在：
if (input.causeQuote) evidenceParts.push('本轮他的原话（引文只在 Prompt 片段里提供）');
// evidence 本身不再含任何引文；causeQuote 仍是独立字段
```

`expressionPlanToSnippet()`（只给模型看，不落盘）负责把引文拼回去：

```ts
const evidenceText = [plan.evidence, plan.causeQuote ? `他刚说的「${plan.causeQuote}」` : null]
  .filter(Boolean).join('；');
```

→ 模型仍然能"引用他的原话"，但**任何把 plan 落盘/上报的消费者都拿不到原话**。

### 2. `server/services/turnTrace.ts`

- 输入 plan 允许带 `causeQuote`，但**只取存在性**：记录里存 `hasCauseQuote: boolean`，不存内容；
- v2.21 的 `sanitizeTraceLabel()` 保留，作为"防御层"（万一有旧式/外部传入的 evidence 带引号）。

### 3. 顺手修掉一个反复出现的测试 flake（真根因）

全量并行时 `generationBudget.test.ts` 偶发红，之前误以为是 deadline 太紧。真正原因：

```ts
const b = singleCallBudget({ GEN_CALL_TIMEOUT_MS: '3000' });
expect(b.timeoutForCall()).toBe(3000);  // ← 真实时钟：构造到这里已过了几 ms，返回 2997
```

改成"`> 0` 且 `<= 3000`"。另外把 deadline 测试余量放宽（120ms→500ms、80ms→200ms）。修完后**连续两次全量 2010 通过**。

## 证据

| 项 | 结果 |
|---|---|
| `expressionPlan.test.ts` | 更新断言：evidence **不含**原话、含"本轮他的原话"；`causeQuote` 保留；**Prompt 片段仍含** `他刚说的「…」` |
| `turnTraceEvidence.test.ts` | 2 条：`hasCauseQuote=true` 且 trace 不含原话；旧式带引号 evidence 仍被遮蔽（防御） |
| 全量测试 | **2010 通过**（连续两跑） |
| tsc | 0 |
| 情绪场景集（新代码重启后） | **14/14**（含 `good_news_offer`） |
| 关键不变量 | 模型仍能拿到引文（snippet 含原话）；落盘 trace 不含引文 |

## 诚实局限

- `causeQuote` 本身仍会进 **Prompt**（这是设计需要，模型要引用他的话）；也会进 `server.ts` 的 timeline 节点 `causeQuoted`
  （若 `ENABLE_EMOTION_TIMELINE=true`，本地文件，非 trace）——这次没改。
- 场景脚本把完整 plan（含 causeQuote）写进 `test_data/emotion_scenario_results.json`（测试夹具，输入是预设句，不是真实用户）。
- `sanitizeTraceLabel` 仍需保留：它防的是"未来某个调用方又把内容塞进 evidence"，不是主路径。
- `hasCauseQuote` 是新增字段，旧 trace 行没有它（审计脚本按可选处理）。
