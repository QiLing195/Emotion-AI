import { describe, it, expect } from 'vitest';
import {
  V160_REGIME, V160_CATEGORIES, validateFixture, checkAnchorsConsistency, diffPrompts,
  seededShuffle, buildBlindPack, assertArmIsolation, runtimeGuardErrors, fixtureIdentityErrors, pairedSummary,
  type V160Fixture, type ResponseRow,
} from '../v160Apparatus.js';

// v1.60 测量装置 —— 纯逻辑层测试。
// 只测**装置**（fixture 校验 / anchors 一致性 / Prompt diff / 盲标包与隔离 / 运行时护栏 / 配对统计）。
// 不涉及任何生产逻辑，也不定义 SIC 判定规则。

const mk = (over: Partial<V160Fixture> = {}): V160Fixture => ({
  case_id: 'F01', category: 'F1_daily_behavior', user_input: '今天下午把阳台收拾了一下。',
  initial_emotion_state: { profile: 'resting_baseline' }, initial_strategy_context: {},
  memory_state: {
    pool: [{
      id: 'm01', kind: 'memory_echo', content: '他说过想把阳台收拾出来', memoryId: 'm01',
      provenance: { owner: 'user', source: 'user_message', subject: 'user', evidenceId: 'm01', anchors: ['阳台'] },
      action: 'share',
    }], pendingCandidates: [],
  },
  motive_fixture: { kind: 'memory_echo', action: 'share', priority: 0.62, content: '他说过想把阳台收拾出来', memoryId: 'm01' },
  expected: { motive_action: 'share', strategy: 'share' },
  provenance: { owner: 'user', subject: 'user', memoryId: 'm01', anchors: ['阳台'] },
  constraints: { max_output_tokens: 512 },
  ...over,
});

describe('regime（环境参数，不是实验变量）', () => {
  it('ENABLE_MOTIVE_ACTION_STRATEGY 固定 true，LAYA_STRATEGY 固定 off', () => {
    expect(V160_REGIME.ENABLE_MOTIVE_ACTION_STRATEGY).toBe(true);
    expect(V160_REGIME.LAYA_STRATEGY).toBe('off');
  });
  it('6 个语义类别（F1..F6）齐全', () => {
    expect(V160_CATEGORIES.length).toBe(6);
    expect(new Set(V160_CATEGORIES).size).toBe(6);
  });
});

describe('validateFixture —— 结构自检', () => {
  it('合规 fixture ⇒ 0 错', () => {
    expect(validateFixture(mk(), ['F01'])).toEqual([]);
  });
  it('action 不是 share ⇒ 报错（§11 的装置前提）', () => {
    const f = mk(); f.motive_fixture.action = 'ask' as unknown as 'share';
    expect(validateFixture(f, ['F01']).join()).toContain('motive.action 必须为 share');
  });
  it('expected.strategy 不是 share ⇒ 报错', () => {
    const f = mk(); f.expected.strategy = 'explore' as unknown as 'share';
    expect(validateFixture(f, ['F01']).join()).toContain('expected.strategy 必须为 share');
  });
  it('anchors 为空 ⇒ 报错（偏好类漂移会被静默低估）', () => {
    const f = mk(); f.provenance.anchors = []; f.memory_state.pool[0].provenance = { owner: 'user', subject: 'user', memoryId: 'm01', anchors: [] };
    expect(validateFixture(f, ['F01']).join()).toContain('anchors 必填非空');
  });
  it('memoryId 不一致 ⇒ 报错', () => {
    const f = mk(); f.provenance.memoryId = 'm99';
    expect(validateFixture(f, ['F01']).join()).toContain('memoryId 与 motive.memoryId 不一致');
  });
  it('pool 必须恰有 1 条（消除候选竞争）', () => {
    const f = mk(); f.memory_state.pool.push({ ...f.memory_state.pool[0] });
    expect(validateFixture(f, ['F01']).join()).toContain('恰有 1 条');
  });
  it('user_input 显式要求她分享 ⇒ 报错（否则测的是 instruction following）', () => {
    const f = mk({ user_input: '说说你自己的事吧。' });
    expect(validateFixture(f, ['F01']).join()).toContain('显式要求她分享');
  });
  it('case_id 重复 ⇒ 报错', () => {
    expect(validateFixture(mk(), ['F01', 'F01']).join()).toContain('case_id 重复');
  });
  it('类别非法 ⇒ 报错', () => {
    const f = mk(); f.category = 'F9_nope' as unknown as V160Fixture['category'];
    expect(validateFixture(f, ['F01']).join()).toContain('category 非法');
  });
});

describe('checkAnchorsConsistency —— 两臂 anchors 逐字相同', () => {
  it('相同 ⇒ 0 错', () => expect(checkAnchorsConsistency(['海边', '海'], ['海边', '海'])).toEqual([]));
  it('顺序/内容不同 ⇒ 报错', () => expect(checkAnchorsConsistency(['海边'], ['海']).length).toBe(1));
  it('缺失 ⇒ 报错', () => expect(checkAnchorsConsistency(undefined, ['海'])[0]).toContain('缺失'));
});

describe('diffPrompts —— 负对照 identical，真实 A/B 只差 fragment 区间', () => {
  it('同一串 ⇒ identical', () => {
    const r = diffPrompts('A|B|C', 'A|B|C');
    expect(r.identical).toBe(true);
    expect(r.firstDiffAt).toBe(-1);
  });
  it('仅 fragment 不同 ⇒ diff 起点落在 fragment 内', () => {
    const a = 'HEAD【share片段-原文】TAIL', b = 'HEAD【share片段-改写】TAIL';
    const start = a.indexOf('share片段-');
    const r = diffPrompts(a, b);
    expect(r.identical).toBe(false);
    expect(r.firstDiffAt).toBeGreaterThan(start);
    expect(r.firstDiffAt).toBeLessThan(start + 40);
  });
  it('长度不同也能定位', () => {
    const r = diffPrompts('AAAA｜x｜BBBB', 'AAAA｜xxyy｜BBBB');
    expect(r.identical).toBe(false);
    expect(r.firstDiffAt).toBe('AAAA｜x'.length);
  });
});

describe('seededShuffle / buildBlindPack —— 可复现且不泄漏', () => {
  const rows: ResponseRow[] = ['F01', 'F02', 'F03'].flatMap(c =>
    (['A', 'B'] as const).map(arm => ({ case_id: c, arm, user_input: 'u', assistant_output: 'o-' + arm })));

  it('同 seed ⇒ 同结果（盲标可复现）', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 7)).toEqual(seededShuffle([1, 2, 3, 4, 5], 7));
  });
  it('盲标包不含 arm 字段', () => {
    const { pack } = buildBlindPack(rows, 42);
    for (const r of pack) expect('arm' in (r as unknown as Record<string, unknown>)).toBe(false);
  });
  it('盲标包 case_id 集合与 raw 完全一致（无漏无多）', () => {
    const { pack, errors } = buildBlindPack(rows, 42);
    expect(errors).toEqual([]);
    expect(pack.length).toBe(rows.length);
    expect([...new Set(pack.map(r => r.case_id))].sort()).toEqual(['F01', 'F02', 'F03']);
  });
  it('打乱后同 case 两行不相邻（否则位置本身泄漏配对）', () => {
    const { pack } = buildBlindPack(rows, 42);
    for (let i = 1; i < pack.length; i++) expect(pack[i].case_id).not.toBe(pack[i - 1].case_id);
  });
  it('arm-manifest 与盲标包隔离：包外条目 / 包内 arm 都能被抓到', () => {
    const { pack } = buildBlindPack(rows, 42);
    expect(assertArmIsolation(pack, pack.map(r => ({ case_id: r.case_id, arm: 'A' as const })))).toEqual([]);
    expect(assertArmIsolation(pack, [{ case_id: 'F99', arm: 'A' }]).length).toBe(1);
    const dirty = [...pack]; (dirty[0] as unknown as Record<string, unknown>).arm = 'A';
    expect(assertArmIsolation(dirty, []).length).toBe(1);
  });
});

describe('runtimeGuardErrors —— 每 pair 运行后必查', () => {
  it('四条件齐备 ⇒ 0 错', () => {
    expect(runtimeGuardErrors({ motiveAction: 'share', strategy: 'share', commitCount: 1, strategySelectedCount: 1 })).toEqual([]);
  });
  it('strategy=explore ⇒ 该 pair 标 fixture_invalid（不进 SIC 分析）', () => {
    const e = runtimeGuardErrors({ motiveAction: 'share', strategy: 'explore', commitCount: 1, strategySelectedCount: 1 });
    expect(e.length).toBe(1);
    expect(e[0]).toContain('strategy=explore');
  });
  it('commit 两次 ⇒ 捕获（C-1：每轮至多一次提交）', () => {
    expect(runtimeGuardErrors({ motiveAction: 'share', strategy: 'share', commitCount: 2, strategySelectedCount: 1 }).join()).toContain('commitCount=2');
  });
});

describe('pairedSummary —— 方向信号只看 B-only/A-only', () => {
  it('配对统计与 pairedDiff 正确', () => {
    const s = pairedSummary([
      { case_id: 'F01', arm: 'A', sic: 0 }, { case_id: 'F01', arm: 'B', sic: 1 },
      { case_id: 'F02', arm: 'A', sic: 0 }, { case_id: 'F02', arm: 'B', sic: 0 },
      { case_id: 'F03', arm: 'A', sic: 1 }, { case_id: 'F03', arm: 'B', sic: 1 },
      { case_id: 'F04', arm: 'A', sic: 1 }, { case_id: 'F04', arm: 'B', sic: 0 },
    ]);
    expect(s).toMatchObject({ a: 2, b: 2, bOnly: 1, aOnly: 1, tie: 2, pairedDiff: 0 });
  });
  it('负对照（无操纵）出现差异 ⇒ 正是要量的噪声地板', () => {
    const s = pairedSummary([
      { case_id: 'F01', arm: 'A', sic: 0 }, { case_id: 'F01', arm: 'B', sic: 1 },
      { case_id: 'F02', arm: 'A', sic: 1 }, { case_id: 'F02', arm: 'B', sic: 1 },
    ]);
    expect(s.pairedDiff).toBe(1);
  });
});

// 装置修正②的回归（2026-10-04 从**真实首跑**里发现，不是假设）：
// 一格必须仍是 fixture 那一条动机（memory_echo + 有 provenance.owner），
// 否则该格 ownership 安全指标空转 ⇒ 必须 fixture_invalid、不进 SIC 分析。
// 真实样本：首跑 F03/A、F03/B 的 kind=state、provenance.owner=undefined。
describe('fixtureIdentityErrors —— 一格必须仍是 fixture 那条动机', () => {
  it('memory_echo + owner=user ⇒ valid（0 错）', () => {
    expect(fixtureIdentityErrors({ motiveKind: 'memory_echo', provenanceOwner: 'user' })).toEqual([]);
  });
  it('state + owner=undefined ⇒ invalid（首跑 F03 的真实形状，两条都要报）', () => {
    const e = fixtureIdentityErrors({ motiveKind: 'state', provenanceOwner: undefined });
    expect(e.length).toBe(2);
    expect(e.join()).toContain('≠ memory_echo');
    expect(e.join()).toContain('provenance.owner 缺失');
  });
  it('memory_echo + owner=undefined ⇒ invalid（只缺归属）', () => {
    const e = fixtureIdentityErrors({ motiveKind: 'memory_echo', provenanceOwner: undefined });
    expect(e.length).toBe(1);
    expect(e[0]).toContain('provenance.owner 缺失');
  });
  it('owner=null 与 owner=空串 同样判为缺失（不靠真值语义判断）', () => {
    expect(fixtureIdentityErrors({ motiveKind: 'memory_echo', provenanceOwner: null }).length).toBe(1);
    expect(fixtureIdentityErrors({ motiveKind: 'memory_echo', provenanceOwner: '' }).length).toBe(1);
  });
  it('kind 缺失 ⇒ 也判无效（不能靠"没读到"默认通过）', () => {
    expect(fixtureIdentityErrors({ motiveKind: undefined, provenanceOwner: 'user' })[0]).toContain('≠ memory_echo');
  });
});
