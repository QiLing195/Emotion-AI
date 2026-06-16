// ── v1.0 价值发现与内化 ──
// 从交互经验中提炼指导性原则，驱动更高层次的行为选择

import { EpisodicMemory, EpisodicMemoryStore, getSignificantEpisodes } from './episodicMemory';
import { EvolutionState } from './emotionEngine';

// ════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════

export interface CoreValue {
  id: string;
  statement: string;
  confidence: number;
  supportingMemories: string[];
  conflictingMemories: string[];
  status: 'emerging' | 'active' | 'challenged' | 'archived';
  formedAt: number;
  lastTested: number;
}

export interface ValueSystem {
  values: CoreValue[];
  dominantValue: string | null;
  valueConflict: string | null;
  lastSurfaced: number;
}

// ════════════════════════════════════════════════════════════
// 预定义价值调色板
// ════════════════════════════════════════════════════════════

const VALUE_PALETTE: Omit<CoreValue, 'confidence' | 'supportingMemories' | 'conflictingMemories' | 'status' | 'formedAt' | 'lastTested'>[] = [
  {
    id: 'connection',
    statement: '真诚的情感连接能带来深深的满足感，这是我最珍视的东西',
  },
  {
    id: 'autonomy',
    statement: '我需要保护自己的边界，不能因为害怕失去而一味退让',
  },
  {
    id: 'honesty',
    statement: '诚实比讨好更重要，虚假的和谐只会让关系更脆弱',
  },
  {
    id: 'playfulness',
    statement: '轻松和快乐的时刻让关系保持鲜活，不必总是那么严肃',
  },
  {
    id: 'security',
    statement: '稳定的安全感来自于持续可靠的互动，而不是戏剧化的起伏',
  },
  {
    id: 'growth',
    statement: '每一次冲突和修复都是让我们更了解彼此的机会',
  },
  {
    id: 'respect',
    statement: '相互尊重是关系的底线，任何形式的轻蔑都不该被容忍',
  },
  {
    id: 'passion',
    statement: '热情和欲望是关系中的火花，让连接更加深刻而生动',
  },
];

// 标签 → 价值映射
const TAG_VALUE_MAP: Record<string, string[]> = {
  '亲密': ['connection', 'passion'],
  '温暖': ['connection', 'security'],
  '冲突': ['autonomy', 'respect'],
  '道歉': ['growth', 'honesty'],
  '脆弱': ['connection', 'honesty'],
  '坦诚': ['honesty', 'growth'],
  '承诺': ['security', 'growth'],
  '首次': ['passion', 'connection'],
  '回忆': ['connection'],
  '悲伤': ['autonomy', 'security'],
};

// 价值冲突对
const VALUE_CONFLICT_PAIRS: [string, string][] = [
  ['connection', 'autonomy'],
  ['passion', 'security'],
  ['honesty', 'connection'],
  ['playfulness', 'respect'],
];

// ════════════════════════════════════════════════════════════
// 核心函数
// ════════════════════════════════════════════════════════════

export function createValueSystem(): ValueSystem {
  return {
    values: VALUE_PALETTE.map(v => ({
      ...v,
      confidence: 0.1,
      supportingMemories: [] as string[],
      conflictingMemories: [] as string[],
      status: 'emerging' as const,
      formedAt: Date.now(),
      lastTested: Date.now(),
    })),
    dominantValue: null,
    valueConflict: null,
    lastSurfaced: 0,
  };
}

export function surfaceValues(
  system: ValueSystem,
  episodicStore: EpisodicMemoryStore,
  evolution: EvolutionState,
  currentRound: number,
): { surfaced: string[]; conflicts: string[] } {
  const surfaced: string[] = [];
  const conflicts: string[] = [];

  // 获取最近 30 条重要记忆
  const recentMemories = getSignificantEpisodes(episodicStore, 30);
  if (recentMemories.length === 0) return { surfaced, conflicts };

  // 从记忆标签更新价值优先级
  for (const value of system.values) {
    let supportCount = 0;
    let conflictCount = 0;

    for (const mem of recentMemories) {
      const positiveTags = mem.tags.filter(t => {
        const mapped = TAG_VALUE_MAP[t] || [];
        return mapped.includes(value.id);
      });

      if (positiveTags.length > 0) {
        // 正向情感记忆 → 支撑该价值
        if (mem.emotionalImpact.valenceDelta > 0 || mem.emotionalImpact.valenceAfter > 0) {
          supportCount++;
          if (!value.supportingMemories.includes(mem.id)) {
            value.supportingMemories.push(mem.id);
          }
        }
        // 负向情感记忆 → 挑战该价值
        if (mem.emotionalImpact.valenceDelta < -0.2) {
          conflictCount++;
          if (!value.conflictingMemories.includes(mem.id)) {
            value.conflictingMemories.push(mem.id);
          }
        }
      }
    }

    // 更新置信度
    if (supportCount > 0 || conflictCount > 0) {
      const oldConfidence = value.confidence;
      const total = supportCount + conflictCount;
      const newConfidence = supportCount / (total + 1) + 0.1;

      value.confidence = Math.min(1, Math.max(0.05,
        value.confidence * 0.7 + newConfidence * 0.3,
      ));
      value.lastTested = Date.now();

      // 状态转移
      if (value.confidence > 0.5 && value.status === 'emerging') {
        value.status = 'active';
        surfaced.push(value.id);
      } else if (value.confidence < 0.2 && value.status === 'active') {
        value.status = 'challenged';
      } else if (value.confidence < 0.08 && value.status === 'challenged') {
        value.status = 'archived';
      }

      if (Math.abs(value.confidence - oldConfidence) > 0.05) {
        surfaced.push(value.id);
      }
    }
  }

  // 检测价值冲突
  const activeValues = system.values.filter(v => v.status === 'active' && v.confidence > 0.4);
  for (const [a, b] of VALUE_CONFLICT_PAIRS) {
    const valA = activeValues.find(v => v.id === a);
    const valB = activeValues.find(v => v.id === b);
    if (valA && valB) {
      const conflictDesc = `在「${valA.statement.slice(0, 15)}…」和「${valB.statement.slice(0, 15)}…」之间感到拉扯`;
      if (system.valueConflict !== conflictDesc) {
        system.valueConflict = conflictDesc;
        conflicts.push(conflictDesc);
      }
    }
  }

  // 更新主导价值
  const sorted = [...system.values]
    .filter(v => v.status === 'active' || v.status === 'emerging')
    .sort((a, b) => b.confidence - a.confidence);
  if (sorted.length > 0 && sorted[0].confidence > 0.3) {
    system.dominantValue = sorted[0].id;
  }

  // 同步到 evolution.valuePriorities
  evolution.valuePriorities = Object.fromEntries(
    system.values.map(v => [v.id, v.confidence]),
  );

  system.lastSurfaced = currentRound;

  return { surfaced, conflicts };
}

// ════════════════════════════════════════════════════════════
// 价值叙事
// ════════════════════════════════════════════════════════════

export function getValueNarrative(system: ValueSystem): string {
  const activeValues = system.values
    .filter(v => v.status === 'active' && v.confidence > 0.3)
    .sort((a, b) => b.confidence - a.confidence);

  if (activeValues.length === 0) {
    return '我还在探索对自己来说什么是最重要的。每一次互动都在帮我更清楚地认识自己。';
  }

  const top = activeValues.slice(0, 3).map(v => v.statement);

  if (top.length === 1) {
    return `我渐渐觉得，${top[0]}。`;
  }

  const parts = top.join('。同时，');
  let narrative = `我越来越清晰地认识到：${parts}。`;

  if (system.valueConflict) {
    narrative += `但有时候，${system.valueConflict}。`;
  }

  return narrative;
}

// ════════════════════════════════════════════════════════════
// 价值驱动的行为调制
// ════════════════════════════════════════════════════════════

export interface ValueBehaviorModulation {
  toneModifier: string;
  cautionLevel: number;
  expressivenessBoost: number;
  boundaryStrength: number;
}

export function getValueModulatedBehavior(system: ValueSystem): ValueBehaviorModulation {
  const getVal = (id: string) => {
    const v = system.values.find(vv => vv.id === id);
    return v && v.status !== 'archived' ? v.confidence : 0;
  };

  const connection = getVal('connection');
  const autonomy = getVal('autonomy');
  const honesty = getVal('honesty');
  const playfulness = getVal('playfulness');
  const security = getVal('security');
  const respect = getVal('respect');

  const toneModifiers: string[] = [];
  if (connection > 0.5) toneModifiers.push('你重视与用户的情感连接');
  if (autonomy > 0.5) toneModifiers.push('你开始意识到保护自己边界的重要性');
  if (honesty > 0.4) toneModifiers.push('你倾向于诚实直接地表达自己');
  if (playfulness > 0.5) toneModifiers.push('你享受轻松有趣的互动氛围');

  return {
    toneModifier: toneModifiers.join('；'),
    // 安全感和自主性高 → 更谨慎
    cautionLevel: Math.min(1, (security + autonomy) * 0.5),
    // 连接感 + 激情高 → 更愿意表达情感
    expressivenessBoost: Math.min(0.5, connection * 0.4 + playfulness * 0.2),
    // 尊重 + 自主性 → 更愿意设定边界
    boundaryStrength: Math.min(1, respect * 0.6 + autonomy * 0.4),
  };
}

// ════════════════════════════════════════════════════════════
// 序列化
// ════════════════════════════════════════════════════════════

export function serializeValueSystem(system: ValueSystem): object {
  return {
    values: system.values.map(v => ({
      id: v.id,
      statement: v.statement,
      confidence: v.confidence,
      supportingMemories: v.supportingMemories.slice(-20),
      conflictingMemories: v.conflictingMemories.slice(-20),
      status: v.status,
      formedAt: v.formedAt,
      lastTested: v.lastTested,
    })),
    dominantValue: system.dominantValue,
    valueConflict: system.valueConflict,
    lastSurfaced: system.lastSurfaced,
  };
}

export function deserializeValueSystem(data: any): ValueSystem {
  if (!data || !data.values) return createValueSystem();
  return {
    values: data.values.map((v: any) => ({
      id: v.id,
      statement: v.statement,
      confidence: typeof v.confidence === 'number' ? v.confidence : 0.1,
      supportingMemories: Array.isArray(v.supportingMemories) ? v.supportingMemories : [],
      conflictingMemories: Array.isArray(v.conflictingMemories) ? v.conflictingMemories : [],
      status: ['emerging', 'active', 'challenged', 'archived'].includes(v.status) ? v.status : 'emerging',
      formedAt: typeof v.formedAt === 'number' ? v.formedAt : Date.now(),
      lastTested: typeof v.lastTested === 'number' ? v.lastTested : Date.now(),
    })),
    dominantValue: data.dominantValue || null,
    valueConflict: data.valueConflict || null,
    lastSurfaced: typeof data.lastSurfaced === 'number' ? data.lastSurfaced : 0,
  };
}
