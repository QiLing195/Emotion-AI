// ── v1.45 离线重打分：她到底有多"复读机"？──
//
// **零 LLM 调用**：只读已经落下的真管道 artifact（`*.jsonl`），用 `replyDiversity` 重新量。
// 为什么先做这一步：v1.36/v1.38/v1.42 三次判"未达标"都用的是**二值**尺子（逐字重复组数），
// 而 v1.42 读原文时发现 A 臂同一输入的三条回复也高度同形 ⇒ 那把尺子可能把"两边都有的模板化"
// 只算在一边头上。先把历史数据量准，再谈要不要改代码。
//
// 三把尺子分开报（定义见 `src/lib/replyDiversity.ts`）：
//   ① 同输入  —— **测量装置的产物**（生产里同一句不会再来一遍）
//   ② 按时间  —— 与她上一条比（= v1.32 生成后查重的口径，生产里真会发生）
//   ③ 开场复用 —— 跨上下文她"怎么开头"的复用（最像用户抱怨的"她怎么老是这么开头"）
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/measure-reply-diversity.ts

import { readFileSync, existsSync } from 'node:fs';
import { sameInputDiversity, inOrderDiversity, openerReuse } from '../src/lib/replyDiversity.js';

interface Spec {
  file: string; textKey: 'reply' | 'text';
  /** 同一输入的分组键（同一句话 × 同一条件） */
  groupKey: (r: Record<string, unknown>) => string;
  /** 条件维（treat/ctl、正面/对照…）—— **必须与臂分开**：
   *  第一版把 treat/ctl 混成一条臂，读出来的条数是两倍、而且把两种条件下的回复混进了比较池 */
  condKey: (r: Record<string, unknown>) => string;
  note: string;
}

const SPECS: Spec[] = [
  { file: 'low-period-restraint-rows.jsonl', textKey: 'reply', note: 'v1.42 少追问（**第三跑**：换了护栏、加了"上次那句"当靶子）',
    groupKey: r => `${r.cond}/${r.id}`, condKey: r => String(r.cond) },
  { file: 'low-period-restraint-rows-pass2.jsonl', textKey: 'reply', note: 'v1.42 少追问（第二跑 —— 就是被坏护栏判掉的那一跑）',
    groupKey: r => `${r.cond}/${r.id}`, condKey: r => String(r.cond) },
  { file: 'low-period-restraint-rows-pass1.jsonl', textKey: 'reply', note: 'v1.42 少追问（第一跑，作废）',
    groupKey: r => `${r.cond}/${r.id}`, condKey: r => String(r.cond) },
  { file: 'low-period-stance-rows.jsonl', textKey: 'reply', note: 'v1.38 准许低位（第二跑）',
    groupKey: r => `${r.kind}/${r.id}`, condKey: r => String(r.kind) },
  { file: 'low-period-hold-back-rows.jsonl', textKey: 'reply', note: 'v1.39 不追问·动机层（三臂）',
    groupKey: r => `${r.cond}/${r.id}`, condKey: r => String(r.cond) },
  { file: 'low-period-proactive-rows.jsonl', textKey: 'text', note: 'v1.40/v1.44 主动消息（她主动开口）',
    groupKey: r => String(r.cell ?? r.cond), condKey: r => String(r.cell ?? r.cond).split('/')[1] ?? 'treat' },
];

/** 开场复用最多的一种，在所有 artifact 上合起来看 —— 这是最强的"跨天"证据 */
const poolByArm = new Map<string, string[]>();
const rowsOf = (spec: Spec): Array<Record<string, unknown>> => {
  if (!existsSync(spec.file)) return [];
  return readFileSync(spec.file, 'utf8').trim().split(/\n/).filter(Boolean).map(l => JSON.parse(l));
};

const pad = (s: string, n: number) => {
  let w = 0;
  for (const ch of s) w += /[\u3000-\u9fff\uff00-\uffef，。？！：；]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

for (const spec of SPECS) {
  const rows = rowsOf(spec);
  if (!rows.length) { console.log(`\n### ${spec.file} —— （没有这个文件，跳过）`); continue; }
  const nonEmpty = rows.filter(r => typeof r[spec.textKey] === 'string' && String(r[spec.textKey]).trim());
  const arms = [...new Set(nonEmpty.map(r => String(r.arm ?? '?')))].sort();
  const conds = [...new Set(nonEmpty.map(r => spec.condKey(r)))].sort();
  console.log(`\n${'='.repeat(96)}\n### ${spec.note}（${spec.file}）\n${'='.repeat(96)}`);
  console.log(`   条数 ${nonEmpty.length}｜臂 ${arms.join('/')}｜条件 ${conds.join('/')}`);

  for (const arm of arms) {
    for (const cond of conds) {
      const mine = nonEmpty.filter(r => String(r.arm ?? '?') === arm && spec.condKey(r) === cond);
      if (mine.length < 2) continue;
      const texts = mine.map(r => String(r[spec.textKey]));
      // ① 同输入（组内两两）
      const groups = new Map<string, string[]>();
      for (const r of mine) {
        const k = spec.groupKey(r);
        groups.set(k, [...(groups.get(k) ?? []), String(r[spec.textKey])]);
      }
      const same = sameInputDiversity([...groups.entries()].map(([key, replies]) => ({ key, replies })));
      // ② 按时间（文件顺序 = 落盘顺序）
      const order = inOrderDiversity(texts);
      // ③ 跨上下文开场
      const reuse = openerReuse(texts);
      console.log(`\n   ── ${arm} / ${cond}（${texts.length} 条，${groups.size} 组）`);
      console.log(`      ① 同输入  ${same.note}`);
      console.log(`      ② 按时间  ${order.note}`);
      console.log(`      ③ 开场复用（框架）最多「${reuse.frame.top.text}」×${reuse.frame.top.count}（占 ${(reuse.frame.share * 100).toFixed(0)}%），`
        + `共 ${reuse.frame.distinct} 种 / ${reuse.n} 条`);
      console.log(`                     （前 12 字口径：最多「${reuse.head.top.text}」×${reuse.head.top.count}，`
        + `共 ${reuse.head.distinct} 种）`);
    }
  }
  // 跨条件合起来（同一臂）：跨话题的开场复用
  for (const arm of arms) {
    const texts = nonEmpty.filter(r => String(r.arm ?? '?') === arm).map(r => String(r[spec.textKey]));
    if (texts.length < 2) continue;
    const reuse = openerReuse(texts);
    console.log(`   ⇒ 臂 ${arm} 跨条件合并（${texts.length} 条）：开场框架 ${reuse.frame.distinct} 种，`
      + `最多「${reuse.frame.top.text}」×${reuse.frame.top.count}（${(reuse.frame.share * 100).toFixed(0)}%）`);
    poolByArm.set(`arm ${arm}`, [...(poolByArm.get(`arm ${arm}`) ?? []), ...texts]);
  }
}

// ── 合起来看：跨脚本、跨条件的开场复用 ──
console.log(`\n${'='.repeat(96)}\n### 全部 artifact 合起来：开场复用（跨话题 / 跨条件的最强证据）\n${'='.repeat(96)}`);
for (const [key, texts] of poolByArm) {
  const reuse = openerReuse(texts);
  console.log(`   ${pad(key, 10)} n=${String(texts.length).padStart(3)}｜开场框架 ${reuse.frame.distinct} 种｜`
    + `最多「${reuse.frame.top.text}」×${reuse.frame.top.count}（${(reuse.frame.share * 100).toFixed(0)}%）`);
}
console.log(`\n（"开场"口径 = ` + '`antiRepetition.assistantOpenerHeads`（去空白后前 12 字）——'
  + ` 正是 Prompt 里【避免重复】那一块承诺要防的东西）`);
