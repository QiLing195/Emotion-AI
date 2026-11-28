import { DatabaseSync } from 'node:sqlite';

export const scopeColumns = 'owner_id, env, character_id, session_id';
const scopeDefinition = `
  owner_id TEXT NOT NULL,
  env TEXT NOT NULL CHECK(env IN ('prod', 'exp')),
  character_id TEXT NOT NULL,
  session_id TEXT NOT NULL
`;
const scoped = (body: string) => `
  ${scopeDefinition}, ${body},
  FOREIGN KEY (${scopeColumns}) REFERENCES scopes (${scopeColumns})
`;

export const SQLITE_SCHEMA_VERSION = 1;
export const BUSY_TIMEOUT = 5000;

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = ${BUSY_TIMEOUT};
      PRAGMA auto_vacuum = INCREMENTAL;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
    `);
    const version = Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version ?? 0);
    if (version > SQLITE_SCHEMA_VERSION) throw new Error('SQLite schema is newer than this DAO release');
    if (version === 0) {
      db.exec(`
        CREATE TABLE scopes (
          ${scopeDefinition},
          consent_version INTEGER NOT NULL DEFAULT 0,
          runtime TEXT,
          PRIMARY KEY (${scopeColumns})
        );
        CREATE TABLE consents (${scoped(`
          grant_key TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, grant_key)
        `)});
        CREATE TABLE events (${scoped(`
          event_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
          fingerprint TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (${scopeColumns}, event_id),
          UNIQUE (${scopeColumns}, sequence)
        `)});
        CREATE TABLE commits (${scoped(`
          event_id TEXT NOT NULL, projection_version TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, event_id, projection_version),
          FOREIGN KEY (${scopeColumns}, event_id) REFERENCES events (${scopeColumns}, event_id)
        `)});
        CREATE TABLE checkpoints (${scoped(`
          sequence INTEGER NOT NULL, projection_version TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, projection_version, sequence),
          FOREIGN KEY (${scopeColumns}, sequence) REFERENCES events (${scopeColumns}, sequence)
        `)});
        CREATE TABLE entities (${scoped(`
          entity_id TEXT NOT NULL, layer TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, entity_id),
          FOREIGN KEY (${scopeColumns}, sequence) REFERENCES events (${scopeColumns}, sequence)
        `)});
        CREATE INDEX entities_layer ON entities (${scopeColumns}, layer, sequence, entity_id);
        CREATE TABLE provenance (${scoped(`
          record_id TEXT NOT NULL, entity_id TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, record_id),
          FOREIGN KEY (${scopeColumns}, entity_id) REFERENCES entities (${scopeColumns}, entity_id) ON DELETE CASCADE
        `)});
        CREATE INDEX provenance_entity ON provenance (${scopeColumns}, entity_id);
        CREATE TABLE provenance_edges (${scoped(`
          record_id TEXT NOT NULL, parent_id TEXT NOT NULL, child_id TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, record_id, parent_id),
          FOREIGN KEY (${scopeColumns}, record_id) REFERENCES provenance (${scopeColumns}, record_id) ON DELETE CASCADE,
          FOREIGN KEY (${scopeColumns}, parent_id) REFERENCES entities (${scopeColumns}, entity_id) ON DELETE CASCADE,
          FOREIGN KEY (${scopeColumns}, child_id) REFERENCES entities (${scopeColumns}, entity_id) ON DELETE CASCADE
        `)});
        CREATE INDEX provenance_parents ON provenance_edges (${scopeColumns}, parent_id);
        CREATE TABLE tombstones (${scoped(`
          entity_id TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, entity_id)
        `)});
        CREATE TABLE task_records (${scoped(`
          task_id TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, task_id)
        `)});
        CREATE TABLE accountability (${scoped(`
          entry_id TEXT NOT NULL, task_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, entry_id),
          UNIQUE (${scopeColumns}, task_id, sequence),
          FOREIGN KEY (${scopeColumns}, task_id) REFERENCES task_records (${scopeColumns}, task_id)
        `)});
        CREATE TABLE idempotency (${scoped(`
          operation_id TEXT NOT NULL, resource_path TEXT NOT NULL, idempotency_key TEXT NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, operation_id, resource_path, idempotency_key)
        `)});
        CREATE TABLE outbox (${scoped(`
          id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL
        `)});
        CREATE INDEX outbox_scope ON outbox (${scopeColumns}, id);
        CREATE TABLE backups (${scoped(`
          sha256 TEXT NOT NULL, state_version INTEGER NOT NULL, created_at TEXT NOT NULL,
          PRIMARY KEY (${scopeColumns}, sha256)
        `)});
        CREATE VIRTUAL TABLE memory_search USING fts5(
          scope_id UNINDEXED, entity_id UNINDEXED, content, tokenize = 'trigram'
        );
        INSERT INTO memory_search(memory_search, rank) VALUES ('secure-delete', 1);
        INSERT INTO schema_migrations VALUES (1);
      `);
    }
    db.exec('COMMIT');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
