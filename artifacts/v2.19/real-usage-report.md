# v2.19 真实使用观察（约 9 分钟，11 轮，真实 server + 真实记忆）

> ⚠️ **诚实前提**：这是**脚本驱动**的真实管道会话（`scripts/real-usage-session.mjs`），不是真人手动操作。
> 目的与 v1.97 相同：用真实 server / 真实记忆 / 真实模型跑一段连续对话，**逐条读回复 + 看日志**，找真实问题。

## 会话设置

- server：本机 `127.0.0.1:3000`，真实 `memories/`、真实状态；11 轮 × 50s（约 9 分钟）。
- 用户 ID：`real-usage-v2.19`（不污染既有用户画像）。
- 话题覆盖：上班没劲 / 开会到六点半 / 想换方向 / 特别难过 / 拿到 offer / 问她今天 / 找不到文档 / 问她是不是 AI / 深夜孤独 / 道谢 / 去睡。
- 原始数据：`artifacts/v2.19/session.jsonl`（每轮消息、回复、延迟、budget、ExpressionGuard、activation、关系阶段）。

## 运行事实（无美化）

| 项 | 结果 |
|---|---|
| 11 轮 HTTP 状态 | **全部 200** |
| 延迟 | 1.9s–11.3s（首轮 11.3s 含冷启动；其余 1.9–7.0s） |
| `[GenBudget]` | 每轮 calls=1–2、timeouts=0、未耗尽 |
| 服务端 ERROR/WARN | stdout 无 ERROR/WARN；stderr 仅一条启动提示 `Firebase credentials not found` |
| ExpressionGuard | 2 轮触发 `questions_capped:3->1` / `2->1` |
| Agent 工具 | 2 轮用到：`check_my_state`、`read_my_desktop` |

## 发现并修掉的问题

### 1) 🔴 冲突状态机 agency 符号反了（真实使用里误报 warning → repair）

**现象**：第 10/11 轮只是"谢谢你今天陪我聊这些 / 我先去睡了"，日志却出现：

```
[Event]🧠 StrategySelected {"strategy":"repair","reason":"冲突状态: warning, 信号数: 3"}
[DEBUG] strategy: repair conflictPhase: warning
```

**根因**：`conflictManager.detectSignals` 用 `emotionEvent.agency < -0.3` 当"用户把负面归因于 AI"。
但全仓约定是 **正 = AI 自己 / 负 = 用户（他）**（`emotionAttribution.ts`: `agency>0.5→self`、`<-0.5→user`；
`emotionAnalyzer` 预设 joy/love/gratitude 的 agency 都是负数）。于是"他难过是因为外部事件"反而被算成"她挨怪"，
几轮后累积到 warning，把正常道谢/道晚安变成 repair。另外 `user_negative_directed` 只检查 `intensity>0.5`
**没检查情绪正负**，"你让我很开心"也会被当冲突信号。

**修法**（`src/lib/conflictManager.ts`）：

- `agency > 0.3` 才算 blame-AI（符号修正 + 注释写明约定）；
- 新增 `NEGATIVE_FOR_CONFLICT` 白名单（anger/sad/fear/disgust/contempt/annoyance/frustration/hurt），
  正向情绪指向 AI 不再算冲突；
- 旧单测里被写反的断言同步修正，并新增两条回归（负 agency 不算怪她 / 正向指向 AI 不算冲突）。

**验证**：28 条冲突单测全过；隔离实例 mini-session（难过 → 谢谢 → 去睡）三轮 `conflictPhase` **全是 normal**，
策略 `accompany`，不再 repair。

### 2) 🟠 报喜没接住，还凭空断言旧事

**现象**（第 5 轮）：用户"我拿到 offer 了，不过又有点怕做不好"，她回：

> 等一下——offer？**之前那个方向的事，是已经走完流程了。** …先让我确认一句，是哪边的 offer。

没接住高兴，还把不确定的"之前那个方向"当已知事实。第 6 轮又追着问"offer 那件事…你先说哪个方向"。

**修法**（`server/server.ts` prompt tone 块）：检测到"他刚报好消息"（joy/love/gratitude 且强度≥0.5，
或文本含 拿到/offer/升职/通过/录取…）时注入一条 tone 规则：**先接住高兴（一句），再谈怕做不好；
不确定的旧事不要当已知事实，要问就问"是哪一个/什么方向"**。

**验证**：新增场景 `good_news_offer`（14 个场景）。实测回复：

> 先接住这个——offer 拿到手了，恭喜你。…你拿到的这个 offer，是哪一个方向？

场景集 **14/14**（含新增场景）。

### 3) 🟠 桌面隐私文件名被无关念出

**现象**（第 7 轮）：用户"文档怎么都找不到，帮我想想"，她读了桌面后念出：

> 其中有个叫「陈曦开题报告」的，还有个「育种理论与技术考试重点」。

**修法**（`server/services/agentLoop.ts`）：`read_my_desktop` 的工具结果后追加隐私提示：
"只提与他的请求直接相关的文件名；不要罗列无关文件名，也不要假装看过文件内容。"
（数据仍走 v2.11 不可信数据块）。**注意：这只是提示，未验证模型是否每次遵守**。

## 观察但不改的（避免过度收口）

- **她的自我状态频率**：11 轮里约 5 轮带"我这边/我这两天"。用户红线是"可以说也可以不说，不能定死"——
  没有每句都加，暂不收紧；如果真人体验觉得多，可再调。
- **AI 身份**：被直接问时如实说"我是 AI，没有真实身体"（符合 v2.02 规则）。
- **连续性**：第 9 轮记得第 7 轮的文档；第 10 轮道歉/道谢自然。
- **排版**：第 7 轮把 `~$`、`.docx` 用反引号包了，聊天 UI 可能直接显示反引号（低优先级）。
- **延迟**：首轮 11.3s 偏高（冷启动），其余可接受；未做 N 次统计。

## 证据

| 项 | 结果 |
|---|---|
| 全量测试 | 待本文件提交前最终跑（见提交记录） |
| 冲突单测 | 28/28（含 3 条新增回归） |
| 场景集 | **14/14**（新增 `good_news_offer`） |
| 工具结果隐私提示单测 | `toolResultInjection` 6/6（新增 1 条） |
| 真实会话原始数据 | `artifacts/v2.19/session.jsonl` |
| 场景报告 | `artifacts/v2.19/emotion-scenarios.md` |

## 诚实局限

- 会话是**脚本驱动**，不是真人手动；话题顺序也是预设的。
- 单次 11 轮，不足以证明"冲突误报已绝迹"；只证明这次链路 + 单测 + mini-session 行为正确。
- 报喜修复只验证了一个场景的一次输出；没做 A/B。
- 桌面隐私提示**没有行为级验证**（模型可能仍罗列无关文件名）。
- 自我状态频率、反引号排版是观察，不是结论。
