/**
 * Stage A：分支结果的有界学习（v1.60，**默认关**）
 *
 * 学什么：**她的选择 → 他有没有接住**（branch.chosen → outcome.hisReaction）。
 * 不学什么：不改模板、不新增分支类型、不改规则、不动 Prompt 结构。
 *
 * 三条硬边界（与项目既有 L1 motif 学习同一套纪律）：
 *   ① 有界：weight = clamp(0.5 + landed/voiced, 0.5, 1.5)
 *   ② 少样本不学：样本 < 3 时权重恒为中性 1.0
 *   ③ **只允许鼓励她说，不允许鼓励她沉默**（人设裁定：主动性降低，但不是没有）
 *      ⇒ 学出来的偏置只可能让"说"更容易出现，绝不会把"安静"推成默认。
 *   ④ 删除账本 = 完全回到中性
 *
 * 账本：memories/branch_learning.json
 *   { schema, updatedAt, branches: { [chosen]: { voiced, landed, missed, unclear } } }
 *
 * 读出的 biasLine 由 selfStateVoice 片段使用（开关 ENABLE_BRANCH_BIAS 默认关）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const BRANCH_LEDGER_DEFAULT = 'memories/branch_learning.json';
export const BRANCH_MIN_SAMPLES = 3;
export const BRANCH_WEIGHT_MIN = 0.5;
export const BRANCH_WEIGHT_MAX = 1.5;

export type BranchChoice = 'voice_with_cause' | 'voice' | 'silence' | 'defer' | 'comfort';
export type BranchReaction = 'landed' | 'missed' | 'unclear';

export interface BranchStat {
  voiced: number;
  landed: number;
  missed: number;
  unclear: number;
}

export interface BranchLedger {
  schema: 'branch-learning-v0';
  updatedAt: number;
  branches: Record<string, BranchStat>;
}

export function branchBiasEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_BRANCH_BIAS === 'true';
}

function emptyLedger(): BranchLedger {
  return { schema: 'branch-learning-v0', updatedAt: Date.now(), branches: {} };
}

export function loadBranchLedger(path = BRANCH_LEDGER_DEFAULT): BranchLedger {
  try {
    if (!existsSync(path)) return emptyLedger();
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<BranchLedger>;
    if (!raw || typeof raw !== 'object' || !raw.branches) return emptyLedger();
    return { schema: 'branch-learning-v0', updatedAt: Number(raw.updatedAt ?? Date.now()), branches: raw.branches };
  } catch {
    return emptyLedger();                       // 账本坏了 = 回到中性，绝不因此报错
  }
}

export function saveBranchLedger(ledger: BranchLedger, path = BRANCH_LEDGER_DEFAULT): boolean {
  try {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(ledger, null, 2), 'utf8');
    return true;
  } catch {
    return false;                               // 学习层失败不影响对话
  }
}

/** 记录一次"选择 → 结果"；unclear 只计数，不参与学习 */
export function recordBranchOutcome(
  chosen: string,
  reaction: BranchReaction,
  ledger: BranchLedger,
): BranchLedger {
  const key = String(chosen || '').trim();
  if (!key) return ledger;
  const stat: BranchStat = ledger.branches[key] ?? { voiced: 0, landed: 0, missed: 0, unclear: 0 };
  stat.voiced += 1;
  if (reaction === 'landed') stat.landed += 1;
  else if (reaction === 'missed') stat.missed += 1;
  else stat.unclear += 1;
  ledger.branches[key] = stat;
  ledger.updatedAt = Date.now();
  return ledger;
}

/**
 * 某一类的权重。
 * · 样本（landed+missed）< 3 ⇒ 恒 1.0（少样本不学）
 * · 否则 0.5 + landed / (landed+missed)，再 clamp 到 [0.5, 1.5]
 */
export function branchWeight(stat: BranchStat | undefined): number {
  if (!stat) return 1.0;
  const graded = stat.landed + stat.missed;
  if (graded < BRANCH_MIN_SAMPLES) return 1.0;
  const raw = 0.5 + stat.landed / graded;
  return Math.min(BRANCH_WEIGHT_MAX, Math.max(BRANCH_WEIGHT_MIN, raw));
}

/** 相对中性 1.0 的偏置量（正 = 这类选择更容易被接住） */
export function branchBias(stat: BranchStat | undefined): number {
  return Math.round((branchWeight(stat) - 1.0) * 1000) / 1000;
}

export interface BranchScores {
  voiceWithCause: number;
  voice: number;
  silence: number;
}

export function branchScores(ledger: BranchLedger): BranchScores {
  return {
    voiceWithCause: branchBias(ledger.branches['voice_with_cause']),
    voice: branchBias(ledger.branches['voice']),
    silence: branchBias(ledger.branches['silence']),
  };
}

/**
 * 生成片段用的偏置行（**只鼓励说，不鼓励沉默**）。
 *
 * · 说 > 沉默 且差距 ≥0.15 ⇒ 加一句"可以说"的鼓励
 * · 说原因 > 只说状态 且差距 ≥0.15 ⇒ 加一句"带上原因更清楚"
 * · 沉默更"有效"时**什么都不做**（人设裁定：不允许学习把沉默推成默认）
 */
export function buildBiasLine(scores: BranchScores): string | null {
  const speaking = Math.max(scores.voiceWithCause, scores.voice);
  const lines: string[] = [];
  // ① 先判断"要不要鼓励她说"——这一步不过，后面任何建议都不加
  //    （红线：沉默更有效时**什么都不做**，不允许学习把沉默推成默认）
  if (speaking - scores.silence >= 0.15) {
    lines.push('（从以往看，你说一句自己的状态时他更容易接住——可以说，不想说也没关系）');
    // ② 只有在已经鼓励"说"的前提下，才可能建议"带上原因"
    if (scores.voiceWithCause - scores.voice >= 0.15) {
      lines.push('（说的时候带上原因，他更容易明白你在经历什么）');
    }
  }
  return lines.length ? lines.join('\n') : null;
}
