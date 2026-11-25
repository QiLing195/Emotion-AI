import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executePendingDesktopAction,
  readDesktopEvents,
  resetDesktopRootsCacheForTests,
  setPendingDesktopAction,
} from '../desktopItems.js';

let tempRoot = '';
let originalCwd = '';
let previousMemoryDir: string | undefined;
let previousOneDrive: string | undefined;
let dataDir = '';
let source = '';
let target = '';

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'desktop-event-test-'));
  originalCwd = process.cwd();
  previousMemoryDir = process.env.MEMORIES_DIR;
  previousOneDrive = process.env.OneDrive;
  const workDir = join(tempRoot, 'work');
  dataDir = join(tempRoot, 'portable-data');
  const desktop = join(tempRoot, 'OneDrive', 'Desktop');
  source = join(desktop, 'note.txt');
  target = join(desktop, 'Archive', 'note.txt');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(desktop, 'Archive'), { recursive: true });
  writeFileSync(source, 'fixture');
  process.env.MEMORIES_DIR = dataDir;
  process.env.OneDrive = join(tempRoot, 'OneDrive');
  process.chdir(workDir);
  resetDesktopRootsCacheForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  resetDesktopRootsCacheForTests();
  if (previousMemoryDir === undefined) delete process.env.MEMORIES_DIR;
  else process.env.MEMORIES_DIR = previousMemoryDir;
  if (previousOneDrive === undefined) delete process.env.OneDrive;
  else process.env.OneDrive = previousOneDrive;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe('desktop action event persistence', () => {
  it('writes move history under the configured writable data directory', () => {
    setPendingDesktopAction({ kind: 'move', path: source, name: 'note.txt', targetPath: target, targetName: 'Archive' });

    expect(executePendingDesktopAction().ok).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(readDesktopEvents()).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dataDir, 'desktop_events.jsonl'), 'utf8').trim())).toMatchObject({
      kind: 'move',
      name: 'note.txt',
      to: 'Archive',
    });
  });
});
