// ── v1.45 「复读机」那把尺子 ──
//
// 为什么要有这个模块：v1.36 / v1.38 / v1.42 **三次**判"未达标"都用的是同一条**二值**护栏
// （同臂内"逐字重复"的组数）。而 v1.42 读原文时发现 A 臂同一输入的三条回复也高度同形
// （只差几个词），只是没越过"逐字相同"那条线。离线重打分（`scripts/measure-reply-diversity.ts`）
// 证实：那条尺子把"**两边都有的**同输入复现"整个隐藏了，于是 0 组 → 3 组看起来像断崖，
// 连续量上只是 0.47 → 0.54；而在**生产相关**的两把尺子（对她上一条 / 跨上下文开场）上两臂基本没差。
//
// 下面钉三件事：
//   ① 三把尺子的定义各自正确（尤其是"同输入"**只在组内**比 —— 第一版把它摊平了算，
//      实测把 0.9 量成 0.08，这种错会让结论完全反过来）；
//   ② "开场"的口径与 Prompt 里【避免重复】那一块**同源**（量它承诺要防的东西）；
//   ③ **它不进决策路径** —— 源码扫描守卫，同 `lowPeriod.ts` 那条约定。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeForCompare, openersOf, sameInputDiversity, inOrderDiversity, openerReuse,
} from '../replyDiversity';
import { assistantOpenerHeads } from '../antiRepetition';

describe('v1.45 复读尺子', () => {
  it('比对前归一：只差标点/空白不算新话（与 antiRepetition 同口径）', () => {
    expect(normalizeForCompare('我在，别急。')).toBe(normalizeForCompare('我在 别急'));
    expect(normalizeForCompare('我在。')).not.toBe(normalizeForCompare('我不在。'));
  });

  it('「开场」口径写死（去空白后前 12 字，与 Prompt 里【避免重复】那一块同源）', () => {
    const replies = ['嗯，下周三。拿报告这事最磨人。', ' 哦对，你说过要去试的那家。'];
    expect(openersOf(replies)).toEqual(['嗯，下周三。拿报告这事最', '哦对，你说过要去试的那家']);
    // 与 `assistantOpenerHeads` **逐字同口径**（不另立一套 —— 量的是那一块承诺要防的东西）
    expect(openersOf(replies)).toEqual(assistantOpenerHeads(replies, 2, 12));
  });

  it('① 同输入**只在组内**比：跨组的不同话不许把均值稀释掉（第一版就是错在这）', () => {
    // 两组各自内部完全一样，但两组之间毫不相干
    const r = sameInputDiversity([
      { key: 'g1', replies: ['甲甲甲甲甲', '甲甲甲甲甲'] },
      { key: 'g2', replies: ['乙乙乙乙乙', '乙乙乙乙乙'] },
    ]);
    expect(r.exactPairs).toBe(2);          // 每组 1 对
    expect(r.meanPairwise).toBe(1);        // 组内 1.00（若把跨组也算进来会掉到 ~0.33）
    expect(r.nearPairs).toBe(2);

    // 单条成组的（没有同伴）不参与配对，也不该把均值拉低
    const r2 = sameInputDiversity([
      { key: 'g1', replies: ['甲甲甲甲甲', '甲甲甲甲甲'] },
      { key: 'g2', replies: ['乙乙乙'] },
    ]);
    expect(r2.meanPairwise).toBe(1);
    expect(r2.exactPairs).toBe(1);
  });

  it('① 同输入：中等同形要能量出连续值（不是只有"一样/不一样"两档）', () => {
    const r = sameInputDiversity([
      { key: 'g', replies: ['我在，别急，慢慢来。', '我在，别急，我们慢慢来。'] },
    ]);
    expect(r.meanPairwise).toBeGreaterThan(0.4);
    expect(r.meanPairwise).toBeLessThan(1);
    expect(r.exactPairs).toBe(0);
    expect(r.note).toContain('同输入');
    expect(r.note).toContain('测量装置的产物');
  });

  it('② 按时间：与她**上一条**比（= v1.32 生成后查重的口径）', () => {
    const r = inOrderDiversity(['我在，别急。', '我在，别急。', '今天天气不错。']);
    expect(r.nearPairs).toBe(1);                 // 只有第 1→2 条那对
    expect(r.exactPairs).toBe(1);
    expect(r.note).toContain('按时间顺序');
    // 逐条都不同时，一把都不该命中
    expect(inOrderDiversity(['甲甲甲甲', '乙乙乙乙', '丙丙丙丙']).nearPairs).toBe(0);
  });

  it('③ 跨上下文开场复用：不同的话也可能同一个开场框架（二值尺子抓不到它）', () => {
    const r = openerReuse([
      '突然想起你面试那事，有结果了吗？',
      '突然想起你面试那事，我有点困。',
      '今天楼下开了新店。',
    ]);
    // 前 12 字那把**太脆**：只差最后两字就不算同一个（所以框架那把才有必要）
    expect(r.head.top.count).toBe(1);
    expect(r.frame.top.text).toBe('突然想起你面试那事');
    expect(r.frame.top.count).toBe(2);
    expect(r.n).toBe(3);
    expect(r.frame.share).toBeCloseTo(2 / 3, 5);
    // 第一个小句不足 4 字时，把下一个小句也带上（否则「哦对」会把所有短开头混成一类）
    expect(openerReuse(['哦对，你说过要去试的那家。', '哦对，就是你说要去试的那家！']).frame.top.text.startsWith('哦对，')).toBe(true);
  });

  it('样本不足时说清楚，而不是报 0（0 和"量不出"不是一回事）', () => {
    expect(sameInputDiversity([{ key: 'g', replies: ['只有一条'] }]).note).toContain('样本不足');
    expect(inOrderDiversity(['只有一条']).note).toContain('样本不足');
  });

  it('空输入不炸', () => {
    expect(openerReuse([])).toMatchObject({ n: 0 });
    expect(openerReuse([]).frame).toMatchObject({ distinct: 0, share: 0 });
    expect(() => sameInputDiversity([])).not.toThrow();
    expect(() => inOrderDiversity([])).not.toThrow();
  });

  /**
   * ⚠️ 约定守卫（同 `lowPeriod.ts` / v1.25 那条的写法）：
   * 这是**测量**模块，不是决策模块。一旦有人拿它去改行为，"她会不会复读"就会悄悄变成
   * "按相似度阈值重写她的回复"之类的东西 —— 而这类改动在本项目里已经栽过（v1.32：
   * Prompt 侧治重复把在场/追问/字数一起赔掉，最后只能靠生成后重写）。
   * 允许引用它的只有：测试、`scripts/`（离线重打分与 A/B 报告）。
   */
  it('约定：src/lib 与 server/ 里没有任何模块引用它（只测量，不进决策路径）', () => {
    const libDir = join(__dirname, '..');
    const offenders: string[] = [];
    for (const name of readdirSync(libDir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      if (name === 'replyDiversity.ts') continue;
      if (readFileSync(join(libDir, name), 'utf8').includes('replyDiversity')) offenders.push(`src/lib/${name}`);
    }
    const serverDir = join(__dirname, '..', '..', '..', 'server');
    for (const rel of readdirSync(serverDir, { recursive: true }) as string[]) {
      if (!rel.endsWith('.ts')) continue;
      if (readFileSync(join(serverDir, rel), 'utf8').includes('replyDiversity')) offenders.push(`server/${rel}`);
    }
    expect(offenders, `这些模块引用了复读尺子（它只该被脚本/测试引用）：${offenders.join(', ')}`).toEqual([]);
  });
});
