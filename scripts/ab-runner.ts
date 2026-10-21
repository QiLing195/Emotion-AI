/**
 * 统一 A/B 跑批（v1.73）—— **多轮连续对话**，不是"无历史一问一答"。
 *
 * 为什么必须改：此前的 harness 每轮都发 `recentMessages: []`，
 * 相当于她永远看不到上一轮（只剩记忆/状态里的痕迹）——
 * 这与真实使用（聊天窗口带上历史）不是同一个装置，量出来的差异会被放大或缩小。
 *
 * 本脚本：
 *   ① 每个 arm 起一个独立服务进程（独立 PORT）；
 *   ② 逐轮把 `recentMessages` 累积成真实对话历史再发；
 *   ③ 记录每轮耗时/回复，落盘 JSON，并打印对比表。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/ab-runner.ts '{"name":"x","runs":2,"messages":["…"],"arms":{"A":{},"B":{"ENABLE_AGENT_TOOLS":"true"}}}'
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface Config {
  name: string;
  runs: number;
  messages: string[];
  arms: Record<string, Record<string, string>>;
  port?: number;
  outDir?: string;
  userIdPrefix?: string;
}

const raw = process.argv[2];
if (!raw) {
  console.error('用法: ab-runner.ts \'{"name","runs","messages","arms"}\'');
  process.exit(2);
}
const cfg = JSON.parse(raw) as Config;
const repo = resolve('.');
const port = cfg.port ?? 3020;
const outDir = cfg.outDir ?? join('artifacts', cfg.name);
mkdirSync(outDir, { recursive: true });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitHealth(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up */ }
    await sleep(500);
  }
  return false;
}

interface TurnResult { user: string; reply: string; sec: number }
interface RunResult { run: number; turns: TurnResult[] }

async function runArm(arm: string, envs: Record<string, string>): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (let run = 1; run <= cfg.runs; run++) {
    const child = spawn(process.execPath, [join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(repo, 'server', 'index.ts')], {
      cwd: repo,
      env: { ...process.env, PORT: String(port), ...envs },
      stdio: 'ignore',                                  // 不用管道（受限环境下管道会 EPERM）
      windowsHide: true,
    });
    try {
      const up = await waitHealth();
      if (!up) { console.warn(`  [${arm}] run${run} 服务未就绪，跳过`); continue; }
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      const turns: TurnResult[] = [];
      for (const message of cfg.messages) {
        const t0 = Date.now();
        let reply = '';
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ message, userId: `${cfg.userIdPrefix ?? 'ab'}-${arm}`, recentMessages: history }),
            signal: AbortSignal.timeout(240_000),
          });
          const data = (await r.json()) as { response?: string };
          reply = String(data?.response ?? '');
        } catch (e) {
          reply = 'ERR: ' + (e instanceof Error ? e.message : 'failed');
        }
        const sec = Math.round((Date.now() - t0) / 100) / 10;
        turns.push({ user: message, reply, sec });
        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: reply });
        await sleep(150);
      }
      runs.push({ run, turns });
      console.log(`  [${arm}] run${run} 完成（${turns.length} 轮，历史累积 ${history.length} 条）`);
    } finally {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      await sleep(1200);
    }
  }
  return runs;
}

const summary: Array<{ arm: string; runs: RunResult[]; avgLen: number; avgSec: number; questionEnd: number; toolTalk: number }> = [];
for (const [arm, envs] of Object.entries(cfg.arms)) {
  const runs = await runArm(arm, envs);
  const allTurns = runs.flatMap(r => r.turns);
  const n = allTurns.length || 1;
  summary.push({
    arm,
    runs,
    avgLen: Math.round(allTurns.reduce((s, t) => s + t.reply.length, 0) / n),
    avgSec: Math.round((allTurns.reduce((s, t) => s + t.sec, 0) / n) * 10) / 10,
    questionEnd: allTurns.filter(t => /[？?]\s*$/.test(t.reply.trim())).length,
    toolTalk: allTurns.filter(t => /工具|查询到|检索到|数据库|系统里/.test(t.reply)).length,
  });
  writeFileSync(join(outDir, `arm-${arm}.json`), JSON.stringify(runs, null, 2), 'utf8');
}

console.log(`\n=== ${cfg.name}（多轮连续，${cfg.runs} 次/臂）===`);
console.log('  arm   条数  均长  均耗时  问句结尾  工具腔');
for (const s of summary) {
  const turns = s.runs.flatMap(r => r.turns);
  console.log(`  ${s.arm.padEnd(5)} ${String(turns.length).padStart(4)}  ${String(s.avgLen).padStart(4)}  ${String(s.avgSec).padStart(6)}s  ${String(s.questionEnd).padStart(7)}  ${String(s.toolTalk).padStart(5)}`);
}
console.log(`\n  原始数据: ${outDir}/arm-*.json`);
