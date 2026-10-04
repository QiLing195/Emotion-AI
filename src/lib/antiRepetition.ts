// src/lib/antiRepetition.ts
//
// 【避免重复】那一块的组装（v1.6 起就存在，v1.32 抽出成纯函数 —— 为了能单测、也为了让"口径"只有一处），
// 外加 v1.32 的**生成后查重**（见文件末尾 `findDuplicateReply`）。

import { textSimilarity } from './memoryEnhancer.js';

/** 她最近几轮的开场（去空白后截断）——`v1.6` 原行为，保留 */
export function assistantOpenerHeads(messages: string[], take = 3, len = 12): string[] {
  return messages
    .filter(m => typeof m === 'string')
    .slice(-take)
    .map(m => m.replace(/\s+/g, '').slice(0, len))
    .filter(Boolean);
}

/**
 * 组装【避免重复】片段。没有任何她说过的话时返回 `''`（调用方判空跳过，别在 Prompt 里留空块）。
 *
 * ⚠️ **试过、被实测否掉、不要加回来**：v1.32 曾在这里加"把你上一轮那句原文摆出来 + 整句不要再给第二遍"
 * （想治"她逐字重复上一轮"）。真管道 A/B（`scripts/ab-defer-anchor.ts --history=repeat`，n=8）：
 *
 * | 指标 | 现状 | 摆了原文（带换法清单） | 摆了原文（不带清单） |
 * |---|---|---|---|
 * | 逐字重复上一轮 | 3/8 | **0/8** | **0/8** |
 * | 在场词 | **1.13** | 0.00 | 0.38 |
 * | 追问 | **0.13** | 1.63 | 1.13 |
 * | 字数 | **46.3** | 95.9 | 71.3 |
 *
 * ⇒ 查重确实治住了，但把 v1.29~v1.31 刚做出来的"短、在场、不追问"一起赔进去了，
 * 而且**代价来自"把上一轮那句摆给她看"本身**（去掉"换法清单"只回收了一半），
 * 因为看到那句话她就忍不住**去谈那句话**（"我不说'别难过'这种话…"这类元话语）。
 * 结论：这件事不该在 Prompt 里治 —— 改走**生成后查重 + 定向重写一次**（`findDuplicateReply`）。
 */
export function buildAntiRepetitionBlock(recentAssistantMessages: string[]): string {
  const heads = assistantOpenerHeads(recentAssistantMessages.filter(m => typeof m === 'string' && m.trim()));
  if (heads.length === 0) return '';
  return `【避免重复】你最近几轮用过这些开场：${heads.map(h => `「${h}…」`).join('、')}。本轮必须换一种开场方式，也不要用相同句式收尾。`;
}

/** 比对前先归一：去掉空白与常见标点，避免"只差一个逗号"被当成新话 */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s，。！？、；：""''（）…—,.!?;:'"()\-]/g, '');
}

/**
 * v1.32 生成后查重：这一条回复是不是**又把她上一轮说过的话说了一遍**。
 *
 * 返回命中的那句原文与相似度（阈值默认 0.7），没命中返回 `null`。
 * 阈值标定（n=8，`--history=repeat`）：逐字重复的样本相似度 **1.00**，其余样本约 **0.25**（平均 0.53 是被那 3 条拉起来的）
 * ⇒ 0.7 落在两簇中间，"换开头、后半句照抄"这档也能抓到。
 */
export function findDuplicateReply(
  previousReplies: string[],
  reply: string,
  threshold = 0.7,
): { matched: string; score: number } | null {
  const mine = normalizeForCompare(reply);
  if (!mine) return null;
  let best: { matched: string; score: number } | null = null;
  for (const prev of previousReplies) {
    if (typeof prev !== 'string' || !prev.trim()) continue;
    const score = textSimilarity(mine, normalizeForCompare(prev));
    if (score >= threshold && (!best || score > best.score)) best = { matched: prev, score };
  }
  return best;
}

/**
 * 命中重复时，**只在这一轮**追加给模型的定向重写要求（不污染正常路径的 Prompt）。
 *
 * 同样**不带"可以怎么换"的清单** —— 清单在 A/B 里被证明会把回复推向"解释+递进+问句"的长模板。
 * 这里只说"换一句别的话，短一点"，把空间留给她自己。
 */
export function buildDedupRewriteInstruction(previousReply: string, maxQuote = 48): string {
  const flat = previousReply.replace(/\s+/g, '');
  const quote = flat.slice(0, maxQuote);
  return `【重写一次】你刚才写的那句和上一轮几乎一样：「${quote}${flat.length > quote.length ? '…' : ''}」`
    + '。换一句别的话，别再重复它——短一点也可以。';
}

