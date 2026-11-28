import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import { scope, temporaryDatabase } from './testSupport.ts';

const storeUrl = new URL('./sqliteStore.ts', import.meta.url).href;
const coordinatorUrl = new URL('./stateCoordinator.ts', import.meta.url).href;
const worker = `
  import { once } from 'node:events';
  import { SqliteDaoStore } from ${JSON.stringify(storeUrl)};
  import { StateCoordinator } from ${JSON.stringify(coordinatorUrl)};
  const [directory, encodedScope, mode] = process.argv.slice(1);
  const scope = JSON.parse(encodedScope);
  const db = new SqliteDaoStore(directory);
  const coordinator = new StateCoordinator(db);
  const event = (eventId) => ({
    eventId, eventType: 'CounterAdded', source: 'm1-process',
    occurredAt: '2026-11-28T03:00:00Z', baseVersion: 0, consentVersion: 0,
    writeKind: 'commutative', change: { kind: 'increment', key: 'total', amount: 1 },
  });
  await db.health(scope.env);
  if (mode === 'crash') {
    await coordinator.commit(scope, event('durable'));
    await db.write(scope, async (tx) => {
      await coordinator.apply(tx, event('interrupted'));
      setInterval(() => {}, 1000);
      process.stdout.write('uncommitted\\n');
      await new Promise(() => {});
    });
  } else {
    process.stdout.write('ready\\n');
    await once(process.stdin, 'data');
    process.stdin.pause();
    await Promise.all(Array.from({ length: 10 }, (_, i) => coordinator.commit(scope, event(mode + '-' + i))));
    await db.close();
  }
`;

function launch(directory: string, mode: string) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', worker, directory, JSON.stringify(scope), mode], { windowsHide: true });
  // Avoid an unhandled error when a child exits before its input is consumed.
  child.stdin.on('error', () => {});
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return { child, exited, stderr: () => stderr };
}

function marker(child: ChildProcessWithoutNullStreams, expected: string) {
  let stdout = '';
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    const onData = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(expected + '\n')) { stop(); resolve(); }
    };
    const onExit = (code: number | null) => { stop(); reject(new Error('Worker exited before ' + expected + ': ' + code)); };
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

describe('M1 WAL process recovery and cross-process locking', () => {
  it('reopens a checkpointed log after a process dies between writes and COMMIT', async () => {
    const tmp = temporaryDatabase();
    const parent = new SqliteDaoStore(tmp.directory);
    const engine = new StateCoordinator(parent);
    let processUnderTest: ReturnType<typeof launch> | undefined;
    try {
      await Promise.all(Array.from({ length: 105 }, (_, i) => engine.commit(scope, {
        eventId: 'seed-' + i, eventType: 'CounterAdded', source: 'm1-parent',
        occurredAt: '2026-11-28T02:00:00Z', baseVersion: 0, consentVersion: 0,
        writeKind: 'commutative', change: { kind: 'increment', key: 'total', amount: 1 },
      })));
      const saved = await parent.read(scope, (tx) => tx.getLatestCheckpoint(DAO_PROJECTION_VERSION, 105));
      expect(saved?.sequence).toBe(100);
      await parent.close();
      processUnderTest = launch(tmp.directory, 'crash');
      await marker(processUnderTest.child, 'uncommitted');
      processUnderTest.child.kill('SIGKILL');
      const [, signal] = await processUnderTest.exited;
      expect(signal).toBe('SIGKILL');
      const reopened = new SqliteDaoStore(tmp.directory);
      try {
        const restored = new StateCoordinator(reopened);
        expect((await restored.recover(scope)).state).toMatchObject({ sequence: 106, counters: { total: 106 } });
        expect(await restored.current(scope)).toEqual(await restored.replay(scope));
        const visible = await reopened.read(scope, (tx) => ({
          events: tx.history(105, 10).map(({ event }) => event.eventId),
          outbox: tx.outbox(0, 400),
        }));
        expect(visible.events).toEqual(['durable']);
        expect(visible.outbox).toHaveLength(212);
      } finally {
        await reopened.close();
      }
    } finally {
      if (processUnderTest && processUnderTest.child.exitCode === null && processUnderTest.child.signalCode === null) {
        processUnderTest.child.kill();
        await processUnderTest.exited;
      }
      await parent.close();
      tmp.remove();
    }
  }, 20_000);

  it('keeps 20 writes ordered across two Node processes sharing the same SQLite WAL', async () => {
    const tmp = temporaryDatabase();
    const first = launch(tmp.directory, 'first');
    const second = launch(tmp.directory, 'second');
    try {
      await Promise.all([marker(first.child, 'ready'), marker(second.child, 'ready')]);
      first.child.stdin.write('go');
      second.child.stdin.write('go');
      expect(await first.exited, first.stderr()).toEqual([0, null]);
      expect(await second.exited, second.stderr()).toEqual([0, null]);
      const db = new SqliteDaoStore(tmp.directory);
      try {
        const engine = new StateCoordinator(db);
        const view = await engine.current(scope);
        expect(view.state).toMatchObject({ sequence: 20, counters: { total: 20 } });
        expect(await engine.replay(scope)).toEqual(view);
      } finally {
        await db.close();
      }
    } finally {
      for (const running of [first, second]) {
        if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill();
        await running.exited;
      }
      tmp.remove();
    }
  }, 20_000);
});
