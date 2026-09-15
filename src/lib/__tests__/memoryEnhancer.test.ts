// ── memoryEnhancer 独立单元测试 ──
// 覆盖：遗忘曲线(艾宾浩斯) / 文本与向量相似 / 重复对检测 / 合并 / 整合入口 /
//       治理联动(verified 慢遗忘) / episodic 召回对归档记忆的过滤
import { describe, it, expect } from 'vitest';
import {
  forgettingRetention,
  textSimilarity,
  memorySimilarity,
  findDuplicatePairs,
  mergePair,
  runConsolidation,
  DEFAULT_ENHANCER_OPTIONS,
} from '../memoryEnhancer';
import {
  createEpisodicMemoryStore,
  recallRelevantMemories,
  getSignificantEpisodes,
  type EpisodicMemory,
  type EpisodicMemoryStore,
} from '../episodicMemory';
import { MemoryLedger } from '../memoryGovernance';

function makeEpisode(partial: Partial<EpisodicMemory> & { id: string }): EpisodicMemory {
  return {
    timestamp: Date.now() - 3600_000,
    roundNumber: 1,
    eventSummary: '',
    emotionalImpact: { valenceBefore: 0, valenceAfter: 0.1, valenceDelta: 0.1, arousalPeak: 0.3, dominantEmotion: 'calm' },
    narrativeFragment: '',
    recallWeight: 0.5,
    tags: [],
    recallCount: 0,
    lastRecalledAt: null,
    ...partial,
  };
}

// ── 1. 遗忘曲线 ──
describe('forgettingRetention — 艾宾浩斯近似', () => {
  it('刚发生（未回想 0 天）→ 保留 1.0', () => {
    const ep = makeEpisode({ id: 'e0', timestamp: Date.now(), recallCount: 0 });
    expect(forgettingRetention(ep, ep.timestamp)).toBe(1);
  });

  it('未回想达到半衰期 → 保留约 0.5', () => {
    const now = Date.now();
    const ep = makeEpisode({ id: 'e1', timestamp: now, recallCount: 0 });
    const retention = forgettingRetention(ep, now + DEFAULT_ENHANCER_OPTIONS.halfLifeDays * 86400_000);
    expect(retention).toBeCloseTo(0.5, 3);
  });

  it('回想次数越多 → 忘得越慢（间隔重复效应）', () => {
    const now = Date.now();
    const seldom = forgettingRetention(makeEpisode({ id: 'a', timestamp: now - 30 * 86400_000, recallCount: 0 }), now);
    const often = forgettingRetention(makeEpisode({ id: 'b', timestamp: now - 30 * 86400_000, recallCount: 6 }), now);
    expect(often).toBeGreaterThan(seldom);
  });

  it('verified 记忆比未核实的忘得慢得多', () => {
    const now = Date.now();
    const ep = makeEpisode({ id: 'c', timestamp: now - 60 * 86400_000, recallCount: 2 });
    const plain = forgettingRetention(ep, now, DEFAULT_ENHANCER_OPTIONS, false);
    const verified = forgettingRetention(ep, now, DEFAULT_ENHANCER_OPTIONS, true);
    expect(verified).toBeGreaterThan(plain);
    expect(verified).toBeGreaterThan(0.5);
  });
});

// ── 2. 相似度 ──
describe('textSimilarity / memorySimilarity', () => {
  it('相同文本 = 1', () => {
    expect(textSimilarity('我想去杭州玩', '我想去杭州玩')).toBe(1);
  });

  it('完全不同主题 ≈ 低分', () => {
    expect(textSimilarity('我想去杭州旅行', '猫粮打折了')).toBeLessThan(0.3);
  });

  it('近似重复（复述原话±标点/语气词）远高于无关文本；同义改写靠 embedding 路径', () => {
    const near = textSimilarity('面试又失败了，心情很低落', '面试又失败了心情很低落。');
    const paraphrase = textSimilarity('面试又失败了，心情很低落', '最近面试没通过，特别难过');
    const unrelated = textSimilarity('面试又失败了，心情很低落', '火锅很好吃下次再去');
    expect(near).toBeGreaterThan(0.7);   // 文本层：只处理近重复（embedding 处理同义改写）
    expect(near).toBeGreaterThan(paraphrase);
    expect(paraphrase).toBeGreaterThan(unrelated);
  });

  it('双方都有 embedding 时融合向量相似，缺失时回落文本', () => {
    const a = makeEpisode({ id: 'ea', eventSummary: '喜欢下雨天看电影', embedding: [1, 0, 0] });
    const b = makeEpisode({ id: 'eb', eventSummary: '喜欢雨天看电影', embedding: [1, 0.1, 0] });
    const c = makeEpisode({ id: 'ec', eventSummary: '喜欢吃火锅', embedding: [0, 0, 1] });
    expect(memorySimilarity(a, b)).toBeGreaterThan(memorySimilarity(a, c));
  });
});

// ── 3. 重复对检测 ──
describe('findDuplicatePairs — 重复事件检测', () => {
  it('同一件事记了两条（间隔>1min）→ 检出', () => {
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'x1', timestamp: Date.now() - 3600_000, eventSummary: '用户说喜欢雨天一个人看电影', tags: ['回忆'], recallCount: 1 }),
      makeEpisode({ id: 'x2', timestamp: Date.now() - 120_000, eventSummary: '用户说喜欢在雨天一个人看电影', tags: ['回忆'] }),
    );
    const pairs = findDuplicatePairs(store);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it('不同事件（情绪不同且无共同标签）→ 不误检', () => {
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'y1', timestamp: Date.now() - 3600_000, eventSummary: '找到新工作了，开心', emotionalImpact: { valenceBefore: 0, valenceAfter: 0.5, valenceDelta: 0.5, arousalPeak: 0.5, dominantEmotion: 'joy' }, tags: ['温暖'] }),
      makeEpisode({ id: 'y2', timestamp: Date.now() - 120_000, eventSummary: '和同事吵架了，很生气', emotionalImpact: { valenceBefore: 0, valenceAfter: -0.4, valenceDelta: -0.4, arousalPeak: 0.6, dominantEmotion: 'anger' }, tags: ['冲突'] }),
    );
    expect(findDuplicatePairs(store)).toHaveLength(0);
  });

  it('已归档记忆不参与检测', () => {
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'z1', timestamp: Date.now() - 3600_000, eventSummary: '同一条记忆', archived: true }),
      makeEpisode({ id: 'z2', timestamp: Date.now() - 120_000, eventSummary: '同一条记忆' }),
    );
    expect(findDuplicatePairs(store)).toHaveLength(0);
  });
});

// ── 4. 合并 ──
describe('mergePair — 副本合并', () => {
  it('高回想/高权重的作为主条目，吸收计数与标签，次条目归档', () => {
    const store = createEpisodicMemoryStore();
    const main = makeEpisode({ id: 'm', eventSummary: '想去杭州定居', tags: ['城市'], recallCount: 4, recallWeight: 0.9 });
    const dup = makeEpisode({ id: 'd', eventSummary: '想搬去杭州定居', tags: ['城市', '未来'], recallCount: 1, recallWeight: 0.7 });
    const { kept, archived } = mergePair(store, main, dup);
    expect(kept.id).toBe('m');
    expect(kept.recallCount).toBe(5);
    expect(kept.tags).toContain('未来');
    expect(archived.archived).toBe(true);
    expect(archived.mergedInto).toBe('m');
  });
});

// ── 5. 整合入口 ──
describe('runConsolidation — 整合入口', () => {
  it('空 store 安全返回', () => {
    const r = runConsolidation(createEpisodicMemoryStore());
    expect(r.mergedPairs).toBe(0);
    expect(r.decayedCount).toBe(0);
  });

  it('老而无回想记忆权重下降；新记忆基本不动', () => {
    const now = Date.now();
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'old', timestamp: now - 90 * 86400_000, recallCount: 0, recallWeight: 0.8 }),
      makeEpisode({ id: 'new', timestamp: now - 60_000, recallCount: 0, recallWeight: 0.8 }),
    );
    const r = runConsolidation(store, null, DEFAULT_ENHANCER_OPTIONS, now);
    const old = store.episodes.find(e => e.id === 'old')!;
    const fresh = store.episodes.find(e => e.id === 'new')!;
    expect(r.decayedCount).toBeGreaterThan(0);
    expect(old.recallWeight).toBeLessThan(0.5);
    expect(fresh.recallWeight).toBeGreaterThan(0.7);
  });

  it('相似副本被合并归档，report 给出明细', () => {
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'p1', timestamp: Date.now() - 3600_000, eventSummary: '用户喜欢雨天一个人看电影', tags: ['回忆'], recallWeight: 0.8 }),
      makeEpisode({ id: 'p2', timestamp: Date.now() - 120_000, eventSummary: '用户喜欢在雨天一个人看电影', tags: ['回忆'] }),
      makeEpisode({ id: 'p3', timestamp: Date.now() - 60_000, eventSummary: '完全无关的火锅话题', tags: ['美食'], recallWeight: 0.6 }),
    );
    const r = runConsolidation(store);
    expect(r.mergedPairs).toBe(1);
    const archived = store.episodes.filter(e => e.archived);
    expect(archived.length).toBe(1);
    expect(store.episodes.filter(e => !e.archived).length).toBe(2);
  });

  it('verified 记忆（治理账本确认）衰减显著慢于未核实', () => {
    const now = Date.now();
    const ledger = new MemoryLedger();
    const store = createEpisodicMemoryStore();
    const v = makeEpisode({ id: 'v', timestamp: now - 90 * 86400_000, recallCount: 0, recallWeight: 0.8 });
    const p = makeEpisode({ id: 'p', timestamp: now - 90 * 86400_000, recallCount: 0, recallWeight: 0.8 });
    store.episodes.push(v, p);
    // 治理账本：v 已核实
    ledger.recordFromDecision(
      { refType: 'episodic', refId: 'v', surfaceText: 'verified memory' },
      { status: 'supported', score: 0.9, margin: 0.4, reason: 'ok' },
      { coverage: 1 },
    );
    ledger.verify('episodic_v', 'reviewer:test');
    runConsolidation(store, ledger, DEFAULT_ENHANCER_OPTIONS, now);
    expect(v.recallWeight).toBeGreaterThan(p.recallWeight);
  });
});

// ── 6. 与 episodic 召回联动 ──
describe('归档记忆不参与召回/重要查询', () => {
  it('recallRelevantMemories 与 getSignificantEpisodes 跳过 archived', () => {
    const store = createEpisodicMemoryStore();
    store.episodes.push(
      makeEpisode({ id: 'active1', eventSummary: '喜欢火锅', tags: ['温暖'], recallWeight: 0.9, emotionalImpact: { valenceBefore: 0, valenceAfter: 0.3, valenceDelta: 0.3, arousalPeak: 0.3, dominantEmotion: 'joy' } }),
      makeEpisode({ id: 'ghost', eventSummary: '喜欢火锅的副本', tags: ['温暖'], recallWeight: 0.95, archived: true, emotionalImpact: { valenceBefore: 0, valenceAfter: 0.3, valenceDelta: 0.3, arousalPeak: 0.3, dominantEmotion: 'joy' } }),
    );
    const recalled = recallRelevantMemories(store, { name: 'joy', intensity: 0.5 }, 5);
    expect(recalled.some(e => e.id === 'ghost')).toBe(false);
    const sig = getSignificantEpisodes(store, 5);
    expect(sig.some(e => e.id === 'ghost')).toBe(false);
  });
});
