// ── Obsidian reviewer 回写 ──
// 读取「AI女友记忆」导出目录里被人工改动的 frontmatter（governance_status），
// 以 reviewer:obsidian 身份同步回 memories/memory_ledger.json（含审计）。
//
// 用法：
//   npm run obsidian:review -- --vault="D:\Lenovo\obsidian\库"
//   npm run obsidian:review -- --out=<导出目录>      # 或指向默认 obsidian_vault
//
// 只处理合法的状态机转移（与 src/lib/memoryGovernance 同一套规则）；
// 非法改动（如 verified→rejected）会列出并跳过，不会静默改坏账本。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MemoryLedger, type MemoryStatus } from '../src/lib/memoryGovernance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SUBDIR = 'AI女友记忆';
const LEDGER_FILE = path.join(PROJECT_ROOT, 'memories', 'memory_ledger.json');

function getArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function resolveRootDir(): string {
  const vault = getArg('vault');
  const out = getArg('out');
  if (vault) return path.join(path.resolve(vault), SUBDIR);
  if (out) return path.resolve(out);
  return path.join(PROJECT_ROOT, 'obsidian_vault');
}

/** 解析我们自产 frontmatter（值均为 "双引号" 形式），只取需要的键。 */
function parseFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*"((?:[^"\\]|\\.)*)"/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const REVIEWER = 'reviewer:obsidian';
const REVIEW_ACTIONS: MemoryStatus[] = ['supported', 'ambiguous', 'verified', 'rejected', 'rolled_back'];

function main(): void {
  const root = resolveRootDir();
  const episodeDir = path.join(root, '情景记忆');
  if (!fs.existsSync(episodeDir)) {
    console.error(`❌ 未找到导出目录：${episodeDir}\n   请先运行 npm run obsidian:export -- --vault=...`);
    process.exit(1);
  }

  if (!fs.existsSync(LEDGER_FILE)) {
    console.error('❌ 未找到 memories/memory_ledger.json（请先让服务端跑一轮对话生成账本）');
    process.exit(1);
  }

  const ledger = MemoryLedger.from(JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8')));
  const changed: string[] = [];
  const skipped: string[] = [];

  const files = fs.readdirSync(episodeDir).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(episodeDir, file), 'utf-8'));
    const refId = fm.id;
    const want = fm.governance_status as MemoryStatus | undefined;
    if (!refId || !want || !REVIEW_ACTIONS.includes(want)) continue;

    const entry = ledger.getByRef('episodic', refId);
    if (!entry) {
      // 无账（旧记忆/弱记忆未建账）——不允许凭空 verify，避免把未治理记忆直接洗成已核实
      skipped.push(`${file}: 账本无此候选（governance_status=${want}），忽略`);
      continue;
    }
    if (entry.status === want) continue;
    const fromStatus = entry.status;

    try {
      ledger.transition(entry.candidateId, want, REVIEWER, 'obsidian_review');
      changed.push(`${file}: ${fromStatus} → ${want}（审计 v${ledger.serialize().history.length}）`);
    } catch (e) {
      // UX 链式转移：用户在 Obsidian 把 proposed/ambiguous 直接标 verified 时，
      // 自动先经 supported 再 verified（两步均为 reviewer 身份，保持状态机纪律）
      if (want === 'verified' && (fromStatus === 'proposed' || fromStatus === 'ambiguous')) {
        try {
          ledger.transition(entry.candidateId, 'supported', REVIEWER, 'reviewer_escalation');
          ledger.transition(entry.candidateId, 'verified', REVIEWER, 'obsidian_review');
          changed.push(`${file}: ${fromStatus} → verified（经 supported 链式核实）`);
        } catch (e2) {
          skipped.push(`${file}: ${(e2 as Error).message}`);
        }
      } else {
        skipped.push(`${file}: ${(e as Error).message}（当前=${fromStatus}，请求=${want}）`);
      }
    }
  }

  if (changed.length === 0 && skipped.length === 0) {
    console.log('✓ 没有发现需要回写的改动。');
    return;
  }

  if (changed.length > 0) {
    const tmp = `${LEDGER_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger.serialize(), null, 2), 'utf-8');
    fs.renameSync(tmp, LEDGER_FILE);
    console.log(`✅ 已回写 ${changed.length} 条到账本（actor=${REVIEWER}）：`);
    for (const c of changed) console.log('  ' + c);
  } else {
    console.log('⚠️ 有改动但全部未通过状态机校验，账本未变。');
  }
  if (skipped.length > 0) {
    console.log(`\n跳过 ${skipped.length} 条：`);
    for (const s of skipped.slice(0, 20)) console.log('  ' + s);
    if (skipped.length > 20) console.log(`  …共 ${skipped.length} 条`);
  }
}

main();
