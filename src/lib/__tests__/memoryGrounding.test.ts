// ── memoryGrounding 单元测试（v1.11）──
// 边界：这是"防编造"的确定性校验，必须同时满足
//   ①真的编造 → 抓住（含"同一话题 + 新增细节"这种最隐蔽的形态）
//   ②提问 → 放行（"面试有消息了吗"是在问，不是断言）
//   ③有依据的复述/改写 → 放行（不能因为措辞不同就误杀）

import { describe, it, expect } from 'vitest';
import {
  extractMemoryClaims,
  groundingCoverage,
  buildGroundingCorpus,
  checkMemoryGrounding,
  buildRewriteInstruction,
  stripUngroundedClaims,
  splitSentences,
  MEMORY_CLAIM_MARKERS,
} from '../memoryGrounding';

// 真实语料：来自本项目的实际记忆与对话（面试话题）
const MEMORIES = [
  '他提到下周要去面试，有点紧张',
  '他今天上班很累，被老板说了两句',
];
const CONVERSATION = [
  '我下周要去面试，有点紧张',
  '面试的事我还是有点忐忑',
  '面试的事我还是没底',
  '嗯，还行吧',
];
const corpus = () => buildGroundingCorpus({ memories: MEMORIES, conversation: CONVERSATION });

// ════════════════════════════════════════════════════════════
// 1. 抽取
// ════════════════════════════════════════════════════════════

describe('extractMemoryClaims — 只认断言型引用', () => {
  it('识别常见断言标记', () => {
    const claims = extractMemoryClaims('你上次说面试前紧张得没睡好。');
    expect(claims).toHaveLength(1);
    expect(claims[0].marker).toBe('你上次说');
    expect(claims[0].phrase).toContain('没睡好');
    expect(claims[0].interrogative).toBe(false);
  });

  it('标记列表覆盖"你说过/你提到过/我们上次/我记得你"等', () => {
    for (const marker of ['你说过', '你提到过', '我们上次', '我记得你', '你告诉过我']) {
      expect(MEMORY_CLAIM_MARKERS).toContain(marker as never);
      expect(extractMemoryClaims(`${marker}一起去过海边。`)).toHaveLength(1);
    }
  });

  it('同一句里的多个句子各自成条', () => {
    const claims = extractMemoryClaims('你上次说面试很顺利。你之前说想去海边。');
    expect(claims).toHaveLength(2);
  });

  it('没有问题标记的句子不产生条目', () => {
    expect(extractMemoryClaims('今天天气不错，我煮了面。')).toHaveLength(0);
    expect(extractMemoryClaims('')).toHaveLength(0);
    expect(extractMemoryClaims(undefined as unknown as string)).toHaveLength(0);
  });

  it('提问型引用被标记为 interrogative（按小句判定）', () => {
    // "你说过要陪我去看海吗" —— 疑问词就在断言小句里
    expect(extractMemoryClaims('你说过要陪我去看海吗')[0].interrogative).toBe(true);
  });

  it('话题式引用 + 后置提问：断言小句本身不是提问（靠接地覆盖率放行）', () => {
    const claims = extractMemoryClaims('你上次说的那个面试，后来怎么样了？');
    expect(claims).toHaveLength(1);
    expect(claims[0].interrogative).toBe(false);
    expect(claims[0].clause).toBe('你上次说的那个面试，');
    // 引用内容只有"面试"这一话题词 → 有依据 → 放行
    expect(checkMemoryGrounding('你上次说的那个面试，后来怎么样了？', corpus()).ok).toBe(true);
  });

  it('⚠️ 整句以问号结尾，但断言小句本身不是提问 → 仍需校验', () => {
    const claims = extractMemoryClaims('你上次说面试前紧张得没睡好，是面试里遇到什么问题了吗？');
    expect(claims).toHaveLength(1);
    expect(claims[0].interrogative).toBe(false);   // 断言小句
    expect(claims[0].phrase).toContain('没睡好');
  });

  it('同句内的提问小句与断言小句分别处理', () => {
    const claims = extractMemoryClaims('你上次说要去海边玩，后来去了吗？');
    expect(claims[0].interrogative).toBe(false);
  });
});

describe('groundingCoverage — 最长匹配覆盖率', () => {
  it('有依据的复述：覆盖率 1.0', () => {
    const r = groundingCoverage('下周要去面试 有点紧张', '他提到下周要去面试，有点紧张');
    expect(r.coverage).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it('只有部分依据：面试/紧张能对上，"没睡好"对不上', () => {
    const r = groundingCoverage('面试前紧张得没睡好', '他提到下周要去面试，有点紧张');
    expect(r.coverage).toBeLessThan(0.6);
    expect(r.missing.join('')).toContain('没睡好');
    expect(r.matched).toContain('面试');
  });

  it('单字不算依据（避免"要/面"这类高频字灌水）', () => {
    const r = groundingCoverage('面试要三轮', '他提到下周要去面试');
    expect(r.matched).toEqual(['面试']);
    expect(r.coverage).toBeLessThan(0.6);
  });

  it('空内容视为通过（覆盖率 1）', () => {
    expect(groundingCoverage('', 'anything').coverage).toBe(1);
    expect(groundingCoverage('，。！', 'x').coverage).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 校验：抓住编造
// ════════════════════════════════════════════════════════════

describe('checkMemoryGrounding — 编造必须被抓', () => {
  it('实测编造案例：「你上次说面试前紧张得没睡好」', () => {
    const result = checkMemoryGrounding('你上次说面试前紧张得没睡好，现在结束了反而更没底。', corpus());
    expect(result.ok).toBe(false);
    expect(result.violations[0].missingChunks.join('')).toContain('睡');
    expect(result.violations[0].reason).toContain('记忆里没有的细节');
  });

  it('整段编造（话题都不存在）', () => {
    const result = checkMemoryGrounding('你之前说要去挪威看极光，我一直记着。', corpus());
    expect(result.ok).toBe(false);
    expect(result.violations[0].coverage).toBeLessThan(0.6);
    expect(result.violations[0].reason).toMatch(/不存在|没有的细节/);
  });

  it('跨轮编造细节：确实有面试这件事，但"三面"是编的', () => {
    const result = checkMemoryGrounding('你上次说面试要面三轮，我替你捏把汗。', corpus());
    expect(result.ok).toBe(false);
    expect(result.violations[0].matchedChunks.length).toBeGreaterThan(0);
  });
});

describe('checkMemoryGrounding — 放行有依据的说法与提问', () => {
  it('有依据的复述 → 通过', () => {
    const result = checkMemoryGrounding('你上次说下周要去面试，有点紧张。', corpus());
    expect(result.ok).toBe(true);
  });

  it('提问 → 一律放行（引用的是话题词、不是编造细节）', () => {
    const result = checkMemoryGrounding('你上次说的那个面试，后来有消息了吗？', corpus());
    expect(result.ok).toBe(true);
    expect(result.claims[0].phrase).toContain('面试');
  });

  it('疑问小句里的引用直接放行（不追究细节）', () => {
    const result = checkMemoryGrounding('你说过要陪我去看海吗？', corpus());
    expect(result.ok).toBe(true);
    expect(result.claims[0].interrogative).toBe(true);
  });

  it('没有记忆引用的普通回复 → 通过', () => {
    expect(checkMemoryGrounding('我在呢，慢慢说。', corpus()).ok).toBe(true);
    expect(checkMemoryGrounding('', corpus()).ok).toBe(true);
  });

  it('语料为空时：断言型引用会被判违规（无从落地）', () => {
    const result = checkMemoryGrounding('你上次说要去面试。', '');
    expect(result.ok).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 重写指令与兜底删除
// ════════════════════════════════════════════════════════════

describe('buildRewriteInstruction', () => {
  it('列出违规原因与"只允许引用的事实清单"', () => {
    const { violations } = checkMemoryGrounding('你上次说面试前紧张得没睡好。', corpus());
    const instruction = buildRewriteInstruction(violations, MEMORIES);
    expect(instruction).toContain('必须重写');
    expect(instruction).toContain('没睡好');
    expect(instruction).toContain('下周要去面试');
    expect(instruction).toContain('不要编造');
  });

  it('没有可引用事实时明确要求改为提问（而不是继续编）', () => {
    const { violations } = checkMemoryGrounding('你上次说我们去过海边。', '');
    const instruction = buildRewriteInstruction(violations, []);
    expect(instruction).toContain('没有可引用的具体记忆');
    expect(instruction).toContain('改成问他');
  });
});

describe('stripUngroundedClaims — 兜底', () => {
  it('删掉未接地的断言小句，保留同句其余内容', () => {
    const reply = '你上次说面试前紧张得没睡好，现在结束了反而更没底。那你先歇一会儿吧。';
    const { violations } = checkMemoryGrounding(reply, corpus());
    const stripped = stripUngroundedClaims(reply, violations);
    expect(stripped).not.toContain('没睡好');
    expect(stripped).toContain('更没底');
    expect(stripped).toContain('歇一会儿');
    expect(stripped).not.toMatch(/^[，,]/);
  });

  it('单句且删后无实体内容时不删（避免把回复删空，交给重写）', () => {
    const reply = '你上次说面试前紧张得没睡好。';
    const { violations } = checkMemoryGrounding(reply, corpus());
    expect(stripUngroundedClaims(reply, violations)).toBe(reply);
  });

  it('没有违规时原样返回', () => {
    expect(stripUngroundedClaims('我在呢。', [])).toBe('我在呢。');
  });
});

describe('splitSentences / buildGroundingCorpus', () => {
  it('按中文标点切句并保留标点', () => {
    const s = splitSentences('第一句。第二句！第三句？');
    expect(s).toHaveLength(3);
    expect(s[0]).toBe('第一句。');
  });

  it('语料由记忆 + 对话 + 附加文本拼成，忽略空值', () => {
    const c = buildGroundingCorpus({ memories: ['A'], conversation: ['B'], extra: ['', 'C'] });
    expect(c.split('\n')).toEqual(['A', 'B', 'C']);
  });
});
