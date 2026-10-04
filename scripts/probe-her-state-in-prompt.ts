// ── v1.47 探针：「她替他悬着」这句话，到底走到她嘴边了吗？──
//
// 起因是 v1.18 留在 docs 里的一条缺口：
//   「单轮 `fear +0.028` 仍低于"被激起"的死区（0.05）⇒ 那一轮读数仍报"静息"；
//     要让单轮就听得出来，得把上限抬到约 0.27 —— **这需要单独决策**。」
// 但那是**只看了数值**得出的结论。读代码之后，这条缺口其实是**三段叠加**的，而最要紧的不是数值：
//
//   ① 数值：`touches_her_concern` 单轮给 fear ≈ 0.028（cap 0.15）→ 低于读数死区 0.05；
//   ② 门槛：就算读出来，消费它的三处都要 ≥0.12（Rule 1 的 `herNegativeBeforeTurn`、
//      让位 `DEFER_HER_SINK`、低谷 `LOW_PERIOD_SINK`）⇒ **单轮永远够不到**；
//   ③ **投递：那句话本身（"他说的正是我挂着的那件…我替他悬着"）只进 `/state`，
//      从来没进过她的 Prompt** —— 而她的九情进 Prompt 的通路**只有一条**：
//      前端把 `buildEmotionContext()` 拼进 `persona.systemPrompt` 送过来。
//
// 而那条通路用的是**绝对值 top-3 + 绝对值 argmax**（`当前情绪: calm(0.44)…` / `主导情绪: calm`）——
// 正是一整套 v1.13 判过"基调冒充情绪"的读法。也就是说：**系统明确告诉她"你现在很平静"**。
//
// 这个探针只回答一个问题：**同一份状态，走到她 Prompt 里的到底是哪句话？**
// 两个条件（都是我这条真管道）：
//   A 不带 persona（= 本项目所有 A/B harness 的条件）
//   B 带 persona（= 生产浏览器送来的条件，systemPrompt 用 `buildEmotionContext` 现拼）
//
// 零判据、零改动：只打印，不下结论。
// 用法：node node_modules/tsx/dist/cli.mjs scripts/probe-her-state-in-prompt.ts

import { cpSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { buildEmotionContext } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import {
  activationOf, separateActivation, RESTING_EMOTION_BASELINE,
} from '../src/lib/emotionActivation.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';
delete process.env.DISABLE_APPRAISAL;          // 这一探针要看的正是评价层

const MEM = 'memories';
const BAK = 'memories.ab-state-bak';
const DUMP = '.tmp-probe-state-prompt.txt';
/** 他这句话：负面、强度高，而且**正是她心里挂着的那件事**（两条评价通路都该命中） */
const HIS = '我体检报告出来了，医生说情况不太好。';
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

function restore() {
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
writeFileSync(DUMP, '', 'utf8');
process.env.DUMP_PROMPT = DUMP;

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
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}\n`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  /** 她：静息 + 一点点沉（模拟"这几天有点低"），并且**心里挂着他的体检结果** */
  const makeState = () => {
    const s = structuredClone(real) as typeof real & {
      internal?: Record<string, unknown>;
    };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + 0.06 };
    s.baselineEmotions = { ...baseline };
    s.internal = {
      ...(s.internal ?? {}),
      motive: {
        pool: [{
          id: 'seed-concern', kind: 'open_loop', content: '他体检结果到底怎么样', source: {},
          salience: 0.8, formedAt: Date.now() - 3_600_000, expiresAt: Date.now() + 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  const state0 = makeState();
  console.log(`${'='.repeat(92)}\n她这一轮开始前的状态（同一份向量，两种读法）\n${'='.repeat(92)}`);
  console.log(`   绝对值 top-3（前端 ` + '`buildEmotionContext`' + ` 用的读法）：`
    + Object.entries(state0.emotions).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}(${v.toFixed(2)})`).join(', '));
  console.log(`   激活态（v1.13 的读法）：${activationOf(state0 as never).note}`);
  console.log(`   ⇒ 前端那段【当前状态】会写成：`
    + buildEmotionContext(state0 as never as never).split('\n').filter(l => l.trim()).slice(0, 2).join(' / '));

  for (const cond of ['A 不带 persona（= 我的 A/B harness）', 'B 带 persona（= 生产浏览器）'] as const) {
    const withPersona = cond.startsWith('B');
    const st = makeState();
    srv.aiEngine.emotionState = structuredClone(st) as never;
    const c = aiCoordinator as unknown as Record<string, unknown>;
    c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);

    const body: Record<string, unknown> = { message: HIS, userId: 'probe-state', recentMessages: RECENT };
    if (withPersona) {
      body.persona = {
        name: '小禾', dynamicEmotion: true, emotionState: structuredClone(st),
        proactive: false,
        // 前端就是这么拼的：`prompt += buildEmotionContext(persona.emotionState, …)`
        systemPrompt: buildEmotionContext(structuredClone(st) as never as never),
      };
    }
    const dumpBefore = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').length : 0;
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json() as { response?: unknown };
    const prompt = existsSync(DUMP) ? readFileSync(DUMP, 'utf8').slice(dumpBefore) : '';
    const st2 = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
    const app = st2.appraisal as never as { note?: string; readings?: Array<{ kind: string; reason: string }> } | null;
    const after = (st2.emotions ?? {}) as Record<string, number>;
    const actAfter = separateActivation(after, baseline as never);

    console.log(`\n${'='.repeat(92)}\n条件 ${cond}\n${'='.repeat(92)}`);
    console.log(`   她回的是：「${typeof data.response === 'string' ? data.response : '(没有回复)'}」`);
    console.log(`\n   【评价层算出来的】（只进 /state）`);
    console.log(`      ${app?.note ?? '(无)'}`);
    for (const r of app?.readings ?? []) console.log(`      · [${r.kind}] ${r.reason}`);
    console.log(`\n   【她的状态在读数里】轮末激活态：${actAfter.note}`);
    console.log(`      fear 位移 ${(actAfter.delta.fear ?? 0).toFixed(3)}`
      + `（读数死区 0.05；消费门槛 0.12）`);

    console.log(`\n   【真正进了她 Prompt 的】长度 ${prompt.length} 字`);
    const headers = [...prompt.matchAll(/【([^】]{1,20})】/g)].map(m => m[1]);
    console.log(`      块头：${[...new Set(headers)].join(' / ') || '（没有块头）'}`);
    for (const [label, needle] of [
      ['她的状态块【当前状态】', '【当前状态】'],
      ['"主导情绪"那句', '主导情绪'],
      [' appraisal 那句话（悬着/替他）', '悬着'],
      [' appraisal 那句话（替他）', '替他'],
      ['她的恐惧(fear/恐惧)', '恐惧'],
      ['她的平静(calm/平静)', '平静'],
      ['挂着的那件事原文', '他体检结果到底怎么样'],
    ] as Array<[string, string]>) {
      console.log(`      ${prompt.includes(needle) ? '✓ 有' : '✗ 没有'}　${label}`);
    }
    const stateLine = prompt.split('\n').find(l => l.includes('【当前状态】'));
    if (stateLine) console.log(`\n      【当前状态】原文：${stateLine.slice(0, 200)}`);
    const domLine = prompt.split('\n').find(l => l.includes('主导情绪'));
    if (domLine) console.log(`      主导情绪那一行：${domLine.slice(0, 120)}`);
    const concernLine = prompt.split('\n').find(l => l.includes('他体检结果到底怎么样'));
    if (concernLine) console.log(`      挂着的那件事那一行：${concernLine.slice(0, 160)}`);
  }
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  restore();
}
