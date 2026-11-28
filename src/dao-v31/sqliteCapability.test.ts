import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('M0 Node 22 persistence feasibility', () => {
  it('opens a disk-backed WAL database with FTS5, foreign keys and transactional rollback', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dao-m0-sqlite-'));
    const file = join(directory, 'capability.sqlite');
    try {
      const writer = new DatabaseSync(file);
      try {
        writer.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA foreign_keys = ON;
          PRAGMA busy_timeout = 5000;
          CREATE TABLE sources (id INTEGER PRIMARY KEY);
          CREATE TABLE observations (id INTEGER PRIMARY KEY, source INTEGER REFERENCES sources(id));
          CREATE VIRTUAL TABLE search USING fts5(summary);
        `);
        expect(writer.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
        expect(writer.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
        expect(writer.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(5000);
        expect(() => writer.exec('INSERT INTO observations VALUES (1, 2)')).toThrow('FOREIGN KEY');

        const reader = new DatabaseSync(file, { readOnly: true });
        const search = () => reader.prepare('SELECT summary FROM search WHERE search MATCH ? ORDER BY bm25(search)').all('marker');
        try {
          writer.exec("BEGIN IMMEDIATE; INSERT INTO search VALUES ('persisted marker');");
          expect(search()).toEqual([]);
          writer.exec('COMMIT');
          expect(search().map((row) => row.summary)).toEqual(['persisted marker']);
          writer.exec("BEGIN IMMEDIATE; INSERT INTO search VALUES ('rolled back marker'); ROLLBACK;");
          expect(search().map((row) => row.summary)).toEqual(['persisted marker']);
        } finally {
          reader.close();
        }
      } finally {
        writer.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
