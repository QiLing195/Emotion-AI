// ── 情绪相空间 3D 轨迹图 ──
// 三轴：X=效价, Y=唤醒, Z=预期 — 等距投影为 2D SVG
// 轨迹点按微六爻阶段着色，含九情吸引子参考
import { useMemo } from 'react';

// ════════════════════════════════════════════════════════
// 数据
// ════════════════════════════════════════════════════════

const ATTRACTORS = [
  { name: 'joy', v: 0.75, a: 0.70, e: 0.6, color: '#f1c40f', label: '喜' },
  { name: 'anger', v: -0.65, a: 0.80, e: -0.3, color: '#e74c3c', label: '怒' },
  { name: 'sad', v: -0.55, a: 0.20, e: -0.4, color: '#3498db', label: '悲' },
  { name: 'fear', v: -0.70, a: 0.85, e: -0.6, color: '#9b59b6', label: '惧' },
  { name: 'love', v: 0.80, a: 0.35, e: 0.5, color: '#e91e63', label: '爱' },
  { name: 'disgust', v: -0.55, a: 0.45, e: -0.2, color: '#1abc9c', label: '厌' },
  { name: 'lust', v: 0.55, a: 0.90, e: 0.3, color: '#ff6b6b', label: '欲' },
  { name: 'calm', v: 0.30, a: 0.10, e: 0.1, color: '#2ecc71', label: '静' },
  { name: 'greed', v: 0.40, a: 0.55, e: 0.7, color: '#f39c12', label: '贪' },
];

const PHASE_COLORS: Record<string, string> = {
  '生': '#2ecc71', '长': '#f39c12', '化': '#e74c3c', '收': '#3498db', '藏': '#95a5a6',
};

// ════════════════════════════════════════════════════════
// 等距投影 (Isometric Projection)
// ════════════════════════════════════════════════════════

const W = 320, H = 260;
const CX = W * 0.52, CY = H * 0.58; // 投影中心
const SCALE = 95;

/**
 * 等距投影: (效价X, 唤醒Y, 预期Z) → (屏幕x, 屏幕y)
 * X轴(效价) → 右下, Y轴(唤醒) → 上, Z轴(预期) → 左下
 */
function project(v: number, a: number, e: number): [number, number] {
  const sx = CX + (v - e) * Math.cos(Math.PI / 6) * SCALE / 1.5;
  const sy = CY - a * SCALE + (v + e) * Math.sin(Math.PI / 6) * SCALE / 1.5;
  return [sx, sy];
}

// ════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════

function AxesLabels() {
  const [ex, ey] = project(1.15, -0.05, 0);
  const [ax, ay] = project(0, 1.05, 0);
  const [zx, zy] = project(0, -0.05, 1.15);
  return (
    <g className="fill-moon-400" style={{ fontSize: '8px' }}>
      <text x={ex} y={ey} textAnchor="middle">效价(V)</text>
      <text x={ax} y={ay} textAnchor="middle">唤醒(A)</text>
      <text x={zx} y={zy} textAnchor="middle">预期(E)</text>
    </g>
  );
}

function AxesLines() {
  const o = project(0, 0, 0);
  const v1 = project(1.1, 0, 0);
  const a1 = project(0, 1.0, 0);
  const e1 = project(0, 0, 1.1);
  const vm = project(-1.1, 0, 0);
  const em = project(0, 0, -1.1);
  return (
    <g fill="none" stroke="#d4c5b9" strokeWidth="0.8">
      <line x1={o[0]} y1={o[1]} x2={v1[0]} y2={v1[1]} />
      <line x1={o[0]} y1={o[1]} x2={vm[0]} y2={vm[1]} strokeDasharray="2,4" opacity="0.5" />
      <line x1={o[0]} y1={o[1]} x2={a1[0]} y2={a1[1]} />
      <line x1={o[0]} y1={o[1]} x2={e1[0]} y2={e1[1]} />
      <line x1={o[0]} y1={o[1]} x2={em[0]} y2={em[1]} strokeDasharray="2,4" opacity="0.5" />
    </g>
  );
}

// ════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════

export interface EmotionVizProps {
  // 情感引擎
  valence: number;
  arousal: number;
  expectation: number;
  dominantEmotion: string;
  microPhase: string;
  phaseDistribution: Record<string, number>;
  trailHistory: { valence: number; arousal: number; phase?: string }[];
  // 策略引擎
  strategy?: string | null;
  strategyLabel?: string;
  strategyColor?: string;
  // 认知引擎
  activePatterns?: { topic: string; lifecycle: string; score: number }[];
}

const LIFECYCLE_COLORS: Record<string, string> = {
  emerging: '#2ecc71', growing: '#f39c12', established: '#3498db',
  dormant: '#95a5a6', reactivated: '#e91e63', archived: '#666',
};
const LIFECYCLE_LABELS: Record<string, string> = {
  emerging: '萌芽', growing: '生长', established: '稳固',
  dormant: '休眠', reactivated: '复苏', archived: '归藏',
};

export default function EmotionViz({
  valence, arousal, expectation,
  dominantEmotion, microPhase,
  phaseDistribution, trailHistory,
  strategy, strategyLabel, strategyColor,
  activePatterns,
}: EmotionVizProps) {
  const currentColor = ATTRACTORS.find(a => a.name === dominantEmotion)?.color || '#fff';

  // 3D 轨迹点（Z=预期，用当前预期值近似历史）
  const trail3D = useMemo(() => trailHistory.map((p, i) => {
    // 历史预期值用衰减近似
    const trailE = expectation * (0.5 + 0.5 * i / Math.max(trailHistory.length - 1, 1));
    return { ...p, expectation: trailE };
  }), [trailHistory, expectation]);

  return (
    <div className="bg-surface-100/60 backdrop-blur rounded-2xl p-3 border border-surface-300/50">
      <div className="text-[10px] text-moon-400 mb-1.5 flex justify-between">
        <span>情绪相空间 3D · 效价×唤醒×预期</span>
        <span className="text-moon-400">
          <span style={{ color: PHASE_COLORS[microPhase] || '#999' }}>{microPhase}</span>
          {' '}V:{valence.toFixed(2)} A:{arousal.toFixed(2)} E:{expectation.toFixed(2)}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* 背景：三个轴的面 */}
        <AxesLines />
        <AxesLabels />

        {/* 原点 */}
        <circle cx={project(0,0,0)[0]} cy={project(0,0,0)[1]} r="1.5" fill="#c8c8cc" />

        {/* 九情吸引子 */}
        {ATTRACTORS.map(a => {
          const [sx, sy] = project(a.v, a.a, a.e);
          return (
            <g key={a.name}>
              <circle cx={sx} cy={sy} r="2.5" fill={a.color} opacity="0.45" />
              <text x={sx} y={sy - 5} textAnchor="middle" fill={a.color} opacity="0.55" style={{ fontSize: '7px' }}>
                {a.label}
              </text>
            </g>
          );
        })}

        {/* 历史轨迹线 */}
        {trail3D.length >= 2 && (
          <polyline
            points={trail3D.map(p => {
              const [sx, sy] = project(p.valence, p.arousal, p.expectation);
              return `${sx},${sy}`;
            }).join(' ')}
            fill="none" stroke="#fcc9b5" strokeWidth="0.8" opacity="0.5"
          />
        )}

        {/* 轨迹点 —— 阶段着色 */}
        {trail3D.map((p, i) => {
          const phase = p.phase || '';
          const color = PHASE_COLORS[phase] || '#666';
          const alpha = 0.25 + (i / Math.max(trail3D.length - 1, 1)) * 0.55;
          const [sx, sy] = project(p.valence, p.arousal, p.expectation);
          const r = i === trail3D.length - 1 ? 2.8 : 1.1;
          return <circle key={i} cx={sx} cy={sy} r={r} fill={color} opacity={alpha} />;
        })}

        {/* 当前位置 —— 三层脉冲晕 + 策略环 + 认知标注 */}
        {(() => {
          const [cx, cy] = project(valence, arousal, expectation);
          const stratColor = strategyColor || '#666';
          return (
            <>
              {/* 策略环（最外层）—— 颜色 = 策略类型 */}
              {strategy && (
                <>
                  <circle cx={cx} cy={cy} r="21" fill="none" stroke={stratColor} opacity="0.25" strokeWidth="2" />
                  <text x={cx} y={cy - 25} textAnchor="middle" fill={stratColor} style={{ fontSize: '7px' }}>
                    {strategyLabel || strategy}
                  </text>
                </>
              )}
              {/* 认知 Pattern 标注 —— 在策略环外侧 */}
              {activePatterns && activePatterns.slice(0, 3).map((p, i) => {
                const angle = -Math.PI / 2 + (i - (activePatterns!.slice(0, 3).length - 1) / 2) * 1.2;
                const rx = cx + Math.cos(angle) * 30;
                const ry = cy + Math.sin(angle) * 30;
                return (
                  <g key={p.topic}>
                    <line x1={cx + Math.cos(angle) * 22} y1={cy + Math.sin(angle) * 22}
                      x2={rx} y2={ry} stroke="#c8c8cc" strokeWidth="0.4" />
                    <text x={rx} y={ry} textAnchor="middle" fill={LIFECYCLE_COLORS[p.lifecycle] || '#888'}
                      style={{ fontSize: '6.5px' }}>
                      {p.topic}
                    </text>
                    <text x={rx} y={ry + 8} textAnchor="middle" fill="#a0a0a8" style={{ fontSize: '5.5px' }}>
                      {LIFECYCLE_LABELS[p.lifecycle] || p.lifecycle}
                    </text>
                  </g>
                );
              })}
              {/* 中心点 + 脉冲 */}
              <circle cx={cx} cy={cy} r="5" fill={currentColor} className="animate-pulse" />
              <circle cx={cx} cy={cy} r="9" fill="none" stroke={currentColor} opacity="0.2" strokeWidth="1.5" />
              {/* 原点连线 */}
              <line x1={project(0,0,0)[0]} y1={project(0,0,0)[1]} x2={cx} y2={cy}
                stroke={currentColor} strokeWidth="0.4" strokeDasharray="2,4" opacity="0.3" />
            </>
          );
        })()}
      </svg>

      {/* 图例 */}
      <div className="flex items-center justify-between mt-2 text-[10px]">
        <div className="flex gap-2 text-moon-500">
          {['生', '长', '化', '收', '藏'].map(p => (
            <span key={p} style={{ color: PHASE_COLORS[p] || '#a0a0a8' }}>
              ● {p} {Math.round((phaseDistribution[p] || 0) * 100)}%
            </span>
          ))}
        </div>
        <div className="flex gap-3 text-moon-400">
          <span>V:{valence.toFixed(2)}</span>
          <span>A:{arousal.toFixed(2)}</span>
          <span>E:{expectation.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
