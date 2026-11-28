import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaoScope } from '../contracts/dao-v31/index.ts';

export const scope: DaoScope = {
  ownerId: 'owner-test', env: 'prod', characterId: 'character-test', sessionId: 'session-test',
};
export const secret = 'a'.repeat(64);

export function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'dao-m1-'));
  return { directory, remove: () => rmSync(directory, { recursive: true, force: true }) };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { resolve, promise };
}
