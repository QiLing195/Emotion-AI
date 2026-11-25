#!/usr/bin/env node
/**
 * Replay the fixed emotion-expression corpus through isolated real server instances.
 * Each case/run gets a fresh process and temporary memories directory so emotion,
 * history, and persisted state cannot bleed into another sample.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS_ROOT = path.resolve(REPO, 'artifacts');
const DATASET_PATH = path.resolve(process.env.EMOTION_EVAL_DATASET_PATH
  || path.join(REPO, 'artifacts', 'v2.30', 'emotion-expression-eval-set.json'));
if (DATASET_PATH === ARTIFACTS_ROOT || !DATASET_PATH.startsWith(ARTIFACTS_ROOT + path.sep)) {
  throw new Error('refusing_to_read_eval_dataset_outside_artifacts');
}
const OUT_DIR = path.resolve(process.env.EMOTION_EVAL_OUTPUT_DIR || path.join(ARTIFACTS_ROOT, 'v2.30'));
if (OUT_DIR === ARTIFACTS_ROOT || !OUT_DIR.startsWith(ARTIFACTS_ROOT + path.sep)) {
  throw new Error('refusing_to_write_eval_outside_artifacts');
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const CHECKPOINT_PATH = path.join(OUT_DIR, 'emotion-expression-replay-progress.json');
const RUNS = Math.max(1, Math.min(5, Number(process.env.EMOTION_EVAL_RUNS || 3)));
const TOWN_ARM = process.env.VIRTUAL_TOWN_ARM === 'town' ? 'town' : 'control';
const VIRTUAL_DAY = Math.max(1, Math.min(7, Number(process.env.VIRTUAL_TOWN_REPLAY_DAY) || 7));
const REQUEST_TIMEOUT_MS = 120000;
const START_TIMEOUT_MS = 60000;

const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
const requestedCaseIds = String(process.env.EMOTION_EVAL_CASE_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const cases = requestedCaseIds.length
  ? dataset.cases.filter(testCase => requestedCaseIds.includes(testCase.id))
  : dataset.cases;
if (cases.length === 0 || (requestedCaseIds.length && cases.length !== new Set(requestedCaseIds).size)) {
  throw new Error('unknown_or_duplicate_emotion_eval_case_id');
}
let results = [];
if (fs.existsSync(CHECKPOINT_PATH)) {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    if (checkpoint.datasetVersion === dataset.version && checkpoint.runsPerCase === RUNS
      && JSON.stringify(checkpoint.caseIds) === JSON.stringify(cases.map(testCase => testCase.id))) {
      results = checkpoint.results ?? [];
    }
  } catch { /* ignore an incomplete checkpoint and start cleanly */ }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function getJson(url, timeoutMs = 10000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function startIsolatedServer(caseId, run) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-friend-expression-eval-'));
  const memoriesDir = path.join(sandbox, 'memories');
  fs.mkdirSync(memoriesDir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'package.json'), path.join(sandbox, 'package.json'));
  for (const file of ['.env', '.env.local']) {
    const source = path.join(REPO, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(sandbox, file));
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logPath = path.join(sandbox, 'server.log');
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [
    path.join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(REPO, 'server', 'index.ts'),
  ], {
    cwd: sandbox,
    env: {
      ...process.env,
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      MEMORIES_DIR: memoriesDir,
      DISABLE_PROACTIVE_LOOP: 'true',
      ENABLE_SANDBOX_REPLAY: 'false',
      ENABLE_LEGACY_WECHAT: 'false',
      ENABLE_VIRTUAL_TOWN_EXPERIMENT: TOWN_ARM === 'town' ? 'true' : 'false',
      VIRTUAL_TOWN_REPLAY_DAY: String(VIRTUAL_DAY),
    },
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    let healthy = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        if ((await getJson(`${base}/health`, 2500)).status === 200) { healthy = true; break; }
      } catch { /* startup is still in progress */ }
      await sleep(500);
    }
    if (!healthy) {
      const log = fs.readFileSync(logPath, 'utf8').slice(-5000);
      throw new Error(`isolated_server_start_failed case=${caseId} run=${run}\n${log}`);
    }
    const config = await getJson(`${base}/api/ai-config`);
    return { sandbox, child, logFd, base, config: config.body };
  } catch (error) {
    child.kill('SIGTERM');
    fs.closeSync(logFd);
    fs.rmSync(sandbox, { recursive: true, force: true });
    throw error;
  }
}

async function stopIsolatedServer(server) {
  const waitForExit = async (timeoutMs) => {
    if (server.child.exitCode !== null) return;
    await Promise.race([
      new Promise(resolve => server.child.once('exit', resolve)),
      sleep(timeoutMs),
    ]);
  };
  if (server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await waitForExit(2500);
    if (server.child.exitCode === null) {
      server.child.kill('SIGKILL');
      await waitForExit(3500);
    }
  }
  try { fs.closeSync(server.logFd); } catch { /* already closed */ }
  const tempRoot = path.resolve(os.tmpdir());
  const target = path.resolve(server.sandbox);
  if (!target.startsWith(tempRoot + path.sep)
      || !path.basename(target).startsWith('ai-friend-expression-eval-')) {
    throw new Error('refusing_to_remove_unexpected_temp_path');
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
}

async function runTurn(base, message, history) {
  const before = await getJson(`${base}/state`);
  const startedAt = Date.now();
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, recentMessages: history.slice(-10) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  const after = await getJson(`${base}/state`);
  const diagnostics = await getJson(`${base}/api/diagnostics`);
  return {
    status: response.status,
    latencyMs: Date.now() - startedAt,
    user: message,
    reply: String(payload.response ?? ''),
    userAnalysis: payload.emotionAnalysis?.user ?? null,
    attribution: payload.emotionAnalysis?.attribution ?? null,
    strategy: payload.strategy ?? null,
    conflictPhase: payload.conflictPhase ?? null,
    expressionPlan: after.body?.expressionPlan ?? null,
    expressionEnforcement: diagnostics.body?.expressionEnforcement ?? null,
    turnTrace: diagnostics.body?.turnTrace ?? null,
    selfClaimGrounding: payload.selfClaimGrounding ?? null,
    virtualTownEvidenceEnforcement: payload.virtualTownEvidenceEnforcement ?? null,
    emotionStateBefore: payload.emotionStateBefore ?? before.body ?? null,
    emotionStateAfter: payload.emotionState ?? after.body ?? null,
  };
}

for (const testCase of cases) {
  for (let run = 1; run <= RUNS; run += 1) {
    if (results.some(result => result.caseId === testCase.id && result.run === run && result.status === 'complete')) continue;
    let server;
    const sample = {
      caseId: testCase.id,
      category: testCase.category,
      severity: testCase.severity,
      context: testCase.context ?? [],
      run,
      turns: [],
      status: 'started',
    };
    try {
      server = await startIsolatedServer(testCase.id, run);
      const history = [...(testCase.context ?? [])];
      for (const [turnIndex, turn] of testCase.turns.entries()) {
        const result = await runTurn(server.base, turn.user, history);
        sample.turns.push({ index: turnIndex + 1, expected: turn.expect, ...result });
        history.push({ role: 'user', content: turn.user }, { role: 'assistant', content: result.reply });
        if (result.status < 200 || result.status >= 300 || !result.reply) {
          sample.status = 'request_failed';
          sample.failure = `turn=${turnIndex + 1} http=${result.status} replyPresent=${Boolean(result.reply)}`;
          break;
        }
      }
      if (sample.status === 'started') sample.status = 'complete';
      sample.provider = server.config?.provider ?? null;
      sample.model = server.config?.model ?? null;
      sample.serverConfigured = Boolean(server.config?.serverConfigured);
    } catch (error) {
      sample.status = 'harness_failed';
      sample.failure = String(error?.stack ?? error);
    } finally {
      if (server) await stopIsolatedServer(server);
    }
    results.push(sample);
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({
      datasetVersion: dataset.version,
      runsPerCase: RUNS,
      caseIds: cases.map(testCase => testCase.id),
      updatedAt: new Date().toISOString(),
      results,
    }, null, 2), 'utf8');
    process.stdout.write(JSON.stringify({
      completed: results.length,
      total: cases.length * RUNS,
      caseId: sample.caseId,
      run,
      status: sample.status,
      turns: sample.turns.length,
      latencyMs: sample.turns.map(turn => turn.latencyMs),
    }) + '\n');
  }
}

const completed = results.filter(result => result.status === 'complete');
const turnResults = results.flatMap(result => result.turns);
const latency = turnResults.map(turn => turn.latencyMs).sort((a, b) => a - b);
const metadata = {
  generatedAt: new Date().toISOString(),
  dataset: path.relative(REPO, DATASET_PATH).replaceAll('\\', '/'),
  virtualTownArm: TOWN_ARM,
  virtualTownCurrentDay: VIRTUAL_DAY,
  datasetVersion: dataset.version,
  runsPerCase: RUNS,
  caseCount: cases.length,
  sampleCount: results.length,
  completeSamples: completed.length,
  completeTurns: turnResults.filter(turn => turn.status >= 200 && turn.status < 300 && turn.reply).length,
  totalTurns: cases.reduce((sum, testCase) => sum + testCase.turns.length, 0) * RUNS,
  medianLatencyMs: latency.length ? latency[Math.floor(latency.length / 2)] : null,
  provider: results.find(result => result.provider)?.provider ?? null,
  model: results.find(result => result.model)?.model ?? null,
  serverConfigured: results.some(result => result.serverConfigured),
  isolation: 'one fresh server process and temporary memories directory per case/run; no userId sent',
  results,
};

// Randomized blind review sheet. Keep each conversation intact and omit expected
// labels, case IDs, run numbers, and provider/model to reduce reviewer priming.
const blindRows = results.filter(sample => sample.turns.length > 0).map(sample => ({
  caseId: sample.caseId,
  run: sample.run,
  context: sample.context ?? [],
  conversation: sample.turns.map(turn => ({ user: turn.user, reply: turn.reply })),
}));
let seed = 0x2302026;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; }
for (let index = blindRows.length - 1; index > 0; index -= 1) {
  const swap = Math.floor(random() * (index + 1));
  [blindRows[index], blindRows[swap]] = [blindRows[swap], blindRows[index]];
}
const blindSheet = blindRows.map(({ caseId, run, context, conversation }, index) => {
  const sampleId = `S${String(index + 1).padStart(3, '0')}`;
  const rawSample = results.find(result => result.caseId === caseId && result.run === run);
  rawSample.blindedSampleId = sampleId;
  return {
    sampleId,
    priorContext: context,
    conversation: conversation.map(({ user, reply }, turnIndex) => ({
      user,
      reply,
      ratings: { reviewerA: null, reviewerB: null },
      hardFailure: { reviewerA: null, reviewerB: null },
      evidenceNotes: { reviewerA: '', reviewerB: '' },
      turnNumber: turnIndex + 1,
    })),
  };
});
fs.writeFileSync(path.join(OUT_DIR, 'emotion-expression-blind-review.json'), JSON.stringify({
  generatedAt: metadata.generatedAt,
  instructions: 'Reviewers score independently. Provider, model and run number are intentionally omitted.',
  rubric: dataset.blindReviewRubric,
  ratingScale: dataset.ratingScale,
  hardFailureExamples: dataset.hardFailureExamples,
  samples: blindSheet,
}, null, 2), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'emotion-expression-replay.json'), JSON.stringify(metadata, null, 2), 'utf8');

process.stdout.write(`REPORT=${path.join(OUT_DIR, 'emotion-expression-replay.json')}\n`);
process.stdout.write(`BLIND=${path.join(OUT_DIR, 'emotion-expression-blind-review.json')}\n`);
process.stdout.write(`SAMPLES=${completed.length}/${results.length} TURNS=${metadata.completeTurns}/${metadata.totalTurns} MEDIAN_MS=${metadata.medianLatencyMs ?? 'N/A'}\n`);
if (completed.length !== results.length || metadata.completeTurns !== metadata.totalTurns) process.exitCode = 1;
