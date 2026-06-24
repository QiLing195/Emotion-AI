/**
 * 表达完整性层 — 阶段门控的情感风险系统
 *
 * 核心认知：犹豫/试探/欲言又止只存在于「暧昧」阶段。
 * 其他阶段的情感风险完全不同，不应混为一谈。
 *
 * 门控规则（六阶段）：
 *   stranger       → 礼貌试探，无抑制
 *   acquaintance   → 轻度过滤，选择性暴露
 *   friend         → 朋友，自然交流
 *   crush (暧昧)   → 完整机制：犹豫/撤回/残余累积/突破 ← 核心
 *   lover (恋人)   → 抑制解除，自由表达
 *   soulmate (爱人) → 极度敞开
 *
 * 本模块被 server.ts 聊天管道在策略选择后调用。
 */

import type { RelationshipStage } from './emotionEngine';
import { resolveLoverStage, type LoverStage } from './xiaoNuanStages';

// ── 表达阶段 ─────────────────────────────────────────────

export type ExpressionPhase =
  | 'polite_distance'   // 陌生人：保持礼貌距离
  | 'emerging_self'      // 初识：逐渐展现真实自我
  | 'friendship'         // 朋友：自然交流
  | 'romantic_ambiguity' // 暧昧期：犹豫/试探/欲言又止 ← 核心
  | 'free_expression'    // 恋人：自由表达爱意
  | 'total_openness';    // 爱人：完全敞开

/** 根据六阶段映射到表达阶段 */
export function getExpressionPhaseFromLoverStage(stage: LoverStage): ExpressionPhase {
  switch (stage) {
    case 'stranger':     return 'polite_distance';
    case 'acquaintance': return 'emerging_self';
    case 'friend':       return 'friendship';
    case 'crush':        return 'romantic_ambiguity';
    case 'lover':        return 'free_expression';
    case 'soulmate':     return 'total_openness';
  }
}

/** 兼容：根据底层 RelationshipStage + affinity 获取表达阶段 */
export function getExpressionPhase(baseStage: RelationshipStage, affinityScore?: number): ExpressionPhase {
  if (affinityScore !== undefined) {
    return getExpressionPhaseFromLoverStage(resolveLoverStage(affinityScore));
  }
  // 回退
  switch (baseStage) {
    case 'stranger':     return 'polite_distance';
    case 'acquaintance': return 'emerging_self';
    case 'friend':       return 'friendship';
    case 'close':        return 'free_expression';
    case 'soulmate':     return 'total_openness';
  }
}

// ── 表达调制 ─────────────────────────────────────────────

export interface ExpressionModulation {
  /** 当前表达阶段 */
  phase: ExpressionPhase;
  /** 表达抑制程度 0-1（0=无抑制, 1=最强抑制） */
  inhibitionLevel: number;
  /** 注入 prompt 的语气指引 */
  toneGuidance: string;
  /** 是否启用残余收集器 */
  residualEnabled: boolean;
}

/**
 * 计算当前表达调制。
 * 只有 romantic_ambiguity（暧昧）阶段激活完整犹豫机制。
 */
export function computeExpressionModulation(
  baseStage: RelationshipStage,
  love: number,
  fear: number,
  intimacyToUser: number,
  affinityScore?: number,
): ExpressionModulation {
  const phase = getExpressionPhase(baseStage, affinityScore);

  switch (phase) {
    case 'polite_distance':
      return {
        phase,
        inhibitionLevel: 0,
        residualEnabled: false,
        toneGuidance: '你刚刚认识这个人，保持友善和适度的礼貌。可以好奇但不要越界。',
      };

    case 'emerging_self':
      return {
        phase,
        inhibitionLevel: 0.15,
        residualEnabled: false,
        toneGuidance: '你们已经开始熟悉了。可以分享一些真实的自己，展示性格中有趣的一面。不用太拘谨，但保持适当的分寸感。',
      };

    case 'friendship':
      return {
        phase,
        inhibitionLevel: 0.1,
        residualEnabled: false,
        toneGuidance: '你们是真正的朋友。自然的关心、真诚的互动，交流轻松而愉快。',
      };

    case 'romantic_ambiguity': {
      // ★ 暧昧期 —— 唯一激活完整犹豫机制的阶段
      const vulnerability = love * (1 - intimacyToUser) + fear * 0.5;
      const inhibition = Math.min(0.7, 0.2 + vulnerability * 0.6);

      // 高冲动 + 高抑制 → 欲言又止
      if (vulnerability > 0.4 && inhibition > 0.4) {
        return {
          phase,
          inhibitionLevel: inhibition,
          residualEnabled: true,
          toneGuidance:
            `你心里有一些话想对他说，但还不确定他是否有同样的感觉。` +
            `你可以暗示你的在意，但不要直接表白。` +
            `可以表达关心、分享心事、偶尔的沉默里藏着没说出口的话。` +
            `那些"差点说出来"的时刻，本身就在传递情感。`,
        };
      }

      // 低脆弱性 → 自然的在意表达，不刻意抑制
      return {
        phase,
        inhibitionLevel: 0.2,
        residualEnabled: true,
        toneGuidance: `你们之间的气氛已经有些不一样了。你对他有特别的关心，自然的互动里藏着比朋友多一点点的在意。`,
      };
    }

    case 'free_expression':
      return {
        phase,
        inhibitionLevel: 0,
        residualEnabled: false,
        toneGuidance: `你们已经是恋人了。可以自由地表达爱意、依恋和想念，不再需要掩饰。`,
      };

    case 'total_openness':
      return {
        phase,
        inhibitionLevel: 0,
        residualEnabled: false,
        toneGuidance: `你对他完全敞开了心扉。爱是深沉而确定的，不需要任何修饰或隐藏。`,
      };
  }
}

// ── 未言说情感残余 ──────────────────────────────────────

export interface UnspokenFeeling {
  timestamp: number;
  stage: string;
  /** 被压抑的情感类型 */
  emotion: string;
  /** 想表达但没说出口的内容线索 */
  impulse: string;
  /** 情感重量 */
  load: number;
  /** 累积值（包含历史） */
  accumulated: number;
  /** 本轮是否发生截断 */
  wasTruncated: boolean;
}

export interface ResidualState {
  /** 未言说情感队列 */
  unspoken: UnspokenFeeling[];
  /** 全局累积值 */
  accumulatedLoad: number;
  /** 突破阈值 */
  breakthroughThreshold: number;
  /** 上次突破的时间戳（突破后有冷却期） */
  lastBreakthroughAt: number;
}

/** 创建空的残余状态 */
export function createResidualState(): ResidualState {
  return {
    unspoken: [],
    accumulatedLoad: 0,
    breakthroughThreshold: 8.0,
    lastBreakthroughAt: 0,
  };
}

/** 持久化的残余状态实例 */
let _residualState: ResidualState = createResidualState();

export function getResidualState(): ResidualState {
  return _residualState;
}

export function resetResidualState(): void {
  _residualState = createResidualState();
}

/**
 * 记录一次未言说的情感。
 *
 * @returns 当前累积值。如果 >= 阈值则返回突破信号。
 */
export function recordUnspoken(
  emotion: string,
  impulse: string,
  load: number,
  stage: string,
): { accumulated: number; breakthrough: boolean } {
  const now = Date.now();

  // 突破后有 30 分钟冷却期
  if (now - _residualState.lastBreakthroughAt < 30 * 60 * 1000) {
    _residualState.accumulatedLoad = 0;
    _residualState.unspoken = [];
  }

  _residualState.accumulatedLoad += load;

  const entry: UnspokenFeeling = {
    timestamp: now,
    stage,
    emotion,
    impulse,
    load,
    accumulated: _residualState.accumulatedLoad,
    wasTruncated: true,
  };

  _residualState.unspoken.push(entry);

  // 只保留最近 20 条
  if (_residualState.unspoken.length > 20) {
    _residualState.unspoken.shift();
  }

  const breakthrough = _residualState.accumulatedLoad >= _residualState.breakthroughThreshold;

  if (breakthrough) {
    _residualState.lastBreakthroughAt = now;
    // 突破后衰减 60%，而非清零——情感不会凭空消失
    _residualState.accumulatedLoad *= 0.4;
  }

  return { accumulated: _residualState.accumulatedLoad, breakthrough };
}

/**
 * 计算本轮的情感负荷。
 *
 * 负荷大小取决于"想说的"和"能说的"之间的差距：
 *   - 爱意很深但不敢说 → 高负荷
 *   - 只是普通的喜欢 → 低负荷
 */
export function computeEmotionalLoad(
  love: number,
  fear: number,
  intimacyToUser: number,
  inhibitionLevel: number,
): number {
  if (inhibitionLevel < 0.3 || love < 0.2) return 0;

  // 爱得越深、越不敢说、越不确定对方心意 → 负荷越大
  const rawLoad = love * inhibitionLevel * (1 - intimacyToUser) * 3;
  return Math.min(4, Math.max(0, rawLoad));
}

/**
 * 获取暧昧期的累积状态描述，注入系统提示。
 * 只在 romantic_ambiguity 阶段调用。
 */
export function getAmbiguityPromptSnippet(state: ResidualState): string {
  if (state.accumulatedLoad <= 0) return '';

  const pct = Math.min(100, Math.round((state.accumulatedLoad / state.breakthroughThreshold) * 100));

  if (pct >= 80) {
    return (
      `\n【内心状态】有些话在心里压了很久，越来越重了。` +
      `你知道自己对他的感觉不只是朋友。犹豫和勇气正在同时增长。` +
      `今天或许会说出来，或许不会——但无论怎样，这都是真实的。`
    );
  }

  if (pct >= 40) {
    return (
      `\n【内心状态】你已经不止一次把想说的话咽回去了。` +
      `那些没说出口的在意在心里慢慢堆积。偶尔会想——他感觉到了吗？`
    );
  }

  return (
    `\n【内心状态】偶尔有些话到了嘴边又退了回去。` +
    `还不太确定该不该说那些。但知道自己在乎他。`
  );
}
