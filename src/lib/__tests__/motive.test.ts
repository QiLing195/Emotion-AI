// ── motive 单元测试（v1.9 动机层）──
// 覆盖：未完待续抽取与解除 / 动机竞选（含习惯化·过期·让位·允许为空）/
//       Prompt 片段 / 价值观·状态·记忆回响的内容生成
// 背景：泛问（"今天怎么样"）的根因是"她此刻没有具体想说的"，
//       所以本层最重要的两条断言是：①有具体素材时必须用它 ②没有就允许安静。

import { describe, it, expect } from 'vitest';
import {
  extractOpenLoops,
  openLoopMotiveContent,
  isOpenLoopResolved,
  selectMotive,
  mergeCandidates,
  markMotiveAttempted,
  satisfyMotive,
  resolveOpenLoops,
  motiveToPromptSnippet,
  DEFAULT_DEFER_STYLE,
  parseDeferStyle,
  describeMotive,
  motiveRelevance,
  shouldDeferToUser,
  valueStanceMotive,
  moodStateMotive,
  memoryEchoMotive,
  MOTIVE_MIN_SALIENCE,
  MOTIVE_MAX_ATTEMPTS,
  MOTIVE_POOL_LIMIT,
  MOTIVE_BASE_SALIENCE,
  type MotiveCandidate,
} from '../motive';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState, MotiveState } from '../emotionTypes';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

/**
 * v1.28：让位判据读的是「**这一轮开始前**她本来沉不沉」（相对本性的激活量），
 * 测试里直接给这个量 —— 而不是给一个 EmotionState（那会让人以为传的是"当前状态"）。
 */
const negBefore = (intensity: number, emotion = 'sad') => ({ emotion, intensity });
/** 她本来静息（门限 0.12 之下） */
const RESTING_BEFORE = negBefore(0, 'neutral');
/** v1.31：她"本来就已经沉在里面"（越 DEFER_HER_SINK=0.12）—— 让位判定的她那一半 */
const SINKING_BEFORE = negBefore(0.20);

function state(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function pool(overrides: Partial<MotiveState> = {}): MotiveState {
  return { pool: [], ...overrides };
}

const openLoopCandidate = (content = '他之前提到「面试」，还没说后来怎么样了——我想知道结果'): MotiveCandidate => ({
  kind: 'open_loop',
  content,
});

// ════════════════════════════════════════════════════════════
// 1. 未完待续（open loop）抽取
// ════════════════════════════════════════════════════════════

describe('extractOpenLoops — 抽取他说了但没落定的事', () => {
  it('未完成标记 + 待结果话题 → 命中', () => {
    const hits = extractOpenLoops('我明天要去面试，有点紧张');
    expect(hits).toHaveLength(1);
    expect(hits[0].topic).toBe('面试');
  });

  it('只有时间词、没有具体事 → 不命中（避免把随口一句当悬念）', () => {
    expect(extractOpenLoops('我明天再说吧')).toHaveLength(0);
  });

  it('已落定的说法 → 不命中', () => {
    expect(extractOpenLoops('面试结果出来了，通过了')).toHaveLength(0);
    expect(extractOpenLoops('那个方案黄了')).toHaveLength(0);
  });

  it('普通闲聊不命中（不制造假悬念）', () => {
    expect(extractOpenLoops('今天吃了面，还行')).toHaveLength(0);
    expect(extractOpenLoops('哈哈哈哈')).toHaveLength(0);
  });

  it('空串 / 非字符串安全', () => {
    expect(extractOpenLoops('')).toHaveLength(0);
    expect(extractOpenLoops('   ')).toHaveLength(0);
    expect(extractOpenLoops(undefined as unknown as string)).toHaveLength(0);
  });

  it('跨句不误配（未完成标记与话题必须同句）', () => {
    expect(extractOpenLoops('我明天要早起。对了，体检是什么流程？')).toHaveLength(0);
  });

  it('maxHits 限制命中数量', () => {
    const hits = extractOpenLoops('我明天要去面试，还要去体检', 1);
    expect(hits).toHaveLength(1);
  });

  it('动机内容具体到可以直接说出口，且区分"刚说"与"之前说"（防假记忆）', () => {
    const [hit] = extractOpenLoops('下周要去体检');
    const past = openLoopMotiveContent(hit);
    const now = openLoopMotiveContent(hit, true);
    expect(past).toContain('体检');
    expect(past).toContain('之前提到');
    expect(now).toContain('体检');
    expect(now).toContain('刚说');
    expect(now).not.toContain('之前提到');
  });
});

describe('isOpenLoopResolved — 后续消息解除悬念', () => {
  const content = '他之前提到「面试」，还没说后来怎么样了——我想知道结果';

  it('同一话题 + 落定标记 → 解除', () => {
    expect(isOpenLoopResolved(content, '面试过了！')).toBe(true);
    expect(isOpenLoopResolved(content, '面试结果出来了')).toBe(true);
  });

  it('只有落定标记但话题不同 → 不解除', () => {
    expect(isOpenLoopResolved(content, '体检结果出来了')).toBe(false);
  });

  it('只有话题没有落定 → 不解除（悬念还在）', () => {
    expect(isOpenLoopResolved(content, '面试好难')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════
// 2. 入池与去重
// ════════════════════════════════════════════════════════════

describe('mergeCandidates — 入池去重与容量', () => {
  it('同一件事重复采集只入池一次（相似视为同一件）', () => {
    const next = mergeCandidates([], [
      openLoopCandidate(),
      openLoopCandidate('他之前提到「面试」，还没说后来怎么样了——我想知道结果'),
    ], T0);
    expect(next).toHaveLength(1);
  });

  it('不同的事各自入池', () => {
    const next = mergeCandidates([], [
      openLoopCandidate(),
      { kind: 'state', content: '我今天状态有点低，不太想强撑着说话' },
    ], T0);
    expect(next).toHaveLength(2);
  });

  it('空内容/空白内容被丢弃', () => {
    const next = mergeCandidates([], [
      { kind: 'state', content: '   ' },
      { kind: 'state', content: '' },
    ], T0);
    expect(next).toHaveLength(0);
  });

  it('池容量有上限', () => {
    const many: MotiveCandidate[] = Array.from({ length: MOTIVE_POOL_LIMIT + 8 }, (_, i) => ({
      kind: 'curiosity' as const,
      content: `我想弄明白第${i}个完全不同的好奇话题到底是怎么回事`,
    }));
    expect(mergeCandidates([], many, T0).length).toBeLessThanOrEqual(MOTIVE_POOL_LIMIT);
  });

  it('重复采集会刷新时效但保留 attempts（不会借刷新洗掉习惯化）', () => {
    const first = mergeCandidates([], [openLoopCandidate()], T0);
    const attempted = first.map(m => ({ ...m, attempts: 2 }));
    const refreshed = mergeCandidates(attempted, [openLoopCandidate()], T0 + 6 * HOUR);
    expect(refreshed[0].attempts).toBe(2);
    expect(refreshed[0].formedAt).toBe(T0 + 6 * HOUR);
  });
});

// ════════════════════════════════════════════════════════════
// 3. 竞选
// ════════════════════════════════════════════════════════════

describe('selectMotive — 有具体动机时用它', () => {
  it('有 open_loop 候选 → 选中它', () => {
    const out = selectMotive({
      state: pool(),
      candidates: [openLoopCandidate()],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0,
    });
    expect(out.selected?.kind).toBe('open_loop');
    expect(out.selected?.salience).toBeGreaterThanOrEqual(MOTIVE_MIN_SALIENCE);
    expect(out.deferredToUser).toBe(false);
  });

  it('open_loop 比"内在状态"更容易被选中（承接他 > 说自己）', () => {
    const out = selectMotive({
      state: pool(),
      candidates: [openLoopCandidate(), { kind: 'state', content: '我今天状态有点低，不太想强撑着说话' }],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0,
    });
    expect(out.selected?.kind).toBe('open_loop');
    expect(MOTIVE_BASE_SALIENCE.open_loop).toBeGreaterThan(MOTIVE_BASE_SALIENCE.state);
  });

  it('与他本轮话语重合的候选优先', () => {
    const out = selectMotive({
      state: pool(),
      candidates: [
        { kind: 'curiosity', content: '我想弄明白量子计算到底是怎么回事' },
        { kind: 'curiosity', content: '我想知道面试那件事后来怎么了' },
      ],
      userText: '面试的事我一直没跟你说',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0,
    });
    expect(out.selected?.content).toContain('面试');
  });
});

describe('selectMotive — 允许"没有动机"', () => {
  it('没有候选 → 不选，并说明是安静陪伴', () => {
    const out = selectMotive({ state: pool(), candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 });
    expect(out.selected).toBeNull();
    expect(out.diagnostics.reason).toContain('安静陪伴');
  });

  it('只提话题词（提问/闲聊）不算悬念', () => {
    expect(extractOpenLoops('体检是什么流程？')).toHaveLength(0);
    expect(extractOpenLoops('结果这两个字怎么写')).toHaveLength(0);
  });

  it('已发生/进行中的事也算悬念（今天去体检了）', () => {
    const hits = extractOpenLoops('今天去体检了');
    expect(hits).toHaveLength(1);
    expect(hits[0].topic).toBe('体检');
  });

  it('候选紧迫度不足 → 也不选（宁可不问，但不是因为过期）', () => {
    // state 型先验 0.40，TTL 6h：5.9h 后已衰到 0.1 以下，但还没过期
    const seeded = mergeCandidates([], [{ kind: 'state', content: '我今天状态有点低，不太想强撑着说话' }], T0);
    const out = selectMotive({
      state: { pool: seeded },
      candidates: [],
      userText: '完全不相关的一句话',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 5.9 * HOUR,
    });
    expect(out.selected).toBeNull();
    expect(out.diagnostics.reason).toContain('紧迫度不足');
    expect(out.nextState.pool).toHaveLength(1); // 只是不选，不是被清掉
  });

  it('她自己本来就已经沉在里面 + 他情绪强烈 → 让位（本轮先接住他）', () => {
    const s = state();
    s.emotions.sad = 0.7;
    const out = selectMotive({
      state: pool(),
      candidates: [openLoopCandidate()],
      userText: '我今天真的很难受',
      herNegativeBeforeTurn: negBefore(0.20),
      userIntensity: 0.9,
      now: T0,
    });
    expect(out.deferredToUser).toBe(true);
    expect(out.selected).toBeNull();
    expect(out.diagnostics.reason).toContain('先接住他');
    // ② v1.28：让位时不再是"什么都没有"，而是给他一个具体锚
    expect(out.deferAnchor?.kind).toBe('open_loop');
    expect(out.deferAnchor?.content).toBeTruthy();
  });

  it('**他很强但她本来没沉 → 不让位**（v1.28 修的：旧口径会被"他这一句"顶上去）', () => {
    const out = selectMotive({
      state: pool(),
      candidates: [openLoopCandidate()],
      userText: '我今天真的很难受',
      herNegativeBeforeTurn: RESTING_BEFORE,
      userIntensity: 0.9,          // 他很强
      now: T0,
    });
    expect(out.deferredToUser).toBe(false);
  });

  it('她本来沉但他强度不高 → 不触发让位', () => {
    expect(shouldDeferToUser(negBefore(0.20), 0.3)).toBe(false);
  });

  it('门槛就是激活量的 0.12（与 ACCOMPANY_WHEN_SHE_SINKS 同一个语义常量）', () => {
    expect(shouldDeferToUser(negBefore(0.11), 0.9)).toBe(false);
    expect(shouldDeferToUser(negBefore(0.12), 0.9)).toBe(true);
    // 与他的强度无关：静息的她，他再强也不让位
    for (const u of [0.6, 0.8, 1.0]) expect(shouldDeferToUser(RESTING_BEFORE, u)).toBe(false);
    expect(shouldDeferToUser(null, 1.0)).toBe(false);
  });

  // ── v1.31：他**明确说了负面情绪**时门槛 0.6 → 0.4（实测见 motive.ts 的 DEFER_USER_INTENSITY_MODERATE）──
  it('他明确是负面情绪（情绪键）→ 0.4 就让位', () => {
    for (const e of ['sad', 'anger', 'fear', 'disgust']) {
      expect(shouldDeferToUser(SINKING_BEFORE, 0.40, e)).toBe(true);
      expect(shouldDeferToUser(SINKING_BEFORE, 0.39, e)).toBe(false);
    }
  });

  it('同样的强度，但没给情绪键 / 情绪键不是负面 → 仍用 0.6 门槛（不传不该悄悄变行为）', () => {
    for (const e of [undefined, null, '', 'neutral', 'joy', 'love', 'gratitude']) {
      expect(shouldDeferToUser(SINKING_BEFORE, 0.40, e as string | undefined)).toBe(false);
      expect(shouldDeferToUser(SINKING_BEFORE, 0.55, e as string | undefined)).toBe(false);
      expect(shouldDeferToUser(SINKING_BEFORE, 0.60, e as string | undefined)).toBe(true);
    }
  });

  it('她本来没沉 → 门槛再低也不让位（v1.28 那条仍然成立）', () => {
    for (const e of ['sad', 'anger']) {
      expect(shouldDeferToUser(RESTING_BEFORE, 0.40, e)).toBe(false);
      expect(shouldDeferToUser(RESTING_BEFORE, 1.00, e)).toBe(false);
    }
  });

  it('selectMotive 会把 userEmotion 透传给让位判定', () => {
    const call = (emotion?: string) => selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '今天上班好累，被老板说了两句',
      herNegativeBeforeTurn: SINKING_BEFORE, userIntensity: 0.40, userEmotion: emotion, now: T0,
    });
    expect(call('sad').deferredToUser).toBe(true);
    expect(call('sad').selected).toBeNull();
    expect(call(undefined).deferredToUser).toBe(false);
    expect(call(undefined).selected).not.toBeNull();
  });
});

describe('selectMotive — 习惯化与过期（防"每次都问同一件事"）', () => {
  it('提起过多次后趋于沉默（但不是硬删除：池里还留着，等他再提起）', () => {
    const seeded = mergeCandidates([], [openLoopCandidate()], T0)
      .map(m => ({ ...m, attempts: MOTIVE_MAX_ATTEMPTS, lastAttemptAt: T0 }));
    const out = selectMotive({
      state: { pool: seeded }, candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 + HOUR,
    });
    expect(out.selected).toBeNull();
    expect(out.nextState.pool).toHaveLength(1); // 保留，不硬清除
  });

  it('尝试 1 次后紧迫度下降（同一件事不会连着追问）', () => {
    const fresh = mergeCandidates([], [openLoopCandidate()], T0);
    const once = fresh.map(m => ({ ...m, attempts: 1 }));
    const twice = fresh.map(m => ({ ...m, attempts: 2 }));
    const pick = (p: typeof fresh) => selectMotive({
      state: { pool: p }, candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 + HOUR,
    }).selected?.salience ?? 0;
    expect(pick(once)).toBeLessThan(pick(fresh));
    expect(pick(twice)).toBeLessThan(pick(once));
  });

  it('过期动机被清除（不许翻陈年旧账）', () => {
    const stale = mergeCandidates([], [openLoopCandidate()], T0); // open_loop TTL 48h
    const out = selectMotive({
      state: { pool: stale }, candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 + 72 * HOUR,
    });
    expect(out.selected).toBeNull();
    expect(out.nextState.pool).toHaveLength(0);
  });

  it('markMotiveAttempted 递增尝试次数', () => {
    const s = pool({ pool: mergeCandidates([], [openLoopCandidate()], T0) });
    const id = s.pool[0].id;
    const once = markMotiveAttempted(s, id, T0 + HOUR);
    expect(once.pool[0].attempts).toBe(1);
    expect(once.pool[0].lastAttemptAt).toBe(T0 + HOUR);
    expect(markMotiveAttempted(once, id, T0 + 2 * HOUR).pool[0].attempts).toBe(2);
  });

  it('satisfyMotive 后该动机退出池', () => {
    const s = pool({ pool: mergeCandidates([], [openLoopCandidate()], T0) });
    const id = s.pool[0].id;
    const satisfied = satisfyMotive(s, id, T0 + HOUR);
    expect(satisfied.pool[0].satisfiedAt).toBe(T0 + HOUR);
    const out = selectMotive({
      state: satisfied, candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 + 2 * HOUR,
    });
    expect(out.selected).toBeNull();
  });

  it('resolveOpenLoops 用后续消息解除悬念', () => {
    const s = pool({ pool: mergeCandidates([], [openLoopCandidate()], T0) });
    const resolved = resolveOpenLoops(s, '面试过了', T0 + HOUR);
    expect(resolved.pool[0].satisfiedAt).toBe(T0 + HOUR);
  });

  it('刚刚提过的那件事，下一轮不会马上再提（防连续追问）', () => {
    const seeded = mergeCandidates([], [openLoopCandidate()], T0);
    const id = seeded[0].id;
    // 上一轮刚提过 → 本轮同一件事被额外打折
    const repeated = selectMotive({
      state: { pool: seeded, lastSelectedId: id, lastSelectedAt: T0 },
      candidates: [],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 5 * 60_000, // 5 分钟后
    });
    const cold = selectMotive({
      state: { pool: seeded, lastSelectedId: 'other_id', lastSelectedAt: T0 },
      candidates: [],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 5 * 60_000,
    });
    expect(repeated.selected).toBeNull();
    expect(cold.selected?.kind).toBe('open_loop');
  });

  it('过了"刚刚"窗口后仍可再提（她确实记挂着）', () => {
    const seeded = mergeCandidates([], [openLoopCandidate()], T0 + 6 * HOUR);
    const out = selectMotive({
      state: { pool: seeded, lastSelectedId: seeded[0].id, lastSelectedAt: T0 },
      candidates: [],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 6 * HOUR, // 距上次提起 6 小时
    });
    expect(out.selected?.kind).toBe('open_loop');
  });

  it('换了动机类型但仍是同一件事 → 也要压（话题级去重）', () => {
    // 上一轮说的是 open_loop（面试），这一轮 stance 里也提到同一件事
    const seeded = mergeCandidates([], [
      openLoopCandidate(),
      { kind: 'stance', content: '他之前提到「面试」还没说后来怎么样了，我想问清楚' },
    ], T0);
    const openLoopId = seeded.find(m => m.kind === 'open_loop')!.id;
    const out = selectMotive({
      state: {
        pool: seeded,
        lastSelectedId: openLoopId,
        lastSelectedContent: '他之前提到「面试」，还没说后来怎么样了——我想知道结果',
        lastSelectedAt: T0,
      },
      candidates: [],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 5 * 60_000,
    });
    // 两条都在讲面试 → 都被压到阈值以下 → 本轮安静
    expect(out.selected).toBeNull();
  });

  it('每轮都写 lastSelection（含"空动机"与"让位"，供 /state 观测）', () => {
    const empty = selectMotive({ state: pool(), candidates: [], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0 });
    expect(empty.nextState.lastSelection?.deferred).toBe(false);
    expect(empty.nextState.lastSelection?.selectedKind).toBeUndefined();

    const s = state();
    s.emotions.sad = 0.7;
    const deferred = selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '难受', herNegativeBeforeTurn: negBefore(0.20), userIntensity: 0.9, now: T0,
    });
    expect(deferred.nextState.lastSelection?.deferred).toBe(true);

    const picked = selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0,
    });
    expect(picked.nextState.lastSelection?.selectedKind).toBe('open_loop');
  });

  it('不同类型即使字面相似也不合并（防"面试悬念"被"立场"吸走）', () => {
    const next = mergeCandidates([], [
      { kind: 'open_loop', content: '他之前提到「面试」，还没说后来怎么样了——我想知道结果' },
      { kind: 'stance', content: '我在意的是真的连上，我想问他面试那件事后来怎么样了' },
    ], T0);
    expect(next.map(m => m.kind).sort()).toEqual(['open_loop', 'stance']);
  });

  it('他再次提起同一件事 → 即使之前问过两次，也可以再问（这才是"记挂着"）', () => {
    const seeded = mergeCandidates([], [openLoopCandidate()], T0)
      .map(m => ({ ...m, attempts: 2, lastAttemptAt: T0 }));
    // 短时间内：被重复惩罚 + 习惯化压住
    const soon = selectMotive({
      state: { pool: seeded, lastSelectedId: seeded[0].id, lastSelectedAt: T0 },
      candidates: [],
      userText: '嗯',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 5 * 60_000,
    });
    expect(soon.selected).toBeNull();
    // 隔天他又提到这件事（候选重新采集 → 刷新时效）→ 她可以再问
    const refreshed = mergeCandidates(seeded, [openLoopCandidate()], T0 + 25 * HOUR);
    const later = selectMotive({
      state: { pool: refreshed, lastSelectedId: seeded[0].id, lastSelectedAt: T0 },
      candidates: [],
      userText: '面试的事我还是有点忐忑',
      herNegativeBeforeTurn: RESTING_BEFORE,
      now: T0 + 25 * HOUR,
    });
    expect(later.selected?.kind).toBe('open_loop');
  });

  it('selectMotive 会记录 lastSelectedId（供可观测）', () => {
    const out = selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0,
    });
    expect(out.nextState.lastSelectedId).toBe(out.selected?.id);
  });
});

// ════════════════════════════════════════════════════════════
// 4. 相关度与 Prompt 片段
// ════════════════════════════════════════════════════════════

describe('motiveRelevance', () => {
  it('与用户话语重合 → 相关度提升', () => {
    expect(motiveRelevance('我想知道面试那件事怎么了', '面试')).toBeGreaterThan(1);
  });

  it('完全无关 → 相关度为 1（不惩罚）', () => {
    expect(motiveRelevance('我想弄明白量子计算', '今天天气不错')).toBe(1);
  });
});

describe('motiveToPromptSnippet', () => {
  it('有动机时给出具体内容与"从这件事出发"的要求', () => {
    const out = selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0,
    });
    const snippet = motiveToPromptSnippet(out.selected);
    expect(snippet).toContain('面试');
    expect(snippet).toContain('从这件事出发');
    // 不暴露内部术语
    expect(snippet).not.toContain('open_loop');
    expect(snippet).not.toMatch(/salience|0\.\d/);
  });

  it('无动机时明确允许安静，并禁止泛问', () => {
    const snippet = motiveToPromptSnippet(null);
    expect(snippet).toContain('安静');
    expect(snippet).toContain('不要为了维持对话而泛问');
  });

  // ── v1.30：让位那段话的三档写法（判定不变，只换措辞；默认档由真管道实测裁定）──
  const ANCHOR = { kind: 'open_loop' as const, content: '他面试那事还没下文' };

  it('默认档 = 实测胜出的 omit ⇒ 不传 opts 时让位片段为空（v1.28 的锚文案已退役）', () => {
    expect(motiveToPromptSnippet(null, ANCHOR)).toBe('');
    expect(DEFAULT_DEFER_STYLE).toBe('omit');
  });

  it('parseDeferStyle：合法档位直通，非法/空 → null（让调用方决定告警与回退）', () => {
    expect(parseDeferStyle('anchor')).toBe('anchor');
    expect(parseDeferStyle(' swallow ')).toBe('swallow');
    expect(parseDeferStyle('omit')).toBe('omit');
    expect(parseDeferStyle('hard')).toBeNull();
    expect(parseDeferStyle('')).toBeNull();
    expect(parseDeferStyle(undefined)).toBeNull();
  });

  it('anchor 档（v1.28 现状，保留可复现）：拿那件事当锚，可以顺着问它的下文', () => {
    const snippet = motiveToPromptSnippet(null, ANCHOR, { deferring: true, deferStyle: 'anchor' });
    expect(snippet).toContain(ANCHOR.content);
    expect(snippet).toContain('顺着这件事问一句它的下文');
  });

  it('swallow：锚仍在，但写成"咽下去"的（先不问它 + 给在场示例）', () => {
    const snippet = motiveToPromptSnippet(null, ANCHOR, { deferring: true, deferStyle: 'swallow' });
    expect(snippet).toContain(ANCHOR.content);
    expect(snippet).toContain('先不问它');
    expect(snippet).toContain('我在');
    // 不能再把它交回给"处理那件事"
    expect(snippet).not.toContain('顺着这件事问一句它的下文');
  });

  it('omit：让位时整块不给（返回空串，调用方需跳过拼接）', () => {
    expect(motiveToPromptSnippet(null, ANCHOR, { deferring: true, deferStyle: 'omit' })).toBe('');
  });

  it('omit 不影响"没有动机"那套措辞（非让位时仍是安静陪着 + 不泛问）', () => {
    const snippet = motiveToPromptSnippet(null, null, { deferring: false, deferStyle: 'omit' });
    expect(snippet).toContain('安静');
    expect(snippet).toContain('不要为了维持对话而泛问');
  });

  it('让位但手里没有"关于他的"具体事 → 允许为空，退回"没有特别挂着的事"那套', () => {
    const snippet = motiveToPromptSnippet(null, null, { deferring: true, deferStyle: 'anchor' });
    expect(snippet).toContain('没有特别挂着的事');
  });

  it('显式 deferring=false 时，即使传了锚也不出"让位"措辞（调用方说了算）', () => {
    const snippet = motiveToPromptSnippet(null, ANCHOR, { deferring: false, deferStyle: 'anchor' });
    expect(snippet).not.toContain('放一放');
    expect(snippet).toContain('安静');
  });

  it('describeMotive 覆盖三种状态', () => {
    expect(describeMotive(null, true)).toContain('让位');
    expect(describeMotive(null, false)).toContain('无动机');
    const out = selectMotive({
      state: pool(), candidates: [openLoopCandidate()], userText: '嗯', herNegativeBeforeTurn: RESTING_BEFORE, now: T0,
    });
    expect(describeMotive(out.selected, false)).toContain('open_loop');
  });
});

// ════════════════════════════════════════════════════════════
// 5. 内容生成器
// ════════════════════════════════════════════════════════════

describe('内容生成器', () => {
  it('价值观立场：已知价值 → 具体句子；未知 → null', () => {
    expect(valueStanceMotive('honesty')).toContain('真实');
    expect(valueStanceMotive('connection')).toBeTruthy();
    expect(valueStanceMotive('not_a_value')).toBeNull();
  });

  it('内在状态：内容分档（v1.49 把门槛从不可达的 0.25 降到可达带内）', () => {
    expect(moodStateMotive(-0.4)).toContain('状态有点低');
    expect(moodStateMotive(-0.15)).toContain('有点闷');      // 轻档：0.25 那条旧门槛下这句从不出现
    expect(moodStateMotive(0.4)).toContain('心情不错');
    expect(moodStateMotive(0.4)).not.toContain('有点闷');
    // 门槛落在实测可达带内（见 scripts/play-state-motive.ts）：|v| < 0.10 仍不说
    expect(moodStateMotive(0.09)).toBeNull();
    expect(moodStateMotive(-0.09)).toBeNull();
    expect(moodStateMotive(NaN)).toBeNull();
  });

  it('记忆回响：有注入文本才生成，且带 memoryId', () => {
    const echo = memoryEchoMotive('他上次提到想去海边', 'ep_1');
    expect(echo?.kind).toBe('memory_echo');
    expect(echo?.content).toContain('海边');
    expect(echo?.source?.memoryId).toBe('ep_1');
    expect(memoryEchoMotive('   ')).toBeNull();
  });
});
