// ── memoryVisibility 独立单元测试 ──
// 覆盖：阶段层级 / 敏感度推断(关键词+标签+情绪强度) / 阶段门控 / 批量过滤 / 治理组合
import { describe, it, expect } from 'vitest';
import {
  STAGE_ORDER,
  stageRank,
  SENSITIVITY_MIN_STAGE,
  inferSensitivity,
  sensitivityOfEpisode,
  visibleAtStage,
  filterVisibleAtStage,
  resolveMemoryAccess,
} from '../memoryVisibility';

describe('memoryVisibility — 阶段层级', () => {
  it('阶段顺序由浅到深且 rank 单调', () => {
    expect(STAGE_ORDER).toEqual(['stranger', 'acquaintance', 'friend', 'crush', 'lover', 'partner']);
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      expect(stageRank(STAGE_ORDER[i])).toBeGreaterThan(stageRank(STAGE_ORDER[i - 1]));
    }
  });

  it('未知阶段按 acquaintance 保守处理', () => {
    expect(stageRank(undefined)).toBe(stageRank('acquaintance'));
    expect(stageRank('weird-stage')).toBe(stageRank('acquaintance'));
  });

  it('敏感度门槛递增：public ≤ familiar ≤ intimate ≤ secret', () => {
    expect(stageRank(SENSITIVITY_MIN_STAGE.public)).toBeLessThan(stageRank(SENSITIVITY_MIN_STAGE.familiar));
    expect(stageRank(SENSITIVITY_MIN_STAGE.familiar)).toBeLessThan(stageRank(SENSITIVITY_MIN_STAGE.intimate));
    expect(stageRank(SENSITIVITY_MIN_STAGE.intimate)).toBeLessThan(stageRank(SENSITIVITY_MIN_STAGE.secret));
  });
});

describe('inferSensitivity — 记忆敏感度推断', () => {
  it('爱意承诺 → secret', () => {
    expect(inferSensitivity({ text: '他说想和我结婚，一辈子在一起' })).toBe('secret');
    expect(inferSensitivity({ text: '我真的很爱你，不要离开我' })).toBe('secret');
    expect(inferSensitivity({ text: '随便聊聊', tags: ['承诺'] })).toBe('secret');
  });

  it('情绪低谷 / 脆弱暴露 → intimate', () => {
    expect(inferSensitivity({ text: '最近找不到工作，压力好大，晚上总失眠' })).toBe('intimate');
    expect(inferSensitivity({ text: '随便说说', tags: ['脆弱'] })).toBe('intimate');
    expect(inferSensitivity({ text: '今天很难过，一个人哭了很久' })).toBe('intimate');
  });

  it('个人偏好 / 兴趣经历 → familiar', () => {
    expect(inferSensitivity({ text: '我喜欢下雨天一个人看电影' })).toBe('familiar');
    expect(inferSensitivity({ text: '随便说说', tags: ['回忆'] })).toBe('familiar');
  });

  it('中性日常 → public', () => {
    expect(inferSensitivity({ text: '今天天气不错' })).toBe('public');
    expect(inferSensitivity({})).toBe('public');
  });

  it('情绪强度加成：只有很强（>0.5）才轻度升级，不单独升到 intimate', () => {
    expect(inferSensitivity({ text: '嗯', valenceDeltaAbs: 0.6 })).toBe('familiar');
    expect(inferSensitivity({ text: '嗯', valenceDeltaAbs: 0.3 })).toBe('public');
  });

  it('“喜欢/偏好”不被误判为爱意承诺（借用 episodic 的 亲密 标签只到 intimate）', () => {
    expect(inferSensitivity({ text: '我喜欢吃火锅，你喜欢吗？', tags: ['亲密'] })).not.toBe('secret');
    expect(inferSensitivity({ text: '我特别喜欢在雨天一个人看电影' })).not.toBe('secret');
  });

  it('sensitivityOfEpisode 组合摘要+叙事+标签+情绪', () => {
    const s = sensitivityOfEpisode({
      eventSummary: '他说想和我结婚',
      narrativeFragment: '',
      tags: ['亲密'],
      emotionalImpact: { valenceDelta: 0.6, arousalPeak: 0.8 },
    });
    expect(s).toBe('secret');
  });
});

describe('visibleAtStage — 阶段门控', () => {
  it('secret 记忆：friend 阶段不可见，lover 阶段可见', () => {
    const input = { text: '他说想和我结婚，一辈子在一起' };
    expect(visibleAtStage(input, 'friend').visible).toBe(false);
    expect(visibleAtStage(input, 'acquaintance').visible).toBe(false);
    expect(visibleAtStage(input, 'crush').visible).toBe(false);
    expect(visibleAtStage(input, 'lover').visible).toBe(true);
    expect(visibleAtStage(input, 'partner').visible).toBe(true);
  });

  it('intimate 记忆：crush 起可见', () => {
    const input = { text: '最近找不到工作，压力好大' };
    expect(visibleAtStage(input, 'friend').visible).toBe(false);
    expect(visibleAtStage(input, 'crush').visible).toBe(true);
  });

  it('familiar 记忆：friend 起可见', () => {
    const input = { text: '我喜欢下雨天一个人看电影' };
    expect(visibleAtStage(input, 'acquaintance').visible).toBe(false);
    expect(visibleAtStage(input, 'friend').visible).toBe(true);
  });

  it('public 记忆：任何阶段都可见', () => {
    for (const stage of STAGE_ORDER) {
      expect(visibleAtStage({ text: '今天天气不错' }, stage).visible).toBe(true);
    }
  });

  it('不可见时给出原因（含所需阶段，便于调试/可观测）', () => {
    const r = visibleAtStage({ text: '他说想和我结婚' }, 'acquaintance');
    expect(r.visible).toBe(false);
    expect(r.minStage).toBe('lover');
    expect(r.reason).toContain('lover');
  });
});

describe('filterVisibleAtStage — 批量过滤', () => {
  it('把阶段不可见的记忆剔除（零泄漏：连上下文都不注入）', () => {
    const items = [
      { id: 'a', text: '今天天气不错' },
      { id: 'b', text: '我喜欢下雨天看电影' },
      { id: 'c', text: '他说想和我结婚' },
    ];
    expect(filterVisibleAtStage(items, 'stranger', (i) => ({ text: i.text })).map((i) => i.id)).toEqual(['a']);
    expect(filterVisibleAtStage(items, 'friend', (i) => ({ text: i.text })).map((i) => i.id)).toEqual(['a', 'b']);
    expect(filterVisibleAtStage(items, 'lover', (i) => ({ text: i.text })).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveMemoryAccess — 可见性 × 治理 组合', () => {
  const allow = { proactive: true, assertive: true, context: true };

  it('阶段不够 → 全 false（连上下文都不给）', () => {
    const d = resolveMemoryAccess({ text: '他说想和我结婚' }, 'acquaintance', allow);
    expect(d.visible).toBe(false);
    expect([d.proactive, d.assertive, d.context]).toEqual([false, false, false]);
  });

  it('可见但治理未放行（如 ambiguous）→ 可作上下文、不可主动提起', () => {
    const d = resolveMemoryAccess({ text: '今天天气不错' }, 'friend', { proactive: false, assertive: false, context: true });
    expect(d.visible).toBe(true);
    expect(d.proactive).toBe(false);
    expect(d.context).toBe(true);
    expect(d.reason).toContain('治理层');
  });

  it('阶段足够 + 治理放行 → 全部可用', () => {
    const d = resolveMemoryAccess({ text: '今天天气不错' }, 'partner', allow);
    expect(d).toMatchObject({ visible: true, proactive: true, assertive: true, context: true });
  });
});
