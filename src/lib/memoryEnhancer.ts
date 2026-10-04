// ── v1.3 记忆增强层 (Memory Enhancer) ──
// 补上文档长期缺失的两件事：
//   1. 遗忘曲线（艾宾浩斯近似）：旧记忆随未回想天数指数衰减 recallWeight；
//      回想得越多记得越久；用户核实过(verified)的记忆几乎不忘。
//   2. 相似合并去重：同一件事反复被记成多条 → 检测并合并为主条目，
//      其余标 archived（保留供人工审查，不参与召回），消灭"副本漂移"。
//
// 与治理账本(memoryGovernance)配合：verified → 慢遗忘；ambiguous/proposed → 正常遗忘；
// 合并不会篡改账本，仅将低权条目移出召回（report 里给出可查记录）。
// 纯逻辑模块：无 io/React 依赖。

import type { EpisodicMemory, EpisodicMemoryStore } from './episodicMemory';
import type { MemoryLedger } from './memoryGovernance';

export interface MemoryEnhancerOptions {
  /** 基准半衰期（天）：无回想时权重每过此天数减半 */
  halfLifeDays?: number;
  /** 每次被想起后记忆强度增加的天数（间隔重复效应） */
  recallStrengthBonusDays?: number;
  /** verified 记忆的额外遗忘抑制系数（乘在半衰期上） */
  verifiedHalfLifeMultiplier?: number;
  /** 相似合并阈值 [0,1]：文本/向量相似 ≥ 此值视为同一件事 */
  mergeThreshold?: number;
  /** 权重衰减下限（不低于此值，保留可恢复性） */
  weightFloor?: number;
  /** 单次整合最多合并对数（防长尾开销） */
  maxMerges?: number;
}

export const DEFAULT_ENHANCER_OPTIONS: Required<MemoryEnhancerOptions> = {
  halfLifeDays: 20,
  recallStrengthBonusDays: 15,
  verifiedHalfLifeMultiplier: 6,
  mergeThreshold: 0.86,
  weightFloor: 0.05,
  maxMerges: 20,
};

// ════════════════════════════════════════════════════════════
// 1. 遗忘曲线
// ════════════════════════════════════════════════════════════

/** 依艾宾浩斯近似计算某条记忆的当前遗忘衰减因子 [0,1]。 */
export function forgettingRetention(
  episode: Pick<EpisodicMemory, 'timestamp' | 'recallCount' | 'lastRecalledAt' | 'recallWeight'>,
  now: number = Date.now(),
  opts?: MemoryEnhancerOptions,
  verified = false,
): number {
  const o: Required<MemoryEnhancerOptions> = { ...DEFAULT_ENHANCER_OPTIONS, ...(opts ?? {}) };
  const ageDays = Math.max(0, (now - (episode.lastRecalledAt ?? episode.timestamp)) / (1000 * 60 * 60 * 24));
  // 强度：每回想一次，半衰期延长 recallStrengthBonusDays 天（间隔重复效应）
  const strengthDays = o.halfLifeDays
    + (episode.recallCount ?? 0) * o.recallStrengthBonusDays;
  const halfLife = verified
    ? strengthDays * o.verifiedHalfLifeMultiplier
    : strengthDays;
  return Math.pow(0.5, ageDays / Math.max(1, halfLife));
}

/** 是否已低于"失活"阈值（权重小 + 长期未回想 → 建议人工复查或可安全归档副本）。 */
export function isInactive(episode: EpisodicMemory, now = Date.now()): boolean {
  const floor = DEFAULT_ENHANCER_OPTIONS.weightFloor;
  return (episode.recallWeight ?? 0) < floor * 2;
}

// ════════════════════════════════════════════════════════════
// 2. 相似合并
// ════════════════════════════════════════════════════════════

/** 归一化文本（去标点空白小写）。 */
function normalizeText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s，。！？、；：""''（）《》.,!?;:()'"\-—…~～]/g, '');
}

/** 中文友好的相似度：字符 2-gram Jaccard + overlap（近似重复/加字场景）。
 *  仅当两句长度相近（较短 ≥ 较长 55%）时启用 overlap，防止短句被长句"吞并"式误并。 */
export function textSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const gram = (s: string, n = 2): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i + n <= s.length; i++) set.add(s.slice(i, i + n));
    return set;
  };
  const A = gram(na);
  const B = gram(nb);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  const jaccard = union === 0 ? 0 : inter / union;
  // 长度相近时允许"一句是另一句的近似超集"计高相似（如差一个虚词）。
  //
  // ⚠️ 门槛原本是 0.55，实测**会误合并**：
  //   「你会不会觉得我很烦」(9 字) <=> 「你会不会觉得我很无聊啊总是聊工作」(16 字)
  //   长度比 9/16 = 0.5625 刚好过线 → `inter / min(A,B)` = **0.875** > 阈值 0.86
  //   而两者 Jaccard 只有 **0.41** —— 是这档加成把**两条不同的担忧**顶过阈值的。
  // 那个 0.55 想救的场景（"一句是另一句被截断的超集"，如 15 字 vs 30 字）**本来也没救到**
  //   （长度比 0.5 < 0.55，走不到这档，实测只有 0.520 < 0.86 → 同样没合并）。
  // 所以收紧到 0.8：只保留"长度几乎一样"的真·近重复，去掉中间地带的误伤。
  const lengthRatio = Math.min(na.length, nb.length) / Math.max(1, Math.max(na.length, nb.length));
  if (lengthRatio >= 0.8) {
    const overlap = inter / Math.max(1, Math.min(A.size, B.size));
    return Math.max(jaccard, overlap);
  }
  return jaccard;
}

/** 融合相似度：双方都有 embedding 时用余弦；否则用文本 2-gram Jaccard。 */
export function memorySimilarity(a: EpisodicMemory, b: EpisodicMemory): number {
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.embedding.length; i++) {
      dot += a.embedding[i] * b.embedding[i];
      na += a.embedding[i] * a.embedding[i];
      nb += b.embedding[i] * b.embedding[i];
    }
    if (na > 0 && nb > 0) {
      const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
      // 向量分与文本分取高者：embedding 未覆盖主题时文本判断兜底
      return Math.max(cos, textSimilarity(a.eventSummary || a.narrativeFragment, b.eventSummary || b.narrativeFragment));
    }
  }
  return textSimilarity(a.eventSummary || a.narrativeFragment, b.eventSummary || b.narrativeFragment);
}

/**
 * 两道"不可能是同一件事"的闸门（原样从 `findDuplicatePairs` 抽出，供即时查重复用）。
 * ① 同一轮/相邻轮的快照（相隔 <60s）不算重复；
 * ② 主导情绪不同**且**标签无交集 → 几乎不可能是一件事。
 */
function passesDuplicateGates(a: EpisodicMemory, b: EpisodicMemory): boolean {
  if (Math.abs(a.timestamp - b.timestamp) < 60_000) return false;
  const aEmo = a.emotionalImpact?.dominantEmotion;
  const bEmo = b.emotionalImpact?.dominantEmotion;
  const tagOverlap = (a.tags ?? []).some(t => (b.tags ?? []).includes(t));
  if (aEmo && bEmo && aEmo !== bEmo && !tagOverlap) return false;
  return true;
}

/** 找出可合并的相似对（已归档的不参与；同轮次不同时刻才可能重复）。 */
export function findDuplicatePairs(
  store: EpisodicMemoryStore,
  opts?: MemoryEnhancerOptions,
): Array<[EpisodicMemory, EpisodicMemory, number]> {
  const o: Required<MemoryEnhancerOptions> = { ...DEFAULT_ENHANCER_OPTIONS, ...(opts ?? {}) };
  const active = store.episodes.filter(ep => !ep.archived);
  const pairs: Array<[EpisodicMemory, EpisodicMemory, number]> = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (!passesDuplicateGates(a, b)) continue;
      const sim = memorySimilarity(a, b);
      if (sim >= o.mergeThreshold) pairs.push([a, b, sim]);
    }
  }
  return pairs.sort((x, y) => y[2] - x[2]).slice(0, o.maxMerges);
}

/** 即时查重时最多回看多少条（重复都发生在相邻几轮，不必扫全库） */
export const NEAR_DUPLICATE_LOOKBACK = 20;

/**
 * **形成时**的轻量查重（v1.17）。
 *
 * ── 为什么需要它（实测根因）────────────────────────────────────────────────
 * 原本只有 `runConsolidation` 这一个去重入口，而它挂在 `server.ts` 里按
 * **≥6 小时**节流。可是重复记忆是在**几十秒内**连续产生的 —— 实测那三条
 * 「今天路上看到一只小猫，挺可爱的」时间戳相差 21s / 118s（相邻几轮）：
 *   第 1 轮形成 → 触发整合（此时只有 1 条，没得合并）→ `_lastConsolidationAt` 设为现在
 *   第 2、3 轮形成 → 距上次整合 21s / 118s，**6h 内全部跳过**
 * → 于是近重复必然并存，要等到下一个 6h 窗口才可能被合并。
 * **节流窗口（6h）与重复产生窗口（2min）差了两个数量级。**
 *
 * 这里补的是"当场合并"：新记忆只跟**最近 {@link NEAR_DUPLICATE_LOOKBACK} 条**比一次
 * （成本 O(N) 次字符串比较），命中就按同一套闸门与阈值合并。
 * 6h 的周期整合继续负责长尾与遗忘。
 *
 * @returns 被归档掉的那一条（调用方据此决定是否落盘/记日志）；没有重复则 null
 */
export function mergeNearDuplicate(
  store: EpisodicMemoryStore,
  fresh: EpisodicMemory,
  opts?: MemoryEnhancerOptions,
): EpisodicMemory | null {
  const o: Required<MemoryEnhancerOptions> = { ...DEFAULT_ENHANCER_OPTIONS, ...(opts ?? {}) };
  const recent = store.episodes
    .filter(ep => !ep.archived && ep.id !== fresh.id)
    .slice(-NEAR_DUPLICATE_LOOKBACK);

  let best: { ep: EpisodicMemory; sim: number } | null = null;
  for (const ep of recent) {
    if (!passesDuplicateGates(fresh, ep)) continue;
    const sim = memorySimilarity(fresh, ep);
    if (sim >= o.mergeThreshold && (!best || sim > best.sim)) best = { ep, sim };
  }
  if (!best) return null;

  const { archived } = mergePair(store, fresh, best.ep);
  return archived;
}

/** 合并一对记忆：高权重/高回想者为主，其余归档并吸收计数。 */
export function mergePair(
  store: EpisodicMemoryStore,
  primary: EpisodicMemory,
  secondary: EpisodicMemory,
): { kept: EpisodicMemory; archived: EpisodicMemory } {
  const byStrength = (x: EpisodicMemory): number =>
    (x.recallCount ?? 0) * 10 + (x.recallWeight ?? 0);
  let main = primary;
  let side = secondary;
  if (byStrength(side) > byStrength(main)) [main, side] = [side, main];

  // 主条目吸收：回想次数与权重取大、标签并集、叙事保留更长/更新者
  main.recallCount = (main.recallCount ?? 0) + (side.recallCount ?? 0);
  main.recallWeight = Math.max(main.recallWeight ?? 0, side.recallWeight ?? 0);
  main.tags = Array.from(new Set([...(main.tags ?? []), ...(side.tags ?? [])]));
  if (!main.lastRecalledAt && side.lastRecalledAt) main.lastRecalledAt = side.lastRecalledAt;
  const mainText = (main.eventSummary || '').length;
  const sideText = (side.eventSummary || '').length;
  if (sideText > mainText) main.eventSummary = side.eventSummary;

  side.archived = true;
  side.mergedInto = main.id;
  return { kept: main, archived: side };
}

// ════════════════════════════════════════════════════════════
// 3. 整合入口
// ════════════════════════════════════════════════════════════

export interface ConsolidationReport {
  at: number;
  decayedCount: number;
  mergedPairs: number;
  archivedCount: number;
  /** 合并明细（主 ← 次），供人工在 Obsidian 复查 */
  mergeDetails: Array<{ keptId: string; archivedId: string; similarity: number }>;
}

/**
 * 一次记忆整合：
 *   a) 遗忘曲线：对所有未归档记忆按 未回想天数 × 记忆强度 衰减 recallWeight；
 *      verified（治理账本确认）用更长的半衰期；
 *   b) 相似合并：重复事件合并为一条，其余归档。
 * 就地修改 store；返回报告（幂等可重跑）。
 */
export function runConsolidation(
  store: EpisodicMemoryStore,
  ledger?: MemoryLedger | null,
  opts?: MemoryEnhancerOptions,
  now: number = Date.now(),
): ConsolidationReport {
  const o: Required<MemoryEnhancerOptions> = { ...DEFAULT_ENHANCER_OPTIONS, ...(opts ?? {}) };
  const report: ConsolidationReport = {
    at: now,
    decayedCount: 0,
    mergedPairs: 0,
    archivedCount: 0,
    mergeDetails: [],
  };
  const isVerified = (ep: EpisodicMemory): boolean =>
    ledger?.getByRef('episodic', ep.id)?.status === 'verified';

  // a) 遗忘
  for (const ep of store.episodes) {
    if (ep.archived) continue;
    const retention = forgettingRetention(ep, now, o, isVerified(ep));
    const next = Math.max(o.weightFloor, (ep.recallWeight ?? 0) * retention);
    if (Math.abs(next - (ep.recallWeight ?? 0)) > 1e-6) {
      ep.recallWeight = Math.round(next * 10000) / 10000;
      report.decayedCount++;
    }
  }

  // b) 合并（迭代直到无可用对）
  for (let guard = 0; guard < o.maxMerges; guard++) {
    const pairs = findDuplicatePairs(store, o);
    if (pairs.length === 0) break;
    const [a, b, sim] = pairs[0];
    const { archived } = mergePair(store, a, b);
    report.mergedPairs++;
    report.archivedCount++;
    report.mergeDetails.push({ keptId: archived.mergedInto!, archivedId: archived.id, similarity: Math.round(sim * 10000) / 10000 });
  }

  return report;
}
