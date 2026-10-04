// ── v1.53 「他接住了她这句话吗」按类型分派：单测 ──
//
// 病灶：`classifyMotiveOutcome` 只认"共享实词锚点"（他接着说**这件事**）。
// 而 `wish`（她的愿望）/`stance`（她的态度）/`state`（她自己的状态）**没有"这件事"可接** ——
// 他再怎么回应也不会复述她的愿望 ⇒ 真实账本里这三类 `landed` 恒为 0（`wish` 29/0、`stance` 3/0）
// ⇒ 权重被罚到 0.5（下界）。v1.53 加**第二通道**：他明确在回应她这句话（问 / 对着她说 / 表态），
// 两条通道是 OR，对所有类型一致。校准：冻结标注集 25 条，一致率 52% → **88%**（非话题型 43% → 93%）。
//
// 必须锁死：①开关默认关 ②关着时逐字走老逻辑 ③第二通道的三个信号
//           ④「我**跟你**说个事」不算回应 ⑤敷衍/只收下判 missed ⑥通道①的"实字够不够"（我今天 ≠ 接住）

import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyMotiveOutcome, classifyOutcomeFor, looksResponsiveToHer, looksDismissive,
  motivePerKindOutcomeEnabled,
} from '../motive';
import type { MotiveKind } from '../emotionTypes';

// v1.53 已上线：默认**开**，`DISABLE_MOTIVE_PER_KIND_OUTCOME=true` 才回退老判据
const KEY = 'DISABLE_MOTIVE_PER_KIND_OUTCOME';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

/** 回退到老判据（她那几类又恒为 0）*/
const off = () => { process.env[KEY] = 'true'; };
/** 默认（新判据）*/
const on = () => { delete process.env[KEY]; };

const WISH = '想和他多待一会儿';
const STATE = '我今天心里有点闷，说不太清楚';
const k = (s: string) => s as MotiveKind;

describe('v1.53 他接住她这句话吗：按类型分派（第二通道）', () => {
  it('**已上线：默认开**；只有 DISABLE_MOTIVE_PER_KIND_OUTCOME=true 才回退（其余值都当开）', () => {
    on();                                 // 默认 = 新判据
    expect(motivePerKindOutcomeEnabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', 'false']) {
      process.env[KEY] = v;
      expect(motivePerKindOutcomeEnabled(), v).toBe(true);
    }
    off();
    expect(motivePerKindOutcomeEnabled()).toBe(false);
  });

  it('回退（DISABLE=true）= 逐字老逻辑（她那句愿望永远"没被接住"—— 这就是要修的病）', () => {
    off();
    // 他用行动接住了，但词面一字不重 ⇒ 老判据 missed
    expect(classifyMotiveOutcome(WISH, '我明天早点下班，晚上陪你')).toBe('missed');
    expect(classifyOutcomeFor(k('wish'), WISH, '我明天早点下班，晚上陪你')).toBe('missed');
    expect(classifyOutcomeFor(k('wish'), WISH, '你呢，今天过得怎么样？')).toBe('missed');
  });

  it('开着：她用行动/追问/表态接住的话 ⇒ landed', () => {
    delete process.env[KEY];
    for (const his of ['我明天早点下班，晚上陪你', '你呢，今天过得怎么样？', '怎么了？跟我说说', '你说得对，我也觉得']) {
      expect(classifyOutcomeFor(k('wish'), WISH, his), his).toBe('landed');
    }
    // 他自己的状态也算"被接住"的一种？—— 不硬判，落 unclear（标注集里也是 unclear）
    expect(classifyOutcomeFor(k('state'), STATE, '我今天也挺累的')).toBe('unclear');
  });

  it('开着：敷衍与"只收下不接" ⇒ missed', () => {
    delete process.env[KEY];
    for (const his of ['嗯', '哦', '好', '嗯，我知道了', '好的，我记下了']) {
      expect(classifyOutcomeFor(k('stance'), '我觉得人得先对自己诚实', his), his).toBe('missed');
    }
    expect(looksDismissive('嗯，我知道了')).toBe(true);
    expect(looksDismissive('我今天也挺累的')).toBe(false);
  });

  it('「我**跟你**说个事」不是在回应她那句（另起话题）', () => {
    delete process.env[KEY];
    expect(looksResponsiveToHer('我跟你说个事，公司那边又改了方案')).toBe(false);
    expect(classifyOutcomeFor(k('wish'), WISH, '我跟你说个事，公司那边又改了方案')).toBe('missed');
    // 对照：真正对着她说的"你"仍算
    expect(looksResponsiveToHer('你这么说，我倒想起一件事')).toBe(true);
  });

  it('通道①的"实字够不够"：光共享「我今天」不算接住她这件事', () => {
    delete process.env[KEY];
    // 老判据会把「我今天」当成锚点 ⇒ landed（假阳性）；新判据要求去掉虚词后仍剩 ≥2 个实字
    expect(classifyMotiveOutcome(STATE, '我今天也挺累的')).toBe('landed');
    expect(classifyOutcomeFor(k('state'), STATE, '我今天也挺累的')).toBe('unclear');
    // 真的共享实词仍然判 landed（不能把通道①打哑）
    expect(classifyOutcomeFor(k('open_loop'), '他面试那事有消息了吗', '面试结果出来了，过了')).toBe('landed');
    expect(classifyOutcomeFor(k('memory_echo'), '他上次说想去看海，我记着呢', '等这个项目结束，我想去趟海边')).toBe('landed');
  });

  it('两条通道是 OR：话题型也能被"他对着她说"救回来', () => {
    delete process.env[KEY];
    // 共享实词一个都没有（锚点失败），但他明确在回应她那句回忆
    expect(classifyOutcomeFor(k('memory_echo'), '他上次说想去看海，我记着呢', '你还记得那事啊')).toBe('landed');
    expect(classifyOutcomeFor(k('curiosity'), '他好像提过一家没去过的店', '你说的那家店在哪来着？')).toBe('landed');
  });

  it('固有盲区（**故意不修**，避免拿标注集过拟合）：换了词的正面回答仍判 missed/unclear', () => {
    delete process.env[KEY];
    // 「熬夜」→「两点才睡」：无共享实词 ⇒ 词面判据接不到（要修得上语义，项目里没有 embedding）
    expect(classifyOutcomeFor(k('worry'), '他是不是又熬夜了，我有点担心', '昨晚两点才睡，今天头有点晕')).not.toBe('landed');
    // 只共享一个字（店）⇒ 低于 2 字锚点下限（v1.17 定的线，不能为了这一个例子降下来）
    expect(classifyOutcomeFor(k('curiosity'), '他好像提过一家没去过的店', '那家店我查了，周末要排队')).not.toBe('landed');
  });
});
