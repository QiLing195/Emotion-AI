// ── v1.54 `memory_echo` 的内容形态：真管道 A/B ──
//
// 病灶：`memoryEchoMotive()` 把 `generateProactiveInjection()` 产出的**元指令**
//（「【主动回忆·好奇】你想起三周前他提到"…"…可以好奇地追问一句——"后来呢？"…」）
// 截 60 字、前面加"我想起"当成**她想说的话** ⇒ 模型接不上（三跑 ~40 格零次），
// 而且那一档指令**自带问句范例**（很可能就是 v1.50b 量到的"问句涨"）。
//
// 本跑：两臂 = 开关（A 旧＝贴指令 / B 新＝从 `eventSummary` 造句），**唯一的变量是内容形态**。
//   被回忆的事故意**与他这句无关**：他讲**阳台**，她记的是**看海** ⇒ `mentionsIt` 干净。
//
// 预声明判据（跑之前写死）：
//   操纵检查：A 臂动机块含「【主动回忆」；B 臂**不含**且含"海边"。两臂各 8/8。
//   主终点  `questions`：B < A（指令里的问句范例被拿掉 ⇒ 她不该更容易问）——配对符号检验 p ≤ 0.10。
//   副终点  `mentionsIt`（她提到"海"）：B ≥ A（造了句 ⇒ 至少不该更少）。
//   底线    字数 ≥ 70% A；仍接住他那件事（echoType）不降；逐字照抄 ≤ 50%。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-echo-content-shape.ts [--keep] [--n=8]
// 行文件：echo-content-shape-rows-run1.jsonl

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { generateProactiveInjection } from '../src/lib/episodicMemory.js';
import { memoryEchoMotive } from '../src/lib/motive.js';
import type { EpisodicMemory } from '../src/lib/episodicMemory.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const KEEP = process.argv.includes('--keep');
const N = (() => { const hit = process.argv.find(a => a.startsWith('--n=')); return hit ? Math.max(4, Number(hit.split('=')[1])) : 8; })();
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories';
const BAK = 'memories.ab-ecs-backup';
const ROWS = 'echo-content-shape-rows-run1.jsonl';
const DUMP = '.tmp-ab-ecs-prompt.txt';
type Arm = 'A' | 'B';

/** 他的这句：**阳台**（与被回忆的事无关） */
const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';

/** 被回忆的那件事：**看海**（真实记忆的形状；`eventSummary` 是他当时的话） */
const MEMORY = {
  id: 'ep_sea',
  eventSummary: '等这个项目结束，我想去趟海边',
  narrativeFragment: '当他说"等这个项目结束，我想去趟海边"的时候，她心里是期待的。',
  emotionalImpact: { dominantEmotion: 'joy', valenceDelta: 0.2 },
} as unknown as EpisodicMemory;

const INJECTION = generateProactiveInjection(MEMORY, 'curious_followup', '三周前');

/** 按臂造内容：**调用真函数**（不复制字符串，避免与生产漂移） */
function contentFor(arm: Arm): string {
  if (arm === 'A') {
    delete process.env.ENABLE_ECHO_LINE_FROM_SUMMARY;
    return memoryEchoMotive(INJECTION, MEMORY.id, MEMORY.eventSummary)!.content;
  }
  process.env.ENABLE_ECHO_LINE_FROM_SUMMARY = 'true';
  return memoryEchoMotive(INJECTION, MEMORY.id, MEMORY.eventSummary)!.content;
}

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const RE = {
  questions: /[？?]/g,
  mentionsIt: /海|看海|海边/g,
  toHim: /[你他]/g,
};

function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    mentionsIt: count(RE.mentionsIt),
    echoType: /阳台|收拾/.test(reply) ? 1 : 0,
    toHim: count(RE.toHim),
    /** 逐字照抄我给的内容（内容里有【主动回忆 之类 ⇒ 抄了会露） */
    quoted: /主动回忆|不需要追问|后来呢|我想起他说过/.test(reply) ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['questions', 'mentionsIt', 'echoType', 'chars', 'toHim', 'quoted'];

function pad(s: string, n: number) { return String(s).padEnd(n, ' '); }
function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function signTest(d: number[]) {
  const win = d.filter(x => x > 0).length, lose = d.filter(x => x < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  const choose = (k: number) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let tail = 0;
  for (let k = 0; k <= Math.min(win, lose); k++) tail += choose(k);
  return { win, lose, p: Math.min(1, 2 * tail / Math.pow(2, n)) };
}
function motiveBlockOf(prompt: string): string {
  const i = prompt.indexOf('【此刻我心里挂着的事】');
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}

interface Row { arm: Arm; pair: number; metrics: Metrics; reply: string; motiveBlock: string; promptLen: number }
const rows: Row[] = [];
let listenerRef: { close: () => void } | null = null;

function restore() {
  if (KEEP) { console.log(`\n[保留] --keep：${BAK}/ 未还原`); return; }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

try {
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑 —— 先停掉它。'); process.exit(3); }

  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  writeFileSync(DUMP, '', 'utf8');
  process.env.DUMP_PROMPT = DUMP;
  writeFileSync(ROWS, '', 'utf8');

  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  const listener = srv.app.listen(0, '127.0.0.1');
  listenerRef = listener as unknown as { close: () => void };
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}`);
  console.log(`   A 臂内容（旧）：${contentFor('A')}`);
  console.log(`   B 臂内容（新）：${contentFor('B')}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = (arm: Arm) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        pool: [{
          id: 'm1', kind: 'memory_echo', content: contentFor(arm), source: { memoryId: MEMORY.id },
          salience: 0.62, formedAt: now - 60_000, expiresAt: now + 5 * 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6): Promise<{ response?: unknown }> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      if (!(res.status === 429 || /too many requests|rate limit/i.test(err)) || i === tries) {
        console.error(`[中断] /api/chat 没返回 response（第 ${i} 次，HTTP ${res.status}）：${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败 —— 不许静默缩小样本');
      }
      console.warn(`   ⏳ 触发限流，等 ${Math.round(wait / 1000)}s 后重发`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  async function callOnce(arm: Arm, pair: number): Promise<Row> {
    srv.aiEngine.emotionState = structuredClone(makeState(arm)) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: HIS, userId: 'ab-ecs', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = motiveBlockOf(prompt);
    const m = score(data.response);
    const row: Row = { arm, pair, metrics: m, reply: data.response, motiveBlock: block, promptLen: prompt.length };
    console.log(`   [${arm}] p${pair} ${String(m.chars).padStart(3)}字 问句${m.questions} 提到海${m.mentionsIt}`
      + ` 接住他${m.echoType} 抄内容${m.quoted}`);
    return row;
  }

  console.log(`[跑法] e1×${N} × 2 臂 = ${N * 2} 格\n`);
  for (let pair = 1; pair <= N; pair++) {
    for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
      rows.push(await callOnce(arm, pair));
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const pairs = (k: keyof Metrics) => Array.from({ length: N }, (_, i) => {
    const a = rows.find(r => r.arm === 'A' && r.pair === i + 1);
    const b = rows.find(r => r.arm === 'B' && r.pair === i + 1);
    return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
  }).filter((x): x is [number, number] => x !== null);
  const diffs = (k: keyof Metrics) => pairs(k).map(([a, b]) => b - a);
  const meanOf = (k: keyof Metrics, arm: Arm) => mean(rows.filter(r => r.arm === arm).map(r => r.metrics[k]));

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(94)}\n① 操纵检查（唯一的变量是**内容形态**）\n${'='.repeat(94)}`);
  const aHas = rows.filter(r => r.arm === 'A' && r.motiveBlock.includes('【主动回忆')).length;
  const bHas = rows.filter(r => r.arm === 'B' && r.motiveBlock.includes('【主动回忆')).length;
  const bSea = rows.filter(r => r.arm === 'B' && r.motiveBlock.includes('海边')).length;
  const manOk = aHas === N && bHas === 0 && bSea === N;
  console.log(`   A 臂动机块含「【主动回忆」：${aHas}/${N}（期望全部）`);
  console.log(`   B 臂动机块含「【主动回忆」：${bHas}（期望 0）；含「海边」（记忆原文）：${bSea}/${N}（期望全部）`);
  console.log(`   A 臂块样例：${rows.find(r => r.arm === 'A')!.motiveBlock.split('\\n')[0].slice(0, 80)}`);
  console.log(`   B 臂块样例：${rows.find(r => r.arm === 'B')!.motiveBlock.split('\\n')[0].slice(0, 80)}`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(94)}\n② 分组均值\n${'='.repeat(94)}`);
  console.log('   ' + pad('指标', 14) + pad('A 旧·贴指令', 16) + pad('B 新·从原文造句', 18) + 'B−A');
  for (const k of KEYS) {
    console.log('   ' + pad(k, 14) + pad(meanOf(k, 'A').toFixed(2), 16) + pad(meanOf(k, 'B').toFixed(2), 18)
      + (meanOf(k, 'B') - meanOf(k, 'A')).toFixed(2));
  }

  // ── ③ 裁定 ──
  const dQ = diffs('questions'); const sQ = signTest(dQ);
  const dM = diffs('mentionsIt');
  const dEcho = diffs('echoType');
  const cA = meanOf('chars', 'A'), cB = meanOf('chars', 'B');
  const primary = mean(dQ) < 0 && sQ.p <= 0.10;
  const seaHold = mean(dM) >= 0;
  const echoHold = mean(dEcho) >= 0;
  const charsOk = cB >= 0.7 * cA;
  const quotedOk = rows.reduce((a, r) => a + r.metrics.quoted, 0) / (rows.length || 1) <= 0.5;
  const passed = manOk && primary && seaHold && echoHold && charsOk && quotedOk;
  console.log(`\n${'='.repeat(94)}\n③ 数据层面裁定（判据跑之前写死）\n${'='.repeat(94)}`);
  console.log(`   主终点【问句变少】：${meanOf('questions', 'A').toFixed(2)} → ${meanOf('questions', 'B').toFixed(2)}`
    + `（均值差 ${mean(dQ).toFixed(2)}，B降${sQ.win} A降${sQ.lose} p=${sQ.p.toFixed(3)}）⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   副终点【她提到那件事】：${meanOf('mentionsIt', 'A').toFixed(2)} → ${meanOf('mentionsIt', 'B').toFixed(2)}`
    + `（均值差 ${mean(dM).toFixed(2)}）⇒ ${seaHold ? '✓ 没更差' : '✗ 更差了'}`);
  console.log(`   底线 仍接住他那件事 echoType 均值差 ${mean(dEcho).toFixed(2)} ⇒ ${echoHold ? '✓' : '✗'}`);
  console.log(`   底线 字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了'}`);
  console.log(`   底线 逐字照抄内容 ${(rows.reduce((a, r) => a + r.metrics.quoted, 0) / (rows.length || 1) * 100).toFixed(0)}% ⇒ ${quotedOk ? '✓' : '✗'}`);
  console.log(`   ⇒ 数据层面：${passed ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   回复原文：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
