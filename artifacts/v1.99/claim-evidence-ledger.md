# 主张—证据台账（v1.99）

> 规则：每条主张要么指向**代码位置/测试/运行记录**，要么明确标为**未验证/缺口**。
> 状态定义：`已验证`=有代码且有测试或运行证据；`已实现`=有代码、缺专项测试；`部分`=只覆盖一部分；`缺口`=没有；`按设计不适用`=单机单用户形态下不成立。

## A. 边界与网络

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| A1 | 服务默认只监听本机回环 | `server/server.ts:3053` `BIND_HOST \|\| '127.0.0.1'` | 代码 + 启动日志 `Server started on http://127.0.0.1:3000` | 已验证 |
| A2 | 跨源请求被限制在本机源 | `setupMiddleware()` CORS 白名单 `/^https?:\/\/(localhost\|127\.0\.0\.1)/` | 代码 | 已实现 |
| A3 | 变更类接口要求 JSON（缓解跨站表单） | `server/server.ts:356-368` 415 分支 | 代码 | 已实现 |
| A4 | 高频接口有速率限制 | `server/server.ts:370-385`（chat 30/min、vision 12/min、其余 60/min） | 代码 | 已实现 |
| A5 | 无账号/无 token | — | 代码中无 auth 中间件 | 按设计不适用（单用户） |

## B. 工具与副作用

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| B1 | 外部 MCP 工具默认只读、按白名单放行 | `server/services/mcpClient.ts` | `mcpClient.test.ts`；真机返回 `tool_not_allowed`；v1.93 报告 | 已验证 |
| B2 | 文件系统 MCP 只能访问授权目录 | `mcp-servers.json`（args 指定 docs 目录）+ 官方 server 语义 | 真机 `list_allowed_directories` 输出 | 已验证（本机配置） |
| B3 | 截屏需授权/策略约束、敏感窗口拒绝、限频 | `server/services/screenWatch.ts`（四种策略、最小间隔 60s、敏感词） | `screenWatch.test.ts` | 已验证 |
| B4 | 桌面打开/移动/重命名需用户点允许，且 Electron 二次校验 | `desktopItems.ts` + `desktop/main.cjs` | 三处校验代码；v1.91 报告 | 已实现 |
| B5 | 桌面动作可撤销（5 分钟） | `desktopItems.ts` undo 路径 | 代码 + v1.91 真机 | 已实现 |

## C. 记忆与 RAG

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| C1 | 记忆有治理状态与证据判定 | `src/lib/memoryGovernance.ts` | `memoryGovernance.test.ts` | 已验证 |
| C2 | 遗忘（艾宾浩斯）与相似合并 | `src/lib/memoryEnhancer.ts` | `memoryEnhancer.test.ts` | 已验证 |
| C3 | 敏感记忆按关系阶段可见性门控 | `src/lib/memoryVisibility.ts` | `memoryVisibility.test.ts` | 已验证 |
| C4 | 形成即入图谱且幂等补全 | `server.ts` `tryFormEpisode` + `backfillEpisodicNodes` | `episodicGraphBackfill.test.ts` | 已验证 |
| C5 | 生成后接地校验（防编造） | `src/lib/memoryGrounding.ts` | `memoryGrounding.test.ts`；`scripts/check-grounding.ts`（编造被重写/删除） | 已验证 |
| C6 | RAG 检索质量有固定评测集 | — | 只有 `test_data/` 的对话质量评测（LLM Judge），**没有** recall@k/groundedness 分层固定集 | 部分 |
| C7 | 用户可查看记忆 | 部分：`/api/her-state`、Obsidian 导出脚本 | `scripts` 里 obsidian-export | 部分 |
| C8 | 用户可删除/纠正/导出全部记忆 | — | 只有 `POST /api/memories/governance`（状态回滚），无删除/导出 API | 缺口 |

## D. AI 质量与安全

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| D1 | 危机（自伤）有专门策略 | `src/lib/dialogueStrategy.ts` `crisis` | 代码 + 策略测试 | 已实现 |
| D2 | 有固定种子输入的对话评测 | `test_data/200_seed_inputs.json`、`llm_judge.mjs`、`eval_*.json` | 评测资产存在（**需人工复核评分有效性**） | 部分 |
| D3 | 有 A/B 对照装置 | `scripts/ab-runner.ts` + 20+ `ab-*.ts` | 代码 + 历史 artifacts | 已验证（工具层） |
| D4 | 提示注入有专项防护与攻击测试 | 仅有"工具只读白名单 + 接地校验" | 无攻击用例/无注入过滤 | 缺口 |

## E. 可靠性与运维

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| E1 | 模型调用失败会重试一次 | `server.ts:1501,1523`（首次 + retry） | 代码 | 已实现 |
| E2 | 外网不可达时抓取回退 curl | 联网层（fetch 1.5s 探测 → curl） | `CLAUDE.md` 记录 + 实测耗时 | 已实现 |
| E3 | 有功能开关可回退 | `CLAUDE.md` 开关表（30+） | 代码 `process.env.XXX === 'true'` | 已验证 |
| E4 | 有关键流程日志 | `[Mood]`/`[Grounding]`/`[ActivityCare]`/`[AgentTool]` 等 | 本次运行日志 | 已实现 |
| E5 | 有 SLO/SLI 与故障演练记录 | — | 无 | 缺口 |
| E6 | 有发布/回滚流程与事故模板 | — | 只有 git 提交与 CLAUDE 版本行 | 部分 |

## F. 数据生命周期

| # | 主张 | 实现位置 | 证据 | 状态 |
|---|---|---|---|---|
| F1 | 截图 7 天自动清理 | `screenWatch.ts:29,164-173` | 代码 | 已实现 |
| F2 | 关心记忆 ≤20 条 / 14 天 | `herCareMemory.ts:17-18` | 代码 + 单测 | 已验证 |
| F3 | 便签 512KB 滚动、时间线 2MB 滚动 | `herNotes.ts`、`emotionTimeline.ts` | 代码 | 已实现 |
| F4 | 运行数据默认不入库 | `.gitignore`（`memories/*.json|jsonl`、`.env*`、`data/`） | `.gitignore` | 已验证 |
| F5 | 数据默认不出本机 | 模型只发 prompt 片段；Firestore 无凭证不启用 | `firebase.ts:26-34`；本机无凭证 | 已验证（本机） |
| F6 | 供应商数据处理条款已核查 | — | 无记录 | 缺口 |

## 使用方式

- 任何人改代码后，**受影响的主张必须更新状态并给出新证据**；不允许把"设计意图"写成"已验证"。
- `已实现` 与 `部分` 想要升到 `已验证`，必须补测试或运行记录（脚本或真机）。
- `缺口` 项进入 `BACKLOG.md` 的候选，不要用文档措辞掩盖。
