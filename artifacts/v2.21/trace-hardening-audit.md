# v2.21 trace 硬化 + 审计脚本

## 1. 发现并修掉 v2.20 的一个真实脱敏漏洞

v2.20 声称 trace "不存用户原话"，但 **`ExpressionPlan.evidence` 是自由字符串，且会夹带用户原话**：

```ts
// src/lib/expressionPlan.ts
if (input.causeQuote) evidenceParts.push(`他刚说的「${input.causeQuote}」`);
```

也就是说：只要本轮计划带了 `causeQuote`（比如他说了某句触发她状态的话），`turn_trace.jsonl` 里就会写入
`evidence:"…他刚说的「<用户原话>」"` —— **v2.20 的脱敏承诺在这一路径上是错的**。之前两次验证恰好都没命中
（plan 都是 silent/unknown、evidence 为空），所以没暴露。

修法（`server/services/turnTrace.ts`）：

- 新增 `sanitizeTraceLabel()`：去换行/制表 → 把 `「…」`/`“…”`/`"…"` 里的内容替换成 **`[引文已遮蔽]`** → 折叠空白 → 限长 160；
- `plan.evidence` 落盘前一律过这个函数（`causeQuote` 本来就不在白名单里）；
- 单测覆盖：含「他刚说的「我今天特别难过」」的 evidence 落盘后**不含原话**、含遮蔽标记；换行/三种引号/超长/空值。

## 2. 审计脚本（让 trace 真正可查）

新增 `scripts/trace-audit.mjs`：

```bash
node scripts/trace-audit.mjs                 # 读 memories/turn_trace.jsonl
node scripts/trace-audit.mjs --rounds        # 加逐轮表格
node scripts/trace-audit.mjs --json          # 聚合 JSON
node scripts/trace-audit.mjs --file=<path>   # 指定文件
# 或 npm run trace:audit
```

聚合：轮数/时间范围、strategy 分布、plan decision/duration、evidence 非空率、intrinsic accepted 类型与 rejected 原因、
guard changes、使用工具的轮数与工具名、budget calls/elapsed/timeouts/expired、prompt 字数、回复字数/问号数。
**不打印任何正文**（只打印枚举/计数/短码）。

## 3. 证据

| 项 | 结果 |
|---|---|
| 单测 `turnTrace.test.ts` + `turnTraceEvidence.test.ts` | 7 条（含引文遮蔽回归） |
| 全量测试 | **2009 通过**（118 文件） |
| tsc | 0 |
| 真实 trace（主实例 1 轮）审计 | 正常输出：plan=silent/unknown、budget elapsed 6241ms、reply 36 字 |
| 合成 3 行（含 `plan:null`/`budget:null` 旧形态）审计 | `--json` 与 `--rounds` 均正常，空字段显示 `-` |
| 引文泄漏验证 | 含「我今天特别难过」的 evidence 落盘后 **不出现原话** ✅ |

## 4. 诚实局限

- 遮蔽只覆盖**带引号**的引文（`「」/“”/""`）。如果未来有人往 `evidence` 里塞**不带引号**的用户原话，仍会泄漏；
  根本解法是让 `expressionPlan` 不把 causeQuote 塞进 evidence（或给 evidence 定义结构化字段），这步没做。
- 审计脚本只读当前文件，不自动合并 `.rot-*` 轮转文件；也不按 userId 哈希分组。
- 没有做 UI / 可视化。
