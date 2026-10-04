// ── v1.50 动机引导语按类型分派：单测 ──
//
// 由来（量出来的，不是猜的）：v1.49 第一跑里 `state` 拿到那段为"他的事"写的样板，
// 模型**直接无视那条动机**（`echo` 1.00→1.00、主终点 13%→0%）；换成对得上的形状后
// 同一个机制立刻生效（4%→67%）。⇒ **文案形状对不上类型，动机就白给。**
// 而 `memory_echo`（她心里存着的一件旧事）、`wish`、`stance` 至今拿到的都是「**问**它的具体下文」。
//
// 必须锁死：①开关默认关 ②关着时逐字节不变 ③开着时只有形状对不上的那几类换文案
//           ④`open_loop`/`worry` **一个字都不动**（问得通，现状是对的）
//           ⑤表里的文字不含要测的标记词（否则量的是我自己的字）

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { MOTIVE_KIND_SHAPES, motiveKindShapeEnabled, motiveToPromptSnippet } from '../motive';
import type { Motive, MotiveKind } from '../emotionTypes';

const KEY = 'ENABLE_MOTIVE_KIND_SHAPE';
const original = process.env[KEY];
// ⚠️ v1.56 已上线：**指代消歧对 `memory_echo` 优先**（它在 `motiveToPromptSnippet` 里排在按类型分派之前）。
//    本文件测的是 v1.50 那张表，所以必须先把它关掉，否则 `memory_echo` 永远走不到这里。
const REF = 'DISABLE_MOTIVE_REFERENT_SHAPE';
const refOriginal = process.env[REF];
beforeEach(() => { process.env[REF] = 'true'; });
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  if (refOriginal === undefined) delete process.env[REF];
  else process.env[REF] = refOriginal;
});
const on = () => { process.env[KEY] = 'true'; };
const off = () => { delete process.env[KEY]; };

const NOW = 1_700_000_000_000;
const mk = (kind: MotiveKind, content: string): Motive => ({
  id: kind, kind, content, source: {},
  salience: 0.6, formedAt: NOW, expiresAt: NOW + 3600_000, attempts: 0,
});

const OLD_BOILERPLATE = '问的应该是这件事的具体下文';

describe('v1.50 动机引导语按类型分派', () => {
  it('开关默认关；只认字面 true', () => {
    off();
    expect(motiveKindShapeEnabled()).toBe(false);
    process.env[KEY] = '1';
    expect(motiveKindShapeEnabled()).toBe(false);
    on();
    expect(motiveKindShapeEnabled()).toBe(true);
  });

  it('关着 = 逐字节回到旧样板（含 memory_echo / wish / stance）', () => {
    off();
    for (const k of ['memory_echo', 'wish', 'stance', 'curiosity'] as MotiveKind[]) {
      expect(motiveToPromptSnippet(mk(k, '我想起他上次说想去看海'))).toContain(OLD_BOILERPLATE);
    }
  });

  it('**问得通的那两类一个字都不动**：open_loop / worry 开着也走旧样板', () => {
    on();
    expect(MOTIVE_KIND_SHAPES.open_loop).toBeUndefined();
    expect(MOTIVE_KIND_SHAPES.worry).toBeUndefined();
    for (const k of ['open_loop', 'worry'] as MotiveKind[]) {
      const s = motiveToPromptSnippet(mk(k, '他面试那事有消息了吗'));
      expect(s).toContain(OLD_BOILERPLATE);
      expect(s).toContain('本轮开口就从这件事出发');
    }
  });

  it('开着：形状对不上的那几类换成自己的引导语，且不再出现旧样板', () => {
    on();
    for (const k of ['memory_echo', 'wish', 'stance', 'curiosity'] as MotiveKind[]) {
      const s = motiveToPromptSnippet(mk(k, '我想起他上次说想去看海'));
      expect(s, k).toContain(MOTIVE_KIND_SHAPES[k]!);
      expect(s, k).not.toContain(OLD_BOILERPLATE);
      // 兜底两句仍在（"先接住他" + "不要说元描述"）
      expect(s).toContain('如果他此刻的情绪更需要被接住');
      expect(s).toContain('不要说出"我心里挂着"这类元描述');
    }
  });

  it('memory_echo 的引导语说的是"用你自己的一句话把它说出来"', () => {
    on();
    const s = motiveToPromptSnippet(mk('memory_echo', '我想起他上次说想去看海'));
    expect(s).toContain('用你自己的一句话把它说出来');
  });

  it('v1.50b：引导语是**正面写法** —— 一个「问」字都不许有（第一跑栽在这）', () => {
    // 第一跑用的是否定式（"不是要盘问他 / 不必问它现在怎么样了"）⇒ 问句反而 1.00→1.75。
    // 把"问"提到她眼前等于点着了它，所以这一版**只说该做什么**。
    for (const [kind, text] of Object.entries(MOTIVE_KIND_SHAPES)) {
      expect(text, kind).not.toMatch(/问|盘问|不必|不是要/);
    }
  });

  it('`state` 仍走它自己的那条路（不受本开关影响，两者互不干扰）', () => {
    on();                       // 只开 v1.50
    const s = motiveToPromptSnippet(mk('state', '我今天心里有点闷，说不太清楚'));
    // `state` 的形状由 `DISABLE_STATE_MOTIVE` 那条通路管；`MOTIVE_KIND_SHAPES` 里**故意没有** state
    expect(MOTIVE_KIND_SHAPES.state).toBeUndefined();
    expect(s).toContain('【我此刻的状态】');   // 已上线（默认开）
  });

  it('表里的文字**不含要测的标记词**（否则量的是我自己的字）', () => {
    const markers = ['我想起', '我记得', '我想到了', '让我想起'];
    for (const [kind, text] of Object.entries(MOTIVE_KIND_SHAPES)) {
      for (const m of markers) expect(text, `${kind} 含标记词 ${m}`).not.toContain(m);
    }
  });

  it('⚠️ 优先级：v1.56 的指代消歧对 `memory_echo` **优先于** v1.50 的按类型分派', () => {
    // 两把开关都开 ⇒ memory_echo 走**指代消歧**（已上线、已实测的那条）
    delete process.env[REF];
    on();
    const echo = motiveToPromptSnippet(mk('memory_echo', '我想起他上次说想去看海'));
    expect(echo).toContain('我自己心里挂着的就是');
    expect(echo).not.toContain(MOTIVE_KIND_SHAPES.memory_echo!);
    // 而 wish / stance / curiosity **仍然**走 v1.50 那张表（它们**没有**被指代消歧接管）
    for (const k of ['wish', 'stance', 'curiosity'] as MotiveKind[]) {
      expect(motiveToPromptSnippet(mk(k, '我想起他上次说想去看海')), k).toContain(MOTIVE_KIND_SHAPES[k]!);
    }
  });
});
