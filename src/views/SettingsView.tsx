import React, { useCallback, useEffect, useState } from 'react';
import { useAIBrainStore, Provider, TTSSettings } from '../store/useAIBrainStore';
import {
  describeVoicePerformance,
  timbreLabel,
  type VoiceArcView,
  type VoicePerformanceView,
} from '../lib/voiceTone';
import { emotionLabel } from '../lib/emotionActivation';

/** `/state → activation` 的形状（服务端算好的「她被激起了什么」） */
/** v1.25 `/state → activationTypical`：相对**她最近一段时间的常态**的读数（并排的第二读法，只读诊断） */
interface TypicalActivationView {
  activeEmotion: string | null;
  activeIntensity: number;
  runnerUp: string | null;
  runnerUpIntensity: number;
  clear: boolean;
  resting: boolean;
  suppressed: string[];
  delta: Record<string, number>;
  reference: Record<string, number>;
  note: string;
  halfLifeHours: number;
  updatedAt: number | null;
}
interface ActivationView {
  activeEmotion: string | null;
  activeIntensity: number;
  runnerUp: string | null;
  runnerUpIntensity: number;
  clear: boolean;
  resting: boolean;
  suppressed: string[];
  delta: Record<string, number>;
  note: string;
}

/** v1.22 `/state → memoryTrace`：本轮**哪几条记忆**进了 Prompt，以及选择时的判据 */
interface MemoryTraceEntry {
  source: string;
  score: number;
  emotion: string | null;
  tags: string[];
  text: string;
}
interface MemoryTrace {
  at: number;
  round: number | null;
  herState: string;
  strategy: string;
  strategyReason: string;
  injected: MemoryTraceEntry[];
  graph: MemoryTraceEntry[];
  proactive: { picked: string | null; approach: string | null; injection: string | null };
  motive: { kind: string; content: string; salience: number } | null;
}

/** `/state` 里"她的内在生活"那几块（v1.8 起的 mood/rumination/emergence/motive/shadow，此前前端从不消费） */
interface InnerLifeView {
  internalNarrative: string;
  mood: { description: string; valence: number; samples: number } | null;
  rumination: { description: string; emotion: string; streak: number } | null;
  emergence: { turns: number; internalShare: number; userShare: number; stuck: boolean; note: string } | null;
  motive: {
    description: string;
    thisTurn: { kind: string | null; deferred: boolean; reason: string } | null;
    lastSelected: { kind: string; content: string; attempts: number } | null;
    poolSize: number;
  } | null;
  shadow: {
    activeTraits: Array<{ id: string; label: string; confidence: number }>;
    accumulating: Array<{ id: string; label: string; confidence: number; evidenceCount: number }>;
    lastDetectionRound: number;
    totalDetections: number;
  } | null;
}

/**
 * v1.26 `/state → longTermDrift`：她要「被经历塑造」那条路（长周期人格漂移）。
 *
 * 与服务端同一条理由：以前这个字段只在漂移**真的发生之后**才有值，重启后是 `null` ——
 * 界面上"什么都没有"，看不出是**还没到评估点**还是**通路挂了**。现在恒定有结构：
 * 开关 / 轮次进度 / 门槛 / 逐参数的单次上限 / 当前人格参数 + 最近一次结果（若有）。
 */
interface LongTermDriftView {
  enabled: boolean;
  round: number;
  intervalRounds: number;
  minEpisodes: number;
  scale: Record<string, number>;
  nextDueRound: number;
  current: { trust: number; openness: number; playfulness: number; resilience: number } | null;
  last: {
    round: number;
    at: number;
    changes: Record<string, number>;
    velocities: Record<string, number>;
    sampled: number;
    skipped: string | null;
  } | null;
}

function StatRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2 border-b border-slate-100 last:border-b-0">
      <span className="text-xs text-slate-400 shrink-0 pt-0.5" title={hint}>{label}</span>
      <span className="text-xs text-slate-600 text-right">{value}</span>
    </div>
  );
}

/** 记忆条目：来源 / 分数 / 情绪匹配 / 正文摘要 —— 分数就是它**为什么排在别人前面** */
function MemoryEntryList({ items, empty }: { items: MemoryTraceEntry[]; empty: string }) {
  if (items.length === 0) return <div className="px-4 py-2 text-xs text-slate-300">{empty}</div>;
  return (
    <div className="divide-y divide-slate-100">
      {items.map((m, i) => (
        <div key={`${m.source}-${i}`} className="px-4 py-2 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-slate-500">{m.source}</span>
            <span className="text-[10px] font-mono text-slate-400">score {m.score.toFixed(3)}</span>
            {m.emotion && (
              <span className="text-[10px] font-mono text-slate-400">情绪 {emotionLabel(m.emotion)}</span>
            )}
            {m.tags.slice(0, 3).map(t => (
              <span key={t} className="px-1 py-0.5 rounded bg-slate-50 text-[10px] text-slate-400">{t}</span>
            ))}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            {m.text || <span className="text-slate-300">（空 —— 叙事被清空的记忆不会进注入）</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * v1.13 情绪诊断：她此刻**被激起了什么**；v1.22 扩到**她的内在生活**与**记忆选择理由**。
 *
 * 为什么要单独一块：`/state` 的 `dominant` 是**绝对值 argmax**，而绝对值里混着人格基调
 * （calm 0.8 / greed 0.2 是静息值），所以它几乎永远返回"平静"，`intensity` 报的也是基调量级。
 * 结果她 41 条记忆里 32 条把当时的情绪记成 calm。这里把**两种读法并排**放出来 ——
 * 不并排就看不出旧结论有多不可信。
 *
 * v1.22 补的两块（P1）：① `mood`/`rumination`/`emergence`/`motive`/`shadow` 这些
 * **一直在算、却从没在界面上出现过**的量；② **这一轮她为什么想起这些** ——
 * 记忆是她情绪最直接的来源，此前完全没有可观测出口（只能靠临时脚本）。
 * 全部只读。
 */
function EmotionDiagnostics() {
  const [activation, setActivation] = useState<ActivationView | null>(null);
  const [legacy, setLegacy] = useState<{ name: string; intensity: number } | null>(null);
  const [typical, setTypical] = useState<TypicalActivationView | null>(null);
  const [inner, setInner] = useState<InnerLifeView | null>(null);
  const [trace, setTrace] = useState<MemoryTrace | null>(null);
  const [drift, setDrift] = useState<LongTermDriftView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActivation(data.activation ?? null);
      setLegacy({ name: data.dominant ?? 'neutral', intensity: data.intensity ?? 0 });
      setTypical(data.activationTypical ?? null);
      setInner({
        internalNarrative: data.internalNarrative ?? '',
        mood: data.mood ?? null,
        rumination: data.rumination ?? null,
        emergence: data.emergence ?? null,
        motive: data.motive ?? null,
        shadow: data.shadow ?? null,
      });
      setTrace(data.memoryTrace ?? null);
      setDrift(data.longTermDrift ?? null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || '读取失败');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // 显式泛型不能省：TS 在这里把 `Object.entries(Record<string, number>)` 的值推成 unknown
  // （联合重载推断），不加就会报 `v > 0` / `b[1] - a[1]` 三处类型错。
  const top = activation
    ? Object.entries<number>(activation.delta)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
    : [];

  return (
    <>
    <SettingGroup title="情绪诊断（她此刻被激起了什么）">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {error ? `读取失败：${error}` : '每 10 秒自动刷新 · 只读'}
          </span>
          <button
            onClick={() => { void refresh(); }}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60"
          >
            刷新
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {activation?.resting ? (
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium">
              静息 —— 她此刻没有明显情绪
            </span>
          ) : (
            <>
              <span className="px-2 py-0.5 rounded-md bg-rose-50 text-rose-600 text-xs font-medium">
                {emotionLabel(activation?.activeEmotion)} +{activation?.activeIntensity.toFixed(2)}
              </span>
              {!activation?.clear && activation?.runnerUp && (
                <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 text-xs font-medium">
                  与 {emotionLabel(activation.runnerUp)} +{activation.runnerUpIntensity.toFixed(2)} 并存（她自己也没那么说得清）
                </span>
              )}
            </>
          )}
        </div>

        {top.length > 0 && (
          <div className="text-[11px] font-mono text-slate-500">
            相对基调的偏离：{top.map(([k, v]) => `${k} +${v.toFixed(2)}`).join('  ')}
          </div>
        )}

        {activation?.suppressed?.length ? (
          <div className="text-[11px] font-mono text-slate-500">
            基调被压低：{activation.suppressed.map(k => `${emotionLabel(k)} ${activation.delta[k].toFixed(2)}`).join('、')}
          </div>
        ) : null}

        <div className="text-[11px] leading-relaxed bg-slate-50 rounded-lg p-2.5 text-slate-500 space-y-0.5">
          <div className="text-slate-400">
            旧读法（绝对值 argmax，基调参与竞争）：主导 = {emotionLabel(legacy?.name)} {legacy?.intensity.toFixed(2)}
          </div>
          <div className="text-slate-600">新读法（相对**人格本性**的激发态）：{activation?.note ?? '—'}</div>
          {typical && (
            <>
              <div className="text-slate-600 pt-1">
                相对**她最近一段时间的常态**：{typical.note}
              </div>
              <div className="text-slate-400">
                常态参照 {typical.halfLifeHours}h 半衰期，按真实时间老化；
                {typical.updatedAt ? ` 上次更新 ${new Date(typical.updatedAt).toLocaleTimeString()}；` : ' '}
                <span className="text-amber-500">
                  只报"她此刻变了多少"—— 长期状态会被学成新的常态（实测持续低落约 20 天后就读不出难过），
                  所以它**只用于诊断**，不参与任何决策
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </SettingGroup>
    {/* v1.22：下面两块用的是**同一次** /state 取回的数据，不额外轮询 */}
    <LongTermDriftDiagnostics drift={drift} />
    <InnerLifeDiagnostics data={inner} />
    <MemoryTraceDiagnostics trace={trace} />
    </>
  );
}

/**
 * v1.23/v1.26 她被经历塑造：长周期人格漂移（read **一段记忆的总体倾向**，不是当轮情绪）。
 *
 * 为什么单独一块：`/state → longTermDrift` 此前是个**只在漂移发生后才非 null** 的字段，
 * 重启后就是 `null` ⇒ 面板上"什么都没有"。而"没有"有两种完全不同的含义：
 * **还没到评估点**（每 20 轮一次）与**这条通路挂了** —— 界面必须能区分，否则
 * 又一次回到本项目最大的失败类别（写了、有测试、界面上看不出来）。
 * 所以这里连"下次第几轮""门槛多少""单次上限"都摆出来。只读。
 */
function LongTermDriftDiagnostics({ drift }: { drift: LongTermDriftView | null }) {
  if (!drift) return null;
  const last = drift.last;
  const changed = last ? Object.keys(last.changes) : [];
  const velocities = last ? Object.keys(last.velocities) : [];
  // 显式泛型不能省：Object.entries(Record<string, number>) 的值会被推成 unknown
  const delta = (v: number, digits = 3) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
  return (
    <SettingGroup title="她被经历塑造（长周期人格漂移）">
      <StatRow
        label="上一次评估"
        value={drift.enabled
          ? (last
            ? `第 ${last.round} 轮（当前第 ${drift.round} 轮）· 样本 ${last.sampled} 条 · ${new Date(last.at).toLocaleTimeString()}`
            : `还没评估过 —— 每 ${drift.intervalRounds} 轮一次，下次第 ${drift.nextDueRound} 轮（当前第 ${drift.round} 轮）`)
          : '已关闭（DISABLE_LONG_TERM_DRIFT=true）'}
        hint="与阶段 3.7 的分工：那条读**当轮情绪**（一瞬间的事），这条读**一段记忆的总体倾向**（一段时间的事）"
      />
      {last && (
        <>
          <StatRow
            label="为什么往这边动（原始趋势）"
            value={velocities.length
              ? Object.entries<number>(last.velocities).map(([k, v]) => `${k} ${delta(v, 2)}`).join('　')
              : '—'}
            hint="从最近记忆的总体倾向算出：正向经历占比 / 爱的经历 / 冲突后是否仍正面"
          />
          <StatRow
            label="实际落下多少"
            value={changed.length
              ? Object.entries<number>(last.changes).map(([k, v]) => `${k} ${delta(v)}`).join('　')
              : `无可动项${last.skipped ? `（${last.skipped}）` : ''}`}
            hint="趋势再大也只走这么多 —— 单次位移有逐参数的硬上限（见下行）"
          />
        </>
      )}
      <StatRow
        label="评估节奏与门槛"
        value={`每 ${drift.intervalRounds} 轮一次 · 最近记忆样本 <${drift.minEpisodes} 条不学`}
        hint="少样本不学 —— 不让一条记忆就把人格带偏（与动机学习同一条纪律）"
      />
      <StatRow
        label="单次位移上限（逐参数）"
        value={Object.entries<number>(drift.scale).map(([k, v]) => `${k} ±${v}`).join('　')}
        hint="单位不一样：trust/openness/playfulness 是 [0,100]，resilience 是 [0,1] —— 共用一个系数会一次打爆"
      />
      {drift.current && (
        <StatRow
          label="当前人格参数"
          value={`trust ${drift.current.trust.toFixed(1)}　openness ${drift.current.openness.toFixed(1)}　playfulness ${drift.current.playfulness.toFixed(1)}　resilience ${drift.current.resilience.toFixed(3)}`}
          hint="她要被经历塑造，总得看得见现在长什么样"
        />
      )}
      <div className="px-4 pb-3 text-[10px] text-slate-300">只读诊断，不参与任何计算</div>
    </SettingGroup>
  );
}

/**
 * v1.22 她的内在生活：`/state` 早就算好了底色心情 / 反刍链 / 涌现诊断 / 动机 / 潜意识，
 * 但**界面上从来没有出现过**（只有 activation 与 appraisal 被消费）。
 *
 * 为什么重要：这些量全是"看不出就等于没有"的东西 ——
 * 「她今天底色沉不沉」「是不是在反复咀嚼同一件事」「情绪是不是只会延续上一轮（自相关）」
 * 「她此刻想说什么」「哪些性格特质正在慢慢长」都只能靠临时脚本证明。只读。
 */
function InnerLifeDiagnostics({ data }: { data: InnerLifeView | null }) {
  if (!data) return null;
  const { mood, rumination, emergence, motive, shadow, internalNarrative } = data;
  const pct = (v: number | undefined) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
  return (
    <SettingGroup title="她的内在生活（一直在算，此前界面上看不到）">
      <StatRow label="内在独白" value={internalNarrative || '—'} hint="由强化状态推导的一句话（describeReinforcementState）" />
      <StatRow
        label="底色心情"
        value={mood?.samples ? `${mood.description}（效价 ${mood.valence.toFixed(2)} · ${mood.samples} 次采样）` : '还没有足够样本'}
        hint="12h 尺度慢变底色；静息值 = 0，按半衰期 18h 淡忘"
      />
      <StatRow
        label="反刍"
        value={rumination?.streak ? `${rumination.description}（${emotionLabel(rumination.emotion)} ×${rumination.streak} 轮）` : '没有在反复咀嚼同一件事'}
        hint="同一情绪连续主导 ≥3 轮才开始钝化，calm 会回升（自我安抚）"
      />
      <StatRow
        label="涌现诊断"
        value={emergence
          ? `${emergence.note}　内在驱动 ${pct(emergence.internalShare)} / 用户 ${pct(emergence.userShare)}${emergence.stuck ? '　⚠️ 卡死' : ''}`
          : '—'}
        hint="内在驱动占比 = 非用户来源（内在事件/心情/反刍/潜意识/评价）占多少；卡死 = 只会延续上一轮"
      />
      <StatRow
        label="此刻想说什么"
        value={motive
          ? (motive.thisTurn
            ? `${motive.thisTurn.kind ?? '（没说）'}${motive.thisTurn.deferred ? '（让位给他）' : ''} · ${motive.thisTurn.reason}　池 ${motive.poolSize} 条`
            : `尚未竞选　池 ${motive.poolSize} 条`)
          : '—'}
        hint="动机层：先决定她此刻想说什么，再让她说；空 = 允许安静陪着，不泛问"
      />
      <StatRow
        label="人格式倾向累积"
        value={shadow
          ? (shadow.activeTraits.length
            ? shadow.activeTraits.map(t => `${t.label} ${t.confidence.toFixed(2)}`).join('、')
            : `活跃 0 个　正在累积：${shadow.accumulating.length ? shadow.accumulating.map(t => `${t.label} ${t.confidence.toFixed(3)}(${t.evidenceCount})`).join('、') : '无'}`)
          : '—'}
        hint="潜意识层：特质置信度 ≥0.3 才算激活；累积项每轮 +1 条证据（默认每 50 轮检测一次）"
      />
      {shadow && shadow.totalDetections > 0 && (
        <StatRow label="潜意识检测" value={`累计 ${shadow.totalDetections} 次 · 上次第 ${shadow.lastDetectionRound} 轮`} />
      )}
    </SettingGroup>
  );
}

/**
 * v1.22 这一轮**她为什么想起这些**。
 *
 * 记忆是她情绪最直接的来源，而此前完全看不出「哪几条进了 Prompt、凭什么是它」——
 * 只有 `activation`/`appraisal` 有界面。这里如实呈现选择记录：
 * 选择时她的状态、策略与理由、注入的【相关记忆】、图谱 BFS 召回的、主动回忆选中的、动机结论。
 * **只读**，不改变任何选择逻辑。
 */
function MemoryTraceDiagnostics({ trace }: { trace: MemoryTrace | null }) {
  if (!trace) return null;
  return (
    <SettingGroup title="这一轮她为什么想起这些（记忆选择记录）">
      <StatRow label="选择时她的状态" value={trace.herState} hint="召回打分（情感一致性 ×1.5 / 标签重合 / 时间衰减）就是按它算的" />
      <StatRow label="策略" value={`${trace.strategy} —— ${trace.strategyReason}`} />
      {trace.motive && (
        <StatRow label="动机" value={`${trace.motive.kind}：${trace.motive.content}（紧迫度 ${trace.motive.salience.toFixed(2)}）`} />
      )}
      <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-slate-400">
        注入 System Prompt 的【相关记忆】{trace.injected.length > 0 ? `（${trace.injected.length} 条）` : ''}
      </div>
      <MemoryEntryList items={trace.injected} empty="这一轮没有记忆进 Prompt（可能都被可见性门控挡掉，或没有够格的候选）" />
      <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-slate-400">
        图谱 BFS 召回的{trace.graph.length > 0 ? `（${trace.graph.length} 条）` : ''}
      </div>
      <MemoryEntryList items={trace.graph} empty="图谱没有召回（种子要求文本/标签/情绪有重合）" />
      <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-slate-400">主动回忆</div>
      <div className="px-4 pb-3 text-xs text-slate-600">
        {trace.proactive.picked
          ? <>选中「{trace.proactive.picked}」　提起方式 {trace.proactive.approach ?? '—'}</>
          : <span className="text-slate-300">这一轮没有主动回忆（策略不在 neutral/explore/share、或权重不够、或没有叙事）</span>}
        {trace.proactive.injection && (
          <div className="mt-1 text-[11px] text-slate-400 font-mono break-all">{trace.proactive.injection}</div>
        )}
      </div>
      <div className="px-4 pb-2 text-[10px] text-slate-300">
        {trace.round != null ? `第 ${trace.round} 轮 · ` : ''}
        {new Date(trace.at).toLocaleTimeString()} · 只读记录，不参与选择
      </div>
    </SettingGroup>
  );
}

/**
 * v1.11 发声诊断：看得见她这次**是怎么发声的**。
 *
 * 为什么要这个面板：`/state` 早就暴露了 `voice`/`voiceArc`，但没有界面消费它 ——
 * 结果"状态到底有没有进到声音里""这次有没有走句内弧线"全靠翻接口。
 * 这里只读不写，纯诊断。
 */
function VoiceDiagnostics({ active }: { active: boolean }) {
  const [voice, setVoice] = useState<VoicePerformanceView | null>(null);
  const [arc, setArc] = useState<VoiceArcView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVoice(data.voice ?? null);
      setArc(data.voiceArc ?? null);
      setError(null);
    } catch (e: any) {
      setError(e?.message || '读取失败');
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10_000);
    return () => clearInterval(timer);
  }, [active, refresh]);

  if (!active) return null;

  const lines = describeVoicePerformance(voice, arc);

  return (
    <SettingGroup title="发声诊断（她这次是怎么发声的）">
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {error ? `读取失败：${error}` : '每 10 秒自动刷新 · 只读'}
          </span>
          <button
            onClick={() => { void refresh(); }}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60"
          >
            刷新
          </button>
        </div>
        {arc?.used && arc.states?.length ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {arc.states.map((s, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-slate-300 text-xs">→</span>}
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-xs font-medium">
                  {s.emotion} {typeof s.valence === 'number' ? s.valence.toFixed(2) : ''}
                </span>
              </React.Fragment>
            ))}
            <span className="text-xs text-slate-400 ml-1">
              音色：{timbreLabel(arc.timbreUsed)}
            </span>
          </div>
        ) : (
          <div className="text-xs text-slate-400">未分段（这一轮她的状态没有移动）</div>
        )}
        <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all bg-slate-50 rounded-lg p-2.5 text-slate-600">
          {lines.join('\n')}
        </pre>
      </div>
    </SettingGroup>
  );
}

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview'],
  anthropic: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  siliconflow: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4', 'glm-4-air', 'glm-4-flash', 'glm-3-turbo'],
};

const PROVIDER_URLS: Record<string, string[]> = {
  openai: ['https://api.openai.com/v1', 'https://api.chatanywhere.tech/v1'],
  gemini: ['https://generativelanguage.googleapis.com/v1beta'],
  anthropic: ['https://api.anthropic.com/v1'],
  deepseek: ['https://api.deepseek.com/v1'],
  siliconflow: ['https://api.siliconflow.cn/v1'],
  moonshot: ['https://api.moonshot.cn/v1'],
  zhipu: ['https://open.bigmodel.cn/api/paas/v4'],
};

/* ── Apple-Style Row ───────────────────────────────── */
function SettingRow({ icon, label, children, last }: {
  icon: string; label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${last ? '' : 'border-b border-slate-100'}`}>
      <span className="text-lg w-7 text-center shrink-0">{icon}</span>
      <span className="text-sm font-medium text-slate-800 w-28 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="px-1 text-xs font-medium text-slate-400 uppercase tracking-wide">{title}</h3>
      <div className="bg-white rounded-xl border border-slate-200/60 shadow-sm overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/* ── Provider Chip ─────────────────────────────────── */
function ProviderChip({ provider, active, onClick }: {
  provider: Provider; active: boolean; onClick: () => void;
}) {
  const labels: Record<string, string> = {
    openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Anthropic',
    deepseek: 'DeepSeek', siliconflow: '硅基流动', moonshot: 'Kimi',
    zhipu: '智谱', custom: '自定义',
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
        active
          ? 'bg-indigo-500 text-white shadow-sm'
          : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
      }`}
    >
      {labels[provider] || provider}
    </button>
  );
}

/* ═════════════════════════════════════════════════════ */
export default function SettingsView() {
  const { settings, setSettings } = useAIBrainStore();
  const [showTestResult, setShowTestResult] = useState<'success' | 'error' | null>(null);

  const handleProviderChange = (p: Provider) => {
    const defaults: Record<string, Partial<typeof settings>> = {
      openai: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4-turbo' },
      gemini: { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3.1-pro-preview' },
      anthropic: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-opus-20240229' },
      deepseek: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      siliconflow: { provider: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
      moonshot: { provider: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
      zhipu: { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4' },
      custom: { provider: 'custom', baseUrl: '', model: '' },
    };
    setSettings(defaults[p] || { provider: p });
  };

  const handleTestConnection = async () => {
    if (!settings.apiKey && !settings.serverConfigured) {
      setShowTestResult('error');
      setTimeout(() => setShowTestResult(null), 3000);
      return;
    }
    try {
      const response = await fetch('/api/ai-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json().catch(() => ({ success: false }));
      setShowTestResult(response.ok && data.success ? 'success' : 'error');
    } catch {
      setShowTestResult('error');
    }
    setTimeout(() => setShowTestResult(null), 3000);
  };

  return (
    <div className="px-6 py-6 space-y-5 bg-[#f2f2f7] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">设置</h2>
          <p className="text-xs text-slate-400 mt-0.5">模型与 API 配置</p>
        </div>
        <div className="flex items-center gap-2">
          {showTestResult === 'success' && (
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2.5 py-1 rounded-full">✓ 连接成功</span>
          )}
          {showTestResult === 'error' && (
            <span className="text-xs font-medium text-red-600 bg-red-50 px-2.5 py-1 rounded-full">✗ 连接失败</span>
          )}
          <button
            onClick={handleTestConnection}
            className="px-4 py-1.5 bg-indigo-500 text-white text-xs font-medium rounded-lg hover:bg-indigo-600 transition-colors"
          >
            测试连接
          </button>
        </div>
      </div>

      {/* ── Model Provider ── */}
      <SettingGroup title="模型服务商">
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(PROVIDER_MODELS) as Provider[]).concat('custom').map(p => (
              <React.Fragment key={p}>
                <ProviderChip provider={p} active={settings.provider === p} onClick={() => handleProviderChange(p)} />
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs text-slate-400">选择用于驱动对话的大语言模型服务商</p>
        </div>
      </SettingGroup>

      {/* ── API Key & Connection ── */}
      <SettingGroup title="连接凭证">
        <SettingRow icon="🔑" label="API Key">
          <input
            type="password"
            value={settings.apiKey}
            onChange={e => setSettings({ apiKey: e.target.value })}
            placeholder="sk-..."
            className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
          />
        </SettingRow>
        <SettingRow icon="🔗" label="Base URL" last>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={e => setSettings({ baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
            className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
          />
        </SettingRow>
      </SettingGroup>

      {/* ── Model ── */}
      <SettingGroup title="模型参数">
        <SettingRow icon="🧠" label="模型">
          <select
            value={settings.model}
            onChange={e => setSettings({ model: e.target.value })}
            className="w-full text-sm bg-transparent outline-none text-slate-700 cursor-pointer"
          >
            {(PROVIDER_MODELS[settings.provider] || []).map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            {!PROVIDER_MODELS[settings.provider]?.includes(settings.model) && settings.model && (
              <option value={settings.model}>{settings.model}</option>
            )}
          </select>
        </SettingRow>
        <SettingRow icon="🌡️" label="发散度" last>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={settings.temperature}
              onChange={e => setSettings({ temperature: parseFloat(e.target.value) })}
              className="flex-1 accent-indigo-500 h-1"
            />
            <span className="text-sm font-mono text-slate-500 w-7 text-right">{settings.temperature.toFixed(1)}</span>
          </div>
        </SettingRow>
      </SettingGroup>

      {/* ── TTS ── */}
      <SettingGroup title="语音合成 (TTS)">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg">🎙️</span>
            <span className="text-sm font-medium text-slate-800">启用语音</span>
          </div>
          <button
            onClick={() => setSettings({ tts: { ...settings.tts, enabled: !(settings.tts?.enabled ?? true), provider: settings.tts?.provider || 'cosyvoice', voiceId: settings.tts?.voiceId || '' } })}
            className={`relative w-10 h-6 rounded-full transition-colors ${(settings.tts?.enabled ?? true) ? 'bg-indigo-500' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${(settings.tts?.enabled ?? true) ? 'translate-x-4' : ''}`} />
          </button>
        </div>
      </SettingGroup>

      {(settings.tts?.enabled ?? true) && (
        <SettingGroup title="TTS 服务商">
          <div className="px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {(['browser', 'cosyvoice', 'voxcpm', 'rvc_custom', 'gemini', 'openai', 'elevenlabs'] as const).map(p => {
                const labels: Record<string, string> = {
                  browser: '浏览器', cosyvoice: 'CosyVoice（本地·情感）', voxcpm: 'VoxCPM', rvc_custom: 'RVC',
                  gemini: 'Gemini', openai: 'OpenAI', elevenlabs: 'ElevenLabs',
                };
                return (
                  <button
                    key={p}
                    onClick={() => setSettings({ tts: { ...settings.tts as TTSSettings, provider: p } })}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      settings.tts?.provider === p
                        ? 'bg-indigo-500 text-white shadow-sm'
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
                    }`}
                  >
                    {labels[p]}
                  </button>
                );
              })}
            </div>
          </div>
          <SettingRow icon="🎵" label="音色 ID" last>
            <input
              type="text"
              value={settings.tts?.voiceId || ''}
              onChange={e => setSettings({ tts: { ...(settings.tts as TTSSettings), voiceId: e.target.value } })}
              placeholder={settings.tts?.provider === 'rvc_custom' ? 'my_voice_v1' : 'alloy'}
              className="w-full text-sm font-mono bg-transparent outline-none placeholder:text-slate-300 text-slate-700"
            />
          </SettingRow>
        </SettingGroup>
      )}

      {/* ── v1.13 情绪诊断：她此刻被激起了什么（与语音无关，始终显示）── */}
      <EmotionDiagnostics />

      {/* ── v1.11 发声诊断（只在用本地情感 TTS 时有意义）── */}
      <VoiceDiagnostics active={(settings.tts?.enabled ?? true) && settings.tts?.provider === 'cosyvoice'} />

      {/* Footer */}
      <p className="text-center text-xs text-slate-300 pt-2">
        配置自动保存 · 仅存储在本地浏览器
      </p>
    </div>
  );
}
