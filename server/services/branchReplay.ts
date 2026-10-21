/**
 * 沙盒分叉回放（v1.60 Stage C）—— **只读、零 LLM、零状态变更**。
 *
 * 用户问的"回放"在这里落地成安全形态：
 *   · **不回档**：绝不恢复状态、绝不改写 memories/、不产生外部消息；
 *   · **只在决策层分叉**：给定历史某一轮，显示"如果她当时选另一条分支，**表达许可片段**会变成什么"，
 *     并附上该分支的历史学习权重（"这个选择过去更容易/更难被他接住"）。
 *
 * 为什么只做决策层而不重新生成回复：
 *   ① 重新生成要调模型（不可复现、有成本、还会产生"影子回复"污染判断）；
 *   ② 决策层的差异是**确定性**的 —— 能逐字 diff，是真正可审计的"如果"。
 *   真实回复需要沙盒里的完整生成（另见计划中的隔离 profile 方案）。
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  buildCauseChain,
  classifyOutcome,
  TIMELINE_DEFAULT_PATH,
  type TimelineRecord,
} from './emotionTimeline.js';
import {
  BRANCH_LEDGER_DEFAULT,
  branchBias,
  branchScores,
  branchWeight,
  buildBiasLine,
  loadBranchLedger,
  type BranchChoice,
  type BranchLedger,
} from './branchLearning.js';
import { buildSelfStateVoiceSnippet } from '../../src/lib/selfStateVoice.js';

export interface ReplayRequest {
  /** 要回放的那一轮（默认 = 时间线里最后一条 branch 节点） */
  fromRound?: number;
  /** 想试的分支（默认 = 该节点记录的全部 candidates） */
  choices?: BranchChoice[];
  /** 可选：他的"下一句话"，用于对**实际**分支做结果判定 */
  hisNextText?: string;
  timelinePath?: string;
  ledgerPath?: string;
}

/** 开关（默认关）：回放端点只在显式开启时可用 */
export function replayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_TIMELINE_REPLAY === 'true';
}

export interface ReplayCandidate {
  choice: BranchChoice;
  /** 该选择下的表达许可片段（决策层，不是她的回复） */
  snippet: string;
  /** 这个片段是否包含"可以说一句自己"的许可 */
  allowsSelfStateVoice: boolean;
  /** 这个片段是否含"原因"许可 */
  allowsCause: boolean;
  /** 历史学习：该分支被接住的情况 */
  learnedWeight: number;
  learnedBias: number;
  graduatedSamples: number;
  note: string;
}

export interface ReplayResult {
  ok: boolean;
  reason?: string;
  mode: 'decision-layer';
  from: {
    round: number;
    segment: string;
    trigger: { source: string; hisEmotion: string | null; quoted: string | null };
    lowActive: boolean;
    lowTurns: number;
    causeChainQuoted: string | null;
    candidates: BranchChoice[];
  } | null;
  actual: { chosen: BranchChoice; replyExcerpt: string; outcome: 'landed' | 'missed' | 'unclear' | null } | null;
  candidates: ReplayCandidate[];
  limitations: string[];
}

function loadNodes(path: string): TimelineRecord[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as TimelineRecord);
  } catch {
    return [];
  }
}

function baseNoVoiceSnippet(): string {
  return '【当前策略：旧片段（未开自我状态表达许可）】\n这一轮按常规策略回应他的好消息即可；不要转身讲自己的事。';
}

export function replayBranch(req: ReplayRequest = {}): ReplayResult {
  const timelinePath = req.timelinePath ?? TIMELINE_DEFAULT_PATH;
  const ledgerPath = req.ledgerPath ?? BRANCH_LEDGER_DEFAULT;
  const nodes = loadNodes(timelinePath);
  if (nodes.length === 0) {
    return { ok: false, reason: 'timeline_empty（时间线为空：先开 ENABLE_EMOTION_TIMELINE 跑几轮）', mode: 'decision-layer', from: null, actual: null, candidates: [], limitations: [] };
  }
  const branches = nodes.filter((n): n is Extract<TimelineRecord, { kind: 'branch' }> => n.kind === 'branch');
  if (branches.length === 0) {
    return { ok: false, reason: 'no_branch_nodes（还没有分支节点：分支只在低谷期记录）', mode: 'decision-layer', from: null, actual: null, candidates: [], limitations: [] };
  }
  const target = req.fromRound !== undefined
    ? branches.find(b => b.round === req.fromRound)
    : branches[branches.length - 1];
  if (!target) {
    return { ok: false, reason: `round_not_found（该轮没有分支节点：${req.fromRound}）`, mode: 'decision-layer', from: null, actual: null, candidates: [], limitations: [] };
  }

  // 该轮之前的节点（用于重建原因链；用 segment 里的 since 做窗口中心，含跨线前回看）
  const beforeNodes = nodes.filter(n => n.ts <= target.ts);
  const sinceMatch = /^seg_(\d+)$/.exec(target.segment);
  const sinceTs = sinceMatch ? Number(sinceMatch[1]) : null;
  const cause = buildCauseChain(beforeNodes, { sinceTs });
  const causeQuoted = cause.kind === 'his_word' ? cause.quoted : null;

  const ledger: BranchLedger = loadBranchLedger(ledgerPath);
  const scores = branchScores(ledger);
  const biasLine = buildBiasLine(scores);

  const choices: BranchChoice[] = req.choices?.length ? req.choices : (target.branch.candidates as BranchChoice[]);
  const candidates: ReplayCandidate[] = choices.map((choice) => {
    const stat = ledger.branches[choice];
    const graduated = stat ? stat.landed + stat.missed : 0;
    const isVoice = choice === 'voice' || choice === 'voice_with_cause';
    const snippet = isVoice
      ? buildSelfStateVoiceSnippet(
          choice === 'voice_with_cause' && causeQuoted
            ? { kind: 'his_word', phrase: `因为你说「${causeQuoted}」，我听着也跟着沉下去了`, evidence: `replay:${cause.evidence}`, topic: causeQuoted }
            : { kind: 'unknown', phrase: '', evidence: 'replay:none' },
          { biasLine },
        )
      : baseNoVoiceSnippet();
    return {
      choice,
      snippet,
      allowsSelfStateVoice: isVoice,
      allowsCause: choice === 'voice_with_cause' ? Boolean(causeQuoted) : false,
      learnedWeight: branchWeight(stat),
      learnedBias: branchBias(stat),
      graduatedSamples: graduated,
      note: graduated < 3
        ? '样本不足 3 ⇒ 学习保持中性（1.0）'
        : (branchBias(stat) > 0 ? '历史上这类选择更容易被他接住' : '历史上这类选择较少被接住'),
    };
  });

  // 实际结果：只有给了他的下一句话才能判定（否则 unknown —— 不猜）
  const outcomeNodes = nodes.filter((n): n is Extract<TimelineRecord, { kind: 'outcome' }> => n.kind === 'outcome' && n.refRound === target.round);
  let actualOutcome: 'landed' | 'missed' | 'unclear' | null = outcomeNodes[0]?.outcome.hisReaction ?? null;
  if (!actualOutcome && typeof req.hisNextText === 'string' && req.hisNextText.trim()) {
    actualOutcome = classifyOutcome(target.branch.replyExcerpt, req.hisNextText);
  }

  return {
    ok: true,
    mode: 'decision-layer',
    from: {
      round: target.round,
      segment: target.segment,
      trigger: { source: 'his_word', hisEmotion: target.context.hisEmotion, quoted: causeQuoted },
      lowActive: target.context.lowActive,
      lowTurns: target.context.lowTurns,
      causeChainQuoted: causeQuoted,
      candidates: target.branch.candidates as BranchChoice[],
    },
    actual: { chosen: target.branch.chosen, replyExcerpt: target.branch.replyExcerpt, outcome: actualOutcome },
    candidates,
    limitations: [
      '这是**决策层**回放：显示"换个选择，表达许可片段会变成什么"，不是重新生成她的回复',
      '不恢复状态、不写文件、不产生消息；真实回复需要沙盒内完整生成（未实现）',
      '学习权重来自历史账本，样本 <3 时为中性',
    ],
  };
}

/** 供 GET /api/timeline 用：读最近节点（倒序返回，便于前端从新到旧展示） */
export function listTimelineNodes(limit = 50, beforeTs?: number, path = TIMELINE_DEFAULT_PATH): TimelineRecord[] {
  const nodes = loadNodes(path);
  const filtered = typeof beforeTs === 'number' ? nodes.filter(n => n.ts < beforeTs) : nodes;
  return filtered.slice(-Math.max(1, Math.min(200, limit))).reverse();
}
