// 评价层实测（v1.14）：同一句话，她心里**挂着** vs **没挂着**，她的反应一样吗？
//
// 这是"理解"与"镜像"的分界：
//   镜像（情绪传染）只会说"他也难过，所以我也难过"—— 与"这件事对她意味着什么"无关；
//   评价层要说的是"他说的正是我挂着的那件事"→ 我替他悬着、想靠近他。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-appraisal.ts
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, setDeterministicMode } from '../src/lib/emotionEngine.js';
import { separateActivation } from '../src/lib/emotionActivation.js';
import type { EmotionState, Motive } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

function motive(content: string, kind: Motive['kind'], salience: number): Motive {
  return {
    id: `m_${content}`, kind, content, source: {}, salience,
    formedAt: Date.now(), expiresAt: Date.now() + 86400_000, attempts: 0,
  };
}

/** 造一个"她心里挂着面试那件事"的状态 */
function stateWith(concerns: Motive[]): EmotionState {
  const s = structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
  s.internal = { ...(s.internal ?? {}), motive: { pool: concerns } } as EmotionState['internal'];
  return s;
}

interface Shot { label: string; delta: Record<string, number>; activation: string; note: string; readings: string[] }

function run(label: string, concerns: Motive[], userText: string, ua: any): Shot {
  const before = stateWith(concerns);
  const beforeEmo = { ...before.emotions };
  const out = aiCoordinator.processTurn({
    userText,
    currentEmotionState: before,
    emotionEvent: null,
    userAnalysis: ua,
    recentUserMoods: [],
    roundNumber: 1,
    lastInteractionAt: Date.now(),
  } as never);
  const after = out.updatedEmotionState;
  const delta: Record<string, number> = {};
  for (const k of Object.keys(after.emotions)) delta[k] = after.emotions[k] - (beforeEmo[k] ?? 0);
  const a = aiCoordinator.getLastAppraisal();
  return {
    label,
    delta,
    activation: separateActivation(after.emotions).note,
    note: a?.note ?? '（没有评价记录）',
    readings: (a?.readings ?? []).map(r => r.reason),
  };
}

const INTERVIEW = motive('他面试那事有消息了吗', 'open_loop', 0.8);
const CAT = motive('他上次说的那家猫咖叫什么', 'curiosity', 0.5);
const sad = { expressedEmotion: 'sad', intensity: 0.8, directedAtAI: false, likelyCause: '面试' };

const shots = [
  run('① 她挂着面试 + 他说面试挂了', [INTERVIEW], '面试又挂了，好烦', sad),
  run('② 她没挂着    + 他说面试挂了', [CAT], '面试又挂了，好烦', sad),
  run('③ 她挂着面试 + 他说面试过了', [INTERVIEW], '面试过了！', { ...sad, expressedEmotion: 'joy' }),
  run('④ 她挂着面试 + 只提了去面试', [INTERVIEW], '今天去面试了', { ...sad, expressedEmotion: 'neutral', intensity: 0.3 }),
];

console.log('同一句话「面试又挂了」，她心里挂着 / 没挂着 —— 她的九情变化\n');
const keys = ['fear', 'sad', 'love', 'joy', 'calm'];
console.log('情景'.padEnd(30) + keys.map(k => k.padStart(9)).join('') + '   激发态读数');
console.log('─'.repeat(112));
for (const s of shots) {
  console.log(s.label.padEnd(30) + keys.map(k => (s.delta[k] ?? 0).toFixed(3).padStart(9)).join('') + '   ' + s.activation);
}
console.log('\n── 评价层给出的理由（可审计）──');
for (const s of shots) {
  console.log(`\n【${s.label}】`);
  if (!s.readings.length) console.log('  ' + s.note);
  else for (const r of s.readings) console.log('  · ' + r);
}
console.log('\n── 判读 ──');
console.log('①② 是同一句话、同一个他的情绪，唯一差别是**她心里有没有挂着这件事**：');
console.log('   ② 只有"我也难过"（镜像）；① 额外出现 fear（替他悬着）—— 这就是"理解"。');
console.log('③④ 说明同一件牵挂，好消息与"还没结果"对她的意义不同（松一口气 vs 悬着）。');

// ── 累积：单轮幅度小（fear +0.015，低于死区 0.05），他反复提这件事时会不会越过死区？──
console.log('\n── 累积：他连着几轮都在说这件事 ──');
{
  let s = stateWith([INTERVIEW]);
  const f0 = s.emotions.fear;
  console.log('轮次   fear    相对该轮起点   激发态读数');
  for (let i = 1; i <= 6; i++) {
    const before = { ...s.emotions };
    const out = aiCoordinator.processTurn({
      userText: '面试那事还是没消息，烦',
      currentEmotionState: s,
      emotionEvent: null,
      userAnalysis: { expressedEmotion: 'sad', intensity: 0.8, directedAtAI: false, likelyCause: '面试' },
      recentUserMoods: [],
      roundNumber: i,
      lastInteractionAt: Date.now(),
    } as never);
    s = out.updatedEmotionState;
    console.log(`${String(i).padStart(3)}   ${s.emotions.fear.toFixed(3)}   `
      + `${(s.emotions.fear - f0 >= 0 ? '+' : '')}${(s.emotions.fear - f0).toFixed(3)}（vs 起点）      `
      + separateActivation(s.emotions).note);
  }
}
