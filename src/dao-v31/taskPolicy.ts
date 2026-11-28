import type { DataCategory, JsonObject, MikaTaskContract, SensitivityLevel } from '../contracts/dao-v31/index.ts';
import { conflict, invalid } from './errors.ts';
import { exactJson, integrityHash, jsonValue } from './exactJson.ts';
import { isIdentifier, sameScope } from './sessionAuth.ts';
import { validateSchema } from './validation.ts';
import type { GrantUse } from './m1Types.ts';
import type { TaskPolicy, TaskReceipt, TaskRequest, TaskRisk, TaskRoute } from './taskTypes.ts';

export const TASK_PURPOSE = 'task-execution';
export const TASK_REVIEWER = 'dao-independent-verifier';
export const TASK_ACCEPTOR = 'dao-policy-acceptance';
export const TASK_DISPATCHER = 'dao-orchestrator';

type Field = 'title' | 'message' | 'note' | 'section' | 'recordId' | 'when';
type Rule = Readonly<{
  risk: TaskRisk; apps: readonly string[]; routes: readonly TaskRoute[]; category: DataCategory;
  sensitivity: SensitivityLevel; write: boolean; required: readonly Field[]; optional?: readonly Field[];
}>;

const notes = ['sandbox.notes'];
const calendar = ['sandbox.calendar'];
const reminders = ['sandbox.reminders'];
const messages = ['sandbox.messages'];

const rules: Readonly<Record<string, Rule>> = Object.freeze({
  'calendar.create': { risk: 'medium', apps: calendar, routes: ['official_api', 'android_native'],
    category: 'CalendarTask', sensitivity: 'Personal', write: true, required: ['title'], optional: ['when'] },
  'calendar.update': { risk: 'medium', apps: calendar, routes: ['official_api', 'android_native'],
    category: 'CalendarTask', sensitivity: 'Personal', write: true, required: ['recordId', 'title'], optional: ['when'] },
  'reminder.create': { risk: 'medium', apps: reminders, routes: ['android_native'],
    category: 'CalendarTask', sensitivity: 'Personal', write: true, required: ['title'], optional: ['when'] },
  'app.open': { risk: 'low', apps: notes, routes: ['android_native', 'mika_sandbox'],
    category: 'DeviceUsage', sensitivity: 'Personal', write: false, required: [] },
  'app.read': { risk: 'low', apps: notes, routes: ['mika_sandbox'],
    category: 'UserProvided', sensitivity: 'Personal', write: false, required: ['section'] },
  'draft.prepare': { risk: 'medium', apps: notes, routes: ['mika_sandbox'],
    category: 'UserProvided', sensitivity: 'Personal', write: true, required: ['title'], optional: ['note'] },
  'message.send': { risk: 'high', apps: messages, routes: ['mika_sandbox'],
    category: 'CommunicationSocial', sensitivity: 'Sensitive', write: true, required: ['message'] },
  'content.delete': { risk: 'high', apps: notes, routes: ['mika_sandbox'],
    category: 'UserProvided', sensitivity: 'Sensitive', write: true, required: ['recordId'] },
  'payment.execute': { risk: 'critical', apps: ['sandbox.payments'], routes: ['official_api'],
    category: 'CommunicationSocial', sensitivity: 'HighlySensitive', write: true, required: [] },
  'transfer.execute': { risk: 'critical', apps: ['sandbox.payments'], routes: ['official_api'],
    category: 'CommunicationSocial', sensitivity: 'HighlySensitive', write: true, required: [] },
  'account.change_credentials': { risk: 'critical', apps: ['sandbox.accounts'], routes: ['official_api'],
    category: 'CommunicationSocial', sensitivity: 'HighlySensitive', write: true, required: [] },
});

const routeOrder: readonly TaskRoute[] = ['official_api', 'android_native', 'mika_sandbox'];
const characters = { title: 160, message: 1000, note: 1000, section: 16, recordId: 128, when: 40 };
const calendarTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function taskInput(rule: Rule, input: JsonObject): JsonObject {
  // No caller-controlled selector, permission, risk or output schema reaches a sandbox driver.
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Task inputs must be an object');
  const keys = [...rule.required, ...(rule.optional ?? [])];
  if (Object.keys(input).some((key) => !keys.includes(key as Field)) || rule.required.some((field) => !Object.hasOwn(input, field))) {
    throw invalid('Task inputs do not match the supported intent');
  }
  const accepted: [string, string][] = [];
  for (const field of keys) {
    if (!Object.hasOwn(input, field)) continue;
    const value = input[field];
    if (typeof value !== 'string' || value.length > characters[field] || !value.trim()
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
      || (field === 'recordId' && !isIdentifier(value))
      || (field === 'section' && value !== 'overview')
      || (field === 'when' && (!calendarTime.test(value) || !Number.isFinite(Date.parse(value))))) {
      throw invalid('Task input field is invalid');
    }
    accepted.push([field, value.trim()]);
  }
  return Object.fromEntries(accepted);
}

function resultSchema(action: string, app: string): JsonObject {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      effectId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' },
      action: { const: action }, targetApp: { const: app }, simulated: { const: true },
      ...(action === 'app.read' && { fixture: { const: 'Sandbox notes overview' } }),
    },
    required: ['effectId', 'action', 'targetApp', 'simulated', ...(action === 'app.read' ? ['fixture'] : [])],
  };
}

export function taskPolicy(request: TaskRequest, capabilities: readonly TaskRoute[] = routeOrder): TaskPolicy {
  const rule = Object.hasOwn(rules, request.intent) ? rules[request.intent] : undefined;
  if (!rule) throw invalid('Unsupported task intent');
  const app = request.targetApp ?? rule.apps[0];
  if (!rule.apps.includes(app)) throw invalid('Target application is outside the sandbox allowlist');
  const route = routeOrder.find((item) => rule.routes.includes(item) && (rule.risk === 'critical' || capabilities.includes(item)));
  if (!route) throw invalid('No supported sandbox route for this task');
  const input = rule.risk === 'critical' ? {} : taskInput(rule, request.inputs);
  const common = {
    sourceId: app, purpose: TASK_PURPOSE, collectionMode: 'on_demand', dataScope: [request.intent],
  } as const;
  const appGrant: GrantUse = { ...common, category: 'DeviceUsage', sensitivity: 'Personal', permission: 'allowRead' };
  const dataGrant: GrantUse = { ...common, category: rule.category, sensitivity: rule.sensitivity,
    permission: rule.write ? 'allowUpload' : 'allowRead' };
  return {
    route, capabilityOrder: rule.routes, action: request.intent, targetApp: app, risk: rule.risk,
    requiresApproval: rule.risk !== 'low', input, outputSchema: resultSchema(request.intent, app),
    grants: rule.risk === 'critical' ? [] : rule.category === 'DeviceUsage' && !rule.write ? [appGrant] : [appGrant, dataGrant],
    criteria: ['Verify one committed sandbox receipt for the approved route, application and action',
      'Keep the consent version current and verify independently of execution'],
  };
}

export const taskInputHash = (policy: TaskPolicy) => integrityHash(jsonValue({ action: policy.action, targetApp: policy.targetApp, input: policy.input }));

export const grantClaims = (policy: TaskPolicy): MikaTaskContract['allowedDataScopes'] =>
  policy.grants.map(({ sourceId, category, sensitivity, purpose, permission }) => ({ sourceId, category, sensitivity, purpose, permission }));

export function verifyContract(contract: MikaTaskContract, request: TaskRequest, capabilities?: readonly TaskRoute[]): TaskPolicy {
  validateSchema('MikaTaskContract', contract);
  const policy = taskPolicy(request, capabilities);
  if (contract.intent !== policy.action || contract.route !== policy.route || contract.riskLevel !== policy.risk
      || contract.allowedActions.length !== 1 || contract.allowedActions[0] !== policy.action
      || contract.targetApps.length !== 1 || contract.targetApps[0] !== policy.targetApp
      || contract.approval.required !== policy.requiresApproval
      || exactJson(jsonValue(grantClaims(policy))) !== exactJson(jsonValue(contract.allowedDataScopes))
      || exactJson(contract.outputSchema) !== exactJson(policy.outputSchema)) {
    throw conflict('Stored task contract does not match server policy');
  }
  return policy;
}

export function workerActor(route: TaskRoute) {
  return route === 'official_api' ? 'sandbox-official-adapter' : route === 'android_native' ? 'sandbox-native-adapter' : 'sandbox-mika-adapter';
}

export function matchesReceipt(receipt: TaskReceipt, contract: MikaTaskContract, expectedInputHash: string) {
  const output = receipt.output;
  const { effectId, action, targetApp, simulated, fixture } = output;
  const reading = receipt.action === 'app.read';
  return isIdentifier(receipt.evidenceId) && receipt.taskId === contract.taskId
    && receipt.executionKey === contract.execution.idempotencyKey && receipt.inputHash === expectedInputHash
    && receipt.route === contract.route && receipt.targetApp === contract.targetApps[0] && receipt.action === contract.allowedActions[0]
    && receipt.consentVersion === contract.consentVersion && receipt.executedBy === workerActor(receipt.route)
    && isIdentifier(receipt.leaseId) && Number.isFinite(Date.parse(receipt.committedAt))
    && effectId === receipt.evidenceId && action === receipt.action && targetApp === receipt.targetApp
    && simulated === true && Object.keys(output).length === (reading ? 5 : 4)
    && (reading ? fixture === 'Sandbox notes overview' : fixture === undefined);
}

export function ensureTaskScope(contract: MikaTaskContract, scope: MikaTaskContract['scope']) {
  if (!sameScope(contract.scope, scope)) throw conflict('Task scope mismatch');
}
