// ── v1.55 「理由形状」真管道 A/B（用户方案的第一步）──
//
// 假说（**唯一的新变量**）：动机内容之所以从不进她的话，不是内容形态问题
//（v1.54 已证三种形态全零：元指令 / 干净标签 / 造句），而是**内容没有动机力** ——
// 一件"被记着的事"若不带上"我为什么想说"，模型只会把它当背景资料。
//
// 两臂**只差中间两行**（表头与末尾那条元描述禁令两臂相同 ⇒ 唯一变量就是"理由"）：
//
//   A 现状·任务式                       B 理由式（用户方案）
//   【此刻我心里挂着的事】<内容>        【此刻我心里挂着的事】我想让他知道：<内容>
//   本轮开口就从这件事出发——…           因为<该类动机的理由>。
//   如果他此刻的情绪更需要被接住…       表达倾向：自然分享，不主动转移话题。
//   不要说出"我心里挂着"这类元描述…     不要说出"我心里挂着"这类元描述…
//
// 底子：动机内容用 v1.54 的**干净造句**（`我想起他说过「…」`），两臂逐字相同
// ⇒ 排除 v1.54 那个"元指令"变量。他这句讲**阳台**，她记的是**看海**（两件事无关）
// ⇒ 「她提到那件事」是干净读数。
//
// **预声明判据（跑之前写死）**：
//   操纵检查：A 臂块含「本轮开口就从这件事出发」12/12；B 臂块含「我想让他知道：」（带冒号——
//             因为 `VALUE_STANCE_LINES` 里本来就有一句"我想让他知道"）12/12；
//             两臂的**动机内容逐字相同**。
//   主终点  `expresses`（她的话里出现**那件事**（海）**或它的关系意义**（一起/共同/经历/见证/一直/记得））：
//             B > A，配对符号检验 p ≤ 0.10。
//   底线    字数 B ≥ 70% A；仍接住他那件事（阳台/收拾）不降；逐字照抄我的文案 ≤ 50%。
//   参考    `questions`（已知噪声地板 ±0.4 ⇒ 只记录，**不作闸门**）。
//   结构性读数（不是假设检验，是**事实**）：三臂的**策略决策**（`/state → strategy.current/reason`）
//             是否恒定 ⇒ 恒定即证明"动机**没有**到达策略层"（用户判断的连线缺口）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-reason-shape.ts [--keep] [--n=12]
// 行文件：motive-reason-shape-rows-run1.jsonl

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
const BAK = 'memories.ab-mrs-backup';
const ROWS = 'motive-reason-shape-rows-run1.jsonl';
const DUMP = '.tmp-ab-mrs-prompt.txt';
type Arm = 'A' | 'B';

/** 他这句：**阳台**（与被回忆的事无关）*/
const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';

/** 被回忆的那件事：**看海** */
const MEMORY = {
  id: 'ep_sea',
  eventSummary: '等这个项目结束，我想去趟海边',
  narrativeFragment: '当他说"等这个项目结束，我想去趟海边"的时候，她心里是期待的。',
  emotionalImpact: { dominantEmotion: 'joy', valenceDelta: 0.2 },
} as unknown as EpisodicMemory;

/** 动机内容：**两臂逐字相同**（用 v1.54 的干净造句，排除元指令变量）*/
const INJECTION = generateProactiveInjection(MEMORY, 'curious_followup', '三周前');
process.env.ENABLE_ECHO_LINE_FROM_SUMMARY = 'true';
const CONTENT = memoryEchoMotive(INJECTION, MEMORY.id, MEMORY.eventSummary)!.content;

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const RE = {
  questions: /[？?]/g,
  /** 主终点：她提到**那件事**（海）或它的**关系意义** */
  expresses: /海|看海|海边|一起|共同|经历|见证|一直|记得/g,
  echo: /阳台|收拾/,
};
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    expresses: count(RE.expresses),
    echoType: RE.echo.test(reply) ? 1 : 0,
    quoted: /本轮开口就从这件事出发|我想让他知道|表达倾向|因为那让我觉得/.test(reply) ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['expresses', 'chars', 'questions', 'echoType', 'quoted'];

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
function blockOf(prompt: string): string {
  const i = prompt.indexOf('【此刻我心里挂着的事】');
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}

interface Row {
  arm: Arm; pair: number; metrics: Metrics; reply: string; block: string;
  promptLen: number; strat: string; stratReason: string;
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
  console.log(`  两臂共用的动机内容：${CONTENT}`);

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

  const applyArm = (arm: Arm) => {
    if (arm === 'B') process.env.ENABLE_MOTIVE_REASON_SHAPE = 'true';
    else delete process.env.ENABLE_MOTIVE_REASON_SHAPE;
  };

  async function callOnce(arm: Arm, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState()) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: HIS, userId: 'ab-mrs', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = blockOf(prompt);
    if (!block) throw new Error(`${arm} 臂没有动机块 —— 这一跑的前提（块在场）不成立`);

    const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
    const strat = (st as Record<string, unknown>).strategy as { current?: string; reason?: string } | undefined;
    const m = score(data.response);
    const row: Row = {
      arm, pair, metrics: m, reply: data.response, block, promptLen: prompt.length,
      strat: String(strat?.current ?? ''), stratReason: String(strat?.reason ?? ''),
    };
    console.log(`   [${arm}] p${pair} ${String(m.chars).padStart(3)}字 那件事${m.expresses} 问句${m.questions}`
      + ` 接住他${m.echoType} 抄${m.quoted} ｜策略=${row.strat}`);
    return row;
  }

  console.log(`[跑法] e1×${N} × 2 臂 = ${N * 2} 格\n`);
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

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(96)}\n① 操纵检查（两臂只差中间两行：理由）\n${'='.repeat(96)}`);
  const aMark = rows.filter(r => r.arm === 'A' && r.block.includes('本轮开口就从这件事出发')).length;
  const bMark = rows.filter(r => r.arm === 'B' && r.block.includes('我想让他知道：')).length;
  const aContent = rows.filter(r => r.arm === 'A' && r.block.includes(CONTENT)).length;
  const bContent = rows.filter(r => r.arm === 'B' && r.block.includes(CONTENT)).length;
  const contentSame = aContent === N && bContent === N;
  const manOk = aMark === N && bMark === N && contentSame;
  console.log(`   A 臂含「本轮开口就从这件事出发」：${aMark}/${N}（期望全部）`);
  console.log(`   B 臂含「我想让他知道：」：${bMark}/${N}（期望全部）`);
  console.log(`   两臂的**动机内容逐字相同**：A ${aContent}/${N}、B ${bContent}/${N}（期望都全部）`);
  console.log(`   A 臂块：\n     ${rows.find(r => r.arm === 'A')!.block.split('\n').join('\n     ')}`);
  console.log(`   B 臂块：\n     ${rows.find(r => r.arm === 'B')!.block.split('\n').join('\n     ')}`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(96)}\n② 分组均值\n${'='.repeat(96)}`);
  console.log('   ' + pad('指标', 12) + pad('A 现状·任务式', 18) + pad('B 理由式', 14) + 'B−A');
  for (const k of KEYS) {
    console.log('   ' + pad(k, 12) + pad(meanOf(k, 'A').toFixed(2), 18) + pad(meanOf(k, 'B').toFixed(2), 14)
      + (meanOf(k, 'B') - meanOf(k, 'A')).toFixed(2));
  }

  // ── ③ 结构性读数：动机有没有到达策略层 ──
  console.log(`\n${'='.repeat(96)}\n③ 结构性读数：动机**有没有**到达策略层（不是假设检验，是事实）\n${'='.repeat(96)}`);
  const aStrats = [...new Set(rows.filter(r => r.arm === 'A').map(r => r.strat))];
  const bStrats = [...new Set(rows.filter(r => r.arm === 'B').map(r => r.strat))];
  const aReasons = [...new Set(rows.filter(r => r.arm === 'A').map(r => r.stratReason))];
  const bReasons = [...new Set(rows.filter(r => r.arm === 'B').map(r => r.stratReason))];
  console.log(`   A 臂策略：${aStrats.join(' | ') || '(空)'}（${aReasons.length} 种理由）`);
  console.log(`   B 臂策略：${bStrats.join(' | ') || '(空)'}（${bReasons.length} 种理由）`);
  console.log(`   理由里**有没有**出现动机/那件事的痕迹：A ${aReasons.some(x => /动机|海|记得/.test(x)) ? '有' : '没有'}`
    + `、B ${bReasons.some(x => /动机|海|记得/.test(x)) ? '有' : '没有'}`);
  console.log(`   ⇒ 两臂策略若同为一类 ⇒ **动机块与策略层之间没有连线**（同一句话、同一个她的状态，`);
  console.log(`      唯一的差别是动机块的写法，而策略层看不见它）`);

  // ── ④ 裁定 ──
  const dE = pairDiffs('expresses'); const sE = signTest(dE);
  const cA = meanOf('chars', 'A'), cB = meanOf('chars', 'B');
  const dEcho = pairDiffs('echoType');
  const primary = mean(dE) > 0 && sE.p <= 0.10;
  const charsOk = cB >= 0.7 * cA;
  const echoOk = mean(dEcho) >= 0;
  const quotedOk = rows.reduce((a, r) => a + r.metrics.quoted, 0) / rows.length <= 0.5;
  const passed = manOk && primary && charsOk && echoOk && quotedOk;
  console.log(`\n${'='.repeat(96)}\n④ 数据层面裁定（判据跑之前写死）\n${'='.repeat(96)}`);
  console.log(`   主终点【她把那件事/它的意义说出来了】：${meanOf('expresses', 'A').toFixed(2)} → ${meanOf('expresses', 'B').toFixed(2)}`
    + `（均值差 ${mean(dE).toFixed(2)}，B增${sE.win} A增${sE.lose} p=${sE.p.toFixed(3)}）⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   底线 字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了'}`);
  console.log(`   底线 仍接住他那件事（阳台/收拾）均值差 ${mean(dEcho).toFixed(2)} ⇒ ${echoOk ? '✓' : '✗ 掉了'}`);
  console.log(`   底线 逐字照抄我的文案 ${(rows.reduce((a, r) => a + r.metrics.quoted, 0) / rows.length * 100).toFixed(0)}% ⇒ ${quotedOk ? '✓' : '✗'}`);
  console.log(`\n   A 臂回复样例：`);
  for (const r of rows.filter(x => x.arm === 'A').slice(0, 4)) console.log(`     · ${r.reply.replace(/\n/g, ' ')}`);
  console.log(`   B 臂回复样例：`);
  for (const r of rows.filter(x => x.arm === 'B').slice(0, 4)) console.log(`     · ${r.reply.replace(/\n/g, ' ')}`);
  console.log(`\n   ⇒ 数据层面：${passed ? '**达标**' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   行文件：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
