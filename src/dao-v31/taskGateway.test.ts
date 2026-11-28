import { describe, expect, it } from 'vitest';
import type { DataCategory, SensitivityLevel, TaskRecord } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { MikaSandbox, SandboxReceiptVerifier } from './mikaSandbox.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { UnifiedTaskGateway } from './taskGateway.ts';
import { TASK_ACCEPTOR, TASK_PURPOSE, TASK_REVIEWER, workerActor } from './taskPolicy.ts';
import { createTaskRuntime } from './taskRuntime.ts';
import type { TaskReview, TaskRoute } from './taskTypes.ts';
import { deferred, scope, temporaryDatabase } from './testSupport.ts';

const start = Date.parse('2026-11-28T00:00:00Z');
const all = { allowRead: true, allowUpload: true, allowAnalysis: false,
  allowPsychologicalInference: false, allowLongTermMemory: false, allowCharacterUse: false };
const none = { ...all, allowRead: false, allowUpload: false };

function fixture(capabilities?: readonly TaskRoute[]) {
  const temp = temporaryDatabase();
  const store = new SqliteDaoStore(temp.directory);
  let time = start;
  const now = () => time;
  const consent = new ConsentManager(store, new StateCoordinator(store, now), now);
  const tasks = createTaskRuntime(store, consent, { now, automatic: false, timeoutMs: 70, capabilities });
  const grant = async (app: string, category: DataCategory, enabled = true, sensitivity: SensitivityLevel = 'Personal',
    dataScope?: readonly string[], target = scope) => {
    const previous = await store.read(target, (tx) => tx.getConsentVersion());
    const saved = await consent.replace(target, category, {
      sourceId: app, sensitivity, collectionMode: 'on_demand', purposes: [TASK_PURPOSE],
      permissions: enabled ? all : none, retentionPolicy: {}, expectedConsentVersion: previous, ...(dataScope && { dataScope }),
    });
    return saved.consentVersion;
  };
  const version = (target = scope) => store.read(target, (tx) => tx.getConsentVersion());
  const receipt = (task: TaskRecord, target = scope) => store.read(target, (tx) => tx.taskReceipt(task.contract.execution.idempotencyKey));
  return { temp, store, consent, tasks, grant, now, version, receipt, tick: (delay: number) => { time += delay; },
    async close() { await tasks.close(); await store.close(); temp.remove(); } };
}

const reminders = { intent: 'reminder.create', inputs: { title: 'Break' } };
const notes = { intent: 'app.open', targetApp: 'sandbox.notes', inputs: {} };

async function queueReminder(run: ReturnType<typeof fixture>, title = 'Break') {
  const version = await run.version();
  const pending = await run.tasks.gateway.submit(scope, { ...reminders, inputs: { title } }, version);
  expect(pending.status).toBe('WAITING_APPROVAL');
  return run.tasks.gateway.approve(scope, pending.contract.taskId, version);
}

describe('M2b R15/R22 task gateway and independent receipt verification', () => {
  it('blocks every supported Critical intent even with grants and an attempted owner approval', async () => {
    const run = fixture();
    try {
      const cases = [
        ['payment.execute', 'sandbox.payments'],
        ['transfer.execute', 'sandbox.payments'],
        ['account.change_credentials', 'sandbox.accounts'],
      ] as const;
      for (const app of new Set(cases.map(([, target]) => target))) {
        await run.grant(app, 'DeviceUsage');
        await run.grant(app, 'CommunicationSocial', true, 'HighlySensitive');
      }
      for (const [intent, targetApp] of cases) {
        const version = await run.version();
        const task = await run.tasks.gateway.submit(scope, { intent, targetApp, inputs: { untrusted: 'discard' } }, version);
        expect(task).toMatchObject({ status: 'BLOCKED', attempt: 0, contract: { riskLevel: 'critical' } });
        await expect(run.tasks.gateway.approve(scope, task.contract.taskId, version)).rejects.toMatchObject({ status: 409 });
        expect(await run.receipt(task)).toBeNull();
        expect((await run.tasks.gateway.ledger(scope, { taskId: '', sequence: 0 }, 10, task.contract.taskId)).items)
          .toMatchObject([{ phase: 'proposed' }, { phase: 'evaluated', finalOutcome: 'BLOCKED' }]);
      }
      expect(await run.tasks.gateway.runNext(scope)).toBeNull();
    } finally { await run.close(); }
  });

  it('recovers 50 missing-ACK or timeout faults with no duplicate effects and no extra dispatches', async () => {
    const run = fixture();
    try {
      await run.grant('sandbox.reminders', 'DeviceUsage');
      await run.grant('sandbox.reminders', 'CalendarTask');
      await run.grant('sandbox.calendar', 'DeviceUsage');
      await run.grant('sandbox.calendar', 'CalendarTask');
      await run.grant('sandbox.notes', 'DeviceUsage');
      const version = await run.grant('sandbox.notes', 'UserProvided');
      const intents = ['calendar.create', 'reminder.create', 'draft.prepare'] as const;
      const effects = new Set<string>();
      const routes = new Set<TaskRoute>();
      for (let n = 0; n < 50; n++) {
        const pending = await run.tasks.gateway.submit(scope, { intent: intents[n % intents.length], inputs: { title: 'Fault ' + n } }, version);
        const task = await run.tasks.gateway.approve(scope, pending.contract.taskId, version);
        routes.add(task.contract.route);
        run.tasks.sandbox.faults.set(scope, task.contract.taskId, n % 2 ? 'missing_ack_after_commit' : 'timeout_after_commit');
        const failedAck = await run.tasks.gateway.runNext(scope);
        expect(failedAck).toMatchObject({ status: 'UNKNOWN_RESULT', attempt: 1, evidenceRefs: [] });
        const effect = await run.receipt(task);
        expect(effect).not.toBeNull();
        const verified = await run.tasks.gateway.runNext(scope);
        expect(verified).toMatchObject({ status: 'COMPLETED', attempt: 1, evidenceRefs: [effect!.evidenceId] });
        expect(await run.receipt(task)).toEqual(effect);
        const { items: ledger } = await run.tasks.gateway.ledger(scope, { taskId: '', sequence: 0 }, 15, task.contract.taskId);
        expect(ledger.filter((row) => row.phase === 'dispatched')).toHaveLength(1);
        expect(ledger.find((row) => row.phase === 'reviewed')).toMatchObject({
          reviewedBy: TASK_REVIEWER, executedBy: effect!.executedBy, evidenceRefs: [effect!.evidenceId],
        });
        expect(ledger.find((row) => row.phase === 'accepted')).toMatchObject({ acceptedBy: TASK_ACCEPTOR });
        effects.add(effect!.evidenceId);
      }
      expect(effects.size).toBe(50);
      expect(routes).toEqual(new Set(['official_api', 'android_native', 'mika_sandbox']));
      expect(await run.tasks.gateway.runNext(scope)).toBeNull();
      process.stdout.write('M2b acceptance: 50/50 post-write ACK failures recovered, 50 unique sandbox receipts, 0 duplicate dispatches\n');
    } finally { await run.close(); }
  }, 30_000);

  it('waits through an inconclusive probe and retries only after authoritative absence', async () => {
    const run = fixture();
    try {
      await run.grant('sandbox.reminders', 'DeviceUsage');
      await run.grant('sandbox.reminders', 'CalendarTask');
      const task = await queueReminder(run);
      run.tasks.sandbox.faults.set(scope, task.contract.taskId, 'interrupted_before_commit');
      run.tasks.sandbox.faults.set(scope, task.contract.taskId, 'probe_unavailable');
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT', attempt: 1 });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT', attempt: 1 });
      expect(await run.tasks.gateway.runNext(scope)).toBeNull();
      expect(await run.receipt(task)).toBeNull();
      run.tick(101);
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'QUEUED', attempt: 1 });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'VERIFYING', attempt: 2 });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', attempt: 2 });
      expect(await run.receipt(task)).not.toBeNull();
    } finally { await run.close(); }
  });

  it('applies app revocation equally to native and Mika routes and to separate data grants', async () => {
    const run = fixture();
    const mika = createTaskRuntime(run.store, run.consent, { now: run.now, automatic: false, capabilities: ['mika_sandbox'] });
    try {
      await run.grant('sandbox.notes', 'DeviceUsage');
      const version = await run.grant('sandbox.notes', 'UserProvided');
      const native = await run.tasks.gateway.submit(scope, notes, version);
      const routed = await mika.gateway.submit(scope, notes, version);
      const reading = await run.tasks.gateway.submit(scope, { intent: 'app.read', inputs: { section: 'overview' } }, version);
      expect(native.contract.route).toBe('android_native');
      expect(routed.contract.route).toBe('mika_sandbox');
      expect(native.contract.allowedDataScopes).toEqual(routed.contract.allowedDataScopes);
      const revoked = await run.grant('sandbox.notes', 'DeviceUsage', false);
      await run.tasks.gateway.reconcileConsent(scope);
      for (const task of [native, routed, reading]) {
        expect((await run.tasks.gateway.list(scope, '', 20)).items.find((item) => item.contract.taskId === task.contract.taskId))
          .toMatchObject({ status: 'BLOCKED', attempt: 0 });
        expect(await run.receipt(task)).toBeNull();
      }
      expect((await mika.gateway.submit(scope, notes, revoked)).status).toBe('BLOCKED');
      expect(await mika.gateway.runNext(scope)).toBeNull();
    } finally { await mika.close(); await run.close(); }
  });

  it('fences a running task on revocation before the sandbox can write', async () => {
    const run = fixture();
    const entered = deferred();
    const allowReturn = deferred();
    const sandbox = new MikaSandbox(run.store, run.consent, run.now);
    const alternate = new UnifiedTaskGateway(run.store, run.consent, {
      execute: async (identity, execution, signal) => {
        entered.resolve();
        await allowReturn.promise;
        return sandbox.execute(identity, execution, signal);
      },
    }, new SandboxReceiptVerifier(run.store, sandbox.faults), { now: run.now, timeoutMs: 2000 });
    try {
      const version = await run.grant('sandbox.notes', 'DeviceUsage');
      const task = await alternate.submit(scope, notes, version);
      const running = alternate.runNext(scope);
      await entered.promise;
      await run.grant('sandbox.notes', 'DeviceUsage', false);
      await alternate.reconcileConsent(scope);
      allowReturn.resolve();
      expect(await running).toMatchObject({ status: 'UNKNOWN_RESULT' });
      expect(await alternate.runNext(scope)).toMatchObject({ status: 'BLOCKED', attempt: 1, evidenceRefs: [] });
      expect(await run.receipt(task)).toBeNull();
    } finally { allowReturn.resolve(); await run.close(); }
  });

  it('never accepts missing, executor-authored or contradictory verification evidence', async () => {
    const run = fixture();
    const sandbox = new MikaSandbox(run.store, run.consent, run.now);
    let observation: TaskReview = { kind: 'uncertain', reviewerId: TASK_REVIEWER };
    const gateway = new UnifiedTaskGateway(run.store, run.consent, sandbox,
      { verify: async () => observation }, { now: run.now });
    try {
      const version = await run.grant('sandbox.notes', 'DeviceUsage');
      const task = await gateway.submit(scope, notes, version);
      expect((await gateway.runNext(scope))?.status).toBe('VERIFYING');
      const receipt = (await run.receipt(task))!;
      for (const next of [
        { kind: 'uncertain', reviewerId: TASK_REVIEWER },
        { kind: 'applied', reviewerId: receipt.executedBy, receipt },
        { kind: 'applied', reviewerId: TASK_REVIEWER, receipt: { ...receipt, evidenceId: 'wrong-receipt' } },
        { kind: 'absent', reviewerId: TASK_REVIEWER },
      ] as const) {
        observation = next;
        expect(await gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT', attempt: 1 });
        run.tick(1020);
      }
      await expect(run.store.write(scope, (tx) => tx.saveTask({
        ...task, status: 'COMPLETED', result: receipt.output, evidenceRefs: [receipt.evidenceId],
      }))).rejects.toMatchObject({ status: 409 });
      const { items } = await gateway.ledger(scope, { taskId: '', sequence: 0 }, 20, task.contract.taskId);
      expect(items.some((entry) => entry.phase === 'accepted' || entry.finalOutcome === 'COMPLETED')).toBe(false);
      expect(receipt.executedBy).toBe(workerActor(task.contract.route));
    } finally { await run.close(); }
  });

  it('keeps an already committed effect under review when cancellation arrives after the lost acknowledgement', async () => {
    const run = fixture();
    try {
      await run.grant('sandbox.reminders', 'DeviceUsage');
      await run.grant('sandbox.reminders', 'CalendarTask');
      const task = await queueReminder(run);
      run.tasks.sandbox.faults.set(scope, task.contract.taskId, 'missing_ack_after_commit');
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT' });
      expect(await run.tasks.gateway.cancel(scope, task.contract.taskId, await run.version())).toMatchObject({ status: 'UNKNOWN_RESULT' });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', attempt: 1 });
      expect(await run.receipt(task)).not.toBeNull();
    } finally { await run.close(); }
  });

  it('reopens a persisted unknown task and verifies its pre-restart sandbox receipt', async () => {
    const run = fixture();
    try {
      const version = await run.grant('sandbox.notes', 'DeviceUsage');
      const task = await run.tasks.gateway.submit(scope, notes, version);
      run.tasks.sandbox.faults.set(scope, task.contract.taskId, 'missing_ack_after_commit');
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT' });
      const first = await run.receipt(task);
      await run.tasks.close();
      await run.store.close();
      const reopened = new SqliteDaoStore(run.temp.directory);
      try {
        const manager = new ConsentManager(reopened, new StateCoordinator(reopened, run.now), run.now);
        const runtime = createTaskRuntime(reopened, manager, { now: run.now, automatic: false });
        try {
          expect(await runtime.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', attempt: 1 });
          expect(await reopened.read(scope, (tx) => tx.taskReceipt(task.contract.execution.idempotencyKey))).toEqual(first);
        } finally { await runtime.close(); }
      } finally { await reopened.close(); }
    } finally { await run.close(); }
  });

  it('lets a competing runtime reclaim an expired lease and fences the old worker', async () => {
    const run = fixture();
    const other = new SqliteDaoStore(run.temp.directory);
    const manager = new ConsentManager(other, new StateCoordinator(other, run.now), run.now);
    const competing = createTaskRuntime(other, manager, { now: run.now, automatic: false });
    const entered = deferred();
    const release = deferred();
    const sandbox = run.tasks.sandbox;
    const first = new UnifiedTaskGateway(run.store, run.consent, {
      execute: async (identity, task, signal) => {
        entered.resolve();
        await release.promise;
        return sandbox.execute(identity, task, signal);
      },
    }, new SandboxReceiptVerifier(run.store, sandbox.faults), { now: run.now });
    try {
      const version = await run.grant('sandbox.notes', 'DeviceUsage');
      const task = await first.submit(scope, notes, version);
      const slow = first.runNext(scope);
      try {
        await entered.promise;
        expect(await competing.gateway.runNext(scope)).toBeNull();
        run.tick(1501);
        expect(await competing.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT', attempt: 1 });
        expect(await competing.gateway.runNext(scope)).toMatchObject({ status: 'QUEUED', attempt: 1 });
        expect(await competing.gateway.runNext(scope)).toMatchObject({ status: 'VERIFYING', attempt: 2 });
        expect(await competing.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', attempt: 2 });
      } finally {
        release.resolve();
        await slow;
      }
      const receipt = await run.receipt(task);
      const { items } = await first.ledger(scope, { taskId: '', sequence: 0 }, 30, task.contract.taskId);
      expect(receipt).not.toBeNull();
      expect(items.filter((entry) => entry.phase === 'dispatched')).toHaveLength(2);
      expect(items.filter((entry) => entry.phase === 'accepted')).toMatchObject([{ evidenceRefs: [receipt!.evidenceId] }]);
    } finally { await competing.close(); await other.close(); await run.close(); }
  });

  it('parks a verified effect without publishing a result when consent changes before acceptance', async () => {
    const run = fixture();
    try {
      const version = await run.grant('sandbox.notes', 'DeviceUsage');
      const task = await run.tasks.gateway.submit(scope, notes, version);
      run.tasks.sandbox.faults.set(scope, task.contract.taskId, 'missing_ack_after_commit');
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'UNKNOWN_RESULT' });
      const receipt = await run.receipt(task);
      await run.grant('sandbox.notes', 'DeviceUsage', false);
      await run.tasks.gateway.reconcileConsent(scope);
      const parked = await run.tasks.gateway.runNext(scope);
      expect(parked).toMatchObject({ status: 'WAITING_USER_INPUT', attempt: 1, evidenceRefs: [] });
      expect(parked?.result).toBeUndefined();
      expect(await run.tasks.gateway.runNext(scope)).toBeNull();
      expect(await run.receipt(task)).toEqual(receipt);
      const { items } = await run.tasks.gateway.ledger(scope, { taskId: '', sequence: 0 }, 20, task.contract.taskId);
      expect(items.some((entry) => entry.phase === 'accepted')).toBe(false);
    } finally { await run.close(); }
  });

  it('expires unapproved work and requires explicit approval for a High risk simulation', async () => {
    const run = fixture();
    try {
      await run.grant('sandbox.messages', 'DeviceUsage');
      const version = await run.grant('sandbox.messages', 'CommunicationSocial', true, 'Sensitive');
      const request = { intent: 'message.send', inputs: { message: 'Synthetic message' } };
      const expires = await run.tasks.gateway.submit(scope, request, version);
      expect(expires).toMatchObject({ status: 'WAITING_APPROVAL', attempt: 0, contract: { riskLevel: 'high' } });
      expect(await run.tasks.gateway.runNext(scope)).toBeNull();
      run.tick(30 * 60_000);
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'EXPIRED', attempt: 0 });
      expect(await run.receipt(expires)).toBeNull();

      const waiting = await run.tasks.gateway.submit(scope, request, version);
      expect(await run.tasks.gateway.approve(scope, waiting.contract.taskId, version)).toMatchObject({ status: 'QUEUED' });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'VERIFYING' });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', result: { simulated: true } });
    } finally { await run.close(); }
  });

  it('decomposes and evaluates a goal only after dispatch, distinct review and acceptance of all dependent tasks', async () => {
    const run = fixture();
    try {
      await run.grant('sandbox.notes', 'DeviceUsage');
      const version = await run.grant('sandbox.notes', 'UserProvided');
      const [open, draft] = await run.tasks.startGoal(scope, { goalId: 'prepare', kind: 'prepare_note', title: 'Planning' }, version);
      expect(open.status).toBe('QUEUED');
      expect(draft.status).toBe('WAITING_APPROVAL');
      await run.tasks.gateway.approve(scope, draft.contract.taskId, version);
      expect((await run.tasks.goal(scope, 'prepare')).status).toBe('active');
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'VERIFYING', contract: { taskId: open.contract.taskId } });
      expect(await run.receipt(draft)).toBeNull();
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', contract: { taskId: open.contract.taskId } });
      run.tick(101);
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'VERIFYING', contract: { taskId: draft.contract.taskId } });
      expect(await run.tasks.gateway.runNext(scope)).toMatchObject({ status: 'COMPLETED', contract: { taskId: draft.contract.taskId } });
      const status = await run.tasks.goal(scope, 'prepare');
      expect(status.status).toBe('completed');
      expect(status.ledger.filter((entry) => entry.phase === 'evaluated').map((entry) => entry.finalOutcome)).toEqual(['COMPLETED', 'COMPLETED']);
      expect(status.ledger.filter((entry) => entry.phase === 'accepted').every((entry) =>
        entry.executedBy !== entry.reviewedBy && entry.executedBy !== entry.acceptedBy && entry.evidenceRefs.length === 1)).toBe(true);
    } finally { await run.close(); }
  });
});
