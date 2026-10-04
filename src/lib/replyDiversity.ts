// ── v1.45 「她是不是变成复读机了」——量这件事的尺子 ──
//
// 起因：v1.36 / v1.38 / v1.42 **三次**都栽在同一个护栏上（"同臂内逐字重复的组数"），
// 而那条护栏是**二值**的（只有完全逐字相同才算一组）。v1.42 那次我读原文时发现：
//   A 臂同一句话的三条回复其实**也高度同形**（只差"第二次/一趟/第二回"这种词），只是没越过
//   "逐字相同"那条线；B 臂因为把问句（变化最多的那部分）拿掉、回复更短，于是越过了。
// ⇒ 那条二值尺子会把"两边都有的模板化"只算在其中一边头上，**把差别放大成断崖**。
//   在它之上连着判掉三个改动，这件事本身需要先量准，而不是继续调片段文字。
//
// 本模块只做**测量**，四件事各算各的，绝不混为一谈：
//   ① `sameInputDiversity` —— 同一句话、重复 N 次。**这是测量装置的产物**：
//      生产里"他这一句 + 她这一状态 + 这一份 Prompt"不会原样再来一遍，
//      所以同一输入下的复现**不等于**用户会看到的复读。
//   ② `inOrderDiversity` —— 按时间顺序，每一条与她**上一条**比（沿用 `findDuplicateReply` 的口径）。
//      **这才是生产里真会发生的**，也正是 v1.32 那条生成后查重要治的东西。
//   ③ `openerReuse` —— 跨上下文（不同的话、不同的日子、不同的话题）她**开场方式**的复用。
//      这一条最像用户抱怨的"她怎么老是这么开头"，而且**两把尺子都抓不到它**
//      （开场一样、后半句不一样 ⇒ 相似度不高；不是同一输入 ⇒ 同一输入那把尺子看不见）。
//   ④ `frameReuse` —— 更宽的"句式骨架"复用（去掉内容词后的结构），当辅助读数。
//
// ⚠️ 只测量，**不进任何决策路径**。与 `lowPeriod.ts` 同一条约定，由 `__tests__/replyDiversity.test.ts`
// 的**源码扫描守卫**钉住：src/lib 与 server/ 里没有任何模块 import 它（只有脚本与测试用）。
//
// 纯逻辑模块：无 io/React 依赖。

import { textSimilarity } from './memoryEnhancer.js';
import { assistantOpenerHeads, findDuplicateReply } from './antiRepetition.js';

/** 比对前先归一：去掉空白与常见标点，避免"只差一个逗号"被当成新话（与 antiRepetition 同口径） */
export function normalizeForCompare(text: string): string {
  return text.replace(/[\s，。！？、；：""''（）…—,.!?;:'"()\-]/g, '');
}

/** 「开场」的口径**沿用 `assistantOpenerHeads`** —— 那正是 Prompt 里【避免重复】那一块承诺要防的东西，
 *  量它才有意义（自己另立一套口径 = 量了个没人承诺过的指标）。 */
export function openersOf(replies: string[], len = 12): string[] {
  return assistantOpenerHeads(replies, Math.max(1, replies.length), len);
}

/**
 * 「开场**框架**」：第一个小句（不足 4 字就把下一个也带上），封顶 `len` 字。
 *
 * 为什么要多这一把：前 12 字那把**太脆** —— 实测 `突然想起你面试那事，有结` 与
 * `突然想起你面试那事，我有` 只差最后两字就不算同一个开场了，而人看就是"同一个开头"。
 * 两把一起报：`head` 是那一块**承诺**要防的口径，`frame` 是**人眼**看到的口径。
 */
export function framesOf(replies: string[], len = 14): string[] {
  return replies
    .filter(m => typeof m === 'string' && m.trim())
    .map(m => {
      const flat = m.replace(/\s+/g, '');
      const clauses = flat.split(/[，。！？、；：…—,.!?;:]/).filter(Boolean);
      let frame = clauses[0] ?? flat;
      if ([...frame].length < 4 && clauses.length > 1) frame = `${clauses[0]}，${clauses[1]}`;
      return [...frame].slice(0, len).join('');
    })
    .filter(Boolean);
}

export interface PairHit { left: string; right: string; score: number }

export interface DiversityReading {
  /** 参与比较的回复条数 */
  n: number;
  /** 两条回复**归一后完全一样**的对数 */
  exactPairs: number;
  /** 归一后相似度 ≥ `nearThreshold` 的对数（比"逐字"宽一档） */
  nearPairs: number;
  /** 所有参与比较的两两相似度均值（**连续量**：1.00 = 全都一样，低 = 各自不同） */
  meanPairwise: number;
  /** 最像的一对（人工过目用） */
  worst: PairHit | null;
  /** 开场复用最多的一种（口径见 `openersOf`） */
  openerTop: { text: string; count: number };
  /** 不重复的开场个数 / 条数 —— `distinct / n` 越高越不像复读机 */
  openerDistinct: number;
  /** 人话诊断 */
  note: string;
}

function pairStats(texts: string[], nearThreshold: number) {
  const norm = texts.map(normalizeForCompare);
  let exact = 0, near = 0, sum = 0, pairs = 0;
  let worst: PairHit | null = null;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      pairs++;
      if (norm[i] === norm[j]) exact++;
      const s = textSimilarity(norm[i], norm[j]);
      sum += s;
      if (s >= nearThreshold) near++;
      if (!worst || s > worst.score) worst = { left: texts[i], right: texts[j], score: s };
    }
  }
  return { exact, near, mean: pairs > 0 ? sum / pairs : 0, worst, pairs };
}

function openerStats(texts: string[], kind: 'head' | 'frame' = 'head') {
  const counts = new Map<string, number>();
  const list = kind === 'head' ? openersOf(texts) : framesOf(texts);
  for (const o of list) counts.set(o, (counts.get(o) ?? 0) + 1);
  let top = { text: '', count: 0 };
  for (const [text, count] of counts) if (count > top.count) top = { text, count };
  return { top, distinct: counts.size };
}

function noteOf(kind: 'sameInput' | 'inOrder', r: Omit<DiversityReading, 'note'>, nearThreshold: number): string {
  if (r.n < 2) return '样本不足（<2 条），量不出复读';
  const share = r.meanPairwise;
  const level = share >= 0.75 ? '几乎一模一样' : share >= 0.55 ? '高度同形' : share >= 0.4 ? '中等同形' : '各自说得不一样';
  const where = kind === 'sameInput'
    ? '（同输入 —— 注意这是**测量装置的产物**，生产里同一句不会再来一遍）'
    : '（按时间顺序，与她上一条比 —— 这条才对应生产里用户看得到的复读）';
  return `两两相似度均值 ${share.toFixed(2)} ⇒ ${level}${where}；`
    + `逐字相同 ${r.exactPairs} 对、≥${nearThreshold} 的近似 ${r.nearPairs} 对；`
    + `开场框架 ${r.openerDistinct}/${r.n} 种${r.openerTop.count > 1 ? `（最多的一种出现 ${r.openerTop.count} 次：${r.openerTop.text}）` : ''}`;
}

/** ① 同一句话的 N 次重复：**只在组内**两两比（组 = 同一句话 + 同一条件）。
 *
 *  ⚠️ 第一版把**所有**回复摊平了算两两相似度 —— 那是错的：不同话题之间本来就该不像，
 *  把它们混进分母会把"同输入复现"这个量稀释掉（实测把 0.9 量成 0.08）。
 *  第一版还错在让脚本把 treat/ctl 混成一条臂（"30 条/臂"）。两处都修了。 */
export function sameInputDiversity(groups: Array<{ key: string; replies: string[] }>, nearThreshold = 0.7): DiversityReading {
  const all = groups.flatMap(g => g.replies.filter(t => typeof t === 'string' && t.trim()));
  let exact = 0, near = 0, sum = 0, pairs = 0;
  let worst: PairHit | null = null;
  for (const g of groups) {
    const texts = g.replies.filter(t => typeof t === 'string' && t.trim());
    if (texts.length < 2) continue;
    const st = pairStats(texts, nearThreshold);
    exact += st.exact; near += st.near; sum += st.mean * st.pairs; pairs += st.pairs;
    if (st.worst && (!worst || st.worst.score > worst.score)) worst = st.worst;
  }
  const op = openerStats(all, 'frame');
  const base = {
    n: all.length, exactPairs: exact, nearPairs: near,
    meanPairwise: pairs > 0 ? Math.round((sum / pairs) * 1000) / 1000 : 0, worst,
    openerTop: op.top, openerDistinct: op.distinct,
  };
  return { ...base, note: noteOf('sameInput', base, nearThreshold) };
}

/** ② 按时间顺序：每一条与**它上一条**比（口径 = v1.32 生成后查重那一条） */
export function inOrderDiversity(repliesInTimeOrder: string[], nearThreshold = 0.7): DiversityReading {
  const texts = repliesInTimeOrder.filter(t => typeof t === 'string' && t.trim());
  const hits: PairHit[] = [];
  for (let i = 1; i < texts.length; i++) {
    const hit = findDuplicateReply([texts[i - 1]], texts[i], nearThreshold);
    if (hit) hits.push({ left: texts[i - 1], right: texts[i], score: hit.score });
  }
  let sum = 0;
  for (let i = 1; i < texts.length; i++) sum += textSimilarity(normalizeForCompare(texts[i]), normalizeForCompare(texts[i - 1]));
  const op = openerStats(texts, 'frame');
  const base = {
    n: texts.length,
    exactPairs: hits.filter(h => normalizeForCompare(h.left) === normalizeForCompare(h.right)).length,
    nearPairs: hits.length,
    meanPairwise: texts.length > 1 ? Math.round((sum / (texts.length - 1)) * 1000) / 1000 : 0,
    worst: hits.length ? hits.reduce((a, b) => (b.score > a.score ? b : a)) : null,
    openerTop: op.top, openerDistinct: op.distinct,
  };
  return { ...base, note: noteOf('inOrder', base, nearThreshold) };
}

/** ③ 跨上下文的开场复用：不同的话、不同的日子，她开头的方式重不重。
 *  两把口径一起给：`head`（前 12 字，= Prompt 那块承诺要防的口径）、`frame`（第一个小句，人眼口径）。 */
export function openerReuse(replies: string[]): {
  n: number; head: ReuseStat; frame: ReuseStat;
} {
  const texts = replies.filter(t => typeof t === 'string' && t.trim());
  const wrap = (s: { top: { text: string; count: number }; distinct: number }): ReuseStat =>
    ({ ...s, n: texts.length, share: texts.length ? s.top.count / texts.length : 0 });
  return { n: texts.length, head: wrap(openerStats(texts, 'head')), frame: wrap(openerStats(texts, 'frame')) };
}

export interface ReuseStat {
  top: { text: string; count: number };
  distinct: number;
  n: number;
  /** 最多的一种开场占多少（越高越像复读机） */
  share: number;
}
