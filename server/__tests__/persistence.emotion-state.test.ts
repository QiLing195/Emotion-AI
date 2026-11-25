import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_EMOTION_STATE } from '../../src/lib/emotionTypes.js';
import type { EmotionState } from '../../src/lib/emotionTypes.js';

describe('emotion state JSON persistence boundary', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(path.join(tmpdir(), 'ai-friend-emotion-persistence-'));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(testRoot, { recursive: true, force: true });
  });

  function makeState(valence: number, sadness: number): EmotionState {
    const state = structuredClone(INITIAL_EMOTION_STATE);
    state.taiji.valence = valence;
    state.emotions.sad = sadness;
    return state;
  }

  async function loadPersistence(memoriesDir = testRoot) {
    vi.stubEnv('MEMORIES_DIR', memoriesDir);
    vi.resetModules();
    return import('../persistence.js');
  }

  it('writes a complete JSON snapshot and restores it after the persistence module is reloaded', async () => {
    const persistence = await loadPersistence();
    const expected = makeState(-0.27, 0.63);

    await persistence.saveEmotionStateAsync(expected);

    const file = path.join(testRoot, 'emotion_state.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(expected);

    vi.resetModules();
    const restartedPersistence = await import('../persistence.js');
    expect(restartedPersistence.loadEmotionState()).toEqual(expected);
  });

  it('serializes consecutive writes to the same file and leaves valid JSON with the last submitted snapshot', async () => {
    const persistence = await loadPersistence();
    const first = makeState(-0.1, 0.2);
    const last = makeState(0.35, 0.81);

    await Promise.all([
      persistence.saveEmotionStateAsync(first),
      persistence.saveEmotionStateAsync(last),
    ]);

    const file = path.join(testRoot, 'emotion_state.json');
    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted).toEqual(last);
    expect(persistence.loadEmotionState()).toEqual(last);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('currently resolves after a failed write, exposing that callers cannot observe persistence failure', async () => {
    const blocker = path.join(testRoot, 'not-a-directory');
    writeFileSync(blocker, 'file');
    const impossibleMemoriesDir = path.join(blocker, 'memories');
    const persistence = await loadPersistence(impossibleMemoriesDir);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(persistence.saveEmotionStateAsync(makeState(0.1, 0.4))).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalled();
    expect(persistence.loadEmotionState()).toBeNull();
    errorLog.mockRestore();
  });

  it('atomically stores state with the event key and rejects a duplicate after module reload', async () => {
    const persistence = await loadPersistence();
    const initialState = makeState(-0.2, 0.3);
    const input = {
      eventId: 'event-001',
      subject: 'character' as const,
      appraisalVersion: 'shadow-v0',
      initialState,
      update: (current: EmotionState) => {
        current.taiji.valence += 0.1;
        return current;
      },
    };

    const applied = await persistence.commitDualLoopEmotionEventAsync(input);
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') throw new Error('expected event to be applied');
    expect(applied.state.taiji.valence).toBeCloseTo(-0.1);

    const file = path.join(testRoot, 'emotion_runtime_v1.json');
    const persisted = JSON.parse(readFileSync(file, 'utf8'));
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.state.taiji.valence).toBeCloseTo(-0.1);
    expect(persisted.processedEvents).toEqual([{
      key: JSON.stringify(['event-001', 'character', 'shadow-v0']),
      eventId: 'event-001',
      subject: 'character',
      appraisalVersion: 'shadow-v0',
    }]);

    vi.resetModules();
    const restartedPersistence = await import('../persistence.js');
    const duplicate = await restartedPersistence.commitDualLoopEmotionEventAsync({
      ...input,
      initialState: undefined,
      update: () => { throw new Error('duplicate must not invoke the state updater'); },
    });
    expect(duplicate.status).toBe('duplicate');
    if (duplicate.status !== 'duplicate') throw new Error('expected duplicate after reload');
    expect(duplicate.state.taiji.valence).toBeCloseTo(-0.1);
    expect(JSON.parse(readFileSync(file, 'utf8')).processedEvents).toHaveLength(1);
  });

  it('serializes concurrent commits with the same event key and scopes keys by subject and appraisal version', async () => {
    const persistence = await loadPersistence();
    const initialState = makeState(0, 0.1);
    const sameEvent = {
      eventId: 'event-race',
      subject: 'character' as const,
      appraisalVersion: 'shadow-v0',
      initialState,
      update: (current: EmotionState) => {
        current.taiji.valence += 0.1;
        return current;
      },
    };

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => persistence.commitDualLoopEmotionEventAsync(sameEvent)),
    );
    expect(concurrent.filter(result => result.status === 'applied')).toHaveLength(1);
    expect(concurrent.filter(result => result.status === 'duplicate')).toHaveLength(7);

    const nextSubject = await persistence.commitDualLoopEmotionEventAsync({
      ...sameEvent,
      initialState: undefined,
      subject: 'user',
    });
    const nextVersion = await persistence.commitDualLoopEmotionEventAsync({
      ...sameEvent,
      initialState: undefined,
      appraisalVersion: 'shadow-v1',
    });
    expect(nextSubject.status).toBe('applied');
    expect(nextVersion.status).toBe('applied');

    const persisted = JSON.parse(readFileSync(path.join(testRoot, 'emotion_runtime_v1.json'), 'utf8'));
    expect(persisted.processedEvents).toHaveLength(3);
    expect(persisted.state.taiji.valence).toBeCloseTo(0.3);
  });

  it('returns persistence_error instead of success when the transactional directory is not writable', async () => {
    const blocker = path.join(testRoot, 'file-not-directory');
    writeFileSync(blocker, 'file');
    const persistence = await loadPersistence(path.join(blocker, 'nested'));

    const result = await persistence.commitDualLoopEmotionEventAsync({
      eventId: 'event-fail',
      subject: 'character',
      appraisalVersion: 'shadow-v0',
      initialState: makeState(0, 0),
      update: current => {
        current.taiji.valence = 0.5;
        return current;
      },
    });

    expect(result.status).toBe('persistence_error');
  });
});
