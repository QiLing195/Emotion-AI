// ── v1.0 自主性行为配置 (Autonomy Config) ──
// 从 server.ts 提取所有可调校参数，集中管理。
// 调校时只需修改此文件，无需翻找 5314 行单体。

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface AutonomyConfig {
  /** 自主循环检查间隔（毫秒） */
  cycleMs: number;
  /** 空闲不足此分钟数跳过检查 */
  idleSkipMin: number;

  // ── 孤独感积累曲线 ──
  /** 孤独感积累速率曲线：[0, maxIdleMin) 区间对应的速率 */
  lonelinessCurve: { maxIdleMin: number; rate: number }[];

  // ── 触发阈值 ──
  /** 基础触发阈值（孤独度 > 此值触发主动联系） */
  contactBaseThreshold: number;
  /** 每次被忽略阈值增加量 */
  contactIgnorePenalty: number;
  /** 阈值上限 */
  contactMaxThreshold: number;
  /** 发送消息后孤独感降低量 */
  contactRelief: number;
  /** 每日主动消息上限 */
  contactDailyCap: number;
  /** 未读消息数达此值时抑制新消息 */
  maxPendingUnread: number;

  // ── 静默时段 ──
  /** 静默时段：在此期间不打扰用户 */
  quietHours: { start: number; end: number };
  /** 静默时段孤独感积累速率倍率 */
  quietHoursRateMultiplier: number;
  /** 静默时段触发阈值提高量 */
  quietHoursThresholdBoost: number;

  // ── 醒来冷却 ──
  /** 静默时段结束后冷却窗口（分钟） */
  postQuietCooldownMin: number;
  /** 冷却窗口内阈值提高 */
  postQuietThresholdBoost: number;
  /** 冷却窗口内最多发几条消息 */
  postQuietMaxMsgs: number;

  // ── 对话结束语宽限 ──
  /** 对话结束语后的宽限期（分钟） */
  closureGraceMin: number;
  /** 宽限期内积累速率倍率 */
  closureRateMultiplier: number;

  // ── 自适应节律 ──
  /** 节律追踪窗口天数 */
  rhythmWindowDays: number;
  /** EMA 平滑系数 */
  rhythmEmaAlpha: number;
  /** 默认节律因子（每小时，0-1） */
  defaultRhythm: Record<number, number>;

  // ── 发现分享 ──
  /** 可分享的发现质量阈值 */
  discoveryShareQuality: number;
  /** 每日发现分享上限 */
  discoveryDailyShareCap: number;
}

// ════════════════════════════════════════════════════════════
// 默认配置
// ════════════════════════════════════════════════════════════

export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  cycleMs: 10 * 60 * 1000, // 10 分钟

  idleSkipMin: 8,

  lonelinessCurve: [
    { maxIdleMin: 30, rate: 0.01 },    // 前30分钟：几乎不涨
    { maxIdleMin: 120, rate: 0.03 },   // 30-120分钟：温和积累
    { maxIdleMin: Infinity, rate: 0.05 }, // 2小时以上：正常速率
  ],

  contactBaseThreshold: 0.65,
  contactIgnorePenalty: 0.05,
  contactMaxThreshold: 0.85,
  contactRelief: 0.15,
  contactDailyCap: 3,
  maxPendingUnread: 2,

  quietHours: { start: 23, end: 8 },
  quietHoursRateMultiplier: 0.2,
  quietHoursThresholdBoost: 0.15,

  postQuietCooldownMin: 60,
  postQuietThresholdBoost: 0.15,
  postQuietMaxMsgs: 1,

  closureGraceMin: 180,   // 3 小时
  closureRateMultiplier: 0.3,

  rhythmWindowDays: 14,
  rhythmEmaAlpha: 0.25,
  defaultRhythm: {
    0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2, 6: 0.2, 7: 0.2,
    8: 0.3, 9: 0.05, 10: 0.05, 11: 0.05,
    12: 0.4, 13: 0.4,
    14: 0.05, 15: 0.05, 16: 0.05, 17: 0.05,
    18: 0.5,
    19: 1.0, 20: 1.0, 21: 1.0, 22: 1.0,
    23: 0.2,
  },

  discoveryShareQuality: 0.5,
  discoveryDailyShareCap: 2,
};

// ════════════════════════════════════════════════════════════
// 纯函数：基于配置的计算（不依赖可变状态）
// ════════════════════════════════════════════════════════════

/** 判断是否为静默时段 */
export function isQuietHour(ts: number, cfg: AutonomyConfig): boolean {
  const h = new Date(ts).getHours();
  return h >= cfg.quietHours.start || h < cfg.quietHours.end;
}

/** 判断是否在静默时段结束后的冷却窗口内 */
export function isPostQuietCooldown(ts: number, cfg: AutonomyConfig): boolean {
  const currentTotalMin = new Date(ts).getHours() * 60 + new Date(ts).getMinutes();
  const endTotalMin = cfg.quietHours.end * 60;
  if (cfg.quietHours.start > cfg.quietHours.end) {
    return currentTotalMin >= endTotalMin && currentTotalMin < endTotalMin + cfg.postQuietCooldownMin;
  }
  return false;
}

/** 根据忽略连击计算动态触发阈值 */
export function getCurrentThreshold(ignoredStreak: number, cfg: AutonomyConfig): number {
  return Math.min(
    cfg.contactMaxThreshold,
    cfg.contactBaseThreshold + ignoredStreak * cfg.contactIgnorePenalty,
  );
}

/** 根据空闲分钟获取孤独感积累速率 */
export function getLonelinessRate(
  idleMin: number,
  ts: number,
  cfg: AutonomyConfig,
  getAvailabilityFactor: (hour: number) => number,
  lastClosureTs: number,
): number {
  let rate = cfg.lonelinessCurve[cfg.lonelinessCurve.length - 1].rate;
  for (const stage of cfg.lonelinessCurve) {
    if (idleMin < stage.maxIdleMin) { rate = stage.rate; break; }
  }
  // 自适应节律因子
  const hour = new Date(ts).getHours();
  rate *= getAvailabilityFactor(hour);
  // 静默时段减缓
  if (isQuietHour(ts, cfg)) {
    rate *= cfg.quietHoursRateMultiplier;
  }
  // 对话结束语宽限期减缓
  if (lastClosureTs > 0 && (ts - lastClosureTs) < cfg.closureGraceMin * 60000) {
    rate *= cfg.closureRateMultiplier;
  }
  return rate;
}

/** 检测文本是否包含对话结束语 */
export function detectClosure(text: string): boolean {
  if (!text) return false;
  return CLOSURE_PATTERNS.some(p => p.test(text));
}

const CLOSURE_PATTERNS = [
  /晚安|睡了|去睡了|先睡了|困了.*睡/,
  /先忙了|去忙了|忙一下|有事|开会|上班|工作/,
  /回头聊|回头说|再聊|下次聊|晚点聊|等(?:下|会)儿.*聊/,
  /先走了|出门了|出去了|下了|先下了|拜拜|再见|88|bye/i,
  /回头.*找|等(?:下|会)儿.*找|晚点.*找/,
  /先(?:不说|不讲)了|到此为止|今天.*到这/,
];

/** 获取日期键（YYYY-MM-DD） */
export function getDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}
