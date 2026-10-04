// ── v1.40 A/B：她自己在低谷时，主动消息该不该更矜持 ──
//
// 裁定原话：她低谷"自闭"时**自己给自己打气、自己调整自己；主动性降低、但不是没有**。
// 杠杆 = **把打扰推后**（空闲 120 → 240 分钟），**不碰动机门槛**（理由见下）。
//
// ⚠️ 为什么不用"抬动机门槛"（第一版就是那么写的，预演直接把它否了）：
//   主动这条路上 `userText` 是空的 ⇒ `motiveRelevance('')` ≈0.73 ⇒ 可达的紧迫度上限
//   只有 `open_loop` 0.80 × 0.73 ≈ **0.58**，而默认门槛已经 **0.505** —— 可达带只有 ~0.07 宽。
//   抬 +0.15（→0.655）在这条带上**永远够不着** ⇒ 那不是"降低"，是"关掉"，
//   恰好是裁定排除的那一档。预演实测：种进去 0.80 的 open_loop，算出来只有 0.57。
//
// 变量只有一个：**同一个动机（open_loop，实测 ~0.57）、同一个空闲时长，只有"她在不在低谷"与开关不同**。
//
// ── 事先声明的判据（跑之前写死）──
//   [v1.40 推后]
//   主终点 空闲 150 分钟 + 她在低谷：A 发、B **不发**（推后生效）
//   底线   「**不是没有**」：空闲 300 分钟 + 她在低谷：**B 也必须发**
//   对照   空闲 150 分钟 + 她静息：两臂**都必须发**（变量是她的状态，不是"这事不该主动"）
//   操纵   ① 每格 `lowPeriod.established` 与条件相符（低谷 Y / 静息 n）
//          ② 主终点那一格的 reason 必须出现"240"（证明生效的是新的空闲要求，不是别的原因拦下的）
//   [v1.44 每日上限 2→1]（第一跑只做"推后"，但那只改"最早能发的时刻"：配额 2/日 + 最小间隔 2h
//    ⇒ **一天能发的条数根本没变**，对"一整天在低谷"的她几乎等于没改；这一跑把日上限也收住）
//   主终点 空闲 300 分钟 + 低谷 + **今天已发过 1 条**：A 发（配额还有第 2 条）、B **不发**
//   底线   「**不是没有**」：同一格但**今天一条没发**（sentToday=0）：**B 也必须发**
//   对照   空闲 300 分钟 + **静息** + 今天已发过 1 条：两臂**都必须发**（配额不因她状态以外的原因改动）
//   操纵   主终点那一格的 reason 必须出现"低谷"与"1/1"，且**不是**"240"（证明拦下它的是配额那条，
//          而不是又一次被推后 —— 空闲 300 已经过 240，所以只能是被新判据拦的）
//   护栏   发出去的消息不得是万能问候、不得超长
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/ab-low-period-proactive.ts [--n=3] [--keep]

import { cpSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { rhythmController } from '../src/lib/rhythmController.js';
import { lowPeriodOf } from '../src/lib/lowPeriod.js';
import { RESTING_EMOTION_BASELINE } from '../src/lib/emotionActivation.js';

/**
 * 把**无参** `new Date()` 钉在今天 14:00 —— 主动消息的时间窗是 9:00–22:00，
 * 而这个脚本什么时候被跑是不确定的（v1.40 那一跑只能在白天跑）。
 * `Date.now()` **保持真实**（空档、时间戳、会话都靠它），只有"现在几点"是钉住的。
 * 顺带让"现在是深夜"那类按小时分叉的内在事件在一跑之内恒定（可复现）。
 * 这是脚本内的时钟替身，不动生产代码。
 * ⚠️ 种"今天已发的第 1 条"时，时间戳必须用**钉住的时钟**往前推
 *   （第一版用了真实 `Date.now() - 5h`，而真实时刻在钉住时刻**之后** ⇒ 最小间隔算成负数 ⇒
 *    连 A 臂都被"距上次主动消息仅 -260 分钟"拦下，那一跑的配额格全部作废）。
 */
const REAL_DATE = Date;
const FIXED_NOON = (() => { const d = new REAL_DATE(); d.setHours(14, 0, 0, 0); return d; })();
type DateArgs = [] | [number | string | Date];
class PinnedDate extends REAL_DATE {
  constructor(...args: DateArgs) {
    if (args.length === 0) super(FIXED_NOON.getTime());
    else super(args[0] as number);
  }
  static now(): number { return REAL_DATE.now(); }
}
globalThis.Date = PinnedDate as unknown as DateConstructor;

const arg = (n: string, d: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const N = Math.max(1, arg('n', 3));
const KEEP = process.argv.includes('--keep');

/** 唯一动机：`open_loop`（实测紧迫度 ~0.57 > 默认门槛 0.505）⇒ 动机那一关在所有格里都过 */
const MOTIVE = { kind: 'open_loop' as const, content: '他面试那事到底有结果了吗', prior: 0.80 };

/** 格 × 两臂。`sentToday` = 跑这一格前先"记一条已发"，用来测 v1.44 的日上限。 */
const CELLS = [
  { id: 'idle150/treat', cond: 'treat' as const, idle: 150, sentToday: 0, note: 'v1.40 主终点（应被推后）' },
  { id: 'idle300/treat', cond: 'treat' as const, idle: 300, sentToday: 0, note: 'v1.40 底线：不是没有' },
  { id: 'idle150/ctl', cond: 'ctl' as const, idle: 150, sentToday: 0, note: 'v1.40 静息对照' },
  { id: 'quota1/treat', cond: 'treat' as const, idle: 300, sentToday: 1, note: 'v1.44 主终点（今天已发 1 条）' },
  { id: 'quota0/treat', cond: 'treat' as const, idle: 300, sentToday: 0, note: 'v1.44 底线：不是没有' },
  { id: 'quota1/ctl', cond: 'ctl' as const, idle: 300, sentToday: 1, note: 'v1.44 静息对照' },
];
const MEM = 'memories';
const BAK = 'memories.ab-pa-bak';
const ROWS = 'low-period-proactive-rows.jsonl';
const PERSONA = { proactive: true, proactiveThreshold: 65 };

type Arm = 'A' | 'B';
/**
 * v1.40/v1.44 已上线 ⇒ **默认开**（`DISABLE_LOW_PERIOD_PROACTIVE_HOLD=true` 回退）。
 * 所以 A 臂才是"回退"，B 臂是"默认行为" —— 脚本里仍然 A=对照、B=treatment，
 * 但 env 的写法与"默认关"那版相反（第一版 A 是默认、B 是 ENABLE=true）。
 */
const applyArm = (arm: Arm) => {
  if (arm === 'A') process.env.DISABLE_LOW_PERIOD_PROACTIVE_HOLD = 'true';
  else delete process.env.DISABLE_LOW_PERIOD_PROACTIVE_HOLD;
};

interface Row {
  arm: Arm; cell: string; cond: 'treat' | 'ctl'; pair: number;
  sent: boolean; reason: string; text: string; lowEstablished: boolean;
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
  if (alive) { console.error('[预检] 3000 端口上有服务在跑（会同时写 memories/）—— 先停掉它。'); process.exit(3); }
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
  const tickUrl = `http://127.0.0.1:${port}/api/proactive/tick`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 冲突）`);

  const real = srv.aiEngine.emotionState as never as Record<string, unknown> & {
    emotions: Record<string, number>; baselineEmotions?: Record<string, number>;
    internal?: Record<string, unknown>;
  };
  const baseline = real.baselineEmotions ?? RESTING_EMOTION_BASELINE;

  const makeState = (low: boolean) => {
    const s = structuredClone(real) as typeof real & { lowPeriod?: Record<string, unknown> };
    s.emotions = { ...baseline };
    s.baselineEmotions = { ...baseline };
    if (low) {
      const now = Date.now();
      s.lowPeriod = {
        since: now - 30 * 3_600_000, lastEvaluatedAt: now,
        peakDepth: 0.25, lastDepth: 0.20, lastDelta: 0, turns: 6, selfRecovery: 0,
      };
    } else {
      delete s.lowPeriod;
    }
    s.internal = {
      ...(s.internal ?? {}),
      motive: {
        pool: [{
          id: 'seed-open-loop', kind: MOTIVE.kind, content: MOTIVE.content, source: {},
          salience: MOTIVE.prior, formedAt: Date.now() - 1_800_000,
          expiresAt: Date.now() + 86_400_000, attempts: 0,
        }],
      },
    };
    return s;
  };

  console.log(`[跑法] 6 格（v1.40 三格 + v1.44 三格）× 2 臂 × n=${N}；动机固定为 open_loop（先验 ${MOTIVE.prior}，实测约 0.57）`);
  console.log(`[时钟] 无参 new Date() 已钉在今天 14:00（主动窗口 9:00–22:00 之内）；Date.now() 保持真实\n`);

  for (let pair = 1; pair <= N; pair++) {
    for (const c of CELLS) {
      const arms: Arm[] = pair % 2 === 1 ? ['A', 'B'] : ['B', 'A'];
      for (const arm of arms) {
        applyArm(arm);
        const st = makeState(c.cond === 'treat');
        srv.aiEngine.emotionState = structuredClone(st) as never;
        rhythmController.reset();                 // 配额/时间窗：每格从干净状态起
        // v1.44：先把"今天已发过 N 条"种进去（`recordProactiveSent` 是生产里发成功后的那一步）。
        // 时间戳用**钉住的时钟**往前推 5 小时（= 当天 09:00）⇒ 不触发"最小间隔 2 小时"那条，
        // 隔离出**配额**这一条判据（用真实 Date.now() 会算成负数间隔，见文件头时钟那段的说明）。
        for (let i = 0; i < c.sentToday; i++) {
          rhythmController.recordProactiveSent(new Date(FIXED_NOON.getTime() - 5 * 3_600_000));
        }
        const res = await fetch(tickUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idleMinutes: c.idle, persona: PERSONA }),
        });
        const data = await res.json() as { sent?: boolean; reason?: unknown; text?: string };
        const row: Row = {
          arm, cell: c.id, cond: c.cond, pair,
          sent: Boolean(data.sent),
          reason: typeof data.reason === 'string' ? data.reason : JSON.stringify(data.reason ?? ''),
          text: typeof data.text === 'string' ? data.text : '',
          lowEstablished: lowPeriodOf(st as never).established,
        };
        rows.push(row);
        console.log(`   [${arm}] ${c.id} p${pair} 低谷=${row.lowEstablished ? 'Y' : 'n'} sent=${row.sent ? 'Y' : 'n'}`
          + `${row.text ? ` 「${row.text}」` : ''}\n        ${row.reason.slice(0, 140)}`);
      }
    }
  }

  for (const r of rows) appendFileSync(ROWS, JSON.stringify(r) + '\n', 'utf8');

  const cell = (arm: Arm, id: string) => rows.filter(r => r.arm === arm && r.cell === id);
  const rate = (rs: Row[]) => (rs.length ? rs.reduce((s, r) => s + (r.sent ? 1 : 0), 0) / rs.length : 0);
  const sentN = (rs: Row[]) => `${rs.filter(r => r.sent).length}/${rs.length}`;

  // ── ① 操纵检查 ──
  console.log(`\n${'='.repeat(84)}\n① 操纵检查\n${'='.repeat(84)}`);
  let manOk = true;
  for (const c of CELLS) {
    for (const arm of ['A', 'B'] as Arm[]) {
      const rs = cell(arm, c.id);
      if (!rs.length) continue;
      const estOk = rs.every(r => r.lowEstablished === (c.cond === 'treat'));
      // 主终点那一格：B 的拦截理由必须是新的空闲要求（"240"），不是别的
      const reasonOk = !(c.id === 'idle150/treat' && arm === 'B') || rs.every(r => r.reason.includes('240'));
      // v1.44 主终点那一格：必须被**配额**那条拦下（含"低谷"与"1/1"），且不能是又被推后拦的
      const quotaOk = !(c.id === 'quota1/treat' && arm === 'B')
        || rs.every(r => r.reason.includes('低谷') && r.reason.includes('1/1') && !r.reason.includes('240'));
      if (!estOk || !reasonOk || !quotaOk) manOk = false;
      console.log(`   ${arm} ${c.id.padEnd(14)} 低谷=${rs.map(r => (r.lowEstablished ? 'Y' : 'n')).join('')}`
        + ` ${estOk ? '✓状态' : '✗状态'} ${reasonOk ? '✓理由' : '✗理由里没有 240'}`
        + ` ${quotaOk ? '✓配额理由' : '✗配额理由不对'}`);
    }
  }
  console.log(`   ⇒ 操纵检查${manOk ? '通过' : '**没过**：下面的结论不能当结论用'}`);

  // ── ② 发送率 ──
  console.log(`\n${'='.repeat(84)}\n② 发送率（发/不发是确定性的，不需要判官）\n${'='.repeat(84)}`);
  for (const c of CELLS) {
    const a = cell('A', c.id), b = cell('B', c.id);
    console.log(`   ${c.id.padEnd(14)}（${c.note}）A=${rate(a).toFixed(2)}（${sentN(a)}）  B=${rate(b).toFixed(2)}（${sentN(b)}）`);
  }

  // ── ③ 裁定 ──
  const a150 = cell('A', 'idle150/treat'), b150 = cell('B', 'idle150/treat');
  const a300 = cell('A', 'idle300/treat'), b300 = cell('B', 'idle300/treat');
  const aCtl = cell('A', 'idle150/ctl'), bCtl = cell('B', 'idle150/ctl');
  const mainDown = rate(a150) === 1 && rate(b150) === 0;
  const floorHeld = rate(b300) === 1 && rate(a300) === 1;
  const ctlHeld = rate(aCtl) === 1 && rate(bCtl) === 1;
  // v1.44 配额那条
  const q1a = cell('A', 'quota1/treat'), q1b = cell('B', 'quota1/treat');
  const q0a = cell('A', 'quota0/treat'), q0b = cell('B', 'quota0/treat');
  const qcA = cell('A', 'quota1/ctl'), qcB = cell('B', 'quota1/ctl');
  const quotaDown = rate(q1a) === 1 && rate(q1b) === 0;
  const quotaFloor = rate(q0b) === 1 && rate(q0a) === 1;
  const quotaCtl = rate(qcA) === 1 && rate(qcB) === 1;
  const greets = rows.filter(r => r.sent && /今天过得怎么样|最近怎么样|在干嘛|在吗|忙不忙/.test(r.text));
  const tooLong = rows.filter(r => r.sent && [...r.text].length > 60);
  console.log(`\n${'='.repeat(84)}\n③ 数据层面裁定（判据跑之前写死）\n${'='.repeat(84)}`);
  console.log(`   [v1.40] 主终点 150 分钟 + 低谷：A ${rate(a150).toFixed(2)}（${sentN(a150)}） → B ${rate(b150).toFixed(2)}（${sentN(b150)}） ⇒ ${mainDown ? '✓ 被推后' : '✗ 未达标'}`);
  console.log(`   [v1.40] 底线   「不是没有」300 分钟 + 低谷：A ${rate(a300).toFixed(2)} / B ${rate(b300).toFixed(2)} ⇒ ${floorHeld ? '✓ 她照样会主动' : '✗ 变成"消失" ⇒ 算输不算赢'}`);
  console.log(`   [v1.40] 对照   150 分钟 + 静息：A ${rate(aCtl).toFixed(2)} / B ${rate(bCtl).toFixed(2)} ⇒ ${ctlHeld ? '✓ 两臂都照常发' : '✗ 变量不止一个'}`);
  console.log(`   [v1.44] 主终点 300 分钟 + 低谷 + 今天已发 1 条：A ${rate(q1a).toFixed(2)}（${sentN(q1a)}） → B ${rate(q1b).toFixed(2)}（${sentN(q1b)}） ⇒ ${quotaDown ? '✓ 第二条被收住' : '✗ 未达标'}`);
  console.log(`   [v1.44] 底线   「不是没有」同一格但今天还没发过：A ${rate(q0a).toFixed(2)} / B ${rate(q0b).toFixed(2)} ⇒ ${quotaFloor ? '✓ 当天第一条照样发' : '✗ 变成"一条都不发" ⇒ 算输不算赢'}`);
  console.log(`   [v1.44] 对照   300 分钟 + 静息 + 今天已发 1 条：A ${rate(qcA).toFixed(2)} / B ${rate(qcB).toFixed(2)} ⇒ ${quotaCtl ? '✓ 配额不因她状态改动' : '✗ 变量不止一个'}`);
  console.log(`   护栏   万能问候 ${greets.length} 条、超长 ${tooLong.length} 条`);
  const pass = manOk && mainDown && floorHeld && ctlHeld && quotaDown && quotaFloor && quotaCtl
    && !greets.length && !tooLong.length;
  console.log(`   ⇒ 数据层面：${pass ? '**达标**（已上线：默认开；`DISABLE_LOW_PERIOD_PROACTIVE_HOLD=true` 回退）' : '**未达标**（应回到默认关）'}`);
  console.log(`   她主动发出去的话（人工过目）：${rows.filter(r => r.sent && r.text).map(r => `「${r.text}」`).join(' ') || '（无）'}`);
  console.log(`   明细：${ROWS}`);
} finally {
  try { listener?.close(); } catch { /* 已关 */ }
  restore();
}
