import { randomUUID } from 'node:crypto';
import { DAO_CONTRACT_VERSION } from '../contracts/dao-v31/index.ts';
import type {
  AgentAccountabilityLedger, DaoScope, MikaTaskContract, TaskRecord, TaskStatus,
} from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { conflict, DaoError, invalid, missing } from './errors.ts';
import { idempotent } from './idempotency.ts';
import type { IdempotencyKey } from './idempotency.ts';
import type { M1PersistencePort, M1ReadTransaction, M1WriteTransaction } from './m1Types.ts';
import { checkTaskConsent, isIndependentReceipt, taskDeadline, taskScopeKey } from './mikaSandbox.ts';
import type { TaskExecutor, TaskVerifier } from './mikaSandbox.ts';
import { isIdentifier } from './sessionAuth.ts';
import { staleConsent } from './stateCoordinator.ts';
import {
  grantClaims, TASK_ACCEPTOR, TASK_DISPATCHER, TASK_REVIEWER, taskInputHash, taskPolicy, verifyContract, workerActor,
} from './taskPolicy.ts';
import type { GoalPlan, GoalSummary, TaskControl, TaskExecution, TaskRequest, TaskReview, TaskRoute } from './taskTypes.ts';

const parked = Number.MAX_SAFE_INTEGER;
const stages: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  CREATED: ['VALIDATING', 'CANCELLED'],
  VALIDATING: ['WAITING_APPROVAL', 'QUEUED', 'BLOCKED', 'CANCELLED'],
  WAITING_APPROVAL: ['QUEUED', 'CANCELLED', 'EXPIRED', 'BLOCKED'],
  QUEUED: ['RUNNING', 'CANCELLED', 'EXPIRED', 'BLOCKED'],
  RUNNING: ['VERIFYING', 'UNKNOWN_RESULT'],
  VERIFYING: ['COMPLETED', 'UNKNOWN_RESULT', 'QUEUED', 'FAILED', 'EXPIRED', 'CANCELLED', 'BLOCKED', 'WAITING_USER_INPUT'],
  UNKNOWN_RESULT: ['COMPLETED', 'QUEUED', 'FAILED', 'EXPIRED', 'CANCELLED', 'BLOCKED', 'WAITING_USER_INPUT'],
  WAITING_USER_INPUT: ['UNKNOWN_RESULT'],
  COMPLETED: [], FAILED: [], CANCELLED: [], EXPIRED: [], BLOCKED: [],
};
const finalStatus = new Set<TaskStatus>(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'BLOCKED']);
const uncertainStatus = new Set<TaskStatus>(['RUNNING', 'VERIFYING', 'UNKNOWN_RESULT', 'WAITING_USER_INPUT']);
const hasExpired = (task: TaskRecord, now: number) => Date.parse(task.contract.expiresAt) <= now;

type LedgerFields = Partial<Pick<AgentAccountabilityLedger,
  'dispatchedBy' | 'executedBy' | 'reviewedBy' | 'acceptedBy' | 'finalOutcome'>>;
type Work = { kind: 'dispatch' | 'probe'; execution: TaskExecution } | { kind: 'transition'; task: TaskRecord };
type Options = Readonly<{ now?: () => number; timeoutMs?: number; taskTtlMs?: number; maxRetries?: number; capabilities?: readonly TaskRoute[] }>;

async function account(tx: M1WriteTransaction, task: TaskRecord, control: TaskControl, phase: AgentAccountabilityLedger['phase'],
  timestamp: string, fields: LedgerFields = {}, refs: readonly string[] = []) {
  const previous = await tx.getAccountabilityEntries(task.contract.taskId);
  await tx.appendAccountabilityEntry({
    entryId: randomUUID(), scope: tx.scope, taskId: task.contract.taskId, goalId: control.goalId,
    sequence: (previous.at(-1)?.sequence ?? 0) + 1, phase, proposedBy: control.proposedBy,
    acceptanceCriteria: control.criteria, evidenceRefs: refs, consentVersion: task.contract.consentVersion,
    occurredAt: timestamp, ...fields,
  });
}

export class UnifiedTaskGateway {
  readonly #store: M1PersistencePort;
  readonly #consent: ConsentManager;
  readonly #executor: TaskExecutor;
  readonly #verifier: TaskVerifier;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #taskTtlMs: number;
  readonly #maxRetries: number;
  readonly #capabilities?: readonly TaskRoute[];
  readonly #running = new Map<string, AbortController>();

  constructor(store: M1PersistencePort, consent: ConsentManager, executor: TaskExecutor, verifier: TaskVerifier, options: Options = {}) {
    this.#store = store;
    this.#consent = consent;
    this.#executor = executor;
    this.#verifier = verifier;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 1500;
    this.#taskTtlMs = options.taskTtlMs ?? 30 * 60_000;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#capabilities = options.capabilities;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 60_000
      || !Number.isSafeInteger(this.#taskTtlMs) || this.#taskTtlMs < this.#timeoutMs || this.#taskTtlMs > 86_400_000
      || !Number.isSafeInteger(this.#maxRetries) || this.#maxRetries < 0 || this.#maxRetries > 3) {
      throw new Error('Invalid sandbox execution configuration');
    }
  }

  #stamp() { return new Date(this.#now()).toISOString(); }

  async #record(tx: M1WriteTransaction, previous: TaskRecord | null, task: TaskRecord, control: TaskControl, reason: string) {
    if ((!previous && task.status !== 'CREATED') || (previous && previous.status !== task.status
      && !stages[previous.status].includes(task.status))) throw conflict('Illegal task state transition');
    if (previous && previous.contract.taskId !== task.contract.taskId) throw conflict('Task identity changed');
    const value = { ...task, updatedAt: this.#stamp() };
    await tx.saveTask(value);
    tx.saveTaskControl({ ...control, outcome: reason });
    const sequence = tx.appendTaskTransition(value, reason);
    tx.enqueue({ event: 'task_status', transition: sequence });
    return value;
  }

  async #finish(tx: M1WriteTransaction, task: TaskRecord, control: TaskControl, status: TaskStatus, reason: string) {
    const updated = await this.#record(tx, task, { ...task, status }, this.#fence(control, parked), reason);
    await account(tx, updated, control, 'evaluated', updated.updatedAt, { finalOutcome: status }, updated.evidenceRefs);
    return updated;
  }

  #fence(control: TaskControl, dueAt: number): TaskControl {
    const { leaseId: _leaseId, leaseUntil: _leaseUntil, ...clean } = control;
    return { ...clean, dueAt };
  }

  #policy(task: TaskRecord, control: TaskControl) {
    return verifyContract(task.contract, control.request, this.#capabilities);
  }

  async #allowed(tx: M1ReadTransaction, task: TaskRecord, control: TaskControl, stage: 'pre_dispatch' | 'pre_external' | 'pre_commit') {
    const policy = this.#policy(task, control);
    await checkTaskConsent(this.#consent, tx, task.contract, policy, stage);
  }

  async #permissionLost(tx: M1ReadTransaction, task: TaskRecord, control: TaskControl, stage: 'pre_dispatch' | 'pre_commit' = 'pre_commit') {
    try { await this.#allowed(tx, task, control, stage); return false; }
    catch (error) {
      if (error instanceof DaoError) return true;
      throw error;
    }
  }

  async #submit(tx: M1WriteTransaction, request: TaskRequest, expected: number, dependencies: readonly string[]) {
    if (expected !== await tx.getConsentVersion()) throw staleConsent('pre_dispatch');
    const policy = taskPolicy(request, this.#capabilities);
    const taskId = randomUUID();
    const start = this.#now();
    const permitted = policy.risk !== 'critical' && await (async () => {
      const view = await this.#consent.view(tx);
      return policy.grants.every((grant) => view.resolve(grant, grant.permission));
    })();
    const contract: MikaTaskContract = {
      taskId, scope: tx.scope, intent: policy.action, targetApps: [policy.targetApp],
      allowedActions: [policy.action], allowedDataScopes: grantClaims(policy), schemaVersion: DAO_CONTRACT_VERSION,
      consentVersion: expected, riskLevel: policy.risk, route: policy.route,
      approval: { required: policy.requiresApproval },
      execution: { timeoutMs: this.#timeoutMs, maxRetries: this.#maxRetries, idempotencyKey: randomUUID() },
      outputSchema: policy.outputSchema, createdAt: new Date(start).toISOString(),
      expiresAt: new Date(start + this.#taskTtlMs).toISOString(),
    };
    const control: TaskControl = {
      taskId, goalId: request.goalId ?? taskId, proposedBy: tx.scope.ownerId,
      request: { intent: policy.action, targetApp: policy.targetApp, goalId: request.goalId ?? taskId, inputs: permitted ? policy.input : {} },
      requestHash: taskInputHash(permitted ? policy : { ...policy, input: {} }),
      dependsOn: dependencies, criteria: policy.criteria, dueAt: start, probes: 0,
    };
    if (permitted) verifyContract(contract, control.request, this.#capabilities);
    const created = await this.#record(tx, null, {
      contract, status: 'CREATED', updatedAt: contract.createdAt, attempt: 0, evidenceRefs: [],
    }, control, 'registered');
    await account(tx, created, control, 'proposed', created.updatedAt);
    const validating = await this.#record(tx, created, { ...created, status: 'VALIDATING' }, control, 'policy_checked');
    if (!permitted) return this.#finish(tx, validating, control, 'BLOCKED', policy.risk === 'critical' ? 'critical_risk' : 'authorization_missing');
    return this.#record(tx, validating, { ...validating, status: policy.requiresApproval ? 'WAITING_APPROVAL' : 'QUEUED' },
      { ...control, dueAt: policy.requiresApproval ? Date.parse(contract.expiresAt) : start }, policy.requiresApproval ? 'owner_approval_required' : 'queued');
  }

  submit(scope: DaoScope, request: TaskRequest, expected: number, key?: IdempotencyKey) {
    return this.#store.write(scope, async (tx) => {
      if (request.goalId && !isIdentifier(request.goalId)) throw invalid('Invalid goal ID');
      const { result } = await idempotent(tx, key, () => this.#submit(tx, request, expected, []));
      return this.publicView(tx, result);
    });
  }

  submitPlan(scope: DaoScope, plan: GoalPlan, expected: number) {
    return this.#store.write(scope, async (tx) => {
      if (!isIdentifier(plan.goalId) || !plan.steps.length || plan.steps.length > 8) throw invalid('Invalid goal plan');
      if (tx.taskRecords('', 1, undefined, plan.goalId).length) throw conflict('Goal ID has already been used');
      const registered = new Map<string, TaskRecord>();
      for (const step of plan.steps) {
        const dependencies = [...new Set(step.dependsOn)].map((key) => registered.get(key)?.contract.taskId);
        if (!isIdentifier(step.key) || registered.has(step.key) || dependencies.some((id) => !id)) throw invalid('Goal steps must form an ordered dependency graph');
        registered.set(step.key, await this.#submit(tx, { ...step.request, goalId: plan.goalId }, expected, dependencies as string[]));
      }
      return Array.from(registered.values());
    });
  }

  approve(scope: DaoScope, id: string, expected: number, key?: IdempotencyKey) {
    return this.#store.write(scope, async (tx) => {
      const { result } = await idempotent(tx, key, async () => {
        if (expected !== await tx.getConsentVersion()) throw staleConsent('pre_commit');
        const task = await tx.getTask(id);
        const control = tx.taskControl(id);
        if (!task || !control) throw missing();
        if (task.status !== 'WAITING_APPROVAL' || task.contract.riskLevel === 'critical') throw conflict('Task is not awaiting owner approval');
        if (hasExpired(task, this.#now())) return this.#finish(tx, task, control, 'EXPIRED', 'approval_deadline');
        if (await this.#permissionLost(tx, task, control)) return this.#finish(tx, task, control, 'BLOCKED', 'consent_changed');
        const contract = { ...task.contract, approval: { required: true, approvalId: randomUUID() } };
        return this.#record(tx, task, { ...task, contract, status: 'QUEUED' }, { ...control, dueAt: this.#now() }, 'owner_approved');
      });
      return this.publicView(tx, result);
    });
  }

  async cancel(scope: DaoScope, id: string, expected: number, key?: IdempotencyKey) {
    const result = await this.#store.write(scope, async (tx) => {
      const { result } = await idempotent(tx, key, async () => {
        if (expected !== await tx.getConsentVersion()) throw staleConsent('pre_commit');
        const task = await tx.getTask(id);
        const control = tx.taskControl(id);
        if (!task || !control) throw missing();
        if (finalStatus.has(task.status)) return task;
        if (!uncertainStatus.has(task.status)) return this.#finish(tx, task, control, 'CANCELLED', 'owner_cancelled');
        if (control.cancelRequested) return task;
        return this.#record(tx, task, { ...task, status: 'UNKNOWN_RESULT' },
          { ...this.#fence(control, this.#now()), cancelRequested: true }, 'cancellation_requires_verification');
      });
      return this.publicView(tx, result);
    });
    if (result.status === 'UNKNOWN_RESULT' || result.status === 'CANCELLED') this.#running.get(taskScopeKey(scope, id))?.abort(conflict('Task cancelled'));
    return result;
  }

  async reconcileConsent(scope: DaoScope) {
    const aborted = await this.#store.write(scope, async (tx) => {
      const version = await tx.getConsentVersion();
      const result: string[] = [];
      for (const control of tx.taskControlsDue(parked - 1, Number.MAX_SAFE_INTEGER)) {
        const task = await tx.getTask(control.taskId);
        if (!task || task.contract.consentVersion === version || finalStatus.has(task.status)) continue;
        if (uncertainStatus.has(task.status)) {
          if (task.status === 'RUNNING' || task.status === 'VERIFYING') {
            await this.#record(tx, task, { ...task, status: 'UNKNOWN_RESULT' }, this.#fence(control, this.#now()), 'consent_changed_during_execution');
            result.push(control.taskId);
          }
        } else {
          await this.#finish(tx, task, control, 'BLOCKED', 'consent_changed');
        }
      }
      return result;
    });
    for (const taskId of aborted) this.#running.get(taskScopeKey(scope, taskId))?.abort(staleConsent('pre_external'));
  }

  #claim(scope: DaoScope) {
    return this.#store.write<Work | null>(scope, async (tx) => {
      const now = this.#now();
      for (const control of tx.taskControlsDue(now, 24)) {
        const task = await tx.getTask(control.taskId);
        if (!task || finalStatus.has(task.status)) continue;
        if (task.status === 'WAITING_APPROVAL' || task.status === 'QUEUED') {
          if (hasExpired(task, now)) return { kind: 'transition', task: await this.#finish(tx, task, control, 'EXPIRED', 'task_deadline') };
          if (await this.#permissionLost(tx, task, control, 'pre_dispatch')) {
            return { kind: 'transition', task: await this.#finish(tx, task, control, 'BLOCKED', 'consent_changed') };
          }
          if (task.status === 'WAITING_APPROVAL') continue;
          const dependencies = await Promise.all(control.dependsOn.map((id) => tx.getTask(id)));
          if (dependencies.some((record) => !record || record.status === 'WAITING_USER_INPUT'
            || (record.status !== 'COMPLETED' && finalStatus.has(record.status)))) {
            return { kind: 'transition', task: await this.#finish(tx, task, control, 'CANCELLED', 'dependency_unavailable') };
          }
          if (dependencies.some((record) => record?.status !== 'COMPLETED')) {
            tx.saveTaskControl({ ...control, dueAt: Math.min(Date.parse(task.contract.expiresAt), now + 100) });
            continue;
          }
          const leaseId = randomUUID();
          const leaseUntil = Math.min(Date.parse(task.contract.expiresAt), now + task.contract.execution.timeoutMs);
          const nextControl = { ...control, leaseId, leaseUntil, dueAt: leaseUntil, probes: 0 };
          const next = await this.#record(tx, task, { ...task, status: 'RUNNING', attempt: task.attempt + 1 }, nextControl, 'dispatched');
          await account(tx, next, control, 'dispatched', next.updatedAt, { dispatchedBy: TASK_DISPATCHER, executedBy: workerActor(task.contract.route) });
          return { kind: 'dispatch', execution: { task: next, control: nextControl, leaseId } };
        }
        if (task.status === 'RUNNING') {
          const next = await this.#record(tx, task, { ...task, status: 'UNKNOWN_RESULT' }, this.#fence(control, now), 'expired_dispatch_lease');
          await account(tx, next, control, 'recovery', next.updatedAt, { dispatchedBy: TASK_DISPATCHER, executedBy: workerActor(task.contract.route) });
          return { kind: 'transition', task: next };
        }
        if (task.status === 'VERIFYING' || task.status === 'UNKNOWN_RESULT') {
          const leaseId = randomUUID();
          const leaseUntil = now + task.contract.execution.timeoutMs;
          const claimed = { ...control, leaseId, leaseUntil, dueAt: leaseUntil };
          tx.saveTaskControl(claimed);
          return { kind: 'probe', execution: { task, control: claimed, leaseId } };
        }
      }
      return null;
    });
  }

  async #dispatch(scope: DaoScope, execution: TaskExecution) {
    const { task, leaseId } = execution;
    const id = task.contract.taskId;
    const key = taskScopeKey(scope, id);
    const controller = new AbortController();
    this.#running.set(key, controller);
    let acknowledged = false;
    try {
      // Both this preflight and the sandbox transaction authorize the same immutable scope.
      await this.#store.read(scope, async (tx) => {
        const current = await tx.getTask(id);
        const control = tx.taskControl(id);
        if (!current || !control || current.status !== 'RUNNING' || control.leaseId !== leaseId) throw conflict('Dispatch lease changed');
        await this.#allowed(tx, current, control, 'pre_external');
      });
      await taskDeadline(Math.max(1, execution.control.leaseUntil! - this.#now()), controller.signal,
        (signal) => this.#executor.execute(scope, execution, signal));
      acknowledged = true;
    } catch {
      // The executor cannot attest whether a write was committed. Reconciliation decides from independently read evidence.
    } finally {
      if (this.#running.get(key) === controller) this.#running.delete(key);
    }
    return this.#store.write(scope, async (tx) => {
      const current = await tx.getTask(id);
      const control = tx.taskControl(id);
      if (!current || !control || current.status !== 'RUNNING' || control.leaseId !== leaseId) return current;
      const known = acknowledged && !await this.#permissionLost(tx, current, control);
      const next = await this.#record(tx, current, { ...current, status: known ? 'VERIFYING' : 'UNKNOWN_RESULT' },
        this.#fence(control, this.#now()), known ? 'acknowledged' : 'unknown_execution_result');
      await account(tx, next, control, known ? 'executed' : 'recovery', next.updatedAt, {
        dispatchedBy: TASK_DISPATCHER, executedBy: workerActor(current.contract.route),
      });
      return next;
    });
  }

  async #verify(scope: DaoScope, execution: TaskExecution) {
    const { task, leaseId } = execution;
    const id = task.contract.taskId;
    let proof: TaskReview;
    try {
      proof = await taskDeadline(task.contract.execution.timeoutMs, undefined, (signal) => this.#verifier.verify(scope, task, signal));
    } catch { proof = { kind: 'uncertain', reviewerId: TASK_REVIEWER }; }
    return this.#store.write(scope, async (tx) => {
      const current = await tx.getTask(id);
      const control = tx.taskControl(id);
      if (!current || !control || control.leaseId !== leaseId || !['UNKNOWN_RESULT', 'VERIFYING'].includes(current.status)) return current;
      const now = this.#now();
      const receipt = tx.taskReceipt(current.contract.execution.idempotencyKey);
      const authorized = !await this.#permissionLost(tx, current, control);
      const absent = proof.kind === 'absent' && proof.reviewerId === TASK_REVIEWER && !receipt;
      if (receipt && isIndependentReceipt(proof, receipt, current, control) && Date.parse(receipt.committedAt) <= Date.parse(current.contract.expiresAt)) {
        if (!authorized) return this.#finish(tx, current, control, 'WAITING_USER_INPUT', 'verified_effect_access_revoked');
        const actors = { dispatchedBy: TASK_DISPATCHER, executedBy: receipt.executedBy, reviewedBy: TASK_REVIEWER };
        const refs = [receipt.evidenceId];
        const previous = await tx.getAccountabilityEntries(id);
        if (!previous.some((entry) => entry.phase === 'executed')) {
          await account(tx, current, control, 'executed', this.#stamp(), actors, refs);
        }
        await account(tx, current, control, 'reviewed', this.#stamp(), actors, refs);
        await account(tx, current, control, 'accepted', this.#stamp(), { ...actors, acceptedBy: TASK_ACCEPTOR }, refs);
        const accepted = await this.#record(tx, current, { ...current, status: 'COMPLETED', result: receipt.output, evidenceRefs: refs },
          this.#fence(control, parked), control.cancelRequested ? 'effect_preceded_cancellation' : 'independently_verified');
        await account(tx, accepted, control, 'evaluated', accepted.updatedAt, { ...actors, acceptedBy: TASK_ACCEPTOR, finalOutcome: 'COMPLETED' }, refs);
        return accepted;
      }
      if (absent) {
        // The old execution lease was fenced before this authoritative negative probe.
        await account(tx, current, control, 'recovery', this.#stamp(), { reviewedBy: TASK_REVIEWER });
        if (control.cancelRequested) return this.#finish(tx, current, control, 'CANCELLED', 'verified_no_effect_after_cancel');
        if (!authorized) return this.#finish(tx, current, control, 'BLOCKED', 'verified_no_effect_after_revocation');
        if (hasExpired(current, now)) return this.#finish(tx, current, control, 'EXPIRED', 'verified_no_effect_at_deadline');
        if (current.attempt > current.contract.execution.maxRetries) return this.#finish(tx, current, control, 'FAILED', 'verified_no_effect_retry_limit');
        return this.#record(tx, current, { ...current, status: 'QUEUED' }, this.#fence(control, now), 'verified_no_effect_retry');
      }
      const probes = control.probes + 1;
      if (hasExpired(current, now) || probes >= 8) return this.#finish(tx, current, control, 'WAITING_USER_INPUT', 'verification_unresolved');
      const retry = now + Math.min(30_000, 50 * 2 ** probes);
      return this.#record(tx, current, { ...current, status: 'UNKNOWN_RESULT' },
        { ...this.#fence(control, Math.min(retry, Date.parse(current.contract.expiresAt))), probes }, 'verification_inconclusive');
    });
  }

  async runNext(scope: DaoScope): Promise<TaskRecord | null> {
    const work = await this.#claim(scope);
    if (!work) return null;
    if (work.kind === 'transition') return work.task;
    return work.kind === 'dispatch' ? this.#dispatch(scope, work.execution) : this.#verify(scope, work.execution);
  }

  async publicView(tx: M1ReadTransaction, value: TaskRecord) {
    if (value.result === undefined) return value;
    const control = tx.taskControl(value.contract.taskId);
    if (control && !await this.#permissionLost(tx, value, control)) return value;
    const { result: _privateOutput, ...visible } = value;
    return { ...visible, evidenceRefs: [] };
  }

  list(scope: DaoScope, after: string, limit: number, status?: TaskStatus) {
    return this.#store.read(scope, async (tx) => {
      const page = tx.taskRecords(after, limit + 1, status);
      return { items: await Promise.all(page.slice(0, limit).map((value) => this.publicView(tx, value))),
        next: page.length > limit ? page[limit - 1].contract.taskId : undefined, version: await tx.getConsentVersion() };
    });
  }

  ledger(scope: DaoScope, after: { taskId: string; sequence: number }, limit: number, taskId?: string, goalId?: string) {
    return this.#store.read(scope, async (tx) => {
      const page = tx.ledgerPage(after, limit + 1, taskId, goalId);
      const boundary = page[limit - 1];
      return { items: page.slice(0, limit), version: await tx.getConsentVersion(),
        next: page.length > limit ? { taskId: boundary.taskId, sequence: boundary.sequence } : undefined };
    });
  }

  goal(scope: DaoScope, goalId: string): Promise<GoalSummary> {
    return this.#store.read(scope, async (tx) => {
      const raw = tx.taskRecords('', Number.MAX_SAFE_INTEGER, undefined, goalId);
      if (!raw.length) throw missing();
      const tasks = await Promise.all(raw.map((task) => this.publicView(tx, task)));
      const status = tasks.every(({ status }) => status === 'COMPLETED') ? 'completed'
        : tasks.some(({ status }) => (finalStatus.has(status) && status !== 'COMPLETED') || status === 'WAITING_USER_INPUT')
          ? 'needs_attention' : 'active';
      return { scope, goalId, tasks, status, ledger: tx.ledgerPage({ taskId: '', sequence: 0 }, Number.MAX_SAFE_INTEGER, undefined, goalId) };
    });
  }
}
