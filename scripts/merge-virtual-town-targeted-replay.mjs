#!/usr/bin/env node
/**
 * Create a full evaluation revision by replacing one complete case with a
 * targeted rerun. The manifest keeps the limited code-change scope explicit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_ROOT = path.join(ROOT, 'artifacts', 'v2.31', 'replay');
const args = new Map(process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  return at > 0 ? [arg.slice(0, at).replace(/^--/, ''), arg.slice(at + 1)] : [arg, ''];
}));
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing_${name}`);
  const resolved = path.resolve(REPLAY_ROOT, value);
  if (!resolved.startsWith(REPLAY_ROOT + path.sep)) throw new Error(`${name}_outside_replay_root`);
  return resolved;
};
const caseId = args.get('case');
const revision = args.get('out');
if (!caseId || !revision || path.basename(revision) !== revision) throw new Error('invalid_case_or_output_revision');

function readReplay(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'emotion-expression-replay.json'), 'utf8'));
}
function loadPair(baseDir, patchDir, label) {
  const base = readReplay(baseDir);
  const patch = readReplay(patchDir);
  if (base.datasetVersion !== patch.datasetVersion || base.provider !== patch.provider || base.model !== patch.model) {
    throw new Error(`${label}_dataset_or_model_mismatch`);
  }
  const baseCases = new Set(base.results.map((sample) => sample.caseId));
  if (!baseCases.has(caseId) || patch.results.length !== 3
      || patch.results.some((sample) => sample.caseId !== caseId || sample.status !== 'complete' || sample.turns.length !== 4)) {
    throw new Error(`${label}_targeted_case_shape_mismatch`);
  }
  const patchByRun = new Map(patch.results.map((sample) => [sample.run, sample]));
  if ([1, 2, 3].some((run) => !patchByRun.has(run))) throw new Error(`${label}_missing_patch_run`);
  const results = base.results.map((sample) => sample.caseId === caseId ? patchByRun.get(sample.run) : sample);
  const turns = results.flatMap((sample) => sample.turns);
  const latencies = turns.map((turn) => turn.latencyMs).sort((a, b) => a - b);
  return {
    ...base,
    generatedAt: new Date().toISOString(),
    completeSamples: results.filter((sample) => sample.status === 'complete').length,
    completeTurns: turns.filter((turn) => turn.status >= 200 && turn.status < 300 && turn.reply).length,
    totalTurns: turns.length,
    medianLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    replayMerge: {
      baseRevision: path.basename(baseDir),
      targetedPatchRevision: path.basename(patchDir),
      replacedCaseId: caseId,
      replacedRuns: [...patchByRun.keys()].sort((a, b) => a - b),
      note: 'Only the target case was rerun after the reality-boundary guard change; all other cases retain the prior full replay output.',
    },
    results,
  };
}

const outputDirs = {
  town: path.join(REPLAY_ROOT, `with-town-${revision}`),
  control: path.join(REPLAY_ROOT, `without-town-${revision}`),
};
for (const [label, outputDir] of Object.entries(outputDirs)) fs.mkdirSync(outputDir, { recursive: true });
const town = loadPair(required('base-town'), required('patch-town'), 'town');
const control = loadPair(required('base-control'), required('patch-control'), 'control');
for (const [data, outputDir] of [[town, outputDirs.town], [control, outputDirs.control]]) {
  fs.writeFileSync(path.join(outputDir, 'emotion-expression-replay.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
process.stdout.write(`MERGED_CASE=${caseId} RUNS=3 REVISION=${revision}\n`);
