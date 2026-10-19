/**
 * jev 影子账本的**离线分歧分析（v1 语义）** —— 只读，不调用模型、不写文件。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-divergence.ts [目录或文件…] [--aggregate]
 *
 * v1 与 v0 的关键区别：v1 加了**权限闸门**（只接管冲突类），且仍是影子（永不生效）。
 * 因此必须分开报告：
 *   · **生效行为**：影子下永远等于规则（不是证据，只是事实）
 *   · **意图**（wouldOverride）：jev 若有权会不会改判 —— ② 判据量的就是这个
 *   · **权限**（authority）：非冲突轮必须是 none（结构性判据 ④）
 *
 * 预登记判据（v1，跑之前写死）：
 *   ① 冲突族：jev 意图有分歧 ≥1，且方向符合（代理：不用 HE_RISES_SHE_STEADY）
 *   ② 非冲突族：jev **意图**与规则一致率 ≥ 80%
 *   ③ 失败率（超时/解析/校验）≤ 2%
 *   ④ 结构性：非冲突轮 authority 全为 'none'；冲突轮全为 'conflict_only'
 * 监测项（不作通过条件）：动作分布、延迟 p90、分歧率
 * n<20 时只报数、不下结论。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  hasLowMoodEvidence,
  isConflictClass,
  type JevShadowRecord,
} from '../server/services/jevShadow.js';

const args = process.argv.slice(2);
const aggregate = args.includes('--aggregate');
const targets = args.filter(a => !a.startsWith('--'));
const paths = targets.length > 0 ? targets : ['artifacts/v1.59'];

function collectFiles(list: string[]): string[] {
  const out: string[] = [];
  for (const p of list) {
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        for (const name of readdirSync(p)) if (name.endsWith('.jsonl')) out.push(join(p, name));
      } else if (p.endsWith('.jsonl')) out.push(p);
    } catch { /* 忽略 */ }
  }
  return out.sort();
}

interface Row { file: string; rec: JevShadowRecord }

function load(files: string[]): Row[] {
  const rows: Row[] = [];
  for (const f of files) {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as JevShadowRecord;
        if (rec && rec.input && rec.input.his_turn) rows.push({ file: f, rec });
      } catch { /* 半行跳过 */ }
    }
  }
  return rows;
}

function pct(a: number, b: number): string {
  return b === 0 ? 'NA' : `${((a / b) * 100).toFixed(1)}%`;
}

/** 兼容 v0 账本（无 conflictClass/authority 字段时按输入推算） */
/**
 * ⚠️ 始终按**当前定义**重算，不信任记录里的 `conflictClass`：
 * 2026-10-19 发现冲突类阈值定义有缺陷（用了 0.05 而非项目既有 0.12 语义），
 * 修正后必须重算，否则旧标签会把 ①/② 的分析带偏。
 */
function conflictOf(rec: JevShadowRecord): boolean {
  return isConflictClass(rec.input);
}

/** 记录里当时写入的 conflictClass（用于展示"定义修正影响了多少条"） */
function storedConflictOf(rec: JevShadowRecord): boolean | null {
  return typeof rec.conflictClass === 'boolean' ? rec.conflictClass : null;
}

function authorityOf(rec: JevShadowRecord): string {
  if (typeof rec.authority === 'string') return rec.authority;
  return conflictOf(rec) ? 'conflict_only' : 'none';
}

function analyze(rows: Row[], label: string): void {
  const n = rows.length;
  const valid = rows.filter(r => r.rec.jev);
  const errors = rows.filter(r => !r.rec.jev);
  const conflictRows = rows.filter(r => conflictOf(r.rec));
  const nonConflictRows = rows.filter(r => !conflictOf(r.rec));
  const conflictValid = conflictRows.filter(r => r.rec.jev);
  const nonConflictValid = nonConflictRows.filter(r => r.rec.jev);

  const intentAgree = valid.filter(r => r.rec.agree === true);
  const intentOverride = valid.filter(r => r.rec.agree === false);
  const nonConflictIntentAgree = nonConflictValid.filter(r => r.rec.agree === true);
  const conflictDiverge = conflictValid.filter(r => r.rec.agree === false);

  console.log(`\n=== ${label} ===`);
  console.log(`  记录 ${n} ｜ 有效 ${valid.length} ｜ 失败 ${errors.length}（${pct(errors.length, n)}）`);
  console.log(`  意图一致 ${intentAgree.length}/${valid.length}（${pct(intentAgree.length, valid.length)}）｜ 意图改判 ${intentOverride.length}`);
  console.log(`  冲突轮 ${conflictRows.length}（有效 ${conflictValid.length}，意图分歧 ${conflictDiverge.length}）｜ 非冲突轮 ${nonConflictRows.length}（有效 ${nonConflictValid.length}）`);

  const byErr = new Map<string, number>();
  for (const r of errors) byErr.set(r.rec.errorCode ?? 'UNKNOWN', (byErr.get(r.rec.errorCode ?? 'UNKNOWN') ?? 0) + 1);
  const reclass = rows.filter(r => storedConflictOf(r.rec) !== null && storedConflictOf(r.rec) !== conflictOf(r.rec)).length;
  if (reclass > 0) console.log(`  ⚠️ 定义修正影响：${reclass} 条记录的 conflictClass 与当前定义不符（已按当前定义重算，不信任旧标签）`);
  if (byErr.size) console.log(`  失败分布: ${[...byErr].map(([k, v]) => `${k}=${v}`).join(' ｜ ')}`);
  for (const r of errors.slice(0, 5)) {
    console.log(`    - ${r.rec.turnId} ${r.rec.errorCode} raw=${String(r.rec.rawHead ?? '').slice(0, 90)}`);
  }

  // reason_code 聚合
  const byReason = new Map<string, { n: number; agree: number; actions: Set<string> }>();
  for (const r of valid) {
    const code = r.rec.jev!.reason_code;
    const slot = byReason.get(code) ?? { n: 0, agree: 0, actions: new Set<string>() };
    slot.n++;
    if (r.rec.agree) slot.agree++;
    slot.actions.add(r.rec.jev!.action);
    byReason.set(code, slot);
  }
  if (byReason.size) {
    console.log('  按 reason_code:');
    for (const [code, s] of [...byReason].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${code.padEnd(22)} n=${String(s.n).padStart(2)} agree=${s.agree} actions=${[...s.actions].join('/')}`);
    }
  }

  // 监测项：动作分布
  const acts = new Map<string, number>();
  for (const r of valid) acts.set(r.rec.jev!.action, (acts.get(r.rec.jev!.action) ?? 0) + 1);
  const lat = valid.map(r => r.rec.latencyMs).sort((a, b) => a - b);
  console.log(`  监测：动作分布 ${[...acts].map(([k, v]) => `${k}=${v}`).join(' ')} ｜ 延迟 p50=${lat[Math.floor(lat.length / 2)] ?? 'NA'}ms p90=${lat[Math.floor(lat.length * 0.9)] ?? 'NA'}ms`);

  // 预登记判据
  const familyDirOk = conflictDiverge.filter(r => r.rec.jev!.reason_code !== 'HE_RISES_SHE_STEADY').length;
  const c1 = conflictValid.length > 0 && conflictDiverge.length > 0 && familyDirOk === conflictDiverge.length;
  const nonConflictIntentRate = nonConflictValid.length ? nonConflictIntentAgree.length / nonConflictValid.length : NaN;
  const c2 = Number.isFinite(nonConflictIntentRate) ? nonConflictIntentRate >= 0.8 : null;
  const failRate = n ? errors.length / n : NaN;
  const c3 = Number.isFinite(failRate) ? failRate <= 0.02 : null;
  const gateBad = conflictRows.filter(r => authorityOf(r.rec) !== 'conflict_only').length
    + nonConflictRows.filter(r => authorityOf(r.rec) !== 'none').length;
  const c4 = gateBad === 0;
  const enough = n >= 20;
  const c1s = conflictValid.length === 0 ? 'NA' : (c1 ? 'PASS(代理)' : 'FAIL');
  const c2s = c2 === null ? 'NA' : (c2 ? 'PASS' : 'FAIL');
  const c3s = c3 === null ? 'NA' : (c3 ? 'PASS' : 'FAIL');

  console.log('  预登记判据（v1）:');
  console.log(`    ① 冲突族有分歧且方向符合 : ${c1s}（有效 ${conflictValid.length}，分歧 ${conflictDiverge.length}）`);
  console.log(`    ② 非冲突族意图一致率≥80% : ${c2s}（${pct(nonConflictIntentAgree.length, nonConflictValid.length)}，n=${nonConflictValid.length}）`);
  console.log(`    ③ 失败率 ≤ 2%            : ${c3s}（${pct(errors.length, n)}）`);
  console.log(`    ④ 权限闸门结构性正确      : ${c4 ? 'PASS' : `FAIL（${gateBad} 条 authority 不符）`}`);
  console.log(`    样本充分性(n≥20)         : ${enough ? 'OK' : `不足（n=${n}）`}`);
  if (!enough) {
    console.log('    判定: **insufficient-sample** —— 不得据此宣布 jev 有价值/无价值');
  } else {
    const pass = c1 !== false && c2 !== false && c3 !== false && c4;
    console.log(`    判定: ${pass ? '**值得继续**（四条件同时满足）' : '**停在这里**（任一不满足）'}`);
  }

  if (conflictDiverge.length) {
    console.log('  冲突族意图分歧明细:');
    for (const r of conflictDiverge) {
      const i = r.rec.input;
      console.log(`    - ${r.rec.turnId} 他=${i.his_turn.emotion}(${i.his_turn.intensity}) 她low=${hasLowMoodEvidence(i)} v=${i.her_state.valence.toFixed(3)}`);
      console.log(`        规则 ${i.rules_default.action}/${i.rules_default.motive_id ?? '-'} ｜ ${i.rules_default.reason_text || i.rules_default.reason_code}`);
      console.log(`        jev  ${r.rec.jev!.action}/${r.rec.jev!.motive_id ?? '-'} ${r.rec.jev!.reason_code} ｜ ${r.rec.jev!.inner_line}`);
    }
  }
  if (nonConflictValid.filter(r => r.rec.agree === false).length) {
    console.log('  非冲突族意图分歧（② 的扣分项）:');
    for (const r of nonConflictValid.filter(r => r.rec.agree === false).slice(0, 6)) {
      const i = r.rec.input;
      console.log(`    - ${r.rec.turnId} 他=${i.his_turn.emotion} ｜ 规则 ${i.rules_default.action}/${i.rules_default.motive_id ?? '-'} vs jev ${r.rec.jev!.action}/${r.rec.jev!.motive_id ?? '-'} ${r.rec.jev!.reason_code}`);
    }
  }
}

const files = collectFiles(paths);
if (files.length === 0) {
  console.log('没有找到 jsonl 账本。');
  process.exit(0);
}
console.log(`读取 ${files.length} 个账本: ${files.map(f => f.split(/[\\/]/).pop()).join(', ')}`);
const all = load(files);
for (const f of files) analyze(all.filter(r => r.file === f), f.split(/[\\/]/).pop() ?? f);

if (aggregate) {
  if (files.length > 1) {
    console.log('\n⚠️ 警告：跨文件合计。仅当这些账本来自**同一实现版本**时结论才有效；混版本 = 无效结论。');
  }
  analyze(all, '合计（--aggregate，仅同版本有效）');
} else {
  console.log('\n（已跳过跨文件合计；需要时加 --aggregate）');
}
