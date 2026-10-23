# v2.16 单轮生成总预算（P1）

## 问题（改之前）

- 每次模型调用**没有总时限**：SDK 默认超时很长（OpenAI 兼容客户端默认 10 分钟级）；
- `retryAsync` 在上层再叠 **最多 4 次尝试**（`AI_MAX_RETRIES=3`）+ 指数退避；
- agent 工具层最多 2 轮模型调用 + 1 次收尾生成 + 接地重写/查重重写；
- 结果：**一次卡死可能把整轮拖到几分钟**，桌宠/聊天看起来"没反应"，又没法解释。

## 设计

新增 `src/lib/generationBudget.ts`：

| 概念 | 默认 | 环境变量 |
|---|---|---|
| 整轮生成总预算 | 25s | `TURN_GEN_BUDGET_MS`（夹取 1s–180s） |
| 单次模型调用上限 | 15s | `GEN_CALL_TIMEOUT_MS`（夹取 0.5s–总预算） |
| 剩余预算低于此值不再重试 | 700ms | 常量 `retryReserveMs` |

规则：

1. **一轮对话创建一个 budget**；agent 多轮工具调用、收尾生成、查重重写、接地重写、非 agent 路径**共享同一 deadline**；
2. 每次调用取 `min(单次上限, 剩余预算)`；超时抛 `GenerationBudgetExceededError`，该错误**不重试**；
3. 预算耗尽后**不再发起任何新生成**；退避等待也不得超过剩余预算；
4. 没有传入 budget 的旁路调用（主动消息、jev、提醒重写）自动用 `singleCallBudget()`，把"单次上限"同时当总预算——**不会重试叠成无限等**。

## 兜底（不让用户看到 500 / 空回复）

| 路径 | 预算耗尽时 |
|---|---|
| agent 路径 | `callModel` 捕获后返回空文本让 agent 用已有文本收尾；若最终仍为空 → 确定性兜底「嗯，我在。」 |
| 非 agent 路径 | 捕获后 → 「嗯，我在。」 |
| 接地重写 | 原有的 `catch` 已是"整句删除兜底"，预算耗尽同样走它 |
| 查重重写 | 原逻辑：重写失败保留原回复（`retry` 抛错会冒泡——⚠️ 见局限） |

## 可观测

- 日志：`[GenBudget] elapsed=6480ms remaining=18520ms calls=1 timeouts=0`
- `GET /api/diagnostics → generationBudget`（`{totalMs, callMs, elapsedMs, remainingMs, expired, calls, timeouts}`）
- 预算超时：`[GenBudget] 生成预算耗尽，agent 提前收尾` / `[GenBudget] agent 无文本，使用确定性兜底`

## 证据

| 项 | 结果 |
|---|---|
| 单测 `generationBudget.test.ts` | 7 条（默认值/夹取/remaining/timeoutForCall/耗尽后 beginCall 抛错/raceWithDeadline/snapshot/旁路预算） |
| 单测 `aiProviderBudget.test.ts` | 4 条（预算内重试成功、耗尽后不重试、单次超时记 timeouts、4xx 不重试） |
| 全量测试 | **1995 通过**（115 文件） |
| tsc | 0 |
| 正常路径探针（主 server） | `elapsed=6480ms remaining=18520ms calls=1 timeouts=0`，回复正常 |
| **强制超时探针**（隔离实例，`TURN_GEN_BUDGET_MS=1000`、`GEN_CALL_TIMEOUT_MS=500`） | `timeouts=1`、回复「嗯，我在。」、整轮 4.3s（含情绪管道）；日志 `[GenBudget] 生成预算耗尽…` |

## 诚实局限

- `raceWithDeadline` **只让等待方返回**，不保证取消底层 HTTP/socket；SDK 内部超时仍会自己结束（对本目标足够）。
- 预算只覆盖**生成调用**；情绪/记忆/Prompt 组装（约 3–4s）不在内——"整轮"仍可能比 25s 长，只是**生成**有上限。
- 查重重写失败目前会冒泡（旧行为），极端情况下可能把预算耗尽变成 500；下一步可把它也纳入兜底。
- aiEngine 的 **Firebase 配置路径**（非 `clientContext`）没有传整轮 budget，只享受单次调用预算。
- 探针是单次采样；没有做"低预算下体验是否可接受"的人工评估。
