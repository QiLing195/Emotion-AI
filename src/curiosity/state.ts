// v4.1: 好奇心引擎 — 封装状态管理
// 使用 CuriosityState 类替代模块级可变变量，提供更好的封装性和可测试性
import { InterestModel, Discovery, EXPLORATION_DAILY_CAP, EXPLORATION_COLD_START_CAP, EXPLORATION_COLD_START_MIN_INTERESTS, MAX_DISCOVERIES } from './types.js';

export class CuriosityState {
  readonly discoveries: Discovery[] = [];
  readonly interestModel: InterestModel = { interests: [], lastExploration: 0, lastDecayDay: '' };

  private _explorationTimer: ReturnType<typeof setInterval> | null = null;
  private _explorationCountToday = 0;
  private _explorationDayKey = '';

  getExplorationDailyCap(): number {
    return this.interestModel.interests.length < EXPLORATION_COLD_START_MIN_INTERESTS
      ? EXPLORATION_COLD_START_CAP
      : EXPLORATION_DAILY_CAP;
  }

  // Timer management
  setExplorationTimer(timer: ReturnType<typeof setInterval> | null): void { this._explorationTimer = timer; }
  getExplorationTimer(): ReturnType<typeof setInterval> | null { return this._explorationTimer; }

  // Daily counter
  getExplorationCountToday(): number { return this._explorationCountToday; }
  setExplorationCountToday(v: number): void { this._explorationCountToday = v; }
  incrementExplorationCountToday(): number { return ++this._explorationCountToday; }

  // Day key
  getExplorationDayKey(): string { return this._explorationDayKey; }
  setExplorationDayKey(v: string): void { this._explorationDayKey = v; }

  // ── 线程安全操作（同步单线程下为逻辑原子性）──

  /** 原子添加 discovery + 自动淘汰最低质量 */
  addDiscovery(d: Discovery): void {
    this.discoveries.push(d);
    if (this.discoveries.length > MAX_DISCOVERIES) {
      // 淘汰最低质量
      let minIdx = 0;
      let minScore = Infinity;
      for (let i = 0; i < this.discoveries.length; i++) {
        const disc = this.discoveries[i];
        const s = disc.quality * 0.5 + (disc.verified ? 0.3 : 0) + (Date.now() - disc.timestamp < 7 * 86400000 ? 0.2 : 0);
        if (s < minScore) { minScore = s; minIdx = i; }
      }
      this.discoveries.splice(minIdx, 1);
    }
  }

  /** 更新兴趣模型（原子替换） */
  updateInterests(interests: InterestModel['interests']): void {
    this.interestModel.interests.length = 0;
    for (const i of interests) this.interestModel.interests.push(i);
  }

  /** Reset all state (useful for testing) */
  reset(): void {
    this.discoveries.length = 0;
    this.interestModel.interests.length = 0;
    this.interestModel.lastExploration = 0;
    this.interestModel.lastDecayDay = '';
    this.stopExplorationTimer();
    this._explorationCountToday = 0;
    this._explorationDayKey = '';
  }

  private stopExplorationTimer(): void {
    if (this._explorationTimer) {
      clearInterval(this._explorationTimer);
      this._explorationTimer = null;
    }
  }
}

// 全局单例 — 向后兼容旧代码
const _instance = new CuriosityState();

// 兼容旧 API 的导出
export const discoveries = _instance.discoveries;
export const interestModel = _instance.interestModel;

export function getExplorationDailyCap(): number { return _instance.getExplorationDailyCap(); }
export function setExplorationTimer(timer: ReturnType<typeof setInterval> | null): void { _instance.setExplorationTimer(timer); }
export function getExplorationTimer(): ReturnType<typeof setInterval> | null { return _instance.getExplorationTimer(); }
export function getExplorationCountToday(): number { return _instance.getExplorationCountToday(); }
export function setExplorationCountToday(v: number): void { _instance.setExplorationCountToday(v); }
export function incrementExplorationCountToday(): number { return _instance.incrementExplorationCountToday(); }
export function getExplorationDayKey(): string { return _instance.getExplorationDayKey(); }
export function setExplorationDayKey(v: string): void { _instance.setExplorationDayKey(v); }
