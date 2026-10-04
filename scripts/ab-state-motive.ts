// ── v1.49 A/B：让"她自己的状态"这条动机**能入选**，她的话会不会跟着走？ ──
//
// 为什么这是 v1.48 结案后最该试的一刀：v1.47/v1.48 三次实验合起来说明
// **描述性状态文本不操纵她的话**，真正操纵她的是**末尾的动机块**（她是"想说他的事"还是"想说自己的事"）。
// 而 `motive.ts` 里那条 `state`（"她今天的状态本身就是想说的事"）此前**两道坎都过不去**
// （零 LLM 预演 `scripts/play-state-motive.ts` 实测）：
//   ① 形成门槛 |mood.valence| ≥ 0.25 —— 而该值的可达带深端只有 ≈0.27（常见低落 0.09~0.13）
//      ⇒ **事实上从不形成**；
//   ② 就算形成，紧迫度是**常数 0.40**（`motiveRelevance` 下界是 1，只加分不减分）
//      ⇒ 裸分 0.38，输给池里每一条（open_loop 0.76 / worry 0.57 / wish 0.44 / memory_echo 0.42 / curiosity 0.39），只赢 stance 0.37。
//
// 变量只有一个：`ENABLE_STATE_MOTIVE`（关 = 旧行为：门槛 0.25 + 常数 0.40；开 = 门槛 0.10 + 按深度连续 0.44→0.72）。
//
// ── 事先声明的判据（跑之前写死）──
//   **主终点**（场景 t1：她心情 −0.22 + 他讲**没有悬念**的平常事，n=8 对）：
//     `selfState`（她把自己的状态说出来）出现率 B > A **且** `echo`（落在他那句话上）B < A，
//     两个方向各自配对符号检验 p ≤ 0.10 ⇒ 达标。
//     ⚠️ `selfState` 词表与动机模板（"状态有点低／心里有点闷／强撑着说话"）**逐字不重叠**，
//        且跑前用断言钉住它不出现在两臂的 Prompt 里（量具不能来自被量的东西 —— v1.38 的教训）。
//   **设计边界**（场景 t2：同一份心情 + 他说的**有悬念**："面试结果还没出来"）：
//     两臂的动机**都必须是 open_loop**（他那件没落定的事永远优先），且 `echo`/字数不差 ⇒ 边界成立。
//   **对照**（场景 c1：她心情只有 −0.05 + 同一句平常事）：两臂都不该形成 state 动机。
//   不退化底线：`chars` B ≥ 70%×A（在 t1 上）；逐字照抄动机模板的比例 ≤ 50%（报告 + 上限，v1.38 的教训）。
//   操纵检查：**动机块逐字对得上**——A/t1 应是 worry 那句、B/t1 应是 state 那句、
//             t2 两臂都是 open_loop 那句、c1 两臂都不是 state 那句。
//
// ── 第二跑（v1.49b）：把那段"为他的事写的样板"换成**着色**文案 ──
//   第一跑证明：机制成了（B 8/8 选中 state）、行为没动（echo 1.00→1.00、主终点 13%→0%），
//   因为 state 拿到的是「问的应该是**这件事**的具体下文」—— 对"我今天心里有点闷"不成话。
//   第二跑只多一件：state 入选时换成着色文案（"照样接住他说的那件事"＋"你的状态只是底色，半句就够"）。
//   主终点也换成**两轴同时**：接住他那件事（echo）**且**她自己的状态在场（selfState）——
//   就是第一跑基线臂里出现过 1/8 的那个理想形态。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-state-motive.ts [--keep]

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
/** t1 的次数（操纵检查里按它对数量） */
const N_T1 = (() => { const hit = process.argv.find(a => a.startsWith('--t1=')); return hit ? Math.max(8, Number(hit.split('=')[1])) : 8; })();
const B = RESTING_EMOTION_BASELINE;
const MOOD_LOW = -0.22;      // 可达带内的深端（预演：base 0.63 → 折后 0.60 > worry 0.57）
const MOOD_FLAT = -0.05;     // 低于新门槛 0.10 ⇒ 两臂都不形成

/** 动机模板里的原句（用来做"照抄"统计与量具污染的互斥检查） */
const TEMPLATE_LOW = '我今天状态有点低，不太想强撑着说话';
const TEMPLATE_MILD = '我今天心里有点闷，说不太清楚';
const WORRY = '他是不是又熬夜了，我有点担心';
const OPEN_LOOP = '他面试那事有消息了吗';

const SCENES: Array<{ id: string; mood: number; text: string; expect: 'state' | 'open_loop' | 'none'; n: number; note: string; preSpecificized?: boolean }> = [
  {
    id: 't1', mood: MOOD_LOW, n: N_T1, expect: 'state',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '她心情 −0.22 ｜ 他讲**没有悬念**的平常事',
  },
  {
    id: 't2', mood: MOOD_LOW, n: 4, expect: 'open_loop',
    text: '面试结果还没出来，说要等下周才有消息。',
    note: '同一份心情 ｜ 他说的**有悬念**（设计边界：他那件事永远优先）',
  },
  {
    // v1.49c：**定向场景** —— 池里已经躺着一条"具体化"产出的 state 候选。
    // 我的 harness 每格都重新播种状态，所以异步的具体化（写 pendingCandidates、下一轮合并）
    // **根本跑不到**；这一格直接把它的产物种进去，验的是**管道**：她该用那句具体的，
    // 而不是规则层的模板句（两者同时在池里就会一会儿一个说法）。
    id: 't3', mood: MOOD_LOW, n: 8, expect: 'state',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '她心情 −0.22 ｜ 池里已有一条**具体化**的 state 候选（跑的是管道，不是模板）',
    preSpecificized: true,
  },
  {
    id: 'c1', mood: MOOD_FLAT, n: 4, expect: 'none',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
    note: '她心情只有 −0.05（对照：两臂都不该形成 state）',
  },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const MEM = 'memories';
const BAK = 'memories.ab-sm-bak';
const DUMP = '.tmp-ab-sm-prompt.txt';
const ROWS = 'state-motive-rows-run5.jsonl';

type Arm = 'A' | 'B';
// v1.49 **已上线（默认开）** ⇒ 臂的约定随之翻转：
//   A = `DISABLE_STATE_MOTIVE=true`（回退到 v1.48 之前的行为）
//   B = 不设（= 现在的默认）
// 第一~四跑用的是 `ENABLE_STATE_MOTIVE`（当时默认关），行文件分别是 -run1..-run4。
const applyArm = (arm: Arm) => {
  if (arm === 'A') process.env.DISABLE_STATE_MOTIVE = 'true';
  else delete process.env.DISABLE_STATE_MOTIVE;
};

const RE = {
  /** 主终点：她把自己的状态说出来 —— **与两段模板逐字不重叠**（见文件头） */
  selfState: /提不起|没劲|没力气|不想动|乏|倦|心里空|发沉|撑不住|没什么心情|闷得慌|闷闷的|打不起精神|不太想说话|心不在焉|有点蔫/g,
  presence: /我就?在|陪着你|我陪|不走|不用一个人|在这儿|在呢/g,
  toHim: /你|他/g,
  questions: /[？?]/g,
};
/** 跑前断言用：这些词**不许**出现在 Prompt 里（否则量的是我自己的字） */
const METER_WORDS = ['提不起', '没劲', '没力气', '不想动', '心里空', '发沉', '撑不住', '没什么心情', '闷得慌', '闷闷的', '打不起精神', '不太想说话', '心不在焉', '有点蔫'];
const STOP = new Set(['我', '你', '的', '了', '是', '在', '和', '有', '就', '都', '也', '很', '要', '会',
  '去', '个', '这', '那', '一', '下', '吗', '呢', '吧', '啊', '嗯', '过', '把', '被', '给', '对', '到',
  '说', '想', '还', '没', '不', '他', '她', '它', '们', '之', '与', '着', '得', '地', '上', '里', '中']);

function longestEcho(reply: string, hisText: string): number {
  const content = (s: string) => [...s].filter(c => /[\u4e00-\u9fffA-Za-z0-9]/.test(c));
  const A = content(reply), Hs = content(hisText).join('');
  let best = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = i + 2; j <= A.length; j++) {
      const sub = A.slice(i, j);
      if (sub.every(c => STOP.has(c))) continue;
      if (Hs.includes(sub.join(''))) best = Math.max(best, sub.length);
    }
  }
  return best;
}

function score(reply: string, hisText: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  const quoted = [TEMPLATE_LOW, TEMPLATE_MILD].some(t => reply.includes(t.slice(0, 8)));
  const echoHit = longestEcho(reply, hisText) >= 2 ? 1 : 0;
  const selfHit = count(RE.selfState) > 0 ? 1 : 0;
  /**
   * v1.49b 加宽口径：第二跑她的说法是「**我这边今天有点闷**，说不上来，可能天气的事」——
   * 而窄词表里只有"闷得慌/闷闷的" ⇒ 漏了。
   * ⚠️ 诚实说明：`有点闷` **也出现在治疗臂的动机内容里**（"我今天心里有点闷"），所以这个口径
   *    天然带一点"词汇携带"的成分。为了把它和"照抄"分开，另设 `copiedContent`：
   *    她的回复里若出现动机内容的前 8 个字，就算照抄、不计入（实测那 3 条都不是照抄）。
   */
  const wide = /我(?:这|那)?(?:边|里|今天)?[^。！？]{0,8}(?:有点闷|闷|提不起|没劲|没力气|不想动|乏|倦|心里空|发沉|撑不住|没什么心情|有点累|不太想说话|心不在焉|有点蔫)/.test(reply) ? 1 : 0;
  const copied = reply.includes(TEMPLATE_LOW.slice(0, 8)) || reply.includes(TEMPLATE_MILD.slice(0, 8)) ? 1 : 0;
  const selfWide = wide && !copied ? 1 : 0;
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    selfState: count(RE.selfState),
    /** 加宽后的自述状态（去掉照抄） */
    selfWide,
    /** v1.49b 主终点：**两轴同时**成立 —— 接住他那件事（echo）＋ 她自己的状态在场（加宽口径、非照抄） */
    both: echoHit && selfWide ? 1 : 0,
    presence: count(RE.presence),
    toHim: count(RE.toHim),
    echo: echoHit,
    quotedTemplate: quoted ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['both', 'selfState', 'selfWide', 'echo', 'chars', 'toHim', 'questions', 'presence', 'quotedTemplate'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
const C = (a: number, b: number) => fact(a) / (fact(b) * fact(a - b));
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length, lose = diffs.filter(d => d < 0).length;
  const n = win + lose;
  if (!n) return { win, lose, p: 1 };
  let tail = 0;
  for (let k = Math.max(win, lose); k <= n; k++) tail += C(n, k);
  return { win, lose, p: Math.min(1, 2 * tail / 2 ** n) };
}
const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

/** 从 Prompt 里取动机块（v1.49b：`state` 那一块换了表头，必须两个都认） */
function motiveBlockOf(prompt: string): string {
  // ⚠️ 第二跑栽过：`state` 入选时表头换成了【我此刻的状态】，只找旧表头 ⇒ 返回空 ⇒ 记成 none，
  //    于是造出"机制没生效"的假象。表头是**我这次自己换的**，解析器必须同步（两个都认）。
  const heads = ['【我此刻的状态】', '【此刻我心里挂着的事】'];
  let i = -1;
  for (const h of heads) {
    const k = prompt.indexOf(h);
    if (k >= 0 && (i < 0 || k < i)) i = k;
  }
  if (i < 0) return '';
  const j = prompt.indexOf('\n【', i + 1);
  return prompt.slice(i, j < 0 ? undefined : j).trimEnd();
}
const motiveKindOf = (block: string): 'state' | 'open_loop' | 'worry' | 'other' | 'none' => {
  if (!block) return 'none';
  // ⚠️ 认**表头**，不要认内容词 —— 内容词匹配这套已经咬了我三次：
  //    v1.49c 里 `state` 的内容来自具体化（"我今天状态不太好…"），不再含"心里有点闷"这类模板词，
  //    于是 t3 的 8/8 全被记成 other，看起来像"管道没生效"。表头是我自己定的，最稳。
  if (block.startsWith('【我此刻的状态】')) return 'state';
  if (block.includes('面试') || block.includes('还没')) return 'open_loop';
  if (block.includes('熬夜') || block.includes('担心')) return 'worry';
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

{
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑 —— 先停掉它。'); process.exit(3); }
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
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  /** 她：静息情绪 ＋ 种一个**底色心情**（`internal.mood`）＋ 一个真实形状的动机池 */
  /** v1.49c：第 2 层具体化会产出这一类句子（更具体、不是模板） */
  // ⚠️ 这句**不能**含主终点词表里的任何一个词（否则量的是我种下去的字）—— 第一次就被那条自检拦住了
  const SPECIFICIZED_STATE = '我今天状态不太好，说不上来为什么，就想安静待着';
  const makeState = (mood: number, preSpecificized = false) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: mood, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        ...(preSpecificized
          ? { pendingCandidates: [{ kind: 'state', content: SPECIFICIZED_STATE, base: 0.63, formedAt: now }] }
          : {}),
        pool: [
          { id: 'w1', kind: 'worry', content: WORRY, source: {}, salience: 0.7, formedAt: now - 24 * 3600_000, expiresAt: now + 6 * 86_400_000, attempts: 0 },
          { id: 'c1', kind: 'curiosity', content: '他好像提过一家没去过的店', source: {}, salience: 0.52, formedAt: now - 72 * 3600_000, expiresAt: now + 12 * 86_400_000, attempts: 0 },
          { id: 'w2', kind: 'wish', content: '想和他多待一会儿', source: {}, salience: 0.58, formedAt: now - 24 * 3600_000, expiresAt: now + 4 * 86_400_000, attempts: 0 },
          { id: 'm1', kind: 'memory_echo', content: '我想起他上次说想去看海', source: {}, salience: 0.62, formedAt: now - 48 * 3600_000, expiresAt: now + 5 * 86_400_000, attempts: 0 },
        ],
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

  async function callOnce(arm: Arm, sc: typeof SCENES[number], pair: number): Promise<Row> {
    applyArm(arm);
    // ⚠️ 只在**开着开关的那一臂**种具体化候选：否则等于绕过开关，A 臂也会用上 state 动机
    const st = makeState(sc.mood, sc.preSpecificized === true && arm === 'B');
    srv.aiEngine.emotionState = structuredClone(st) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: sc.text, userId: 'ab-sm', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    // 量具污染自检：主终点的词表不许出现在 Prompt 里（出现即抛错，不产生漂亮假数据）
    for (const w of METER_WORDS) {
      if (prompt.includes(w)) {
        throw new Error(`量具污染：主终点词「${w}」出现在 ${arm} 臂的 Prompt 里 —— 那量的是我自己的字`);
      }
    }
    const block = motiveBlockOf(prompt);
    const kind = motiveKindOf(block);
    const m = score(data.response, sc.text);
    const row: Row = { arm, id: sc.id, pair, metrics: m, reply: data.response, motiveBlock: block, motiveKind: kind, promptLen: prompt.length };
    console.log(`   [${arm}] ${pad(sc.id, 3)} p${pair} 动机=${pad(kind, 10)}${String(m.chars).padStart(3)}字`
      + ` 自述${m.selfState} echo${m.echo} 指向他${m.toHim} 抄模板${m.quotedTemplate}`);
    return row;
  }

  console.log(`[跑法] ${SCENES.map(s => `${s.id}×${s.n}`).join(' + ')} × 2 臂 = ${SCENES.reduce((a, s) => a + s.n, 0) * 2} 格\n`);
  for (const sc of SCENES) {
    for (let pair = 1; pair <= sc.n; pair++) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        rows.push(await callOnce(arm, sc, pair));
      }
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const pairsOf = (k: keyof Metrics, id: string) => {
    const sc = SCENES.find(s => s.id === id)!;
    return Array.from({ length: sc.n }, (_, i) => {
      const a = rows.find(r => r.arm === 'A' && r.id === id && r.pair === i + 1);
      const b = rows.find(r => r.arm === 'B' && r.id === id && r.pair === i + 1);
      return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
    }).filter((x): x is [number, number] => x !== null);
  };
  const diffs = (k: keyof Metrics, id: string) => pairsOf(k, id).map(([a, b]) => b - a);
  const rate = (k: keyof Metrics, id: string, arm: Arm) => {
    const rs = rows.filter(r => r.arm === arm && r.id === id);
    return rs.length ? rs.filter(r => r.metrics[k] > 0).length / rs.length : 0;
  };

  // ── ① 操纵检查：动机块逐字对得上 ──
  console.log(`\n${'='.repeat(94)}\n① 操纵检查（动机块是这一刀唯一的杠杆，必须逐字对得上）\n${'='.repeat(94)}`);
  let manOk = true;
  const want: Record<string, Record<Arm, string>> = {
    // ⚠️ A 臂的赢家**不是**我种下的 worry(0.574)：服务端的"主动回忆闸门"会另加一条**新鲜**的
    //    memory_echo（0.62）把它压过 ⇒ 实测 A 臂 = memory_echo。第一跑我把期望写成 worry，
    //    于是报"没过"——**错的是期望，不是代码**。这里只断言"是不是 state"，其余种类照实打印。
    t1: { A: 'not_state', B: 'state' },
    t2: { A: 'open_loop', B: 'open_loop' },
    t3: { A: 'not_state', B: 'state' },   // 候选只种在 B 臂
    c1: { A: 'not_state', B: 'not_state' },
  };
  for (const sc of SCENES) {
    for (const arm of ['A', 'B'] as Arm[]) {
      const rs = rows.filter(r => r.arm === arm && r.id === sc.id);
      const expect = want[sc.id][arm];
      const hit = rs.filter(r => (expect === 'not_state'
        ? r.motiveKind !== 'state' : r.motiveKind === expect)).length;
      const ok = hit === rs.length;
      if (!ok) manOk = false;
      console.log(`   ${sc.id}/${arm}：动机类型 ${[...new Set(rs.map(r => r.motiveKind))].join('/')}`
        + `（期望 ${expect}）${hit}/${rs.length} ${ok ? '✓' : '✗'}`);
    }
  }
  const s1a = rows.find(r => r.arm === 'A' && r.id === 't1')!.motiveBlock;
  const s1b = rows.find(r => r.arm === 'B' && r.id === 't1')!.motiveBlock;
  console.log(`\n   A/t1 的动机块：${s1a.slice(0, 110).replace(/\n/g, ' ⏎ ')}`);
  console.log(`   B/t1 的动机块：${s1b.slice(0, 110).replace(/\n/g, ' ⏎ ')}`);
  // v1.49b：文案也要对上（旧样板那句对"我自己的心情"不成话 ⇒ 第一跑行为没动的原因）
  const bNew = rows.filter(r => r.arm === 'B' && r.id === 't1'
    && r.motiveBlock.includes('【我此刻的状态】')
    && !r.motiveBlock.includes('问的应该是这件事的具体下文')).length;
  const aOld = rows.filter(r => r.arm === 'A' && r.id === 't1'
    && r.motiveBlock.includes('问的应该是这件事的具体下文')
    && !r.motiveBlock.includes('【我此刻的状态】')).length;
  const textOk = bNew === N_T1 && aOld === N_T1;
  if (!textOk) manOk = false;
  console.log(`   B/t1 拿到新·着色文案：${bNew}/${N_T1}（应全部）；A/t1 仍是旧样板：${aOld}/${N_T1}`
    + `${textOk ? ' ✓' : ' ✗'}`);
  console.log(`   量具自检：主终点词表（${METER_WORDS.length} 个）在两臂 Prompt 里都不出现 ✓（出现即抛错中断）`);
  console.log(`   Prompt 长度：A ${mean(rows.filter(r => r.arm === 'A').map(r => r.promptLen)).toFixed(0)}`
    + ` / B ${mean(rows.filter(r => r.arm === 'B').map(r => r.promptLen)).toFixed(0)} 字`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(94)}\n② 分组均值\n${'='.repeat(94)}`);
  for (const sc of SCENES) {
    console.log(`\n   【${sc.id}】${sc.note}（n=${sc.n} 对）`);
    console.log('   ' + pad('指标', 16) + pad('A 基线', 14) + pad('B 能入选', 14) + 'B−A');
    for (const k of KEYS) {
      const a = rows.filter(r => r.arm === 'A' && r.id === sc.id).map(r => r.metrics[k]);
      const b = rows.filter(r => r.arm === 'B' && r.id === sc.id).map(r => r.metrics[k]);
      console.log('   ' + pad(k, 16) + pad(`${mean(a).toFixed(2)}`, 14) + pad(`${mean(b).toFixed(2)}`, 14)
        + (mean(b) - mean(a)).toFixed(2));
    }
  }

  // ── ③ 逐对检验 ──
  console.log(`\n${'='.repeat(94)}\n③ 配对符号检验\n${'='.repeat(94)}`);
  for (const sc of SCENES) {
    console.log(`   【${sc.id}】`);
    for (const k of ['selfState', 'echo', 'chars', 'toHim', 'quotedTemplate'] as Array<keyof Metrics>) {
      const d = diffs(k, sc.id); const s = signTest(d);
      console.log(`      ${pad(k, 16)}B胜${String(s.win).padStart(2)} A胜${String(s.lose).padStart(2)} p=${s.p.toFixed(3)}`
        + ` 均值差 ${mean(d)}`);
    }
  }

  // ── ④ 裁定 ──
  const dBoth = diffs('both', 't1'); const sBoth = signTest(dBoth);
  const dSelf = diffs('selfState', 't1'); const sSelf = signTest(dSelf);
  const dEcho = diffs('echo', 't1');
  const primary = mean(dBoth) > 0 && sBoth.p <= 0.10;      // v1.49b 主终点：两轴同时
  const echoHold = mean(dEcho) >= 0;
  const cA = mean(rows.filter(r => r.arm === 'A' && r.id === 't1').map(r => r.metrics.chars));
  const cB = mean(rows.filter(r => r.arm === 'B' && r.id === 't1').map(r => r.metrics.chars));
  const charsOk = cB >= 0.7 * cA;
  const quoteRate = rows.filter(r => r.id === 't1').reduce((a, r) => a + r.metrics.quotedTemplate, 0)
    / (rows.filter(r => r.id === 't1').length || 1);
  const quoteOk = quoteRate <= 0.5;
  const t2Echo = mean(diffs('echo', 't2'));
  const t3B = rows.filter(r => r.id === 't3' && r.arm === 'B');
  const t3Both = t3B.filter(r => r.metrics.both).length / (t3B.length || 1);
  const toHimHold = mean(diffs('toHim', 't1')) >= -0.5;
  const passed = manOk && primary && charsOk && quoteOk && echoHold && toHimHold;

  console.log(`\n${'='.repeat(94)}\n④ 数据层面裁定（判据跑之前写死；最终仍须人看原文）\n${'='.repeat(94)}`);
  console.log(`   主终点【两轴同时】接住他那件事 + 她自己在场（t1 both）：出现率 `
    + `${(rate('both', 't1', 'A') * 100).toFixed(0)}% → ${(rate('both', 't1', 'B') * 100).toFixed(0)}%`
    + `，均值差 ${mean(dBoth).toFixed(2)}（B胜${sBoth.win} A胜${sBoth.lose} p=${sBoth.p.toFixed(3)}）`
    + `⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   分解 自述状态：${(rate('selfState', 't1', 'A') * 100).toFixed(0)}% → `
    + `${(rate('selfState', 't1', 'B') * 100).toFixed(0)}%（B胜${sSelf.win} A胜${sSelf.lose} p=${sSelf.p.toFixed(3)}）`
    + `；接住 echo 均值差 ${mean(dEcho).toFixed(2)} ⇒ ${echoHold ? '✓ 没掉' : '✗ 掉了 ⇒ 算输'}`);
  console.log(`   底线 字数（t1）${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了'}`);
  console.log(`   底线 仍在跟他说话 toHim 均值差 ${mean(diffs('toHim', 't1')).toFixed(2)} ⇒ ${toHimHold ? '✓' : '✗'}`);
  console.log(`   底线 逐字照抄动机模板（t1 全格）${(quoteRate * 100).toFixed(0)}% ⇒ ${quoteOk ? '✓' : '✗ 太高'}`);
  console.log(`   边界（t2 他有悬念）echo 均值差 ${t2Echo.toFixed(2)}（两臂都该是 open_loop，见①）`);
  console.log(`   t3【定向·具体化】两轴同时出现率 ${(t3Both * 100).toFixed(0)}%（这一格两臂都走具体化那句，看的是管道）`);
  console.log(`   ⇒ 数据层面：${passed ? '**达标**（仍须人看原文）' : '**未达标**'}；v1.49 已上线（DISABLE_STATE_MOTIVE=true 回退）`);
  console.log(`   回复原文：${ROWS}`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
