// scripts/collect-strategy-ledger.ts
//
// v1.34 **样本账本**：把"他刚说了什么 / 她当时是什么局面 / 规则选了哪条 / 她真回了什么"
// 一条一行落盘。它是"让 AI 提议阈值改动"的**唯一证据来源** —— 没有它，
// 提议就只能建立在模型的想象上，而不是建立在真发生过的局面上。
//
// 为什么每条都要连 `StrategyContext` 一起存：
// `scripts/propose-strategy-tuning.ts` 要做的核心动作是**反事实重放** ——
// 把阈值改一点，然后用**同一个 context** 重跑 `selectStrategy`，看哪些样本的策略翻了。
// `selectStrategy` 是纯函数，所以这件事完全确定、完全不花一分钱；
// 但前提是当时的 context 还在。它只在 `processTurn` 内部存在过，不落盘就永远回不来
//（为此在协调器上开了 `getLastStrategyContext()`）。
//
// ⚠️ 副作用：真实管道会写 `memories/`。先整目录备份，结束（含异常）后原样恢复。
// ⚠️ 跑之前 3000 端口的服务必须停掉（两个实例同时写记忆 = 最伤数据的状态）：脚本会**预检并拒绝启动**。
// ⚠️ 强制 `LAYA_STRATEGY=off`：账本要记的是**规则链**的结论，混进 Laya 的改判就没法归因。
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/collect-strategy-ledger.ts [--out=ledger.jsonl]

import { cpSync, rmSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { conflictManager } from '../src/lib/conflictManager.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { markInteraction } from '../server/persistence.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';
process.env.LAYA_STRATEGY = 'off';            // 账本只记规则的结论
delete process.env.STRATEGY_TUNING;           // 记的必须是**默认阈值**下的判定
markInteraction(Date.now() - 3 * 60_000);     // 空闲时长钉常数（否则每条样本的 state 不同）

const strArg = (n: string, d: string) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const OUT = strArg('out', 'strategy-ledger.jsonl');

/**
 * 覆盖各档的句子：从"他明确难受"到"他随口一说"到"他关上门"。
 * 阈值提议需要的是**跨档的样本** —— 全挤在一档里，任何阈值改动都只会看到"全翻"或"全不翻"。
 */
const MESSAGES: { id: string; text: string }[] = [
  { id: 's01', text: '我今天面试又挂了，真的特别难受，感觉自己特别没用。' },
  { id: 's02', text: '这次又没成，我大概就是这样的人吧。' },
  { id: 's03', text: '我真的撑不住了，什么都不想做了。' },
  { id: 's04', text: '刚才被老板当众骂了一顿，太丢人了。' },
  { id: 's05', text: '你说我是不是特别没用？' },
  { id: 's06', text: '没事，就是有点累，你别管我。' },
  { id: 's07', text: '我妈又打电话来催了，烦死了。' },
  { id: 's08', text: '今天特别想找人说说话，又不知道该说什么。' },
  { id: 's09', text: '今天下班路上看到一只特别胖的橘猫，走路都在晃。' },
  { id: 's10', text: '我今天升职了！老板终于认可我了。' },
  { id: 's11', text: '我最近在研究怎么把本地的模型跑起来，显存只有 4G，挺麻烦的。' },
  { id: 's12', text: '明天要去体检，心里有点七上八下的。' },
  { id: 's13', text: '又是睡不着的一晚，感觉有点孤单。' },
  { id: 's14', text: '算了，不说了。' },
  // v1.36 补：**正面样本**。改"好事不许走安静陪着"时账本里只有 s10 一条 joy ⇒ A/B 没有样本可看。
  // 结构性改动最容易栽在"账本没覆盖到"：重放显示 0 条翻，看着像"改动没用"，其实是没测到。
  { id: 's15', text: '我面试过了！下周一就能入职。' },
  { id: 's16', text: '今天自己做的红烧肉居然特别成功，我都惊了。' },
  { id: 's17', text: '我喜欢的球队今天赢了，赢得很漂亮。' },
  { id: 's18', text: '刚收到消息，我那个副业接到第一单了。' },
  { id: 's19', text: '谢谢你一直在，这段时间要不是你我真的扛不过来。' },
  { id: 's20', text: '明天终于能休息了，我打算睡到中午。' },
];

const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

// ── 预检：3000 端口不能有别的实例在写 memories/ ──
{
  let alive = false;
  try {
    const r = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) });
    alive = r.ok;
  } catch { /* 连不上 = 没有实例 */ }
  if (alive) {
    console.error('[预检] 3000 端口上还有服务在跑 —— 两个实例同时写 memories/ 会伤数据，先停掉它再跑本脚本。');
    process.exit(3);
  }
}

const MEM = 'memories';
const BAK = 'memories.ab-ledger-bak';
function restore() {
  if (!existsSync(BAK)) return;
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（账本采集未留痕）`);
}
rmSync(BAK, { recursive: true, force: true });
cpSync(MEM, BAK, { recursive: true });
writeFileSync(OUT, '', 'utf8');

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
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 冲突）`);
  console.log(`[账本] ${OUT}；共 ${MESSAGES.length} 条样本；阈值=默认（STRATEGY_TUNING 未设）；Laya=off`);

  let written = 0;
  let skipped = 0;
  for (const m of MESSAGES) {
    conflictManager.reset();
    markInteraction(Date.now() - 3 * 60_000);   // 每条样本的局面尽量一致
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: m.text, userId: 'ledger', recentMessages: RECENT }),
    });
    const data = await res.json() as { response?: unknown; error?: unknown };
    const reply = typeof data.response === 'string' ? data.response : '';
    const ctx = aiCoordinator.getLastStrategyContext();
    const dec = aiCoordinator.getLastStrategyDecision();
    if (!reply || !ctx || !dec) {
      skipped++;
      console.log(`   ✗ ${m.id} 丢弃（回复/上下文/裁决缺一）：reply=${!!reply} ctx=${!!ctx} dec=${!!dec}`);
      continue;
    }
    const line = JSON.stringify({
      id: m.id, message: m.text, reply,
      strategy: dec.strategy, reason: dec.reason, confidence: dec.confidence,
      ctx,
    });
    appendFileSync(OUT, line + '\n', 'utf8');
    written++;
    console.log(`   ${m.id} ${(dec.strategy + '        ').slice(0, 10)} ${[...reply.replace(/\s/g, '')].length}字  ｜${reply.replace(/\n/g, ' / ').slice(0, 60)}`);
  }
  console.log(`\n[账本] 写入 ${written} 条${skipped ? `，丢弃 ${skipped} 条` : ''} → ${OUT}`);
  console.log('[下一步] node node_modules/tsx/dist/cli.mjs scripts/propose-strategy-tuning.ts --ledger=' + OUT);
} finally {
  if (listener) (listener as unknown as { close: () => void }).close();
  restore();
}
