# v2.18 预算错误路由：让兜底真正接上

## 问题（v2.17 遗留）

`executeStrongConnection` 原来**无条件**把生成错误变成 fallback（「嗯，我在。」）。
于是：

- 非 agent 路径：预算耗尽 → strong connection 抢先 fallback → server 的 `[GenBudget] 生成预算耗尽，使用确定性兜底` 永远走不到；错误被"吞掉"，诊断也看不到；
- 查重路径：`aiEngine.generateResponse` 同样被 fallback 吞掉 → 重写返回同一句兜底文本 → **v2.17 新增的 dedup catch 是死代码**（探针已证明）。

## 改动

1. `src/lib/moduleConnections.ts`：`executeStrongConnection` 的 catch **最前面**判断
   `GenerationBudgetExceededError`（同时按 `name` 兜底跨模块副本）→ **原样上抛**；
   **不增加**连接失败计数、不触发熔断（预算耗尽是"时间用完了"，不是"连接坏了"）。
2. `server/services/aiEngine.ts`：两处 catch 都先判断预算错误 → **原样上抛**，不再包成 `AIRequestError`；
   其他错误行为不变（仍 fallback / 包装）。

这样：

| 路径 | 预算耗尽时 |
|---|---|
| 非 agent | `executeStrongConnection` 上抛 → `aiEngine` 上抛 → server catch → 记录日志 + 兜底「嗯，我在。」 |
| 查重 | `executeStrongConnection` 上抛 → `aiEngine` 上抛 → `[Dedup]` catch → **保留原回复** |
| agent | 不变：`callModel` 捕获 → 用已有文本收尾 → 空则兜底 |

## 证据

| 项 | 结果 |
|---|---|
| 单测 `moduleConnections.test.ts` | 3 条（预算错误不 fallback / 普通错误仍 fallback / 按 name 识别不 fallback） |
| 全量测试 | **1999 通过**（116 文件） |
| tsc | 0 |
| 探针 A：非 agent（`ENABLE_AGENT_TOOLS=false`，total=1000/call=500） | stderr：`[AIEngine] Error: GenerationBudgetExceededError: ai_call aborted after 500ms` + **`[GenBudget] 生成预算耗尽，使用确定性兜底`**；回复「嗯，我在。」 |
| 探针 B：查重（agent 路径，两轮同输入） | stderr：**`[Dedup] 重写失败，保留原回复：ai_call aborted after 480ms`**（v2.17 里从未出现）；两轮回复均非空、无 500 |

## 诚实局限

- 只给**预算错误**开了"上抛"通道；其他生成错误仍走 fallback（设计如此，没改）。
- 熔断状态没有被预算错误污染（rethrow 在计数器之前），但也没有专门测"broken 状态下发生过预算错误"的组合。
- 探针仍是用 1s/0.5s 的人造低预算触发，不是自然网络卡死。
- 没有做 A/B 证明"兜底回复的体验更好"；这一步只证明**错误路由正确、诊断可见**。
