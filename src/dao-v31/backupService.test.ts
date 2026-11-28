import { describe, expect, it } from 'vitest';
import { BackupService } from './backupService.ts';
import type { JsonObject } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { scope, temporaryDatabase } from './testSupport.ts';
import { integrityHash } from './exactJson.ts';

describe('M1 integrity-checked scope backup', () => {
  it('recovers a fresh authorized scope, rejects tampering, and never restores forgotten data', async () => {
    const first = temporaryDatabase();
    const second = temporaryDatabase();
    const from = new SqliteDaoStore(first.directory);
    const into = new SqliteDaoStore(second.directory);
    function setup(store: SqliteDaoStore) {
      const state = new StateCoordinator(store);
      const consent = new ConsentManager(store, state);
      const hub = new PersonalDataHub(store, consent, state);
      const backups = new BackupService(store, consent, state);
      const authorize = () => consent.replace(scope, 'UserProvided', {
        sourceId: 'diary', collectionMode: 'manual', sensitivity: 'Personal', purposes: ['journal'],
        permissions: { allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: false,
          allowLongTermMemory: false, allowCharacterUse: false },
        expectedConsentVersion: 0, retentionPolicy: {},
      });
      return { state, consent, hub, backups, authorize };
    }
    try {
      const source = setup(from);
      const destination = setup(into);
      await source.authorize();
      const data = await source.hub.ingest(scope, {
        sourceId: 'diary', sensitivity: 'Personal', category: 'UserProvided', purpose: 'journal',
        occurredAt: '2026-11-28T00:00:00Z', type: 'journal', data: { title: 'backup proof' }, expectedConsentVersion: 1,
      });
      const backup = await source.backups.export(scope);
      const contents = backup.snapshot;
      const entities = contents.entities as readonly JsonObject[];
      const proofs = contents.lineage as readonly JsonObject[];
      const base = entities.find((entity) => entity.layer === 'observation')!;
      const pattern = {
        ...base, layer: 'pattern', ref: { kind: 'pattern', entityId: 'restored-pattern' },
        body: { summary: 'Should roll back' },
      };
      const updatedProof = { ...proofs[0], actor: { actorId: 'different-actor', kind: 'module' } };
      const validNewProof = {
        recordId: 'restored-lineage', scope, kind: 'derived', entity: pattern.ref, upstream: [base.ref],
        actor: { actorId: 'contract-test', kind: 'module' }, consentVersion: 1, occurredAt: backup.createdAt,
      };
      const adverse = {
        formatVersion: backup.formatVersion, createdAt: backup.createdAt, scope,
        snapshot: {
          ...contents, entities: [...entities, pattern], lineage: [updatedProof, ...proofs.slice(1), validNewProof],
        },
      };
      const sourceBefore = await source.state.current(scope);
      await expect(source.backups.restore(scope, {
        backup: { ...adverse, sha256: integrityHash(adverse) }, expectedStateVersion: 2, expectedConsentVersion: 1,
      })).rejects.toMatchObject({ status: 409, message: 'Backup would change existing provenance' });
      expect(await source.state.current(scope)).toEqual(sourceBefore);
      expect(await from.read(scope, (tx) => tx.entity('restored-pattern'))).toBeNull();
      await expect(destination.backups.restore(scope, { backup, expectedStateVersion: 0, expectedConsentVersion: 0 }))
        .rejects.toMatchObject({ status: 403 });
      expect((await destination.state.current(scope)).state.stateVersion).toBe(0);
      await destination.authorize();
      await expect(destination.backups.restore(scope, {
        backup: { ...backup, sha256: 'f'.repeat(64) }, expectedStateVersion: 1, expectedConsentVersion: 1,
      })).rejects.toMatchObject({ status: 400 });
      expect((await destination.state.current(scope)).state.stateVersion).toBe(1);
      expect((await destination.hub.listObservations(scope, {}, 0, 20)).items).toHaveLength(0);
      expect(await destination.backups.restore(scope, { backup, expectedStateVersion: 1, expectedConsentVersion: 1 }))
        .toMatchObject({ restored: true, stateVersion: 2 });
      expect((await destination.hub.listObservations(scope, {}, 0, 20)).items[0].summary).toBe('backup proof');
      expect(await destination.state.current(scope)).toEqual(await destination.state.replay(scope));
      await destination.hub.forget(scope, { kind: 'event', entityId: data.recordId }, 1);
      const after = await destination.state.current(scope);
      await expect(destination.backups.restore(scope, { backup, expectedStateVersion: after.state.stateVersion, expectedConsentVersion: 1 }))
        .rejects.toMatchObject({ status: 409 });
      expect(await destination.state.current(scope)).toEqual(after);
      expect((await destination.hub.listObservations(scope, {}, 0, 20)).items).toHaveLength(0);
    } finally {
      await Promise.all([from.close(), into.close()]);
      first.remove();
      second.remove();
    }
  });
});
