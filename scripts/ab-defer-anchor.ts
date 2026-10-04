// scripts/ab-defer-anchor.ts
//
// v1.30：让位（她自己也沉在里面 → 本轮不表达自己的事）那段话**怎么写**，端到端实测裁定。
//
// 为什么问这个：v1.28 在让位时借一条**关于他的** `open_loop` 当锚，理由是"把素材抽空，
// 模型会回退到安慰 + 分析"。但 v1.29 对**真实 Prompt** 逐块对切（n=4）给出了反面证据：
//     锚在场  ⇒ 在场词 0.25 ｜ 劝解 1.50 ｜ 61.0 字
//     旧空文案 ⇒ 在场词 0.75 ｜ 劝解 1.25 ｜ 64.0 字
//     整块不给 ⇒ 在场词 1.00（4/4「我在。」）｜ 劝解 0.75 ｜ 46.0 字
// ⇒ 在"让位"这个分支里，**具体素材本身就是干扰**：模型会去"处理那件事"，而不是"只是陪着"。
// 但那次是**离线回放**（把 dump 下来的 Prompt 按块对切后重新发给模型），不是真管道。
// 本脚本在**真管道**上跑三档，作为落地判据。
//
// 三档（只换那段话的写法，判定与动力学完全不变）：
//   anchor  = v1.28 现状：拿那件事当锚，"可以顺着这件事问一句它的下文"
//   swallow = 锚仍在，但写成**咽下去**的（"这一轮先不问它"）+ 给在场示例 —— 保留"她心里有东西"的内在理由
//   omit    = 让位时**整块不给**（她本轮确实没有要说的事）
//
// 设计（同 `ab-emotion-reply.ts` 的方法学）：
//   · 走**真实 HTTP 管道**（真 express + 真 Prompt 组装 + 真 provider），不是离线拼 Prompt
//   · 唯一变量 = 让位档位；他的那句话、`recentMessages`、她的起始状态（baseline + sad 0.20）逐臂相同
//   · **操纵检查**：打开 `DUMP_PROMPT` 抓真正发出去的 Prompt，逐样本断言该档的标记文本在位
//     （否则"三档没差别"可能只是开关没生效 —— 这个项目反复吃过静默失效的亏）
//   · 有效样本门槛：`userIntensity ≥ DEFER_USER_INTENSITY` 且 `/state → motive.thisTurn.deferred === true`
//     （anchor/swallow 还要求真挑到了锚）—— 不满足就重跑该样本
//   · 每档 n≥6（本项目教训：n=4 的漂亮结论补到 n=6 缩水一半）
//   · 轮转执行抵消顺序效应；逐样本打印原文（指标是尺子，原文才是事实）
//   · 副作用：真实管道会写 `memories/`。先整目录备份，结束（含异常）后原样恢复
//     ⚠️ 跑之前 3000 端口的服务必须停掉（两个实例同时写记忆 = 最伤数据的状态）；脚本会**预检并拒绝启动**
//
// 事先声明的判据：
//   主终点 = 字面在场（"我在/我陪着你"这类短句出现，`presenceStrict ≥ 1`）—— v1.29 里唯一没被兑现的那条
//   次终点 = 劝解/追问次数（锚把她推向"处理那件事"的痕迹）与字数
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/ab-defer-anchor.ts [--n=6] [--message=...] [--styles=anchor,swallow,omit] [--keep]

import { cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { DEFER_USER_INTENSITY, DEFER_HER_SINK, DEFER_ANCHOR_STYLES, type DeferStyle } from '../src/lib/motive.js';
import { STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';
import { textSimilarity } from '../src/lib/memoryEnhancer.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const strArg = (name: string, dflt: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const N = Math.max(2, arg('n', 6));
const MAX_ATTEMPTS = N * 4;
const KEEP = process.argv.includes('--keep');
/** 他这句话：必须强到 `userIntensity ≥ 0.6`（让位判定的一半），所以默认用标定过的重句 */
const HIS_MESSAGE = strArg('message', '我今天面试又挂了，真的特别难受，感觉自己特别没用。');
/**
 * `default` 是**伪档**：不设 `DEFER_ANCHOR_STYLE`，让 server 走它自己的默认值 ——
 * 用来验证"落地的默认档"而不只是"显式传 omit 时的行为"（本项目的老毛病就是"只测了传参那条路"）。
 */
type StyleArg = DeferStyle | 'default';
const VALID_STYLE_ARGS = [...DEFER_ANCHOR_STYLES, 'default'];
const STYLES = strArg('styles', DEFER_ANCHOR_STYLES.join(','))
  .split(',').map(s => s.trim()).filter(Boolean) as StyleArg[];
for (const s of STYLES) {
  if (!VALID_STYLE_ARGS.includes(s)) {
    console.error(`[参数] --styles 里有非法档位 "${s}"（合法：${VALID_STYLE_ARGS.join('|')}）`);
    process.exit(2);
  }
}

/**
 * 上下文（历史由客户端传入，所以这里是唯一来源）。
 *
 * `--history=` 三档，专为验证 v1.30 那一轮冒出来的"她为**不存在的事**道歉"到底是不是 bug：
 *   `plain`  = 只有寒暄（默认）
 *   `repeat` = 历史里她**先**提了「面试」，而他会话里从没提过 ⇒ **她的话在历史上无据**（自相矛盾的历史）
 *   `legit`  = 他先说「我明天有个面试」，她再提 ⇒ **同一句话落在有据的历史里**
 * 若道歉只出现在无据那档、不出现在有据那档，那它**不是 bug** —— 是【回复前自检】真抓住了注入的不一致；
 * 我上一轮直接把它写成"新失败模式"，属于**没有先验证自己的前提**。
 */
type HistoryMode = 'plain' | 'repeat' | 'legit';
const HISTORY = (strArg('history', 'plain').trim() || 'plain') as HistoryMode;
if (!['plain', 'repeat', 'legit'].includes(HISTORY)) {
  console.error(`[参数] --history 只能是 plain|repeat|legit（收到 "${HISTORY}"）`);
  process.exit(2);
}
const RECENT_BASE = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const RECENT = HISTORY === 'plain' ? RECENT_BASE : HISTORY === 'repeat' ? [
  ...RECENT_BASE,
  { role: 'user', content: '嗯' },
  { role: 'assistant', content: '我在。面试挂了这件事，先别急着往自己身上扣"没用"这两个字。' },
] : [
  ...RECENT_BASE,
  { role: 'user', content: '我明天有个面试，有点紧张' },
  { role: 'assistant', content: '嗯，明天那场面试我记得。今晚早点睡，别熬。' },
];
/** 历史里她上一轮那句（`repeat` 档才有）—— 用来量"她这一轮是不是把它又抄了一遍" */
const PRIOR_LINE = HISTORY === 'repeat'
  ? (RECENT[RECENT.length - 1].content as string).replace(/\s+/g, '')
  : '';

const MEM = 'memories';
const BAK = 'memories.ab-defer-bak';
const DUMP = '.ab-defer-prompt.dump';

/** 各档真正进 Prompt 的标记文本（操纵检查用；omit/default 档要求动机块完全不出现） */
const MARKERS: Record<StyleArg, { must: string[]; mustNot: string[] }> = {
  anchor: { must: ['你心里其实挂着一件关于他的事', '顺着这件事问一句它的下文'], mustNot: ['这一轮先不问它'] },
  swallow: { must: ['你心里本来装着一件关于他的事', '这一轮先不问它', '我在'], mustNot: ['顺着这件事问一句它的下文'] },
  omit: { must: [], mustNot: ['【此刻', '顺着这件事问一句它的下文', '这一轮先不问它'] },
  default: { must: [], mustNot: ['【此刻', '顺着这件事问一句它的下文', '这一轮先不问它'] },
};

/** 设档位：`default` = 把环境变量**删掉**，走 server 自己的默认值 */
function applyStyleEnv(style: StyleArg) {
  if (style === 'default') delete process.env.DEFER_ANCHOR_STYLE;
  else process.env.DEFER_ANCHOR_STYLE = style;
}

interface Row {
  style: StyleArg;
  pair: number;
  attempt: number;
  strategy: string;
  reason: string;
  userIntensity: number;
  herBefore: string;
  negBefore: number;
  herAfter: string;
  deferred: boolean;
  anchor: string;
  manipulationOk: boolean;
  manipulationWhy: string;
  reply: string;
}

/**
 * 回复文本指标。`presence` 与 v1.29 口径**逐字相同**（才能和那批数字比），
 * 另加 `presenceStrict`：老口径的 `我在` 会把"我在想…"也算成在场感（假阳性），
 * 用一个负向前瞻把这类"我在 + 动词"排掉，避免结论建立在一把糊尺子上。
 */
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    sentences: count(/[。！？!?]/g),
    questions: count(/[？?]/g),
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是/g),
    presence: count(/我在|陪着你|陪你|抱着|抱抱|我一直|不用一个人/g),
    presenceStrict: count(/我在(?!想|忙|看|听|说|等|做|写|吃|学|试|考虑|琢磨|这|那)|陪着你|我陪|不走|不用一个人/g),
    presenceAct: count(/（[^）]{2,12}）/g),
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    empathy: count(/我懂|明白|听起来|感觉你|辛苦了|心疼|难受|委屈|泄气/g),
    /** 锚话题被"接着处理"的痕迹（面试/结果/消息…），纯描述性，不作判据 */
    anchorWords: count(/面试|结果|消息|下文|公司|通知/g),
    /** 为**不存在的事**道歉 / 自我指认的编造（v1.30 那一轮冒出来的 2/6） */
    apology: count(/是我说早了|自己脑补|脑补|抱歉|对不起|不该提|是我多嘴|我记错|你还没提过/g),
    /** 与**历史里她自己上一轮那句**的重合度（1.00 = 逐字一样）—— 量【避免重复】到底管不管用 */
    dupPrev: PRIOR_LINE ? textSimilarity(reply.replace(/\s+/g, ''), PRIOR_LINE) : 0,
    /** 逐字重复上一轮（去掉空白后完全相同） */
    verbatim: PRIOR_LINE && reply.replace(/\s+/g, '') === PRIOR_LINE ? 1 : 0,
  };
}
type Metrics = ReturnType<typeof score>;
const METRIC_KEYS: Array<keyof Metrics> = ['chars', 'sentences', 'questions', 'probe', 'presence',
  'presenceStrict', 'presenceAct', 'advice', 'empathy', 'anchorWords', 'apology', 'dupPrev', 'verbatim'];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
/** 符号检验（精确二项，双尾）——n 小、分布未知，不用 t 检验 */
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length;
  const lose = diffs.filter(d => d < 0).length;
  const n = win + lose;
  if (n === 0) return { win, lose, p: 1 };
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const C = (a: number, b: number) => fact(a) / (fact(b) * fact(a - b));
  let tail = 0;
  for (let k = Math.max(win, lose); k <= n; k++) tail += C(n, k);
  return { win, lose, p: Math.min(1, (2 * tail) / 2 ** n) };
}

// ── 预检：3000 端口不能有别的实例在写 memories/ ──
{
  let alive = false;
  try {
    const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) });
    alive = r.ok;
  } catch { /* 连不上 = 没有实例 */ }
  if (alive) {
    console.error('[预检] 3000 端口上还有服务在跑 —— 两个实例同时写 memories/ 会伤数据，先停掉它再跑本脚本。');
    process.exit(3);
  }
}

// ── 备份（实验不留痕）──
function backup() {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  console.log(`[备份] ${MEM}/ → ${BAK}/（实验结束后原样恢复）`);
}
function restore() {
  if (!existsSync(BAK)) return;
  if (KEEP) {
    console.log(`[恢复] --keep：**跳过恢复**，实验数据留在 ${MEM}/，备份在 ${BAK}/`);
    return;
  }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

backup();
writeFileSync(DUMP, '', 'utf8');
process.env.DUMP_PROMPT = DUMP;

let listener: { close: () => void } | null = null;
const rows: Row[] = [];
try {
  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  listener = srv.app.listen(0, '127.0.0.1');
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 端口冲突）`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>;
    baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;
  /** 三档共用的起始状态：静息 + sad 0.20（越 `DEFER_HER_SINK`=0.12 ⇒ 让位判定的她那一半成立） */
  const HERS = (() => {
    const s = structuredClone(real) as typeof real;
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.20 };
    s.baselineEmotions = { ...baseline };
    return s;
  })();

  /** 走一轮真实管道：钉住档位与她起始状态 → POST /api/chat → 收回复 + 抓 Prompt 做操纵检查 */
  async function callOnce(style: StyleArg, attempt: number): Promise<Row> {
    applyStyleEnv(style);
    const before = structuredClone(HERS) as never;
    srv.aiEngine.emotionState = before;
    // 协调器自己的滑动窗口也要归零，否则后面的样本会带着前面的历史
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = [];
    c.topicHistory = [];
    c.herValenceHistory = [];

    // ⚠️ 这里必须按**字符串长度**截取，不能按文件字节数：中文一个字 3 字节、1 个 UTF-16 码元，
    // 用 `statSync().size` 当 slice 偏移会让偏移量随轮次越飘越远（第一轮就对不上），
    // 表现为"操纵检查全灭"，看着像开关没生效 —— 实际是尺子错了（本轮已踩过一次）。
    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: HIS_MESSAGE, userId: 'ab-defer', recentMessages: RECENT }),
    });
    const data = await res.json() as Record<string, never>;
    if (typeof data.response !== 'string') {
      console.error(`[中断] /api/chat 没有返回 response：${JSON.stringify(data).slice(0, 300)}`);
      throw new Error('chat 调用失败（见上）');
    }
    const afterState = (data.emotionState ?? before) as never;
    const dBefore = activationOf(before as never).delta as Record<string, number>;
    const dAfter = activationOf(afterState).delta as Record<string, number>;
    const maxNeg = (d: Record<string, number>) => Math.max(d.sad ?? 0, d.fear ?? 0, d.anger ?? 0);

    // 操纵检查：这一轮**真正发出去**的 Prompt 里，该档的标记文本是否在位
    const dumpAll = readFileSync(DUMP, 'utf8');
    const prompt = dumpAll.slice(dumpBefore);
    const mk = MARKERS[style];
    const missing = mk.must.filter(m => !prompt.includes(m));
    const forbidden = mk.mustNot.filter(m => prompt.includes(m));
    const manipulationOk = missing.length === 0 && forbidden.length === 0;
    const manipulationWhy = [
      missing.length ? `缺 ${missing.map(m => `「${m}」`).join('')}` : '',
      forbidden.length ? `多了 ${forbidden.map(m => `「${m}」`).join('')}` : '',
    ].filter(Boolean).join('；');

    let deferred = false;
    let anchor = '';
    let strategy = String(data.strategy ?? '?');
    try {
      const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
      const m = st.motive as never as {
        thisTurn?: { deferred?: boolean; deferAnchor?: { content?: string } | null };
      } | undefined;
      deferred = Boolean(m?.thisTurn?.deferred);
      anchor = m?.thisTurn?.deferAnchor?.content ?? '';
    } catch { /* 记录失败不影响主流程 */ }

    return {
      style,
      pair: 0,
      attempt,
      strategy,
      reason: String(data.strategyReason ?? ''),
      userIntensity: Number((data.emotionAnalysis as never as { user?: { intensity?: number } })?.user?.intensity ?? 0),
      herBefore: activationOf(before as never).note,
      negBefore: maxNeg(dBefore),
      herAfter: activationOf(afterState as never).note,
      deferred,
      anchor,
      manipulationOk,
      manipulationWhy,
      reply: String(data.response),
    };
  }

  console.log(`\n[他这句话] 「${HIS_MESSAGE}」`);
  console.log(`[她的起始状态] ${activationOf(HERS as never).note}（本轮开始前负位移 +${(Math.max(
    (activationOf(HERS as never).delta as Record<string, number>).sad ?? 0,
    (activationOf(HERS as never).delta as Record<string, number>).fear ?? 0,
    (activationOf(HERS as never).delta as Record<string, number>).anger ?? 0)).toFixed(3)}，让位门槛 ${DEFER_HER_SINK}）`);
  console.log(`[判据] 他强度 ≥ ${DEFER_USER_INTENSITY} 且 deferred=true${STYLES.includes('omit') ? '' : ' 且真挑到锚'}`
    + `　｜历史=${HISTORY}${HISTORY === 'repeat' ? '（她先提了面试、他从未提 ⇒ 她的那句话在历史上无据）' : ''}`);

  const rotate = <T,>(xs: T[], k: number) => xs.map((_, i) => xs[(i + k) % xs.length]);
  let attempts = 0;
  for (let pair = 1; pair <= N; pair++) {
    for (const style of rotate(STYLES, pair - 1)) {
      let row: Row | null = null;
      while (!row) {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          throw new Error(`有效样本不足（已试 ${attempts} 次，只拿到 ${rows.length} 条）：他这句话可能不够强，或锚挑不出来。`);
        }
        const r = await callOnce(style, attempts);
        const needAnchor = style !== 'omit' && style !== 'default';
        const ok = r.userIntensity >= DEFER_USER_INTENSITY && r.deferred
          && (!needAnchor || r.anchor.length > 0) && r.manipulationOk;
        if (!ok) {
          const why = [
            r.userIntensity < DEFER_USER_INTENSITY ? `他强度 ${r.userIntensity.toFixed(2)} < ${DEFER_USER_INTENSITY}` : '',
            !r.deferred ? '没有让位（她那一半不成立）' : '',
            needAnchor && !r.anchor ? '没挑到锚' : '',
            !r.manipulationOk ? `操纵检查失败（${r.manipulationWhy}）` : '',
          ].filter(Boolean).join('；');
          console.log(`   ✗ 丢弃（${style}）：${why}`);
          continue;
        }
        row = { ...r, pair };
      }
      rows.push(row);
      const m = score(row.reply);
      console.log(`   [${row.style}] p${pair} ${String(m.chars).padStart(3)}字 在场${m.presenceStrict} 动作${m.presenceAct} 劝解${m.advice} 追问${m.probe} ｜${row.strategy}`
        + `\n        「${row.reply.replace(/\n/g, ' / ')}」`);
    }
  }

  // ── 汇总 ──
  const styleRows = (s: StyleArg) => rows.filter(r => r.style === s);
  console.log(`\n${'='.repeat(78)}\n各档均值（n=${N}，均值±SD）\n${'='.repeat(78)}`);
  const header = ['指标'.padEnd(14), ...STYLES.map(s => `${s} 档`.padEnd(18))].join('');
  console.log(header);
  for (const k of METRIC_KEYS) {
    const cells = STYLES.map(s => {
      const xs = styleRows(s).map(r => score(r.reply)[k]);
      return `${mean(xs).toFixed(2)}±${sd(xs).toFixed(2)}`.padEnd(18);
    });
    console.log(k.padEnd(14) + cells.join(''));
  }

  console.log('\n主终点：字面在场（"我在/我陪着你"这类短句）—— 逐样本');
  for (const s of STYLES) {
    const xs = styleRows(s).map(r => score(r.reply).presenceStrict);
    const hit = xs.filter(x => x >= 1).length;
    console.log(`   ${s.padEnd(8)} ${hit}/${xs.length} 条出现　（逐样本 ${xs.join(', ')}）`);
  }

  console.log('\n道歉/自我指认（"是我说早了/脑补/抱歉"）—— 是不是只出现在**无据历史**那一档');
  for (const s of STYLES) {
    const xs = styleRows(s).map(r => score(r.reply).apology);
    console.log(`   ${s.padEnd(8)} ${xs.filter(x => x >= 1).length}/${xs.length} 条出现　（逐样本 ${xs.join(', ')}）`);
  }

  console.log('\n开场多样性（同档内不同开头的条数；越低越像模板 —— 让位档最容易滑向"固定开场"）');
  for (const s of STYLES) {
    const heads = styleRows(s).map(r => [...r.reply.replace(/\s/g, '')].slice(0, 6).join(''));
    const uniq = [...new Set(heads)];
    console.log(`   ${s.padEnd(8)} ${uniq.length}/${heads.length} 种　${uniq.map(h => `「${h}…」`).join('')}`);
  }

  console.log('\n整条回复的重复情况（同档内**逐字相同**的条数越少越好；`dupPrev` 是与她上一轮那句的重合度）');
  for (const s of STYLES) {
    const rs = styleRows(s);
    const bodies = rs.map(r => r.reply.replace(/\s+/g, ''));
    const uniqBodies = [...new Set(bodies)];
    const verbatim = rs.filter(r => score(r.reply).verbatim === 1).length;
    const sims = rs.map(r => score(r.reply).dupPrev);
    console.log(`   ${s.padEnd(8)} 不同整条 ${uniqBodies.length}/${bodies.length}`
      + `　逐字重复上一轮 **${verbatim}/${rs.length}**`
      + `　与上一轮平均重合 ${(sims.reduce((a, b) => a + b, 0) / (sims.length || 1)).toFixed(2)}`
      + `　最高 ${Math.max(0, ...sims).toFixed(2)}`);
  }

  console.log('\n配对符号检验（逐对，同 pair 相减；n 小、分布未知）');
  for (let i = 0; i < STYLES.length; i++) {
    for (let j = i + 1; j < STYLES.length; j++) {
      const a = styleRows(STYLES[i]).sort((x, y) => x.pair - y.pair);
      const b = styleRows(STYLES[j]).sort((x, y) => x.pair - y.pair);
      const diffsOf = (k: keyof Metrics) => a.map((r, idx) => score(r.reply)[k] - score(b[idx].reply)[k]);
      const parts = (['presenceStrict', 'advice', 'chars'] as Array<keyof Metrics>).map(k => {
        const t = signTest(diffsOf(k));
        return `${k} ${t.win}胜${t.lose}负 p=${t.p.toFixed(3)}`;
      });
      console.log(`   ${STYLES[i]} vs ${STYLES[j]}：${parts.join('　')}`);
    }
  }

  console.log('\n逐样本她的状态读数（确认三档的**输入**一致）');
  for (const s of STYLES) {
    const rs = styleRows(s);
    console.log(`   ${s.padEnd(8)} 本轮开始前 ${rs[0].herBefore} ｜ 起始负位移 +${rs[0].negBefore.toFixed(3)}`
      + ` ｜ 被这一句推到 ${rs[0].herAfter} ｜ 策略 ${rs[0].strategy} ｜ 锚「${rs[0].anchor}」`);
  }
} finally {
  if (listener) (listener as unknown as { close: () => void }).close();
  rmSync(DUMP, { force: true });
  restore();
}
