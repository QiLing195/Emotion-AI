// ── v1.15 一次性状态修复：清理「幽灵预测误差」造成的损伤 ──
// 背景：修复前，无信号事件会产生 error = 0 − expectation 并被损失厌恶放大，
//       把她从 0.2 一路拖到 −0.49，同时 expectation 被侵蚀到 ≈0（乐观基线流失）。
//       引擎修好后不会再恶化，但**已经造成的损伤不会自动复原**（回升需要真实正面信号）。
// 本脚本把太极恢复到人格基线、把九情复位到该人格的静息profile、并清掉在损伤期学到的心情/反刍。
//
// 用法：
//   npx tsx scripts/repair-emotion-state.ts           # 只看诊断（dry-run，不写盘）
//   npx tsx scripts/repair-emotion-state.ts --apply   # 执行修复（先备份 .bak-<时间戳>）

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '../memories/emotion_state.json');
const apply = process.argv.includes('--apply');

if (!fs.existsSync(FILE)) {
  console.log('未找到 memories/emotion_state.json，无需修复');
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const baseline = Number(state?.evolution?.baseline ?? 0.2);
const before = {
  valence: Number(state?.taiji?.valence ?? 0),
  arousal: Number(state?.taiji?.arousal ?? 0),
  expectation: Number(state?.taiji?.expectation ?? 0),
  sad: Number(state?.emotions?.sad ?? 0),
  disgust: Number(state?.emotions?.disgust ?? 0),
  mood: state?.internal?.mood ? Number(state.internal.mood.valence) : null,
  rumination: state?.internal?.rumination?.emotion ?? null,
  lowPeriodHours: state?.lowPeriod?.since
    ? Number(((Date.now() - Number(state.lowPeriod.since)) / 3_600_000).toFixed(2))
    : null,
};

console.log('=== 修复前 ===');
console.log(`  太极：valence=${before.valence.toFixed(3)} arousal=${before.arousal.toFixed(3)} expectation=${before.expectation.toFixed(3)}`);
console.log(`  人格基线 evolution.baseline = ${baseline.toFixed(3)}`);
console.log(`  九情：sad=${before.sad.toFixed(3)} disgust=${before.disgust.toFixed(3)}`);
console.log(`  内在：mood=${before.mood === null ? 'n/a' : before.mood.toFixed(3)} rumination=${before.rumination ?? 'n/a'}`);
console.log(`  低谷：${before.lowPeriodHours === null ? '不在低谷' : `已持续 ${before.lowPeriodHours} 小时`}`);

// 期望值只有被真实正面信号才该上升；这里按"回到人格基线"处理，等价于把损伤抹掉
const targetExpectation = baseline;
const targetValence = baseline;

console.log('\n=== 修复方案 ===');
console.log(`  太极 valence/expectation → 人格基线 ${baseline.toFixed(3)}；arousal → 0.5`);
console.log('  九情 → 复位为该人格静息 profile（joy/love/sad/fear/anger/disgust/lust=0, calm=0.8, greed=0.2）');
console.log('  内在：清空 mood 与 rumination（它们是在损伤期学到的），保留 satiation 计数');
console.log('  低谷：结案（九情既然复位到静息，那段低谷就不该继续挂着 —— 见 v1.37 lowPeriod）');
console.log('  交互计数与记忆不动（只修情绪状态）');

if (!apply) {
  console.log('\n（dry-run：未写入任何文件。加 --apply 执行）');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${FILE}.bak-${stamp}`;
fs.copyFileSync(FILE, backup);

state.taiji = { ...state.taiji, valence: targetValence, arousal: 0.5, expectation: targetExpectation };
state.emotions = {
  joy: 0, anger: 0, sad: 0, fear: 0, love: 0, disgust: 0, lust: 0, calm: 0.8, greed: 0.2,
  ...(state.emotions && typeof state.emotions === 'object' ? {} : {}),
};
if (state.internal && typeof state.internal === 'object') {
  delete state.internal.mood;
  delete state.internal.rumination;
}
// v1.37：低谷读数既然建立在九情之上，九情复位到静息就等于那段低谷结束了。
// 不清的话 /state 会继续报"她处在低谷第 N 小时"，而状态早已回到静息 —— 读数与状态打架。
if (state.lowPeriod && typeof state.lowPeriod === 'object') {
  state.lowPeriod = {
    since: null,
    lastEvaluatedAt: Date.now(),
    peakDepth: 0,
    lastDepth: 0,
    lastDelta: 0,
    turns: 0,
    selfRecovery: 0,
    ...(state.lowPeriod.lastEpisode ? { lastEpisode: state.lowPeriod.lastEpisode } : {}),
  };
}

const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
fs.renameSync(tmp, FILE);

console.log(`\n=== 已修复 ===`);
console.log(`  备份：${path.basename(backup)}`);
console.log(`  现在：valence=${targetValence.toFixed(3)} expectation=${targetExpectation.toFixed(3)} arousal=0.5`);
console.log('  提示：需重启服务让新状态生效；如需回滚，把备份文件改回 emotion_state.json 即可。');
