import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { installConsolePipeGuards } = require('../consolePipeGuard.cjs') as {
  installConsolePipeGuards: (stdout: EventEmitter, stderr: EventEmitter) => () => void;
};

describe('console pipe guards', () => {
  it('handles EPIPE on stdout and stderr so detached console pipes cannot crash main', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const uninstall = installConsolePipeGuards(stdout, stderr);

    expect(() => stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow();
    expect(() => stderr.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow();

    uninstall();
  });

  it('does not suppress other stream errors', () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const uninstall = installConsolePipeGuards(stdout, stderr);
    const diskError = Object.assign(new Error('disk failure'), { code: 'EIO' });

    expect(() => stdout.emit('error', diskError)).toThrow(diskError);
    uninstall();
  });
});
