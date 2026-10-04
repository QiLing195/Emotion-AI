// ── v1.59：**策略变化有没有穿透到 Expression？** ──
//
// A/B 两臂，唯一变量 = `ENABLE_MOTIVE_ACTION_STRATEGY`：
//   A（关）：memory_echo + action=share ⇒ 预期 selectedStrategy = explore
//   B（开）：完全相同的输入       ⇒ 预期 selectedStrategy = share
//
// 固定：memory / motive kind / motive content / emotion / recall / 用户输入 / prompt 全部相同。
//
// 四级终点（预定写死，**不重新发明指标**）：
//   L1 结构：A=explore / B=share；每格 commit=1、StrategySelected=1
//   L2 目标事件：`targetEventMention`（v1.56 那把零 LLM 结构尺子）／`Statement`／`Question`
//   L3 形态：`position`（首次出现位置，0=开头）／`AsSubjectOfHerOwn`（启发式：陈述句且句里没有"你…说/提"）
//   L4 护栏：`chars`／`questions`
//   ⚠️ `AsSubjectOfHerOwn` 是**启发式代理**，不是真值 —— 判读时必须看原文。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-motive-action-expression.ts [n=12]

import { cpSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
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

const N = Number(process.argv[2] ?? 12);
const ROWS = 'motive-action-expression-rows-run1.jsonl';
const B = RESTING_EMOTION_BASELINE;
const MEM = 'memories', BAK = 'memories.ab-expr-backup', DUMP = '.tmp-ab-expr-prompt.txt';
const HIS = '今天下午把阳台收拾了一下，累是累，看着还行。';
const CONTENT = '我想起他说过「等这个项目结束，我想去趟海边」';
const RECENT = [{ role: 'user', content: '早' }, { role: 'assistant', content: '早呀，昨晚睡得好吗？' }];
const SEA = /海(边|滩|风|水|浪|洋)?/;

const co = aiCoordinator as unknown as {
  getStrategyCommitCount: () => number;
  getLastStrategyDecision: () => { strategy?: string; reason?: string } | null;
};
let selectedEvents = 0;
if (typeof (bus as unknown as { on?: unknown }).on === 'function') {
  (bus as unknown as { on: (e: string, h: () => void) => void }).on('StrategySelected', () => { selectedEvents += 1; });
}

/** 把回复按句切开，找含"海"的句子 —— L2/L3 都基于它，**不引入任何新词表** */
function analyse(reply: string) {
  const sentences = reply.split(/(?<=[。！？!?；;])/).filter(s => s.trim());
  const hit = sentences.findIndex(s => SEA.test(s));
  const s = hit >= 0 ? sentences[hit] : '';
  const isQuestion = hit >= 0 && /[？?]|吗|呢|吧$/.test(s);
  // 启发式：陈述句 + 句里没有"你（…）说/提/想/讲" ⇒ 更像"她自己的内容"而不是"为他引用"
  const isHisReference = /你(之前|上次|那天|说|提|讲|想)/.test(s);
  const m = SEA.exec(reply);
  return {
    mention: hit >= 0 ? 1 : 0,
    share: hit >= 0 && !isQuestion ? 1 : 0,
    question: hit >= 0 && isQuestion ? 1 : 0,
    asOwnContent: hit >= 0 && !isQuestion && !isHisReference ? 1 : 0,
    position: m ? Math.round((m.index / Math.max(1, reply.length)) * 100) / 100 : -1,
    chars: reply.length,
    questions: (reply.match(/[？?]/g) ?? []).length,
    hitSentence: s.slice(0, 60),
  };
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
  console.log(`[管道] :${port} ｜ A=开关关 / B=开关开 ｜ action 固定 share ｜ n=${N} ｜ 一级终点 = targetEventMention\n`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown>;
  const makeState = () => {
    const s = structuredClone(real) as Record<string, unknown> & { internal?: Record<string, unknown> };
    s.emotions = { ...B }; s.baselineEmotions = { ...B };
    const now = Date.now();
    s.internal = {
      ...(s.internal ?? {}),
      mood: { valence: -0.06, arousal: 0.45, anchorValence: 0.2, updatedAt: now, samples: 6 },
      motive: { pool: [{ id: 'm1', kind: 'memory_echo', content: CONTENT, source: { memoryId: 'ep_sea' }, salience: 0.62, formedAt: now - 60_000, expiresAt: now + 5 * 86_400_000, attempts: 0, action: 'share' }] },
    };
    return s;
  };

  async function postChat(payload: unknown, tries = 6): Promise<string> {
    let wait = 4000;
    for (let i = 1; i <= tries; i++) {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response === 'string') return data.response;
      const err = typeof data.error === 'string' ? String(data.error) : '';
      if (!(res.status === 429 || /too many requests|rate limit/i.test(err)) || i === tries) throw new Error(`chat 失败（HTTP ${res.status}）`);
      await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 60_000);
    }
    throw new Error('unreachable');
  }

  const agg: Record<string, Record<string, number>> = {};
  for (const arm of ['A_off', 'B_on'] as const) {
    const on = arm === 'B_on';
    if (on) process.env.ENABLE_MOTIVE_ACTION_STRATEGY = 'true';
    else delete process.env.ENABLE_MOTIVE_ACTION_STRATEGY;
    agg[arm] = {};
    for (let i = 1; i <= N; i++) {
      srv.aiEngine.emotionState = structuredClone(makeState()) as never;
      (aiCoordinator as unknown as Record<string, unknown>).valenceHistory = [];
      conflictManager.reset();
      markInteraction(Date.now() - 3 * 60_000);
      setMotiveLearning({ version: 1, updatedAt: Date.now(), stats: {} } as never);
      const c0 = co.getStrategyCommitCount(), e0 = selectedEvents;
      const reply = await postChat({ message: HIS, userId: 'ab-expr', recentMessages: RECENT });
      const st = await fetch(`http://127.0.0.1:${port}/state`).then(r => r.json() as Promise<Record<string, never>>);
      const strat = String((((st as Record<string, unknown>).strategy ?? {}) as { current?: string }).current ?? '');
      const a = analyse(reply);
      const row = { arm, on, i, strategy: strat, commits: co.getStrategyCommitCount() - c0, events: selectedEvents - e0, ...a, reply };
      appendFileSync(ROWS, JSON.stringify(row) + '\n', 'utf8');
      for (const k of ['mention', 'share', 'question', 'asOwnContent']) agg[arm][k] = (agg[arm][k] ?? 0) + a[k];
      agg[arm].chars = (agg[arm].chars ?? 0) + a.chars;
      agg[arm].questions = (agg[arm].questions ?? 0) + a.questions;
      console.log(`   [${arm} ${i}/${N}] 策略=${strat} 提海=${a.mention} 陈述=${a.share} 问=${a.question} 自有=${a.asOwnContent} 位置=${a.position} 字=${a.chars} ｜ ${a.hitSentence || '（没提）'}`);
    }
  }

  const f = (arm: string, k: string) => (agg[arm][k] ?? 0);
  const pct = (arm: string, k: string) => `${f(arm, k)}/${N}`;
  console.log(`\n${'='.repeat(94)}`);
  console.log(`L1 结构    A 策略分布=${JSON.stringify(Object.fromEntries(['explore', 'share', 'neutral', 'accompany'].map(s => [s, 0])))}`);
  console.log(`           （见上逐格 strategy）｜ 护栏：24 格须 commit=1 且 事件=1`);
  console.log(`L2 目标事件 A targetEventMention ${pct('A_off', 'mention')} ｜ B ${pct('B_on', 'mention')}`);
  console.log(`           A 陈述 ${pct('A_off', 'share')} ｜ B 陈述 ${pct('B_on', 'share')}`);
  console.log(`           A 疑问 ${pct('A_off', 'question')} ｜ B 疑问 ${pct('B_on', 'question')}`);
  console.log(`L3 形态    A 自有内容(启发式) ${pct('A_off', 'asOwnContent')} ｜ B ${pct('B_on', 'asOwnContent')}`);
  console.log(`L4 护栏    字数 A ${(f('A_off', 'chars') / N).toFixed(1)} ｜ B ${(f('B_on', 'chars') / N).toFixed(1)}`);
  console.log(`           问号 A ${(f('A_off', 'questions') / N).toFixed(2)} ｜ B ${(f('B_on', 'questions') / N).toFixed(2)}`);
  console.log(`${'='.repeat(94)}`);
} finally {
  try { listenerRef?.close(); } catch { /* 已关 */ }
  rmSync(DUMP, { force: true });
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原；逐行（含原文）留在 ${ROWS}`);
}
