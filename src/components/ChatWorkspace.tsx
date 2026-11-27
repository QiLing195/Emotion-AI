import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BookmarkPlus,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  PersonaCloudSnapshotMeta,
  sanitizeDocId,
  savePersonaGrowthToCloud,
  subscribeDynamicConcerns,
  subscribePersonaGrowth,
  syncDynamicConcernsToCloud,
} from '../services/cloudStore';
import {
  AffectBridgeDecision,
  AffectBridgeInput,
  CharacterEmotionState,
  CurrentConcern,
  EmotionEngineMode,
  ExpressionBudgetState,
  ExpressionDecision,
  PersonaGrowthState,
  RoleReferences,
  SCHEMA_VERSION,
  UnderstandingResult,
} from '../dual-loop/contracts';
import { evaluateAffectBridge } from '../dual-loop/affectBridgeGate';
import {
  commitCharacterEmotionTransition,
  createInitialCharacterState,
} from '../dual-loop/characterStateEngine';
import { evaluateExpressionGate } from '../dual-loop/expressionGate';
import { DEFAULT_ROLE_REFERENCES } from '../dual-loop/ledgerReplay';
import { computeRoleAppraisalDelta } from '../dual-loop/roleAppraisal';
import {
  classifyFastPathRoute,
  extractUserEvidenceSpans,
  routeResponseStrategy,
  runUnderstandingTurn,
} from '../dual-loop/understandingLoop';
import {
  revokeDynamicConcern,
  upsertDynamicConcernFromTurn,
} from '../dual-loop/dynamicConcerns';
import {
  applyPersonaGrowthTurn,
  applyReflectionCandidates,
  createInitialPersonaGrowthState,
  PREFERENCE_SCOPE_LABELS,
  resolveActivePreferencesForIntent,
  sanitizePersonaGrowthState,
} from '../dual-loop/personaGrowth';
import {
  clampCoord,
  formatCoord,
  getQuadrant,
  QUADRANTS,
  QuadrantId,
} from '../data/affectLexicon';
import {
  ChatPersonaProfile,
  createCustomPersonaTemplate,
  loadActivePersonaId,
  loadPersonaProfiles,
  PRESET_PERSONA_PROFILES,
  saveActivePersonaId,
  savePersonaProfiles,
} from '../data/personaProfiles';
import {
  DeepSeekModelId,
  DefaultExtractorSource,
} from './SettingsView';

const CHAT_MESSAGES_STORAGE_KEY = 'emotion_ai_chat_messages_v1';
const DYNAMIC_CONCERNS_STORAGE_KEY = 'emotion_ai_dynamic_concerns_v1';
const PERSONA_GROWTH_STORAGE_KEY = 'emotion_ai_persona_growth_v1';

type InspectorTab = 'persona' | 'telemetry';

interface ChatTurnMeta {
  readonly eventId: string;
  readonly routeNote: string;
  readonly primaryLabel: string;
  readonly valence: number | null;
  readonly arousal: number | null;
  readonly quadrant: QuadrantId | 'none';
  readonly intent: string;
  readonly strategy: string;
  readonly bridgeDecision: AffectBridgeDecision['decision'];
  readonly expressionReason: ExpressionDecision['reasonCode'];
  readonly expressionAllowed: boolean;
  readonly implicitCue: boolean;
}

interface ChatMessageItem {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: string;
  readonly personaName?: string;
  readonly sourceUtterance?: string;
  readonly meta?: ChatTurnMeta;
  readonly savedToLog?: boolean;
}

const STARTER_PROMPTS: ReadonlyArray<{ readonly title: string; readonly text: string }> = [
  {
    title: '倾诉受挫',
    text: '今天连续改了三版方案还是被打回，我现在特别沮丧。',
  },
  {
    title: '克制疲惫',
    text: '我不是生气，只是连着加班一周觉得有点累。',
  },
  {
    title: '先给方案',
    text: '别太鸡汤了，我现在急着上线，直接给我排查步骤和结论就行。',
  },
  {
    title: '日常事务',
    text: '帮我列出上线前最关键的三项接口联调检查清单。',
  },
];

const STRATEGY_LABELS: Record<string, string> = {
  crisis_safety_protocol: '危机安全兜底',
  respect_refusal: '尊重边界切回事务',
  acknowledge_and_listen: '接住感受并倾听',
  gentle_clarify: '温和澄清确认',
  hold_unknown: '客观事实直答',
};

const EXPRESSION_LABELS: Record<string, string> = {
  yield_to_crisis: '危机让位',
  yield_to_user_negative: '用户负面让位',
  yield_to_persona_boundary: '低打扰边界让位',
  below_deadzone: '低于死区静默',
  untraceable_source: '无证据静默',
  budget_exhausted: '频率预算耗尽',
  allowed_grounded: '接地放行',
};

const INTENT_LABELS: Record<string, string> = {
  venting: '倾诉表达',
  help_seeking: '寻求协助',
  factual_task: '纯事务处理',
  social_chat: '日常交流',
  unknown: '未明确',
};

function formatClockTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function loadChatMessages(): ChatMessageItem[] {
  try {
    const raw = window.localStorage.getItem(CHAT_MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatMessageItem =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof item.id === 'string' &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.text === 'string'
        )
    );
  } catch {
    return [];
  }
}

function loadDynamicConcerns(): CurrentConcern[] {
  try {
    const raw = window.localStorage.getItem(DYNAMIC_CONCERNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CurrentConcern[]).filter((c) => c.origin === 'dynamic');
  } catch {
    return [];
  }
}

function loadPersonaGrowthState(): PersonaGrowthState {
  try {
    const raw = window.localStorage.getItem(PERSONA_GROWTH_STORAGE_KEY);
    if (!raw) return createInitialPersonaGrowthState('2026-11-25T08:00:00Z');
    return sanitizePersonaGrowthState(JSON.parse(raw), '2026-11-25T08:00:00Z');
  } catch {
    return createInitialPersonaGrowthState('2026-11-25T08:00:00Z');
  }
}

interface PersonaDraft {
  name: string;
  roleTitle: string;
  identity: string;
  personality: string;
  speakingStyle: string;
  greeting: string;
  valuesText: string;
  baselineValence: number;
  baselineArousal: number;
}

function profileToDraft(profile: ChatPersonaProfile): PersonaDraft {
  return {
    name: profile.name,
    roleTitle: profile.roleTitle,
    identity: profile.identity,
    personality: profile.personality,
    speakingStyle: profile.speakingStyle,
    greeting: profile.greeting,
    valuesText: profile.values.join('；'),
    baselineValence: profile.baselineValence,
    baselineArousal: profile.baselineArousal,
  };
}

interface ChatWorkspaceProps {
  readonly cloudUser: User | null;
  readonly deepseekModel: DeepSeekModelId;
  readonly defaultExtractorSource: DefaultExtractorSource;
  readonly defaultEngineMode: EmotionEngineMode;
  readonly onSaveAnnotationFromChat: (payload: {
    readonly utterance: string;
    readonly valence: number;
    readonly arousal: number;
    readonly primaryLabel: string;
    readonly context: string;
  }) => void;
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  cloudUser,
  deepseekModel,
  defaultExtractorSource,
  defaultEngineMode,
  onSaveAnnotationFromChat,
}) => {
  const [personas, setPersonas] = useState<ChatPersonaProfile[]>(loadPersonaProfiles);
  const [activePersonaId, setActivePersonaId] = useState<string>(() =>
    loadActivePersonaId(loadPersonaProfiles())
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('persona');

  const activePersona = useMemo(
    () =>
      personas.find((p) => p.id === activePersonaId) ??
      personas[0] ??
      PRESET_PERSONA_PROFILES[0],
    [personas, activePersonaId]
  );

  const [personaDraft, setPersonaDraft] = useState<PersonaDraft>(() =>
    profileToDraft(activePersona)
  );
  const [personaSaveFeedback, setPersonaSaveFeedback] = useState('');

  const [messages, setMessages] = useState<ChatMessageItem[]>(loadChatMessages);
  const [inputText, setInputText] = useState('');
  const [engineMode, setEngineMode] = useState<EmotionEngineMode>(
    defaultEngineMode === 'shadow_only' ? 'bounded_live' : defaultEngineMode
  );
  const [isSending, setIsSending] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState('');
  const [chatError, setChatError] = useState('');

  const [roleState, setRoleState] = useState<CharacterEmotionState>(() =>
    createInitialCharacterState(
      new Date().toISOString(),
      activePersona.baselineValence,
      activePersona.baselineArousal
    )
  );
  const [dynamicConcerns, setDynamicConcerns] = useState<CurrentConcern[]>(
    loadDynamicConcerns
  );
  const [personaGrowth, setPersonaGrowth] = useState<PersonaGrowthState>(
    loadPersonaGrowthState
  );
  const [seenKeys, setSeenKeys] = useState<string[]>([]);
  const [expressionHistory, setExpressionHistory] = useState<boolean[]>([]);
  const [isReflecting, setIsReflecting] = useState(false);
  const [reflectionNotice, setReflectionNotice] = useState<{
    readonly type: 'success' | 'error';
    readonly message: string;
  } | null>(null);
  const [cloudFatalError, setCloudFatalError] = useState<Error | null>(null);

  const cloudConcernIdsRef = useRef<Set<string>>(new Set());
  const personaCloudMetaRef = useRef<PersonaCloudSnapshotMeta>({
    hasStateDoc: false,
    prefKeys: new Set(),
    logsById: new Map(),
  });
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    savePersonaProfiles(personas);
  }, [personas]);

  useEffect(() => {
    saveActivePersonaId(activePersona.id);
  }, [activePersona.id]);

  useEffect(() => {
    setPersonaDraft(profileToDraft(activePersona));
  }, [activePersona]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CHAT_MESSAGES_STORAGE_KEY,
        JSON.stringify(messages.slice(-60))
      );
    } catch {
      // 忽略本地存储受限异常
    }
  }, [messages]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isSending]);

  useEffect(() => {
    if (!cloudUser) {
      cloudConcernIdsRef.current = new Set();
      personaCloudMetaRef.current = {
        hasStateDoc: false,
        prefKeys: new Set(),
        logsById: new Map(),
      };
      setDynamicConcerns(loadDynamicConcerns());
      setPersonaGrowth(loadPersonaGrowthState());
      return;
    }

    const unsubConcerns = subscribeDynamicConcerns(
      cloudUser.uid,
      (items) => {
        cloudConcernIdsRef.current = new Set(
          items.map((item) => sanitizeDocId(item.id, 'dyn'))
        );
        setDynamicConcerns(items);
      },
      (err) => setCloudFatalError(err)
    );

    const unsubPersona = subscribePersonaGrowth(
      cloudUser.uid,
      (cloudState, meta) => {
        personaCloudMetaRef.current = meta;
        setPersonaGrowth(cloudState);
      },
      (err) => setCloudFatalError(err)
    );

    return () => {
      unsubConcerns();
      unsubPersona();
    };
  }, [cloudUser]);

  useEffect(() => {
    if (cloudUser) return;
    try {
      window.localStorage.setItem(
        DYNAMIC_CONCERNS_STORAGE_KEY,
        JSON.stringify(dynamicConcerns)
      );
    } catch {
      // 忽略配额异常
    }
  }, [dynamicConcerns, cloudUser]);

  useEffect(() => {
    if (cloudUser) return;
    try {
      window.localStorage.setItem(
        PERSONA_GROWTH_STORAGE_KEY,
        JSON.stringify(personaGrowth)
      );
    } catch {
      // 忽略配额异常
    }
  }, [personaGrowth, cloudUser]);

  const persistDynamicConcerns = (nextConcerns: CurrentConcern[]) => {
    setDynamicConcerns(nextConcerns);
    if (!cloudUser) return;
    const prevIds = new Set(cloudConcernIdsRef.current);
    cloudConcernIdsRef.current = new Set(
      nextConcerns
        .filter((c) => c.origin === 'dynamic')
        .map((c) => sanitizeDocId(c.id, 'dyn'))
    );
    void syncDynamicConcernsToCloud(
      cloudUser.uid,
      nextConcerns,
      prevIds
    ).catch((err) =>
      setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
    );
  };

  const persistPersonaGrowth = (nextState: PersonaGrowthState) => {
    setPersonaGrowth(nextState);
    if (!cloudUser) return;
    const currentMeta = personaCloudMetaRef.current;
    void savePersonaGrowthToCloud(cloudUser.uid, nextState, currentMeta)
      .then((updatedMeta) => {
        personaCloudMetaRef.current = updatedMeta;
      })
      .catch((err) =>
        setCloudFatalError(err instanceof Error ? err : new Error(String(err)))
      );
  };

  const activeRefs: RoleReferences = useMemo(() => {
    const baseConstitution = DEFAULT_ROLE_REFERENCES.constitution;
    return {
      ...DEFAULT_ROLE_REFERENCES,
      constitution: baseConstitution
        ? {
            ...baseConstitution,
            values:
              activePersona.values.length > 0
                ? activePersona.values
                : baseConstitution.values,
            hardBoundaries:
              activePersona.hardBoundaries.length > 0
                ? activePersona.hardBoundaries
                : baseConstitution.hardBoundaries,
          }
        : null,
      currentConcerns: [
        ...DEFAULT_ROLE_REFERENCES.currentConcerns,
        ...dynamicConcerns,
      ],
    };
  }, [activePersona, dynamicConcerns]);

  const latestAssistantMeta = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant' && messages[i].meta) {
        return messages[i].meta!;
      }
    }
    return null;
  }, [messages]);

  const userTurnCount = useMemo(
    () => messages.filter((m) => m.role === 'user').length,
    [messages]
  );

  const scopedResolution = useMemo(() => {
    const intent = (latestAssistantMeta?.intent ?? 'unknown') as
      | 'venting'
      | 'help_seeking'
      | 'factual_task'
      | 'social_chat'
      | 'unknown';
    return resolveActivePreferencesForIntent(personaGrowth.preferences, intent);
  }, [personaGrowth.preferences, latestAssistantMeta]);

  const handleSelectPersona = (nextPersona: ChatPersonaProfile) => {
    setActivePersonaId(nextPersona.id);
    setPersonaSaveFeedback('');
    setRoleState(
      createInitialCharacterState(
        new Date().toISOString(),
        nextPersona.baselineValence,
        nextPersona.baselineArousal
      )
    );
  };

  const handleCreateCustomPersona = () => {
    if (personas.length >= 12) {
      setPersonaSaveFeedback('最多支持保存 12 个角色设定。');
      return;
    }
    const customCount = personas.filter((p) => p.isCustom).length + 1;
    const created = createCustomPersonaTemplate(customCount);
    setPersonas((prev) => [...prev, created]);
    setActivePersonaId(created.id);
    setPersonaSaveFeedback('已新建自定义角色，可编辑后点击保存。');
    setRoleState(
      createInitialCharacterState(
        new Date().toISOString(),
        created.baselineValence,
        created.baselineArousal
      )
    );
  };

  const handleDeletePersona = (id: string) => {
    const target = personas.find((p) => p.id === id);
    if (!target || !target.isCustom || personas.length <= 1) return;
    const nextList = personas.filter((p) => p.id !== id);
    setPersonas(nextList);
    if (activePersona.id === id) {
      const fallback = nextList[0];
      setActivePersonaId(fallback.id);
      setRoleState(
        createInitialCharacterState(
          new Date().toISOString(),
          fallback.baselineValence,
          fallback.baselineArousal
        )
      );
    }
    setPersonaSaveFeedback('已删除自定义角色。');
  };

  const handleSavePersonaDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedName = personaDraft.name.trim().slice(0, 32);
    if (!cleanedName) {
      setPersonaSaveFeedback('角色名称不能为空。');
      return;
    }

    const parsedValues = personaDraft.valuesText
      .split(/[；;，,\n]+/)
      .map((s) => s.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 5);

    const updated: ChatPersonaProfile = {
      ...activePersona,
      name: cleanedName,
      roleTitle: personaDraft.roleTitle.trim().slice(0, 48) || activePersona.roleTitle,
      identity: personaDraft.identity.trim().slice(0, 200),
      personality: personaDraft.personality.trim().slice(0, 200),
      speakingStyle: personaDraft.speakingStyle.trim().slice(0, 160),
      greeting: personaDraft.greeting.trim().slice(0, 180) || activePersona.greeting,
      values: parsedValues.length > 0 ? parsedValues : activePersona.values,
      baselineValence: Number(
        Math.max(-0.5, Math.min(0.5, personaDraft.baselineValence)).toFixed(2)
      ),
      baselineArousal: Number(
        Math.max(-0.5, Math.min(0.5, personaDraft.baselineArousal)).toFixed(2)
      ),
    };

    setPersonas((prev) =>
      prev.map((item) => (item.id === activePersona.id ? updated : item))
    );
    setRoleState((prev) => ({
      ...prev,
      baselineValence: updated.baselineValence,
      baselineArousal: updated.baselineArousal,
      valence: messages.length === 0 ? updated.baselineValence : prev.valence,
      arousal: messages.length === 0 ? updated.baselineArousal : prev.arousal,
    }));
    setPersonaSaveFeedback(`已应用「${updated.name}」设定，下一轮回复立即生效。`);
  };

  const handleResetActivePreset = () => {
    const preset = PRESET_PERSONA_PROFILES.find((p) => p.id === activePersona.id);
    if (!preset) return;
    setPersonas((prev) =>
      prev.map((item) => (item.id === preset.id ? preset : item))
    );
    setRoleState(
      createInitialCharacterState(
        new Date().toISOString(),
        preset.baselineValence,
        preset.baselineArousal
      )
    );
    setPersonaSaveFeedback(`已恢复预设角色「${preset.name}」的初始设定。`);
  };

  const sendMessage = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || isSending) return;

    setChatError('');
    setReflectionNotice(null);
    setInputText('');
    setIsSending(true);
    setPhaseLabel('理解语义中…');

    const now = new Date();
    const timestamp = now.toISOString();
    const clock = formatClockTime(now);
    const eventId = `chat-${Date.now()}`;
    const userMsgId = `${eventId}-u`;
    const assistantMsgId = `${eventId}-a`;

    const recentHistory = messages.slice(-6).map((m) => ({
      role: m.role,
      text: m.text,
    }));

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        text: trimmed,
        createdAt: clock,
      },
    ]);

    try {
      // 1. 理解环（按设置默认通道执行快慢分级或全量语义提取）
      let understanding: UnderstandingResult;
      let useServerLlm = defaultExtractorSource === 'server_llm';
      let routeNote = '本地快路';

      if (defaultExtractorSource === 'hybrid_fast_slow') {
        const fastDecision = classifyFastPathRoute(trimmed);
        if (fastDecision.route === 'local_fast') {
          useServerLlm = false;
          routeNote = '本地快路';
        } else {
          useServerLlm = true;
          routeNote = `服务端 ${deepseekModel}`;
        }
      } else if (defaultExtractorSource === 'server_llm') {
        routeNote = `服务端 ${deepseekModel}`;
      }

      if (useServerLlm) {
        try {
          const extractRes = await fetch('/api/dual-loop/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId,
              timestamp,
              text: trimmed,
              recentHistory,
              model: deepseekModel,
            }),
          });
          const extractPayload = (await extractRes.json().catch(() => ({}))) as {
            bridgeInput?: AffectBridgeInput;
          };
          if (extractRes.ok && extractPayload.bridgeInput) {
            const spans = extractUserEvidenceSpans([
              { eventId, actor: 'user', text: trimmed, timestamp },
            ]);
            const { strategy, rationale } = routeResponseStrategy(
              extractPayload.bridgeInput
            );
            understanding = {
              schemaVersion: SCHEMA_VERSION,
              eventId,
              eventTimestamp: timestamp,
              spans,
              bridgeInput: extractPayload.bridgeInput,
              responseStrategy: strategy,
              strategyRationale: rationale,
              revokedEventIds: [],
            };
          } else {
            routeNote = '本地规则降级';
            understanding = runUnderstandingTurn({
              eventId,
              actor: 'user',
              text: trimmed,
              timestamp,
            });
          }
        } catch {
          routeNote = '本地规则降级';
          understanding = runUnderstandingTurn({
            eventId,
            actor: 'user',
            text: trimmed,
            timestamp,
          });
        }
      } else {
        understanding = runUnderstandingTurn({
          eventId,
          actor: 'user',
          text: trimmed,
          timestamp,
        });
      }

      // 2. 桥接 7 道硬门禁 + 角色状态机更新
      const seenSet = new Set(seenKeys);
      const bridgeDecision = evaluateAffectBridge(
        understanding.bridgeInput,
        activeRefs,
        seenSet,
        timestamp
      );
      if (bridgeDecision.decision !== 'duplicate_event_ignored') {
        setSeenKeys((prev) => [...prev, bridgeDecision.idempotencyKey]);
      }

      const roleDelta = computeRoleAppraisalDelta(
        bridgeDecision,
        activeRefs,
        engineMode
      );
      const { nextState, record } = commitCharacterEmotionTransition({
        currentState: roleState,
        eventId,
        idempotencyKey: bridgeDecision.idempotencyKey,
        timestamp,
        mode: engineMode,
        roleAppraisalDelta: roleDelta,
        matchedConcernId: bridgeDecision.matchedConcernId,
        evidenceIds: bridgeDecision.matchedEvidenceIds,
      });
      setRoleState(nextState);

      // 3. 人格成长小闭环 + 表达门 + 动态关切更新
      const growthUpdate = applyPersonaGrowthTurn({
        state: personaGrowth,
        utterance: trimmed,
        understanding,
        decision: bridgeDecision,
        timestamp,
      });
      persistPersonaGrowth(growthUpdate.nextState);

      const recentWindow = expressionHistory.slice(-5);
      const budget: ExpressionBudgetState = {
        windowTurns: 5,
        expressionsInWindow: recentWindow.filter(Boolean).length,
        maxExpressionsInWindow: 1,
      };
      const expression = evaluateExpressionGate(
        nextState,
        understanding,
        budget,
        record,
        growthUpdate.nextState
      );
      setExpressionHistory((prev) => [...prev, expression.allowSelfExpression]);

      const concernUpdate = upsertDynamicConcernFromTurn(
        activeRefs.currentConcerns,
        understanding,
        bridgeDecision,
        timestamp
      );
      persistDynamicConcerns(
        concernUpdate.concerns.filter((c) => c.origin === 'dynamic')
      );

      const primaryHyp = understanding.bridgeInput.hypotheses.find(
        (h) => !h.isAlternative
      );
      const hasCoords =
        primaryHyp !== undefined &&
        typeof primaryHyp.valence === 'number' &&
        typeof primaryHyp.arousal === 'number';
      const turnMeta: ChatTurnMeta = {
        eventId,
        routeNote,
        primaryLabel: primaryHyp?.label ?? '无情绪判断',
        valence: hasCoords ? clampCoord(primaryHyp!.valence!) : null,
        arousal: hasCoords ? clampCoord(primaryHyp!.arousal!) : null,
        quadrant: hasCoords
          ? getQuadrant(primaryHyp!.valence!, primaryHyp!.arousal!)
          : 'none',
        intent: understanding.bridgeInput.intent ?? 'unknown',
        strategy: understanding.responseStrategy,
        bridgeDecision: bridgeDecision.decision,
        expressionReason: expression.reasonCode,
        expressionAllowed: expression.allowSelfExpression,
        implicitCue: Boolean(understanding.bridgeInput.implicitCue),
      };

      // 4. 按当前人格设定 + 双环策略流式生成受控回复（SSE）
      setPhaseLabel(`${activePersona.name} 回复中…`);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: 'assistant',
          text: '',
          createdAt: formatClockTime(new Date()),
          personaName: activePersona.name,
          sourceUtterance: trimmed,
          meta: turnMeta,
          savedToLog: false,
        },
      ]);

      const currentIntent = understanding.bridgeInput.intent ?? 'unknown';
      const scopedPrefs = resolveActivePreferencesForIntent(
        growthUpdate.nextState.preferences,
        currentIntent
      );

      const response = await fetch('/api/dual-loop/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          responseStrategy: understanding.responseStrategy,
          intent: currentIntent,
          expressionDecision: expression,
          roleState: {
            valence: nextState.valence,
            arousal: nextState.arousal,
          },
          personaProfile: {
            name: activePersona.name,
            roleTitle: activePersona.roleTitle,
            identity: activePersona.identity,
            personality: activePersona.personality,
            speakingStyle: activePersona.speakingStyle,
            values: activePersona.values,
            hardBoundaries: activePersona.hardBoundaries,
          },
          personaGrowth: {
            preferenceKeys: scopedPrefs.activePreferences.map((p) => p.key),
            traits: growthUpdate.nextState.traits,
          },
          recentHistory,
          model: deepseekModel,
        }),
      });

      if (!response.ok || !response.body) {
        const errPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const msg = errPayload.error || '受控回复生成失败，请稍后重试。';
        setChatError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, text: `（${msg}）` } : m
          )
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          const dataLine = rawEvent
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6)) as {
            chunk?: string;
            error?: string;
            done?: boolean;
          };
          if (payload.error) {
            setChatError(payload.error);
            if (!accumulated) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, text: `（${payload.error}）` }
                    : m
                )
              );
            }
            return;
          }
          if (payload.chunk) {
            accumulated += payload.chunk;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, text: accumulated } : m
              )
            );
          }
        }
      }
    } catch {
      setChatError('无法连接对话服务，请检查服务是否正常运行。');
    } finally {
      setIsSending(false);
      setPhaseLabel('');
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(inputText);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(inputText);
    }
  };

  const handleSaveTurnToAnnotations = (msg: ChatMessageItem) => {
    if (!msg.sourceUtterance || !msg.meta || msg.savedToLog) return;
    const v = msg.meta.valence ?? 0;
    const a = msg.meta.arousal ?? 0;
    const label =
      msg.meta.primaryLabel === '无情绪判断' ? '平静' : msg.meta.primaryLabel;
    onSaveAnnotationFromChat({
      utterance: msg.sourceUtterance,
      valence: v,
      arousal: a,
      primaryLabel: label,
      context: '观察笔记',
    });
    setMessages((prev) =>
      prev.map((item) =>
        item.id === msg.id ? { ...item, savedToLog: true } : item
      )
    );
  };

  const handleRunReflection = async () => {
    const turns = messages.slice(-10).map((m) => ({
      role: m.role,
      text: m.text,
    }));
    if (turns.filter((t) => t.role === 'user').length < 2) {
      setReflectionNotice({
        type: 'error',
        message: '至少完成 2 轮对话后才可提炼跨轮沟通偏好。',
      });
      return;
    }
    setIsReflecting(true);
    setReflectionNotice(null);
    try {
      const response = await fetch('/api/dual-loop/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, model: deepseekModel }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        candidates?: Array<{
          preferenceKey:
            | 'solution_first'
            | 'low_emotional_probing'
            | 'gentle_pacing'
            | 'concise_direct';
          confidence: number;
          evidenceQuotes: string[];
          rationale: string;
        }>;
        error?: string;
      };
      if (!response.ok) {
        setReflectionNotice({
          type: 'error',
          message: payload.error || '异步反思提炼失败。',
        });
        return;
      }
      const candidates = Array.isArray(payload.candidates)
        ? payload.candidates
        : [];
      if (candidates.length === 0) {
        setReflectionNotice({
          type: 'success',
          message: '反思完成：当前对话尚无跨轮重复偏好，保持现有人设。',
        });
        return;
      }
      const { nextState, report } = applyReflectionCandidates(
        personaGrowth,
        candidates,
        new Date().toISOString()
      );
      persistPersonaGrowth(nextState);
      setReflectionNotice({
        type: 'success',
        message: `异步反思完成：通过门控沉淀 ${report.accepted.length} 项偏好，拦截 ${report.rejected.length} 项。`,
      });
    } catch {
      setReflectionNotice({
        type: 'error',
        message: '无法连接异步反思接口，请稍后重试。',
      });
    } finally {
      setIsReflecting(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setSeenKeys([]);
    setExpressionHistory([]);
    setRoleState(
      createInitialCharacterState(
        new Date().toISOString(),
        activePersona.baselineValence,
        activePersona.baselineArousal
      )
    );
    setChatError('');
    setReflectionNotice(null);
  };

  if (cloudFatalError) {
    throw cloudFatalError;
  }

  const baselineX = 50 + roleState.baselineValence * 40;
  const baselineY = 50 - roleState.baselineArousal * 40;
  const currentX = 50 + roleState.valence * 40;
  const currentY = 50 - roleState.arousal * 40;
  const isPresetPersona = PRESET_PERSONA_PROFILES.some(
    (p) => p.id === activePersona.id
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* 左侧主区域：带人格设定的实时情感对话流 */}
      <section className="lg:col-span-8 bg-white border border-slate-200 rounded-lg flex flex-col h-[calc(100vh-8.5rem)] min-h-[600px]">
        {/* 对话顶栏 */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {activePersona.name}
              <span aria-hidden="true" className="mx-1.5 text-slate-300 font-normal">
                ·
              </span>
              <span className="font-normal text-slate-600">
                {activePersona.roleTitle}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              基线{' '}
              <span className="font-mono tabular-nums">
                ({formatCoord(activePersona.baselineValence)},{' '}
                {formatCoord(activePersona.baselineArousal)})
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                ·
              </span>
              模型 <span className="font-mono">{deepseekModel}</span>
              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                ·
              </span>
              双环门控与人格设定实时生效
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRunReflection}
              disabled={userTurnCount < 2 || isReflecting || isSending}
              title={
                userTurnCount < 2
                  ? '完成至少 2 轮对话后可运行异步反思'
                  : '提炼跨轮沟通偏好'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {isReflecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{isReflecting ? '反思中…' : '异步反思'}</span>
            </button>
            <button
              type="button"
              onClick={handleClearChat}
              disabled={messages.length === 0 || isSending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>清空对话</span>
            </button>
          </div>
        </div>

        {/* 消息滚动列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center max-w-xl mx-auto py-6 space-y-6">
              {/* 角色开场白 */}
              <div className="space-y-2 pb-5 border-b border-slate-200">
                <p className="text-xs text-slate-500">
                  {activePersona.name} · {activePersona.roleTitle}
                </p>
                <p className="text-sm text-slate-900 leading-relaxed">
                  {activePersona.greeting}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  可在右侧「人格设定」随时切换预设角色、新建自定义角色，或调整性格、口吻与初始情绪基线。
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {STARTER_PROMPTS.map((starter) => (
                  <button
                    key={starter.title}
                    type="button"
                    onClick={() => void sendMessage(starter.text)}
                    className="text-left p-3 rounded-md border border-slate-200 bg-slate-50/70 hover:bg-slate-100/80 transition-colors space-y-1"
                  >
                    <p className="text-xs font-medium text-slate-900">
                      {starter.title}
                    </p>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {starter.text}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    isUser ? 'items-end' : 'items-start'
                  } space-y-1.5`}
                >
                  <div
                    className={
                      isUser
                        ? 'max-w-[82%] px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm leading-relaxed whitespace-pre-wrap'
                        : 'max-w-[86%] px-4 py-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-sm leading-relaxed whitespace-pre-wrap'
                    }
                  >
                    {msg.text ? (
                      msg.text
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        <span>{msg.personaName || activePersona.name} 正在组织回复…</span>
                      </span>
                    )}
                  </div>

                  {/* 无胶囊行内元数据 */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 px-0.5">
                    {!isUser && (
                      <>
                        <span className="font-medium text-slate-600">
                          {msg.personaName || activePersona.name}
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="font-mono tabular-nums">{msg.createdAt}</span>
                    {!isUser && msg.meta && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">
                          {msg.meta.primaryLabel}
                          {msg.meta.valence !== null &&
                            msg.meta.arousal !== null && (
                              <span className="font-mono tabular-nums ml-1">
                                ({formatCoord(msg.meta.valence)},{' '}
                                {formatCoord(msg.meta.arousal)})
                              </span>
                            )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {STRATEGY_LABELS[msg.meta.strategy] ?? msg.meta.strategy}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          表达门：
                          {EXPRESSION_LABELS[msg.meta.expressionReason] ??
                            msg.meta.expressionReason}
                        </span>
                        {msg.sourceUtterance && (
                          <>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => handleSaveTurnToAnnotations(msg)}
                              disabled={msg.savedToLog}
                              className={`inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
                                msg.savedToLog
                                  ? 'text-emerald-700'
                                  : 'text-blue-600 hover:text-blue-700'
                              }`}
                            >
                              {msg.savedToLog ? (
                                <>
                                  <Check className="w-3 h-3" aria-hidden="true" />
                                  <span>已存入标注</span>
                                </>
                              ) : (
                                <>
                                  <BookmarkPlus className="w-3 h-3" aria-hidden="true" />
                                  <span>存入标注日志</span>
                                </>
                              )}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollEndRef} />
        </div>

        {/* 底部输入框 */}
        <form
          onSubmit={handleSubmit}
          className="p-4 border-t border-slate-200 space-y-2.5"
        >
          {chatError && (
            <p className="text-xs text-rose-700" role="alert">
              {chatError}
            </p>
          )}
          {reflectionNotice && (
            <p
              role={reflectionNotice.type === 'error' ? 'alert' : 'status'}
              className={`text-xs ${
                reflectionNotice.type === 'error'
                  ? 'text-rose-700'
                  : 'text-emerald-700'
              }`}
            >
              {reflectionNotice.message}
            </p>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={inputRef}
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              placeholder={`对「${activePersona.name}」说点什么（Enter 发送，Shift + Enter 换行）…`}
              aria-label="聊天消息输入框"
              className="flex-1 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none resize-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSending}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 h-[42px] text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{isSending ? phaseLabel || '处理中…' : '发送'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* 右侧面板：人格设定编辑器 + 实时情绪状态 */}
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-lg flex flex-col lg:h-[calc(100vh-8.5rem)] lg:min-h-[600px]">
        {/* 分段切换栏 */}
        <div className="p-3 border-b border-slate-200">
          <div
            className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md"
            role="tablist"
            aria-label="右侧检查器面板切换"
          >
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'persona'}
              onClick={() => setInspectorTab('persona')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                inspectorTab === 'persona'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              人格设定
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inspectorTab === 'telemetry'}
              onClick={() => setInspectorTab('telemetry')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                inspectorTab === 'telemetry'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              实时情绪状态
            </button>
          </div>
        </div>

        {/* 面板内容滚动区 */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {inspectorTab === 'persona' ? (
            <>
              {/* 1. 角色选择与新建 */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    对话角色列表
                  </h3>
                  <button
                    type="button"
                    onClick={handleCreateCustomPersona}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>新建角色</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {personas.map((item) => {
                    const selected = item.id === activePersona.id;
                    return (
                      <div key={item.id} className="relative group">
                        <button
                          type="button"
                          onClick={() => handleSelectPersona(item)}
                          className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                            selected
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-slate-900'
                          }`}
                        >
                          <p className="text-xs font-semibold truncate pr-4">
                            {item.name}
                          </p>
                          <p
                            className={`text-xs truncate mt-0.5 ${
                              selected ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            {item.roleTitle}
                          </p>
                        </button>
                        {item.isCustom && (
                          <button
                            type="button"
                            onClick={() => handleDeletePersona(item.id)}
                            aria-label={`删除角色 ${item.name}`}
                            title="删除自定义角色"
                            className={`absolute top-1.5 right-1.5 p-1 rounded transition-colors ${
                              selected
                                ? 'text-slate-300 hover:text-white'
                                : 'text-slate-400 hover:text-rose-600'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. 当前人格设定表单 */}
              <form onSubmit={handleSavePersonaDraft} className="p-4 space-y-3.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="persona-name"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      角色名称
                    </label>
                    <input
                      id="persona-name"
                      type="text"
                      maxLength={32}
                      value={personaDraft.name}
                      onChange={(e) => {
                        setPersonaDraft((prev) => ({ ...prev, name: e.target.value }));
                        setPersonaSaveFeedback('');
                      }}
                      className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="persona-title"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      角色定位
                    </label>
                    <input
                      id="persona-title"
                      type="text"
                      maxLength={48}
                      value={personaDraft.roleTitle}
                      onChange={(e) => {
                        setPersonaDraft((prev) => ({
                          ...prev,
                          roleTitle: e.target.value,
                        }));
                        setPersonaSaveFeedback('');
                      }}
                      className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="persona-identity"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    身份背景
                  </label>
                  <textarea
                    id="persona-identity"
                    rows={2}
                    maxLength={200}
                    value={personaDraft.identity}
                    onChange={(e) => {
                      setPersonaDraft((prev) => ({
                        ...prev,
                        identity: e.target.value,
                      }));
                      setPersonaSaveFeedback('');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="persona-personality"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    核心性格
                  </label>
                  <textarea
                    id="persona-personality"
                    rows={2}
                    maxLength={200}
                    value={personaDraft.personality}
                    onChange={(e) => {
                      setPersonaDraft((prev) => ({
                        ...prev,
                        personality: e.target.value,
                      }));
                      setPersonaSaveFeedback('');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="persona-style"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    说话风格与口吻
                  </label>
                  <textarea
                    id="persona-style"
                    rows={2}
                    maxLength={160}
                    value={personaDraft.speakingStyle}
                    onChange={(e) => {
                      setPersonaDraft((prev) => ({
                        ...prev,
                        speakingStyle: e.target.value,
                      }));
                      setPersonaSaveFeedback('');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none resize-none leading-relaxed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="persona-values"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    核心价值观（分号分隔，同步写入角色宪章）
                  </label>
                  <input
                    id="persona-values"
                    type="text"
                    value={personaDraft.valuesText}
                    onChange={(e) => {
                      setPersonaDraft((prev) => ({
                        ...prev,
                        valuesText: e.target.value,
                      }));
                      setPersonaSaveFeedback('');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="persona-greeting"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    开场白
                  </label>
                  <input
                    id="persona-greeting"
                    type="text"
                    maxLength={180}
                    value={personaDraft.greeting}
                    onChange={(e) => {
                      setPersonaDraft((prev) => ({
                        ...prev,
                        greeting: e.target.value,
                      }));
                      setPersonaSaveFeedback('');
                    }}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none"
                  />
                </div>

                {/* 初始情绪基线 (V, A) */}
                <div className="pt-1 space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="persona-base-v" className="text-slate-600">
                        初始情绪基线 · 效价 (V)
                      </label>
                      <span className="font-mono tabular-nums text-slate-900">
                        {formatCoord(personaDraft.baselineValence)}
                      </span>
                    </div>
                    <input
                      id="persona-base-v"
                      type="range"
                      min={-0.5}
                      max={0.5}
                      step={0.02}
                      value={personaDraft.baselineValence}
                      onChange={(e) => {
                        setPersonaDraft((prev) => ({
                          ...prev,
                          baselineValence: parseFloat(e.target.value),
                        }));
                        setPersonaSaveFeedback('');
                      }}
                      className="w-full accent-blue-600"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <label htmlFor="persona-base-a" className="text-slate-600">
                        初始情绪基线 · 唤醒度 (A)
                      </label>
                      <span className="font-mono tabular-nums text-slate-900">
                        {formatCoord(personaDraft.baselineArousal)}
                      </span>
                    </div>
                    <input
                      id="persona-base-a"
                      type="range"
                      min={-0.5}
                      max={0.5}
                      step={0.02}
                      value={personaDraft.baselineArousal}
                      onChange={(e) => {
                        setPersonaDraft((prev) => ({
                          ...prev,
                          baselineArousal: parseFloat(e.target.value),
                        }));
                        setPersonaSaveFeedback('');
                      }}
                      className="w-full accent-blue-600"
                    />
                  </div>
                </div>

                {personaSaveFeedback && (
                  <p className="text-xs text-emerald-700" role="status">
                    {personaSaveFeedback}
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>保存并应用设定</span>
                  </button>
                  {isPresetPersona && (
                    <button
                      type="button"
                      onClick={handleResetActivePreset}
                      className="inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>恢复预设</span>
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <>
              {/* 1. 本轮情绪理解 */}
              <div className="p-5 space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    本轮情绪理解
                  </h3>
                  {latestAssistantMeta && (
                    <span className="text-xs text-slate-400">
                      {latestAssistantMeta.routeNote}
                    </span>
                  )}
                </div>

                {latestAssistantMeta ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                    <div>
                      <dt className="text-slate-500">主情绪</dt>
                      <dd className="font-medium text-slate-900 mt-0.5">
                        {latestAssistantMeta.primaryLabel}
                        {latestAssistantMeta.implicitCue ? '（隐含）' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">沟通诉求</dt>
                      <dd className="text-slate-900 mt-0.5">
                        {INTENT_LABELS[latestAssistantMeta.intent] ??
                          latestAssistantMeta.intent}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">效价 / 唤醒度</dt>
                      <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                        {latestAssistantMeta.valence !== null &&
                        latestAssistantMeta.arousal !== null
                          ? `${formatCoord(latestAssistantMeta.valence)} / ${formatCoord(latestAssistantMeta.arousal)}`
                          : '无坐标'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">所属象限</dt>
                      <dd className="text-slate-900 mt-0.5">
                        {latestAssistantMeta.quadrant === 'none'
                          ? '无判断'
                          : QUADRANTS[latestAssistantMeta.quadrant].shortLabel}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    发送第一条消息后，这里将实时显示情绪坐标、象限归属与双环策略路由。
                  </p>
                )}
              </div>

              {/* 2. 角色连续状态 */}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    {activePersona.name} 的情绪状态
                  </h3>
                  <div
                    className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded"
                    role="tablist"
                    aria-label="对话角色状态机模式"
                  >
                    {(
                      [
                        { id: 'bounded_live', label: '有界' },
                        { id: 'shadow_only', label: '影子' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={engineMode === opt.id}
                        onClick={() => setEngineMode(opt.id)}
                        className={`px-2 py-0.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                          engineMode === opt.id
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <svg
                    viewBox="0 0 100 100"
                    className="w-20 h-20 shrink-0 border border-slate-200 rounded bg-slate-50"
                    aria-label="角色二维情绪位置示意图"
                  >
                    <line x1="50" y1="6" x2="50" y2="94" stroke="#CBD5E1" strokeWidth="1" />
                    <line x1="6" y1="50" x2="94" y2="50" stroke="#CBD5E1" strokeWidth="1" />
                    <circle
                      cx={baselineX}
                      cy={baselineY}
                      r="3"
                      fill="none"
                      stroke="#94A3B8"
                      strokeWidth="1.2"
                    />
                    <circle cx={currentX} cy={currentY} r="4" fill="#2563EB" />
                  </svg>
                  <dl className="space-y-1.5 text-xs min-w-0">
                    <div>
                      <dt className="text-slate-500">当前坐标 (V, A)</dt>
                      <dd className="font-mono tabular-nums font-medium text-slate-900">
                        ({formatCoord(roleState.valence)},{' '}
                        {formatCoord(roleState.arousal)})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">角色初始基线</dt>
                      <dd className="font-mono tabular-nums text-slate-600">
                        ({formatCoord(roleState.baselineValence)},{' '}
                        {formatCoord(roleState.baselineArousal)})
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              {/* 3. 人格成长与场景偏好 */}
              <div className="p-5 space-y-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    人格成长与场景偏好
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {personaGrowth.preferences.length} 项
                  </span>
                </div>

                {personaGrowth.preferences.length === 0 ? (
                  <p className="text-xs text-slate-500 leading-relaxed">
                    尚未记录特定偏好。对话中表达“直接给方案”“别分析我情绪”或连续倾诉后会自动习得并在此展示。
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-xs">
                    {personaGrowth.preferences.map((pref) => {
                      const isActive = scopedResolution.activePreferences.some(
                        (p) => p.key === pref.key
                      );
                      return (
                        <li key={pref.key} className="py-2 first:pt-0 last:pb-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-medium text-slate-900">
                              {pref.label}
                            </span>
                            <span
                              className={
                                isActive
                                  ? 'text-emerald-700 font-medium'
                                  : 'text-slate-400'
                              }
                            >
                              {isActive ? '本轮生效' : '场景静默'}
                            </span>
                          </div>
                          <p className="text-slate-500 mt-0.5">
                            {PREFERENCE_SCOPE_LABELS[pref.scope]} · 置信度{' '}
                            <span className="font-mono tabular-nums">
                              {Math.round(pref.confidence * 100)}%
                            </span>
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {userTurnCount >= 5 && (
                  <p className="text-xs text-slate-500 pt-1">
                    已对话 {userTurnCount} 轮，可点击上方「异步反思」沉淀跨轮习惯。
                  </p>
                )}
              </div>

              {/* 4. 动态关切（24h TTL） */}
              {dynamicConcerns.length > 0 && (
                <div className="p-5 space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900">
                    临时动态关切（24h TTL）
                  </h3>
                  <ul className="space-y-1.5 text-xs">
                    {dynamicConcerns.map((concern) => (
                      <li
                        key={concern.id}
                        className="flex items-center justify-between gap-2 text-slate-700"
                      >
                        <span className="truncate">
                          {concern.topicKeywords.join(' / ')}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            persistDynamicConcerns(
                              revokeDynamicConcern(dynamicConcerns, concern.id)
                            )
                          }
                          aria-label={`移除关切 ${concern.topicKeywords.join('/')}`}
                          className="p-0.5 text-slate-400 hover:text-rose-600 transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
