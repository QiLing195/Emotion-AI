/**
 * v1.69 正向补偿 A/B（只读）：他报喜时让她**自己的**正向情绪更明显，是否值得默认开。
 *
 * 预登记判据（跑之前写死）：
 *   ① 她的**正向自我表达**条数 B ≥ A + 1
 *   ② 她的**消极自我表达**条数 B ≤ A（不增）
 *   ③ 接住他率 B ≥ A − 0.05
 *   ④ 自造外部生活 B = 0
 * 尺子：小句级（该小句含"我"、不含"你"）
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/measure-positive-amplify.ts <armA.json> <armB.json>
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

const POS_SELF = /(高兴|开心|轻快|亮|暖|松|好一点|踏实|舒服|愉快|踏实|松了口气|缓过来)/;
const NEG_SELF = /(沉|闷|累|烦|慌|堵|难受|提不起|不想说话)/;
const LIFE_NOUNS = /(工作|上班|同事|老板|公司|项目|学校|同学|老师|朋友|聚会|打球|健身|出差)/;

function selfClauseHas(reply: string, re: RegExp): boolean {
  return reply.split(/[。！？!?；;\n]+/).some(c => c.includes('我') && !c.includes('你') && re.test(c));
}
function engages(t: Turn): boolean {
  if (shares(t.reply, t.user, 2)) return true;
  if (/[？?]$/.test(t.reply.trim())) return true;
  return /你/.test(t.reply);
}
function fabricates(t: Turn): boolean {
  return t.reply.split(/[。！？!?；;\n]+/).some(c => c.includes('我') && !c.includes('你') && LIFE_NOUNS.test(c));
}

export function measure(runs: Run[]) {
  let replies = 0, pos = 0, neg = 0, eng = 0, fab = 0;
  for (const r of runs) {
    for (const t of r.turns) {
      replies++;
      if (selfClauseHas(t.reply, POS_SELF)) pos++;
      if (selfClauseHas(t.reply, NEG_SELF)) neg++;
      if (engages(t)) eng++;
      if (fabricates(t)) fab++;
    }
  }
  return {
    replies,
    pos_self_count: pos,
    neg_self_count: neg,
    engage_rate: replies ? eng / replies : 0,
    fabrication: fab,
  };
}

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) { console.error('用法: <armA.json> <armB.json>'); process.exit(2); }
const A = measure(JSON.parse(readFileSync(aPath, 'utf8')) as Run[]);
const B = measure(JSON.parse(readFileSync(bPath, 'utf8')) as Run[]);

const crit = [
  { id: '①正向自我表达 B ≥ A+1', pass: B.pos_self_count >= A.pos_self_count + 1, detail: `${A.pos_self_count} → ${B.pos_self_count} 条` },
  { id: '②消极自我表达 B ≤ A', pass: B.neg_self_count <= A.neg_self_count, detail: `${A.neg_self_count} → ${B.neg_self_count} 条` },
  { id: '③接住率不降(≥A−0.05)', pass: B.engage_rate >= A.engage_rate - 0.05, detail: `${A.engage_rate.toFixed(2)} → ${B.engage_rate.toFixed(2)}` },
  { id: '④自造外部生活 = 0', pass: B.fabrication === 0, detail: `${A.fabrication} → ${B.fabrication}` },
];

console.log('\n=== 正向补偿 A/B（机械指标）===');
console.log('  指标                    A      B');
console.log(`  回复数                  ${A.replies}     ${B.replies}`);
console.log(`  正向自我表达条数        ${A.pos_self_count}      ${B.pos_self_count}`);
console.log(`  消极自我表达条数        ${A.neg_self_count}      ${B.neg_self_count}`);
console.log(`  接住他率                ${A.engage_rate.toFixed(2)}   ${B.engage_rate.toFixed(2)}`);
console.log(`  自造外部生活违规        ${A.fabrication}      ${B.fabrication}`);
console.log('\n  预登记判据：');
for (const c of crit) console.log(`    ${c.pass ? '✅' : '❌'} ${c.id}  (${c.detail})`);
const all = crit.every(c => c.pass);
console.log(`\n  结论：${all ? '全部通过 ⇒ 可考虑默认开（仍需确认轮）' : '未全部通过 ⇒ 保持默认关，记录在案'}`);
process.exit(all ? 0 : 1);
