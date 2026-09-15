// ── 情绪涌现 A/B 对比：改动前（只有阶段 3 用户话语事件） vs 改动后（+传染/内在事件/心情/反刍） ──
// 用途：同一段对话、同一初始状态、同一输入，逐轮对比情感状态的差异。
// 运行：npm run ab:emotion   （不需要 LLM / 网络）
//
// 说明：旧版路径严格复刻改动前的权威链路 —— 仅 applyEvent(EmotionUpdated)，
// 因为改动前 contagion / 内在事件 / 心情 / 反刍 均未接入（或根本不存在）。
// 主导情绪用"被激活情绪"（排除静息就高的 calm/greed），与反刍层口径一致。

import { applyEvent, buildEmotionUpdatedPayload } from '../src/lib/stateReducer.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionEngine.js';
import { activatedDominant } from '../src/lib/rumination.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { analyzeUserEmotionLocally, fallbackEmotionEvent } from '../server/services/emotionAnalyzer.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';
import type { EmotionEvent } from '../src/lib/emotionEngine.js';

const HOUR = 3_600_000;

interface Step {
  text: string;
  /** 距上一次互动（分钟）；用于孤独/重逢通路 */
  idleMinutes?: number;
}

const SCENARIO: Step[] = [
  { text: '今天上班好累，被老板说了两句', idleMinutes: 12 * 60 }, // 12h 没说话 + 一句明显情绪化的话
  { text: '今天很难过，什么都不想做' },
  { text: '我好开心！今天升职了' },
  { text: '你真贴心，谢谢你' },
  { text: '我老板真讨厌，气死我了' },
  { text: '今天吃了面', idleMinutes: 30 },
];

function contextOf(state: EmotionState) {
  const evo = state.evolution;
  return {
    baseA: evo.resilience,
    baseB: 1 - evo.resilience,
    baseR: evo.sensitivity,
    emotionalStability: Math.max(0.1, Math.min(0.9, 1 - evo.sensitivity)),
    empathy: evo.empathy,
    optimism: evo.optimism,
  };
}

function row(label: string, s: EmotionState) {
  const dom = activatedDominant(s.emotions);
  return `${label} v=${s.taiji.valence.toFixed(3)} a=${s.taiji.arousal.toFixed(3)} `
    + `sad=${s.emotions.sad.toFixed(3)} joy=${s.emotions.joy.toFixed(3)} love=${s.emotions.love.toFixed(3)} `
    + `| 激活主导=${dom.name}(${dom.intensity.toFixed(2)})`;
}

// ── 旧版：仅阶段 3 ──
let oldState: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
const oldSnaps: EmotionState[] = [];
let oldAbsDelta = 0;
for (const step of SCENARIO) {
  const analysis = analyzeUserEmotionLocally(step.text);
  const event: EmotionEvent = fallbackEmotionEvent(step.text, analysis);
  const before = oldState.taiji.valence;
  oldState = applyEvent(oldState, {
    id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion',
    timestamp: Date.now(),
    data: buildEmotionUpdatedPayload({ stimulus: event, context: contextOf(oldState) }),
  });
  oldAbsDelta += Math.abs(oldState.taiji.valence - before);
  oldSnaps.push(structuredClone(oldState));
}

// ── 新版：完整协调器 ──
let newState: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
const newSnaps: EmotionState[] = [];
let newAbsDelta = 0;
let clock = Date.now() - 13 * HOUR;
for (let i = 0; i < SCENARIO.length; i++) {
  const step = SCENARIO[i];
  const gapMs = (step.idleMinutes ?? 1) * 60_000;
  const lastInteractionAt = clock;
  clock += gapMs;
  const analysis = analyzeUserEmotionLocally(step.text);
  const event: EmotionEvent = fallbackEmotionEvent(step.text, analysis);
  const before = newState.taiji.valence;
  const out = aiCoordinator.processTurn({
    userText: step.text,
    currentEmotionState: newState,
    emotionEvent: event,
    userAnalysis: analysis,
    recentUserMoods: [],
    lastInteractionAt,
    roundNumber: i + 1,
  });
  newState = out.updatedEmotionState;
  newAbsDelta += Math.abs(newState.taiji.valence - before);
  newSnaps.push(structuredClone(newState));
}

// ── 输出对比 ──
console.log('=== 同一段对话：改动前 vs 改动后 ===\n');
for (let i = 0; i < SCENARIO.length; i++) {
  const analysis = analyzeUserEmotionLocally(SCENARIO[i].text);
  console.log(`第 ${i + 1} 轮  用户：「${SCENARIO[i].text}」`
    + `${SCENARIO[i].idleMinutes ? `（距上轮 ${SCENARIO[i].idleMinutes} 分钟）` : ''}`);
  console.log(`        本地 NLU: ${analysis.expressedEmotion} i=${analysis.intensity.toFixed(2)} 指向她=${analysis.directedAtAI}`);
  console.log(`        ${row('旧', oldSnaps[i])}`);
  console.log(`        ${row('新', newSnaps[i])}`);
  console.log(`        差异: Δvalence=${(newSnaps[i].taiji.valence - oldSnaps[i].taiji.valence).toFixed(3)}`
    + ` Δsad=${(newSnaps[i].emotions.sad - oldSnaps[i].emotions.sad).toFixed(3)}`
    + ` Δjoy=${(newSnaps[i].emotions.joy - oldSnaps[i].emotions.joy).toFixed(3)}`
    + ` Δlove=${(newSnaps[i].emotions.love - oldSnaps[i].emotions.love).toFixed(3)}`);
  console.log('');
}

const report = aiCoordinator.getEmergenceReport();
console.log('\n=== 汇总 ===');
console.log(`旧版累计 |Δvalence| = ${oldAbsDelta.toFixed(3)}   新版 = ${newAbsDelta.toFixed(3)}`
  + `（新版约为旧版的 ${(newAbsDelta / Math.max(1e-9, oldAbsDelta)).toFixed(2)} 倍）`);
console.log(`旧版末态: ${row('', oldState)}`);
console.log(`新版末态: ${row('', newState)}`);
console.log(`新版内在驱动占比 internalShare = ${(report.internalShare * 100).toFixed(1)}%`
  + `  明细=${JSON.stringify(Object.fromEntries(Object.entries(report.breakdown).map(([k, v]) => [k, Number(v.toFixed(3))])))}`);
console.log(`涌现诊断: ${report.note}`);
console.log(`新版持久化了内在状态: mood=${JSON.stringify(newState.internal?.mood)}`);
console.log(`                        rumination=${JSON.stringify(newState.internal?.rumination)}`);

// ════════════════════════════════════════════════════════════
// 长场景：连续 12 轮同一情绪刺激（假设 NLU 识别为中高强度"难过"）
// 目的：对比"旧版会一直往下累积" vs "新版会习惯化/钝化并自我安抚"
// ════════════════════════════════════════════════════════════
const LONG_TURNS = 12;
const LONG_INTENSITY = 0.75;
const sadAnalysis = {
  expressedEmotion: 'sad',
  likelyCause: 'user is upset',
  intensity: LONG_INTENSITY,
  directedAtAI: false,
};
const sadEvent: EmotionEvent = fallbackEmotionEvent('我还是很难过', sadAnalysis);

let longOld: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
let longNew: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
const longRows: string[] = [];
let longClock = Date.now() - LONG_TURNS * 5 * 60_000;

for (let i = 1; i <= LONG_TURNS; i++) {
  longOld = applyEvent(longOld, {
    id: '', type: 'EmotionUpdated', level: 'cognitive', source: 'emotion',
    timestamp: Date.now(),
    data: buildEmotionUpdatedPayload({ stimulus: sadEvent, context: contextOf(longOld) }),
  });
  const lastInteractionAt = longClock;
  longClock += 5 * 60_000; // 每轮间隔 5 分钟：同一场连续对话
  const out = aiCoordinator.processTurn({
    userText: '我还是很难过',
    currentEmotionState: longNew,
    emotionEvent: sadEvent,
    userAnalysis: sadAnalysis,
    recentUserMoods: [],
    lastInteractionAt,
    roundNumber: i,
  });
  longNew = out.updatedEmotionState;
  longRows.push(
    `第 ${String(i).padStart(2)} 轮 | 旧 v=${longOld.taiji.valence.toFixed(3)} sad=${longOld.emotions.sad.toFixed(3)} calm=${longOld.emotions.calm.toFixed(3)}`
    + ` || 新 v=${longNew.taiji.valence.toFixed(3)} sad=${longNew.emotions.sad.toFixed(3)} calm=${longNew.emotions.calm.toFixed(3)}`
    + ` a=${longNew.taiji.arousal.toFixed(3)}`
    + ` | mood=${(longNew.internal?.mood?.valence ?? 0).toFixed(3)}`
    + ` 反刍=${longNew.internal?.rumination?.emotion}x${longNew.internal?.rumination?.streak}`,
  );
}

console.log(`\n=== 长场景：连续 ${LONG_TURNS} 轮「我还是很难过」（intensity=${LONG_INTENSITY}）===`);
console.log(longRows.join('\n'));
console.log(`\n旧版：sad ${INITIAL_EMOTION_STATE.emotions.sad.toFixed(3)} → ${longOld.emotions.sad.toFixed(3)}`
  + `   val ${INITIAL_EMOTION_STATE.taiji.valence.toFixed(3)} → ${longOld.taiji.valence.toFixed(3)}`
  + `   calm ${INITIAL_EMOTION_STATE.emotions.calm.toFixed(3)} → ${longOld.emotions.calm.toFixed(3)}`);
console.log(`新版：sad ${INITIAL_EMOTION_STATE.emotions.sad.toFixed(3)} → ${longNew.emotions.sad.toFixed(3)}`
  + `   val ${INITIAL_EMOTION_STATE.taiji.valence.toFixed(3)} → ${longNew.taiji.valence.toFixed(3)}`
  + `   calm ${INITIAL_EMOTION_STATE.emotions.calm.toFixed(3)} → ${longNew.emotions.calm.toFixed(3)}`);
const longReport = aiCoordinator.getEmergenceReport();
console.log(`新版内在驱动占比 = ${(longReport.internalShare * 100).toFixed(1)}%`
  + `（明细 ${JSON.stringify(Object.fromEntries(Object.entries(longReport.breakdown).map(([k, v]) => [k, Number(v.toFixed(3))])))}）`);
console.log(`版末态心情：${JSON.stringify(longNew.internal?.mood)}`);
