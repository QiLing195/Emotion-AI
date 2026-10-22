# 数据清单、保留期与权限（v1.99，本机实测）

> 数据位置：`memories/`（明文 JSON/JSONL，已被 `.gitignore` 排除）。
> 本表由本机实际目录 + 代码常量整理；"谁能读"按**当前实现**（单机单用户）说明。

## 一、数据清单

| 数据 | 文件 | 内容 | 保留/上限（代码） | 读到它的人/功能 |
|---|---|---|---|---|
| 情感状态 | `emotion_state.json`（含 .bak） | 九情向量、太极、基线 | 覆盖写；.bak 保留旧版 | 情绪引擎、/state、记忆标注 |
| 情景记忆 | `episodic_memory.json` | 对话形成的情景（含叙事情绪） | 归档 + 遗忘曲线（不删文件，标记归档） | 记忆召回 RAG、图谱 |
| 记忆图谱 | `memory_graph.json` | 节点/边/对象库 | 归档同步；.bak | 图谱 BFS 召回 |
| 关系状态 | `relationship_state_v2.json` | 阶段/亲密度/统计 | 覆盖写 | 可见性门控、策略 |
| 情感时间线 | `emotion_timeline.jsonl` | 每轮状态变化（含触发引文） | 单文件 2MB 滚动，保留 14 份 | 低谷起因链（读最近 10 节点） |
| 活动日志 | `activity_log.jsonl` | 前台窗口标题 + 进程名（20s/条，敏感标题已替换） | 只读最多 400 行；文件本身无自动删除 | 活动理解、她看你的活动 |
| 关心记忆 | `activity_care.json` | 她主动关心的原话/类别/证据 | ≤20 条、14 天 | 下次"接着问结果"、她现在界面 |
| 便签 | `her_notes.jsonl` | 她记的 4~80 字便签 | 512KB 滚动 | 她自己翻看 |
| 提醒 | `her_followups.json` | 到点提醒 | 未发 ≤20、过期 7 天作废 | 主动消息 |
| 桌面事件 | `desktop_events.jsonl` | 打开/移动/重命名记录 | 未设上限（审计用） | 工具 `recall_desktop_events` |
| 截屏 | `memories/screens/*.jpg` + `screen_captures.jsonl` | 屏幕截图 + 审计 | 截图 7 天自动清理 | 她看屏幕（授权/策略约束） |
| 语音事件 | `voice_events.jsonl` | 唤醒词命中的转写结果 | 未设上限 | 桌宠气泡/对话 |
| MCP 审计 | `mcp_calls.jsonl` | 每次外部工具调用 | 未设上限 | 审计 |
| 学习账本 | `motive_learning.json`、`reward_stats.json`、`branch_learning.json` 等 | 权重/统计 | 有界写入 | 动机/策略排序 |
| 潜意识 | `shadow_state.json` | 特质置信度 | 覆盖写 | 状态漂移 |
| 世界/自我模型 | `world_model.json`、`self_model.json`、`identity_narrative.json` | 叙事与认知 | 覆盖写 | Prompt 装配 |
| 配置/密钥 | `.env`（不入库）、`mcp-servers.json`（不入库）、`scripts/voice-config.json` | API key、MCP 路径、唤醒词 | 本机文件 | server/子进程 |

## 二、权限矩阵（当前实现 = 单用户本机）

| 主体 | 读 | 写 | 依据 |
|---|---|---|---|
| 本机浏览器页面（localhost） | 通过 HTTP API 读大部分状态 | 通过 HTTP API 写 | 同源；CORS 白名单 |
| 同一台机器上的其它本地进程 | **能读**（文件系统权限 + 回环 API） | **能写**（同上） | 无进程级隔离、无 token |
| 局域网内其它机器 | **不能**（默认仅回环） | 不能 | `BIND_HOST=127.0.0.1` |
| 模型供应方 | 只收到 prompt 里的文本（system prompt + 他的话 + 召回片段 + 工具结果摘要） | — | 网络出站仅此 |
| Firestore（可选） | 有凭证才启用 | 同步用户数据 | 本机无凭证 ⇒ 当前不用 |
| MCP 子进程 | 只读 `docs/`（配置指定） | 无（写工具未放行） | allowTools 白名单 |
| PowerShell 子进程（采样/语音/OCR） | 前台窗口标题、麦克风、截图 | 写 `memories/*.jsonl` | 继承本机用户权限 |

## 三、删除与导出：现状 = 缺口

实测检查（代码搜索 + 端点列表）：

```
✓ 有：POST /api/memories/governance（治理状态回滚，不是删除）
✗ 无：删除单条/全部记忆的 API
✗ 无：导出全部记忆的 API（只有 Obsidian 导出脚本，离线生成看板）
✗ 无：删除向图谱/索引/备份/日志传播的实现（图谱只有"归档同步"）
✗ 无：供应商侧数据删除/不训练的核查记录
```

**若要补 P0**，最小方案：
1. `DELETE /api/memories/:id`：治理状态改 `rolled_back` + 从情景/图谱/索引移除 + 写删除审计；
2. `GET /api/export`：打包 `memories/`（脱敏 `.env`）为 zip（本地下载）；
3. 删除后断言脚本：召回不再命中、图谱无节点、`.bak` 不复活、导出文件不含该条；
4. 明确"备份/滚动文件里的旧副本"策略（当前 `.bak` 会保留旧数据）。

## 四、本机 .env / 外部存储核查

- `.env` 在 `.gitignore` 中；`readAISettings()` 只从 `.env` 读 key（`server.ts:2969+`）。
- Firestore：`firebase.ts` 需要 `GOOGLE_APPLICATION_CREDENTIALS` 或配置里 `private_key/client_email`；本机三者都没有 ⇒ 打印 `Firestore persistence disabled`，**不写云**。
- 出网接口：模型 API、MCP npx 下载、Open-Meteo（天气/地名）。无其它统计/上报端点。
