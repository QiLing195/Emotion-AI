// scripts/ab-laya-strategy.ts
//
// v1.33 行为裁定：`LAYA_STRATEGY=on`（允许 Laya 改判策略）到底让回复**变好还是变差**？
//
// 为什么必须量：`probe-laya-strategy.ts` 只证明了"它挑得不算离谱"（8 情景 7 个落在合理集，
// 但 6 个都是同一条 `empathize`、均值置信度 0.49）。那**不是**"开着更好"的证据 ——
// 本项目已经在 v1.30 吃过一次同款教训：`swallow`（多给一句在场示例）看着"两件都做了"，
// 实测却把在场 12/12 换来了追问 2.58 与 84 字，比现状更差。
//
// 设计（沿用 `ab-defer-anchor.ts` 的方法学）：
//   · 走**真实 HTTP 管道**（进程内起真 express + 真 Prompt 组装 + 真 provider + 真 Laya sidecar）
//   · 唯一变量 = 这一轮允不允许 Laya 改判；他的那句话、`recentMessages`、她的起始状态逐臂相同
//   · **两阶段**：
//       阶段 A（筛选）：每条候选消息在 `on` 下跑一次，看 `audit.outcome` ——
//         `applied` 才算**真有处理**。没被改判的消息在 A/B 里 `on`=`off`，测它只是浪费样本。
//       阶段 B（配对 A/B）：只对**真被改判**的消息做 off/on 配对各 n 次。
//   · **操纵检查**（两条，缺一不可）：
//       ① `off` 臂：`layaStats().calls` 必须**一次都没涨**（默认关闭 = 真的一次网络都不发）
//       ② `on` 臂：`audit.outcome === 'applied'` 且策略确实与规则不同
//   · 每样本状态复位（含 `conflictManager.reset()` —— 它是模块单例，不在情感快照里，
//     上批实验被它污染过：15 个样本里 7 个假 repair）
//   · 轮转执行抵消顺序效应；逐样本打印原文（指标是尺子，原文才是事实）
//   · 副作用：真实管道会写 `memories/`。先整目录备份，结束（含异常）后原样恢复
//     ⚠️ 跑之前 3000 端口的服务必须停掉（两个实例同时写记忆 = 最伤数据的状态）；脚本**预检并拒绝启动**
//
// 事先声明的判据：
//   主终点 = **在场**（`presenceStrict`，v1.29/v1.30 的口径，逐字相同）
//   次终点 = 追问（`probe`）/ 劝解（`advice`）/ 字数（`chars`）
//   ⚠️ 主终点有**已知的尺子缺陷**（`presenceStrict` 看不见「我在这儿」），所以另报一个
//      `presenceWide` 口径；两个口径不一致时**以原文为准**，别拿一个口径下结论。
//   ⚠️ 预期方向：Laya 在"她本来就已经沉进去"的局面里把她从 `accompany` 推向 `empathize`，
//      也就是**让她多说、多问**。按 v1.30/v1.31 的结论（让位要少说、不追问），这可能更差 ——
//      但那是**预期**，不是结论；本脚本就是去把它证成或证伪。
//
// 落地判据（跑之前就写好，免得事后找理由）：
//   主终点显著变好 → 可以谈开启；主终点显著变差 → 明确不开；
//   **两个口径都不显著、而没有任何一个次终点显著变好** → 不开（代价是**确定**的 0.5s/轮）。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/ab-laya-strategy.ts [--n=6] [--minConf=0.5] [--messages=a|b] [--keep]

import { cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { markInteraction } from '../server/persistence.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { layaHealth, layaStats, resetLayaBreaker } from '../server/services/layaClient.js';
import type { LayaAudit } from '../src/lib/layaDecision.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
// CPU 单次前向实测 0.5~0.9s，默认 1500ms 在负载下会误熔断 ⇒ 给宽
process.env.LAYA_TIMEOUT_MS = process.env.LAYA_TIMEOUT_MS ?? '4000';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const strArg = (name: string, dflt: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};
const N = Math.max(2, arg('n', 6));
const KEEP = process.argv.includes('--keep');
const MIN_CONF = arg('minConf', 0.5);
/** 每轮之间歇一下（毫秒）：第一次跑到 a7/p2 就被 provider 限流打断过，慢一点比反复重发省事 */
const DELAY_MS = Math.max(0, arg('delay', 500));
/**
 * 把「距上次说话 N 分钟」钉成常数。
 * 不钉的话，同一批样本里第一个带这句、后面的不带 —— 实测这一句的有无会把模型
 * 从 `empathize 0.72` 翻成 `neutral 0.33`（跨过门限），"改判率"于是 8/8 → 3/8。
 * 那是**尺子的锅**：每个样本的 state 文本必须逐字一致，这是配对设计的前提。
 */
const PINNED_IDLE_MIN = Math.max(0, arg('idle', 3));
process.env.LAYA_MIN_CONFIDENCE = String(MIN_CONF);

/**
 * 候选消息。全部是"他明确难受"这一类 —— 因为她的起始状态钉在 **sad +0.20**
 * （越过 `ACCOMPANY_WHEN_SHE_SINKS`，也越过让位门槛），规则链在这类句子上会走
 * `accompany`（少说话、陪着），而这正是 Laya 想去改判的那一档。
 * 到底哪几条真会被改判，由**阶段 A 筛选**决定，不靠我猜。
 */
const CANDIDATES: { id: string; text: string }[] = [
  { id: 'a1', text: '我今天面试又挂了，真的特别难受，感觉自己特别没用。' },
  { id: 'a2', text: '这次又没成，我大概就是这样的人吧。' },
  { id: 'a3', text: '我真的撑不住了，什么都不想做了。' },
  { id: 'a4', text: '刚才被老板当众骂了一顿，太丢人了。' },
  { id: 'a5', text: '你说我是不是特别没用？' },
  { id: 'a6', text: '今天特别想找人说说话，又不知道该说什么。' },
  { id: 'a7', text: '没事，就是有点累，你别管我。' },
  { id: 'a8', text: '我妈又打电话来催了，烦死了。' },
];
const ONLY = strArg('messages', '').split(',').map(s => s.trim()).filter(Boolean);
const POOL = ONLY.length ? CANDIDATES.filter(c => ONLY.includes(c.id)) : CANDIDATES;

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const MEM = 'memories';
const BAK = 'memories.ab-laya-bak';
const DUMP = '.ab-laya-prompt.dump';
/** 只读诊断口：Laya 那条通路**真正发出去的 state 文本**（复现"两轮跑出不同改判率"用） */
const STATE_DUMP = '.ab-laya-state.dump';

/**
 * 三条臂。`on` 与 `on-keep` 的唯一差别是**规则给 `accompany` 时让不让模型碰**
 * （`LAYA_KEEP_ACCOMPANY`）；两条都开着 Laya，都发网络。
 */
type Arm = 'off' | 'on' | 'on-keep';
const ALL_ARMS: Arm[] = ['off', 'on', 'on-keep'];
const ARMS = (strArg('arms', ALL_ARMS.join(','))
  .split(',').map(s => s.trim()).filter(Boolean)) as Arm[];
for (const a of ARMS) {
  if (!ALL_ARMS.includes(a)) {
    console.error(`[参数] --arms 里有非法臂 "${a}"（合法：${ALL_ARMS.join('|')}）`);
    process.exit(2);
  }
}
/**
 * 唯二变量：允不允许改判、以及收窄档开不开。
 * `on` 必须**显式**写 `LAYA_KEEP_ACCOMPANY=false`，否则它就变成收窄版、两条臂会重合
 * （这个项目反复吃过"以为在 A/B，其实两臂一样"的亏）。
 */
function applyArm(arm: Arm) {
  if (arm === 'off') {
    process.env.LAYA_STRATEGY = 'off';
    return;
  }
  process.env.LAYA_STRATEGY = 'on';
  process.env.LAYA_KEEP_ACCOMPANY = arm === 'on' ? 'false' : 'true';
}

interface Row {
  arm: Arm;
  msgId: string;
  msg: string;
  pair: number;
  strategy: string;
  /** 规则的**原始**结论（从审计 note "Laya 改判 X → Y" 里扒回来；off 臂没有审计 ⇒ '—'） */
  ruleStrategy: string;
  audit: LayaAudit | null;
  callsBefore: number;
  callsAfter: number;
  userIntensity: number;
  herBefore: string;
  ms: number;
  reply: string;
}

/**
 * 从审计 note 里把**规则原本的结论**扒出来。
 *
 * 为什么要扒：`audit.picked` 与最终策略在 `applied` 时**必然相同**，
 * 所以只看 `picked` 看不出"它把什么改成了什么"。note 里本来就写着
 * 「Laya 改判 accompany → empathize（p=0.71…）」，那是唯一的第一手来源。
 * （`agree`/`guard`/`low_confidence` 这些没有改判，返回 '—'。）
 */
function ruleStrategyOf(audit: LayaAudit | null | undefined): string {
  const m = audit?.note?.match(/改判\s+(\S+)\s*→/);
  return m ? m[1] : '—';
}

/**
 * 回复文本指标 —— 与 `ab-defer-anchor.ts` / v1.29 / v1.30 **逐字相同**（否则数字不可比），
 * 外加两个 v1.33 才补上的在场口径 `presenceWide` / `presencePhrase`。
 *
 * ⚠️ **这套"在场"正则已经两次给出反的结论**，两次都是漏词：
 *   ① `presenceStrict` 的负向前瞻排除了「我在**这**」⇒ `我在。` 算在场、`我在这儿呢。` 不算；
 *   ② `presenceWide` 只认 `我在` ⇒ **`我就在这儿` 一个都不匹配**（字符是 我就 在，没有"我在"）。
 *   ②的后果最严重：a7 那一轮 `neutral` 的回复 10/10 都说「我就在这儿」，
 *   而 `presenceWide` 记成 **1/10**，于是"A/B 把在场打没了（p=0.016）"这个结论**完全是假的**；
 *   换成 `presencePhrase` 重算是 **10/10 vs 8/10（持平）**，真正的差别只有字数 46→19.9。
 *
 * 教训（写在这里免得下次再犯）：**在这条任务上，"手写正则的在场"不能单独当主终点用**。
 * 三个口径都报，**三者不一致时以原文为准** —— 本项目在语音那边最后也是靠听感裁定的。
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
    presenceWide: count(/我在|陪着你|我陪|不走|不用一个人/g),
    /** 目前最全的一版：`我就?在` 一次覆盖 我在／我就在／我在这儿／我就在这儿／我在呢 */
    presencePhrase: count(/我就?在|陪着你|我陪|不走|不用一个人/g),
    presenceAct: count(/（[^）]{2,12}）/g),
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    empathy: count(/我懂|明白|听起来|感觉你|辛苦了|心疼|难受|委屈|泄气/g),
  };
}
type Metrics = ReturnType<typeof score>;
const METRIC_KEYS: Array<keyof Metrics> = [
  'chars', 'sentences', 'questions', 'probe', 'presence', 'presenceStrict', 'presenceWide',
  'presencePhrase', 'presenceAct', 'advice', 'empathy',
];
/** 预注册的主终点（与 v1.29/v1.30 同口径；另两个口径作对照） */
const PRIMARY: keyof Metrics = 'presenceStrict';
const PRESENCE_VARIANTS: Array<keyof Metrics> = ['presenceStrict', 'presenceWide', 'presencePhrase'];

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
const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

// ── 预检 ①：3000 端口不能有别的实例在写 memories/ ──
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
// ── 预检 ②：Laya sidecar 必须活着（否则 `on` 臂全是 no_verdict，A/B 变成"两臂相同"的假实验）──
{
  const h = await layaHealth();
  console.log(`[预检] Laya sidecar ${process.env.LAYA_ENDPOINT ?? 'http://127.0.0.1:8790'} → ${h.ok ? 'ok' : 'DOWN'}（${h.detail}）`);
  if (!h.ok) {
    console.error('[预检] sidecar 没起来：`on` 臂会全部回退成规则，A/B 无意义。先按 docs 的 v1.33 节把它起起来。');
    process.exit(3);
  }
}
resetLayaBreaker();

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
writeFileSync(STATE_DUMP, '', 'utf8');
process.env.LAYA_DUMP_STATE = STATE_DUMP;

let listener: { close: () => void } | null = null;
const all: Row[] = [];
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
  console.log(`[设置] 裁判门限 LAYA_MIN_CONFIDENCE=${MIN_CONF}；n=${N}/臂/句`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>;
    baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;
  /**
   * 两臂共用的起始状态：静息 + **sad +0.20**。
   * 这一档同时越过两个门限（`ACCOMPANY_WHEN_SHE_SINKS=0.12` 与 `DEFER_HER_SINK=0.12`），
   * 也就是「她本来就已经沉进去了」—— 规则链在这类局面上给 `accompany`，
   * 而 Laya 在实测里正想把它改成 `empathize`。改判的代价就落在这里。
   */
  const HERS = (() => {
    const s = structuredClone(real) as typeof real;
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.20 };
    s.baselineEmotions = { ...baseline };
    return s;
  })();
  const negOf = (es: unknown) => {
    const d = activationOf(es as never).delta as Record<string, number>;
    return Math.max(d.sad ?? 0, d.fear ?? 0, d.anger ?? 0);
  };

  /**
   * 发一轮对话。**限流要重试，不能当成失败样本**：
   * 第一次跑到 a7/p2 就被 provider 的 `{"error":"Too many requests"}` 打断过 ——
   * 那种情况下**没有生成任何回复**，重发请求不是"重试一个样本"，是"这一轮根本没发生过"。
   * （重试不改样本身份：同一句、同一臂、同一 pair。）
   */
  async function postChat(url: string, payload: unknown, tries = 6): Promise<Record<string, never>> {    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      const rateLimited = res.status === 429 || /too many requests|rate limit/i.test(err);
      if (!rateLimited || i === tries) {
        console.error(`[中断] /api/chat 没有返回 response（第 ${i} 次，HTTP ${res.status}）：${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败（见上）');
      }
      console.warn(`   ⏳ 触发限流（${err}），等 ${Math.round(wait / 1000)}s 后重发（第 ${i}/${tries} 次）`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  /** 走一轮真实管道：钉住臂与她起始状态 → POST /api/chat → 收回复 + 读回裁决审计 */
  async function callOnce(arm: Arm, msgId: string, msg: string, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(HERS) as never;
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = [];
    c.topicHistory = [];
    c.herValenceHistory = [];
    // ⚠️ 模块单例，不在情感快照里：不复位的话上一轮的冲突阶段会漏到下一轮
    // （上一批实验 15 个样本里 7 个被它污染成假 repair）
    conflictManager.reset();
    // ⚠️ v1.33 踩到的坑：`idleMinutes` 由 `getLastInteractionAt()` 现算，而每跑完一轮它就被更新，
    // 于是**同一个句子在第一批样本里带「距上次说话 N 分钟」、后面的样本不带**。
    // 实测这一句的有无会把模型从 `empathize 0.72` 翻成 `neutral 0.33`（跨过 0.5 门限），
    // 结果"改判率"从 8/8 掉到 3/8 —— 那是**尺子的锅**，不是模型或收窄的锅。
    // 所以把空闲时长钉成一个常数（默认 3 分钟），让每个样本的 state 文本真正一致。
    markInteraction(Date.now() - PINNED_IDLE_MIN * 60_000);

    const callsBefore = layaStats().calls;
    if (DELAY_MS > 0) await new Promise(r => setTimeout(r, DELAY_MS));
    const t0 = Date.now();
    const data = await postChat(url, { message: msg, userId: 'ab-laya', recentMessages: RECENT });
    const ms = Date.now() - t0;
    const decision = aiCoordinator.getLastStrategyDecision();
    return {
      arm, msgId, msg, pair,
      strategy: decision?.strategy ?? String(data.strategy ?? '?'),
      ruleStrategy: ruleStrategyOf(decision?.laya),
      audit: decision?.laya ?? null,
      callsBefore,
      callsAfter: layaStats().calls,
      userIntensity: Number((data.emotionAnalysis as never as { user?: { intensity?: number } })?.user?.intensity ?? 0),
      herBefore: activationOf(HERS as never).note,
      ms,
      reply: String(data.response),
    };
  }

  console.log(`\n[她的起始状态] ${activationOf(HERS as never).note}（本轮开始前负位移 +${negOf(HERS).toFixed(3)}）`);

  // ════════════════════════════════════════════════════════════
  // 阶段 A：筛选 —— 哪些句子真的会被 Laya 改判？
  // ════════════════════════════════════════════════════════════
  console.log(`\n${'='.repeat(78)}\n阶段 A｜筛选（每条消息在 on 下跑一次，看它到底改不改判）\n${'='.repeat(78)}`);
  const treated: typeof POOL = [];
  for (const cand of POOL) {
    const r = await callOnce('on', cand.id, cand.text, 0);
    all.push(r);
    const a = r.audit;
    const applied = a?.outcome === 'applied';
    if (applied) treated.push(cand);
    const verdict = a
      ? `${pad(String(a.outcome), 16)}规则=${pad(r.ruleStrategy, 11)}→ 最终=${pad(a.picked ?? '—', 11)}p=${a.confidence.toFixed(2)}`
      : '（没有审计记录 —— 不对劲）';
    console.log(`${pad(cand.id, 4)}${pad(cand.text.slice(0, 22), 46)}${verdict}`
      + `${String(r.ms).padStart(5)}ms  他的强度 ${r.userIntensity.toFixed(2)}`);
  }
  console.log(`\n→ 真被改判（audit.outcome === 'applied'）的句子：**${treated.length}/${POOL.length}**`
    + `${treated.length ? `　${treated.map(t => t.id).join(', ')}` : ''}`);
  if (treated.length === 0) {
    console.log('\n没有任何句子被改判 ⇒ `on` 与 `off` 在这批输入上**行为完全相同**，A/B 无从谈起。');
    console.log('这本身是个结论：**默认门限下 Laya 在这类局面上基本不说话**（它 6/8 都在选最安全的 empathize 但置信度不够）。');
    console.log('要接着量，可用 `--minConf=0.35` 再跑一遍（那是另一个决策：降低门限换更多改判）。');
  }

  // ════════════════════════════════════════════════════════════
  // 阶段 B：配对 A/B（只对真被改判的句子）
  // ════════════════════════════════════════════════════════════
  const rows: Row[] = [];
  if (treated.length > 0) {
    console.log(`\n${'='.repeat(78)}\n阶段 B｜配对 A/B（臂 = ${ARMS.join(' / ')}，n=${N}/臂/句）\n${'='.repeat(78)}`);
    const rotate = <T,>(xs: T[], k: number) => xs.map((_, i) => xs[(i + k) % xs.length]);
    for (let pair = 1; pair <= N; pair++) {
      for (const cand of rotate(treated, pair - 1)) {
        for (const arm of rotate(ARMS, pair - 1)) {
          const r = await callOnce(arm, cand.id, cand.text, pair);
          r.pair = pair;
          all.push(r);
          rows.push(r);
          const m = score(r.reply);
          const mark = r.audit?.outcome === 'applied' ? '⚡'
            : r.audit?.outcome === 'rule_wins' ? '⛔' : ' ';
          console.log(`   ${mark}[${pad(arm, 8)}] ${cand.id} p${pair} ${String(m.chars).padStart(3)}字 `
            + `在场${m.presenceStrict}/${m.presenceWide} 动作${m.presenceAct} 劝解${m.advice} 追问${m.probe} ｜${pad(r.strategy, 10)}`
            + `${String(r.ms).padStart(5)}ms`);
          console.log(`        「${r.reply.replace(/\n/g, ' / ')}」`);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════════════════════════
  const armRows = (a: Arm) => rows.filter(r => r.arm === a);
  const LIVE_ARMS: Arm[] = ARMS.filter(a => a !== 'off');
  const PAD = 18;

  console.log(`\n${'='.repeat(78)}\n① 操纵检查\n${'='.repeat(78)}`);
  const offRows = armRows('off');
  const offLeak = offRows.filter(r => r.callsAfter > r.callsBefore);
  console.log(`off 臂发起的 Laya 调用：` + (offLeak.length === 0
    ? `**0 次**（${offRows.length}/${offRows.length} 个样本都一次网络都没发）✓`
    : `**${offLeak.length}/${offRows.length} 个样本发了网络** ✗ —— 默认关闭那条通路漏了`));
  for (const a of LIVE_ARMS) {
    const rs = armRows(a);
    const tally = new Map<string, number>();
    for (const r of rs) {
      const k = r.audit?.outcome ?? '(无审计)';
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const applied = rs.filter(r => r.audit?.outcome === 'applied').length;
    console.log(`${pad(a, 8)}臂 裁决分布：${[...tally].map(([k, v]) => `${k} ${v}`).join('　')}`);
    console.log(`${pad('', 8)}     真改判：**${applied}/${rs.length}**（其余回规则 ⇒ 那些配对是噪声地板）`);
    // 它到底把什么改成了什么 —— "它做了什么"的第一手视图，比任何均值都先看
    const transitions = new Map<string, number>();
    for (const r of rs.filter(x => x.audit?.outcome === 'applied')) {
      const k = `${r.ruleStrategy} → ${r.audit?.picked}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
    if (transitions.size > 0) {
      console.log(`${pad('', 8)}     改判方向：${[...transitions].sort((a2, b2) => b2[1] - a2[1]).map(([k, v]) => `${k} ×${v}`).join('　')}`);
    }
  }

  console.log(`\n${'='.repeat(78)}\n② 各臂均值（均值±SD）\n${'='.repeat(78)}`);
  console.log(pad('指标', 16) + ARMS.map(a => pad(a, PAD)).join(''));
  for (const k of METRIC_KEYS) {
    const cells = ARMS.map(a => {
      const xs = armRows(a).map(r => score(r.reply)[k]);
      return pad(`${mean(xs).toFixed(2)}±${sd(xs).toFixed(2)}`, PAD);
    });
    console.log(pad(k, 16) + cells.join(''));
  }

  if (rows.length > 0) {
    console.log(`\n${'='.repeat(78)}\n③ 配对符号检验（同句同 pair 相减；n 小、分布未知）\n${'='.repeat(78)}`);
    console.log('   逐对比较：`off` 当作基线；`on` = 什么都能改（v1.33 首次实测那套），'
      + '`on-keep` = 默认的收窄版。');
    for (const k of [...PRESENCE_VARIANTS, 'probe', 'advice', 'chars'] as Array<keyof Metrics>) {
      const parts: string[] = [];
      for (const a of LIVE_ARMS) {
        const pairsAll: number[] = [];
        const pairsChanged: number[] = [];
        for (const cand of treated) {
          for (let p = 1; p <= N; p++) {
            const base = rows.find(r => r.arm === 'off' && r.msgId === cand.id && r.pair === p);
            const trt = rows.find(r => r.arm === a && r.msgId === cand.id && r.pair === p);
            if (!base || !trt) continue;
            const d = score(trt.reply)[k] - score(base.reply)[k];
            pairsAll.push(d);
            if (trt.audit?.outcome === 'applied') pairsChanged.push(d);
          }
        }
        const t = signTest(pairsAll);
        const tc = signTest(pairsChanged);
        parts.push(`${pad(a, 8)}全部 ${t.win}胜${t.lose}负 p=${t.p.toFixed(3)}`
          + `（真改判 n=${pairsChanged.length}：${tc.win}胜${tc.lose}负 p=${tc.p.toFixed(3)}）`);
      }
      console.log(`   ${pad(k, 16)}${parts.join('\n' + ' '.repeat(19))}`);
    }

    console.log(`\n主终点逐样本：字面在场 —— **两个口径都报**（presenceStrict 看不见「我在这儿」）`);
    for (const k of PRESENCE_VARIANTS) {
      for (const arm of ARMS) {
        const xs = armRows(arm).map(r => score(r.reply)[k]);
        console.log(`   ${k.padEnd(15)}${arm.padEnd(8)} ${xs.filter(x => x >= 1).length}/${xs.length} 条出现`
          + `　均值 ${mean(xs).toFixed(2)}`);
      }
    }

    console.log(`\n按句拆开看（改判发生在哪几句上，差异就只可能出现在那几句）`);
    for (const cand of treated) {
      const filt = (a: Arm) => rows.filter(r => r.arm === a && r.msgId === cand.id);
      const fmt = (a: Arm, k: keyof Metrics) => mean(filt(a).map(r => score(r.reply)[k])).toFixed(2);
      const chain = (k: keyof Metrics) => ARMS.map(a => fmt(a, k)).join('→');
      const applied = filt('on').filter(r => r.audit?.outcome === 'applied').length;
      const kept = filt('on-keep').filter(r => r.audit?.outcome === 'rule_wins').length;
      console.log(`   ${pad(cand.id, 4)}${pad(cand.text.slice(0, 16), 36)}`
        + `在场(strict) ${chain('presenceStrict')}　追问 ${chain('probe')}　`
        + `劝解 ${chain('advice')}　字数 ${chain('chars')}`
        + `　（on 改判 ${applied}/${N}；on-keep 被规则挡下 ${kept}/${N}）`);
    }
    console.log(`   （列顺序 = ${ARMS.join(' → ')}）`);

    console.log(`\n延迟代价（含 LLM NLU + 生成 + Laya 前向；每轮多付的就是它）`);
    for (const arm of ARMS) {
      const xs = armRows(arm).map(r => r.ms);
      console.log(`   ${arm.padEnd(8)} ${mean(xs).toFixed(0)}ms ±${sd(xs).toFixed(0)}`);
    }

    console.log(`\n${'='.repeat(78)}\n④ 逐臂原文（指标是尺子，原文才是事实）\n${'='.repeat(78)}`);
    for (const cand of treated) {
      console.log(`\n── ${cand.id} 「${cand.text}」`);
      for (const arm of ARMS) {
        console.log(`   [${arm}]`);
        for (const r of rows.filter(x => x.arm === arm && x.msgId === cand.id)) {
          const flag = r.audit?.outcome === 'rule_wins' ? '⛔规则挡住 ' : '';
          console.log(`      p${r.pair} ${pad(r.strategy, 11)}${flag}「${r.reply.replace(/\n/g, ' / ')}」`);
        }
      }
    }
  }

  if (rows.length === 0) {
    console.log('\n（阶段 B 未执行 —— 见阶段 A 的结论）');
  }
} finally {
  if (listener) (listener as unknown as { close: () => void }).close();
  rmSync(DUMP, { force: true });
  restore();
  // state 文本**留着**：两轮跑出不同改判率时，唯一能解释它的就是这段文本
  if (existsSync(STATE_DUMP)) console.log(`[诊断] 真正发出去的 state 文本已留在 ${STATE_DUMP}（唯一能解释"两轮不同"的证据）`);
}
