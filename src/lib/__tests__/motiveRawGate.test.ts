// ── v1.52 门槛看"加权前"的分（学习权重只用于排序）──
//
// 病灶（v1.51 量出）：`motiveWeight` 的下界 0.5 把 `curiosity`/`stance` 的有效先验压到
// 0.26 / 0.23，而 `MOTIVE_MIN_SALIENCE`=0.28 是按**未加权**先验标定的 ⇒ 这两类
// **事实上永远开不了口**（`wish` 只剩 0.01 余量）。这与 `motiveWeight` 注释里的意图
// （"下界保证任何开口方式都不会被封杀"）直接矛盾。
//
// 语义分工（必须锁死）：
//   · 门槛（**能不能开口**）是**情境**问题 ⇒ 看加权前（含"刚说过"的重复惩罚，那是情境事实）
//   · 权重（**够格的里面谁最该说**）是**学习**问题 ⇒ 只用于排序
// 所以：开着时 `stance` 能开口，但它报出来的 `salience` 仍是**加权后**的值（排序没变）。

import { describe, it, expect, afterEach } from 'vitest';
import {
  MOTIVE_MIN_SALIENCE, motiveRawGateEnabled, motiveWeight, selectMotive, mergeCandidates,
} from '../motive';
import type { MotiveCandidate, MotiveLearningState } from '../motive';

// v1.52 已上线：默认**开**，DISABLE_MOTIVE_RAW_GATE=true 才回退（门槛看加权后）
const KEY = 'DISABLE_MOTIVE_RAW_GATE';
const original = process.env[KEY];
afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});
const off = () => { process.env[KEY] = 'true'; };   // 回退（门槛看加权后）
const on = () => { delete process.env[KEY]; };     // 默认（门槛看加权前）

const NOW = 1_700_000_000_000;
const USER = '今天下午把阳台收拾了一下，累是累，看着还行。';
/** 真实账本里 stance/curiosity 的样子：样本够了、但一次都没被接住 ⇒ 权重 0.5 */
const LEDGER: MotiveLearningState = {
  stats: { stance: { voiced: 3, landed: 0 }, curiosity: { voiced: 10, landed: 0 } },
} as unknown as MotiveLearningState;

const cand = (kind: string, content: string, ageMs = 10 * 60_000): MotiveCandidate => ({
  kind: kind as never, content, formedAt: NOW - ageMs,
});

const pick = (kind: string, content: string, learning?: MotiveLearningState, extra: Record<string, unknown> = {}) => {
  const pool = mergeCandidates([], [cand(kind, content)], NOW);
  return selectMotive({
    state: { pool, ...extra } as never, candidates: [], userText: USER, now: NOW, learning,
  });
};

describe('v1.52 门槛看加权前（学习权重只用于排序）', () => {
  it('**已上线：默认开**；只有 DISABLE_MOTIVE_RAW_GATE=true 才回退（其余值都当开）', () => {
    on();
    expect(motiveRawGateEnabled()).toBe(true);
    for (const v of ['1', 'TRUE', 'yes', 'false']) {
      process.env[KEY] = v;
      expect(motiveRawGateEnabled(), v).toBe(true);
    }
    off();
    expect(motiveRawGateEnabled()).toBe(false);
  });

  it('前置事实：账本里 stance 的权重是 0.5，加权后**确实**过不了门槛', () => {
    expect(motiveWeight(LEDGER, 'stance')).toBeCloseTo(0.5, 9);
    off();
    const r = pick('stance', '诚实比好听更要紧', LEDGER);
    expect(r.selected).toBeNull();
    expect(r.diagnostics.reason).toContain('动机紧迫度不足');
    expect(r.diagnostics.topSalience).toBeLessThan(MOTIVE_MIN_SALIENCE);
  });

  it('开着：同一条 stance 能开口了（门槛看加权前），但报出来的仍是**加权后**的分', () => {
    on();
    const r = pick('stance', '诚实比好听更要紧', LEDGER);
    expect(r.selected?.kind).toBe('stance');
    expect(r.selected?.content).toBe('诚实比好听更要紧');
    // 报出来的分 < 门槛 ⇒ 证明"排序仍走加权"、门槛看的是另一个数
    expect(r.selected!.salience).toBeLessThan(MOTIVE_MIN_SALIENCE);
  });

  it('开着也**不会**什么都放进来：加权前就不过门槛的照样安静陪伴', () => {
    on();
    // 极旧 ⇒ 保鲜度衰减到门槛以下（stance TTL 72h ⇒ 半衰期 36h）
    const r = pick('stance', '诚实比好听更要紧', LEDGER, {});
    expect(r.selected?.kind).toBe('stance');                 // 新鲜时能开口（上一条）
    const stale = selectMotive({
      state: { pool: mergeCandidates([], [cand('stance', '诚实比好听更要紧', 40 * 3600_000)], NOW) } as never,
      candidates: [], userText: USER, now: NOW, learning: LEDGER,
    });
    expect(stale.selected).toBeNull();                        // 40h 前形成的 ⇒ 加权前已低于门槛
    expect(r.deferredToUser).toBe(false);
  });

  it('学习权重**仍然决定排序**：加权前更高的那条会被权重压下去', () => {
    on();
    const pool = mergeCandidates([], [
      cand('stance', '诚实比好听更要紧'),        // 先验 0.46
      cand('memory_echo', '他上次说想去看海'),   // 先验 0.62（**加权前更高**）
    ], NOW);
    // 情形一：memory_echo 不在账本里（权重 1.0）⇒ 它赢（0.62 > 0.46）
    const r1 = selectMotive({
      state: { pool } as never, candidates: [], userText: USER, now: NOW, learning: LEDGER,
    });
    expect(r1.selected?.kind).toBe('memory_echo');
    // 情形二：**只**给 memory_echo 记上"9 次发声、0 次被接住"⇒ 它 0.62×0.5=0.31；
    //        而 stance 不在账本里、权重仍是 1.0 ⇒ 0.46
    //        ★ 这就是"排序仍由权重决定"的证据：**加权前更高**的那条被权重压了下去
    const r2 = selectMotive({
      state: { pool } as never, candidates: [], userText: USER, now: NOW,
      learning: {
        stats: { memory_echo: { voiced: 9, landed: 0 } },
      } as unknown as MotiveLearningState,
    });
    expect(motiveWeight({ stats: { memory_echo: { voiced: 9, landed: 0 } } } as unknown as MotiveLearningState, 'memory_echo'))
      .toBeCloseTo(0.5, 9);
    expect(motiveWeight(LEDGER, 'memory_echo')).toBe(1);   // 不在账本里 ⇒ 中性
    expect(r2.selected?.kind).toBe('stance');
  });

  it('"刚刚说过"的重复惩罚**仍然计入门槛**（那是情境事实，不是学习）', () => {
    on();
    const r = pick('stance', '诚实比好听更要紧', LEDGER, {
      lastSelectedId: 'x', lastSelectedContent: '诚实比好听更要紧', lastSelectedAt: NOW - 5 * 60_000,
    });
    // 5 分钟前刚说过 ⇒ ×0.3 ⇒ 加权前 0.46×0.3≈0.14 < 0.28 ⇒ 门槛照样拦住
    expect(r.selected).toBeNull();
    expect(r.diagnostics.reason).toContain('动机紧迫度不足');
  });
});
