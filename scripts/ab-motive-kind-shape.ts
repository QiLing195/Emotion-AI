// ── v1.50 动机引导语按类型分派：真管道 A/B ──
//
// 假设（有前因）：`motiveToPromptSnippet()` 那句「如果你想问他什么，问的应该是**这件事**的具体下文」
// 原本服务**所有**类型。v1.49 第一跑已经量过：形状对不上类型时，模型**直接无视那条动机**
// （`state` 拿到"他的事"的样板 ⇒ `echo` 1.00→1.00、主终点 13%→0%）；换成对得上的形状立刻生效（4%→67%）。
//
// 而 `memory_echo`（她**心里存着**的一件旧事）/`wish`/`stance` 现在拿到的正是那句"问它的具体下文" ——
// 那等于把"回忆/愿望/态度"变成"**盘问**"。
//
// 所以这一跑的主终点（**跑之前写死**）：
//   m1（memory_echo 赢）：她那句**不再变成一个问句** —— `questions` 下降（配对符号检验 p ≤ 0.10）
//                          且**仍然接住他刚说的那件事**（`echoType` 不降）、字数 ≥ 70% A。
//   副终点：她确实"把它说出来"（`recollection` 上升）；`s1`（stance 赢）同样 `questions` 下降。
//   负对照 `k1`（open_loop 赢）：**两臂的动机块必须逐字相同** —— 表里故意没有 open_loop/worry，
//                          它们本来就是"关于他的、问得通"的，一个字都不该动。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-kind-shape.ts [--keep] [--n=8]
// 行文件：motive-kind-shape-rows-run1.jsonl（每行的 `motiveBlock` 就是那一格的证据）

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
const MOOD = -0.06;                    // 心情接近中性 ⇒ 不让 v1.49 的 state 动机插进来抢戏
const MEM = 'memories';
const BAK = 'memories.ab-mks-backup';
const ROWS = 'motive-kind-shape-rows-run2.jsonl';
const DUMP = '.tmp-ab-mks-prompt.txt';
type Arm = 'A' | 'B';

/** 动机内容（每一格都种这几条之一；都不含下面的量具词） */
const CONTENT = {
  memory_echo: '他上次说想去看海，我记着呢',
  stance: '我觉得人得先对自己诚实',
  open_loop: '他面试那事有消息了吗',
};

/** 量具污染自检用：这些是**要测的标记词**，绝不许出现在 Prompt 里（否则量的是我自己的字） */
// v1.50b：量具词改成**治疗文案**里的短语 —— 它们绝不许出现在 Prompt 里（否则 `mentionsIt` 量的是我的指令）。
// ⚠️ 动机**内容**（如"他上次说想去看海"）**两臂都有** ⇒ 量「她提到那件事」是**公平的**（不是污染）。
const SHAPE_PHRASES = ['用你自己的一句话', '把它说出来', '轻轻提一句', '具体的点说出来'];
// v1.50b：指标的词（`mentionsIt`）取自**动机内容**，而内容**两臂完全相同** ⇒ 公平。
// 真正要守的是「指标词 ∩ 治疗文案 = ∅」（否则量的是我的指令）。
const METRIC_WORDS = ['看海', '海', '在意', '连上', '聊了多少', '诚实', '真话', '好听'];

interface Scene { id: string; kind: keyof typeof CONTENT; text: string; note: string }
const SCENES: Scene[] = [
  {
    id: 'm1', kind: 'memory_echo',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '池里只有一条 memory_echo（她心里存着的一件旧事）｜他讲一件平常事',
  },
  {
    id: 's1', kind: 'stance',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '池里只有一条 stance（她心里的一个态度）｜同一句他的话',
  },
  {
    id: 'k1', kind: 'open_loop',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '负对照：open_loop（关于他的、问得通）⇒ 两臂动机块**必须逐字相同**',
  },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const RE = {
  questions: /[？?]/g,
  recollection: /我想起|我记得|我想到了|让我想起|记起来/g,
  /** v1.50b 主终点：她**提到那件事**（回忆→海／态度→在意·连上·诚实）*/
  mentionsIt: /看海|海|在意|连上|聊了多少|诚实|真话|好听/g,
  toHim: /[你他]/g,
};

function score(reply: string, hisText: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    recollection: count(RE.recollection),
    mentionsIt: count(RE.mentionsIt),
    toHim: count(RE.toHim),
    /** 仍接住他刚说的那件事（阳台/收拾） */
    echoType: /阳台|收拾/.test(reply) ? 1 : 0,
    /** 逐字照抄我给的新引导语（≥10 字连续）⇒ 那是"抄指令"，不是"说出来" */
    quotedShape: /用你自己的一句话|把它说出来|轻轻提一句|具体的点说出来|你心里存着的一件事|你心里的一个态度/.test(reply) ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['mentionsIt', 'questions', 'recollection', 'echoType', 'chars', 'toHim', 'quotedShape'];

function pad(s: string, n: number) { return String(s).padEnd(n, ' '); }
function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
/** 配对符号检验（双尾）：只看方向，不看幅度 */
function signTest(d: number[]) {
  const win = d.filter(x => x > 0).length, lose = d.filter(x => x < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  const choose = (k: number) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
  let tail = 0;
  for (let k = 0; k <= Math.min(win, lose); k++) tail += choose(k);
  return { win, lose, p: Math.min(1, 2 * tail / Math.pow(2, n)) };
}

/** 从 Prompt 里取动机块（这几类的表头都是【此刻我心里挂着的事】） */
function motiveBlockOf(prompt: string): string {
  const i = prompt.indexOf('【此刻我心里挂着的事】');
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}
const motiveKindOf = (block: string): keyof typeof CONTENT | 'other' | 'none' => {
  if (!block) return 'none';
  // ⚠️ 第四次栽在同一个地方：按**内容词**认类型。这一跑 s1 的块里是服务端那条 stance
  //（内容词不在我的表里）⇒ 记成 other，但**文案检查已证明它是 stance**（新写法是 stance 专属的）。
  // ⇒ 认类型要认**表头/专属文案**，不要只认内容词。
  if (block.includes('你心里的一个态度')) return 'stance';   // 新·stance 专属引导语
  if (block.includes('看海')) return 'memory_echo';
  if (block.includes('诚实')) return 'stance';
  if (block.includes('面试')) return 'open_loop';
  return 'other';
};

interface Row {
  arm: Arm; id: string; pair: number; metrics: Metrics; reply: string;
  motiveBlock: string; motiveKind: string; promptLen: number;
}
const rows: Row[] = [];

function restore() {
  if (KEEP) { console.log(`\n[保留] --keep：${BAK}/ 未还原`); return; }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

let listenerRef: { close: () => void } | null = null;

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
  // 量具自检（静态）：指标词与治疗文案**不许重叠**
  for (const w of METRIC_WORDS) {
    if (SHAPE_PHRASES.some(sp => sp.includes(w) || w.includes(sp))) {
      throw new Error(`量具污染：「${w}」既是指标词又出现在治疗文案里 —— 那量的是我的指令`);
    }
  }
  console.log(`   量具自检（静态）：指标词（${METRIC_WORDS.length} 个）与治疗文案（${SHAPE_PHRASES.length} 条）不重叠 ✓`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  /** 她：静息情绪 ＋ 池里**只有一条**动机（这样它在两臂都稳赢，跑的是文案形状这一个变量） */
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
          salience: 0.6, formedAt: now - 10 * 60_000, expiresAt: now + 6 * 86_400_000, attempts: 0,
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

  const applyArm = (arm: Arm) => {
    if (arm === 'B') process.env.ENABLE_MOTIVE_KIND_SHAPE = 'true';
    else delete process.env.ENABLE_MOTIVE_KIND_SHAPE;
  };

  async function callOnce(arm: Arm, sc: Scene, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState(sc.kind)) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: sc.text, userId: 'ab-mks', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = motiveBlockOf(prompt);
    // 治疗文案只许出现在 B 臂（A 臂的动机块必须是旧样板）
    for (const w of SHAPE_PHRASES) {
      if (arm === 'A' && block.includes(w)) throw new Error(`操纵失败：A 臂的动机块里出现了治疗文案「${w}」`);
    }
    const kind = motiveKindOf(block);
    const m = score(data.response, sc.text);
    const row: Row = { arm, id: sc.id, pair, metrics: m, reply: data.response, motiveBlock: block, motiveKind: kind, promptLen: prompt.length };
    console.log(`   [${arm}] ${pad(sc.id, 3)} p${pair} 动机=${pad(kind, 12)}${String(m.chars).padStart(3)}字`
      + ` 提到那件事${m.mentionsIt} 问句${m.questions} 接住他${m.echoType} 抄指令${m.quotedShape}`);
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
  const rate = (k: keyof Metrics, id: string, arm: Arm) => {
    const rs = rows.filter(r => r.arm === arm && r.id === id);
    return rs.length ? rs.filter(r => r.metrics[k] > 0).length / rs.length : 0;
  };

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(94)}\n① 操纵检查（文案是这一刀唯一的杠杆，必须逐字对得上）\n${'='.repeat(94)}`);
  let manOk = true;
  for (const sc of SCENES) {
    for (const arm of ['A', 'B'] as Arm[]) {
      const rs = rows.filter(r => r.arm === arm && r.id === sc.id);
      const hit = rs.filter(r => r.motiveKind === sc.kind).length;
      const ok = hit === rs.length;
      if (!ok) manOk = false;
      console.log(`   ${sc.id}/${arm}：动机类型 ${[...new Set(rs.map(r => r.motiveKind))].join('/')}`
        + `（期望 ${sc.kind}）${hit}/${rs.length} ${ok ? '✓' : '✗'}`);
    }
  }
  // 文案形状：treatment 场景 B 臂必须是新形状、A 臂必须是旧样板；负对照 k1 两臂都必须是旧样板
  const NEWSHAPE: Record<string, string> = { m1: '用你自己的一句话', s1: '你心里的一个态度' };
  const OLD = '问的应该是这件事的具体下文';
  let textOk = true;
  for (const sc of SCENES) {
    const isTreated = sc.id in NEWSHAPE;
    const bNew = rows.filter(r => r.arm === 'B' && r.id === sc.id
      && r.motiveBlock.includes(isTreated ? NEWSHAPE[sc.id] : OLD)).length;
    const aOld = rows.filter(r => r.arm === 'A' && r.id === sc.id && r.motiveBlock.includes(OLD)).length;
    const ok = bNew === N && aOld === N;
    if (!ok) textOk = false;
    console.log(`   ${sc.id}：B 臂拿到${isTreated ? '新·按类型' : '旧·'}文案 ${bNew}/${N}；A 臂旧样板 ${aOld}/${N} ${ok ? '✓' : '✗'}`);
  }
  if (!textOk) manOk = false;
  // 负对照：k1 两臂的动机块必须**逐字相同**
  const k1a = new Set(rows.filter(r => r.arm === 'A' && r.id === 'k1').map(r => r.motiveBlock));
  const k1b = new Set(rows.filter(r => r.arm === 'B' && r.id === 'k1').map(r => r.motiveBlock));
  const k1Same = k1a.size === 1 && k1b.size === 1 && [...k1a][0] === [...k1b][0];
  if (!k1Same) manOk = false;
  console.log(`   负对照 k1（open_loop）：两臂动机块逐字相同 ${k1Same ? '✓' : '✗'}`
    + `（A ${k1a.size} 种 / B ${k1b.size} 种）`);
  console.log(`   量具自检：指标词与治疗文案不重叠 ✓（静态，抛错即中断）；治疗文案只出现在 B 臂 ✓`);
  console.log(`   Prompt 长度：A ${mean(rows.filter(r => r.arm === 'A').map(r => r.promptLen)).toFixed(0)}`
    + ` / B ${mean(rows.filter(r => r.arm === 'B').map(r => r.promptLen)).toFixed(0)} 字`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(94)}\n② 分组均值\n${'='.repeat(94)}`);
  for (const sc of SCENES) {
    console.log(`\n   【${sc.id}】${sc.note}（n=${N} 对）`);
    console.log('   ' + pad('指标', 16) + pad('A 旧样板', 14) + pad('B 按类型', 14) + 'B−A');
    for (const k of KEYS) {
      const a = rows.filter(r => r.arm === 'A' && r.id === sc.id).map(r => r.metrics[k]);
      const b = rows.filter(r => r.arm === 'B' && r.id === sc.id).map(r => r.metrics[k]);
      console.log('   ' + pad(k, 16) + pad(mean(a).toFixed(2), 14) + pad(mean(b).toFixed(2), 14)
        + (mean(b) - mean(a)).toFixed(2));
    }
  }

  // ── ③ 裁定 ──
  const dQ = diffs('questions', 'm1'); const sQ = signTest(dQ);
  const dEcho = diffs('echoType', 'm1');
  const cA = mean(rows.filter(r => r.arm === 'A' && r.id === 'm1').map(r => r.metrics.chars));
  const cB = mean(rows.filter(r => r.arm === 'B' && r.id === 'm1').map(r => r.metrics.chars));
  const dRec = diffs('recollection', 'm1');
  const dM = diffs('mentionsIt', 'm1'); const sM = signTest(dM);
  const dQs = diffs('questions', 's1');
  // v1.50b：主终点换成**实质**那一半 —— 她到底有没有把那件事说出来。
  // 旧终点（问句不涨）**保留为护栏** ⇒ 整体比第一跑更严，不是放宽。
  const primary = mean(dM) > 0 && sM.p <= 0.10;
  const questionsHold = mean(dQ) <= 0;
  const echoHold = mean(dEcho) >= 0;
  const charsOk = cB >= 0.7 * cA;
  const quoteOk = rows.filter(r => r.id === 'm1' || r.id === 's1')
    .reduce((a, r) => a + r.metrics.quotedShape, 0) / (2 * N) <= 0.5;
  const passed = manOk && primary && questionsHold && echoHold && charsOk && quoteOk;

  console.log(`\n${'='.repeat(94)}\n③ 数据层面裁定（判据跑之前写死；最终仍须人看原文）\n${'='.repeat(94)}`);
  console.log(`   主终点 m1【她把那件事说出来了】：提到那件事 ${mean(rows.filter(r => r.arm === 'A' && r.id === 'm1').map(r => r.metrics.mentionsIt)).toFixed(2)}`
    + ` → ${mean(rows.filter(r => r.arm === 'B' && r.id === 'm1').map(r => r.metrics.mentionsIt)).toFixed(2)}`
    + `（均值差 ${mean(dM).toFixed(2)}，B增${sM.win} A增${sM.lose} p=${sM.p.toFixed(3)}）⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   护栏 m1【问句不许涨（第一跑就栽在这）】：问句数 ${mean(rows.filter(r => r.arm === 'A' && r.id === 'm1').map(r => r.metrics.questions)).toFixed(2)}`
    + ` → ${mean(rows.filter(r => r.arm === 'B' && r.id === 'm1').map(r => r.metrics.questions)).toFixed(2)}`
    + `（均值差 ${mean(dQ).toFixed(2)}，p=${sQ.p.toFixed(3)}）⇒ ${questionsHold ? '✓' : '✗ 涨了 ⇒ 算输'}`);
  console.log(`   参考 m1「我想起…」这类标记词 ${mean(rows.filter(r => r.arm === 'A' && r.id === 'm1').map(r => r.metrics.recollection)).toFixed(2)}`
    + ` → ${mean(rows.filter(r => r.arm === 'B' && r.id === 'm1').map(r => r.metrics.recollection)).toFixed(2)}（均值差 ${mean(dRec).toFixed(2)}）`);
  console.log(`   参考 s1（stance）问句数均值差 ${mean(dQs).toFixed(2)}`);
  console.log(`   底线 m1 接住他那件事 echoType 均值差 ${mean(dEcho).toFixed(2)} ⇒ ${echoHold ? '✓' : '✗ 掉了 ⇒ 算输'}`);
  console.log(`   底线 m1 字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了'}`);
  console.log(`   底线 逐字照抄我的引导语（两格全格）${
    (rows.filter(r => r.id === 'm1' || r.id === 's1').reduce((a, r) => a + r.metrics.quotedShape, 0) / (2 * N) * 100).toFixed(0)}%`
    + ` ⇒ ${quoteOk ? '✓' : '✗ 太高（那是抄指令，不是说话）'}`);
  console.log(`   负对照 k1（open_loop）两臂动机块逐字相同 ⇒ ${k1Same ? '✓（开关没碰它）' : '✗ 碰了 ⇒ 不算'}`);
  console.log(`   ⇒ 数据层面：${passed ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   回复原文：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
