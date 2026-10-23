# v2.25 删除的备份传播（`.bak` 不再让删掉的记忆复活）

> 接 v1.99 / v2.00 审查的 P1：「删除要传播」，但 `.bak` 副本会留旧数据。
> v2.00 的实现里 `purgeBackups` **默认关**，必须手动加 `?purgeBackups=1` 才清 ⇒ 正常删除仍留副本。

## 改动

### 1. 删除默认清理 `.bak`

- `server/services/memoryAdmin.ts` 新增 `parsePurgeBackups(value)`：**默认 true**；只有显式 `0`/`false` 才保留备份。
- `DELETE /api/memories/:id` 改为 `parsePurgeBackups(req.query.purgeBackups)`：
  - 默认：episodic + 图谱 + `.bak` 里同 id 一起清；`scrubbedBackups` 计数；
  - `?purgeBackups=0` / `?purgeBackups=false`：保留旧行为（显式 opt-out）。
- 审计日志 `memories/memory_admin_audit.jsonl` 仍记录 `scrubbedBackups`。

### 2. 导出不含 `.bak`（补断言）

`exportMemories()` 本来就按扩展名白名单（`.json`/`.jsonl`/…）过滤，`.bak` 命中不了 → 被 `skipped(binary_or_unsupported)`。
此前没有测试钉住，这次补上，防止以后把备份也导出、让"删除"从导出文件里复活。

## 证据

| 项 | 结果 |
|---|---|
| 单测 `memoryAdmin.test.ts` | **8 通过**（新增 1：`parsePurgeBackups` 全部输入 + 行为衔接；导出测试新增 `.bak` 被跳过断言） |
| 隔离实例 E2E | 删除前 `.bak` 含目标 id=True → `DELETE /api/memories/:id`（不带参数）返回 `ok=true, removedEpisode=true, scrubbedBackups=1` → 删除后 `.bak` 含目标=False；审计记录 `scrubbedBackups:1` |
| 全量测试 | 见提交记录 |
| tsc | 0 |

## 局限

- `scrubBackups()` 只处理 **`episodic_memory.json.bak*` 这类带 `episodes` 的 JSON**；`memory_graph.json.bak` 等其它备份不会按 id 清理（图谱节点本身已从主文件删除）。
- 已存在的旧 `.bak` 文件不会自动删除；没有批量清理脚本/端点（目前只能手动删，或后续加 `privacy:purge-backups`）。
- `?purgeBackups=false` 仍保留旧行为——这是有意的逃生口，但意味着"删了还可能从备份恢复"。
- 导出只是**不包含**备份，不会删除它们。
