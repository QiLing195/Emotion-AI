import { mkdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';
import { DAO_PROJECTION_VERSION } from '../contracts/dao-v31/index.ts';
import type {
  AgentAccountabilityLedger, CommitRecord, DaoEnv, DaoOperationId, DaoScope, DataConsent,
  IdempotencyResult, ProjectionCheckpoint, ProvenanceRecord, SystemEvent, TaskRecord,
} from '../contracts/dao-v31/index.ts';
import type {
  ConsentedEntity, DataLayer, HistoryEntry, M1PersistencePort, M1ReadTransaction,
  M1WriteTransaction, RuntimeNotification, RuntimeRecord, Tombstone,
} from './m1Types.ts';
import { conflict, DaoError } from './errors.ts';
import { sameScope } from './sessionAuth.ts';
import { openDatabase, scopeColumns, SQLITE_SCHEMA_VERSION } from './sqliteSchema.ts';
import { grantKey } from './m1Types.ts';

const filter = 'owner_id = ? AND env = ? AND character_id = ? AND session_id = ?';
const scopeValues = (scope: DaoScope) => [scope.ownerId, scope.env, scope.characterId, scope.sessionId] as const;
const parse = <T,>(value: SQLOutputValue): T => JSON.parse(String(value)) as T;
const queues = new Map<string, Promise<unknown>>();

function serial<T>(path: string, work: () => Promise<T> | T): Promise<T> {
  const result = (queues.get(path) ?? Promise.resolve()).then(work, work);
  queues.set(path, result);
  const release = () => { if (queues.get(path) === result) queues.delete(path); };
  void result.then(release, release);
  return result;
}

class ScopedTransaction implements M1WriteTransaction {
  readonly scope: DaoScope;
  readonly #db: DatabaseSync;
  readonly #keys: ReturnType<typeof scopeValues>;
  readonly #writable: boolean;
  #active = true;

  constructor(db: DatabaseSync, scope: DaoScope, writable: boolean) {
    this.#db = db;
    this.scope = scope;
    this.#keys = scopeValues(scope);
    this.#writable = writable;
  }

  finish() { this.#active = false; }

  #statement(sql: string) {
    if (!this.#active) throw new Error('The DAO transaction has ended');
    return this.#db.prepare(sql);
  }

  #rows(sql: string, ...values: SQLInputValue[]) {
    return this.#statement(sql).all(...this.#keys, ...values);
  }

  #one(sql: string, ...values: SQLInputValue[]) {
    return this.#statement(sql).get(...this.#keys, ...values);
  }

  #oneBody<T>(sql: string, ...values: SQLInputValue[]): T | null {
    const result = this.#one(sql, ...values);
    return result ? parse<T>(result.body) : null;
  }

  #bodies<T>(sql: string, ...values: SQLInputValue[]): readonly T[] {
    return this.#rows(sql, ...values).map((row) => parse<T>(row.body));
  }

  #run(sql: string, ...values: SQLInputValue[]) {
    return this.#writeStatement(sql).run(...this.#keys, ...values);
  }

  #writeStatement(sql: string) {
    if (!this.#writable) throw new Error('DAO read transactions cannot modify data');
    return this.#statement(sql);
  }

  #verify(scope: DaoScope) {
    if (!sameScope(this.scope, scope)) throw new DaoError(403, 'SCOPE_MISMATCH', 'Repository scope mismatch');
  }

  async getConsentVersion() {
    return Number(this.#one(`SELECT consent_version FROM scopes WHERE ${filter}`)?.consent_version ?? 0);
  }

  async listConsents() {
    return this.#bodies<DataConsent>(`SELECT body FROM consents WHERE ${filter} ORDER BY grant_key`);
  }

  async updateConsent(expectedVersion: number, consent: DataConsent) {
    this.#verify(consent.scope);
    if (consent.consentVersion !== expectedVersion + 1
      || this.#writeStatement(`UPDATE scopes SET consent_version = ? WHERE ${filter} AND consent_version = ?`)
        .run(consent.consentVersion, ...this.#keys, expectedVersion).changes !== 1) {
      throw new DaoError(409, 'CONSENT_VERSION_MISMATCH', 'Consent version changed');
    }
    this.#run(`INSERT INTO consents (${scopeColumns}, grant_key, body) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (${scopeColumns}, grant_key) DO UPDATE SET body = excluded.body`,
    grantKey(consent), JSON.stringify(consent));
  }

  runtime() {
    const record = this.#one(`SELECT runtime FROM scopes WHERE ${filter}`)?.runtime;
    return record ? parse<RuntimeRecord>(record) : null;
  }

  setRuntime(record: RuntimeRecord) {
    this.#writeStatement(`UPDATE scopes SET runtime = ? WHERE ${filter}`).run(JSON.stringify(record), ...this.#keys);
  }

  async getEvent(eventId: string) {
    return this.#oneBody<SystemEvent>(`SELECT body FROM events WHERE ${filter} AND event_id = ?`, eventId);
  }

  async listEvents(afterSequence: number, limit: number) {
    return this.#bodies<SystemEvent>(`SELECT body FROM events WHERE ${filter} AND sequence > ? ORDER BY sequence LIMIT ?`, afterSequence, limit);
  }

  async appendEvent(event: SystemEvent) {
    this.#verify(event.scope);
    this.#run(`INSERT INTO events (${scopeColumns}, event_id, sequence, body) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.eventId, event.sequence, JSON.stringify(event));
  }

  setEventFingerprint(eventId: string, fingerprint: string) {
    const write = this.#writeStatement(`UPDATE events SET fingerprint = ? WHERE ${filter} AND event_id = ? AND fingerprint = ''`);
    if (write.run(fingerprint, ...this.#keys, eventId).changes !== 1) throw conflict('Event fingerprint is immutable after assignment');
  }

  async getCommit(eventId: string, projectionVersion: string) {
    return this.#oneBody<CommitRecord>(`SELECT body FROM commits WHERE ${filter} AND event_id = ? AND projection_version = ?`, eventId, projectionVersion);
  }

  async appendCommit(commit: CommitRecord) {
    this.#verify(commit.scope);
    this.#run(`INSERT INTO commits (${scopeColumns}, event_id, projection_version, body) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      commit.eventId, commit.projectionVersion, JSON.stringify(commit));
  }

  history(after: number, limit: number) {
    return this.#rows(`
      SELECT events.body AS event, commits.body AS commit_body, events.fingerprint FROM events
      JOIN commits USING (${scopeColumns}, event_id)
      WHERE ${filter} AND events.sequence > ? AND commits.projection_version = ?
      ORDER BY events.sequence LIMIT ?
    `, after, DAO_PROJECTION_VERSION, limit).map((row): HistoryEntry => ({
      event: parse<SystemEvent>(row.event),
      commit: parse<CommitRecord>(row.commit_body),
      fingerprint: String(row.fingerprint),
    }));
  }

  async getLatestCheckpoint(projectionVersion: string, atOrBefore: number) {
    return this.#oneBody<ProjectionCheckpoint>(`SELECT body FROM checkpoints
      WHERE ${filter} AND projection_version = ? AND sequence <= ? ORDER BY sequence DESC LIMIT 1`,
    projectionVersion, atOrBefore);
  }

  async saveCheckpoint(checkpoint: ProjectionCheckpoint) {
    this.#verify(checkpoint.scope);
    this.#run(`INSERT INTO checkpoints (${scopeColumns}, projection_version, sequence, body) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      checkpoint.projectionVersion, checkpoint.sequence, JSON.stringify(checkpoint));
  }

  entity(entityId: string) {
    return this.#oneBody<ConsentedEntity>(`SELECT body FROM entities WHERE ${filter} AND entity_id = ?`, entityId);
  }

  entities(layer?: DataLayer) {
    if (layer) return this.#bodies<ConsentedEntity>(`SELECT body FROM entities WHERE ${filter} AND layer = ? ORDER BY sequence, entity_id`, layer);
    return this.#bodies<ConsentedEntity>(`SELECT body FROM entities WHERE ${filter} ORDER BY sequence, entity_id`);
  }

  insertEntity(entity: ConsentedEntity) {
    if (this.tombstone(entity.ref.entityId)) throw conflict('Entity was permanently deleted');
    this.#run(`INSERT INTO entities (${scopeColumns}, entity_id, layer, sequence, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entity.ref.entityId, entity.layer, entity.sequence, JSON.stringify(entity));
    if (entity.layer === 'memory' && typeof entity.body.summary === 'string') {
      this.#writeStatement('INSERT INTO memory_search (scope_id, entity_id, content) VALUES (?, ?, ?)')
        .run(JSON.stringify(this.#keys), entity.ref.entityId, entity.body.summary);
    }
  }

  searchMemory(terms: string, limit: number) {
    const match = '"' + terms.replaceAll('"', '""') + '"';
    return this.#statement(`SELECT entity_id FROM memory_search
      WHERE scope_id = ? AND memory_search MATCH ? ORDER BY bm25(memory_search), entity_id LIMIT ?`)
      .all(JSON.stringify(this.#keys), match, limit)
      .flatMap((row) => {
        const found = this.entity(String(row.entity_id));
        return found ? [found] : [];
      });
  }

  descendants(entityId: string) {
    return this.#statement(`
      WITH RECURSIVE reachable(entity_id) AS (
        VALUES (?)
        UNION
        SELECT child_id FROM provenance_edges JOIN reachable ON parent_id = reachable.entity_id
        WHERE ${filter}
      )
      SELECT entity_id FROM reachable ORDER BY entity_id
    `).all(entityId, ...this.#keys).map((row) => String(row.entity_id));
  }

  tombstone(entityId: string) {
    return this.#oneBody<Tombstone>(`SELECT body FROM tombstones WHERE ${filter} AND entity_id = ?`, entityId);
  }

  tombstones() {
    return this.#bodies<Tombstone>(`SELECT body FROM tombstones WHERE ${filter} ORDER BY entity_id`);
  }

  removeEntities(tombstones: readonly Tombstone[]) {
    for (const marker of tombstones) {
      const id = marker.ref.entityId;
      this.#run(`INSERT INTO tombstones (${scopeColumns}, entity_id, body) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (${scopeColumns}, entity_id) DO NOTHING`, id, JSON.stringify(marker));
      this.#writeStatement('DELETE FROM memory_search WHERE scope_id = ? AND entity_id = ?').run(JSON.stringify(this.#keys), id);
      this.#run(`DELETE FROM entities WHERE ${filter} AND entity_id = ?`, id);
    }
  }

  async getProvenance(entityId: string) {
    return this.#bodies<ProvenanceRecord>(`SELECT body FROM provenance WHERE ${filter} AND entity_id = ? ORDER BY record_id`, entityId);
  }

  lineage() {
    return this.#bodies<ProvenanceRecord>(`SELECT body FROM provenance WHERE ${filter} ORDER BY record_id`);
  }

  async appendProvenance(record: ProvenanceRecord) {
    this.#verify(record.scope);
    const child = record.entity.entityId;
    if (this.entity(child)?.ref.kind !== record.entity.kind) throw conflict('The provenance entity is unavailable');
    const descendants = new Set(this.descendants(child));
    for (const upstream of record.upstream) {
      if (descendants.has(upstream.entityId) || this.entity(upstream.entityId)?.ref.kind !== upstream.kind) {
        throw conflict('Provenance requires available acyclic dependencies');
      }
    }
    this.#run(`INSERT INTO provenance (${scopeColumns}, record_id, entity_id, body) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      record.recordId, child, JSON.stringify(record));
    for (const parent of record.upstream) {
      this.#run(`INSERT INTO provenance_edges (${scopeColumns}, record_id, parent_id, child_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.recordId, parent.entityId, child);
    }
  }

  async getTask(taskId: string) {
    return this.#oneBody<TaskRecord>(`SELECT body FROM task_records WHERE ${filter} AND task_id = ?`, taskId);
  }

  async saveTask(task: TaskRecord) {
    this.#verify(task.contract.scope);
    this.#run(`INSERT INTO task_records (${scopeColumns}, task_id, body) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (${scopeColumns}, task_id) DO UPDATE SET body = excluded.body`,
    task.contract.taskId, JSON.stringify(task));
  }

  async getAccountabilityEntries(taskId: string) {
    return this.#bodies<AgentAccountabilityLedger>(`SELECT body FROM accountability WHERE ${filter} AND task_id = ? ORDER BY sequence`, taskId);
  }

  async appendAccountabilityEntry(entry: AgentAccountabilityLedger) {
    this.#verify(entry.scope);
    this.#run(`INSERT INTO accountability (${scopeColumns}, entry_id, task_id, sequence, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.entryId, entry.taskId, entry.sequence, JSON.stringify(entry));
  }

  enqueue(notification: RuntimeNotification) {
    this.#run(`INSERT INTO outbox (${scopeColumns}, body) VALUES (?, ?, ?, ?, ?)`, JSON.stringify(notification));
  }

  outbox(after: number, limit: number) {
    return this.#rows(`SELECT id, body FROM outbox WHERE ${filter} AND id > ? ORDER BY id LIMIT ?`, after, limit)
      .map((row) => ({ id: Number(row.id), notification: parse<RuntimeNotification>(row.body) }));
  }

  hasOutbox(id: number) {
    return Boolean(this.#one(`SELECT id FROM outbox WHERE ${filter} AND id = ?`, id));
  }

  latestOutbox() {
    return Number(this.#one(`SELECT MAX(id) AS id FROM outbox WHERE ${filter}`)?.id ?? 0);
  }

  async getIdempotencyResult(operationId: DaoOperationId, resourcePath: string, key: string) {
    return this.#oneBody<IdempotencyResult>(`SELECT body FROM idempotency
      WHERE ${filter} AND operation_id = ? AND resource_path = ? AND idempotency_key = ?`, operationId, resourcePath, key);
  }

  async saveIdempotencyResult(operationId: DaoOperationId, resourcePath: string, key: string, result: IdempotencyResult) {
    this.#run(`INSERT INTO idempotency (${scopeColumns}, operation_id, resource_path, idempotency_key, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, operationId, resourcePath, key, JSON.stringify(result));
  }

  keepBackup(sha256: string, stateVersion: number, createdAt: string) {
    this.#run(`INSERT INTO backups (${scopeColumns}, sha256, state_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (${scopeColumns}, sha256) DO NOTHING`, sha256, stateVersion, createdAt);
  }
}

export class SqliteDaoStore implements M1PersistencePort {
  readonly #directory: string;
  readonly #connections = new Map<DaoEnv, DatabaseSync>();
  #closed = false;

  constructor(directory: string) {
    const location = resolve(directory);
    mkdirSync(location, { recursive: true, mode: 0o700 });
    this.#directory = realpathSync(location);
  }

  #path(env: DaoEnv) {
    if (env !== 'prod' && env !== 'exp') throw new Error('Invalid SQLite environment');
    return join(this.#directory, `dao-${env}.sqlite`);
  }

  #connection(env: DaoEnv) {
    if (this.#closed) throw new Error('DAO persistence is closed');
    const existing = this.#connections.get(env);
    if (existing) return existing;
    const db = openDatabase(this.#path(env));
    this.#connections.set(env, db);
    return db;
  }

  #access<T>(scope: DaoScope, write: boolean, operation: (tx: ScopedTransaction) => Promise<T> | T): Promise<T> {
    return serial(this.#path(scope.env), async () => {
      const db = this.#connection(scope.env);
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      const tx = new ScopedTransaction(db, { ...scope }, write);
      try {
        if (write) db.prepare(`INSERT INTO scopes (${scopeColumns}) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`)
          .run(...scopeValues(scope));
        const result = await operation(tx);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        tx.finish();
      }
    });
  }

  read<T>(scope: DaoScope, operation: (tx: M1ReadTransaction) => Promise<T> | T) {
    return this.#access(scope, false, operation);
  }

  write<T>(scope: DaoScope, operation: (tx: M1WriteTransaction) => Promise<T> | T) {
    return this.#access(scope, true, operation);
  }

  health(env: DaoEnv) {
    return serial(this.#path(env), () => {
      const db = this.#connection(env);
      const journalMode = db.prepare('PRAGMA journal_mode').get()?.journal_mode;
      const foreignKeys = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
      const busyTimeoutMs = Number(db.prepare('PRAGMA busy_timeout').get()?.timeout);
      const schemaVersion = Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version);
      const fts5 = Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'memory_search'").get());
      if (journalMode !== 'wal' || foreignKeys !== 1 || schemaVersion !== SQLITE_SCHEMA_VERSION) {
        throw new DaoError(503, 'UNAVAILABLE', 'SQLite is not ready', undefined, true);
      }
      return { journalMode: 'wal' as const, foreignKeys: true as const, busyTimeoutMs, schemaVersion, fts5 };
    });
  }

  async close() {
    await Promise.all((['prod', 'exp'] as const).map((env) => serial(this.#path(env), () => {
      this.#connections.get(env)?.close();
      this.#connections.delete(env);
    })));
    this.#closed = true;
  }
}
