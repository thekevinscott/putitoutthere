import { describe, expect, it } from 'vitest';

import { ExecError } from './exec-error.js';
import { findExecError } from './find-exec-error.js';

describe('findExecError (#617)', () => {
  it('returns the error itself when it is already an ExecError', () => {
    const err = new ExecError('boom', 'out', 'err', 3);
    expect(findExecError(err)).toBe(err);
  });

  it('finds the ExecError one link down the cause chain', () => {
    // The shape every handler produces: catch the seam's ExecError, throw a
    // rendered message with it as `cause`.
    const exec = new ExecError('Command failed', '', 'npm error code E403', 1);
    expect(findExecError(new Error('npm publish failed', { cause: exec }))).toBe(exec);
  });

  it('finds it through several links', () => {
    const exec = new ExecError('Command failed', '', 'boom', 1);
    const wrapped = new Error('inner', { cause: exec });
    expect(findExecError(new Error('outer', { cause: wrapped }))).toBe(exec);
  });

  it('returns null for an error with no cause', () => {
    expect(findExecError(new Error('preflight rejected the manifest'))).toBeNull();
  });

  it('returns null when the chain ends in a non-Error cause', () => {
    // `cause` is untyped — a handler could attach anything.
    expect(findExecError(new Error('wrapped', { cause: 'a string' }))).toBeNull();
  });

  it('returns null for a non-Error input', () => {
    expect(findExecError('not an error')).toBeNull();
    expect(findExecError(undefined)).toBeNull();
  });

  it('terminates on a cyclic cause chain', () => {
    // `cause` is caller-supplied; a cycle must not hang the failure path,
    // which by definition runs when something has already gone wrong.
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(findExecError(a)).toBeNull();
  });

  it('gives up past the depth bound rather than walking forever', () => {
    // Pins the bound as a real limit: an ExecError buried deeper than the
    // walk goes is reported as absent, not found.
    let deepest: Error = new ExecError('Command failed', '', 'boom', 1);
    for (let i = 0; i < 12; i++) {
      deepest = new Error(`wrap-${i}`, { cause: deepest });
    }
    expect(findExecError(deepest)).toBeNull();
  });
});
