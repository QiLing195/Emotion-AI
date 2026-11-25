import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHILD_PROGRAM = `
import fs from 'node:fs';
const mode = process.env.DUAL_LOOP_CHILD_MODE;
if (mode === 'crash-before-rename' || mode === 'crash-after-rename') {
  const originalRename = fs.promises.rename.bind(fs.promises);
  fs.promises.rename = async (...args) => {
    if (mode === 'crash-before-rename') process.exit(71);
    await originalRename(...args);
    if (mode === 'crash-after-rename') process.exit(72);
  };
}
const { INITIAL_EMOTION_STATE } = await import('./src/lib/emotionTypes.ts');
const { commitDualLoopEmotionEventAsync } = await import('./server/persistence.ts');
const eventId = process.env.DUAL_LOOP_EVENT_ID;
const initialState = structuredClone(INITIAL_EMOTION_STATE);
initialState.taiji.valence = 0;
const result = await commitDualLoopEmotionEventAsync({
  eventId,
  subject: 'character',
  appraisalVersion: 'shadow-v0',
  initialState,
  update: current => {
    if (mode === 'remove-lock-during-update') {
      const lockDir = process.env.MEMORIES_DIR + '/emotion_runtime_v1.json.lock';
      fs.writeFileSync(lockDir + '/test-owner-marker', 'force release failure');
      setTimeout(() => fs.rmSync(lockDir, { recursive: true, force: true }), 1_000);
    }
    current.taiji.valence += 0.1;
    return current;
  },
});
console.log(JSON.stringify({ status: result.status, valence: result.state?.taiji?.valence }));
`;

describe('dual-loop emotion persistence across real Node processes', () => {
  let memoriesDir: string;

  beforeEach(() => {
    memoriesDir = mkdtempSync(path.join(tmpdir(), 'ai-friend-dual-loop-process-'));
  });

  afterEach(() => {
    rmSync(memoriesDir, { recursive: true, force: true });
  });

  function runChild(mode: string, eventId: string) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', CHILD_PROGRAM],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          MEMORIES_DIR: memoriesDir,
          DUAL_LOOP_CHILD_MODE: mode,
          DUAL_LOOP_EVENT_ID: eventId,
        },
      },
    );
    return result;
  }

  function resultJson(stdout: string) {
    const line = stdout.trim().split(/\r?\n/).at(-1);
    return JSON.parse(line ?? '{}') as { status?: string; valence?: number };
  }

  it('deduplicates an event after the writer exits and a new process starts', () => {
    const first = runChild('commit', 'process-restart-event');
    expect(first.status).toBe(0);
    expect(resultJson(first.stdout)).toMatchObject({ status: 'applied' });

    const replay = runChild('replay', 'process-restart-event');
    expect(replay.status).toBe(0);
    expect(resultJson(replay.stdout)).toMatchObject({ status: 'duplicate' });
    expect(resultJson(replay.stdout).valence).toBeCloseTo(0.1);
  });

  it('ignores a temporary snapshot after a process exits before rename, then can apply the uncommitted event once', () => {
    const seed = runChild('commit', 'seed-event');
    expect(seed.status).toBe(0);

    const crashed = runChild('crash-before-rename', 'interrupted-event');
    expect(crashed.status).toBe(71);
    const finalFile = path.join(memoriesDir, 'emotion_runtime_v1.json');
    expect(existsSync(finalFile)).toBe(true);
    expect(readdirSync(memoriesDir).some(name => name.endsWith('.tmp'))).toBe(true);
    expect(JSON.parse(readFileSync(finalFile, 'utf8')).processedEvents.map((event: { eventId: string }) => event.eventId))
      .toEqual(['seed-event']);

    const retry = runChild('retry', 'interrupted-event');
    expect(retry.status).toBe(0);
    expect(resultJson(retry.stdout).status).toBe('applied');
    expect(resultJson(retry.stdout).valence).toBeCloseTo(0.2);
    expect(readdirSync(memoriesDir).some(name => name.endsWith('.tmp'))).toBe(false);
  });

  it('treats a process exit after rename as committed, even when the caller received no result', () => {
    const crashed = runChild('crash-after-rename', 'committed-before-response');
    expect(crashed.status).toBe(72);

    const replay = runChild('restart-replay', 'committed-before-response');
    expect(replay.status).toBe(0);
    expect(resultJson(replay.stdout).status).toBe('duplicate');
    expect(resultJson(replay.stdout).valence).toBeCloseTo(0.1);
  });

  it('reports lock release failure and allows the caller to safely resolve commit status by replaying the same key', () => {
    const interrupted = runChild('remove-lock-during-update', 'lock-release-event');
    expect(interrupted.status).toBe(0);
    expect(resultJson(interrupted.stdout).status).toBe('persistence_error');

    const finalFile = path.join(memoriesDir, 'emotion_runtime_v1.json');
    expect(JSON.parse(readFileSync(finalFile, 'utf8')).processedEvents.map((event: { eventId: string }) => event.eventId))
      .toContain('lock-release-event');

    const replay = runChild('retry', 'lock-release-event');
    expect(replay.status).toBe(0);
    expect(resultJson(replay.stdout).status).toBe('duplicate');
    expect(resultJson(replay.stdout).valence).toBeCloseTo(0.1);
  });
});
