// ── v1.48 A/B：她的状态块改读激发态之后，她的话跟不跟得上她自己的状态？ ──
//
// 病灶（v1.47 探针实测）：她的状态进 Prompt 的**唯一**通路是前端把 `buildEmotionContext()`
// 拼进 `persona.systemPrompt`，而它一直按**绝对值**读 ⇒ 每一轮都对她说
// 「当前情绪: calm(0.80), love(0.40)…／主导情绪: calm。回答时自然地流露出这种情绪。」
// 探针那一轮她的激活态其实是「难过（+0.06）」。
//
// 变量只有一个：那两行（底色 + 此刻的偏离）。两臂**都用带 persona 的写法**（对齐生产条件）。
//   A = 关（`ENABLE_ACTIVATION_STATE` 未设）：`当前情绪: calm(0.80)…` + `主导情绪: calm。流露出这种情绪。`
//   B = 开：`底色: 平静 0.80…。此刻被激起: 难过 +0.18（相对你自己的底色）。` + `此刻状态: 难过（+0.18 …）。`
//
// ── 事先声明的判据（跑之前写死）──
//   主终点 `lowTone`（低位腔：低落/沉/提不起/没劲/闷/堵/累/烦…）
//     用在**她明显偏低**的 4 个场景上（n=4 场景 × 4 次 = 16 对）：
//     出现率 B > A 且配对符号检验 p ≤ 0.10 ⇒ 达标。
//     ⚠️ 这张词表**两臂的 Prompt 里都没有**（实测断言在下面打印），所以它量的是
//        "她的话有没有跟着状态走"，不是"她抄没抄我写的那句话"（v1.38 的教训）。
//   同组第二判据 `warmth`（基线腔：安宁/温暖/踏实/安心/撒娇/黏/甜甜/放松）
//     **不许上升**（B ≤ A）—— 方向相反的两个量一起看，才排除"只是多说了几个情绪词"。
//   不退化底线（任一破就算输）：
//     · 静息对照 r1/r2：`warmth` 与 `echo`（落在他那句话上）都不许下降
//     · 全局 `chars` B ≥ 70% × A
//     · `selfAnnounce`（把自己的情绪宣布出来）不许上升
//   方向性对照（只报告，不作判据）：`u1` 她开心 + 他讲平常事 ⇒ `upTone`（轻快/高兴…）B > A？
//   操纵 A 臂 Prompt 必须**没有** `此刻被激起/此刻状态`，B 臂必须**有**；
//        且逐对**服务端策略块逐字节相同**（她的状态没变，只有那一块文字变了）
//   人工 全文过目（这条臂本来就是"语气"层面的改动，数字只能指方向）
//
// ── 第二跑（v1.48b）：位置 ──
//   第一跑（行文件 `activation-state-rows-run1.jsonl`）只改了**开头**那段（前端 persona 里的状态块）：
//   主终点 低位腔 **19% → 19%（1:1, p=1.000）**、基线腔反而 +0.06、两臂回复常常逐字相同 ⇒ 未达标。
//   病因不是"读法"，是**位置**：那一块在全文 ~2700 字里只占 ~150 字且排在开头，
//   而真正操纵她的是**末尾**的【此刻我心里挂着的事】与策略片段（v1.29 量过的"叠加稀释"）。
//   第二跑只多了一件事：服务端在**策略片段之前**再给一条 `activationHint`（当前状态，静息时不注入）。
//   判据、场景、臂数、写法**全部与第一跑相同**，所以第二跑能直接与第一跑对照。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-activation-state.ts [--n=4] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode, buildEmotionContext } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const N = Math.max(2, arg('n', 4));
const KEEP = process.argv.includes('--keep');

const B = RESTING_EMOTION_BASELINE;
type Over = Record<string, number>;

/** 场景：她的状态（相对基线的偏离）+ 他说的话 + 期望方向 */
const SCENES: Array<{
  id: string; group: 'low' | 'rest' | 'up'; over: Over; text: string; note: string;
}> = [
  {
    id: 'd1', group: 'low', over: { sad: B.sad + 0.18 }, note: '难过 +0.18',
    text: '今天下午把阳台收拾了一下，累是累，看着还行。',
  },
  {
    id: 'd2', group: 'low', over: { sad: B.sad + 0.18 }, note: '难过 +0.18',
    text: '跟你说个好消息，项目过了，评审那边一次就通过了。',
  },
  {
    id: 'd3', group: 'low', over: { fear: B.fear + 0.15 }, note: '害怕 +0.15',
    text: '这周末我打算在家躺着，哪儿也不去。',
  },
  {
    id: 'd4', group: 'low', over: { sad: B.sad + 0.10, calm: B.calm - 0.15 }, note: '难过 +0.10 且平静被压低',
    text: '晚上随便煮了点面，吃完看了会儿球赛。',
  },
  { id: 'r1', group: 'rest', over: {}, note: '静息', text: '今天下午把阳台收拾了一下，累是累，看着还行。' },
  { id: 'r2', group: 'rest', over: {}, note: '静息', text: '工作上有点烦，被领导当众说了一顿，心里挺堵的。' },
  {
    id: 'u1', group: 'up', over: { joy: B.joy + 0.20 }, note: '开心 +0.20',
    text: '晚上随便煮了点面，吃完看了会儿球赛。',
  },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const MEM = 'memories';
const BAK = 'memories.ab-as2-bak';
const DUMP = '.tmp-ab-as2-prompt.txt';
const ROWS = 'activation-state-rows-run2.jsonl';
const MARKER_B = '此刻被激起';
const MARKER_REST = '此刻状态: 静息';
const MARKER_A = '主导情绪:';

type Arm = 'A' | 'B';
const applyArm = (arm: Arm) => {
  if (arm === 'B') process.env.ENABLE_ACTIVATION_STATE = 'true';
  else delete process.env.ENABLE_ACTIVATION_STATE;
};

/**
 * ⚠️ 量具不能来自被量的东西：`lowTone` 的每个词都**不许**出现在任一臂的 Prompt 里。
 * 这条在跑之前用断言钉住（出现在任一侧就抛错中断，不产生一份看着漂亮的假数据）。
 */
const RE = {
  lowTone: /低落|低沉|沉沉的|提不起|没劲|没力气|闷|堵|累|烦|心里不好受|打不起精神|蔫/g,
  warmth: /安宁|温暖|踏实|安心|撒娇|黏|甜甜|放松/g,
  upTone: /轻快|高兴|雀跃|兴奋|来劲|带劲|乐呵|美滋滋/g,
  selfAnnounce: /我(很|也|有点)?(难过|低落|害怕|烦|沉|累)|我心里(也|很)|我自己也/g,
  presence: /我就?在|陪着你|我陪|不走|不用一个人|在这儿|在呢/g,
  questions: /[？?]/g,
};
const LOW_WORDS = ['低落', '低沉', '提不起', '没劲', '闷', '堵', '累', '烦', '打不起精神', '蔫'];
const STOP = new Set(['我', '你', '的', '了', '是', '在', '和', '有', '就', '都', '也', '很', '要', '会',
  '去', '个', '这', '那', '一', '下', '吗', '呢', '吧', '啊', '嗯', '过', '把', '被', '给', '对', '到',
  '说', '想', '还', '没', '不', '他', '她', '它', '们', '之', '与', '着', '得', '地', '上', '里', '中']);

/** 回复里最长的一段"与他那句话逐字重合的内容词"（≥2 字、非纯虚词）—— 结构量 */
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
  return {
    chars: [...reply].length,
    questions: count(RE.questions),
    lowTone: count(RE.lowTone),
    warmth: count(RE.warmth),
    upTone: count(RE.upTone),
    selfAnnounce: count(RE.selfAnnounce),
    presence: count(RE.presence),
    echo: longestEcho(reply, hisText) >= 2 ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['lowTone', 'warmth', 'upTone', 'echo', 'selfAnnounce', 'presence', 'questions', 'chars'];
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
  arm: Arm; id: string; group: string; pair: number; note: string;
  metrics: Metrics; reply: string;
  personaLen: number; promptLen: number; strategyBlock: string; strategyName: string; baseMatches: boolean;
  stateLine: string; guidanceLine: string; hasLateHint: boolean;
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
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = (over: Over) => {
    const s = structuredClone(real) as typeof real & { emotions: Record<string, number> };
    s.emotions = { ...B, ...over };
    (s as Record<string, unknown>).baselineEmotions = { ...B };
    return s;
  };

  /** 生产浏览器就是这么送的：状态块由 `buildEmotionContext` 拼进 systemPrompt（这一步在设好臂之后做） */
  const personaFor = (st: Record<string, unknown>) => ({
    name: '小禾', dynamicEmotion: true, proactive: false,
    emotionState: structuredClone(st),
    systemPrompt: buildEmotionContext(structuredClone(st) as never as never),
  });

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
        console.error(`[中断] /api/chat 没有返回 response（第 ${i} 次，HTTP ${res.status}）：${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败 —— 不许静默缩小样本');
      }
      console.warn(`   ⏳ 触发限流，等 ${Math.round(wait / 1000)}s 后重发（第 ${i}/${tries} 次）`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  async function callOnce(arm: Arm, sc: typeof SCENES[number], pair: number): Promise<Row> {
    applyArm(arm);
    const st = makeState(sc.over);
    srv.aiEngine.emotionState = structuredClone(st) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = []; co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const persona = personaFor(st);
    const personaLen = (persona.systemPrompt as string).length;
    // 量具自检：低位腔的每个词都不许出现在这条臂的 Prompt 文本里
    for (const w of LOW_WORDS) {
      if ((persona.systemPrompt as string).includes(w)) {
        throw new Error(`量具污染：低位腔词「${w}」出现在 ${arm} 臂的 persona 里 —— 这会把"她跟着状态走"量成"她抄了我的话"`);
      }
    }

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({
      message: sc.text, userId: 'ab-as2', recentMessages: RECENT, persona,
    });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const block = strategyBlockOf(prompt);
    const name = strategyNameOf(block);
    const key = HEADER_TO_KEY[name] ?? null;
    const m = score(data.response, sc.text);
    const stateLine = (persona.systemPrompt as string).split('【当前状态】')[1]?.split('。')
      .slice(0, 2).join('。') ?? '';
    const guidanceLine = (persona.systemPrompt as string).split('\n').filter(l => l.startsWith('主导情绪') || l.startsWith('此刻状态'))[0] ?? '';
    const row: Row = {
      arm, id: sc.id, group: sc.group, pair, note: sc.note, metrics: m, reply: data.response,
      personaLen, promptLen: prompt.length, strategyBlock: block, strategyName: name,
      baseMatches: key !== null && block === STRATEGY_PROMPT_SNIPPETS[key as never],
      stateLine, guidanceLine,
      hasLateHint: prompt.includes('【我此刻的状态】'),
    };
    console.log(`   [${arm}] ${pad(sc.id, 3)} p${pair} ${pad(name || '?', 8)}${String(m.chars).padStart(3)}字`
      + ` 低位${m.lowTone} 基线腔${m.warmth} 上扬${m.upTone} echo${m.echo} 自述${m.selfAnnounce}`);
    return row;
  }

  console.log(`[跑法] ${SCENES.length} 场景 × 2 臂 × n=${N} = ${SCENES.length * 2 * N} 格\n`);
  for (let pair = 1; pair <= N; pair++) {
    for (const sc of SCENES) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        rows.push(await callOnce(arm, sc, pair));
      }
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const pick = (arm: Arm, id: string, pair?: number) =>
    rows.filter(r => r.arm === arm && r.id === id && (pair === undefined || r.pair === pair));
  const pairsOf = (k: keyof Metrics, group: string) => SCENES.filter(s => s.group === group).flatMap(sc =>
    Array.from({ length: N }, (_, i) => {
      const a = rows.find(r => r.arm === 'A' && r.id === sc.id && r.pair === i + 1);
      const b = rows.find(r => r.arm === 'B' && r.id === sc.id && r.pair === i + 1);
      return a && b ? [a.metrics[k], b.metrics[k]] as [number, number] : null;
    }).filter((x): x is [number, number] => x !== null));
  const diffs = (k: keyof Metrics, group: string) => pairsOf(k, group).map(([a, b]) => b - a);
  const rate = (k: keyof Metrics, group: string, arm: Arm) => {
    const rs = rows.filter(r => r.arm === arm && r.group === group);
    return rs.length ? rs.filter(r => r.metrics[k] > 0).length / rs.length : 0;
  };

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(90)}\n① 操纵检查\n${'='.repeat(90)}`);
  let manOk = true;
  for (const arm of ['A', 'B'] as Arm[]) {
    const rs = rows.filter(r => r.arm === arm);
    const hasB = rs.filter(r => r.stateLine.includes(MARKER_B) || r.guidanceLine.includes(MARKER_REST)
      || r.guidanceLine.includes('此刻状态')).length;
    const hasA = rs.filter(r => r.guidanceLine.includes(MARKER_A)).length;
    const want = arm === 'B' ? hasB === rs.length && hasA === 0 : hasA === rs.length && hasB === 0;
    if (!want) manOk = false;
    console.log(`   ${arm} 臂：含【旧读法·主导情绪】 ${hasA}/${rs.length}；含【新读法·此刻被激起/此刻状态】 ${hasB}/${rs.length}`
      + ` ${want ? '✓' : '✗'}`);
  }
  console.log(`   A 臂状态块（逐字）：${pick('A', 'd1')[0]?.stateLine}`);
  console.log(`                        ${pick('A', 'd1')[0]?.guidanceLine}`);
  console.log(`   B 臂状态块（逐字）：${pick('B', 'd1')[0]?.stateLine}`);
  console.log(`                        ${pick('B', 'd1')[0]?.guidanceLine}`);
  // 服务端策略块逐对相同 + 策略落在真片段上
  let sameBlock = 0, totalPairs = 0, baseOk = 0;
  for (const sc of SCENES) for (let i = 1; i <= N; i++) {
    const a = rows.find(r => r.arm === 'A' && r.id === sc.id && r.pair === i);
    const b = rows.find(r => r.arm === 'B' && r.id === sc.id && r.pair === i);
    if (!a || !b) continue;
    totalPairs++;
    if (a.strategyBlock === b.strategyBlock) sameBlock++;
    if (a.baseMatches && b.baseMatches) baseOk++;
  }
  // ⚠️ 这条**不可能**是 100%：同一条话的 LLM NLU 分类两次可能不同（实测第一跑 26/28 = 93%），
  //    而 NLU 是策略的输入之一 —— 这是**管线自带的噪声地板**，不是变量的影响（它的方向随机）。
  const stratOk = sameBlock >= totalPairs * 0.9 && baseOk === totalPairs;
  console.log(`   逐对策略块逐字节相同：${sameBlock}/${totalPairs}（≥90% 即算过；NLU 非确定性是噪声地板）`
    + `；策略块落在真片段上：${baseOk}/${totalPairs} ${stratOk ? '✓' : '✗'}`);
  if (!stratOk) manOk = false;
  const lenA = mean(rows.filter(r => r.arm === 'A').map(r => r.personaLen));
  const lenB = mean(rows.filter(r => r.arm === 'B').map(r => r.personaLen));
  console.log(`   persona 长度：A ${lenA.toFixed(0)} → B ${lenB.toFixed(0)} 字（差异只来自那两行）`);
  // 末尾那条提示：A 臂必须一条都没有；B 臂必须**只在有偏离的场景**出现（静息场景不注入）
  const nonRest = ['d1', 'd2', 'd3', 'd4', 'u1'];
  const aHint = rows.filter(r => r.arm === 'A' && r.hasLateHint).length;
  const bHintOn = rows.filter(r => r.arm === 'B' && r.hasLateHint).length;
  const bHintOff = rows.filter(r => r.arm === 'B' && r.group === 'rest' && r.hasLateHint).length;
  const hintOk = aHint === 0 && bHintOn === nonRest.length * N && bHintOff === 0;
  if (!hintOk) manOk = false;
  console.log(`   末尾【我此刻的状态】：A 臂 ${aHint} 条（应 0）｜B 臂有偏离的格子 ${bHintOn}/${nonRest.length * N}`
    + `｜B 臂静息格子 ${bHintOff} 条（应 0，静息不注入） ${hintOk ? '✓' : '✗'}`);
  const sampleHint = rows.find(r => r.arm === 'B' && r.hasLateHint)?.reply;
  const hintText = readFileSync(DUMP, 'utf8').split('【我此刻的状态】')[1];
  if (hintText) console.log(`   B 臂末尾提示（逐字）：【我此刻的状态】${hintText.split('\n')[0].slice(0, 90)}`);
  console.log(`   服务的整体 Prompt 长度：A ${mean(rows.filter(r => r.arm === 'A').map(r => r.promptLen)).toFixed(0)}`
    + ` → B ${mean(rows.filter(r => r.arm === 'B').map(r => r.promptLen)).toFixed(0)} 字`);
  console.log(`   量具自检：低位腔词表（${LOW_WORDS.length} 个）在两臂 persona 里都不出现 ✓（出现即抛错中断）`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的数字不能当结论用'}`);

  // ── ② 分组均值 ──
  console.log(`\n${'='.repeat(90)}\n② 分组均值\n${'='.repeat(90)}`);
  for (const g of ['low', 'rest', 'up'] as const) {
    const label = g === 'low' ? '她明显偏低（4 场景 × n=' + N + '，主终点在这组）'
      : g === 'rest' ? '静息对照（2 场景 × n=' + N + '，不许变冷）'
        : '她开心（1 场景 × n=' + N + '，方向性对照）';
    console.log(`\n   【${label}】`);
    console.log('   ' + pad('指标', 14) + pad('A 基线', 14) + pad('B 激发态', 14) + 'B−A');
    for (const k of KEYS) {
      const a = rows.filter(r => r.arm === 'A' && r.group === g).map(r => r.metrics[k]);
      const b = rows.filter(r => r.arm === 'B' && r.group === g).map(r => r.metrics[k]);
      console.log('   ' + pad(k, 14) + pad(`${mean(a).toFixed(2)}±${sd(a).toFixed(2)}`, 14)
        + pad(`${mean(b).toFixed(2)}±${sd(b).toFixed(2)}`, 14) + (mean(b) - mean(a)).toFixed(2));
    }
    const d = diffs('lowTone', g); const s = signTest(d);
    console.log(`   低位腔出现率：${(rate('lowTone', g, 'A') * 100).toFixed(0)}% → ${(rate('lowTone', g, 'B') * 100).toFixed(0)}%`
      + `（B胜${s.win} A胜${s.lose} p=${s.p.toFixed(3)}）`);
  }

  // ── ③ 裁定 ──
  const dLow = diffs('lowTone', 'low');
  const sLow = signTest(dLow);
  const primary = mean(dLow) > 0 && sLow.p <= 0.10;
  const warmthLow = mean(diffs('warmth', 'low'));
  const warmthOk = warmthLow <= 0;
  const restWarm = mean(diffs('warmth', 'rest'));
  const restEcho = mean(diffs('echo', 'rest'));
  const restOk = restWarm >= 0 && restEcho >= 0;
  const cA = mean(rows.filter(r => r.arm === 'A').map(r => r.metrics.chars));
  const cB = mean(rows.filter(r => r.arm === 'B').map(r => r.metrics.chars));
  const charsOk = cB >= 0.7 * cA;
  const announceOk = mean(diffs('selfAnnounce', 'low')) <= 0 && mean(diffs('selfAnnounce', 'rest')) <= 0;
  const upDelta = mean(diffs('upTone', 'up'));
  const passed = manOk && primary && warmthOk && restOk && charsOk && announceOk;

  console.log(`\n${'='.repeat(90)}\n③ 数据层面裁定（判据跑之前写死；最终还得人看原文）\n${'='.repeat(90)}`);
  console.log(`   主终点 低位腔（她明显偏低那 4 个场景）：${(rate('lowTone', 'low', 'A') * 100).toFixed(0)}% → `
    + `${(rate('lowTone', 'low', 'B') * 100).toFixed(0)}%，均值差 ${mean(dLow).toFixed(2)}`
    + `（B胜${sLow.win} A胜${sLow.lose} p=${sLow.p.toFixed(3)}）⇒ ${primary ? '✓ 达标' : '✗ 未达标'}`);
  console.log(`   同组 基线腔 warmth ${warmthLow.toFixed(2)} ⇒ ${warmthOk ? '✓ 没上升' : '✗ 上升了 ⇒ 算输'}`);
  console.log(`   底线 静息对照：基线腔 ${restWarm.toFixed(2)}（≥0 ✓）｜接住 echo ${restEcho.toFixed(2)}`
    + ` ⇒ ${restOk ? '✓ 没变冷' : '✗ 变冷了 ⇒ 算输'}`);
  console.log(`   底线 字数 ${cA.toFixed(1)} → ${cB.toFixed(1)}（${(cB / cA * 100).toFixed(0)}%）⇒ ${charsOk ? '✓' : '✗ 塌了 ⇒ 算输'}`);
  console.log(`   底线 自述情绪 ${announceOk ? '✓ 没更多' : '✗ 更多了 ⇒ 算输'}`);
  console.log(`   方向性对照 她开心那格的上扬腔 ${upDelta.toFixed(2)}（只报告）`);
  console.log(`   ⇒ 数据层面：${passed ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
  console.log(`   回复原文：${ROWS}`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
