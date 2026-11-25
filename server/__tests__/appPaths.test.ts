import { describe, expect, it } from 'vitest';
import { resolveAppResource, resolveAppRoot, resolveMemoriesDir, resolveMemoryPath, resolveWebDistDir } from '../appPaths.js';

describe('application data and resource paths', () => {
  it('uses MEMORIES_DIR for all persistent app data', () => {
    const env = { MEMORIES_DIR: 'D:/AI Girlfriend/data' } as NodeJS.ProcessEnv;

    expect(resolveMemoriesDir(env, 'C:/worktree')).toBe('D:\\AI Girlfriend\\data');
    expect(resolveMemoryPath('screens/screen-1.jpg', env, 'C:/worktree'))
      .toBe('D:\\AI Girlfriend\\data\\screens\\screen-1.jpg');
  });

  it('keeps development defaults anchored to the repository working directory', () => {
    expect(resolveMemoriesDir({} as NodeJS.ProcessEnv, 'C:/worktree')).toBe('C:\\worktree\\memories');
    expect(resolveWebDistDir({} as NodeJS.ProcessEnv, 'C:/worktree')).toBe('C:\\worktree\\dist');
  });

  it('allows the built frontend directory to be set independently', () => {
    const env = { WEB_DIST_DIR: 'D:/AI Girlfriend/resources/web' } as NodeJS.ProcessEnv;

    expect(resolveWebDistDir(env, 'C:/worktree')).toBe('D:\\AI Girlfriend\\resources\\web');
  });

  it('anchors immutable resources to APP_ROOT instead of the process working directory', () => {
    const env = { APP_ROOT: 'D:/portable/AI Girlfriend' } as NodeJS.ProcessEnv;

    expect(resolveAppRoot(env, 'C:/Users/test')).toBe('D:\\portable\\AI Girlfriend');
    expect(resolveAppResource('scripts/ocr-image.ps1', env, 'C:/Users/test'))
      .toBe('D:\\portable\\AI Girlfriend\\scripts\\ocr-image.ps1');
    expect(resolveWebDistDir(env, 'C:/Users/test')).toBe('D:\\portable\\AI Girlfriend\\dist');
  });
});
