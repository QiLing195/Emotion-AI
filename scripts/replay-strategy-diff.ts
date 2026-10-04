// scripts/replay-strategy-diff.ts
//
// v1.36 **结构改动的沙箱**：把某个环境开关打开/关掉，用**账本里真实发生过的 `StrategyContext`**
// 重跑 `selectStrategy`，数出"这个改动会让哪几条样本换策略"。
//
// 为什么结构改动特别需要它：改阈值时"会翻哪几条"能靠扫描算出来（v1.34 的提议器），
// 但改**规则结构**（加条件、改分支）没有可扫的参数空间 —— 唯一的办法就是**拿真样本重放两臂**。
// `selectStrategy` 是纯函数、开关又是**每轮现读 env**，所以这件事完全确定、不花一分钱、不用起服务。
//
// 它回答的是**爆炸半径**（哪些做法变了、变成什么、理由写了什么），不是"变好还是变差"——
// 后者必须走真管道 A/B（见 `docs/emotion-memory-history.md` 的方法学）。
//
// 用法：
//   node node_modules/tsx/dist/cli.mjs scripts/replay-strategy-diff.ts \
//     --a="DISABLE_STRATEGY_DIRECTION=true" --b=""          # A=旧行为，B=新行为（默认）
//   … --ledger=strategy-ledger.jsonl --only=s10,s09

import { readFileSync, existsSync } from 'node:fs';
import { selectStrategy, type StrategyContext } from '../src/lib/dialogueStrategy.js';

const strArg = (n: string, d: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const LEDGER = strArg('ledger', 'strategy-ledger.jsonl');
/** 臂 = 一串 `KEY=VALUE`（分号分隔）；空串 = 什么都不设 */
const ARM_A = strArg('a', 'DISABLE_STRATEGY_DIRECTION=true');
const ARM_B = strArg('b', '');
const ONLY = strArg('only', '').split(',').map(s => s.trim()).filter(Boolean);

interface Sample {
  id: string; message: string; reply: string;
  strategy: string; reason: string; ctx: StrategyContext;
}
if (!existsSync(LEDGER)) {
  console.error(`[账本] 找不到 ${LEDGER} —— 先跑 scripts/collect-strategy-ledger.ts`);
  process.exit(3);
}
let samples: Sample[] = readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean)
  .map(l => JSON.parse(l) as Sample);
if (ONLY.length) samples = samples.filter(s => ONLY.includes(s.id));
if (samples.length === 0) { console.error('[账本] 没有可用样本'); process.exit(3); }

/** 应用一臂的 env → 重放全部样本 → **恢复原 env**（两臂必须干净隔离） */
function replay(arm: string): { strategy: string; reason: string }[] {
  const spec = arm.split(';').map(s => s.trim()).filter(Boolean);
  const touched: [string, string | undefined][] = [];
  for (const kv of spec) {
    const i = kv.indexOf('=');
    if (i < 0) { console.error(`[臂] 这一项不是 KEY=VALUE：${kv}`); process.exit(2); }
    const k = kv.slice(0, i);
    touched.push([k, process.env[k]]);
    process.env[k] = kv.slice(i + 1);
  }
  try {
    return samples.map(s => {
      try {
        const d = selectStrategy(s.ctx);
        return { strategy: d.strategy, reason: d.reason };
      } catch (e) {
        return { strategy: `ERR:${(e as Error).message.slice(0, 40)}`, reason: '' };
      }
    });
  } finally {
    for (const [k, v] of touched) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

const a = replay(ARM_A);
const b = replay(ARM_B);

console.log(`[账本] ${samples.length} 条：${samples.map(s => s.id).join(', ')}`);
console.log(`[A 臂] ${ARM_A || '（不设 env）'}`);
console.log(`[B 臂] ${ARM_B || '（不设 env，= 代码默认）'}`);

// 先确认 A 臂与账本记录一致（不一致说明账本之后改过代码/阈值，得说清楚）
const drift = samples.filter((s, i) => s.strategy !== a[i].strategy);
if (drift.length > 0) {
  console.log(`\n⚠️ 有 ${drift.length}/${samples.length} 条与账本记录不一致（A 臂不是"当时那套代码"）：`);
  for (const s of drift) {
    const i = samples.indexOf(s);
    console.log(`   ${s.id}：账本=${s.strategy} A臂=${a[i].strategy}`);
  }
}

const flips = samples.map((s, i) => ({ s, i })).filter(({ i }) => a[i].strategy !== b[i].strategy);
console.log(`\n${'='.repeat(78)}\n爆炸半径：${flips.length}/${samples.length} 条换了策略\n${'='.repeat(78)}`);
if (flips.length === 0) {
  console.log('   一条都没翻 —— 这个改动在这批样本上**没有可观测影响**（要么样本没覆盖到，要么改动没生效）。');
  console.log('   ⚠️ 别据此认为"改动没用"：先确认账本里有**会触发该分支**的样本（这里看 `他此刻的情绪`）。');
}
for (const { s, i } of flips) {
  const emo = s.ctx.userAnalysis?.expressedEmotion ?? '—';
  const inten = (s.ctx.userAnalysis?.intensity ?? 0).toFixed(2);
  console.log(`\n── ${s.id}　他说的：「${s.message}」`);
  console.log(`   他的情绪=${emo} 强度=${inten}｜她本轮开始前负位移=${(s.ctx.herNegativeBeforeTurn?.intensity ?? 0).toFixed(2)}`);
  console.log(`   A: ${a[i].strategy.padEnd(11)}｜${a[i].reason.slice(0, 78)}`);
  console.log(`   B: ${b[i].strategy.padEnd(11)}｜${b[i].reason.slice(0, 78)}`);
  console.log(`   账本里她当时真回的：「${s.reply.replace(/\s+/g, ' ').slice(0, 80)}」`);
}

// 分组：翻掉的那些在"他情绪方向"上怎么分布 —— 结构改动最该看这个
const byEmotion = new Map<string, number>();
for (const { s } of flips) {
  const e = s.ctx.userAnalysis?.expressedEmotion ?? '—';
  byEmotion.set(e, (byEmotion.get(e) ?? 0) + 1);
}
if (flips.length > 0) {
  console.log(`\n翻掉的样本按他的情绪分：${[...byEmotion].map(([k, v]) => `${k}×${v}`).join('　')}`);
}
console.log(`\n[下一步] 这只是"变了什么"。要判"变好还是变差"必须走真管道 A/B：`);
console.log(`   node node_modules/tsx/dist/cli.mjs scripts/calibrate-judge.ts --armB="${ARM_A}" …`);
