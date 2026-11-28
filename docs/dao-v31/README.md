# 道·AI V3.1 API 契约

契约版本 **3.1.0**，初始投影版本 **1.0.0**。M0 发布 [共享 TypeScript 入口](../../src/contracts/dao-v31/index.ts)、[OpenAPI 3.1](openapi.json) 和 [JSON Schema 2020-12](schemas.json)。前端可用 `DaoRequestBody<OperationId>`、`DaoResponseData<OperationId>`、`DaoPathParams<OperationId>`、`DaoQuery<OperationId>`、`ApiEnvelope<T>`、`DaoStreamFrames` 和 `DaoChatFrames` 建立类型化客户端或 Mock。OpenAPI 的 `x-dao-milestone` 标注各操作首次实现阶段。

使用 Node 22.20 在项目根执行 `node src/dao-v31/publishContracts.ts` 重新生成两份契约文档。新增可选字段走次版本，删除必填字段、改变既有字段语义或取消已承诺的事件走主版本。客户端应容忍响应中新增的字段和未识别的 SSE 事件名。投影版本独立于 HTTP 契约演进，回放必须选用明确的投影版本和参数快照。

## M1 本地联调

M1 已启用健康、授权列表与更新、手动记录、观察列表、溯源、状态快照、事件日志、运行时 SSE 和备份导出与恢复，共 11 个 REST/SSE 操作。其它操作按 OpenAPI 的 `x-dao-milestone` 交付。服务端已具备内部删除栅栏，公用四类 `ForgetRequest` 接口安排在 M3。

M2a 的情绪投影、调节状态、情绪溯源以及 A/B1/B2/C/D 指标由现有 `GET /api/dao/state/snapshot` 返回。实时进度仍走 `track_update`。SQLite 健康检查的 `schemaVersion` 已升至 `2`，HTTP 契约继续使用 `3.1.0`。B1 冷启动或查询超时可返回空召回并标记降级，前端按现有轨道字段显示。四轨运行时为服务端内部入口，公开对话按计划在 M3 接入。 [M2a 验收](V3.1-M2a.md)

在项目根目录打开 PowerShell，使用 Node 22.20 或该大版本的更新补丁。设置会话签名密钥与本地所有者，再签发 15 分钟的限定作用域令牌并启动开发服务。

```powershell
$env:DAO_OWNER_ID = 'local-owner'
$env:DAO_SESSION_SECRET = node -p "require('node:crypto').randomBytes(32).toString('hex')"
node src/dao-v31/sessionAuth.ts prod local-character local-session 900
npm.cmd run dev
```

同一终端里的签发命令和服务器须使用相同的 `DAO_SESSION_SECRET` 与 `DAO_OWNER_ID`。需要从另一个终端续签时，通过本机环境或私有的环境变量文件加载同一配置。令牌最长期限为 3600 秒。签发脚本依次接收环境、角色 ID、会话 ID 和可选时长。SQLite 默认保存在用户目录下的 `.emotion-ai/dao/`。可用 `DAO_DB_DIR` 指定代码目录之外的私有目录。签名密钥或身份未配置时，DAO 路由返回 503。

前端联调在同源开发服务上使用签发命令打印的短期令牌，以内存变量传给请求。示例采用上面的角色和会话 ID。签名密钥仅供服务端和本地签发器使用。

```ts
const headers = {
  Authorization: `Bearer ${devSessionToken}`,
  'X-Dao-Env': 'prod',
  'X-Dao-Character-Id': 'local-character',
  'X-Dao-Session-Id': 'local-session',
};
const health = await fetch('/api/dao/health', { headers }).then((response) => response.json());
```

使用 `PUT /api/dao/consents/UserProvided` 提交生活记录来源的授权，首次将 `expectedConsentVersion` 设为 `0`。写入附带每次操作唯一的 `Idempotency-Key`，网络重试沿用原键。取得新版本后，将它放入 `POST /api/dao/data/records` 的 `expectedConsentVersion`。记录所用的 `sourceId`、类别、敏感度与用途必须匹配授权。手动记录需要读取和上传权限，生成和查看观察还需要分析权限。未授权的数据视图返回 403。

## 鉴权与通用行为

- 每个操作携带 `Authorization: Bearer <token>`、`X-Dao-Env: prod|exp`、`X-Dao-Character-Id`、`X-Dao-Session-Id`。服务端验签后从身份声明解析 `ownerId`，并验证三项请求作用域。开发环境使用服务端签发的会话令牌。客户端提交的身份字段不得改变授权主体。
- 所有写操作携带 `Idempotency-Key`。服务端按完整作用域、操作、资源路径和键约束请求重放。同键同请求返回原结果或已受理的状态，同键异请求返回 `409 IDEMPOTENCY_CONFLICT`。重新发出具备副作用的请求前应沿用原键。对话 SSE 重试使用同一键并重用已保存审核结果和轮次标识。
- 所有 JSON 成功响应含 `{ ok: true, data, meta }`，错误响应含 `{ ok: false, error, meta }`。`meta` 包含 `requestId`、RFC 3339 的 `serverTime`、`consentVersion`、`projectionVersion`。鉴权失败时 `consentVersion` 返回 `0` 作为未解析值。错误详情限调用方有权看到的字段。
- 带并发控制的写入提交 `expectedConsentVersion`，过期返回 `409 CONSENT_VERSION_MISMATCH`。列表游标为不透明字符串，绑定作用域和过滤条件。开放式 JSON 数据字段仍按具体记录类型或任务类型做服务端校验。
- `GET /api/dao/health` 也要求鉴权。其 `sqlite` 报告当前范围的 WAL、外键、FTS5、忙等待和迁移版本。

## 双通道 SSE

`GET /api/dao/stream` 推送运行进度，`POST /api/dao/chat/reply` 推送单轮回复。两个通道都使用 `text/event-stream`、`Cache-Control: no-cache, no-transform` 和 `X-Accel-Buffering: no`。Web Console 使用能附请求头的 `fetch` 流读取。每条业务帧的 `event` 是事件名，`data` 是 JSON 对象，包含 `scope`、`meta` 和该帧对应的 `data`。HTTP 失败在开始流前返回错误信封。开始流后发送 `error` 帧并按事件定义结束本次流。注释心跳可由客户端忽略。

| 通道 | 事件 |
|---|---|
| 运行时 | `track_update`（A/B1/B2/C/D）、`system_event`、`commit_record`、`task_status`、`shadow_psychology`、`consent_revoked`、`stream_reset`、`error` |
| 对话 | `reply_started`、`reply_delta`、`safety_replaced`、`reply_done`、`error` |

- 运行时事件附有供同一作用域断线续订的流 ID。客户端以 `Last-Event-ID` 恢复，服务端按当前授权筛选可补发内容。游标不可用时推送 `stream_reset`，客户端刷新快照与仍可读取的事件。流 ID 与持久事件 `sequence` 语义独立。
- M1 的运行时流初次连接发送 `: connected\n\n`，随后每 25 秒发送 `: ping\n\n`，即使期间没有业务事件。注释帧不更新游标。初次订阅从当前出站位置接收新增事件，客户端可先连接，再读快照和历史事件并按序合并。令牌到期会收到 `UNAUTHENTICATED` 错误帧，续签后用最近的业务事件 ID 重连。
- 对话的用户消息提交 `turnType: message`。显式结束提交 `turnType: session_end`，触发授权范围内的 Shadow 批处理。流式回复先发 `reply_started`，随后发已审核的 `reply_delta` 帧。高风险用 Strict，常规用 Buffered，Fast 用于低风险的简单请求。Buffered 使用前一句重叠上下文，按句末标点、最多 100 字或 1500 ms 触发审核。
- 发出 `safety_replaced` 后，客户端用 `replacement` 替换该轮的可见回复，后续只接收原因是 `safety_replaced` 的 `reply_done` 或终止错误。已发送的网络内容无法撤回，因此未经审核的片段不得发送。

腾讯云部署可对运行时流使用独立 Nginx 路径。下例关闭缓存及缓冲，并允许心跳间隔内的空闲时间。上游 Express 响应始终携带 `X-Accel-Buffering: no`。 [Nginx HTTP 代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

```nginx
location = /api/dao/stream {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 75s;
    gzip off;
}
```

## 领域与持久化约定

| 范围 | 契约约束 |
|---|---|
| 事件、提交与回放 | `SystemEvent` 独立记录发生时间、接收时间和提交序列；`CommitRecord` 记录四类写入、结果与状态哈希。事件和投影版本构成提交幂等约束，每 100 条事件写检查点。State Replay 使用固定事件顺序，随机项使用事件 ID 与投影版本确定的种子。Appraisal 使用录制模型输出，E2E 使用快照与对照，三个模式都 Mock 副作用并重新应用撤销和硬遗忘。 |
| 授权 | 授权以作用域、数据源、类别、敏感度、采集模式及适用设备来限定。类别与敏感度是独立字段。读取是其余五维的前提，心理推断还依赖分析。长期记忆另经治理审批，角色使用只接收筛选摘要。派发前、外部调用前和写事务内核对版本与用途。 |
| 溯源与遗忘 | 独立 `ProvenanceRecord` 用上游实体引用串联来源、处理主体、版本、派生、消费与失效。四种治理动作各用独立判别值，删除沿依赖图传播，墓碑保留最小标识和必要审计字段。 |
| 角色与画像 | 快照分别返回 `userProfile`、`characterPersonality`、`relationshipState`、`characterEmotion`，另有调节状态、情绪溯源和轨道指标。心理分析默认 Shadow，候选附证据、替代解释、置信度或未知，以及有效期限。只有授权、证据通过的受限摘要可以进入角色上下文。 |
| 任务与账本 | 客户端请求意图和数据，服务端签发 `MikaTaskContract` 并裁决路由、风险、动作及数据范围。官方 API 或 Android 原生接口优先。Critical 任务禁止自主执行。遇 `UNKNOWN_RESULT` 先核验副作用再决定重试；由独立主体验收并记入 `AgentAccountabilityLedger`。 |
| 实验与导出 | 实验用独立存储及只读授权快照。提升需人工审批与独立评估，发布对象为获批配置。备份校验覆盖完整原始快照与作用域元数据，保留当前撤销与删除约束，写入失败则整笔回滚。Obsidian 导出含七个固定分区，默认排除高敏原始记录。 |

Node 22 的 SQLite 权威存储通过 `DaoPersistencePort` 屏蔽具体驱动。数据库启用 WAL、外键和 5000 ms 忙等待，写事务采用 `BEGIN IMMEDIATE`。生产与实验使用分别持久化的 SQLite 文件，仓储操作再绑定完整作用域。事件、投影、业务记录和 Outbox 同事务提交，模型及工具处理在事务之外执行。

M1 的备份限于调用者的完整作用域，包含事件与提交、可见数据与溯源、当前授权审计和删除墓碑。单份可移植备份最多 7 MiB。恢复前验证 SHA-256、事件重放哈希、作用域和当前授权，并保留已有删除栅栏。当前历史与备份前缀一致时可续接后续事件。仅初始化授权的全新作用域可以在重新授权后恢复数据，恢复作为新治理事件入账，源历史保留在备份文件中。恢复将历史授权记录作为审计资料，当前生效授权由服务端保留。

包含 M2a 角色或时钟提交的归档，恢复时要求目标库拥有匹配的提交前缀。依赖历史顺序的情绪与时钟通过原事件重放恢复。

## 协作与里程碑发布

- Codex 维护 `server.ts`、`src/dao-v31/`、`src/contracts/dao-v31/` 和 `docs/`。前端维护 `src/components/dao/`、`src/services/dao*` 和 `src/App.tsx`。合并时使用 Codex 冻结的共享契约及配套 OpenAPI 和 JSON Schema。
- 把授权备份放在仓库外，或写入已忽略的 `.dao-backups/`。保存单个备份时使用 `dao-backup-<日期>.json`。环境变量模板 `.env.example` 只填写变量名及非敏感示例，实际 `DAO_SESSION_SECRET` 通过本地环境或主机密钥配置注入。
- 推送前核对待提交路径，检查受忽略规则覆盖的文件是否已被 Git 跟踪，再检查暂存内容是否含实际密钥。Git 已跟踪的文件会绕过忽略规则，发现本地数据库、测试库、备份或密钥时应先从待发布内容移除。

```sh
git check-ignore --no-index -- .env .env.production local.sqlite local.sqlite-wal test.db test.db-shm .dao-backups/export.json dao-backup-example.json
git ls-files -ci --exclude-standard
git diff --cached --name-only
git grep --cached -l -E 'DAO_SESSION_SECRET[[:space:]]*=[[:space:]]*[[:xdigit:]]{64}|DEEPSEEK_API_KEY[[:space:]]*=[[:space:]]*sk-' -- .
```

每个里程碑先跑本阶段验收门禁、`npm test` 和 `npm run lint`。通过后提交代码与验收报告，同步到 GitHub，再用 `v3.1-m1`、`v3.1-m2a` 等标签标记已核验的提交。发布后核对远端标签指向。需要复现旧版本时，从对应标签建立本地分支。
