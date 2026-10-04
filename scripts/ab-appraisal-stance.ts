// ── v1.47 A/B：把"这件事对我来说意味着什么"送进她的 Prompt，她的话会不会变 ──
//
// 起因（真管道探针 `scripts/probe-her-state-in-prompt.ts` 实测）：
//   同一轮里评价层**算对了** ——「他说的正是我挂着的（都提到「体检」），而且不好 → 我替他悬着」——
//   但 `getLastAppraisal()` 的消费者**只有 /state**，那句话**一个字都没进她的 Prompt**。
//   而她的状态进 Prompt 的唯一通路（前端 `buildEmotionContext`）**按绝对值排序**，
//   于是同一轮里系统对她说的是「当前情绪: calm(0.80), love(0.40)…／主导情绪: calm。回答时自然地流露出这种情绪。」
//   ⇒ v1.18 把这条缺口记成"fear 只有 0.028、要抬 cap"是**推论错了**：探针实测那轮 fear 位移 0.102，
//     而且就算抬到 0.27 也挤不进绝对值前三。缺的不是幅度，是**投递**。
//
// 变量只有一个：**同一批"正好碰到她挂着的事"的坏消息**下，这一块给不给。
//   A = 基线（开关关）：Prompt 里没有评价那一块（逐字与旧版相同）。
//   B = `ENABLE_APPRAISAL_STANCE=true`：末尾策略片段**之前**多一块
//       「【这件事对我来说意味着什么】…我这会儿是替他悬着的那种沉…」。
//
// 两臂都用**同一份 persona**（含前端那条状态块，见 `personaFor`）—— 因为生产浏览器就是这么送的：
//   · 单一变量仍是"评价块给不给"；
//   · 结论才**能搬到生产**（我的其它 harness 不发 persona，Prompt 只有 ~1.8KB，
//     而生产是 ~10KB，见探针实测：1771 字 vs 10112 字）。
//
// ── 事先声明的判据（跑之前写死）──
//   主终点 `dread`（**担心式追问**）：她问的是"结果好坏/严不严重"，而不是中立地问细节。
//          判据：出现率 B > A，且配对符号检验 p ≤ 0.10。
//          ⚠️ 词表（严不严重/要紧吗/有没有事/是不是不太好/别吓/糟不糟/怎么回事）**与片段文字零重叠**
//             —— 片段里刻意不写这些词，由 `appraisalStance.test.ts` 的守卫钉住。
//   次终点 `stake`（把这件事连到"她自己在等"）：一直/惦记/挂着/放心不下 —— **只报告，不作判据**
//          （它对语义最贴，但离片段的用词最近，当判据有自证风险）。
//   不退化底线（任一破了就算输）：
//     · `comfort`（泛泛安慰：别一个人扛着/你心里有数/会好的/想开点/没关系）**不许上升**
//     · `echo`（回复有没有落在他那句话的**具体内容**上，结构量）不许下降
//     · `chars` 均值 ≥ A 臂的 70%
//     · `selfAnnounce`（她把自己的情绪宣布出来：我很担心/我害怕/我心里难受…）**不许上升**
//     · 同臂逐字重复组数 B ≤ A（v1.45 的教训：这类护栏要留着，但用连续量一起看）
//   对照   一条**碰不到她挂着的事**的平常话：两臂都必须**没有**那一块（证明它只在有评价时出现）
//   操纵   低谷条件之外再加一条：B 臂 Prompt 必须含【这件事对我来说意味着什么】、A 臂必须不含，
//          且两臂的**策略块**逐字节相同（把变量收成一个）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-appraisal-stance.ts [--n=3] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { buildEmotionContext } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';
import { normalizeForCompare, openerReuse } from '../src/lib/replyDiversity.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';
delete process.env.DISABLE_APPRAISAL;          // 这一跑测的就是评价层

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const N = Math.max(2, arg('n', 3));
const KEEP = process.argv.includes('--keep');

/**
 * 五条"正好碰到她挂着的那件事"的坏消息 + 一条碰不到的平常话（对照）。
 * 每条都配一句**与她挂着的事有 ≥2 字词面锚点**的牵挂（否则评价层认不出来 —— 它宁可认不出）。
 */
const CASES = [
  { id: 'c1', text: '体检报告出来了，医生说情况不太好。', concern: '他体检结果到底怎么样' },
  { id: 'c2', text: '面试结果出来了，没通过，第二轮就被刷了。', concern: '他面试那事有消息了吗' },
  { id: 'c3', text: '项目验收没过，得整个重做，我这周白熬了。', concern: '他那个项目验收怎么样了' },
  { id: 'c4', text: '那套房子没租成，房东临时反悔了，烦死了。', concern: '他说要搬的那套房子最后租了吗' },
  { id: 'c5', text: '我爸的手术排期下来了，情况比想的麻烦。', concern: '他爸的手术安排在什么时候' },
];
const CONTROL = { id: 'k1', text: '楼下新开了一家面馆，中午去试了下。', concern: '他体检结果到底怎么样' };

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const MEM = 'memories';
const BAK = 'memories.ab-as-bak';
const DUMP = '.tmp-ab-as-prompt.txt';
const ROWS = 'appraisal-stance-rows.jsonl';
const MARKER = '【这件事对我来说意味着什么】';

type Arm = 'A' | 'B';
const applyArm = (arm: Arm) => {
  if (arm === 'B') process.env.ENABLE_APPRAISAL_STANCE = 'true';
  else delete process.env.ENABLE_APPRAISAL_STANCE;
};

const RE = {
  /** 主终点：担心式追问 —— **与片段文字零重叠**（片段里没有这些词） */
  dread: /严不严重|严重吗|要不要紧|要紧吗|有没有事|没什么事吧|是不是不太好|是不是不乐观|别吓我|糟不糟|多糟|到底怎么样|情况如何/g,
  /** 次终点（只报告）：把这件事连到"她自己在等" */
  stake: /一直|惦记|挂着|放心不下/g,
  comfort: /别一个人扛着|一个人扛|你心里有数|会好的|想开点|没关系|别难过|没事的/g,
  /** 她把自己的情绪宣布出来 */
  selfAnnounce: /我很担心|我担心你|我害怕|我替你担心|我心里难受|我有点担心|我也很担心/g,
  presencePhrase: /我就?在|陪着你|我陪|不走|不用一个人|在这儿|在呢/g,
  questions: /[？?]/g,
};
const STOP = new Set(['我', '你', '的', '了', '是', '在', '和', '有', '就', '都', '也', '很', '要', '会',
  '去', '个', '这', '那', '一', '下', '吗', '呢', '吧', '啊', '嗯', '过', '把', '被', '给', '对', '到',
  '说', '想', '还', '没', '不', '他', '她', '它', '们', '之', '与', '着', '得', '地', '上', '里', '中']);

/** 回复里最长的一段"与他那句话逐字重合的内容词"（≥2 字、非纯虚词）—— 结构量，与我的文字无关 */
function longestEcho(reply: string, hisText: string): number {
  const content = (s: string) => [...s].filter(c => /[\u4e00-\u9fffA-Za-z0-9]/.test(c));
  const A = content(reply), B = content(hisText).join('');
  let best = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 2; j <= A.length; j++) {
      const sub = A.slice(i, j);
      if (sub.every(c => STOP.has(c))) continue;
      if (B.includes(sub.join(''))) best = Math.max(best, sub.length);
    }
  }
  return best;
}

function score(reply: string, hisText: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  const questions = count(RE.questions);
  return {
    chars: [...reply].length,
    questions,
    dread: count(RE.dread),
    stake: count(RE.stake),
    comfort: count(RE.comfort),
    selfAnnounce: count(RE.selfAnnounce),
    presencePhrase: count(RE.presencePhrase),
    echo: longestEcho(reply, hisText) >= 2 ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['dread', 'stake', 'comfort', 'selfAnnounce', 'echo', 'presencePhrase', 'questions', 'chars'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
const C = (a: number, b: number) => fact(a) / (fact(b) * fact(a - b));
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length, lose = diffs.filter(d => d < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  let tail = 0;
  for (let k = Math.max(win, lose); k <= n; k++) tail += C(n, k);
  return { win, lose, p: Math.min(1, (2 * tail) / 2 ** n) };
}
const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

const STRAT_MARKER = '【当前策略：';
function strategyBlockOf(prompt: string): string {
  const i = prompt.indexOf(STRAT_MARKER);
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}
const HEADER_TO_KEY: Record<string, string> = {};
for (const [k, v] of Object.entries(STRATEGY_PROMPT_SNIPPETS)) {
  const m = (v as string).match(/^【当前策略：(.+?)】/);
  if (m) HEADER_TO_KEY[m[1]] = k;
}
const strategyNameOf = (block: string) => (block.match(/^【当前策略：(.+?)】/) ?? [, ''])[1] as string;

interface Row {
  arm: Arm; cond: 'treat' | 'ctl'; id: string; pair: number;
  metrics: Metrics; reply: string;
  hasAppraisal: boolean; strategyName: string; strategyBlock: string; baseMatches: boolean;
  appraisalLine: string;
}
const rows: Row[] = [];

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
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  /** 她：静息 + 一点点低（这样"她在低谷"不是变量，而"心里挂着他的事"是） */
  const makeState = (concern: string) => {
    const s = structuredClone(real) as typeof real & { internal?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.06 };
    s.baselineEmotions = { ...baseline };
    s.internal = {
      ...(s.internal ?? {}),
      motive: {
        pool: [{
          id: 'seed-concern', kind: 'open_loop', content: concern, source: {},
          salience: 0.8, formedAt: Date.now() - 3_600_000, expiresAt: Date.now() + 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  /** 生产浏览器就是这么送的：状态块由 `buildEmotionContext` 拼进 systemPrompt（两臂逐字相同） */
  const personaFor = (st: Record<string, unknown>) => ({
    name: '小禾', dynamicEmotion: true, proactive: false,
    emotionState: structuredClone(st),
    systemPrompt: buildEmotionContext(structuredClone(st) as never as never),
  });

  /**
   * 发一轮。**限流必须重试**（/api/chat 是 30 次/分钟）：v1.42 第一跑就被它静默吃掉过 30 个格子。
   * 重试用尽就抛错中断整跑 —— 宁可不跑，也不要一个悄悄变小的 n。
   */
  async function postChat(url: string, payload: unknown, tries = 6): Promise<{ response?: unknown }> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      const rateLimited = res.status === 429 || /too many requests|rate limit/i.test(err);
      if (!rateLimited || i === tries) {
        console.error(`[中断] /api/chat 没有返回 response（第 ${i} 次，HTTP ${res.status}）：${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败（见上）—— 不许静默缩小样本');
      }
      console.warn(`   ⏳ 触发限流（${err}），等 ${Math.round(wait / 1000)}s 后重发（第 ${i}/${tries} 次）`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  async function callOnce(arm: Arm, cond: 'treat' | 'ctl', c: typeof CASES[number], pair: number): Promise<Row> {
    applyArm(arm);
    const st = makeState(c.concern);
    srv.aiEngine.emotionState = structuredClone(st) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = []; co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat(url, {
      message: c.text, userId: 'ab-as', recentMessages: RECENT, persona: personaFor(st),
    });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = strategyBlockOf(prompt);
    const name = strategyNameOf(block);
    const key = HEADER_TO_KEY[name] ?? null;
    const metrics = score(data.response, c.text);
    const line = prompt.split('\n').find(l => l.startsWith(MARKER)) ?? '';
    const row: Row = {
      arm, cond, id: c.id, pair, metrics, reply: data.response,
      hasAppraisal: prompt.includes(MARKER),
      strategyName: name,
      strategyBlock: block,
      baseMatches: key !== null && block === STRATEGY_PROMPT_SNIPPETS[key as never],
      appraisalLine: line,
    };
    console.log(`   [${arm}/${cond}] ${pad(c.id, 3)} p${pair} ${pad(name || '?', 8)}`
      + `评价块=${row.hasAppraisal ? 'Y' : 'n'} ${String(metrics.chars).padStart(3)}字`
      + ` 担心式${metrics.dread} 连带${metrics.stake} 安慰${metrics.comfort} 宣布${metrics.selfAnnounce} echo${metrics.echo}`);
    return row;
  }

  const seed = makeState(CASES[0].concern);
  console.log(`[她的起始状态] 静息 + sad ${(0.06).toFixed(2)}；心里挂着「${CASES[0].concern}」`);
  console.log(`[跑法] ${CASES.length} 条坏消息 × 2 臂 × n=${N}（treat）＋ 2 臂 × n=${N}（对照：一句平常话）\n`);

  for (let pair = 1; pair <= N; pair++) {
    for (const c of CASES) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        rows.push(await callOnce(arm, 'treat', c, pair));
      }
    }
    for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
      rows.push(await callOnce(arm, 'ctl', CONTROL, pair));
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const treat = rows.filter(r => r.cond === 'treat');
  const pick = (arm: Arm, cond: 'treat' | 'ctl', id: string) => rows.filter(r => r.arm === arm && r.cond === cond && r.id === id);

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(88)}\n① 操纵检查\n${'='.repeat(88)}`);
  let manOk = true;
  for (const c of CASES) {
    const a = pick('A', 'treat', c.id), b = pick('B', 'treat', c.id);
    const okA = a.length > 0 && a.every(r => !r.hasAppraisal && r.baseMatches);
    const okB = b.length > 0 && b.every(r => r.hasAppraisal && r.baseMatches);
    if (!okA || !okB) manOk = false;
    const names = [...new Set([...a, ...b].map(r => r.strategyName))].join('/');
    console.log(`   ${pad(c.id, 3)}策略=${pad(names, 10)} A无块=${okA ? 'Y' : 'n'} B有块=${b.filter(r => r.hasAppraisal).length}/${b.length}`
      + `${okB ? ' ✓' : ' ✗'}`);
    const sample = b.find(r => r.appraisalLine)?.appraisalLine;
    if (sample) console.log(`        B 的块：${sample.slice(0, 120)}`);
  }
  // 对照：碰不到她挂着的事 ⇒ 两臂都不许有那一块
  let ctlOk = 0, ctlTotal = 0;
  for (let pair = 1; pair <= N; pair++) {
    const a = rows.find(r => r.arm === 'A' && r.cond === 'ctl' && r.pair === pair);
    const b = rows.find(r => r.arm === 'B' && r.cond === 'ctl' && r.pair === pair);
    if (!a || !b) continue;
    ctlTotal++;
    if (!a.hasAppraisal && !b.hasAppraisal) ctlOk++;
  }
  console.log(`   对照（碰不到她挂着的事）：两臂都没有那一块 ${ctlOk}/${ctlTotal}${ctlOk === ctlTotal && ctlTotal > 0 ? ' ✓ 变量只有一个' : ' ✗'}`);
  if (ctlOk !== ctlTotal || ctlTotal === 0) manOk = false;
  // 两臂策略块逐字节相同（把变量收成一个：只有评价块不同）
  let stratSame = 0;
  for (const c of CASES) for (let pair = 1; pair <= N; pair++) {
    const a = treat.find(r => r.arm === 'A' && r.id === c.id && r.pair === pair);
    const b = treat.find(r => r.arm === 'B' && r.id === c.id && r.pair === pair);
    if (a && b && a.hasAppraisal !== b.hasAppraisal) {
      // 评价块在策略块之前，所以策略块本身应当仍然相同
      if (a.strategyBlock === b.strategyBlock) stratSame++;
    }
  }
  console.log(`   两臂策略块逐字节相同的配对：${stratSame}（评价块插在策略块**之前**，策略块本身不该被影响）`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的数字不能当结论用'}`);

  // ── ② 各臂均值 ──
  console.log(`\n${'='.repeat(88)}\n② 各臂均值（低谷条件 n=${treat.filter(r => r.arm === 'A').length}/${treat.filter(r => r.arm === 'B').length}）\n${'='.repeat(88)}`);
  console.log(pad('指标', 16) + pad('A 基线', 16) + pad('B 有评价块', 16) + 'B−A');
  for (const k of KEYS) {
    const g = (arm: Arm) => treat.filter(r => r.arm === arm).map(r => r.metrics[k]);
    const [A, B] = [g('A'), g('B')];
    console.log(pad(k, 16) + pad(`${mean(A).toFixed(2)}±${sd(A).toFixed(2)}`, 16)
      + pad(`${mean(B).toFixed(2)}±${sd(B).toFixed(2)}`, 16) + (mean(B) - mean(A)).toFixed(2));
  }

  // ── ③ 配对符号检验 ──
  const pairsOf = (k: keyof Metrics) => CASES.flatMap(c => Array.from({ length: N }, (_, i) => {
    const a = treat.find(r => r.arm === 'A' && r.id === c.id && r.pair === i + 1);
    const b = treat.find(r => r.arm === 'B' && r.id === c.id && r.pair === i + 1);
    return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
  }).filter((x): x is [number, number] => x !== null));
  const diffs = (k: keyof Metrics) => pairsOf(k).map(([a, b]) => b - a);
  console.log(`\n${'='.repeat(88)}\n③ 配对检验（同一条话同 pair，对立面 = 基线 A）\n${'='.repeat(88)}`);
  for (const k of KEYS) {
    const d = diffs(k); const s = signTest(d);
    const dir = mean(d) < 0 ? '更低' : mean(d) > 0 ? '更高' : '持平';
    console.log(`   ${pad(k, 16)}B胜${String(s.win).padStart(2)} A胜${String(s.lose).padStart(2)} p=${s.p.toFixed(3)}`
      + ` 均值差 ${mean(d).toFixed(2)}（B ${dir}）`);
  }

  // ── ④ 逐字重复（只用连续量 + 组数一起看；v1.45 的教训）──
  const dupGroups = (arm: Arm) => {
    const g = new Map<string, number>();
    for (const r of treat.filter(x => x.arm === arm)) g.set(r.reply, (g.get(r.reply) ?? 0) + 1);
    return [...g.values()].filter(v => v > 1).length;
  };
  const openA = openerReuse(treat.filter(r => r.arm === 'A').map(r => r.reply));
  const openB = openerReuse(treat.filter(r => r.arm === 'B').map(r => r.reply));
  console.log(`\n${'='.repeat(88)}\n④ 重复（连续量为主）\n${'='.repeat(88)}`);
  console.log(`   A：逐字重复组 ${dupGroups('A')}｜开场框架 ${openA.frame.distinct}/${openA.n} 种（最多占 ${(openA.frame.share * 100).toFixed(0)}%）`);
  console.log(`   B：逐字重复组 ${dupGroups('B')}｜开场框架 ${openB.frame.distinct}/${openB.n} 种（最多占 ${(openB.frame.share * 100).toFixed(0)}%）`);

  // ── ⑤ 裁定 ──
  const sDread = signTest(diffs('dread'));
  const primary = mean(diffs('dread')) > 0 && sDread.p <= 0.10;
  const dreadRate = (arm: Arm) => {
    const rs = treat.filter(r => r.arm === arm);
    return rs.filter(r => r.metrics.dread > 0).length / rs.length;
  };
  const mA = mean(treat.filter(r => r.arm === 'A').map(r => r.metrics.chars));
  const mB = mean(treat.filter(r => r.arm === 'B').map(r => r.metrics.chars));
  const charsOk = mB >= 0.7 * mA;
  const comfortOk = mean(diffs('comfort')) <= 0;
  const echoOk = mean(diffs('echo')) >= 0;
  const announceOk = mean(diffs('selfAnnounce')) <= 0;
  const dupOk = dupGroups('B') <= dupGroups('A') && openB.frame.share <= Math.max(0.2, openA.frame.share * 1.5);
  console.log(`\n${'='.repeat(88)}\n⑤ 数据层面裁定（判据跑之前写死；最终裁定要人看过原文再下）\n${'='.repeat(88)}`);
  console.log(`   主终点 dread（担心式追问）：出现率 ${(dreadRate('A') * 100).toFixed(0)}% → ${(dreadRate('B') * 100).toFixed(0)}%`
    + `，均值差 ${mean(diffs('dread')).toFixed(2)}（B胜${sDread.win} A胜${sDread.lose} p=${sDread.p.toFixed(3)}）⇒ ${primary ? '✓ 达标' : '✗ 未达标'}`);
  console.log(`   次终点 stake（连带自己，**只报告**）：均值差 ${mean(diffs('stake')).toFixed(2)}`
    + `（B胜${signTest(diffs('stake')).win} A胜${signTest(diffs('stake')).lose}）`);
  console.log(`   护栏   安慰腔 comfort ${mean(diffs('comfort')).toFixed(2)} ${comfortOk ? '✓ 没更多' : '✗ 变多了 ⇒ 算输'}`);
  console.log(`   护栏   接住 echo ${mean(diffs('echo')).toFixed(2)} ${echoOk ? '✓ 没掉' : '✗ 掉了 ⇒ 算输'}`);
  console.log(`   护栏   字数 ${mA.toFixed(1)} → ${mB.toFixed(1)}（${(mB / mA * 100).toFixed(0)}%） ${charsOk ? '✓' : '✗ 塌了 ⇒ 算输'}`);
  console.log(`   护栏   宣布心情 selfAnnounce ${mean(diffs('selfAnnounce')).toFixed(2)} ${announceOk ? '✓ 没更多' : '✗ 变多了 ⇒ 算输'}`);
  console.log(`   护栏   重复（组数 + 开场框架占比） ${dupOk ? '✓' : '✗ 更单调 ⇒ 算输'}`);
  const pass = manOk && primary && comfortOk && echoOk && charsOk && announceOk && dupOk;
  console.log(`   ⇒ 数据层面：${pass ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   回复原文：${ROWS}（人工过目）`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
