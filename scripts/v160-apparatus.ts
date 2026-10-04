// v1.60 测量装置 CLI —— **只造测量装置**（不实现 B 臂文案、不改任何生产逻辑）。
//
// 用法：node node_modules/tsx/dist/cli.mjs scripts/v160-apparatus.ts
//
// 产出：artifacts/v1.60/{fixtures/F01..F24.json, fixture-manifest.jsonl, arm-manifest.jsonl,
//                      apparatus-metadata.json, raw/, annotation/, analysis/}
// 自检：结构自检 / anchors 一致性 / 盲标包不含 arm 且隔离 / Prompt diff / 运行时护栏 / 配对统计
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  V160_REGIME, V160_CATEGORIES, validateFixture, checkAnchorsConsistency, diffPrompts,
  buildBlindPack, assertArmIsolation, runtimeGuardErrors, pairedSummary,
  type V160Fixture, type V160Category, type ResponseRow,
} from '../src/lib/v160Apparatus.js';

const ROOT = 'artifacts/v1.60';
const SEED = 20261004;   // 盲标打乱 seed（写入元数据，保证可复现）

let n = 0; const fails: string[] = [];
const check = (cond: boolean, msg: string, got?: unknown) => {
  n += 1;
  if (cond) console.log('  ✓ ' + msg);
  else { fails.push(msg); console.log('  ✗ ' + msg + ' ｜ 实际=' + JSON.stringify(got)); }
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// ── 1. 展开编制表 → 规范要求的 24 个 fixture ──
interface SourceRow { case_id: string; category: string; user_input: string; anchors: string[]; priority: number; memory: string }
const src = JSON.parse(readFileSync(ROOT + '/fixtures/fixture-source.json', 'utf8')) as { _common: Record<string, unknown>; fixtures: SourceRow[] };
const C = src._common;
const rows = src.fixtures;

const fixtures: V160Fixture[] = rows.map(r => {
  const memoryId = 'm' + r.case_id.slice(1);   // 纯索引，不承载语义（纪律 #3）
  const prov = { owner: C.provenance_owner as 'user', subject: C.provenance_subject as 'user', memoryId, anchors: r.anchors };
  return {
    case_id: r.case_id,
    category: r.category as V160Category,
    user_input: r.user_input,
    initial_emotion_state: C.initial_emotion_state as { profile: string },
    initial_strategy_context: {},
    memory_state: {
      pool: [{
        id: memoryId, kind: 'memory_echo', content: r.memory, source: { memoryId }, memoryId,
        provenance: { owner: prov.owner, source: 'user_message', subject: prov.subject, evidenceId: memoryId, anchors: r.anchors },
        salience: r.priority, base: r.priority, formedAt: '@now', expiresAt: '@now+5d', attempts: 0, action: 'share',
      }],
      pendingCandidates: [],
    },
    motive_fixture: { kind: 'memory_echo', action: 'share', priority: r.priority, content: r.memory, memoryId },
    expected: { motive_action: 'share', strategy: 'share' },
    provenance: prov,
    constraints: { max_output_tokens: C.max_output_tokens as number },
  };
});

console.log('v1.60 装置自检 ｜ regime: ENABLE_MOTIVE_ACTION_STRATEGY=' + V160_REGIME.ENABLE_MOTIVE_ACTION_STRATEGY
  + ' ｜ LAYA_STRATEGY=' + V160_REGIME.LAYA_STRATEGY + '\n');

console.log('[1] fixture 结构自检');
const allIds = fixtures.map(f => f.case_id);
const structErrors = fixtures.flatMap(f => validateFixture(f, allIds));
check(fixtures.length === 24, 'fixture 数 = 24', fixtures.length);
check(structErrors.length === 0, '24 格结构自检 0 错', structErrors.slice(0, 5));
check(new Set(allIds).size === 24, 'case_id 唯一', new Set(allIds).size);
const byCat = new Map<string, number>();
for (const f of fixtures) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
check(V160_CATEGORIES.length === 6 && V160_CATEGORIES.every(c => byCat.get(c) === 4), '6 类 × 4', Object.fromEntries(byCat));
check(fixtures.every(f => f.provenance.anchors.length >= 2), 'anchors 均非空（≥2）');
check(fixtures.every(f => !/说说你自己|分享一个你的经历/.test(f.user_input)), 'user_input 无「显式要求她分享」');

console.log('\n[2] 写入 fixture 文件 + sha256 manifest');
mkdirSync(ROOT + '/fixtures', { recursive: true });
for (const d of ['raw', 'annotation', 'analysis']) mkdirSync(ROOT + '/' + d, { recursive: true });
const manifestLines: string[] = [];
for (const f of fixtures) {
  const text = JSON.stringify(f, null, 2) + '\n';
  const p = ROOT + '/fixtures/' + f.case_id + '.json';
  const prev = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (prev !== null && sha(prev) !== sha(text)) console.log('  ⚠️ 装置变更：' + f.case_id + ' 的 sha256 与既有文件不同（封条：视为装置变更）');
  writeFileSync(p, text, 'utf8');
  manifestLines.push(JSON.stringify({ case_id: f.case_id, category: f.category, path: p, sha256: sha(text), memoryId: f.provenance.memoryId, anchors: f.provenance.anchors, expected: f.expected }));
}
writeFileSync(ROOT + '/fixture-manifest.jsonl', manifestLines.join('\n') + '\n', 'utf8');
check(manifestLines.length === 24, 'fixture-manifest 24 行', manifestLines.length);
check(existsSync(ROOT + '/fixtures/F01.json') && existsSync(ROOT + '/fixtures/F24.json'), 'F01/F24 文件已落盘');

console.log('\n[3] anchors 一致性（装置规范 §6）');
check(fixtures.every(f => checkAnchorsConsistency(f.provenance.anchors, [...f.provenance.anchors]).length === 0), '同 fixture 两臂 anchors 逐字相同（0 错）');
check(checkAnchorsConsistency(['海边'], ['海边', '海']).length > 0, '反例：anchors 不同 ⇒ 报错', checkAnchorsConsistency(['海边'], ['海边', '海']));
check(checkAnchorsConsistency(undefined, ['海']).length > 0, '反例：anchors 缺失 ⇒ 报错');

console.log('\n[4] Prompt diff（负对照要求 identical；真实 A/B 应只差 fragment 区间）');
const pSame = 'A块…B块…【share 片段】…尾部';
check(diffPrompts(pSame, pSame).identical, '同串 ⇒ identical=true');
const fragA = 'HEAD|share片段-原文|TAIL', fragB = 'HEAD|share片段-改写|TAIL';
const d = diffPrompts(fragA, fragB);
const fragStart = fragA.indexOf('share片段-');   // 期望的 diff 起点 = fragment 起点（不写死数字）
check(!d.identical && d.firstDiffAt > fragStart && d.firstDiffAt < fragStart + 40, '仅 fragment 不同 ⇒ diff 起点落在 fragment 区内（起点=' + fragStart + '）', d);
check(d.lastDiffAt >= fragStart && d.lastDiffAt <= fragStart + 40, 'diff 末位落在 fragment 内', d);

console.log('\n[5] 盲标包与 arm-manifest 隔离（装置规范 §8/§9）');
const synthetic: ResponseRow[] = fixtures.flatMap(f => (['A', 'B'] as const).map(arm => ({
  case_id: f.case_id, arm, user_input: f.user_input, assistant_output: '（自检用合成输出 ' + arm + '）',
})));
const { pack, errors: packErrors } = buildBlindPack(synthetic, SEED);
check(pack.every(r => !('arm' in (r as unknown as Record<string, unknown>))), '盲标包不含 arm 字段');
check(packErrors.length === 0, '盲标包结构 0 错', packErrors);
check(pack.length === 48, '盲标包 48 行（24 对）', pack.length);
const armManifest = pack.map((r, i) => {
  const pid = 'P' + String(i + 1).padStart(2, '0');
  const owner = synthetic.find(s => s.case_id === r.case_id && s.assistant_output === r.assistant_output);
  return { pack_id: pid, case_id: r.case_id, arm: (owner?.arm ?? 'A') as 'A' | 'B' };
});
writeFileSync(ROOT + '/arm-manifest.jsonl', armManifest.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf8');
check(assertArmIsolation(pack, armManifest).length === 0, 'arm-manifest 与盲标包隔离 0 错');
const alternating = armManifest.map(m => m.arm).every((a, i, arr) => i < 2 || a === arr[i - 2]);
check(!alternating, 'arm 顺序非严格交替（防标注者看穿）');
check(armManifest.length === 48 && new Set(armManifest.map(m => m.pack_id)).size === 48, 'pack_id 唯一（P01…P48）');
// 自检产物与被隔离，不污染 raw/
writeFileSync(ROOT + '/analysis/apparatus-selfcheck-pack.jsonl', pack.map((r, i) => JSON.stringify({ pack_id: 'P' + String(i + 1).padStart(2, '0'), ...r })).join('\n') + '\n', 'utf8');
check(!existsSync(ROOT + '/annotation/annotation-pack.jsonl'), 'annotation/ 未写入合成包（真实标注包待生成后写）');

console.log('\n[6] 运行时结构护栏（§11：不满足 ⇒ fixture_invalid，不进 SIC 分析）');
check(runtimeGuardErrors({ motiveAction: 'share', strategy: 'share', commitCount: 1, strategySelectedCount: 1 }).length === 0, '四条件齐备 ⇒ 0 错');
check(runtimeGuardErrors({ motiveAction: 'share', strategy: 'explore', commitCount: 1, strategySelectedCount: 1 }).length === 1, 'strategy=explore ⇒ 捕获（该 pair 标 fixture_invalid）');
check(runtimeGuardErrors({ motiveAction: 'ask', strategy: 'explore', commitCount: 1, strategySelectedCount: 1 }).length === 2, 'action/strategy 双错 ⇒ 捕获 2 条');

console.log('\n[7] 配对统计（§15：observed / noise / threshold 分开放）');
const sic: Array<{ case_id: string; arm: 'A' | 'B'; sic: 0 | 1 }> = [
  { case_id: 'F01', arm: 'A', sic: 0 }, { case_id: 'F01', arm: 'B', sic: 1 },
  { case_id: 'F02', arm: 'A', sic: 0 }, { case_id: 'F02', arm: 'B', sic: 0 },
  { case_id: 'F03', arm: 'A', sic: 1 }, { case_id: 'F03', arm: 'B', sic: 1 },
  { case_id: 'F04', arm: 'A', sic: 1 }, { case_id: 'F04', arm: 'B', sic: 0 },
];
const ps = pairedSummary(sic);
check(ps.a === 2 && ps.b === 2 && ps.bOnly === 1 && ps.aOnly === 1 && ps.tie === 2, 'B-only/A-only/tie 计算正确', ps);
check(ps.pairedDiff === 0, 'pairedDiff = B-only − A-only = 0', ps.pairedDiff);

console.log('\n[8] 元数据（regime 作为环境参数记录，不是实验变量）');
const meta = {
  experiment: 'v1.60-expression-self-initiation', phase: 'apparatus',
  generatedAt: new Date().toISOString(), blindSeed: SEED,
  regime: V160_REGIME,
  attributionIsolation: 'v1.60 不检验 Motive.action→Strategy=share（属 C-2 既有结论）；「share 生效」不计入 v1.60 收益。',
  preRunClarification: {
    pack_id: '盲标包每行加 pack_id（P01…P48）：一 case 有 A/B 两行，仅凭 case_id 无法区分行 ⇒ 标注不可执行。此为**运行前**格式澄清，不涉及任何显示过结果后的规则改动。',
    fixtureFileFormat: '规范写 F01.yaml…F24.yaml，实现用 F01.json…F24.json（格式声明，语义不变）。',
  },
  fixtureCount: fixtures.length, categories: V160_CATEGORIES,
  armManifestRows: armManifest.length,
  note: '本阶段只造测量装置：不含 B 臂操纵文案，不含任何生产逻辑改动。',
};
writeFileSync(ROOT + '/apparatus-metadata.json', JSON.stringify(meta, null, 2) + '\n', 'utf8');
writeFileSync(ROOT + '/analysis/apparatus-selfcheck.json', JSON.stringify({ assertions: n, failed: fails, pass: fails.length === 0, regime: V160_REGIME, blindSeed: SEED }, null, 2) + '\n', 'utf8');
check(existsSync(ROOT + '/apparatus-metadata.json') && existsSync(ROOT + '/analysis/apparatus-selfcheck.json'), '元数据与自检报告已落盘');

console.log('\nASSERTIONS: ' + (n - fails.length) + '/' + n);
console.log('RESULT: ' + (fails.length === 0 ? 'PASS' : 'FAIL'));
if (fails.length) console.log('未通过：\n  - ' + fails.join('\n  - '));
process.exit(fails.length === 0 ? 0 : 1);
