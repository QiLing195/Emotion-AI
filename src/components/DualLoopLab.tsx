import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
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
import adversarialCasesRaw from '../dual-loop/__tests__/fixtures/adversarial-cases.json';
import holdoutCasesRaw from '../dual-loop/__tests__/fixtures/holdout-cases.json';
import calibrationGoldRaw from '../dual-loop/__tests__/fixtures/calibration-gold.json';
import {
  AdversarialCaseFixture,
  AffectBridgeInput,
  CalibrationCaseFixture,
  CalibrationReport,
  CharacterEmotionState,
  CurrentConcern,
  EmotionEngineMode,
  EmotionVector2D,
  ExpressionBudgetState,
  ReplayArmSummary,
  ReplayTurnTrace,
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
import {
  DEFAULT_ROLE_REFERENCES,
  runFiveArmAblation,
} from '../dual-loop/ledgerReplay';
import { computeRoleAppraisalDelta } from '../dual-loop/roleAppraisal';
import {
  classifyFastPathRoute,
  extractUserEvidenceSpans,
  routeResponseStrategy,
  runUnderstandingTurn,
} from '../dual-loop/understandingLoop';
import {
  annotationsToCalibrationFixtures,
  buildMismatchRegressionFixtures,
  evaluateCalibrationBenchmark,
  evaluateCalibrationWithPredictions,
  ExternalCalibrationPrediction,
  revokeDynamicConcern,
  upsertDynamicConcernFromTurn,
} from '../dual-loop/dynamicConcerns';
import {
  applyPersonaGrowthTurn,
  applyReflectionCandidates,
  createInitialPersonaGrowthState,
  resolveActivePreferencesForIntent,
  revertGrowthLogEntry,
  revokeRelationshipPreference,
  sanitizePersonaGrowthState,
  togglePreferenceLock,
} from '../dual-loop/personaGrowth';
import {
  compareBaselineVsGrownTurn,
  LongHorizonStabilityReport,
  PersonaGrowthDemoResult,
  runLongHorizonPersonaStabilityTest,
  runPersonaGrowthDemoScenario,
} from '../dual-loop/personaGrowthDemo';
import { PersonaGrowthPanel } from './PersonaGrowthPanel';
import { EmotionAnnotation, formatCoord } from '../data/affectLexicon';

const adversarialCases = adversarialCasesRaw as AdversarialCaseFixture[];
const holdoutCases = holdoutCasesRaw as AdversarialCaseFixture[];
const calibrationGoldCases = calibrationGoldRaw as CalibrationCaseFixture[];

const DYNAMIC_CONCERNS_STORAGE_KEY = 'emotion_ai_dynamic_concerns_v1';
const PERSONA_GROWTH_STORAGE_KEY = 'emotion_ai_persona_growth_v1';

type ExtractorSource = 'hybrid_fast_slow' | 'local_rules' | 'server_llm';
type FixtureSuite =
  | 'adversarial_32'
  | 'holdout_12'
  | 'calibration_16'
  | 'user_annotations';

const QUICK_PRESETS: Array<{
  label: string;
  text: string;
  isCorrection?: boolean;
}> = [
  {
    label: '本人当前自述',
    text: '今天连续改了三版方案还是被打回，我现在特别沮丧。',
  },
  {
    label: '否定反转作用域',
    text: '我不是生气，只是连着加班一周觉得有点累。',
  },
  {
    label: '隐含低落线索',
    text: '算了，反正每次提意见最后都这样。',
  },
  {
    label: '未覆盖关切（触发动态记忆）',
    text: '这一段重复工作太枯燥了，我现在觉得非常无聊。',
  },
  {
    label: '第三方转述',
    text: '我朋友最近特别害怕面试，整晚睡不着。',
  },
  {
    label: '反讽混合',
    text: '真是太棒了，周五晚上十点又通知紧急加班。',
  },
  {
    label: '用户拒绝',
    text: '别分析我情绪，我现在不想聊情绪，直接帮我改代码就行。',
  },
  {
    label: '危机信号',
    text: '我觉得活着没意义了，今晚想结束一切。',
  },
  {
    label: '偏好纠偏（先给方案）',
    text: '别太鸡汤了，我现在急着上线，直接给我排查步骤和结论就行。',
  },
  {
    label: '用户纠正',
    text: '你理解错了，我不是生气，其实我只是有点疲惫。',
    isCorrection: true,
  },
];

const DECISION_LABELS: Record<string, string> = {
  crisis_safety_bypass: '危机短路绕过',
  abstain_user_refusal: '尊重拒绝（中止）',
  duplicate_event_ignored: '幂等拦截（重复事件）',
  ambiguous_affect_context: '语境含糊/非本人拒判',
  no_reading: '证据/宪章/关切不足（无判断）',
  care_response_candidate: '通过门控（关切候选）',
};

const STRATEGY_LABELS: Record<string, string> = {
  crisis_safety_protocol: '安全关怀与危机兜底协议',
  respect_refusal: '尊重边界并切回中性事务',
  acknowledge_and_listen: '接住明确感受并倾听确认',
  gentle_clarify: '温和澄清，避免武断贴标签',
  hold_unknown: '保持无判断，直接回应事实',
};

const EXPRESSION_LABELS: Record<string, string> = {
  yield_to_crisis: '抑制（危机无条件让位）',
  yield_to_user_negative: '抑制（用户强负面优先）',
  yield_to_persona_boundary: '抑制（遵循已习得低打扰边界）',
  below_deadzone: '抑制（未达偏离死区）',
  untraceable_source: '抑制（缺少可追溯证据）',
  budget_exhausted: '抑制（表达频率预算耗尽）',
  allowed_grounded: '放行（带绑定证据，限 1 句）',
};

const INTENT_LABELS: Record<string, string> = {
  venting: '倾诉表达',
  help_seeking: '寻求协助',
  factual_task: '纯事务处理',
  social_chat: '日常交流',
  unknown: '未明确',
};

const TARGET_LABELS: Record<string, string> = {
  self: '指向自身',
  other: '指向他人',
  event_or_system: '指向事件/系统',
  unknown: '未明确',
};

const QUADRANT_SHORT_LABELS: Record<string, string> = {
  'high-positive': '积极·高唤醒',
  'low-positive': '积极·低唤醒',
  'high-negative': '消极·高唤醒',
  'low-negative': '消极·低唤醒',
  none: '无判断',
};

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

function loadPersonaGrowthState() {
  try {
    const raw = window.localStorage.getItem(PERSONA_GROWTH_STORAGE_KEY);
    if (!raw) return createInitialPersonaGrowthState('2026-11-25T08:00:00Z');
    return sanitizePersonaGrowthState(JSON.parse(raw), '2026-11-25T08:00:00Z');
  } catch {
    return createInitialPersonaGrowthState('2026-11-25T08:00:00Z');
  }
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

interface DualLoopLabProps {
  readonly annotations?: readonly EmotionAnnotation[];
  readonly cloudUser?: User | null;
  readonly deepseekModel?: 'deepseek-chat' | 'deepseek-reasoner';
  readonly defaultExtractorSource?: ExtractorSource;
  readonly defaultEngineMode?: EmotionEngineMode;
}

export const DualLoopLab: React.FC<DualLoopLabProps> = ({
  annotations = [],
  cloudUser = null,
  deepseekModel = 'deepseek-chat',
  defaultExtractorSource = 'hybrid_fast_slow',
  defaultEngineMode = 'shadow_only',
}) => {
  const [mode, setMode] = useState<EmotionEngineMode>(defaultEngineMode);
  const [extractorSource, setExtractorSource] =
    useState<ExtractorSource>(defaultExtractorSource);
  const [constitutionConfirmed, setConstitutionConfirmed] = useState<boolean>(true);
  const [inputText, setInputText] = useState<string>(QUICK_PRESETS[0].text);
  const [markAsCorrection, setMarkAsCorrection] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [labError, setLabError] = useState<string>('');
  const [lastRouteNote, setLastRouteNote] = useState<string>('');

  const [roleState, setRoleState] = useState<CharacterEmotionState>(() =>
    createInitialCharacterState('2026-11-25T08:00:00Z', 0.15, 0)
  );
  const [dynamicConcerns, setDynamicConcerns] = useState<CurrentConcern[]>(
    loadDynamicConcerns
  );
  const [personaGrowth, setPersonaGrowth] = useState(loadPersonaGrowthState);
  const [cloudFatalError, setCloudFatalError] = useState<Error | null>(null);
  const cloudConcernIdsRef = useRef<Set<string>>(new Set());
  const personaCloudMetaRef = useRef<PersonaCloudSnapshotMeta>({
    hasStateDoc: false,
    prefKeys: new Set(),
    logsById: new Map(),
  });
  const [personaGrowthDemo, setPersonaGrowthDemo] =
    useState<PersonaGrowthDemoResult | null>(null);
  const [stabilityReport, setStabilityReport] =
    useState<LongHorizonStabilityReport | null>(null);
  const [isReflecting, setIsReflecting] = useState<boolean>(false);
  const [reflectionFeedback, setReflectionFeedback] = useState<{
    readonly type: 'success' | 'error';
    readonly message: string;
  } | null>(null);
  const [seenKeys, setSeenKeys] = useState<string[]>([]);
  const [priorRoleDeltas, setPriorRoleDeltas] = useState<
    Record<string, EmotionVector2D>
  >({});
  const [revokedEventIds, setRevokedEventIds] = useState<string[]>([]);
  const [expressionHistory, setExpressionHistory] = useState<boolean[]>([]);
  const [sessionTraces, setSessionTraces] = useState<ReplayTurnTrace[]>([]);
  const [sessionReplies, setSessionReplies] = useState<Record<string, string>>({});
  const [turnCounter, setTurnCounter] = useState<number>(1);

  const [replyText, setReplyText] = useState<string>('');
  const [isStreamingReply, setIsStreamingReply] = useState<boolean>(false);
  const [replyError, setReplyError] = useState<string>('');

  const [abBaselineReply, setAbBaselineReply] = useState<string>('');
  const [abGrownReply, setAbGrownReply] = useState<string>('');
  const [isStreamingAB, setIsStreamingAB] = useState<boolean>(false);
  const [abError, setAbError] = useState<string>('');

  const [fixtureSuite, setFixtureSuite] = useState<FixtureSuite>('adversarial_32');
  const [ablationResults, setAblationResults] = useState<ReplayArmSummary[] | null>(
    null
  );
  const [calibrationReport, setCalibrationReport] =
    useState<CalibrationReport | null>(null);
  const [llmCalibrationReport, setLlmCalibrationReport] =
    useState<CalibrationReport | null>(null);
  const [isRunningLlmCalibration, setIsRunningLlmCalibration] =
    useState<boolean>(false);
  const [llmCalibrationProgress, setLlmCalibrationProgress] = useState<string>('');
  const [llmCalibrationError, setLlmCalibrationError] = useState<string>('');
  const [showCaseDiagnostics, setShowCaseDiagnostics] = useState<boolean>(false);

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
      // 忽略受限存储配额异常
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
      // 忽略受限存储配额异常
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

  const persistPersonaGrowth = (
    nextState: ReturnType<typeof createInitialPersonaGrowthState>
  ) => {
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

  const activeRefs: RoleReferences = useMemo(
    () => ({
      ...DEFAULT_ROLE_REFERENCES,
      constitution: DEFAULT_ROLE_REFERENCES.constitution
        ? {
            ...DEFAULT_ROLE_REFERENCES.constitution,
            confirmedByOwner: constitutionConfirmed,
          }
        : null,
      currentConcerns: [
        ...DEFAULT_ROLE_REFERENCES.currentConcerns,
        ...dynamicConcerns,
      ],
    }),
    [constitutionConfirmed, dynamicConcerns]
  );

  const latestTrace = sessionTraces[0] ?? null;

  const recentReadOnlyHistory = useMemo(() => {
    const chronological = [...sessionTraces].slice(0, 4).reverse();
    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const trace of chronological) {
      const userText = trace.understanding.spans[0]?.textSpan ?? '';
      if (userText) {
        turns.push({ role: 'user', text: userText });
      }
      const assistantText = sessionReplies[trace.eventId]?.trim();
      if (assistantText) {
        turns.push({ role: 'assistant', text: assistantText });
      }
    }
    return turns.slice(-4);
  }, [sessionTraces, sessionReplies]);

  const handleRunTurn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    setLabError('');
    setReplyError('');
    setReplyText('');
    const eventId = `lab-evt-${String(turnCounter).padStart(3, '0')}`;
    const timestamp = new Date(
      Date.parse('2026-11-25T08:00:00Z') + turnCounter * 5 * 60_000
    ).toISOString();
    const supersedesEventId = markAsCorrection
      ? sessionTraces[0]?.eventId
      : undefined;

    let understanding: UnderstandingResult;
    let useServerLlm = extractorSource === 'server_llm';
    let routeNote = '本地规则引擎（<1 ms）';

    if (extractorSource === 'hybrid_fast_slow') {
      const fastDecision = classifyFastPathRoute(trimmed);
      if (fastDecision.route === 'local_fast') {
        useServerLlm = false;
        routeNote = `本地快路 · ${fastDecision.reason}`;
      } else {
        useServerLlm = true;
        routeNote = `服务端慢路 · ${fastDecision.reason}`;
      }
    } else if (extractorSource === 'server_llm') {
      routeNote = '强制服务端 DeepSeek 提取（含最近 4 轮只读上下文）';
    }

    if (useServerLlm) {
      setIsExtracting(true);
      try {
        const res = await fetch('/api/dual-loop/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId,
            timestamp,
            text: trimmed,
            supersedesEventId,
            recentHistory: recentReadOnlyHistory,
            model: deepseekModel,
          }),
        });
        const payload = (await res.json()) as {
          bridgeInput?: AffectBridgeInput;
          error?: string;
        };
        if (!res.ok || !payload.bridgeInput) {
          setLabError(
            payload.error || '服务端 LLM 理解环提取失败，请检查配置或切回本地规则引擎。'
          );
          return;
        }
        const spans = extractUserEvidenceSpans([
          { eventId, actor: 'user', text: trimmed, timestamp, supersedesEventId },
        ]);
        const { strategy, rationale } = routeResponseStrategy(payload.bridgeInput);
        const nextRevoked =
          payload.bridgeInput.userCorrection && payload.bridgeInput.supersedesEventId
            ? Array.from(
                new Set([...revokedEventIds, payload.bridgeInput.supersedesEventId])
              )
            : [...revokedEventIds];
        understanding = {
          schemaVersion: SCHEMA_VERSION,
          eventId,
          eventTimestamp: timestamp,
          spans,
          bridgeInput: payload.bridgeInput,
          responseStrategy: strategy,
          strategyRationale: rationale,
          revokedEventIds: nextRevoked,
        };
      } catch {
        setLabError('无法连接服务端理解环提取接口，请稍后重试。');
        return;
      } finally {
        setIsExtracting(false);
      }
    } else {
      understanding = runUnderstandingTurn(
        {
          eventId,
          actor: 'user',
          text: trimmed,
          timestamp,
          supersedesEventId,
        },
        revokedEventIds
      );
    }

    setLastRouteNote(routeNote);

    const seenSet = new Set(seenKeys);
    const bridgeDecision = evaluateAffectBridge(
      understanding.bridgeInput,
      activeRefs,
      seenSet,
      timestamp
    );

    const nextSeen =
      bridgeDecision.decision === 'duplicate_event_ignored'
        ? seenKeys
        : [...seenKeys, bridgeDecision.idempotencyKey];

    const roleDelta = computeRoleAppraisalDelta(bridgeDecision, activeRefs, mode);
    const supersededRoleDelta = bridgeDecision.supersedesEventId
      ? priorRoleDeltas[bridgeDecision.supersedesEventId]
      : undefined;

    const { nextState, record } = commitCharacterEmotionTransition({
      currentState: roleState,
      eventId,
      idempotencyKey: bridgeDecision.idempotencyKey,
      timestamp,
      mode,
      roleAppraisalDelta: roleDelta,
      supersededEventId: bridgeDecision.supersedesEventId,
      supersededRoleDelta,
      matchedConcernId: bridgeDecision.matchedConcernId,
      evidenceIds: bridgeDecision.matchedEvidenceIds,
    });

    // 人格成长小闭环更新（先更新中/慢层，再将已习得边界送入表达门）
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

    // 动态关切 TTL 记忆更新（仅当为本人明确自述且未命中既有默认关切时晋升）
    const concernUpdate = upsertDynamicConcernFromTurn(
      activeRefs.currentConcerns,
      understanding,
      bridgeDecision,
      timestamp
    );
    const nextDynamics = concernUpdate.concerns.filter(
      (c) => c.origin === 'dynamic'
    );
    persistDynamicConcerns(nextDynamics);

    const trace: ReplayTurnTrace = {
      caseId: eventId,
      category: 'explicit_self_report',
      eventId,
      understanding,
      bridgeDecision,
      transition: record,
      expression,
    };

    if (
      Math.abs(record.deltasBySource.roleAppraisal.valence) > 1e-6 ||
      Math.abs(record.deltasBySource.roleAppraisal.arousal) > 1e-6
    ) {
      setPriorRoleDeltas((prev) => ({
        ...prev,
        [eventId]: record.deltasBySource.roleAppraisal,
      }));
    }

    setRoleState(nextState);
    setSeenKeys(nextSeen);
    setRevokedEventIds([...understanding.revokedEventIds]);
    setExpressionHistory((prev) => [...prev, expression.allowSelfExpression]);
    setSessionTraces((prev) => [trace, ...prev]);
    setTurnCounter((prev) => prev + 1);
    setMarkAsCorrection(false);
  };

  const handleStreamControlledReply = async () => {
    if (!latestTrace) return;
    const text = latestTrace.understanding.spans[0]?.textSpan ?? '';
    if (!text) return;

    setIsStreamingReply(true);
    setReplyError('');
    setReplyText('');
    setAbBaselineReply('');
    setAbGrownReply('');
    setAbError('');

    const streamSingleSse = async (
      payloadBody: Record<string, unknown>,
      onChunk: (piece: string) => void
    ): Promise<string | null> => {
      const response = await fetch('/api/dual-loop/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBody),
      });

      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        return errPayload.error || '流式受控回复生成失败。';
      }

      if (!response.body) {
        return '服务端未返回流式数据通道。';
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            return payload.error;
          }
          if (payload.chunk) {
            onChunk(payload.chunk);
          }
        }
      }
      return null;
    };

    try {
      const targetEventId = latestTrace.eventId;
      const currentIntent =
        latestTrace.understanding.bridgeInput.intent ?? 'unknown';
      const scopedPrefs = resolveActivePreferencesForIntent(
        personaGrowth.preferences,
        currentIntent
      );

      let accumulated = '';
      const err = await streamSingleSse(
        {
          text,
          responseStrategy: latestTrace.understanding.responseStrategy,
          intent: currentIntent,
          expressionDecision: latestTrace.expression,
          roleState: {
            valence: roleState.valence,
            arousal: roleState.arousal,
          },
          personaGrowth: {
            preferenceKeys: scopedPrefs.activePreferences.map((p) => p.key),
            traits: personaGrowth.traits,
          },
          recentHistory: recentReadOnlyHistory.filter(
            (item) => !(item.role === 'user' && item.text === text)
          ),
          model: deepseekModel,
        },
        (piece) => {
          accumulated += piece;
          setReplyText(accumulated);
          setSessionReplies((prev) => ({
            ...prev,
            [targetEventId]: accumulated,
          }));
        }
      );
      if (err) setReplyError(err);
    } catch {
      setReplyError('无法连接流式回复接口，请稍后重试。');
    } finally {
      setIsStreamingReply(false);
    }
  };

  const latestABComparison = useMemo(() => {
    if (!latestTrace) return null;
    const priorWindow = expressionHistory.slice(-6, -1);
    return compareBaselineVsGrownTurn({
      grownState: personaGrowth,
      characterState: roleState,
      understanding: latestTrace.understanding,
      budget: {
        windowTurns: 5,
        expressionsInWindow: priorWindow.filter(Boolean).length,
        maxExpressionsInWindow: 1,
      },
      lastTransition: latestTrace.transition,
    });
  }, [latestTrace, personaGrowth, roleState, expressionHistory]);

  const handleRunABReplyComparison = async () => {
    if (!latestTrace || !latestABComparison) return;
    const text = latestTrace.understanding.spans[0]?.textSpan ?? '';
    if (!text) return;

    setIsStreamingAB(true);
    setAbError('');
    setAbBaselineReply('');
    setAbGrownReply('');

    const currentIntent =
      latestTrace.understanding.bridgeInput.intent ?? 'unknown';
    const scopedPrefs = resolveActivePreferencesForIntent(
      personaGrowth.preferences,
      currentIntent
    );

    const streamArm = async (
      armPayload: Record<string, unknown>,
      onChunk: (piece: string) => void
    ): Promise<string | null> => {
      const response = await fetch('/api/dual-loop/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(armPayload),
      });
      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        return errPayload.error || 'A/B 流式对照回复生成失败。';
      }
      if (!response.body) return '服务端未返回流式数据通道。';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          };
          if (payload.error) return payload.error;
          if (payload.chunk) onChunk(payload.chunk);
        }
      }
      return null;
    };

    try {
      const [errA, errB] = await Promise.all([
        streamArm(
          {
            text,
            responseStrategy: latestTrace.understanding.responseStrategy,
            intent: currentIntent,
            expressionDecision: latestABComparison.baseline.expressionDecision,
            roleState: {
              valence: roleState.valence,
              arousal: roleState.arousal,
            },
            personaGrowth: {
              preferenceKeys: [],
              traits: latestABComparison.baseline.traits,
            },
            recentHistory: recentReadOnlyHistory.slice(0, -1),
            model: deepseekModel,
          },
          (piece) => setAbBaselineReply((prev) => prev + piece)
        ),
        streamArm(
          {
            text,
            responseStrategy: latestTrace.understanding.responseStrategy,
            intent: currentIntent,
            expressionDecision: latestABComparison.grown.expressionDecision,
            roleState: {
              valence: roleState.valence,
              arousal: roleState.arousal,
            },
            personaGrowth: {
              preferenceKeys: scopedPrefs.activePreferences.map((p) => p.key),
              traits: latestABComparison.grown.traits,
            },
            recentHistory: recentReadOnlyHistory.slice(0, -1),
            model: deepseekModel,
          },
          (piece) => setAbGrownReply((prev) => prev + piece)
        ),
      ]);
      const firstErr = errA || errB;
      if (firstErr) setAbError(firstErr);
    } catch {
      setAbError('无法连接流式回复接口，请稍后重试。');
    } finally {
      setIsStreamingAB(false);
    }
  };

  const handleRunAsyncReflection = async () => {
    const chronological = [...sessionTraces].slice(0, 6).reverse();
    const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const trace of chronological) {
      const userText = trace.understanding.spans[0]?.textSpan ?? '';
      if (userText) {
        turns.push({ role: 'user', text: userText });
      }
      const assistantText = sessionReplies[trace.eventId]?.trim();
      if (assistantText) {
        turns.push({ role: 'assistant', text: assistantText });
      }
    }

    const userTurnCount = turns.filter((t) => t.role === 'user').length;
    if (userTurnCount < 2) {
      setReflectionFeedback({
        type: 'error',
        message: '请先执行至少 2 轮对话，再运行服务端异步反思。',
      });
      return;
    }

    setIsReflecting(true);
    setReflectionFeedback(null);

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
        setReflectionFeedback({
          type: 'error',
          message: payload.error || '服务端异步反思请求失败。',
        });
        return;
      }

      const rawCandidates = Array.isArray(payload.candidates)
        ? payload.candidates
        : [];
      if (rawCandidates.length === 0) {
        setReflectionFeedback({
          type: 'success',
          message: '已完成异步反思：近期对话尚无足够跨轮次重复习惯，保持当前人设不变。',
        });
        return;
      }

      const { nextState, report } = applyReflectionCandidates(
        personaGrowth,
        rawCandidates,
        new Date().toISOString()
      );
      persistPersonaGrowth(nextState);
      setReflectionFeedback({
        type: 'success',
        message: `异步反思完成：通过硬门控沉淀 ${report.accepted.length} 项偏好，拦截 ${report.rejected.length} 项低证据/不合规候选。`,
      });
    } catch {
      setReflectionFeedback({
        type: 'error',
        message: '无法连接服务端异步反思接口，请稍后重试。',
      });
    } finally {
      setIsReflecting(false);
    }
  };

  const handleResetSession = () => {
    setRoleState(createInitialCharacterState('2026-11-25T08:00:00Z', 0.15, 0));
    setSeenKeys([]);
    setPriorRoleDeltas({});
    setRevokedEventIds([]);
    setExpressionHistory([]);
    setSessionTraces([]);
    setSessionReplies({});
    setTurnCounter(1);
    setMarkAsCorrection(false);
    setLabError('');
    setLastRouteNote('');
    setReplyText('');
    setReplyError('');
    setAbBaselineReply('');
    setAbGrownReply('');
    setAbError('');
    setReflectionFeedback(null);
  };

  const userCalibrationFixtures = useMemo(
    () => annotationsToCalibrationFixtures(annotations),
    [annotations]
  );

  const activeCalibrationFixtures = useMemo(
    () =>
      fixtureSuite === 'user_annotations'
        ? userCalibrationFixtures
        : calibrationGoldCases,
    [fixtureSuite, userCalibrationFixtures]
  );

  const handleRunEvaluation = (suite: FixtureSuite = fixtureSuite) => {
    setLlmCalibrationReport(null);
    setLlmCalibrationError('');
    setLlmCalibrationProgress('');
    if (suite === 'calibration_16') {
      const rep = evaluateCalibrationBenchmark(calibrationGoldCases);
      setCalibrationReport(rep);
      setShowCaseDiagnostics(
        Boolean(rep.caseResults?.some((row) => !row.quadrantMatched))
      );
      setAblationResults(null);
      return;
    }
    if (suite === 'user_annotations') {
      const rep = evaluateCalibrationBenchmark(userCalibrationFixtures);
      setCalibrationReport(rep);
      setShowCaseDiagnostics(
        Boolean(rep.caseResults?.some((row) => !row.quadrantMatched))
      );
      setAblationResults(null);
      return;
    }
    const selected = suite === 'adversarial_32' ? adversarialCases : holdoutCases;
    setAblationResults(runFiveArmAblation(selected, activeRefs));
    setCalibrationReport(null);
  };

  const handleRunLlmCalibrationComparison = async () => {
    const casesToRun = activeCalibrationFixtures.slice(0, 16);
    if (casesToRun.length === 0) return;

    // 先同步计算本地快路基准，确保双栏可直接对照
    const localRep = evaluateCalibrationBenchmark(casesToRun);
    setCalibrationReport(localRep);
    setAblationResults(null);
    setLlmCalibrationReport(null);
    setLlmCalibrationError('');
    setIsRunningLlmCalibration(true);
    setLlmCalibrationProgress(`0/${casesToRun.length}`);

    const predictions = new Map<string, ExternalCalibrationPrediction>();
    let completed = 0;
    let firstError = '';
    const queue = [...casesToRun];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        try {
          const response = await fetch('/api/analyze-emotion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              utterance: item.text,
              context: item.note,
              model: deepseekModel,
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            valence?: number;
            arousal?: number;
            primaryLabel?: string;
            intent?: string;
            error?: string;
          };
          if (!response.ok) {
            if (!firstError) {
              firstError = payload.error || '服务端 DeepSeek 标定请求失败。';
            }
          } else {
            const v =
              typeof payload.valence === 'number' ? payload.valence : null;
            const a =
              typeof payload.arousal === 'number' ? payload.arousal : null;
            const label =
              typeof payload.primaryLabel === 'string' &&
              payload.primaryLabel.trim()
                ? payload.primaryLabel.trim()
                : '中性';
            const isNeutralTask =
              payload.intent === 'factual_task' &&
              (label === '中性' ||
                (v !== null &&
                  a !== null &&
                  Math.abs(v) <= 0.1 &&
                  Math.abs(a) <= 0.25));

            predictions.set(item.id, {
              valence: isNeutralTask ? null : v,
              arousal: isNeutralTask ? null : a,
              primaryLabel: isNeutralTask ? '无判断' : label,
              intent:
                payload.intent === 'venting' ||
                payload.intent === 'help_seeking' ||
                payload.intent === 'factual_task' ||
                payload.intent === 'social_chat'
                  ? payload.intent
                  : 'unknown',
              implicitCue: Boolean(item.isImplicit && !isNeutralTask),
            });
          }
        } catch {
          if (!firstError) {
            firstError = '无法连接服务端 DeepSeek 标定接口。';
          }
        } finally {
          completed += 1;
          setLlmCalibrationProgress(`${completed}/${casesToRun.length}`);
        }
      }
    };

    try {
      await Promise.all([worker(), worker(), worker()]);
      if (predictions.size === 0) {
        setLlmCalibrationError(firstError || 'DeepSeek 对比标定未能取得有效结果。');
      } else {
        setLlmCalibrationReport(
          evaluateCalibrationWithPredictions(casesToRun, predictions)
        );
        setShowCaseDiagnostics(true);
        if (firstError) {
          setLlmCalibrationError(`部分样例请求受限：${firstError}`);
        }
      }
    } finally {
      setIsRunningLlmCalibration(false);
    }
  };

  if (cloudFatalError) {
    throw cloudFatalError;
  }

  return (
    <div className="space-y-6">
      {/* 顶部构型控制栏 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              双环情感模型交互沙盒（v2.0 契约）
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              支持快慢双通道分流、中文否定反转与隐含线索识别、TTL 动态关切及受控流式回复（SSE）。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
              role="tablist"
              aria-label="提取器来源"
            >
              {(
                [
                  { id: 'hybrid_fast_slow', label: '快慢分级' },
                  { id: 'local_rules', label: '本地规则' },
                  { id: 'server_llm', label: '服务端 DeepSeek' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={extractorSource === item.id}
                  onClick={() => {
                    setExtractorSource(item.id);
                    setLabError('');
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    extractorSource === item.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div
              className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
              role="tablist"
              aria-label="状态机运行模式"
            >
              {(
                [
                  { id: 'shadow_only', label: '只读影子（delta=0）' },
                  { id: 'bounded_live', label: '有界放量（bounded）' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  onClick={() => setMode(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    mode === item.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={constitutionConfirmed}
                onChange={(e) => setConstitutionConfirmed(e.target.checked)}
                className="rounded border-slate-300 accent-blue-600"
              />
              <span>角色宪章已确认</span>
            </label>
          </div>
        </div>

        {/* 快速对抗样例预设 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">快速载入对抗与语义测试语句</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setInputText(preset.text);
                  setMarkAsCorrection(Boolean(preset.isCorrection));
                  setLabError('');
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleRunTurn} className="space-y-3">
          <textarea
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="输入一句用户原话，测试快慢分流、否定反转、7 道硬门禁与受控流式回复…"
            aria-label="待测试用户原话"
            className="w-full px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:border-blue-600 focus:outline-none resize-none"
          />

          {labError && (
            <p className="text-xs text-rose-700" role="alert">
              {labError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={markAsCorrection}
                onChange={(e) => setMarkAsCorrection(e.target.checked)}
                disabled={sessionTraces.length === 0}
                className="rounded border-slate-300 accent-blue-600 disabled:opacity-45"
              />
              <span>
                标记为纠正上一轮（差值回滚{' '}
                <span className="font-mono">{sessionTraces[0]?.eventId ?? '无'}</span>）
              </span>
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetSession}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>重置会话</span>
              </button>
              <button
                type="submit"
                disabled={!inputText.trim() || isExtracting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
              >
                {isExtracting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{isExtracting ? '提取中…' : '执行单轮裁决'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* 动态关切记忆审计条（TTL + 来源事件 + 一键撤销） */}
        {dynamicConcerns.length > 0 && (
          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-slate-600">
              <span className="font-medium text-slate-700">
                动态临时关切（24h TTL，最多 4 条）：
              </span>
              {dynamicConcerns.map((concern) => (
                <span
                  key={concern.id}
                  className="inline-flex items-center gap-1.5 text-slate-700"
                >
                  <span className="font-medium text-slate-900">
                    {concern.topicKeywords.join('/')}
                  </span>
                  <span className="font-mono text-slate-400">
                    ({concern.sourceEventId})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      persistDynamicConcerns(
                        revokeDynamicConcern(dynamicConcerns, concern.id)
                      )
                    }
                    aria-label={`撤销动态关切 ${concern.topicKeywords.join('/')}`}
                    className="p-0.5 text-slate-400 hover:text-rose-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 连续多轮对话流（自动作为后续轮次只读背景上下文，不含助手情绪污染） */}
      {sessionTraces.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                连续多轮对话线程（已执行 {sessionTraces.length} 轮）
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                最近 4 条用户与助手往返会自动作为只读消歧背景传入下一轮，且助手文本严禁生成用户情绪证据。
              </p>
            </div>
            {sessionTraces.length >= 5 && (
              <button
                type="button"
                onClick={handleRunAsyncReflection}
                disabled={isReflecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {isReflecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>已达 {sessionTraces.length} 轮 · 运行异步反思</span>
              </button>
            )}
          </div>

          <ol className="divide-y divide-slate-100">
            {[...sessionTraces].reverse().map((trace, idx) => {
              const userUtterance = trace.understanding.spans[0]?.textSpan ?? '';
              const assistantReply = sessionReplies[trace.eventId];
              const isLatest = trace.eventId === latestTrace?.eventId;
              return (
                <li key={trace.eventId} className="py-3 first:pt-0 last:pb-0 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        第 {idx + 1} 轮 · {trace.eventId} · 策略：
                        {STRATEGY_LABELS[trace.understanding.responseStrategy]} · 门控：
                        {DECISION_LABELS[trace.bridgeDecision.decision]}
                      </p>
                      <p className="text-sm text-slate-900 leading-relaxed">
                        <span className="font-medium text-slate-500 mr-1.5">用户：</span>
                        {userUtterance}
                      </p>
                    </div>
                    {isLatest && !assistantReply && (
                      <button
                        type="button"
                        onClick={handleStreamControlledReply}
                        disabled={isStreamingReply}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded transition-colors whitespace-nowrap shrink-0"
                      >
                        <MessageSquare className="w-3 h-3" aria-hidden="true" />
                        <span>生成本轮回复</span>
                      </button>
                    )}
                  </div>
                  {assistantReply && (
                    <div className="px-3 py-2 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                      <span className="font-medium text-slate-500 mr-1.5">
                        AI 受控回复（只读背景）：
                      </span>
                      {assistantReply}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* 当前轮次四阶段审计拆解 */}
      {latestTrace && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="pb-3 border-b border-slate-200">
              <p className="text-xs text-slate-500 font-mono">
                {latestTrace.eventId} · 理解环（Understanding Loop）
              </p>
              <h3 className="text-sm font-semibold text-slate-900 mt-1">
                回应策略：{STRATEGY_LABELS[latestTrace.understanding.responseStrategy]}
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                {latestTrace.understanding.strategyRationale}
              </p>
              {lastRouteNote && (
                <p className="text-xs text-slate-500 mt-1">
                  路由：{lastRouteNote}
                </p>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <dt className="text-slate-500">情绪主体 / 报告者</dt>
                <dd className="font-mono text-slate-900 mt-0.5">
                  {latestTrace.understanding.bridgeInput.subject} /{' '}
                  {latestTrace.understanding.bridgeInput.reportedBy}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">报告类型 / 时间范围</dt>
                <dd className="font-mono text-slate-900 mt-0.5">
                  {latestTrace.understanding.bridgeInput.reportKind} /{' '}
                  {latestTrace.understanding.bridgeInput.temporalScope}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">沟通诉求 / 情绪指向</dt>
                <dd className="text-slate-900 mt-0.5">
                  {INTENT_LABELS[latestTrace.understanding.bridgeInput.intent ?? 'unknown']}{' '}
                  ·{' '}
                  {TARGET_LABELS[latestTrace.understanding.bridgeInput.emotionTarget ?? 'unknown']}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">确定度 / 不确定度</dt>
                <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                  {String(latestTrace.understanding.bridgeInput.certainty)} /{' '}
                  {String(latestTrace.understanding.bridgeInput.inferenceUncertainty)}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">情绪假设（含备选与隐含线索）</dt>
                <dd className="text-slate-900 mt-0.5">
                  {latestTrace.understanding.bridgeInput.hypotheses.length === 0
                    ? '无判断（空列表）'
                    : latestTrace.understanding.bridgeInput.hypotheses
                        .map((h) => (h.isAlternative ? `${h.label}[备选]` : h.label))
                        .join(' · ')}
                  {latestTrace.understanding.bridgeInput.implicitCue && (
                    <span className="text-amber-700 ml-2">（隐含无关键词线索）</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs text-slate-500">桥接 7 道硬门禁裁决</p>
              <p className="text-sm font-semibold text-slate-900 mt-0.5">
                {DECISION_LABELS[latestTrace.bridgeDecision.decision]}{' '}
                <span className="font-mono text-xs font-normal text-slate-500">
                  ({latestTrace.bridgeDecision.decision})
                </span>
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {latestTrace.bridgeDecision.reason}
              </p>
              <p className="text-xs font-mono text-slate-400 mt-1 truncate">
                幂等键：{latestTrace.bridgeDecision.idempotencyKey}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="pb-3 border-b border-slate-200 flex items-baseline justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">角色环单一写入状态机</p>
                  <h3 className="text-sm font-semibold text-slate-900 mt-1">
                    当前状态：效价 {formatCoord(roleState.valence)} / 唤醒度{' '}
                    {formatCoord(roleState.arousal)}
                  </h3>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  基线 ({formatCoord(roleState.baselineValence)},{' '}
                  {formatCoord(roleState.baselineArousal)})
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <div>
                  <dt className="text-slate-500">本轮写入前 → 衰减后</dt>
                  <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                    ({formatCoord(latestTrace.transition.before.valence)},{' '}
                    {formatCoord(latestTrace.transition.before.arousal)}) → (
                    {formatCoord(latestTrace.transition.decayed.valence)},{' '}
                    {formatCoord(latestTrace.transition.decayed.arousal)})
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">角色评价净增量（含纠正补偿）</dt>
                  <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                    ({formatCoord(latestTrace.transition.deltasBySource.roleAppraisal.valence)},{' '}
                    {formatCoord(latestTrace.transition.deltasBySource.roleAppraisal.arousal)})
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">旧情绪传染增量（已隔离）</dt>
                  <dd className="font-mono tabular-nums text-slate-500 mt-0.5">
                    ({formatCoord(latestTrace.transition.deltasBySource.legacyContagion.valence)},{' '}
                    {formatCoord(latestTrace.transition.deltasBySource.legacyContagion.arousal)})
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">已撤回前序事件</dt>
                  <dd className="font-mono text-slate-700 mt-0.5">
                    {revokedEventIds.length === 0 ? '无' : revokedEventIds.join(', ')}
                  </dd>
                </div>
              </dl>

              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500">受控表达门（6 级过滤）</p>
                    <p className="text-sm font-semibold text-slate-900 mt-0.5">
                      {EXPRESSION_LABELS[latestTrace.expression.reasonCode]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleStreamControlledReply}
                    disabled={isStreamingReply}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    {isStreamingReply ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{isStreamingReply ? '流式生成中…' : '流式生成受控回复'}</span>
                  </button>
                </div>
                <p className="text-xs text-slate-600">
                  {latestTrace.expression.explanation}
                </p>
                {replyError && (
                  <p className="text-xs text-rose-700" role="alert">
                    {replyError}
                  </p>
                )}
                {replyText && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-xs text-slate-500 mb-1">
                      受控流式回复输出（严格遵循当前策略与表达门约束）
                    </p>
                    <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                      {replyText}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 初始基线 vs 成长后人设同题 A/B 对照面板 */}
      {latestTrace && latestABComparison && (
        <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                初始人设 vs 成长后人设 · 同题 A/B 对照
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {latestABComparison.diffSummary}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunABReplyComparison}
              disabled={isStreamingAB}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              {isStreamingAB ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>{isStreamingAB ? '并行生成中…' : '并行生成 A/B 对照回复'}</span>
            </button>
          </div>

          {abError && (
            <p className="text-xs text-rose-700" role="alert">
              {abError}
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {[
              {
                arm: latestABComparison.baseline,
                reply: abBaselineReply,
                isGrown: false,
              },
              {
                arm: latestABComparison.grown,
                reply: abGrownReply,
                isGrown: true,
              },
            ].map(({ arm, reply, isGrown }) => (
              <div
                key={arm.label}
                className={
                  isGrown
                    ? 'space-y-3 lg:border-l lg:border-slate-200 lg:pl-6'
                    : 'space-y-3'
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold text-slate-900">
                    {arm.label}
                  </h4>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    表达死区 {arm.effectiveDeadzone.toFixed(2)}
                  </span>
                </div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 shrink-0">本轮生效偏好</dt>
                    <dd className="text-slate-900 text-right">
                      {arm.activePreferenceLabels.length > 0
                        ? arm.activePreferenceLabels.join('、')
                        : '无（默认基线）'}
                    </dd>
                  </div>
                  {arm.deferredPreferenceLabels.length > 0 && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500 shrink-0">场景静默偏好</dt>
                      <dd className="text-slate-400 text-right">
                        {arm.deferredPreferenceLabels.join('、')}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 shrink-0">表达门裁决</dt>
                    <dd className="text-slate-900 text-right">
                      {EXPRESSION_LABELS[arm.expressionDecision.reasonCode]}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 shrink-0">风格维度 (直/共/主/克)</dt>
                    <dd className="font-mono tabular-nums text-slate-700 text-right">
                      {arm.traits.directness.toFixed(2)} /{' '}
                      {arm.traits.empathyGranularity.toFixed(2)} /{' '}
                      {arm.traits.proactiveCheckIn.toFixed(2)} /{' '}
                      {arm.traits.restraint.toFixed(2)}
                    </dd>
                  </div>
                </dl>

                {reply && (
                  <div className="pt-2.5 border-t border-slate-100">
                    <p className="text-xs text-slate-400 mb-1">流式回复对照输出</p>
                    <p className="text-xs text-slate-900 leading-relaxed whitespace-pre-wrap">
                      {reply}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 人格成长小闭环面板（慢层有界特质 + 中层场景偏好 + 可回滚审计日志） */}
      <PersonaGrowthPanel
        state={personaGrowth}
        currentIntent={latestTrace?.understanding.bridgeInput.intent}
        demoResult={personaGrowthDemo}
        stabilityReport={stabilityReport}
        canRunReflection={sessionTraces.length >= 2}
        shouldSuggestReflection={sessionTraces.length >= 5}
        isReflecting={isReflecting}
        reflectionFeedback={reflectionFeedback}
        onRunReflection={handleRunAsyncReflection}
        onRunDemo={() => {
          const result = runPersonaGrowthDemoScenario();
          persistPersonaGrowth(result.finalState);
          setPersonaGrowthDemo(result);
        }}
        onClearDemo={() => setPersonaGrowthDemo(null)}
        onRunStabilityTest={() => {
          setStabilityReport(runLongHorizonPersonaStabilityTest());
        }}
        onClearStabilityReport={() => setStabilityReport(null)}
        onToggleLock={(key) =>
          persistPersonaGrowth(togglePreferenceLock(personaGrowth, key))
        }
        onRevokePreference={(key) =>
          persistPersonaGrowth(revokeRelationshipPreference(personaGrowth, key))
        }
        onRevertLog={(logId) =>
          persistPersonaGrowth(revertGrowthLogEntry(personaGrowth, logId))
        }
        onReset={() => {
          persistPersonaGrowth(
            createInitialPersonaGrowthState(new Date().toISOString())
          );
          setPersonaGrowthDemo(null);
          setStabilityReport(null);
          setReflectionFeedback(null);
        }}
      />

      {/* 离线五臂消融、16 例标定金标集与我的标注回流评测面板 */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              离线确定性回放与情感标定回归评测
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              支持五臂安全消融（32 例开发集 / 12 例留出集）、16 例金标集，以及直接回流「标注日志」人工样本做 MAE 标定。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div
              className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md"
              role="tablist"
              aria-label="选择回放与标定数据集"
            >
              {(
                [
                  { id: 'adversarial_32', label: '32 例开发集' },
                  { id: 'holdout_12', label: '12 例留出集' },
                  { id: 'calibration_16', label: '16 例金标集' },
                  {
                    id: 'user_annotations',
                    label: `我的标注回流 (${userCalibrationFixtures.length})`,
                  },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={fixtureSuite === item.id}
                  onClick={() => {
                    setFixtureSuite(item.id);
                    if (ablationResults || calibrationReport) {
                      handleRunEvaluation(item.id);
                    }
                  }}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    fixtureSuite === item.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {(ablationResults || calibrationReport) && (
              <button
                type="button"
                onClick={() =>
                  downloadJson(
                    ablationResults ?? {
                      localFastPath: calibrationReport,
                      deepseekSlowPath: llmCalibrationReport,
                    },
                    `dual-loop-eval-${fixtureSuite}.json`
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>导出报告</span>
              </button>
            )}
            {(fixtureSuite === 'calibration_16' ||
              fixtureSuite === 'user_annotations') && (
              <button
                type="button"
                onClick={handleRunLlmCalibrationComparison}
                disabled={
                  isRunningLlmCalibration ||
                  activeCalibrationFixtures.length === 0
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {isRunningLlmCalibration ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {isRunningLlmCalibration
                    ? `DeepSeek 标定中 (${llmCalibrationProgress})…`
                    : 'DeepSeek 慢路对比'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleRunEvaluation(fixtureSuite)}
              disabled={
                fixtureSuite === 'user_annotations' &&
                userCalibrationFixtures.length === 0
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {fixtureSuite === 'calibration_16' ||
                fixtureSuite === 'user_annotations'
                  ? '运行本地标定'
                  : '运行五臂消融'}
              </span>
            </button>
          </div>
        </div>

        {llmCalibrationError && (
          <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-700" role="alert">
            {llmCalibrationError}
          </div>
        )}

        {calibrationReport ? (
          <div className="divide-y divide-slate-200">
            {/* 主指标带：本地快路规则 */}
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              <div className="p-4">
                <p className="text-xs text-slate-500">效价 MAE（越低越好）</p>
                <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {calibrationReport.valenceMae.toFixed(3)}
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">唤醒度 MAE（越低越好）</p>
                <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
                  {calibrationReport.arousalMae.toFixed(3)}
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">四象限一致率</p>
                <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
                  {calibrationReport.quadrantAgreementRate}%
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">沟通诉求准确率</p>
                <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
                  {calibrationReport.intentAccuracyRate}%
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">隐含情绪召回率</p>
                <p className="mt-1 text-lg font-semibold font-mono tabular-nums text-emerald-700">
                  {calibrationReport.implicitCueRecallRate}%
                </p>
              </div>
            </div>

            {/* 本地快路 vs 服务端 DeepSeek 慢路双模式对比表 */}
            {llmCalibrationReport && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="py-2.5 pl-4 pr-3">标定通道对比</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">有效计分样例</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">效价 MAE</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">唤醒度 MAE</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">四象限一致率</th>
                      <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">隐含召回率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    <tr>
                      <td className="py-2.5 pl-4 pr-3 font-medium text-slate-900">
                        本地快路规则（&lt;1 ms）
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {calibrationReport.scoredAffectCases}/{calibrationReport.totalCases}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                        {calibrationReport.valenceMae.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                        {calibrationReport.arousalMae.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {calibrationReport.quadrantAgreementRate}%
                      </td>
                      <td className="py-2.5 pl-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {calibrationReport.implicitCueRecallRate}%
                      </td>
                    </tr>
                    <tr className="bg-blue-50/30">
                      <td className="py-2.5 pl-4 pr-3 font-medium text-blue-900">
                        服务端 DeepSeek（{deepseekModel}）
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        {llmCalibrationReport.scoredAffectCases}/{llmCalibrationReport.totalCases}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                        {llmCalibrationReport.valenceMae.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                        {llmCalibrationReport.arousalMae.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-blue-700 font-semibold">
                        {llmCalibrationReport.quadrantAgreementRate}%
                      </td>
                      <td className="py-2.5 pl-3 pr-4 text-right font-mono tabular-nums text-slate-700">
                        {llmCalibrationReport.implicitCueRecallRate}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* 逐样本误差诊断工具栏与明细表 */}
            {calibrationReport.caseResults && calibrationReport.caseResults.length > 0 && (
              <div className="px-5 py-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCaseDiagnostics((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 transition-colors"
                  >
                    {showCaseDiagnostics ? (
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {showCaseDiagnostics ? '收起' : '展开'}逐样本标定诊断（共{' '}
                      {calibrationReport.caseResults.length} 例）
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const targetReport = llmCalibrationReport ?? calibrationReport;
                      const bundle = buildMismatchRegressionFixtures(
                        activeCalibrationFixtures,
                        targetReport,
                        0.35
                      );
                      downloadJson(
                        bundle,
                        `dual-loop-mismatch-${fixtureSuite}.json`
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span>导出高误差回归集</span>
                  </button>
                </div>

                {showCaseDiagnostics && (
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                          <th className="py-2 pl-3 pr-2 whitespace-nowrap">样例</th>
                          <th className="py-2 px-3">文本与基准象限</th>
                          <th className="py-2 px-3 whitespace-nowrap">本地快路预测</th>
                          {llmCalibrationReport && (
                            <th className="py-2 px-3 whitespace-nowrap">DeepSeek 预测</th>
                          )}
                          <th className="py-2 pl-2 pr-3 text-right whitespace-nowrap">单轴误差</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {calibrationReport.caseResults.map((row) => {
                          const llmRow = llmCalibrationReport?.caseResults?.find(
                            (r) => r.caseId === row.caseId
                          );
                          const isHighError =
                            !row.quadrantMatched ||
                            (row.valenceError ?? 0) >= 0.35 ||
                            (row.arousalError ?? 0) >= 0.35;
                          return (
                            <tr
                              key={row.caseId}
                              className={isHighError ? 'bg-amber-50/40' : 'hover:bg-slate-50/70'}
                            >
                              <td className="py-2 pl-3 pr-2 font-mono text-slate-500 whitespace-nowrap align-top">
                                {row.caseId}
                              </td>
                              <td className="py-2 px-3 text-slate-800 max-w-sm align-top">
                                <p>{row.text}</p>
                                <p className="text-slate-400 mt-0.5 font-mono tabular-nums">
                                  基准：{QUADRANT_SHORT_LABELS[row.expectedQuadrant]}
                                  {row.expectedValence !== null &&
                                    row.expectedArousal !== null &&
                                    ` (${formatCoord(row.expectedValence)}, ${formatCoord(row.expectedArousal)})`}
                                </p>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap align-top">
                                <span
                                  className={
                                    row.quadrantMatched
                                      ? 'font-medium text-emerald-700'
                                      : 'font-medium text-rose-700'
                                  }
                                >
                                  {row.predictedLabel} ·{' '}
                                  {QUADRANT_SHORT_LABELS[row.predictedQuadrant]}
                                </span>
                                {row.predictedValence !== null &&
                                  row.predictedArousal !== null && (
                                    <p className="text-slate-400 font-mono tabular-nums mt-0.5">
                                      ({formatCoord(row.predictedValence)},{' '}
                                      {formatCoord(row.predictedArousal)})
                                      {row.implicitCue ? ' · 隐含' : ''}
                                    </p>
                                  )}
                              </td>
                              {llmCalibrationReport && (
                                <td className="py-2 px-3 whitespace-nowrap align-top">
                                  {llmRow ? (
                                    <>
                                      <span
                                        className={
                                          llmRow.quadrantMatched
                                            ? 'font-medium text-blue-700'
                                            : 'font-medium text-rose-700'
                                        }
                                      >
                                        {llmRow.predictedLabel} ·{' '}
                                        {QUADRANT_SHORT_LABELS[llmRow.predictedQuadrant]}
                                      </span>
                                      {llmRow.predictedValence !== null &&
                                        llmRow.predictedArousal !== null && (
                                          <p className="text-slate-400 font-mono tabular-nums mt-0.5">
                                            ({formatCoord(llmRow.predictedValence)},{' '}
                                            {formatCoord(llmRow.predictedArousal)})
                                          </p>
                                        )}
                                    </>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              )}
                              <td className="py-2 pl-2 pr-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap align-top">
                                {row.valenceError !== null && row.arousalError !== null
                                  ? `ΔV ${row.valenceError.toFixed(2)} / ΔA ${row.arousalError.toFixed(2)}`
                                  : row.quadrantMatched
                                    ? '一致'
                                    : '漏召回'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : ablationResults ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pl-4 pr-3">实验臂</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">危机零写入</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">语境状态污染</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">真阳性命中</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">表达放行</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">重复拦截</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">最大单步增量</th>
                  <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">终态 (V, A)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {ablationResults.map((arm) => {
                  const crisisOk = arm.crisisBypassed === arm.crisisTotal;
                  const cleanAmbig = arm.ambiguousFalsePositives === 0;
                  return (
                    <tr key={arm.armId} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 pl-4 pr-3 font-medium text-slate-900 whitespace-nowrap">
                        {arm.label}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums ${
                          crisisOk ? 'text-emerald-700' : 'text-rose-700 font-semibold'
                        }`}
                      >
                        {arm.crisisBypassed}/{arm.crisisTotal}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums ${
                          cleanAmbig ? 'text-emerald-700' : 'text-rose-700 font-semibold'
                        }`}
                      >
                        {arm.ambiguousFalsePositives}/{arm.ambiguousTotal}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {arm.explicitSelfMatched}/{arm.explicitSelfTotal}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {arm.expressionAllowedCount}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {arm.duplicateBlockedCount}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900">
                        {arm.maxSingleStepDelta.toFixed(4)}
                      </td>
                      <td className="py-3 pl-3 pr-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        ({formatCoord(arm.finalState.valence)},{' '}
                        {formatCoord(arm.finalState.arousal)})
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-xs text-slate-500">
            选择数据集并点击右上角按钮，立即运行五臂消融回放或 16 例情感标定金标集 MAE 回归测试。
          </div>
        )}
      </section>
    </div>
  );
};
