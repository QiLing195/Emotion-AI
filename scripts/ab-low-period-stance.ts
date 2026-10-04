// ── v1.38 A/B：她自己在低谷、他带来好消息 —— 「准许低位回应」的片段值不值得开 ──
//
// 变量**只有一个**：同一个策略标签下、两块不同的策略片段文字。
//   A = 默认（开关关）：她拿到 `STRATEGY_PROMPT_SNIPPETS[策略]`。
//       好事 + 她沉 ⇒ Rule 1 给 `accompany` ⇒ 她拿到【沉默陪伴】（那段是**对着他**的：他在无力）。
//   B = 低谷立场（`ENABLE_LOW_PERIOD_STANCE=true`）：换成 `LOW_PERIOD_STANCE_SNIPPET`
//       —— 准许"挺好的"这类低位回应、不许假装高兴、也**不许冷处理**。
//
// 为什么只换文字不动标签：v1.31 判过"换策略标签无用"（已回滚），v1.36 换标签（accompany→empathize）
// 也没有收益、还模板塌缩；而真正推得动行为的杠杆一直在**内容块**（v1.29 片段改写、v1.30 整块不给）。
//
// ── 事先声明的判据（跑之前写死）──
//   ⚠️ 这套判据在**正式跑之前**改过一次，原因与改动范围都写在这里（改的是量尺，不是方向）：
//      预演（`--messages=p1,c1 --n=2`）量出 A 臂的 `hype` **本来就是 0** —— 在**当前默认**
//      （`ENABLE_STRATEGY_DIRECTION` 关）下，好事 + 她沉 ⇒ Rule 1 给 `accompany`，她拿到的是
//      【沉默陪伴】（一段为"他无力"写的指令），压根不会去假装高兴。所以"假装高兴下降"
//      **没有下降空间**，拿它当主终点只会得到一个恒为 0 的假结论。
//   ⇒ 改成以**她有没有接住这件好事**为主终点（这才是"片段错配"的直接后果），
//     并把"不假装高兴 / 不冷处理"降为**非劣**项（不许变差）。
//   主终点 「接住好事」`ack` 必须上升（B > A）
//   非劣   `hype` 不许上升（B ≤ A）；`cold`（对好事毫无正面指涉）不许更冷
//   护栏   `presencePhrase` 不许下降；`chars`/`probe`/`questions` 下降是预期的（不是终点）
//   对照   两条**负面**消息两臂的**片段**必须相同（变量只有一个）；逐字相同比例只作参考
//   操纵   ① `lowPeriod.established` 两臂都为 true（她确实在"一段"低谷里）
//           ② DUMP_PROMPT 抓到的**真 Prompt**：正面 B 有立场标记、A 没有；负面两臂都没有
//   人     最终裁定必须**人看过** `low-period-stance-rows.jsonl` 里的原文再下 ——
//          "短到像敷衍"这件事可数指标判不了。
//
// 判官不参与裁定：这一跑的主终点是**可数**的（判官有实测位置偏见 11/14，单次判决不可用）。
// 所有回复落盘到 `low-period-stance-rows.jsonl`，供人工过目。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-low-period-stance.ts [--n=4] [--messages=p1,p2] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { lowPeriodOf } from '../src/lib/lowPeriod.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const strArg = (n: string, d: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const N = Math.max(2, arg('n', 4));
const KEEP = process.argv.includes('--keep');

/** 与 `ab-strategy-direction.ts` **逐字相同**的 5 条正面 + 2 条负面对照（尺子一致，数字才可比） */
const MESSAGES = [
  { id: 'p1', kind: 'pos', text: '我今天升职了！老板终于认可我了。' },
  { id: 'p2', kind: 'pos', text: '我面试过了！下周一就能入职。' },
  { id: 'p3', kind: 'pos', text: '刚收到消息，我那个副业接到第一单了。' },
  { id: 'p4', kind: 'pos', text: '我喜欢的球队今天赢了，赢得很漂亮。' },
  { id: 'p5', kind: 'pos', text: '谢谢你一直在，这段时间要不是你我真的扛不过来。' },
  { id: 'c1', kind: 'neg', text: '我今天面试又挂了，真的特别难受。' },
  { id: 'c2', kind: 'neg', text: '我真的撑不住了，什么都不想做。' },
];
const ONLY = strArg('messages', '').split(',').map(s => s.trim()).filter(Boolean);
const POOL = ONLY.length ? MESSAGES.filter(m => ONLY.includes(m.id)) : MESSAGES;

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const MEM = 'memories';
const BAK = 'memories.ab-lps-bak';
const DUMP = '.tmp-ab-lps-prompt.txt';
const ROWS = 'low-period-stance-rows.jsonl';

/** 立场片段的**独有**标记：拿它当"这一轮真的走了新片段"的证据 */
const STANCE_MARKER = '本轮不适用';

type Arm = 'A' | 'B';
function applyArm(arm: Arm) {
  if (arm === 'B') process.env.ENABLE_LOW_PERIOD_STANCE = 'true';
  else delete process.env.ENABLE_LOW_PERIOD_STANCE;
}

/** 指标：与 `ab-strategy-direction.ts` 同口径；新增 `engage`/`hype`/`cold`（本跑的主终点与非劣项） */
const RE = {
  probe: /为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是/g,
  questions: /[？?]/g,
  presencePhrase: /我就?在|陪着你|我陪|不走|不用一个人/g,
  /** 旧口径的积极共鸣（含追问细节），保留作明细 */
  cheer: /真的|太好了|太棒|好棒|厉害|恭喜|哇|我就知道|值了|快跟我说说|怎么|哪[支个]|多少/g,
  /**
   * 主终点：**接住好事**（对好事的正面回应）= 低位承认 + 高能惊叹 + 具体肯定。
   *
   * ⚠️ 这把词表是**第一跑之后**才补的，而且是看了**回复原文**才发现尺子有缺陷：
   *    第一跑只数"低位承认词"（挺好/真好/恭喜…），可 A 臂天然的说法是
   *    **"哇，真的？恭喜你！"／"真的假的？第一单！"／"赢了就好"** —— 都不在那把词表里，
   *    于是 A 被判成"没接住"（cold=0.53），而 B 因为片段举的例子恰好就是词表里那几个词，被判成"接住了"。
   *    **那等于在量"她有没有照新指令说话"，而不是"她有没有接住他的事"。**
   *    现在按观察到的**双方**自然说法重写（方向不变，只是把 A 的说法也认出来）。
   */
  engage: /挺好|真不错|恭喜|替你高兴|为你高兴|为你开心|值得|不容易|辛苦了|太好了|太棒|好棒|太厉害|哇|天哪|我就知道|真的[吗的？!]|真的假的|值了|有回响|赢了就好|迈过去了|佩服/g,
  /** 明细：**低位承认**（立场片段的独有产物 —— 现行片段是**禁止**这类措辞的） */
  ack: /挺好|真不错|恭喜|替你高兴|为你高兴|为你开心|值得|不容易|辛苦了/g,
  /** 明细：**高能惊叹** */
  hype: /太好了|太棒|好棒|太厉害|哇|天哪|我就知道|真的[吗的？!]|真的假的|！{2,}/g,
  /** 跑偏：把话题拉回她自己（A 拿到的是【沉默陪伴】——那段是给"他无力"写的，用在他的好事上） */
  selfTalk: /我这两天|我这几天|我自己|我最近也|有点闷|我也累|我也撑|我状态/g,
  /** 陪伴话术（同一段片段的典型产物） */
  presenceTalk: /我陪|我在|不走|不用一个人/g,
  advice: /别急|原因|其实|说明|应该|至少|会好起来|没关系|想开/g,
};
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  const engage = count(RE.engage);
  return {
    chars: [...reply].length,
    probe: count(RE.probe),
    questions: count(RE.questions),
    presencePhrase: count(RE.presencePhrase),
    cheer: count(RE.cheer),
    engage,
    ack: count(RE.ack),
    hype: count(RE.hype),
    selfTalk: count(RE.selfTalk),
    presenceTalk: count(RE.presenceTalk),
    /** 冷处理：对好事**没有任何**正面回应（既没承认、也没惊叹、也没具体肯定） */
    cold: engage === 0 ? 1 : 0,
    advice: count(RE.advice),
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['engage', 'ack', 'hype', 'cold', 'selfTalk', 'presenceTalk', 'chars', 'probe', 'questions', 'presencePhrase', 'cheer', 'advice'];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
function signTest(diffs: number[]) {
  const win = diffs.filter(d => d > 0).length, lose = diffs.filter(d => d < 0).length;
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

interface Row {
  arm: Arm; id: string; kind: string; pair: number; strategy: string; snippet: string;
  metrics: Metrics; reply: string; stanceInPrompt: boolean; lowEstablished: boolean; lowNote: string;
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

  /**
   * 两臂共用的起始状态：静息 + **sad +0.20**（越进入门槛 0.12）
   * **并且**钉住一段**已成段**的低谷（30 小时 / 6 轮落定）。
   *
   * 为什么必须钉低谷本身（而不只钉情绪）：治疗方案的门是"**已成段**"（≥2 次落定），
   * 而 harness 每轮都把状态克隆回起点 ⇒ 光靠 `updateLowPeriod` 永远只攒到 1 轮、
   * `established` 恒 false ⇒ **开关开了也不会生效，会量到一个假的"没差别"**。
   * 这一段是把"她这几天在低谷"这件事**摆到台面上**，也正是人设裁定描述的场景。
   */
  const HERS = (() => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.20 };
    s.baselineEmotions = { ...baseline };
    const now = Date.now();
    s.lowPeriod = {
      since: now - 30 * 3_600_000,
      lastEvaluatedAt: now,
      peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0,
      turns: 6, selfRecovery: 0,
    };
    return s;
  })();

  console.log(`[她的起始状态] ${activationOf(HERS as never).note}`);
  console.log(`[钉住的低谷] ${lowPeriodOf(HERS as never).note}`);
  console.log(`[跑法] 他的消息 ${POOL.length} 条 × 2 臂 × n=${N}\n`);

  for (let pair = 1; pair <= N; pair++) {
    for (const m of POOL) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        applyArm(arm);
        srv.aiEngine.emotionState = structuredClone(HERS) as never;
        const c = aiCoordinator as unknown as Record<string, unknown>;
        c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
        conflictManager.reset();
        markInteraction(Date.now() - 3 * 60_000);

        // ⚠️ 偏移必须按**字符串长度**取，不能按文件字节数：中文一字 3 字节 / 1 个 UTF-16 码元，
        // 用 `statSync().size` 会让偏移随轮次越飘越远，表现为"操纵检查全灭"（ab-defer-anchor 踩过）。
        const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: m.text, userId: 'ab-lps', recentMessages: RECENT }),
        });
        const data = await res.json() as { response?: unknown; strategy?: unknown; emotionState?: unknown };
        if (typeof data.response !== 'string') {
          console.error(`   ✗ ${m.id}/${arm} /api/chat 没返回 response，跳过`);
          continue;
        }
        const reply = data.response;
        const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
        const stanceInPrompt = prompt.includes(STANCE_MARKER);
        const post = (data.emotionState ?? HERS) as never;
        const lp = lowPeriodOf(post);
        const dec = aiCoordinator.getLastStrategyDecision();
        const metrics = score(reply);
        rows.push({
          arm, id: m.id, kind: m.kind, pair,
          strategy: dec?.strategy ?? String(data.strategy ?? '?'),
          snippet: stanceInPrompt ? 'stance' : 'base',
          metrics, reply, stanceInPrompt, lowEstablished: lp.established, lowNote: lp.note,
        });
        console.log(`   [${arm}] ${m.id} p${pair} ${pad(dec?.strategy ?? '?', 10)} ${pad(stanceInPrompt ? '立场' : '原片段', 7)}`
          + ` ${String(metrics.chars).padStart(3)}字 高能${metrics.hype} 承认${metrics.ack} 追问${metrics.probe} 在场${metrics.presencePhrase}`);
      }
    }
  }

  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(84)}\n① 操纵检查\n${'='.repeat(84)}`);
  let manOk = true;
  for (const m of POOL) {
    const a = rows.filter(r => r.id === m.id && r.arm === 'A');
    const b = rows.filter(r => r.id === m.id && r.arm === 'B');
    const aS = [...new Set(a.map(r => r.snippet))].join('/');
    const bS = [...new Set(b.map(r => r.snippet))].join('/');
    const aEst = a.every(r => r.lowEstablished), bEst = b.every(r => r.lowEstablished);
    let note: string;
    if (m.kind === 'pos') {
      const ok = aS === 'base' && bS === 'stance';
      if (!ok) manOk = false;
      note = ok ? '✓ 正面：A 原片段 / B 立场片段' : `✗ 正面：没走出预期分支（A=${aS} B=${bS}）`;
    } else {
      const ok = aS === 'base' && bS === 'base';
      if (!ok) manOk = false;
      note = ok ? '✓ 对照：负面两臂都是原片段（变量只有一个）' : `✗ 对照：负面两臂不同（A=${aS} B=${bS}）⇒ 变量不止一个`;
    }
    if (!aEst || !bEst) { manOk = false; note += `｜✗ 低谷未成段（A=${aEst} B=${bEst}）—— 治疗方案根本没开门`; }
    console.log(`   ${pad(m.id, 4)}${pad(m.kind, 5)}A=${pad(aS, 7)}B=${pad(bS, 7)}${note}`);
  }
  console.log(`   低谷读数（A 臂样本）：${rows.find(r => r.arm === 'A')?.lowNote ?? 'n/a'}`);
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的数字不能当结论用'}`);

  // ── ② 各臂均值（只看正面消息：治疗方案只对它们生效）──
  const POS = POOL.filter(m => m.kind === 'pos').map(m => m.id);
  const posRows = rows.filter(r => r.kind === 'pos');
  console.log(`\n${'='.repeat(84)}\n② 各臂均值（均值±SD，只统计 ${POS.join('/')}）\n${'='.repeat(84)}`);
  console.log(pad('指标', 16) + pad('A 原片段', 18) + pad('B 立场片段', 18) + 'B−A');
  for (const k of KEYS) {
    const A = posRows.filter(r => r.arm === 'A').map(r => r.metrics[k]);
    const B = posRows.filter(r => r.arm === 'B').map(r => r.metrics[k]);
    const d = mean(B) - mean(A);
    console.log(pad(k, 16) + pad(`${mean(A).toFixed(2)}±${sd(A).toFixed(2)}`, 18)
      + pad(`${mean(B).toFixed(2)}±${sd(B).toFixed(2)}`, 18) + `${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
  }

  // ── ③ 配对符号检验 ──
  console.log(`\n${'='.repeat(84)}\n③ 配对符号检验（同句同 pair 相减，正面消息）\n${'='.repeat(84)}`);
  for (const k of ['hype', 'ack', 'chars', 'probe', 'questions', 'presencePhrase'] as Array<keyof Metrics>) {
    const diffs: number[] = [];
    for (const m of POOL.filter(x => x.kind === 'pos')) {
      for (let p = 1; p <= N; p++) {
        const a = rows.find(r => r.arm === 'A' && r.id === m.id && r.pair === p);
        const b = rows.find(r => r.arm === 'B' && r.id === m.id && r.pair === p);
        if (a && b) diffs.push(b.metrics[k] - a.metrics[k]);
      }
    }
    const { win, lose, p } = signTest(diffs);
    const dir = mean(diffs) < 0 ? 'B 更低' : mean(diffs) > 0 ? 'B 更高' : '持平';
    console.log(`   ${pad(k, 16)}B胜${win} A胜${lose}  p=${p.toFixed(3)}  均值差 ${mean(diffs).toFixed(2)}（${dir}）`);
  }

  // ── ④ 对照：负面消息两臂的**片段口径**（① 已断言）＋措辞逐字相同比例（参考，不是判据）──
  console.log(`\n${'='.repeat(84)}\n④ 负面对照（参考：逐字相同比例 —— 采样噪声会让它 <100%，别当判据）\n${'='.repeat(84)}`);
  for (const m of POOL.filter(x => x.kind === 'neg')) {
    let same = 0, total = 0;
    for (let p = 1; p <= N; p++) {
      const a = rows.find(r => r.arm === 'A' && r.id === m.id && r.pair === p);
      const b = rows.find(r => r.arm === 'B' && r.id === m.id && r.pair === p);
      if (a && b) { total++; if (a.reply === b.reply) same++; }
    }
    console.log(`   ${pad(m.id, 4)}逐字相同 ${same}/${total}（两臂**片段**已由 ① 断言相同 ⇒ 变量只有一个）`);
  }

  // ── ⑤ 主终点判定（照事先写死的判据）──
  const pairDiff = (k: keyof Metrics) => POOL.filter(x => x.kind === 'pos').flatMap(m =>
    Array.from({ length: N }, (_, i) => {
      const a = rows.find(r => r.arm === 'A' && r.id === m.id && r.pair === i + 1);
      const b = rows.find(r => r.arm === 'B' && r.id === m.id && r.pair === i + 1);
      return a && b ? b.metrics[k] - a.metrics[k] : null;
    }).filter((x): x is number => x !== null));
  const diffsEngage = pairDiff('engage'), diffsAck = pairDiff('ack'), diffsHype = pairDiff('hype');
  const diffsCold = pairDiff('cold'), diffsSelf = pairDiff('selfTalk');
  const diffsPresence = pairDiff('presencePhrase');
  const engage = signTest(diffsEngage), ack = signTest(diffsAck), hype = signTest(diffsHype);
  const cold = signTest(diffsCold), selfT = signTest(diffsSelf), presence = signTest(diffsPresence);
  const posRowsA = rows.filter(r => r.kind === 'pos' && r.arm === 'A');
  const posRowsB = rows.filter(r => r.kind === 'pos' && r.arm === 'B');
  const coldRate = (rs: Row[]) => (rs.length ? rs.reduce((s, r) => s + r.metrics.cold, 0) / rs.length : 0);

  console.log(`\n${'='.repeat(84)}\n⑤ 数据层面裁定（判据跑之前写死；最终裁定要人看过原文再下）\n${'='.repeat(84)}`);
  const engageUp = mean(diffsEngage) >= 0;
  const hypeOk = mean(diffsHype) <= 0;
  const coldOk = coldRate(posRowsB) <= coldRate(posRowsA);
  const presOk = mean(diffsPresence) >= 0;
  console.log(`   主终点 接住好事 engage：均值差 ${mean(diffsEngage).toFixed(2)}（B胜${engage.win} A胜${engage.lose} p=${engage.p.toFixed(3)}）⇒ ${engageUp ? '✓ 没变差' : '✗ 更接不住了'}`);
  console.log(`     明细 低位承认 ack：均值差 ${mean(diffsAck).toFixed(2)}（B胜${ack.win} A胜${ack.lose} p=${ack.p.toFixed(3)}）｜高能 hype：均值差 ${mean(diffsHype).toFixed(2)}（p=${hype.p.toFixed(3)}）`);
  console.log(`   非劣   不冷处理 cold 率：A=${coldRate(posRowsA).toFixed(2)} B=${coldRate(posRowsB).toFixed(2)} ⇒ ${coldOk ? '✓ 没更冷' : '✗ B 更冷 ⇒ 算输不算赢'}`);
  console.log(`   护栏   在场感 presencePhrase：均值差 ${mean(diffsPresence).toFixed(2)}（B胜${presence.win} A胜${presence.lose} p=${presence.p.toFixed(3)}）⇒ ${presOk ? '✓ 没掉' : '✗ 掉了（但注意：A 的在场词来自【沉默陪伴】那段**本身**就是错配的片段）'}`);
  console.log(`   参考   跑偏 selfTalk：均值差 ${mean(diffsSelf).toFixed(2)}（p=${selfT.p.toFixed(3)}）—— 若样本里逐字出现片段举的例句，那是**我的文本泄漏**，不是她的行为`);
  const charsA = mean(posRowsA.map(r => r.metrics.chars)), charsB = mean(posRowsB.map(r => r.metrics.chars));
  const sdB = sd(posRowsB.map(r => r.metrics.chars));
  console.log(`   参考   字数：A=${charsA.toFixed(1)}（SD ${sd(posRowsA.map(r => r.metrics.chars)).toFixed(1)}） B=${charsB.toFixed(1)}（SD ${sdB.toFixed(1)}）`);
  console.log(`          ⇒ B 的**方差**比均值更值得看：SD 大 = 时而过短时而超长（模板塌缩／自我倾泻是同一根轴的两端）`);
  console.log(`          ⇒ 必看 ${ROWS} 里的原文再定；若普遍过短，正确的下一步是给片段**加下限**，不是把方向判死`);
  console.log(`   操纵检查${manOk ? '通过' : '**没过**（上面的数字不能当结论用）'}`);
  console.log(`   ⇒ 数据层面：${manOk && engageUp && hypeOk && coldOk && presOk ? '**达标**（仍须人看原文）' : '**未达标**'}；开关默认关，代码留着`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
