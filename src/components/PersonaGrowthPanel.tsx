import React from 'react';
import {
  Activity,
  Loader2,
  Lock,
  Play,
  RotateCcw,
  Sparkles,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import {
  PersonaGrowthState,
  PersonaTraitKey,
  RelationshipPreferenceKey,
  UserIntentKind,
} from '../dual-loop/contracts';
import {
  PREFERENCE_SCOPE_LABELS,
  resolveActivePreferencesForIntent,
  TRAIT_METADATA,
} from '../dual-loop/personaGrowth';
import {
  LongHorizonStabilityReport,
  PersonaGrowthDemoResult,
} from '../dual-loop/personaGrowthDemo';

interface PersonaGrowthPanelProps {
  readonly state: PersonaGrowthState;
  readonly currentIntent?: UserIntentKind;
  readonly demoResult: PersonaGrowthDemoResult | null;
  readonly stabilityReport: LongHorizonStabilityReport | null;
  readonly canRunReflection: boolean;
  readonly shouldSuggestReflection?: boolean;
  readonly isReflecting: boolean;
  readonly reflectionFeedback: {
    readonly type: 'success' | 'error';
    readonly message: string;
  } | null;
  readonly onRunReflection: () => void;
  readonly onRunDemo: () => void;
  readonly onClearDemo: () => void;
  readonly onRunStabilityTest: () => void;
  readonly onClearStabilityReport: () => void;
  readonly onToggleLock: (key: RelationshipPreferenceKey) => void;
  readonly onRevokePreference: (key: RelationshipPreferenceKey) => void;
  readonly onRevertLog: (logId: string) => void;
  readonly onReset: () => void;
}

const TRAIT_LABELS: Record<PersonaTraitKey, string> = {
  directness: '直接程度',
  empathyGranularity: '共情细腻度',
  proactiveCheckIn: '主动关切度',
  restraint: '表达克制度',
};

const TRIGGER_LABELS: Record<string, string> = {
  refusal_feedback: '边界拒绝反馈',
  correction_feedback: '用户纠错反馈',
  explicit_preference: '显式偏好声明',
  pattern_consolidation: '多轮模式整合',
  reflection_consolidation: '异步反思沉淀',
  homeostatic_decay: '稳态回归',
};

const GATE_REASON_SHORT: Record<string, string> = {
  yield_to_crisis: '危机让位',
  yield_to_user_negative: '用户强负面让位',
  yield_to_persona_boundary: '低打扰边界让位',
  below_deadzone: '低于死区静默',
  untraceable_source: '无证据静默',
  budget_exhausted: '预算用尽静默',
  allowed_grounded: '接地放行',
};

function formatSignedDelta(delta: number): string {
  const fixed = delta.toFixed(3);
  return delta > 0 ? `+${fixed}` : fixed;
}

export const PersonaGrowthPanel: React.FC<PersonaGrowthPanelProps> = ({
  state,
  currentIntent,
  demoResult,
  stabilityReport,
  canRunReflection,
  shouldSuggestReflection = false,
  isReflecting,
  reflectionFeedback,
  onRunReflection,
  onRunDemo,
  onClearDemo,
  onRunStabilityTest,
  onClearStabilityReport,
  onToggleLock,
  onRevokePreference,
  onRevertLog,
  onReset,
}) => {
  const hasAnyGrowth =
    state.preferences.length > 0 ||
    state.changelog.length > 0 ||
    TRAIT_METADATA.some(
      (meta) =>
        Math.abs(state.traits[meta.key] - state.baselineTraits[meta.key]) > 1e-6
    );

  const scopedResolution = currentIntent
    ? resolveActivePreferencesForIntent(state.preferences, currentIntent)
    : null;
  const deferredMap = new Map(
    scopedResolution?.deferredPreferences.map((d) => [d.preference.key, d.reason]) ??
      []
  );

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            人格成长小闭环（中层场景偏好 + 慢层有界特质）
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            安全底线与危机让位不可改写；偏好按场景作用域隔离防冲突（事务/求助 vs 倾诉陪伴），单轮步长 ≤ 0.03、相对初始基线最大偏移 ±
            {state.maxTraitDrift.toFixed(2)}。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 self-start lg:self-auto">
          <button
            type="button"
            onClick={onRunReflection}
            disabled={!canRunReflection || isReflecting}
            title={
              canRunReflection
                ? '调用服务端受控异步反思接口，从近期多轮对话提炼跨轮偏好候选'
                : '请先执行至少 2 轮对话，再运行异步反思提炼'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            {isReflecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{isReflecting ? '反思提炼中…' : '服务端异步反思'}</span>
          </button>
          <button
            type="button"
            onClick={onRunDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" aria-hidden="true" />
            <span>运行 7 轮测试 Demo</span>
          </button>
          <button
            type="button"
            onClick={onRunStabilityTest}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Activity className="w-3.5 h-3.5" aria-hidden="true" />
            <span>30 轮稳态压测</span>
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={!hasAnyGrowth && !demoResult && !stabilityReport}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>重置初始人设</span>
          </button>
        </div>
      </div>

      {shouldSuggestReflection && !isReflecting && !reflectionFeedback && (
        <p className="text-xs text-slate-600">
          当前已累计多轮连续对话，建议点击上方「服务端异步反思」提炼跨轮次沟通习惯偏好。
        </p>
      )}

      {reflectionFeedback && (
        <p
          role={reflectionFeedback.type === 'error' ? 'alert' : 'status'}
          className={`text-xs ${
            reflectionFeedback.type === 'error'
              ? 'text-rose-700'
              : 'text-emerald-700'
          }`}
        >
          {reflectionFeedback.message}
        </p>
      )}

      {/* 30 轮长程稳态压力测试结果 */}
      {stabilityReport && (
        <div className="pb-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                30 轮长程混合稳态压力测试报告
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                ·
              </span>
              <span
                className={
                  stabilityReport.allPassed
                    ? 'font-medium text-emerald-700'
                    : 'font-medium text-rose-700'
                }
              >
                {stabilityReport.allPassed ? '全部安全不变量通过' : '检测到稳态违例'}
              </span>
            </div>
            <button
              type="button"
              onClick={onClearStabilityReport}
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              收起压测报告
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-200 rounded-md divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-3">
              <p className="text-xs text-slate-500">模拟总轮次 / 变更日志</p>
              <p className="mt-1 text-sm font-semibold font-mono tabular-nums text-slate-900">
                {stabilityReport.totalTurns} 轮 / {stabilityReport.changelogCount} 条
              </p>
            </div>
            <div className="p-3">
              <p className="text-xs text-slate-500">最大特质漂移（上限 ±{stabilityReport.driftLimit.toFixed(2)}）</p>
              <p
                className={`mt-1 text-sm font-semibold font-mono tabular-nums ${
                  stabilityReport.withinDriftEnvelope ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                ±{stabilityReport.maxObservedDrift.toFixed(3)}
              </p>
            </div>
            <div className="p-3">
              <p className="text-xs text-slate-500">危机核写入次数（{stabilityReport.crisisTurns} 次危机）</p>
              <p
                className={`mt-1 text-sm font-semibold font-mono tabular-nums ${
                  stabilityReport.crisisWrites === 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {stabilityReport.crisisWrites} 次
              </p>
            </div>
            <div className="p-3">
              <p className="text-xs text-slate-500">互斥偏好作用域冲突</p>
              <p
                className={`mt-1 text-sm font-semibold font-mono tabular-nums ${
                  stabilityReport.scopeConflicts === 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {stabilityReport.scopeConflicts} 次
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2 pl-3 pr-2 whitespace-nowrap">关键轮次</th>
                  <th className="py-2 px-3">代表语句</th>
                  <th className="py-2 px-3">稳态审计说明</th>
                  <th className="py-2 pl-2 pr-3 text-right whitespace-nowrap">累计最大漂移</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {stabilityReport.milestones.map((m) => (
                  <tr key={m.turn} className="hover:bg-slate-50/70">
                    <td className="py-2 pl-3 pr-2 font-medium text-slate-900 whitespace-nowrap align-top">
                      <span className="font-mono tabular-nums text-slate-400 mr-1.5">
                        #{String(m.turn).padStart(2, '0')}
                      </span>
                      {m.phase}
                    </td>
                    <td className="py-2 px-3 text-slate-700 max-w-xs align-top">
                      {m.utterance}
                    </td>
                    <td className="py-2 px-3 text-slate-600 align-top">
                      <p>{m.note}</p>
                      <p className="text-slate-400 mt-0.5">
                        当前生效偏好：
                        {m.activePreferences.length > 0
                          ? m.activePreferences.join('、')
                          : '无'}
                      </p>
                    </td>
                    <td className="py-2 pl-2 pr-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      ±{m.maxDriftSoFar.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 一键 7 轮端到端测试 Demo 逐轮验证明细 */}
      {demoResult && (
        <div className="pb-4 border-b border-slate-200 space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              <span className="font-semibold text-slate-900">
                7 轮成长闭环与场景防冲突 Demo 结果
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                ·
              </span>
              <span
                className={
                  demoResult.allPassed
                    ? 'font-medium text-emerald-700'
                    : 'font-medium text-rose-700'
                }
              >
                {demoResult.steps.filter((s) => s.passed).length}/{demoResult.steps.length} 项校验通过
              </span>
              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                ·
              </span>
              <span>已载入下方实时面板，可直接测试锁定、撤销或单条回滚</span>
            </div>
            <button
              type="button"
              onClick={onClearDemo}
              className="text-xs text-slate-500 hover:text-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              收起演示明细
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2 pl-3 pr-2 whitespace-nowrap">轮次与场景</th>
                  <th className="py-2 px-3">测试原话</th>
                  <th className="py-2 px-3">成长结果与场景作用域解析</th>
                  <th className="py-2 px-3 whitespace-nowrap">表达门裁决</th>
                  <th className="py-2 pl-2 pr-3 text-right whitespace-nowrap">校验</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {demoResult.steps.map((step) => (
                  <tr key={step.turn} className="hover:bg-slate-50/70">
                    <td className="py-2.5 pl-3 pr-2 font-medium text-slate-900 whitespace-nowrap align-top">
                      <span className="font-mono tabular-nums text-slate-400 mr-1.5">
                        0{step.turn}
                      </span>
                      {step.title}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-xs align-top">
                      {step.utterance}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 align-top">
                      <p>{step.growthOutcome}</p>
                      {(step.activePreferenceLabels.length > 0 ||
                        step.deferredPreferenceLabels.length > 0) && (
                        <p className="text-slate-500 mt-0.5">
                          生效：
                          {step.activePreferenceLabels.length > 0
                            ? step.activePreferenceLabels.join('、')
                            : '无'}
                          {step.deferredPreferenceLabels.length > 0 && (
                            <>
                              <span aria-hidden="true" className="mx-1.5 text-slate-300">
                                ·
                              </span>
                              场景静默：{step.deferredPreferenceLabels.join('、')}
                            </>
                          )}
                        </p>
                      )}
                      <p className="text-slate-400 mt-0.5">{step.assertionNote}</p>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap align-top">
                      {GATE_REASON_SHORT[step.expressionReasonCode] ??
                        step.expressionReasonCode}
                    </td>
                    <td
                      className={`py-2.5 pl-2 pr-3 text-right font-medium whitespace-nowrap align-top ${
                        step.passed ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {step.passed ? '通过' : '未通过'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 两栏平衡布局：慢层有界特质 + 中层关系偏好 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* 慢层：有界特质微调 */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-900">
              慢层有界特质（稳态回弹 + 硬偏移边界）
            </h4>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              包络 ±{state.maxTraitDrift.toFixed(2)}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {TRAIT_METADATA.map((meta) => {
              const baseline = state.baselineTraits[meta.key];
              const current = state.traits[meta.key];
              const delta = Math.round((current - baseline) * 1000) / 1000;
              const minBound = Math.max(0, baseline - state.maxTraitDrift);
              const maxBound = Math.min(1, baseline + state.maxTraitDrift);
              const baselinePct = baseline * 100;
              const currentPct = current * 100;
              const minPct = minBound * 100;
              const bandWidthPct = (maxBound - minBound) * 100;

              return (
                <div key={meta.key} className="py-2.5 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-slate-900 whitespace-nowrap">
                        {meta.label}
                      </span>
                      <span className="text-slate-400 truncate">
                        {meta.lowHint} / {meta.highHint}
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-slate-900 whitespace-nowrap shrink-0">
                      {current.toFixed(3)}
                      <span
                        className={`ml-2 ${
                          Math.abs(delta) < 1e-6
                            ? 'text-slate-400'
                            : delta > 0
                              ? 'text-blue-700'
                              : 'text-amber-700'
                        }`}
                      >
                        ({formatSignedDelta(delta)})
                      </span>
                    </div>
                  </div>

                  {/* 0..1 刻度轨 + 允许偏移走廊 + 基线锚点 + 当前值指针 */}
                  <div className="relative h-2 bg-slate-100 rounded-sm overflow-hidden">
                    <div
                      className="absolute top-0 bottom-0 bg-blue-100/80"
                      style={{
                        left: `${minPct}%`,
                        width: `${bandWidthPct}%`,
                      }}
                      aria-hidden="true"
                    />
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-slate-400"
                      style={{ left: `${baselinePct}%` }}
                      title={`初始基线 ${baseline.toFixed(2)}`}
                      aria-hidden="true"
                    />
                    <div
                      className="absolute top-0 bottom-0 w-1.5 bg-slate-900 rounded-xs transition-transform duration-150"
                      style={{ left: `calc(${currentPct}% - 3px)` }}
                      aria-hidden="true"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-slate-500 pt-1">
            不可变核：安全底线、诚实边界与危机无条件让位锁定在规则层，任何对话均不可修改。
          </p>
        </div>

        {/* 中层：关系与协作偏好（带场景作用域隔离） */}
        <div className="space-y-3 lg:border-l lg:border-slate-200 lg:pl-6">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-900">
              中层关系偏好（场景作用域防冲突 · 支持锁定）
            </h4>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {scopedResolution
                ? `本轮生效 ${scopedResolution.activePreferences.length}/${state.preferences.length}`
                : `已记录 ${state.preferences.length} 项`}
            </span>
          </div>

          {state.preferences.length === 0 ? (
            <div className="py-5 text-xs text-slate-500 leading-relaxed">
              尚未沉淀关系偏好。可点击上方「运行 7 轮测试 Demo」或「偏好纠偏（先给方案）」，观察不同场景作用域偏好如何互不冲突地切换生效。
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {state.preferences.map((pref) => {
                const deferredReason = deferredMap.get(pref.key);
                const isDeferredNow = Boolean(deferredReason);
                return (
                  <li
                    key={pref.key}
                    className={`py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3 ${
                      isDeferredNow ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-medium text-slate-900">
                        {pref.label}
                        <span aria-hidden="true" className="mx-1.5 text-slate-300">
                          ·
                        </span>
                        <span className="font-normal text-slate-500">
                          {PREFERENCE_SCOPE_LABELS[pref.scope]}
                        </span>
                        {scopedResolution && (
                          <>
                            <span aria-hidden="true" className="mx-1.5 text-slate-300">
                              ·
                            </span>
                            <span
                              className={
                                isDeferredNow
                                  ? 'font-normal text-slate-400'
                                  : 'font-medium text-emerald-700'
                              }
                            >
                              {isDeferredNow ? '本轮静默' : '本轮生效'}
                            </span>
                          </>
                        )}
                      </p>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {isDeferredNow ? deferredReason : pref.description}
                      </p>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        置信度 {Math.round(pref.confidence * 100)}% · 证据 {pref.evidenceCount} 次 ·{' '}
                        {pref.locked ? '已锁定（不衰减）' : '7 天自动衰减'}
                      </p>
                    </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleLock(pref.key)}
                      aria-label={pref.locked ? `解锁偏好 ${pref.label}` : `锁定偏好 ${pref.label}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded transition-colors whitespace-nowrap shrink-0"
                    >
                      {pref.locked ? (
                        <>
                          <Lock className="w-3 h-3" aria-hidden="true" />
                          <span>解锁</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3 h-3" aria-hidden="true" />
                          <span>锁定</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRevokePreference(pref.key)}
                      aria-label={`撤销偏好 ${pref.label}`}
                      className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 底部：可审计成长变更日志 + 单条回滚 */}
      <div className="pt-4 border-t border-slate-200 space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-xs font-semibold text-slate-900">
            成长变更审计日志（证据可追溯 · 支持单条精确回滚）
          </h4>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            共 {state.changelog.length} 条记录
          </span>
        </div>

        {state.changelog.length === 0 ? (
          <p className="text-xs text-slate-500">
            暂无成长变更记录。普通闲聊、第三方转述与危机信号不会触发人格改写。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2 pr-3 whitespace-nowrap">来源事件</th>
                  <th className="py-2 px-3 whitespace-nowrap">触发类型</th>
                  <th className="py-2 px-3">变更说明与特质微调</th>
                  <th className="py-2 pl-3 text-right whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {state.changelog.slice(0, 8).map((entry) => {
                  const deltaSummary = (
                    Object.entries(entry.traitDeltas) as Array<[PersonaTraitKey, number]>
                  )
                    .filter(([, val]) => typeof val === 'number' && Math.abs(val) > 1e-6)
                    .map(([k, val]) => `${TRAIT_LABELS[k]} ${formatSignedDelta(val)}`)
                    .join(' · ');

                  return (
                    <tr
                      key={entry.id}
                      className={entry.reverted ? 'opacity-55' : 'hover:bg-slate-50/70'}
                    >
                      <td className="py-2.5 pr-3 font-mono tabular-nums text-slate-600 whitespace-nowrap align-top">
                        {entry.eventId}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap align-top">
                        {TRIGGER_LABELS[entry.triggerKind] ?? entry.triggerKind}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 align-top">
                        <p className={entry.reverted ? 'line-through text-slate-500' : ''}>
                          {entry.summary}
                        </p>
                        {deltaSummary && (
                          <p className="text-slate-400 font-mono tabular-nums mt-0.5">
                            {deltaSummary}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 text-right whitespace-nowrap align-top">
                        {entry.reverted ? (
                          <span className="text-slate-400">已回滚</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onRevertLog(entry.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 rounded transition-colors whitespace-nowrap shrink-0"
                          >
                            <Undo2 className="w-3 h-3" aria-hidden="true" />
                            <span>回滚此条</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
