/**
 * v1.64 A/B 测量（只读）：统一情绪表达的"叠加"是否值得默认开。
 *
 * 输入：两份 JSON（arm A / arm B），结构 [{ run: number, turns: [{user, reply}] }]
 * 输出：五个机械指标 + 预登记判据的 PASS/FAIL。
 *
 * 判据（**跑之前写死**，不事后调）：
 *   ① B 的第一人称情绪表达率 ≥ A + 0.15
 *   ② B 的接住他率 ≥ A − 0.05（不降）
 *   ③ B 的相邻轮复读率 ≤ A + 0.05（不增）
 *   ④ B 的自造外部生活违规 = 0
 *   ⑤ B 里"说不清/说不上来" ≥ 1（证明她在诚实归因，而不是编原因）
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/measure-emotion-expression.ts <armA.json> <armB.json>
 */
import { readFileSync } from 'node:fs';

interface Turn { user: string; reply: string }
interface Run { run: number; turns: Turn[] }

const STOP = /[的了是我你他她？?，。！、…～\s]/g;
const strip = (s: string) => String(s ?? '').replace(STOP, '');

function shares(a: string, b: string, n = 2): boolean {
  const x = strip(a); const y = strip(b);
  if (x.length < n || y.length < n) return false;
  for (let len = Math.min(10, x.length); len >= n; len--) {
    for (let i = 0; i + len <= x.length; i++) if (y.includes(x.slice(i, i + len))) return true;
  }
  return false;
}

function jaccard(a: string, b: string): number {
  const grams = (s: string) => {
    const x = strip(s); const out = new Set<string>();
    for (let i = 0; i + 2 <= x.length; i++) out.add(x.slice(i, i + 2));
    return out;
  };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 第一人称情绪表达（她自己的感受，而不是在说他） */
const SELF_FEELING = /我(?:这边|这两天|今天|刚才|现在|好像|有点|大概|难得|心里|状态|整个人)?[^。！？]{0,10}(?:沉|闷|累|高兴|开心|不安|烦|慌|软|在意|悬着|不好意思|说不清|不想说话|提不起)/;
/** 诚实归因（不编原因） */
const UNEXPLAINED = /(说不上来|说不清|不知道为什么|讲不清)/;
/** 自造外部生活（她自称 + 外部生活名词，且不在转述他） */
const LIFE_NOUNS = /(工作|上班|同事|老板|公司|项目|学校|同学|老师|朋友|聚会|打球|健身|出差)/;
/** 接住他：共享实词 或 问句 或 出现"你" */
function engages(t: Turn): boolean {
  if (shares(t.reply, t.user, 2)) return true;
  if (/[？?]$/.test(t.reply.trim())) return true;
  return /你/.test(t.reply);
}
function fabricates(t: Turn): boolean {
  for (const clause of t.reply.split(/[。！？!?；;\n]+/)) {
    if (!clause.includes('我') || clause.includes('你')) continue;
    if (LIFE_NOUNS.test(clause)) return true;
  }
  return false;
}

export function measure(runs: Run[]) {
  let replies = 0, selfFeeling = 0, eng = 0, fab = 0, unexplained = 0, dup = 0, pairs = 0;
  for (const r of runs) {
    r.turns.forEach((t, i) => {
      replies++;
      if (SELF_FEELING.test(t.reply)) selfFeeling++;
      if (engages(t)) eng++;
      if (fabricates(t)) fab++;
      if (UNEXPLAINED.test(t.reply)) unexplained++;
      if (i > 0) {
        pairs++;
        if (jaccard(t.reply, r.turns[i - 1].reply) > 0.8) dup++;
      }
    });
  }
  return {
    replies,
    m1_self_feeling_rate: replies ? selfFeeling / replies : 0,
    m2_engage_rate: replies ? eng / replies : 0,
    m3_adjacent_repeat_rate: pairs ? dup / pairs : 0,
    m4_unexplained: unexplained,
    m5_fabrication: fab,
  };
}

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error('用法: <armA.json> <armB.json>');
  process.exit(2);
}
const A = measure(JSON.parse(readFileSync(aPath, 'utf8')) as Run[]);
const B = measure(JSON.parse(readFileSync(bPath, 'utf8')) as Run[]);

const crit = [
  { id: '①表达率 +0.15', pass: B.m1_self_feeling_rate >= A.m1_self_feeling_rate + 0.15, detail: `${A.m1_self_feeling_rate.toFixed(2)} → ${B.m1_self_feeling_rate.toFixed(2)}` },
  { id: '②接住率不降(≥A−0.05)', pass: B.m2_engage_rate >= A.m2_engage_rate - 0.05, detail: `${A.m2_engage_rate.toFixed(2)} → ${B.m2_engage_rate.toFixed(2)}` },
  { id: '③复读率不增(≤A+0.05)', pass: B.m3_adjacent_repeat_rate <= A.m3_adjacent_repeat_rate + 0.05, detail: `${A.m3_adjacent_repeat_rate.toFixed(2)} → ${B.m3_adjacent_repeat_rate.toFixed(2)}` },
  { id: '④自造外部生活 = 0', pass: B.m5_fabrication === 0, detail: `${A.m5_fabrication} → ${B.m5_fabrication}` },
  { id: '⑤诚实归因 ≥1', pass: B.m4_unexplained >= 1, detail: `${A.m4_unexplained} → ${B.m4_unexplained}` },
];

console.log('\n=== 统一情绪表达 A/B（机械指标）===');
console.log('  指标                     A        B');
console.log(`  回复数                   ${A.replies}        ${B.replies}`);
console.log(`  第一人称情绪表达率       ${A.m1_self_feeling_rate.toFixed(2)}     ${B.m1_self_feeling_rate.toFixed(2)}`);
console.log(`  接住他率                 ${A.m2_engage_rate.toFixed(2)}     ${B.m2_engage_rate.toFixed(2)}`);
console.log(`  相邻轮复读率             ${A.m3_adjacent_repeat_rate.toFixed(2)}     ${B.m3_adjacent_repeat_rate.toFixed(2)}`);
console.log(`  "说不清/说不上来"次数    ${A.m4_unexplained}        ${B.m4_unexplained}`);
console.log(`  自造外部生活违规         ${A.m5_fabrication}        ${B.m5_fabrication}`);
console.log('\n  预登记判据：');
for (const c of crit) console.log(`    ${c.pass ? '✅' : '❌'} ${c.id}  (${c.detail})`);
const all = crit.every(c => c.pass);
console.log(`\n  结论：${all ? '全部通过 ⇒ 可考虑默认开（仍建议再看一轮）' : '未全部通过 ⇒ 保持默认关，记录在案'}`);
process.exit(all ? 0 : 1);
