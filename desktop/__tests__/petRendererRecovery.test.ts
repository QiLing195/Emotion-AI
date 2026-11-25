import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { PetRendererRecovery } = require('../petRendererRecovery.cjs') as {
  PetRendererRecovery: new (deps: {
    getWebContents: () => { isDestroyed: () => boolean; reload: () => void } | null;
    now?: () => number;
    schedule?: (callback: () => void, delayMs: number) => unknown;
    log?: (message: string) => void;
    maxRetries?: number;
    windowMs?: number;
    reloadDelayMs?: number;
  }) => { recover: (details: { reason?: string }) => boolean; manualReload: () => boolean };
};

describe('pet renderer recovery policy', () => {
  it('reloads a crashed renderer after a short delay', () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    let reloads = 0;
    const contents = { isDestroyed: () => false, reload: () => { reloads += 1; } };
    const recovery = new PetRendererRecovery({
      getWebContents: () => contents,
      schedule: (callback, delay) => { callbacks.push(callback); delays.push(delay); },
      reloadDelayMs: 250,
    });

    expect(recovery.recover({ reason: 'killed' })).toBe(true);
    expect(reloads).toBe(0);
    expect(delays).toEqual([250]);
    callbacks[0]();
    expect(reloads).toBe(1);
  });

  it('skips clean exits and limits repeated reloads within the retry window', () => {
    let now = 10_000;
    let scheduled = 0;
    const logs: string[] = [];
    const recovery = new PetRendererRecovery({
      getWebContents: () => ({ isDestroyed: () => false, reload: () => undefined }),
      now: () => now,
      schedule: () => { scheduled += 1; },
      log: (message) => logs.push(message),
      maxRetries: 2,
      windowMs: 60_000,
    });

    expect(recovery.recover({ reason: 'clean-exit' })).toBe(false);
    expect(recovery.recover({ reason: 'crashed' })).toBe(true);
    expect(recovery.recover({ reason: 'killed' })).toBe(true);
    expect(recovery.recover({ reason: 'oom' })).toBe(false);
    expect(scheduled).toBe(2);
    expect(logs).toHaveLength(3);
    expect(logs[2]).toContain('暂停自动重载');

    now += 60_001;
    expect(recovery.recover({ reason: 'crashed' })).toBe(true);
    expect(scheduled).toBe(3);
  });

  it('does not reload a webContents that was destroyed before the retry fires', () => {
    let alive = true;
    let reloads = 0;
    let scheduled: (() => void) | undefined;
    const recovery = new PetRendererRecovery({
      getWebContents: () => alive ? { isDestroyed: () => false, reload: () => { reloads += 1; } } : null,
      schedule: (callback) => { scheduled = callback; },
    });

    expect(recovery.recover({ reason: 'crashed' })).toBe(true);
    alive = false;
    scheduled?.();
    expect(reloads).toBe(0);
  });

  it('lets a manual reload bypass the retry cap and clears the automatic retry budget', () => {
    let reloads = 0;
    let scheduled = 0;
    const logs: string[] = [];
    const recovery = new PetRendererRecovery({
      getWebContents: () => ({ isDestroyed: () => false, reload: () => { reloads += 1; } }),
      schedule: () => { scheduled += 1; },
      log: (message) => logs.push(message),
      maxRetries: 1,
    });

    expect(recovery.recover({ reason: 'crashed' })).toBe(true);
    expect(recovery.recover({ reason: 'crashed' })).toBe(false);
    expect(recovery.manualReload()).toBe(true);
    expect(reloads).toBe(1);
    expect(recovery.recover({ reason: 'crashed' })).toBe(true);
    expect(scheduled).toBe(2);
    expect(logs).toContain('[Pet] renderer 自动重载计数已由用户重置');
  });
});
