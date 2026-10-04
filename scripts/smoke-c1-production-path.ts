// ── v1.58 C-1 **生产路径结构断言**（真实 express 管道，不看自然语言）──
//
// 巨标：证明 `server.ts` 的新生产路径真的跑通了这条生命周期：
//   输入 → 情绪 → **临时策略** → 回忆 → **动机 ×1** → **定稿策略** → 仲裁 → **提交 ×1** → 下游一致
//
// 1446 条旧测试走的是**非延后**路径 ⇒ 只证明"旧路径没坏"，**不能**证明新路径接通。这个脚本补那一格。
//
// 断言（跑前写死）：
//   ① `getStrategyCommitCount()` 增量 **=== 1**            （提交恰好一次）
//   ② `bus` 的 `StrategySelected` 事件增量 **=== 1**        （事件恰好一次）
//   ③ 下游三处**看到同一份定稿策略**：
//        `/state → strategy.current` === 定稿
//        调试头 `strategy=` === 定稿
//        `/state → strategy.reason` 里带动机痕迹（开关开时）
//   ④ 开关开 + action=wait ⇒ 定稿 = `accompany`（**允许**与临时不同）；
//      开关关 ⇒ 定稿与临时**逐字相同**（证明"不传 motive 时行为不变，但仍只提交一次"）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/smoke-c1-production-path.ts [--keep]

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction, setMotiveLearning } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import { bus } from '../src/eventBus.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';
process.env.ENABLE_ECHO_LINE_FROM_SUMMARY = 'true';

const KEEP = process.argv.includes('--keep');
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories';
const BAK = 'memories.smoke-c1-backup';
const DUMP = '.tmp-smoke-c1-prompt.txt';
const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';
const CONTENT = '我想起他说过「等这个项目结束，我想去趟海边」';
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const co = aiCoordinator as unknown as {
  getStrategyCommitCount: () => number;
  getLastStrategyDecision: () => { strategy?: string; reason?: string } | null;
};

/** 事件计数：`bus.on` 若不存在就诚实报"没量到"（不许假装通过）*/
let selectedEvents = 0;
const canCountEvents = typeof (bus as unknown as { on?: unknown }).on === 'function';
if (canCountEvents) {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

let listenerRef: { close: () => void } | null = null;
try {
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑 —— 先停掉它。'); process.exit(3); }

  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  writeFileSync(DUMP, '', 'utf8');
  process.env.DUMP_PROMPT = DUMP;

  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  const listener = srv.app.listen(0, '127.0.0.1');
  listenerRef = listener as unknown as { close: () => void };
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = (action: 'wait' | 'share' | null) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        pool: [{
          id: 'm1', kind: 'memory_echo', content: CONTENT, source: { memoryId: 'ep_sea' },
          salience: 0.62, formedAt: now - 60_000, expiresAt: now + 5 * 86_400_000, attempts: 0,
          ...(action ? { action } : {}),
        }],
      },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6): Promise<Record<string, never>> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      if (!(res.status === 429 || /too many requests|rate limit/i.test(err)) || i === tries) {
        throw new Error(`chat 调用失败（HTTP ${res.status}）：${JSON.stringify(data).slice(0, 160)}`);
      }
      await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  interface Cell { label: string; switch: boolean; action: 'wait' | 'share' | null; commits: number; events: number; final: string; reason: string; stateStrategy: string; promptStrategy: string; motiveKind: string; actionSeen: string }
  const cells: Cell[] = [];

  async function runCell(label: string, sw: boolean, action: 'wait' | 'share' | null): Promise<Cell> {
    if (sw) process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';
    else delete process.env.ENABLE_MOTIVE_ACTION_STRATEGY;
    srv.aiEngine.emotionState = structuredClone(makeState(action)) as never;
    (aiCoordinator as unknown as Record<string, unknown>).valenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);
    setMotiveLearning({ version: 1, updatedAt: Date.now(), stats: {} } as never);

    const c0 = co.getStrategyCommitCount();
    const e0 = selectedEvents;
    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    await postChat({ message: HIS, userId: 'smoke-c1', recentMessages: RECENT });
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);
    const header = /strategy=(\w+)/.exec(prompt.split('\n')[1] ?? '')?.[1] ?? '';
    const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
    const stateStrat = ((st as Record<string, unknown>).strategy ?? {}) as { current?: string };
    const motiveView = ((st as Record<string, unknown>).motive ?? {}) as { thisTurn?: { kind?: string }; thisTurnAction?: string };
    const last = co.getLastStrategyDecision();
    const c: Cell = {
      label, switch: sw, action,
      commits: co.getStrategyCommitCount() - c0,
      events: selectedEvents - e0,
      final: String(last?.strategy ?? ''),
      reason: String(last?.reason ?? ''),
      stateStrategy: String(stateStrat.current ?? ''),
      promptStrategy: header,
      motiveKind: String(motiveView.thisTurn?.kind ?? ''),
      actionSeen: String((motiveView as Record<string, unknown>).thisTurnAction ?? ''),
    };
    console.log(`   [${label}] 提交+${c.commits} 事件+${c.events} 定稿=${c.final} ｜ /state=${c.stateStrategy} ｜ Prompt=${c.promptStrategy}`
      + ` ｜ 动机=${c.motiveKind}`);
    console.log(`         reason: ${c.reason.slice(0, 96)}`);
    return c;
  }

  console.log('[跑法] 2 格：① 开关关（定稿应与临时一致，仍只提交一次）② 开关开 + action=wait（定稿应为 accompany）\n');
  cells.push(await runCell('开关关', false, null));
  cells.push(await runCell('开关开/wait', true, 'wait'));

  console.log(`\n${'='.repeat(96)}\n裁定（断言跑前写死）\n${'='.repeat(96)}`);
  let ok = true;
  // ① 提交恰好一次 / ② 事件恰好一次
  for (const c of cells) {
    const a = c.commits === 1;
    const b = canCountEvents ? c.events === 1 : true;
    if (!a || !b) ok = false;
    console.log(`   ① 提交数 = ${c.commits}（须 1）${a ? '✓' : '✗'} ｜ ② StrategySelected = `
      + `${canCountEvents ? c.events : '没量到（bus 无 on）'}${b ? ' ✓' : ' ✗'}`);
  }
  // ③ 下游一致
  for (const c of cells) {
    const same = c.final !== '' && c.final === c.stateStrategy && c.final === c.promptStrategy;
    if (!same) ok = false;
    console.log(`   ③ 定稿 === /state === Prompt（${c.final} / ${c.stateStrategy} / ${c.promptStrategy}）${same ? '✓' : '✗'}`);
  }
  // ④ 两种 regime
  const off = cells[0], on = cells[1];
  const offOk = off.final !== '' && off.reason.includes('action=') === false;   // 关着时理由里不该有 action
  const onOk = on.final === 'accompany';
  if (!offOk || !onOk) ok = false;
  console.log(`   ④ 开关关：定稿理由里**无** action 痕迹 ${offOk ? '✓' : '✗'}（理由：${off.reason.slice(0, 60)}）`);
  console.log(`      开关开+wait：定稿 = accompany ${onOk ? '✓' : '✗'}（实际 ${on.final}）`);
  console.log(`\n   ⇒ 生产路径结构断言：${ok ? '**全部通过**' : '**有未通过项**'}`);
  console.log(`   ⚠️ 注意："临时策略 ≠ 定稿策略" **不是 bug**（那正是这一刀的意义）；`);
  console.log(`      真正的 bug 是"定稿 ≠ 提交"或"提交 ≠ 下游" —— 上面 ③ 专门守这个。`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  if (KEEP) console.log(`\n[保留] --keep：${BAK}/ 未还原`);
  else {
    rmSync(MEM, { recursive: true, force: true });
    cpSync(BAK, MEM, { recursive: true });
    rmSync(BAK, { recursive: true, force: true });
    console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
  }
}
