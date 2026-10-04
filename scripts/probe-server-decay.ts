// ── v1.43 探针：服务端时间衰减接上之前 / 之后（两臂同一条真管道）──
//
// 背景（v1.41 挖出的既有 bug，见 `scripts/probe-low-period-idle.ts` 的原始记录）：
//   `processTimeDecay` 只能经 `StateDecayed` 事件到达，而那个事件**只有前端 store 在发**
//   ⇒ 服务端（server.ts / aiCoordinator / server/services）从不衰减。
//   实测：空闲 0.5/30/96/168 小时后 sad = 0.172/0.157/0.157/0.157 —— 一周与一天一模一样。
// v1.43 把衰减接在协调器**阶段 0**（刺激之前），并加 `DISABLE_SERVER_DECAY` 回退开关。
// 本探针就是那一改的**前后对照**，两臂共用同一条真管道、同一句话、同一个起始状态。
//
// 两个通道分开看，别混：
//   · **衰减**（九情回归各自静息基线）—— 旧臂预期不发生；新臂预期随空档单调回落到基线
//   · **低谷**（v1.37 的时长读数 + v1.43 的结案理由）—— 衰减把深度带回死区以下时，
//     结案理由必须是 `idle`（时间到了），**不许**记成 `self`（她自己调过来的）
//
// ── 事先声明的判据（跑之前写死；**第一版量具有两处错，已按下面的说明修好并重跑**）──
//   ① 旧臂复现 v1.41：**长空档**（≥24h）三档的 sad 极差 < 0.02（"没有随时间回归"）
//      ② 新臂衰减：sadAfter 随空档**单调不增**，且**同一空档下新臂必须明显低于旧臂**
//         （两臂只差"衰减做不做"，别的通道两边一样 ⇒ 差值就是衰减那一份）
//   ③ 新臂低谷：空档 ≥ 24h 的档结案，且 `closedBy === 'idle'`；
//      空档 ≤ 6h 的档仍 active（她还没被时间带走）
//   ④ 关键一条（v1.37 写错、v1.41 证伪、现在它可能成真的那条）：
//      新臂里**任何**一档都不许出现"靠没人理她结案、却记成 self"
//
// ── 【第一版量具的两处错】（跑完第一版才看见，都是我的错，不是数据的错）──
//   (a) 判据 ① 写的是"长空档三档极差"，代码却把**所有**档位都算了进去，还把 12h 那档的噪声
//       （12h 会触发**孤独**内在事件，sad 被抬到 0.201）当成"衰减有变化" ⇒ 误报 ✗。
//       数据其实完全符合：24/72/168h 都是 **0.158，极差 0.000**。
//   (b) 判据 ② 原来写"168h 后 |sad − 基线| < 0.01"，但**读的是这一轮结束后的状态** ——
//       衰减发生在阶段 0，之后的这一轮自己还会动 sad（重逢/孤独/评价）。
//       实测 168h 衰减本身已把 0.20 打到 ~0（0.20×2⁻²⁸），剩下的 0.043 全是**这一轮**的贡献
//       ⇒ 拿"轮末值 vs 基线"当判据，量的是别的东西（同 v1.37 学到的：终点必须量到那条通路）。
//       改成**两臂同档对照**（只差"衰减做不做"），差值即衰减那一份。
//   (c) 附带：12h 正好是**数学上的跨越点**（起始 0.20，sad 半衰期 6h ⇒ 0.20×2⁻² = 0.05 = 退出死区），
//       浮点上落在哪边都说得通 ⇒ 那档改成**边界档，不作判据**（判据改看 ≤6h）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/probe-server-decay.ts [--keep]

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
delete process.env.DISABLE_BASELINE_DECAY;   // 两臂都用 v1.24 的"回归静息基线"语义

const KEEP = process.argv.includes('--keep');
const MEM = 'memories';
const BAK = 'memories.ab-decay-bak';
const ROWS = 'server-decay-rows.jsonl';
/** 他这次说的是一句纯寒暄（不带来任何情绪）—— 这样"变化"只可能来自时间通道 */
const TEXT = '嗯，我在。';
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];
const GAPS_H = [0.5, 6, 12, 24, 72, 168];
/** 起始深度：静息基线 + sad 0.20（sad 半衰期 6h ⇒ 衰减单独跨过死区 0.05 需要 12h） */
const START_DEPTH = 0.20;

type Arm = 'old' | 'new';
function applyArm(arm: Arm) {
  if (arm === 'old') process.env.DISABLE_SERVER_DECAY = 'true';
  else delete process.env.DISABLE_SERVER_DECAY;
}

interface Row {
  arm: Arm; gapH: number;
  sadBefore: number; sadAfter: number; joyAfter: number;
  active: boolean; established: boolean; hours: number; phase: string;
  closedBy: string | null; lastEpisodeHours: number | null;
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

const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

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

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;
  console.log(`[静息基线] sad=${(baseline.sad ?? 0).toFixed(4)} joy=${(baseline.joy ?? 0).toFixed(4)}`
    + ` love=${(baseline.love ?? 0).toFixed(4)}`);

  /** 每个单元格都从**同一个她**出发：静息 + sad 0.20，并且已经"成段"在低谷 30 小时 */
  const makeState = () => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline, sad: (baseline.sad ?? 0) + START_DEPTH };
    s.baselineEmotions = { ...baseline };
    const now = Date.now();
    s.lowPeriod = {
      since: now - 30 * 3_600_000, lastEvaluatedAt: now,
      peakDepth: 0.25, lastDepth: START_DEPTH, lastDelta: 0, turns: 6, selfRecovery: 0,
    };
    return s;
  };

  console.log(`[跑法] 两臂 × 空闲 ${GAPS_H.join('/')} 小时 × 各 1 轮（同一句话「${TEXT}」）\n`);

  for (const arm of ['old', 'new'] as Arm[]) {
    applyArm(arm);
    console.log(`── 臂 ${arm === 'old' ? '旧（DISABLE_SERVER_DECAY=true，复现 v1.41）' : '新（服务端衰减已接）'} ──`);
    for (const gapH of GAPS_H) {
      const st = makeState();
      srv.aiEngine.emotionState = structuredClone(st) as never;
      const c = aiCoordinator as unknown as Record<string, unknown>;
      c.valenceHistory = []; c.topicHistory = []; c.herValenceHistory = [];
      conflictManager.reset();
      markInteraction(Date.now() - gapH * 3_600_000);

      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: TEXT, userId: 'probe-decay', recentMessages: RECENT }),
      });
      const data = await res.json() as { response?: unknown; emotionState?: unknown };
      const post = (data.emotionState ?? st) as never as {
        emotions: Record<string, number>;
        lowPeriod?: { lastEpisode?: { hours?: number; closedBy?: string } };
      };
      const lp = lowPeriodOf(post as never);
      const row: Row = {
        arm, gapH,
        sadBefore: (baseline.sad ?? 0) + START_DEPTH,
        sadAfter: Number(post.emotions?.sad ?? NaN),
        joyAfter: Number(post.emotions?.joy ?? NaN),
        active: lp.active, established: lp.established, hours: lp.hours, phase: lp.phase,
        closedBy: lp.lastEpisode?.closedBy ?? null,
        lastEpisodeHours: post.lowPeriod?.lastEpisode?.hours ?? null,
      };
      rows.push(row);
      console.log(`   ${pad(String(gapH) + 'h', 7)}sad ${row.sadBefore.toFixed(3)} → ${row.sadAfter.toFixed(3)}`
        + `  joy ${row.joyAfter.toFixed(3)}  低谷 active=${row.active ? 'Y' : 'n'}`
        + ` ${row.active ? `hours=${row.hours} ${row.phase}` : `closedBy=${row.closedBy ?? '-'} last=${row.lastEpisodeHours ?? '-'}h`}`);
    }
    console.log('');
  }
  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const get = (arm: Arm, gapH: number) => rows.find(r => r.arm === arm && r.gapH === gapH)!;
  console.log(`${'='.repeat(86)}\n裁定（判据见文件头，跑之前写死）\n${'='.repeat(86)}`);
  const longGaps = GAPS_H.filter(g => g >= 24), shortGaps = GAPS_H.filter(g => g <= 6);
  const boundaryGaps = GAPS_H.filter(g => g > 6 && g < 24);

  // ① 旧臂在**长空档**上确实不随时间变化（12h 那档会触发孤独事件，不属于这条判据，见文件头 (a)）
  const oldTail = longGaps.map(g => get('old', g).sadAfter);
  const oldSpread = Math.max(...oldTail) - Math.min(...oldTail);
  const oldFlat = oldSpread < 0.02;
  console.log(`   ① 旧臂复现 v1.41：长空档 ${longGaps.join('/')}h 的 sad = ${oldTail.map(v => v.toFixed(3)).join(' / ')}`
    + `（极差 ${oldSpread.toFixed(3)}） ⇒ ${oldFlat ? '✓ 没有随时间回归（服务端确实没衰减）' : '✗ 竟然有变化'}`);
  console.log(`      （全部档位：${GAPS_H.map(g => `${g}h=${get('old', g).sadAfter.toFixed(3)}`).join(' ')}`
    + ` —— 12h 那档更高是**孤独**内在事件，不是衰减）`);

  // ② 新臂：单调 + **两臂同档对照**（只差"衰减做不做"，差值即衰减那一份）
  const news = GAPS_H.map(g => get('new', g).sadAfter);
  const monotone = news.every((v, i) => i === 0 || v <= news[i - 1] + 0.001);
  const diffs = GAPS_H.map(g => ({
    g, old: get('old', g).sadAfter, now: get('new', g).sadAfter,
    delta: get('old', g).sadAfter - get('new', g).sadAfter,
  }));
  const allLower = diffs.every(d => d.now <= d.old + 0.001);
  const longDelta = Math.max(...longGaps.map(g => get('old', g).sadAfter - get('new', g).sadAfter));
  console.log(`   ② 新臂衰减：sad = ${news.map(v => v.toFixed(3)).join(' / ')}`
    + ` ⇒ ${monotone ? '✓ 单调不增' : '✗ 不单调'}；两臂同档对照 ${allLower ? '✓ 每一档新臂都不高于旧臂' : '✗ 有档反而更高'}`);
  for (const d of diffs) {
    console.log(`      ${pad(String(d.g) + 'h', 7)}旧 ${d.old.toFixed(3)} → 新 ${d.now.toFixed(3)}（衰减贡献 ${d.delta.toFixed(3)}）`);
  }
  const longDecayed = longDelta > 0.05;
  console.log(`      长空档上衰减贡献最大 ${longDelta.toFixed(3)} ⇒ ${longDecayed ? '✓ 衰减确实在起作用' : '✗ 几乎没起作用'}`);

  // ③ 低谷
  const longOk = longGaps.every(g => !get('new', g).active && get('new', g).closedBy === 'idle');
  const shortOk = shortGaps.every(g => get('new', g).active);
  console.log(`   ③ 新臂低谷：≥24h 的档 ${longGaps.map(g => `${g}h=${get('new', g).closedBy ?? '(还开着)'}`).join(' ')}`
    + ` ⇒ ${longOk ? '✓ 都被时间结案、理由记 idle' : '✗ 结案或理由不对'}`);
  console.log(`      ≤6h 的档 ${shortGaps.map(g => `${g}h=${get('new', g).active ? 'active' : 'closed'}`).join(' ')}`
    + ` ⇒ ${shortOk ? '✓ 她还没被时间带走' : '✗ 太早结案'}`);
  if (boundaryGaps.length > 0) {
    console.log(`      （边界档 ${boundaryGaps.map(g => `${g}h=${get('new', g).active ? 'active' : `closed(${get('new', g).closedBy})`}`).join(' ')}`
      + ` —— 12h 正好是数学跨越点，浮点上落哪边都算对，**不作判据**）`);
  }

  const fakeSelf = rows.filter(r => r.arm === 'new' && !r.active && r.closedBy !== 'idle');
  console.log(`   ④ 关键：新臂里"没人在却记成 self"的档 = ${fakeSelf.length}`
    + ` ⇒ ${fakeSelf.length === 0 ? '✓ 没有把"时间到了"读成"她自己调过来了"' : '✗ 出现了假的自我安抚'}`);
  const pass = oldFlat && monotone && allLower && longDecayed && longOk && shortOk && fakeSelf.length === 0;
  console.log(`   ⇒ 探针层面：${pass ? '**符合设计**' : '**不符合设计，先别提交**'}`);
  console.log(`   明细：${ROWS}`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  restore();
}
