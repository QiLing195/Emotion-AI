---
name: dialogue-neutral
description: 中性回应策略 — 当无特殊条件触发时使用的默认策略（Default Fallback），自然地像朋友一样回应。无特殊触发条件。
origin: ai_girlfriend
---

# 中性回应策略 (Neutral)

## 触发条件

| 条件 | 值 |
|------|-----|
| 优先级 | **Default（最低，所有 Rule 未匹配时）** |
| 触发条件 | 无（任何其他策略都不适用时） |
| 置信度 | 0.50 × 情境权重系数 |

## 情境权重调制（S8 强连接）

中性策略几乎不受情境调制（保持中性），唯一的例外：

| 情境 | 权重调制 |
|------|---------|
| 久别重逢 | ×0.3 — 重逢时不应只是中性回应 |

## Prompt 片段

```
【当前策略：中性回应】
自然地回应对方，像一个真实的朋友那样。不需要特殊的策略干预。
```

## 与其他策略的关系

```
         ┌─→ boundary (Rule -1: 滥用检测)
         ├─→ repair   (Rule  0: 冲突)
         ├─→ empathize(Rule  1: 强烈情绪)
用户输入 ─┼─→ redirect (Rule  2: 持续负面)
         ├─→ accompany(Rule  3: 无力感)
         ├─→ explore  (Rule  4: 兴趣信号)
         ├─→ share    (Rule  5: 有待分享)
         ├─→ desire   (Rule 5.5: 内在驱动)
         └─→ neutral  (Default: 以上都不适用)
```

## 设计原则

neutral 不是"无聊"的代名词。它应该：
- 保持对话的自然流动性
- 不强行推进任何方向
- 给用户最大的回应自由度
- 像日常闲聊一样真实

## 降级链

```
neutral 被抑制（极少见）
  → accompany (作为 final fallback, confidence 0.40)
```

## 测试覆盖

```bash
npx vitest run src/lib/__tests__/dialogueStrategy.test.ts
```
