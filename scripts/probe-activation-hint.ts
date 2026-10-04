// 两格小探针：把"她静息 + 他讲平常事/他难过"两格里**轮末**的激活态打出来。
//
// 要钉的是 v1.48b A/B 里那条操纵检查为什么"没过"：
//   末尾提示用的是 `turnOutput.updatedEmotionState`（**本轮更新之后**，他这句话已经落进来了），
//   而我的检查是按场景分组（"她静息"是**本轮开始前**的标签）要求它不出现。
// 这个探针只回答一句：那两格里她轮末到底还是不是"静息"。

import { readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';
import { RESTING_EMOTION_BASELINE, activationOf, activationHint } from '../src/lib/emotionActivation.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const MEM = 'memories';
const BAK = 'memories.ab-ah-bak';
const B = RESTING_EMOTION_BASELINE;
const CASES = [
  ['r1', '今天下午把阳台收拾了一下，累是累，看着还行。'],
  ['r2', '工作上有点烦，被领导当众说了一顿，心里挺堵的。'],
] as const;

{
  let alive = false;
  try { const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) }); alive = r.ok; } catch { /* 无实例 */ }
  if (alive) { console.error('[预检] 3000 端口上有服务在跑。'); process.exit(3); }
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
const DUMP = '.tmp-probe-ah.txt';
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
  console.log(`[管道] 127.0.0.1:${port}\n`);
  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;

  for (const [id, text] of CASES) {
    const st = structuredClone(real) as Record<string, unknown>;
    (st as Record<string, unknown>).emotions = { ...B };
    (st as Record<string, unknown>).baselineEmotions = { ...B };
    srv.aiEngine.emotionState = structuredClone(st) as never;
    const co = aiCoordinator as unknown as Record<string, unknown>;
    co.valenceHistory = []; co.topicHistory = co.herValenceHistory = [];
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);
    const before = activationOf(st as never);
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, userId: 'probe-ah', recentMessages: [{ role: 'user', content: '早' }] }),
    });
    const data = await res.json() as { response?: string };
    const state = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
    const after = activationOf({ emotions: (state.emotions ?? {}) as Record<string, number>, baselineEmotions: B } as never);
    console.log(`${'='.repeat(88)}\n${id}｜他说：${text}\n${'='.repeat(88)}`);
    console.log(`   她的状态·**本轮开始前**（场景标签就是按这个分的）：${before.note}`);
    console.log(`   她的状态·**本轮之后**（末尾提示用的就是这一份）：${after.note}`);
    console.log(`   轮末偏离：${Object.entries(after.delta).filter(([, v]) => v > 0.05)
      .map(([k, v]) => `${k} +${v.toFixed(3)}`).join('  ') || '（没有正偏离）'}`);
    console.log(`   activationHint 会给：${activationHint({ emotions: state.emotions, baselineEmotions: B } as never) || '（空串，不注入）'}`);
    console.log(`   她回：${data.response}`);
    const prompt = readFileSync(DUMP, 'utf8');
    console.log(`   Prompt 里含【我此刻的状态】：${prompt.includes('【我此刻的状态】') ? '是' : '否'}`);
  }
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`\n[恢复] ${MEM}/ 已还原`);
}
