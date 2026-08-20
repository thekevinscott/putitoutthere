import { describe, expect, it } from 'vitest';
import { ExecError } from './exec-error.js';

describe('ExecError', () => {
  it('carries stdout, stderr, and status', () => {
    const err = new ExecError('boom', 'out', 'err', 3);
    expect(err.message).toBe('boom');
    expect(err.stdout).toBe('out');
    expect(err.stderr).toBe('err');
    expect(err.status).toBe(3);
    expect(err.name).toBe('ExecError');
    expect(err).toBeInstanceOf(Error);
  });

  it('allows a null status and a cause', () => {
    const cause = new Error('spawn ENOENT');
    const err = new ExecError('failed to spawn', '', '', null, { cause });
    expect(err.status).toBeNull();
    expect(err.cause).toBe(cause);
  });

  it('carries the argv the seam recorded', () => {
    // #617: the failure dump reads this to report what actually ran. The
    // message a handler wraps this error in never holds the argv.
    const err = new ExecError('Command failed', '', '', 1, {
      command: ['npm', 'publish', '--access=public'],
    });
    expect(err.command).toEqual(['npm', 'publish', '--access=public']);
  });

  it('defaults command to empty when the seam did not record one', () => {
    // Every pre-#617 call site omits it; those must not produce
    // `undefined.join(...)` in the renderer.
    expect(new ExecError('boom', '', '', 1).command).toEqual([]);
    expect(new ExecError('boom', '', '', 1, { cause: new Error('x') }).command).toEqual([]);
  });
});
