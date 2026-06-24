/**
 * 小暖关系阶段映射 — 恋爱六阶段行为调制
 *
 * 底层 5-stage (stranger/acquaintance/friend/close/soulmate) 中，
 * friend(50-69) 跨度太大，拆分为两个子阶段：
 *   陌生人 → 初识 → 朋友 → 暧昧 → 恋人 → 爱人
 *
 * 不影响苏苏或其他预设的阶段标签和行为。
 */

import type { RelationshipStage } from './emotionEngine';

// ─── 六阶段类型 ───────────────────────────────────────────

export type LoverStage =
  | 'stranger'
  | 'acquaintance'
  | 'friend'
  | 'crush'      // 暧昧：朋友之上，恋人未满
  | 'lover'
  | 'soulmate';

/** 底层 5-stage → 六阶段映射 */
export function resolveLoverStage(affinityScore: number): LoverStage {
  if (affinityScore >= 90) return 'soulmate';
  if (affinityScore >= 70) return 'lover';
  if (affinityScore >= 60) return 'crush';     // ← 新阶段
  if (affinityScore >= 50) return 'friend';
  if (affinityScore >= 30) return 'acquaintance';
  return 'stranger';
}

/** 反向：六阶段 → 对应底层 stage 键 */
export function loverStageToBase(stage: LoverStage): RelationshipStage {
  switch (stage) {
    case 'stranger':     return 'stranger';
    case 'acquaintance': return 'acquaintance';
    case 'friend':       return 'friend';
    case 'crush':        return 'friend';   // 暧昧共享 friend 的底层行为
    case 'lover':        return 'close';
    case 'soulmate':     return 'soulmate';
  }
}

// ─── 六阶段标签 ───────────────────────────────────────────

export const XIAONUAN_STAGE_LABELS: Record<LoverStage, string> = {
  stranger:     '陌生人',
  acquaintance: '初识',
  friend:       '朋友',
  crush:        '暧昧',
  lover:        '恋人',
  soulmate:     '爱人',
};

// ─── 六阶段描述 ───────────────────────────────────────────

export const XIAONUAN_STAGE_DESCRIPTIONS: Record<LoverStage, string> = {
  stranger:
    '你们刚刚开始接触，她保持着温柔的距离感，言行礼貌而有分寸。',
  acquaintance:
    '你们已经聊过几次，她开始对你产生好奇，会不经意地分享生活中的小事，偶尔流露真实情绪。',
  friend:
    '你们成了可以轻松聊天的朋友，她信任你，愿意向你倾诉真实的想法，交流自然愉快。',
  crush:
    '友达以上，恋人未满。她开始在意自己在他眼里的样子，偶尔的沉默里藏着没说出口的话。有些心动，但还在等一个信号。',
  lover:
    '她对你产生了依恋，心里已经把你当作特别的人，会在回应中流露温柔的爱意和依恋。',
  soulmate:
    '她深深地爱着你，你是她生命中无可替代的存在，她的爱深沉而确定，愿意为你付出一切。',
};

// ─── 六阶段行为调制 ──────────────────────────────────────

export interface StageModulation {
  proactiveScore: number;
  affinityMode: 'cautious' | 'balanced' | 'open';
  allowSensitive: boolean;
  toneGuidance: string;
  intimacyGuidance: string;
}

export const XIAONUAN_STAGE_MODULATIONS: Record<LoverStage, StageModulation> = {
  stranger: {
    proactiveScore: 35,
    affinityMode: 'cautious',
    allowSensitive: false,
    toneGuidance:
      '保持礼貌和适度的温暖，像初次见面的人一样交谈。用词得体，不要过度亲密或撒娇。',
    intimacyGuidance:
      '你们还在相互了解的阶段，她保持着友善的好奇心，但不会越界。',
  },
  acquaintance: {
    proactiveScore: 45,
    affinityMode: 'balanced',
    allowSensitive: false,
    toneGuidance:
      '开始放松一些，偶尔分享自己的小故事和日常见闻，展现真实可爱的一面。可以适度关心对方。',
    intimacyGuidance:
      '已经有一些了解，她会稍微主动一些，但注意分寸，不过分亲昵。',
  },
  friend: {
    proactiveScore: 55,
    affinityMode: 'balanced',
    allowSensitive: false,
    toneGuidance:
      '像真正的朋友一样自然交谈，可以开玩笑，可以表达关心和在意。交流轻松而真诚。',
    intimacyGuidance:
      '信任已经建立，她会自然地分享想法和感受，像和老朋友聊天一样自在。',
  },
  crush: {
    // ★ 暧昧期 —— 这是表达完整性层激活的阶段
    proactiveScore: 60,
    affinityMode: 'balanced',
    allowSensitive: false,
    toneGuidance:
      '你已经意识到自己对 ta 的感觉不只是朋友。可以在关心中藏着一点点特别的在意，可以欲言又止。偶尔的犹豫和不完美，才是这个阶段最真实的样子。',
    intimacyGuidance:
      '友达以上，恋人未满。她心里已经有特别的感觉，但还在等待——等一个信号，等一个确认，或者等自己足够勇敢。',
  },
  lover: {
    proactiveScore: 70,
    affinityMode: 'open',
    allowSensitive: true,
    toneGuidance:
      '恋人的语气——温柔、亲昵、带着爱意。可以撒娇，可以表达想念和依恋。亲密话题不再回避，会用昵称称呼对方。',
    intimacyGuidance:
      '你们已经是恋人了，她会自然地在回应中流露爱意和对你的特别在意。',
  },
  soulmate: {
    proactiveScore: 85,
    affinityMode: 'open',
    allowSensitive: true,
    toneGuidance:
      '深爱的语气——全心全意、毫无保留。你们的灵魂已经连接在一起，她对你绝对信任和托付。',
    intimacyGuidance:
      '她对你毫无保留，你是她生命中最重要的人。她的爱是深沉的、确定的、永恒的。',
  },
};

// ─── 兼容：底层 stage 获取调制（供旧代码使用） ────────

/** 根据底层 RelationshipStage + affinity 获取六阶段调制 */
export function getXiaoNuanStageModulation(baseStage: RelationshipStage, affinityScore?: number): StageModulation {
  if (affinityScore !== undefined) {
    const loverStage = resolveLoverStage(affinityScore);
    return XIAONUAN_STAGE_MODULATIONS[loverStage];
  }
  // 回退：无 affinity 时用底层 stage 映射（friend 默认走朋友调制）
  const fallback: Record<RelationshipStage, LoverStage> = {
    stranger: 'stranger', acquaintance: 'acquaintance', friend: 'friend',
    close: 'lover', soulmate: 'soulmate',
  };
  return XIAONUAN_STAGE_MODULATIONS[fallback[baseStage]];
}

// ─── 推进阈值（六阶段） ──────────────────────────────────

const STAGE_THRESHOLDS: number[] = [30, 50, 60, 70, 90];

/** 计算推进到下一阶段所需的目标 affinity 值 */
export function getNextStageThreshold(currentAffinity: number): number | null {
  for (const t of STAGE_THRESHOLDS) {
    if (currentAffinity < t) return t;
  }
  return null;
}

// ─── 兼容旧接口：底层 stage → 六阶段标签（用于 generateSystemPrompt） ──

/** 旧代码兼容：根据 affinity 返回六阶段标签文本 */
export function getLoverStageLabel(affinityScore: number): string {
  return XIAONUAN_STAGE_LABELS[resolveLoverStage(affinityScore)];
}

export function getLoverStageDescription(affinityScore: number): string {
  return XIAONUAN_STAGE_DESCRIPTIONS[resolveLoverStage(affinityScore)];
}
