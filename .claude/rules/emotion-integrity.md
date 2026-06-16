# 情感引擎修改规范

> 每次修改 `src/lib/emotionEngine.ts` 或 `src/lib/emotionOptimizer.ts` 时必须遵循。

## 修改前检查

- [ ] 确认当前 `USE_EMOTION_OPTIMIZER` 开关状态
- [ ] 阅读 `moduleConnections.ts` 中 S3/S4/S6 连接定义
- [ ] 确认修改不会破坏 `aiCoordinator.processTurn()` 的管道顺序

## 修改后必须验证

### 1. 九情吸引子稳定性
```bash
npx vitest run src/lib/__tests__/emotionEngine.test.ts
```
- 所有 9 个情绪的 intensity 必须在 [0, 1] 范围内
- 主导情绪切换时不能出现 NaN
- EMA 平滑后情绪值不得振荡（相邻两帧变化 > 0.5 为异常）

### 2. v4.1 补丁完整性
```bash
npx vitest run src/lib/__tests__/emotionOptimizer.test.ts
```
- 个性化损失厌恶系数 ∈ [1.0, 3.0]
- 唤醒边界：`max(0.1, 1-arousal)` 确保最小 10% 上升空间
- 两阶段反转：Phase1（加速回归中性）→ Phase2（温和翻转 0.4）
- 翻转后压力衰减至 30% 而非清零

### 3. 数学边界
- `valence` ∈ [-1, 1]
- `arousal` ∈ [0, 1]
- `expectation` ∈ [-1, 1]
- `reversalPressure` ∈ [0, ∞) 不得为 NaN
- `extremityDuration` 在离开极值区时自动清零

### 4. 特性开关行为
- `USE_EMOTION_OPTIMIZER = false` 时，行为必须与 v4.0 完全一致
- `USE_EMOTION_OPTIMIZER = true` 时，v4.1 四项补丁全部激活
- 切换开关后需重置状态重新测试

## 禁止的操作

- 不得修改 `EMOTION_ATTRACTORS` 坐标而不更新对应的 `EMOTION_MEMORY_KEYWORDS`
- 不得在 `updateTaiji()` 中引入副作用（如直接修改全局状态）
- 不得移除现有的 JSDoc 注释（数学公式说明）
