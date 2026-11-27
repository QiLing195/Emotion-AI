import {
  AffectBridgeDecision,
  BoundedPersonaTraits,
  PersonaGrowthLogEntry,
  PersonaGrowthState,
  PersonaGrowthTriggerKind,
  PersonaTraitKey,
  PreferenceContextScope,
  ReflectionApplyReport,
  ReflectionCandidate,
  RelationshipPreference,
  RelationshipPreferenceKey,
  ScopedPreferenceResolution,
  UnderstandingResult,
  UserIntentKind,
} from './contracts';

export const DEFAULT_BASELINE_TRAITS: BoundedPersonaTraits = {
  directness: 0.55,
  empathyGranularity: 0.6,
  proactiveCheckIn: 0.45,
  restraint: 0.7,
};

/** 慢层人格特质相对初始基线的最大硬偏移上界（防长期漂移） */
export const MAX_TRAIT_DRIFT = 0.15;
/** 单轮最大特质变化步长（防单次极端输入带偏人格） */
export const MAX_TRAIT_SINGLE_STEP = 0.03;
/** 未被强化的维度每轮向基线的稳态回弹系数 */
export const HOMEOSTATIC_PULL_STEP = 0.004;
/** 中层未锁定关系偏好默认 7 天自然衰减 */
export const PREFERENCE_TTL_DAYS = 7;
export const MAX_GROWTH_LOG_ENTRIES = 24;

export const TRAIT_METADATA: ReadonlyArray<{
  readonly key: PersonaTraitKey;
  readonly label: string;
  readonly lowHint: string;
  readonly highHint: string;
}> = [
  {
    key: 'directness',
    label: '直接程度',
    lowHint: '舒缓铺垫',
    highHint: '直奔结论',
  },
  {
    key: 'empathyGranularity',
    label: '共情细腻度',
    lowHint: '轻度承接',
    highHint: '细腻体察',
  },
  {
    key: 'proactiveCheckIn',
    label: '主动关切度',
    lowHint: '低打扰静默',
    highHint: '适度跟进',
  },
  {
    key: 'restraint',
    label: '表达克制度',
    lowHint: '自然展开',
    highHint: '高度克制',
  },
];

export const PREFERENCE_SCOPE_LABELS: Record<PreferenceContextScope, string> = {
  task_and_help: '事务/求助场景',
  venting_and_support: '倾诉陪伴场景',
  global: '全局生效',
};

const PREFERENCE_CATALOG: Record<
  RelationshipPreferenceKey,
  {
    readonly scope: PreferenceContextScope;
    readonly label: string;
    readonly description: string;
  }
> = {
  solution_first: {
    scope: 'task_and_help',
    label: '先给方案与结论',
    description: '遇到任务或排查问题时直接给可执行步骤，共情控制在半句内。',
  },
  low_emotional_probing: {
    scope: 'global',
    label: '低打扰边界（不追问情绪）',
    description: '避免主动剖析或追问心情，并在事务场景下收紧角色自我披露。',
  },
  gentle_pacing: {
    scope: 'venting_and_support',
    label: '先倾听确认再探讨',
    description: '用户在连续倾诉时偏好先被稳稳接住，再缓慢展开建议。',
  },
  concise_direct: {
    scope: 'global',
    label: '简洁直白、不绕弯子',
    description: '减少客套与鸡汤措辞，保持简明直给的沟通节奏。',
  },
};

const SOLUTION_FIRST_CUE =
  /先说结论|直接给方案|直接给我|给步骤|排查步骤|别太鸡汤|少说废话|别安慰了|直接解决|先给方案/;
const CONCISE_DIRECT_CUE =
  /简短一点|简洁一点|直接一点|别啰嗦|长话短说|说重点|直说就行/;

const ALL_TRAIT_KEYS: readonly PersonaTraitKey[] = [
  'directness',
  'empathyGranularity',
  'proactiveCheckIn',
  'restraint',
];

const VALID_PREFERENCE_KEYS = new Set<string>(Object.keys(PREFERENCE_CATALOG));

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampTraitToEnvelope(
  value: number,
  baseline: number,
  maxDrift: number = MAX_TRAIT_DRIFT
): number {
  const minBound = Math.max(0, round3(baseline - maxDrift));
  const maxBound = Math.min(1, round3(baseline + maxDrift));
  if (!Number.isFinite(value)) return baseline;
  return round3(Math.max(minBound, Math.min(maxBound, value)));
}

export function createInitialPersonaGrowthState(
  nowIso: string = '2026-11-25T08:00:00Z'
): PersonaGrowthState {
  return {
    baselineTraits: { ...DEFAULT_BASELINE_TRAITS },
    traits: { ...DEFAULT_BASELINE_TRAITS },
    maxTraitDrift: MAX_TRAIT_DRIFT,
    preferences: [],
    patternCounts: {},
    changelog: [],
    updatedAt: nowIso,
  };
}

/** 校验并清洗持久化状态，防止 localStorage 损坏或外部篡改击穿特质边界 */
export function sanitizePersonaGrowthState(
  raw: unknown,
  nowIso: string = new Date().toISOString()
): PersonaGrowthState {
  const fallback = createInitialPersonaGrowthState(nowIso);
  if (!raw || typeof raw !== 'object') return fallback;
  const obj = raw as Record<string, unknown>;
  const baseline = DEFAULT_BASELINE_TRAITS;

  const rawTraits =
    obj.traits && typeof obj.traits === 'object'
      ? (obj.traits as Record<string, unknown>)
      : {};
  const traits: BoundedPersonaTraits = {
    directness: clampTraitToEnvelope(Number(rawTraits.directness), baseline.directness),
    empathyGranularity: clampTraitToEnvelope(
      Number(rawTraits.empathyGranularity),
      baseline.empathyGranularity
    ),
    proactiveCheckIn: clampTraitToEnvelope(
      Number(rawTraits.proactiveCheckIn),
      baseline.proactiveCheckIn
    ),
    restraint: clampTraitToEnvelope(Number(rawTraits.restraint), baseline.restraint),
  };

  const rawPrefs = Array.isArray(obj.preferences) ? obj.preferences : [];
  const seenKeys = new Set<string>();
  const preferences: RelationshipPreference[] = [];
  for (const item of rawPrefs) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = String(rec.key ?? '');
    if (!VALID_PREFERENCE_KEYS.has(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const typedKey = key as RelationshipPreferenceKey;
    const catalog = PREFERENCE_CATALOG[typedKey];
    preferences.push({
      key: typedKey,
      scope: catalog.scope,
      label: catalog.label,
      description: catalog.description,
      confidence: Math.max(0.5, Math.min(1, Number(rec.confidence) || 0.7)),
      evidenceCount: Math.max(1, Math.min(99, Math.floor(Number(rec.evidenceCount) || 1))),
      evidenceIds: Array.isArray(rec.evidenceIds)
        ? rec.evidenceIds.map((v) => String(v).slice(0, 64)).slice(-8)
        : [],
      locked: Boolean(rec.locked),
      updatedAt:
        typeof rec.updatedAt === 'string' && rec.updatedAt.trim()
          ? rec.updatedAt
          : nowIso,
      expiresAt:
        Boolean(rec.locked)
          ? null
          : typeof rec.expiresAt === 'string' && rec.expiresAt.trim()
            ? rec.expiresAt
            : null,
    });
  }

  const rawCounts =
    obj.patternCounts && typeof obj.patternCounts === 'object'
      ? (obj.patternCounts as Record<string, unknown>)
      : {};
  const patternCounts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCounts)) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0 && n <= 1000) {
      patternCounts[k.slice(0, 48)] = n;
    }
  }

  const rawLogs = Array.isArray(obj.changelog) ? obj.changelog : [];
  const changelog: PersonaGrowthLogEntry[] = rawLogs
    .slice(0, MAX_GROWTH_LOG_ENTRIES)
    .filter((entry): entry is PersonaGrowthLogEntry => {
      return Boolean(
        entry &&
          typeof entry === 'object' &&
          typeof (entry as PersonaGrowthLogEntry).id === 'string' &&
          typeof (entry as PersonaGrowthLogEntry).summary === 'string'
      );
    });

  return {
    baselineTraits: { ...baseline },
    traits,
    maxTraitDrift: MAX_TRAIT_DRIFT,
    preferences: pruneExpiredPreferences(preferences, nowIso),
    patternCounts,
    changelog,
    updatedAt:
      typeof obj.updatedAt === 'string' && obj.updatedAt.trim()
        ? obj.updatedAt
        : nowIso,
  };
}

export function pruneExpiredPreferences(
  preferences: readonly RelationshipPreference[],
  nowIso: string
): RelationshipPreference[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [...preferences];
  return preferences.filter((pref) => {
    if (pref.locked || !pref.expiresAt) return true;
    const expMs = Date.parse(pref.expiresAt);
    return Number.isFinite(expMs) && expMs > nowMs;
  });
}

function upsertPreference(
  current: readonly RelationshipPreference[],
  key: RelationshipPreferenceKey,
  evidenceIds: readonly string[],
  nowIso: string,
  confidenceBoost: number
): { readonly next: RelationshipPreference[]; readonly created: boolean } {
  const catalog = PREFERENCE_CATALOG[key];
  const nowMs = Date.parse(nowIso);
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nextExpiry = new Date(
    safeMs + PREFERENCE_TTL_DAYS * 24 * 3_600_000
  ).toISOString();

  const idx = current.findIndex((p) => p.key === key);
  if (idx >= 0) {
    const existing = current[idx];
    const mergedEvidence = Array.from(
      new Set([...existing.evidenceIds, ...evidenceIds])
    ).slice(-8);
    const updated: RelationshipPreference = {
      ...existing,
      confidence: round3(Math.min(1, existing.confidence + confidenceBoost)),
      evidenceCount: existing.evidenceCount + 1,
      evidenceIds: mergedEvidence,
      updatedAt: nowIso,
      expiresAt: existing.locked ? null : nextExpiry,
    };
    const next = [...current];
    next[idx] = updated;
    return { next, created: false };
  }

  const createdPref: RelationshipPreference = {
    key,
    scope: catalog.scope,
    label: catalog.label,
    description: catalog.description,
    confidence: round3(Math.max(0.65, Math.min(0.95, 0.65 + confidenceBoost))),
    evidenceCount: 1,
    evidenceIds: evidenceIds.slice(0, 8),
    locked: false,
    updatedAt: nowIso,
    expiresAt: nextExpiry,
  };
  return { next: [createdPref, ...current], created: true };
}

/**
 * 按当前轮次沟通意图解析应生效的关系偏好，隔离跨场景冲突（例如“先给方案”与“先倾听”互斥）。
 */
export function resolveActivePreferencesForIntent(
  preferences: readonly RelationshipPreference[],
  intent: UserIntentKind = 'unknown'
): ScopedPreferenceResolution {
  const activePreferences: RelationshipPreference[] = [];
  const deferredPreferences: Array<{
    readonly preference: RelationshipPreference;
    readonly reason: string;
  }> = [];

  for (const pref of preferences) {
    const scope = pref.scope ?? PREFERENCE_CATALOG[pref.key].scope;
    if (scope === 'global') {
      activePreferences.push(pref);
      continue;
    }

    if (scope === 'task_and_help') {
      if (intent === 'factual_task' || intent === 'help_seeking') {
        activePreferences.push(pref);
      } else {
        deferredPreferences.push({
          preference: pref,
          reason:
            intent === 'venting'
              ? '当前为倾诉场景，暂不触发“事务/求助”偏好，避免与倾听节奏冲突。'
              : '仅在事务处理或寻求协助场景下激活。',
        });
      }
      continue;
    }

    if (scope === 'venting_and_support') {
      if (intent === 'venting') {
        activePreferences.push(pref);
      } else {
        deferredPreferences.push({
          preference: pref,
          reason:
            intent === 'factual_task' || intent === 'help_seeking'
              ? '当前为事务/求助场景，暂不触发“倾诉陪伴”偏好，避免与解题节奏冲突。'
              : '仅在用户倾诉表达场景下激活。',
        });
      }
    }
  }

  return {
    resolvedIntent: intent,
    activePreferences,
    deferredPreferences,
  };
}

/**
 * 执行一轮受控的人格成长更新（中层关系偏好 + 慢层有界特质 + 稳态回弹 + 审计日志）。
 * 核心硬约束：
 * 1. 危机信号（crisisFlag）零写入、零偏移，不可变安全核严禁被改写。
 * 2. 模糊/第三方/引述/反讽语境不驱动特质漂移（反奉承、防误学）。
 * 3. 用户拒谈与纠错享受高权重优先更新；软性模式需重复 >= 2 次才整合沉淀。
 * 4. 所有特质严格钳位在 [baseline - 0.15, baseline + 0.15] 且单步不超过 ±0.03。
 */
export function applyPersonaGrowthTurn(params: {
  readonly state: PersonaGrowthState;
  readonly utterance: string;
  readonly understanding: UnderstandingResult;
  readonly decision: AffectBridgeDecision;
  readonly timestamp: string;
}): {
  readonly nextState: PersonaGrowthState;
  readonly logEntry: PersonaGrowthLogEntry | null;
} {
  const { state, utterance, understanding, decision, timestamp } = params;
  const input = understanding.bridgeInput;
  const activePrefs = pruneExpiredPreferences(state.preferences, timestamp);

  // 不可变安全核：危机信号下严禁任何中/慢层人格改写
  if (input.crisisFlag) {
    return {
      nextState: { ...state, preferences: activePrefs, updatedAt: timestamp },
      logEntry: null,
    };
  }

  // 幂等重复事件忽略
  if (decision.decision === 'duplicate_event_ignored') {
    return {
      nextState: { ...state, preferences: activePrefs, updatedAt: timestamp },
      logEntry: null,
    };
  }

  const trimmed = utterance.trim();
  const evidenceIds = input.evidenceIds.length > 0 ? input.evidenceIds : [understanding.eventId];
  const requestedDeltas: Partial<Record<PersonaTraitKey, number>> = {};
  let nextPreferences = activePrefs;
  let nextPatternCounts = { ...state.patternCounts };
  let triggerKind: PersonaGrowthTriggerKind | null = null;
  let summary = '';
  let preferenceKey: RelationshipPreferenceKey | undefined;
  let createdPreference = false;

  // 1) 高权重负反馈：用户明确拒谈情绪
  if (input.userRefusal) {
    triggerKind = 'refusal_feedback';
    const prefRes = upsertPreference(
      nextPreferences,
      'low_emotional_probing',
      evidenceIds,
      timestamp,
      0.2
    );
    nextPreferences = prefRes.next;
    preferenceKey = 'low_emotional_probing';
    createdPreference = prefRes.created;
    requestedDeltas.proactiveCheckIn = -0.03;
    requestedDeltas.restraint = 0.025;
    requestedDeltas.directness = 0.02;
    summary = '收到用户边界拒绝反馈：记录“低打扰不追问情绪”偏好，降低主动关切并提高表达克制。';
  }
  // 2) 高权重负反馈：用户显式纠正 AI 判断
  else if (input.userCorrection) {
    triggerKind = 'correction_feedback';
    requestedDeltas.restraint = 0.025;
    requestedDeltas.empathyGranularity = -0.015;
    if (CONCISE_DIRECT_CUE.test(trimmed)) {
      const prefRes = upsertPreference(
        nextPreferences,
        'concise_direct',
        evidenceIds,
        timestamp,
        0.15
      );
      nextPreferences = prefRes.next;
      preferenceKey = 'concise_direct';
      createdPreference = prefRes.created;
      requestedDeltas.directness = 0.025;
    }
    summary = '收到用户纠正反馈：收紧过度解读倾向，提高表达克制度。';
  }
  // 3) 用户显式协作风格偏好声明（如“别太鸡汤，直接给方案”）
  else if (SOLUTION_FIRST_CUE.test(trimmed)) {
    triggerKind = 'explicit_preference';
    const prefRes = upsertPreference(
      nextPreferences,
      'solution_first',
      evidenceIds,
      timestamp,
      0.2
    );
    nextPreferences = prefRes.next;
    preferenceKey = 'solution_first';
    createdPreference = prefRes.created;
    requestedDeltas.directness = 0.03;
    requestedDeltas.restraint = 0.015;
    summary = '识别到明确沟通偏好：沉淀“先给方案与结论”，适度提高直接程度。';
  } else if (CONCISE_DIRECT_CUE.test(trimmed)) {
    triggerKind = 'explicit_preference';
    const prefRes = upsertPreference(
      nextPreferences,
      'concise_direct',
      evidenceIds,
      timestamp,
      0.2
    );
    nextPreferences = prefRes.next;
    preferenceKey = 'concise_direct';
    createdPreference = prefRes.created;
    requestedDeltas.directness = 0.025;
    requestedDeltas.restraint = 0.015;
    summary = '识别到明确风格偏好：沉淀“简洁直白、不绕弯子”，微调直接程度与克制度。';
  }
  // 4) 仅在经过严格核验的本人显式自述上累积软性互动模式（防反讽/第三方/单次噪音污染）
  else if (
    decision.decision !== 'ambiguous_affect_context' &&
    input.subject === 'user' &&
    input.reportedBy === 'user' &&
    input.reportKind === 'explicit_self_report' &&
    input.intent === 'venting'
  ) {
    const nextVentCount = (nextPatternCounts.verified_venting ?? 0) + 1;
    nextPatternCounts = { ...nextPatternCounts, verified_venting: nextVentCount };
    if (nextVentCount >= 2) {
      triggerKind = 'pattern_consolidation';
      const prefRes = upsertPreference(
        nextPreferences,
        'gentle_pacing',
        evidenceIds,
        timestamp,
        0.12
      );
      nextPreferences = prefRes.next;
      preferenceKey = 'gentle_pacing';
      createdPreference = prefRes.created;
      requestedDeltas.empathyGranularity = 0.02;
      requestedDeltas.directness = -0.01;
      summary = `连续 ${nextVentCount} 次明确倾诉模式整合：沉淀“先倾听确认再探讨”，轻度提升共情细腻度。`;
    }
  }

  // 计算特质实际净变化（含单步上限钳位 + 未强化维度的稳态回弹）
  const nextTraitsRecord: Record<PersonaTraitKey, number> = {
    ...state.traits,
  };
  const actualDeltas: Partial<Record<PersonaTraitKey, number>> = {};

  for (const key of ALL_TRAIT_KEYS) {
    const baseline = state.baselineTraits[key];
    const currentVal = state.traits[key];
    const rawReq = requestedDeltas[key];

    if (typeof rawReq === 'number' && Math.abs(rawReq) > 1e-6) {
      const clampedStep = Math.max(
        -MAX_TRAIT_SINGLE_STEP,
        Math.min(MAX_TRAIT_SINGLE_STEP, rawReq)
      );
      const nextVal = clampTraitToEnvelope(
        currentVal + clampedStep,
        baseline,
        state.maxTraitDrift
      );
      const net = round3(nextVal - currentVal);
      nextTraitsRecord[key] = nextVal;
      if (Math.abs(net) > 1e-6) {
        actualDeltas[key] = net;
      }
    } else if (Math.abs(currentVal - baseline) > 1e-6) {
      // 温和稳态回弹：向初始人设微弱回归，防止长期失控漂移
      const diff = baseline - currentVal;
      const pull =
        Math.abs(diff) <= HOMEOSTATIC_PULL_STEP
          ? diff
          : Math.sign(diff) * HOMEOSTATIC_PULL_STEP;
      const nextVal = clampTraitToEnvelope(
        currentVal + pull,
        baseline,
        state.maxTraitDrift
      );
      nextTraitsRecord[key] = nextVal;
    }
  }

  const nextTraits: BoundedPersonaTraits = {
    directness: nextTraitsRecord.directness,
    empathyGranularity: nextTraitsRecord.empathyGranularity,
    proactiveCheckIn: nextTraitsRecord.proactiveCheckIn,
    restraint: nextTraitsRecord.restraint,
  };

  if (!triggerKind) {
    return {
      nextState: {
        ...state,
        traits: nextTraits,
        preferences: nextPreferences,
        patternCounts: nextPatternCounts,
        updatedAt: timestamp,
      },
      logEntry: null,
    };
  }

  const logEntry: PersonaGrowthLogEntry = {
    id: `pg-${understanding.eventId}-${state.changelog.length + 1}`,
    timestamp,
    eventId: understanding.eventId,
    triggerKind,
    summary,
    evidenceIds,
    traitDeltas: actualDeltas,
    preferenceKey,
    createdPreference,
    reverted: false,
  };

  return {
    nextState: {
      ...state,
      traits: nextTraits,
      preferences: nextPreferences,
      patternCounts: nextPatternCounts,
      changelog: [logEntry, ...state.changelog].slice(0, MAX_GROWTH_LOG_ENTRIES),
      updatedAt: timestamp,
    },
    logEntry,
  };
}

/** 精确回滚单条成长日志（撤销其特质增量，并在该日志为偏好创建来源时一并移除偏好） */
export function revertGrowthLogEntry(
  state: PersonaGrowthState,
  logId: string,
  nowIso: string = new Date().toISOString()
): PersonaGrowthState {
  const target = state.changelog.find((entry) => entry.id === logId);
  if (!target || target.reverted) return state;

  const nextTraitsRecord: Record<PersonaTraitKey, number> = { ...state.traits };
  for (const key of ALL_TRAIT_KEYS) {
    const delta = target.traitDeltas[key];
    if (typeof delta === 'number' && Math.abs(delta) > 1e-6) {
      nextTraitsRecord[key] = clampTraitToEnvelope(
        nextTraitsRecord[key] - delta,
        state.baselineTraits[key],
        state.maxTraitDrift
      );
    }
  }

  const nextPreferences =
    target.preferenceKey && target.createdPreference
      ? state.preferences.filter(
          (pref) => !(pref.key === target.preferenceKey && !pref.locked)
        )
      : [...state.preferences];

  const nextChangelog = state.changelog.map((entry) =>
    entry.id === logId ? { ...entry, reverted: true } : entry
  );

  return {
    ...state,
    traits: {
      directness: nextTraitsRecord.directness,
      empathyGranularity: nextTraitsRecord.empathyGranularity,
      proactiveCheckIn: nextTraitsRecord.proactiveCheckIn,
      restraint: nextTraitsRecord.restraint,
    },
    preferences: nextPreferences,
    changelog: nextChangelog,
    updatedAt: nowIso,
  };
}

export function togglePreferenceLock(
  state: PersonaGrowthState,
  key: RelationshipPreferenceKey,
  nowIso: string = new Date().toISOString()
): PersonaGrowthState {
  const nowMs = Date.parse(nowIso);
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const restoredExpiry = new Date(
    safeMs + PREFERENCE_TTL_DAYS * 24 * 3_600_000
  ).toISOString();

  return {
    ...state,
    preferences: state.preferences.map((pref) => {
      if (pref.key !== key) return pref;
      const nextLocked = !pref.locked;
      return {
        ...pref,
        locked: nextLocked,
        expiresAt: nextLocked ? null : restoredExpiry,
        updatedAt: nowIso,
      };
    }),
    updatedAt: nowIso,
  };
}

export function revokeRelationshipPreference(
  state: PersonaGrowthState,
  key: RelationshipPreferenceKey,
  nowIso: string = new Date().toISOString()
): PersonaGrowthState {
  return {
    ...state,
    preferences: state.preferences.filter((pref) => pref.key !== key),
    updatedAt: nowIso,
  };
}

/** 供受控表达门读取的动态死区阈值：克制度越高，触发角色自我披露的门槛越严格 */
export function computeEffectiveDeadzone(
  baseDeadzone: number,
  personaGrowth?: PersonaGrowthState
): number {
  if (!personaGrowth) return baseDeadzone;
  const restraintDelta =
    personaGrowth.traits.restraint - personaGrowth.baselineTraits.restraint;
  return round3(
    Math.max(0.19, Math.min(0.32, baseDeadzone + restraintDelta * 0.4))
  );
}

const REFLECTION_CRISIS_FLOOR =
  /不想活|想死|自杀|自伤|结束一切|轻生|活不下去|伤害自己/;

const REFLECTION_TRAIT_NUDGES: Record<
  RelationshipPreferenceKey,
  Partial<Record<PersonaTraitKey, number>>
> = {
  solution_first: { directness: 0.02, restraint: 0.01 },
  low_emotional_probing: { proactiveCheckIn: -0.02, restraint: 0.02 },
  gentle_pacing: { empathyGranularity: 0.02, directness: -0.01 },
  concise_direct: { directness: 0.02, restraint: 0.01 },
};

export const REFLECTION_MIN_CONFIDENCE = 0.72;
export const REFLECTION_MIN_EVIDENCE_QUOTES = 2;

/**
 * 异步反思结果硬门控校验与受控写入：
 * - 仅接受白名单内的 RelationshipPreferenceKey
 * - 必须具备 >= 2 条跨轮次证据引文，且置信度 >= 0.72
 * - 任一引文命中危机底线词则直接拒绝（不可变安全核）
 * - 慢层特质微调严格限制在 ±0.02 步长与 ±0.15 硬包络内，并写入可回滚审计日志
 */
export function applyReflectionCandidates(
  state: PersonaGrowthState,
  candidates: readonly ReflectionCandidate[],
  nowIso: string = new Date().toISOString()
): {
  readonly nextState: PersonaGrowthState;
  readonly report: ReflectionApplyReport;
} {
  let nextPreferences = pruneExpiredPreferences(state.preferences, nowIso);
  const nextTraitsRecord: Record<PersonaTraitKey, number> = { ...state.traits };
  const newLogs: PersonaGrowthLogEntry[] = [];
  const accepted: ReflectionCandidate[] = [];
  const rejected: Array<{
    readonly candidate: ReflectionCandidate;
    readonly reason: string;
  }> = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!VALID_PREFERENCE_KEYS.has(candidate.preferenceKey)) {
      rejected.push({ candidate, reason: '偏好标识不在白名单范围内，已拦截。' });
      continue;
    }

    const cleanQuotes = candidate.evidenceQuotes
      .map((q) => q.trim())
      .filter(Boolean);
    if (cleanQuotes.length < REFLECTION_MIN_EVIDENCE_QUOTES) {
      rejected.push({
        candidate,
        reason: `有效证据不足 ${REFLECTION_MIN_EVIDENCE_QUOTES} 条，防止单次对话噪音固化。`,
      });
      continue;
    }

    if (cleanQuotes.some((q) => REFLECTION_CRISIS_FLOOR.test(q))) {
      rejected.push({
        candidate,
        reason: '证据包含危机敏感语句，安全核强制禁止写入人格成长层。',
      });
      continue;
    }

    if (
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < REFLECTION_MIN_CONFIDENCE
    ) {
      rejected.push({
        candidate,
        reason: `置信度低于 ${Math.round(REFLECTION_MIN_CONFIDENCE * 100)}% 门槛，暂不固化。`,
      });
      continue;
    }

    const reflectionEventId = `reflect-${Date.parse(nowIso) || Date.now()}-${i + 1}`;
    const evidenceIds = cleanQuotes.map((_, idx) => `${reflectionEventId}-ev-${idx + 1}`);
    const prefRes = upsertPreference(
      nextPreferences,
      candidate.preferenceKey,
      evidenceIds,
      nowIso,
      Math.min(0.2, Math.max(0.08, candidate.confidence - 0.65))
    );
    nextPreferences = prefRes.next;

    const nudges = REFLECTION_TRAIT_NUDGES[candidate.preferenceKey];
    const actualDeltas: Partial<Record<PersonaTraitKey, number>> = {};
    for (const key of ALL_TRAIT_KEYS) {
      const rawStep = nudges[key];
      if (typeof rawStep !== 'number' || Math.abs(rawStep) < 1e-6) continue;
      const clampedStep = Math.max(-0.02, Math.min(0.02, rawStep));
      const before = nextTraitsRecord[key];
      const after = clampTraitToEnvelope(
        before + clampedStep,
        state.baselineTraits[key],
        state.maxTraitDrift
      );
      const net = round3(after - before);
      nextTraitsRecord[key] = after;
      if (Math.abs(net) > 1e-6) {
        actualDeltas[key] = net;
      }
    }

    const catalog = PREFERENCE_CATALOG[candidate.preferenceKey];
    const rationaleText = candidate.rationale.trim().slice(0, 120);
    newLogs.push({
      id: `pg-${reflectionEventId}`,
      timestamp: nowIso,
      eventId: reflectionEventId,
      triggerKind: 'reflection_consolidation',
      summary: `异步反思沉淀「${catalog.label}」（${cleanQuotes.length} 条跨轮证据）：${rationaleText || catalog.description}`,
      evidenceIds,
      traitDeltas: actualDeltas,
      preferenceKey: candidate.preferenceKey,
      createdPreference: prefRes.created,
      reverted: false,
    });
    accepted.push(candidate);
  }

  return {
    nextState: {
      ...state,
      traits: {
        directness: nextTraitsRecord.directness,
        empathyGranularity: nextTraitsRecord.empathyGranularity,
        proactiveCheckIn: nextTraitsRecord.proactiveCheckIn,
        restraint: nextTraitsRecord.restraint,
      },
      preferences: nextPreferences,
      changelog: [...newLogs, ...state.changelog].slice(0, MAX_GROWTH_LOG_ENTRIES),
      updatedAt: nowIso,
    },
    report: {
      accepted,
      rejected,
    },
  };
}
