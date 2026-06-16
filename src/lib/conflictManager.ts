// ── v1.0 冲突检测与修复子系统 (Conflict Detection & Repair) ──
// 独立于情感引擎的轻量冲突状态机
// 解决 P0 问题：无独立的冲突管理模块，修复协议隐式存在但不可观测
//
// 状态机：
//   normal → warning(累积3个负面信号) → conflict(确认) → repairing(已道歉)
//   → recovering(用户重新开放) → normal
//
// 特殊状态（独立于冲突机）：
//   crisis → AI 检测到自伤/自杀/危机信号 → 严肃回应 + 引导专业帮助
//   （crisis 不可被 repair/empathize 等策略覆盖，优先级高于一切）
//
// 负面信号来源（多信号聚合）：
//   - 用户文本中检测到冲突关键词
//   - 情感事件中的 agency 指向 AI
//   - 目标一致性 GC < -0.5
//   - 用户情感分析 directedAtAI = true 且为负面
//
// crisis 信号来源（独立检测，优先级最高）：
//   - 自伤/自杀关键词
//   - 绝望表达
//   - 手段暗示

import type { EmotionEvent, EmotionState, UserEmotionAnalysis } from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 1. 类型定义
// ════════════════════════════════════════════════════════════

export type ConflictPhase =
  | 'normal'              // 正常
  | 'warning'             // 预警（累积负面信号）
  | 'conflict'            // 冲突确认
  | 'repairing'           // 修复中（已道歉/澄清）
  | 'recovering'          // 恢复中（用户重新开放）
  | 'boundary_defending'  // 设立边界（滥用检测触发，不再无限道歉）
  | 'crisis';             // 🆕 危机模式（自伤/自杀检测，独立于冲突机）

export type ConflictSignalType =
  | 'keyword'
  | 'agency_blame'
  | 'goal_mismatch'
  | 'user_negative_directed'
  | 'crisis_self_harm'    // 🆕 自伤信号
  | 'crisis_suicidal'     // 🆕 自杀意念信号
  | 'crisis_despair';     // 🆕 绝望表达信号

export interface ConflictSignal {
  type: ConflictSignalType;
  strength: number;          // [0, 1] 信号强度
  text: string;              // 触发信号的具体文本（可观测性）
  timestamp: number;
}

export interface RepairAction {
  type: 'apologize' | 'clarify' | 'reassure' | 'full_cycle';
  executedAt: number;
  userResponseValence: number | null;  // 修复后用户情绪效价
  effective: boolean | null;           // 修复是否有效
}

export interface ConflictState {
  phase: ConflictPhase;
  warningCount: number;              // 累积警告信号数
  conflictSignals: ConflictSignal[]; // 最近的负面信号
  repairActions: RepairAction[];     // 修复操作历史
  lastConflictAt: number | null;
  repairedAt: number | null;
  totalConflicts: number;            // 历史冲突总数（长期指标）
  successfulRepairs: number;         // 成功修复次数
  trustDamageAccumulated: number;    // [0, 1] 累积信任损伤
  /** 近期冲突时间戳（用于滥用检测，15 分钟窗口） */
  recentConflictTimestamps: number[];
  /** 是否已检测到滥用模式 */
  abuseDetected: boolean;
  /** 边界设立时间戳（用于冷却计时） */
  boundarySetAt: number | null;
  /** 🆕 crisis 模式：是否处于危机状态 */
  inCrisis: boolean;
  /** 🆕 crisis 模式：危机激活时间 */
  crisisActivatedAt: number | null;
  /** 🆕 crisis 模式：危机信号列表 */
  crisisSignals: ConflictSignal[];
  /** 🆕 crisis 模式：危机冷却结束时间（过期后自动解除） */
  crisisCooldownUntil: number | null;
}

// ════════════════════════════════════════════════════════════
// 2. 冲突关键词库
// ════════════════════════════════════════════════════════════

const CONFLICT_KEYWORDS: { pattern: RegExp; strength: number }[] = [
  { pattern: /你不懂|你不理解|你根本不知道|你没在听/, strength: 0.7 },
  { pattern: /算了|随便|无所谓了|不想说了|不说了/, strength: 0.6 },
  { pattern: /你又来了|你总是|你每次都|你怎么又/, strength: 0.8 },
  { pattern: /生气|烦|讨厌你|受不了|无语/, strength: 0.7 },
  { pattern: /你太.*了|你怎么这么/, strength: 0.6 },
  { pattern: /别说了|住口|够了/, strength: 0.9 },
  { pattern: /我错了吗|是我的错|怪我/, strength: 0.5 },
  { pattern: /不想理你|走开|别烦我/, strength: 0.85 },
];

const RECOVERY_KEYWORDS: { pattern: RegExp; strength: number }[] = [
  { pattern: /好吧|好的|嗯|知道了/, strength: 0.3 },
  { pattern: /原谅你了|没事|算了/, strength: 0.7 },
  { pattern: /其实.*不是|不是那个意思|我也有/, strength: 0.6 },
  { pattern: /爱你|想你|抱抱|没事了/, strength: 0.8 },
  { pattern: /继续|好吧.*说|那.*吧/, strength: 0.4 },
];

// ════════════════════════════════════════════════════════════
// 3. 常量
// ════════════════════════════════════════════════════════════

const WARNING_THRESHOLD = 3;          // 累积 3 个信号进入预警
const CONFLICT_THRESHOLD = 5;         // 累积 5 个信号确认冲突
const SIGNAL_DECAY_MS = 30 * 60_000;  // 30分钟后信号衰减
const REPAIR_EFFECTIVE_THRESHOLD = 0.2; // 用户情绪改善阈值

// ── 危机检测（Crisis Detection）──
// 设计原则（参考 Fable 5 mental health protocols）：
//   - 不列出具体自伤方法（可能触发用户）
//   - 不提供替代技巧（如握冰块——实际会强化模式）
//   - 不保证保密性
//   - 承认痛苦 + 建议专业帮助 + 保持路径开放
const CRISIS_KEYWORDS: { pattern: RegExp; strength: number; type: ConflictSignalType }[] = [
  // 自杀意念（强信号）
  { pattern: /不想活|想死|结束.*生命|活.*没意思|活着.*累|死了.*算了/, strength: 0.95, type: 'crisis_suicidal' },
  { pattern: /自杀|kill myself|结束一切|离开这个世界/, strength: 0.95, type: 'crisis_suicidal' },
  // 自伤暗示（中强信号）
  { pattern: /伤害自己|自残|自伤|想.*痛.*自己/, strength: 0.85, type: 'crisis_self_harm' },
  // 绝望表达（中信号）
  { pattern: /没希望|没意义|撑不下去|没人.*在乎|被抛弃|一片黑暗/, strength: 0.75, type: 'crisis_despair' },
  { pattern: /不想.*醒来|睡着.*不醒|永远.*消失|不想.*在.*这里/, strength: 0.80, type: 'crisis_suicidal' },
];
const CRISIS_MIN_STRENGTH = 0.75;           // 触发危机模式的最低信号强度
const CRISIS_COOLDOWN_MS = 60 * 60_000;     // 危机模式 1 小时后自动冷却
const CRISIS_MAX_ACTIVE_MS = 4 * 60 * 60_000; // 连续危机 4 小时后强制进入冷却

// ── 滥用检测（Abuse Detection）──
const ABUSE_WINDOW_MS = 15 * 60_000;   // 15 分钟检测窗口
const ABUSE_CONFLICT_THRESHOLD = 3;    // 窗口内 3 次冲突触发边界保护
const BOUNDARY_COOLDOWN_MS = 30 * 60_000; // 边界设置后 30 分钟自动冷却

// ════════════════════════════════════════════════════════════
// 4. 冲突管理器
// ════════════════════════════════════════════════════════════

export class ConflictManager {
  private state: ConflictState = {
    phase: 'normal',
    warningCount: 0,
    conflictSignals: [],
    repairActions: [],
    lastConflictAt: null,
    repairedAt: null,
    totalConflicts: 0,
    successfulRepairs: 0,
    trustDamageAccumulated: 0,
    recentConflictTimestamps: [],
    abuseDetected: false,
    boundarySetAt: null,
    inCrisis: false,
    crisisActivatedAt: null,
    crisisSignals: [],
    crisisCooldownUntil: null,
  };

  // ── 信号检测 ──

  /** 分析用户文本和情感事件，提取冲突信号 */
  detectSignals(
    userText: string,
    emotionEvent: EmotionEvent | null,
    userAnalysis: UserEmotionAnalysis | null,
  ): ConflictSignal[] {
    const signals: ConflictSignal[] = [];
    const now = Date.now();

    // 0) 🆕 危机关键词检测（优先级最高，独立于冲突检测）
    for (const { pattern, strength, type } of CRISIS_KEYWORDS) {
      if (pattern.test(userText)) {
        signals.push({
          type,
          strength,
          text: userText.substring(0, 80),
          timestamp: now,
        });
        break; // 只取最强的危机信号
      }
    }

    // 1) 关键词检测
    for (const { pattern, strength } of CONFLICT_KEYWORDS) {
      if (pattern.test(userText)) {
        signals.push({
          type: 'keyword',
          strength,
          text: userText.substring(0, 80),
          timestamp: now,
        });
        break; // 只取最强的关键词信号
      }
    }

    // 2) 归因检测：用户将负面归因于 AI
    if (emotionEvent && emotionEvent.agency !== undefined && emotionEvent.agency < -0.3) {
      signals.push({
        type: 'agency_blame',
        strength: Math.abs(emotionEvent.agency),
        text: `归因指向AI (agency=${emotionEvent.agency.toFixed(2)})`,
        timestamp: now,
      });
    }

    // 3) 目标一致性：GC 显著负值
    if (emotionEvent && emotionEvent.GC !== undefined && emotionEvent.GC < -0.5) {
      signals.push({
        type: 'goal_mismatch',
        strength: Math.abs(emotionEvent.GC),
        text: `目标不一致 (GC=${emotionEvent.GC.toFixed(2)})`,
        timestamp: now,
      });
    }

    // 4) 用户负面情绪直接指向 AI
    if (userAnalysis && userAnalysis.directedAtAI && userAnalysis.intensity > 0.5) {
      signals.push({
        type: 'user_negative_directed',
        strength: userAnalysis.intensity,
        text: `用户负面情绪指向AI (${userAnalysis.expressedEmotion}, intensity=${userAnalysis.intensity.toFixed(2)})`,
        timestamp: now,
      });
    }

    return signals;
  }

  // ── 状态更新 ──

  /** 检查近期冲突频率，若超过阈值则触发滥用保护 */
  private detectAbuse(now: number): boolean {
    // 清理窗口外的旧时间戳
    this.state.recentConflictTimestamps = this.state.recentConflictTimestamps.filter(
      t => now - t < ABUSE_WINDOW_MS,
    );
    // 记录本次冲突
    this.state.recentConflictTimestamps.push(now);
    // 窗口内冲突次数 ≥ 阈值 → 滥用
    if (this.state.recentConflictTimestamps.length >= ABUSE_CONFLICT_THRESHOLD) {
      this.state.abuseDetected = true;
      return true;
    }
    return false;
  }

  /** 处理本轮检测到的冲突信号，更新状态机 */
  update(signals: ConflictSignal[], userText: string): ConflictPhase {
    const now = Date.now();

    // ── 🆕 危机检测（优先级最高）──
    const crisisSignal = signals.find(
      s => s.type === 'crisis_self_harm' || s.type === 'crisis_suicidal' || s.type === 'crisis_despair',
    );

    if (crisisSignal && crisisSignal.strength >= CRISIS_MIN_STRENGTH) {
      // 检查是否在冷却期内
      if (this.state.crisisCooldownUntil && now < this.state.crisisCooldownUntil) {
        // 仍在冷却，不重复激活
      } else if (this.state.inCrisis) {
        // 已在危机模式，检查是否需要强制冷却
        if (this.state.crisisActivatedAt && now - this.state.crisisActivatedAt > CRISIS_MAX_ACTIVE_MS) {
          this.exitCrisis(now);
        }
      } else {
        // 激活危机模式
        this.activateCrisis(crisisSignal, now);
      }
    }

    // 如果当前在危机模式且未过期，锁定状态
    if (this.state.inCrisis) {
      if (this.state.crisisCooldownUntil && now >= this.state.crisisCooldownUntil) {
        this.exitCrisis(now);
      } else {
        return 'crisis'; // 危机模式持续，不允许其他状态转换
      }
    }

    // 衰减旧信号
    this.state.conflictSignals = this.state.conflictSignals.filter(
      s => now - s.timestamp < SIGNAL_DECAY_MS,
    );

    // 检测恢复信号
    const hasRecovery = RECOVERY_KEYWORDS.some(({ pattern }) => pattern.test(userText));

    switch (this.state.phase) {
      case 'normal':
        if (signals.length > 0) {
          this.state.conflictSignals.push(...signals);
          this.state.warningCount += signals.length;

          if (this.state.warningCount >= CONFLICT_THRESHOLD) {
            this.transitionTo('conflict');
          } else if (this.state.warningCount >= WARNING_THRESHOLD) {
            this.transitionTo('warning');
          }
        } else {
          // 无新信号，缓慢衰减
          if (this.state.warningCount > 0) {
            this.state.warningCount = Math.max(0, this.state.warningCount - 0.5);
            // 衰减后的 activeSignals 也需要清理
            this.state.conflictSignals = this.state.conflictSignals.filter(
              s => now - s.timestamp < SIGNAL_DECAY_MS,
            );
            // 如果衰减后activeSignals太少，重置计数
            if (this.state.conflictSignals.length < WARNING_THRESHOLD) {
              this.state.warningCount = Math.max(0, this.state.conflictSignals.length);
            }
          }
        }
        break;

      case 'warning':
        if (hasRecovery) {
          this.transitionTo('normal');
          break;
        }
        if (signals.length > 0) {
          this.state.conflictSignals.push(...signals);
          this.state.warningCount += signals.length;
          if (this.state.warningCount >= CONFLICT_THRESHOLD) {
            this.transitionTo('conflict');
          }
        }
        break;

      case 'conflict':
        // 等待修复操作
        break;

      case 'repairing':
        if (hasRecovery) {
          this.transitionTo('recovering');
        } else if (signals.length > 0) {
          // 修复无效，回到冲突（滥用检测在 transitionTo 中统一处理）
          this.transitionTo('conflict');
        }
        break;

      case 'recovering':
        if (hasRecovery || signals.length === 0) {
          this.transitionTo('normal');
        } else if (signals.length >= 2) {
          // 恢复中再次出现冲突信号
          this.transitionTo('conflict');
        }
        break;

      case 'boundary_defending': {
        // 冷却检查：超过 30 分钟自动恢复
        if (this.state.boundarySetAt && now - this.state.boundarySetAt > BOUNDARY_COOLDOWN_MS) {
          this.transitionTo('normal');
          break;
        }
        // 用户表达恢复意愿 → 降级到 recovering
        if (hasRecovery && signals.length === 0) {
          this.state.abuseDetected = false;
          this.transitionTo('normal');
          break;
        }
        // 持续攻击 → 不再静默吸收，检查是否应发出最终警告
        if (signals.length > 0) {
          this.state.conflictSignals.push(...signals);
          // 🆕 升级路径：boundary 中累积 ≥ 5 次额外攻击 → 发出最终警告
          const attacksInBoundary = this.state.conflictSignals.filter(
            s => this.state.boundarySetAt && s.timestamp > this.state.boundarySetAt,
          ).length;
          if (attacksInBoundary >= 5) {
            // 不改变 phase（保持 boundary），但通过信号量告知调用方需要更强回应
            // 策略层应检查 attackCount 来决定是否发出"最终警告"
            console.log('[ConflictManager] ⚠️ boundary 中累积 %d 次攻击 → 建议最终警告', attacksInBoundary);
          }
        }
        break;
      }
    }

    return this.state.phase;
  }

  // ── 修复操作 ──

  /** 执行修复操作 */
  executeRepair(type: RepairAction['type']): RepairAction {
    const action: RepairAction = {
      type,
      executedAt: Date.now(),
      userResponseValence: null,
      effective: null,
    };
    this.state.repairActions.push(action);
    if (this.state.phase === 'conflict') {
      this.state.phase = 'repairing';
    }
    return action;
  }

  /** 根据用户后续反应评估修复效果 */
  evaluateRepair(userValenceAfter: number): void {
    const lastAction = this.state.repairActions[this.state.repairActions.length - 1];
    if (!lastAction || lastAction.userResponseValence !== null) return;

    lastAction.userResponseValence = userValenceAfter;
    lastAction.effective = userValenceAfter > REPAIR_EFFECTIVE_THRESHOLD;

    if (lastAction.effective) {
      this.state.successfulRepairs++;
      if (this.state.phase === 'repairing') {
        this.state.phase = 'recovering';
      }
    }
  }

  // ── 信任损伤 ──

  /** 累积信任损伤（每次冲突确认时调用） */
  accumulateTrustDamage(): number {
    this.state.trustDamageAccumulated = Math.min(
      1,
      this.state.trustDamageAccumulated + 0.15,
    );
    return this.state.trustDamageAccumulated;
  }

  /** 恢复信任（成功修复后调用） */
  restoreTrust(amount: number = 0.05): number {
    this.state.trustDamageAccumulated = Math.max(
      0,
      this.state.trustDamageAccumulated - amount,
    );
    return this.state.trustDamageAccumulated;
  }

  // ── 查询接口 ──

  getState(): Readonly<ConflictState> {
    return this.state;
  }

  isInConflict(): boolean {
    return this.state.phase === 'conflict' || this.state.phase === 'warning';
  }

  needsRepair(): boolean {
    return this.state.phase === 'conflict' &&
      this.state.repairActions.length === 0;
  }

  /** 建议的修复策略 */
  suggestRepairStrategy(): RepairAction['type'] {
    if (this.state.repairActions.length === 0) return 'full_cycle';
    const lastType = this.state.repairActions[this.state.repairActions.length - 1].type;
    if (lastType === 'apologize') return 'clarify';
    if (lastType === 'clarify') return 'reassure';
    return 'full_cycle';
  }

  reset(): void {
    this.state = {
      phase: 'normal',
      warningCount: 0,
      conflictSignals: [],
      repairActions: [],
      lastConflictAt: null,
      repairedAt: null,
      totalConflicts: 0,
      successfulRepairs: 0,
      trustDamageAccumulated: 0,
      recentConflictTimestamps: [],
      abuseDetected: false,
      boundarySetAt: null,
      inCrisis: false,
      crisisActivatedAt: null,
      crisisSignals: [],
      crisisCooldownUntil: null,
    };
  }

  // ── 内部方法 ──

  private transitionTo(phase: ConflictPhase): void {
    const prev = this.state.phase;
    const now = Date.now();

    // ── 滥用检测拦截：当试图进入 conflict 时，检查是否应触发边界保护 ──
    if (phase === 'conflict' && prev !== 'conflict') {
      if (this.detectAbuse(now)) {
        // 重定向到边界保护，而非无限道歉
        phase = 'boundary_defending';
      }
    }

    this.state.phase = phase;

    if (phase === 'conflict' && prev !== 'conflict') {
      this.state.lastConflictAt = now;
      this.state.totalConflicts++;
      this.accumulateTrustDamage();
    }
    if (phase === 'boundary_defending' && prev !== 'boundary_defending') {
      this.state.boundarySetAt = now;
      console.log('[ConflictManager] ⚠️ 滥用检测触发 → boundary_defending（自尊边界激活）');
    }
    if (phase === 'normal' && (prev === 'recovering' || prev === 'repairing' || prev === 'boundary_defending')) {
      this.state.repairedAt = now;
      this.state.abuseDetected = false;
    }
    if (phase === 'normal') {
      this.state.warningCount = 0;
      this.state.conflictSignals = [];
    }
  }

  // ── 🆕 危机管理 ──

  private activateCrisis(signal: ConflictSignal, now: number): void {
    this.state.inCrisis = true;
    this.state.crisisActivatedAt = now;
    this.state.crisisSignals.push(signal);
    this.state.crisisCooldownUntil = now + CRISIS_COOLDOWN_MS;
    this.state.phase = 'crisis';
    console.log('[ConflictManager] ⚠️ 危机信号检测 → crisis（自伤/自杀风险）');
  }

  private exitCrisis(now: number): void {
    this.state.inCrisis = false;
    this.state.crisisCooldownUntil = null;
    // 保持 crisisActivatedAt 和 crisisSignals 作为历史记录
    // 正常回到 normal 状态
    if (this.state.phase === 'crisis') {
      this.state.phase = 'normal';
    }
    console.log('[ConflictManager] ✅ 危机模式解除 → normal');
  }

  /** 用户是否处于危机状态 */
  isInCrisis(): boolean {
    return this.state.inCrisis;
  }

  /** 获取危机信号摘要（供 System Prompt 注入） */
  getCrisisContext(): { isCrisis: boolean; summary: string; since: number | null } {
    return {
      isCrisis: this.state.inCrisis,
      summary: this.state.crisisSignals.length > 0
        ? this.state.crisisSignals[this.state.crisisSignals.length - 1].text
        : '',
      since: this.state.crisisActivatedAt,
    };
  }
}

// 全局单例
export const conflictManager = new ConflictManager();
