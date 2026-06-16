---
name: emotion-coherence-checker
description: 情感引擎修改后的自动验证 — 检查九情稳定性、反转压力边界、唤醒边界、EMA 平滑效果。每次修改 emotionEngine.ts 或 emotionOptimizer.ts 后主动使用。
tools: ["Read", "Bash", "Grep"]
---

# 情感一致性验证 Agent

## 职责

每次修改 `src/lib/emotionEngine.ts` 或 `src/lib/emotionOptimizer.ts` 后，自动运行完整的情感状态一致性检查。

## 检查清单

### 1. 九情吸引子验证

```bash
npx vitest run src/lib/__tests__/emotionEngine.test.ts --reporter=verbose
```

检查点：
- [ ] 所有 9 个情绪的 intensity ∈ [0, 1]
- [ ] 主导情绪切换时无 NaN 或 undefined
- [ ] EMA 平滑后相邻两帧变化 ≤ 0.5
- [ ] `EMOTION_ATTRACTORS` 坐标与 `EMOTION_MEMORY_KEYWORDS` 同步

### 2. v4.1 补丁完整性

```bash
npx vitest run src/lib/__tests__/emotionOptimizer.test.ts --reporter=verbose
```

检查点：
- [ ] 个性化损失厌恶系数 ∈ [1.0, 3.0]（由 resilience/sensitivity 动态计算）
- [ ] 唤醒边界：`max(0.1, 1-arousal)` 始终 ≥ 0.1
- [ ] 唤醒基线回归不导致负值
- [ ] 两阶段反转：Phase1 加速回归中性、Phase2 温和翻转×0.4
- [ ] 翻转后压力衰减至 30% 而非清零
- [ ] `AROUSAL_POSITIVITY_FACTOR = 0.8` 正确应用

### 3. 极值反转安全性

```
reversalPressure 累积：
  valence > EXTREMITY_THRESHOLD → pressure += REVERSAL_RATE × dt
  valence ≤ EXTREMITY_THRESHOLD  → pressure 衰减

Phase 1 (1.0 ≤ pressure < 1.5): 加速回归中性，不反转
Phase 2 (pressure ≥ 1.5):       翻转 valence = -valence × 0.4

验证：
  - pressure 不出现 NaN
  - extremityDuration 在离开极值区时清零
  - 连续反转不导致振荡（amplitude 应递减）
```

### 4. 特性开关行为

```
USE_EMOTION_OPTIMIZER = false → 行为与 v4.0 完全一致
USE_EMOTION_OPTIMIZER = true  → v4.1 四项补丁全部激活
```

### 5. 回归测试

```bash
# 完整情感测试套件
npx vitest run src/lib/__tests__/emotionEngine.test.ts \
                src/lib/__tests__/emotionOptimizer.test.ts \
                src/lib/__tests__/edgeCases.test.ts
```

## 发现问题时

1. 记录：哪个检查点失败、输入条件、实际 vs 期望输出
2. 如果是 v4.1 行为变化 → 确认 isExpected 后更新测试
3. 如果是意外回归 → 标记 CRITICAL，阻塞合并
4. 如果涉及数学公式修改 → 更新 PROJECT_BOOK.md 中的对应章节
