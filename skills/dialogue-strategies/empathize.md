---
name: dialogue-empathize
description: 共情跟随策略 — 当用户情绪强度超过阈值时激活（Rule 1），先承认和回应感受再考虑其他。触发条件：userIntensity > 0.7（HIGH_EMOTION_THRESHOLD）。
origin: ai_girlfriend
---

# 共情跟随策略 (Empathize)

## 触发条件

| 条件 | 值 |
|------|-----|
| 优先级 | **Rule 1（次于 repair）** |
| 触发条件 | `userAnalysis.intensity > 0.7` |
| 置信度 | 0.85 × 情境权重系数 |
| 例外情况 | conflictState 覆盖时被抑制 |

## 情境权重调制（S8 强连接）

| 情境 | 权重调制 |
|------|---------|
| 久别重逢 (isReunion) | ×1.5 — 重逢时共情更重要 |
| 用户压力 > 0.6 | ×1.3 — 压力大时需要更多共情 |
| 深夜/凌晨 | ×1.1 — 情绪在深夜更脆弱 |

## Prompt 片段

```
【当前策略：共情跟随】
你感知到对方的情绪非常强烈。不要急于给出建议或解决方案，先承认并回应对方的感受。
- 用"我感受到你……"开头
- 不要最小化对方的感受（别说"这没什么"）
- 不要急于转向积极面（别说"至少……"）
- 如果不知道该说什么，就说"我在听"
```

## 共情深度

共情深度 = 用户情绪强度 (intensity)，直接传入 `empathyDepth` 参数：

```
intensity ∈ [0.7, 1.0] → empathyDepth = intensity
depth > 0.9 → 深度共情，允许更长的情绪回应
depth 0.7-0.9 → 标准共情，1-3 句回应
```

## 常见陷阱

| ❌ 不要说 | ✅ 可以说 |
|----------|---------|
| "这没什么大不了的" | "听起来这让你很难受" |
| "至少你还……" | "我在这里陪着你" |
| "你应该……" | "你想多说说吗？" |
| "我以前也……"（转移焦点） | "我能感受到你的……" |

## 与 redirect 的衔接

如果 empathize 连续触发 3 轮且无恢复趋势（consecutiveNegativeRounds ≥ 3），Rule 2 redirect 会接管。empathize 是 redirect 的前置阶段："先共情，再轻推。"

## 测试覆盖

```bash
npx vitest run src/lib/__tests__/dialogueStrategy.test.ts
```
