# 单机体验基线（v2.01，2026-10-22T15:24:47.945Z）

> 5 轮真实聊天 + 5 个读接口；**先测量再优化**。所有数字都是本机一次采样，不是 SLO。

## 读接口
| 路径 | 延迟 | 状态 |
|---|---|---|
| /health | 0ms | ok |
| /api/her-state | 0ms | ok |
| /api/memories?limit=5 | 0ms | ok |
| /api/diagnostics | 0ms | ok |
| /api/activity/understanding | 0ms | ok |

## 聊天端到端
| 轮 | 输入 | 端到端 | 回复字数 | timings 字段 | RSS 前→后 |
|---|---|---|---|---|---|
| 1 | 今天下午开了个会，挺累的 | 6612ms | 82 | 11 个 | 115→124 MB |
| 2 | 嗯，我在。 | 2142ms | 96 | 11 个 | 124→125 MB |
| 3 | 你会怎么形容傍晚的天气？ | 5275ms | 111 | 11 个 | 125→128 MB |
| 4 | 我刚才在想一件事，还没想明白 | 1692ms | 8 | 11 个 | 128→129 MB |
| 5 | 陪我说会话吧 | 3115ms | 68 | 11 个 | 129→129 MB |

- 端到端平均：**3767ms**（最小 1692ms / 最大 6612ms）

## 服务端分阶段（DEBUG_TIMINGS=true）
| 阶段 | 平均 |
|---|---|
| conflictDetectionMs | 0ms |
| contextEnrichmentMs | 0ms |
| emotionUpdateMs | 1ms |
| patternRetrievalMs | 3ms |
| thoughtGenerationMs | 4ms |
| strategySelectionMs | 3ms |
| arbitrationMs | 2ms |
| rhythmDecisionMs | 0ms |
| memoryGraphMs | 5ms |
| internalEmotionMs | 1ms |
| totalMs | 18ms |

## 记忆写入
| 轮 | episodes 前→后 |
|---|---|
| 1 | 125→125 |
| 2 | 125→125 |
| 3 | 125→125 |
| 4 | 125→125 |
| 5 | 125→125 |

## 备注 / 限制
- 这是**单机一次采样**：未做并发、未做冷启动对比、未做多日趋势；
- 第一轮可能包含惰性初始化（嵌入/具体化/Laya 等），与后续轮不可直接平均；
- 分阶段耗时只在 `DEBUG_TIMINGS=true` 时返回（默认不暴露，避免响应变大）；
- 未覆盖：故障注入（模型 API 超时/失败）、长会话内存增长、磁盘 IO 峰值。