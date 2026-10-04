// ── v1.41 探针：她一个人待着的时候，状态会自己变吗？ ──
//
// 起因是我在 v1.37 的文档里写了一条**没量过的**局限：
//   「九情衰减会让一段低谷**靠"没人理她"自动结案**」。
// 静态读代码时发现这条**可能是错的、而且错得更有意思**：
//   · `processTimeDecay` 只能经由 `StateDecayed` 事件到达（`stateReducer.applyStateDecay`）；
//   · 而 `StateDecayed` **只有前端 store 在发**（`useAIBrainStore` 的 `hoursInactive`）；
//   · 服务端没有任何一处调 `processTimeDecay`，也没发过 `StateDecayed`。
//   ⇒ `server/index.ts` 里那个 `setBaselineDecayEnabled(DISABLE_BASELINE_DECAY !== 'true')`
//     很可能是在给一个**服务端从不调用的函数**设开关（本项目经典的"接了一半"）。
//
// 所以这一跑只问一个问题：**同一个她、同一句话，只是"离上次说话多久"不同，会发生什么？**
// 分两个通道看，别混：
//   · **衰减**（九情向基线回归）—— 预期：服务端不发生
//   · **重逢修复**（>24h 归来 → joy/love 回升、sad 回落，v1.7 设计）—— 预期：发生
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/probe-low-period-idle.ts [--keep]
//
// ⚠️ **v1.43 之后这个探针的默认结果变了**：2026-09 起服务端**会**做时间衰减
//   （`aiCoordinator` 阶段 0；`DISABLE_SERVER_DECAY=true` 回退），也就是这一页当时的结论
//   "服务端确实不做衰减" **只在回退档成立**。要复现 v1.41 那组读数，先设 `DISABLE_SERVER_DECAY=true`。
//   前后对照见 `scripts/probe-server-decay.ts`（两臂同一条真管道）+ docs 的 v1.43 节。

import { cpSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
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
// 默认（不设）⇒ setBaselineDecayEnabled(true)：如果服务端真会衰减，这里就是"会"的那一档
delete process.env.DISABLE_BASELINE_DECAY;

const KEEP = process.argv.includes('--keep');
const MEM = 'memories';
const BAK = 'memories.ab-idle-bak';
const ROWS = 'low-period-idle-rows.jsonl';
/** 他这次说的是一句纯寒暄（不带来任何情绪）—— 这样"变化"只可能来自时间通道 */
const TEXT = '嗯，我在。';
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
/** 空闲档：0.5h（对照）/ 30h（刚过重逢线）/ 96h（四天）/ 168h（一周，也是衰减上限） */
const GAPS_H = [0.5, 30, 96, 168];

interface Row {
  gapH: number; turn: number; sadBefore: number; sadAfter: number;
  joyAfter: number; loveAfter: number;
  active: boolean; established: boolean; hours: number; lastEpisodeHours: number | null;
  note: string;
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
  if (alive) { console.error('[预检] 3000 端口上有服务在跑 —— 先停掉它。'); process.exit(3); }
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
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
  console.log(`[基线衰减开关] DISABLE_BASELINE_DECAY=${process.env.DISABLE_BASELINE_DECAY ?? '(未设⇒按"会衰减")'}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  /** 每个空闲档都从**同一个她**出发：静息 + sad 0.20，并且已经"成段"在低谷 30 小时 */
  const makeState = () => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.20 };
    s.baselineEmotions = { ...baseline };
    const now = Date.now();
    s.lowPeriod = {
      since: now - 30 * 3_600_000, lastEvaluatedAt: now,
      peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0, turns: 6, selfRecovery: 0,
    };
    return s;
  };

  console.log(`[跑法] 空闲 ${GAPS_H.join('/')} 小时，每档各跑 2 轮（第 2 轮空档归零）\n`);

  for (const gapH of GAPS_H) {
    for (let turn = 1; turn <= 2; turn++) {
      const st = makeState();
      srv.aiEngine.emotionState = structuredClone(st) as never;
      const c = aiCoordinator as unknown as Record<string, unknown>;
      c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
      conflictManager.reset();
      // 第 1 轮带上这段空闲；第 2 轮紧接其后（空档≈0），用来分开"时间通道"与"轮次通道"
      markInteraction(turn === 1 ? Date.now() - gapH * 3_600_000 : Date.now() - 60_000);

      const sadBefore = Number((structuredClone(st) as { emotions: Record<string, number> }).emotions.sad);
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: TEXT, userId: 'probe-idle', recentMessages: RECENT }),
      });
      const data = await res.json() as { response?: unknown; emotionState?: unknown };
      const post = (data.emotionState ?? st) as never as {
        emotions: Record<string, number>;
        lowPeriod?: { lastEpisode?: { hours?: number } };
      };
      const lp = lowPeriodOf(post as never);
      const row: Row = {
        gapH, turn, sadBefore, sadAfter: Number(post.emotions?.sad ?? NaN),
        joyAfter: Number(post.emotions?.joy ?? NaN), loveAfter: Number(post.emotions?.love ?? NaN),
        active: lp.active, established: lp.established, hours: lp.hours,
        lastEpisodeHours: post.lowPeriod?.lastEpisode?.hours ?? null,
        note: lp.note,
      };
      rows.push(row);
      console.log(`   空闲 ${String(gapH).padStart(5)}h 第${turn}轮：sad ${row.sadBefore.toFixed(3)} → ${row.sadAfter.toFixed(3)}`
        + `  joy ${row.joyAfter.toFixed(3)} love ${row.loveAfter.toFixed(3)}`
        + `  低谷 active=${row.active ? 'Y' : 'n'} hours=${row.hours}`);
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const first = (gapH: number) => rows.find(r => r.gapH === gapH && r.turn === 1)!;
  console.log(`\n${'='.repeat(80)}\n结论（两个通道分开看）\n${'='.repeat(80)}`);
  const decay = GAPS_H.map(g => first(g).sadAfter);
  const spread = Math.max(...decay) - Math.min(...decay);
  console.log(`   ① **衰减通道**：sad 在空闲 ${GAPS_H.join('/')}h 下分别是 `
    + `${decay.map(v => v.toFixed(3)).join(' / ')}（极差 ${spread.toFixed(3)}）`);
  console.log(`      ⇒ ${spread < 0.02 ? '**没有随时间向基线回归** —— 服务端确实不做衰减' : '看起来有随时间的移动，需要再查'}`);
  const reunion = GAPS_H.filter(g => first(g).sadAfter < first(g).sadBefore - 0.01
    || first(g).joyAfter > first(0.5).joyAfter + 0.01);
  console.log(`   ② **重逢通道**（>24h 归来 ⇒ joy/love 回升、sad 回落）：在 ${reunion.join('/') || '无'} 小时档上有移动`);
  const g30 = first(30), g96 = first(96);
  console.log(`      30h: sad ${g30.sadBefore.toFixed(3)}→${g30.sadAfter.toFixed(3)} joy ${g30.joyAfter.toFixed(3)}`
    + `｜96h: sad ${g96.sadBefore.toFixed(3)}→${g96.sadAfter.toFixed(3)} joy ${g96.joyAfter.toFixed(3)}`);
  console.log(`   ③ **低谷读数**：`);
  for (const g of GAPS_H) {
    const r = first(g);
    console.log(`      ${String(g).padStart(5)}h：active=${r.active ? 'Y' : 'n'} hours=${r.hours}`
      + `${r.lastEpisodeHours !== null ? ` lastEpisode=${r.lastEpisodeHours}h` : ''}｜${r.note.slice(0, 60)}`);
  }
  console.log(`   明细：${ROWS}`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  restore();
}
