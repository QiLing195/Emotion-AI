// ── motiveSpecificizer 单元测试（v1.10 第 2 层：念头具体化）──
// 边界：这一步只**生成素材**，不改任何规则/权重；非法或失败一律丢弃（不污染状态）。
// 必须锁死：①prompt 带上情境与"禁止重复已知话题" ②解析宽容但校验严格
//           ③元描述/空话/超长一律拒绝 ④调用节流（间隔 + 池太空冷启动）

import { describe, it, expect } from 'vitest';
import {
  buildSpecificizePrompt,
  parseSpecificMotives,
  isUsableSpecificMotive,
  shouldSpecificize,
  SPECIFICIZABLE_KINDS,
  SPECIFIC_MOTIVE_MAX,
  SPECIFIC_MOTIVE_MAX_CHARS,
  SPECIFIC_MOTIVE_INTERVAL_ROUNDS,
  SPECIFIC_MOTIVE_POOL_FLOOR,
} from '../motiveSpecificizer';

const T0 = 1_700_000_000_000;

describe('buildSpecificizePrompt — 给出情境与边界', () => {
  it('包含最近他说的话、心情、价值、模板方向与"不要重复的话题"', () => {
    const prompt = buildSpecificizePrompt({
      recentUserTexts: ['我下周要去面试', '今天上班好累'],
      moodDescription: '心情有点低落',
      topValue: 'connection',
      templateThoughts: ['想和他多待一会儿'],
      knownTopics: ['面试'],
    });
    expect(prompt).toContain('面试');
    expect(prompt).toContain('心情有点低落');
    expect(prompt).toContain('connection');
    expect(prompt).toContain('想和他多待一会儿');
    expect(prompt).toContain('不要重复');
    expect(prompt).toContain('JSON');
  });

  it('缺少可选情境时也能构造（不报错、不出现 undefined）', () => {
    const prompt = buildSpecificizePrompt({ recentUserTexts: [] });
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('JSON');
  });

  it('限制输出了允许的 kind 白名单', () => {
    const prompt = buildSpecificizePrompt({ recentUserTexts: ['嗯'] });
    for (const kind of SPECIFICIZABLE_KINDS) expect(prompt).toContain(kind);
  });
});

describe('isUsableSpecificMotive — 校验严格', () => {
  it('接受有具体指代的第一人称独白', () => {
    expect(isUsableSpecificMotive('wish', '我想问他面试那件事后来怎么样了')).toBe(true);
    expect(isUsableSpecificMotive('worry', '今天他说话比平时短，我有点担心')).toBe(true);
  });

  it('拒绝模板化空话（没有具体指代）', () => {
    expect(isUsableSpecificMotive('wish', '想被理解')).toBe(false);
    expect(isUsableSpecificMotive('wish', '想和他多待一会儿')).toBe(false);
  });

  it('拒绝白名单外的类型', () => {
    expect(isUsableSpecificMotive('open_loop', '他之前提到「面试」还没说结果')).toBe(false);
    expect(isUsableSpecificMotive('hack', '我想问他面试的事怎么样了')).toBe(false);
  });

  it('拒绝元描述与系统口吻', () => {
    expect(isUsableSpecificMotive('wish', '作为一个AI，我想知道他今天怎么样')).toBe(false);
    expect(isUsableSpecificMotive('wish', '我的prompt要求我问他面试的事')).toBe(false);
  });

  it('拒绝过短与超长内容', () => {
    expect(isUsableSpecificMotive('wish', '问他')).toBe(false);
    expect(isUsableSpecificMotive('wish', '我想问他面试的事'.repeat(20))).toBe(false);
  });

  it('拒绝非字符串', () => {
    expect(isUsableSpecificMotive('wish', 123 as unknown as string)).toBe(false);
    expect(isUsableSpecificMotive(null, '我想问他面试的事')).toBe(false);
  });
});

describe('parseSpecificMotives — 宽容解析 + 严格校验', () => {
  it('解析标准 JSON', () => {
    const out = parseSpecificMotives(
      '{"motives":[{"kind":"wish","content":"我想问他面试那件事怎么样了"}]}', T0,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('wish');
    expect(out[0].formedAt).toBe(T0);
  });

  it('能从夹带解释文字的回复里抠出 JSON', () => {
    const out = parseSpecificMotives(
      '好的，这是结果：{"motives":[{"kind":"worry","content":"他今天回消息很慢，我有点担心"}]} 希望有帮助',
      T0,
    );
    expect(out).toHaveLength(1);
  });

  it('非法条目被逐条丢弃，合法条目保留', () => {
    const out = parseSpecificMotives(JSON.stringify({
      motives: [
        { kind: 'wish', content: '想被理解' },                        // 空话 → 丢
        { kind: 'open_loop', content: '他之前提到「面试」还没说结果' }, // 类型不允许 → 丢
        { kind: 'curiosity', content: '我想知道他最近在忙的那个项目是什么' }, // 保留
      ],
    }), T0);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('curiosity');
  });

  it('数量与长度受上限约束', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      kind: 'wish', content: `我想问他第${i}件事后来到底怎么样了`,
    }));
    const out = parseSpecificMotives(JSON.stringify({ motives: many }), T0);
    expect(out.length).toBeLessThanOrEqual(SPECIFIC_MOTIVE_MAX);
    for (const m of out) expect(m.content.length).toBeLessThanOrEqual(SPECIFIC_MOTIVE_MAX_CHARS);
  });

  it('重复内容只保留一条', () => {
    const dup = { kind: 'wish', content: '我想问他面试那件事怎么样了' };
    const out = parseSpecificMotives(JSON.stringify({ motives: [dup, { ...dup }] }), T0);
    expect(out).toHaveLength(1);
  });

  it('完全无法解析 → 空数组（绝不污染状态）', () => {
    expect(parseSpecificMotives('模型今天不太配合')).toEqual([]);
    expect(parseSpecificMotives('')).toEqual([]);
    expect(parseSpecificMotives(null)).toEqual([]);
    expect(parseSpecificMotives('{"motives":"不是数组"}')).toEqual([]);
  });

  it('接受"没有真实素材"的空结果', () => {
    expect(parseSpecificMotives('{"motives":[]}', T0)).toEqual([]);
  });
});

describe('shouldSpecificize — 节流', () => {
  it('池太空时立即补（冷启动）', () => {
    expect(shouldSpecificize(1, SPECIFIC_MOTIVE_POOL_FLOOR - 1, -1)).toBe(true);
  });

  it('池够多时按间隔触发', () => {
    expect(shouldSpecificize(SPECIFIC_MOTIVE_INTERVAL_ROUNDS - 1, 9, 0)).toBe(false);
    expect(shouldSpecificize(SPECIFIC_MOTIVE_INTERVAL_ROUNDS, 9, 0)).toBe(true);
  });

  it('同一轮不重复触发（防一次对话内多次调用 LLM）', () => {
    expect(shouldSpecificize(7, 0, 7)).toBe(false);
  });
});
