// ── v1.56 「指代消歧」真管道 A/B（用户方案的**第一跑**：只消歧，不加 action、不碰 strategyCtx）──
//
// 病灶（v1.55 量出）：块里「你想问他什么，问的应该是**这件事**的具体下文」的「这件事」
// **无指代** ⇒ 模型解析成**他刚说的那件**（阳台 24/24），**她挂的那件**（海）0/24。
//
// 两臂（**唯一变量 = 指代**，其余全部相同：他的话 / 她的情绪 / 记忆 / 动机内容 /
//       策略 / Prompt 顺序 / 不加理由 / 不加 action / 不碰 strategyCtx）：
//
//   A 现状                                   B 指代消歧
//   【此刻我心里挂着的事】<内容>              【此刻我心里挂着的事】
//   本轮开口就从这件事出发——如果你想问他       这一件是**我自己**心里的事 —— 跟他刚刚说的那件不是同一件。
//   什么，问的应该是这件事的具体下文…          我自己心里挂着的就是：<内容>
//   如果他此刻的情绪更需要被接住…             我这一轮想把它说出来：说我自己挂着的这一件。
//   不要说出"我心里挂着"这类元描述…
//
// **预声明判据（跑之前写死）**：
//   操纵检查（三条，零 LLM）：
//     ① A 臂块含「问的应该是这件事的具体下文」12/12；B 臂含「我自己心里挂着的就是」12/12
//     ② 两臂动机内容**逐字相同** 12/12
//     ③ **Prompt 除动机块以外逐字相同 12/12**（把块整段挖掉后两臂相等）—— 用户明确要求的
//   主终点 **`targetEventMention`**（她的回复里出现**目标事件本身**的词：海）
//             —— 新尺子**零 LLM、结构式**，且**不使用**「一直/记得」这类普通词 ⇒ 不会重演 v1.55 的污染。
//             B > A，配对符号检验 p ≤ 0.10。
//   副终点 **`targetEventShare`**（那句是**陈述**而不是问句）B > A。
//   参考   `targetEventQuestion`（她**问**那件事的比例）。
//   护栏   ① 策略一致（用户的硬要求：`/state → strategy.current` 两臂相同）
//          ② 字数 B ≥ 70% A ③ 仍接住他那件事（echoType）不降 ④ 逐字照抄 ≤ 50%
//   漂移对照：与 v1.55 那次 A 臂（同一 A、隔一次运行）比较 ⇒ 估 run-to-run 漂移。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-referent-shape.ts [--keep] [--n=12]
// 行文件：referent-shape-rows-run1.jsonl

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
const N = (() => { const hit = process.argv.find(a => a.startsWith('--n=')); return hit ? Math.max(4, Number(hit.split('=')[1])) : 12; })();
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories';
const BAK = 'memories.ab-rs-backup';
const ROWS = 'referent-shape-rows-run2.jsonl';
const PREV = 'motive-reason-shape-rows-run1.jsonl';
const DUMP = '.tmp-ab-rs-prompt.txt';
type Arm = 'A' | 'B';
const BLOCK_HEAD = '【此刻我心里挂着的事】';

const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';
const MEMORY = {
  id: 'ep_sea',
  eventSummary: '等这个项目结束，我想去趟海边',
  narrativeFragment: '当他说"等这个项目结束，我想去趟海边"的时候，她心里是期待的。',
  emotionalImpact: { dominantEmotion: 'joy', valenceDelta: 0.2 },
} as unknown as EpisodicMemory;

/** 目标事件（零 LLM 结构指标用）：只取**那个词本身**，不掺普通词 */
const TARGET_RE = /海/;

process.env.ENABLE_ECHO_LINE_FROM_SUMMARY = 'true';
const INJECTION = generateProactiveInjection(MEMORY, 'curious_followup', '三周前');
const CONTENT = memoryEchoMotive(INJECTION, MEMORY.id, MEMORY.eventSummary)!.content;

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

/** 按**小句**判"她提到/说/问那件事"（结构式，不靠普通词）*/
function sentences(reply: string): string[] {
  return reply.split(/[。！？!?；;\n]+/).map(s => s.trim()).filter(Boolean);
}
function score(reply: string) {
  const ss = sentences(reply);
  const withTarget = ss.filter(s => TARGET_RE.test(s));
  const q = withTarget.filter(s => /[？?]/.test(s)).length;
  const share = withTarget.length - q;
  return {
    /** 主终点：她的回复里**有没有出现目标事件本身**（0/1）*/
    targetEventMention: withTarget.length > 0 ? 1 : 0,
    /** 副终点：那句是**陈述**（说出来）而不是问句 */
    targetEventShare: share,
    /** 参考：她**问**那件事的次数 */
    targetEventQuestion: q,
    chars: [...reply].length,
    questions: (reply.match(/[？?]/g) ?? []).length,
    echoType: /阳台|收拾/.test(reply) ? 1 : 0,
    quoted: /本轮开口就从这件事出发|我自己心里挂着的就是|想把它说出来/.test(reply) ? 1 : 0,
    /** 老尺子的污染源：只用于**展示**新尺子不受它影响 */
    alwaysNoise: (reply.match(/一直/g) ?? []).length,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['targetEventMention', 'targetEventShare', 'targetEventQuestion', 'chars', 'questions', 'echoType', 'quoted', 'alwaysNoise'];

const pad = (s: string, n: number) => String(s).padEnd(n, ' ');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function signTest(d: number[]) {
  const win = d.filter(x => x > 0).length, lose = d.filter(x => x < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  const choose = (k: number) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let tail = 0;
  for (let k = 0; k <= Math.min(win, lose); k++) tail += choose(k);
  return { win, lose, p: Math.min(1, 2 * tail / Math.pow(2, n)) };
}
/** 挖掉动机块（从表头到下一个 '\n【'），得到"其余部分" */
/** 剥掉调试头里的时间戳（否则两臂**必然**差 5 个字符 —— 我的检查器就是这么误报的）*/
function stripDebugHeader(s: string): string {
  return s.replace(/===== [0-9T:.\-]+Z strategy=\w+ =====/g, '===== TS strategy=X =====');
}

function otherPart(prompt: string): string {
  const i = prompt.indexOf(BLOCK_HEAD);
  if (i < 0) return prompt;
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(0, i) + prompt.slice(j < 0 ? prompt.length : j);
}
function blockOf(prompt: string): string {
  const i = prompt.indexOf(BLOCK_HEAD);
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}

interface Row {
  arm: Arm; pair: number; metrics: Metrics; reply: string; block: string;
  otherHash: string; promptLen: number; strat: string; stratReason: string;
}
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
  console.log(`  目标事件（零 LLM 指标）：${TARGET_RE} ｜ 动机内容：${CONTENT}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = () => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        pool: [{
          id: 'm1', kind: 'memory_echo', content: CONTENT, source: { memoryId: MEMORY.id },
          salience: 0.62, formedAt: now - 60_000, expiresAt: now + 5 * 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6): Promise<Record<string, never>> {
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

  // v1.56 **已上线（默认开）** ⇒ 臂的约定翻转：A = DISABLE=true（旧形状），B = 不设（现在的默认）
  const applyArm = (arm: Arm) => {
    if (arm === 'A') process.env.DISABLE_MOTIVE_REFERENT_SHAPE = 'true';
    else delete process.env.DISABLE_MOTIVE_REFERENT_SHAPE;
  };

  async function callOnce(arm: Arm, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState()) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: HIS, userId: 'ab-rs', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = blockOf(prompt);
    if (!block) throw new Error(`${arm} 臂没有动机块 —— 前提（块在场）不成立`);
    const other = stripDebugHeader(otherPart(prompt));

    const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
    const strat = (st as Record<string, unknown>).strategy as { current?: string; reason?: string } | undefined;
    const m = score(data.response);
    const row: Row = {
      arm, pair, metrics: m, reply: data.response, block, otherHash: other, promptLen: prompt.length,
      strat: String(strat?.current ?? ''), stratReason: String(strat?.reason ?? ''),
    };
    console.log(`   [${arm}] p${pair} ${String(m.chars).padStart(3)}字 目标${m.targetEventMention}`
      + `(陈述${m.targetEventShare}/问${m.targetEventQuestion}) 问句${m.questions} 接住他${m.echoType}`
      + ` 一直×${m.alwaysNoise} ｜策略=${row.strat}`);
    return row;
  }

  console.log(`[跑法] ${N} 对 × 2 臂 = ${N * 2} 格（逐对交替，配对）\n`);
  for (let pair = 1; pair <= N; pair++) {
    for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
      rows.push(await callOnce(arm, pair));
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const pairDiffs = (k: keyof Metrics) => Array.from({ length: N }, (_, i) => {
    const a = rows.find(r => r.arm === 'A' && r.pair === i + 1);
    const b = rows.find(r => r.arm === 'B' && r.pair === i + 1);
    return a && b ? b.metrics[k] - a.metrics[k] : null;
  }).filter((x): x is number => x !== null);
  const meanOf = (k: keyof Metrics, arm: Arm) => mean(rows.filter(r => r.arm === arm).map(r => r.metrics[k]));

  // ── ① 操纵检查（三条，用户明确要求的）──
  console.log(`\n${'='.repeat(98)}\n① 操纵检查（唯一变量 = 指代；其余必须完全一致）\n${'='.repeat(98)}`);
  const aMark = rows.filter(r => r.arm === 'A' && r.block.includes('问的应该是这件事的具体下文')).length;
  const bMark = rows.filter(r => r.arm === 'B' && r.block.includes('我自己心里挂着的就是')).length;
  const bNoDeixis = rows.filter(r => r.arm === 'B' && !r.block.includes('这件事')).length;
  const aContent = rows.filter(r => r.arm === 'A' && r.block.includes(CONTENT)).length;
  const bContent = rows.filter(r => r.arm === 'B' && r.block.includes(CONTENT)).length;
  const identicalPairs = Array.from({ length: N }, (_, i) => i + 1)
    .filter(p => {
      const a = rows.find(r => r.arm === 'A' && r.pair === p);
      const b = rows.find(r => r.arm === 'B' && r.pair === p);
      return a && b && a.otherHash === b.otherHash;
    }).length;
  const manOk = aMark === N && bMark === N && bNoDeixis === N && aContent === N && bContent === N && identicalPairs === N;
  console.log(`   ① A 臂块含旧那句：${aMark}/${N}；B 臂块含新锚定句：${bMark}/${N}；B 臂**无**「这件事」：${bNoDeixis}/${N}`);
  console.log(`   ② 动机内容逐字相同：A ${aContent}/${N}、B ${bContent}/${N}`);
  console.log(`   ③ **Prompt 除动机块以外逐字相同**：${identicalPairs}/${N} 对 ✓（用户明确要求）`);
  console.log(`   A 臂块：\n     ${rows.find(r => r.arm === 'A')!.block.split('\n').join('\n     ')}`);
  console.log(`   B 臂块：\n     ${rows.find(r => r.arm === 'B')!.block.split('\n').join('\n     ')}`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(98)}\n② 分组均值\n${'='.repeat(98)}`);
  console.log('   ' + pad('指标', 22) + pad('A 现状', 12) + pad('B 指代消歧', 14) + 'B−A');
  for (const k of KEYS) {
    console.log('   ' + pad(k, 22) + pad(meanOf(k, 'A').toFixed(2), 12) + pad(meanOf(k, 'B').toFixed(2), 14)
      + (meanOf(k, 'B') - meanOf(k, 'A')).toFixed(2));
  }

  // ── ③ 结构性读数 ──
  console.log(`\n${'='.repeat(98)}\n③ 结构性读数（事实，不是假设检验）\n${'='.repeat(98)}`);
  const aStrats = [...new Set(rows.filter(r => r.arm === 'A').map(r => r.strat))];
  const bStrats = [...new Set(rows.filter(r => r.arm === 'B').map(r => r.strat))];
  const stratSame = aStrats.length === 1 && bStrats.length === 1 && aStrats[0] === bStrats[0];
  console.log(`   策略：A ${aStrats.join('|') || '(空)'} ｜ B ${bStrats.join('|') || '(空)'} ⇒ ${stratSame ? '✓ 两臂一致（符合"只动指代"）' : '✗ 两臂不同'}`);
  console.log(`   新尺子的污染源「一直」出现次数：A ${rows.filter(r => r.arm === 'A').reduce((a, r) => a + r.metrics.alwaysNoise, 0)}`
    + ` / B ${rows.filter(r => r.arm === 'B').reduce((a, r) => a + r.metrics.alwaysNoise, 0)}`
    + `（新主终点**一个都没数**它）`);

  // ── ④ 漂移对照（与 v1.55 的 A 臂比）──
  console.log(`\n${'='.repeat(98)}\n④ 漂移对照（同一 A 臂，隔一次运行）\n${'='.repeat(98)}`);
  if (existsSync(PREV)) {
    const prev = readFileSync(PREV, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { arm: string; reply: string; metrics: { chars: number } });
    const prevA = prev.filter(r => r.arm === 'A');
    console.log(`   v1.55 那次 A 臂（n=${prevA.length}）字数 ${mean(prevA.map(r => r.metrics.chars)).toFixed(1)}`
      + ` ｜ 本次 A 臂字数 ${meanOf('chars', 'A').toFixed(1)}`);
    const prevOpener = [...new Set(prevA.map(r => r.reply.split(/[。？?]/)[0].trim()))];
    console.log(`   v1.55 A 臂开场去重：${prevOpener.length} 种 ｜ 本次 A 臂开场去重：`
      + `${[...new Set(rows.filter(r => r.arm === 'A').map(r => r.reply.split(/[。？?]/)[0].trim()))].length} 种`);
    console.log(`   ⇒ 两次 A 臂的**开场是否同形**是判断"装置痕迹"的参照：同形 ⇒ 那 24/24 的固定开场是**提示词**造成的`);
  } else console.log(`   （找不到 ${PREV}，跳过）`);

  // ── ⑤ 裁定 ──
  const dM = pairDiffs('targetEventMention'); const sM = signTest(dM);
  const dS = pairDiffs('targetEventShare'); const sS = signTest(dS);
  const cA = meanOf('chars', 'A'), cB = meanOf('chars', 'B');
  const primary = mean(dM) > 0 && sM.p <= 0.10;
  const charsOk = cB >= 0.7 * cA;
  const echoOk = mean(pairDiffs('echoType')) >= 0;
  const quotedOk = rows.reduce((a, r) => a + r.metrics.quoted, 0) / rows.length <= 0.5;
  const passed = manOk && primary && charsOk && echoOk && quotedOk && stratSame;
  console.log(`\n${'='.repeat(98)}\n⑤ 数据层面裁定（判据跑之前写死）\n${'='.repeat(98)}`);
  console.log(`   主终点【她提到了那件事】：${meanOf('targetEventMention', 'A').toFixed(2)} → ${meanOf('targetEventMention', 'B').toFixed(2)}`
    + `（B增${sM.win} A增${sM.lose} p=${sM.p.toFixed(3)}）⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   副终点【她是**说出来**的（陈述句）】：${meanOf('targetEventShare', 'A').toFixed(2)} → ${meanOf('targetEventShare', 'B').toFixed(2)}`
    + `（B增${sS.win} A增${sS.lose} p=${sS.p.toFixed(3)}）`);
  console.log(`   参考【她**问**那件事】：${meanOf('targetEventQuestion', 'A').toFixed(2)} → ${meanOf('targetEventQuestion', 'B').toFixed(2)}`);
  console.log(`   护栏 策略一致 ${stratSame ? '✓' : '✗'}｜字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）${charsOk ? '✓' : '✗'}`
    + `｜仍接住他那件事 ${echoOk ? '✓' : '✗'}｜照抄 ${(rows.reduce((a, r) => a + r.metrics.quoted, 0) / rows.length * 100).toFixed(0)}% ${quotedOk ? '✓' : '✗'}`);
  console.log(`\n   A 臂回复（全部）：`);
  for (const r of rows.filter(x => x.arm === 'A')) console.log(`     · ${r.reply.replace(/\n/g, ' ')}`);
  console.log(`   B 臂回复（全部）：`);
  for (const r of rows.filter(x => x.arm === 'B')) console.log(`     · ${r.reply.replace(/\n/g, ' ')}`);
  console.log(`\n   ⇒ 数据层面：${passed ? '**达标**' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   行文件：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
