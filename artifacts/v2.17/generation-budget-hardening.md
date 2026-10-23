# v2.17 生成预算硬化：真正的 abort + 最后两条兜底

## 1. 真正的 abort（不再只是"等待方返回"）

v2.16 的 `raceWithDeadline` 只是让等待方先返回，底层 HTTP 请求可能还在跑。v2.17 在 `retryAsync` 每次尝试里：

```ts
const controller = new AbortController();
abortTimer = setTimeout(() => controller.abort(), timeoutMs);
... fn(signal)
```

- **OpenAI / DeepSeek / 兼容分支**：`chat.completions.create(params, { signal })` —— 官方 SDK 支持；
- **Gemini 分支**：`generateContent(params, { abortSignal })` —— SDK 类型未声明第二参，运行时传（`as any`）；即使被忽略，仍有 `raceWithDeadline` 兜底；
- 到 deadline 触发 abort → catch 里统一转成 `GenerationBudgetExceededError`（调用方走确定性兜底），并记 `timeouts`。

## 2. 查重重写失败兜底（消灭最后一条"预算耗尽 → 500"）

`[Dedup] 定向重写一次` 之前没有 try/catch：重写抛错（含预算耗尽）会冒泡成 500。现在：

```ts
try { ...重写...; if (retry 有文本) result = retry; }
catch (e) { console.warn('[Dedup] 重写失败，保留原回复：...'); }
```

保留原回复、不阻塞主流程。

## 3. 后台异步生成检查（已有保护，无需改）

| 调用 | 现状 |
|---|---|
| 记忆叙事（`void generateAIResponse(...).then().catch()`） | 已有 `.catch` 静默 |
| 动机具体化（同上） | 已有 `.catch` 静默 |
| jev 影子（`void runJevShadow(...).catch()`） | 已有 `.catch` |
| 桌面回声 / 活动关心 / 主动消息 | 各自 try/catch |
| AI 连接测试 | 已 try/catch → 502 |

## 证据

| 项 | 结果 |
|---|---|
| 单测 `generationBudget.test.ts` | 7 条 |
| 单测 `aiProviderBudget.test.ts` | **5 条**（新增：超时时 `signal.aborted === true`） |
| 全量测试 | **1996 通过**（115 文件） |
| tsc | 0 |
| 强制超时探针（隔离实例，total=1000ms/call=500ms） | 两次调用都被限：`calls=2 timeouts=2 EXPIRED`，回复「嗯，我在。」，**无 500、无空回复** |
| 查重探针（同一隔离实例连发两轮） | `[Dedup] 与上一轮重复（相似度 1.00）→ 定向重写一次`；预算已耗尽 → 两轮回复均非空、无 500 |

## 诚实局限

- **Gemini 的 abort 是"运行时传参"**：类型未声明，若该 SDK 版本忽略第二参，则只有 race 生效（不会让整轮拖住，但 socket 可能继续跑）。没有做网络级抓包证明 socket 被取消。
- 查重探针里 `executeStrongConnection` **先**在内部把预算错误兜底成「嗯，我在。」，所以**新增的 dedup catch 没有被真正走到**——它是防御性代码；真正触发需要该函数改为重新抛错。
- 预算仍只覆盖生成调用；情绪/记忆/Prompt 组装不在内。
- 探针都是人工把预算调到 1s/0.5s 触发的，不是自然网络卡死复现。
