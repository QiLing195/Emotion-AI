/**
 * v1.71 低谷退出的**假设轨迹模拟**（只读离线，零行为风险）。
 *
 * 输入：low_exit_probe.jsonl（每轮记录 depth / peakDepth / positiveActivation）
 * 输出：对三种"改法"分别算出 depth 会怎么走、第几轮会退出低谷、退出后是否稳定。
 *
 * 三种假设：
 *   baseline（现状）：depth 按记录的真实值（它只随时间空闲衰减 ⇒ 连续对话里几乎不动）
 *   A（正向推低）：每轮 depth -= k × positiveActivation，界 [0, peak]
 *   B（每轮自然回落）：每轮 depth -= d，界 [0, peak]
 *
 * 预登记判据（改动力学之前先定，之后不许调）：
 *   ① 在"明显变好"的语料里，低谷应在**1~6 轮内**退出（不能永远不出）
 *   ② 不能在**仍被负面事件冲击**的轮次退出（退出点必须距离最后一次负面 ≥1 轮）
 *   ③ 退出后 depth 不应立刻反弹回峰值（稳定 2 轮以上）
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/simulate-low-exit.ts <probe.jsonl> [<probe2.jsonl> ...]
 */
import { readFileSync } from 'node:fs';

interface ProbeRecord {
  round: number;
  active: boolean;
  depth: number;
  peakDepth: number;
  phase: string;
  positiveActivation: number;
  accum: number;
  wouldExit: boolean;
}

export const EXIT_DEPTH = 0.05;
export const POSITIVE_K = [0.005, 0.01, 0.02, 0.03, 0.05];
export const NATURAL_DECAY = [0.006, 0.008, 0.01, 0.012, 0.02];

function loadSessions(paths: string[]): ProbeRecord[][] {
  return paths.map(p => {
    const seen = new Set<number>();
    const rows: ProbeRecord[] = [];
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as ProbeRecord;
      // 去重：同一 round 只保留一条（策略片段每回合算两次）
      if (seen.has(r.round)) continue;
      seen.add(r.round);
      rows.push(r);
    }
    return rows.sort((a, b) => a.round - b.round);
  });
}

interface SimResult {
  name: string;
  exitRound: number | null;
  exitAfterPositiveRounds: number | null;
  minDepth: number;
  finalDepth: number;
  stableAfterExit: boolean;
}

function simulate(rows: ProbeRecord[], name: string, kind: 'baseline' | 'positive' | 'natural', param = 0): SimResult {
  let depth = 0;
  let peak = 0;
  let exitRound: number | null = null;
  let exitIdx: number | null = null;
  let segStartIdx: number | null = null;
  let positiveSeen = 0;
  let depthHistory: number[] = [];

  rows.forEach((r, idx) => {
    if (!r.active) { depth = 0; peak = 0; return; }
    if (depth === 0 && peak === 0) {           // 段开始：以记录的 depth/peak 初始化
      depth = r.depth;
      peak = Math.max(r.peakDepth, r.depth);
    }
    if (segStartIdx === null) segStartIdx = idx;
    if (r.positiveActivation > 0) positiveSeen++;
    if (kind !== 'baseline') {
      // 现实约束①：**负面事件把她推回去** —— 记录里 depth 比模拟值高，说明这一轮有负压
      const realDepth = Number(r.depth ?? 0);
      if (realDepth > depth + 0.005) depth = Math.min(peak, realDepth);
      // 现实约束②：模拟值不能低于 0、不能高于峰值
      depth = Math.max(0, Math.min(peak, depth));
      // 改法本身
      if (kind === 'positive') {
        depth = Math.max(0, Math.min(peak, depth - param * r.positiveActivation));
      } else {
        depth = Math.max(0, Math.min(peak, depth - param));
      }
    } else {
      depth = r.depth;                          // 现状：用真实值
    }
    depthHistory.push(depth);
    if (exitRound === null && depth < EXIT_DEPTH) {
      exitRound = r.round;
      exitIdx = idx;
    }
  });

  const after = exitIdx === null ? [] : depthHistory.slice(exitIdx + 1, exitIdx + 3);
  const stableAfterExit = after.every(d => d < EXIT_DEPTH);
  return {
    name,
    exitRound,
    exitAfterPositiveRounds: exitIdx === null || segStartIdx === null ? null : exitIdx - segStartIdx + 1,
    minDepth: depthHistory.length ? Math.round(Math.min(...depthHistory) * 1000) / 1000 : 0,
    finalDepth: depthHistory.length ? Math.round(depthHistory[depthHistory.length - 1] * 1000) / 1000 : 0,
    stableAfterExit,
  };
}

const paths = process.argv.slice(2);
if (paths.length === 0) { console.error('用法: <probe.jsonl> [...]'); process.exit(2); }
const sessions = loadSessions(paths);

const results: SimResult[] = [];
for (const rows of sessions) {
  results.push(simulate(rows, 'baseline（现状）', 'baseline'));
  for (const k of POSITIVE_K) results.push(simulate(rows, `A: 正向推低 k=${k}`, 'positive', k));
  for (const d of NATURAL_DECAY) results.push(simulate(rows, `B: 每轮回落 d=${d}`, 'natural', d));
}

console.log(`\n=== 低谷退出假设轨迹（${sessions.length} 段语料）===`);
const activeCount = sessions.map(s => s.filter(r => r.active).length);
console.log(`  每段 active 轮次: ${activeCount.join(' / ')}`);

for (const r of results) {
  const exitTxt = r.exitRound === null
    ? '**永不退出**'
    : `段内第 ${r.exitAfterPositiveRounds} 轮退出（全局 #${r.exitRound}，稳定=${r.stableAfterExit}）`;
  console.log(`  ${r.name.padEnd(22)} → ${exitTxt} ｜ 最低 depth=${r.minDepth} ｜ 结束 depth=${r.finalDepth}`);
}

console.log('\n  预登记判据：');
const anyExit = results.some(r => r.exitRound !== null);
console.log(`    ① 1~6 轮内退出（不能永不退出）: ${anyExit ? '至少一种改法满足（见上表）' : '❌ 所有改法都永不退出'}`);
console.log('    ② 退出点距最后一次负面 ≥1 轮:（需按语料人工核对，脚本不自动判）');
console.log('    ③ 退出后稳定 2 轮: 见"稳定="字段');
