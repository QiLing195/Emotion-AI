// scripts/ab-strategy-direction.ts
//
// v1.36 结构改动（**好事不许走"安静陪着"**）的真管道 A/B。
//
// 为什么不能拿账本直接当 A/B：这个分支只在**两个条件同时成立**时发作 ——
// ①他情绪强度 ≥0.7 ②她**本轮开始前**就已经沉在里面（≥0.12）。
// 20 条账本样本里只有 s10 同时满足 ⇒ 拿真状态下跑，新分支几乎不会触发，
// 会量出"没差别"然后**误判成"改动没用"**。所以本脚本把她钉在「静息 + sad 0.20」，
// 让两臂都真的走到那条分支上。
//
// 两臂（唯一变量）：
//   A = `DISABLE_STRATEGY_DIRECTION=true`（旧行为：只看强度，好事也被推去安静陪着）
//   B = 默认（新行为：是好事就走 empathize，用它片段里的「积极情绪的共鸣」那一档）
//
// 输出：逐样本原文（指标是尺子，原文才是事实）+ 配对符号检验 + 判官正反两问（粗筛）。
// ⚠️ 判官有已知位置偏见（v1.35 实测 11/14），所以只取"正反一致"的判决，且只当粗筛。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/ab-strategy-direction.ts [--n=4] [--messages=…] [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { activationOf, RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { generateAIResponse, type AISettings } from '../src/lib/aiProvider.js';
import { buildPairwisePrompt, parsePairwise } from '../src/lib/replyJudge.js';

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

/** 正面样本（+ 两条负面**对照**：它们在两臂下必须**一模一样**，否则说明变量不止一个） */
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
const BAK = 'memories.ab-dir-bak';

type Arm = 'A' | 'B';
function applyArm(arm: Arm) {
  if (arm === 'A') process.env.DISABLE_STRATEGY_DIRECTION = 'true';
  else delete process.env.DISABLE_STRATEGY_DIRECTION;
}

/** 指标：与 `ab-laya-strategy.ts` / v1.29 同口径（措辞逐字相同，数字才可比） */
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办|还是/g),
    questions: count(/[？?]/g),
    /** 目前最全的在场口径（`我就?在` 覆盖 我在／我就在／我在这儿／我就在这儿） */
    presencePhrase: count(/我就?在|陪着你|我陪|不走|不用一个人/g),
    /** 积极共鸣（判"好事接得好不好"最直接的一把尺子：惊叹/追问细节/具体赞美） */
    cheer: count(/真的|太好了|太棒|好棒|厉害|恭喜|哇|我就知道|值了|快跟我说说|怎么|哪[支个]|多少/g),
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|想开/g),
  };
}
type Metrics = ReturnType<typeof score>;
const KEYS: Array<keyof Metrics> = ['chars', 'probe', 'questions', 'presencePhrase', 'cheer', 'advice'];
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
function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (!d || d === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY 不可用');
  return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 } as AISettings;
}

{
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑（会同时写 memories/）—— 先停掉它。'); process.exit(3); }
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });

interface Row { arm: Arm; id: string; kind: string; text: string; pair: number; strategy: string; reason: string; reply: string }
const rows: Row[] = [];
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
  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;
  /** 两臂共用起始状态：静息 + **sad +0.20**（越过 0.12 ⇒ "她本来就已经沉进去了"） */
  const HERS = (() => {
    const s = structuredClone(real) as typeof real;
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.20 };
    s.baselineEmotions = { ...baseline };
    return s;
  })();
  console.log(`[管道] ${url}｜他的消息 ${POOL.length} 条 × 2 臂 × n=${N}`);
  console.log(`[她的起始状态] ${activationOf(HERS as never).note}（钉住 ⇒ 新分支可达；否则会量到"没差别"而误判）`);

  for (let pair = 1; pair <= N; pair++) {
    for (const m of POOL) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        applyArm(arm);
        srv.aiEngine.emotionState = structuredClone(HERS) as never;
        const c = aiCoordinator as unknown as Record<string, unknown>;
        c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
        conflictManager.reset();
        markInteraction(Date.now() - 3 * 60_000);
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: m.text, userId: 'ab-dir', recentMessages: RECENT }),
        });
        const data = await res.json() as { response?: unknown };
        const reply = typeof data.response === 'string' ? data.response : '';
        const dec = aiCoordinator.getLastStrategyDecision();
        if (!reply || !dec) { console.log(`   ✗ ${m.id}/${arm} 没拿到回复或裁决，跳过`); continue; }
        rows.push({ arm, id: m.id, kind: m.kind, text: m.text, pair, strategy: dec.strategy, reason: dec.reason, reply });
        const s = score(reply);
        console.log(`   [${arm}] ${m.id} p${pair} ${pad(dec.strategy, 10)} ${String(s.chars).padStart(3)}字 追问${s.probe} 积极${s.cheer} 在场${s.presencePhrase}`);
      }
    }
  }

  // ── 操纵检查：两臂必须真的走了不同分支；负面**对照**必须一模一样 ──
  console.log(`\n${'='.repeat(78)}\n① 操纵检查\n${'='.repeat(78)}`);
  for (const m of POOL) {
    const a = rows.filter(r => r.id === m.id && r.arm === 'A');
    const b = rows.filter(r => r.id === m.id && r.arm === 'B');
    const aS = [...new Set(a.map(r => r.strategy))].join('/');
    const bS = [...new Set(b.map(r => r.strategy))].join('/');
    const note = m.kind === 'pos'
      ? (aS !== bS ? '✓ 两臂策略不同（新分支生效）' : '⚠️ 两臂策略相同 —— 这条没触发新分支')
      : (aS === bS ? '✓ 对照：两臂策略相同（变量只有一个）' : '✗ 对照竟然也不同 ⇒ 变量不止一个');
    console.log(`   ${pad(m.id, 4)}${pad(m.kind, 5)}A=${pad(aS, 11)}B=${pad(bS, 11)}${note}`);
  }

  console.log(`\n${'='.repeat(78)}\n② 各臂均值（均值±SD）\n${'='.repeat(78)}`);
  console.log(pad('指标', 16) + pad('A 旧行为', 18) + pad('B 新行为', 18) + 'B−A');
  for (const k of KEYS) {
    const A = rows.filter(r => r.arm === 'A').map(r => score(r.reply)[k]);
    const B = rows.filter(r => r.arm === 'B').map(r => score(r.reply)[k]);
    const d = mean(B) - mean(A);
    console.log(pad(k, 16) + pad(`${mean(A).toFixed(2)}±${sd(A).toFixed(2)}`, 18)
      + pad(`${mean(B).toFixed(2)}±${sd(B).toFixed(2)}`, 18) + `${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
  }

  console.log(`\n${'='.repeat(78)}\n③ 配对符号检验（同句同 pair 相减；n 小、分布未知）\n${'='.repeat(78)}`);
  for (const k of ['cheer', 'probe', 'chars', 'presencePhrase'] as Array<keyof Metrics>) {
    const diffs: number[] = [];
    for (const m of POOL) for (let p = 1; p <= N; p++) {
      const a = rows.find(r => r.arm === 'A' && r.id === m.id && r.pair === p);
      const b = rows.find(r => r.arm === 'B' && r.id === m.id && r.pair === p);
      if (a && b) diffs.push(score(b.reply)[k] - score(a.reply)[k]);
    }
    const t = signTest(diffs);
    console.log(`   ${pad(k, 16)}${t.win}胜${t.lose}负 p=${t.p.toFixed(3)}（n=${diffs.length} 对）`);
  }

  // ── 判官：正反两问，只有一致才计数（它有已知位置偏见）──
  console.log(`\n${'='.repeat(78)}\n④ 判官（粗筛；只取正反一致的判决）\n${'='.repeat(78)}`);
  let bWin = 0, aWin = 0, tie = 0, unstable = 0;
  for (const m of POOL) {
    for (let p = 1; p <= N; p++) {
      const a = rows.find(r => r.arm === 'A' && r.id === m.id && r.pair === p);
      const b = rows.find(r => r.arm === 'B' && r.id === m.id && r.pair === p);
      if (!a || !b || a.reply === b.reply) continue;   // 两臂逐字相同 ⇒ 不用问判官
      const c = { userMessage: m.text, situation: `他情绪强度偏高；她本轮开始前**本来就已经沉在里面**（sad +0.20）` };
      const fwd = parsePairwise(await generateAIResponse(settings(), '你是严格的对话评审。只输出 JSON。', buildPairwisePrompt(c, a.reply, b.reply), false, 0.1));
      const rev = parsePairwise(await generateAIResponse(settings(), '你是严格的对话评审。只输出 JSON。', buildPairwisePrompt(c, b.reply, a.reply), false, 0.1));
      const revAsFwd = rev ? (rev.winner === 'A' ? 'B' : rev.winner === 'B' ? 'A' : 'tie') : null;
      if (!fwd || !revAsFwd || fwd.winner !== revAsFwd) { unstable++; console.log(`   ${m.id} p${p}：正反不一致（${fwd?.winner ?? '?'} vs ${revAsFwd ?? '?'}）→ 不计`); continue; }
      if (fwd.winner === 'B') bWin++; else if (fwd.winner === 'A') aWin++; else tie++;
      console.log(`   ${m.id} p${p}：${fwd.winner === 'tie' ? '一样' : `${fwd.winner} 更好`}　${(fwd.because || '').slice(0, 60)}`);
    }
  }
  console.log(`   → B(新) 胜 ${bWin}｜A(旧) 胜 ${aWin}｜一样 ${tie}｜位置不稳排除 ${unstable}`);

  console.log(`\n${'='.repeat(78)}\n⑤ 原文（指标是尺子，原文才是事实）\n${'='.repeat(78)}`);
  for (const m of POOL) {
    console.log(`\n── ${m.id}（${m.kind}）「${m.text}」`);
    for (const arm of ['A', 'B'] as Arm[]) {
      for (const r of rows.filter(x => x.arm === arm && x.id === m.id)) {
        console.log(`   [${arm}] ${pad(r.strategy, 11)}「${r.reply.replace(/\n+/g, ' / ')}」`);
      }
    }
  }
} finally {
  if (listener) (listener as unknown as { close: () => void }).close();
  if (KEEP) console.log(`[恢复] --keep：跳过；备份在 ${BAK}`);
  else {
    rmSync(MEM, { recursive: true, force: true });
    cpSync(BAK, MEM, { recursive: true });
    rmSync(BAK, { recursive: true, force: true });
    console.log('[恢复] memories/ 已还原');
  }
}
