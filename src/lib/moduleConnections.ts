// ── v1.0 模块连接规范 (Module Connection Specification) ──
// 显式定义模块间的强连接和弱连接，提供超时、fallback 和熔断保护
// 解决 P1 问题：连接类型不明确，故障传导不可控
//
// 连接分类：
//   STRONG  — 同步依赖，不允许失败，需超时 + fallback
//   WEAK    — 异步解耦，允许延迟/偶尔丢失，fire-and-forget
//   PENDING — 设计中有但尚未实现的连接

import { bus } from '../eventBus';

// ════════════════════════════════════════════════════════════
// 1. 连接定义
// ════════════════════════════════════════════════════════════

export type ConnectionStrength = 'strong' | 'weak' | 'pending';

export interface ModuleConnection {
  id: string;
  from: string;              // 源模块
  to: string;                // 目标模块
  strength: ConnectionStrength;
  description: string;
  /** 强连接的超时时间（毫秒） */
  timeoutMs?: number;
  /** 强连接的 fallback 行为 */
  fallback?: string;
  /** 熔断阈值：连续失败 N 次后断开 */
  circuitBreakerThreshold?: number;
  /** 当前状态 */
  status: 'healthy' | 'degraded' | 'broken' | 'pending';
  /** 连续失败计数 */
  consecutiveFailures: number;
  /** 最后一次失败时间戳（用于自动恢复） */
  lastFailureTime?: number;
}

// ════════════════════════════════════════════════════════════
// 2. 连接注册表
// ════════════════════════════════════════════════════════════

export const MODULE_CONNECTIONS: ModuleConnection[] = [
  // ═══ 强连接 (STRONG) — 同步依赖，不允许失败 ═══

  {
    id: 'S1',
    from: '用户输入',
    to: 'NLU管道',
    strength: 'strong',
    description: '文本理解：用户文本 → 情感/意图分析',
    timeoutMs: 5000,
    fallback: '内置中文规则分析器（无 Transformer 时）',
    circuitBreakerThreshold: 3,
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'S2',
    from: 'NLU管道',
    to: '情感事件提取(LLM)',
    strength: 'strong',
    description: '情感参数提取：分析结果 → EmotionEvent {deltaA, deltaB, deltaR...}',
    timeoutMs: 10000,
    fallback: '基于关键词的启发式情感评估',
    circuitBreakerThreshold: 2,
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'S3',
    from: '情感事件提取',
    to: '情感引擎更新',
    strength: 'strong',
    description: '五层情感更新：EmotionEvent → Taiji → YinYang → Sancai → 九情',
    timeoutMs: 500,
    fallback: undefined, // 不允许失败，但这是纯计算，基本不会超时
    circuitBreakerThreshold: 5,
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'S4',
    from: '情感引擎 + 系统Prompt',
    to: 'AI回复生成',
    strength: 'strong',
    description: '生成回复：情感上下文 + 人格Prompt → LLM 生成',
    timeoutMs: 30000,
    fallback: '预定义中性回复（"我在这里" / "嗯，我理解"）',
    circuitBreakerThreshold: 2,
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'S5',
    from: '冲突检测信号',
    to: '对话策略选择',
    strength: 'strong',
    description: '冲突感知：ConflictState → 策略引擎选择 repair/empathize',
    timeoutMs: 100,
    fallback: undefined,
    circuitBreakerThreshold: 3,
    status: 'healthy',  // ✅ aiCoordinator 阶段 1+4: conflictState → StrategyContext
    consecutiveFailures: 0,
  },
  {
    id: 'S6',
    from: '人格参数',
    to: '情感引擎更新速率',
    strength: 'strong',
    description: '个性化调制：resilience/sensitivity → lossAversion/alphaValues',
    timeoutMs: 50,
    fallback: '使用默认参数 (ALPHA_V=0.30, lossAversion=2.0)',
    circuitBreakerThreshold: 5,
    status: 'healthy',  // ✅ lossAversion + alpha 动态化均已挂接 taijiUpdate
    consecutiveFailures: 0,
  },
  {
    id: 'S7',
    from: '价值体系',
    to: '对话策略选择',
    strength: 'strong',
    description: '价值驱动策略：activeValues → getSituationalWeights 调制策略权重',
    timeoutMs: 50,
    fallback: '使用默认策略权重（权重=1.0）',
    circuitBreakerThreshold: 5,
    status: 'healthy',  // ✅ extractActiveValues → aiCoordinator → StrategyContext → getSituationalWeights
    consecutiveFailures: 0,
  },
  {
    id: 'S8',
    from: '情境感知层',
    to: '对话策略选择',
    strength: 'strong',
    description: '情境调制：时间/用户状态/会话深度 → 策略权重 + 抑制规则',
    timeoutMs: 50,
    fallback: '使用默认策略权重（忽略情境调制）',
    circuitBreakerThreshold: 5,
    status: 'healthy',  // ✅ aiCoordinator 阶段 2+4: timeSlot/userStress/isReunion → StrategyContext
    consecutiveFailures: 0,
  },

  // ═══ 弱连接 (WEAK) — 异步解耦，允许延迟/丢失 ═══

  {
    id: 'W1',
    from: '情感引擎更新',
    to: '情景记忆形成检查',
    strength: 'weak',
    description: '异步检查是否形成新记忆（不阻塞回复生成）',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W2',
    from: '情景记忆形成',
    to: '价值体系刷新',
    strength: 'weak',
    description: '每 N 轮批量处理，从记忆标签中更新价值置信度',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W3',
    from: '好奇心探索',
    to: '发现存储',
    strength: 'weak',
    description: '后台探索结果异步写入，不影响主对话流程',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W4',
    from: '发现存储',
    to: '可分享内容标记',
    strength: 'weak',
    description: '高质量发现标记为可分享，供策略引擎选用',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W5',
    from: '认知事件发射',
    to: '认知观测台指标计算',
    strength: 'weak',
    description: '事件日志离线分析，不阻塞主流程',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W6',
    from: '情感状态变更',
    to: '主动消息决策',
    strength: 'weak',
    description: '自主循环定时检查（非实时），loneliness > threshold 时触发',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W7',
    from: '冲突状态机',
    to: '情景记忆（标记冲突记忆）',
    strength: 'weak',
    description: '冲突记忆特殊标记，以便未来修复时参考',
    status: 'healthy',  // ✅ aiCoordinator 管道中 conflict → repair strategy 已串联
    consecutiveFailures: 0,
  },
  {
    id: 'W8',
    from: '好奇心发现',
    to: '对话话题建议队列',
    strength: 'weak',
    description: '发现不直接推送，放入建议队列供策略引擎按需取用',
    status: 'healthy',  // ✅ aiCoordinator 中 pendingDiscoveries → share 策略已串联
    consecutiveFailures: 0,
  },
  {
    id: 'W9',
    from: '思维图谱',
    to: 'desire 策略内容源',
    strength: 'weak',
    description: 'activeWishes → desire 策略的真实内容来源（替代兴趣模型拼凑），异步弱连接',
    status: 'healthy',  // 🆕 thoughtGraph.ts 已就位，aiCoordinator 管道已集成
    consecutiveFailures: 0,
  },

  // ═══ 待建连接 (PENDING 但不急) ═══

  {
    id: 'W10',
    from: 'MemoryGraph',
    to: 'workspace 注入',
    strength: 'weak',
    description: '图遍历召回 memoryContext → System Prompt workspace 注入（替代关键词匹配）',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W11',
    from: '情景记忆形成',
    to: 'MemoryGraph 节点同步',
    strength: 'weak',
    description: '新情景记忆/发现/思维节点 → 异步添加为 MemoryNode + 自动建边',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'W12',
    from: 'aiCoordinator 行为信号',
    to: 'evolution.attachmentStyle',
    strength: 'weak',
    description: 'v1.1 依恋风格分类：效价波动+话题切换+亲密寻求+频率波动 → secure/anxious/avoidant',
    status: 'healthy',
    consecutiveFailures: 0,
  },
  {
    id: 'P3',
    from: '思维图谱 — 认知失调',
    to: '情景记忆（内在冲突标记）',
    strength: 'pending',
    description: '活跃的认知失调应形成特殊的"内在冲突"记忆，丰富人格深度',
    status: 'pending',
    consecutiveFailures: 0,
  },
  {
    id: 'P1',
    from: '身份叙事',
    to: '系统Prompt个性描述',
    strength: 'pending',
    description: '已有但隐式，应将叙事→Prompt的映射显式化为接口',
    status: 'pending',
    consecutiveFailures: 0,
  },
  {
    id: 'P2',
    from: '节奏控制器',
    to: 'TTS响应延迟',
    strength: 'pending',
    description: '将 rhythmController 的延迟决策应用到 TTS 播放时机',
    status: 'pending',
    consecutiveFailures: 0,
  },
];

// ════════════════════════════════════════════════════════════
// 3. 连接健康检查
// ════════════════════════════════════════════════════════════

export interface ConnectionHealthReport {
  totalConnections: number;
  strongHealthy: number;
  strongDegraded: number;
  strongBroken: number;
  weakHealthy: number;
  pendingCount: number;
  criticalWarnings: string[];
}

export function getConnectionHealth(): ConnectionHealthReport {
  const strong = MODULE_CONNECTIONS.filter(c => c.strength === 'strong');
  const weak = MODULE_CONNECTIONS.filter(c => c.strength === 'weak');
  const pending = MODULE_CONNECTIONS.filter(c => c.strength === 'pending');

  const criticalWarnings: string[] = [];

  // 强连接中有任何非 healthy 的都是严重问题
  for (const conn of strong) {
    if (conn.status === 'broken') {
      criticalWarnings.push(`🔴 强连接断裂: ${conn.id} (${conn.from} → ${conn.to}) — ${conn.description}`);
    } else if (conn.status === 'degraded') {
      criticalWarnings.push(`🟡 强连接降级: ${conn.id} (${conn.from} → ${conn.to}) — ${conn.description}`);
    } else if (conn.status === 'pending') {
      criticalWarnings.push(`⚪ 强连接待建: ${conn.id} (${conn.from} → ${conn.to}) — ${conn.description}`);
    }
  }

  return {
    totalConnections: MODULE_CONNECTIONS.length,
    strongHealthy: strong.filter(c => c.status === 'healthy').length,
    strongDegraded: strong.filter(c => c.status === 'degraded').length,
    strongBroken: strong.filter(c => c.status === 'broken').length,
    weakHealthy: weak.filter(c => c.status === 'healthy').length,
    pendingCount: pending.length,
    criticalWarnings,
  };
}

// ════════════════════════════════════════════════════════════
// 4. 强连接执行包装器
// ════════════════════════════════════════════════════════════

/**
 * 包装强连接调用：自动添加超时、fallback 和熔断逻辑
 *
 * @param connId 连接 ID
 * @param fn 要执行的实际函数
 * @param fallbackFn 失败时的 fallback 函数（可选）
 * @param timeoutMs 超时时间（可选，默认使用连接定义中的）
 */
export async function executeStrongConnection<T>(
  connId: string,
  fn: () => Promise<T>,
  fallbackFn?: () => Promise<T> | T,
  timeoutMs?: number,
): Promise<T> {
  const conn = MODULE_CONNECTIONS.find(c => c.id === connId);
  if (!conn) throw new Error(`未找到连接: ${connId}`);

  // 自动恢复：熔断 60s 后进入半开状态，允许重试
  if (conn.status === 'broken') {
    const cooldownMs = 60_000;
    if (conn.lastFailureTime && Date.now() - conn.lastFailureTime > cooldownMs) {
      console.log(`[ModuleConnections] ${connId} 熔断冷却完成，进入半开状态`);
      conn.status = 'degraded';
      conn.consecutiveFailures = 1; // 半开：允许一次重试
    } else {
      console.warn(`[ModuleConnections] ${connId} 已熔断，直接使用 fallback`);
      if (fallbackFn) return fallbackFn();
      throw new Error(`连接 ${connId} 已熔断且无 fallback`);
    }
  }

  const timeout = timeoutMs ?? conn.timeoutMs ?? 5000;

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`连接 ${connId} 超时 (${timeout}ms)`)), timeout),
      ),
    ]);

    // 成功：重置计数器
    conn.consecutiveFailures = 0;
    conn.lastFailureTime = undefined;
    if (conn.status === 'degraded') {
      conn.status = 'healthy';
      console.log(`[ModuleConnections] ${connId} 已恢复健康`);
    }
    return result;
  } catch (error) {
    conn.consecutiveFailures++;
    conn.lastFailureTime = Date.now();

    // 熔断检查
    if (conn.circuitBreakerThreshold &&
        conn.consecutiveFailures >= conn.circuitBreakerThreshold) {
      conn.status = 'broken';
      console.error(
        `[ModuleConnections] 🔴 ${connId} 连续失败 ${conn.consecutiveFailures} 次，已熔断`,
      );
    } else if (conn.consecutiveFailures >= 2) {
      conn.status = 'degraded';
    }

    // 尝试 fallback
    if (fallbackFn) {
      console.warn(`[ModuleConnections] ${connId} 失败，使用 fallback: ${(error as Error).message}`);
      return fallbackFn();
    }

    throw error;
  }
}

/**
 * 发送弱连接事件（fire-and-forget）
 * 失败不抛异常，仅记录日志
 */
export function emitWeakConnection(connId: string, eventName: string, data?: any): void {
  const conn = MODULE_CONNECTIONS.find(c => c.id === connId);
  if (!conn) {
    console.warn(`[ModuleConnections] 未找到弱连接: ${connId}`);
    return;
  }

  try {
    bus.emit(eventName as any, data);
  } catch (error) {
    conn.consecutiveFailures++;
    console.warn(
      `[ModuleConnections] 弱连接 ${connId} 发射失败 (第${conn.consecutiveFailures}次): ${(error as Error).message}`,
    );
  }
}

// ════════════════════════════════════════════════════════════
// 5. 启动时健康报告
// ════════════════════════════════════════════════════════════

export function printConnectionReport(): void {
  const report = getConnectionHealth();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('模块连接健康报告');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  总连接数: ${report.totalConnections}`);
  console.log(`  强连接: ${report.strongHealthy} 健康, ${report.strongDegraded} 降级, ${report.strongBroken} 断裂`);
  console.log(`  弱连接: ${report.weakHealthy} 健康`);
  console.log(`  待建: ${report.pendingCount}`);
  if (report.criticalWarnings.length > 0) {
    console.log('  ⚠️ 严重警告:');
    for (const w of report.criticalWarnings) {
      console.log(`    ${w}`);
    }
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
