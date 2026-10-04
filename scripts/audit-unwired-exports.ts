// 审计：找出"写了、测了、但没人接线"的导出（静默失效类 bug 的通用形状）。
//
// ── 为什么要这个脚本 ─────────────────────────────────────────────────────────
// 本次会话撞见 5 次同类事故，3 次是靠运气 grep 到的：
//   driftPersonalityParams  服务端只 import 未调用 → 人格六参数 160 轮一个点没动
//   selectRedirectTopic     4 个分支是死代码（calm 永远胜出）
//   memorySimilarity        的 embedding 分支从未执行（episode 没有 embedding 字段）
//   createNodeFromEpisode   零生产调用 → 孤儿记忆
//   shadowLayer             出口取出即丢弃 → 潜意识层空转
// 这类 bug **不报错、不崩溃，只是功能不存在**。靠撞是撞不完的，所以扫一遍：
//
//   A 类  服务端有人用          → 已接线
//   B 类  仅 src 内部互相用       → 纯工具，正常
//   C 类  **只有测试用**          → 高度可疑：写好了、测过了，但线上没人调 ← 本脚本的目标
//
// 用法: node node_modules/tsx/dist/cli.mjs scripts/audit-unwired-exports.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const all = walk('src').concat(walk('server'), walk('scripts'));
const lib = all.filter(f => f.startsWith('src/lib/') && !f.includes('__tests__'));
const server = all.filter(f => f.startsWith('server/'));
const srcOther = all.filter(f => f.startsWith('src/') && !f.includes('__tests__'));
const tests = all.filter(f => f.includes('__tests__') || f.startsWith('scripts/'));

/** 一个导出名在哪些文件里被提到（排除定义它的那个文件） */
function usedIn(name: string, files: string[]): number {
  const re = new RegExp(`\\b${name}\\b`);
  let n = 0;
  for (const f of files) {
    if (lib.includes(f) && f === currentFile) continue;
    const src = readFileSync(f, 'utf8');
    if (re.test(src)) n++;
  }
  return n;
}

interface Row { file: string; name: string; server: number; src: number; test: number }
const rows: Row[] = [];
let currentFile = '';

for (const f of lib) {
  currentFile = f;
  const src = readFileSync(f, 'utf8');
  const names = new Set<string>();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const name of names) {
    rows.push({
      file: f,
      name,
      server: usedIn(name, server),
      src: usedIn(name, srcOther),
      test: usedIn(name, tests),
    });
  }
}

const C = rows.filter(r => r.server === 0 && r.src === 0 && r.test > 0);
const noUseAtAll = rows.filter(r => r.server === 0 && r.src === 0 && r.test === 0);

console.log(`扫描 ${lib.length} 个 src/lib 文件，共 ${rows.length} 个导出\n`);
console.log(`A 类 服务端有人用：${rows.filter(r => r.server > 0).length}`);
console.log(`B 类 仅 src 内部用：${rows.filter(r => r.server === 0 && r.src > 0).length}`);
console.log(`C 类 **只有测试用（可疑·写好了没接线）**：${C.length}`);
console.log(`D 类 谁都没用（可能纯导出/常量）：${noUseAtAll.length}\n`);

if (C.length) {
  console.log('── C 类明细（按文件分组）──');
  const byFile = new Map<string, Row[]>();
  for (const r of C) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
  for (const [file, rs] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${file}  (${rs.length})`);
    console.log('  ' + rs.map(r => r.name).join(', '));
  }
  console.log('\n判读：**不是每个 C 类都是 bug** —— 有的是给未来/给前端预留的纯函数，');
  console.log('但每一个都值得问一句"线上到底有没有人调它"。');
}
