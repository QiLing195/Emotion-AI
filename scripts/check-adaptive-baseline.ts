// v1.25 实测：把"参照物"从**人格本性**换成**她最近一段时间的常态**，到底值不值？
//
// 要回答三个问题（都用**真实管道** aiCoordinator.processTurn，只把时间轴接到可控的"过了多久"）：
//   ① 稳态：常态参照会不会把长期底色噪声消掉？（现状：`suppressed` 长期列着 calm/love/joy/greed）
//   ② 风险：**适应器会不会吞掉信号**？—— 他持续低落很久之后，她还能不能读出自己难过？多久开始读不出？
//   ③ 好处：换参照之后，**真正的变化**还报不报？（好消息来的时候能不能看见）
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/check-adaptive-baseline.ts
import { readFileSync } from 'node:fs';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { INITIAL_EMOTION_STATE, setDeterministicMode } from '../src/lib/emotionEngine.js';
import {
  activationOf, activationTypicalOf, updateTypicalEmotions, separateActivation,
  EMOTION_TYPICAL_HALF_LIFE_H, RESTING_EMOTION_BASELINE,
} from '../src/lib/emotionActivation.js';
import type { EmotionState } from '../src/lib/emotionTypes.js';

setDeterministicMode(true);

const HOUR = 3600_000;

/** 走一轮真实管道；`gapHours` 模拟"距离上一轮过了多久"（只影响常态老化，不改引擎动力学） */
function step(state: EmotionState, text: string, ua: Record<string, unknown>, gapHours: number): EmotionState {
  // 把常态的上次更新时间往前挪 → EMA 看到的时间间隔就是 gapHours
  (state as { typicalUpdatedAt?: number }).typicalUpdatedAt = Date.now() - gapHours * HOUR;
  const out = aiCoordinator.processTurn({
    userText: text,
    currentEmotionState: state,
    emotionEvent: null,
    userAnalysis: { expressedEmotion: 'neutral', intensity: 0.2, directedAtAI: false, likelyCause: 't', ...ua },
    recentUserMoods: [],
    roundNumber: 1,
    lastInteractionAt: Date.now(),
  } as never);
  return out.updatedEmotionState;
}

const both = (s: EmotionState) =>
  `本性：${activationOf(s).note}\n             常态：${activationTypicalOf(s).note}`;

/** 线上真实状态（拿不到就退回默认人设）——"常驻噪声"这个问题只在真实运行点上才看得见 */
function liveState(): EmotionState {
  try {
    const j = JSON.parse(readFileSync('memories/emotion_state.json', 'utf8'));
    const s = j.emotionState ?? j;
    return { ...structuredClone(INITIAL_EMOTION_STATE), ...s } as EmotionState;
  } catch {
    return structuredClone(INITIAL_EMOTION_STATE);
  }
}

// ── ① 稳态：从**线上真实状态**出发，跑 40 轮日常闲聊（每轮间隔 6h = 共 10 天）──
//
// 为什么要用线上真实状态 + 长跨度：常态 EMA 半衰期 72h，只模拟 2 小时它根本来不及动
// （第一版脚本就犯了这个错：40 轮 ×3 分钟 = 2h，常态参照从 .800 只挪到 .802，什么也没说明）。
console.log('══ ① 稳态：从线上真实状态出发，40 轮闲聊（间隔 6h ≈ 10 天）══\n');
{
  let s: EmotionState = structuredClone(liveState());
  const t0 = (s as { typicalEmotions?: Record<string, number> }).typicalEmotions ?? {};
  console.log(`起点（线上真实状态，还没有常态记录 → 冷启动取**人格本性**）：`);
  console.log(`  emotions: calm ${s.emotions.calm.toFixed(3)} love ${s.emotions.love.toFixed(3)} joy ${s.emotions.joy.toFixed(3)} greed ${s.emotions.greed.toFixed(3)}`);
  console.log(`  本性：${activationOf(s).note}`);
  console.log(`  → 本性 suppressed = [${activationOf(s).suppressed.join(', ') || '（空）'}]　（这就是"常驻噪声"）\n`);

  const CHAT = ['今天天气不错', '刚吃完饭', '在看书', '有点困了', '刚洗完澡', '准备睡了'];
  for (let i = 1; i <= 40; i++) {
    s = step(s, CHAT[i % CHAT.length], {}, 6);
    if (i % 8 === 0) {
      const t = (s as { typicalEmotions?: Record<string, number> }).typicalEmotions ?? {};
      console.log(`第 ${String(i).padStart(2)} 轮（累计 ${(i * 6 / 24).toFixed(0)} 天）：常态参照 calm ${t.calm?.toFixed(3)} love ${t.love?.toFixed(3)} joy ${t.joy?.toFixed(3)}`);
      console.log(`  她的 emotions：calm ${s.emotions.calm.toFixed(3)} love ${s.emotions.love.toFixed(3)} joy ${s.emotions.joy.toFixed(3)}`);
      console.log(`  本性：${activationOf(s).note}`);
      console.log(`       suppressed = [${activationOf(s).suppressed.join(', ') || '（空）'}]`);
      console.log(`  常态：${activationTypicalOf(s).note}`);
      console.log(`       suppressed = [${activationTypicalOf(s).suppressed.join(', ') || '（空）'}]\n`);
    }
  }
}

// ── ② 风险：适应器会不会吞掉信号？────────────────────────────────────────
console.log('══ ② 风险：他持续低落，她多久之后"读不出自己难过"？══\n');
{
  const run = (gapHours: number, label: string) => {
    let s: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
    const marks: string[] = [];
    for (let i = 1; i <= 60; i++) {
      s = step(s, '我今天特别难过，什么都做不好', { expressedEmotion: 'sad', intensity: 0.9 }, gapHours);
      const typ = activationTypicalOf(s);
      const sadTyp = typ.delta.sad ?? 0;
      const sadDisp = activationOf(s).delta.sad ?? 0;
      if (i === 1 || i === 5 || i === 10 || i === 20 || i === 30 || i === 60) {
        marks.push(`  第 ${String(i).padStart(2)} 轮（累计 ${(i * gapHours).toFixed(1)}h）：`
          + `sad 相对本性 +${sadDisp.toFixed(3)} / 相对常态 +${sadTyp.toFixed(3)}`
          + `　常态参照的 sad ${(typ.baseline.sad ?? 0).toFixed(3)}`);
      }
    }
    console.log(`${label}`);
    for (const m of marks) console.log(m);
    console.log('');
  };
  run(0.05, '每轮间隔 3 分钟（真实聊天节奏：一次低落对话）');
  run(8, '每轮间隔 8 小时（每天一次、连着 20 天的低落）');
}

// ── ③ 好处：换参照之后，真正的变化还报不报？──────────────────────────────
console.log('══ ③ 他忽然带来一个好消息，两个读数分别怎么说？══\n');
{
  // 先过 10 天日常（把常态参照喂成"她最近的样子"），再来一句真的开心
  let s: EmotionState = structuredClone(liveState());
  const CHAT = ['今天天气不错', '刚吃完饭', '在看书', '有点困了', '刚洗完澡', '准备睡了'];
  for (let i = 0; i < 40; i++) s = step(s, CHAT[i % CHAT.length], {}, 6);
  const t = (s as { typicalEmotions?: Record<string, number> }).typicalEmotions ?? {};
  console.log(`10 天日常之后：常态参照 joy ${t.joy?.toFixed(3)} love ${t.love?.toFixed(3)} calm ${t.calm?.toFixed(3)}`);
  console.log(`  ${both(s)}\n`);

  const after = step(s, '我今天拿到offer了，太开心了！', { expressedEmotion: 'joy', intensity: 0.9, directedAtAI: true }, 0.05);
  console.log(`他说「我今天拿到 offer 了，太开心了！」之后：`);
  console.log(`  ${both(after)}`);
  console.log(`  joy 位移：相对本性 +${(activationOf(after).delta.joy ?? 0).toFixed(3)}　相对常态 +${(activationTypicalOf(after).delta.joy ?? 0).toFixed(3)}`);
}

// ── ④ 半衰期扫描：用真实管道采两条轨迹，再离线扫参数（把"72h 的理由"从断言变成数据）──
console.log('══ ④ 半衰期扫描（轨迹来自真实管道，EMA 离线扫参）══\n');
{
  const DEADZONE = 0.05;
  const chatTraj: Record<string, number>[] = [];
  {
    let s: EmotionState = structuredClone(liveState());
    const CHAT = ['今天天气不错', '刚吃完饭', '在看书', '有点困了', '刚洗完澡', '准备睡了'];
    for (let i = 0; i < 40; i++) { s = step(s, CHAT[i % CHAT.length], {}, 6); chatTraj.push({ ...s.emotions }); }
  }
  const sadTraj: Record<string, number>[] = [];
  {
    let s: EmotionState = structuredClone(INITIAL_EMOTION_STATE);
    for (let i = 0; i < 40; i++) {
      s = step(s, '我今天特别难过，什么都做不好', { expressedEmotion: 'sad', intensity: 0.9 }, 8);
      sadTraj.push({ ...s.emotions });
    }
  }
  console.log(`轨迹：日常 ${chatTraj.length} 轮 × 6h（${(chatTraj.length * 6 / 24).toFixed(0)} 天）· 低落 ${sadTraj.length} 轮 × 8h（${(sadTraj.length * 8 / 24).toFixed(0)} 天）\n`);

  const sweep = (H: number) => {
    const ref: Record<string, number> = { ...RESTING_EMOTION_BASELINE };
    let convergeDay: number | null = null;
    chatTraj.forEach((emo, i) => {
      const alpha = 1 - Math.pow(2, -6 / H);
      for (const k of Object.keys(ref)) ref[k] = ref[k] + ((emo[k] ?? 0) - ref[k]) * alpha;
      if (convergeDay === null && separateActivation(emo, ref).suppressed.length === 0) convergeDay = (i + 1) * 6 / 24;
    });
    // ⚠️ 度量口径踩过一次坑：不能用"第一次低于死区"当吞信号的日子 ——
    // **第一轮**她的 sad 位移本来就只有 +0.047（单轮强度就不够），与半衰期无关，
    // 于是每个半衰期都报"第 0.3 天"，表看着毫无分辨力。正确的口径是
    // "**曾经报过之后**，多久掉回死区以下"（先升上去、被参照追平、再掉下来）。
    const ref2: Record<string, number> = { ...RESTING_EMOTION_BASELINE };
    let swallowDay: number | null = null;
    let everRaised = false;
    sadTraj.forEach((emo, i) => {
      const alpha = 1 - Math.pow(2, -8 / H);
      for (const k of Object.keys(ref2)) ref2[k] = ref2[k] + ((emo[k] ?? 0) - ref2[k]) * alpha;
      const raised = Math.abs((emo.sad ?? 0) - ref2.sad) >= DEADZONE;
      if (raised) everRaised = true;
      else if (everRaised && swallowDay === null) swallowDay = (i + 1) * 8 / 24;
    });
    return { convergeDay, swallowDay };
  };

  console.log('半衰期    清空「基调被压低」常驻噪声        读不出「难过」(位移<0.05)');
  console.log('-'.repeat(70));
  for (const H of [6, 12, 24, 48, 72, 168, 336]) {
    const r = sweep(H);
    const c = r.convergeDay === null ? '未收敛(>10天)' : `第 ${r.convergeDay.toFixed(1)} 天`;
    const sw = r.swallowDay === null ? '未吞掉(>13天)' : `第 ${r.swallowDay.toFixed(1)} 天`;
    console.log(`${String(H).padStart(4)}h    ${c.padEnd(32)}${sw}`);
  }
  console.log(`\n怎么读这张表（两列的可靠性不一样）：`);
  console.log(`  · 第一列可信：收敛速度就是"约 2~3 个半衰期"，6h→1.0 天、24h→3.0 天、48h→5.0 天、72h→6.8 天；`);
  console.log(`    168h 以上 10 天内根本不收敛 —— 那时读数长期卡在本性与运行点之间，等于没解决问题。`);
  console.log(`  · 第二列要小心：这里模拟的是"每轮都在说你很难过"（单调升到饱和），`);
  console.log(`    目标一直在往上跑，所以它量的是"参照追平一个移动目标要多久"，不是"适应一段静止的持续低落"。`);
  console.log(`    后者按半衰期算就是 ~2~3 个半衰期（24h→2~3 天、72h→6~9 天）。`);
  console.log(`  → 结论是一个**区间**而不是一个精确值：6h 太快（参照贴着当前值走，失去"常态"的含义）、`);
  console.log(`    168h 以上太慢（没法用）。取 ${EMOTION_TYPICAL_HALF_LIFE_H}h 是这条区间里**偏保守**的一端：`);
  console.log(`    宁可收敛慢一点，也不要把一段低落几天就学成"正常"。`);
  console.log(`这条读数**只做诊断**（并排暴露在 /state）；决策路径仍用相对本性的那个 —— 见 emotionTypicalBaseline.test.ts 的约定守卫。`);
}

console.log(`\n── 参数 ──`);
console.log(`  常态 EMA 半衰期 ${EMOTION_TYPICAL_HALF_LIFE_H}h（太短会吞信号、太长则收敛慢到等于没解）`);
console.log(`  常态参照**不参与任何动力学**（只读）；衰减回归的目标仍是人格本性 baselineEmotions。`);
console.log(`  两者并排暴露：/state → activation（相对本性）与 /state → activationTypical（相对常态）。`);
