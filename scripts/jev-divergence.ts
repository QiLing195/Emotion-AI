/**
 * jev 影子账本的**离线分歧分析**（只读，不调用模型、不写任何文件）
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/jev-divergence.ts [目录或文件…]
 *   默认读 artifacts/v1.59/
 *
 * 预登记判据（在看数据之前就定过，见 jev 设计）：
 *   ① 已知失败族上 jev 与规则不同、且方向符合人设（本条给出**机械代理**，仍需人工判读样本）
 *   ② 非冲突类上与规则一致率 ≥ 80%（避免"到处乱改"）
 *   ③ 失败率（解析/超时/校验）≤ 2%
 *   三者同时满足才"值得继续"；任一不满足 ⇒ 结论是"jev 无价值/不可判"。
 *   ⚠️ 样本 < 20 条时一律只报数、不下结论（"insufficient-sample"）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hasLowMoodEvidence, type JevShadowRecord } from '../server/services/jevShadow.js';

const POSITIVE = new Set(['joy', 'gratitude', 'love', 'excitement', 'happy']);

const args = process.argv.slice(2);
const aggregate = args.includes('--aggregate');
const targets = args.filter(a => !a.startsWith('--'));
const paths = targets.length > 0 ? targets : ['artifacts/v1.59'];

function collectFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        for (const name of readdirSync(p)) {
          if (name.endsWith('.jsonl')) out.push(join(p, name));
        }
      } else if (p.endsWith('.jsonl')) {
        out.push(p);
      }
    } catch {
      // 忽略不存在的路径
    }
  }
  return out.sort();
}

interface Row {
  file: string;
  rec: JevShadowRecord;
}

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
      } catch {
        // 半行/坏行跳过（账本是 append-only，允许最后一行不完整）
      }
    }
  }
  return rows;
}

/** 冲突信号：她低落 × 他报喜/平常事（v1.38 / v1.42 族） */
function isConflictSignal(rec: JevShadowRecord): boolean {
  const low = hasLowMoodEvidence(rec.input);
  const his = String(rec.input.his_turn.emotion || '').toLowerCase();
  return low && (POSITIVE.has(his) || his === 'neutral');
}

function pct(a: number, b: number): string {
  if (b === 0) return 'NA';
  return `${((a / b) * 100).toFixed(1)}%`;
}

function analyze(rows: Row[], label: string): void {
  const n = rows.length;
  const valid = rows.filter(r => r.rec.jev);
  const errors = rows.filter(r => !r.rec.jev);
  const agree = valid.filter(r => r.rec.agree === true);
  const conflictRows = rows.filter(r => isConflictSignal(r.rec));
  const nonConflictValid = valid.filter(r => !isConflictSignal(r.rec));
  const nonConflictAgree = nonConflictValid.filter(r => r.rec.agree === true);

  console.log(`\n=== ${label} ===`);
  console.log(`  记录数 ${n} ｜ 有效决策 ${valid.length} ｜ 失败 ${errors.length}（${pct(errors.length, n)}）｜ 一致 ${agree.length}/${valid.length}（${pct(agree.length, valid.length)}）`);

  const byErr = new Map<string, number>();
  for (const r of errors) byErr.set(r.rec.errorCode ?? 'UNKNOWN', (byErr.get(r.rec.errorCode ?? 'UNKNOWN') ?? 0) + 1);
  if (byErr.size) console.log(`  失败分布: ${[...byErr].map(([k, v]) => `${k}=${v}`).join(' ｜ ')}`);
  if (errors.length) {
    for (const r of errors.slice(0, 5)) {
      console.log(`    - ${r.rec.turnId} ${r.rec.errorCode} raw=${String(r.rec.rawHead ?? '').slice(0, 90)}`);
    }
  }

  // 按 reason_code 聚合
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

  // 预登记判据
  const conflictValid = conflictRows.filter(r => r.rec.jev);
  const familyDiverge = conflictValid.filter(r => r.rec.agree === false);
  // 代理 ①：在"她低落 × 他报喜/平常事"族里，jev 没有把"一起高兴"当默认（HE_RISES_SHE_STEADY）
  const familyDirOk = familyDiverge.filter(r => r.rec.jev!.reason_code !== 'HE_RISES_SHE_STEADY').length;
  const c1 = conflictValid.length > 0 && familyDiverge.length > 0 && familyDirOk === familyDiverge.length;
  const nonConflictRate = nonConflictValid.length ? nonConflictAgree.length / nonConflictValid.length : NaN;
  const c2 = Number.isFinite(nonConflictRate) ? nonConflictRate >= 0.8 : null;
  const failRate = n ? errors.length / n : NaN;
  const c3 = Number.isFinite(failRate) ? failRate <= 0.02 : null;
  const enough = n >= 20;

  console.log('  预登记判据:');
  console.log(`    ① 已知失败族有分歧且方向符合  : ${c1 ? 'PASS(代理)' : 'FAIL/无样本'}（族内有效 ${conflictValid.length}，分歧 ${familyDiverge.length}）`);
  console.log(`    ② 非冲突类一致率 ≥ 80%        : ${c2 === null ? 'NA' : (c2 ? 'PASS' : 'FAIL')}（${pct(nonConflictAgree.length, nonConflictValid.length)}，n=${nonConflictValid.length}）`);
  console.log(`    ③ 失败率 ≤ 2%                 : ${c3 === null ? 'NA' : (c3 ? 'PASS' : 'FAIL')}（${pct(errors.length, n)}）`);
  console.log(`    样本充分性(n≥20)              : ${enough ? 'OK' : `不足（n=${n}）⇒ 只报数、不下结论`}`);
  if (!enough) {
    console.log('    判定: **insufficient-sample** —— 不得据此宣布 jev 有价值/无价值');
  } else {
    console.log(`    判定: ${c1 && c2 && c3 ? '**值得继续**（三条件同时满足）' : '**停在这里**（任一不满足）'}`);
  }

  // 分歧明细
  if (familyDiverge.length) {
    console.log('  已知失败族的分歧明细:');
    for (const r of familyDiverge) {
      const i = r.rec.input;
      console.log(`    - ${r.rec.turnId} 他=${i.his_turn.emotion}(${i.his_turn.intensity}) 她low=${hasLowMoodEvidence(i)} v=${i.her_state.valence.toFixed(3)}`);
      console.log(`        规则 ${i.rules_default.action}/${i.rules_default.motive_id ?? '-'}`);
      console.log(`        jev  ${r.rec.jev!.action}/${r.rec.jev!.motive_id ?? '-'} ${r.rec.jev!.reason_code} ｜ ${r.rec.jev!.inner_line}`);
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
for (const f of files) {
  analyze(all.filter(r => r.file === f), f.split(/[\\/]/).pop() ?? f);
}

// ⚠️ 跨文件合计只在**同一实现版本**下有效。
// 2026-10-19 的教训：把"修复前 / 旧枚举 / 护栏方向反 / 当前"四份账本混算 ⇒ 得到
// "失败率 13.6%、停在这里"的假结论 —— 那不是 jev 的表现，是四个装置的混合。
if (aggregate) {
  if (files.length > 1) {
    console.log('\n⚠️ 警告：正在跨文件合计。仅当这些账本来自**同一实现版本**时结论才有效；');
    console.log('   若混了修复前/修复后的数据，合计结论无效（应逐文件看，或只合计同一版本）。');
  }
  analyze(all, '合计（--aggregate，仅同版本有效）');
} else {
  console.log('\n（已跳过跨文件合计；需要时加 --aggregate —— 只在同一实现版本下才可用）');
}
