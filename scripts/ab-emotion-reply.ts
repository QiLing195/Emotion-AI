// scripts/ab-emotion-reply.ts
//
// 端到端验收 + **去纠缠**：她的情绪到底经由哪条路改变了她说的那句话？
//
// 背景（v1.27 第一次跑出来的结论）：机制成立（她的状态 → 策略 → Prompt 片段确实换了），
// 但**文本层没兑现** —— B 组（accompany）反而更长、更爱讲道理。
// 但第一版只有两个臂，而两臂之间**差了两样东西**：
//   ① 进 Prompt 的**策略片段**（empathize vs accompany）
//   ② 她的**状态本身**（状态会经"记忆召回打分 / 模式注入的 drives / 动机"间接进入 Prompt ——
//      实测 Prompt 组装里**没有**一段直接写她情绪的"状态块"，她的状态是**间接**进来的）
// 所以那轮**分不开**"片段没被遵守"和"状态让她多话"。
//
// 本版用**三个臂**把它拆开（`ACCOMPANY_WHEN_SHE_SINKS = 0.12` 是分界线）：
//
//   A：静息（0.00）        → 策略 empathize   片段 = 共情跟随
//   C：sad +0.10（不越线）  → 策略 empathize   片段 = 共情跟随   ← 与 A **同片段**、只差状态
//   B：sad +0.20（越线）    → 策略 accompany   片段 = 沉默陪伴   ← 与 C **状态同类**（都是难过）、差片段
//
// 三臂读法：
//   · A vs C = **状态**的净效应（片段不变）
//   · C vs B = **片段**的净效应（状态都读作"难过"，只差幅度 0.10→0.20）
//   若 C≈A 而 B≫C ⇒ 变化来自**片段**；若 C≫A 而 B≈C ⇒ 变化来自**状态**。
//
// 其他设计同 v1.27：
//   · 走**真实 HTTP 管道**（真 express + 真 Prompt 组装 + 真 provider）
//   · 同一个他、同一句话、同一段 `recentMessages`（历史由客户端传入、服务端不留 → 天然可控）
//   · 每臂 n≥4，轮转执行抵消顺序效应；每次都是**同一句他**
//   · ⚠️ 这条分支**依赖 LLM NLU**：本地词典对这类句子只给 0.04~0.10（见 `scripts/probe-local-nlu.ts`），
//     够不到 0.7 ⇒ 本脚本不设 `DISABLE_LLM_NLU`，并按**实测强度 ≥ 0.7** 筛有效对照
//   · 副作用：真实管道会写 `memories/`。先整目录备份，结束（含异常）后原样恢复 —— 实验不留痕
//     ⚠️ 跑之前先停掉 3000 端口的服务（两个实例同时写记忆 = 最伤数据的状态）
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/ab-emotion-reply.ts [--n=4] [--keep]

import { cpSync, rmSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { ACCOMPANY_WHEN_SHE_SINKS, STRATEGY_PROMPT_SNIPPETS } from '../src/lib/dialogueStrategy.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const N = Math.max(2, arg('n', 4));          // 每个"三臂组"算一对，共 N 对
const MAX_ATTEMPTS = N * 3;                  // 强度不够被丢弃时的上限
const KEEP = process.argv.includes('--keep');
/** `--message=...` 跳过标定直接用这句话（省钱）；`--arms=A,C` 只跑部分臂（钉通道时够用） */
const FIXED_MESSAGE = process.argv.find(a => a.startsWith('--message='))?.slice('--message='.length) ?? '';
const ARM_FILTER = (process.argv.find(a => a.startsWith('--arms='))?.slice('--arms='.length) ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const MEM = 'memories';
const BAK = 'memories.ab-reply-bak';

/** 三个臂：sad 位移是唯一变量（0 = 静息；0.10 不越 0.12 门限；0.20 越线） */
const ALL_ARMS = [
  { id: 'A' as const, sad: 0.00, want: 'empathize', label: '静息（不越线）' },
  { id: 'C' as const, sad: 0.10, want: 'empathize', label: 'sad +0.10（不越线）' },
  { id: 'B' as const, sad: 0.20, want: 'accompany', label: 'sad +0.20（越线）' },
];
const ARMS = ARM_FILTER.length ? ALL_ARMS.filter(a => ARM_FILTER.includes(a.id)) : ALL_ARMS;
type ArmId = (typeof ALL_ARMS)[number]['id'];

/**
 * 候选"他这句话"：从轻到重。标定阶段逐句实测
 * 「LLM 给的强度」与「单轮把她推到多深」，挑一句强度 ≥ 0.7 的。
 */
const CANDIDATES = [
  '今天挺不顺的，面试没过。',
  '我今天面试又挂了，挺难受的。',
  '我今天面试又挂了，感觉自己挺没用的。',
  '我今天面试又挂了，真的特别难受。',
  '我今天面试又挂了，真的特别难受，感觉自己特别没用。',
];
/** 三臂逐字相同的上下文（历史由客户端传入，所以这里是唯一来源） */
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

interface Row {
  arm: ArmId;
  pair: number;
  attempt: number;
  strategy: string;
  reason: string;
  userIntensity: number;
  herBefore: string;
  negBefore: number;      // 这一轮**开始前**她的最大负情绪位移（臂构造是否落到位，看它）
  herAfter: string;
  negAfter: number;       // 单轮被推多深
  snippetHead: string;
  recallCount: number;    // Prompt 通道之一：这轮召回了几条记忆
  patternCount: number;   // Prompt 通道之二：模式注入候选数
  /** 状态**间接**进 Prompt 的另外三条路（server.ts 里逐条可查）：动机片段 / 心情提示 / 反刍提示 */
  motive: string;
  mood: string;
  rumination: string;
  injected: string[];     // 真正进了 Prompt 的记忆摘要（内容是否随状态变）
  /**
   * `shouldDeferToUser` 的**原样输入**：让位门槛是 `userIntensity ≥ 0.6 && sad+fear+anger ≥ 0.35`
   * （**绝对值**，不是相对本性的激活量），而且读的是**被本轮刺激推动之后**的状态。
   * 把这两个数记下来，才能判断"让位与否"是被她**本来**的状态决定，还是被**他这一句**顶过去的。
   */
  negSum: number;
  deferred: boolean;
  /** v1.28 让位时真正进 Prompt 的锚（/state → motive.thisTurn.deferAnchor） */
  anchor: string;
  reply: string;
}

/**
 * 回复文本指标：按各自片段的**明文要求**打分。
 *
 * ⚠️ 第一版的口径错误（记着别再犯）：`advice` 词表里曾把「**先别急**着给自己下结论」算成"陪伴词"，
 * 而那其实是**劝解/讲道理** —— 指标写着陪伴、实际在分析，结论会整个反过来。
 * 现在分成 `presence`（片段明写要的）与 `advice`（empathize 片段明写不要的）两组。
 */
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    sentences: count(/[。！？!?]/g),
    questions: count(/[？?]/g),
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是/g),
    /** 在场感：accompany 片段明写「"我在"，"我陪着你"比任何建议都有力量」 */
    presence: count(/我在|陪着你|陪你|抱着|抱抱|我一直|不用一个人/g),
    /** 分析/劝解：empathize 片段明写「不要急于给出建议或解决方案」 */
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    empathy: count(/我懂|明白|听起来|感觉你|辛苦了|心疼|难受|委屈|泄气/g),
    stage: count(/（[^）]{2,12}）/g),
  };
}
type Metrics = ReturnType<typeof score>;
const METRIC_KEYS: Array<keyof Metrics> = ['chars', 'sentences', 'questions', 'probe', 'presence', 'advice', 'empathy', 'stage'];

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
  const armState = (arm: ArmId) => {
    const spec = ARMS.find(a => a.id === arm)!;
    const s = structuredClone(real) as typeof real;
    s.emotions = { ...baseline };
    s.baselineEmotions = { ...baseline };
    if (spec.sad > 0) s.emotions.sad = (baseline.sad ?? 0) + spec.sad;
    return s;
  };

  /** 走一轮真实管道：设定她的起始状态 → POST /api/chat → 收取策略与回复 */
  async function callOnce(arm: ArmId, message: string): Promise<Omit<Row, 'pair' | 'attempt'>> {
    const before = armState(arm);
    srv.aiEngine.emotionState = before as never;
    // 协调器自己的滑动窗口也要归零，否则后跑的臂会带着先跑的臂的历史
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = [];
    c.topicHistory = [];
    c.herValenceHistory = [];

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, userId: 'ab-reply', recentMessages: RECENT }),
    });
    const data = await res.json() as Record<string, never>;
    if (typeof data.response !== 'string') {
      console.error(`[中断] /api/chat 没有返回 response：${JSON.stringify(data).slice(0, 300)}`);
      throw new Error('chat 调用失败（见上）');
    }
    const strategy = String(data.strategy ?? '?');
    const afterState = (data.emotionState ?? before) as never;
    const dAfter = activationOf(afterState).delta as Record<string, number>;
    const dBefore = activationOf(before as never).delta as Record<string, number>;
    const maxNeg = (d: Record<string, number>) => Math.max(d.sad ?? 0, d.fear ?? 0, d.anger ?? 0);
    const ctx = data.memoryContext as unknown as unknown[] | undefined;
    const pats = data.relevantPatterns as unknown as unknown[] | undefined;
    // 同一台服务器上再取一次 /state：把「她的状态**间接**进了 Prompt 的哪几条路」记录下来。
    // 这一步不花 LLM 调用（本机 GET），但能直接指认通道，省掉下去猜。
    let motive = '—';
    let mood = '—';
    let rumination = '—';
    let injected: string[] = [];
    let anchor = '';
    try {
      const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
      const m = st.motive as never as {
        thisTurn?: { kind?: string; deferred?: boolean; reason?: string; deferAnchor?: { content?: string } | null };
      } | undefined;
      motive = m?.thisTurn
        ? `${m.thisTurn.kind ?? '（没说）'}${m.thisTurn.deferred ? '·让位给他' : ''}｜${m.thisTurn.reason ?? ''}`
        : '尚未竞选';
      anchor = m?.thisTurn?.deferAnchor?.content ?? '';
      const md = st.mood as never as { description?: string; samples?: number } | undefined;
      mood = md?.samples ? `${md.description}` : '样本不足';
      const ru = st.rumination as never as { emotion?: string; streak?: number } | undefined;
      rumination = ru?.streak ? `${ru.emotion} ×${ru.streak}` : '无';
      const tr = st.memoryTrace as never as { injected?: Array<{ source: string; emotion: string | null; text: string }> } | undefined;
      injected = (tr?.injected ?? []).map(e => `${e.source}/${e.emotion ?? '-'}:${(e.text ?? '').slice(0, 16)}`);
    } catch { /* 记录失败不影响主流程 */ }
    // 让位判定的两个原样输入（口径与 shouldDeferToUser 完全一致）
    const emoAfter = (afterState as never as { emotions?: Record<string, number> }).emotions ?? {};
    const negSum = (emoAfter.sad ?? 0) + (emoAfter.fear ?? 0) + (emoAfter.anger ?? 0);
    const deferred = /让位/.test(motive);
    return {
      arm,
      strategy,
      reason: String(data.strategyReason ?? ''),
      userIntensity: Number((data.emotionAnalysis as never as { user?: { intensity?: number } })?.user?.intensity ?? 0),
      herBefore: activationOf(before as never).note,
      negBefore: maxNeg(dBefore),
      herAfter: activationOf(afterState).note,
      negAfter: maxNeg(dAfter),
      snippetHead: (STRATEGY_PROMPT_SNIPPETS as Record<string, string>)[strategy]?.split('\n')[0] ?? '（无片段）',
      recallCount: Array.isArray(ctx) ? ctx.length : 0,
      patternCount: Array.isArray(pats) ? pats.length : 0,
      motive,
      mood,
      rumination,
      injected,
      negSum,
      deferred,
      anchor,
      reply: data.response,
    };
  }

  console.log(`\n[三个臂] 唯一变量 = 她**这一轮开始前**的 sad 位移（陪伴门限 ${ACCOMPANY_WHEN_SHE_SINKS}）`);
  for (const a of ARMS) console.log(`   ${a.id}: sad +${a.sad.toFixed(2)} → 预期策略 ${a.want}　${a.label}`);
  console.log(`[片段首行] empathize → ${STRATEGY_PROMPT_SNIPPETS.empathize.split('\n')[0]}`);
  console.log(`           accompany → ${STRATEGY_PROMPT_SNIPPETS.accompany.split('\n')[0]}`);

  // ── 标定阶段：选一句"他情绪强烈"的话，并量出单轮把她推多深 ──
  let HIS_MESSAGE = FIXED_MESSAGE;
  if (!HIS_MESSAGE) {
    console.log('\n══ ⓪ 标定：一句负面话当场把她推多深？（A 臂起始=静息）══\n');
    console.log('他这句话                                  强度   这一轮结束时她的激活态                          单轮负位移  本轮策略');
    for (const cand of CANDIDATES) {
      const r = await callOnce('A', cand);
      const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));
      console.log(
        `${pad(cand, 40)} ${r.userIntensity.toFixed(2)}   ${pad(r.herAfter, 46)} +${r.negAfter.toFixed(3)}      ${r.strategy}`,
      );
      if (!HIS_MESSAGE && r.userIntensity >= 0.7) HIS_MESSAGE = cand;
    }
    if (!HIS_MESSAGE) {
      console.log('\n⚠️ 没有候选句的强度 ≥ 0.7 —— 这轮对话根本进不了 Rule 1 的分支，无法构造对照。');
      throw new Error('标定未通过：没有够强的他这句话');
    }
  } else {
    console.log(`\n[跳过标定] 用 --message 指定的他这句话（省 LLM 调用）`);
  }
  console.log(`\n[选定] 他这句话 = 「${HIS_MESSAGE}」`);

  let pair = 0;
  let attempt = 0;
  let dropped = 0;
  while (pair < N && attempt < MAX_ATTEMPTS) {
    attempt++;
    // 轮转顺序：抵消"先跑的臂占到某种便宜"的顺序效应
    const order = ARMS.map(a => a.id);
    const shift = attempt % order.length;
    const rotated = [...order.slice(shift), ...order.slice(0, shift)];
    const thisPair: Partial<Record<ArmId, Row>> = {};
    for (const arm of rotated) {
      thisPair[arm] = { ...(await callOnce(arm, HIS_MESSAGE)), pair: pair + 1, attempt };
    }
    const got = ARMS.map(a => thisPair[a.id]!);
    // 有效对照：他必须真的强到能触发 Rule 1（阈值 0.7，对齐 LLM 的 0.1 量化刻度 → 用 >=）
    if (got.every(r => r.userIntensity >= 0.7)) {
      pair++;
      for (const r of got) r.pair = pair;
      rows.push(...got);
      console.log(`✓ 第 ${pair} 对（第 ${attempt} 次尝试）：他强度 ${got.map(r => r.userIntensity.toFixed(2)).join(' / ')}`
        + ` → ${got.map(r => `${r.arm}=${r.strategy}`).join('  ')}`);
    } else {
      dropped++;
      console.log(`✗ 丢弃第 ${attempt} 次尝试：他强度 ${got.map(r => r.userIntensity.toFixed(2)).join(' / ')}`
        + ` —— 有臂没进"他情绪强烈"分支`);
    }
  }

  if (rows.length === 0) {
    console.log('\n没有拿到任何有效对照 —— 说明 LLM NLU 对这句话给出的强度总 < 0.7，换一句更强烈的他试试。');
  }

  // ── 报告 ──
  const armRows = (arm: ArmId) => rows.filter(r => r.arm === arm);
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].length));

  console.log('\n══ ① 机制：臂有没有落到位（确定性那一半）══\n');
  for (const a of ARMS) {
    const rs = armRows(a.id);
    if (!rs.length) continue;
    const strategies = [...new Set(rs.map(r => r.strategy))];
    const ok = strategies.length === 1 && strategies[0] === a.want ? '✓' : '⚠️';
    console.log(`${a.id} 臂（${a.label}）${ok}`);
    console.log(`   本轮开始前她的负位移实测：+${rs[0].negBefore.toFixed(3)}（期望 +${a.sad.toFixed(2)}）　激活态读数：${rs[0].herBefore}`);
    console.log(`   策略：${strategies.join(' / ')}（期望 ${a.want}）`);
    console.log(`   理由：${rs[0].reason}`);
    console.log(`   片段：${rs[0].snippetHead}`);
    console.log(`   单轮被推 +${rs[0].negAfter.toFixed(3)} → 本轮结束后：${rs[0].herAfter}\n`);
  }

  console.log('══ ② 回复原文（同一句话、同一段上下文；按三臂并排看）══\n');
  for (let p = 1; p <= pair; p++) {
    console.log(`[第 ${p} 对]`);
    for (const a of ARMS) {
      const r = rows.find(x => x.arm === a.id && x.pair === p);
      if (r) console.log(`  ${a.id}（${r.strategy}/${a.label}）：${r.reply}`);
    }
    console.log('');
  }

  console.log(`══ ③ 指标（均值±SD；n=${pair} 对）══\n`);
  const header = ['指标'.padEnd(10), ...ARMS.map(a => `${a.id} 臂`.padEnd(16)), 'C−A（状态）'.padEnd(14), 'B−C（片段）'];
  console.log(header.join(''));
  for (const k of METRIC_KEYS) {
    const cols = ARMS.map(a => {
      const v = armRows(a.id).map(r => score(r.reply)[k]);
      return `${mean(v).toFixed(2)}±${sd(v).toFixed(2)}`.padEnd(16);
    });
    const cMinusA = (armRows('C').length && armRows('A').length)
      ? armRows('C').map((r, i) => score(r.reply)[k] - score(armRows('A')[i].reply)[k]) : [];
    const bMinusC = (armRows('B').length && armRows('C').length)
      ? armRows('B').map((r, i) => score(r.reply)[k] - score(armRows('C')[i].reply)[k]) : [];
    const sCA = signTest(cMinusA);
    const sBC = signTest(bMinusC);
    console.log(
      `${k.padEnd(10)}${cols.join('')}`
      + `${((mean(cMinusA) >= 0 ? '+' : '') + mean(cMinusA).toFixed(2)).padEnd(14)}`
      + `${(mean(bMinusC) >= 0 ? '+' : '') + mean(bMinusC).toFixed(2)}　`
      + `(C−A ${sCA.win}胜/${sCA.lose}负 p=${sCA.p.toFixed(2)}；B−C ${sBC.win}胜/${sBC.lose}负 p=${sBC.p.toFixed(2)})`,
    );
  }

  console.log('\n══ ④ 她的状态**间接**进 Prompt 的通道（逐条对照，看是哪一条在变）══\n');
  console.log('· 已从代码确认的通道：`motiveToPromptSnippet`（动机）/ `moodHint`（底色心情）/ `ruminationHint`（反刍）');
  console.log('  + 记忆注入的**内容**；Prompt 里**没有**一段直接描述她情绪的"状态块"。\n');
  console.log('· **v1.28 之后**让位判定已改为「强度 ≥0.6 且 **本轮开始前**的激活量 ≥ 0.12」；');
  console.log('  下面记的 `sad+fear+anger` 是**旧口径的输入**（绝对值、刺激之后），只作对照 ——');
  console.log('  它恰恰说明"他这一句的推力"有多大（静息的她也能被推到 0.32~0.42），而新口径不再被它翻动。\n');
  for (const a of ARMS) {
    const rs = armRows(a.id);
    if (!rs.length) continue;
    const sums = rs.map(r => r.negSum);
    const deferCount = rs.filter(r => r.deferred).length;
    const ints = rs.map(r => r.userIntensity);
    console.log(`${a.id} 臂：强度 ${mean(ints).toFixed(2)}　sad+fear+anger = ${mean(sums).toFixed(3)}±${sd(sums).toFixed(3)}`
      + `（门槛 0.35，逐条 ${sums.map(v => v.toFixed(3)).join('/')}）　让位 ${deferCount}/${rs.length}`);
    console.log(`      召回 ${mean(rs.map(r => r.recallCount)).toFixed(1)} 条　模式候选 ${mean(rs.map(r => r.patternCount)).toFixed(1)} 个`);
    console.log(`      动机：${rs[0].motive}`);
    console.log(`      让位锚：${rs[0].anchor || '—'}`);
    console.log(`      心情：${rs[0].mood}　反刍：${rs[0].rumination}`);
    console.log(`      进了 Prompt 的记忆：${rs[0].injected.length ? rs[0].injected.join(' | ') : '（无）'}`);
  }
  // 通道是否随状态变化：把每臂的"通道指纹"做个集合比较
  //
  // ⚠️ 第一版写错了：只查 `fi ⊆ fj` 就打印"完全相同"—— 当 C 臂**部分轮次**让位时，
  // 它的指纹集合同时含"有动机"与"让位"两种，A 的集合是它的子集，于是被误判成"没差别"。
  // 子集 ≠ 相等；必须双向都查。
  const fingerprint = (a: ArmId) => new Set(armRows(a).map(r => `${r.motive}|${r.mood}|${r.rumination}|${r.injected.join('~')}`));
  for (let i = 0; i < ARMS.length; i++) {
    for (let j = i + 1; j < ARMS.length; j++) {
      const fi = fingerprint(ARMS[i].id);
      const fj = fingerprint(ARMS[j].id);
      const iSubJ = [...fi].every(x => fj.has(x));
      const jSubI = [...fj].every(x => fi.has(x));
      const verdict = iSubJ && jSubI
        ? '**完全相同**（状态没动这些通道）'
        : (iSubJ || jSubI)
          ? `**部分轮次不同**：${ARMS[i].id} 有 ${fi.size} 种指纹、${ARMS[j].id} 有 ${fj.size} 种（其中一臂在某些轮次上翻转）`
          : '**不同**（状态确实改动了 Prompt 内容）';
      console.log(`\n${ARMS[i].id} vs ${ARMS[j].id} 的通道指纹：${verdict}`);
    }
  }

  console.log('\n══ ⑤ 判读（脚本不下结论，人来判）══\n');
  console.log('· **A vs C**（片段相同、状态不同）= 状态净效应；**C vs B**（状态同类、片段不同）= 片段净效应。');
  console.log('  · 若 C≈A 且 B≫C ⇒ 上一轮观察到的"更长/更爱讲道理"来自**片段**（模型没照片段做）。');
  console.log('  · 若 C≫A 且 B≈C ⇒ 来自**状态本身**（那 v1.15 那条规则的意义就要重新评估）。');
  console.log(`· 样本量：每臂 ${pair} 条、都是**同一句他**。LLM 采样有抖动；`);
  console.log(`  理想分裂下 n=${pair} 的精确 p ≈ ${signTest(Array.from({ length: pair }, () => 1)).p.toFixed(3)}`
    + `（n 小达不到 0.05 是抽样功效的极限，不是效应不存在）——以**原文判读**为准，指标只是把手感变成数字。`);
  console.log(`· 丢弃 ${dropped} / 尝试 ${attempt}（有臂强度 <0.7 的组不计入对照）。`);
} finally {
  try { listener?.close(); } catch { /* ignore */ }
  restore();
}
