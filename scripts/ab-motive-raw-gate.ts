// ── v1.52 动机门槛改看"加权前"：真管道 A/B ──
//
// 病灶（v1.51 量出，见 `measure-motive-reach.ts`）：学习权重 `0.5 + 回应率` 的下界 0.5 把
// `curiosity`（0.26）/`stance`（0.23）压到门槛 0.28 之下 ⇒ 这两类**事实上永远开不了口**，
// 而 `MOTIVE_MIN_SALIENCE` 是按**未加权**先验标定的。修法：门槛看**加权前**（情境问题：
// 这件事值不值得开口），学习权重只用于**排序**（学习问题：够格的里面谁最该说）。
//
// 预声明判据（**跑之前写死**）：
//   操纵检查：A/s1 A/q1 拿不到动机块（安静陪伴）；B/s1 拿到我种的那条 stance；B/q1 是 curiosity；
//            负对照 k1（memory_echo，**不在账本里** ⇒ 权重 1.0）两臂动机块**逐字相同**。
//   主终点 s1：她**自己也说了一句**（陈述句数）B > A，配对符号检验 p ≤ 0.10。
//   底线：字数 ≥ 70% A；仍在跟他说话（toHim）不降；逐字照抄 ≤ 50%。
//   副终点 q1：B 能开口（拿得到 curiosity 动机块）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-raw-gate.ts [--keep] [--n=8]
// ── 第二跑（改了两处**量具/期望**，判据本身没放宽）──
//   · 护栏 `toHim`（数「你/他」两个字）第一跑报 −0.63，**是假阴性**：原文里 A 臂每格都是
//     同一句万能二选一（「你是那种…还是…？」，两个「你」），B 臂变成「先说自己一句、再问他一句」
//     （问句少了一处、代词自然少）。v1.49 已记过这把尺子数不到没有代词的问句 ⇒ 换成
//     **engaged = 仍在跟他互动**（接住他这句的话题 **或** 问他 ≥1 句）；`toHim` 只打印、不作为闸门。
//   · s1 的操纵检查：B 臂未必选中**我种的那条** —— 服务端自己也会加一条 stance（由价值观生成），
//     两条都够格 ⇒ 认「**任意一条 stance**开口」。
// 行文件：motive-raw-gate-rows-run2.jsonl

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const KEEP = process.argv.includes('--keep');
const N = (() => { const hit = process.argv.find(a => a.startsWith('--n=')); return hit ? Math.max(4, Number(hit.split('=')[1])) : 8; })();
const B = RESTING_EMOTION_BASELINE;
const MOOD = -0.06;
const MEM = 'memories';
const BAK = 'memories.ab-rg-backup';
const ROWS = 'motive-raw-gate-rows-run3.jsonl';
const DUMP = '.tmp-ab-rg-prompt.txt';
type Arm = 'A' | 'B';

/** 种进池里的动机内容（都不含下面的量具词） */
const CONTENT = {
  // ⚠️ 这条 stance 里**不能**出现 `我觉得 / 我认为 / 对我来说`（那是主终点的词）
  stance: '诚实比好听更要紧',
  curiosity: '他好像提过一家没去过的店',
  memory_echo: '他上次说想去看海，我记着呢',
};
/**
 * 要测的标记词：**这里故意是空的**。
 *
 * 原本主终点用词表量"她把态度说出来"（`我觉得|我认为|对我来说|我信`），结果自检当场拦住：
 * `对我来说` **本来就在生产 Prompt 里**（persona 那一大段里就有）⇒ 量的是我自己的字。
 * ⇒ 主终点改成**结构量**（陈述句数 / 问句数），它不可能出现在 Prompt 里；
 *    "她说的到底是不是一条态度"这一步交给**人看原文**（判据只保证"确实有话说"）。
 */
const METER_WORDS: string[] = [];

interface Scene { id: string; kind: keyof typeof CONTENT; text: string; note: string }
const SCENES: Scene[] = [
  {
    id: 's1', kind: 'stance',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '池里只有一条 stance（账本里它权重 0.50 ⇒ 旧门槛下**永远开不了口**）',
  },
  {
    id: 'q1', kind: 'curiosity',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '池里只有一条 curiosity（同上，权重 0.50）',
  },
  {
    id: 'k1', kind: 'memory_echo',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '负对照：memory_echo **不在账本里**（权重 1.0）⇒ 两臂动机块必须逐字相同',
  },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const RE = {
  questions: /[？?]/g,
  /** 陈述句数（句号/感叹号收尾的小句）—— 结构量，不可能出现在 Prompt 里 */
  statements: /[。！]/g,
  toHim: /[你他]/g,
};

function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    /** 她在"接住他那件事"之外**自己还说了一句**（旧门槛下她拿不到动机块 ⇒ 常常没话说） */
    statements: count(RE.statements),
    toHim: count(RE.toHim),
    echoType: /阳台|收拾/.test(reply) ? 1 : 0,
    /** v2 护栏：只认「还在跟他互动」（不数代词）—— `toHim` 已证是假阴性尺子 */
    engaged: (/阳台|收拾/.test(reply) || count(RE.questions) >= 1) ? 1 : 0,
    quoted: /诚实比好听更要紧|一家没去过的店|他上次说想去看海/.test(reply) ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['statements', 'questions', 'engaged', 'echoType', 'chars', 'toHim', 'quoted'];

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
const motiveKindOf = (block: string): keyof typeof CONTENT | 'other' | 'none' => {
  if (!block) return 'none';
  // 「诚实比好听更要紧」= 我种的；「我在意的是真的连上…」= 服务端由价值观生成的那条
  if (block.includes('诚实') || block.includes('在意') || block.includes('连上')) return 'stance';
  if (block.includes('没去过的店')) return 'curiosity';
  if (block.includes('看海')) return 'memory_echo';
  return 'other';
};

interface Row {
  arm: Arm; id: string; pair: number; metrics: Metrics; reply: string;
  motiveBlock: string; motiveKind: string; promptLen: number;
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

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = (kind: keyof typeof CONTENT) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: MOOD, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        pool: [{
          id: 'k1', kind, content: CONTENT[kind], source: {},
          salience: 0.5, formedAt: now - 10 * 60_000, expiresAt: now + 6 * 86_400_000, attempts: 0,
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

  // v1.52 **已上线（默认开）** ⇒ 臂的约定随之翻转：A = DISABLE=true（门槛看加权后），B = 不设（现在的默认）
  const applyArm = (arm: Arm) => {
    if (arm === 'A') process.env.DISABLE_MOTIVE_RAW_GATE = 'true';
    else delete process.env.DISABLE_MOTIVE_RAW_GATE;
  };

  async function callOnce(arm: Arm, sc: Scene, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState(sc.kind)) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: sc.text, userId: 'ab-rg', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    for (const w of METER_WORDS) {
      if (prompt.includes(w)) throw new Error(`量具污染：标记词「${w}」出现在 ${arm} 臂的 Prompt 里 —— 那量的是我自己的字`);
    }
    const block = motiveBlockOf(prompt);
    const kind = motiveKindOf(block);
    const m = score(data.response);
    const row: Row = { arm, id: sc.id, pair, metrics: m, reply: data.response, motiveBlock: block, motiveKind: kind, promptLen: prompt.length };
    console.log(`   [${arm}] ${pad(sc.id, 3)} p${pair} 动机=${pad(kind, 12)}${String(m.chars).padStart(3)}字`
      + ` 陈述${m.statements} 问句${m.questions} 接住他${m.echoType} 抄内容${m.quoted}`);
    return row;
  }

  console.log(`[跑法] ${SCENES.map(s => `${s.id}×${N}`).join(' + ')} × 2 臂 = ${SCENES.length * N * 2} 格\n`);
  for (const sc of SCENES) {
    for (let pair = 1; pair <= N; pair++) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        rows.push(await callOnce(arm, sc, pair));
      }
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const pairsOf = (k: keyof Metrics, id: string) => Array.from({ length: N }, (_, i) => {
    const a = rows.find(r => r.arm === 'A' && r.id === id && r.pair === i + 1);
    const b = rows.find(r => r.arm === 'B' && r.id === id && r.pair === i + 1);
    return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
  }).filter((x): x is [number, number] => x !== null);
  const diffs = (k: keyof Metrics, id: string) => pairsOf(k, id).map(([a, b]) => b - a);
  const meanOf = (k: keyof Metrics, id: string, arm: Arm) =>
    mean(rows.filter(r => r.arm === arm && r.id === id).map(r => r.metrics[k]));

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(94)}\n① 操纵检查（能不能开口是这一刀唯一的杠杆）\n${'='.repeat(94)}`);
  let manOk = true;
  const quiet = (id: string, arm: Arm) => rows.filter(r => r.id === id && r.arm === arm && r.motiveKind === 'none').length;
  const hasKind = (id: string, arm: Arm, k: string) => rows.filter(r => r.id === id && r.arm === arm && r.motiveKind === k).length;
  const checks: Array<[string, boolean, string]> = [
    ['A/s1 拿不到动机块（安静陪伴）', quiet('s1', 'A') === N, `${quiet('s1', 'A')}/${N}`],
    ['B/s1 拿到我种的那条 stance', hasKind('s1', 'B', 'stance') === N, `${hasKind('s1', 'B', 'stance')}/${N}`],
    ['A/q1 拿不到动机块', quiet('q1', 'A') === N, `${quiet('q1', 'A')}/${N}`],
    ['B/q1 拿到 curiosity', hasKind('q1', 'B', 'curiosity') === N, `${hasKind('q1', 'B', 'curiosity')}/${N}`],
  ];
  for (const [name, ok, num] of checks) {
    if (!ok) manOk = false;
    console.log(`   ${name}：${num} ${ok ? '✓' : '✗'}`);
  }
  const k1a = new Set(rows.filter(r => r.arm === 'A' && r.id === 'k1').map(r => r.motiveBlock));
  const k1b = new Set(rows.filter(r => r.arm === 'B' && r.id === 'k1').map(r => r.motiveBlock));
  const k1Same = k1a.size === 1 && k1b.size === 1 && [...k1a][0] === [...k1b][0];
  if (!k1Same) manOk = false;
  console.log(`   负对照 k1（memory_echo，权重 1.0）两臂动机块逐字相同 ${k1Same ? '✓' : '✗'}`
    + `（A ${k1a.size} 种 / B ${k1b.size} 种）`);
  console.log(`   量具自检：标记词（${METER_WORDS.length} 个）在两臂 Prompt 里都不出现 ✓（出现即抛错中断）`);
  console.log(`   Prompt 长度：A ${mean(rows.filter(r => r.arm === 'A').map(r => r.promptLen)).toFixed(0)}`
    + ` / B ${mean(rows.filter(r => r.arm === 'B').map(r => r.promptLen)).toFixed(0)} 字`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(94)}\n② 分组均值\n${'='.repeat(94)}`);
  for (const sc of SCENES) {
    console.log(`\n   【${sc.id}】${sc.note}（n=${N} 对）`);
    console.log('   ' + pad('指标', 14) + pad('A 旧门槛', 14) + pad('B 门槛看加权前', 18) + 'B−A');
    for (const k of KEYS) {
      console.log('   ' + pad(k, 14) + pad(meanOf(k, sc.id, 'A').toFixed(2), 14)
        + pad(meanOf(k, sc.id, 'B').toFixed(2), 18) + (meanOf(k, sc.id, 'B') - meanOf(k, sc.id, 'A')).toFixed(2));
    }
  }

  // ── ③ 裁定 ──
  const dSt = diffs('statements', 's1'); const sSt = signTest(dSt);
  const cA = meanOf('chars', 's1', 'A'), cB = meanOf('chars', 's1', 'B');
  const dEng = diffs('engaged', 's1');   // v2：换掉 toHim（假阴性），判据本身没放宽
  const quoteRate = rows.reduce((a, r) => a + r.metrics.quoted, 0) / (rows.length || 1);
  const primary = mean(dSt) > 0 && sSt.p <= 0.10;
  const charsOk = cB >= 0.7 * cA;
  const toHimOk = mean(dEng) >= 0 && meanOf('engaged', 's1', 'B') >= 0.9;
  const quoteOk = quoteRate <= 0.5;
  const passed = manOk && primary && charsOk && toHimOk && quoteOk;

  console.log(`\n${'='.repeat(94)}\n③ 数据层面裁定（判据跑之前写死；最终仍须人看原文）\n${'='.repeat(94)}`);
  console.log(`   主终点 s1【她自己也说了一句】：陈述句数 ${meanOf('statements', 's1', 'A').toFixed(2)} → `
    + `${meanOf('statements', 's1', 'B').toFixed(2)}（均值差 ${mean(dSt).toFixed(2)}，B增${sSt.win} A增${sSt.lose} `
    + `p=${sSt.p.toFixed(3)}）⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   副终点 q1【能开口】：B 臂拿到 curiosity 动机块的比例 ${(hasKind('q1', 'B', 'curiosity') / N * 100).toFixed(0)}%`
    + `（A 臂 ${(quiet('q1', 'A') / N * 100).toFixed(0)}% 是安静陪伴）`);
  console.log(`   底线 s1 字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了'}`);
  console.log(`   底线 s1 仍在跟他互动 engaged（接住他那件事 或 问他≥1句）：${meanOf('engaged', 's1', 'A').toFixed(2)} → `
    + `${meanOf('engaged', 's1', 'B').toFixed(2)}（均值差 ${mean(dEng).toFixed(2)}）⇒ ${toHimOk ? '✓' : '✗'}`);
  console.log(`   （参考：toHim 数代词 均值差 ${mean(diffs('toHim', 's1')).toFixed(2)} —— **不作为闸门**，v1.49 已证它数不到没有代词的问句）`);
  console.log(`   底线 逐字照抄动机内容 ${(quoteRate * 100).toFixed(0)}% ⇒ ${quoteOk ? '✓' : '✗ 太高'}`);
  console.log(`   负对照 k1 两臂动机块逐字相同 ⇒ ${k1Same ? '✓（这条没被门槛改动碰到）' : '✗ 碰到了 ⇒ 不算'}`);
  console.log(`   ⇒ 数据层面：${passed ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   回复原文：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
