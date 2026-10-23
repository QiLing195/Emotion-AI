# v2.20 脱敏 turn trace（plan / intrinsic / 强制 / 预算落盘）

> 回应审查意见：「plan 与 intrinsic 写进脱敏 trace 文件（现在只在内存 + /state）」。

## 做了什么

新增 `server/services/turnTrace.ts`，每轮对话写一行 JSONL 到 `memories/turn_trace.jsonl`：

| 字段 | 内容 | 说明 |
|---|---|---|
| `v` / `ts` / `round` | schema 版本 / 时间 / 轮次 | |
| `user` | userId 的 sha256 前 8 位 | **不存原始 id** |
| `prompt` | blocks / chars / permits / suppressed ids | 只看结构 |
| `strategy` / `conflict` | 枚举 | |
| `plan` | decision / reason / emotion / tone / duration / evidence / maxSentences / maxQuestions / confidence | **白名单复制**，`causeQuote` 等字段即便传入也不会写 |
| `intrinsic` | accepted 的类型列表 / rejected 的原因列表 | 不存 evidenceRef 内容 |
| `enforcement` | changed / changes 短码 | |
| `budget` | elapsed / remaining / calls / timeouts / expired | |
| `memory` | 注入条数 / 来源计数 / 是否主动回忆 | **不存记忆正文** |
| `motive` | kind / salience | **不存动机内容** |
| `agent` | 轮数 / usedTools / 工具名列表 | 不存工具入参与结果 |
| `reply` | 字数 / 问号数 | **不存回复正文** |

写入失败静默（`[TurnTrace] 写入失败` 警告，不影响主流程）；单文件 **2MB** 轮转，保留 **5** 份。
开关：`ENABLE_TURN_TRACE=false` 可关（默认开）；路径可用 `TURN_TRACE_FILE` 覆盖，默认跟随 `MEMORIES_DIR`。
`/api/diagnostics` 新增 `turnTrace`（最近一轮的结构记录）。

## 证据

| 项 | 结果 |
|---|---|
| 单测 `turnTrace.test.ts` | 5 条（脱敏白名单 / JSONL 追加 / 轮转保留 / 路径与开关 / 写失败不抛） |
| 隔离实例真实两轮 | 文件 2 行；最后一行含 plan/intrinsic/enforcement/budget/agent；`user=79451f70`（哈希） |
| 脱敏检查 | 用户原话「提不起劲/说不上来为什么」**未出现在文件里** ✅ |
| `/api/diagnostics.turnTrace` | 存在 |
| 全量测试 | 见提交记录（本地跑） |
| tsc | 0 |

真实两轮的 plan 示例（结构，不含正文）：

```
{"decision":"express","reason":"express:sad(sustained)","emotion":"sad","tone":"quiet",
 "duration":"sustained","evidence":"低谷已持续成段；心情层偏置 -0.38；…","confidence":0.82}
intrinsic: {"accepted":["thought_wish","thought_fear"],"rejected":[]}
budget: {"elapsedMs":1699,"remainingMs":23301,"calls":2,"timeouts":0,"expired":false}
reply: {"chars":77,"questionMarks":1}
```

## 诚实局限

- `plan.evidence` 是内部短标签（低谷/心情/反刍/内在活动类型），**不含用户原话**；但它是自由字符串，未来若有人往里面塞内容，脱敏会失效——白名单只能防"多传字段"，不能防"字段本身被写脏"。
- 只覆盖主聊天路径；主动消息 / jev / 摘要等旁路生成没有 trace。
- 轮转是单进程非原子操作（rename 失败时静默跳过，不丢主流程但可能少轮转一次）。
- 文件未加密；本机单用户场景，`memories/` 本来就有记忆正文，trace 的敏感度低于记忆文件。
- 没有做人工审计工具（目前只能 `jq`/脚本读 JSONL）。
