// ── v1.0 时钟模块 (System Clock) ──
// 集中式时间管理：提供统一的 now()、today()、elapsed() API
// 管理所有系统定时器（探索周期、情感衰减、自主循环）
// 支持时间注入用于测试（setMockTime / useRealTime）
//
// 设计原则：
//   - 单一真相来源：所有模块通过 Clock 获取时间，而非直接调 Date.now()
//   - 可测试性：测试中注入假时间，验证时间相关行为
//   - 可观测性：暴露 uptime、tick 计数等指标

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export interface ClockSnapshot {
  now: number;
  iso: string;
  hour: number;
  dayOfWeek: number;
  timeSlot: 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn';
  uptimeMs: number;
  tickCount: number;
}

export interface TimerHandle {
  id: number;
  cancel: () => void;
}

// ════════════════════════════════════════════════════════════
// 2. 核心实现
// ════════════════════════════════════════════════════════════

class Clock {
  private _mockTime: number | null = null;
  private _startTime: number;
  private _tickCount = 0;

  constructor() {
    this._startTime = Date.now();
  }

  // ── 时间源 ──

  /** 当前时间戳（ms）。测试中可注入。 */
  now(): number {
    return this._mockTime ?? Date.now();
  }

  /** ISO 时间字符串 */
  iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** 当前小时 (0-23) */
  hour(): number {
    return new Date(this.now()).getHours();
  }

  /** 当前星期 (0=Sun, 6=Sat) */
  dayOfWeek(): number {
    return new Date(this.now()).getDay();
  }

  /** 今天日期标记 (YYYY-MM-DD) */
  todayKey(): string {
    const d = new Date(this.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 当前时段 */
  timeSlot(): 'morning' | 'afternoon' | 'evening' | 'night' | 'dawn' {
    const h = this.hour();
    if (h >= 5 && h < 8) return 'dawn';
    if (h >= 8 && h < 12) return 'morning';
    if (h >= 12 && h < 18) return 'afternoon';
    if (h >= 18 && h < 23) return 'evening';
    return 'night';
  }

  // ── 时间计算 ──

  /** 从某个时间戳到现在的毫秒数 */
  elapsedMs(since: number): number {
    return this.now() - since;
  }

  /** 从某个时间戳到现在的分钟数 */
  elapsedMinutes(since: number): number {
    return this.elapsedMs(since) / 60_000;
  }

  /** 从某个时间戳到现在的小时数 */
  elapsedHours(since: number): number {
    return this.elapsedMs(since) / 3_600_000;
  }

  /** 从某个时间戳到现在的天数 */
  elapsedDays(since: number): number {
    return this.elapsedMs(since) / 86_400_000;
  }

  // ── 系统度量 ──

  /** 注入假时间（测试用） */
  setMockTime(timestamp: number | null): void {
    this._mockTime = timestamp;
    if (timestamp !== null) {
      this._startTime = timestamp; // 同步启动时间避免负 uptime
    }
  }

  /** 系统运行时长（ms） */
  uptimeMs(): number {
    return this.now() - this._startTime;
  }

  /** 递增 tick 计数并返回 */
  tick(): number {
    this._tickCount++;
    return this._tickCount;
  }

  /** 获取当前快照 */
  snapshot(): ClockSnapshot {
    return {
      now: this.now(),
      iso: this.iso(),
      hour: this.hour(),
      dayOfWeek: this.dayOfWeek(),
      timeSlot: this.timeSlot(),
      uptimeMs: this.uptimeMs(),
      tickCount: this._tickCount,
    };
  }

  // ── 测试支持 ──

  /** 快进时间（测试用） */
  advanceTime(ms: number): void {
    if (this._mockTime !== null) {
      this._mockTime += ms;
    }
  }

  /** 是否在测试模式 */
  isMocked(): boolean {
    return this._mockTime !== null;
  }

  /** 重置到真实时间 */
  reset(): void {
    this._mockTime = null;
    this._startTime = Date.now();
    this._tickCount = 0;
  }
}

// ── 全局单例 ──
export const clock = new Clock();
