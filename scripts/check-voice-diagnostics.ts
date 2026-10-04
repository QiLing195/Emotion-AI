// 一次性核对：拿 /state 的真实数据跑一遍发声诊断的展示逻辑，确认面板会显示什么。
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-voice-diagnostics.ts
import { describeVoicePerformance } from '../src/lib/voiceTone.js';

const res = await fetch('http://127.0.0.1:3000/state');
const state: any = await res.json();
const lines = describeVoicePerformance(state.voice ?? null, state.voiceArc ?? null);

console.log('── 设置页「发声诊断」面板将显示 ──');
for (const l of lines) console.log(l);

if (!state.voice) {
  console.log('\n⚠️ 还没有发声记录：先在应用里发一句话（或调用一次 /api/tts）再看。');
} else {
  const used = state.voiceArc?.used;
  console.log(`\n✓ 有记录；句内弧线 used=${used}`);
}
