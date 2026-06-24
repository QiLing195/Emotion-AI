// ── 三模型实时参数面板 ──
// 从 useAIBrainStore 读取情感/认知/策略状态，实时渲染
import React, { useEffect, useState, useMemo } from 'react';
import { useAIBrainStore } from '../store/useAIBrainStore';
import EmotionViz from './EmotionViz';
import { FunnelWidget } from './FunnelWidget';
import { getMicroPhase, getPhaseStats, MicroPhase } from '../lib/emotionEngine';

// 九情 → 颜色映射
const EMOTION_COLORS: Record<string, string> = {
  joy: '#f1c40f', anger: '#e74c3c', sad: '#3498db', fear: '#9b59b6',
  love: '#e91e63', disgust: '#1abc9c', lust: '#ff6b6b', calm: '#2ecc71',
  greed: '#f39c12',
};

const EMOTION_LABELS: Record<string, string> = {
  joy: '喜', anger: '怒', sad: '悲', fear: '惧', love: '爱',
  disgust: '厌', lust: '欲', calm: '静', greed: '贪',
};

// 策略中文标签
const STRATEGY_LABELS: Record<string, string> = {
  empathize: '共情跟随', redirect: '转移注意', explore: '好奇探索',
  accompany: '沉默陪伴', share: '主动分享', repair: '冲突修复',
  neutral: '中性回应',
};

const STRATEGY_COLORS: Record<string, string> = {
  empathize: '#e91e63', redirect: '#f39c12', explore: '#2ecc71',
  accompany: '#3498db', share: '#1abc9c', repair: '#e74c3c',
  neutral: '#95a5a6',
};

// ── 图标：Activity（示波器） ──
function ActivityIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16l4-8 4 4 4-6" />
    </svg>
  );
}

// ── 预设切换器 ──
function PresetSwitcher() {
  const presets = useAIBrainStore(s => s.presets);
  const activePresetId = useAIBrainStore(s => s.activePresetId);
  const setActivePresetId = useAIBrainStore(s => s.setActivePresetId);

  if (!presets || presets.length <= 1) return null;

  return (
    <div className="px-4 py-2 border-b divider-soft">
      <div className="text-xs text-moon-400 uppercase tracking-wider mb-1.5">人格预设</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => setActivePresetId(p.id)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              activePresetId === p.id
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 迷你柱状图 ──
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-1.5 bg-surface-300 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── 折叠区块 ──
function CollapsibleSection({ title, icon, defaultOpen, children }: {
  title: string; icon: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border-b divider-soft">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-moon-500 hover:text-rose-600 hover:bg-rose-50/50 transition-all"
      >
        <span>{icon}</span>
        <span className="flex-1 text-left">{title}</span>
        <span className="text-moon-300">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-4 pb-2 space-y-1.5">{children}</div>}
    </div>
  );
}

// ── 数字行 ──
function Row({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-moon-400">{label}</span>
      <span className="font-mono text-moon-700" style={color ? { color } : undefined}>
        {value}{unit && <span className="text-moon-400">{unit}</span>}
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════

export default function ModelPanel({ showSettings, showOscilloscope, onSettingsClick, onOscilloscopeClick }: {
  showSettings?: boolean;
  showOscilloscope?: boolean;
  onSettingsClick?: () => void;
  onOscilloscopeClick?: () => void;
}) {
  // 500ms 轮询 store 快照，Zustand 的 getState 始终返回最新值
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(timer);
  }, []);

  const state = useAIBrainStore.getState();
  const emo = state.persona.emotionState;
  if (!emo) {
    return (
      <div className="w-[360px] flex-shrink-0 glass-strong flex items-center justify-center text-moon-400 text-sm">
        等待初始化...
      </div>
    );
  }

  const { taiji, sancai, emotions, reinforcement } = emo;

  // 主导情绪
  const dominant = useMemo(() => {
    let best = 'calm'; let bestV = 0;
    for (const [k, v] of Object.entries(emotions || {})) {
      if (Math.abs(v) > Math.abs(bestV)) { best = k; bestV = v; }
    }
    return { name: best, intensity: bestV };
  }, [emotions]);

  // 从 store 读取 lastRelevantPatterns / lastStrategy
  const storeFull = state as any;
  const lastPatterns = storeFull.lastRelevantPatterns || [];
  const lastStrategy = storeFull.lastStrategy || null;
  const lastStrategyReason = storeFull.lastStrategyReason || '';

  return (
    <div className="w-[360px] flex-shrink-0 glass-strong overflow-y-auto flex flex-col shadow-float z-10">
      {/* 标题 */}
      <div className="px-4 py-3 border-b divider-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-moon-800">三模型观测台</span>
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse-soft" />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onSettingsClick}
              className={`p-1.5 rounded-lg transition-all ${
                showSettings
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'text-moon-400 hover:text-moon-600 hover:bg-slate-100'
              }`}
              title="设置"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button
              onClick={onOscilloscopeClick}
              className={`p-1.5 rounded-lg transition-all ${
                showOscilloscope
                  ? 'bg-rose-100 text-rose-600'
                  : 'text-moon-400 hover:text-moon-600 hover:bg-slate-100'
              }`}
              title="认知示波器"
            >
              <ActivityIcon />
            </button>
          </div>
        </div>
        <div className="text-xs text-moon-400 mt-0.5">Emotion · Cognition · Strategy</div>
      </div>

      {/* 人格预设切换 */}
      <PresetSwitcher />

      {/* 情感模型 */}
      <CollapsibleSection title="情感模型 Emotion" icon="❤️">
        <div className="space-y-1.5">
          <div className="text-xs text-moon-400 uppercase tracking-wider mb-1">太极 Taiji</div>
          <Row label="效价 valence" value={taiji.valence.toFixed(3)} color={taiji.valence > 0 ? '#2ecc71' : '#e74c3c'} />
          <MiniBar value={taiji.valence} max={1} color={taiji.valence > 0 ? '#2ecc71' : '#e74c3c'} />
          <Row label="唤醒 arousal" value={taiji.arousal.toFixed(3)} color={taiji.arousal > 0.5 ? '#e74c3c' : '#3498db'} />
          <MiniBar value={taiji.arousal} max={1} color={taiji.arousal > 0.5 ? '#f39c12' : '#3498db'} />
          <Row label="预期 expectation" value={taiji.expectation.toFixed(3)} color={taiji.expectation > 0 ? '#2ecc71' : '#9b59b6'} />

          <div className="text-xs text-moon-400 uppercase tracking-wider mt-2 mb-1">三才 Sancai</div>
          <Row label="A 趋近" value={sancai.A.toFixed(3)} />
          <Row label="B 回避" value={sancai.B.toFixed(3)} />
          <Row label="R 理性" value={sancai.R.toFixed(3)} />
          <Row label="和谐 harmony" value={sancai.harmony.toFixed(3)} />

          {/* Phase 3: 情绪可视化 */}
          <EmotionViz
            valence={taiji.valence}
            arousal={taiji.arousal}
            expectation={taiji.expectation}
            dominantEmotion={dominant.name}
            microPhase={(() => { try { return getMicroPhase(emo).phase; } catch { return '生'; } })()}
            phaseDistribution={(() => { try { return getPhaseStats().distribution; } catch { return {}; } })()}
            trailHistory={(storeFull.trailHistory || []) as { valence: number; arousal: number; phase?: string }[]}
            strategy={lastStrategy}
            strategyLabel={STRATEGY_LABELS[lastStrategy || ''] || lastStrategy}
            strategyColor={STRATEGY_COLORS[lastStrategy || '']}
            activePatterns={
              (lastPatterns || []).slice(0, 3).map((p: any) => ({
                topic: p.topic,
                lifecycle: p.lifecycle || 'established',
                score: p.maturityScore || 0,
              }))
            }
          />

          <div className="text-xs text-moon-400 uppercase tracking-wider mt-2 mb-1">
            九情 · 主导: <span style={{ color: EMOTION_COLORS[dominant.name] || '#95a5a6' }}>{EMOTION_LABELS[dominant.name] || dominant.name}</span>
          </div>
          {Object.entries(emotions || {}).map(([name, val]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="text-xs w-5" style={{ color: EMOTION_COLORS[name] }}>
                {EMOTION_LABELS[name] || name}
              </span>
              <div className="flex-1">
                <MiniBar value={Math.abs(val)} max={1} color={EMOTION_COLORS[name] || '#95a5a6'} />
              </div>
              <span className="text-xs font-mono w-8 text-right text-moon-500">
                {val.toFixed(2)}
              </span>
            </div>
          ))}

          <div className="text-xs text-moon-400 uppercase tracking-wider mt-2 mb-1">强化驱动</div>
          <Row label="贪婪驱力 greed" value={reinforcement.greedDrive.toFixed(3)} color="#f39c12" />
          <MiniBar value={reinforcement.greedDrive} max={1} color="#f39c12" />
          <Row label="恐惧回避 fear" value={reinforcement.fearAvoidance.toFixed(3)} color="#9b59b6" />
          <MiniBar value={reinforcement.fearAvoidance} max={1} color="#9b59b6" />
        </div>
      </CollapsibleSection>

      {/* 认知模型 */}
      <CollapsibleSection title="认知模型 Cognition" icon="🧠" defaultOpen={false}>
        <div className="space-y-1.5">
          {lastPatterns.length > 0 ? (
            <>
              <div className="text-xs text-moon-400 uppercase tracking-wider mb-1">
                情绪加权模式 ({lastPatterns.length})
              </div>
              {lastPatterns.slice(0, 5).map((p: any, i: number) => (
                <div key={i} className="text-xs">
                  <div className="flex justify-between">
                    <span className="text-moon-700">{p.topic}</span>
                    <span className="font-mono text-moon-400">{(p.maturityScore || 0).toFixed(2)}</span>
                  </div>
                  {p.emotionalSignature && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {Object.entries(p.emotionalSignature as Record<string, number>)
                        .filter(([, v]) => Math.abs(v) > 0.2)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3)
                        .map(([k, v]) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{
                            backgroundColor: (EMOTION_COLORS[k] || '#555') + '30',
                            color: EMOTION_COLORS[k] || '#999',
                          }}>
                            {EMOTION_LABELS[k] || k}:{v.toFixed(1)}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="text-xs text-moon-400">等待首轮对话建立模式...</div>
          )}
        </div>
      </CollapsibleSection>

      {/* 策略模型 */}
      <CollapsibleSection title="策略模型 Strategy" icon="🎯" defaultOpen={false}>
        <div className="space-y-1.5">
          {lastStrategy ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{
                  backgroundColor: (STRATEGY_COLORS[lastStrategy] || '#f43f6e') + '18',
                  color: STRATEGY_COLORS[lastStrategy] || '#f43f6e',
                }}>
                  {STRATEGY_LABELS[lastStrategy] || lastStrategy}
                </span>
                <span className="text-[10px] font-mono text-moon-400">{lastStrategy}</span>
              </div>
              {lastStrategyReason && (
                <div className="text-xs text-moon-500 leading-relaxed">{lastStrategyReason}</div>
              )}
            </>
          ) : (
            <div className="text-xs text-moon-400">等待首轮对话触发策略...</div>
          )}
        </div>
      </CollapsibleSection>

      {/* Sprint E: 认知漏斗 */}
      <CollapsibleSection title="认知漏斗 Funnel" icon="📊" defaultOpen={false}>
        <FunnelWidget />
      </CollapsibleSection>

      {/* 底部状态 */}
      <div className="mt-auto px-4 py-2.5 border-t divider-soft text-xs text-moon-400">
        <div className="flex justify-between">
          <span>更新频率</span>
          <span className="font-mono">500ms</span>
        </div>
        <div className="flex justify-between">
          <span>主导情绪</span>
          <span style={{ color: EMOTION_COLORS[dominant.name] || '#999' }}>
            {EMOTION_LABELS[dominant.name] || dominant.name} {dominant.intensity.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
