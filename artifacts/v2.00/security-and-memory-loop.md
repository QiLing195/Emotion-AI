# v2.00：暴露风险（P0-2）+ 用户可控的记忆闭环（P0-1 之外）

> 依据专家建议的顺序：① 先处理暴露风险 ② 建用户可控的记忆闭环。
> 本文件只写**测到的**，不写"设计上应该"。

## 一、暴露风险：实测了什么

### 1）非回环绑定必须带 token，否则拒绝启动

代码：`server/server.ts` start() 里判断 `BIND_HOST` 是否回环；非回环且无 `API_TOKEN` → 打印原因并抛错（进程退出）。
中间件：`setupMiddleware()` 里，设置了 `API_TOKEN` 时**非本机来源**的 `/api/*` 必须带 `x-api-token`（或 `Authorization: Bearer`）；
本机（127.0.0.1/::1）默认放行（本机 UI/桌宠不用配）；`REQUIRE_API_TOKEN_ALWAYS=true` 时连本机也要求。

实测：

```
A) BIND_HOST=0.0.0.0 且无 API_TOKEN
   → [Security] 拒绝启动：… 未设置 API_TOKEN
   → 进程退出，3011 未监听 ✅

B) BIND_HOST=0.0.0.0 + API_TOKEN=testtoken123（本机 LAN IP 192.168.3.103）
   本机 /health                     → ok
   LAN 无 token /api/her-state       → HTTP 401 ✅
   LAN 带 x-api-token /api/her-state → ok ✅
   本机 127.0.0.1 无 token           → ok（本机 UI 不需要）✅
```

### 2）CORS 收紧（CORS 不是鉴权，但"任意 localhost 端口"必须收）

原实现 `/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/` 意味着**任何本机端口上的网页**都能调 API。
现改为白名单：`http://localhost:3000 / 127.0.0.1:3000 / localhost:5173 / 127.0.0.1:5173`，可用 `CORS_ALLOWED_ORIGINS` 追加。

预检（OPTIONS）实测：

| Origin | 结果 |
|---|---|
| `http://127.0.0.1:3000` | 204 + `Access-Control-Allow-Origin` ✅ |
| `http://127.0.0.1:5173`（Vite 开发） | 204 + ACAO ✅ |
| `http://127.0.0.1:3997`（另一个本机端口） | 415，无 ACAO ✅（收紧前是放行的） |
| `http://evil.example` | 415，无 ACAO ✅ |

外部站点的非 JSON 表单提交实测：`415 {"error":"Content-Type must be application/json"}`（跨站表单被 JSON-only 拦住）。

### 3）"本机其它进程"的现状（诚实说明）

同一用户下的本机进程**可以直接读 `memories/*.json`，也能直连回环 API**（实测 `GET /api/her-state` 200）。
这是单机信任模型：能跑代码的本地进程本来就有文件权限。**我们没假装它被防住了**；
真正降低风险的是：默认不回环外暴露、工具白名单、桌面/截屏需授权、删除/导出可控。

### 4）仍未解决

- `REQUIRE_API_TOKEN_ALWAYS=true` 时，本机前端/桌宠不会自动带 token（会 401）——需要给前端注入 token 才能用，属于"偏执模式"的已知限制。
- 浏览器页面的实际攻击面：外站被 CORS + JSON-only 挡住；**白名单内的本机页面**仍可调 API。若用户在本机跑其它开发服务，需要自己把它从白名单里拿掉。

## 二、记忆闭环：查看 / 纠错 / 删除 / 导出

### 端点（新增）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/memories?limit=` | 列记忆（已有） |
| GET | `/api/memories/:id` | 单条详情（**去掉 embedding** 大字段） |
| PATCH | `/api/memories/:id` | 纠错：只允许 `eventSummary` / `narrativeFragment` / `tags`（长度受限），同步改图谱节点内容 |
| DELETE | `/api/memories/:id?purgeBackups=1` | 删除：episodic 主文件 + 图谱节点/边 + 可选 `.bak` 副本；写审计 |
| GET | `/api/memories/export` | 导出 `memories/` 下文本文件（json/jsonl/txt/md，单文件 ≤4MB，跳过截图二进制），作为 JSON 附件下载 |

核心实现：`server/services/memoryAdmin.ts`；图谱删除：`MemoryGraph.removeNode()/removeBySource()`（含边与邻接清理）。
DELETE 无 body 也放行（JSON-only 中间件只拦"带 body 的非 JSON"），否则 REST 删除会被 415 挡住——这是实测踩到的。

### 隔离验证（真实文件哈希前后一致）

```
临时实例：cwd=临时目录 + MEMORIES_DIR=临时目录/memories
  episodes=122（副本）
  PATCH 一条 → 摘要变化
  DELETE ?purgeBackups=1 → {"ok":true,"removedEpisode":true,"removedGraphNodes":1,"scrubbedBackups":1}
  临时 episodic 文件里还有该 id：False
  临时 memory_graph.json 里还有该 id：False
  临时 .bak-proof 里还有该 id：False（被清掉）
  真实 memories/episodic_memory.json SHA256 前后一致：True
  真实 memories/memory_graph.json SHA256 前后一致：True
```

### 踩到并修掉的事故（必须记录）

第一次隔离验证时，`server/persistence.ts` 用的是**绝对路径** `path.join(__dirname,'../memories')`，
所以"临时 cwd"的实例其实读写的是**真实 memories**：纠错改了真实条目、删除删掉了真实条目；
随后一个直接测试脚本又把 episodic 写成空。

处理：
1. 从 `%TEMP%` 里 23:12:35 的副本恢复 `episodic_memory.json`（122 条，含被删那条，原摘要）+ `memory_graph.json`；
2. 主 server 重启后核对：`/api/memories` 122 条、被误删条目可读回、原始摘要一致；
3. `memories/memory_admin_audit.jsonl` 追加 `op:"restore"` 记录事故与恢复来源；
4. **根因修复**：`persistence.ts` 所有数据路径改为 `MEMORIES_DIR`（env 可覆盖，默认仓库 memories/），
   `memoryAdmin` 用同一规则；之后再验证，真实文件哈希不再变化。

## 三、回归测试

```
新增 server/services/__tests__/memoryAdmin.test.ts（7 条）：
  删除传播（episode+graph）/ 不存在→not_found / .bak 清理 / 坏 JSON 不冒险改 /
  纠错字段白名单+图谱同步 / 导出跳过二进制 / 单条详情去 embedding
全量测试：1909 + 7 = 1916（见提交时的实际数字）
```

## 四、仍然缺的（不掩盖）

```
1. 界面上还没有"记忆管理"面板（现在是 API 可用；用户要会用 curl / 后续加 UI）
2. 删除不涉及 semantic_memory / 关系/情绪状态里可能存在的"关于他的描述"（那些不是 episodic 记忆）
3. 导出不含截图二进制、不含 `.env`（有意如此）；需要完整备份要单独做
4. 供应商侧数据删除/不训练核查仍未做（合规项）
```
