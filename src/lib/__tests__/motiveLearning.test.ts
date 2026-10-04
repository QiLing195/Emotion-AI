// ── motive L1 反馈学习 单元测试（v1.10）──
// 边界：这是 RSI-lite —— **只学权重，不改规则**。
// 必须锁死：①权重有界 [0.5,1.5] ②少样本不学 ③任何类型都不会被永久封杀
//           ④结果判定只看"他有没有接住这件事" ⑤权重真的影响竞选排序

import { describe, it, expect } from 'vitest';
import {
  createMotiveLearning,
  motiveWeight,
  classifyMotiveOutcome,
  learnFromOutcome,
  summarizeMotiveLearning,
  selectMotive,
  mergeCandidates,
  MOTIVE_LEARNING_MIN_SAMPLES,
  MOTIVE_WEIGHT_MIN,
  MOTIVE_WEIGHT_MAX,
  type MotiveCandidate,
} from '../motive';
import { INITIAL_EMOTION_STATE } from '../emotionEngine';
import type { EmotionState } from '../emotionTypes';

const T0 = 1_700_000_000_000;

function state(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

/** 连续记录 n 次结果 */
function record(
  kind: 'open_loop' | 'wish' | 'worry' | 'state' | 'curiosity',
  outcomes: Array<'landed' | 'missed' | 'unclear'>,
) {
  let learning = createMotiveLearning(T0);
  for (const o of outcomes) learning = learnFromOutcome(learning, kind, o, T0);
  return learning;
}

const candidate = (kind: MotiveCandidate['kind'], content: string): MotiveCandidate => ({ kind, content });

describe('motiveWeight — 权重有界且少样本不学', () => {
  it('无学习状态 → 中性 1.0', () => {
    expect(motiveWeight(undefined, 'open_loop')).toBe(1);
    expect(motiveWeight(createMotiveLearning(T0), 'open_loop')).toBe(1);
  });

  it('样本不足 → 保持中性（不被一两次偶然结果带偏）', () => {
    const learning = record('wish', ['missed', 'missed']);
    expect(MOTIVE_LEARNING_MIN_SAMPLES).toBeGreaterThan(2);
    expect(motiveWeight(learning, 'wish')).toBe(1);
  });

  it('回应率高 → 权重上浮；一直没被接住 → 权重下探但有下界', () => {
    expect(motiveWeight(record('open_loop', ['landed', 'landed', 'landed']), 'open_loop'))
      .toBeCloseTo(MOTIVE_WEIGHT_MAX, 5);
    expect(motiveWeight(record('wish', ['missed', 'missed', 'missed']), 'wish'))
      .toBeCloseTo(MOTIVE_WEIGHT_MIN, 5);
  });

  it('任何类型都不会被永久封杀（下界 0.5 > 0）', () => {
    const learning = record('state', Array(20).fill('missed'));
    expect(motiveWeight(learning, 'state')).toBe(MOTIVE_WEIGHT_MIN);
    expect(motiveWeight(learning, 'state')).toBeGreaterThan(0);
  });

  it('unclear 只记样本、不计入 landed（不冤枉也不奖励）', () => {
    const learning = record('curiosity', ['unclear', 'unclear', 'unclear', 'unclear']);
    expect(learning.stats.curiosity).toEqual({ voiced: 4, landed: 0 });
    // 4 次 unclear → landedRate 0 → 权重落到下界（她仍可以好奇，但更少）
    expect(motiveWeight(learning, 'curiosity')).toBeCloseTo(MOTIVE_WEIGHT_MIN, 5);
  });

  it('其他类型权重互不影响', () => {
    const learning = record('wish', ['missed', 'missed', 'missed']);
    expect(motiveWeight(learning, 'open_loop')).toBe(1);
  });
});

describe('classifyMotiveOutcome — 只看"他有没有接住这件事"', () => {
  it('他的话里出现同一话题 → landed', () => {
    expect(classifyMotiveOutcome('他之前提到「面试」，还没说后来怎么样了', '面试没过，有点烦'))
      .toBe('landed');
  });

  it('字面明显重合 → landed', () => {
    expect(classifyMotiveOutcome('我今天状态有点低，不想强撑着说话', '你今天状态不太好吗'))
      .toBe('landed');
  });

  it('完全转到别的话题 → missed', () => {
    expect(classifyMotiveOutcome('他之前提到「面试」，还没说后来怎么样了', '刚刚楼下有只猫好可爱'))
      .toBe('missed');
  });

  it('空输入 → unclear（不产生错误归因）', () => {
    expect(classifyMotiveOutcome('', '你好')).toBe('unclear');
    expect(classifyMotiveOutcome('想问他面试', '')).toBe('unclear');
  });
});

describe('学习结果真的影响竞选', () => {
  const pool = mergeCandidates([], [
    candidate('wish', '我想问他面试那件事到底怎么样了'),
    candidate('curiosity', '我想弄明白量子计算到底是怎么回事'),
  ], T0);

  it('权重高的类型更容易被选中', () => {
    const base = selectMotive({
      state: { pool }, candidates: [], userText: '嗯', herNegativeBeforeTurn: { emotion: 'neutral', intensity: 0 }, now: T0,
    });
    // 默认先验：两者接近 → 提升 curiosity 权重后它应当胜出
    const boosted = record('curiosity', ['landed', 'landed', 'landed']);
    const after = selectMotive({
      state: { pool }, candidates: [], userText: '嗯', herNegativeBeforeTurn: { emotion: 'neutral', intensity: 0 }, learning: boosted, now: T0,
    });
    expect(base.selected).not.toBeNull();
    // curiosity 权重 1.5 后，其有效紧迫度应超过未加权的 wish
    expect(after.selected?.kind).toBe('curiosity');
  });

  it('被压低的类型仍可能在他主动提起时被选中（下界保证不封杀）', () => {
    const suppressed = record('curiosity', ['missed', 'missed', 'missed']);
    const topics = mergeCandidates([], [candidate('curiosity', '我想知道量子计算到底是怎么回事')], T0);
    const out = selectMotive({
      state: { pool: topics },
      candidates: [],
      userText: '量子计算到底是什么，你给我讲讲',
      herNegativeBeforeTurn: { emotion: 'neutral', intensity: 0 },
      learning: suppressed,
      now: T0,
    });
    expect(out.selected?.kind).toBe('curiosity');
  });
});

describe('summarizeMotiveLearning — 可观测', () => {
  it('给出回应率与权重，按样本量排序', () => {
    let learning = record('wish', ['landed', 'missed', 'landed']);
    learning = learnFromOutcome(learning, 'open_loop', 'landed', T0);
    const rows = summarizeMotiveLearning(learning);
    const wish = rows.find(r => r.kind === 'wish')!;
    expect(wish.voiced).toBe(3);
    expect(wish.landed).toBe(2);
    expect(wish.landedRate).toBeCloseTo(0.67, 2);
    expect(wish.weight).toBeCloseTo(1.17, 2);
    expect(rows[0].kind).toBe('wish'); // 样本多的排前面
  });

  it('无账本 → 空数组（不报错）', () => {
    expect(summarizeMotiveLearning(undefined)).toEqual([]);
    expect(summarizeMotiveLearning(createMotiveLearning(T0))).toEqual([]);
  });
});
