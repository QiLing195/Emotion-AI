import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPLAY_SCRIPT = path.join(PROJECT_ROOT, 'scripts/run-dual-loop-shadow-replay.mjs');

describe('offline dual-loop shadow replay persistence', () => {
  let memoriesDir: string;

  beforeEach(() => {
    memoriesDir = mkdtempSync(path.join(tmpdir(), 'ai-friend-shadow-replay-'));
  });

  afterEach(() => {
    rmSync(memoriesDir, { recursive: true, force: true });
  });

  function runReplay() {
    return spawnSync(process.execPath, ['--import', 'tsx', REPLAY_SCRIPT], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, MEMORIES_DIR: memoriesDir },
    });
  }

  it('persists minimized appraisal traces without mutating character state, and deduplicates a process restart', () => {
    const first = runReplay();
    expect(first.status).toBe(0);
    expect(first.stderr).toBe('');
    expect(first.stdout).toContain('"applied": 12');
    expect(first.stdout).toContain('"persistedRoleStateUnchanged": true');

    const replay = runReplay();
    expect(replay.status).toBe(0);
    expect(replay.stdout).toContain('"duplicates": 12');
    expect(replay.stdout).toContain('"persistedTraceCount": 12');

    const persisted = JSON.parse(readFileSync(path.join(memoriesDir, 'emotion_runtime_v1.json'), 'utf8'));
    expect(persisted.processedEvents).toHaveLength(12);
    expect(persisted.state.taiji.valence).toBeCloseTo(0.2);
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':quote')))
      .toMatchObject({ shadowTrace: { userSubject: 'third_party', roleStateWriteApplied: false } });
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':multiple-speakers')))
      .toMatchObject({ shadowTrace: { userSubject: 'multiple', appraisalReason: 'multiple_or_mixed_affect_sources' } });
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':double-negation-boundary')))
      .toMatchObject({ shadowTrace: { appraisalReason: 'user_declined_affect_discussion', proposedStateDelta: 0 } });
    expect(JSON.stringify(persisted)).not.toContain('我朋友说');
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':correction-before')))
      .toMatchObject({ shadowTrace: { appraisalDisposition: 'care_response_candidate', roleStateWriteApplied: false } });
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':correction-after')))
      .toMatchObject({ shadowTrace: {
        userCorrectionApplied: true,
        appraisalReason: 'user_correction_removed_affect',
        proposedStateDelta: 0,
      } });
    expect(persisted.processedEvents.find((event: { eventId: string }) => event.eventId.endsWith(':independent-own-event-001')))
      .toMatchObject({ shadowTrace: {
        eventSource: 'character_internal_event',
        demoLocalStateChanged: true,
        roleStateWriteApplied: false,
        proposedStateDelta: 0,
      } });
  });

  it('refuses to run if pointed at a directory inside the project', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', REPLAY_SCRIPT], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, MEMORIES_DIR: path.join(PROJECT_ROOT, 'memories') },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing to use a replay directory inside the project');
  });

  it('rejects non-minimized trace text before creating or poisoning a persistence snapshot', () => {
    const childProgram = `
      const { commitDualLoopEmotionEventAsync } = await import('./server/persistence.ts');
      const { INITIAL_EMOTION_STATE } = await import('./src/lib/emotionTypes.ts');
      const result = await commitDualLoopEmotionEventAsync({
        eventId:'unsafe-trace', subject:'character', appraisalVersion:'shadow-v0.1',
        initialState:structuredClone(INITIAL_EMOTION_STATE), update:state=>state,
        shadowTrace:{ source:'offline-replay', caseId:'unsafe', eventSource:'user_affect_bridge', demoLocalStateChanged:false, userSubject:'user',
          affectReportKind:'explicit_self_report', emotionHypothesis:['sad'], inferenceUncertainty:'low',
          userCorrectionApplied:false, appraisalDisposition:'care_response_candidate',
          appraisalReason:'我这周一直很难受', proposedStateDelta:0, roleStateWriteApplied:false }
      });
      console.log(JSON.stringify(result));
    `;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childProgram], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, MEMORIES_DIR: memoriesDir },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ status: 'rejected' });
    expect(existsSync(path.join(memoriesDir, 'emotion_runtime_v1.json'))).toBe(false);
  });
});
