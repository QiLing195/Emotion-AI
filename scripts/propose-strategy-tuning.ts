// scripts/propose-strategy-tuning.ts
//
// v1.34 **离线提议器**：让模型看着真实样本，提出"某个阈值该往哪边挪"。
// 这是"AI 自己总结规则"这条路的**第一步**（用户选定：离线提议 + 人过目；**只调阈值/权重**）。
//
// 三段式，顺序不能换：
//   ① **反事实重放**（确定性，不花一分钱）：对每个阈值，在它的合法区间里扫几个值，
//      用**账本里真发生过的 context** 重跑 `selectStrategy`，数出"几条样本的策略翻了、从什么翻成什么"。
//      这是整件事的地基：`selectStrategy` 是纯函数，所以"改一下会怎样"是**算**出来的，不是猜的。
//   ② **让模型提议**：把 ① 的表 + 原始样本（他的话/她的局面/规则选了什么/她真回了什么）给它，
//      要求结构化输出（哪个阈值、从多少到多少、依据哪几条样本、预期行为往哪边动）。
//   ③ **确定性校验 + 与 ① 对账**：越界/未知阈值/引用了不存在的样本 → 直接判废；
//      模型声称的效果**必须能在 ① 的表里对上** —— 对不上就标红（"它在编"）。
//
// **这个脚本不会改任何代码、不会落地任何东西**。它的产物只有一份报告，给人看。
// 落地要另走一步：`STRATEGY_TUNING` 环境变量 → 真管道 A/B → 过了才进默认值。
//
// 用法:
//   node node_modules/tsx/dist/cli.mjs scripts/propose-strategy-tuning.ts --ledger=strategy-ledger.jsonl
//   … --no-llm        只跑 ①（重放表本身就是有用的证据）
//   … --out=report.md 报告落盘

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  selectStrategy, strategyTuning, DEFAULT_STRATEGY_TUNING, STRATEGY_TUNING_BOUNDS,
  type StrategyContext, type StrategyTuning,
} from '../src/lib/dialogueStrategy.js';
import { generateAIResponse, type AISettings } from '../src/lib/aiProvider.js';

const strArg = (n: string, d: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const LEDGER = strArg('ledger', 'strategy-ledger.jsonl');
const OUT = strArg('out', '');
const NO_LLM = process.argv.includes('--no-llm');
const KNOBS = Object.keys(DEFAULT_STRATEGY_TUNING) as (keyof StrategyTuning)[];

interface Sample {
  id: string; message: string; reply: string;
  strategy: string; reason: string; confidence: number; ctx: StrategyContext;
}

if (!existsSync(LEDGER)) {
  console.error(`[账本] 找不到 ${LEDGER} —— 先跑 scripts/collect-strategy-ledger.ts`);
  process.exit(3);
}
const samples: Sample[] = readFileSync(LEDGER, 'utf8')
  .split(/\r?\n/).filter(Boolean)
  .map((l, i) => {
    try { return JSON.parse(l) as Sample; }
    catch (e) { console.error(`[账本] 第 ${i + 1} 行不是合法 JSON，跳过：${(e as Error).message}`); return null; }
  })
  .filter((s): s is Sample => s !== null);

if (samples.length === 0) {
  console.error('[账本] 一条有效样本都没有');
  process.exit(3);
}
console.log(`[账本] ${samples.length} 条样本：${samples.map(s => s.id).join(', ')}`);

// ════════════════════════════════════════════════════════════
// ① 反事实重放（确定性）
// ════════════════════════════════════════════════════════════

/** 在 env 里放一档阈值 → 重放全部样本 → 恢复 env。**必须同步**（selectStrategy 是纯的）。 */
function replayWith(overrides: Partial<StrategyTuning>): string[] {
  const prev = process.env.STRATEGY_TUNING;
  process.env.STRATEGY_TUNING = JSON.stringify(overrides);
  try {
    return samples.map(s => {
      try { return selectStrategy(s.ctx).strategy; }
      catch (e) { return `ERR:${(e as Error).message.slice(0, 40)}`; }
    });
  } finally {
    if (prev === undefined) delete process.env.STRATEGY_TUNING; else process.env.STRATEGY_TUNING = prev;
  }
}

const baselineStrategies = replayWith({});
// 账本里记的策略应当与"默认阈值下重放"逐字一致 —— 不一致说明账本或代码已经漂了，必须先说
const drift = samples.filter((s, i) => s.strategy !== baselineStrategies[i]);
if (drift.length > 0) {
  console.warn(`⚠️ 有 ${drift.length}/${samples.length} 条样本的"账本策略"与"现在重放的策略"不一致：`);
  for (const s of drift) {
    const i = samples.indexOf(s);
    console.warn(`   ${s.id}：账本=${s.strategy} 重放=${baselineStrategies[i]}（期间改过规则/阈值？）`);
  }
  console.warn('   ⇒ 下面的重放表仍然可用，但这份账本已经不是"当时那套代码"的记录了。\n');
}

/** 每个阈值取 5 档（含默认），扫一遍，数翻转 */
interface SweepRow { knob: keyof StrategyTuning; value: number; flipped: number; moves: string[] }
const sweeps: SweepRow[] = [];
for (const knob of KNOBS) {
  const [lo, hi] = STRATEGY_TUNING_BOUNDS[knob];
  const cur = DEFAULT_STRATEGY_TUNING[knob];
  const isInt = Number.isInteger(cur) && Number.isInteger(lo) && Number.isInteger(hi);
  const cands = new Set<number>();
  for (let k = 0; k < 5; k++) {
    const raw = lo + ((hi - lo) * k) / 4;
    cands.add(isInt ? Math.round(raw) : Math.round(raw * 100) / 100);
  }
  cands.add(cur);
  for (const v of [...cands].sort((a, b) => a - b)) {
    if (v === cur) continue;
    const got = replayWith({ [knob]: v } as Partial<StrategyTuning>);
    const moves: string[] = [];
    let flipped = 0;
    samples.forEach((s, i) => {
      if (got[i] !== baselineStrategies[i]) {
        flipped++;
        moves.push(`${s.id}:${baselineStrategies[i]}→${got[i]}`);
      }
    });
    sweeps.push({ knob, value: v, flipped, moves });
  }
}
sweeps.sort((a, b) => b.flipped - a.flipped);

console.log(`\n${'='.repeat(78)}\n① 反事实重放：把某个阈值挪一下，账本里有几条会翻（默认值 ${JSON.stringify(DEFAULT_STRATEGY_TUNING)}）\n${'='.repeat(78)}`);
const live = sweeps.filter(s => s.flipped > 0);
if (live.length === 0) {
  console.log('   所有候选值都**一条都不翻** —— 这批样本对阈值不敏感（要么样本太少，要么都在同一档）。');
} else {
  for (const s of live) {
    console.log(`   ${s.knob.padEnd(26)} → ${String(s.value).padStart(6)}　翻 ${String(s.flipped).padStart(2)}/${samples.length}　${s.moves.slice(0, 6).join('  ')}${s.moves.length > 6 ? ` …(+${s.moves.length - 6})` : ''}`);
  }
}
const dead = KNOBS.filter(k => sweeps.filter(s => s.knob === k).every(s => s.flipped === 0));
if (dead.length > 0) {
  console.log(`   一条都不翻的阈值：${dead.join(', ')}（这批样本里它们没被触发过 —— 不是"不重要"，是"没证据"）`);
}
/**
 * 证据门槛（确定性，与 `motive` 的"样本 <3 不学"同一条原则）：
 * 一条提议要有 **≥3 条被引用的样本**，且重放里要 **≥3 条真的翻**。
 * 为什么必须卡：这轮实测里，模型看了一条 s01 就敢提议把 `accompanyWhenSheSinks` 从 0.12 挪到 0.22
 * —— 一条样本撑不起一次行为改动，那叫过拟合。
 */
const MIN_EVIDENCE = 3;

// ════════════════════════════════════════════════════════════
// ② 让模型提议（可选）
// ════════════════════════════════════════════════════════════

interface Proposal {
  knob: keyof StrategyTuning; from: number; to: number;
  because: string; sampleIds: string[]; expect: string;
}
interface Checked extends Proposal {
  valid: boolean;
  problems: string[];
  /** 值得警惕但不一定致命的问题（例如证据不足、有它没提到的附带影响） */
  warnings: string[];
  replayFlipped: number | null;
  replayMoves: string[];
  /** 重放里翻掉、但**不在它引用范围内**的样本 —— 人看这条最省事 */
  collateral: string[];
}
const checkedProposals: Checked[] = [];

function settings(): AISettings {
  const env = readFileSync('.env', 'utf-8');
  const d = env.match(/^DEEPSEEK_API_KEY="?(.+?)"?$/m)?.[1];
  if (!d || d === 'your_deepseek_api_key_here') throw new Error('DEEPSEEK_API_KEY 不可用（线上用的就是它）');
  return { provider: 'custom', apiKey: d, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', temperature: 0.1 } as AISettings;
}

function buildPrompt(): string {
  const knobTable = KNOBS.map(k => {
    const [lo, hi] = STRATEGY_TUNING_BOUNDS[k];
    return `- ${k}：当前 ${DEFAULT_STRATEGY_TUNING[k]}，合法区间 [${lo}, ${hi}]`;
  }).join('\n');
  const replayTable = live.length === 0
    ? '（这批样本对任何阈值改动都不敏感）'
    : live.map(s => `- ${s.knob} → ${s.value}：翻 ${s.flipped}/${samples.length}　${s.moves.slice(0, 8).join(' ')}`).join('\n');
  const sampleTable = samples.map(s => {
    const c = s.ctx;
    const a = c.emotionState.taiji;
    return [
      `## ${s.id}　他说的：「${s.message}」`,
      `   局面：他的情绪强度=${(c.userAnalysis?.intensity ?? 0).toFixed(2)}(${c.userAnalysis?.expressedEmotion ?? '?'})，`
      + `她的效价=${a.valence.toFixed(2)} 唤醒=${a.arousal.toFixed(2)}，`
      + `本轮开始前她的负位移=${(c.herNegativeBeforeTurn?.intensity ?? 0).toFixed(2)}，`
      + `连续负面=${c.consecutiveNegativeRounds}，兴趣信号=${c.interestSignals.length}，待分享=${c.pendingDiscoveries.length}`,
      `   规则选了：${s.strategy}（${s.reason.slice(0, 70)}）`,
      `   她真回了：「${s.reply.replace(/\s+/g, ' ').slice(0, 90)}」`,
    ].join('\n');
  }).join('\n\n');

  return `你在帮我调一套对话策略引擎的**判定阈值**。她是他的 AI 女友；这套阈值决定"她这一刻该共情、该安静陪着、该换个话题、还是该追问细节"。

你的任务：**看真实样本，指出哪个阈值定得不对，该往哪边挪**。

严格约束（违反的输出会被程序直接判废）：
1. 只能改下面列出的阈值，**只能改数值**。不许新增规则、不许新增条件、不许改任何别的东西。
2. 每个值必须落在它的合法区间内。
3. 必须引用**真实存在的样本编号**作为依据（不许编）。
4. 最多提 3 条。**如果没有足够证据，就一条都不提** —— "样本不足所以不动"是完全正确的答案，比硬凑一条好。

## 可调阈值
${knobTable}

## 反事实重放（已经替你算好了：改成某个值会让哪些样本的策略翻掉）
${replayTable}

## 样本（这些是真跑出来的，回复也是她真的说过的）
${sampleTable}

只输出 JSON，不要任何解释文字，格式：
{"proposals":[{"knob":"阈值名","from":当前值,"to":建议值,"because":"一句话理由","sampleIds":["s01","s06"],"expect":"改了之后她的行为预期往哪边动（要可测，例如：追问变少/陪伴变多）"}]}
没有把握就输出 {"proposals":[]}。`;
}

const proposals: Checked[] = [];
if (!NO_LLM) {
  console.log(`\n${'='.repeat(78)}\n② 让模型提议（只输出 JSON；没把握就该输出空）\n${'='.repeat(78)}`);
  let raw = '';
  try {
    raw = await generateAIResponse(
      settings(),
      '你是一个严格的策略调参助手。只输出 JSON。',
      buildPrompt(),
      false, 0.1,
    );
  } catch (e) {
    console.error(`   ✗ 调模型失败（不影响 ① 的结论）：${(e as Error).message}`);
  }
  const m = raw.match(/\{[\s\S]*\}/);
  let parsed: { proposals?: unknown } | null = null;
  if (m) { try { parsed = JSON.parse(m[0]) as { proposals?: unknown }; } catch { parsed = null; } }
  if (!parsed || !Array.isArray(parsed.proposals)) {
    console.log(`   模型没有给出可解析的 JSON（原样 ${raw.length} 字）→ 按"没有提议"处理`);
  } else if (parsed.proposals.length === 0) {
    console.log('   模型给出**空提议**（"证据不够，先不动"）—— 这是合法且常见的正确答案。');
  } else {
    for (const p of parsed.proposals as Proposal[]) {
      const problems: string[] = [];
      const warnings: string[] = [];
      const knob = p?.knob as keyof StrategyTuning;
      if (!KNOBS.includes(knob)) problems.push(`阈值名 "${String(p?.knob)}" 不在可调表里`);
      if (typeof p?.from !== 'number' || p.from !== DEFAULT_STRATEGY_TUNING[knob]) {
        problems.push(`from=${String(p?.from)} 与当前值 ${DEFAULT_STRATEGY_TUNING[knob]} 不符（它记错了现状）`);
      }
      if (typeof p?.to !== 'number' || !Number.isFinite(p.to)) problems.push('to 不是数字');
      const ids = Array.isArray(p?.sampleIds) ? p.sampleIds : [];
      const unknown = ids.filter(id => !samples.some(s => s.id === id));
      if (unknown.length > 0) problems.push(`引用了不存在的样本 ${unknown.join(',')}`);
      if (ids.length === 0) problems.push('没有引用任何样本');
      else if (ids.length < MIN_EVIDENCE) {
        warnings.push(`**证据不足**：只引用 ${ids.length} 条（门槛 ${MIN_EVIDENCE}）—— 一条样本撑不起一次行为改动`);
      }
      // 与 ① 对账：这个改动到底翻不翻、翻几条
      let replayFlipped: number | null = null;
      let replayMoves: string[] = [];
      let collateral: string[] = [];
      if (problems.length === 0) {
        const got = replayWith({ [knob]: p.to } as Partial<StrategyTuning>);
        samples.forEach((s, i) => {
          if (got[i] !== baselineStrategies[i]) {
            replayMoves.push(`${s.id}:${baselineStrategies[i]}→${got[i]}`);
            if (!ids.includes(s.id)) collateral.push(s.id);
          }
        });
        replayFlipped = replayMoves.length;
        if (replayFlipped === 0) problems.push('**重放显示这条改动一条样本都不翻**（改了等于没改）');
        else if (replayFlipped < MIN_EVIDENCE) {
          warnings.push(`**重放只翻 ${replayFlipped} 条**（门槛 ${MIN_EVIDENCE}）`);
        }
        if (collateral.length > 0) {
          warnings.push(`**它没提到的附带影响**：${collateral.join(', ')} 也会跟着变（这类连带改动才是真正要看的）`);
        }
      }
      checkedProposals.push({ ...p, valid: problems.length === 0, problems, warnings, replayFlipped, replayMoves, collateral });
    }
  }
}

// ════════════════════════════════════════════════════════════
// ③ 报告（给人看；不落地任何东西）
// ════════════════════════════════════════════════════════════

const lines: string[] = [];
lines.push('# 策略阈值提议（离线，未落地）', '');
lines.push(`账本：\`${LEDGER}\`（${samples.length} 条真实样本）`);
lines.push(`阈值：默认值；Laya=off；STRATEGY_TUNING 未设`, '');
lines.push('## ① 反事实重放（确定性：`selectStrategy` 是纯函数，同一 context 重跑）', '');
if (live.length === 0) {
  lines.push('- 所有候选值**一条都不翻** ⇒ 这批样本对阈值不敏感，先要更多/更分散的样本。');
} else {
  for (const s of live) lines.push(`- \`${s.knob}\` → ${s.value}：翻 ${s.flipped}/${samples.length}　${s.moves.slice(0, 8).join(' ')}`);
}
lines.push('', '## ② 模型的提议（已过确定性校验）', '');
lines.push(`> ⚠️ 它读到的**唯一质量信号是回复原文**，而那把尺子没有校准过（而且这个项目刚刚两次被手写指标骗到）。`);
lines.push(`> 所以下面每一条都要当"**假设**"看，不是结论。证据门槛：引用 ≥${MIN_EVIDENCE} 条样本、重放翻 ≥${MIN_EVIDENCE} 条。`, '');
if (NO_LLM) lines.push('- （--no-llm，未调用模型）');
else if (checkedProposals.length === 0) lines.push('- 模型没有给出提议（或输出不可解析）。');
else {
  for (const p of checkedProposals) {
    lines.push(`### ${p.valid ? '✅' : '⛔'} \`${String(p.knob)}\`：${p.from} → ${p.to}`);
    lines.push(`- 理由：${p.because}`);
    lines.push(`- 依据样本：${(p.sampleIds ?? []).join(', ')}`);
    lines.push(`- 预期方向：${p.expect}`);
    lines.push(`- 重放校验：${p.replayFlipped === null ? '未跑（前面的校验已失败）' : `翻 ${p.replayFlipped} 条　${p.replayMoves.join(' ')}`}`);
    for (const w of p.warnings) lines.push(`- ⚠️ ${w}`);
    if (!p.valid) lines.push(`- **判废原因**：${p.problems.join('；')}`);
    lines.push('');
  }
}
lines.push('## 下一步（人来决定）', '');
lines.push('挑一条你认为值得试的，然后**必须**走真管道 A/B：');
lines.push('```bash');
lines.push(`STRATEGY_TUNING='{"<阈值名>":<新值>}' node node_modules/tsx/dist/cli.mjs scripts/ab-laya-strategy.ts --arms=off …`);
lines.push('```');
lines.push('（`--arms=off` 时 Laya 不参与，比的是**阈值改动本身**；判据要事先声明。）');
lines.push('');
lines.push('⚠️ 本脚本**没有改任何代码、没有落地任何阈值**。');

const report = lines.join('\n');
console.log(`\n${'='.repeat(78)}\n③ 报告\n${'='.repeat(78)}\n${report}`);
if (OUT) { writeFileSync(OUT, report, 'utf8'); console.log(`\n[报告] 已写入 ${OUT}`); }
