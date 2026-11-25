#!/usr/bin/env node
/** Run a real-model, isolated-server A/B replay with the virtual-town event off/on. */
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evalScript = path.join(repo, 'scripts', 'run-emotion-expression-eval.mjs');
const dataset = path.join(repo, 'artifacts', 'v2.31', 'virtual-town-eval-set.json');
const defaultCases = [
  'town_ask_recorded_activity',
  'town_ask_real_activity',
  'town_unrecorded_bookshop',
  'town_unrecorded_mood_cause',
  'town_unrecorded_cafe',
];
const cases = String(process.env.VIRTUAL_TOWN_EVAL_CASE_IDS || defaultCases.join(','))
  .split(',').map(value => value.trim()).filter(Boolean);
const runs = Math.max(1, Math.min(5, Number(process.env.VIRTUAL_TOWN_EVAL_RUNS || 3)));
const revision = process.env.VIRTUAL_TOWN_EVAL_REVISION || 'final-guard';
const withTownOnly = process.env.VIRTUAL_TOWN_EVAL_WITH_ONLY === 'true';

function runArm(name, enabled) {
  const output = path.join(repo, 'artifacts', 'v2.31', 'replay', `${name}-${revision}`);
  const env = {
    ...process.env,
    EMOTION_EVAL_DATASET_PATH: dataset,
    EMOTION_EVAL_OUTPUT_DIR: output,
    EMOTION_EVAL_CASE_IDS: cases.join(','),
    EMOTION_EVAL_RUNS: String(runs),
    ENABLE_UNIFIED_EXPRESSION: 'true',
    ENABLE_VIRTUAL_TOWN_EXPERIMENT: enabled ? 'true' : 'false',
    DISABLE_EXPRESSION_ENFORCEMENT: 'false',
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [evalScript], { cwd: repo, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolve()
      : reject(new Error(`${name}_replay_failed_exit_${code}`)));
  });
}

if (!withTownOnly) await runArm('without-town', false);
await runArm('with-town', true);
console.log(`Virtual-town ${withTownOnly ? 'targeted replay' : 'A/B'} complete: ${cases.length} cases × ${runs} repeats per arm.`);
