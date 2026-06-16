---
name: dialogue-accompany
description: 沉默陪伴策略 — 当用户表达无力感时激活（Rule 3），不急于填满空间而是用简洁有力的陪伴回应。触发条件：arousal < 0.2 且 valence < -0.3（NEGATIVE_THRESHOLD）。
origin: ai_girlfriend
---

# 沉默陪伴策略 (Accompany)

## 触发条件

| 条件 | 值 |
|------|-----|
| 优先级 | **Rule 3（次于 redirect）** |
| 触发条件 | `arousal < 0.2` **且** `valence < -0.3` |
| 置信度 | 0.80 × 情境权重系数 |
| 被抑制条件 | 某些极少情境下被抑制 |

## 情境权重调制（S8 强连接）

| 情境 | 权重调制 |
|------|---------|
| 深夜/凌晨 | ×1.3 — 深夜更需要陪伴感 |
| 久别重逢 (isReunion) | ×1.2 — 重逢时陪伴更被需要 |
| 用户高情绪 (intensity > 0.7) | ×0.5 — 应先 empathize，不是 accompany |

## 降级 Fallback

当所有其他策略被情境抑制时，accompany 作为最终降级选项：
```
confidence = 0.40, reason = "所有策略被情境抑制，降级为沉默陪伴"
```

## Prompt 片段

```
【当前策略：沉默陪伴】
对方表达了深深的无力感或疲惫。有时候不说话比说话更好。
- 回应急可以很短（1-2句话）
- "我在"，"我陪着你"比任何建议都有力量
- 不要让回复显得空洞——真诚地承认你无法"解决"什么
- 可以提供一个安静的共同活动的邀请（"要不要一起听首歌"）
```

## 回应长度指导

```
minimalDelay = 2.0 秒（给对话留出呼吸空间）
回复字数 10-40 字（比 quick_chat 更短）
```

## 与 empathize 的区别

| 维度 | empathize | accompany |
|------|-----------|-----------|
| 情绪强度 | 高唤醒、高情绪 | 低唤醒、无力感 |
| 回应策略 | 积极回应、确认感受 | 简洁陪伴、给空间 |
| 主动性 | 主动共情 | 被动陪伴 |
| 错误代价 | 少说为佳 | 多说反而增加负担 |

## 测试覆盖

```bash
npx vitest run src/lib/__tests__/dialogueStrategy.test.ts
```
