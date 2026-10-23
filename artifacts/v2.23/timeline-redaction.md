# v2.23 时间线落盘脱敏（`causeQuoted` / `trigger.quoted` 不再默认写原话）

> 接 v2.22 的遗留：`memories/emotion_timeline.jsonl` 也会写用户原话（`trigger.quoted`），
> 分支节点还会写 `branch.causeQuoted`。本机 `ENABLE_EMOTION_TIMELINE=true`，所以这是真实的隐私面。

## 为什么不能简单删掉

时间线的引文是**功能**，不是日志：`buildCauseChain()` 读回最近节点，让她能说
"因为你说「…」，我听着也跟着沉下去了"（v1.60 实测 4/5 能说出起因）。直接不存 → 跨轮原因链失效。

## 做法：默认只存摘要，原文只进同进程内存

`server/services/emotionTimeline.ts`：

- 新增 `timelineStoreQuote()`：**默认 false**；`TIMELINE_STORE_QUOTE=true` 才恢复旧行为（原文落盘）。
- 写盘前 `sanitizeForStorage()`：
  - `state_change.trigger.quoted` → 存 `null` + `quotedHash`（sha256 前 16 位）+ `quotedLength`；
  - `branch.causeQuoted` → 存 `null` + `causeQuotedHash` + `causeQuotedLength`；
  - 原文进 **bounded 内存缓存**（64 条），仅当前进程可读。
- 读回时 `hydrateFromCache()`：按 hash 把原文补回节点 ⇒ **同进程内原因链行为不变**。
- 跨进程/重启：缓存没了 ⇒ 节点 `quoted=null` ⇒ `buildCauseChain()` 的 `quoted` 为 null；
  协调器早就有 `if (chain.kind === 'his_word' && chain.quoted)` 判断 ⇒ **自动降级为"只说状态、不引原话"**，不会编。
- 测试辅助 `clearTimelineQuoteCache()` 用于模拟重启。

## 证据

| 项 | 结果 |
|---|---|
| 单测 `emotionTimeline.test.ts` | **21 通过**（新增 4 条：默认脱敏/同进程还原；清缓存后读回无原话且原因链 quoted=null；`TIMELINE_STORE_QUOTE=true` 才落原话；branch 节点同样脱敏） |
| 隔离实例真实一轮 | 新 `state_change` 节点：`quoted=null`、`quotedHash=f00396626735e42d`；文件里**不含**「领导当众骂」✅ |
| tsc | 0 |
| 全量测试 | 见提交记录 |

## 行为变化（诚实说明）

- 默认（本机不改 env）：**重启后**她的自状态表达可能只说"我这两天有点沉"，不再带
  "因为你说「…」"——这是隐私默认换来的降级，不是 bug。
- 同一次进程内（绝大多数连续对话）：原因链与 v1.60 一致（缓存还原）。
- 要恢复旧行为（原话落盘）：`TIMELINE_STORE_QUOTE=true`。

## 局限

- 内存缓存是**同进程**的；多进程/多实例各自独立，跨实例原因链会降级。
- `replyExcerpt`（她自己那句话前 80 字）仍落盘：outcome 判定需要它做文本重合；那是**她的话**，不是用户原话，这次没动。
- `branchReplay` 的 loader 已接 `hydrateTimelineNodes()`（同进程可还原 `causeQuoted`）；**跨重启**仍会降级（拿不到原文，回放里 `causeChainQuoted=null`）。
- 已存在的旧时间线文件里仍有历史原话（不自动重写）；要不要迁移/清理另说。
