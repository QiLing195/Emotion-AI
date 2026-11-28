import { describe, expect, it } from 'vitest';
import type { EntityRef } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { scope, temporaryDatabase } from './testSupport.ts';

describe('M1 Personal Data Hub and R16 lineage', () => {
  it('exposes the scoped DAG under current consent and fences deleted dependencies', async () => {
    const temp = temporaryDatabase();
    const db = new SqliteDaoStore(temp.directory);
    const coordinator = new StateCoordinator(db);
    const manager = new ConsentManager(db, coordinator);
    const hub = new PersonalDataHub(db, manager, coordinator);
    const grant = {
      category: 'UserProvided', sensitivity: 'Personal', sourceId: 'diary', collectionMode: 'manual',
      purposes: ['journal'], retentionPolicy: {}, expectedConsentVersion: 0,
      permissions: { allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: true,
        allowLongTermMemory: true, allowCharacterUse: false },
    } as const;
    try {
      await expect(hub.listObservations(scope, {}, 0, 20)).rejects.toMatchObject({ status: 403 });
      await manager.replace(scope, grant.category, grant);
      const result = await hub.ingest(scope, {
        sourceId: grant.sourceId, category: grant.category, sensitivity: grant.sensitivity,
        type: 'diary', purpose: 'journal', data: { title: 'Morning practice' },
        occurredAt: '2026-11-28T00:00:00Z', expectedConsentVersion: 1,
      });
      const page = await hub.listObservations(scope, {}, 0, 20);
      expect(page.items.map((item) => item.summary)).toEqual(['Morning practice']);
      const derived = await hub.derive(scope, {
        entityId: 'derived-memory', layer: 'memory',
        upstream: [{ kind: 'observation', entityId: page.items[0].observationId }],
        use: { ...grant, purpose: 'journal' }, body: { summary: 'Evidence marker' }, consentVersion: 1,
        memoryGovernanceApproved: true,
      });
      expect(await hub.searchMemory(scope, 'marker')).toHaveLength(1);
      expect((await hub.provenance(scope, derived.entityId)).upstream.map((item) => item.kind).sort())
        .toEqual(['collected', 'derived', 'derived']);
      expect((await hub.forget(scope, { kind: 'event', entityId: result.recordId }, 1)).affectedCount).toBe(3);
      expect((await hub.listObservations(scope, {}, 0, 20)).items).toHaveLength(0);
      expect(await hub.searchMemory(scope, 'marker')).toHaveLength(0);
      expect((await coordinator.current(scope)).state.counters.manualRecords).toBe(0);
      await expect(hub.derive(scope, {
        entityId: 'late', layer: 'memory', upstream: [derived],
        use: { ...grant, purpose: 'journal' }, body: { summary: 'Late copy' }, consentVersion: 1,
        memoryGovernanceApproved: true,
      })).rejects.toMatchObject({ status: 409 });
    } finally {
      await db.close();
      temp.remove();
    }
  });

  it('tracks all six data layers, processing versions, and consumers without crossing scopes or revived grants', async () => {
    const temp = temporaryDatabase();
    const db = new SqliteDaoStore(temp.directory);
    const coordinator = new StateCoordinator(db);
    const manager = new ConsentManager(db, coordinator);
    const hub = new PersonalDataHub(db, manager, coordinator);
    const use = {
      sourceId: 'diary', category: 'UserProvided', sensitivity: 'Personal', collectionMode: 'manual', purpose: 'journal',
    } as const;
    const initial = {
      ...use, purposes: ['journal'], retentionPolicy: {}, expectedConsentVersion: 0,
      permissions: { allowRead: true, allowUpload: true, allowAnalysis: true, allowPsychologicalInference: true,
        allowLongTermMemory: true, allowCharacterUse: true },
    };
    try {
      await manager.replace(scope, use.category, initial);
      const write = await hub.ingest(scope, {
        ...use, type: 'journal', occurredAt: '2026-11-28T00:00:00Z',
        data: { title: 'Visible fact' }, expectedConsentVersion: 1,
      });
      const { items: [observation] } = await hub.listObservations(scope, {}, 0, 10);
      let parent: EntityRef = { kind: 'observation', entityId: observation.observationId };
      for (const layer of ['pattern', 'hypothesis', 'memory', 'insight'] as const) {
        parent = await hub.derive(scope, {
          entityId: 'proof-' + layer, layer, upstream: [parent], use, consentVersion: 1,
          body: { summary: 'Authorized ' + layer }, memoryGovernanceApproved: true,
          ...(layer === 'hypothesis' && { versions: { model: 'verified-test', prompt: '1.0.0', knowledgeBase: '1.0.0' } }),
        });
      }
      await hub.recordUse(scope, parent, use, 1, { actorId: 'reviewer', kind: 'module' });
      await hub.recordUse(scope, parent, use, 1, { actorId: 'gateway', kind: 'module' }, { kind: 'task', id: 'task-1' });
      const graph = await hub.provenance(scope, write.recordId);
      expect(graph.upstream).toMatchObject([{ kind: 'collected', source: { sourceId: 'diary' } }]);
      expect(graph.downstream.map((item) => item.kind).sort())
        .toEqual(['accessed', 'consumed', 'derived', 'derived', 'derived', 'derived', 'processed']);
      expect(graph.downstream.find((item) => item.kind === 'processed')?.versions?.model).toBe('verified-test');
      await expect(hub.recordUse(scope, parent, use, 1, { actorId: 'role', kind: 'module' },
        { kind: 'character', id: scope.characterId })).rejects.toMatchObject({ status: 403 });
      for (const other of [
        { ...scope, ownerId: 'another-owner' },
        { ...scope, env: 'exp' as const },
        { ...scope, characterId: 'another-character' },
        { ...scope, sessionId: 'another-session' },
      ]) {
        await expect(hub.provenance(other, parent.entityId)).rejects.toMatchObject({ status: 404 });
      }
      await manager.replace(scope, use.category, {
        ...initial, expectedConsentVersion: 1,
        permissions: { ...initial.permissions, allowPsychologicalInference: false },
      });
      await expect(hub.provenance(scope, parent.entityId)).rejects.toMatchObject({ status: 403 });
      expect(await hub.searchMemory(scope, 'Authorized memory')).toEqual([]);
      expect((await hub.listObservations(scope, {}, 0, 10)).items).toHaveLength(1);
    } finally {
      await db.close();
      temp.remove();
    }
  });
});
