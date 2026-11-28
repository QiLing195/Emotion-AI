import type { AgentAccountabilityLedger, DaoRequestBody, DaoScope, JsonObject, MikaTaskContract, TaskRecord } from '../contracts/dao-v31/index.ts';
import type { GrantUse } from './m1Types.ts';

export type TaskRequest = DaoRequestBody<'createTask'>['request'];
export type TaskRoute = MikaTaskContract['route'];
export type TaskRisk = MikaTaskContract['riskLevel'];
export type TaskActor = string;

export type TaskControl = Readonly<{
  taskId: string; goalId: string; proposedBy: string; request: TaskRequest;
  requestHash: string; dependsOn: readonly string[]; criteria: readonly string[];
  dueAt: number; probes: number;
  leaseId?: string; leaseUntil?: number; cancelRequested?: boolean;
  outcome?: string;
}>;

export type TaskReceipt = Readonly<{
  evidenceId: string; taskId: string; executionKey: string; leaseId: string;
  inputHash: string; route: TaskRoute; targetApp: string; action: string;
  executedBy: TaskActor; consentVersion: number; committedAt: string; output: JsonObject;
}>;

export type TaskExecution = Readonly<{
  task: TaskRecord; control: TaskControl; leaseId: string;
}>;

export type TaskTransition = Readonly<{ sequence: number; task: TaskRecord; reason: string }>;
export type TaskReview =
  | { readonly kind: 'applied'; readonly reviewerId: TaskActor; readonly receipt: TaskReceipt }
  | { readonly kind: 'absent'; readonly reviewerId: TaskActor }
  | { readonly kind: 'uncertain'; readonly reviewerId: TaskActor };
export type TaskProof = Extract<TaskReview, { kind: 'applied' }>;

export type TaskPolicy = Readonly<{
  route: TaskRoute; capabilityOrder: readonly TaskRoute[]; action: string; risk: TaskRisk; targetApp: string;
  requiresApproval: boolean; grants: readonly GrantUse[]; input: JsonObject; outputSchema: JsonObject;
  criteria: readonly string[];
}>;

export type GoalPlanStep = Readonly<{ key: string; request: Omit<TaskRequest, 'goalId'>; dependsOn?: readonly string[] }>;
export type GoalPlan = Readonly<{ goalId: string; steps: readonly GoalPlanStep[] }>;
export type GoalSummary = Readonly<{
  scope: DaoScope; goalId: string; status: 'active' | 'completed' | 'needs_attention';
  tasks: readonly TaskRecord[]; ledger: readonly AgentAccountabilityLedger[];
}>;
