// 临时烟雾测试：直接驱动 aiCoordinator.processTurn，验证 v1.7/v1.8 内在情绪源已接入主链
// 覆盖：情绪传染 / 内在事件 / 心情层 / 反刍 / 强化（奖惩）/ 涌现诊断
//
// v1.13 追加：每轮并排打印**两种情绪读法**：
//   旧 = 绝对值 argmax（基调 calm 0.8 参与竞争 → 几乎永远"平静"）
//   新 = 激发态（相对人格基线的偏离 → 这一轮她真正被激起了什么）
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionEngine.js';
import { separateActivation } from '../src/lib/emotionActivation.js';
import { lowPeriodOf } from '../src/lib/lowPeriod.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

/** 旧读法：绝对值 argmax（复刻 /state 里 dominant 的算法） */
function rawDominant(emotions: Record<string, number>): string {
  const top = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0];
  return `${top?.[0] ?? 'neutral'} ${(top?.[1] ?? 0).toFixed(2)}`;
}

function turn(label: string, text: string, state: EmotionState, opts: Record<string, unknown> = {}) {
  const out = aiCoordinator.processTurn({
    userText: text,
    currentEmotionState: state,
    emotionEvent: null,
    userAnalysis: null,
    recentUserMoods: [],
    roundNumber: 1,
    ...opts,
  } as never);
  const es = out.updatedEmotionState;
  const mood = es.internal?.mood;
  const act = separateActivation(es.emotions);
  console.log(
    `${label.padEnd(14)} valence=${es.taiji.valence.toFixed(4)} sad=${es.emotions.sad.toFixed(4)} ` +
    `joy=${es.emotions.joy.toFixed(4)} mood(V)=${mood?.valence.toFixed(4)} samples=${mood?.samples} ` +
    `rumination=${es.internal?.rumination?.emotion}x${es.internal?.rumination?.streak} ` +
    `internalMs=${out.metadata.timings.internalEmotionMs}`,
  );
  console.log(
    `${''.padEnd(14)} ├ 旧读法(绝对值) ${rawDominant(es.emotions)}` +
    `  └ 新读法(激发态) ${act.note}`,
  );
  return es;
}

// ① 内在事件：12h 独处 → 孤独（无 userAnalysis，纯内在）
const idle12h = Date.now() - 12 * 60 * 60 * 1000;
let s = turn('孤独(12h)', '嗯', structuredClone(INITIAL_EMOTION_STATE), { lastInteractionAt: idle12h });

// ② 久别重逢：>24h → reunion 修复而非孤独
const idle30h = Date.now() - 30 * 60 * 60 * 1000;
s = turn('重逢(30h)', '我回来了', structuredClone(INITIAL_EMOTION_STATE), { lastInteractionAt: idle30h });

// ③ 心情层：连续 8 轮低落 → 心情成形并偏置下一轮
let moodState = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
for (let i = 1; i <= 8; i++) {
  moodState = turn(`低落第${i}轮`, '今天很难过', moodState, {
    userAnalysis: { expressedEmotion: 'sad', intensity: 0.8, directedAtAI: false, likelyCause: '' },
  });
}
// 再给一句中性话：应被低落心情微微往下拉
const neutralBefore = moodState.taiji.valence;
moodState = turn('中性(受心情)', '今天吃了面', moodState);
console.log(`心情偏置：中性轮 valence ${neutralBefore.toFixed(4)} → ${moodState.taiji.valence.toFixed(4)}`);

// ④ 强化：被夸奖（指向她）→ 亲密/愉悦上升
const rewardState = turn('被夸奖', '你真贴心，谢谢你', structuredClone(INITIAL_EMOTION_STATE), {
  userAnalysis: { expressedEmotion: 'gratitude', intensity: 0.9, directedAtAI: true, likelyCause: '' },
});
console.log(`强化后 intimacyFromUser=${rewardState.intimacyFromUser.toFixed(4)} joy=${rewardState.emotions.joy.toFixed(4)}`);
// ④b 指向第三人 → 不应被强化
const thirdParty = turn('骂老板', '我老板真讨厌', structuredClone(INITIAL_EMOTION_STATE), {
  userAnalysis: { expressedEmotion: 'anger', intensity: 0.9, directedAtAI: false, likelyCause: '老板' },
});
console.log(`第三人愤怒 intimacyFromUser=${thirdParty.intimacyFromUser.toFixed(4)}（应与初始一致）`);

// ⑤ 反刍：连续 8 轮同一情绪 → 钝化 + calm 回升
let rumeState = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
for (let i = 1; i <= 8; i++) {
  rumeState = turn(`反刍第${i}轮`, '我还是很难过', rumeState, {
    userAnalysis: { expressedEmotion: 'sad', intensity: 0.9, directedAtAI: false, likelyCause: '' },
  });
}
console.log(`反刍链=${rumeState.internal?.rumination?.emotion}x${rumeState.internal?.rumination?.streak} calm=${rumeState.emotions.calm.toFixed(4)}`);

// ⑥ 涌现诊断
const report = aiCoordinator.getEmergenceReport();
console.log('涌现诊断：', JSON.stringify({
  turns: report.turns,
  internalShare: Number(report.internalShare.toFixed(3)),
  userShare: Number(report.userShare.toFixed(3)),
  autocorr: report.lag1Autocorrelation === null ? null : Number(report.lag1Autocorrelation.toFixed(3)),
  volatility: Number(report.valenceVolatility.toFixed(4)),
  threshold: Number(report.autocorrThreshold.toFixed(3)),
  stuck: report.stuck,
  note: report.note,
}, null, 0));

// ⑦ v1.37 低谷期时长：**跨轮**的量，逐轮那条链路里本来无处安放。
//   验证三件事：连续低落如何累加时长/轮数、她自己往回爬会被记下来、
//   以及"他换了话题"到底能不能结束一段低谷（答案请自己看输出，别预设）。
console.log('\n── v1.37 低谷期时长（read-only，尚未接进任何行为）──');
{
  const HOUR = 3_600_000;
  // 自检跑得比真实时间快得多 ⇒ 用**模拟时钟**读（起点 + N 小时），否则 hours 恒 ≈ 0。
  // 真实运行里 `since` 与 `Date.now()` 都是墙钟，不需要这一层。
  const read = (s: EmotionState, plusHours: number) =>
    lowPeriodOf(s, (s.lowPeriod?.since ?? Date.now()) + plusHours * HOUR);

  let lp = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
  for (let i = 1; i <= 5; i++) {
    lp = turn(`低谷第${i}轮`, '今天很难过', lp, {
      userAnalysis: { expressedEmotion: 'sad', intensity: 0.8, directedAtAI: false, likelyCause: '' },
    });
    const r = read(lp, i);
    if (i <= 2 || i === 5) {
      console.log(`低谷第${i}轮：active=${r.active} established=${r.established} phase=${r.phase} `
        + `hours=${r.hours} turns=${r.turns} depth=${r.depth} peak=${r.peakDepth}`);
    }
  }
  console.log('（注意 turns < 轮数：进入判据看的是**上一轮落定**的状态 —— 她自己先攒，攒过 0.12 才开始计时）');

  for (let i = 1; i <= 6; i++) {
    lp = turn(`中性第${i}轮`, '今天吃了面', lp, {
      userAnalysis: { expressedEmotion: 'neutral', intensity: 0.1, directedAtAI: false, likelyCause: '' },
    });
    const r = read(lp, 5 + i);
    console.log(`中性第${i}轮：active=${r.active} phase=${r.phase} depth=${r.depth} turns=${r.turns}`);
    if (!r.active) { console.log(`→ 已结案：${r.note}`); break; }
    if (i === 6) console.log(`→ 6 轮中性话仍未结案：${r.note}`);
  }
}
