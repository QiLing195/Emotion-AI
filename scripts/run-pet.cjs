// 启动桌宠：先确保后端在跑，再起 Electron（Electron 二进制位置由 electron npm 包给出）
// 注意：某些环境会设置 ELECTRON_RUN_AS_NODE=1，那会让 electron 以纯 Node 运行，必须清掉。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const APP_URL = process.env.PET_APP_URL || 'http://127.0.0.1:3000';
const APP_ROOT = path.resolve(__dirname, '..');
const portableData = process.argv.includes('--portable-data');
const dataRoot = process.env.MEMORIES_DIR || (portableData
  ? path.join(APP_ROOT, 'data')
  : path.join(APP_ROOT, 'memories'));
const electronBin = require('electron');           // npm 包在 node 下 require 会返回二进制路径
const mainEntry = path.join(APP_ROOT, 'desktop', 'main.cjs');
const compiledServer = path.join(APP_ROOT, 'dist', 'server', 'index.js');
const serverEntry = [
  'node_modules/tsx/dist/cli.mjs',
  fs.existsSync(compiledServer) ? compiledServer : 'server/index.ts',
];
const appEnv = {
  ...process.env,
  APP_ROOT,
  MEMORIES_DIR: dataRoot,
  WEB_DIST_DIR: path.join(APP_ROOT, 'dist'),
};

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await probe(`${APP_URL}/health`)) return null;
  console.log('[pet] 后端没在跑，先启动 server ...');
  const serverLog = fs.openSync(path.join(process.env.TEMP || '.', 'ai-girlfriend-server.log'), 'a');
  const child = spawn(process.execPath, serverEntry, {
    cwd: APP_ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: appEnv,
  });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await probe(`${APP_URL}/health`)) { console.log('[pet] 后端就绪'); return child; }
  }
  console.error('[pet] 后端 60s 内没起来，放弃');
  process.exit(1);
}

(async () => {
  const serverChild = await ensureServer();
  const env = { ...appEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const pet = spawn(electronBin, [mainEntry], { cwd: APP_ROOT, stdio: 'inherit', env });
  pet.on('close', (code) => {
    console.log('[pet] Electron 退出 code=' + code);
    if (serverChild && !serverChild.killed) { try { serverChild.kill(); } catch {} }
    process.exit(code ?? 0);
  });
})();
