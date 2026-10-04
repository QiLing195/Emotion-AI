// ── v1.53 「他接住了她这句话吗」按类型分派：**真管道确认** ──
//
// 与前面几刀不同，这一刀的终点**不是她的话术**，而是**学习账本里的计数**：
// 服务端每轮开头会拿"上一轮她说出口的那条动机"和"他这句话"判一次接住没接住，
// 然后 `landed++ / voiced++`。所以这是一个**确定性**读数（不经过 LLM 的措辞），
// 三格各 8 对、开关两臂，读 `/state → motive.learning`。
//
// 预声明判据（**跑之前写死**）：
//   ① 治疗格 s1（她上一轮说的是**态度**，他这句"你说得对，我也觉得"是在回应她）
//      A 臂（老判据）：missed ⇒ `stance.landed` 增量 **0**
//      B 臂（新判据）：landed ⇒ 增量 **1**
//      两臂 **8/8 各自一致**，且 A=0 / B=8 才算操纵成功。
//   ② 负对照 n1（同一格，但他说的是"嗯"= 敷衍）⇒ **两臂都应 0**（新通道不是橡皮图章）。
//   ③ 负对照 n2（她上轮说的是**话题型** open_loop，他说"面试结果出来了"）
//      ⇒ **两臂都应 1**（通道①没被打哑）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-outcome-signal.ts [--keep] [--n=8]
// 行文件：motive-outcome-signal-rows-run1.jsonl

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction, setMotiveLearning } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';
import type { MotiveKind } from '../src/lib/emotionTypes';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const KEEP = process.argv.includes('--keep');
const N = (() => { const hit = process.argv.find(a => a.startsWith('--n=')); return hit ? Math.max(4, Number(hit.split('=')[1])) : 8; })();
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories';
const BAK = 'memories.ab-mos-backup';
const ROWS = 'motive-outcome-signal-rows-run2.jsonl';
const DUMP = '.tmp-ab-mos-prompt.txt';
type Arm = 'A' | 'B';

interface Scene {
  id: string; kind: MotiveKind; voiced: string; his: string;
  expectLanded: Record<Arm, number>; note: string;
}
const SCENES: Scene[] = [
  {
    id: 's1', kind: 'stance', voiced: '我在意的是真的连上，不是聊了多少句',
    his: '你说得对，我也觉得',
    expectLanded: { A: 0, B: 1 },
    note: '治疗格：她上轮说的是**态度**，他这句在**回应她**（词面一字不重）',
  },
  {
    id: 'n1', kind: 'stance', voiced: '我在意的是真的连上，不是聊了多少句',
    his: '嗯',
    expectLanded: { A: 0, B: 0 },
    note: '负对照：同一格但他敷衍 ⇒ 两臂都不该记 landed（新通道不是橡皮图章）',
  },
  {
    id: 'n2', kind: 'open_loop', voiced: '他面试那事有消息了吗',
    his: '面试结果出来了，过了',
    expectLanded: { A: 1, B: 1 },
    note: '负对照：话题型 + 他接着这件事说 ⇒ 两臂都该 landed（通道①没被打哑）',
  },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

interface Row {
  arm: Arm; id: string; pair: number; landed: number; voiced: number; reason: string; promptLen: number;
}
const rows: Row[] = [];
let listenerRef: { close: () => void } | null = null;

function restore() {
  if (KEEP) { console.log(`\n[保留] --keep：${BAK}/ 未还原`); return; }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

try {
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑 —— 先停掉它。'); process.exit(3); }

  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  writeFileSync(DUMP, '', 'utf8');
  process.env.DUMP_PROMPT = DUMP;
  writeFileSync(ROWS, '', 'utf8');

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
  /** 她上一轮刚说过 `sc.voiced`（`lastSelected*` 就是这个用处的） */
  const makeState = (sc: Scene) => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B };
    s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: {
        pool: [],
        lastSelectedId: 'prev',
        lastSelectedKind: sc.kind,
        lastSelectedContent: sc.voiced,
        lastSelectedAt: now - 5 * 60_000,
        lastSelection: { at: now - 5 * 60_000, reason: '（夹具）', selectedKind: sc.kind, deferred: false },
      },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6): Promise<{ response?: unknown }> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      if (!(res.status === 429 || /too many requests|rate limit/i.test(err)) || i === tries) {
        console.error(`[中断] /api/chat 没返回 response（第 ${i} 次，HTTP ${res.status}）：${JSON.stringify(data).slice(0, 200)}`);
        throw new Error('chat 调用失败 —— 不许静默缩小样本');
      }
      console.warn(`   ⏳ 触发限流，等 ${Math.round(wait / 1000)}s 后重发`);
      await new Promise(r => setTimeout(r, wait));
      wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  // v1.53 **已上线（默认开）** ⇒ 臂的约定翻转：A = DISABLE=true（老判据），B = 不设（现在的默认）
  const applyArm = (arm: Arm) => {
    if (arm === 'A') process.env.DISABLE_MOTIVE_PER_KIND_OUTCOME = 'true';
    else delete process.env.DISABLE_MOTIVE_PER_KIND_OUTCOME;
  };

  async function callOnce(arm: Arm, sc: Scene, pair: number): Promise<Row> {
    applyArm(arm);
    srv.aiEngine.emotionState = structuredClone(makeState(sc)) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);
    // 每格从**空账本**开始 ⇒ 读到的就是这一格的增量（否则会累加）
    setMotiveLearning({ version: 1, updatedAt: Date.now(), stats: {} } as never);

    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const data = await postChat({ message: sc.his, userId: 'ab-mos', recentMessages: RECENT });
    if (typeof data.response !== 'string') throw new Error('no response');
    const prompt = readFileSync(DUMP, 'utf8').slice(dumpBefore);

    const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);

    // ⚠️ `/state → motive.learning` 是**数组**（`summarizeMotiveLearning()` 的输出：
    //    每类一行 {kind, voiced, landed, landedRate, weight}），不是按类索引的对象。
    //    第一跑我按对象取 ⇒ 每格都读成 0，于是把一次**完美操纵**读成了"全 0"。
    const learningRaw = ((st as Record<string, unknown>).motive as Record<string, unknown> | undefined)?.learning;
    const stat = Array.isArray(learningRaw)
      ? (learningRaw as Array<{ kind?: string; voiced?: number; landed?: number }>).find(x => x.kind === sc.kind)
      : (learningRaw as { stats?: Record<string, { voiced?: number; landed?: number }> } | undefined)?.stats?.[sc.kind];
    const row: Row = {
      arm, id: sc.id, pair,
      landed: stat?.landed ?? 0, voiced: stat?.voiced ?? 0,
      reason: String(((st as Record<string, unknown>).motive as Record<string, unknown> | undefined)?.thisTurn
        ? (((st as Record<string, unknown>).motive as Record<string, unknown>).thisTurn as Record<string, unknown>).reason : ''),
      promptLen: prompt.length,
    };
    console.log(`   [${arm}] ${sc.id} p${pair} ${sc.kind} voiced=${row.voiced} landed=${row.landed}`);
    return row;
  }

  console.log(`[跑法] ${SCENES.map(s => `${s.id}×${N}`).join(' + ')} × 2 臂 = ${SCENES.length * N * 2} 格\n`);
  for (const sc of SCENES) {
    for (let pair = 1; pair <= N; pair++) {
      for (const arm of (pair % 2 === 1 ? ['A', 'B'] : ['B', 'A']) as Arm[]) {
        rows.push(await callOnce(arm, sc, pair));
      }
    }
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  // ── ① 操纵检查（读数是计数，确定性） ──
  console.log(`\n${'='.repeat(94)}\n① 操纵检查（读的是学习账本的计数，不经过她的话术）\n${'='.repeat(94)}`);
  let ok = true;
  for (const sc of SCENES) {
    for (const arm of ['A', 'B'] as Arm[]) {
      const rs = rows.filter(r => r.arm === arm && r.id === sc.id);
      const expect = sc.expectLanded[arm];
      const hit = rs.filter(r => r.landed === expect).length;
      const good = hit === rs.length;
      if (!good) ok = false;
      console.log(`   ${sc.id}/${arm}（${sc.note.slice(0, 34)}…）：landed=${[...new Set(rs.map(r => r.landed))].join('/')}`
        + ` 期望 ${expect} ⇒ ${hit}/${rs.length} ${good ? '✓' : '✗'}`);
    }
  }
  console.log(`   ⇒ 操纵检查${ok ? '通过' : '**没过**：数字不能当结论用'}`);

  // ── ② 裁定 ──
  const s1a = rows.filter(r => r.arm === 'A' && r.id === 's1');
  const s1b = rows.filter(r => r.arm === 'B' && r.id === 's1');
  const primary = s1a.every(r => r.landed === 0) && s1b.every(r => r.landed === 1);
  const n1ok = rows.filter(r => r.id === 'n1').every(r => r.landed === 0);
  const n2ok = rows.filter(r => r.id === 'n2').every(r => r.landed === 1);
  console.log(`\n${'='.repeat(94)}\n② 裁定（判据跑之前写死）\n${'='.repeat(94)}`);
  console.log(`   主终点 s1：A 臂 landed 全 0（${s1a.map(r => r.landed).join('')}）／B 臂 landed 全 1（${s1b.map(r => r.landed).join('')}）`
    + ` ⇒ ${primary ? '**达标**' : '**未达标**'}`);
  console.log(`   负对照 n1（他敷衍）：两臂 landed 全 0 ⇒ ${n1ok ? '✓ 新通道不是橡皮图章' : '✗ 放水了'}`);
  console.log(`   负对照 n2（话题型 + 他接着说）：两臂 landed 全 1 ⇒ ${n2ok ? '✓ 通道①没被打哑' : '✗ 被打哑了'}`);
  const passed = ok && primary && n1ok && n2ok;
  console.log(`   ⇒ 数据层面：${passed ? '**达标**' : '**未达标**'}；v1.53 已上线（DISABLE_MOTIVE_PER_KIND_OUTCOME=true 回退）`);
  console.log(`   逐格原文：${ROWS}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
