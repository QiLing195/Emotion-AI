import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHILD_PROGRAM = `
import fs from 'node:fs';
import path from 'node:path';
const barrierDir = process.env.DUAL_LOOP_BARRIER_DIR;
await fs.promises.writeFile(path.join(barrierDir, process.pid + '.ready'), 'ready');
while (fs.readdirSync(barrierDir).filter(name => name.endsWith('.ready')).length < 2) {
  await new Promise(resolve => setTimeout(resolve, 5));
}
const { commitDualLoopEmotionEventAsync } = await import('./server/persistence.ts');
const { INITIAL_EMOTION_STATE } = await import('./src/lib/emotionTypes.ts');
const state = structuredClone(INITIAL_EMOTION_STATE);
const result = await commitDualLoopEmotionEventAsync({
  eventId: process.env.DUAL_LOOP_EVENT_ID,
  subject: 'character',
  appraisalVersion: 'shadow-v0',
  initialState: state,
  update: current => {
    current.taiji.valence += 0.1;
    return current;
  },
});
console.log(JSON.stringify({ status: result.status }));
`;

describe('dual-loop state transaction across Node processes', () => {
  let testRoot: string;
  let memoriesDir: string;
  let barrierDir: string;

  beforeEach(() => {
    testRoot = mkdtempSync(path.join(tmpdir(), 'ai-friend-dual-loop-multiprocess-'));
    memoriesDir = path.join(testRoot, 'memories');
    barrierDir = path.join(testRoot, 'barrier');
    mkdirSync(barrierDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function startChild(eventId: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', CHILD_PROGRAM], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MEMORIES_DIR: memoriesDir,
        DUAL_LOOP_BARRIER_DIR: barrierDir,
        DUAL_LOOP_EVENT_ID: eventId,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    return { child, done: new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
      child.on('close', code => resolve({ code, stdout, stderr }));
    }) };
  }

  function parseResult(stdout: string) {
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as { status?: string };
  }

  it('preserves two distinct events submitted simultaneously by separate processes', async () => {
    const { spawnSync } = await import('node:child_process');
    const seedProgram = `
      const { commitDualLoopEmotionEventAsync } = await import('./server/persistence.ts');
      const { INITIAL_EMOTION_STATE } = await import('./src/lib/emotionTypes.ts');
      const state = structuredClone(INITIAL_EMOTION_STATE); state.taiji.valence = 0;
      const result = await commitDualLoopEmotionEventAsync({ eventId:'seed', subject:'character', appraisalVersion:'shadow-v0', initialState:state, update:s=>s });
      console.log(JSON.stringify({status:result.status}));
    `;
    const seeded = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', seedProgram], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      env: { ...process.env, MEMORIES_DIR: memoriesDir },
    });
    expect(seeded.status).toBe(0);
    expect(parseResult(seeded.stdout).status).toBe('applied');

    const a = startChild('event-a');
    const b = startChild('event-b');
    const [resultA, resultB] = await Promise.all([a.done, b.done]);
    expect([resultA.code, resultB.code]).toEqual([0, 0]);
    expect(resultA.stderr + resultB.stderr).toBe('');
    expect(parseResult(resultA.stdout).status).toBe('applied');
    expect(parseResult(resultB.stdout).status).toBe('applied');

    const persisted = JSON.parse(readFileSync(path.join(memoriesDir, 'emotion_runtime_v1.json'), 'utf8'));
    const ids = persisted.processedEvents.map((event: { eventId: string }) => event.eventId);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('event-a');
    expect(ids).toContain('event-b');
    expect(persisted.state.taiji.valence).toBeCloseTo(0.2);
  }, 30_000);

  it('applies the same event key only once across separate processes', async () => {
    const { spawnSync } = await import('node:child_process');
    const seedProgram = `
      const { commitDualLoopEmotionEventAsync } = await import('./server/persistence.ts');
      const { INITIAL_EMOTION_STATE } = await import('./src/lib/emotionTypes.ts');
      const state = structuredClone(INITIAL_EMOTION_STATE); state.taiji.valence = 0;
      await commitDualLoopEmotionEventAsync({ eventId:'seed', subject:'character', appraisalVersion:'shadow-v0', initialState:state, update:s=>s });
    `;
    const seeded = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', seedProgram], {
      cwd: PROJECT_ROOT, encoding: 'utf8', env: { ...process.env, MEMORIES_DIR: memoriesDir },
    });
    expect(seeded.status).toBe(0);

    const a = startChild('same-event');
    const b = startChild('same-event');
    const [resultA, resultB] = await Promise.all([a.done, b.done]);
    expect([resultA.code, resultB.code]).toEqual([0, 0]);
    const statuses = [parseResult(resultA.stdout).status, parseResult(resultB.stdout).status].sort();
    expect(statuses).toEqual(['applied', 'duplicate']);
    const persisted = JSON.parse(readFileSync(path.join(memoriesDir, 'emotion_runtime_v1.json'), 'utf8'));
    expect(persisted.processedEvents.filter((event: { eventId: string }) => event.eventId === 'same-event')).toHaveLength(1);
    expect(persisted.state.taiji.valence).toBeCloseTo(0.1);
  }, 30_000);
});
