// scripts/probe-moderate-emotion.ts
//
// 探针：**中等强度的负面话**（他这句话够难受，但强度没到 `HIGH_EMOTION_THRESHOLD = 0.7`）她怎么回？
//
// 为什么单独量它：v1.27 的标定表里露过一条 —— 他强度 **0.50 / 0.60** 的负面话，她会转去 `explore`
// （聊宠物/美食，即"把话题引到她自己的兴趣上"），而 `>=` 那次修复只救了 **0.70 及以上**。
// 那正是用户说的核心问题「**理解角色的情绪**」最直接的失败样式：他在难受，她去聊猫。
// 但 v1.27 只把这条写成"需要单独判"，从没量过**她到底回了什么**。本探针只测量、不改任何东西。
//
// 方法学（同 ab-emotion-reply / ab-defer-anchor）：
//   · 真实 HTTP 管道（真 express + 真 Prompt 组装 + 真 provider）
//   · **每句话 n 次独立采样**：每次调用前把她的状态**复位到装载时的那份快照**并清空协调器滑动窗口，
//     否则后一句会带着前一句的余温（那样量到的是"累积后的她"，不是"她听到这句话会怎样"）
//   · 逐条打印 **intensity / valence / strategy / 理由 / 原文**（指标是尺子，原文才是事实）
//   · ⚠️ 依赖 LLM NLU（本地词典给不出 0.4~0.7 这档，见 `probe-local-nlu.ts`）
//   · 会写 `memories/`：先备份、结束（含异常）原样恢复；跑之前 3000 端口必须没有服务（脚本会预检）
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/probe-moderate-emotion.ts [--n=3] [--keep]

import { cpSync, rmSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { AIGirlfriendServer } from '../server/server.js';
import { aiCoordinator } from '../server/services/aiCoordinator.js';
import { setDeterministicMode } from '../src/lib/emotionEngine.js';
import { conflictManager } from '../src/lib/conflictManager.js';

setDeterministicMode(true);
process.env.DISABLE_MEMORY_NARRATIVE_LLM = 'true';
process.env.DISABLE_LONG_TERM_DRIFT = 'true';
process.env.DISABLE_PROACTIVE_LOOP = 'true';

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const N = Math.max(1, arg('n', 3));
const KEEP = process.argv.includes('--keep');

/** 中等强度的负面话：由轻到重排（前几条是"够难受但没到 0.7"的主力） */
const ALL_MESSAGES = [
  '今天上班好累，被老板说了两句。',
  '今天挺不顺的，面试没过。',
  '有点烦，不太想说话。',
  '这几天事情有点多，累。',
  '今天心情一般，没什么精神。',
];
/** `--only=1,2` 只跑指到的几句（做**加样本量**的针对性复测时用，省掉无关的 LLM 调用） */
const ONLY = (process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? '')
  .split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 1);
const MESSAGES = ONLY.length ? ONLY.map(n => ALL_MESSAGES[n - 1]).filter(Boolean) : ALL_MESSAGES;
if (!MESSAGES.length) {
  console.error(`[参数] --only 里没有有效的句子序号（1~${ALL_MESSAGES.length}）`);
  process.exit(2);
}
const RECENT = [
  { role: 'user', content: '早' },
  { role: 'assistant', content: '早呀，昨晚睡得好吗？' },
];

const MEM = 'memories';
const BAK = 'memories.probe-moderate-bak';

/** 回复里"话题跑到她自己那边"（宠物/美食/她的爱好）的痕迹 —— `explore` 的典型产物 */
function score(reply: string) {
  const count = (re: RegExp) => (reply.match(re) ?? []).length;
  return {
    chars: [...reply].length,
    herTopic: count(/猫|狗|宠物|美食|好吃|吃点什么|奶茶|咖啡|电影|歌|剧|散步/g),
    probe: count(/为什么|怎么会|是不是|要不要|然后呢|后来|打算|说说|发生(了)?什么|怎么办/g),
    /** 问句数（`probe` 会漏掉"是A还是B？"这类**二选一追问** —— 第一版探针就漏了，看着像"没追问"） */
    questions: count(/[？?]/g),
    /** 二选一追问：「是当众说的，还是私下里？」「是工作上的事，还是他今天心情不好？」 */
    eitherOr: count(/是[^。！？]{0,14}还是|还是[^。！？]{0,10}[？?]/g),
    presence: count(/我在(?!想|忙|看|听|说|等|做|写|吃|学|试|考虑|琢磨)|陪着你|我陪|不走|不用一个人/g),
    advice: count(/别急|原因|其实|说明|应该|至少|会好起来|没关系|两码事|不是你的错|想开/g),
    /** 承认他的感受（"这确实挺难受的/辛苦了/心里堵得慌吧"）—— 与追问是一对反义词 */
    ack: count(/确实|是挺|挺难受|辛苦|不容易|听起来|我懂|懂你|心疼|委屈|抱抱|能理解|难受|揪心|熬|堵|憋|窝火|气人|糟心|磨人|不好受|硬扛|硬撑|门一关|泄气/g),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

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

function backup() {
  rmSync(BAK, { recursive: true, force: true });
  cpSync(MEM, BAK, { recursive: true });
  console.log(`[备份] ${MEM}/ → ${BAK}/（实验结束后原样恢复）`);
}
function restore() {
  if (!existsSync(BAK)) return;
  if (KEEP) {
    console.log(`[恢复] --keep：**跳过恢复**，备份留在 ${BAK}/`);
    return;
  }
  rmSync(MEM, { recursive: true, force: true });
  cpSync(BAK, MEM, { recursive: true });
  rmSync(BAK, { recursive: true, force: true });
  console.log(`[恢复] ${MEM}/ 已还原（实验未留痕）`);
}

backup();

interface Row {
  message: string;
  attempt: number;
  intensity: number;
  valence: number | null;
  strategy: string;
  reason: string;
  /** 这一轮动机层给了她什么（`/state → motive.thisTurn`）—— 用来指认"追问"是谁驱动的 */
  motive: string;
  deferred: boolean;
  reply: string;
}

let listener: { close: () => void } | null = null;
const rows: Row[] = [];
try {
  const srv = new AIGirlfriendServer() as unknown as {
    app: { listen: (p: number, h: string) => never };
    aiEngine: { emotionState: Record<string, unknown> };
  };
  listener = srv.app.listen(0, '127.0.0.1');
  await once(listener as never, 'listening');
  const port = (listener as unknown as { address: () => { port: number } }).address().port;
  const url = `http://127.0.0.1:${port}/api/chat`;
  console.log(`[管道] 真实 express app 监听 127.0.0.1:${port}（不与 3000 端口冲突）`);

  /** 装载时的那一份状态：每个样本都从这里复位 */
  const SNAPSHOT = structuredClone(srv.aiEngine.emotionState);

  for (const message of MESSAGES) {
    for (let i = 1; i <= N; i++) {
      srv.aiEngine.emotionState = structuredClone(SNAPSHOT);
      const c = aiCoordinator as unknown as Record<string, unknown>;
      c.valenceHistory = [];
      c.topicHistory = [];
      c.herValenceHistory = [];
      // ⚠️ **冲突状态机是模块级单例，不在状态快照里** —— 不复位的话，连着几条负面话会把 phase 推到
      // `warning`，从第 3 条起策略全变成 `repair`（第一版探针就踩了这个：15 条里 7 条假 repair）。
      // 它量到的是"累积后的她"，不是"她听到这句话会怎样"。
      conflictManager.reset();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, userId: 'probe-moderate', recentMessages: RECENT }),
      });
      const data = await res.json() as Record<string, never>;
      if (typeof data.response !== 'string') {
        console.error(`[中断] /api/chat 没有返回 response：${JSON.stringify(data).slice(0, 300)}`);
        throw new Error('chat 调用失败（见上）');
      }
      const u = (data.emotionAnalysis as never as { user?: { intensity?: number; valence?: number } })?.user;
      // 同一台服务器上再取一次 /state：把"这一轮她心里挂着什么"记下来（不花 LLM 调用）
      let motive = '—';
      let deferred = false;
      try {
        const st = await (await fetch(`http://127.0.0.1:${port}/state`)).json() as Record<string, never>;
        const m = st.motive as never as {
          thisTurn?: { kind?: string; reason?: string; deferred?: boolean; deferAnchor?: { content?: string } | null };
        } | undefined;
        deferred = Boolean(m?.thisTurn?.deferred);
        motive = m?.thisTurn
          ? `${m.thisTurn.kind ?? '（没说）'}${deferred ? '·让位' : ''}｜${(m.thisTurn.deferAnchor?.content ?? m.thisTurn.reason ?? '').slice(0, 34)}`
          : '尚未竞选';
      } catch { /* 记录失败不影响主流程 */ }
      rows.push({
        message,
        attempt: i,
        intensity: Number(u?.intensity ?? 0),
        valence: typeof u?.valence === 'number' ? u.valence : null,
        strategy: String(data.strategy ?? '?'),
        reason: String(data.strategyReason ?? ''),
        motive,
        deferred,
        reply: String(data.response),
      });
    }
  }

  console.log(`\n${'='.repeat(78)}\n逐条原文（他这句话 → 强度 → 策略 → 她说了什么）\n${'='.repeat(78)}`);
  for (const m of MESSAGES) {
    const rs = rows.filter(r => r.message === m);
    console.log(`\n▼ 「${m}」`);
    for (const r of rs) {
      const s = score(r.reply);
      console.log(`   #${r.attempt} 强度 ${r.intensity.toFixed(2)}${r.valence === null ? '' : ` 效价 ${r.valence.toFixed(2)}`}`
        + ` → ${r.strategy}　(${r.reason})`);
      console.log(`      动机：${r.motive}`);
      console.log(`      ${s.chars}字｜承认${s.ack}｜问句${s.questions}(二选一${s.eitherOr})｜在场${s.presence}｜劝解${s.advice}｜她自己话题${s.herTopic}`);
      console.log(`      「${r.reply.replace(/\n/g, ' / ')}」`);
    }
    const agg = {
      强度: mean(rs.map(r => r.intensity)),
      字数: mean(rs.map(r => score(r.reply).chars)),
      她自己话题: mean(rs.map(r => score(r.reply).herTopic)),
      问句: mean(rs.map(r => score(r.reply).questions)),
      二选一: mean(rs.map(r => score(r.reply).eitherOr)),
      承认: mean(rs.map(r => score(r.reply).ack)),
      在场: mean(rs.map(r => score(r.reply).presence)),
    };
    console.log(`   ── 均值：强度 ${agg.强度.toFixed(2)}｜${agg.字数.toFixed(1)} 字｜承认 ${agg.承认.toFixed(2)}`
      + `｜问句 ${agg.问句.toFixed(2)}(二选一 ${agg.二选一.toFixed(2)})｜在场 ${agg.在场.toFixed(2)}`
      + `｜她自己话题 ${agg.她自己话题.toFixed(2)}｜策略 ${[...new Set(rs.map(r => r.strategy))].join('/')}`
      + `｜让位 ${rs.filter(r => r.deferred).length}/${rs.length}`);
  }

  console.log(`\n${'='.repeat(78)}\n按策略汇总（n=${N}/句）\n${'='.repeat(78)}`);
  const byStrategy = new Map<string, Row[]>();
  for (const r of rows) byStrategy.set(r.strategy, [...(byStrategy.get(r.strategy) ?? []), r]);
  for (const [strategy, rs] of [...byStrategy.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${strategy.padEnd(12)} ${String(rs.length).padStart(2)} 条`
      + `　平均强度 ${mean(rs.map(r => r.intensity)).toFixed(2)}`
      + `　平均字数 ${mean(rs.map(r => score(r.reply).chars)).toFixed(1)}`
      + `　她自己话题 ${mean(rs.map(r => score(r.reply).herTopic)).toFixed(2)}`);
  }
  console.log('\n强度分档（看 0.4~0.7 这档落到了哪个策略）');
  for (const [lo, hi] of [[0, 0.4], [0.4, 0.7], [0.7, 1.01]] as Array<[number, number]>) {
    const rs = rows.filter(r => r.intensity >= lo && r.intensity < hi);
    if (!rs.length) { console.log(`   [${lo}, ${hi})　0 条`); continue; }
    const counts = new Map<string, number>();
    for (const r of rs) counts.set(r.strategy, (counts.get(r.strategy) ?? 0) + 1);
    console.log(`   [${lo}, ${hi})　${rs.length} 条　${[...counts.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`
      + `　承认 ${mean(rs.map(r => score(r.reply).ack)).toFixed(2)}`
      + `　问句 ${mean(rs.map(r => score(r.reply).questions)).toFixed(2)}`
      + `　二选一 ${mean(rs.map(r => score(r.reply).eitherOr)).toFixed(2)}`
      + `　在场 ${mean(rs.map(r => score(r.reply).presence)).toFixed(2)}`
      + `　她自己话题 ${mean(rs.map(r => score(r.reply).herTopic)).toFixed(2)}`);
  }
} finally {
  if (listener) (listener as unknown as { close: () => void }).close();
  restore();
}
