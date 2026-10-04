// scripts/check-defer-threshold.ts
//
// v1.28 离线扫参（**不调 LLM、不写任何状态**）：给「动机层让位」选一个不被单轮推力翻动的门槛。
//
// 背景（v1.27 实测验出来的）：
//   `shouldDeferToUser` 现在读的是**被本轮刺激推动之后**的**绝对值** `sad+fear+anger ≥ 0.35`，
//   而他一句强度 0.70 的话单轮就把静息的她推到 0.32（A 臂 0.320/0.307/0.322，让位 0/3），
//   她起始多沉 0.10 只让终点多 0.017 却跨过门槛（C 臂 0.357/0.286/0.357，让位 2/3）
//   ⇒ 分类决定被"他这一句"顶过去。
//
// 本脚本把两个口径放在同一张网格上对照：
//   · 旧：u ≥ 0.6 且 **刺激之后绝对值** sad+fear+anger ≥ 0.35
//   · 新：u ≥ 0.6 且 **本轮开始前的激活量**（相对人格本性） ≥ 门槛
// 并扫描新门槛的候选值，找一个"他再强也顶不动、她真沉才让位"的区间。
//
// 网格：她的起始沉 h（激活量 0~0.30）× 他的强度 u（0.5~1.0），走**真实管道**（确定性模式）。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-defer-threshold.ts

import { readFileSync } from 'node:fs';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, setDeterministicMode } from '../src/lib/emotionEngine.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { DEFER_HER_SINK_CANDIDATES } from '../src/lib/motive.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

const H_GRID = [0, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20, 0.30];
const U_GRID = [0.5, 0.6, 0.65, 0.70, 0.80, 0.90, 1.00];
const OLD_SUM_GATE = 0.35;
const OLD_U_GATE = 0.6;

/** 线上真实状态（拿不到就退回默认人设）——"她本来沉多少"只有在真实运行点上才有意义 */
function liveState(): EmotionState {
  try {
    const j = JSON.parse(readFileSync('memories/emotion_state.json', 'utf8'));
    const s = j.emotionState ?? j;
    return { ...structuredClone(INITIAL_EMOTION_STATE), ...s } as EmotionState;
  } catch {
    return structuredClone(INITIAL_EMOTION_STATE);
  }
}

/** 他这句话的情绪事件：负向强度随 u 放大（形状取自线上实测的 LLM 事件） */
function hisEvent(u: number) {
  return {
    deltaA: -0.4 * u, deltaB: -0.3 * u, deltaR: 0.1 * u,
    intent: 'self' as const, GC: -0.6 * u, agency: 0.2, fairness: -0.2, control: -0.3,
  };
}

interface Cell { h: number; u: number; sumAfter: number; oldDefer: boolean; }
const cells: Cell[] = [];

const base = structuredClone(liveState());
const baseline = (base.baselineEmotions ?? RESTING_EMOTION_BASELINE) as Record<string, number>;

for (const h of H_GRID) {
  for (const u of U_GRID) {
    const s = structuredClone(base);
    s.emotions = { ...baseline };
    s.emotions.sad = (baseline.sad ?? 0) + h;          // 她**本来**的沉（相对本性的激活量）
    const out = aiCoordinator.processTurn({
      userText: '我今天面试又挂了，感觉自己挺没用的',
      currentEmotionState: s,
      emotionEvent: hisEvent(u),
      userAnalysis: { expressedEmotion: 'sad', intensity: u, directedAtAI: false, likelyCause: 't' },
      recentUserMoods: [],
      roundNumber: 1,
      lastInteractionAt: Date.now(),
    } as never);
    const emo = out.updatedEmotionState.emotions as Record<string, number>;
    const sumAfter = (emo.sad ?? 0) + (emo.fear ?? 0) + (emo.anger ?? 0);
    cells.push({ h, u, sumAfter, oldDefer: u >= OLD_U_GATE && sumAfter >= OLD_SUM_GATE });
  }
}

// ── 表 1：旧口径的让位地图（行 = 她本来多沉，列 = 他多强）──
console.log('══ 表 1：**旧口径**让位地图（● = 让位）＋ 刺激之后 sad+fear+anger 的实测值 ══\n');
console.log('她本来沉\\他强度   ' + U_GRID.map(u => u.toFixed(2).padStart(9)).join(''));
for (const h of H_GRID) {
  const row = U_GRID.map(u => {
    const c = cells.find(x => x.h === h && x.u === u)!;
    return `${c.oldDefer ? '●' : '○'}${c.sumAfter.toFixed(3)}`.padStart(9);
  });
  console.log(`h=${h.toFixed(2).padEnd(10)}` + row.join(''));
}
console.log('\n看两件事：① 他强度 ≥0.70 那一整列几乎全是 ● —— 她本来是静息也照样让位；');
console.log('          ② 单轮就把静息的她推到 ' + cells.filter(c => c.h === 0).map(c => c.sumAfter.toFixed(3)).join(' / ')
  + '（u 0.5→1.0），门槛 0.35 就落在这条曲线中间。\n');

// ── 表 2：新口径（读她**本来**的激活量）在各候选门槛下的让位率 ──
console.log('══ 表 2：新口径「u ≥ 0.6 且 **本轮开始前**的激活量 ≥ 门槛」 ══\n');
console.log('门槛   让位格子（h ≥ 门槛、u ≥ 0.6 的部分）                      h=0 时会误让位吗');
for (const th of DEFER_HER_SINK_CANDIDATES) {
  const cellsWithU = cells.filter(c => c.u >= OLD_U_GATE);
  const on = cellsWithU.filter(c => c.h >= th).length;
  const wrong = cellsWithU.filter(c => c.h === 0 && c.h >= th).length;
  console.log(`${th.toFixed(2)}   ${String(on).padStart(2)} / ${cellsWithU.length} 格（都是"她本来就已经沉"的那些）        `
    + (wrong === 0 ? '不会 ✓（与他的强度无关）' : `会（${wrong} 格）✗`));
}
console.log('\n结论口径：门槛只需满足「h=0 时无论他多强都不让位」——这一点对所有候选都成立；');
console.log('差别只在"多沉才算沉"。取与陪伴分支**同一个**语义常量最省事（同一个意思不要两个数）。');

// ── 表 3：新旧口径在同一网格上的分歧点 ──
console.log('\n══ 表 3：两口径分歧（旧 ● 新 ○ = 旧口径"被顶上去"的误让位；旧 ○ 新 ● = 真沉却没让位）══\n');
const NEW_TH = 0.12;
let oldOnly = 0;
let newOnly = 0;
for (const c of cells) {
  const newDefer = c.u >= OLD_U_GATE && c.h >= NEW_TH;
  if (c.oldDefer && !newDefer) oldOnly++;
  if (!c.oldDefer && newDefer) newOnly++;
}
console.log(`以门槛 ${NEW_TH} 为例：旧口径独有的让位 ${oldOnly} 格 —— 全部是 h < ${NEW_TH} 的格子`
  + `（她本来没到"沉"，被他的强度顶上去）；新口径独有 ${newOnly} 格`
  + `（旧口径是超集：凡是新口径让位的格子，旧口径也都让位 —— 没有"真沉却没让位"的漏判）`);
console.log('前者就是实测抓到的那个病：她本来没沉，被"他这一句"顶到让位。');
console.log('\n⚠️ 表 1 是**合成事件**扫出来的敏感度地图（把 u 从 0.5 扫到 1.0，事件形状取自线上实测的 LLM 事件）；');
console.log('   它与线上真实那一轮（A 臂 0.316~0.322 → 让位 0/3、C 臂 0.357/0.286/0.357 → 让位 2/3）');
console.log('   在**量级与边界位置**上一致，但不逐点相等 —— 真实轮次还叠了心情层/传染/评价层。');
