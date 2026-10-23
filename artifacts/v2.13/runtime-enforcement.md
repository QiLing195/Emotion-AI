# v2.13 ExpressionPlan 运行时强制（输出端）

> 目标：把“最多一问 / transient 不得声称持续”从 **Prompt 建议** 变成 **生成后的代码校验**。
> 只处理**可判定**的违规；语气/主意图/事实仍不猜。

## 实现

`src/lib/expressionEnforcement.ts`（纯函数，可单测）：

| 规则 | 触发条件 | 动作 |
|---|---|---|
| ① 时间尺度 | 计划 `duration !== 'sustained'`，且句子含“我/自己”、**不含**“你/他/她/朋友/同事/老板/家人/父母” | 移除 `这两天/这几天/最近几天/这些天/这段时间/最近一阵/一直` 等持续词（不替换成别的时间词，避免新增事实） |
| ② 提问上限 | 问号数量 > 允许上限 | 多出来的 `？` 改成 `。`（保留文字，只去掉追问语气） |

接入点：`server.ts` 在**生成之后、来源归属安全闸之前**执行；`aiCoordinator.getLastExpressionPlan()` 取本轮计划。

可观测：

- 日志：`[ExpressionGuard] duration_claims_removed:1` / `questions_capped:2->1`
- `GET /api/diagnostics → expressionEnforcement`（最近一轮 `{text, changed, changes}`）
- 开关：`DISABLE_EXPRESSION_ENFORCEMENT=true` 可整体关闭（默认开；仅当有 plan 时生效）

## 一个实测出来的坑：silent 的 `maxQuestions=0` 不能按 0 执行

计划器对 `silent` 轮次设 `maxQuestions: 0`，语义是“不要展开自述/不要追问”，**不是**“连一句关心都不能问”。

首版按 0 严格执行，10 场景里触发了 **8 次** `questions_capped:1->0`，把正常关心改成了陈述句：

```
原：你说的是哪一句？          → 强制后：你说的是哪一句。
原：你还好吗？                → 强制后：你还好吗。
```

于是改成：**silent 计划至少保留 1 个问题**（`max(1, planCap)`）；`express` 计划按 `plan.maxQuestions`。

## 证据

| 项 | 结果 |
|---|---|
| 单测 `expressionEnforcement.test.ts` | 9 条通过（transient 去持续词 / sustained 不动 / 转述不动 / 2 问→1 / silent 保留 1 问 / silent 2 问→1 / null / 关闭开关 / 不改事实） |
| 全量测试 | **1984 通过**（113 文件） |
| tsc | 0 |
| 情绪场景集（真实多轮，10 场景） | **10/10**（`artifacts/v2.13/emotion-scenarios.md`） |
| 真实管道触发 | `[ExpressionGuard] questions_capped:2->1`（把“两个追问”压成一个） |
| `/api/diagnostics` | 有 `expressionEnforcement` 字段，正常返回本轮结果 |

## 诚实局限

- 只强制两条可判定规则；**主意图/语气/“最多一句自述”**没有可靠判据，仍靠 Prompt（不硬改）。
- 时间词移除是**保守**的：只处理含“我/自己”且不含他人指代的句子；写坏读起来会略显生硬（少见），但不会新增事实断言。
- 触发是随机的：单轮可能没有违规，所以“本次没改”不能说明强制没生效；单测 + 一次真实 `2->1` 才是证据。
- 没有做 A/B 证明“强制后质量更好/更差”；目前只证明**违规能被代码拦住且场景集不回退**。
