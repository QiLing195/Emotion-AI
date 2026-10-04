// P2 实测（v1.23）：
//   ① 静息基线跟着人设走 —— 同一个向量，三个人设读出什么？
//   ② 长周期人格漂移 —— 让"经历"累积 100 轮，人格往哪走？（以及 resilience 会不会被打爆）
//   ③ 附带记下一条**新发现**：引擎的衰减目标与 activation 的基线互相矛盾（各自都能复现）
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-long-term-drift.ts
import { readFileSync } from 'node:fs';
import {
  separateActivation, activationOf, baselineForPersona, RESTING_EMOTION_BASELINE,
} from '../src/lib/emotionActivation.js';
import {
  INITIAL_EMOTION_STATE, INITIAL_EMOTION_SWEET, INITIAL_EMOTION_GENTLE,
} from '../src/lib/emotionTypes.js';
import {
  applyLongTermDrift, computePersonalityDriftVelocity, LONG_TERM_DRIFT_SCALE,
} from '../src/lib/personalityEvolution.js';
import { processTimeDecay, setDeterministicMode } from '../src/lib/emotionEngine.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

console.log('══ ① 静息基线跟着人设走 ══\n');
const show = (label: string, state: EmotionState) => {
  const withDefault = separateActivation(state.emotions, RESTING_EMOTION_BASELINE);
  const withOwn = activationOf(state);
  console.log(`${label}`);
  console.log(`  她自己的静息值    ${Object.entries(state.emotions).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  用默认基线读      ${withDefault.note}   ← 错的那份（把人格基调当成了"被激起的情绪"）`);
  console.log(`  用她自己的基线读  ${withOwn.note}`);
  console.log('');
};
show('默认人设（calm .8 / greed .2）', structuredClone(INITIAL_EMOTION_STATE));
show('sweet_girlfriend（苏苏：love .4 / greed .35 / joy .3）', structuredClone(INITIAL_EMOTION_SWEET));
show('gentle_girlfriend（林晚：calm .9 / joy .2 / greed .1）', structuredClone(INITIAL_EMOTION_GENTLE));
console.log(`baselineForPersona('sweet_girlfriend').love = ${baselineForPersona('sweet_girlfriend')?.love}`);
console.log(`baselineForPersona('不认识的人设') = ${baselineForPersona('nope')}  ← undefined ⇒ 调用方保留状态里的基线，不乱猜\n`);

console.log('══ ② 长周期漂移：100 轮（每 20 轮算一次，共 5 次）══\n');

/** 造一批情景记忆（只用到漂移真正读的字段） */
const memories = (mix: 'warm' | 'rough' | 'mixed', n = 30) =>
  Array.from({ length: n }, (_, i) => ({
    id: `ep_${i}`,
    emotionalImpact: {
      valenceDelta: mix === 'warm' ? 0.5 : mix === 'rough' ? -0.5 : (i % 2 ? 0.5 : -0.5),
      dominantEmotion: mix === 'warm' && i % 3 === 0 ? 'love' : 'calm',
    },
    tags: mix === 'rough' ? ['冲突'] : (i % 4 === 0 ? ['温暖'] : []),
  })) as never;

const run = (label: string, mix: 'warm' | 'rough' | 'mixed') => {
  const evo: Record<string, number> = {
    trust: 50, openness: 50, playfulness: 50,
    empathy: 70, optimism: 60, sensitivity: 0.5, resilience: 0.886,
  };
  const before = { ...evo };
  const perRun: string[] = [];
  for (let round = 20; round <= 100; round += 20) {
    const { changes } = applyLongTermDrift(evo as never, memories(mix));
    perRun.push(`第${round}轮 ${Object.entries(changes).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${(v as number).toFixed(3)}`).join(' ') || '(无)'}`);
  }
  console.log(`${label}`);
  for (const line of perRun) console.log(`    ${line}`);
  console.log(`    100 轮累计：` + Object.keys(before).filter(k => k in LONG_TERM_DRIFT_SCALE)
    .map(k => `${k} ${before[k].toFixed(3)} → ${evo[k].toFixed(3)}`).join('   '));
  console.log(`    resilience 是否越界：[0,1] 内 = ${evo.resilience >= 0 && evo.resilience <= 1}\n`);
};

run('全是有温度的记忆（8 成正向）', 'warm');
run('全是不顺的记忆（全是冲突/负向）', 'rough');
run('一半一半', 'mixed');

console.log('── 单次位移上限（按参数分尺度）──');
console.log('   ' + Object.entries(LONG_TERM_DRIFT_SCALE).map(([k, v]) => `${k} ≤ ${v}`).join('   '));
console.log('   注意 resilience 是 [0,1] 而 trust 等是 [0,100] —— 共用系数会一次把它打爆。\n');

console.log('══ ③ 附带发现：两个"静息"互相矛盾 ══\n');
const persisted = (() => { try { const j = JSON.parse(readFileSync('memories/emotion_state.json', 'utf8')); return j.emotionState ?? j; } catch { return null; } })();
if (persisted) {
  console.log(`线上状态：${activationOf(persisted).note}`);
  const decayed = processTimeDecay(structuredClone(persisted), 1000);
  console.log(`衰减 1000h 后：九情全部 → 0（processTimeDecay 乘指数，没有回归目标）`);
  console.log(`  用 activation 的基线读：${separateActivation(decayed.emotions).note}`);
  console.log('  ↑ 同一个"静息"，一边说基线是 calm .8/greed .2，一边把九情归零 —— 两者只能对一个。');
  console.log('    这会影响"长时间没说话之后她的状态"（v1.15 的语义是 0 = 中性），需要单独决策，本次没动。');
} else {
  console.log('（没读到 memories/emotion_state.json，跳过）');
}
console.log(`\n默认基线（activation 层用的）：${JSON.stringify(RESTING_EMOTION_BASELINE)}`);
console.log(`线上 evolution（长周期漂移的起点）：trust/openness/playfulness ~50，resilience 0.886`);

// 原始趋势（不落参数）也打印一次，便于解释"为什么往这边动"
console.log('\n原始趋势示例（warm 记忆 ×30）：');
const v = computePersonalityDriftVelocity({} as never, memories('warm'));
console.log('   ' + Object.entries(v).map(([k, x]) => `${k} ${x}`).join('   '));
