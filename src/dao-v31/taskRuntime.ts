import type { DaoScope } from '../contracts/dao-v31/index.ts';
import { ConsentManager } from './consentManager.ts';
import { invalid } from './errors.ts';
import { MikaSandbox, SandboxReceiptVerifier, taskScopeKey } from './mikaSandbox.ts';
import type { M1PersistencePort } from './m1Types.ts';
import { UnifiedTaskGateway } from './taskGateway.ts';
import type { GoalPlan, TaskRoute } from './taskTypes.ts';

type RuntimeOptions = Readonly<{
  now?: () => number; automatic?: boolean; pollMs?: number; timeoutMs?: number; taskTtlMs?: number;
  maxRetries?: number; capabilities?: readonly TaskRoute[];
}>;
type Goal = Readonly<{ goalId: string; kind: 'prepare_note' | 'read_notes'; title?: string }>;

function decompose(goal: Goal): GoalPlan {
  if (goal.kind === 'prepare_note') {
    if (!goal.title?.trim()) throw invalid('The note goal requires a title');
    return { goalId: goal.goalId, steps: [
      { key: 'open', request: { intent: 'app.open', targetApp: 'sandbox.notes', inputs: {} } },
      { key: 'draft', dependsOn: ['open'], request: { intent: 'draft.prepare', targetApp: 'sandbox.notes', inputs: { title: goal.title } } },
    ] };
  }
  if (goal.kind === 'read_notes') {
    return { goalId: goal.goalId, steps: [
      { key: 'open', request: { intent: 'app.open', targetApp: 'sandbox.notes', inputs: {} } },
      { key: 'read', dependsOn: ['open'], request: { intent: 'app.read', targetApp: 'sandbox.notes', inputs: { section: 'overview' } } },
    ] };
  }
  throw invalid('Unsupported orchestration goal');
}

class TaskSupervisor {
  readonly #store: M1PersistencePort;
  readonly #gateway: UnifiedTaskGateway;
  readonly #now: () => number;
  readonly #active = new Map<string, Promise<void>>();
  #closed = false;
  #timer?: NodeJS.Timeout;
  #poll?: Promise<void>;

  constructor(store: M1PersistencePort, gateway: UnifiedTaskGateway, now: () => number, interval?: number) {
    this.#store = store;
    this.#gateway = gateway;
    this.#now = now;
    if (interval !== undefined) {
      if (!Number.isFinite(interval) || interval < 10) throw new Error('Invalid task polling interval');
      this.#timer = setInterval(() => this.#pollDue(), interval);
      this.#timer.unref();
      this.#pollDue();
    }
  }

  #pollDue() {
    if (this.#closed || this.#poll || this.#active.size >= 4) return;
    this.#poll = Promise.all((['prod', 'exp'] as const).map((env) => this.#store.dueTaskScopes(env, this.#now(), 8)))
      .then((scopes) => { for (const scope of scopes.flat()) this.kick(scope); })
      .catch(() => {}) // A transient SQLite failure leaves durable due work for the next poll.
      .finally(() => { this.#poll = undefined; });
  }

  kick(scope: DaoScope) {
    if (this.#closed || !this.#timer || this.#active.size >= 4) return;
    const key = taskScopeKey(scope, '');
    if (this.#active.has(key)) return;
    const work = (async () => {
      for (let i = 0; i < 12 && !this.#closed; i++) {
        if (!await this.#gateway.runNext(scope)) break;
      }
    })().catch(() => {}).finally(() => { this.#active.delete(key); });
    this.#active.set(key, work);
  }

  async close() {
    this.#closed = true;
    clearInterval(this.#timer);
    await this.#poll;
    await Promise.all([...this.#active.values()]);
  }
}

export function createTaskRuntime(store: M1PersistencePort, consent: ConsentManager, options: RuntimeOptions = {}) {
  const now = options.now ?? Date.now;
  const sandbox = new MikaSandbox(store, consent, now, options.capabilities);
  const verifier = new SandboxReceiptVerifier(store, sandbox.faults);
  const gateway = new UnifiedTaskGateway(store, consent, sandbox, verifier, { ...options, now });
  const supervisor = new TaskSupervisor(store, gateway, now, options.automatic === false ? undefined : options.pollMs ?? 250);
  const kick = (scope: DaoScope) => supervisor.kick(scope);
  return {
    gateway, sandbox, kick, close: () => supervisor.close(),
    async startGoal(scope: DaoScope, goal: Goal, expected: number) {
      const tasks = await gateway.submitPlan(scope, decompose(goal), expected);
      kick(scope);
      return tasks;
    },
    goal: (scope: DaoScope, goalId: string) => gateway.goal(scope, goalId),
  };
}
