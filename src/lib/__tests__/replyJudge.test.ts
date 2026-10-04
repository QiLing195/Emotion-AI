// ── 回复判官单元测试（v1.35）──
// 这个文件锁的是判官的**契约**，不是它的判断力（判断力只能靠 `scripts/calibrate-judge.ts` 校准）。
// 三条：
//   ① 解析"允许为空"：格式不对 → null，绝不猜一个赢家（拿噪声当适应度比没有适应度更糟）
//   ② prompt 必须带上**本项目自己的裁定**（否则判官按通用"有帮助"判，方向正好相反）
//   ③ 局面描述只描述局面，**不暗示答案**（在 prompt 里塞倾向会污染它）

import { describe, it, expect } from 'vitest';
import {
  buildPairwisePrompt, buildPointwisePrompt, parsePairwise, parsePointwise,
  describeSituation, JUDGE_AXES, PROJECT_RULINGS,
} from '../replyJudge';

const CASE = { userMessage: '我今天面试又挂了', situation: '他的情绪强度 0.80（sad）' };

describe('parsePairwise — 解不出来就 null', () => {
  it('认得 A / B / tie（大小写与多余文字都容忍）', () => {
    expect(parsePairwise('{"winner":"A","because":"x","loserFlaw":"y"}')?.winner).toBe('A');
    expect(parsePairwise('```json\n{"winner":"b","because":"x","loserFlaw":null}\n```')?.winner).toBe('B');
    expect(parsePairwise('好的：{"winner":"tie","because":"x","loserFlaw":null}')?.winner).toBe('tie');
  });

  it('tie 时 loserFlaw 为 null（不硬编一个毛病出来）', () => {
    const v = parsePairwise('{"winner":"tie","because":"整体相当","loserFlaw":null}');
    expect(v?.loserFlaw).toBeNull();
  });

  it('赢家字段缺失/非法 → null（不是"默认 A"）', () => {
    expect(parsePairwise('{"because":"x"}')).toBeNull();
    expect(parsePairwise('{"winner":"左边那条","because":"x"}')).toBeNull();
    expect(parsePairwise('{"winner":true}')).toBeNull();
    expect(parsePairwise('没有 JSON')).toBeNull();
    expect(parsePairwise('')).toBeNull();
  });
});

describe('parsePointwise — 五个轴必须齐全且合法', () => {
  const ok = JSON.stringify({ scores: { acknowledge: 5, presence: 4, restraint: 3, grounding: 5, fit: 4 }, because: 'x' });

  it('齐全 → 解出来', () => {
    const v = parsePointwise(ok);
    expect(v?.scores.acknowledge).toBe(5);
    expect(v?.scores.fit).toBe(4);
  });

  it('缺一个轴 / 越界 / 非数字 → null', () => {
    expect(parsePointwise(JSON.stringify({ scores: { acknowledge: 5, presence: 4, restraint: 3, grounding: 5 } }))).toBeNull();
    expect(parsePointwise(JSON.stringify({ scores: { acknowledge: 9, presence: 4, restraint: 3, grounding: 5, fit: 4 } }))).toBeNull();
    expect(parsePointwise(JSON.stringify({ scores: { acknowledge: 'good', presence: 4, restraint: 3, grounding: 5, fit: 4 } }))).toBeNull();
    expect(parsePointwise('{"scores":{}}')).toBeNull();
  });

  it('轴名与 JUDGE_AXES 一致（改轴就得改这里，防止两处漂移）', () => {
    const keys = Object.keys(JSON.parse(ok).scores);
    expect(keys.sort()).toEqual([...JUDGE_AXES].sort());
  });
});

describe('prompt 必须带上本项目自己的裁定', () => {
  it('成对 prompt 里有两条回复、有 tie 选项、有"长度不是越长越好"', () => {
    const p = buildPairwisePrompt(CASE, '回复甲', '回复乙');
    expect(p).toContain('回复甲');
    expect(p).toContain('回复乙');
    expect(p).toContain('tie');
    expect(p).toContain('长度不是越长越好');
  });

  it('把项目裁定写进去了（承认 / 少说陪着 / 别管我别追问 / 不许编造）', () => {
    const p = buildPairwisePrompt(CASE, 'a', 'b');
    for (const frag of ['先承认', '少说、陪着', '不要再追问', '不许说出记忆和对话里并不存在的事']) {
      expect(p, `缺少判据：${frag}`).toContain(frag);
    }
    expect(PROJECT_RULINGS.split('\n').length).toBeGreaterThanOrEqual(6);
  });

  it('逐条 prompt 列出了全部轴与 1~5 的量程', () => {
    const p = buildPointwisePrompt(CASE);
    for (const a of JUDGE_AXES) expect(p).toContain(a);
    expect(p).toContain('1~5');
  });

  it('prompt 里不含"哪条来自哪个配置"这类泄漏（盲测）', () => {
    const p = buildPairwisePrompt(CASE, 'a', 'b');
    expect(p).not.toMatch(/阈值|STRATEGY_TUNING|默认臂|实验臂/);
  });
});

describe('describeSituation — 只描述局面', () => {
  it('她自己已经沉在里面时明说；平静时也明说', () => {
    const sinking = describeSituation({ userAnalysis: { intensity: 0.8 }, herNegativeBeforeTurn: { emotion: 'sad', intensity: 0.2 } });
    expect(sinking).toContain('本来就已经沉在里面');
    const calm = describeSituation({ userAnalysis: { intensity: 0.8 }, herNegativeBeforeTurn: { emotion: 'sad', intensity: 0 } });
    expect(calm).toContain('平静');
    expect(calm).not.toContain('沉在里面');
  });

  it('带上他的强度与她的效价/唤醒（判官需要这些才知道该陪着还是该接话）', () => {
    const s = describeSituation({
      userAnalysis: { intensity: 0.6, expressedEmotion: 'sad' },
      emotionState: { taiji: { valence: -0.2, arousal: 0.3 } },
      consecutiveNegativeRounds: 3,
    });
    expect(s).toContain('0.60');
    expect(s).toContain('-0.20');
    expect(s).toContain('0.30');
    expect(s).toContain('连续 3 轮');
  });

  it('不暗示答案（不出现"应该/更好/建议"这类词）', () => {
    const s = describeSituation({ userAnalysis: { intensity: 0.8 } });
    expect(s).not.toMatch(/应该|更好|建议|不要/);
  });
});
