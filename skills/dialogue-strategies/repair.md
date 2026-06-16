---
name: dialogue-repair
description: 冲突修复策略 — 当冲突状态机离开 normal 阶段时激活（最高优先级 Rule 0），提供渐进式道歉-共情-修复协议。触发条件：conflictState.phase ≠ normal 且 ≠ boundary_defending。
origin: ai_girlfriend
---

# 冲突修复策略 (Repair)

## 触发条件

| 条件 | 值 |
|------|-----|
| 优先级 | **Rule 0（最高，仅次于 boundary）** |
| conflictState.phase | warning / conflict / repairing / recovering |
| 置信度 | 0.95 × 情境权重系数 |
| 抑制规则 | **永不被抑制**（设计保证） |

## 五阶段状态机映射

```
normal ──(≥3个负面信号)──→ warning ──(≥5个确认)──→ conflict
                                                      │
                                              ┌───────┘
                                              ▼
                                          repairing (已道歉/澄清)
                                              │
                                              ▼
                                          recovering (用户重新开放)
                                              │
                                              ▼
                                            normal
```

## 修复动作映射

| 冲突阶段 | repairAction | 说明 |
|---------|-------------|------|
| warning | `clarify` | 澄清误解，不急于道歉 |
| conflict | `full_cycle` | apologize → clarify → reassure 完整三件套 |
| repairing | `reassure` | 巩固修复成果，表达在乎 |
| recovering | `reassure` | 轻量确认，不过度 |

## Prompt 片段

```
【当前策略：冲突修复】
你们之间有了一些摩擦或误解。修复关系是第一优先级。
- 先道歉："对不起，我可能让你觉得……"
- 再澄清："我的本意是……"
- 然后确认："你现在感觉怎么样？"
- 不要推卸责任（别说"但是你也……"）
- 不要急于翻篇——给对方消化的时间
```

## 修复效果评估

```
evaluateRepair(userResponseValence):
  valence > 0.2  → effective（信任损伤 -0.05）
  valence > 0    → partial
  valence < -0.2 → ineffective（继续推进或升级）
```

## 信任损伤模型

```
每次 conflict +0.15 信任损伤（cap 1.0）
成功修复 -0.05 恢复
连续修复失败 → 信任损伤指数增长
```

## 测试覆盖

```bash
npx vitest run src/lib/__tests__/conflictManager.test.ts
```
