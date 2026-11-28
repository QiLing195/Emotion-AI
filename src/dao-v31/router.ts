import express from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAO_API_PREFIX, DAO_CONTRACT_VERSION, DAO_PROJECTION_VERSION, SCOPE_HEADERS } from '../contracts/dao-v31/index.ts';
import type { ApiEnvelope, ApiMeta, DaoOperationId, DaoScope } from '../contracts/dao-v31/index.ts';
import { DaoError, invalid } from './errors.ts';
import { isIdentifier, isScope, sameScope, sessionKey, verifySessionToken } from './sessionAuth.ts';
import type { SessionClaims } from './sessionAuth.ts';
import { SqliteDaoStore } from './sqliteStore.ts';
import { StateCoordinator } from './stateCoordinator.ts';
import { ConsentManager } from './consentManager.ts';
import { PersonalDataHub } from './dataHub.ts';
import { DaoViews } from './views.ts';
import { DaoCursors } from './cursors.ts';
import { serveRuntimeStream } from './runtimeStream.ts';
import { BackupService } from './backupService.ts';
import { bodyFor, paramsFor, queryFor } from './validation.ts';
import { createTrackRuntime } from './trackRuntime.ts';
import { MemoryWorker } from './memoryWorker.ts';
import { createTaskRuntime } from './taskRuntime.ts';

export interface DaoRouterOptions {
  readonly secret: string;
  readonly ownerId: string;
  readonly directory: string;
  readonly now?: () => number;
  readonly heartbeatMs?: number;
  readonly pollMs?: number;
  readonly autoRunTasks?: boolean;
  readonly taskPollMs?: number;
}

export type RouteContext = {
  readonly claims: SessionClaims;
  readonly scope: DaoScope;
  readonly requestId: string;
};

export function metadata(requestId: string, time: number, consentVersion: number): ApiMeta {
  return { requestId, serverTime: new Date(time).toISOString(), consentVersion, projectionVersion: DAO_PROJECTION_VERSION };
}

function writeKey(req: Request, operation: DaoOperationId, path: string, body: unknown) {
  const key = req.header('Idempotency-Key');
  if (!isIdentifier(key)) throw invalid('A valid Idempotency-Key header is required');
  return { operation, path, key, body };
}

function numericQuery(req: Request) {
  const query = { ...req.query };
  for (const name of ['limit', 'afterSequence']) {
    const raw = query[name];
    if (typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw)) {
      // Keep the Express input intact and let schema validation inspect typed numbers.
      Object.defineProperty(query, name, { value: Number(raw), enumerable: true });
    }
  }
  return query;
}

export function createDaoRouter(options: DaoRouterOptions) {
  sessionKey(options.secret);
  if (!isIdentifier(options.ownerId)) throw new Error('DAO_OWNER_ID must be a valid scope identifier');
  const now = options.now ?? Date.now;
  const router = express.Router();
  const store = new SqliteDaoStore(options.directory);
  const coordinator = new StateCoordinator(store, now);
  const consent = new ConsentManager(store, coordinator, now);
  const hub = new PersonalDataHub(store, consent, coordinator, now);
  const tasks = createTaskRuntime(store, consent, { now, automatic: options.autoRunTasks, pollMs: options.taskPollMs });
  const gateway = tasks.gateway;
  const views = new DaoViews(store, hub, (tx, task) => gateway.publicView(tx, task));
  const cursors = new DaoCursors(options.secret);
  const backups = new BackupService(store, consent, coordinator, now);
  const memoryWorker = new MemoryWorker(options.directory);
  const runtime = createTrackRuntime(store, consent, hub, coordinator, { now }, memoryWorker.lookup);
  const contexts = new WeakMap<Request, RouteContext>();

  router.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.header('Authorization');
    const token = authorization?.match(/^Bearer ([^ ]+)$/i)?.[1];
    if (!token) throw new DaoError(401, 'UNAUTHENTICATED', 'A scoped bearer token is required');
    const claims = verifySessionToken(options.secret, token, options.ownerId, now());
    const scope = {
      ownerId: claims.scope.ownerId, env: req.header(SCOPE_HEADERS.env),
      characterId: req.header(SCOPE_HEADERS.characterId), sessionId: req.header(SCOPE_HEADERS.sessionId),
    };
    if (!isScope(scope)) throw invalid('All three DAO scope headers are required');
    if (!sameScope(scope, claims.scope)) throw new DaoError(403, 'SCOPE_MISMATCH', 'Bearer token does not authorize the requested scope');
    contexts.set(req, { claims, scope, requestId: res.locals.requestId as string });
    next();
  });

  const ordinaryJson = express.json({ limit: '64kb' });
  const backupJson = express.json({ limit: '8mb' });
  router.use((req, res, next) => (req.method === 'POST' && req.path === '/backup/restore' ? backupJson : ordinaryJson)(req, res, next));
  const context = (req: Request) => contexts.get(req)!;
  const success = async <T,>(req: Request, res: Response, status: number, data: T, committedVersion?: number) => {
    const { scope, requestId } = context(req);
    const consentVersion = committedVersion ?? await store.read(scope, (tx) => tx.getConsentVersion());
    const payload: ApiEnvelope<T> = { ok: true, data, meta: metadata(requestId, now(), consentVersion) };
    res.status(status).json(payload);
  };

  router.get('/health', async (req, res) => {
    const { scope } = context(req);
    const sqlite = await store.health(scope.env);
    await success(req, res, 200, { env: scope.env, contractVersion: DAO_CONTRACT_VERSION, sqlite });
  });

  router.get('/consents', async (req, res) => {
    const { items, version } = await consent.list(context(req).scope);
    await success(req, res, 200, { items }, version);
  });

  router.put('/consents/:category', async (req, res) => {
    const { category } = paramsFor('putConsent', req.params);
    const body = bodyFor('putConsent', req.body);
    const grant = await consent.replace(context(req).scope, category, body,
      writeKey(req, 'putConsent', '/consents/' + category, body));
    await gateway.reconcileConsent(context(req).scope);
    tasks.kick(context(req).scope);
    await success(req, res, 200, grant);
  });

  router.post('/data/records', async (req, res) => {
    const input = bodyFor('createDataRecord', req.body);
    const result = await hub.ingest(context(req).scope, input, writeKey(req, 'createDataRecord', '/data/records', input));
    await success(req, res, 201, result);
  });

  router.get('/data/observations', async (req, res) => {
    const { cursor, limit = 50, category, sensitivity } = queryFor('listObservations', numericQuery(req));
    const { scope } = context(req);
    const filter = { ...(category && { category }), ...(sensitivity && { sensitivity }) };
    const cursorPurpose = 'observations:' + JSON.stringify(filter);
    const after = cursor ? cursors.open(scope, cursorPurpose, cursor) : [0, ''];
    if (!Array.isArray(after) || typeof after[0] !== 'number' || typeof after[1] !== 'string') throw invalid('Invalid observation cursor');
    const { items, version, next } = await hub.listObservations(scope, filter, after[0], limit, after[1]);
    await success(req, res, 200, {
      items, ...(next && { nextCursor: cursors.seal(scope, cursorPurpose, [next.sequence, next.id]) }),
    }, version);
  });

  router.get('/provenance/:entityId', async (req, res) => {
    const { entityId } = paramsFor('getProvenance', req.params);
    const { version, ...data } = await hub.provenance(context(req).scope, entityId);
    await success(req, res, 200, data, version);
  });

  router.get('/state/snapshot', async (req, res) => {
    const { data, version } = await views.snapshot(context(req).scope);
    await success(req, res, 200, data, version);
  });

  router.get('/events', async (req, res) => {
    const { cursor, limit = 50, afterSequence } = queryFor('listEvents', numericQuery(req));
    const { scope } = context(req);
    if (cursor && afterSequence !== undefined) throw invalid('Use cursor or afterSequence, not both');
    const after = cursor ? cursors.open(scope, 'events', cursor) : afterSequence ?? 0;
    if (typeof after !== 'number') throw invalid('Invalid event cursor');
    const { items, version, next } = await views.events(scope, after, limit);
    await success(req, res, 200, { items, ...(next !== undefined && { nextCursor: cursors.seal(scope, 'events', next) }) }, version);
  });

  router.get('/stream', async (req, res) => {
    const { claims, scope, requestId } = context(req);
    await serveRuntimeStream(res, {
      scope, expiresAt: claims.expiresAt, lastEventId: req.header('Last-Event-ID'),
      store, cursors, views, now, meta: (version) => metadata(requestId, now(), version),
      heartbeatMs: options.heartbeatMs, pollMs: options.pollMs,
    });
  });

  router.get('/backup/export', async (req, res) => {
    const backup = await backups.export(context(req).scope);
    await success(req, res, 200, backup);
  });

  router.post('/backup/restore', async (req, res) => {
    const body = bodyFor('restoreBackup', req.body);
    const restored = await backups.restore(context(req).scope, body, writeKey(req, 'restoreBackup', '/backup/restore', body));
    await success(req, res, 200, restored);
  });

  router.post('/tasks', async (req, res) => {
    const { scope } = context(req);
    const body = bodyFor('createTask', req.body);
    const task = await gateway.submit(scope, body.request, body.expectedConsentVersion, writeKey(req, 'createTask', '/tasks', body));
    await success(req, res, 202, task);
    tasks.kick(scope);
  });

  router.get('/tasks', async (req, res) => {
    const { scope } = context(req);
    const { status, cursor, limit = 50 } = queryFor('listTasks', numericQuery(req));
    const purpose = 'task-page:' + (status ?? '');
    const after = cursor ? cursors.open(scope, purpose, cursor) : '';
    if (typeof after !== 'string') throw invalid('Invalid task cursor');
    const { items, next, version } = await gateway.list(scope, after, limit, status);
    await success(req, res, 200, { items, ...(next && { nextCursor: cursors.seal(scope, purpose, next) }) }, version);
  });

  router.post('/tasks/:taskId/approve', async (req, res) => {
    const { scope } = context(req);
    const { taskId } = paramsFor('approveTask', req.params);
    const body = bodyFor('approveTask', req.body);
    const task = await gateway.approve(scope, taskId, body.expectedConsentVersion, writeKey(req, 'approveTask', '/tasks/' + taskId + '/approve', body));
    await success(req, res, 200, task);
    tasks.kick(scope);
  });

  router.post('/tasks/:taskId/cancel', async (req, res) => {
    const { scope } = context(req);
    const { taskId } = paramsFor('cancelTask', req.params);
    const body = bodyFor('cancelTask', req.body);
    const task = await gateway.cancel(scope, taskId, body.expectedConsentVersion, writeKey(req, 'cancelTask', '/tasks/' + taskId + '/cancel', body));
    await success(req, res, 200, task);
    tasks.kick(scope);
  });

  router.get('/orchestrator/ledger', async (req, res) => {
    const { scope } = context(req);
    const { taskId, goalId, cursor, limit = 50 } = queryFor('listAccountabilityEntries', numericQuery(req));
    const purpose = 'accountability:' + JSON.stringify([taskId ?? null, goalId ?? null]);
    const after = cursor ? cursors.open(scope, purpose, cursor) : ['', 0];
    if (!Array.isArray(after) || typeof after[0] !== 'string' || typeof after[1] !== 'number') throw invalid('Invalid accountability cursor');
    const { items, next, version } = await gateway.ledger(scope, { taskId: after[0], sequence: after[1] }, limit, taskId, goalId);
    await success(req, res, 200, { items, ...(next && { nextCursor: cursors.seal(scope, purpose, [next.taskId, next.sequence]) }) }, version);
  });

  router.use(() => { throw new DaoError(404, 'NOT_FOUND', 'DAO operation is not available at this milestone'); });
  const errors: ErrorRequestHandler = async (error: unknown, req, res, next) => {
    if (res.headersSent) { next(error); return; }
    const current = contexts.get(req);
    let consentVersion = 0;
    if (current) {
      try { consentVersion = await store.read(current.scope, (tx) => tx.getConsentVersion()); } catch { /* DB unavailable */ }
    }
    const issue = error instanceof DaoError ? error
      : error instanceof SyntaxError || (error && typeof error === 'object' && 'status' in error && error.status === 413)
        ? invalid('Malformed or oversized JSON body')
        : new DaoError(500, 'INTERNAL_ERROR', 'DAO operation failed');
    const payload: ApiEnvelope<never> = {
      ok: false,
      error: { code: issue.code, message: issue.message, retryable: issue.retryable, ...(issue.details && { details: issue.details }) },
      meta: metadata(current?.requestId ?? (res.locals.requestId as string | undefined) ?? randomUUID(), now(), consentVersion),
    };
    if (issue.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="dao"');
    res.status(issue.status).json(payload);
  };
  router.use(errors);
  return { router, store, runtime, tasks, close: async () => { await tasks.close(); await memoryWorker.close(); await store.close(); } };
}

export function daoMount(env: NodeJS.ProcessEnv) {
  if (env.DAO_SESSION_SECRET && env.DAO_OWNER_ID) {
    try {
      return createDaoRouter({
        secret: env.DAO_SESSION_SECRET, ownerId: env.DAO_OWNER_ID,
        directory: privateDatabaseDirectory(env.DAO_DB_DIR || join(homedir(), '.emotion-ai', 'dao')),
      }).router;
    } catch {
      process.stderr.write('DAO V3.1 configuration is invalid; legacy API remains available\n');
    }
  }
  return express.Router().use((_req, res) => {
    const payload: ApiEnvelope<never> = {
      ok: false, error: { code: 'UNAVAILABLE', message: 'Configure the DAO server session key and owner', retryable: false },
      meta: metadata(randomUUID(), Date.now(), 0),
    };
    res.setHeader('Cache-Control', 'no-store').status(503).json(payload);
  });
}

function privateDatabaseDirectory(configured: string): string {
  const location = resolve(configured);
  let parent = location;
  while (!existsSync(parent)) parent = dirname(parent);
  const canonical = resolve(realpathSync(parent), relative(parent, location));
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const fromRoot = relative(root, canonical);
  if (!fromRoot || (!isAbsolute(fromRoot) && fromRoot.split(/[\\/]/)[0] !== '..')) {
    throw new Error('DAO_DB_DIR must be outside the app checkout and static file roots');
  }
  return canonical;
}

export { DAO_API_PREFIX };
