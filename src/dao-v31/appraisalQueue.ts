import { randomUUID } from 'node:crypto';
import type { DaoScope, EntityRef } from '../contracts/dao-v31/index.ts';
import { assess } from './appraisal.ts';
import type { AppraisalHypothesis, AppraisalInput } from './appraisal.ts';
import { AffectRuntime } from './affectRuntime.ts';
import { ConsentManager } from './consentManager.ts';
import { conflict, DaoError, denied, invalid, missing } from './errors.ts';
import { MemoryRetrieval } from './memoryRetrieval.ts';
import type { GrantUse, M1PersistencePort, M1ReadTransaction, M1WriteTransaction } from './m1Types.ts';
import { PersonalDataHub } from './dataHub.ts';
import { isIdentifier } from './sessionAuth.ts';
import { trackUpdate } from './trackMetrics.ts';
import type { AppraisalJob } from './trackTypes.ts';
import { exactJson, jsonValue } from './exactJson.ts';

export interface AppraisalPort {
  evaluate(job: AppraisalJob, signal: AbortSignal): Promise<{ appraisal: AppraisalInput; relationshipSignal: number }>;
  counterfactuals?(job: AppraisalJob, initial: AppraisalInput, signal: AbortSignal): Promise<readonly AppraisalHypothesis[]>;
}

export type AppraisalRequest = Readonly<{
  jobId: string; turnId: string; eventId: string; use: GrantUse; evidence: readonly EntityRef[];
  dependsOn?: readonly string[]; maxRetries?: number; ttlMs?: number;
}>;
const circuitThreshold = 3;
const circuitCooldownMs = 30_000;
const leaseDuration = 15_000;
const waiting = (job: AppraisalJob) => job.status === 'queued' || job.status === 'running';
const keyFor = (scope: DaoScope, jobId: string) => JSON.stringify([scope.ownerId, scope.env, scope.characterId, scope.sessionId, jobId]);

function terminal(tx: M1WriteTransaction, job: AppraisalJob, status: Exclude<AppraisalJob['status'], 'queued' | 'running'>,
  outcome: string, commitEventId?: string) {
  const finished = { ...job, status, outcome, leaseId: undefined, leaseUntil: undefined, ...(commitEventId && { commitEventId }) };
  tx.setAppraisalJob(finished);
  trackUpdate(tx, { track: 'C', status, jobId: job.jobId, ...(commitEventId && { eventId: commitEventId }),
    ...(status !== 'completed' && { detail: outcome }) }, -1);
  return finished;
}

async function withCancellation<T>(perform: () => Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupt = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([interrupt, perform()]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class AppraisalQueue {
  readonly #store: M1PersistencePort;
  readonly #consent: ConsentManager;
  readonly #recall: MemoryRetrieval;
  readonly #affect: AffectRuntime;
  readonly #hub: PersonalDataHub;
  readonly #now: () => number;
  readonly #running = new Map<string, AbortController>();

  constructor(store: M1PersistencePort, consent: ConsentManager, recall: MemoryRetrieval, affect: AffectRuntime,
    hub: PersonalDataHub, now = Date.now) {
    this.#store = store;
    this.#consent = consent;
    this.#recall = recall;
    this.#affect = affect;
    this.#hub = hub;
    this.#now = now;
  }

  enqueue(scope: DaoScope, request: AppraisalRequest) {
    return this.#store.write(scope, async (tx) => {
      const dependencies = [...new Set(request.dependsOn)].sort();
      const maxRetries = request.maxRetries ?? 2;
      const ttlMs = request.ttlMs ?? 60_000;
      const use = { ...request.use, permission: 'allowCharacterUse' as const };
      if (![request.jobId, request.turnId, request.eventId, ...dependencies].every(isIdentifier)
        || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3 || dependencies.length > 16
        || dependencies.includes(request.jobId) || request.evidence.length > 32
        || request.evidence.some((ref) => !isIdentifier(ref.entityId) || !['observation', 'memory'].includes(ref.kind))) {
        throw invalid('Invalid appraisal job');
      }
      const prior = tx.getAppraisalJob(request.jobId);
      if (prior) {
        const before = { eventId: prior.eventId, turnId: prior.turnId, use: prior.use, evidence: prior.evidence,
          dependsOn: prior.dependsOn, maxRetries: prior.maxRetries, ttlMs: prior.expiresAt - prior.context.retrievedAt };
        const next = { eventId: request.eventId, turnId: request.turnId, use, evidence: request.evidence,
          dependsOn: dependencies, maxRetries, ttlMs };
        if (exactJson(jsonValue(before)) !== exactJson(jsonValue(next))) throw conflict('Appraisal job ID has already been used');
        return prior;
      }
      const event = await tx.getEvent(request.eventId);
      if (event?.eventType !== 'RoleTurnOpened' || event.turnId !== request.turnId) throw conflict('Appraisal requires a matching role turn');
      for (const id of dependencies) {
        const dependency = tx.getAppraisalJob(id);
        if (dependency?.turnId !== request.turnId) throw conflict('Appraisal dependency is outside the turn');
      }
      const context = await this.#recall.context(tx, request.turnId, ttlMs);
      await this.#consent.check(tx, { scope, expectedVersion: context.consentVersion, use }, 'pre_dispatch');
      await this.#consent.check(tx, { scope, expectedVersion: context.consentVersion, use: { ...use, permission: 'allowAnalysis' } }, 'pre_dispatch');
      await this.#checkEvidence(tx, request.evidence);
      const job: AppraisalJob = {
        jobId: request.jobId, eventId: request.eventId, turnId: request.turnId, context, use,
        evidence: request.evidence, dependsOn: dependencies, status: 'queued', attempts: 0,
        maxRetries, availableAt: context.retrievedAt, expiresAt: context.expiresAt,
      };
      tx.setAppraisalJob(job);
      trackUpdate(tx, { track: 'C', status: 'queued', jobId: job.jobId }, 1);
      return job;
    });
  }

  async #checkEvidence(tx: M1ReadTransaction, evidence: readonly EntityRef[]) {
    if ((await this.#hub.authorizedEvidence(tx, evidence, 'allowCharacterUse')).size !== new Set(evidence.map(({ entityId }) => entityId)).size) {
      throw denied('Appraisal evidence was withdrawn or forgotten');
    }
  }

  get(scope: DaoScope, jobId: string) {
    return this.#store.read(scope, (tx) => tx.getAppraisalJob(jobId));
  }

  async cancel(scope: DaoScope, jobId: string) {
    const result = await this.#store.write(scope, (tx) => {
      const job = tx.getAppraisalJob(jobId);
      if (!job) throw missing();
      return waiting(job) ? terminal(tx, job, 'cancelled', 'cancelled') : job;
    });
    if (result.status === 'cancelled') this.#running.get(keyFor(scope, jobId))?.abort(conflict('Appraisal was cancelled'));
    return result;
  }

  async #dependencyVersions(tx: M1ReadTransaction, job: AppraisalJob) {
    const seen = new Set<string>();
    const versions = new Set<number>();
    const pending = [...job.dependsOn];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const previous = tx.getAppraisalJob(id);
      if (!previous?.commitEventId) return null;
      const event = await tx.getEvent(previous.commitEventId);
      if (!event) return null;
      if (event.sequence > job.context.snapshotVersion) versions.add(event.sequence);
      pending.push(...previous.dependsOn);
    }
    return versions;
  }

  #claim(scope: DaoScope) {
    return this.#store.write(scope, async (tx) => {
      const now = this.#now();
      const circuit = tx.appraisalCircuit();
      for (const original of tx.appraisalJobs()) {
        if (!waiting(original)) continue;
        if (original.expiresAt <= now || now < original.context.retrievedAt) {
          terminal(tx, original, 'expired', 'deadline'); continue;
        }
        if (original.status === 'running' && original.leaseUntil! > now) continue;
        if (original.status === 'running' && original.attempts > original.maxRetries) {
          terminal(tx, original, 'failed', 'lease_expired'); continue;
        }
        if (original.availableAt > now) continue;
        const dependencies = original.dependsOn.map((jobId) => tx.getAppraisalJob(jobId)?.status);
        if (dependencies.some((status) => !status || ['failed', 'cancelled', 'expired'].includes(status))) {
          terminal(tx, original, 'cancelled', 'dependency_unavailable'); continue;
        }
        if (dependencies.some((status) => status !== 'completed') || circuit.opensUntil > now) continue;
        let context = original.context;
        if (original.dependsOn.length) {
          const commits = await this.#dependencyVersions(tx, original);
          const latest = tx.runtime()?.state.stateVersion ?? 0;
          if (commits && latest - original.context.snapshotVersion === commits.size
            && [...commits].every((sequence) => sequence <= latest)) {
            context = { ...context, snapshotVersion: latest };
          }
        }
        if (!await this.#recall.valid(tx, context, original.turnId)) {
          terminal(tx, original, 'cancelled', 'stale_context'); continue;
        }
        const job: AppraisalJob = { ...original, context, status: 'running', attempts: original.attempts + 1,
          leaseId: randomUUID(), leaseUntil: Math.min(original.expiresAt, now + leaseDuration) };
        tx.setAppraisalJob(job);
        trackUpdate(tx, { track: 'C', status: 'running', jobId: job.jobId }, 0);
        return job;
      }
      return null;
    });
  }

  async runNext(scope: DaoScope, port: AppraisalPort): Promise<AppraisalJob | null> {
    const job = await this.#claim(scope);
    if (!job) return null;
    const key = keyFor(scope, job.jobId);
    const controller = new AbortController();
    this.#running.set(key, controller);
    const limit = setTimeout(() => controller.abort(new Error('Appraisal lease deadline')), Math.max(1, job.leaseUntil! - this.#now()));
    try {
      const ticket = await this.#consent.admit(scope, job.use, job.context.consentVersion);
      return await this.#consent.execute(ticket, async (signal) => {
        const verifyExternal = () => this.#store.read(scope, async (tx) => {
          await this.#consent.check(tx, ticket, 'pre_external');
          await this.#consent.check(tx, { ...ticket, use: { ...job.use, permission: 'allowAnalysis' } }, 'pre_external');
          if (tx.getAppraisalJob(job.jobId)?.leaseId !== job.leaseId || !await this.#recall.valid(tx, job.context, job.turnId)) {
            throw conflict('Appraisal is no longer current');
          }
          await this.#checkEvidence(tx, job.evidence);
        });
        await verifyExternal();
        const active = AbortSignal.any([signal, controller.signal]);
        return withCancellation(async () => {
          const value = await port.evaluate(job, active);
          const evaluation = assess(value.appraisal);
          if (!evaluation.counterfactualTriggered || value.appraisal.alternatives?.length || !port.counterfactuals) return value;
          await verifyExternal();
          active.throwIfAborted();
          const alternatives = await port.counterfactuals(job, value.appraisal, active);
          return { ...value, appraisal: { ...value.appraisal, alternatives } };
        }, active);
      }, async (tx, value) => {
        await this.#consent.check(tx, { ...ticket, use: { ...job.use, permission: 'allowAnalysis' } }, 'pre_commit');
        const current = tx.getAppraisalJob(job.jobId)!;
        if (current.status !== 'running' || current.leaseId !== job.leaseId || this.#now() >= job.leaseUntil!
          || !await this.#recall.valid(tx, job.context, job.turnId)) throw conflict('Appraisal result is no longer current');
        if (value.appraisal.eventId !== job.eventId) throw invalid('Appraisal result belongs to another event');
        const commit = await this.#affect.apply(tx, {
          commitEventId: randomUUID(), turnId: job.turnId, appraisal: value.appraisal, evidence: job.evidence,
          relationshipSignal: value.relationshipSignal, consentVersion: job.context.consentVersion,
          baseVersion: job.context.snapshotVersion, deadlineMs: job.leaseUntil,
        }, 'C');
        tx.setAppraisalCircuit({ failures: 0, opensUntil: 0 });
        return terminal(tx, current, 'completed', 'committed', commit.eventId);
      });
    } catch (error) {
      return this.#store.write(scope, async (tx) => {
        const current = tx.getAppraisalJob(job.jobId);
        if (!current || current.status !== 'running' || current.leaseId !== job.leaseId) return current;
        const now = this.#now();
        if (now >= job.expiresAt) return terminal(tx, current, 'expired', 'deadline');
        if (!await this.#recall.valid(tx, job.context, job.turnId) || (error instanceof DaoError && !error.retryable)) {
          return terminal(tx, current, 'cancelled', 'stale_or_denied');
        }
        const circuit = tx.appraisalCircuit();
        const failures = circuit.failures + 1;
        const opensUntil = failures >= circuitThreshold ? now + circuitCooldownMs : circuit.opensUntil;
        tx.setAppraisalCircuit({ failures, opensUntil });
        if (job.attempts > job.maxRetries) return terminal(tx, current, 'failed', 'retry_limit');
        const retry = { ...current, status: 'queued' as const, availableAt: Math.max(opensUntil, now + 100 * 2 ** (job.attempts - 1)),
          leaseId: undefined, leaseUntil: undefined, outcome: 'retry_scheduled' };
        tx.setAppraisalJob(retry);
        trackUpdate(tx, { track: 'C', status: 'queued', jobId: job.jobId, detail: 'retry_scheduled' }, 0);
        return retry;
      });
    } finally {
      clearTimeout(limit);
      if (this.#running.get(key) === controller) this.#running.delete(key);
    }
  }
}
