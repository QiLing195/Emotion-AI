import { randomUUID } from 'node:crypto';
import type { ConsentStage, DaoScope, MikaTaskContract, TaskRecord } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { conflict, denied } from './errors.ts';
import type { M1PersistencePort, M1ReadTransaction } from './m1Types.ts';
import { staleConsent } from './stateCoordinator.ts';
import { matchesReceipt, TASK_REVIEWER, taskInputHash, verifyContract, workerActor } from './taskPolicy.ts';
import type { TaskControl, TaskExecution, TaskPolicy, TaskReceipt, TaskReview, TaskRoute } from './taskTypes.ts';

export interface TaskExecutor {
  execute(scope: DaoScope, execution: TaskExecution, signal: AbortSignal): Promise<void>;
}
export interface TaskVerifier {
  verify(scope: DaoScope, task: TaskRecord, signal: AbortSignal): Promise<TaskReview>;
}

export function taskScopeKey(scope: DaoScope, taskId: string) {
  return JSON.stringify([scope.ownerId, scope.env, scope.characterId, scope.sessionId, taskId]);
}

export async function checkTaskConsent(
  manager: ConsentManager, tx: M1ReadTransaction, contract: MikaTaskContract, policy: TaskPolicy, stage: ConsentStage,
) {
  if (contract.riskLevel === 'critical') throw denied('Critical tasks are blocked by policy');
  if (contract.consentVersion !== await tx.getConsentVersion()) throw staleConsent(stage);
  const view = await manager.view(tx);
  if (!policy.grants.every((grant) => view.resolve(grant, grant.permission))) throw denied('Task application or data scope has no current grant');
}

export type SandboxFault = 'missing_ack_after_commit' | 'timeout_after_commit' | 'interrupted_before_commit' | 'probe_unavailable' | 'missing_review_proof';
export class SandboxFaultPlan {
  readonly #plans = new Map<string, Partial<Record<SandboxFault, number>>>();

  set(scope: DaoScope, taskId: string, fault: SandboxFault, times = 1) {
    const key = taskScopeKey(scope, taskId);
    this.#plans.set(key, { ...this.#plans.get(key), [fault]: times });
  }

  take(scope: DaoScope, taskId: string, fault: SandboxFault) {
    const key = taskScopeKey(scope, taskId);
    const plan = this.#plans.get(key);
    if (!plan || !(plan[fault] ?? 0)) return false;
    plan[fault] = plan[fault]! - 1;
    if (Object.values(plan).every((count) => count === 0)) this.#plans.delete(key);
    return true;
  }
}

async function waitForAbort(signal: AbortSignal): Promise<never> {
  signal.throwIfAborted();
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
}

/** Writes synthetic receipts only. No transport, device, account or operating-system action is exposed. */
export class MikaSandbox implements TaskExecutor {
  readonly #store: M1PersistencePort;
  readonly #consent: ConsentManager;
  readonly #now: () => number;
  readonly #capabilities?: readonly TaskRoute[];
  readonly faults = new SandboxFaultPlan();

  constructor(store: M1PersistencePort, consent: ConsentManager, now = Date.now, capabilities?: readonly TaskRoute[]) {
    this.#store = store;
    this.#consent = consent;
    this.#now = now;
    this.#capabilities = capabilities;
  }

  async execute(scope: DaoScope, execution: TaskExecution, signal: AbortSignal) {
    const taskId = execution.task.contract.taskId;
    if (this.faults.take(scope, taskId, 'interrupted_before_commit')) throw new Error('Sandbox interrupted before receipt');
    await this.#store.write(scope, async (tx) => {
      signal.throwIfAborted();
      const current = await tx.getTask(taskId);
      const control = tx.taskControl(taskId);
      if (!current || !control || current.status !== 'RUNNING' || control.leaseId !== execution.leaseId
          || control.cancelRequested || this.#now() >= (control.leaseUntil ?? 0)
          || this.#now() >= Date.parse(current.contract.expiresAt)) throw conflict('Sandbox dispatch lease is unavailable');
      const contract = current.contract;
      const policy = verifyContract(contract, control.request, this.#capabilities);
      if (policy.requiresApproval && !contract.approval.approvalId) throw denied('Task requires owner approval');
      await checkTaskConsent(this.#consent, tx, contract, policy, 'pre_external');
      const previous = tx.taskReceipt(contract.execution.idempotencyKey);
      if (previous) {
        if (!matchesReceipt(previous, contract, control.requestHash)) throw conflict('Sandbox execution key is already bound');
        return;
      }
      if (control.requestHash !== taskInputHash(policy)) throw conflict('Sandbox input does not match the admitted request');
      signal.throwIfAborted();
      const evidenceId = randomUUID();
      const receipt: TaskReceipt = {
        evidenceId, taskId, executionKey: contract.execution.idempotencyKey, leaseId: execution.leaseId,
        inputHash: control.requestHash, route: policy.route, targetApp: policy.targetApp, action: policy.action,
        executedBy: workerActor(policy.route), consentVersion: contract.consentVersion, committedAt: new Date(this.#now()).toISOString(),
        output: { effectId: evidenceId, action: policy.action, targetApp: policy.targetApp, simulated: true,
          ...(policy.action === 'app.read' && { fixture: 'Sandbox notes overview' }) },
      };
      await checkTaskConsent(this.#consent, tx, contract, policy, 'pre_commit');
      signal.throwIfAborted();
      if (this.#now() >= control.leaseUntil!) throw conflict('Sandbox dispatch lease expired before commit');
      tx.insertTaskReceipt(receipt);
    });
    if (this.faults.take(scope, taskId, 'missing_ack_after_commit')) throw new Error('Sandbox acknowledgement lost');
    if (this.faults.take(scope, taskId, 'timeout_after_commit')) await waitForAbort(signal);
  }
}

/** Read-only verification runs under an actor separate from the named sandbox adapters. */
export class SandboxReceiptVerifier implements TaskVerifier {
  readonly #store: M1PersistencePort;
  readonly #faults: SandboxFaultPlan;

  constructor(store: M1PersistencePort, faults: SandboxFaultPlan) {
    this.#store = store;
    this.#faults = faults;
  }

  async verify(scope: DaoScope, task: TaskRecord, signal: AbortSignal): Promise<TaskReview> {
    signal.throwIfAborted();
    const id = task.contract.taskId;
    if (this.#faults.take(scope, id, 'probe_unavailable')) throw new Error('Verifier unavailable');
    if (this.#faults.take(scope, id, 'missing_review_proof')) return { kind: 'uncertain', reviewerId: TASK_REVIEWER };
    return this.#store.read(scope, async (tx) => {
      signal.throwIfAborted();
      const current = await tx.getTask(id);
      if (!current || !['VERIFYING', 'UNKNOWN_RESULT'].includes(current.status)) return { kind: 'uncertain', reviewerId: TASK_REVIEWER };
      const key = task.contract.execution.idempotencyKey;
      const receipt = tx.taskReceipt(key);
      return receipt
        ? { kind: 'applied', receipt, reviewerId: TASK_REVIEWER }
        : { kind: 'absent', reviewerId: TASK_REVIEWER };
    });
  }
}

// Trusted in-process ports observe a deadline even if a test simulator deliberately drops its acknowledgement.
export async function taskDeadline<T>(milliseconds: number, outer: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const signal = outer ? AbortSignal.any([controller.signal, outer]) : controller.signal;
  signal.throwIfAborted();
  let stop!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new Error('Sandbox deadline exceeded')), milliseconds);
  try { return await Promise.race([stopped, run(signal)]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

export function isIndependentReceipt(proof: TaskReview, stored: TaskReceipt | null, task: TaskRecord, control: TaskControl) {
  return proof.kind === 'applied' && proof.reviewerId === TASK_REVIEWER && stored
    && proof.reviewerId !== stored.executedBy && proof.receipt.evidenceId === stored.evidenceId
    && proof.receipt.executionKey === stored.executionKey && matchesReceipt(stored, task.contract, control.requestHash);
}
