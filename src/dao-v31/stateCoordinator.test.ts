import { describe, expect, it } from 'vitest';
import { StateCoordinator } from './stateCoordinator.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { scope, temporaryDatabase } from './testSupport.ts';

describe('M1 State Coordinator', () => {
  it('persists atomic, idempotent ordered commits and rebuilds the same projection after reopening', async () => {
    const tmp = temporaryDatabase();
    const db = new SqliteDaoStore(tmp.directory);
    const engine = new StateCoordinator(db, () => 2_000_000);
    const proposal = {
      eventId: 'e1', eventType: 'CounterAdded', source: 'test',
      occurredAt: '2026-11-28T00:00:00Z', baseVersion: 0, consentVersion: 0,
      writeKind: 'commutative', change: { kind: 'increment', key: 'tally', amount: 2 },
    } as const;
    const first = await engine.commit(scope, proposal);
    expect(first.outcome).toBe('COMMITTED');
    expect((await engine.commit(scope, proposal)).outcome).toBe('NOOP_DUPLICATE');
    expect(await engine.current(scope)).toEqual({
      hash: first.stateHash, state: { sequence: 1, stateVersion: 1, counters: { tally: 2 }, derived: {}, slots: {} },
    });
    await db.close();

    const opened = new SqliteDaoStore(tmp.directory);
    try {
      const restored = new StateCoordinator(opened);
      expect(await restored.recover(scope)).toEqual(await restored.replay(scope));
      expect((await restored.current(scope)).hash).toBe(first.stateHash);
    } finally {
      await opened.close();
      tmp.remove();
    }
  });
});
