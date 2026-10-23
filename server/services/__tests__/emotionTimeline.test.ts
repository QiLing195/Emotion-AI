import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  timelineEnabled,
  buildStateChangeNode,
  appendTimelineNode,
  readRecentNodes,
  buildCauseChain,
  classifyBranch,
  classifyOutcome,
  segmentOf,
  buildBranchNode,
  buildOutcomeNode,
  clearTimelineQuoteCache,
  quoteDigest,
  redactTimelineNode,
  TIMELINE_MAX_BYTES,
  type EmotionTimelineNode,
} from '../emotionTimeline.js';
import type { EmotionState } from '../../../src/lib/emotionTypes.js';
import { INITIAL_EMOTION_STATE } from '../../../src/lib/emotionTypes.js';

function freshState(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function stateWithSad(delta = 0.2): EmotionState {
  const s = freshState();
  // 直接抬 sad，制造"被激起"的负向偏离（不走 NLU）
  s.emotions.sad = Math.min(1, s.emotions.sad + delta);
  return s;
}

describe('开关（默认关，关着不碰磁盘）', () => {
  it('默认关；只有显式 true 才开', () => {
    expect(timelineEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(timelineEnabled({ ENABLE_EMOTION_TIMELINE: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(timelineEnabled({ ENABLE_EMOTION_TIMELINE: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('节点构建（事实层：数字直接取状态、引文只取他的话）', () => {
  it('负向他的话 ⇒ trigger=his_word_negative，引文来自他的原话', () => {
    const before = freshState();
    const after = stateWithSad(0.3);
    const node = buildStateChangeNode({
      ts: 1700000000000,
      round: 7,
      turnId: 'u-7',
      userText: '我今天被领导当众骂了一顿，特别难受。',
      hisEmotion: 'sad',
      hisIntensity: 0.8,
      before,
      after,
      relationshipAxes: { trust: 0.61, familiarity: 3.2 },
    });
    expect(node.kind).toBe('state_change');
    expect(node.trigger.source).toBe('his_word_negative');
    expect(node.trigger.quoted).toBe('我今天被领导当众骂了一顿');
    expect(node.trigger.hisEmotion).toBe('sad');
    expect(node.trigger.hisIntensity).toBe(0.8);
    expect(node.relationship?.trust).toBeCloseTo(0.61, 4);
    // before/after 是真实读数，不是占位
    expect(node.after.top.some(([k]) => k === 'sad')).toBe(true);
    expect(node.delta.valence).toBeCloseTo(node.after.valence - node.before.valence, 4);
  });

  it('正向他的话 ⇒ 不取引文（避免把好消息截成"原因"）', () => {
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'x', userText: '我升职了！', hisEmotion: 'joy',
      before: freshState(), after: freshState(),
    });
    expect(node.trigger.source).toBe('his_word_positive');
    expect(node.trigger.quoted).toBeNull();
  });

  it('缺少状态时给零帧而不是崩（观测层必须永不抛）', () => {
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'x', userText: '', hisEmotion: null, before: null, after: undefined,
    });
    expect(node.before.valence).toBe(0);
    expect(node.after.top).toEqual([]);
    expect(node.trigger.source).toBe('unknown');
  });

  it('低谷字段来自 lowPeriod 读数（turns/selfRecovery/phase）', () => {
    const after = stateWithSad(0.25);
    after.lowPeriod = {
      since: 1000, lastEvaluatedAt: 2000, peakDepth: 0.2, lastDepth: 0.15,
      lastDelta: -0.01, turns: 4, selfRecovery: 0.06,
    };
    const node = buildStateChangeNode({
      ts: 2, round: 2, turnId: 'x', userText: '', hisEmotion: null,
      before: freshState(), after,
    });
    expect(node.after.low.active).toBe(true);
    expect(node.after.low.turns).toBe(4);
    expect(node.after.low.selfRecovery).toBeCloseTo(0.06, 4);
  });
});

describe('写入 / 滚动 / 读回', () => {
  it('追加一个节点后能读回，字段完整', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'u-1', userText: '我很难受', hisEmotion: 'sad',
      before: freshState(), after: stateWithSad(0.2),
    });
    expect(appendTimelineNode(node, path)).toBe(true);
    const back = readRecentNodes(1, path);
    expect(back).toHaveLength(1);
    expect(back[0].turnId).toBe('u-1');
    const first = back[0];
    expect(first.kind).toBe('state_change');
    if (first.kind === 'state_change') expect(first.trigger.source).toBe('his_word_negative');
  });

  it('超过上限会滚动，且读回只读当前文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-rot-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    // 直接塞一个大文件触发滚动
    writeFileSync(path, 'x'.repeat(TIMELINE_MAX_BYTES + 10), 'utf8');
    const node = buildStateChangeNode({
      ts: 3, round: 3, turnId: 'u-3', userText: '', hisEmotion: null,
      before: null, after: null,
    });
    expect(appendTimelineNode(node, path)).toBe(true);
    const rotated = readFileSync(path, 'utf8');
    expect(rotated.split('\n').filter(Boolean)).toHaveLength(1);   // 新文件只有新节点
    const nodes = readRecentNodes(5, path);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].turnId).toBe('u-3');
  });

  it('读回按时间顺序，且 k 生效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-k-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    for (let i = 0; i < 5; i++) {
      appendTimelineNode(buildStateChangeNode({
        ts: i, round: i, turnId: `u-${i}`, userText: '', hisEmotion: null, before: null, after: null,
      }) as EmotionTimelineNode, path);
    }
    expect(readRecentNodes(2, path).map(n => n.turnId)).toEqual(['u-3', 'u-4']);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });
});

describe('Stage 2：原因链（origin 取窗口内最早那条负向 = 起因事件）', () => {
  function nodeAt(round: number, ts: number, hisEmotion: string, userText: string): EmotionTimelineNode {
    return buildStateChangeNode({
      ts, round, turnId: `u-${round}`, userText, hisEmotion,
      before: freshState(), after: freshState(),
    });
  }

  it('多条负向 ⇒ origin 是最早那条（事件），latest 是最后那条', () => {
    const nodes = [
      nodeAt(1, 100, 'neutral', '在吗'),
      nodeAt(2, 200, 'sad', '我今天被领导当众骂了一顿'),
      nodeAt(3, 300, 'sad', '心里堵得慌'),
      nodeAt(4, 400, 'joy', '我升职了'),
    ];
    const c = buildCauseChain(nodes);
    expect(c.kind).toBe('his_word');
    expect(c.quoted).toBe('我今天被领导当众骂了一顿');   // 起因 = 最早
    expect(c.round).toBe(2);
    expect(c.latestQuoted).toBe('心里堵得慌');            // 最近一条另存
    expect(c.chain).toHaveLength(2);                      // 正向不入链
  });

  it('sinceTs 过滤掉上一段低谷的节点（分支/低谷路径隔离的基础）', () => {
    const nodes = [
      nodeAt(2, 200, 'sad', '上一段低谷的旧事'),
      nodeAt(9, 900, 'sad', '这一段低谷的起因'),
      nodeAt(10, 1000, 'sad', '这一段更近的情绪句'),
    ];
    const c = buildCauseChain(nodes, { sinceTs: 500, lookbackNodes: 0 });
    expect(c.quoted).toBe('这一段低谷的起因');
    expect(c.round).toBe(9);
    expect(c.chain).toHaveLength(2);
  });

  it('没有负向节点 ⇒ unknown（不编原因）', () => {
    const c = buildCauseChain([nodeAt(1, 100, 'joy', '我升职了'), nodeAt(2, 200, 'neutral', '在吗')]);
    expect(c.kind).toBe('unknown');
    expect(c.quoted).toBeNull();
  });

  it('maxChain 生效（链长有上限）', () => {
    const nodes = [1, 2, 3, 4, 5].map(i => nodeAt(i, i * 100, 'sad', `第${i}件难过的事`));
    expect(buildCauseChain(nodes, { maxChain: 2 }).chain).toHaveLength(2);
  });
});

describe('Stage 3：分支枚举 + 结果 + 路径隔离', () => {
  it('分支分类：他没负面时——说了原因 > 只说了状态 > 没说', () => {
    const withCause = classifyBranch({
      usedVoiceSnippet: true, causeQuoted: '我今天被领导当众骂了一顿',
      reply: '我这两天有点沉，今天还被领导当众骂了一顿，所以笑不太出来。', hisEmotion: 'joy',
    });
    expect(withCause.chosen).toBe('voice_with_cause');
    expect(withCause.candidates).toEqual(['voice_with_cause', 'voice', 'silence']);

    const stateOnly = classifyBranch({
      usedVoiceSnippet: true, causeQuoted: null,
      reply: '我这两天有点沉，所以接得没那么热。', hisEmotion: 'neutral',
    });
    expect(stateOnly.chosen).toBe('voice');

    const silent = classifyBranch({
      usedVoiceSnippet: true, causeQuoted: null,
      reply: '真好。恭喜你——这事儿你等了一阵子了。', hisEmotion: 'joy',
    });
    expect(silent.chosen).toBe('silence');
  });

  it('他负面时：她说安慰话 = comfort，否则 = defer（让位）', () => {
    expect(classifyBranch({
      usedVoiceSnippet: false, causeQuoted: null,
      reply: '我在这儿，你慢慢说，别硬撑。', hisEmotion: 'sad',
    }).chosen).toBe('comfort');
    expect(classifyBranch({
      usedVoiceSnippet: false, causeQuoted: null,
      reply: '堵得慌……是压着什么东西说不出来吗？', hisEmotion: 'sad',
    }).chosen).toBe('defer');
  });

  it('结果分类：共享实词 / 他反问 = landed；无关 = missed；空 = unclear', () => {
    expect(classifyOutcome('我这两天有点沉，被领导骂了一顿', '那你现在还难受吗？')).toBe('landed');
    expect(classifyOutcome('我这两天有点沉', '今天天气不错，我出去走了走。')).toBe('missed');
    expect(classifyOutcome('我这两天有点沉', '')).toBe('unclear');
  });

  it('路径隔离：一段低谷一个 segment；没有低谷 = seg_none', () => {
    expect(segmentOf(true, 1234)).toBe('seg_1234');
    expect(segmentOf(false, null)).toBe('seg_none');
    expect(segmentOf(true, null)).toBe('seg_none');
    // 不同低谷段 → 不同 segment（分支历史不互相污染）
    expect(segmentOf(true, 111)).not.toBe(segmentOf(true, 222));
  });

  it('分支/结果节点可写入并读回（含 segment 与 refRound）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-br-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const br = buildBranchNode({
      ts: 10, round: 5, turnId: 'u-5', lowActive: true, lowSince: 111, lowTurns: 3,
      hisEmotion: 'joy', usedVoiceSnippet: true, causeQuoted: null,
      reply: '我这两天有点沉。恭喜你。',
    });
    const out = buildOutcomeNode({
      ts: 11, round: 6, turnId: 'u-6', segment: br.segment, refRound: 5,
      herReply: br.branch.replyExcerpt, hisNextText: '你现在还沉吗？', hisEmotion: 'neutral', herDeltaValence: -0.02,
    });
    expect(appendTimelineNode(br, path)).toBe(true);
    expect(appendTimelineNode(out, path)).toBe(true);
    const back = readRecentNodes(2, path);
    expect(back[0].kind).toBe('branch');
    expect(back[1].kind).toBe('outcome');
    if (back[0].kind === 'branch') expect(back[0].segment).toBe('seg_111');
    if (back[1].kind === 'outcome') {
      expect(back[1].refRound).toBe(5);
      expect(back[1].outcome.hisReaction).toBe('landed');
    }
  });
});

/**
 * v2.23：时间线落盘脱敏 —— 用户原话默认只存 hash/长度，原文仅在**同进程内存缓存**里；
 * 进程重启后读回拿不到原文 ⇒ 原因链自动降级（只说状态、不引原话）。
 * TIMELINE_STORE_QUOTE=true 才恢复"原话落盘"的旧行为。
 */
describe('v2.23 落盘脱敏（默认不把他的话写进文件）', () => {
  it('默认：文件里没有原话，只有 quotedHash/quotedLength；同进程读回能还原', () => {
    clearTimelineQuoteCache();
    const dir = mkdtempSync(join(tmpdir(), 'tl-mask-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const node = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'u-mask-1', userText: '我今天被领导当众骂了一顿', hisEmotion: 'sad',
      before: freshState(), after: stateWithSad(0.3),
    });
    expect(appendTimelineNode(node, path)).toBe(true);

    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('我今天被领导当众骂了一顿');
    const stored = JSON.parse(raw.trim().split('\n')[0]);
    expect(stored.trigger.quoted).toBeNull();
    expect(stored.trigger.quotedHash).toMatch(/^[a-f0-9]{16}$/);
    expect(stored.trigger.quotedLength).toBeGreaterThan(0);

    // 同进程：按 hash 从内存缓存还原，原因链行为不变
    const back = readRecentNodes(1, path);
    const first = back[0];
    if (first.kind !== 'state_change') throw new Error('unexpected kind');
    expect(first.trigger.quoted).toBe('我今天被领导当众骂了一顿');
    rmSync(dir, { recursive: true, force: true });
  });

  it('清缓存（模拟重启）：读回没有原话，只有 hash/长度（原因链降级，不编）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-mask2-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const node = buildStateChangeNode({
      ts: 2, round: 2, turnId: 'u-mask-2', userText: '我今天被领导当众骂了一顿', hisEmotion: 'sad',
      before: freshState(), after: stateWithSad(0.3),
    });
    appendTimelineNode(node, path);
    clearTimelineQuoteCache();

    const back = readRecentNodes(1, path);
    const first = back[0];
    if (first.kind !== 'state_change') throw new Error('unexpected kind');
    expect(first.trigger.quoted).toBeNull();
    expect(first.trigger.quotedHash).toMatch(/^[a-f0-9]{16}$/);
    expect(first.trigger.quotedLength).toBeGreaterThan(0);

    // 没有原文就不出 "because you said" 的原因链
    const cause = buildCauseChain(back);
    expect(cause.quoted).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('TIMELINE_STORE_QUOTE=true 才把原话写进文件（旧行为可回退）', () => {
    const prev = process.env.TIMELINE_STORE_QUOTE;
    process.env.TIMELINE_STORE_QUOTE = 'true';
    const dir = mkdtempSync(join(tmpdir(), 'tl-mask3-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    try {
      const node = buildStateChangeNode({
        ts: 3, round: 3, turnId: 'u-mask-3', userText: '我今天被领导当众骂了一顿', hisEmotion: 'sad',
        before: freshState(), after: stateWithSad(0.3),
      });
      appendTimelineNode(node, path);
      const raw = readFileSync(path, 'utf8');
      expect(raw).toContain('我今天被领导当众骂了一顿');
      const stored = JSON.parse(raw.trim().split('\n')[0]);
      expect(stored.trigger.quoted).toBe('我今天被领导当众骂了一顿');
      expect(stored.trigger.quotedHash ?? null).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.TIMELINE_STORE_QUOTE;
      else process.env.TIMELINE_STORE_QUOTE = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('分支节点 branch.causeQuoted 同样脱敏；同进程读回可还原', () => {
    clearTimelineQuoteCache();
    const dir = mkdtempSync(join(tmpdir(), 'tl-branch-mask-'));
    const path = join(dir, 'emotion_timeline.jsonl');
    const node = buildBranchNode({
      ts: 4, round: 4, turnId: 'u-br-1', lowActive: true, lowSince: 10, lowTurns: 2,
      hisEmotion: 'joy', usedVoiceSnippet: true,
      causeQuoted: '我今天被领导当众骂了一顿',
      reply: '我这两天有点沉，今天还被领导当众骂了一顿，所以笑不太出来。',
    });
    appendTimelineNode(node, path);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('我今天被领导当众骂了一顿');
    const stored = JSON.parse(raw.trim().split('\n')[0]);
    expect(stored.branch.causeQuoted).toBeNull();
    expect(stored.branch.causeQuotedHash).toMatch(/^[a-f0-9]{16}$/);

    const back = readRecentNodes(1, path)[0];
    if (back.kind !== 'branch') throw new Error('unexpected kind');
    expect(back.branch.causeQuoted).toBe('我今天被领导当众骂了一顿');
    rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * v2.24：历史清理脚本用的强制脱敏函数（不看 TIMELINE_STORE_QUOTE；幂等）。
 */
describe('v2.24 历史节点强制脱敏（redactTimelineNode）', () => {
  it('把已落盘的 quoted/causeQuoted 换成 hash/长度，且与 quoteDigest 一致、可幂等', () => {
    const raw = '我今天被领导当众骂了一顿';
    const stateNode = buildStateChangeNode({
      ts: 1, round: 1, turnId: 'u-redact-1', userText: raw, hisEmotion: 'sad',
      before: freshState(), after: stateWithSad(0.3),
    });
    // build 阶段仍是原文（v2.23 只在写盘时脱敏）
    expect(stateNode.trigger.quoted).toBe(raw);

    const r1 = redactTimelineNode(stateNode);
    expect(r1.changed).toBe(true);
    if (r1.node.kind !== 'state_change') throw new Error('unexpected kind');
    expect(r1.node.trigger.quoted).toBeNull();
    expect(r1.node.trigger.quotedHash).toBe(quoteDigest(raw));
    expect(r1.node.trigger.quotedLength).toBe(Array.from(raw).length);

    // 幂等：再跑一次不改
    const r2 = redactTimelineNode(r1.node);
    expect(r2.changed).toBe(false);
    if (r2.node.kind !== 'state_change') throw new Error('unexpected kind');
    expect(r2.node.trigger.quotedHash).toBe(quoteDigest(raw));
  });

  it('branch.causeQuoted 同样强制脱敏', () => {
    const raw = '我今天被领导当众骂了一顿';
    const branchNode = buildBranchNode({
      ts: 2, round: 2, turnId: 'u-redact-2', lowActive: true, lowSince: 1, lowTurns: 1,
      hisEmotion: 'joy', usedVoiceSnippet: true, causeQuoted: raw,
      reply: '我这两天有点沉，今天还被领导当众骂了一顿，所以笑不太出来。',
    });
    const r = redactTimelineNode(branchNode);
    expect(r.changed).toBe(true);
    if (r.node.kind !== 'branch') throw new Error('unexpected kind');
    expect(r.node.branch.causeQuoted).toBeNull();
    expect(r.node.branch.causeQuotedHash).toBe(quoteDigest(raw));
    expect(redactTimelineNode(r.node).changed).toBe(false);
  });
});
