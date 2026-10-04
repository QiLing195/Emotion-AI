// ── v1.49 `state` 动机能不能入选（她自己的状态）──
//
// 这一组钉的是**算术**（零 LLM），因为这一刀的成败全在算术上：
//   ① 旧行为：「形成门槛 0.25」跨不过（`|mood.valence|` 可达带深端 ≈0.27、常见低落 0.09~0.13）
//      ＋「常数先验 0.40」⇒ 输给每一条在池的动机。两件事都要有测试钉住"关掉开关就是回旧行为"。
//   ② 新行为：门槛落进可达带（0.10）＋紧迫度随深度连续（0.44 → 0.72），
//      并在真池子里**赢得过**该赢的（curiosity/stance/memory_echo/wish，深一点连 worry 也赢），
//      **赢不过** `open_loop`（他那件还没落定的事）—— 这是刻意的设计边界。
//   ③ 实例级 `base` 必须真的被 `salienceOf` 认（否则整刀是空转）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  MOTIVE_BASE_SALIENCE, MOTIVE_MIN_SALIENCE, mergeCandidates, moodStateMotive, selectMotive,
  motiveToPromptSnippet, stateMotiveEnabled, stateMotiveFor,
  STATE_BASE_AT_MIN, STATE_BASE_MAX, STATE_MOOD_FULL, STATE_MOOD_MIN,
} from '../motive';
import type { MotiveCandidate } from '../motive';

// v1.49 已上线：默认**开**，`DISABLE_STATE_MOTIVE=true` 才回退旧行为
const KEY = 'DISABLE_STATE_MOTIVE';
/** 关掉新行为（= 回到 v1.48 之前） */
const off = () => { process.env[KEY] = 'true'; };
/** 打开（= 现在的默认） */
const on = () => { delete process.env[KEY]; };
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

const NOW = 1_700_000_000_000;
/** 一个真实形状的池子：都在保鲜期内、都没提过、与他这句话无关 */
function poolWith(stateBase?: number) {
  const cands: MotiveCandidate[] = [
    { kind: 'worry', content: '他是不是又熬夜了，我有点担心', formedAt: NOW - 24 * 3600_000 },
    { kind: 'memory_echo', content: '我想起他上次说想去看海', formedAt: NOW - 48 * 3600_000 },
    { kind: 'wish', content: '想和他多待一会儿', formedAt: NOW - 24 * 3600_000 },
    { kind: 'curiosity', content: '他好像提过一家没去过的店', formedAt: NOW - 72 * 3600_000 },
    { kind: 'stance', content: '我觉得人得先对自己诚实', formedAt: NOW - 12 * 3600_000 },
    { kind: 'state', content: '我今天状态有点低，不太想强撑着说话', formedAt: NOW - 10 * 60_000,
      ...(stateBase === undefined ? {} : { base: stateBase }) },
  ];
  return mergeCandidates([], cands, NOW);
}
const winner = (stateBase?: number) => selectMotive({
  state: { pool: poolWith(stateBase) } as never, candidates: [], userText: '今晚随便煮了点面', now: NOW,
}).selected?.kind ?? null;
/** 加一条"他那件还没落定的事" */
const winnerWithOpenLoop = (stateBase?: number) => selectMotive({
  state: {
    pool: mergeCandidates(poolWith(stateBase),
      [{ kind: 'open_loop', content: '他体检结果到底怎么样', formedAt: NOW - 2 * 3600_000 }], NOW),
  } as never, candidates: [], userText: '今晚随便煮了点面', now: NOW,
}).selected?.kind ?? null;

describe('v1.49 state 动机：能不能形成、能不能入选', () => {
  it('**已上线：默认开**；只有 DISABLE_STATE_MOTIVE=true 才回退（其余值都当开）', () => {
    on();
    expect(stateMotiveEnabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', 'false']) {
      process.env[KEY] = v;
      expect(stateMotiveEnabled(), v).toBe(true);
    }
    off();
    expect(stateMotiveEnabled()).toBe(false);
  });

  it('DISABLE=true = 逐字旧行为：门槛 0.25，且**不带** base（紧迫度落回类型先验 0.40）', () => {
    off();
    expect(stateMotiveFor(-0.20)).toBeNull();                 // 可达带内，但旧门槛够不到
    expect(stateMotiveFor(-0.26)?.base).toBeUndefined();       // 带内容、不带实例级 base
    expect(stateMotiveFor(-0.26)?.content).toContain('状态有点低');
    // 类型先验仍是 0.40 ⇒ 在真池子里裸分 0.38，**输给每一条**（这个池里最弱的是 stance 0.37；
    // 没有 open_loop 时赢家是 worry 0.57）
    expect(winner()).toBe('worry');
    expect(winner()).not.toBe('state');
  });

  it('开着：门槛落进实测可达带（0.10），紧迫度随深度连续上升', () => {
    on();
    expect(stateMotiveFor(-0.09)).toBeNull();                  // 低于可达带下限不说
    expect(stateMotiveFor(-STATE_MOOD_MIN)?.base).toBeCloseTo(STATE_BASE_AT_MIN, 9);
    expect(stateMotiveFor(-STATE_MOOD_FULL)?.base).toBeCloseTo(STATE_BASE_MAX, 9);
    // 单调不减 + 深端封顶
    const vs = [0.10, 0.12, 0.15, 0.18, 0.22, 0.28, 0.40, 1.0];
    const bases = vs.map(v => stateMotiveFor(-v)!.base!);
    for (let i = 1; i < bases.length; i++) expect(bases[i]).toBeGreaterThanOrEqual(bases[i - 1]);
    expect(bases.at(-1)).toBeCloseTo(STATE_BASE_MAX, 9);
    // 轻档内容与重档不同（旧门槛下"有点闷"这句从不出现）
    expect(stateMotiveFor(-0.12)?.content).toContain('有点闷');
    expect(stateMotiveFor(-0.30)?.content).toContain('状态有点低');
  });

  it('设计边界：**赢不过"他那件还没落定的事"**（base 上限刻意低于 open_loop 先验）', () => {
    expect(STATE_BASE_MAX).toBeLessThan(MOTIVE_BASE_SALIENCE.open_loop);
    on();
    expect(winnerWithOpenLoop(stateMotiveFor(-0.40)!.base)).toBe('open_loop');
    // 对照：若越界抬到 open_loop 的先验之上，它就会反超 —— 证明这个上限真的在起作用
    expect(winnerWithOpenLoop(MOTIVE_BASE_SALIENCE.open_loop + 0.01)).toBe('state');
  });

  it('真的能入选：浅低压过 stance/curiosity/echo/wish，再深一点压过 worry', () => {
    on();
    // 浅低（|v|=0.12，base 0.47 → 折后 0.45）：已经过了 wish 0.44，但**还压不过 worry 0.57**
    // ——这是刻意的：worry 是"关于他的挂念"，不该被一点点低落顶掉
    expect(winner(stateMotiveFor(-0.12)!.base)).toBe('worry');
    // 深下区（|v|=0.22，base 0.63 → 折后 0.60）⇒ 压过 worry
    expect(winner(stateMotiveFor(-0.22)!.base)).toBe('state');
    // 交叉点在哪：扫一遍找"state 第一次赢"的深度，钉住它落在可达带里（≤0.25）
    let crossing: number | null = null;
    for (let v = STATE_MOOD_MIN; v <= 0.6; v += 0.01) {
      if (winner(stateMotiveFor(-v)!.base) === 'state') { crossing = Number(v.toFixed(2)); break; }
    }
    expect(crossing).not.toBeNull();
    expect(crossing!).toBeLessThanOrEqual(0.25);
    expect(crossing!).toBeGreaterThan(STATE_MOOD_MIN);
    // 关掉开关的同一条池子：从不入选
    off();
    expect(winner()).not.toBe('state');
  });

  it('实例级 base 必须真的被 salienceOf 认（否则整刀空转）', () => {
    const p = poolWith(0.10);
    const st = p.find(m => m.kind === 'state')!;
    expect(st.base).toBe(0.10);
    const sel = selectMotive({ state: { pool: p } as never, candidates: [], userText: '', now: NOW });
    const diag = selectMotive({ state: { pool: [st] } as never, candidates: [], userText: '', now: NOW });
    expect(diag.diagnostics.topSalience).toBeLessThan(MOTIVE_BASE_SALIENCE.state);   // 比类型先验低
    expect(diag.diagnostics.topSalience).toBeGreaterThan(0);
    expect(sel.diagnostics.topSalience).toBeGreaterThan(0);
  });

  it('深端仍过最低门槛（不会因为"封顶"反而变成不说）', () => {
    on();
    const b = stateMotiveFor(-0.35)!.base!;
    expect(b).toBeGreaterThan(MOTIVE_MIN_SALIENCE);
  });

  it('v1.49b：state 入选时拿到的**不是**那段为"他的事"写的样板，而是"着色"', () => {
    on();                        // 先开着拿到内容与 base
    const st = stateMotiveFor(-0.22)!;
    expect(st).not.toBeNull();
    const motive = {
      id: 's1', kind: 'state' as const, content: st.content, source: {},
      salience: st.base!, base: st.base!, formedAt: NOW, expiresAt: NOW + 6 * 3600_000, attempts: 0,
    };
    // 关着：走旧样板（"问的应该是这件事的具体下文"）—— 对"我自己的心情"不成话
    off();
    expect(motiveToPromptSnippet(motive)).toContain('问的应该是这件事的具体下文');
    // 开着：换成着色文案
    on();
    const s = motiveToPromptSnippet(motive);
    expect(s).toContain('【我此刻的状态】');
    expect(s).toContain(st.content);
    expect(s).not.toContain('问的应该是这件事的具体下文');
    expect(s).toContain('照样接住他说的那件事');   // 不许把他那件事换掉（v1.42 的教训）
    expect(s).toContain('只是底色');
    expect(s).toContain('半句');
    // 其余类型**逐字不变**（只有 state 换文案）
    // ⚠️ v1.56 起 `memory_echo` **不再**走那段样板（指代消歧接管了它，见 `referentShape.test.ts`），
    //    所以对照换成 `open_loop` —— 它**设计上就永远**走那段"问他的下文"的样板。
    const loop = {
      id: 'o1', kind: 'open_loop' as const, content: '他面试那事有消息了吗', source: {},
      salience: 0.8, formedAt: NOW, expiresAt: NOW + 86_400_000, attempts: 0,
    };
    expect(motiveToPromptSnippet(loop)).toContain('问的应该是这件事的具体下文');
  });
});
