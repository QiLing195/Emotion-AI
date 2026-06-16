// ── v1.0 情境感知层 (Context Awareness Layer) ──
// 为情感引擎提供环境情境上下文，解决"同一句话不同情境"的理解问题
// 解决 P1 问题：情感引擎只处理文本，完全缺失环境情境概念
//
// 维度：
//   时间情境 — 早晨/深夜/周末/工作日
//   用户状态 — 活跃/疲惫/压力累积
//   会话情境 — 初次对话/深度交流/久别重逢

import type { EmotionState } from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface TimeContext {
  hour: number;            // 0-23
  dayOfWeek: number;       // 0(Sun)-6(Sat)
  isWeekend: boolean;
  timeSlot: 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn';
  seasonalityHint: string; // 季节提示 e.g. "初夏的傍晚"
}

export interface UserStateContext {
  /** 用户当前活跃度 [0, 1]，从交互频率推断 */
  activityLevel: number;
  /** 累积压力指数 [0, 1]，从近期负面情绪比例推断 */
  accumulatedStress: number;
  /** 连续活跃天数 */
  consecutiveActiveDays: number;
  /** 最近一次交互距今（分钟） */
  minutesSinceLastInteraction: number;
  /** 是否是久别重逢 (>24h) */
  isReunion: boolean;
  /** 用户当前情绪基调（近10轮滑动平均效价） */
  moodBaseline: number;
  /** 用户情绪波动性（近10轮效价标准差） */
  moodVolatility: number;
}

export interface SessionContext {
  /** 当前会话轮数 */
  roundInSession: number;
  /** 是否是今天的第一轮对话 */
  isFirstInteractionToday: boolean;
  /** 当前会话深度：'small_talk' | 'casual' | 'deep' | 'intimate' */
  depth: 'small_talk' | 'casual' | 'deep' | 'intimate';
  /** 用户是否在倾诉（连续长消息） */
  isUserVenting: boolean;
  /** 话题切换频率（近5轮话题变化次数） */
  topicSwitchRate: number;
}

export interface ContextSnapshot {
  time: TimeContext;
  user: UserStateContext;
  session: SessionContext;
  /** 综合情境权重，用于调制情感更新速率 */
  modulationFactors: ContextModulation;
}

export interface ContextModulation {
  /** 情感响应速率调制 [0.5, 1.5]，>1 = 更敏感 */
  emotionalSensitivityMod: number;
  /** 回复长度偏好 [0.5, 1.5]，>1 = 更长回复 */
  responseLengthMod: number;
  /** 主动消息适宜度 [0, 1] */
  proactiveSuitability: number;
  /** 深度对话倾向 [0, 1] */
  depthAffinity: number;
}

// ════════════════════════════════════════════════════════════
// 2. 常量
// ════════════════════════════════════════════════════════════

const STRESS_WINDOW = 10;              // 计算累积压力的窗口（轮数）
const MOOD_WINDOW = 10;               // 计算情绪基线的窗口
const REUNION_THRESHOLD_MIN = 24 * 60; // 24小时算久别重逢
const VENTING_MIN_MESSAGE_LENGTH = 50; // 倾诉消息最小长度（字符）
const DEEP_DEPTH_THRESHOLD = 5;       // 连续5轮以上深度交流

// ════════════════════════════════════════════════════════════
// 3. 情境感知引擎
// ════════════════════════════════════════════════════════════

export class ContextAwareness {
  // 历史记录
  private recentUserValences: number[] = [];
  private recentMessageLengths: number[] = [];
  private recentTopics: string[] = [];
  private interactionTimestamps: number[] = [];
  private dailyFirstInteraction: Record<string, boolean> = {};

  // ── 时间情境 ──

  getTimeContext(now: Date = new Date()): TimeContext {
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const month = now.getMonth();

    let timeSlot: TimeContext['timeSlot'];
    if (hour >= 5 && hour < 9) timeSlot = 'morning';
    else if (hour >= 9 && hour < 14) timeSlot = 'afternoon';
    else if (hour >= 14 && hour < 20) timeSlot = 'evening';
    else if (hour >= 20 && hour < 24) timeSlot = 'night';
    else timeSlot = 'dawn'; // 0-5

    const seasonNames = ['冬', '春', '夏', '秋'];
    const seasonIdx = Math.floor(((month + 1) % 12) / 3);
    const timeSlotNames: Record<string, string> = {
      morning: '早晨', afternoon: '午后', evening: '傍晚', night: '夜晚', dawn: '凌晨',
    };

    return {
      hour,
      dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      timeSlot,
      seasonalityHint: `${seasonNames[seasonIdx]}天的${timeSlotNames[timeSlot]}`,
    };
  }

  // ── 用户状态推断 ──

  getUserContext(now: Date = new Date()): UserStateContext {
    const nowMs = now.getTime();

    // 活动度：最近24小时的交互次数 / 24
    const recent24h = this.interactionTimestamps.filter(
      t => nowMs - t < 24 * 60 * 60_000,
    );
    const activityLevel = Math.min(1, recent24h.length / 12);

    // 连续活跃天数
    let consecutiveDays = 0;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (let d = 0; d < 30; d++) {
      const dayStart = today - d * 24 * 60 * 60_000;
      const dayEnd = dayStart + 24 * 60 * 60_000;
      if (this.interactionTimestamps.some(t => t >= dayStart && t < dayEnd)) {
        consecutiveDays++;
      } else {
        break;
      }
    }

    // 最近一次交互
    const lastInteraction = this.interactionTimestamps.length > 0
      ? this.interactionTimestamps[this.interactionTimestamps.length - 1]
      : nowMs;
    const minutesSince = (nowMs - lastInteraction) / 60_000;

    // 累积压力
    const accumulatedStress = this.calculateAccumulatedStress();

    // 情绪基线
    const moodBaseline = this.recentUserValences.length > 0
      ? this.recentUserValences.slice(-MOOD_WINDOW).reduce((a, b) => a + b, 0) / Math.min(this.recentUserValences.length, MOOD_WINDOW)
      : 0;

    // 情绪波动
    const recentVals = this.recentUserValences.slice(-MOOD_WINDOW);
    const mean = moodBaseline;
    const variance = recentVals.length > 1
      ? recentVals.reduce((s, v) => s + (v - mean) ** 2, 0) / recentVals.length
      : 0;
    const moodVolatility = Math.sqrt(variance);

    return {
      activityLevel,
      accumulatedStress,
      consecutiveActiveDays: consecutiveDays,
      minutesSinceLastInteraction: minutesSince,
      isReunion: minutesSince > REUNION_THRESHOLD_MIN,
      moodBaseline: Math.round(moodBaseline * 1000) / 1000,
      moodVolatility: Math.round(moodVolatility * 1000) / 1000,
    };
  }

  // ── 会话情境 ──

  getSessionContext(roundNumber: number, userText: string): SessionContext {
    const todayKey = new Date().toISOString().slice(0, 10);

    // 今天第一次交互
    const isFirstToday = !this.dailyFirstInteraction[todayKey];
    this.dailyFirstInteraction[todayKey] = true;

    // 消息长度
    this.recentMessageLengths.push(userText.length);
    if (this.recentMessageLengths.length > 20) this.recentMessageLengths.shift();

    // 倾诉检测
    const recentLengths = this.recentMessageLengths.slice(-3);
    const isVenting = recentLengths.length >= 2 &&
      recentLengths.every(l => l > VENTING_MIN_MESSAGE_LENGTH);

    // 对话深度
    const depth = this.inferConversationDepth(roundNumber, userText);

    // 话题切换率
    const topicSwitchRate = this.calculateTopicSwitchRate();

    return {
      roundInSession: roundNumber,
      isFirstInteractionToday: isFirstToday,
      depth,
      isUserVenting: isVenting,
      topicSwitchRate,
    };
  }

  // ── 综合调制因子 ──

  getModulationFactors(
    time: TimeContext,
    user: UserStateContext,
    session: SessionContext,
  ): ContextModulation {
    // 1) 情感敏感度调制
    let emotionalSensitivityMod = 1.0;
    // 深夜/凌晨更敏感
    if (time.timeSlot === 'night' || time.timeSlot === 'dawn') {
      emotionalSensitivityMod *= 1.2;
    }
    // 久别重逢更敏感
    if (user.isReunion) {
      emotionalSensitivityMod *= 1.3;
    }
    // 情绪波动大时降低敏感度（保护AI不被情绪过山车影响）
    if (user.moodVolatility > 0.5) {
      emotionalSensitivityMod *= 0.8;
    }

    // 2) 回复长度偏好
    let responseLengthMod = 1.0;
    if (session.depth === 'intimate') responseLengthMod *= 1.3;
    if (session.depth === 'small_talk') responseLengthMod *= 0.7;
    if (session.isUserVenting) responseLengthMod *= 0.5; // 倾诉时少说多听

    // 3) 主动消息适宜度
    let proactiveSuitability = 0.5;
    // 夜晚不打扰
    if (time.timeSlot === 'night' || time.timeSlot === 'dawn') proactiveSuitability *= 0.2;
    // 用户压力大时不宜主动打扰
    if (user.accumulatedStress > 0.6) proactiveSuitability *= 0.5;
    // 久别重逢适宜主动问候
    if (user.isReunion) proactiveSuitability *= 1.5;
    // 周末适宜
    if (time.isWeekend) proactiveSuitability *= 1.2;
    proactiveSuitability = Math.min(1, proactiveSuitability);

    // 4) 深度对话倾向
    let depthAffinity = 0.5;
    if (time.timeSlot === 'night') depthAffinity += 0.3; // 夜晚更容易深聊
    if (session.depth === 'deep' || session.depth === 'intimate') depthAffinity += 0.3;
    if (user.moodBaseline < -0.3) depthAffinity += 0.1;   // 用户情绪低落时
    depthAffinity = Math.min(1, depthAffinity);

    return {
      emotionalSensitivityMod: Math.round(emotionalSensitivityMod * 100) / 100,
      responseLengthMod: Math.round(responseLengthMod * 100) / 100,
      proactiveSuitability: Math.round(proactiveSuitability * 100) / 100,
      depthAffinity: Math.round(depthAffinity * 100) / 100,
    };
  }

  // ── 记录方法 ──

  recordInteraction(userValence: number, userText: string, topic?: string): void {
    this.recentUserValences.push(userValence);
    if (this.recentUserValences.length > 50) this.recentUserValences.shift();

    this.interactionTimestamps.push(Date.now());
    if (this.interactionTimestamps.length > 200) this.interactionTimestamps.shift();

    if (topic) {
      this.recentTopics.push(topic);
      if (this.recentTopics.length > 20) this.recentTopics.shift();
    }
  }

  getSnapshot(roundNumber: number, userText: string): ContextSnapshot {
    const now = new Date();
    const time = this.getTimeContext(now);
    const user = this.getUserContext(now);
    const session = this.getSessionContext(roundNumber, userText);
    const modulationFactors = this.getModulationFactors(time, user, session);

    return { time, user, session, modulationFactors };
  }

  // ── 内部方法 ──

  private calculateAccumulatedStress(): number {
    if (this.recentUserValences.length < 3) return 0;
    const recent = this.recentUserValences.slice(-STRESS_WINDOW);
    const negativeRatio = recent.filter(v => v < -0.2).length / recent.length;
    const meanValence = recent.reduce((a, b) => a + b, 0) / recent.length;
    // 负面比例 + 低效价 = 高压力
    return Math.min(1, negativeRatio * 0.6 + Math.max(0, -meanValence) * 0.4);
  }

  private inferConversationDepth(
    roundNumber: number,
    _userText: string,
  ): SessionContext['depth'] {
    // 基于近期消息长度和轮数推断对话深度
    const recentLengths = this.recentMessageLengths.slice(-5);
    const avgLength = recentLengths.length > 0
      ? recentLengths.reduce((a, b) => a + b, 0) / recentLengths.length
      : 0;

    if (roundNumber > 50 && avgLength > 100) return 'intimate';
    if (roundNumber > 20 && avgLength > 60) return 'deep';
    if (avgLength < 20) return 'small_talk';
    return 'casual';
  }

  private calculateTopicSwitchRate(): number {
    if (this.recentTopics.length < 3) return 0;
    const recent = this.recentTopics.slice(-5);
    let switches = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i] !== recent[i - 1]) switches++;
    }
    return switches / (recent.length - 1);
  }

  reset(): void {
    this.recentUserValences = [];
    this.recentMessageLengths = [];
    this.recentTopics = [];
    this.interactionTimestamps = [];
    this.dailyFirstInteraction = {};
  }
}

// 全局单例
export const contextAwareness = new ContextAwareness();
