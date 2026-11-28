import { describe, expect, it } from 'vitest';
import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import type { StateProposal } from './stateCoordinator.ts';
import { deferred, scope, temporaryDatabase } from './testSupport.ts';

const ROUNDS = 100;
const CLIENTS = 20;
const grant = {
  sourceId: 'journal', sensitivity: 'Personal', purposes: ['self-record'],
  collectionMode: 'manual', retentionPolicy: {}, expectedConsentVersion: 0,
  permissions: { allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: false,
    allowLongTermMemory: true, allowCharacterUse: false },
} as const;
const occurredAt = '2026-11-28T02:00:00Z';

function increment(eventId: string, other: Partial<StateProposal> = {}): StateProposal {
  return {
    eventId, eventType: 'CounterAdded', source: 'm1-stress', occurredAt,
    baseVersion: 0, consentVersion: 0, writeKind: 'commutative', change: { kind: 'increment', key: 'total', amount: 1 },
    ...other,
  };
}

type Round = {
  readonly scope: DaoScope;
  readonly states: readonly StateCoordinator[];
  readonly hub: PersonalDataHub;
  readonly hubs: readonly PersonalDataHub[];
  readonly consent: ConsentManager;
  readonly db: SqliteDaoStore;
  readonly tick: (time: number) => void;
};

function startTogether<T>(work: (index: number) => Promise<T>) {
  const start = deferred();
  const waiting = Array.from({ length: CLIENTS }, (_, index) => start.promise.then(() => work(index)));
  start.resolve();
  return Promise.allSettled(waiting);
}

function enforce(results: readonly PromiseSettledResult<unknown>[], expectedSuccess: number) {
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(expectedSuccess);
  for (const item of results) {
    if (item.status === 'rejected') expect(item.reason).toMatchObject({ status: 409 });
  }
}

const cases: Record<string, (fixture: Round, index: number) => Promise<void>> = {
  'same snapshot concurrent commutative commits': async ({ scope, states }) => {
    const results = await startTogether((i) => states[i % 2].commit(scope, increment('same-' + i)));
    enforce(results, CLIENTS);
    expect((await states[0].current(scope)).state.counters.total).toBe(CLIENTS);
    expect((await states[1].commit(scope, increment('same-0'))).outcome).toBe('NOOP_DUPLICATE');
  },
  'heterogeneous writes recompute from their actual committed prefix': async ({ scope, states, db }, round) => {
    const commits = await startTogether((i) => {
      const operation = (i + round) % 20;
      const engine = states[i % 2];
      if (operation === 0) {
        return engine.commit(scope, increment('ex', { writeKind: 'exclusive', change: { kind: 'set', key: 'status', value: 8 } }));
      }
      if (operation === 1) {
        return engine.commit(scope, increment('gov', {
          writeKind: 'governed', change: { kind: 'remove', keys: ['status'] }, governanceApproved: true,
        }));
      }
      if (operation === 2 || operation === 19) {
        return engine.commit(scope, increment('sum-' + operation, {
          writeKind: 'recomputable', change: { kind: 'sum', key: 'derived-total', inputs: ['total'] },
        }));
      }
      return engine.commit(scope, increment('mix-' + operation));
    });
    const accepted = commits.filter((item) => item.status === 'fulfilled').length;
    expect(accepted).toBe(round % 20 < 2 ? 19 : 18);
    enforce(commits, accepted);
    const { state } = await states[0].current(scope);
    const history = await db.read(scope, (tx) => tx.history(0, 50));
    const lastSum = history.reduce((last, { commit }, index) => commit.writeKind === 'recomputable' ? index : last, -1);
    const accumulatedBeforeLastSum = history.slice(0, lastSum).filter(({ commit }) => commit.writeKind === 'commutative').length;
    expect(state.counters.total).toBe(16);
    expect(state.derived['derived-total']).toBe(accumulatedBeforeLastSum);
    expect(state.slots.status).toBe(round % 20 === 0 ? 8 : undefined);
  },
  'timed-out proposals finishing after the newer batch cannot cover the current state': async ({ scope, states, tick }) => {
    const releaseLate = deferred();
    const begin = deferred();
    const late = Array.from({ length: 10 }, (_, i) => begin.promise.then(async () => {
      await releaseLate.promise;
      return states[i % 2].commit(scope, increment('late-' + i, {
        writeKind: 'exclusive', deadlineMs: 1001, change: { kind: 'set', key: 'status', value: 99 },
        occurredAt: '2026-11-28T00:00:00Z',
      }));
    }));
    const onTime = Array.from({ length: 10 }, (_, i) => begin.promise.then(() =>
      states[i % 2].commit(scope, increment('on-time-' + i, { deadlineMs: 1001 }))));
    const all = Promise.allSettled([...late, ...onTime]);
    tick(1000);
    begin.resolve();
    await Promise.all(onTime);
    tick(1002);
    releaseLate.resolve();
    const results = await all;
    expect(results.slice(0, 10).every((value) => value.status === 'rejected')).toBe(true);
    enforce(results, 10);
    expect((await states[0].current(scope)).state).toMatchObject({ counters: { total: 10 }, slots: {} });
  },
  'two exclusive proposals competing from the same version leave exactly one writer': async ({ scope, states }, round) => {
    const results = await startTogether((i) => {
      const value = (i + round) % 2;
      return states[i % 2].commit(scope, increment('exclusive-' + value, {
        writeKind: 'exclusive', change: { kind: 'set', key: 'status', value: value + 1 },
      }));
    });
    enforce(results, 10);
    const accepted = results.flatMap((item) => item.status === 'fulfilled' && item.value.outcome === 'COMMITTED' ? [item.value] : []);
    expect(accepted).toHaveLength(1);
    const current = await states[0].current(scope);
    expect(current.state.slots.status).toBe(round % 2 + 1);
    expect(current.hash).toBe(accepted[0].stateHash);
  },
  'ForgetRequest racing with memory writes prevents erased evidence from being resurrected': async ({ scope, states, hub, hubs, consent, db }, round) => {
    await consent.replace(scope, 'UserProvided', grant);
    const raw = await hub.ingest(scope, {
      sourceId: 'journal', category: 'UserProvided', sensitivity: 'Personal', purpose: 'self-record',
      type: 'journal', occurredAt, data: { title: 'Erasure subject' }, expectedConsentVersion: 1,
    });
    const { items: [observed] } = await hub.listObservations(scope, {}, 0, 10);
    const root: EntityRef = { kind: 'event', entityId: raw.recordId };
    const upstream = [{ kind: 'observation', entityId: observed.observationId }] as const;
    const deletePosition = round % CLIENTS;
    const results = await startTogether((i) => i === deletePosition
      ? hubs[i % 2].forget(scope, root, 1).then((value) => ({ written: false, affected: value.affectedCount }))
      : hubs[i % 2].derive(scope, {
        entityId: 'memory-' + i, layer: 'memory', upstream, consentVersion: 1, memoryGovernanceApproved: true,
        use: { sourceId: 'journal', category: 'UserProvided', sensitivity: 'Personal', collectionMode: 'manual', purpose: 'self-record' },
        body: { summary: 'resurrection fence marker' },
      }).then(() => ({ written: true, affected: 0 })));
    enforce(results, deletePosition + 1);
    expect(results[deletePosition]).toEqual({ status: 'fulfilled', value: { written: false, affected: deletePosition + 2 } });
    expect(await hub.searchMemory(scope, 'fence marker')).toEqual([]);
    expect((await hub.listObservations(scope, {}, 0, 10)).items).toEqual([]);
    expect((await states[0].current(scope)).state.counters.manualRecords).toBe(0);
    expect(await db.read(scope, (tx) => tx.tombstones())).toHaveLength(deletePosition + 2);
  },
};

describe('M1 E3 SQLite five-class concurrency gate', () => {
  it.each(Object.entries(cases))('%s with 20 clients for 100 rounds', async (name, run) => {
    const tmp = temporaryDatabase();
    const first = new SqliteDaoStore(tmp.directory);
    const second = new SqliteDaoStore(tmp.directory);
    let now = Date.parse('2026-11-28T12:00:00Z');
    const clock = () => now;
    const states = [new StateCoordinator(first, clock), new StateCoordinator(second, clock)];
    const consent = new ConsentManager(first, states[0], clock);
    const otherConsent = new ConsentManager(second, states[1], clock);
    const hubs = [new PersonalDataHub(first, consent, states[0], clock), new PersonalDataHub(second, otherConsent, states[1], clock)];
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const currentScope = { ...scope, sessionId: 'stress-' + round };
        await run({ scope: currentScope, states, hub: hubs[0], hubs, consent, db: first, tick: (time) => { now = time; } }, round);
        const replayed = await states[1].replay(currentScope);
        expect(replayed).toEqual(await states[0].current(currentScope));
        const entries = await first.read(currentScope, (tx) => tx.history(0, 128));
        expect(entries.map(({ commit }) => commit.stateVersion)).toEqual(Array.from({ length: entries.length }, (_, i) => i + 1));
        expect(entries.at(-1)?.commit.stateHash).toBe(replayed.hash);
      }
      process.stdout.write(`M1 ${name}: ${ROUNDS}x${CLIENTS}; zero silent overwrite or version disorder; replay hashes ${ROUNDS}/${ROUNDS}\n`);
    } finally {
      await Promise.all([first.close(), second.close()]);
      tmp.remove();
    }
  }, 90_000);
});
