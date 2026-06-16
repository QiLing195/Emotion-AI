---
name: ai-girlfriend-quality-gate
description: AI 女友项目的完整质量验证流程 — 类型检查 → 测试套件 → 安全扫描 → 情感引擎冒烟测试 → 模块连接健康检查。在完成功能或提交 PR 前运行。
origin: ai_girlfriend
---

# AI 女友质量门控

对标 ECC `verification-loop` skill，每次修改后或提交前的完整质量检查。

## 何时使用

- 完成一个功能或重大代码修改后
- 修改 `src/lib/` 下的任何引擎文件后
- 修改 `server.ts` 或 `server/` 目录后
- 提交 PR 前
- 部署前

## Phase 1: TypeScript 类型检查

```bash
npx tsc --noEmit 2>&1 | head -40
```

**通过标准**: 零错误（warning 可接受）

**失败处理**: 修复所有 ERROR 后重新运行，不要跳过

## Phase 2: 测试套件

```bash
npx vitest run --reporter=verbose 2>&1 | tail -50
```

**通过标准**:
- 63 个测试全部通过
- 无 skipped 测试
- 覆盖率 ≥ 80%

**按模块运行**（调试时）:
```bash
# 情感引擎
npx vitest run src/lib/__tests__/emotionEngine.test.ts src/lib/__tests__/emotionOptimizer.test.ts

# 对话策略 + 冲突管理
npx vitest run src/lib/__tests__/dialogueStrategy.test.ts src/lib/__tests__/conflictManager.test.ts

# 情境感知 + 节奏控制
npx vitest run src/lib/__tests__/contextAwareness.test.ts src/lib/__tests__/rhythmController.test.ts

# 记忆系统
npx vitest run src/lib/__tests__/episodicMemory.test.ts

# 好奇心引擎
npx vitest run src/curiosity/__tests__/funnel.test.ts src/curiosity/__tests__/insights.test.ts src/curiosity/__tests__/patterns.test.ts
```

## Phase 3: API 安全扫描

```bash
# 检查硬编码密钥
grep -rn "sk-\|AIza\|api_key\|apiKey\|secret" --include="*.ts" src/ server/ server.ts 2>/dev/null \
  | grep -v "process.env" \
  | grep -v "\.env" \
  | grep -v "safetySetting" \
  | grep -v "your_"

# 检查 console.log 残留
grep -rn "console\.log" --include="*.ts" --include="*.tsx" src/ server/ 2>/dev/null | wc -l
# 应趋近于 0（当前已知 139 个残留为技术债，不新增即可）

# 检查 .env 在 .gitignore 中
grep -q "\.env" .gitignore && echo "✅ .env in .gitignore" || echo "❌ .env NOT in .gitignore"
```

**通过标准**: 零硬编码密钥，无新增 console.log

## Phase 4: 情感引擎冒烟测试

```bash
# 确保服务在运行 (npm run dev)
curl -s http://localhost:3000/state | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert -1 <= d['valence'] <= 1, f'valence out of range: {d[\"valence\"]}'
assert 0 <= d['arousal'] <= 1, f'arousal out of range: {d[\"arousal\"]}'
print(f'✅ State OK: valence={d[\"valence\"]:.3f} arousal={d[\"arousal\"]:.3f} dominant={d.get(\"dominant\", \"?\")}')
"
```

## Phase 5: 模块连接健康检查

```bash
# 管道钩子状态
curl -s http://localhost:3000/api/metrics

# 当前对话策略
curl -s http://localhost:3000/api/strategy | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'策略: {d.get(\"strategy\", \"?\")}, 置信度: {d.get(\"confidence\", \"?\")}')
"

# 冲突状态
curl -s http://localhost:3000/state | python3 -c "
import sys, json
d = json.load(sys.stdin)
c = d.get('conflictState', {})
print(f'冲突阶段: {c.get(\"phase\", \"normal\")}, 警告数: {c.get(\"warningCount\", 0)}')
"
```

## Phase 6: 对话质量手动抽查

```bash
# 测试边界输入
TEST_CASES=(
  "我今天很难过"
  "你根本不懂我"
  "谢谢你一直陪着我"
  "我最近对摄影很感兴趣"
  "你说的对，我可能反应过度了"
)

for msg in "${TEST_CASES[@]}"; do
  echo "=== 测试: $msg ==="
  curl -s -X POST http://localhost:3000/api/chat \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"$msg\",\"persona\":{},\"settings\":{}}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('strategy','?'))"
done
```

## 全部通过后的检查清单

- [ ] Phase 1: `tsc --noEmit` 零错误
- [ ] Phase 2: 63 测试全部通过
- [ ] Phase 3: 零硬编码密钥
- [ ] Phase 4: 情感状态值在合法范围
- [ ] Phase 5: 策略/冲突状态正常
- [ ] Phase 6: 边界输入不崩溃/不越界
- [ ] 人格安全边界（`.claude/rules/persona-safety.md`）未违反
- [ ] 情感引擎一致性（`.claude/rules/emotion-integrity.md`）未违反
