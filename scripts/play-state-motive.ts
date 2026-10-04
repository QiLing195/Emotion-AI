// ── v1.49 预演（零 LLM）：`state` 动机到底能不能形成、能不能入选 ──
//
// 起因：v1.48 的结构性结论说"她的状态要影响她的话，得走决策路径"，而 `motive.ts` 里
// 正好有一条 `state`（"她今天的状态本身就是想说的事"）。我上一轮把它记成
// "先验只有 0.40，抢不过 open_loop 0.80" —— **那是推论，不是实测**。
// 这个脚本在真管道之前先把两件算术量清楚（v1.40 那次"杠杆被物理性否掉"就是这么否的）：
//
//   ① **形成门槛**：`moodStateMotive()` 要求 `|mood.valence| ≥ 0.25`；
//      而 `mood.valence` 的采样是 `moodSampleFrom()` = `(正−负)/1.5`，经 `updateMood()` 的
//      alpha（连续几轮的 dt 只有几分钟 ⇒ alpha 落到下界 0.02）极慢地逼近。
//      ⇒ 先算"她真沉下去时，这个值到底能到多少"。
//   ② **当选门槛**：`salienceOf()` = base × freshness × attemptPenalty × relevance，
//      其中 `relevance = clamp(1 + sim*1.5, 1, 2.5)` **下界是 1**（只加分不减分）
//      ⇒ `state` 的紧迫度**就是常数 base**。而 `worry`/`memory_echo`/`wish`/`curiosity`
//      的 TTL 是 5~14 天 ⇒ 它们**常年满新鲜度**地占着 0.46~0.70。
//      ⇒ 再算"要赢需要多少"。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/play-state-motive.ts

import {
  MOTIVE_BASE_SALIENCE, MOTIVE_MIN_SALIENCE, MOTIVE_TTL_HOURS,
  moodStateMotive, stateMotiveFor, selectMotive, mergeCandidates, markMotiveAttempted,
} from '../src/lib/motive.js';
import { updateMood, moodSampleFrom, createMood, decayedMood } from '../src/lib/moodLayer.js';
import { INITIAL_EMOTION_STATE } from '../src/lib/emotionTypes.js';
import type { MotiveCandidate } from '../src/lib/motive.js';

// 这一段预演测的是 v1.49 的**新机制**（连续映射 + 具体化那一路），所以显式打开开关：
// 关着时 stateMotiveFor 走旧分支（门槛 0.25 不可达），下面几段会全空 —— 那正是第一跑量到的事。
process.env.ENABLE_STATE_MOTIVE = 'true';

const MIN = 60_000;
const TURN_GAP_MIN = 3;          // 真实聊天里一轮大约几分钟
const GATE = 0.25;               // `moodStateMotive` 的门槛
const MOOD = -0.22;              // 这一段仿真的心情（与 A/B 的 t1 同值）
const WORRY_LIKE = '他是不是又熬夜了，我有点担心';
const st0 = { lastSelectedId: undefined, lastSelectedContent: undefined, lastSelectedAt: undefined };

const f = (x: number, n = 3) => x.toFixed(n);

// ── ① 形成门槛：她真沉下去时 mood.valence 能到多少 ──
console.log(`${'='.repeat(94)}\n① 形成门槛：「state」动机要求 |mood.valence| ≥ ${GATE}，而它逼近得多慢\n${'='.repeat(94)}`);
console.log('   （「moodSampleFrom」= (正−负)/1.5；只算 sad 主导的情形：sample = −sad/1.5）\n');

const base = INITIAL_EMOTION_STATE.emotions;
for (const sad of [0.13, 0.20, 0.33, 0.40]) {
  const st = {
    ...structuredClone(INITIAL_EMOTION_STATE),
    emotions: { ...base, sad },
  } as never;
  const sample = moodSampleFrom(st);
  let mood = createMood(0);
  const marks: Array<[number, number]> = [];
  for (let i = 1; i <= 200; i++) {
    mood = updateMood(mood, sample, i * TURN_GAP_MIN * MIN);
    if ([10, 25, 50, 100, 200].includes(i)) marks.push([i, mood.valence]);
  }
  const asymptote = sample.valence;   // 无衰减时的极限就是这个采样值
  console.log(`   sad ${f(sad, 2)} ⇒ 采样 ${f(sample.valence)}｜极限 ${f(asymptote)}`
    + `｜跨 ${GATE} 需要：${Math.abs(asymptote) >= GATE ? '能跨' : '**永远跨不过**'}`);
  console.log(`      轮数→心情：${marks.map(([n, v]) => `${n}轮 ${f(v)}`).join('  ')}`);
}

// ── ② 当选门槛：真实池子里谁赢 ──
console.log(`\n${'='.repeat(94)}\n② 当选门槛：一个真实形状的池子（都在保鲜期内）\n${'='.repeat(94)}`);
const now = 1_700_000_000_000;
const cands: MotiveCandidate[] = [
  { kind: 'open_loop', content: '他体检结果到底怎么样', formedAt: now - 2 * 3600_000 },
  { kind: 'worry', content: '他是不是又熬夜了，我有点担心', formedAt: now - 24 * 3600_000 },
  { kind: 'memory_echo', content: '我想起他上次说想去看海', formedAt: now - 48 * 3600_000 },
  { kind: 'wish', content: '想和他多待一会儿', formedAt: now - 24 * 3600_000 },
  { kind: 'curiosity', content: '他好像提过一家没去过的店', formedAt: now - 72 * 3600_000 },
  { kind: 'stance', content: '我觉得人得先对自己诚实', formedAt: now - 12 * 3600_000 },
  (() => { const s = stateMotiveFor(-0.18)!; return { kind: 'state' as const, content: s.content, base: s.base, formedAt: now - 10 * MIN }; })(),
];
const pool = mergeCandidates([], cands, now);
const run = (stateBase?: number, label = '') => {
  const p = stateBase === undefined ? pool : pool.map(m => (m.kind === 'state' ? { ...m, base: stateBase } : m));
  const sel = selectMotive({ state: { pool: p } as never, candidates: [], userText: '今晚随便煮了点面', now });
  const scored = p.map(m => {
    const s = selectMotive({ state: { pool: [m] } as never, candidates: [], userText: '', now });
    return { kind: m.kind, top: s.diagnostics.topSalience };
  }).sort((a, b) => b.top - a.top);
  console.log(`   ${label.padEnd(26)} 赢家=${String(sel.selected?.kind ?? (sel.deferredToUser ? '让位' : '（没有动机）')).padEnd(12)}`
    + `top=${f(sel.diagnostics.topSalience, 3)}｜逐条：${scored.map(s => `${s.kind} ${f(s.top, 2)}`).join('  ')}`);
};
console.log('   （「diag」的 top 是单条独处时的紧迫度 ⇒ 就是它的"裸分"）\n');
console.log('   —— v1.49 之前：state 是常数 base=0.40 ⇒ 裸分 0.38，**输给每一条**（只赢 stance 0.37）——\n');
run(0.40, '旧·常数 base=0.40');
console.log('\n   —— v1.49 之后：base 按 |mood.valence| **连续**给（`stateMotiveFor`）——\n');
for (const v of [0.08, 0.10, 0.12, 0.15, 0.18, 0.22, 0.28, 0.40]) {
  const s = stateMotiveFor(-v);
  run(s?.base, `|mood|=${v.toFixed(2)}${s ? ` ⇒ base ${s.base.toFixed(2)}` : ' ⇒ 不该说（不形成）'}`);
}
console.log('\n   （对照：把 base 抬到 0.80 就会**反超** open_loop —— 所以 0.72 这个上限是刻意的设计边界）');
run(0.80, '若 base=0.80（越界对照）');

// ── ③ 逐条裸分（看清"要赢就得超过谁"）──
console.log(`\n${'='.repeat(94)}\n③ 每个类型的"裸分"（新鲜、没提过、与他这句话无关）\n${'='.repeat(94)}`);
for (const [kind, b] of Object.entries(MOTIVE_BASE_SALIENCE)) {
  console.log(`   ${kind.padEnd(12)} base ${f(b, 2)}｜TTL ${String(MOTIVE_TTL_HOURS[kind as never]).padStart(4)}h`
    + `｜${b >= MOTIVE_MIN_SALIENCE ? '过最低门槛' : '**低于最低门槛**'}`);
}
console.log(`   （最低门槛 ${MOTIVE_MIN_SALIENCE}）`);
console.log(`\n   ⇒ \`state\` 要"入选"只需 > 其他在场动机；要"形成"还得先让 |mood.valence| 跨过 ${GATE}。`);

// ── ④ 多轮竞选仿真（零 LLM）：她在**持续低谷**里到底会多常说自己的状态 ──
//
// 这一段回答的是"还能不能上线"剩下的那个问题：具体化的节奏是"每 5 轮一次/池太空时"
// ⇒ 没有产物时**模板路照旧**，那她会不会连着 10 轮说同一句？
// 不需要长会话采样 —— 习惯化（attempts）、话题级重复惩罚（30 分钟内 ×0.3）、TTL 全是**确定性**的，
// 直接照着 `selectMotive` 跑就行（v1.40 那次"杠杆被物理性否掉"也是这么预演的）。
console.log(`\n${"=".repeat(94)}\n④ 20 轮竞选仿真：她心情一直 −0.22、池里另有三条关于他的/旧事的动机\n${"=".repeat(94)}`);

function simulate(enabled: boolean, turns = 20) {
  const t0 = now;
  let st = mergeCandidates([], [
    { kind: "worry", content: WORRY_LIKE, formedAt: t0 - 24 * 3600_000 },
    { kind: "wish", content: "想和他多待一会儿", formedAt: t0 - 24 * 3600_000 },
    { kind: "memory_echo", content: "我想起他上次说想去看海", formedAt: t0 - 48 * 3600_000 },
  ] as MotiveCandidate[], t0);
  const picks: string[] = [];
  const stateSal: number[] = [];
  let stateContentSeen = new Set<string>();
  let carry: Record<string, unknown> = {};
  for (let i = 0; i < turns; i++) {
    const t = t0 + i * 3 * 60_000;                       // 每轮隔 3 分钟
    const hasState = st.some(m => m.kind === "state");
    const cands: MotiveCandidate[] = [];
    if (enabled && !hasState) {
      const sm = stateMotiveFor(MOOD);                   // MOOD = −0.22（可达带深端）
      if (sm) cands.push({ kind: "state", content: sm.content, base: sm.base, formedAt: t });
    }
    // ⚠️ 必须把 `lastSelected*` 一起带进去、并在选中后 `markMotiveAttempted` —— 这两件事
    //    在**服务器**里做（`selectMotive` 自己只记 lastSelection、不碰 attempts）。
    //    第一版仿真漏了它们，于是关着开关时"worry 20/20"——那是装置产物，不是行为。
    const sel = selectMotive({ state: { ...st0, pool: st, ...carry }, candidates: cands, userText: "今晚随便煮了点面", now: t } as never);
    picks.push(sel.selected ? sel.selected.kind : (sel.deferredToUser ? "让位" : "无"));
    if (sel.selected?.kind === "state") stateContentSeen.add(sel.selected.content);
    const pool = sel.nextState.pool;
    const sm = pool.find(m => m.kind === "state");
    if (sm) {
      const solo = selectMotive({ state: { pool: [sm] } as never, candidates: [], userText: "", now: t });
      stateSal.push(solo.diagnostics.topSalience);
    } else stateSal.push(0);
    st = pool;
    const ls = sel.nextState.lastSelection;
    carry = {
      lastSelectedId: sel.selected ? sel.selected.id : undefined,
      lastSelectedContent: sel.selected ? sel.selected.content : undefined,
      lastSelectedKind: sel.selected ? sel.selected.kind : undefined,
      lastSelectedAt: ls ? ls.at : undefined,
    };
    // st 在这里是**池数组**（不是 MotiveState）⇒ 包一层
    if (sel.selected) st = markMotiveAttempted({ pool: st } as never, sel.selected.id, t).pool;
  }
  return { picks, stateSal, distinct: stateContentSeen.size };
}

for (const enabled of [false, true]) {
  const r = simulate(enabled);
  const n = r.picks.filter(k => k === "state").length;
  console.log(`\n   开关 ${enabled ? "开" : "关"}：选中山她自己状态的轮数 ${n}/20`);
  console.log(`     逐轮：${r.picks.join(" ")}`);
  console.log(`     她那句单独的紧迫度轨迹：${r.stateSal.map(v => v.toFixed(2)).join(" ")}`);
  console.log(`     （"她那句话"的去重条数：${r.distinct}）`);
}
console.log('\n   ⇒ 读法：习惯化与话题级惩罚会把"连着说"压住；剩下要看的只是**频率**是否合理。');
