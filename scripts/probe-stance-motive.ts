// 一次性探针：单放一条 stance 时，服务端的动机层到底怎么决定的（读 /state → motive）
import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';

const MEM = 'memories', BAK = 'memories.ab-probe-backup';
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
let listener: { close: () => void } | null = null;
try {
  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  listener = srv.app.listen(0, '127.0.0.1') as unknown as { close: () => void };
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const now = Date.now();
  const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
  s.emotions = { ...RESTING_EMOTION_BASELINE };
  s.baselineEmotions = { ...RESTING_EMOTION_BASELINE };
  s.internal = {
    ...(s.internal ?? {}),
    mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
    motive: { pool: [{ id: 'k1', kind: 'stance', content: '我觉得人得先对自己诚实', source: {}, salience: 0.6, formedAt: now - 10 * 60_000, expiresAt: now + 6 * 86_400_000, attempts: 0 }] },
  };
  srv.aiEngine.emotionState = structuredClone(s) as never;

  const chat = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '今天下午把阳台收拾了一下，累是累，看着还行。', userId: 'probe', recentMessages: [] }),
  }).then(r => r.json() as Promise<Record<string, unknown>>);
  console.log('回复：', String(chat.response).slice(0, 120));

  const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
  const m = (st as Record<string, unknown>).motive as Record<string, unknown> | undefined;
  console.log('\n/state → motive：');
  console.log('  thisTurn:', JSON.stringify(m?.thisTurn));
  console.log('  pool:', JSON.stringify((m?.pool as Array<Record<string, unknown>> | undefined)?.map(x => ({ kind: x.kind, content: String(x.content).slice(0, 24), salience: x.salience }))));
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log('\n[恢复] memories/ 已还原');
}
