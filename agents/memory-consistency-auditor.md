---
name: memory-consistency-auditor
description: 记忆一致性审计 — 验证情景记忆形成条件、艾宾浩斯遗忘曲线、情景→语义记忆整合的正确性。修改记忆系统相关代码后使用。
tools: ["Read", "Bash", "Grep"]
---

# 记忆一致性审计 Agent

## 职责

确保 AI 的记忆系统（情景记忆 + 记忆增强 + 整合）正确运行，不产生数据损坏或不一致。

## 检查清单

### 1. 情景记忆形成条件

验证记忆仅在以下条件触发时形成（不应丢失也不应滥生）：

```
触发条件（满足任一）:
  - 效价变化 > 0.25 (DELTA_VALENCE_THRESHOLD)
  - 唤醒峰值 > 0.7 (AROUSAL_PEAK_THRESHOLD)
  - 主导情绪切换
  - 包含显著模式关键词
  - 信念修正（范式版本变化）
```

```bash
npx vitest run src/lib/__tests__/episodicMemory.test.ts --reporter=verbose
```

检查：
- [ ] 细微情感波动不形成记忆（避免泛滥）
- [ ] 重大情感波动必定形成记忆（避免丢失）
- [ ] 叙事模板与情感匹配
- [ ] recallWeight 初始值合理
- [ ] tags 标签正确

### 2. 艾宾浩斯遗忘曲线

```bash
grep -n "effectiveHalfLife\|recallBoost\|BASE_HALF_LIFE" src/lib/memoryEnhancer.ts
```

验证：
- [ ] `BASE_HALF_LIFE_HOURS = 72` 正确应用
- [ ] `RECALL_BOOST_FACTOR = 1.5` 正确应用
- [ ] 每次回忆延长半衰期 50%
- [ ] `recallWeight < 0.05` 且 `recallCount ≤ 2` 时归档
- [ ] 最近 24h 内回忆过 → 10% 巩固加成
- [ ] 记忆永不永久删除（`MIN_RETENTION_WEIGHT = 0.05`）

### 3. 情感染色重构

```bash
grep -n "currentValence\|reconstruct\|情感染色" src/lib/memoryEnhancer.ts
```

验证：
- [ ] 原始记忆数据不被修改（仅本次回忆版本不同）
- [ ] 正向情感 → 温暖前缀
- [ ] 负向情感 → 克制前缀
- [ ] 中性情感 → 客观前缀
- [ ] 重构不影响 recallWeight 计算

### 4. 情景→语义记忆整合

```bash
grep -n "LifeLesson\|记忆整合\|consolidat" src/lib/memoryEnhancer.ts
```

验证：
- [ ] ≥ 3 条共享标签的记忆触发整合
- [ ] recallWeight > 0.1 的记忆才参与
- [ ] ≥ 60% 同情感方向时才能形成 LifeLesson
- [ ] LifeLesson 的 confidence 计算合理
- [ ] 示例 LifeLesson: "真诚的连接需要双方都愿意打开心扉"

### 5. 统一记忆接口

```bash
npx vitest run src/lib/__tests__/unifiedMemory.test.ts --reporter=verbose
```

检查：
- [ ] 情景记忆 API: `findAll`, `findById`, `create`, `delete`
- [ ] 语义记忆 API: 与价值体系不冲突
- [ ] 记忆查询的过滤和排序正确

### 6. 记忆数据完整性

```bash
# 查看当前记忆状态
curl -s http://localhost:3000/api/memories?limit=10 | python3 -c "
import sys, json
memories = json.load(sys.stdin)
print(f'总记忆数: {len(memories) if isinstance(memories, list) else \"?\"}')
if isinstance(memories, list):
    for m in memories[:5]:
        print(f'  [{m.get(\"id\",\"?\")[:8]}] {m.get(\"dominantEmotion\",\"?\")} | {m.get(\"eventSummary\",\"\")[:50]}')
"
```

## 发现一致性问题时

1. **数据损坏** → 立即停止写入，备份数据，诊断根因
2. **逻辑错误** → 修复并添加对应测试用例
3. **边界条件遗漏** → 补充 edge case 测试
4. **性能问题** → 记忆数量 > 200 时需要索引或分页优化
