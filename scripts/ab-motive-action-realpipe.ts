// ── v1.58 C-2（真管道）：**只改 `action`，`selectedStrategy` 会不会分化** —— 一级终点是策略，不是语言 ──
//
// 固定：memory / motive kind / motive content / emotion / recall / 用户输入 / prompt 全部相同
// 唯一变量：`action ∈ {share, ask, wait}`
// 一级终点：`/state → strategy.current`（结构性，不用 NLU、不看自然语言）
// 护栏（v1.58 新结构量具）：每格 `commitCount` 增量 = 1、`StrategySelected` 事件增量 = 1
//
// 三臂 × n=8。结果逐行写 `motive-action-realpipe-rows-run1.jsonl`（即使中断也留痕）。
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-action-realpipe.ts [n=8]

import { cpSync, rmSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
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
process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';   // 本实验的**操纵**：策略层消费 action

const N = Number(process.argv[2] ?? 8);
const ARMS = ['share', 'ask', 'wait'] as const;
const ROWS = 'motive-action-realpipe-rows-run1.jsonl';
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories', BAK = 'memories.ab-action-backup', DUMP = '.tmp-ab-action-prompt.txt';
const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';
const CONTENT = '我想起他说过「等这个项目结束，我想去趟海边」';
const RECENT = [{ role: 'user', content: '早' }, { role: 'assistant', content: '早呀，昨晚睡得好吗？' }];

const co = aiCoordinator as unknown as {
  getStrategyCommitCount: () => number;
  getLastStrategyDecision: () => { strategy?: string; reason?: string } | null;
};
let selectedEvents = 0;
if (typeof (bus as unknown as { on?: unknown }).on === 'function') {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

let listenerRef: { close: () => void } | null = null;
try {
  let alive = false;
  try { alive = (await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) })).ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 有服务在跑 —— 先停掉。'); process.exit(3); }

  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  writeFileSync(DUMP, '', 'utf8'); process.env.DUMP_PROMPT = DUMP;
  writeFileSync(ROWS, '', 'utf8');

  const srv = new AIGirlfriendServer() as unknown as { app: { listen: (p: number, h: string) => never }; aiEngine: { emotionState: Record<string, unknown> } };
  const listener = srv.app.listen(0, '127.0.0.1');
  listenerRef = listener as unknown as { close: () => void };
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app :${port} ｜ 三臂 ${ARMS.join('/')} × n=${N} ｜ 一级终点 = selectedStrategy\n`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = (action: string) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B }; s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: { pool: [{ id: 'm1', kind: 'memory_echo', content: CONTENT, source: { memoryId: 'ep_sea' }, salience: 0.62, formedAt: now - 60_000, expiresAt: now + 5 * 86_400_000, attempts: 0, action }] },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6) {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      if (!(res.status === 429 || /too many requests|rate limit/i.test(err)) || i === tries) throw new Error(`chat 失败（HTTP ${res.status}）`);
      await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  const counts: Record<string, Record<string, number>> = {};
  for (const arm of ARMS) {
    counts[arm] = {};
    for (let i = 1; i <= N; i++) {
      srv.aiEngine.emotionState = structuredClone(makeState(arm)) as never;
      (aiCoordinator as unknown as Record<string, unknown>).valenceHistory = [];
      conflictManager.reset();
      markInteraction(Date.now() - 3 * 60_000);
      setMotiveLearning({ version: 1, updatedAt: Date.now(), stats: {} } as never);
      const c0 = co.getStrategyCommitCount(), e0 = selectedEvents;
      await postChat({ message: HIS, userId: 'ab-action', recentMessages: RECENT });
      const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
      const strat = String((((st as Record<string, unknown>).strategy ?? {}) as { current?: string }).current ?? '');
      const reason = String(co.getLastStrategyDecision()?.reason ?? '');
      const commits = co.getStrategyCommitCount() - c0, events = selectedEvents - e0;
      counts[arm][strat] = (counts[arm][strat] ?? 0) + 1;
      appendFileSync(ROWS, JSON.stringify({ arm, i, strategy: strat, commits, events, motiveTag: /action=\w+/.test(reason) ? (reason.match(/action=(\w+)/)?.[1] ?? '') : '', reason: reason.slice(0, 120) }) + '\n', 'utf8');
      console.log(`   [${arm} ${i}/${N}] 策略=${strat} ｜ 提交+${commits} 事件+${events} ｜ 动机痕迹=${/action=\w+/.test(reason) ? '有' : '无'}`);
    }
  }

  console.log(`\n${'='.repeat(88)}\n一级终点：${ARMS.map(a => `${a} → ${JSON.stringify(counts[a])}`).join('  ｜  ')}\n${'='.repeat(88)}`);
  const distinct = ARMS.map(a => Object.keys(counts[a]).join('+'));
  const allSame = new Set(distinct).size === 1;
  console.log(`   ⇒ 三臂取值：${distinct.join(' ｜ ')} ⇒ ${allSame ? '**全部收敛到同一策略**（⇒ 还有一堵策略优先级的墙）' : '**出现分化**（C 成立）'}`);
  const rows = readFileSync(ROWS, 'utf8').trim().split('\n').map(l => JSON.parse(l) as { commits: number; events: number });
  const guardOk = rows.every(r => r.commits === 1 && r.events === 1);
  console.log(`   护栏：${rows.length} 格全部 提交=1 且 事件=1 ⇒ ${guardOk ? '✓' : '✗'}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原；逐行数据留在 ${ROWS}`);
}
