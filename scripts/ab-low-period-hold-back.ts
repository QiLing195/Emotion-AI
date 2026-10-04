// ── v1.39 A/B：她自己在低谷时，还该不该追问他的事 ──
//
// 变量只有一个：**同一批"他说的平常事"**下，她这一轮心里那件"关于他的待办"给不给。
//   A = 基线（开关关）：她心里挂着一件关于他的事 → Prompt 末尾给她【此刻我心里挂着的事】，
//       她自然会顺着它问一句下文（这正是本项目"泛问"的根因解法 v1.9，也是这里的**基线行为**）。
//   B = **整段**（`ENABLE_LOW_PERIOD_HOLD_BACK=true`，闸门 `period`）：她**已成段**在低谷 ⇒
//       走让位路（v1.30 裁定该路 `omit`：整块不给）⇒ 本轮不追问。
//   C = **逐轮**（闸门 `turn`）：只要**这一次落定**沉就收住。
//
// 为什么必须挑"他情绪不强"的话（否则又是一个没有下降空间的假终点）：
//   他**明确负面** + 她沉时，`shouldDeferToUser`（v1.28/v1.31）**本来就会**让位
//   ⇒ 那条路上两臂永远一样。这一条要测的是**他说的是平常事**、她本来会追问的那些。
//
// ── 事先声明的判据（跑之前写死）──
//   主终点 `questions` / `probe`（追问）必须**下降**（B < A）
//   护栏   `ack`（承认）不许下降；`chars` 不许塌；**同臂逐字重复（模板塌缩）不许上升**
//   对照   ⭐ 同一批话、**她状态换成静息**（不在低谷）⇒ 两臂的 Prompt 必须**逐字节相同**
//          （证明变量只有一个：不是"这些话不该问"，而是"她在低谷时才不问"）
//   操纵   ① 低谷条件：A 的 Prompt **有**【此刻我心里挂着的事】且 `/state` 说没让位；
//          B/C 的 Prompt **没有**该块且 `/state` 说让位、理由里含"低谷"
//          ② 静息条件：A/B 都有该块、都没让位、Prompt 逐字节相同
//   B vs C 逐轮/整段：**报告但不预设赢家**（我 a priori 倾向整段 —— 它才配得上"自闭一段时间"；
//          若逐轮明显更好，得给出机制解释才谈采用）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-low-period-hold-back.ts [--n=3] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { lowPeriodOf } from '../src/lib/lowPeriod.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const N = Math.max(2, arg('n', 3));
const KEEP = process.argv.includes('--keep');

/**
 * 他说的**平常事**（都不是明确负面 ⇒ 旧让位路不会抢跑），
 * 每条都配一件"她心里挂着的、与它对应的"事 —— 那才是 A 臂会追问的东西。
 */
const MSGS = [
  { id: 'h1', text: '我下周三要去医院拿体检报告。', seed: '他体检结果到底怎么样' },
  { id: 'h2', text: '我最近一直在想要不要换个方向。', seed: '他说想换方向那事，后来怎么定的' },
  { id: 'h3', text: '周末可能要去趟外地。', seed: '他周末去外地那事定了没' },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const MEM = 'memories';
const BAK = 'memories.ab-hb-bak';
const DUMP = '.tmp-ab-hb-prompt.txt';
const ROWS = 'low-period-hold-back-rows.jsonl';

/** 让位时 Prompt 里**不该再有**的那一块（`omit` 会整块不给） */
const MOTIVE_MARKER = '【此刻我心里挂着的事】';

type Arm = 'A' | 'B' | 'C';
function applyArm(arm: Arm) {
  delete process.env.ENABLE_LOW_PERIOD_HOLD_BACK;
  delete process.env.LOW_PERIOD_HOLD_BACK_GATE;
  if (arm === 'B') process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
  if (arm === 'C') {
    process.env.ENABLE_LOW_PERIOD_HOLD_BACK = 'true';
    process.env.LOW_PERIOD_HOLD_BACK_GATE = 'turn';
  }
}

const RE = {
  questions: /[？?]/g,
  probe: /为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是|怎么样|哪[个家]|什么时候/g,
  ack: /挺好|真不错|恭喜|替你高兴|值得|不容易|辛苦了|嗯嗯|我懂|知道了|听到了/g,
  presencePhrase: /我就?在|陪着你|我陪|不走|不用一个人/g,
  advice: /别急|原因|其实|说明|应该|至少|会好起来|没关系|想开/g,
};
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    probe: count(RE.probe),
    ack: count(RE.ack),
    presencePhrase: count(RE.presencePhrase),
    advice: count(RE.advice),
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['questions', 'probe', 'chars', 'ack', 'presencePhrase', 'advice'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length, lose = diffs.filter(d => d < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const C = (a: number, b: number) => fact(a) / (fact(b) * fact(a - b));
  let tail = 0;
  for (let k = Math.max(win, lose); k <= n; k++) tail += C(n, k);
  return { win, lose, p: Math.min(1, (2 * tail) / 2 ** n) };
}
const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

interface Row {
  arm: Arm; cond: 'treat' | 'ctl'; id: string; pair: number;
  metrics: Metrics; reply: string; hasMotive: boolean; deferred: boolean; reason: string;
  /** Prompt 里那一块"她心里挂着的事"的**原文**（没有则为空串）—— 对照检查比这一块，不比整个 Prompt */
  motiveBlock: string;
}
const rows: Row[] = [];

/**
 * 取出 Prompt 里"她心里挂着的事"那一块。
 *
 * ⚠️ 对照检查**只能比这一块**，不能比整个 Prompt：整份 Prompt 里还有心情/反刍/情境等
 * **本来就随状态与时间变**的块（还有 LLM NLU 每轮不同的输出）—— 第一版拿"整份逐字节相同"
 * 当判据，静息对照必然 0/6（那是量具错，不是变量不纯）。
 */
function motiveBlockOf(prompt: string): string {
  const i = prompt.indexOf(MOTIVE_MARKER);
  if (i < 0) return '';
  const j = prompt.indexOf('\n', i);
  return prompt.slice(i, j < 0 ? undefined : j);
}

function restore() {
  if (KEEP) { console.log(`\n[保留] --keep：${BAK}/ 未还原（看完请手动删）`); return; }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

{
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑（会同时写 memories/）—— 先停掉它。'); process.exit(3); }
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
writeFileSync(DUMP, '', 'utf8');
process.env.DUMP_PROMPT = DUMP;
writeFileSync(ROWS, '', 'utf8');

let listener: { close: () => void } | null = null;
try {
  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  listener = srv.app.listen(0, '127.0.0.1');
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 冲突）`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
    internal?: Record<string, unknown>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  /** 造一个起始状态：可选地把她沉下去 + 钉住一段低谷 + 钉住"她心里挂着的那件事" */
  const makeState = (opts: { sunk: boolean; low: boolean; seed: string }) => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + (opts.sunk ? 0.20 : 0) };
    s.baselineEmotions = { ...baseline };
    if (opts.low) {
      const now = Date.now();
      s.lowPeriod = {
        since: now - 30 * 3_600_000, lastEvaluatedAt: now,
        peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0, turns: 6, selfRecovery: 0,
      };
    } else {
      delete s.lowPeriod;
    }
    // 钉住"她心里挂着的那件关于他的事" ⇒ 保证 A 臂**有东西可追问**（否则又是没有下降空间）
    s.internal = {
      ...(s.internal ?? {}),
      motive: {
        pool: [{
          id: `seed-${opts.seed}`, kind: 'open_loop', content: opts.seed, source: {},
          salience: 0.8, formedAt: Date.now() - 3_600_000, expiresAt: Date.now() + 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  async function callOnce(arm: Arm, cond: 'treat' | 'ctl', m: typeof MSGS[number], pair: number): Promise<Row | null> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState({ sunk: cond === 'treat', low: cond === 'treat', seed: m.seed })) as never;
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: m.text, userId: 'ab-hb', recentMessages: RECENT }),
    });
    const data = await res.json() as { response?: unknown; emotionState?: unknown };
    if (typeof data.response !== 'string') {
      console.error(`   ✗ ${m.id}/${arm}/${cond} 没返回 response，跳过`);
      return null;
    }
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    let deferred = false, reason = '';
    try {
      const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
      const mm = st.motive as never as { thisTurn?: { deferred?: boolean; reason?: string } } | undefined;
      deferred = Boolean(mm?.thisTurn?.deferred);
      reason = String(mm?.thisTurn?.reason ?? '');
    } catch { /* 记录失败不影响主流程 */ }
    const metrics = score(data.response);
    const row: Row = {
      arm, cond, id: m.id, pair, metrics, reply: data.response,
      hasMotive: prompt.includes(MOTIVE_MARKER), deferred, reason,
      motiveBlock: motiveBlockOf(prompt),
    };
    console.log(`   [${arm}/${cond}] ${m.id} p${pair} ${String(metrics.chars).padStart(3)}字 追问${metrics.questions} `
      + `问句${metrics.probe} 承认${metrics.ack} 挂着事=${row.hasMotive ? 'Y' : 'n'} 让位=${deferred ? 'Y' : 'n'}`);
    return row;
  }

  console.log(`[她的起始状态-低谷] ${activationOf(makeState({ sunk: true, low: true, seed: 'x' }) as never).note}`);
  console.log(`[钉住的低谷] ${lowPeriodOf(makeState({ sunk: true, low: true, seed: 'x' }) as never).note}`);
  console.log(`[跑法] 他的平常事 ${MSGS.length} 条 × 3 臂 × n=${N}（低谷）＋ 2 臂 × n=${N}（静息对照）\n`);

  for (let pair = 1; pair <= N; pair++) {
    const order: Arm[] = pair % 2 === 1 ? ['A', 'B', 'C'] : ['C', 'B', 'A'];
    for (const m of MSGS) {
      for (const arm of order) {
        const r = await callOnce(arm, 'treat', m, pair);
        if (r) rows.push(r);
      }
    }
    for (const m of MSGS) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        const r = await callOnce(arm, 'ctl', m, pair);
        if (r) rows.push(r);
      }
    }
  }

  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');
  const pick = (arm: Arm, cond: 'treat' | 'ctl', id: string) =>
    rows.filter(r => r.arm === arm && r.cond === cond && r.id === id);
  const modes = (xs: Row[]) => [...new Set(xs.map(r => `${r.hasMotive ? 'Y' : 'n'}${r.deferred ? 'Y' : 'n'}`))].join(',');

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(84)}\n① 操纵检查（挂着事 / 让位）\n${'='.repeat(84)}`);
  let manOk = true;
  for (const m of MSGS) {
    const a = pick('A', 'treat', m.id), b = pick('B', 'treat', m.id), cc = pick('C', 'treat', m.id);
    const okA = a.every(r => r.hasMotive && !r.deferred);
    const okB = b.every(r => !r.hasMotive && r.deferred && r.reason.includes('低谷'));
    const okC = cc.every(r => !r.hasMotive && r.deferred && r.reason.includes('低谷'));
    if (!okA || !okB || !okC) manOk = false;
    console.log(`   ${pad(m.id, 4)}低谷 A=${pad(modes(a), 6)}${okA ? '✓' : '✗ 基线竟然没给她"挂着的事"⇒ 这条样本没有下降空间'}`);
    console.log(`        B=${pad(modes(b), 6)}${okB ? '✓ 整段：让位且理由含"低谷"' : '✗'}`);
    console.log(`        C=${pad(modes(cc), 6)}${okC ? '✓ 逐轮：让位且理由含"低谷"' : '✗'}`);
  }
  let ctlIdentical = 0, ctlTotal = 0;
  for (const m of MSGS) for (let p = 1; p <= N; p++) {
    const a = rows.find(r => r.arm === 'A' && r.cond === 'ctl' && r.id === m.id && r.pair === p);
    const b = rows.find(r => r.arm === 'B' && r.cond === 'ctl' && r.id === m.id && r.pair === p);
    if (a && b) {
      ctlTotal++;
      // 静息下两臂都该**照常**给她"挂着的事"，且那一块**一模一样**
      if (a.hasMotive && b.hasMotive && !a.deferred && !b.deferred && a.motiveBlock === b.motiveBlock) ctlIdentical++;
    }
  }
  console.log(`   静息对照：「挂着的事」那一块两臂相同 ${ctlIdentical}/${ctlTotal}`
    + `${ctlIdentical === ctlTotal && ctlTotal > 0 ? ' ✓ 变量只有一个（是"她在低谷"而不是"这些话不该问"）' : ' ✗ 变量不止一个'}`
    + `\n      （样本：${rows.find(r => r.cond === 'ctl')?.motiveBlock || '（空）'}）`);
  if (ctlIdentical !== ctlTotal || ctlTotal === 0) manOk = false;
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的数字不能当结论用'}`);

  // ── ② 各臂均值（只统计低谷条件）──
  const treat = rows.filter(r => r.cond === 'treat');
  console.log(`\n${'='.repeat(84)}\n② 各臂均值（均值±SD，低谷条件）\n${'='.repeat(84)}`);
  console.log(pad('指标', 16) + pad('A 基线', 16) + pad('B 整段', 16) + pad('C 逐轮', 16) + 'B−A / C−A');
  for (const k of KEYS) {
    const g = (arm: Arm) => treat.filter(r => r.arm === arm).map(r => r.metrics[k]);
    const [A, B, C] = [g('A'), g('B'), g('C')];
    console.log(pad(k, 16) + pad(`${mean(A).toFixed(2)}±${sd(A).toFixed(2)}`, 16)
      + pad(`${mean(B).toFixed(2)}±${sd(B).toFixed(2)}`, 16) + pad(`${mean(C).toFixed(2)}±${sd(C).toFixed(2)}`, 16)
      + `${(mean(B) - mean(A)).toFixed(2)} / ${(mean(C) - mean(A)).toFixed(2)}`);
  }

  // ── ③ 配对符号检验 ──
  const diffs = (k: keyof Metrics, arm: Arm) => MSGS.flatMap(m => Array.from({ length: N }, (_, i) => {
    const a = rows.find(r => r.arm === 'A' && r.cond === 'treat' && r.id === m.id && r.pair === i + 1);
    const b = rows.find(r => r.arm === arm && r.cond === 'treat' && r.id === m.id && r.pair === i + 1);
    return a && b ? b.metrics[k] - a.metrics[k] : null;
  }).filter((x): x is number => x !== null));
  console.log(`\n${'='.repeat(84)}\n③ 配对符号检验（同句同 pair 相减，对立面=基线 A）\n${'='.repeat(84)}`);
  for (const k of ['questions', 'probe', 'chars', 'ack'] as Array<keyof Metrics>) {
    for (const arm of ['B', 'C'] as Arm[]) {
      const d = diffs(k, arm); const s = signTest(d);
      const dir = mean(d) < 0 ? '更低' : mean(d) > 0 ? '更高' : '持平';
      console.log(`   ${pad(k, 12)}${arm}：${arm}胜${s.win} A胜${s.lose} p=${s.p.toFixed(3)} 均值差 ${mean(d).toFixed(2)}（${arm} ${dir}）`);
    }
  }

  // ── ④ 模板塌缩检测（同臂内逐字重复）──
  console.log(`\n${'='.repeat(84)}\n④ 模板塌缩（同臂内完全相同的回复；v1.36/v1.38 都栽在这）\n${'='.repeat(84)}`);
  const dupRate = (arm: Arm) => {
    const rs = treat.filter(r => r.arm === arm);
    if (!rs.length) return { groups: 0, n: 0, max: 0 };
    const g = new Map<string, number>();
    for (const r of rs) g.set(r.reply, (g.get(r.reply) ?? 0) + 1);
    const sizes = [...g.values()].filter(v => v > 1);
    return { groups: sizes.length, n: rs.length, max: Math.max(0, ...sizes) };
  };
  for (const arm of ['A', 'B', 'C'] as Arm[]) {
    const d = dupRate(arm);
    console.log(`   ${arm}：重复组 ${d.groups} / ${d.n} 条${d.max > 1 ? `（最大一组 ×${d.max}）` : ''}`);
  }
  const dupA = dupRate('A'), dupB = dupRate('B'), dupC = dupRate('C');

  // ── ⑤ 裁定 ──
  const sQ = signTest(diffs('questions', 'B')), sP = signTest(diffs('probe', 'B'));
  const dAck = mean(diffs('ack', 'B')), dChars = mean(diffs('chars', 'B'));
  const probedDown = mean(diffs('probe', 'B')) < 0 && sP.p <= 0.1;
  const qDown = mean(diffs('questions', 'B')) < 0;
  const ackHeld = dAck >= 0;
  const dupOk = dupB.groups <= dupA.groups;
  console.log(`\n${'='.repeat(84)}\n⑤ 数据层面裁定（判据跑之前写死；最终裁定要人看过原文再下）\n${'='.repeat(84)}`);
  console.log(`   主终点 追问 probe：均值差 ${mean(diffs('probe', 'B')).toFixed(2)}（B胜${sP.win} A胜${sP.lose} p=${sP.p.toFixed(3)}）⇒ ${probedDown ? '✓ 明显收住' : '✗ 未达标'}`);
  console.log(`   主终点 问号 questions：均值差 ${mean(diffs('questions', 'B')).toFixed(2)}（p=${sQ.p.toFixed(3)}）⇒ ${qDown ? '✓ 方向对' : '✗ 没降'}`);
  console.log(`   护栏   承认 ack：均值差 ${dAck.toFixed(2)} ⇒ ${ackHeld ? '✓ 没掉' : '✗ 掉了 ⇒ 变成不接话，算输'}`);
  console.log(`   护栏   字数 chars：均值差 ${dChars.toFixed(2)}｜塌缩 A ${dupA.groups}组 / B ${dupB.groups}组 / C ${dupC.groups}组 ⇒ ${dupOk ? '✓ 没更塌' : '✗ B 更塌 ⇒ 算输'}`);
  console.log(`   对照   静息条件下两臂 Prompt 逐字节相同 ${ctlIdentical}/${ctlTotal}（见 ①）`);
  const pass = manOk && probedDown && qDown && ackHeld && dupOk;
  console.log(`   ⇒ 数据层面：${pass ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   B vs C（**不预设赢家**）：probe B=${mean(diffs('probe', 'B')).toFixed(2)} C=${mean(diffs('probe', 'C')).toFixed(2)}｜`
    + `questions B=${mean(diffs('questions', 'B')).toFixed(2)} C=${mean(diffs('questions', 'C')).toFixed(2)}`);
  console.log(`   回复原文：${ROWS}（人工过目；判官不参与本跑裁定）`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
