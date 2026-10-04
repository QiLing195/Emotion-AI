// v1.24 实测：九情的时间衰减该回到哪里？
//
// 背景（两个"静息"互相矛盾）：`processTimeDecay` 把九情 `*= decay`（回到 0），
// 而 activation 层按「静息 = calm .8 / greed .2」读 → 长时间没互动后读数变成
// 「情绪上没被激起什么，但基调被压低了：平静 −0.80、贪念 −0.20」。
//
// 本文件其余每一层本来就回归自己的基线（arousal/亲密/三才 → 0.5、greedDrive → 0.3、
// fearAvoidance → 0.1、人格参数 → 50），只有九情漏了 —— 所以这是补漏，不是改设计。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-baseline-decay.ts
import { readFileSync } from 'node:fs';
import { processTimeDecay, setBaselineDecayEnabled } from '../src/lib/emotionTimeDecay.js';
import { activationOf, separateActivation, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import {
  INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET, INITIAL_EMOTION_GENTLE,
} from '../src/lib/emotionTypes.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

const fmt = (e: Record<string, number>) =>
  Object.entries(e).filter(([, v]) => v > 0.005).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(' ') || '(全 0)';

console.log('══ 线上真实状态：衰减 24h / 168h ══\n');
const persisted = (() => {
  try { const j = JSON.parse(readFileSync('memories/emotion_state.json', 'utf8')); return (j.emotionState ?? j) as EmotionState; }
  catch { return null; }
})();

if (persisted) {
  console.log(`衰减前：${fmt(persisted.emotions)}`);
  console.log(`  读数：${activationOf(persisted).note}\n`);
  for (const h of [24, 168]) {
    const out = processTimeDecay(structuredClone(persisted), h);
    console.log(`衰减 ${h}h 后：${fmt(out.emotions)}`);
    console.log(`  新（回基线）：${activationOf(out).note}`);
    setBaselineDecayEnabled(false);
    const legacy = processTimeDecay(structuredClone(persisted), h);
    setBaselineDecayEnabled(true);
    console.log(`  旧（回 0） ：${separateActivation(legacy.emotions).note}`);
    console.log('');
  }
} else {
  console.log('（没读到 memories/emotion_state.json，跳过）\n');
}

console.log('══ 三个人设长时间之后停在哪儿 ══\n');
const show = (label: string, state: EmotionState) => {
  const out = processTimeDecay(structuredClone(state), 168);
  console.log(`${label}`);
  console.log(`  静息基线：${fmt((state.baselineEmotions ?? RESTING_EMOTION_BASELINE) as Record<string, number>)}`);
  console.log(`  168h 后 ：${fmt(out.emotions)}   读数：${activationOf(out).note}`);
};
show('默认人设', structuredClone(INITIAL_EMOTION_STATE));
show('sweet_girlfriend（love .4 是她"平时"的样子）', structuredClone(INITIAL_EMOTION_SWEET));
show('gentle_girlfriend（calm .9）', structuredClone(INITIAL_EMOTION_GENTLE));

console.log('\n══ 对照：同一函数的其他层本来就有基线 ══\n');
const s = structuredClone(INITIAL_EMOTION_STATE);
s.taiji.arousal = 0.95;
s.reinforcement.greedDrive = 0.9;
s.reinforcement.fearAvoidance = 0.8;
s.evolution.trust = 90;
const out = processTimeDecay(s, 168);
console.log(`  arousal       0.950 → ${out.taiji.arousal.toFixed(3)}   （回归 0.5）`);
console.log(`  greedDrive    0.900 → ${out.reinforcement.greedDrive.toFixed(3)}   （回归 0.3）`);
console.log(`  fearAvoidance 0.800 → ${out.reinforcement.fearAvoidance.toFixed(3)}   （回归 0.1）`);
console.log(`  trust        90.000 → ${out.evolution.trust.toFixed(3)}   （回归 50）`);
console.log(`  九情          ${fmt(structuredClone(INITIAL_EMOTION_STATE).emotions)} → ${fmt(out.emotions)}   ← 原本只剩这一层没有回归目标`);
console.log(`\n  所以 v1.24 只是把九情也写成"基线 + 偏移 × decay"，与上面几行同一个写法。`);
console.log(`  开关：DISABLE_BASELINE_DECAY=true 可回到旧行为（衰减到 0），仅供 A/B 与回退。`);
