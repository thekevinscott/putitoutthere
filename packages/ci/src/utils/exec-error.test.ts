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
});
