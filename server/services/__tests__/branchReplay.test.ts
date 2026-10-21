import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendTimelineNode,
  buildBranchNode,
  buildOutcomeNode,
  buildStateChangeNode,
} from '../emotionTimeline.js';
import { saveBranchLedger, type BranchLedger } from '../branchLearning.js';
import { replayBranch, listTimelineNodes, replayEnabled } from '../branchReplay.js';
import { INITIAL_EMOTION_STATE, type EmotionState } from '../../../src/lib/emotionTypes.js';

function freshState(): EmotionState {
  return structuredClone(INITIAL_EMOTION_STATE) as EmotionState;
}

function stateWithSad(delta: number): EmotionState {
  const s = freshState();
  s.emotions.sad = Math.min(1, s.emotions.sad + delta);
  return s;
}

function buildCorpus(dir: string) {
  const timeline = join(dir, 'emotion_timeline.jsonl');
  const ledger = join(dir, 'branch_learning.json');
  const base = 1000;
  // 起因事件（跨线前）
  appendTimelineNode(buildStateChangeNode({
    ts: base, round: 1, turnId: 'u-1', userText: '我今天被领导当众骂了一顿。',
    hisEmotion: 'sad', before: freshState(), after: stateWithSad(0.2),
  }), timeline);
  // 情绪句（跨线）
  appendTimelineNode(buildStateChangeNode({
    ts: base + 100, round: 2, turnId: 'u-2', userText: '心里堵得慌。',
    hisEmotion: 'sad', before: stateWithSad(0.2), after: stateWithSad(0.3),
  }), timeline);
  // 分支节点（低谷段 since=base+150）
  appendTimelineNode(buildBranchNode({
    ts: base + 200, round: 3, turnId: 'u-3',
    lowActive: true, lowSince: base + 150, lowTurns: 2, hisEmotion: 'joy',
    usedVoiceSnippet: true, causeQuoted: '我今天被领导当众骂了一顿',
    reply: '真好。我这两天有点沉，今天还被领导当众骂了一顿。',
  }), timeline);
  appendTimelineNode(buildOutcomeNode({
    ts: base + 300, round: 4, turnId: 'u-4', segment: `seg_${base + 150}`, refRound: 3,
    herReply: '真好。我这两天有点沉。', hisNextText: '那你现在还难受吗？', hisEmotion: 'neutral', herDeltaValence: -0.02,
  }), timeline);
  const l: BranchLedger = {
    schema: 'branch-learning-v0', updatedAt: 0,
    branches: {
      voice_with_cause: { voiced: 5, landed: 4, missed: 1, unclear: 0 },
      voice: { voiced: 3, landed: 1, missed: 2, unclear: 0 },
      silence: { voiced: 4, landed: 0, missed: 4, unclear: 0 },
    },
  };
  saveBranchLedger(l, ledger);
  return { timeline, ledger };
}

describe('开关（默认关）', () => {
  it('只有显式 true 才可用', () => {
    expect(replayEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(replayEnabled({ ENABLE_TIMELINE_REPLAY: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(replayEnabled({ ENABLE_TIMELINE_REPLAY: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('沙盒分叉回放（决策层、只读）', () => {
  it('给出该轮上下文：起因链、实际选择、实际结果', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp-'));
    const { timeline, ledger } = buildCorpus(dir);
    const r = replayBranch({ timelinePath: timeline, ledgerPath: ledger });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('decision-layer');
    expect(r.from?.round).toBe(3);
    // 起因应该是**最早那条负向**（跨线前回看生效）
    expect(r.from?.causeChainQuoted).toBe('我今天被领导当众骂了一顿');
    expect(r.actual?.chosen).toBe('voice_with_cause');
    expect(r.actual?.outcome).toBe('landed');
  });

  it('分叉候选：每个选择都给出对应片段（沉默 = 旧片段，不含自我状态许可）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp2-'));
    const { timeline, ledger } = buildCorpus(dir);
    const r = replayBranch({ timelinePath: timeline, ledgerPath: ledger, choices: ['voice_with_cause', 'voice', 'silence'] });
    expect(r.candidates).toHaveLength(3);
    const silence = r.candidates.find(c => c.choice === 'silence');
    expect(silence?.allowsSelfStateVoice).toBe(false);
    expect(silence?.snippet).toContain('旧片段');
    const withCause = r.candidates.find(c => c.choice === 'voice_with_cause');
    expect(withCause?.allowsCause).toBe(true);
    expect(withCause?.snippet).toContain('我今天被领导当众骂了一顿');
    const voice = r.candidates.find(c => c.choice === 'voice');
    expect(voice?.allowsCause).toBe(false);
    expect(voice?.snippet).toContain('可以选择');
  });

  it('带上历史学习权重（≥3 样本才偏离中性）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp3-'));
    const { timeline, ledger } = buildCorpus(dir);
    const r = replayBranch({ timelinePath: timeline, ledgerPath: ledger, choices: ['voice_with_cause', 'voice', 'silence'] });
    const wc = r.candidates.find(c => c.choice === 'voice_with_cause');
    const si = r.candidates.find(c => c.choice === 'silence');
    expect(wc?.learnedWeight).toBeCloseTo(1.3, 4);   // 0.5 + 4/5
    expect(si?.learnedWeight).toBeCloseTo(0.5, 4);   // 0.5 + 0/4
    expect(wc?.graduatedSamples).toBe(5);
    expect(si?.note).toContain('较少被接住');
  });

  it('没有他的下一句时，实际结果取历史 outcome 节点（不猜）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp4-'));
    const { timeline, ledger } = buildCorpus(dir);
    const r = replayBranch({ timelinePath: timeline, ledgerPath: ledger });
    expect(r.actual?.outcome).toBe('landed');           // 来自 outcome 节点
    // 提供下一句也不会覆盖已有历史结果
    const r2 = replayBranch({ timelinePath: timeline, ledgerPath: ledger, hisNextText: '今天天气不错' });
    expect(r2.actual?.outcome).toBe('landed');
  });

  it('空时间线 / 找不到轮次 ⇒ 明确失败原因（不伪造结果）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp5-'));
    const empty = join(dir, 'none.jsonl');
    const r = replayBranch({ timelinePath: empty, ledgerPath: join(dir, 'none.json') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('timeline_empty');

    const { timeline, ledger } = buildCorpus(dir);
    const r2 = replayBranch({ timelinePath: timeline, ledgerPath: ledger, fromRound: 999 });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain('round_not_found');
  });

  it('回放是只读的：不产生任何"影子"节点（节点数不变）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp6-'));
    const { timeline, ledger } = buildCorpus(dir);
    const before = listTimelineNodes(100, undefined, timeline).length;
    replayBranch({ timelinePath: timeline, ledgerPath: ledger, choices: ['voice', 'silence'] });
    const after = listTimelineNodes(100, undefined, timeline).length;
    expect(after).toBe(before);
  });
});

describe('时间线浏览（GET /api/timeline 的数据面）', () => {
  it('倒序返回，limit 生效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rp7-'));
    const { timeline } = buildCorpus(dir);
    const nodes = listTimelineNodes(2, undefined, timeline);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].ts).toBeGreaterThan(nodes[1].ts);   // 从新到旧
  });
});
