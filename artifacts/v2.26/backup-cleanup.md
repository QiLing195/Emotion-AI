# v2.26 批量备份清理（`privacy:purge-backups`）

> 接 v2.25 的遗留：删除已默认清 `.bak`，但**旧的备份副本**还在 `memories/` 里；
> v2.24 的历史清理也会生成 `.pre-redact-*` 备份。这次给一个可审计的批量清理工具。

## 工具

```bash
npm run privacy:purge-backups                         # dry-run（默认）
npm run privacy:purge-backups -- --apply              # 实际删除
npm run privacy:purge-backups -- --older-than=7       # 只删早于 7 天的
npm run privacy:purge-backups -- --include-rotations  # 连 .rot-* 轮转也当备份删
npm run privacy:purge-backups -- --dir=<dir>
```

- 匹配：`.bak`、`.bak.<ts>`、`.bak-<ts>`、`.pre-redact-*`；**默认不碰 `.rot-*`**（那些是历史数据，不是备份副本）。
- 安全：只列普通文件（跳过 symlink/目录/读不到），只按文件名模式匹配，删除失败不抛、返回 failed。
- 输出：文件 / 大小 / 年龄（天）表格 + 共多少 / 释放多少。

实现拆成可测服务 `server/services/backupCleanup.ts`（`isBackupName` / `listBackupFiles` / `selectBackups` / `purgeBackups` / `formatBytes`）+ 薄 CLI `scripts/purge-backups.ts`。

## 真实执行

| 项 | 数值 |
|---|---|
| 匹配 | 5 个 / **649.5KB** |
| 明细 | `emotion_state.json.bak-2026-09-15…`（2 个，各 7.4KB/7.3KB，37 天）、`episodic_memory.json.bak` 28.3KB（37 天）、`memory_graph.json.bak` 581.6KB（37 天）、`episodic_memory.json.bak.1789918011612` 24.9KB（33 天） |
| 执行 | 先复制到 `%TEMP%` 安全备份 → `--apply` 删除 → 校验 `memories/` 剩 0 → 删除临时安全备份 |
| 释放 | 649.5KB |
| 服务 | `/health` ok |

## 证据

| 项 | 结果 |
|---|---|
| 单测 `backupCleanup.test.ts` | **6 通过**（文件名识别含 `.bak-<ts>`、`.rot-*` 开关；只列普通文件；older-than 按 mtime；purge 真删 + failed 不抛；formatBytes） |
| 全量测试 | 见提交记录 |
| 真实 dry-run/apply | 5 个匹配、649.5KB；apply 后 0 残留 |
| tsc | 0 |

## 局限

- 只删 `memories/`（或 `--dir`）下**文件名匹配**的备份；不扫描子目录。
- 不清理 `memory_graph.json.bak` 之外的其它"非文件备份"（如 git 历史、系统快照）。
- 删除不可逆（本次先复制到 `%TEMP%` 再删，确认后连临时备份也删了）。
- `--include-rotations` 会删时间线 `.rot-*` 历史，默认关闭；没有"保留最近 N 份"的保留策略（需要的话后续加）。
- 脚本不做审计日志（`memories/memory_admin_audit.jsonl` 只记 API 删除）。
