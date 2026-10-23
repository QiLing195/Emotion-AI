#!/usr/bin/env node
/**
 * v2.15：unified expression 开/关 A/B 重复跑（N 次/臂）
 *
 * 设计（避免状态污染）：
 *  - 先把线上 memories/ 复制成**只读快照**（不写线上）；
 *  - 每次运行都从快照重新复制一份 MEMORIES_DIR，起独立端口 server → 同一初始状态；
 *  - 两臂交替（on,off,on,off…），降低时间漂移的系统偏差；
 *  - 禁用语音/活动采样/活动关心/MCP 等后台副作用，只保留对话主链；
 *  - 结果写到 artifacts/v2.14/ab/<arm>-<n>.json，不覆盖主 server。
 *
 * 用法：node node_modules/tsx/dist/cli.mjs scripts/run-ab-repeat.mjs [N=3]
 */
import { spawn } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const N = Math.max(1, Number(process.argv[2] || 3));
const OUT = join(REPO, 'artifacts/v2.14/ab');
mkdirSync(OUT, { recursive: true });

const BASE = join(REPO, 'memories');
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
const SNAPSHOT = join(tmpdir(), `ab-snapshot-${STAMP}`);
cpSync(BASE, SNAPSHOT, { recursive: true });
console.log(`快照: ${SNAPSHOT}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function waitHealth(port, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

async function runArm(arm, n) {
  const memDir = join(tmpdir(), `ab-${arm}-${n}-${STAMP}`);
  cpSync(SNAPSHOT, memDir, { recursive: true });
  const port = await freePort();
  const logPath = join(tmpdir(), `ab-${arm}-${n}-${STAMP}.log`);
  const logFd = openSync(logPath, 'w');
  const child = spawn(process.execPath, [join(REPO, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      MEMORIES_DIR: memDir,
      PORT: String(port),
      BIND_HOST: '',
      ENABLE_UNIFIED_EXPRESSION: arm === 'on' ? 'true' : 'false',
      ENABLE_VOICE_WAKE: 'false',
      ENABLE_ACTIVITY_WATCH: 'false',
      ENABLE_ACTIVITY_CARE: 'false',
      ENABLE_MCP_CLIENT: 'false',
      ENABLE_HER_FOLLOWUP: 'false',
      ENABLE_PROACTIVE_MEMORY: 'false',
    },
    stdio: ['ignore', logFd, logFd],
  });
  closeSync(logFd);

  const t0 = Date.now();
  try {
    const up = await waitHealth(port);
    if (!up) throw new Error('server_not_ready');
    const env = { ...process.env, SCENARIO_USER: `ab-${arm}` };
    const r = await new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [join(REPO, 'scripts/emotion-scenarios.mjs'), `http://127.0.0.1:${port}`, `artifacts/v2.14/ab/run-${arm}-${n}`], {
        cwd: REPO, env, stdio: ['ignore', 'ignore', 'inherit'],
      });
      p.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`scenarios exit ${code}`))));
      p.on('error', reject);
    });
    void r;
    const resultPath = join(REPO, 'test_data/emotion_scenario_results.json');
    const outPath = join(OUT, `${arm}-${n}.json`);
    cpSync(resultPath, outPath);
    const data = JSON.parse(readFileSync(outPath, 'utf8'));
    const green = (data.results ?? []).filter(x => x.green).length;
    console.log(`  ${arm}-${n}: ${green}/${(data.results ?? []).length} 通过（${Math.round((Date.now() - t0) / 1000)}s）`);
    return { arm, n, green, total: (data.results ?? []).length, outPath };
  } finally {
    try { child.kill(); } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 1200));
    try { rmSync(memDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const summary = [];
try {
  for (let n = 1; n <= N; n++) {
    // 两臂交替，降低系统时间漂移
    for (const arm of ['on', 'off']) {
      console.log(`>>> ${arm} 第 ${n} 次`);
      summary.push(await runArm(arm, n));
    }
  }
} finally {
  try { rmSync(SNAPSHOT, { recursive: true, force: true }); } catch { /* ignore */ }
  writeFileSync(join(OUT, 'runs.json'), JSON.stringify({ ranAt: new Date().toISOString(), n: N, runs: summary }, null, 2), 'utf8');
}
console.log('完成：', summary.map(s => `${s.arm}-${s.n}=${s.green}/${s.total}`).join(' '));
