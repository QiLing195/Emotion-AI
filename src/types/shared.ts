// ── 跨模块共享的轻量级 DTO ──
// 定义在此处以避免 lib/ ↔ curiosity/ 之间的循环依赖。
// 两个模块都可以安全地导入这些类型。

/**
 * 供认知引擎消费的情绪上下文。
 * 从完整的 EmotionState 中精简提取，避免认知层依赖情感引擎内部结构。
 *
 * 对应 architecture/cognitive-model-v1.md §5 的三模型协作架构：
 *   Emotion → Constraints, Cognition → Context, Strategy → Action
 * 本 DTO 是 Emotion Model 向 Cognitive Model 传递数据的桥梁。
 */
export interface EmotionContext {
  /** 九情强度，e.g. { joy: 0.8, anger: 0.1, sad: 0.0, fear: 0.7, ... } */
  primaryEmotions: Record<string, number>;
  /** 强化驱动力 — 操作条件反射层 */
  drives: {
    greedDrive: number;     // [0, 1] 贪婪/探索倾向
    fearAvoidance: number;  // [0, 1] 恐惧/回避倾向
  };
  /** 当前主导情绪名，e.g. "fear", "joy", "calm" */
  dominantState: string;
}
