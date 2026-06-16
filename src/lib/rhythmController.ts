// ── v1.0 节奏控制器 (Rhythm Controller) ──
// 显式管理交互节奏：响应延迟、主动消息频率、快聊/深聊模式切换
// 解决 P1 问题：节奏控制零散存在但无独立模块
//
// 核心原则：
//   - AI 不应该总是秒回
//   - 主动消息需要时间和频率约束
//   - 会话节奏应根据情境动态调整

import type { TimeContext, UserStateContext, SessionContext } from './contextAwareness';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type ChatMode = 'quick_chat' | 'casual' | 'deep_talk';

export interface RhythmConfig {
  /** 最短响应延迟（毫秒），模拟"思考时间" */
  minResponseDelayMs: number;
  /** 最长响应延迟（毫秒） */
  maxResponseDelayMs: number;
  /** 当前聊天模式 */
  mode: ChatMode;
  /** 24小时内主动消息最大数量 */
  maxProactivePerDay: number;
  /** 两次主动消息的最小间隔（分钟） */
  minProactiveIntervalMin: number;
  /** 主动消息的适宜时间窗口 [开始小时, 结束小时] */
  proactiveTimeWindow: [number, number];
}

export interface RhythmDecision {
  /** 本轮回复的建议延迟（毫秒） */
  responseDelayMs: number;
  /** 是否允许发送主动消息 */
  allowProactive: boolean;
  /** 建议的回复长度（字符数） */
  suggestedResponseLength: number;
  /** 当前聊天模式 */
  mode: ChatMode;
  /** 决策原因（可观测性） */
  reason: string;
}

export interface ProactiveQuota {
  sentToday: number;
  lastSentAt: number | null;
  dailyLimit: number;
  remaining: number;
}

// ════════════════════════════════════════════════════════════
// 2. 默认配置
// ════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: RhythmConfig = {
  minResponseDelayMs: 500,        // 至少半秒"思考"
  maxResponseDelayMs: 5000,       // 最多5秒
  mode: 'casual',
  maxProactivePerDay: 2,          // 24h内最多2条主动消息
  minProactiveIntervalMin: 120,   // 两次主动消息至少间隔2小时
  proactiveTimeWindow: [9, 22],   // 早9点到晚10点之间
};

const MODE_LENGTHS: Record<ChatMode, { min: number; max: number }> = {
  quick_chat: { min: 10, max: 60 },
  casual: { min: 30, max: 150 },
  deep_talk: { min: 80, max: 400 },
};

// ════════════════════════════════════════════════════════════
// 3. 节奏控制器
// ════════════════════════════════════════════════════════════

export class RhythmController {
  private config: RhythmConfig = { ...DEFAULT_CONFIG };
  private proactiveQuota: ProactiveQuota = {
    sentToday: 0,
    lastSentAt: null,
    dailyLimit: DEFAULT_CONFIG.maxProactivePerDay,
    remaining: DEFAULT_CONFIG.maxProactivePerDay,
  };
  private todayKey: string = '';
  private recentResponseTimes: number[] = [];     // 最近几次回复耗时（用于模式检测）
  private consecutiveQuickRounds = 0;
  private consecutiveDeepRounds = 0;

  // ── 响应延迟计算 ──

  /** 计算本轮回复的建议延迟 */
  computeResponseDelay(
    time: TimeContext,
    _user: UserStateContext,
    session: SessionContext,
    emotionIntensity: number,
  ): number {
    let delay = this.config.minResponseDelayMs;

    // 1) 基于对话深度的基础延迟
    switch (session.depth) {
      case 'intimate':
        delay += 1500; // 深度对话多"思考"一会儿
        break;
      case 'deep':
        delay += 800;
        break;
      case 'small_talk':
        delay += 200;  // 轻松对话快速回应
        break;
      default:
        delay += 500;
    }

    // 2) 用户倾诉时增加延迟（表示在认真听/思考）
    if (session.isUserVenting) {
      delay += 1000;
    }

    // 3) 高情绪强度时增加延迟（需要措辞）
    if (emotionIntensity > 0.7) {
      delay += 800;
    }

    // 4) 深夜适当增加延迟（人类深夜反应也会变慢）
    if (time.timeSlot === 'night' || time.timeSlot === 'dawn') {
      delay += 500;
    }

    // 5) 添加随机抖动 (±20%)，避免机械化
    const jitter = (Math.random() - 0.5) * 0.4 * delay;
    delay += jitter;

    // 限制在配置范围内
    delay = Math.max(this.config.minResponseDelayMs, Math.min(this.config.maxResponseDelayMs, delay));

    this.recentResponseTimes.push(delay);
    if (this.recentResponseTimes.length > 20) this.recentResponseTimes.shift();

    return Math.round(delay);
  }

  // ── 聊天模式检测与切换 ──

  /** 根据用户行为自动检测并切换聊天模式 */
  detectMode(
    userMessageLength: number,
    responseLength: number,
    roundIntervalMs: number,
  ): ChatMode {
    // 快聊模式信号：短消息 + 短间隔
    if (userMessageLength < 30 && roundIntervalMs < 30_000) {
      this.consecutiveQuickRounds++;
      this.consecutiveDeepRounds = 0;
    } else if (userMessageLength > 100 && roundIntervalMs > 60_000) {
      this.consecutiveDeepRounds++;
      this.consecutiveQuickRounds = 0;
    } else {
      this.consecutiveQuickRounds = Math.max(0, this.consecutiveQuickRounds - 1);
      this.consecutiveDeepRounds = Math.max(0, this.consecutiveDeepRounds - 1);
    }

    // 切换阈值
    if (this.consecutiveQuickRounds >= 4) {
      this.config.mode = 'quick_chat';
    } else if (this.consecutiveDeepRounds >= 3) {
      this.config.mode = 'deep_talk';
    } else if (this.consecutiveQuickRounds === 0 && this.consecutiveDeepRounds === 0) {
      this.config.mode = 'casual';
    }

    return this.config.mode;
  }

  /** 获取当前模式下的建议回复长度 */
  getSuggestedResponseLength(): number {
    const range = MODE_LENGTHS[this.config.mode];
    return Math.floor((range.min + range.max) / 2);
  }

  // ── 主动消息频率控制 ──

  /** 检查是否允许在当前时刻发送主动消息 */
  canSendProactive(now: Date = new Date()): { allowed: boolean; reason: string } {
    const hour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);

    // 重置每日配额
    if (todayStr !== this.todayKey) {
      this.todayKey = todayStr;
      this.proactiveQuota.sentToday = 0;
      this.proactiveQuota.remaining = this.proactiveQuota.dailyLimit;
    }

    // 1) 时间窗口检查
    const [windowStart, windowEnd] = this.config.proactiveTimeWindow;
    if (hour < windowStart || hour >= windowEnd) {
      return {
        allowed: false,
        reason: `当前时间 ${hour}:00 不在适宜窗口 [${windowStart}:00, ${windowEnd}:00) 内`,
      };
    }

    // 2) 每日配额检查
    if (this.proactiveQuota.remaining <= 0) {
      return {
        allowed: false,
        reason: `已达今日主动消息上限 (${this.proactiveQuota.dailyLimit}条)`,
      };
    }

    // 3) 最小间隔检查
    if (this.proactiveQuota.lastSentAt) {
      const minutesSince = (now.getTime() - this.proactiveQuota.lastSentAt) / 60_000;
      if (minutesSince < this.config.minProactiveIntervalMin) {
        return {
          allowed: false,
          reason: `距上次主动消息仅 ${Math.round(minutesSince)} 分钟，需 ≥ ${this.config.minProactiveIntervalMin} 分钟`,
        };
      }
    }

    return { allowed: true, reason: '通过所有检查' };
  }

  /** 记录一次主动消息发送 */
  recordProactiveSent(now: Date = new Date()): void {
    this.proactiveQuota.sentToday++;
    this.proactiveQuota.remaining = Math.max(0, this.proactiveQuota.dailyLimit - this.proactiveQuota.sentToday);
    this.proactiveQuota.lastSentAt = now.getTime();
  }

  // ── 综合决策 ──

  /** 生成本轮完整的节奏决策 */
  decide(
    time: TimeContext,
    user: UserStateContext,
    session: SessionContext,
    emotionIntensity: number,
    userMessageLength: number,
    roundIntervalMs: number,
    contextModulation: { responseLengthMod: number; proactiveSuitability: number },
  ): RhythmDecision {
    // 检测聊天模式
    const mode = this.detectMode(userMessageLength, 0, roundIntervalMs);

    // 计算响应延迟
    const responseDelayMs = this.computeResponseDelay(time, user, session, emotionIntensity);

    // 检查主动消息
    const proactiveCheck = this.canSendProactive();
    const allowProactive = proactiveCheck.allowed && contextModulation.proactiveSuitability > 0.5;

    // 计算建议回复长度
    const baseLength = this.getSuggestedResponseLength();
    const suggestedLength = Math.round(baseLength * contextModulation.responseLengthMod);

    return {
      responseDelayMs,
      allowProactive,
      suggestedResponseLength: suggestedLength,
      mode,
      reason: [
        `模式: ${mode}`,
        `延迟: ${responseDelayMs}ms`,
        `主动消息: ${allowProactive ? `允许(${proactiveCheck.reason})` : `禁止(${proactiveCheck.reason})`}`,
      ].join(' | '),
    };
  }

  // ── 查询接口 ──

  getMode(): ChatMode { return this.config.mode; }
  getProactiveQuota(): Readonly<ProactiveQuota> { return this.proactiveQuota; }
  getConfig(): Readonly<RhythmConfig> { return this.config; }

  updateConfig(partial: Partial<RhythmConfig>): void {
    Object.assign(this.config, partial);
    this.proactiveQuota.dailyLimit = this.config.maxProactivePerDay;
    this.proactiveQuota.remaining = Math.max(0, this.proactiveQuota.dailyLimit - this.proactiveQuota.sentToday);
  }

  reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.proactiveQuota = {
      sentToday: 0, lastSentAt: null,
      dailyLimit: DEFAULT_CONFIG.maxProactivePerDay,
      remaining: DEFAULT_CONFIG.maxProactivePerDay,
    };
    this.recentResponseTimes = [];
    this.consecutiveQuickRounds = 0;
    this.consecutiveDeepRounds = 0;
  }
}

// 全局单例
export const rhythmController = new RhythmController();
