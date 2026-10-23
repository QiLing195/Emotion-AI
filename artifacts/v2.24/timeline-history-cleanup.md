# v2.24 旧时间线历史清理（把历史里的用户原话抹平）

> v2.23 只保证**新写入**脱敏；`memories/emotion_timeline.jsonl` 里还留着历史原话。
> 这次把它清掉，并留下可重复执行的维护脚本。

## 结果（真实数据）

| 项 | 数值 |
|---|---|
| 时间线节点 | 1756 |
| 含原话的节点 | **356**（`trigger.quoted` + `branch.causeQuoted`） |
| 清理后仍有原话 | **0** |
| 清理后带 `quotedHash` 的节点 | 358 |
| JSON 解析失败 | 0 |
| 文件大小 | 1014KB → 1024KB（hash 字段比短引文略长） |
| 备份 | 操作前复制到 `%TEMP%`，校验通过后删除（避免备份本身继续留原话） |

## 脚本

`scripts/redact-timeline-history.ts`（`npm run timeline:redact`）：

```bash
# 只报告（默认 dry-run）
node node_modules/tsx/dist/cli.mjs scripts/redact-timeline-history.ts
# 实际写回（默认先备份成 <file>.pre-redact-<ts>）
node node_modules/tsx/dist/cli.mjs scripts/redact-timeline-history.ts --apply
# 不生成同目录备份（确认 dry-run/演练后再用）
node node_modules/tsx/dist/cli.mjs scripts/redact-timeline-history.ts --apply --no-backup
# 只处理主文件、不碰 .rot-*
... --keep-rotations
```

- 纯函数 `redactTimelineNode()`（`emotionTimeline.ts`）：把非空 `trigger.quoted` / `branch.causeQuoted`
  替换成 `null` + `quotedHash`（sha256 前 16 位）+ `quotedLength`；**强制脱敏，不看 `TIMELINE_STORE_QUOTE`**；幂等。
- 脚本逐行解析、重写（临时文件 + rename），跳过坏行；失败不写回。
- ⚠️ `--apply` 默认生成的 `.pre-redact-*` 备份**仍含原话**；确认清理结果后应删除（或直接 `--no-backup`）。
  本次先在临时副本上演练（356/356、幂等），再对真实文件 `--no-backup` 执行，并另存 `%TEMP%` 备份，校验后删除。

## 证据

| 项 | 结果 |
|---|---|
| 单测 `emotionTimeline.test.ts` | **23 通过**（新增 2：强制脱敏 hash 一致/幂等；branch 同样处理） |
| 全量测试 | 见提交记录 |
| 临时副本演练 | 356 个节点脱敏、备份生成、重跑 0 变更、原话残留 0 |
| 真实 apply | 356 个节点脱敏、0 原话、0 解析失败、服务 `/health` ok |
| tsc | 0 |

## 局限

- 只处理 `emotion_timeline.jsonl`（及可选 `.rot-*`）；其它文件（`activity_log`、`emotion_timeline` 以外的记忆）不在范围。
- 备份如果保留，原话仍在备份里；脚本只提示，不自动删（避免误删）。
- 清理后历史节点保留 `quotedHash`：能证明"当时有引文"，但再也还原不出原文（设计如此）。
- 不影响新写入：v2.23 的运行时逻辑不变。
