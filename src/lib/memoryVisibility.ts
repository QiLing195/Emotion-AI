// ── v1.6 记忆可见性门控 (Memory Visibility) ──
// 补上记忆系统的第三道判定（借鉴 c-former GovLayer 的"角色层级 → 可见字段"范式）：
//   ① memoryGovernance：这条记忆**可不可信**（proposed/supported/verified）→ 能不能说
//   ② memoryEnhancer  ：这条记忆**还记不记得住**（遗忘曲线/合并）      → 还在不在
//   ③ 本模块          ：这条记忆**现在该不该说**（关系阶段门控）      → 现在能不能说
//
// 核心：关系阶段 = 可见层级。亲密承诺类记忆在陌生人/初识阶段必须"在检索阶段就被排除"，
// 而不是靠 Prompt 叮嘱模型"别说"（零泄漏原则）。
// 纯逻辑模块：无 io/React 依赖。

import type { RelationshipStageV2 } from './relationshipProgressionV2';

// ════════════════════════════════════════════════════════════
// 1. 阶段层级
// ════════════════════════════════════════════════════════════

/** 关系阶段由浅到深（与 relationshipProgressionV2 对齐） */
export const STAGE_ORDER: RelationshipStageV2[] = [
  'stranger', 'acquaintance', 'friend', 'crush', 'lover', 'partner',
];

/** 阶段在关系深度上的位次（未知阶段按 acquaintance 处理，保守但不至于全锁） */
export function stageRank(stage: RelationshipStageV2 | string | undefined | null): number {
  const idx = STAGE_ORDER.indexOf(stage as RelationshipStageV2);
  return idx >= 0 ? idx : 1; // 默认 acquaintance
}

// ════════════════════════════════════════════════════════════
// 2. 记忆敏感度分级
// ════════════════════════════════════════════════════════════

/**
 * 记忆敏感度：
 *  - public   日常/兴趣/公共信息        → 任何阶段可见
 *  - familiar 个人偏好/经历/回忆        → 朋友起
 *  - intimate 脆弱面/情绪低谷/深层暴露  → 暧昧起
 *  - secret   爱意承诺/关系里程碑/秘密  → 恋人起
 */
export type MemorySensitivity = 'public' | 'familiar' | 'intimate' | 'secret';

/** 各级敏感度所需的最低关系阶段（可见性门槛） */
export const SENSITIVITY_MIN_STAGE: Record<MemorySensitivity, RelationshipStageV2> = {
  public: 'stranger',
  familiar: 'friend',
  intimate: 'crush',
  secret: 'lover',
};

export const SENSITIVITY_ORDER: MemorySensitivity[] = ['public', 'familiar', 'intimate', 'secret'];

/** 敏感度对应的人读说明（日志/可观测性用） */
export const SENSITIVITY_LABELS: Record<MemorySensitivity, string> = {
  public: '公开信息',
  familiar: '个人经历',
  intimate: '脆弱私密',
  secret: '爱意承诺',
};

interface SensitivitySignal {
  pattern: RegExp;
  weight: number;
}

/** secret：爱意/承诺/关系里程碑 —— 阶段不够时绝不主动提 */
const SECRET_SIGNALS: SensitivitySignal[] = [
  { pattern: /结婚|求婚|嫁|娶|一辈子|永远|余生|白头/, weight: 3 },
  { pattern: /表白|告白|在一起|做我|男朋友|女朋友|恋人|同居/, weight: 3 },
  { pattern: /爱你|爱上你|很想你|离不开|不要离开|别走/, weight: 2 },
  { pattern: /分手|离婚|前任|失恋|心碎/, weight: 2 },
  { pattern: /承诺|发誓|保证一辈子|约定/, weight: 2 },
  { pattern: /秘密|从没告诉|第一次告诉/, weight: 2 },
];

/** intimate：情绪低谷 / 深层脆弱 / 重大个人事件 */
const INTIMATE_SIGNALS: SensitivitySignal[] = [
  { pattern: /崩溃|撑不住|绝望|想死|自杀|活不下去/, weight: 3 },
  { pattern: /失业|找不到工作|被辞|破产|欠债|生病|住院|确诊/, weight: 2 },
  { pattern: /难过|伤心|哭|泪|孤独|没人懂|没人理解|委屈|孤零零/, weight: 2 },
  { pattern: /焦虑|失眠|睡不着|压力|害怕|恐惧|不安|担心失去/, weight: 2 },
  { pattern: /家人|父母|亲人|去世|离世|走了/, weight: 1 },
  { pattern: /自卑|没用|失败者|讨厌自己/, weight: 2 },
];

/** familiar：个人偏好 / 日常经历 / 兴趣 */
const FAMILIAR_SIGNALS: SensitivitySignal[] = [
  { pattern: /喜欢|最爱|讨厌|习惯|爱好|兴趣|梦想|愿望/, weight: 1 },
  { pattern: /以前|小时候|曾经|记得|回忆|那会儿/, weight: 1 },
  { pattern: /朋友|同事|工作|上学|专业|宠物|猫|狗/, weight: 1 },
  { pattern: /游戏|电影|音乐|美食|旅行|摄影|读书|运动/, weight: 1 },
];

/** 标签 → 敏感度基线（复用 episodicMemory 的 SIGNIFICANT_PATTERNS 标签体系）
 *  注意：'亲密' 标签覆盖面很宽（连"喜欢/未来"都会触发），所以基线只给到 intimate，
 *  是否升到 secret 交由文本关键词（结婚/承诺/表白等）决定，避免"喜欢火锅"被判成爱意承诺。 */
const TAG_BASELINE: Record<string, MemorySensitivity> = {
  亲密: 'intimate',
  承诺: 'secret',
  首次: 'intimate',
  脆弱: 'intimate',
  悲伤: 'intimate',
  坦诚: 'intimate',
  冲突: 'familiar',
  道歉: 'familiar',
  回忆: 'familiar',
  温暖: 'familiar',
};

export interface SensitivityInput {
  /** 记忆文本（事件摘要 / 叙事 / 内容） */
  text?: string;
  /** 记忆标签（可选，来自 episodic tags） */
  tags?: string[];
  /** 情绪强度信号（可选）：|效价变化| */
  valenceDeltaAbs?: number;
  /** 唤醒峰值（可选） */
  arousalPeak?: number;
}

/**
 * 推断记忆敏感度：关键词打分 + 标签基线 + 情绪强度加成，取最高档。
 * 保守取向：拿不准时不轻易升级到 secret（避免正常日常被锁死），
 * 但命中 secret 关键词一律升级（越界代价 > 少提一句的代价）。
 */
export function inferSensitivity(input: SensitivityInput): MemorySensitivity {
  const text = input.text ?? '';
  const score: Record<MemorySensitivity, number> = { public: 0, familiar: 0, intimate: 0, secret: 0 };

  const addHits = (signals: SensitivitySignal[], level: MemorySensitivity): void => {
    for (const s of signals) {
      if (s.pattern.test(text)) score[level] += s.weight;
    }
  };
  addHits(SECRET_SIGNALS, 'secret');
  addHits(INTIMATE_SIGNALS, 'intimate');
  addHits(FAMILIAR_SIGNALS, 'familiar');

  for (const tag of input.tags ?? []) {
    const base = TAG_BASELINE[tag];
    if (base) score[base] += 2;
  }

  // 情绪强度加成：仅作轻度辅助（强烈情绪事件更可能值得记，但不单独升到 intimate——
  // 否则"随口闲聊但情绪波动大"会被误判为私密，导致初期几乎无记忆可提）
  const intensity = Math.max(input.valenceDeltaAbs ?? 0, (input.arousalPeak ?? 0) - 0.5);
  if (intensity > 0.5) score.familiar += 1;

  // 取最高档（按敏感度从高到低找第一个有分的；全 0 → public）
  for (let i = SENSITIVITY_ORDER.length - 1; i > 0; i--) {
    const level = SENSITIVITY_ORDER[i];
    if (score[level] > 0) return level;
  }
  return 'public';
}

/** 从 episode 形态的对象推断敏感度（结构化字段优先） */
export function sensitivityOfEpisode(episode: {
  tags?: string[];
  eventSummary?: string;
  narrativeFragment?: string;
  emotionalImpact?: { valenceDelta?: number; arousalPeak?: number };
}): MemorySensitivity {
  return inferSensitivity({
    text: `${episode.eventSummary ?? ''} ${episode.narrativeFragment ?? ''}`.trim(),
    tags: episode.tags,
    valenceDeltaAbs: Math.abs(episode.emotionalImpact?.valenceDelta ?? 0),
    arousalPeak: episode.emotionalImpact?.arousalPeak,
  });
}

// ════════════════════════════════════════════════════════════
// 3. 可见性判定
// ════════════════════════════════════════════════════════════

export interface VisibilityResult {
  visible: boolean;
  sensitivity: MemorySensitivity;
  /** 该记忆可见所需的最低阶段 */
  minStage: RelationshipStageV2;
  /** 不可见 / 可用的原因（可观测性） */
  reason: string;
}

/** 判断某条记忆在当前关系阶段是否可见 */
export function visibleAtStage(
  input: SensitivityInput,
  currentStage: RelationshipStageV2 | string | undefined | null,
  opts?: { forcedSensitivity?: MemorySensitivity },
): VisibilityResult {
  const sensitivity = opts?.forcedSensitivity ?? inferSensitivity(input);
  const minStage = SENSITIVITY_MIN_STAGE[sensitivity];
  const need = stageRank(minStage);
  const have = stageRank(currentStage);
  const visible = have >= need;
  return {
    visible,
    sensitivity,
    minStage,
    reason: visible
      ? `${SENSITIVITY_LABELS[sensitivity]}·当前阶段可见（${currentStage ?? 'acquaintance'} ≥ ${minStage}）`
      : `${SENSITIVITY_LABELS[sensitivity]}·需到「${minStage}」阶段（当前 ${currentStage ?? 'acquaintance'}）`,
  };
}

/** 批量过滤：把当前阶段不可见的记忆剔除（用于召回/注入前） */
export function filterVisibleAtStage<T>(
  items: T[],
  currentStage: RelationshipStageV2 | string | undefined | null,
  toInput: (item: T) => SensitivityInput,
): T[] {
  return items.filter((item) => visibleAtStage(toInput(item), currentStage).visible);
}

// ════════════════════════════════════════════════════════════
// 4. 与治理层组合（可信 × 记得住 × 现在该不该说）
// ════════════════════════════════════════════════════════════

/** 治理层给出的使用许可（与 memoryGovernance.recallAllowance 结构一致） */
export interface GovernanceAllowance {
  proactive: boolean;
  assertive: boolean;
  context: boolean;
}

export interface MemoryAccessDecision {
  visible: boolean;
  proactive: boolean;
  assertive: boolean;
  context: boolean;
  sensitivity: MemorySensitivity;
  minStage: RelationshipStageV2;
  reason: string;
}

/**
 * 组合判定：可见性（阶段） × 治理（可信度）。
 * 两者取"与"：阶段不够 → 连上下文都不注入（零泄漏）；
 * 治理未核实 → 可见但不可主动提起。
 */
export function resolveMemoryAccess(
  input: SensitivityInput,
  currentStage: RelationshipStageV2 | string | undefined | null,
  allowance: GovernanceAllowance,
): MemoryAccessDecision {
  const vis = visibleAtStage(input, currentStage);
  if (!vis.visible) {
    return {
      visible: false,
      proactive: false,
      assertive: false,
      context: false,
      sensitivity: vis.sensitivity,
      minStage: vis.minStage,
      reason: vis.reason,
    };
  }
  return {
    visible: true,
    proactive: allowance.proactive,
    assertive: allowance.assertive,
    context: allowance.context,
    sensitivity: vis.sensitivity,
    minStage: vis.minStage,
    reason: allowance.proactive ? vis.reason : `${vis.reason}；但治理层未放行主动提起`,
  };
}
