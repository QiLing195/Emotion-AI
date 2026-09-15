#!/usr/bin/env node
// ── Obsidian 记忆看板导出器（v2：治理状态 + 待审清单 + 子目录安全导出）──
// 把 memories/*.json（情景记忆 / 记忆图谱 / 语义记忆 / 关系状态 / 治理账本）导出为
// Obsidian vault 风格 markdown，用于人工审查与"养成"可视化。
//
// 用法（v2）：
//   node scripts/export-obsidian.cjs --vault="D:\Lenovo\obsidian\库"
//       → 导出到 <vault>\AI女友记忆\（推荐：只创建/更新自己的子目录，绝不碰库内其它笔记）
//   node scripts/export-obsidian.cjs --out=<目录>
//       → 导出到指定目录（该目录必须为空或为本导出器的专属产物，否则拒绝执行以防误删）
//   node scripts/export-obsidian.cjs                # 默认 ./obsidian_vault
//
// 回写闭环（人工核实）：
//   1. 运行本脚本导出；
//   2. 在 Obsidian 中打开 待审记忆.md / 任意记忆 note，把 frontmatter 的
//      governance_status 改为 verified / rejected（或 verified 改 rolled_back）；
//   3. 运行 npm run obsidian:review -- --vault="D:\Lenovo\obsidian\库" 同步回账本。
// 可重复运行（每次只重建 AI女友记忆/ 子目录），产物不入 git。

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const vaultArg = getArg('vault');
const outArg = getArg('out');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const memoriesDir = path.join(PROJECT_ROOT, 'memories');
const SUBDIR = 'AI女友记忆';

// 解析导出根目录（本脚本只管理这一个目录）
let rootDir;
if (vaultArg) {
  rootDir = path.join(path.resolve(vaultArg), SUBDIR); // 库内专属子目录
} else if (outArg) {
  rootDir = path.resolve(outArg); // 必须为空/专属产物目录
} else {
  rootDir = path.join(PROJECT_ROOT, 'obsidian_vault');
}

// ── 安全守卫：拒绝在"非专属目录"上清空重建 ──
const KNOWN_TOP = new Set(['README.md', '记忆总览.md', '待审记忆.md', '语义记忆.md', '关系状态.md', '情景记忆', '图谱节点']);
if (fs.existsSync(rootDir)) {
  const foreign = fs.readdirSync(rootDir).filter((name) => !KNOWN_TOP.has(name));
  if (foreign.length > 0) {
    console.error(`❌ 拒绝执行：${rootDir} 内含非导出器产物（${foreign.slice(0, 5).join(', ')}…）。`);
    console.error(`   为避免误删你的笔记，请用 --vault 指向 Obsidian 库根目录，`);
    console.error(`   本脚本会创建/更新其下的「${SUBDIR}」子目录，其余内容不受影响。`);
    process.exit(1);
  }
}
fs.rmSync(rootDir, { recursive: true, force: true });
fs.mkdirSync(rootDir, { recursive: true });

const EPISODE_DIR = '情景记忆';
const NODE_DIR = '图谱节点';

// ── 小工具 ──
function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(memoriesDir, name), 'utf-8'));
  } catch {
    return null;
  }
}
function yamlQuote(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"';
}
function sanitize(s, max = 40) {
  let r = String(s ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (r.length > max) r = r.slice(0, max).trim();
  return r || 'untitled';
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
function fmtDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function writeNote(relPath, frontmatter, body) {
  const fmLines = Object.entries(frontmatter)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.map(yamlQuote).join(', ')}]` : `${k}: ${yamlQuote(v)}`));
  const file = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\n${fmLines.join('\n')}\n---\n\n${body}\n`, 'utf-8');
  return relPath;
}
function round4(n) {
  return typeof n === 'number' ? Math.round(n * 10000) / 10000 : n;
}
const STATUS_LABEL = {
  proposed: '🟡 待初评', supported: '🟢 已支持·待核实', ambiguous: '🟠 存疑·待核实',
  verified: '🔵 已核实', rejected: '⚫ 已否定', rolled_back: '⚪ 已回滚',
};
/** 治理指引（供 reviewer 在 Obsidian 中手动改动） */
function reviewHint(status) {
  if (status === 'verified') return '若核实有误：把 governance_status 改为 "rolled_back"。';
  if (status === 'rejected' || status === 'rolled_back') return '';
  if (status === 'ambiguous') return '这条记忆存疑：在 Obsidian 里核实后，把 governance_status 改为 "verified"（确有其事）或 "rejected"（记错/随口）。';
  return '核实后把 governance_status 改为 "verified"（确有其事）或 "rejected"（记错）。改完运行 npm run obsidian:review。';
}

// 治理账本：refType/refId → status
const ledgerRaw = readJson('memory_ledger.json');
const ledgerByRef = new Map(); // `${refType}:${refId}` -> {status, entry}
if (ledgerRaw && Array.isArray(ledgerRaw.entries)) {
  for (const e of ledgerRaw.entries) ledgerByRef.set(`${e.refType}:${e.refId}`, e);
}
const statusOf = (refType, refId) => ledgerByRef.get(`${refType}:${refId}`);

const report = { episodes: 0, nodes: 0, semantic: 0 };
const reviewList = []; // 待核实候选

// ── 1. 情景记忆 → 单篇 md ──
const episodic = readJson('episodic_memory.json');
const episodeStems = new Map(); // id -> 文件名 stem
if (episodic && Array.isArray(episodic.episodes)) {
  for (const ep of episodic.episodes) {
    if (!ep?.id) continue;
    const stem = `${ep.id}_${sanitize(ep.eventSummary || ep.narrativeFragment || '')}`;
    episodeStems.set(ep.id, stem);
    const impact = ep.emotionalImpact || {};
    const emo = impact.dominantEmotion || 'unknown';
    const gov = statusOf('episodic', ep.id);
    const status = gov?.status;
    const fm = {
      id: ep.id,
      type: 'episodic',
      date: fmtDate(ep.timestamp),
      round: ep.roundNumber,
      emotion: emo,
      tags: ['记忆', '情景', ...(Array.isArray(ep.tags) ? ep.tags : [])],
      recall_weight: round4(ep.recallWeight),
      recall_count: ep.recallCount,
      last_recalled_at: fmtDay(ep.lastRecalledAt),
      valence_delta: round4(impact.valenceDelta),
      governance_status: status, // undefined → 旧记忆无账，不输出该键
    };
    const govLines = status
      ? ['', `**🔖 治理**：${STATUS_LABEL[status] ?? status}${gov?.decision ? `（支持分 ${round4(gov.decision.score)}，margin ${round4(gov.decision.margin)}）` : ''}`, `> ${reviewHint(status)}`]
      : ['', '> 🔖 治理上线前的记忆（无账目，按默认放行）'];
    const lines = [
      ep.eventSummary ? `> ${ep.eventSummary}` : '',
      '',
      ep.narrativeFragment || '',
      '',
      `**当时情绪**：${emo}`,
      `**效价变化**：${round4(impact.valenceBefore)} → ${round4(impact.valenceAfter)}（Δ ${round4(impact.valenceDelta)}），唤醒峰值 ${round4(impact.arousalPeak)}`,
      `**回想**：${ep.recallCount ?? 0} 次 · 权重 ${round4(ep.recallWeight)}${ep.lastRecalledAt ? ' · 上次 ' + fmtDay(ep.lastRecalledAt) : ''}`,
      ...govLines,
      '',
      '[[记忆总览]]',
    ];
    writeNote(`${EPISODE_DIR}/${stem}.md`, fm, lines.filter(Boolean).join('\n'));
    report.episodes++;
    if (status && (status === 'supported' || status === 'ambiguous' || status === 'proposed')) {
      reviewList.push({
        refId: ep.id, stem, status, kind: 'episodic',
        decision: gov?.decision,
        summary: String(ep.eventSummary ?? '').slice(0, 40),
      });
    }
  }
}

// ── 2. 记忆图谱 → 节点 md（含关联链接）──
const graph = readJson('memory_graph.json');
const nodeStems = new Set();
if (graph && Array.isArray(graph.nodes)) {
  for (const n of graph.nodes) if (n?.id) nodeStems.add(n.id);
  const edgesByNode = new Map();
  for (const e of graph.edges || []) {
    if (!e?.sourceNodeId || !e?.targetNodeId) continue;
    for (const [from, to] of [[e.sourceNodeId, e.targetNodeId], [e.targetNodeId, e.sourceNodeId]]) {
      if (!nodeStems.has(to)) continue;
      if (!edgesByNode.has(from)) edgesByNode.set(from, []);
      edgesByNode.get(from).push({ other: to, type: e.type || 'link', weight: e.weight ?? 0 });
    }
  }
  for (const n of graph.nodes) {
    if (!n?.id) continue;
    const edges = (edgesByNode.get(n.id) || [])
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 25);
    const sig = n.emotionalSignature || {};
    const sourceRefType = n.source === 'episodic' ? 'episodic' : null;
    const gov = sourceRefType && n.sourceId ? statusOf(sourceRefType, n.sourceId) : undefined;
    const fm = {
      id: n.id,
      type: 'graph_node',
      source: n.source,
      emotion: sig.dominantEmotion,
      tags: ['记忆', '图谱', ...(Array.isArray(n.tags) ? n.tags : [])],
      weight: round4(n.weight),
      activation_count: n.activationCount,
      decay_rate: round4(n.decayRate),
      archived: n.archived === true,
      date: fmtDay(n.createdAt),
      last_activated_at: fmtDay(n.lastActivatedAt),
    };
    const neighborLines = edges.length
      ? ['**关联记忆**（前 ' + edges.length + ' 条）：', ...edges.map((e2) => `- [[${e2.other}]] — ${e2.type} · ${round4(e2.weight)}`)]
      : ['_（暂无关联）_'];
    const extra = n.metadata?.eventSummary ? `\n> ${n.metadata.eventSummary}` : '';
    const body = [
      n.content || '',
      extra,
      '',
      `**情绪签名**：${sig.dominantEmotion ?? '-'}（效价 ${round4(sig.valence)}，唤醒 ${round4(sig.arousal)}）`,
      ...(n.archived ? ['', '> ⚠️ 已归档（低活跃）'] : []),
      '',
      ...neighborLines,
      '',
      '[[记忆总览]]',
    ].filter((l) => l !== '');
    writeNote(`${NODE_DIR}/${n.id}.md`, fm, body.join('\n'));
    report.nodes++;
  }
}

// ── 3. 语义记忆 → 聚合页 ──
const semantic = readJson('semantic_memory.json');
let semanticLines = ['> 语义记忆：反复出现的关键短语及其情绪效价累积。', '', '| 短语 | 效价 | 出现次数 | 最近 |', '| --- | --- | --- | --- |'];
if (semantic && typeof semantic === 'object') {
  for (const [phrase, meta] of Object.entries(semantic)) {
    report.semantic++;
    semanticLines.push(
      `| ${String(phrase).replace(/\|/g, '\\|')} | ${round4(meta?.totalValence)} | ${meta?.occurrences ?? meta?.count ?? ''} | ${fmtDay(meta?.lastSeen)} |`,
    );
  }
}
writeNote('语义记忆.md', { type: 'aggregate', tags: ['记忆', '语义'] }, semanticLines.join('\n'));

// ── 4. 关系状态 → 摘要页 ──
const rel = readJson('relationship_state_v2.json');
if (rel) {
  const stageLabel = { stranger: '陌生人', acquaintance: '相识', friend: '朋友', crush: '暧昧', lover: '恋人', soulmate: '灵魂伴侣' };
  const dimLines = [];
  if (rel.dimensions && typeof rel.dimensions === 'object') {
    for (const [k, v] of Object.entries(rel.dimensions)) {
      if (typeof v === 'number') dimLines.push(`- **${k}**: ${round4(v)}`);
    }
  }
  const body = [
    `**当前阶段**：${stageLabel[rel.stage] ?? rel.stage}（boundary: ${rel.boundaryStatus ?? '-'}）`,
    `**开始于**：${fmtDay(rel.createdAt)} · **更新于**：${fmtDay(rel.updatedAt)}`,
    `**证据事件**：${rel.evidence?.length ?? 0} 条`,
    '',
    '## 关系维度',
    ...(dimLines.length ? dimLines : ['_（无）_']),
    '',
    '[[记忆总览]]',
  ].join('\n');
  writeNote('关系状态.md', { type: 'relationship', tags: ['关系'] }, body);
}

// ── 5. 待审清单（reviewer 入口）──
{
  const header = [
    '> 这里是**待你核实**的记忆候选（supported/ambiguous/proposed，尚未被人工 verified）。',
    '> **如何核实**：点开笔记 → 把 frontmatter 里 `governance_status` 改为 `"verified"`（确有其事）',
    '> 或 `"rejected"`（记错/随口）→ 保存 → 在项目目录运行',
    '> `npm run obsidian:review -- --vault="<你的库路径>"` 同步回账本。',
    '',
    `共 ${reviewList.length} 条待核实。`,
    '',
    '| 状态 | 记忆 | 支持分 | margin | 建议 |',
    '| --- | --- | --- | --- | --- |',
  ];
  const rows = reviewList
    .sort((a, b) => (b.decision?.score ?? 0) - (a.decision?.score ?? 0))
    .map((r) => `| ${STATUS_LABEL[r.status] ?? r.status} | [[${r.stem}]] — ${r.summary.replace(/\|/g, '\\|')} | ${round4(r.decision?.score)} | ${round4(r.decision?.margin)} | 核实后改 verified / rejected |`);
  writeNote('待审记忆.md', { type: 'review_queue', tags: ['记忆', '审查'] }, [...header, ...(rows.length ? rows : ['_（全部已核实 🎉）_']), '', '[[记忆总览]]'].join('\n'));
}

// ── 6. 记忆总览（MOC）──
{
  const statusCounts = {};
  for (const e of ledgerRaw?.entries ?? []) {
    if (e.status) statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
  }
  const overview = [
    '> 本 vault 由 `npm run obsidian:export -- --vault=<库路径>` 生成，用于人工审查 AI 的记忆。',
    '> **可重复生成**：每次对话后重跑即可刷新（只更新本「AI女友记忆」目录）。',
    '',
    '## 统计',
    `- 情景记忆：${report.episodes} 条 · 图谱节点：${report.nodes} 个 · 语义记忆：${report.semantic} 条`,
    ...(rel ? [`- 关系阶段：${rel.stage}（boundary ${rel.boundaryStatus}）`] : []),
    `- 治理账本：${ledgerRaw?.entries?.length ?? 0} 条候选` + (Object.keys(statusCounts).length ? `（${Object.entries(statusCounts).map(([k, v]) => `${STATUS_LABEL[k] ?? k} ${v}`).join('，')}）` : ''),
    '',
    `## 🔎 待你核实（${reviewList.length}）`,
    reviewList.length ? `- [[待审记忆]] — 打开清单逐条核实` : '- _（全部已核实 🎉）_',
    '',
    '## 情景记忆（按时间）',
    ...(episodic?.episodes
      ? [...episodic.episodes]
          .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .map((ep) => {
            const stem = episodeStems.get(ep.id);
            const day = fmtDay(ep.timestamp);
            const st = statusOf('episodic', ep.id)?.status;
            const mark = st === 'verified' ? ' ✅' : st === 'rejected' || st === 'rolled_back' ? ' ⛔' : st === 'ambiguous' ? ' 🟠' : '';
            return `- [[${stem ?? ep.id}]] — ${day} — ${String(ep.eventSummary ?? '').slice(0, 40)}${ep.recallCount ? ` （想起 ${ep.recallCount} 次）` : ''}${mark}`;
          })
      : ['_（暂无）_']),
    '',
    '## 常用链接',
    '- [[语义记忆]] · [[关系状态]]',
  ].join('\n');
  writeNote('记忆总览.md', { type: 'moc', tags: ['记忆'] }, overview);
}

// ── README ──
writeNote(
  'README.md',
  { type: 'readme' },
  [
    '# AI 女友 · 记忆看板（AI女友记忆/）',
    '',
    '本目录由导出器生成，是 AI 记忆的**只读镜像 + 人工核实台**。',
    '',
    '## 刷新（每次对话后）',
    '```bash',
    'npm run obsidian:export -- --vault="D:\\Lenovo\\obsidian\\库"',
    '```',
    '',
    '## 人工核实（reviewer 工作流）',
    '1. 打开 [[待审记忆]] 或任意记忆 note；',
    '2. 编辑 frontmatter 的 `governance_status`：确有其事 → `"verified"`；记错/随口 → `"rejected"`；已核实但后来发现错了 → `"rolled_back"`；',
    '3. 保存后在项目目录运行：',
    '```bash',
    'npm run obsidian:review -- --vault="D:\\Lenovo\\obsidian\\库"',
    '```',
    '4. 回写会以 `reviewer:obsidian` 身份记入治理账本审计（只有你能 verify）。',
    '',
    '## 状态图例',
    '- 🟡 proposed 待初评 · 🟢 supported 已支持（待你核实）· 🟠 ambiguous 存疑 · 🔵 verified 已核实 · ⚫ rejected 已否定 · ⚪ rolled_back 已回滚',
    '',
    '> 运行时会重建本目录全部内容；请勿在「AI女友记忆」之外放置个人笔记（重建不影响库内其它文件夹）。',
  ].join('\n'),
);

console.log('Obsidian 导出完成 →', rootDir);
console.log(`  情景记忆 ${report.episodes} 篇 · 图谱节点 ${report.nodes} 篇 · 语义记忆 ${report.semantic} 条 · 待核实 ${reviewList.length} 条`);
