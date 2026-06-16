// ── v1.0 好奇心状态归约器 (Curiosity State Reducer) ──
// applyCuriosityEvent(state, event) → newState
//
// 设计目标：
//   与 EmotionState 的 applyEvent 同构 —— curiosity 状态变更也从事件派生
//   使 DiscoveryStored / InterestDecayed 等事件可回放、可审计
//
// 当前 coverage：
//   DiscoveryStored  — 存储新发现
//   InterestDecayed  — 衰减/清理过期兴趣
//
// Phase 2 扩展：
//   InterestDetected         — 兴趣检测（当前只发事件不改变已持久化的 state）
//   DiscoveryDuplicateSkipped — 统计用，不改变 discoveries 数组

import type { Discovery } from './types.js';
import type { BusEvent } from '../eventBus.js';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface CuriositySnapshot {
  discoveries: Discovery[];
  interestCount: number;
}

export interface DiscoveryStoredPayload {
  topic: string;
  sourceType: 'web' | 'ai_generated';
  quality: number;
  /** 实际存储的 discovery（用于回放） */
  discovery?: Discovery;
}

export interface InterestDecayedPayload {
  removed: number;
  remaining: number;
}

// ════════════════════════════════════════════════════════════
// 核心
// ════════════════════════════════════════════════════════════

/**
 * 应用好奇心事件到本地状态。
 * 返回更新后的 discoveries 数组引用（不可变更新）。
 *
 * @param discoveries 当前发现列表
 * @param event 好奇心事件
 * @returns 新发现列表（如果事件不影响则返回原引用）
 */
export function applyCuriosityEvent(discoveries: Discovery[], event: BusEvent): Discovery[] {
  switch (event.type) {
    case 'DiscoveryStored':
      return applyDiscoveryStored(discoveries, event.data as DiscoveryStoredPayload);
    case 'DiscoveryDuplicateSkipped':
    case 'ExplorationStarted':
    case 'ExplorationCompleted':
    case 'DiscoveryShared':
      // 观测事件，不改变 discoveries
      return discoveries;
    case 'InterestDecayed':
      // InterestDecayed 改变的是 interestModel，不是 discoveries
      // 由 interests.ts 中的 decayInterests 直接管理
      return discoveries;
    default:
      return discoveries;
  }
}

/**
 * 获取兴趣数量的可变引用封装。
 * 返回一个简易计数器快照供测试和观测。
 */
export function getCuriositySnapshot(discoveries: Discovery[], interestCount: number): CuriositySnapshot {
  return { discoveries, interestCount };
}

// ════════════════════════════════════════════════════════════
// 事件处理器
// ════════════════════════════════════════════════════════════

function applyDiscoveryStored(discoveries: Discovery[], payload: DiscoveryStoredPayload): Discovery[] {
  // 如果有完整的 discovery 对象，直接 push
  if (payload.discovery) {
    const next = [...discoveries, payload.discovery];
    if (next.length > 200) next.shift(); // MAX_DISCOVERIES
    return next;
  }

  // 如果只有摘要信息（旧代码路径），构造最小 discovery
  const minimalDiscovery: Discovery = {
    id: `disc_replay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: `${payload.topic} 发现`,
    content: '',
    topic: payload.topic,
    timestamp: Date.now(),
    shared: false,
    quality: payload.quality,
    sourceType: payload.sourceType,
    verified: false,
  };

  const next = [...discoveries, minimalDiscovery];
  if (next.length > 200) next.shift();
  return next;
}

/**
 * 构建 DiscoveryStored 事件的完整 payload。
 * discovery 对象可选 —— 有则用于精确回放，无则用摘要信息。
 */
export function buildDiscoveryStoredPayload(d: Discovery): DiscoveryStoredPayload {
  return {
    topic: d.topic,
    sourceType: d.sourceType,
    quality: d.quality,
    discovery: d, // 完整对象用于确定性回放
  };
}
