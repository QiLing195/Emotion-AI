import { describe, it, expect } from 'vitest';
import {
  buildAntiRepetitionBlock, assistantOpenerHeads,
  findDuplicateReply, buildDedupRewriteInstruction,
} from '../antiRepetition.js';

// v1.32：实测（`scripts/ab-defer-anchor.ts --history=repeat`，n=8）**她会逐字重复上一轮 3/8 条**
// （与上一轮相似度 1.00；其余样本约 0.25）。
// 试过的**错误方向**：把上一轮那句原文摆进 Prompt 里让她别再说 —— 查重是治住了（0/8），
// 但把"短/在场/不追问"一起赔掉（在场 1.13→0.00/0.38、追问 0.13→1.63/1.13、字数 46→96/71）。
// 所以这一组测试钉的是**改后的做法**：Prompt 侧保持 v1.6 原样，查重放到生成之后。

const LAST = '我在。面试挂了这件事，先别急着往自己身上扣"没用"这两个字。';

describe('assistantOpenerHeads', () => {
  it('取最近 3 条、去空白、超长才截到 12 字', () => {
    const heads = assistantOpenerHeads(['一', '二', '三', '这是一句特别特别长的话'], 3, 12);
    expect(heads).toEqual(['二', '三', '这是一句特别特别长的话']); // 8 字，未超 12 不截
    expect(assistantOpenerHeads(['这是一句特别特别长的话'], 1, 5)).toEqual(['这是一句特']);
  });

  it('过滤空内容', () => {
    expect(assistantOpenerHeads(['', '   ', '在'])).toEqual(['在']);
  });
});

describe('buildAntiRepetitionBlock', () => {
  it('她没说过话 → 空串（调用方判空跳过，不留空块）', () => {
    expect(buildAntiRepetitionBlock([])).toBe('');
    expect(buildAntiRepetitionBlock(['', '  '])).toBe('');
  });

  it('保持 v1.6 原行为：只列开场、只要求换开场，**不摆上一轮原文**', () => {
    const block = buildAntiRepetitionBlock(['早呀，昨晚睡得好吗？', LAST]);
    expect(block).toContain('【避免重复】');
    expect(block).toContain('你最近几轮用过这些开场');
    expect(block).toContain('「我在。面试挂了这件事，先…」');
    expect(block).toContain('本轮必须换一种开场方式');
    // 反面断言：摆原文会把回复推向"谈那句话"的长模板（实测 在场 1.13→0.00、追问 0.13→1.63）
    expect(block).not.toContain('不要再给第二遍');
    expect(block).not.toContain(LAST.slice(0, 40));
  });
});

describe('findDuplicateReply — 生成后查重', () => {
  it('逐字重复 → 命中，相似度 1.00', () => {
    const hit = findDuplicateReply([LAST], LAST);
    expect(hit).not.toBeNull();
    expect(hit!.matched).toBe(LAST);
    expect(hit!.score).toBeCloseTo(1, 5);
  });

  it('标点/空白差异不算"新话"（归一后再比）', () => {
    const hit = findDuplicateReply([LAST], '我在 面试挂了这件事 先别急着往自己身上扣"没用"这两个字');
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeGreaterThan(0.7);
  });

  it('换开头、后半句照抄 → 仍抓到（阈值 0.7 落在两簇中间）', () => {
    const hit = findDuplicateReply([LAST], '我听着呢。面试挂了这件事，先别急着往自己身上扣"没用"这两个字。');
    expect(hit).not.toBeNull();
  });

  it('说得不一样 → 不命中（实测非重复样本约 0.25）', () => {
    expect(findDuplicateReply([LAST], '嗯，那就先不说。我在这儿，你想开口的时候再说。')).toBeNull();
  });

  it('没有历史 / 空回复 → 不命中', () => {
    expect(findDuplicateReply([], LAST)).toBeNull();
    expect(findDuplicateReply([LAST], '   ')).toBeNull();
  });

  it('多条历史里挑最像的那条', () => {
    const other = '早呀，昨晚睡得好吗？';
    const hit = findDuplicateReply([other, LAST], LAST);
    expect(hit!.matched).toBe(LAST);
  });
});

describe('buildDedupRewriteInstruction', () => {
  it('带上上一轮原文 + 只要求换一句，**不给换法清单**', () => {
    const text = buildDedupRewriteInstruction(LAST);
    expect(text).toContain('【重写一次】');
    expect(text).toContain(LAST.slice(0, 30));
    expect(text).toContain('换一句别的话');
    expect(text).not.toContain('换个说法');
    expect(text).not.toContain('给一个动作');
  });

  it('过长的上一轮被截断', () => {
    const text = buildDedupRewriteInstruction('啊'.repeat(100), 10);
    expect(text).toContain('「' + '啊'.repeat(10) + '…」');
  });
});
