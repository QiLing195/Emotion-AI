// 存量情景记忆修复 v2 —— 让她不再把"错的情绪"当回忆说出口
//
// ── 问题 ─────────────────────────────────────────────────────────────────────
// 41 条存量的 `dominantEmotion` / `narrativeFragment` 是在 v1.13/v1.20 修好之前生成的：
// 情绪标签兜底到「绝对值 argmax」（calm 人格基调 0.8 通吃），叙事再按那个标签套模板。
// 这些叙事会经【相关记忆】/【主动回忆】注入 Prompt —— 她会说"你生日那天我心里一阵不适"。
//
// ── 为什么不是"重算标签" ────────────────────────────────────────────────────
// 存量里**没有九情向量**（只存 valenceBefore/After/Delta + 一个标签），没有任何依据能反推出
// "她当时真实的情绪"。照着 valenceΔ 的正负猜一个 sad/joy 就是伪造 —— 与项目一贯纪律冲突
// （"宁可少生成，也不让空话进池"）。所以只做**停止污染**：清空叙事 + 打 `narrativeStale`，
// 它们于是被 `decideProactiveRecall` 的 `narrativeFragment.length > 10` 与
// `recallEpisodic` 的空叙事过滤挡掉，不再出现在任何回忆里。
// **不编新叙事、不改任何数值、不删条目**（记忆本身仍在，效价/标签/权重一律不动）。
//
// ── 为什么是"审核过的清单"而不是自动规则（v1 vs v2 的关键区别）────────────────
// v1 用一条自动规则（`calm` + Δ<−0.1）扫，漏掉了 Δ 小的同病条目。
// v2 的候选由 `scripts/audit-stale-episodes.ts` 用**两把独立文本尺子**
// （`SIGNIFICANT_PATTERNS` 正则标签 + 本地词典 NLU）逐条列出，**再经人工逐条判定**。
// 理由：两把尺子都窄，"没抓到情绪词"不等于"这句话是中性"（实测「今天上班好累，被老板说了两句」
// 两把尺子都读作中性，但人一看就知道是负面的）—— 所以最终选择权在人，不写成规则。
// 清单里那一条 `sad`「今天上班好累」被**刻意保留**：他确实是负面，记成 sad 合理。
//
// 用法:
//   node node_modules/tsx/dist/cli.mjs scripts/repair-episode-narratives.ts            # dry-run
//   node node_modules/tsx/dist/cli.mjs scripts/repair-episode-narratives.ts --apply    # 写入（先备份）
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const FILE = 'memories/episodic_memory.json';
const APPLY = process.argv.includes('--apply');

interface Impact { valenceBefore: number; valenceAfter: number; valenceDelta: number; arousalPeak: number; dominantEmotion: string }
interface Episode {
  id: string; timestamp: number; roundNumber: number;
  eventSummary: string; emotionalImpact: Impact; narrativeFragment: string;
  tags?: string[]; recallWeight?: number;
}

/**
 * 人工复核过的清单（2026-09，逐条看过原文）。
 * 每条都带**守卫字段**：目标条目的轮次/标签/原文片段必须对得上，否则拒绝执行 ——
 * 防止"照着 id 盲删"（数据一变，脚本应当报错而不是乱清）。
 */
const APPROVED: Array<{ id: string; round: number; label: string; textHas: string; why: string }> = [
  // ── 证据强：至少一把文本尺子明确读出了相反方向 ──
  { id: 'ep_1789479620492_36', round: 140, label: 'calm', textHas: '体检', why: '他说"有点担心结果"（正则标签 脆弱 + NLU fear），却记成平静' },
  { id: 'ep_1789474857043_28', round: 92, label: 'calm', textHas: '面试', why: '他说"有点紧张"（NLU fear），却记成平静' },
  { id: 'ep_1782315030139_14', round: 35, label: 'calm', textHas: '你好啊叔叔', why: '纯寒暄；记成 calm 是"静息被写成平静"，叙事在 claim 她没经历过的情绪' },
  { id: 'ep_1782290829101_12', round: 29, label: 'calm', textHas: '你好', why: '纯寒暄；同上，且叙事 claim"满足/幸福"' },
  // ── 人工判定为准（两把尺子都沉默，但人一看就知道记反了）──
  { id: 'ep_1788879636911_21', round: 62, label: 'disgust', textHas: '生日', why: '他在邀请她一起过生日，她记成"一阵不适、想把自己缩回去"' },
  { id: 'ep_1788938043350_22', round: 65, label: 'sad', textHas: '画展', why: '他把珍视的秘密（偷偷学画画）告诉她，她记成"说不出的失落"' },
  { id: 'ep_1789312992224_26', round: 85, label: 'sad', textHas: '我回来了', why: '一句"嗯，我回来了"被记成"仿佛被什么抽空了"' },
  { id: 'ep_1789305021491_23', round: 71, label: 'disgust', textHas: '还记得', why: '他在问"你还记得我之前跟你说过的事吗"，她记成"一阵不适"' },
  { id: 'ep_1789313010331_27', round: 86, label: 'disgust', textHas: '变化', why: '他在问"你觉得我最近有什么变化吗"，她记成"一阵不适"' },
  { id: 'ep_1789305306217_24', round: 74, label: 'disgust', textHas: '无聊', why: '他在自我怀疑求安慰，她记成"被轻蔑对待、想转身离开"' },
];
// 刻意保留：ep_1789310132485_25（第81轮「今天上班好累，被老板说了两句」→ sad）——
// 他确实是负面的，记成 sad 合理，只是强度偏大；禁言它反而丢掉一条合理的同情记忆。

const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const key = Array.isArray(raw) ? null : Object.keys(raw).find(k => Array.isArray(raw[k]));
const episodes: Episode[] = Array.isArray(raw) ? raw : raw[key!];
console.log(`读入 ${episodes.length} 条情景记忆（容器字段：${key ?? '根数组'}）\n`);

// ── 逐条核对守卫字段 ──
const targets: Episode[] = [];
const problems: string[] = [];
for (const spec of APPROVED) {
  const ep = episodes.find(e => e.id === spec.id);
  if (!ep) { problems.push(`${spec.id}：找不到该条目`); continue; }
  if (ep.roundNumber !== spec.round) { problems.push(`${spec.id}：轮次 ${ep.roundNumber} ≠ 清单 ${spec.round}`); continue; }
  if (ep.emotionalImpact?.dominantEmotion !== spec.label) {
    problems.push(`${spec.id}：标签 ${ep.emotionalImpact?.dominantEmotion} ≠ 清单 ${spec.label}`); continue;
  }
  if (!ep.eventSummary.includes(spec.textHas)) { problems.push(`${spec.id}：原文不含「${spec.textHas}」`); continue; }
  if ((ep.narrativeFragment ?? '').length === 0 || ep.tags?.includes('narrativeStale')) {
    console.log(`  ${spec.id}  已处理过（叙事为空/已标 narrativeStale），跳过`);
    continue;
  }
  targets.push(ep);
}

if (problems.length) {
  console.error('守卫字段不匹配，拒绝执行：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`符合清单且待处理：${targets.length} 条\n`);
for (const ep of targets) {
  const spec = APPROVED.find(s => s.id === ep.id)!;
  console.log(`  第${ep.roundNumber}轮  ${ep.id}  权重 ${(ep.recallWeight ?? 0).toFixed(3)}`);
  console.log(`    他说：「${ep.eventSummary}」`);
  console.log(`    理由：${spec.why}`);
  console.log(`    将清空的叙事：${ep.narrativeFragment}\n`);
}

if (targets.length === 0) console.log('（episodic 侧无需修复 —— 可能已执行过）');

// ════════════════════════════════════════════════════════════════════════════
// 第二步：**图谱里还存着同一段叙事的副本**，必须一起清，否则那条通路还在说旧话
// ────────────────────────────────────────────────────────────────────────────
// 图谱 episodic 节点的 `content` 就是 `narrativeFragment`（`createNodeFromEpisode`），
// v1.14 的 backfill 把当时的叙事写进了 `memories/memory_graph.json`。
// `queryMemoryGraph` 直接返回 `node.content` → 若不同步，她会经由**图谱召回**这条通路
// 继续说出"你生日那天我心里一阵不适"。两处必须同时空，否则等于没修。
// 幂等：只清"对应 episode 已无叙事、而节点 content 还非空"的节点。
const GRAPH_FILE = 'memories/memory_graph.json';
const staleIds = new Set(
  episodes.filter(e => (e.tags ?? []).includes('narrativeStale')).map(e => e.id),
);
let graphDoc: { nodes?: Array<{ source?: string; sourceId?: string; content?: string }> } | null = null;
let graphCleared = 0;
if (existsSync(GRAPH_FILE)) {
  graphDoc = JSON.parse(readFileSync(GRAPH_FILE, 'utf8'));
  for (const node of graphDoc!.nodes ?? []) {
    if (node.source !== 'episodic' || !node.sourceId || !node.content) continue;
    if (staleIds.has(node.sourceId)) { node.content = ''; graphCleared++; }
  }
  console.log(`图谱侧待清空 content 的 episodic 节点：${graphCleared} 个（共 ${(graphDoc!.nodes ?? []).length} 个节点）`);
} else {
  console.log(`（未找到 ${GRAPH_FILE}，跳过图谱同步）`);
}

if (targets.length === 0 && graphCleared === 0) { console.log('\n无需修复。'); process.exit(0); }

if (!APPLY) {
  console.log('\n（dry-run）将把这些条目的 narrativeFragment 清空并加 `narrativeStale` 标签，');
  console.log('并同步清空图谱里对应节点的 content；');
  console.log('清空后它们会被 `decideProactiveRecall` 的 narrativeFragment.length > 10、');
  console.log('`recallEpisodic` 的空叙事过滤、以及 `selectSeeds` 的空内容过滤挡掉，不再进任何回忆。');
  console.log('要写入请加 --apply。');
  process.exit(0);
}

if (targets.length > 0) {
  if (existsSync(`${FILE}.bak`)) copyFileSync(FILE, `${FILE}.bak.${Date.now()}`);
  else copyFileSync(FILE, `${FILE}.bak`);
  for (const ep of targets) {
    ep.narrativeFragment = '';
    ep.tags = [...new Set([...(ep.tags ?? []), 'narrativeStale'])];
  }
  writeFileSync(FILE, JSON.stringify(raw, null, 1), 'utf8');
  console.log(`\n✓ 已处理 ${targets.length} 条（备份在 ${FILE}.bak*）。`);
  console.log('  注意：**没有**给它们编新的情绪标签或叙事 —— 存量数据不足以反推，编了就是伪造。');
  console.log('  数值（valenceBefore/After/Delta、dominantEmotion、recallWeight、tags 原内容）一律未动。');
}

if (graphCleared > 0 && graphDoc) {
  if (existsSync(`${GRAPH_FILE}.bak`)) copyFileSync(GRAPH_FILE, `${GRAPH_FILE}.bak.${Date.now()}`);
  else copyFileSync(GRAPH_FILE, `${GRAPH_FILE}.bak`);
  writeFileSync(GRAPH_FILE, JSON.stringify(graphDoc, null, 1), 'utf8');
  console.log(`✓ 已同步图谱：清空 ${graphCleared} 个节点 content（备份在 ${GRAPH_FILE}.bak*）`);
} else if (graphDoc) {
  console.log('✓ 图谱已一致，无需同步。');
}
console.log('  `queryMemoryGraph`/`selectSeeds` 也已加空内容过滤 —— 空记忆不当种子、不扩散。');
