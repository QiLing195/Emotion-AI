// ── v1.47 评价结论的**投递**（把"这件事对我来说意味着什么"送进她的 Prompt）──
//
// 为什么要有这一步（真管道探针 `scripts/probe-her-state-in-prompt.ts` 实测）：
// 同一轮里评价层**算对了**（`[touches_her_concern] …而且不好 → 我替他悬着`），
// 但 `getLastAppraisal()` 的消费者**只有 /state** ⇒ 算出来的"理解"一个字都没到她嘴边。
//
// 下面钉四件事：
//   ① 开关默认关，关着时**什么都不产生**（Prompt 与旧版逐字相同 —— 由空串保证）；
//   ② 五种立场各自由哪条通路产生（不靠解析中文 reason 猜语义）；
//   ③ 片段结构纪律：不含可被整句照抄的自述、不含"要宣布的心情"那种句式、**不含量具词**；
//   ④ 一次只给**一个**立场（给五条会变成一摞互相打架的指令）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  appraiseEvent, appraisalToPromptSnippet, appraisalStanceEnabled,
  type AppraisalResult, type AppraisalStance,
} from '../appraisal';
import type { Motive } from '../emotionTypes';

const KEY = 'ENABLE_APPRAISAL_STANCE';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

function concern(content: string, salience = 0.8): Motive {
  return {
    id: 'c1', kind: 'open_loop', content, source: {},
    salience, formedAt: 0, expiresAt: 9e12, attempts: 0,
  } as Motive;
}

/** 五种立场各来一个输入 */
const CASES: Array<{ stance: AppraisalStance; input: Parameters<typeof appraiseEvent>[0] }> = [
  {
    stance: 'dreading',
    input: { userText: '体检报告出来了，医生说情况不太好。', userEmotion: 'sad', userIntensity: 0.8, concerns: [concern('他体检结果到底怎么样')] },
  },
  {
    stance: 'relieved',
    input: { userText: '体检报告出来了，一切正常。', userEmotion: 'joy', userIntensity: 0.8, concerns: [concern('他体检结果到底怎么样')] },
  },
  {
    stance: 'awaiting',
    input: { userText: '明天要去拿体检报告。', userEmotion: 'neutral', userIntensity: 0.2, concerns: [concern('他体检结果到底怎么样')] },
  },
  {
    stance: 'aching',
    input: { userText: '今天真的很难受。', userEmotion: 'sad', userIntensity: 0.8, concerns: [] },
  },
  {
    stance: 'glad',
    input: { userText: '我今天特别开心。', userEmotion: 'joy', userIntensity: 0.8, concerns: [] },
  },
];

describe('v1.47 评价结论的投递', () => {
  it('开关默认关；只认字面 true（与其余开关同一套约定）', () => {
    expect(appraisalStanceEnabled()).toBe(false);
    for (const v of ['1', 'TRUE', 'yes']) {
      process.env[KEY] = v;
      expect(appraisalStanceEnabled(), v).toBe(false);
    }
    process.env[KEY] = 'true';
    expect(appraisalStanceEnabled()).toBe(true);
  });

  it('没有评价 ⇒ 空串（不许在 Prompt 里留一个空块）', () => {
    expect(appraisalToPromptSnippet(null)).toBe('');
    expect(appraisalToPromptSnippet({ readings: [], emotions: {}, valence: 0, arousal: 0, note: '' })).toBe('');
    // 允许为空：他说的与她挂着的无关、情绪也不强时，不硬编反应
    const none = appraiseEvent({ userText: '楼下新开了一家面馆。', userEmotion: 'neutral', userIntensity: 0.1, concerns: [concern('他体检结果到底怎么样')] });
    expect(none.readings).toHaveLength(0);
    expect(appraisalToPromptSnippet(none)).toBe('');
  });

  it('五种立场各自由哪条通路产生（不靠解析中文 reason 猜语义）', () => {
    for (const c of CASES) {
      const r = appraiseEvent(c.input);
      expect(r.readings.length, c.stance).toBeGreaterThan(0);
      // ⚠️ 断言的是"**这一条被产出了**"，不是"它排第一"：读数顺序是**产出顺序**（for_him 先），
      //    而渲染时按**情绪量**取最强的一条 —— 两者是两件事，混起来测会得出假失败。
      const found = r.readings.map(x => x.stance);
      expect(found, `${c.stance}: ${r.readings.map(x => x.reason).join(' / ')}`).toContain(c.stance);
    }
  });

  it('渲染取**最强**的那条：他不好受 + 又正好碰到她挂着的事 ⇒ 用的是"替他悬着"那句', () => {
    const s = appraisalToPromptSnippet(appraiseEvent(CASES[0].input));
    expect(s).toContain('替他悬着');
  });

  it('有评价 ⇒ 一块，且带上"她心里搁着的那件事"的原文', () => {
    const r = appraiseEvent(CASES[0].input);
    const s = appraisalToPromptSnippet(r);
    expect(s).toContain('【这件事对我来说意味着什么】');
    expect(s).toContain('他体检结果到底怎么样');
    expect(s.length).toBeLessThan(140);              // 是一句底色，不是一段作文
  });

  it('一次只给**一个**立场（两条同时成立时取最强的那条）', () => {
    // 他的情绪强 + 又正好碰到她挂着的事 ⇒ for_him 与 touches_her_concern 都会产出
    const r = appraiseEvent(CASES[0].input);
    expect(r.readings.length).toBeGreaterThan(1);
    const s = appraisalToPromptSnippet(r);
    const stanceOf = (st: AppraisalStance) => CASES.find(c => c.stance === st)!;
    expect(appraisalToPromptSnippet(appraiseEvent(stanceOf('aching').input))).not.toContain('搁着');
  });

  /**
   * ⚠️ 结构纪律（本项目栽过的两次都要防）：
   *   · v1.38：片段里的**例句被逐字照抄**（16 条里 5 条）⇒ 这里给"底色"不给"可抄的句子"；
   *   · 本轮新增：片段里**不许出现量具用的那批词**（严不严重/要紧/有没有事…）——
   *     否则 `scripts/ab-appraisal-stance.ts` 的 `dread` 就是在量我自己的文字。
   */
  it('结构纪律：不含可照抄的自述、不含"宣布心情"的句式、不含量具词', () => {
    for (const c of CASES) {
      const s = appraisalToPromptSnippet(appraiseEvent(c.input));
      // ① 不许出现"我要宣布我的心情"这类句式（她要的是底色，不是汇报）
      for (const bad of ['我很担心', '我担心你', '我害怕', '我替你担心', '我心里难受']) {
        expect(s, `${c.stance} 里出现了要宣布的心情：${bad}`).not.toContain(bad);
      }
      // ② 不含量具词表（否则量的是我自己的字）
      for (const bad of ['严重', '要紧', '有没有事', '是不是不', '别吓', '糟糕']) {
        expect(s, `${c.stance} 里出现了量具词：${bad}`).not.toContain(bad);
      }
      // ③ 引号只用于"她心里搁着的那件事"的原文，不用来给例句
      const quotes = (s.match(/「/g) ?? []).length;
      expect(quotes, `${c.stance} 的引号数不对：${s}`).toBe(s.includes('）') ? 1 : 0);
    }
  });
});
