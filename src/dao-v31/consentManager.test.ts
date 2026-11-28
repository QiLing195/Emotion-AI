import { describe, expect, it } from 'vitest';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { deferred, scope, temporaryDatabase } from './testSupport.ts';

const base = {
  sourceId: 'diary', category: 'UserProvided', sensitivity: 'Personal', collectionMode: 'manual', purpose: 'journal',
} as const;
const permissions = {
  allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: false,
  allowLongTermMemory: false, allowCharacterUse: false,
};

describe('M1 three-stage consent preflight and cancellation', () => {
  it('allows an unchanged ticket to persist authorized evidence through the real coordinator', async () => {
    const directory = temporaryDatabase();
    const db = new SqliteDaoStore(directory.directory);
    const coordinator = new StateCoordinator(db);
    const manager = new ConsentManager(db, coordinator);
    const hub = new PersonalDataHub(db, manager, coordinator);
    try {
      await manager.replace(scope, base.category, {
        ...base, purposes: [base.purpose], retentionPolicy: {}, permissions, expectedConsentVersion: 0,
      });
      const raw = await hub.ingest(scope, {
        ...base, type: 'journal', occurredAt: '2026-11-28T00:00:00Z',
        expectedConsentVersion: 1, data: { title: 'Valid evidence' },
      });
      const ticket = await manager.admit(scope, { ...base, permission: 'allowAnalysis' }, 1);
      const result = await manager.execute(ticket, async () => 'Valid derived value', (tx, summary) =>
        hub.deriveInTransaction(tx, {
          entityId: 'valid-candidate', layer: 'pattern', use: base, consentVersion: 1,
          upstream: [{ kind: 'event', entityId: raw.recordId }], body: { summary },
        }));
      expect((await hub.provenance(scope, result.entityId)).upstream).toHaveLength(2);
      expect(await coordinator.current(scope)).toEqual(await coordinator.replay(scope));
    } finally {
      await db.close();
      directory.remove();
    }
  });

  it.each(['pre_dispatch', 'pre_external', 'pre_commit'] as const)('rejects revocation at %s with zero new records', async (stage) => {
    const directory = temporaryDatabase();
    const db = new SqliteDaoStore(directory.directory);
    const coordinator = new StateCoordinator(db);
    const manager = new ConsentManager(db, coordinator);
    const hub = new PersonalDataHub(db, manager, coordinator);
    const use = { ...base, permission: 'allowAnalysis' } as const;
    const update = (expectedConsentVersion: number, enabled: boolean) => manager.replace(scope, base.category, {
      ...base, purposes: ['journal'], retentionPolicy: {},
      permissions: enabled ? permissions : { ...permissions, allowAnalysis: false }, expectedConsentVersion,
    });
    let externalCalls = 0;
    let commitCalls = 0;
    const entered = deferred();
    const release = deferred();
    let signal: AbortSignal | undefined;
    try {
      await update(0, true);
      const evidence = await hub.ingest(scope, {
        sourceId: base.sourceId, category: base.category, sensitivity: base.sensitivity,
        purpose: base.purpose, type: 'journal', occurredAt: '2026-11-28T00:00:00Z',
        expectedConsentVersion: 1, data: { title: 'Authorized foundation' },
      });
      if (stage === 'pre_dispatch') {
        await update(1, false);
        await expect(manager.admit(scope, use, 1)).rejects.toMatchObject({ details: { stage } });
      } else {
        const ticket = await manager.admit(scope, use, 1);
        if (stage === 'pre_external') await update(1, false);
        const pending = manager.execute(ticket, async (requestSignal) => {
          externalCalls++;
          signal = requestSignal;
          entered.resolve();
          await release.promise;
          return 'stale result';
        }, (tx, summary) => {
          commitCalls++;
          return hub.deriveInTransaction(tx, {
            entityId: 'stale-candidate', layer: 'pattern', use, consentVersion: 1,
            upstream: [{ kind: 'event', entityId: evidence.recordId }], body: { summary },
          });
        });
        const failure = expect(pending).rejects.toMatchObject({ details: { stage } });
        if (stage === 'pre_commit') {
          await entered.promise;
          await update(1, false);
          expect(signal?.aborted).toBe(true);
        }
        release.resolve();
        await failure;
      }
      expect(externalCalls).toBe(stage === 'pre_commit' ? 1 : 0);
      expect(commitCalls).toBe(0);
      expect(await db.read(scope, (tx) => tx.entities())).toHaveLength(2);
      expect(await db.read(scope, (tx) => tx.entity('stale-candidate'))).toBeNull();
      expect(await db.read(scope, (tx) => tx.history(0, 10).map(({ event }) => event.eventType)))
        .toEqual(['ConsentUpdated', 'ManualRecordIngested', 'ConsentRevoked']);
      expect(await db.read(scope, (tx) => tx.getConsentVersion())).toBe(2);
    } finally {
      release.resolve();
      await db.close();
      directory.remove();
    }
  });
});
