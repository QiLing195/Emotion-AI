#!/usr/bin/env node
/**
 * Stage 8 interaction emotion evaluation.
 * Default mode is a no-network preflight. Model calls require explicit --run.
 * The runner intentionally reads only the case JSONL, never the reviewer key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const CASES_PATH = path.join(ROOT, 'artifacts/emotion-learning/stage-8-interaction-eval-cases-v1.jsonl');
const OUTPUT_ROOT = path.join(ROOT, 'artifacts/emotion-learning/stage-8-runs');
const ABLATED_BLOCKS = new Set([
  'appraisal', 'herState', 'moodHint', 'ruminationHint', 'goodNewsReception',
  'motive', 'strategy', 'expression_permit',
]);
const args = new Set(process.argv.slice(2));
const argValue = (name, fallback) => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const doRun = args.has('--run');
const checkServerOnly = args.has('--check-server');
const selectedCase = argValue('--case', null);
const replicates = Number(argValue('--replicates', '1'));
const requestedCondition = argValue('--condition', 'both');
const conditions = requestedCondition === 'both'
  ? ['production', 'prompt-ablation']
  : [requestedCondition];
if (conditions.some((condition) => !['production', 'prompt-ablation'].includes(condition))) {
  throw new Error('--condition must be production, prompt-ablation, or both');
}

function readCases() {
  const lines = fs.readFileSync(CASES_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSONL at line ${index + 1}`); }
  });
  const ids = new Set();
  for (const row of rows) {
    if (!/^IE-\d{2}$/.test(row.case_id) || ids.has(row.case_id)) throw new Error(`Invalid/duplicate case_id: ${row.case_id}`);
    ids.add(row.case_id);
    if (!['development', 'transfer'].includes(row.split)) throw new Error(`Invalid split: ${row.case_id}`);
    if (!Array.isArray(row.turns) || row.turns.length < 1 || row.turns.at(-1)?.role !== 'user') {
      throw new Error(`Case must end with a user turn: ${row.case_id}`);
    }
    if (row.turns.some((turn) => !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')) {
      throw new Error(`Invalid turn schema: ${row.case_id}`);
    }
  }
  return rows;
}

function makeRequestBody(row, replicate) {
  // The reviewer key is never opened or passed through this function.
  const turns = row.turns;
  return {
    message: turns.at(-1).content,
    userId: `stage8-${row.case_id}-r${replicate}`,
    settings: { temperature: 0.2 },
    recentMessages: turns.slice(0, -1),
  };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated server exited before health check (code ${child.exitCode})`);
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return;
    } catch { /* server is still starting */ }
    await delay(250);
  }
  throw new Error('Isolated server health check timed out');
}

async function startIsolatedServer(memoryDir, port, condition) {
  fs.mkdirSync(memoryDir, { recursive: true });
  // MCP config lookup prefers MEMORIES_DIR/mcp-servers.json; the empty file
  // prevents fallback to the enabled app-root filesystem MCP configuration.
  fs.writeFileSync(path.join(memoryDir, 'mcp-servers.json'), JSON.stringify({ servers: {} }), 'utf8');
  const env = {
    ...process.env,
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    REQUIRE_API_TOKEN_ALWAYS: 'false',
    MEMORIES_DIR: memoryDir,
    ENABLE_MCP_CLIENT: 'false',
    ENABLE_AGENT_TOOLS: 'false',
    STAGE8_PROMPT_ABLATION: condition === 'prompt-ablation' ? 'true' : 'false',
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
  child.once('error', (error) => { child.spawnError = error; });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, child);
    const statusRes = await fetch(`${baseUrl}/api/mcp/status`, { signal: AbortSignal.timeout(3_000) });
    if (!statusRes.ok) throw new Error(`MCP status endpoint failed: HTTP ${statusRes.status}`);
    const status = await statusRes.json();
    if (status.clientEnabled !== false) throw new Error('Isolation failed: MCP client is still enabled');
    if (!Array.isArray(status.servers) || status.servers.length !== 0) {
      throw new Error('Isolation failed: MCP configuration is not empty');
    }
    const diagnosticRes = await fetch(`${baseUrl}/api/diagnostics`, { signal: AbortSignal.timeout(3_000) });
    if (!diagnosticRes.ok) throw new Error(`Diagnostics endpoint failed: HTTP ${diagnosticRes.status}`);
    const diagnostics = await diagnosticRes.json();
    if (diagnostics.flags?.agentTools !== false) throw new Error('Isolation failed: Agent tools are still enabled');
    if (diagnostics.flags?.stage8PromptAblation !== (condition === 'prompt-ablation')) {
      throw new Error(`Wrong prompt condition in server: expected ${condition}`);
    }
    return { child, baseUrl, diagnostics, mcpConfiguredServers: status.servers.length };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

async function runOne(row, replicate, condition, outputPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ai-friend-stage8-${row.case_id}-${replicate}-${condition}-`));
  const memoryDir = path.join(tempRoot, 'memories');
  let child;
  try {
    const port = await freePort();
    const server = await startIsolatedServer(memoryDir, port, condition);
    child = server.child;
    const requestBody = makeRequestBody(row, replicate);
    const bodyText = JSON.stringify(requestBody);
    if (bodyText.includes('stage-8-interaction-eval-answer-key')) throw new Error('Isolation failed: reviewer key path entered request');
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText,
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Chat failed for ${row.case_id}: HTTP ${response.status}`);
    const diagnosticsRes = await fetch(`${server.baseUrl}/api/diagnostics`, { signal: AbortSignal.timeout(3_000) });
    if (!diagnosticsRes.ok) throw new Error(`Prompt diagnostics failed for ${row.case_id}: HTTP ${diagnosticsRes.status}`);
    const diagnostics = await diagnosticsRes.json();
    const memoriesRes = await fetch(`${server.baseUrl}/api/memories?limit=1`, { signal: AbortSignal.timeout(3_000) });
    if (!memoriesRes.ok) throw new Error(`Memory diagnostics failed for ${row.case_id}: HTTP ${memoriesRes.status}`);
    const memoryState = await memoriesRes.json();
    if (row.case_id === 'IE-16' && Number(memoryState.total) !== 0) {
      throw new Error(`IE-16 memory-write boundary failed: expected 0 episodes, got ${memoryState.total}`);
    }
    const manifest = diagnostics.prompt?.manifest ?? [];
    const activeAblatedBlocks = manifest
      .filter((block) => ABLATED_BLOCKS.has(block.id) && !block.suppressed)
      .map((block) => block.id);
    if (condition === 'prompt-ablation' && activeAblatedBlocks.length > 0) {
      throw new Error(`Prompt ablation failed; these affective blocks remain active: ${activeAblatedBlocks.join(',')}`);
    }
    fs.appendFileSync(outputPath, `${JSON.stringify({
      case_id: row.case_id,
      split: row.split,
      replicate,
      condition,
      timestamp: new Date().toISOString(),
      request: requestBody,
      response: payload.response ?? null,
      emotionAnalysis: payload.emotionAnalysis ?? null,
      episodicMemoryTotal: Number(memoryState.total ?? 0),
      promptManifest: manifest.map(({ id, category, suppressed }) => ({ id, category, suppressed })),
      httpStatus: response.status,
    })}\n`, 'utf8');
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3_000)]);
    }
    const resolvedTemp = path.resolve(tempRoot);
    const tempBase = path.resolve(os.tmpdir()) + path.sep;
    if (!resolvedTemp.startsWith(tempBase)) throw new Error('Refusing to remove temp directory outside OS temp root');
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

async function checkIsolatedServer(condition) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `ai-friend-stage8-preflight-${condition}-`));
  const memoryDir = path.join(tempRoot, 'memories');
  let child;
  try {
    const server = await startIsolatedServer(memoryDir, await freePort(), condition);
    child = server.child;
    console.log(JSON.stringify({
      mode: 'isolated_server_check',
      condition,
      health: 'ok',
      mcpClientEnabled: server.diagnostics.flags.mcpClient,
      mcpConfiguredServers: server.mcpConfiguredServers,
      agentToolsEnabled: server.diagnostics.flags.agentTools,
      promptAblationEnabled: server.diagnostics.flags.stage8PromptAblation,
      temporaryMemoryDirectory: true,
      modelCalls: 0,
    }, null, 2));
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3_000)]);
    }
    const resolvedTemp = path.resolve(tempRoot);
    const tempBase = path.resolve(os.tmpdir()) + path.sep;
    if (!resolvedTemp.startsWith(tempBase)) throw new Error('Refusing to remove temp directory outside OS temp root');
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

async function main() {
  const allCases = readCases();
  const cases = selectedCase ? allCases.filter((row) => row.case_id === selectedCase) : allCases;
  if (cases.length === 0) throw new Error(`No case found for --case=${selectedCase}`);
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 3) throw new Error('--replicates must be an integer from 1 to 3');

  const bySplit = Object.fromEntries(['development', 'transfer'].map((split) => [split, allCases.filter((row) => row.split === split).length]));
  if (bySplit.development !== 12 || bySplit.transfer !== 4) throw new Error(`Unexpected case split: ${JSON.stringify(bySplit)}`);

  if (checkServerOnly) {
    for (const condition of conditions) await checkIsolatedServer(condition);
    return;
  }

  const safeEnv = {
    ENABLE_MCP_CLIENT: 'false',
    ENABLE_AGENT_TOOLS: 'false',
    MEMORIES_DIR: '<unique temporary directory per run>',
    mcpConfig: '{"servers":{}}',
  };
  if (!doRun) {
    console.log(JSON.stringify({
      mode: 'preflight_only',
      modelCalls: 0,
      cases: cases.length,
      replicates,
      conditions,
      plannedChatRequests: cases.length * replicates * conditions.length,
      splits: bySplit,
      isolatedEnv: safeEnv,
      reviewerKeyRead: false,
    }, null, 2));
    return;
  }

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_ROOT, `run-${runId}.jsonl`);
  console.log(`Chat requests planned: ${cases.length * replicates * conditions.length}; output: ${path.relative(ROOT, outputPath)}`);
  for (const row of cases) {
    for (let replicate = 1; replicate <= replicates; replicate++) {
      const pairOrder = replicate % 2 === 1 ? conditions : [...conditions].reverse();
      for (const condition of pairOrder) {
        console.log(`Running ${row.case_id} (${row.split}, ${condition}) replicate ${replicate}/${replicates}`);
        await runOne(row, replicate, condition, outputPath);
      }
    }
  }
  console.log(`Completed. Results: ${path.relative(ROOT, outputPath)}`);
}

main().catch((error) => {
  console.error(`stage8 emotion evaluation failed: ${error.message}`);
  process.exitCode = 1;
});
