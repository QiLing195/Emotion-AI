// 验证潜意识层两条链路：①检测证据累积 ②激活后情感出口真的生效（限幅内）
import { shadowLayer, applyShadowEmotionBias, SHADOW_MAX_TURN_BIAS } from '../src/lib/shadowLayer.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionEngine.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

const emptyThought: any = { nodes: [], edges: [], dissonances: [], stats: {} };
const strategyStats = {
  empathize: { uses: 40, successes: 2 },
  repair: { uses: 35, successes: 3 },
  boundary: { uses: 20, successes: 18 },
};

// ① 证据累积：模拟多轮检测
console.log('=== ① 检测证据累积（每轮 +0.015/条证据，≥0.3 激活）===');
for (const rounds of [1, 10, 25, 40]) {
  const layer = new (shadowLayer.constructor as any)();
  for (let i = 0; i < rounds; i++) layer.detectTraits(emptyThought, null, strategyStats, 50 + i);
  const traits = layer.getState().traits
    .filter((t: any) => t.confidence > 0)
    .map((t: any) => `${t.label}=${t.confidence.toFixed(3)}${t.active ? '(活跃)' : ''}`);
  console.log(`  检测 ${String(rounds).padStart(2)} 次 → ${traits.join('  ') || '（无证据）'}`);
}

// ② 情感出口：注入一个活跃 trait，验证偏置被限幅施加
console.log('\n=== ② 情感出口（激活后每轮的底色偏置）===');
const layer = new (shadowLayer.constructor as any)();
for (let i = 0; i < 40; i++) layer.detectTraits(emptyThought, null, strategyStats, 50 + i);
const active = layer.getActiveTraits();
console.log(`  活跃特质：${active.map((t: any) => `${t.label}(conf=${t.confidence.toFixed(2)})`).join('、') || '（无）'}`);

const mod = layer.getEmotionModulation();
console.log(`  聚合调制：valenceBias=${mod.valenceBias.toFixed(3)} arousalBias=${mod.arousalBias.toFixed(3)} sticky=[${mod.stickyEmotions.join(',')}] alphaV=${mod.alphaVMultiplier}`);

const before = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
const after = applyShadowEmotionBias(before, mod);
console.log(`  施加前：valence=${before.taiji.valence.toFixed(4)} arousal=${before.taiji.arousal.toFixed(4)}`);
console.log(`  施加后：valence=${after.taiji.valence.toFixed(4)} arousal=${after.taiji.arousal.toFixed(4)}`);
console.log(`  实际位移：Δvalence=${(after.taiji.valence - before.taiji.valence).toFixed(4)} Δarousal=${(after.taiji.arousal - before.taiji.arousal).toFixed(4)}（上限 ±${SHADOW_MAX_TURN_BIAS}）`);
console.log(`  限幅生效：${Math.abs(after.taiji.valence - before.taiji.valence) <= SHADOW_MAX_TURN_BIAS + 1e-9 ? '✓' : '✗'}`);

// ③ 持久化往返
const snapshot = JSON.parse(JSON.stringify(layer.getState()));
const restored = new (shadowLayer.constructor as any)();
restored.loadState(snapshot);
const same = JSON.stringify(restored.getEmotionModulation()) === JSON.stringify(layer.getEmotionModulation());
console.log(`\n=== ③ 持久化往返：调制一致 ${same ? '✓' : '✗'}（traits=${snapshot.traits.length}, 活跃=${snapshot.stats.activeTraits}）===`);
