import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'artifacts/emotion-learning/memory-write-boundary');
const RUN = process.argv.includes('--run');
const CASES = [
  {
    id: 'explicit_remember',
    message: '我真的很喜欢喝无糖拿铁，每次喝都觉得安心，这对我很重要。请记住。',
    expectedMemory: 'at_least_one',
  },
  {
    id: 'defer_until_source_check',
    message: '这条信息先确认来源，再决定是否记下来。',
    expectedMemory: 'zero',
  },
  {
    id: 'explicit_no_record',
    message: '这个只是临时想法，今晚想喝奶茶，请不要把它记录成我的长期偏好。',
    expectedMemory: 'zero',
  },
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`isolated server exited (${child.exitCode})`);
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* server is starting */ }
    await delay(250);
  }
  throw new Error('isolated server health check timed out');
}

async function runCase(testCase) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ai-friend-memory-boundary-${testCase.id}-`));
  const memoryDir = path.join(tempRoot, 'memories');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'mcp-servers.json'), JSON.stringify({ servers: {} }), 'utf8');
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    REQUIRE_API_TOKEN_ALWAYS: 'false',
    MEMORIES_DIR: memoryDir,
    ENABLE_MCP_CLIENT: 'false',
    ENABLE_AGENT_TOOLS: 'false',
    DISABLE_PROACTIVE_LOOP: 'true',
    ENABLE_ACTIVITY_CARE: 'false',
    ENABLE_ACTIVITY_WATCH: 'false',
    ENABLE_VOICE_WAKE: 'false',
  };
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: ROOT,
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  try {
    await waitForHealth(url, child);
    const mcpRes = await fetch(`${url}/api/mcp/status`, { signal: AbortSignal.timeout(3_000) });
    const mcp = await mcpRes.json();
    const diagRes = await fetch(`${url}/api/diagnostics`, { signal: AbortSignal.timeout(3_000) });
    const diagnostics = await diagRes.json();
    if (mcp.clientEnabled !== false || mcp.servers?.length !== 0 || diagnostics.flags?.agentTools !== false) {
      throw new Error('isolation preflight failed (MCP/Agent tools must be disabled)');
    }

    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: testCase.message, settings: { temperature: 0.2 } }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${testCase.id}: chat HTTP ${response.status}`);
    const memoriesRes = await fetch(`${url}/api/memories?limit=2`, { signal: AbortSignal.timeout(3_000) });
    const memories = await memoriesRes.json();
    const total = Number(memories.total ?? 0);
    if (testCase.expectedMemory === 'zero' && total !== 0) {
      throw new Error(`${testCase.id}: expected no episodic write; got ${total}`);
    }
    if (testCase.expectedMemory === 'at_least_one' && total < 1) {
      throw new Error(`${testCase.id}: explicit remember control created no episodic memory`);
    }
    return {
      id: testCase.id,
      status: response.status,
      response: payload.response ?? null,
      episodicMemoryTotal: total,
      expectedMemory: testCase.expectedMemory,
      isolated: true,
      mcpClientEnabled: mcp.clientEnabled,
      mcpServerCount: mcp.servers.length,
      agentToolsEnabled: diagnostics.flags.agentTools,
    };
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3_000)]);
    }
    const resolvedTemp = path.resolve(tempRoot);
    const tempBase = path.resolve(os.tmpdir()) + path.sep;
    if (!resolvedTemp.startsWith(tempBase)) throw new Error('refusing to remove temp directory outside OS temp root');
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

async function main() {
  if (!RUN) {
    console.log(JSON.stringify({ mode: 'dry_run', modelCalls: 0, plannedCalls: CASES.length, cases: CASES.map(({ id, message, expectedMemory }) => ({ id, message, expectedMemory })) }, null, 2));
    return;
  }
  const results = [];
  for (const testCase of CASES) {
    console.log(`Running ${testCase.id}`);
    results.push(await runCase(testCase));
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const output = path.join(OUTPUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(output, `${JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ mode: 'live', output, results }, null, 2));
}

main().catch(error => {
  console.error(`memory write boundary smoke failed: ${error.message}`);
  process.exitCode = 1;
});
