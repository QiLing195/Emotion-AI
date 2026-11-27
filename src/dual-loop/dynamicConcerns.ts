import { getQuadrant } from '../data/affectLexicon';
import {
  AffectBridgeDecision,
  CalibrationCaseDiagnostic,
  CalibrationCaseFixture,
  CalibrationReport,
  CurrentConcern,
  UnderstandingResult,
  UserIntentKind,
} from './contracts';
import { runUnderstandingTurn } from './understandingLoop';

export const MAX_DYNAMIC_CONCERNS = 4;
export const DEFAULT_DYNAMIC_CONCERN_TTL_HOURS = 24;

/**
 * 清理已过期的动态关切，保证关切严格有时效上限、不演变为永久人格漂移。
 */
export function pruneExpiredConcerns(
  concerns: readonly CurrentConcern[],
  nowIso: string
): CurrentConcern[] {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return [...concerns];
  return concerns.filter((c) => {
    if (c.origin !== 'dynamic') return true;
    const expMs = Date.parse(c.expiresAt);
    return Number.isFinite(expMs) && expMs > nowMs;
  });
}

/**
 * 基于已通过严格归因核验的用户自述，受控生成或续期带事件溯源与 TTL 的动态关切。
 * - 绝不在危机、拒谈、第三方/引述/高不确定度样本上创建关切。
 * - 动态关切数量受 maxDynamic 上限约束，超出时淘汰最早过期项。
 */
export function upsertDynamicConcernFromTurn(
  existingConcerns: readonly CurrentConcern[],
  understanding: UnderstandingResult,
  decision: AffectBridgeDecision,
  nowIso: string,
  ttlHours: number = DEFAULT_DYNAMIC_CONCERN_TTL_HOURS,
  maxDynamic: number = MAX_DYNAMIC_CONCERNS
): {
  readonly concerns: CurrentConcern[];
  readonly promotedConcern: CurrentConcern | null;
} {
  const active = pruneExpiredConcerns(existingConcerns, nowIso);
  const input = understanding.bridgeInput;

  const isEligibleSelfReport =
    !input.crisisFlag &&
    !input.userRefusal &&
    input.subject === 'user' &&
    input.reportedBy === 'user' &&
    input.reportKind === 'explicit_self_report' &&
    (input.temporalScope === 'moment' || input.temporalScope === 'interval') &&
    input.evidenceIds.length > 0 &&
    input.certainty !== 'unknown' &&
    input.certainty >= 0.7 &&
    input.inferenceUncertainty !== 'unknown' &&
    input.inferenceUncertainty <= 0.35;

  if (!isEligibleSelfReport) {
    return { concerns: active, promotedConcern: null };
  }

  // 若已命中现有默认关切且未缺失，无需重复创建动态副本
  if (decision.decision === 'care_response_candidate' && decision.matchedConcernId) {
    return { concerns: active, promotedConcern: null };
  }

  const primaryHyp = input.hypotheses.find((h) => !h.isAlternative);
  if (!primaryHyp || !primaryHyp.label.trim()) {
    return { concerns: active, promotedConcern: null };
  }

  const label = primaryHyp.label.trim();
  const nowMs = Date.parse(nowIso);
  const safeBaseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const expiresAt = new Date(safeBaseMs + ttlHours * 3_600_000).toISOString();

  const existingDynamicIdx = active.findIndex(
    (c) => c.origin === 'dynamic' && c.topicKeywords.includes(label)
  );

  if (existingDynamicIdx >= 0) {
    const refreshed: CurrentConcern = {
      ...active[existingDynamicIdx],
      sourceEventId: understanding.eventId,
      expiresAt,
    };
    const next = [...active];
    next[existingDynamicIdx] = refreshed;
    return { concerns: next, promotedConcern: refreshed };
  }

  const vDir: -1 | 0 | 1 =
    typeof primaryHyp.valence === 'number'
      ? primaryHyp.valence >= 0
        ? 1
        : -1
      : 0;
  const aDir: -1 | 0 | 1 =
    typeof primaryHyp.arousal === 'number'
      ? primaryHyp.arousal >= 0
        ? 1
        : -1
      : 0;

  const newConcern: CurrentConcern = {
    id: `concern-dyn-${understanding.eventId}`,
    topicKeywords: [label],
    targetValenceDirection: vDir,
    targetArousalDirection: aDir,
    weight: 0.55,
    sourceEventId: understanding.eventId,
    expiresAt,
    origin: 'dynamic',
  };

  const defaults = active.filter((c) => c.origin !== 'dynamic');
  const dynamics = [...active.filter((c) => c.origin === 'dynamic'), newConcern]
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(-maxDynamic);

  return {
    concerns: [...defaults, ...dynamics],
    promotedConcern: newConcern,
  };
}

export function revokeDynamicConcern(
  concerns: readonly CurrentConcern[],
  concernId: string
): CurrentConcern[] {
  return concerns.filter(
    (c) => !(c.origin === 'dynamic' && c.id === concernId)
  );
}

/**
 * 将用户在「情绪平面 / 标注日志」中人工保存的标注记录回流转换为双环标定回归样例。
 */
export function annotationsToCalibrationFixtures(
  annotations: ReadonlyArray<{
    readonly id: string;
    readonly utterance: string;
    readonly valence: number;
    readonly arousal: number;
    readonly quadrant:
      | 'high-positive'
      | 'low-positive'
      | 'high-negative'
      | 'low-negative';
    readonly primaryLabel: string;
    readonly context: string;
  }>
): CalibrationCaseFixture[] {
  return annotations
    .filter((item) => item.utterance.trim().length > 0)
    .map((item) => ({
      id: item.id,
      text: item.utterance.trim(),
      expectedValence: item.valence,
      expectedArousal: item.arousal,
      expectedQuadrant: item.quadrant,
      note: `${item.context} · 人工标签「${item.primaryLabel}」`,
    }));
}

export interface ExternalCalibrationPrediction {
  readonly valence: number | null;
  readonly arousal: number | null;
  readonly primaryLabel: string;
  readonly intent?: UserIntentKind;
  readonly implicitCue?: boolean;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 通用标定评测聚合器：支持对本地规则输出或服务端 DeepSeek 预测结果执行统一口径的 MAE / 四象限 / 诉求 / 隐含召回与逐样本诊断。
 */
export function evaluateCalibrationWithPredictions(
  cases: readonly CalibrationCaseFixture[],
  predictionsByCaseId: ReadonlyMap<string, ExternalCalibrationPrediction>
): CalibrationReport {
  let scoredAffectCases = 0;
  let valenceAbsErrSum = 0;
  let arousalAbsErrSum = 0;
  let quadrantHits = 0;
  let intentTotal = 0;
  let intentHits = 0;
  let implicitTotal = 0;
  let implicitHits = 0;
  const caseResults: CalibrationCaseDiagnostic[] = [];

  for (const item of cases) {
    const pred = predictionsByCaseId.get(item.id);
    const hasCoords =
      pred !== undefined &&
      typeof pred.valence === 'number' &&
      Number.isFinite(pred.valence) &&
      typeof pred.arousal === 'number' &&
      Number.isFinite(pred.arousal);

    const predictedValence = hasCoords ? round3(pred!.valence!) : null;
    const predictedArousal = hasCoords ? round3(pred!.arousal!) : null;
    const predictedQuadrant: CalibrationCaseFixture['expectedQuadrant'] = hasCoords
      ? getQuadrant(predictedValence!, predictedArousal!)
      : 'none';
    const predictedLabel = pred?.primaryLabel?.trim() || '无判断';
    const implicitCue = Boolean(pred?.implicitCue);

    if (item.expectedIntent) {
      intentTotal += 1;
      if (pred?.intent === item.expectedIntent) {
        intentHits += 1;
      }
    }

    if (item.isImplicit) {
      implicitTotal += 1;
      if (hasCoords && (implicitCue || predictedQuadrant === item.expectedQuadrant)) {
        implicitHits += 1;
      }
    }

    const quadrantMatched = predictedQuadrant === item.expectedQuadrant;
    if (quadrantMatched) {
      quadrantHits += 1;
    }

    let valenceError: number | null = null;
    let arousalError: number | null = null;
    if (
      item.expectedValence !== null &&
      item.expectedArousal !== null &&
      predictedValence !== null &&
      predictedArousal !== null
    ) {
      scoredAffectCases += 1;
      valenceError = round3(Math.abs(predictedValence - item.expectedValence));
      arousalError = round3(Math.abs(predictedArousal - item.expectedArousal));
      valenceAbsErrSum += valenceError;
      arousalAbsErrSum += arousalError;
    }

    caseResults.push({
      caseId: item.id,
      text: item.text,
      note: item.note,
      expectedValence: item.expectedValence,
      expectedArousal: item.expectedArousal,
      expectedQuadrant: item.expectedQuadrant,
      predictedValence,
      predictedArousal,
      predictedQuadrant,
      predictedLabel,
      valenceError,
      arousalError,
      quadrantMatched,
      implicitCue,
    });
  }

  const total = cases.length || 1;
  return {
    totalCases: cases.length,
    scoredAffectCases,
    valenceMae:
      scoredAffectCases > 0 ? round3(valenceAbsErrSum / scoredAffectCases) : 0,
    arousalMae:
      scoredAffectCases > 0 ? round3(arousalAbsErrSum / scoredAffectCases) : 0,
    quadrantAgreementRate: Math.round((quadrantHits / total) * 100),
    intentAccuracyRate:
      intentTotal > 0 ? Math.round((intentHits / intentTotal) * 100) : 100,
    implicitCueRecallRate:
      implicitTotal > 0 ? Math.round((implicitHits / implicitTotal) * 100) : 100,
    caseResults,
  };
}

/**
 * 情感分析金标回归评测器：使用本地确定性理解环规则计算效价/唤醒度 MAE、象限一致率、诉求准确率、隐含召回率及逐例诊断。
 */
export function evaluateCalibrationBenchmark(
  cases: readonly CalibrationCaseFixture[]
): CalibrationReport {
  const predictions = new Map<string, ExternalCalibrationPrediction>();

  for (let i = 0; i < cases.length; i += 1) {
    const item = cases[i];
    const result = runUnderstandingTurn({
      eventId: `cal-${item.id}`,
      actor: 'user',
      text: item.text,
      timestamp: `2026-11-26T08:${String(i % 60).padStart(2, '0')}:00Z`,
    });

    const input = result.bridgeInput;
    const primary = input.hypotheses.find((h) => !h.isAlternative);
    const hasCoords =
      primary !== undefined &&
      typeof primary.valence === 'number' &&
      typeof primary.arousal === 'number';

    predictions.set(item.id, {
      valence: hasCoords ? primary!.valence! : null,
      arousal: hasCoords ? primary!.arousal! : null,
      primaryLabel: primary?.label ?? '无判断',
      intent: input.intent,
      implicitCue: Boolean(input.implicitCue),
    });
  }

  return evaluateCalibrationWithPredictions(cases, predictions);
}

export interface MismatchRegressionBundle {
  readonly exportedAt: string;
  readonly errorThreshold: number;
  readonly totalEvaluated: number;
  readonly mismatchCount: number;
  readonly fixtures: readonly CalibrationCaseFixture[];
  readonly diagnostics: readonly CalibrationCaseDiagnostic[];
}

/**
 * 筛选象限不一致或单轴误差 >= errorThreshold 的高误差样本，导出为可直接复用的回归测试夹具 JSON。
 */
export function buildMismatchRegressionFixtures(
  cases: readonly CalibrationCaseFixture[],
  report: CalibrationReport,
  errorThreshold: number = 0.35
): MismatchRegressionBundle {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const diagnostics = (report.caseResults ?? []).filter((row) => {
    if (!row.quadrantMatched) return true;
    const vErr = row.valenceError ?? 0;
    const aErr = row.arousalError ?? 0;
    return vErr >= errorThreshold || aErr >= errorThreshold;
  });

  const fixtures = diagnostics
    .map((d) => caseById.get(d.caseId))
    .filter((item): item is CalibrationCaseFixture => Boolean(item));

  return {
    exportedAt: new Date().toISOString(),
    errorThreshold,
    totalEvaluated: report.totalCases,
    mismatchCount: fixtures.length,
    fixtures,
    diagnostics,
  };
}
