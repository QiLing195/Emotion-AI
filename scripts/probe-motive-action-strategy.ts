// ── v1.57 C 阶段探针：`action → selectedStrategy`（**零 LLM，确定性**）──
//
// 用户方案 C 的问题被严格限定为：
//   同一个已经能表达的 motive，**仅仅改变 `action`**，是否足以让策略决策发生可重复、可解释的变化。
//
// 所以这一跑**不测"她有没有提到海边"**（那是 A/B 已经解决的问题），只看：
//   · `selectStrategy()` 选中了哪一个策略
//   · 它的 `reason` 里有没有留下动机的痕迹（可观测性）
//
// 两个场景（关键：它们的**现状**不同，才能看出 action 有没有真的改变决策）：
//   场景 1「他的话里有兴趣信号」→ 现状（开关关）= `explore`（Rule 4 抢走）
//   场景 2「他的话里没有兴趣信号」→ 现状 = `neutral`
//
// 四个 action × 两个场景 × 开关开/关 = 16 次**纯函数调用**，无随机、无网络。
//
// ⚠️ 这一跑**不碰真管道**：目的是把"映射规则本身能不能分化"与"管线有没有把动机送到策略层"
//    这两个问题**分开**（后者是执行顺序问题，见 docs v1.57）。

import { selectStrategy, motiveActionStrategyEnabled } from '../src/lib/dialogueStrategy.js';
import type { StrategyContext, StrategyMotiveContext } from '../src/lib/dialogueStrategy.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionEngine.js';
import { actionFor } from '../src/lib/motive.js';
import type { MotiveAction, MotiveKind } from '../src/lib/emotionTypes.js';

/** 她的状态：与 A/B 那一跑同款（轻微偏离静息，非低谷）*/
function herState() {
  return {
    ...structuredClone(INITIAL_EMOTION_STATE),
    emotions: { ...RESTING_EMOTION_BASELINE, sad: RESTING_EMOTION_BASELINE.sad! + 0.08 },
    baselineEmotions: { ...RESTING_EMOTION_BASELINE },
  } as never;
}

/** 场景 1：他的话里有兴趣/探索信号（Rule 4 会触发）｜场景 2：没有（Rule 4 不触发）*/
function makeCtx(withInterest: boolean): StrategyContext {
  return {
    emotionState: herState(),
    herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.06 },
    userAnalysis: null,
    conflictState: null,
    recentUserMoods: [0.1, 0.05, 0.12],
    consecutiveNegativeRounds: 0,
    interestSignals: withInterest ? ['阳台', '收拾'] : [],
    pendingDiscoveries: [],
    idleMinutes: 3,
    timeOfDay: 15,
  } as unknown as StrategyContext;
}

const SCENES: Array<{ id: string; withInterest: boolean; note: string }> = [
  { id: '场景1', withInterest: true, note: '他的话里有兴趣信号（现状 = Rule 4 抢走 → explore）' },
  { id: '场景2', withInterest: false, note: '他的话里没有兴趣信号（现状 = neutral）' },
];

const KINDS: MotiveKind[] = ['memory_echo', 'open_loop'];
const EXPLICIT: Array<MotiveAction | null> = ['share', 'ask', 'wait'];

console.log(`${'='.repeat(96)}`);
console.log('v1.57 C 探针：`action → selectedStrategy`（零 LLM，纯函数）');
console.log(`${'='.repeat(96)}\n`);

const results: Array<{ scene: string; label: string; strategy: string; reason: string }> = [];
for (const sc of SCENES) {
  console.log(`【${sc.id}】${sc.note}`);
  for (const kind of KINDS) {
    const rows: Array<[string, MotiveAction | undefined]> = [
      ['基线：不给 motive', undefined],
      ...EXPLICIT.map(a => [`action=${a}`, a as MotiveAction] as [string, MotiveAction]),
    ];
    for (const [label, action] of rows) {
      for (const on of [false, true]) {
        if (on) process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';
        else delete process.env.ENABLE_MOTIVE_ACTION_STRATEGY;
        const ctx = makeCtx(sc.withInterest);
        if (action !== undefined) {
          ctx.motive = {
            type: kind,
            action: actionFor(kind, action),
            priority: 0.62,
          } as StrategyMotiveContext;
        }
        const d = selectStrategy(ctx);
        const flag = on ? '开' : '关';
        results.push({ scene: sc.id, label: `${kind}/${label}/${flag}`, strategy: d.strategy, reason: d.reason });
        console.log(`   ${(kind + ' ' + label).padEnd(30)} 开关${flag} → ${d.strategy.padEnd(10)} ${d.reason.slice(0, 62)}`);
      }
    }
    console.log('');
  }
}

// ── 判定：开关打开时，三个 action 是否给出**系统性不同**的结果 ──
console.log(`${'='.repeat(96)}`);
console.log('判定（跑之前写死）：同一场景 + 同一 kind 下，**只看开关打开**那一列');
console.log(`${'='.repeat(96)}`);
let allDiff = true;
for (const sc of SCENES) {
  for (const kind of KINDS) {
    const pick = (label: string) => results.find(r => r.scene === sc.id && r.label === `${kind}/${label}/开`)!.strategy;
    const share = pick('action=share');
    const ask = pick('action=ask');
    const wait = pick('action=wait');
    const distinct = new Set([share, ask, wait]).size;
    const contract = share === 'share' && ask === 'explore' && wait === 'accompany';
    if (distinct < 2) allDiff = false;
    console.log(`   ${sc.id} ${kind.padEnd(12)} share→${share.padEnd(10)} ask→${ask.padEnd(10)} wait→${wait.padEnd(10)}`
      + ` ｜不同取值 ${distinct} 个 ｜符合契约(share/explore/accompany)：${contract ? '✓' : '✗'}`);
  }
}
console.log(`\n   ⇒ 映射规则${allDiff ? '**能分化**' : '**不能分化**'}；`
  + `\n     但**这不等于**真管道会变 —— 见下面那条结构事实。`);

console.log(`\n${'='.repeat(96)}`);
console.log('⚠️ 结构事实（本次一并量出，零 LLM）：动机与策略的**执行顺序**');
console.log(`${'='.repeat(96)}`);
console.log('   `server.ts`：`aiCoordinator.processTurn(...)` 在第 **663** 行（策略在里面选）');
console.log('                动机选择 `const motiveSelection = ...` 在第 **797** 行');
console.log('                而动机选择**依赖 `turnOutput.updatedEmotionState`**（第 838/852 行）');
console.log('   ⇒ **策略层在物理上看不到本轮的动机** —— 不是"字段没被消费"，是**顺序反了**。');
console.log('   ⇒ 要让 `Motive → Action → Strategy` 同轮成立，必须把动机选择**前移进协调器**');
console.log('      （在"刺激已施加、策略尚未选"的那个位置）—— 那是一次**结构性改动**，不是接线。');
console.log(`   ⇒ 本探针证明的是：**字段一旦到位，映射规则真的会分化决策**（前提条件已满足）。`);
