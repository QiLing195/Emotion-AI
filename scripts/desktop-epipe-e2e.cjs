// Windows-only E2E check for the Electron main-process EPIPE guard.
// Run with: node scripts/desktop-epipe-e2e.cjs
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const REPO = path.resolve(__dirname, '..');
const MAIN_ENTRY = path.join(REPO, 'desktop', 'main.cjs');
const STARTUP_TIMEOUT_MS = 60_000;
const RECOVERY_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function powershell(script, env = process.env) {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], { encoding: 'utf8', windowsHide: true, env, timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `PowerShell exited ${result.status}`);
  return result.stdout.trim();
}

function existingMainProcess() {
  const output = powershell(
    "$main = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:PET_E2E_MAIN) }; " +
    "@($main | Select-Object ProcessId, CommandLine) | ConvertTo-Json -Compress",
    { ...process.env, PET_E2E_MAIN: MAIN_ENTRY },
  );
  if (!output || output === '[]') return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function appSnapshot(runnerPid) {
  const script = [
    `$runner = ${Number(runnerPid)}`,
    "$main = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $runner -and $_.CommandLine -and $_.CommandLine.Contains($env:PET_E2E_MAIN) } | Select-Object -First 1",
    "$renderers = @()",
    "if ($main) { $renderers = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $main.ProcessId -and $_.CommandLine -match '--type=renderer' } | ForEach-Object { [int]$_.ProcessId }) }",
    "[PSCustomObject]@{ mainPid = if ($main) { [int]$main.ProcessId } else { $null }; rendererPids = $renderers; mainAlive = [bool]$main } | ConvertTo-Json -Compress",
  ].join('; ');
  const output = powershell(script, { ...process.env, PET_E2E_MAIN: MAIN_ENTRY });
  return JSON.parse(output);
}

function readEvents(markerPath) {
  if (!fs.existsSync(markerPath)) return [];
  return fs.readFileSync(markerPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) return;
    } catch { /* the isolated server is still starting */ }
    await sleep(250);
  }
  throw new Error(`isolated server did not become healthy; runner exit=${child.exitCode}`);
}

async function waitForTrayReady(child, getOutput) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && child.exitCode === null) {
    if (getOutput().includes('[Pet] 系统托盘已就绪')) return;
    await sleep(100);
  }
  throw new Error(`Electron tray did not become ready; runner exit=${child.exitCode}`);
}

async function waitForRecovery(runnerPid, mainPid, oldRendererPid, markerPath) {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snapshot = appSnapshot(runnerPid);
    const events = readEvents(markerPath);
    const postTriggerEpipe = events.some(event => event.pid === mainPid && event.code === 'EPIPE' && event.at >= triggerAt);
    const replacement = snapshot.rendererPids.find(pid => pid !== oldRendererPid);
    if (snapshot.mainPid === mainPid && replacement && postTriggerEpipe) return { snapshot, events, replacement };
    await sleep(250);
  }
  const snapshot = appSnapshot(runnerPid);
  throw new Error(`recovery timeout: snapshot=${JSON.stringify(snapshot)} events=${JSON.stringify(readEvents(markerPath))}`);
}

async function waitForGuardListeners(mainPid, markerPath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const snapshot = readEvents(markerPath).find(event => event.pid === mainPid && event.listeners);
    if (snapshot?.listeners?.stdout >= 2 && snapshot?.listeners?.stderr >= 2) return snapshot;
    await sleep(100);
  }
  throw new Error(`EPIPE guard listeners were not installed on both streams: ${JSON.stringify(readEvents(markerPath))}`);
}

let triggerAt = 0;

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
  const exited = await Promise.race([
    new Promise(resolve => child.once('close', () => resolve(true))),
    sleep(3000).then(() => false),
  ]);
  if (!exited && process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This E2E check requires Windows.');
  const existing = existingMainProcess();
  if (existing.length) {
    throw new Error(`Close the existing desktop pet before running this isolated check: ${JSON.stringify(existing)}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-girlfriend-epipe-e2e-'));
  const markerPath = path.join(tempDir, 'epipe-events.jsonl');
  const preloadPath = path.join(tempDir, 'observe-epipe.cjs');
  const port = await freePort();
  const appUrl = `http://127.0.0.1:${port}`;
  const memoryDir = path.join(tempDir, 'memories');
  const preloadSource = [
    "const fs = require('node:fs');",
    "if (process.versions.electron) {",
    "  const record = event => fs.appendFileSync(process.env.EPIPE_E2E_MARKER, JSON.stringify({ pid: process.pid, at: Date.now(), ...event }) + '\\n');",
    "  for (const [stream, writable] of [['stdout', process.stdout], ['stderr', process.stderr]]) writable.on('error', error => { if (error?.code === 'EPIPE') record({ stream, code: error.code }); });",
    "  process.on('uncaughtExceptionMonitor', error => record({ uncaught: error?.code || error?.message }));",
    "  let attempts = 0;",
    "  const listenerCheck = setInterval(() => {",
    "    attempts++;",
    "    const listeners = { stdout: process.stdout.listenerCount('error'), stderr: process.stderr.listenerCount('error') };",
    "    if ((listeners.stdout >= 2 && listeners.stderr >= 2) || attempts >= 200) { record({ listeners }); clearInterval(listenerCheck); }",
    "  }, 50);",
    "}",
  ].join('\n');
  fs.writeFileSync(preloadPath, preloadSource, 'utf8');
  const preloadOption = preloadPath.replace(/\\/g, '/');
  const nodeOptions = `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require=${preloadOption}`;
  const child = spawn(process.execPath, ['scripts/run-pet.cjs'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(port),
      MEMORIES_DIR: memoryDir,
      PET_APP_URL: appUrl,
      NODE_OPTIONS: nodeOptions,
      EPIPE_E2E_MARKER: markerPath,
      ENABLE_ACTIVITY_WATCH: 'false',
      ENABLE_ACTIVITY_CARE: 'false',
      ENABLE_MCP_CLIENT: 'false',
      DISABLE_PROACTIVE_LOOP: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let outputText = '';
  let pipesClosed = false;
  const collect = chunk => {
    outputText += chunk;
    if (!pipesClosed && outputText.includes('[Pet] 系统托盘已就绪')) {
      pipesClosed = true;
      child.stdout.destroy();
      child.stderr.destroy();
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  try {
    await Promise.race([
      Promise.all([waitForHealth(appUrl, child), waitForTrayReady(child, () => outputText)]),
      new Promise((_, reject) => child.once('close', (code, signal) => reject(new Error(`runner exited before ready: code=${code} signal=${signal}`)))),
    ]);
    if (!pipesClosed) throw new Error('stdout/stderr were not disconnected after tray readiness');

    const initial = appSnapshot(child.pid);
    if (!initial.mainPid || initial.rendererPids.length !== 1) {
      throw new Error(`unexpected isolated process tree: ${JSON.stringify(initial)}`);
    }
    const mainPid = initial.mainPid;
    const oldRendererPid = initial.rendererPids[0];
    await waitForGuardListeners(mainPid, markerPath);
    triggerAt = Date.now();

    const kill = spawnSync('taskkill.exe', ['/PID', String(oldRendererPid), '/F'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (kill.status !== 0) throw new Error(`could not terminate isolated renderer ${oldRendererPid}: ${kill.stderr.trim()}`);

    const recovered = await waitForRecovery(child.pid, mainPid, oldRendererPid, markerPath);
    const epipeEvents = recovered.events.filter(event => event.pid === mainPid && event.code === 'EPIPE' && event.at >= triggerAt);
    const streams = new Set(epipeEvents.map(event => event.stream));
    if (epipeEvents.length === 0) throw new Error('renderer crash did not produce an observed EPIPE event');
    if (streams.size === 0) throw new Error(`no post-trigger EPIPE event was observed: ${JSON.stringify(epipeEvents)}`);
    const response = await fetch(`${appUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (response.status !== 200) throw new Error(`/health returned ${response.status}`);

    console.log('PASS: real Electron main process received EPIPE after pipe closure and stayed alive.');
    console.log(`PASS: renderer ${oldRendererPid} was replaced by ${recovered.replacement}; /health=${response.status}.`);
    console.log(`Observed post-trigger EPIPE stream(s): ${[...streams].sort().join(', ')}.`);
  } finally {
    await stopChild(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`FAIL: ${error?.stack || error}`);
  process.exitCode = 1;
});
