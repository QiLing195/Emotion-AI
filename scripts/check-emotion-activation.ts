// 情绪表示层自检（v1.13）：把「她此刻被激起了什么」摊开，并验证它真的进入了记忆。
//
// 回答两个问题：
//   ① 同一份 emotions 向量，绝对值 argmax（旧）与激发态（新）分别读出什么？
//   ② 这个读法有没有真的落到**她的记忆**里（记忆标签 + 叙事片段）？
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-emotion-activation.ts
import { separateActivation, describeActivation, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { createEpisodicMemoryStore, tryFormEpisode } from '../src/lib/episodicMemory.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionEngine.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

const line = (s = '') => console.log(s);

/** 旧读法：/state 里 dominant 的算法（绝对值 argmax） */
function rawDominant(emotions: Record<string, number>) {
  const top = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0];
  return { name: top?.[0] ?? 'neutral', intensity: top?.[1] ?? 0 };
}

line('══ ① 两种读法对照 ══\n');

const cases: { label: string; emotions: Record<string, number> }[] = [
  { label: '线上真实向量（2026-09 抄自 /state）', emotions: {
    calm: 0.439, greed: 0.359, love: 0.184, lust: 0.184, joy: 0.175,
    sad: 0.133, disgust: 0.125, anger: 0.121, fear: 0.072 } },
  { label: '静息（正好等于人格基线）', emotions: { ...RESTING_EMOTION_BASELINE } },
  { label: '他很难过 → 她被牵动（sad 0.18）', emotions: { ...RESTING_EMOTION_BASELINE, sad: 0.18 } },
  { label: '她很开心（joy 0.4）', emotions: { ...RESTING_EMOTION_BASELINE, joy: 0.4 } },
  { label: '被哄好了但底色还沉（calm 0.55 低于基线）', emotions: { ...RESTING_EMOTION_BASELINE, calm: 0.55, joy: 0.22 } },
  { label: '难过与爱意势均力敌（说不清）', emotions: { ...RESTING_EMOTION_BASELINE, sad: 0.3, love: 0.31 } },
];

for (const c of cases) {
  const raw = rawDominant(c.emotions);
  line(`【${c.label}】`);
  line(`  旧（绝对值 argmax）：${raw.name} ${raw.intensity.toFixed(2)}`);
  for (const l of describeActivation(c.emotions)) line(`  ${l}`);
  line();
}

line('══ ② 它有没有真的进入她的记忆？ ══\n');

// 直接形成一条记忆，看标签与叙事用的是哪个读法
const store = createEpisodicMemoryStore();
store.prevValence = 0.15;   // 模拟"他这句话之前"的效价
const state: EmotionState = {
  ...structuredClone(INITIAL_EMOTION_STATE),
  taiji: { valence: -0.03, arousal: 0.48, expectation: 0.1 },
  emotions: { ...RESTING_EMOTION_BASELINE, sad: 0.18, calm: 0.78 },
} as EmotionState;

const ep = tryFormEpisode(store, state, '我今天特别难过，什么都做不好', '');
if (!ep) {
  line('（这条没达到成忆门槛，换个更强的状态再试）');
} else {
  const a = separateActivation(state.emotions);
  line(`他说：${ep.eventSummary}`);
  line(`valenceΔ = ${ep.emotionalImpact.valenceDelta.toFixed(3)}`);
  line(`她的情绪标签 = ${ep.emotionalImpact.dominantEmotion}`);
  line(`她的叙事     = ${ep.narrativeFragment}`);
  line();
  const oldLabel = rawDominant(state.emotions).name;
  line(`旧读法会给的标签 = ${oldLabel}${oldLabel === ep.emotionalImpact.dominantEmotion ? '（与现在相同）' : '  ← 修好了'}`);
  line(`激发态读法       = ${a.note}`);
  line(ep.emotionalImpact.dominantEmotion === 'calm' && rawDominant(state.emotions).name === 'calm'
    ? '⚠️ 仍标成 calm —— 检查 separateActivation 是否被真正接进 tryFormEpisode'
    : '✓ 记忆标签不再无条件等于基调');
}
