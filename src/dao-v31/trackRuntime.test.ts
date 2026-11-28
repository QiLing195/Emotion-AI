import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import type { AppraisalInput } from './appraisal.ts';
import { ConsentManager } from './consentManager.ts';
import { DAY, HOUR } from './dynamics.ts';
import { PersonalDataHub } from './dataHub.ts';
import { emotionRules } from './emotionModel.ts';
import { createDaoRouter } from './router.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { deferred, scope, secret, temporaryDatabase } from './testSupport.ts';
import { DaoViews } from './views.ts';

const begin = Date.parse('2026-01-01T00:00:00Z');
const use = {
  sourceId: 'role-evidence', category: 'UserProvided', sensitivity: 'Personal',
  collectionMode: 'manual', purpose: 'interaction', permission: 'allowCharacterUse',
} as const;
const permissions = { allowRead: true, allowUpload: true, allowAnalysis: true,
  allowPsychologicalInference: false, allowLongTermMemory: true, allowCharacterUse: true };

function input(eventId: string, evidence: readonly EntityRef[]): AppraisalInput {
  return {
    appraisalId: 'appraisal-' + eventId, eventId, goalCongruence: -0.75,
    causalAgency: { self: 0.6, user: 0.2, environment: 0.2 }, perceivedIntent: 'unknown',
    fairness: 0.6, controllability: 0.45, confidence: 0.8, evidence: evidence.map(({ entityId }) => entityId),
    intentEvidence: [],
  };
}

async function setup() {
  const temp = temporaryDatabase();
  let clock = begin;
  const now = () => clock;
  const dao = createDaoRouter({ secret, ownerId: scope.ownerId, directory: temp.directory, now });
  const state = new StateCoordinator(dao.store, now);
  const consent = new ConsentManager(dao.store, state, now);
  const hub = new PersonalDataHub(dao.store, consent, state, now);
  const authorization = (enabled: boolean, expectedConsentVersion: number) => consent.replace(scope, use.category, {
    sourceId: use.sourceId, sensitivity: use.sensitivity, collectionMode: use.collectionMode, purposes: [use.purpose],
    permissions: enabled ? permissions : {
      ...permissions, allowCharacterUse: false, allowAnalysis: false, allowLongTermMemory: false,
    }, retentionPolicy: {}, expectedConsentVersion,
  });
  const record = async () => {
    await authorization(true, 0);
    const receipt = await hub.ingest(scope, {
      sourceId: use.sourceId, category: use.category, sensitivity: use.sensitivity, purpose: use.purpose,
      type: 'journal', occurredAt: new Date(begin).toISOString(), data: { title: 'Reviewed feedback' }, expectedConsentVersion: 1,
    });
    const { items: [observation] } = await hub.listObservations(scope, {}, 0, 10);
    return { raw: { kind: 'event', entityId: receipt.recordId } as const,
      observation: { kind: 'observation', entityId: observation.observationId } as const };
  };
  const memory = (id: string, observation: EntityRef, summary: string, tags: readonly string[] = [], entities: readonly string[] = []) =>
    hub.derive(scope, { entityId: id, layer: 'memory', use, upstream: [observation], consentVersion: 1,
      memoryGovernanceApproved: true, body: { summary, tags, entities, confidence: 0.85, importance: 0.85 } });
  return {
    ...dao, temp, state, consent, hub, now, tick: (value: number) => { clock += value; }, authorization, record, memory,
    views: new DaoViews(dao.store, hub),
    async finish() { await dao.close(); temp.remove(); },
  };
}

describe('M2a runtime, replay and track acceptance', () => {
  it('upgrades a populated M1 database without changing its projection and backfills existing memory metadata', async () => {
    const fixture = await setup();
    try {
      const { observation } = await fixture.record();
      await fixture.memory('m1-memory', observation, 'M1 retained memory', ['prior']);
      const old = await fixture.state.current(scope);
      await fixture.close();
      const disk = new DatabaseSync(join(fixture.temp.directory, 'dao-prod.sqlite'));
      try {
        // The fixture contains only M1 domain writes. Remove M2a schema objects to reopen it as v1.
        disk.exec(`
          DROP TABLE appraisal_circuit;
          DROP TABLE appraisal_jobs;
          DROP TABLE track_metrics;
          DROP TABLE memory_terms;
          ALTER TABLE scopes DROP COLUMN memory_version;
          DELETE FROM schema_migrations WHERE version = 2;
        `);
      } finally { disk.close(); }
      const reopened = createDaoRouter({ secret, ownerId: scope.ownerId, directory: fixture.temp.directory, now: fixture.now });
      try {
        expect((await reopened.store.health('prod')).schemaVersion).toBe(2);
        expect(await new StateCoordinator(reopened.store).replay(scope)).toEqual(old);
        const result = await reopened.runtime.retrieval.quick(scope, { text: '', tags: ['PRIOR'] }, 1000);
        expect(result.hits[0]?.entity.ref.entityId).toBe('m1-memory');
      } finally { await reopened.close(); }
    } finally { await fixture.finish(); }
  });

  it('commits A once, exposes emotion and regulation separately, and replays the ordered provenance', async () => {
    const fixture = await setup();
    try {
      const { observation, raw } = await fixture.record();
      const work = {
        turnId: 'turn-1', appraisal: input('event-1', [observation]), applyEventId: 'apply-1', settlementId: 'clock-1',
        consentVersion: 1, evidence: [observation], use, relationshipSignal: 0.8, memoryQuery: { text: 'feedback' },
      };
      const turn = await fixture.runtime.startTurn(scope, work);
      expect(turn.analysis.outcome).toBe('COMMITTED');
      expect((await fixture.runtime.startTurn(scope, work)).analysis.outcome).toBe('NOOP_DUPLICATE');
      const snapshot = (await fixture.views.snapshot(scope)).data;
      expect(snapshot.characterEmotion.B).toBeGreaterThan(0);
      expect(snapshot.regulationState.regulation).toBeLessThan(0.65);
      expect(snapshot.characterPersonality.version).toBe(0);
      expect(snapshot.relationshipState.version).toBe(0);
      expect(snapshot.emotionProvenance?.appraisalId).toBe('appraisal-event-1');
      expect(snapshot.trackMetrics.find(({ track }) => track === 'A')).toMatchObject({ completed: 1 });
      expect((await fixture.state.replay(scope)).hash).toBe(snapshot.stateHash);
      await expect(fixture.runtime.affect.applyA(scope, use, {
        ...work, evidence: [raw], appraisal: input('event-1', [raw]), commitEventId: 'raw-apply',
        baseVersion: snapshot.stateVersion,
      })).rejects.toMatchObject({ status: 403 });
      const rawEvents = (await fixture.views.outbox(scope, 0)).frames;
      expect(rawEvents.some((frame) => frame.name === 'track_update')).toBe(true);
    } finally { await fixture.finish(); }
  });

  it('settles one year on UTC wall and simulation clocks without replaying time twice', async () => {
    const fixture = await setup();
    try {
      await fixture.runtime.affect.settle(scope, 'start', 0);
      for (let d = 1; d <= 365; d++) {
        fixture.tick(DAY);
        const settled = await fixture.runtime.affect.settle(scope, 'day-' + d, 0, d === 50 ? 'recovery' : 'real_elapsed');
        expect(settled.elapsedMs).toBe(DAY);
      }
      const state = (await fixture.state.current(scope)).state;
      expect(state.emotion?.clock).toMatchObject({ wallHighWaterMs: begin + 365 * DAY, simulationMs: 365 * DAY, version: 366 });
      expect(state.emotion?.yi).toMatchObject({ A: 0, B: 0, regulation: { regulation: 0.65 } });
      expect(await fixture.runtime.affect.settle(scope, 'day-365', 0)).toMatchObject({ status: 'duplicate' });
      fixture.tick(-HOUR);
      expect(await fixture.runtime.affect.settle(scope, 'rollback', 0)).toMatchObject({ status: 'clock_rollback' });
      fixture.tick(HOUR);
      expect(await fixture.runtime.affect.settle(scope, 'caught-up', 0)).toMatchObject({ status: 'unchanged' });
      expect(await fixture.state.replay(scope)).toEqual(await fixture.state.current(scope));
      const exp: DaoScope = { ...scope, env: 'exp' };
      const simulated = await fixture.runtime.affect.settle(exp, 'experiment', 0, 'manual_simulation', 366 * DAY);
      expect(simulated.state).toMatchObject({ simulationMs: 366 * DAY, wallHighWaterMs: null, version: 1 });
      expect((await fixture.state.current(scope)).state).toEqual(state);
      await expect(fixture.runtime.affect.settle(scope, 'prod-manual', 0, 'manual_simulation', 366 * DAY)).rejects.toMatchObject({ status: 400 });
    } finally { await fixture.finish(); }
  }, 20_000);

  it('rolls back an interrupted D settlement, then recovers one exact interval on a reopened database', async () => {
    const fixture = await setup();
    try {
      await fixture.runtime.affect.settle(scope, 'start', 0);
      fixture.tick(8 * HOUR);
      await expect(fixture.store.write(scope, async (tx) => {
        await fixture.state.apply(tx, {
          eventId: 'd-recover', eventType: 'TimeSettled', source: 'simulation-clock',
          occurredAt: new Date(fixture.now()).toISOString(), baseVersion: 1, consentVersion: 0, writeKind: 'exclusive',
          change: { kind: 'settle', eventId: 'd-recover', env: 'prod', rules: emotionRules,
            clock: { settlementId: 'd-recover', source: 'recovery', targetMs: fixture.now() } },
        });
        throw new Error('injected failure before COMMIT');
      })).rejects.toThrow('injected failure');
      await fixture.close();
      const reopened = createDaoRouter({ secret, ownerId: scope.ownerId, directory: fixture.temp.directory, now: fixture.now });
      try {
        expect(await reopened.runtime.affect.settle(scope, 'd-recover', 0, 'recovery')).toMatchObject({ elapsedMs: 8 * HOUR });
        const next = new StateCoordinator(reopened.store);
        expect((await next.recover(scope)).state.emotion?.clock.simulationMs).toBe(8 * HOUR);
        expect(await next.replay(scope)).toEqual(await next.current(scope));
      } finally { await reopened.close(); }
    } finally { await fixture.finish(); }
  });

  it('rejects B2 results after the memory index, snapshot, consent or deadline changes', async () => {
    const fixture = await setup();
    try {
      const { observation } = await fixture.record();
      const memory = await fixture.memory('old-memory', observation, 'old context');
      const query = (change: () => Promise<unknown>) => fixture.runtime.retrieval.deep(scope, 'turn-1', async () => {
        await change();
        return [memory];
      });
      expect((await query(async () => {})).status).toBe('completed');
      expect(await query(() => fixture.memory('another-memory', observation, 'new index'))).toMatchObject({ status: 'degraded', matches: [] });
      expect(await query(() => fixture.runtime.affect.openTurn(scope, 'another-event', 'next-turn', 1))).toMatchObject({ status: 'degraded', matches: [] });
      expect(await query(async () => { fixture.tick(6000); })).toMatchObject({ status: 'degraded', matches: [] });
      expect(await query(() => fixture.authorization(false, 1))).toMatchObject({ status: 'degraded', matches: [] });
    } finally { await fixture.finish(); }
  });

  it('orders C dependencies, fences duplicate jobs, expires stale work and cancels an active adapter', async () => {
    const fixture = await setup();
    const release = deferred();
    try {
      const { observation } = await fixture.record();
      const queue = fixture.runtime.appraisals;
      await fixture.runtime.affect.openTurn(scope, 'event-1', 'turn-1', 1);
      const request = { turnId: 'turn-1', eventId: 'event-1', use, evidence: [observation] };
      const port = { evaluate: async () => ({ appraisal: input('event-1', [observation]), relationshipSignal: 0.7 }) };
      await queue.enqueue(scope, { ...request, jobId: 'z-first' });
      await queue.enqueue(scope, { ...request, jobId: 'a-dependent', dependsOn: ['z-first'] });
      await queue.enqueue(scope, { ...request, jobId: 'c-grandchild', dependsOn: ['a-dependent'] });
      expect(await queue.runNext(scope, port)).toMatchObject({ jobId: 'z-first', status: 'completed', attempts: 1 });
      expect(await queue.runNext(scope, port)).toMatchObject({ jobId: 'a-dependent', status: 'completed', attempts: 1 });
      expect(await queue.runNext(scope, port)).toMatchObject({ jobId: 'c-grandchild', status: 'completed', attempts: 1 });
      expect(await queue.enqueue(scope, { ...request, jobId: 'z-first' })).toMatchObject({ status: 'completed', attempts: 1 });
      await expect(queue.enqueue(scope, { ...request, jobId: 'z-first', evidence: [] })).rejects.toMatchObject({ status: 409 });
      await queue.enqueue(scope, { ...request, jobId: 'temporary', ttlMs: 100 });
      fixture.tick(100);
      expect(await queue.runNext(scope, port)).toBeNull();
      expect(await queue.get(scope, 'temporary')).toMatchObject({ status: 'expired' });

      const entered = deferred();
      await queue.enqueue(scope, { ...request, jobId: 'cancel-job' });
      let sawAbort = false;
      const execution = queue.runNext(scope, { evaluate: async (_job, signal) => {
        signal.addEventListener('abort', () => { sawAbort = true; }, { once: true });
        entered.resolve();
        await release.promise;
        return port.evaluate();
      } });
      await entered.promise;
      const before = await fixture.state.current(scope);
      await queue.cancel(scope, 'cancel-job');
      expect(await execution).toMatchObject({ status: 'cancelled' });
      expect(sawAbort).toBe(true);
      expect(await fixture.state.current(scope)).toEqual(before);
    } finally { release.resolve(); await fixture.finish(); }
  });

  it('retries transient C failures, opens and recovers the circuit, and refuses stale consent', async () => {
    const fixture = await setup();
    try {
      const { observation } = await fixture.record();
      const queue = fixture.runtime.appraisals;
      await fixture.runtime.affect.openTurn(scope, 'event-1', 'turn-1', 1);
      const request = { turnId: 'turn-1', eventId: 'event-1', use, evidence: [observation] };
      await queue.enqueue(scope, { ...request, jobId: 'retry', maxRetries: 3 });
      const fault = { evaluate: async () => { throw new Error('transient adapter failure'); } };
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect(await queue.runNext(scope, fault)).toMatchObject({ status: 'queued', attempts: attempt });
        fixture.tick(500);
      }
      expect(await queue.runNext(scope, fault)).toBeNull();
      fixture.tick(30_000);
      const port = { evaluate: async () => ({ appraisal: input('event-1', [observation]), relationshipSignal: 0.7 }) };
      expect(await queue.runNext(scope, port)).toMatchObject({ status: 'completed', attempts: 4 });
      await queue.enqueue(scope, { ...request, jobId: 'revoked' });
      expect(await queue.runNext(scope, { evaluate: async () => {
        await fixture.authorization(false, 1);
        return port.evaluate();
      } })).toMatchObject({ status: 'cancelled' });
      const snapshot = (await fixture.views.snapshot(scope)).data;
      expect(snapshot.characterEmotion.version).toBe(1);
      expect(snapshot.emotionProvenance).toBeNull();
    } finally { await fixture.finish(); }
  });

  it('requests C counterfactuals only for consequential or ambiguous appraisals', async () => {
    const fixture = await setup();
    try {
      const { observation } = await fixture.record();
      const queue = fixture.runtime.appraisals;
      let requests = 0;
      for (const [eventId, severe] of [['ambiguous', true], ['ordinary', false]] as const) {
        await fixture.runtime.affect.openTurn(scope, eventId, 'turn-' + eventId, 1);
        await queue.enqueue(scope, { jobId: eventId, turnId: 'turn-' + eventId, eventId, use, evidence: [observation] });
        const raw = input(eventId, [observation]);
        const value = severe ? raw : { ...raw, goalCongruence: 0.2, perceivedIntent: 'neutral' as const, intentEvidence: raw.evidence };
        const outcome = await queue.runNext(scope, {
          evaluate: async () => ({ appraisal: value, relationshipSignal: 0.2 }),
          counterfactuals: async () => {
            requests++;
            return [
              { hypothesisId: 'contextual', interpretation: 'neutral', evidenceFor: raw.evidence, evidenceAgainst: [], confidence: 0.4 },
              { hypothesisId: 'unresolved', interpretation: 'unknown', evidenceFor: raw.evidence, evidenceAgainst: [], confidence: 0.5 },
            ];
          },
        });
        expect(outcome?.status).toBe('completed');
      }
      expect(requests).toBe(1);
      await fixture.runtime.affect.openTurn(scope, 'withdrawn', 'turn-withdrawn', 1);
      await queue.enqueue(scope, { jobId: 'withdrawn', turnId: 'turn-withdrawn', eventId: 'withdrawn', use, evidence: [observation] });
      expect(await queue.runNext(scope, {
        evaluate: async () => {
          await fixture.authorization(false, 1);
          return { appraisal: input('withdrawn', [observation]), relationshipSignal: 0.2 };
        },
        counterfactuals: async () => { requests++; return []; },
      })).toMatchObject({ status: 'cancelled' });
      expect(requests).toBe(1);
    } finally { await fixture.finish(); }
  });

  it('reclaims an expired C lease after reopening and discards the previous worker result', async () => {
    const fixture = await setup();
    const release = deferred();
    try {
      const { observation } = await fixture.record();
      await fixture.runtime.affect.openTurn(scope, 'event-1', 'turn-1', 1);
      await fixture.runtime.appraisals.enqueue(scope, { jobId: 'leased', turnId: 'turn-1', eventId: 'event-1', use, evidence: [observation] });
      const entered = deferred();
      const value = { appraisal: input('event-1', [observation]), relationshipSignal: 0.7 };
      const old = fixture.runtime.appraisals.runNext(scope, { evaluate: async () => {
        entered.resolve();
        await release.promise;
        return value;
      } });
      await entered.promise;
      fixture.tick(15_001);
      const reopened = createDaoRouter({ secret, ownerId: scope.ownerId, directory: fixture.temp.directory, now: fixture.now });
      try {
        const accepted = await reopened.runtime.appraisals.runNext(scope, { evaluate: async () => value });
        expect(accepted).toMatchObject({ status: 'completed', attempts: 2 });
        release.resolve();
        expect((await old)?.commitEventId).toBe(accepted?.commitEventId);
        expect((await fixture.state.current(scope)).state.emotion?.version).toBe(1);
      } finally { await reopened.close(); }
    } finally { release.resolve(); await fixture.finish(); }
  });

  it('returns B1 fallback while a cold SQLite worker is held behind a real database writer', async () => {
    const fixture = await setup();
    const release = deferred();
    try {
      await fixture.record();
      const entered = deferred();
      const blocker = fixture.store.write(scope, async () => { entered.resolve(); await release.promise; });
      await entered.promise;
      try {
        const reply = await fixture.runtime.retrieval.quick(scope, { text: 'feedback' }, 15);
        expect(reply.metrics).toMatchObject({ timeout: true, fallbackUsed: true, resultCount: 0 });
        expect(reply.metrics.latencyMs).toBeLessThan(250);
      } finally {
        release.resolve();
        await blocker;
      }
    } finally { await fixture.finish(); }
  });

  it('uses the in-process SQLite worker with bounded B1 fallback and measured lookup P50 at most 30 ms', async () => {
    const fixture = await setup();
    try {
      const { observation } = await fixture.record();
      await fixture.memory('exact-top', observation, 'contract regression，记录睡眠趋势', ['planning'], ['workspace']);
      for (let i = 0; i < 300; i++) {
        await fixture.memory('memory-' + i, observation, i % 5 === 0 ? 'regression sample ' + i : 'unrelated sample ' + i);
      }
      const metadata = await fixture.runtime.retrieval.quick(scope, { text: '', tags: ['PLANNING'], entities: ['workspace'] }, 1000);
      expect(metadata.hits[0]?.entity.ref.entityId).toBe('exact-top');
      const short = await fixture.runtime.retrieval.quick(scope, { text: '睡眠' });
      expect(short.hits[0]?.entity.ref.entityId).toBe('exact-top');
      const samples: number[] = [];
      let fallbacks = 0;
      for (let i = 0; i < 80; i++) {
        const result = await fixture.runtime.retrieval.quick(scope, { text: 'regression', tags: ['planning'] });
        samples.push(result.metrics.latencyMs);
        fallbacks += Number(result.metrics.fallbackUsed);
        if (!result.metrics.fallbackUsed) expect(result.hits.some(({ entity }) => entity.ref.entityId === 'exact-top')).toBe(true);
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.ceil(samples.length / 2) - 1];
      const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
      process.stdout.write(`M2a B1 acceptance: ${samples.length} samples / 301 memories, P50=${p50.toFixed(3)}ms P95=${p95.toFixed(3)}ms, fallbacks=${fallbacks}\n`);
      expect(p50).toBeLessThanOrEqual(30);
      expect(fallbacks).toBeLessThanOrEqual(4);
      expect((await fixture.runtime.retrieval.quick(scope, { text: 'regression' }, 0)).metrics)
        .toMatchObject({ timeout: true, resultCount: 0, fallbackUsed: true });
    } finally { await fixture.finish(); }
  }, 55_000);
});
